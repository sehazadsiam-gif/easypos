from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_db
from app.models import PracticeItem, PracticeTrip, PracticeTripLine, PracticeStockMovement
from app.schemas import PracticeItemIn, PracticeTripIn, PracticeUsageIn

router = APIRouter(prefix="/practice-bazar", tags=["practice-bazar"])

@router.get("/items")
def list_practice_items(db=Depends(get_db)):
    """Public list of practice items with pack specifications and par levels."""
    items = db.query(PracticeItem).order_by(PracticeItem.name.asc()).all()
    return [
        {
            "id": i.id,
            "barcode": i.barcode,
            "name": i.name,
            "category": i.category,
            "base_unit": i.base_unit,
            "pack_size": i.pack_size,
            "pack_unit": i.pack_unit,
            "current_stock": i.current_stock,
            "par_level": i.par_level,
            "default_cost": i.default_cost
        }
        for i in items
    ]

@router.post("/items")
def create_practice_item(b: PracticeItemIn, db=Depends(get_db)):
    """Add a new practice item to the sandbox."""
    if db.query(PracticeItem).filter_by(barcode=b.barcode).first():
        raise HTTPException(400, "Barcode already exists in practice catalogue")
    it = PracticeItem(
        barcode=b.barcode,
        name=b.name,
        category=b.category,
        base_unit=b.base_unit,
        pack_size=b.pack_size,
        pack_unit=b.pack_unit,
        par_level=b.par_level,
        default_cost=b.default_cost,
        current_stock=0.0
    )
    db.add(it)
    db.commit()
    return {"id": it.id, "barcode": it.barcode}

@router.get("/trips")
def list_practice_trips(db=Depends(get_db)):
    """Recent practice trips history."""
    trips = db.query(PracticeTrip).order_by(PracticeTrip.created_at.desc()).limit(30).all()
    res = []
    for t in trips:
        lines = db.query(PracticeTripLine).filter_by(trip_id=t.id).all()
        res.append({
            "id": t.id,
            "trip_name": t.trip_name,
            "shopper_name": t.shopper_name,
            "total_cost": t.total_cost,
            "item_count": t.item_count,
            "created_at": t.created_at.isoformat(),
            "lines": [
                {
                    "item_id": l.item_id,
                    "pack_count": l.pack_count,
                    "total_units": l.total_units,
                    "total_cost": l.total_cost
                }
                for l in lines
            ]
        })
    return res

@router.post("/trips")
def create_practice_trip(b: PracticeTripIn, db=Depends(get_db)):
    """Approve and record a scanned practice shopping trip."""
    if not b.lines:
        raise HTTPException(400, "Cannot approve an empty practice trip")

    total_cost = sum(l.total_cost for l in b.lines)
    trip = PracticeTrip(
        trip_name=b.trip_name,
        shopper_name=b.shopper_name,
        total_cost=total_cost,
        item_count=len(b.lines)
    )
    db.add(trip)
    db.flush()

    for l in b.lines:
        item = db.get(PracticeItem, l.item_id)
        if not item:
            continue
        units_added = l.pack_count * item.pack_size
        item.current_stock += units_added

        # Record line
        db.add(PracticeTripLine(
            trip_id=trip.id,
            item_id=item.id,
            pack_count=l.pack_count,
            total_units=units_added,
            unit_cost=l.unit_cost,
            total_cost=l.total_cost
        ))

        # Record movement
        db.add(PracticeStockMovement(
            item_id=item.id,
            movement_type="practice_bazar",
            qty_change=units_added,
            reason=f"Practice Trip #{trip.id}: {b.trip_name}"
        ))

    db.commit()
    return {"id": trip.id, "total_cost": total_cost, "status": "approved"}

@router.post("/usage")
def simulate_practice_usage(b: PracticeUsageIn, db=Depends(get_db)):
    """Simulate kitchen consumption of practice stock."""
    it = db.get(PracticeItem, b.item_id)
    if not it:
        raise HTTPException(404, "Practice item not found")
    if b.qty_used <= 0:
        raise HTTPException(400, "Usage must be greater than zero")

    actual_deduct = min(it.current_stock, b.qty_used)
    it.current_stock -= actual_deduct

    db.add(PracticeStockMovement(
        item_id=it.id,
        movement_type="practice_usage",
        qty_change=-actual_deduct,
        reason=b.reason
    ))
    db.commit()
    return {"id": it.id, "remaining_stock": it.current_stock}

@router.post("/reset")
def reset_practice_sandbox(db=Depends(get_db)):
    """1-Click Reset button: wipe all practice movements, trips, and reset stock to initial baselines."""
    db.query(PracticeTripLine).delete()
    db.query(PracticeTrip).delete()
    db.query(PracticeStockMovement).delete()
    
    # Reset all practice item stocks to default par level
    items = db.query(PracticeItem).all()
    for it in items:
        it.current_stock = it.par_level * it.pack_size
    db.commit()
    return {"status": "reset_complete", "message": "Practice sandbox successfully restored to clean baseline!"}
