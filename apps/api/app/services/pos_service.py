import json
from datetime import datetime
from typing import List
from app.models import Order, Line, PrintJob, RecipeItem, Ingredient, StockMovement

def deduct_inventory_for_order(db, tenant_id: int, order_id: int):
    """Auto-deduct raw ingredient stock and record StockMovement."""
    lines = db.query(Line).filter_by(tenant_id=tenant_id, order_id=order_id).all()
    for line in lines:
        recipes = db.query(RecipeItem).filter_by(tenant_id=tenant_id, item_id=line.item_id).all()
        for r in recipes:
            ing = db.query(Ingredient).filter_by(tenant_id=tenant_id, id=r.ingredient_id).first()
            if ing:
                used = r.qty * line.qty
                ing.current_stock = max(0, ing.current_stock - used)
                cost = ing.cost_per_unit * used
                db.add(StockMovement(
                    tenant_id=tenant_id,
                    ingredient_id=ing.id,
                    movement_type="sale_deduction",
                    qty_change=-used,
                    unit=ing.unit,
                    cost_paisa=cost,
                    ref_order_id=order_id,
                    reason=f"Sale order #{order_id} ({line.qty}x {line.name})"
                ))

def generate_print_jobs(db, tenant_id: int, order: Order, lines: List[Line], reprint: bool = False):
    """Generate station KOTs and Bill/Receipt print jobs."""
    stations = {}
    for l in lines:
        stations.setdefault(l.station, []).append(l)

    prefix = "[REPRINT] " if reprint else ""

    # 1. Station KOTs
    for station, s_lines in stations.items():
        text_lines = [
            f"=== {prefix}KOT: {station.upper()} ===",
            f"Order #{order.id} | Slot: {order.slot or '-'} | Ch: {order.channel}",
            f"Waiter: {order.waiter or '-'}",
            f"Time: {order.created_at.strftime('%Y-%m-%d %H:%M:%S')}",
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
    bill_lines = [
        "*** CROWN POINT OF SALE ***",
        f"Mushak Invoice / Receipt {prefix}",
        f"Order #{order.id} | Slot: {order.slot or '-'}",
        f"Channel: {order.channel.replace('_', ' ').title()}",
        f"Date: {order.created_at.strftime('%Y-%m-%d %H:%M:%S')}",
        "--------------------------------",
    ]
    for l in lines:
        bill_lines.append(f"{l.name:<18} x{l.qty:>2} ৳{(l.unit_price * l.qty)/100:>7.2f}")
    bill_lines.append("--------------------------------")
    bill_lines.append(f"Subtotal:          ৳{order.subtotal/100:.2f}")
    bill_lines.append(f"VAT:               ৳{order.vat/100:.2f}")
    if order.service > 0:
        bill_lines.append(f"Service Charge:    ৳{order.service/100:.2f}")
    bill_lines.append(f"Grand Total:       ৳{order.total/100:.2f}")
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
