from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from app.dependencies import get_db, auth, apply_postgres_rls, verify_owner_password
from app.models import (
    Ingredient, RecipeItem, Item, DailyBazar, StockMovement,
    BazarTrip, StockLedger, User, InventoryBatch, InventoryBatchLine
)
from app.schemas import (
    IngredientIn, IngredientUpdateIn, RecipeSetIn, DailyBazarIn,
    WastageIn, BazarTripIn, LedgerReversalIn, InventoryClearIn, OwnerActionIn
)
from app.services.inventory_service import get_inventory_summary, get_current_stock_map, validate_barcode, today_str

router = APIRouter(prefix="/inventory", tags=["inventory"])

@router.get("")
def list_inventory(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    u=Depends(auth),
    db=Depends(get_db),
):
    try:
        apply_postgres_rls(db, u["tid"])
        return get_inventory_summary(db, u["tid"], start_date=start_date, end_date=end_date)
    except Exception as e:
        err_msg = str(e)
        if "barcode does not exist" in err_msg or "UndefinedColumn" in err_msg:
            from app.seed import _ensure_columns
            _ensure_columns()
            db.rollback()
            apply_postgres_rls(db, u["tid"])
            return get_inventory_summary(db, u["tid"], start_date=start_date, end_date=end_date)
        import logging, traceback
        logging.getLogger("easypos.inventory").error(f"Error in list_inventory: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, detail=f"Inventory error: {str(e)}")

@router.post("")
def add_ingredient(b: IngredientIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Managers only")
    if b.unit not in ("g", "ml", "pcs"):
        raise HTTPException(400, "Base unit must be g, ml, or pcs")
    if b.min_stock < 0:
        raise HTTPException(400, "Minimum stock cannot be negative")
    apply_postgres_rls(db, u["tid"])

    import re
    import uuid

    barcode = validate_barcode(b.barcode) if b.barcode else None
    if barcode:
        existing = db.query(Ingredient).filter_by(tenant_id=u["tid"], barcode=barcode).first()
        if existing:
            raise HTTPException(400, f"Barcode '{barcode}' already exists on another bazar item")
    else:
        # Auto-generate a clean, descriptive barcode from name
        clean_name = re.sub(r"[^A-Z0-9]+", "-", b.name.upper()).strip("-")
        if not clean_name:
            clean_name = "ITEM"
        clean_name = clean_name[:12]
        candidate = f"ING-{clean_name}-{b.unit.upper()}"
        if db.query(Ingredient).filter_by(tenant_id=u["tid"], barcode=candidate).first():
            candidate = f"ING-{clean_name}-{uuid.uuid4().hex[:4].upper()}"
        barcode = candidate

    ing = Ingredient(
        tenant_id=u["tid"],
        barcode=barcode,
        name=b.name,
        unit=b.unit,
        pack_size=b.pack_size,
        pack_unit=b.pack_unit,
        min_stock=b.min_stock,
        current_stock=0,
        cost_per_unit=b.cost_per_unit
    )
    db.add(ing)
    db.commit()
    return {"id": ing.id, "barcode": ing.barcode, "name": ing.name}

@router.get("/shopping-list")
def shopping_list(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    summary = get_inventory_summary(db, u["tid"])
    return [item for item in summary if item["status"] == "LOW"]

@router.get("/ledger")
def list_ledger(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    bazar_item_id: Optional[int] = Query(None),
    type: Optional[str] = Query(None),
    u=Depends(auth),
    db=Depends(get_db),
):
    try:
        apply_postgres_rls(db, u["tid"])
        q = db.query(StockLedger).filter_by(tenant_id=u["tid"])
        if start_date:
            q = q.filter(StockLedger.date >= start_date)
        if end_date:
            q = q.filter(StockLedger.date <= end_date)
        if bazar_item_id:
            q = q.filter(StockLedger.bazar_item_id == bazar_item_id)
        if type:
            q = q.filter(StockLedger.type == type)

        entries = q.order_by(StockLedger.created_at.desc(), StockLedger.id.desc()).limit(300).all()
        res = []
        for e in entries:
            ing = db.get(Ingredient, e.bazar_item_id)
            usr = db.get(User, e.created_by) if e.created_by else None
            res.append({
                "id": e.id,
                "bazar_item_id": e.bazar_item_id,
                "bazar_item_name": ing.name if ing else "Unknown",
                "unit": ing.unit if ing else "",
                "quantity": e.quantity,
                "type": e.type,
                "batch_id": e.batch_id,
                "ref_ledger_id": e.ref_ledger_id,
                "date": e.date,
                "reason": e.reason,
                "created_by": usr.name if usr else "System",
                "created_at": e.created_at.isoformat() if e.created_at else None,
            })
        return res
    except Exception as e:
        import logging, traceback
        logging.getLogger("easypos.inventory").error(f"Error in list_ledger: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, detail=f"Ledger error: {str(e)}")

@router.post("/ledger/{ledger_id}/reverse")
def reverse_ledger_entry(ledger_id: int, b: LedgerReversalIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Only manager or owner can reverse ledger entries")
    if not b.reason or not b.reason.strip():
        raise HTTPException(400, "Reversal reason is required")
    apply_postgres_rls(db, u["tid"])
    verify_owner_password(db, u["tid"], b.owner_password)

    orig = db.get(StockLedger, ledger_id)
    if not orig or orig.tenant_id != u["tid"]:
        raise HTTPException(404, "Ledger entry not found")
    if orig.type == "reversal":
        raise HTTPException(400, "Cannot reverse a reversal entry")

    already = db.query(StockLedger).filter_by(tenant_id=u["tid"], ref_ledger_id=orig.id, type="reversal").first()
    if already:
        raise HTTPException(400, "This ledger entry has already been reversed")

    rev = StockLedger(
        tenant_id=u["tid"],
        bazar_item_id=orig.bazar_item_id,
        quantity=-orig.quantity,
        type="reversal",
        batch_id=orig.batch_id,
        ref_ledger_id=orig.id,
        date=today_str(),
        reason=b.reason.strip(),
        created_by=u["uid"],
    )
    db.add(rev)

    ing = db.get(Ingredient, orig.bazar_item_id)
    if ing:
        ing.current_stock = (ing.current_stock or 0) + rev.quantity

    db.commit()
    return {"id": rev.id, "quantity": rev.quantity, "type": "reversal", "ref_ledger_id": orig.id}

@router.get("/movements")
def list_movements(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    moves = db.query(StockMovement).filter_by(tenant_id=u["tid"]).order_by(StockMovement.created_at.desc()).limit(100).all()
    res = []
    for m in moves:
        ing = db.get(Ingredient, m.ingredient_id)
        res.append({
            "id": m.id,
            "ingredient_name": ing.name if ing else "Item",
            "type": m.movement_type,
            "qty_change": m.qty_change,
            "unit": m.unit,
            "cost_paisa": m.cost_paisa,
            "reason": m.reason,
            "date": m.created_at.isoformat()
        })
    return res

@router.post("/wastage")
def record_wastage(b: WastageIn, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    ing = db.get(Ingredient, b.ingredient_id)
    if not ing or ing.tenant_id != u["tid"]:
        raise HTTPException(404, "Ingredient not found")
    if b.qty_lost <= 0:
        raise HTTPException(400, "Quantity must be greater than zero")

    actual_lost = min(ing.current_stock, b.qty_lost)
    ing.current_stock -= actual_lost
    cost = actual_lost * ing.cost_per_unit

    db.add(StockMovement(
        tenant_id=u["tid"],
        ingredient_id=ing.id,
        movement_type="wastage",
        qty_change=-actual_lost,
        unit=ing.unit,
        cost_paisa=cost,
        reason=b.reason,
        created_by=u["uid"]
    ))
    db.commit()
    return {"status": "ok", "remaining_stock": ing.current_stock, "cost_lost": cost}

@router.get("/recipes/{item_id}")
def get_recipe(item_id: int, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    recipes = db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=item_id).all()
    res = []
    for r in recipes:
        ing = db.get(Ingredient, r.ingredient_id)
        res.append({
            "ingredient_id": r.ingredient_id,
            "ingredient_name": ing.name if ing else "Unknown",
            "unit": ing.unit if ing else "",
            "qty": r.qty,
            "version": r.version,
            "cost_paisa": (ing.cost_per_unit * r.qty) if ing else 0
        })
    return res

@router.post("/recipes")
def set_recipe(b: RecipeSetIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Managers only")
    apply_postgres_rls(db, u["tid"])
    it = db.get(Item, b.item_id)
    if not it or it.tenant_id != u["tid"]:
        raise HTTPException(404, "Item not found")

    db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=b.item_id).delete()
    for ri in b.ingredients:
        ing = db.get(Ingredient, ri.ingredient_id)
        if not ing or ing.tenant_id != u["tid"]:
            raise HTTPException(400, "Invalid ingredient")
        db.add(RecipeItem(tenant_id=u["tid"], item_id=b.item_id, ingredient_id=ri.ingredient_id, qty=ri.qty, version=1))
    db.commit()
    return {"status": "ok"}

@router.get("/daily-bazar")
def get_daily_bazar(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    records = db.query(DailyBazar).filter_by(tenant_id=u["tid"]).order_by(DailyBazar.purchased_at.desc()).all()
    res = []
    for r in records:
        ing = db.get(Ingredient, r.ingredient_id)
        from app.models import User
        usr = db.get(User, r.purchased_by)
        res.append({
            "id": r.id,
            "ingredient_id": r.ingredient_id,
            "ingredient_name": ing.name if ing else "Unknown",
            "unit": ing.unit if ing else "",
            "qty_purchased": r.qty_purchased,
            "total_cost": r.total_cost,
            "purchased_by": usr.name if usr else "Staff",
            "purchased_at": r.purchased_at.isoformat()
        })
    return res

@router.post("/daily-bazar")
def add_daily_bazar(b: DailyBazarIn, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    ing = db.get(Ingredient, b.ingredient_id)
    if not ing or ing.tenant_id != u["tid"]:
        raise HTTPException(404, "Ingredient not found")
    if b.qty_purchased <= 0 or b.total_cost < 0:
        raise HTTPException(400, "Invalid quantities")

    new_cost_per_unit = round(b.total_cost / b.qty_purchased)
    ing.current_stock += b.qty_purchased
    ing.cost_per_unit = new_cost_per_unit

    record = DailyBazar(
        tenant_id=u["tid"],
        client_uuid=b.client_uuid,
        ingredient_id=b.ingredient_id,
        qty_purchased=b.qty_purchased,
        total_cost=b.total_cost,
        purchased_by=u["uid"]
    )
    db.add(record)

    db.add(StockMovement(
        tenant_id=u["tid"],
        ingredient_id=ing.id,
        movement_type="daily_bazar",
        qty_change=b.qty_purchased,
        unit=ing.unit,
        cost_paisa=b.total_cost,
        reason="Daily Bazar purchase"
    ))
    db.commit()
    return {"id": record.id, "new_stock": ing.current_stock, "cost_per_unit": ing.cost_per_unit}

# Production Barcode Scanning Trips
@router.post("/bazar-trips")
def create_production_bazar_trip(b: BazarTripIn, u=Depends(auth), db=Depends(get_db)):
    """Production scanned trip approval: increments real ingredients and records audit movements."""
    apply_postgres_rls(db, u["tid"])
    if not b.lines:
        raise HTTPException(400, "Cannot approve empty trip")

    total_cost = sum(l.total_cost for l in b.lines)
    trip = BazarTrip(
        tenant_id=u["tid"],
        trip_name=b.trip_name,
        shopper_name=b.shopper_name,
        total_cost=total_cost,
        receipt_memo=b.receipt_memo,
        created_by=u["uid"],
        status="approved"
    )
    db.add(trip)
    db.flush()

    for l in b.lines:
        ing = db.get(Ingredient, l.ingredient_id)
        if not ing or ing.tenant_id != u["tid"]:
            continue
        base_units_added = round(l.pack_count * (ing.pack_size or 1.0))
        ing.current_stock += base_units_added
        if base_units_added > 0:
            ing.cost_per_unit = round(l.total_cost / base_units_added)

        db.add(DailyBazar(
            tenant_id=u["tid"],
            trip_id=trip.id,
            ingredient_id=ing.id,
            qty_purchased=base_units_added,
            total_cost=l.total_cost,
            purchased_by=u["uid"]
        ))

        db.add(StockMovement(
            tenant_id=u["tid"],
            ingredient_id=ing.id,
            movement_type="daily_bazar",
            qty_change=base_units_added,
            unit=ing.unit,
            cost_paisa=l.total_cost,
            ref_trip_id=trip.id,
            reason=f"Scanned Bazar Trip #{trip.id}: {b.trip_name}",
            created_by=u["uid"]
        ))

    db.commit()
    return {"id": trip.id, "total_cost": total_cost, "status": "approved"}


@router.post("/clear")
def clear_inventory_scope(b: InventoryClearIn, u=Depends(auth), db=Depends(get_db)):
    """Clear Monthly Opening Stock (central), Daily Bazar (bazar), Daily Sale (sale), or ALL stocks. Strictly requires Owner Password."""
    valid_scopes = {"central", "bazar", "sale", "all"}
    if b.scope not in valid_scopes:
        raise HTTPException(400, "Invalid scope. Must be central, bazar, sale, or all")

    apply_postgres_rls(db, u["tid"])
    verify_owner_password(db, u["tid"], b.owner_password)

    tid = u["tid"]
    batches_deleted = 0
    ledger_deleted = 0

    if b.scope == "all":
        db.query(InventoryBatchLine).filter_by(tenant_id=tid).delete(synchronize_session=False)
        batches_deleted = db.query(InventoryBatch).filter_by(tenant_id=tid).delete(synchronize_session=False)
        ledger_deleted = db.query(StockLedger).filter_by(tenant_id=tid).delete(synchronize_session=False)
        db.query(DailyBazar).filter_by(tenant_id=tid).delete(synchronize_session=False)
        db.query(StockMovement).filter_by(tenant_id=tid).delete(synchronize_session=False)
        db.query(Ingredient).filter_by(tenant_id=tid).update({"current_stock": 0}, synchronize_session=False)
    else:
        batch_rows = db.query(InventoryBatch.id).filter_by(tenant_id=tid, batch_type=b.scope).all()
        batch_ids = [row[0] for row in batch_rows]

        if batch_ids:
            db.query(InventoryBatchLine).filter(
                InventoryBatchLine.tenant_id == tid,
                InventoryBatchLine.batch_id.in_(batch_ids),
            ).delete(synchronize_session=False)

            ledger_deleted += db.query(StockLedger).filter(
                StockLedger.tenant_id == tid,
                StockLedger.batch_id.in_(batch_ids),
            ).delete(synchronize_session=False)

            batches_deleted = db.query(InventoryBatch).filter(
                InventoryBatch.tenant_id == tid,
                InventoryBatch.id.in_(batch_ids),
            ).delete(synchronize_session=False)

        # Also delete any standalone ledger entries of this scope type
        ledger_deleted += db.query(StockLedger).filter_by(tenant_id=tid, type=b.scope).delete(synchronize_session=False)

        if b.scope == "bazar":
            db.query(DailyBazar).filter_by(tenant_id=tid).delete(synchronize_session=False)
            db.query(StockMovement).filter_by(tenant_id=tid, movement_type="daily_bazar").delete(synchronize_session=False)

        db.flush()
        # Re-sync Ingredient.current_stock from remaining StockLedger sums
        stock_map = get_current_stock_map(db, tid)
        for ing in db.query(Ingredient).filter_by(tenant_id=tid).all():
            ing.current_stock = stock_map.get(ing.id, 0)

    db.commit()
    return {
        "status": "cleared",
        "scope": b.scope,
        "batches_deleted": batches_deleted,
        "ledger_entries_deleted": ledger_deleted,
    }


@router.patch("/{ingredient_id}")
def update_ingredient(ingredient_id: int, b: IngredientUpdateIn, u=Depends(auth), db=Depends(get_db)):
    """Edit ingredient / bazar item name, price (cost_per_unit), unit, min_stock, or barcode. Requires Owner Password."""
    apply_postgres_rls(db, u["tid"])
    verify_owner_password(db, u["tid"], b.owner_password)

    ing = db.query(Ingredient).filter_by(tenant_id=u["tid"], id=ingredient_id).first()
    if not ing:
        raise HTTPException(404, "Ingredient not found")

    if b.name is not None and b.name.strip():
        ing.name = b.name.strip()
    if b.unit is not None:
        if b.unit not in ("g", "ml", "pcs"):
            raise HTTPException(400, "Base unit must be g, ml, or pcs")
        ing.unit = b.unit
    if b.barcode is not None and b.barcode.strip():
        clean_bc = validate_barcode(b.barcode)
        if clean_bc != ing.barcode:
            exists = db.query(Ingredient).filter_by(tenant_id=u["tid"], barcode=clean_bc).first()
            if exists:
                raise HTTPException(400, f"Barcode '{clean_bc}' already in use")
            ing.barcode = clean_bc
    if b.pack_size is not None and b.pack_size > 0:
        ing.pack_size = b.pack_size
    if b.pack_unit is not None:
        ing.pack_unit = b.pack_unit
    if b.min_stock is not None:
        if b.min_stock < 0:
            raise HTTPException(400, "Minimum stock cannot be negative")
        ing.min_stock = b.min_stock
    if b.cost_per_unit is not None:
        if b.cost_per_unit < 0:
            raise HTTPException(400, "Cost per unit cannot be negative")
        ing.cost_per_unit = b.cost_per_unit

    db.commit()
    db.refresh(ing)
    return {
        "id": ing.id,
        "name": ing.name,
        "barcode": ing.barcode,
        "unit": ing.unit,
        "pack_size": ing.pack_size,
        "pack_unit": ing.pack_unit,
        "min_stock": ing.min_stock,
        "cost_per_unit": ing.cost_per_unit,
        "current_stock": ing.current_stock,
    }


@router.post("/{ingredient_id}/delete")
def delete_ingredient(ingredient_id: int, b: OwnerActionIn, u=Depends(auth), db=Depends(get_db)):
    """Delete an ingredient / bazar item and its references. Strictly requires Owner Password."""
    apply_postgres_rls(db, u["tid"])
    verify_owner_password(db, u["tid"], b.owner_password)

    ing = db.query(Ingredient).filter_by(tenant_id=u["tid"], id=ingredient_id).first()
    if not ing:
        raise HTTPException(404, "Ingredient not found")

    tid = u["tid"]
    db.query(RecipeItem).filter_by(tenant_id=tid, ingredient_id=ing.id).delete(synchronize_session=False)
    db.query(InventoryBatchLine).filter_by(tenant_id=tid, bazar_item_id=ing.id).delete(synchronize_session=False)
    db.query(StockLedger).filter_by(tenant_id=tid, bazar_item_id=ing.id).delete(synchronize_session=False)
    db.query(DailyBazar).filter_by(tenant_id=tid, ingredient_id=ing.id).delete(synchronize_session=False)
    db.query(StockMovement).filter_by(tenant_id=tid, ingredient_id=ing.id).delete(synchronize_session=False)
    db.delete(ing)
    db.commit()
    return {"status": "deleted", "id": ingredient_id}
