from fastapi import APIRouter, Depends, HTTPException
from app.database import now
from app.dependencies import get_db, auth, apply_postgres_rls
from app.models import Item, Ingredient, Recipe, RecipeItem, User
from app.schemas import RecipeDraftIn
from app.services.inventory_service import convert_to_base_units, get_approved_recipe

router = APIRouter(prefix="/recipes", tags=["recipes"])


def _serialize_recipe_lines(db, tenant_id: int, recipe: Recipe):
    lines = db.query(RecipeItem).filter_by(tenant_id=tenant_id, recipe_id=recipe.id).all()
    out = []
    for r in lines:
        ing = db.get(Ingredient, r.ingredient_id)
        out.append({
            "id": r.id,
            "bazar_item_id": r.ingredient_id,
            "bazar_item_name": ing.name if ing else "Unknown",
            "base_unit": ing.unit if ing else "",
            "qty_base": r.qty,
            "input_amount": r.input_amount if r.input_amount is not None else r.qty,
            "input_unit": r.input_unit or (ing.unit if ing else ""),
        })
    return out


def _serialize_recipe(db, tenant_id: int, recipe: Recipe):
    creator = db.get(User, recipe.created_by) if recipe.created_by else None
    approver = db.get(User, recipe.approved_by) if recipe.approved_by else None
    return {
        "id": recipe.id,
        "item_id": recipe.item_id,
        "version": recipe.version,
        "status": recipe.status,
        "created_by": creator.name if creator else None,
        "created_at": recipe.created_at.isoformat() if recipe.created_at else None,
        "approved_by": approver.name if approver else None,
        "approved_at": recipe.approved_at.isoformat() if recipe.approved_at else None,
        "ingredients": _serialize_recipe_lines(db, tenant_id, recipe),
    }


@router.get("")
def list_recipes(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    items = db.query(Item).filter_by(tenant_id=u["tid"]).order_by(Item.name.asc()).all()
    res = []
    for it in items:
        approved = get_approved_recipe(db, u["tid"], it.id)
        draft = (
            db.query(Recipe)
            .filter_by(tenant_id=u["tid"], item_id=it.id, status="draft")
            .order_by(Recipe.version.desc())
            .first()
        )
        res.append({
            "item_id": it.id,
            "name": it.name,
            "barcode": it.barcode,
            "price": it.price,
            "category": it.category or "General",
            "recipe_status": "approved" if approved else ("draft" if draft else "none"),
            "approved_recipe": _serialize_recipe(db, u["tid"], approved) if approved else None,
            "draft_recipe": _serialize_recipe(db, u["tid"], draft) if draft else None,
        })
    return res


@router.get("/{item_id}")
def get_item_recipe(item_id: int, u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    it = db.get(Item, item_id)
    if not it or it.tenant_id != u["tid"]:
        raise HTTPException(404, "Menu item not found")

    approved = get_approved_recipe(db, u["tid"], item_id)
    draft = (
        db.query(Recipe)
        .filter_by(tenant_id=u["tid"], item_id=item_id, status="draft")
        .order_by(Recipe.version.desc())
        .first()
    )
    history = (
        db.query(Recipe)
        .filter_by(tenant_id=u["tid"], item_id=item_id)
        .order_by(Recipe.version.desc())
        .all()
    )
    return {
        "item_id": it.id,
        "name": it.name,
        "barcode": it.barcode,
        "price": it.price,
        "approved_recipe": _serialize_recipe(db, u["tid"], approved) if approved else None,
        "draft_recipe": _serialize_recipe(db, u["tid"], draft) if draft else None,
        "history": [_serialize_recipe(db, u["tid"], r) for r in history],
    }


@router.post("/{item_id}/draft")
def save_recipe_draft(item_id: int, b: RecipeDraftIn, u=Depends(auth), db=Depends(get_db)):
    """Create or update a draft recipe. Editing an approved recipe creates a new draft version."""
    apply_postgres_rls(db, u["tid"])
    it = db.get(Item, item_id)
    if not it or it.tenant_id != u["tid"]:
        raise HTTPException(404, "Menu item not found")
    if not b.ingredients:
        raise HTTPException(400, "Recipe must have at least one ingredient")

    converted_lines = []
    for line in b.ingredients:
        ing = db.get(Ingredient, line.bazar_item_id)
        if not ing or ing.tenant_id != u["tid"]:
            raise HTTPException(400, f"Invalid bazar item {line.bazar_item_id}")
        qty_base = convert_to_base_units(line.amount, line.unit, ing.unit)
        converted_lines.append((ing, qty_base, line.amount, line.unit))

    # Find existing draft, or create new draft version
    draft = (
        db.query(Recipe)
        .filter_by(tenant_id=u["tid"], item_id=item_id, status="draft")
        .order_by(Recipe.version.desc())
        .first()
    )
    if draft:
        db.query(RecipeItem).filter_by(tenant_id=u["tid"], recipe_id=draft.id).delete()
        draft.created_by = u["uid"]
        draft.created_at = now()
    else:
        latest = (
            db.query(Recipe)
            .filter_by(tenant_id=u["tid"], item_id=item_id)
            .order_by(Recipe.version.desc())
            .first()
        )
        next_version = (latest.version + 1) if latest else 1
        draft = Recipe(
            tenant_id=u["tid"],
            item_id=item_id,
            version=next_version,
            status="draft",
            created_by=u["uid"],
        )
        db.add(draft)
        db.flush()

    for ing, qty_base, amount, unit in converted_lines:
        db.add(RecipeItem(
            tenant_id=u["tid"],
            recipe_id=draft.id,
            item_id=item_id,
            ingredient_id=ing.id,
            qty=qty_base,
            input_amount=amount,
            input_unit=unit,
            version=draft.version,
        ))

    db.commit()
    return _serialize_recipe(db, u["tid"], draft)


@router.post("/{item_id}/approve")
def approve_recipe(item_id: int, u=Depends(auth), db=Depends(get_db)):
    """Manager/owner only: approve the latest draft recipe for a menu item."""
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Only manager or owner can approve recipes")
    apply_postgres_rls(db, u["tid"])

    it = db.get(Item, item_id)
    if not it or it.tenant_id != u["tid"]:
        raise HTTPException(404, "Menu item not found")

    draft = (
        db.query(Recipe)
        .filter_by(tenant_id=u["tid"], item_id=item_id, status="draft")
        .order_by(Recipe.version.desc())
        .first()
    )
    if not draft:
        raise HTTPException(400, "No draft recipe found to approve")

    # Supersede any previously approved recipe
    prev_approved = db.query(Recipe).filter_by(tenant_id=u["tid"], item_id=item_id, status="approved").all()
    for p in prev_approved:
        p.status = "superseded"

    draft.status = "approved"
    draft.approved_by = u["uid"]
    draft.approved_at = now()
    db.commit()
    return _serialize_recipe(db, u["tid"], draft)
