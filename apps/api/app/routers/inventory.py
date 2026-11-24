from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_db, auth, apply_postgres_rls
from app.models import Ingredient, RecipeItem, Item, DailyBazar, StockMovement
from app.schemas import IngredientIn, RecipeSetIn, DailyBazarIn, WastageIn

router = APIRouter(prefix="/inventory", tags=["inventory"])

@router.get("")
def list_inventory(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    ings = db.query(Ingredient).filter_by(tenant_id=u["tid"]).all()
    return [
        {"id": i.id, "name": i.name, "unit": i.unit, "current_stock": i.current_stock, "cost_per_unit": i.cost_per_unit}
        for i in ings
    ]

@router.post("")
def add_ingredient(b: IngredientIn, u=Depends(auth), db=Depends(get_db)):
    if u["role"] not in ("owner", "manager"):
        raise HTTPException(403, "Managers only")
    apply_postgres_rls(db, u["tid"])
    ing = Ingredient(tenant_id=u["tid"], name=b.name, unit=b.unit, current_stock=b.current_stock, cost_per_unit=b.cost_per_unit)
    db.add(ing)
    db.commit()
    return {"id": ing.id}

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
