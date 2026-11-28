import json
from datetime import datetime
from typing import List
from app.models import Order, Line, PrintJob, RecipeItem, Ingredient, StockMovement, StockLedger
from app.services.inventory_service import get_approved_recipe, today_str

def deduct_inventory_for_order(db, tenant_id: int, order_id: int, user_id: int = None):
    """Auto-deduct raw ingredient stock into StockLedger (append-only) and StockMovement."""
    lines = db.query(Line).filter_by(tenant_id=tenant_id, order_id=order_id).all()
    order_date = today_str()
    for line in lines:
        approved_rec = get_approved_recipe(db, tenant_id, line.item_id)
        if approved_rec:
            recipes = db.query(RecipeItem).filter_by(tenant_id=tenant_id, recipe_id=approved_rec.id).all()
        else:
            recipes = db.query(RecipeItem).filter_by(tenant_id=tenant_id, item_id=line.item_id).all()
        for r in recipes:
            ing = db.query(Ingredient).filter_by(tenant_id=tenant_id, id=r.ingredient_id).first()
            if ing:
                used = (r.qty or 0) * (line.qty or 0)
                if used <= 0:
                    continue
                ing.current_stock = (ing.current_stock or 0) - used
                cost = (ing.cost_per_unit or 0) * used
                db.add(StockLedger(
                    tenant_id=tenant_id,
                    bazar_item_id=ing.id,
                    quantity=-used,
                    type="sale",
                    date=order_date,
                    reason=f"POS Sale Order #{order_id} ({line.qty}x {line.name})",
                    created_by=user_id,
                ))
                db.add(StockMovement(
                    tenant_id=tenant_id,
                    ingredient_id=ing.id,
                    movement_type="sale_deduction",
                    qty_change=-used,
                    unit=ing.unit or "g",
                    cost_paisa=cost,
                    ref_order_id=order_id,
                    reason=f"Sale order #{order_id} ({line.qty}x {line.name})",
                    created_by=user_id,
                ))

def generate_print_jobs(db, tenant_id: int, order: Order, lines: List[Line], reprint: bool = False):
    """Generate station KOTs and Bill/Receipt print jobs."""
    stations = {}
    for l in lines:
        st = (l.station or "kitchen").lower()
        stations.setdefault(st, []).append(l)

    prefix = "[REPRINT] " if reprint else ""
    ts = (order.created_at or datetime.utcnow()).strftime('%Y-%m-%d %H:%M:%S')

    # 1. Station KOTs (separates KITCHEN vs BAR automatically)
    for station, s_lines in stations.items():
        text_lines = [
            f"=== {prefix}KOT: {station.upper()} ===",
            f"Order #{order.id} | Slot: {order.slot or '-'} | Ch: {order.channel}",
            f"Waiter: {order.waiter or '-'}",
            f"Time: {ts}",
            "--------------------------------",
        ]
        for sl in s_lines:
            text_lines.append(f"{sl.qty}x {sl.name}")
        text_lines.append("================================")

        job = PrintJob(
            tenant_id=tenant_id,
            order_id=order.id,
            type=f"kot_{station}",
            station=station,
            payload="\n".join(text_lines),
            status="pending"
        )
        db.add(job)

    # 2. Bill / Customer Receipt (Mushak 6.3 compliant summary)
    subtotal = order.subtotal or 0
    vat = order.vat or 0
    service = order.service or 0
    total = order.total or 0
    bill_lines = [
        "*** CROWN POINT OF SALE ***",
        f"Mushak Invoice / Receipt {prefix}",
        f"Order #{order.id} | Slot: {order.slot or '-'}",
        f"Channel: {(order.channel or 'dine_in').replace('_', ' ').title()}",
        f"Date: {ts}",
        "--------------------------------",
    ]
    for l in lines:
        up = l.unit_price or 0
        bill_lines.append(f"{l.name:<18} x{l.qty:>2} ৳{(up * l.qty)/100:>7.2f}")
    bill_lines.append("--------------------------------")
    bill_lines.append(f"Subtotal:          ৳{subtotal/100:.2f}")
    bill_lines.append(f"VAT:               ৳{vat/100:.2f}")
    if service > 0:
        bill_lines.append(f"Service Charge:    ৳{service/100:.2f}")
    bill_lines.append(f"Grand Total:       ৳{total/100:.2f}")
    bill_lines.append("================================")
    bill_lines.append("Thank you for dining with us!")

    db.add(PrintJob(
        tenant_id=tenant_id,
        order_id=order.id,
        type="receipt",
        station="counter",
        payload="\n".join(bill_lines),
        status="pending"
    ))
