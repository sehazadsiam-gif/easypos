from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from app.database import now
from app.dependencies import get_db, auth, apply_postgres_rls, verify_owner_password
from app.models import (
    Ingredient,
    Item,
    Recipe,
    RecipeItem,
    InventoryBatch,
    InventoryBatchLine,
    StockLedger,
    User,
)
from app.schemas import BatchCreateIn, BatchLinesUpdateIn, BatchApproveIn
from app.services.inventory_service import today_str, get_current_stock_map, get_approved_recipe

router = APIRouter(prefix="/batches", tags=["batches"])

VALID_BATCH_TYPES = {"central", "bazar", "sale"}


def _serialize_batch(db, tenant_id: int, batch: InventoryBatch, include_lines: bool = False):
    creator = db.get(User, batch.created_by) if batch.created_by else None
    approver = db.get(User, batch.approved_by) if batch.approved_by else None
    lines = db.query(InventoryBatchLine).filter_by(tenant_id=tenant_id, batch_id=batch.id).all()

    data = {
        "id": batch.id,
        "batch_type": batch.batch_type,
        "batch_date": batch.batch_date,
        "status": batch.status,
        "note": batch.note,
        "allow_negative_stock": batch.allow_negative_stock,
        "line_count": len(lines),
        "created_by": creator.name if creator else "Staff",
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
        "approved_by": approver.name if approver else None,
        "approved_at": batch.approved_at.isoformat() if batch.approved_at else None,
    }

    if include_lines:
        stock_map = get_current_stock_map(db, tenant_id) if batch.batch_type == "sale" else {}
        total_needed_map = {}
        serialized_lines = []

        for ln in lines:
            if batch.batch_type in ("central", "bazar"):
                ing = db.get(Ingredient, ln.bazar_item_id)
                serialized_lines.append({
                    "id": ln.id,
                    "bazar_item_id": ln.bazar_item_id,
                    "name": ing.name if ing else "Unknown",
                    "barcode": ing.barcode if ing else "",
                    "base_unit": ing.unit if ing else "",
                    "pack_size": int(ing.pack_size or 1) if ing else 1,
                    "quantity": ln.quantity,
                    "pack_count": ln.pack_count,
                })
            else:
                it = db.get(Item, ln.menu_item_id)
                rec_items = []
                if ln.recipe_id:
                    rec_items = db.query(RecipeItem).filter_by(tenant_id=tenant_id, recipe_id=ln.recipe_id).all()
                ingredients_used = []
                for ri in rec_items:
                    ing = db.get(Ingredient, ri.ingredient_id)
                    used = ri.qty * ln.quantity
                    total_needed_map[ri.ingredient_id] = total_needed_map.get(ri.ingredient_id, 0) + used
                    ingredients_used.append({
                        "bazar_item_id": ri.ingredient_id,
                        "name": ing.name if ing else "Unknown",
                        "base_unit": ing.unit if ing else "",
                        "per_serving": ri.qty,
                        "total_used": used,
                        "current_stock": stock_map.get(ri.ingredient_id, 0),
                    })
                serialized_lines.append({
                    "id": ln.id,
                    "menu_item_id": ln.menu_item_id,
                    "name": it.name if it else "Unknown",
                    "barcode": it.barcode if it else "",
                    "recipe_id": ln.recipe_id,
                    "recipe_version": ln.recipe_version,
                    "quantity": ln.quantity,
                    "ingredients_used": ingredients_used,
                })

        data["lines"] = serialized_lines
        if batch.batch_type == "sale":
            warnings = []
            for ing_id, needed in total_needed_map.items():
                avail = stock_map.get(ing_id, 0)
                if avail - needed < 0:
                    ing = db.get(Ingredient, ing_id)
                    warnings.append({
                        "bazar_item_id": ing_id,
                        "name": ing.name if ing else "Unknown",
                        "base_unit": ing.unit if ing else "",
                        "needed": needed,
                        "available": avail,
                        "shortage": needed - avail,
                    })
            data["stock_warnings"] = warnings
            data["has_negative_stock_warning"] = len(warnings) > 0

    return data


