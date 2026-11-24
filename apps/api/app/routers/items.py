from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_db, auth, apply_postgres_rls
from app.models import Item, RecipeItem
from app.schemas import ItemIn

router = APIRouter(prefix="/items", tags=["items"])

@router.get("")
def list_items(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    items_list = db.query(Item).filter_by(tenant_id=u["tid"]).all()
    res = []
    for i in items_list:
        recipes = db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=i.id).all()
        res.append({
            "id": i.id,
            "name": i.name,
            "category": i.category or "General",
            "price": i.price,
            "station": i.station,
            "image_url": i.image_url,
            "recipe_count": len(recipes)
        })
    return res

@router.post("")
def add_item(b: ItemIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Managers only")
    apply_postgres_rls(db, u["tid"])
    i = Item(
        tenant_id=u["tid"],
        branch_id=u.get("branch_id"),
        name=b.name,
        category=b.category,
        price=b.price,
        station=b.station,
        image_url=b.image_url
    )
    db.add(i)
    db.commit()
    return {"id": i.id, "name": i.name}
