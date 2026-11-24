import json
from app.database import Base, engine, Session
from app.models import Tenant, Branch, Terminal, User, Item, Ingredient, RecipeItem, TableLayout
from app.security import hp

def seed():
    Base.metadata.create_all(engine)
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

        items = [
            ("Cappuccino", 19000, "bar", "Beverages"),
            ("Latte", 20000, "bar", "Beverages"),
            ("Cold Coffee", 22000, "bar", "Beverages"),
            ("Club Sandwich", 28000, "kitchen", "Food"),
            ("French Fries", 15000, "kitchen", "Snacks"),
            ("Chicken Burger", 32000, "kitchen", "Food")
        ]
        created_items = {}
        for n, p, s, cat in items:
            it = Item(tenant_id=t.id, branch_id=b.id, name=n, price=p, station=s, category=cat)
            db.add(it)
            db.flush()
            created_items[n] = it

        milk = Ingredient(tenant_id=t.id, name="Milk", unit="ml", current_stock=25000, cost_per_unit=10)
        coffee_beans = Ingredient(tenant_id=t.id, name="Coffee Beans", unit="g", current_stock=6000, cost_per_unit=200)
        chicken = Ingredient(tenant_id=t.id, name="Chicken Patty", unit="pcs", current_stock=150, cost_per_unit=8000)
        bun = Ingredient(tenant_id=t.id, name="Burger Bun", unit="pcs", current_stock=150, cost_per_unit=2500)
        fries = Ingredient(tenant_id=t.id, name="Potatoes", unit="g", current_stock=30000, cost_per_unit=5)
        db.add_all([milk, coffee_beans, chicken, bun, fries])
        db.flush()

        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["Cappuccino"].id, ingredient_id=coffee_beans.id, qty=18))
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["Cappuccino"].id, ingredient_id=milk.id, qty=150))
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["Chicken Burger"].id, ingredient_id=chicken.id, qty=1))
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["Chicken Burger"].id, ingredient_id=bun.id, qty=1))
        db.add(RecipeItem(tenant_id=t.id, item_id=created_items["French Fries"].id, ingredient_id=fries.id, qty=200))

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
        db.commit()
    db.close()