@router.get("")
def list_batches(
    batch_type: Optional[str] = Query(None),
    batch_date: Optional[str] = Query(None),
    u=Depends(auth),
    db=Depends(get_db),
):
    apply_postgres_rls(db, u["tid"])
    q = db.query(InventoryBatch).filter_by(tenant_id=u["tid"])
    if batch_type:
        q = q.filter(InventoryBatch.batch_type == batch_type)
    if batch_date:
        q = q.filter(InventoryBatch.batch_date == batch_date)
    batches = q.order_by(InventoryBatch.batch_date.desc(), InventoryBatch.id.desc()).limit(100).all()
    return [_serialize_batch(db, u["tid"], b, include_lines=False) for b in batches]


@router.get("/{batch_id}")
def get_batch(batch_id: int, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    batch = db.get(InventoryBatch, batch_id)
    if not batch or batch.tenant_id != u["tid"]:
        raise HTTPException(404, "Batch not found")
    return _serialize_batch(db, u["tid"], batch, include_lines=True)


@router.post("")
def create_batch(b: BatchCreateIn, u=Depends(auth), db=Depends(get_db)):
    if b.batch_type not in VALID_BATCH_TYPES:
        raise HTTPException(400, "Invalid batch_type. Must be central, bazar, or sale")
    apply_postgres_rls(db, u["tid"])

    batch = InventoryBatch(
        tenant_id=u["tid"],
        batch_type=b.batch_type,
        batch_date=b.batch_date or today_str(),
        status="draft",
        note=b.note,
        created_by=u["uid"],
    )
    db.add(batch)
    db.commit()
    return _serialize_batch(db, u["tid"], batch, include_lines=True)


@router.put("/{batch_id}/lines")
def update_batch_lines(batch_id: int, b: BatchLinesUpdateIn, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    batch = db.get(InventoryBatch, batch_id)
    if not batch or batch.tenant_id != u["tid"]:
        raise HTTPException(404, "Batch not found")

    is_approved_edit = batch.status != "draft"
    verified_owner = None
    if is_approved_edit:
        verified_owner = verify_owner_password(db, u["tid"], b.owner_password)
        if not b.lines:
            raise HTTPException(400, "Approved batch must have at least one line")

    if b.batch_date is not None:
        batch.batch_date = b.batch_date
    if b.note is not None:
        batch.note = b.note
    if b.allow_negative_stock is not None:
        batch.allow_negative_stock = b.allow_negative_stock

    new_lines = []
    for ln in b.lines:
        if ln.quantity <= 0:
            raise HTTPException(400, "Line quantity must be greater than zero")

        if batch.batch_type in ("central", "bazar"):
            if not ln.bazar_item_id:
                raise HTTPException(400, "bazar_item_id is required")
            ing = db.get(Ingredient, ln.bazar_item_id)
            if not ing or ing.tenant_id != u["tid"]:
                raise HTTPException(404, f"Bazar item {ln.bazar_item_id} not found")
            new_lines.append(InventoryBatchLine(
                tenant_id=u["tid"],
                batch_id=batch.id,
                bazar_item_id=ing.id,
                quantity=ln.quantity,
                pack_count=ln.pack_count,
            ))
        else:
            if not ln.menu_item_id:
                raise HTTPException(400, "menu_item_id is required")
            it = db.get(Item, ln.menu_item_id)
            if not it or it.tenant_id != u["tid"]:
                raise HTTPException(404, f"Menu item {ln.menu_item_id} not found")
            approved_rec = get_approved_recipe(db, u["tid"], it.id)
            if not approved_rec:
                raise HTTPException(400, f"Recipe not approved for {it.name}")
            new_lines.append(InventoryBatchLine(
                tenant_id=u["tid"],
                batch_id=batch.id,
                menu_item_id=it.id,
                recipe_id=approved_rec.id,
                recipe_version=approved_rec.version,
                quantity=ln.quantity,
                pack_count=float(ln.quantity),
            ))

    if is_approved_edit:
        # Append-only ledger reconciliation: reverse active entries for this batch, then post updated entries
        existing_entries = (
            db.query(StockLedger)
            .filter_by(tenant_id=u["tid"], batch_id=batch.id)
            .all()
        )
        reversed_ids = {e.ref_ledger_id for e in existing_entries if e.type == "reversal" and e.ref_ledger_id}
        for orig in existing_entries:
            if orig.type == "reversal" or orig.id in reversed_ids:
                continue
            rev = StockLedger(
                tenant_id=u["tid"],
                bazar_item_id=orig.bazar_item_id,
                quantity=-orig.quantity,
                type="reversal",
                batch_id=batch.id,
                ref_ledger_id=orig.id,
                date=today_str(),
                reason=f"Owner Edit Reversal for {batch.batch_type.title()} Batch #{batch.id}",
                created_by=verified_owner.id,
            )
            db.add(rev)
            ing = db.get(Ingredient, orig.bazar_item_id)
            if ing:
                ing.current_stock = (ing.current_stock or 0) + rev.quantity
        db.flush()

        # Re-post ledger entries for the edited lines
        if batch.batch_type in ("central", "bazar"):
            for nl in new_lines:
                ing = db.get(Ingredient, nl.bazar_item_id)
                db.add(StockLedger(
                    tenant_id=u["tid"],
                    bazar_item_id=nl.bazar_item_id,
                    quantity=nl.quantity,
                    type=batch.batch_type,
                    batch_id=batch.id,
                    date=batch.batch_date,
                    reason=f"Owner Edited {batch.batch_type.title()} Batch #{batch.id}",
                    created_by=verified_owner.id,
                ))
                if ing:
                    ing.current_stock = (ing.current_stock or 0) + nl.quantity
        else:
            stock_map = get_current_stock_map(db, u["tid"])
            deductions = {}
            for nl in new_lines:
                rec_items = db.query(RecipeItem).filter_by(tenant_id=u["tid"], recipe_id=nl.recipe_id).all()
                if not rec_items:
                    it = db.get(Item, nl.menu_item_id)
                    raise HTTPException(400, f"Recipe has no ingredients for {it.name if it else nl.menu_item_id}")
                for ri in rec_items:
                    deductions[ri.ingredient_id] = deductions.get(ri.ingredient_id, 0) + (ri.qty * nl.quantity)

            allow_neg = bool(batch.allow_negative_stock)
            if not allow_neg:
                for ing_id, deduct_qty in deductions.items():
                    avail = stock_map.get(ing_id, 0)
                    if avail - deduct_qty < 0:
                        ing = db.get(Ingredient, ing_id)
                        name = ing.name if ing else f"Item {ing_id}"
                        raise HTTPException(400, f"Not enough stock for {name} (available {avail}, needed {deduct_qty})")

            for ing_id, deduct_qty in deductions.items():
                ing = db.get(Ingredient, ing_id)
                db.add(StockLedger(
                    tenant_id=u["tid"],
                    bazar_item_id=ing_id,
                    quantity=-deduct_qty,
                    type="sale",
                    batch_id=batch.id,
                    date=batch.batch_date,
                    reason=f"Owner Edited Daily Sale Batch #{batch.id}",
                    created_by=verified_owner.id,
                ))
                if ing:
                    ing.current_stock = (ing.current_stock or 0) - deduct_qty

        batch.approved_by = verified_owner.id
        batch.approved_at = now()

    db.query(InventoryBatchLine).filter_by(tenant_id=u["tid"], batch_id=batch.id).delete()
    for nl in new_lines:
        db.add(nl)
    db.commit()
    return _serialize_batch(db, u["tid"], batch, include_lines=True)


@router.post("/{batch_id}/approve")
def approve_batch(batch_id: int, b: BatchApproveIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Only manager or owner can approve batches")
    apply_postgres_rls(db, u["tid"])

    batch = db.get(InventoryBatch, batch_id)
    if not batch or batch.tenant_id != u["tid"]:
        raise HTTPException(404, "Batch not found")
    if batch.status != "draft":
        raise HTTPException(400, "Batch is already approved and locked")

    lines = db.query(InventoryBatchLine).filter_by(tenant_id=u["tid"], batch_id=batch.id).all()
    if not lines:
        raise HTTPException(400, "Cannot approve an empty batch")

    if batch.batch_type in ("central", "bazar"):
        for ln in lines:
            ing = db.get(Ingredient, ln.bazar_item_id)
            if not ing or ing.tenant_id != u["tid"]:
                raise HTTPException(400, "Invalid bazar item in batch")
            db.add(StockLedger(
                tenant_id=u["tid"],
                bazar_item_id=ing.id,
                quantity=ln.quantity,
                type=batch.batch_type,
                batch_id=batch.id,
                date=batch.batch_date,
                reason=f"{batch.batch_type.title()} Batch #{batch.id}",
                created_by=u["uid"],
            ))
            # Keep legacy current_stock column in sync
            ing.current_stock = (ing.current_stock or 0) + ln.quantity
    else:
        # Sale batch: deduct ingredients based on stored recipe_id/recipe_version
        stock_map = get_current_stock_map(db, u["tid"])
        deductions = {}  # bazar_item_id -> total_deducted (positive int)
        for ln in lines:
            it = db.get(Item, ln.menu_item_id)
            if not it or it.tenant_id != u["tid"]:
                raise HTTPException(400, "Invalid menu item in sale batch")

            rec = db.get(Recipe, ln.recipe_id) if ln.recipe_id else get_approved_recipe(db, u["tid"], it.id)
            if not rec or rec.tenant_id != u["tid"]:
                raise HTTPException(400, f"Recipe not approved for {it.name}")
            if ln.recipe_id is None:
                ln.recipe_id = rec.id
                ln.recipe_version = rec.version

            rec_items = db.query(RecipeItem).filter_by(tenant_id=u["tid"], recipe_id=rec.id).all()
            if not rec_items:
                raise HTTPException(400, f"Recipe has no ingredients for {it.name}")
            for ri in rec_items:
                deduct_qty = ri.qty * ln.quantity
                deductions[ri.ingredient_id] = deductions.get(ri.ingredient_id, 0) + deduct_qty

        allow_neg = bool(b.allow_negative_stock or batch.allow_negative_stock)
        if not allow_neg:
            for ing_id, deduct_qty in deductions.items():
                avail = stock_map.get(ing_id, 0)
                if avail - deduct_qty < 0:
                    ing = db.get(Ingredient, ing_id)
                    name = ing.name if ing else f"Item {ing_id}"
                    raise HTTPException(400, f"Not enough stock for {name} (available {avail}, needed {deduct_qty})")

        for ing_id, deduct_qty in deductions.items():
            ing = db.get(Ingredient, ing_id)
            db.add(StockLedger(
                tenant_id=u["tid"],
                bazar_item_id=ing_id,
                quantity=-deduct_qty,
                type="sale",
                batch_id=batch.id,
                date=batch.batch_date,
                reason=f"Daily Sale Batch #{batch.id}",
                created_by=u["uid"],
            ))
            if ing:
                ing.current_stock = (ing.current_stock or 0) - deduct_qty
        batch.allow_negative_stock = allow_neg

    batch.status = "approved"
    batch.approved_by = u["uid"]
    batch.approved_at = now()
    db.commit()
    return _serialize_batch(db, u["tid"], batch, include_lines=True)


@router.delete("/{batch_id}")
def delete_batch(batch_id: int, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    batch = db.get(InventoryBatch, batch_id)
    if not batch or batch.tenant_id != u["tid"]:
        raise HTTPException(404, "Batch not found")
    if batch.status != "draft":
        raise HTTPException(400, "Approved batches cannot be edited or deleted")

    db.query(InventoryBatchLine).filter_by(tenant_id=u["tid"], batch_id=batch.id).delete()
    db.delete(batch)
    db.commit()
    return {"status": "deleted", "id": batch_id}
