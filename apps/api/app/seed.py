import json
from datetime import date
from sqlalchemy import text
from app.database import Base, engine, Session
from app.models import (
    Tenant, Branch, Terminal, User, Item, Ingredient,
    Recipe, RecipeItem, TableLayout, PracticeItem,
    InventoryBatch, InventoryBatchLine, StockLedger,
)
from app.security import hp


def _ensure_sqlite_columns():
    """Add any new columns to existing SQLite tables if upgrading an existing DB."""
    if not str(engine.url).startswith("sqlite"):
        return
    migrations = [
        ("items", "barcode", "VARCHAR"),
        ("ingredients", "barcode", "VARCHAR"),
        ("ingredients", "min_stock", "INTEGER DEFAULT 0"),
        ("recipe_items", "recipe_id", "INTEGER"),
        ("recipe_items", "input_amount", "FLOAT"),
        ("recipe_items", "input_unit", "VARCHAR"),
    ]
    with engine.begin() as conn:
        for table, col, col_type in migrations:
            try:
                cols = [r[1] for r in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()]
                if col not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))
            except Exception:
                pass


def seed():
    Base.metadata.create_all(engine)
    _ensure_sqlite_columns()
    db = Session()
    if not db.query(Tenant).first():
        t = Tenant(code="crown", name="Crown Coffee", plan="pro")
        db.add(t)
        db.flush()

        b = Branch(tenant_id=t.id, code="uttara", name="Crown Coffee Uttara", address="Sector 3, Uttara, Dhaka", phone="+8801700000000")
        db.add(b)
        db.flush()

        term = Terminal(tenant_id=t.id, branch_id=b.id, code="POS-1", name="Main Counter POS")
        db.add(term)

        owner = User(tenant_id=t.id, branch_id=b.id, emp_id="1001", name="Owner", role="owner", pw=hp("admin123"), pin="1234")
        manager = User(tenant_id=t.id, branch_id=b.id, emp_id="1002", name="Manager", role="manager", pw=hp("admin123"), pin="9999")
        cashier = User(tenant_id=t.id, branch_id=b.id, emp_id="1003", name="Cashier", role="cashier", pw=hp("admin123"), pin=None)
        db.add_all([owner, manager, cashier])
        db.flush()

        items = [
            ("Cappuccino", "MENU-CAPPUCCINO", 19000, "bar", "Beverages"),
            ("Latte", "MENU-LATTE", 20000, "bar", "Beverages"),
            ("Cold Coffee", "MENU-COLD-COFFEE", 22000, "bar", "Beverages"),
            ("Club Sandwich", "MENU-CLUB-SANDWICH", 28000, "kitchen", "Food"),
            ("French Fries", "MENU-FRENCH-FRIES", 15000, "kitchen", "Snacks"),
            ("Chicken Burger", "MENU-CHICKEN-BURGER", 32000, "kitchen", "Food")
        ]
        created_items = {}
        for n, bc, p, s, cat in items:
            it = Item(tenant_id=t.id, branch_id=b.id, name=n, barcode=bc, price=p, station=s, category=cat)
            db.add(it)
            db.flush()
            created_items[n] = it

        milk = Ingredient(tenant_id=t.id, barcode="ING-MILK-1L", name="Milk", unit="ml", pack_size=1000, pack_unit="1 L", min_stock=5000, current_stock=25000, cost_per_unit=10)
        coffee_beans = Ingredient(tenant_id=t.id, barcode="ING-COFFEE-1KG", name="Coffee Beans", unit="g", pack_size=1000, pack_unit="1 kg", min_stock=2000, current_stock=6000, cost_per_unit=200)
        chicken = Ingredient(tenant_id=t.id, barcode="ING-CHICKEN-12PCS", name="Chicken Patty", unit="pcs", pack_size=12, pack_unit="12 pcs", min_stock=24, current_stock=150, cost_per_unit=8000)
        bun = Ingredient(tenant_id=t.id, barcode="ING-BUN-6PCS", name="Burger Bun", unit="pcs", pack_size=6, pack_unit="6 pcs", min_stock=24, current_stock=150, cost_per_unit=2500)
        fries = Ingredient(tenant_id=t.id, barcode="ING-POTATO-5KG", name="Potatoes", unit="g", pack_size=5000, pack_unit="5 kg", min_stock=10000, current_stock=30000, cost_per_unit=5)
        cheese = Ingredient(tenant_id=t.id, barcode="ING-CHEESE-500G", name="Cheese Slice", unit="g", pack_size=500, pack_unit="500 g", min_stock=1000, current_stock=8000, cost_per_unit=70)
        sugar = Ingredient(tenant_id=t.id, barcode="ING-SUGAR-1KG", name="White Sugar", unit="g", pack_size=1000, pack_unit="1 kg", min_stock=3000, current_stock=20000, cost_per_unit=14)
        db.add_all([milk, coffee_beans, chicken, bun, fries, cheese, sugar])
        db.flush()

        # Seed initial Central Inventory batch & ledger entries
        today = date.today().isoformat()
        central_batch = InventoryBatch(
            tenant_id=t.id,
            batch_type="central",
            batch_date=today,
            status="approved",
            note="Initial Central Inventory",
            created_by=owner.id,
            approved_by=owner.id,
        )
        db.add(central_batch)
        db.flush()
        for ing in [milk, coffee_beans, chicken, bun, fries, cheese, sugar]:
            db.add(InventoryBatchLine(
                tenant_id=t.id,
                batch_id=central_batch.id,
                bazar_item_id=ing.id,
                quantity=ing.current_stock,
                pack_count=round(ing.current_stock / (ing.pack_size or 1), 2),
            ))
            db.add(StockLedger(
                tenant_id=t.id,
                bazar_item_id=ing.id,
                quantity=ing.current_stock,
                type="central",
                batch_id=central_batch.id,
                date=today,
                reason="Initial Central Inventory",
                created_by=owner.id,
            ))

        # Seed approved recipes for Cappuccino, Chicken Burger, French Fries
        def add_approved_recipe(item_obj, lines):
            rec = Recipe(
                tenant_id=t.id,
                item_id=item_obj.id,
                version=1,
                status="approved",
                created_by=owner.id,
                approved_by=owner.id,
            )
            db.add(rec)
            db.flush()
            for ing_obj, qty_val, in_amt, in_unit in lines:
                db.add(RecipeItem(
                    tenant_id=t.id,
                    recipe_id=rec.id,
                    item_id=item_obj.id,
                    ingredient_id=ing_obj.id,
                    qty=qty_val,
                    input_amount=in_amt,
                    input_unit=in_unit,
                    version=1,
                ))

        add_approved_recipe(created_items["Cappuccino"], [(coffee_beans, 18, 18, "g"), (milk, 150, 150, "ml")])
        add_approved_recipe(created_items["Chicken Burger"], [(chicken, 1, 1, "pcs"), (bun, 1, 1, "pcs")])
        add_approved_recipe(created_items["French Fries"], [(fries, 200, 200, "g")])

        default_layout = [
            {"id": "T1", "label": "T1", "x": 40, "y": 40, "width": 80, "height": 80, "shape": "square"},
            {"id": "T2", "label": "T2", "x": 160, "y": 40, "width": 80, "height": 80, "shape": "square"},
            {"id": "T3", "label": "T3", "x": 280, "y": 40, "width": 80, "height": 80, "shape": "square"},
            {"id": "T4", "label": "T4", "x": 400, "y": 40, "width": 80, "height": 80, "shape": "square"},
            {"id": "T5", "label": "T5", "x": 40, "y": 160, "width": 80, "height": 80, "shape": "square"},
            {"id": "T6", "label": "T6", "x": 160, "y": 160, "width": 80, "height": 80, "shape": "square"},
            {"id": "T7", "label": "T7", "x": 280, "y": 160, "width": 80, "height": 80, "shape": "round"},
            {"id": "T8", "label": "T8", "x": 400, "y": 160, "width": 80, "height": 80, "shape": "round"},
        ]
        db.add(TableLayout(tenant_id=t.id, channel="dine_in", layout_json=json.dumps(default_layout)))

    # Seed Practice Items if empty
    if not db.query(PracticeItem).first():
        sample_practice = [
            ("ITEM-MILK", "Fresh Full Cream Milk", "Dairy", "ml", 1000, "1 litre", 10000, 20000, 10000),
            ("ITEM-COFFEE-BEANS", "Espresso Coffee Beans", "Beverages", "g", 1000, "1 kg", 3000, 10000, 250000),
            ("ITEM-CHEESE", "Cheddar Cheese Block", "Dairy", "g", 500, "500 gram", 2000, 5000, 65000),
            ("ITEM-BURGER-BUN", "Sesame Burger Buns", "Bakery", "pcs", 12, "12 pcs", 24, 60, 28000),
            ("ITEM-CHICKEN", "Chicken Patty Pack", "Meat", "pcs", 10, "10 pcs", 30, 80, 85000),
            ("ITEM-POTATO", "French Fry Potatoes", "Produce", "g", 5000, "5 kg", 15000, 40000, 30000),
            ("ITEM-SUGAR", "White Sugar Bag", "Dry Goods", "g", 1000, "1 kg", 5000, 15000, 14000),
            ("ITEM-TEA", "Black Tea Leaves", "Beverages", "g", 500, "500 gram", 1500, 4000, 35000),
            ("ITEM-BUTTER", "Salted Butter Block", "Dairy", "g", 200, "200 gram", 800, 2000, 32000),
            ("ITEM-SAUCE", "Tomato Ketchup Gallon", "Condiments", "g", 2000, "2 kg", 4000, 10000, 55000)
        ]
        for barcode, name, cat, unit, psize, punit, stock, par, cost in sample_practice:
            db.add(PracticeItem(
                barcode=barcode,
                name=name,
                category=cat,
                base_unit=unit,
                pack_size=psize,
                pack_unit=punit,
                current_stock=stock,
                par_level=par,
                default_cost=cost
            ))
    db.commit()
    db.close()
