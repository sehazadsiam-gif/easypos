from fastapi import APIRouter, Depends
from app.dependencies import get_db, auth, apply_postgres_rls
from app.models import Order, Line, Shift, RecipeItem, Ingredient, VoidRefund

router = APIRouter(prefix="/reports", tags=["reports"])

@router.get("/daily")
def daily(u=Depends(auth), db=Depends(get_db)):
    apply_postgres_rls(db, u["tid"])
    out = {
        "by_shift": {},
        "by_channel": {},
        "by_payment": {},
        "total": 0,
        "total_vat": 0,
        "total_service": 0,
        "total_cost": 0,
        "food_cost_pct": 0,
        "voids_refunds_total": 0,
        "voids_refunds_count": 0,
        "mushak_summary": {
            "sales_excluding_tax": 0,
            "vat_collected": 0,
            "total_with_vat": 0
        }
    }
    paid_orders = db.query(Order).filter_by(tenant_id=u["tid"], status="paid").all()
    for o in paid_orders:
        sh = db.get(Shift, o.shift_id)
        label = sh.label if sh else "Unassigned"
        out["by_shift"][label] = out["by_shift"].get(label, 0) + o.total
        out["by_channel"][o.channel] = out["by_channel"].get(o.channel, 0) + o.total
        out["total"] += o.total
        out["total_vat"] += o.vat
        out["total_service"] += o.service

        lines = db.query(Line).filter_by(tenant_id=u["tid"], order_id=o.id).all()
        for l in lines:
            recipes = db.query(RecipeItem).filter_by(tenant_id=u["tid"], item_id=l.item_id).all()
            for r in recipes:
                ing = db.get(Ingredient, r.ingredient_id)
                if ing:
                    out["total_cost"] += ing.cost_per_unit * r.qty * l.qty

    if out["total"] > 0:
        out["food_cost_pct"] = round((out["total_cost"] / out["total"]) * 100, 2)
        out["mushak_summary"]["sales_excluding_tax"] = out["total"] - out["total_vat"]
        out["mushak_summary"]["vat_collected"] = out["total_vat"]
        out["mushak_summary"]["total_with_vat"] = out["total"]

    vrs = db.query(VoidRefund).filter_by(tenant_id=u["tid"]).all()
    out["voids_refunds_total"] = sum(vr.amount for vr in vrs)
    out["voids_refunds_count"] = len(vrs)

    return out
