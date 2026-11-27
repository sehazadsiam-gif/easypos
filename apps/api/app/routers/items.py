import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from app.dependencies import get_db, auth, apply_postgres_rls, verify_owner_password
from app.models import Item, Recipe, RecipeItem
from app.schemas import ItemIn, ItemUpdateIn
from app.services.inventory_service import validate_barcode, get_approved_recipe

router = APIRouter(prefix="/items", tags=["items"])


@router.get("")
def list_items(
    approved_only: bool = Query(False),
    u=Depends(auth),
    db=Depends(get_db),
):
    apply_postgres_rls(db, u["tid"])
    items_list = db.query(Item).filter_by(tenant_id=u["tid"]).order_by(Item.name.asc()).all()
    res = []
    for i in items_list:
        approved_rec = get_approved_recipe(db, u["tid"], i.id)
        draft_rec = (
            db.query(Recipe)
            .filter_by(tenant_id=u["tid"], item_id=i.id, status="draft")
            .order_by(Recipe.version.desc())
            .first()
        )
        if approved_only and not approved_rec:
            continue

        if approved_rec:
            recipe_status = "approved"
            recipe_count = db.query(RecipeItem).filter_by(tenant_id=u["tid"], recipe_id=approved_rec.id).count()
        elif draft_rec:
            recipe_status = "draft"
            recipe_count = db.query(RecipeItem).filter_by(tenant_id=u["tid"], recipe_id=draft_rec.id).count()
        else:
            recipe_status = "none"
            recipe_count = db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=i.id).count()

        res.append({
            "id": i.id,
            "name": i.name,
            "barcode": i.barcode,
            "category": i.category or "General",
            "price": i.price,
            "station": i.station,
            "image_url": i.image_url,
            "recipe_count": recipe_count,
            "recipe_status": recipe_status,
            "approved_recipe_version": approved_rec.version if approved_rec else None,
            "has_draft_recipe": draft_rec is not None,
            "draft_recipe_version": draft_rec.version if draft_rec else None,
        })
    return res


@router.post("")
def add_item(b: ItemIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Managers only")
    apply_postgres_rls(db, u["tid"])

    import re

    barcode = validate_barcode(b.barcode)
    if not barcode:
        clean_name = re.sub(r"[^A-Z0-9]+", "-", b.name.upper()).strip("-")[:12]
        if not clean_name:
            clean_name = "ITEM"
        candidate = f"MENU-{clean_name}"
        if db.query(Item).filter_by(tenant_id=u["tid"], barcode=candidate).first():
            candidate = f"MENU-{clean_name}-{uuid.uuid4().hex[:4].upper()}"
        barcode = candidate
    else:
        existing = db.query(Item).filter_by(tenant_id=u["tid"], barcode=barcode).first()
        if existing:
            raise HTTPException(400, f"Barcode '{barcode}' already exists on another menu item")

    i = Item(
        tenant_id=u["tid"],
        branch_id=u.get("branch_id"),
        name=b.name,
        barcode=barcode,
        category=b.category,
        price=b.price,
        station=b.station,
        image_url=b.image_url,
    )
    db.add(i)
    db.commit()
    return {"id": i.id, "name": i.name, "barcode": i.barcode, "price": i.price}


@router.patch("/{item_id}")
def update_item(item_id: int, b: ItemUpdateIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Managers only")
    apply_postgres_rls(db, u["tid"])

    it = db.query(Item).filter_by(tenant_id=u["tid"], id=item_id).first()
    if not it:
        raise HTTPException(404, "Item not found")

    if get_approved_recipe(db, u["tid"], it.id):
        verify_owner_password(db, u["tid"], b.owner_password)

    # If price is explicitly passed (including 0 or None to reset)
    if b.price is not None:
        it.price = b.price if b.price > 0 else None
    if b.name is not None:
        it.name = b.name.strip()
    if b.barcode is not None:
        clean_barcode = validate_barcode(b.barcode)
        if clean_barcode != it.barcode:
            exists = db.query(Item).filter_by(tenant_id=u["tid"], barcode=clean_barcode).first()
            if exists:
                raise HTTPException(400, f"Barcode '{clean_barcode}' already in use")
            it.barcode = clean_barcode
    if b.category is not None:
        it.category = b.category
    if b.station is not None:
        it.station = b.station
    if b.image_url is not None:
        it.image_url = b.image_url

    db.commit()
    db.refresh(it)
    return {
        "id": it.id,
        "name": it.name,
        "barcode": it.barcode,
        "category": it.category,
        "price": it.price,
        "station": it.station,
    }
