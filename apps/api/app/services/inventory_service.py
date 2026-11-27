from datetime import date
from typing import Optional, Dict
from fastapi import HTTPException
from sqlalchemy import func
from app.models import Ingredient, Recipe, RecipeItem, StockLedger

ALLOWED_UNITS = {"g", "gm", "kg", "ml", "l", "L", "pcs"}


def today_str() -> str:
    return date.today().isoformat()


def validate_barcode(barcode: Optional[str]) -> Optional[str]:
    if barcode is None:
        return None
    code = barcode.strip().upper()
    if not code:
        return None
    if code.startswith("QTY-"):
        raise HTTPException(400, "Barcode cannot start with reserved prefix 'QTY-'")
    return code


def convert_to_base_units(amount: float, unit: str, base_unit: str) -> int:
    """Convert g/kg/ml/L/pcs to integer base units (g, ml, pcs)."""
    if amount is None or amount <= 0:
        raise HTTPException(400, "Amount must be greater than zero")

    u = unit.strip()
    if u not in ALLOWED_UNITS:
        raise HTTPException(400, f"Invalid unit '{unit}'. Allowed: g, kg, ml, L, pcs")

    u_lower = u.lower()
    bu = base_unit.strip().lower()

    if bu in ("g", "gm"):
        if u_lower in ("g", "gm"):
            return int(round(amount))
        if u_lower == "kg":
            return int(round(amount * 1000))
        raise HTTPException(400, f"Unit '{unit}' is incompatible with base unit 'g'")
    elif bu == "ml":
        if u_lower == "ml":
            return int(round(amount))
        if u_lower == "l":
            return int(round(amount * 1000))
        raise HTTPException(400, f"Unit '{unit}' is incompatible with base unit 'ml'")
    elif bu == "pcs":
        if u_lower == "pcs":
            return int(round(amount))
        raise HTTPException(400, f"Unit '{unit}' is incompatible with base unit 'pcs'")
    else:
        raise HTTPException(400, f"Unsupported base unit '{base_unit}'")


def get_current_stock_map(db, tenant_id: int) -> Dict[int, int]:
    """Current stock per bazar item = SUM of ledger quantity."""
    rows = (
        db.query(StockLedger.bazar_item_id, func.coalesce(func.sum(StockLedger.quantity), 0))
        .filter(StockLedger.tenant_id == tenant_id)
        .group_by(StockLedger.bazar_item_id)
        .all()
    )
    return {item_id: int(total or 0) for item_id, total in rows}


def get_approved_recipe(db, tenant_id: int, item_id: int) -> Optional[Recipe]:
    """Return the active approved recipe version for a menu item, if any."""
    return (
        db.query(Recipe)
        .filter_by(tenant_id=tenant_id, item_id=item_id, status="approved")
        .order_by(Recipe.version.desc())
        .first()
    )


def get_inventory_summary(
    db,
    tenant_id: int,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    """Compute Central, Bazar, Sale, Reversal, Current Stock, Min Stock, Status per bazar item."""
    ings = db.query(Ingredient).filter_by(tenant_id=tenant_id).order_by(Ingredient.name.asc()).all()
    current_map = get_current_stock_map(db, tenant_id)

    ledger_q = db.query(StockLedger).filter(StockLedger.tenant_id == tenant_id)
    if start_date:
        ledger_q = ledger_q.filter(StockLedger.date >= start_date)
    if end_date:
        ledger_q = ledger_q.filter(StockLedger.date <= end_date)

    all_entries = ledger_q.all()
    reversed_ids = {e.ref_ledger_id for e in all_entries if e.type == "reversal" and e.ref_ledger_id}

    by_type: Dict[int, Dict[str, int]] = {}
    for e in all_entries:
        if e.type == "reversal":
            by_type.setdefault(e.bazar_item_id, {})["reversal"] = by_type.get(e.bazar_item_id, {}).get("reversal", 0) + int(e.quantity or 0)
            continue
        if e.id in reversed_ids:
            continue
        by_type.setdefault(e.bazar_item_id, {})[e.type] = by_type.get(e.bazar_item_id, {}).get(e.type, 0) + int(e.quantity or 0)

    result = []
    for ing in ings:
        tmap = by_type.get(ing.id, {})
        central_total = tmap.get("central", 0)
        bazar_total = tmap.get("bazar", 0)
        sale_raw = tmap.get("sale", 0)  # negative in ledger
        sale_total = -sale_raw if sale_raw < 0 else sale_raw
        reversal_total = tmap.get("reversal", 0)
        current_stock = current_map.get(ing.id, 0)
        min_stock = ing.min_stock or 0
        is_low = current_stock < min_stock
        suggested_buy = max(0, min_stock - current_stock) if is_low else 0

        result.append({
            "id": ing.id,
            "barcode": ing.barcode,
            "name": ing.name,
            "unit": ing.unit,
            "base_unit": ing.unit,
            "pack_size": int(ing.pack_size or 1),
            "pack_unit": ing.pack_unit or ing.unit,
            "min_stock": min_stock,
            "central_total": central_total,
            "bazar_total": bazar_total,
            "sale_total": sale_total,
            "reversal_total": reversal_total,
            "current_stock": current_stock,
            "status": "LOW" if is_low else "OK",
            "suggested_buy": suggested_buy,
            "cost_per_unit": ing.cost_per_unit or 0,
        })
    return result
