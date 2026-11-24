from fastapi import APIRouter, Depends
from app.dependencies import get_db, auth, apply_postgres_rls
from app.models import Order, Line, Payment, Item
from app.schemas import SyncBatchIn
from app.services.pos_service import generate_print_jobs, deduct_inventory_for_order
from app.routers.shifts import cur
from app.routers.orders import ser
from app.database import SVC, VAT

router = APIRouter(prefix="/sync", tags=["sync"])

@router.post("/outbox")
def sync_outbox(b: SyncBatchIn, u=Depends(auth), db=Depends(get_db)):
    results = []
    t = u["tid"]
    apply_postgres_rls(db, t)
    s = cur(db, t)
    for itm in b.items:
        act = itm.action
        uuid = itm.client_uuid
        data = itm.data
        if act == "create_order":
            ex = db.query(Order).filter_by(tenant_id=t, client_uuid=uuid).first()
            if ex:
                results.append({"client_uuid": uuid, "status": "success", "order": ser(ex, db)})
                continue
            if not s:
                results.append({"client_uuid": uuid, "status": "error", "error": "No open shift"})
                continue
            try:
                lines, sub = [], 0
                for l in data.get("lines", []):
                    item_id = l.get("item_id")
                    qty = l.get("qty", 1)
                    item_obj = db.get(Item, item_id)
                    if item_obj and item_obj.tenant_id == t and qty > 0:
                        sub += item_obj.price * qty
                        lines.append(Line(tenant_id=t, item_id=item_obj.id, name=item_obj.name, qty=qty, unit_price=item_obj.price, station=item_obj.station))
                if not lines:
                    results.append({"client_uuid": uuid, "status": "error", "error": "Empty or invalid items"})
                    continue
                svc = round(sub * SVC / 100) if data.get("channel") == "dine_in" else 0
                vat = round(sub * VAT / 100)
                o = Order(
                    tenant_id=t,
                    shift_id=s.id,
                    client_uuid=uuid,
                    channel=data.get("channel"),
                    slot=data.get("slot"),
                    waiter=data.get("waiter"),
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
                generate_print_jobs(db, t, o, lines)
                deduct_inventory_for_order(db, t, o.id)
                db.commit()
                results.append({"client_uuid": uuid, "status": "success", "order": ser(o, db)})
            except Exception as e:
                db.rollback()
                results.append({"client_uuid": uuid, "status": "error", "error": str(e)})

        elif act == "pay_order":
            order_uuid = data.get("order_client_uuid")
            order_id = data.get("order_id")
            o = None
            if order_uuid:
                o = db.query(Order).filter_by(tenant_id=t, client_uuid=order_uuid).first()
            elif order_id:
                o = db.get(Order, order_id)
            if not o or o.tenant_id != t:
                results.append({"client_uuid": uuid, "status": "error", "error": "Order not found"})
                continue
            if o.status == "paid":
                results.append({"client_uuid": uuid, "status": "success", "paid": True, "change": 0})
                continue
            db.add(Payment(tenant_id=t, order_id=o.id, client_uuid=uuid, method=data.get("method", "cash"), amount=o.total))
            o.status = "paid"
            db.commit()
            results.append({"client_uuid": uuid, "status": "success", "paid": True, "change": max(0, data.get("amount", o.total) - o.total)})
        else:
            results.append({"client_uuid": uuid, "status": "error", "error": f"Unknown action: {act}"})
    return {"results": results}
