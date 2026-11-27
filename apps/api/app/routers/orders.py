from fastapi import APIRouter, Depends, HTTPException
from app.database import now, VAT, SVC
from app.dependencies import get_db, auth, apply_postgres_rls
from app.models import Order, Line, Payment, Item, User, VoidRefund
from app.schemas import OrderIn, PayIn, VoidRefundIn, TableTransferIn
from app.security import check_rate_limit, record_failed_attempt, clear_rate_limit
from app.services.pos_service import deduct_inventory_for_order, generate_print_jobs

router = APIRouter(prefix="/orders", tags=["orders"])

def ser(o, db=None):
    res = {
        "id": o.id,
        "client_uuid": o.client_uuid,
        "channel": o.channel,
        "slot": o.slot,
        "waiter": o.waiter,
        "status": o.status,
        "subtotal": o.subtotal,
        "vat": o.vat,
        "service": o.service,
        "total": o.total,
        "created_at": o.created_at.isoformat() if o.created_at else None
    }
    if db:
        lines = db.query(Line).filter_by(tenant_id=o.tenant_id, order_id=o.id).all()
        res["lines"] = [
            {"id": l.id, "item_id": l.item_id, "name": l.name, "qty": l.qty, "unit_price": l.unit_price, "station": l.station}
            for l in lines
        ]
    return res

@router.get("/open")
def open_orders(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    orders = db.query(Order).filter_by(tenant_id=u["tid"], status="open").all()
    return [ser(o, db) for o in orders]

@router.post("")
def create_order(b: OrderIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] == "manager":
        raise HTTPException(403, "Manager account is restricted to Inventory and Stock operations only")
    t = u["tid"]
    apply_postgres_rls(db, t)
    ex = db.query(Order).filter_by(tenant_id=t, client_uuid=b.client_uuid).first()
    if ex:
        return ser(ex, db)
    
    from app.routers.shifts import cur
    s = cur(db, t)
    if not s:
        raise HTTPException(400, "Open a shift first")
    
    lines, sub = [], 0
    for l in b.lines:
        it = db.get(Item, l.item_id)
        if not it or it.tenant_id != t or l.qty < 1:
            raise HTTPException(400, "Bad item")
        price = it.price or 0
        sub += price * l.qty
        lines.append(Line(tenant_id=t, item_id=it.id, name=it.name, qty=l.qty, unit_price=price, station=it.station))
    if not lines:
        raise HTTPException(400, "Empty order")
    
    svc = round(sub * SVC / 100) if b.channel == "dine_in" else 0
    vat = round(sub * VAT / 100)
    try:
        o = Order(
            tenant_id=t,
            branch_id=u.get("branch_id"),
            shift_id=s.id,
            client_uuid=b.client_uuid,
            channel=b.channel,
            slot=b.slot,
            waiter=b.waiter,
            subtotal=sub,
            vat=vat,
            service=svc,
            total=sub + vat + svc
        )
        db.add(o)
        db.flush()
        for l in lines:
            l.order_id = o.id
            db.add(l)
        db.flush()

        generate_print_jobs(db, t, o, lines)
        deduct_inventory_for_order(db, t, o.id)
        db.commit()
        return ser(o, db)
    except HTTPException:
        raise
    except Exception as e:
        import logging, traceback
        logging.getLogger("easypos.orders").error(f"Order creation failed: {e}\n{traceback.format_exc()}")
        db.rollback()
        raise HTTPException(500, detail=f"Order failed: {str(e)}")

@router.post("/{oid}/transfer")
def transfer_table(oid: int, b: TableTransferIn, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    o = db.get(Order, oid)
    if not o or o.tenant_id != u["tid"]:
        raise HTTPException(404, "Order not found")
    if o.status != "open":
        raise HTTPException(400, "Only open orders can be transferred")
    old_slot = o.slot
    o.slot = b.target_slot
    db.commit()
    return {"status": "ok", "old_slot": old_slot, "new_slot": o.slot}

@router.post("/{oid}/print-bill")
def print_bill(oid: int, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    o = db.get(Order, oid)
    if not o or o.tenant_id != u["tid"]:
        raise HTTPException(404, "Order not found")
    lines = db.query(Line).filter_by(tenant_id=u["tid"], order_id=o.id).all()
    generate_print_jobs(db, u["tid"], o, lines, reprint=True)
    db.commit()
    return {"status": "bill_queued"}

@router.post("/{oid}/pay")
def pay(oid: int, b: PayIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] == "manager":
        raise HTTPException(403, "Manager account is restricted to Inventory and Stock operations only")
    apply_postgres_rls(db, u["tid"])
    o = db.get(Order, oid)
    if not o or o.tenant_id != u["tid"]:
        raise HTTPException(404, "Order not found")
    if o.status == "paid":
        return {"change": 0, "status": "paid"}
    if o.status != "open":
        raise HTTPException(400, f"Cannot pay order in status {o.status}")
    if b.amount < o.total:
        raise HTTPException(400, "Amount is less than total")
    
    db.add(Payment(tenant_id=o.tenant_id, order_id=o.id, client_uuid=b.client_uuid, method=b.method, amount=o.total))
    o.status = "paid"
    db.commit()
    return {"change": b.amount - o.total, "status": "paid"}

@router.post("/void-refund")
def void_or_refund(b: VoidRefundIn, u=Depends(auth), db=Depends(get_db)):
    if b.type not in ("void", "refund"):
        raise HTTPException(400, "Type must be void or refund")
    apply_postgres_rls(db, u["tid"])
    o = db.get(Order, b.order_id)
    if not o or o.tenant_id != u["tid"]:
        raise HTTPException(404, "Order not found")
    
    rate_key = f"pin:{u['tid']}:{u['uid']}"
    if not check_rate_limit(rate_key, max_attempts=5, window_seconds=60):
        raise HTTPException(429, "Too many failed PIN attempts. Please wait 1 minute.")

    managers = db.query(User).filter(
        User.tenant_id == u["tid"],
        User.role.in_(["owner", "manager"])
    ).all()
    approver = None
    for m in managers:
        if m.pin and m.pin == b.manager_pin:
            approver = m
            break
    if not approver:
        record_failed_attempt(rate_key)
        raise HTTPException(403, "Invalid manager approval PIN")
    clear_rate_limit(rate_key)

    if b.type == "void":
        if o.status == "paid":
            raise HTTPException(400, "Paid order cannot be voided; use refund")
        o.status = "voided"
        rec = VoidRefund(tenant_id=u["tid"], order_id=o.id, type="void", reason=b.reason, amount=o.total, approved_by=approver.id)
        db.add(rec)
    elif b.type == "refund":
        if o.status != "paid":
            raise HTTPException(400, "Only paid orders can be refunded")
        o.status = "refunded"
        rec = VoidRefund(tenant_id=u["tid"], order_id=o.id, type="refund", reason=b.reason, amount=o.total, approved_by=approver.id)
        db.add(rec)
    
    db.commit()
    return {"status": o.status, "type": b.type, "approved_by": approver.name}
