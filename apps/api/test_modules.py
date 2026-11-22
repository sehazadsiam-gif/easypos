import pytest
import uuid
from fastapi.testclient import TestClient
from app.main import app, Session, Tenant, User, Item, Shift, Order, Line, Payment, Ingredient, RecipeItem, TableLayout, hp

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_db():
    db = Session()
    # verify initial seed exists
    t = db.query(Tenant).filter_by(code="crown").first()
    assert t is not None
    db.close()

def get_auth_token(role="owner"):
    emp_id = "1001" if role == "owner" else ("1002" if role == "manager" else "1003")
    r = client.post("/auth/login", json={"tenant": "crown", "emp_id": emp_id, "password": "admin123"})
    assert r.status_code == 200
    return r.json()["token"]

def test_offline_outbox_order_idempotency_and_sync():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Open a shift if not already open
    curr = client.get("/shifts/current", headers=headers).json()
    if not curr:
        r_open = client.post("/shifts/open", json={"label": "Morning Shift", "opening_cash": 100000}, headers=headers)
        assert r_open.status_code == 200

    # 2. Get items
    items = client.get("/items", headers=headers).json()
    assert len(items) > 0
    item1 = items[0]

    # 3. Simulate offline batch sync with client_uuid
    order_uuid = str(uuid.uuid4())
    pay_uuid = str(uuid.uuid4())
    
    sync_payload = {
        "items": [
            {
                "action": "create_order",
                "client_uuid": order_uuid,
                "data": {
                    "channel": "dine_in",
                    "slot": "T1",
                    "waiter": "Karim",
                    "lines": [{"item_id": item1["id"], "qty": 2}]
                }
            },
            {
                "action": "pay_order",
                "client_uuid": pay_uuid,
                "data": {
                    "order_client_uuid": order_uuid,
                    "method": "cash",
                    "amount": 50000
                }
            }
        ]
    }

    r_sync = client.post("/sync/outbox", json=sync_payload, headers=headers)
    assert r_sync.status_code == 200
    results = r_sync.json()["results"]
    assert len(results) == 2
    assert results[0]["status"] == "success"
    assert results[1]["status"] == "success"

    # 4. Resending the same outbox items must be idempotent!
    r_sync2 = client.post("/sync/outbox", json=sync_payload, headers=headers)
    assert r_sync2.status_code == 200
    results2 = r_sync2.json()["results"]
    assert results2[0]["status"] == "success"
    assert results2[1]["status"] == "success"

def test_recipes_inventory_auto_deduct_and_daily_bazar():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}
    
    # 1. Check inventory
    inv = client.get("/inventory", headers=headers).json()
    milk = next(i for i in inv if i["name"] == "Milk")
    initial_stock = milk["current_stock"]

    # 2. Purchase more milk via Daily Bazar
    bazar_res = client.post("/inventory/daily-bazar", json={
        "ingredient_id": milk["id"],
        "qty_purchased": 5000,
        "total_cost": 50000  # 500 tk
    }, headers=headers)
    assert bazar_res.status_code == 200
    assert bazar_res.json()["new_stock"] == initial_stock + 5000

    # 3. Order a Cappuccino (uses 150ml milk and 18g beans)
    items = client.get("/items", headers=headers).json()
    capp = next(i for i in items if i["name"] == "Cappuccino")
    
    order_uuid = str(uuid.uuid4())
    r_order = client.post("/orders", json={
        "client_uuid": order_uuid,
        "channel": "takeaway",
        "slot": "Counter",
        "waiter": "Barista",
        "lines": [{"item_id": capp["id"], "qty": 2}]
    }, headers=headers)
    assert r_order.status_code == 200

    # 4. Verify Milk auto-deducted (150 * 2 = 300 ml)
    inv_after = client.get("/inventory", headers=headers).json()
    milk_after = next(i for i in inv_after if i["name"] == "Milk")
    assert milk_after["current_stock"] == (initial_stock + 5000) - 300

def test_kot_receipt_printing_jobs():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}

    # Fetch pending print jobs
    jobs = client.get("/printers/jobs?status=pending", headers=headers).json()
    assert len(jobs) > 0
    first_job = jobs[0]
    assert "station" in first_job
    assert "payload" in first_job

    # Ack job
    ack_res = client.post(f"/printers/jobs/{first_job['id']}/ack", headers=headers)
    assert ack_res.status_code == 200
    assert ack_res.json()["status"] == "printed"

def test_void_and_refund_with_manager_pin():
    owner_token = get_auth_token("owner")
    cashier_token = get_auth_token("cashier")
    
    headers_cashier = {"Authorization": f"Bearer {cashier_token}"}
    headers_owner = {"Authorization": f"Bearer {owner_token}"}

    # 1. Create order
    items = client.get("/items", headers=headers_cashier).json()
    order_uuid = str(uuid.uuid4())
    r_order = client.post("/orders", json={
        "client_uuid": order_uuid,
        "channel": "dine_in",
        "slot": "T4",
        "waiter": "Rahim",
        "lines": [{"item_id": items[0]["id"], "qty": 1}]
    }, headers=headers_cashier)
    order_id = r_order.json()["id"]

    # 2. Try void with wrong PIN -> fails
    r_fail = client.post("/orders/void-refund", json={
        "order_id": order_id,
        "type": "void",
        "reason": "Customer cancelled before preparation",
        "manager_pin": "0000"
    }, headers=headers_cashier)
    assert r_fail.status_code == 403

    # 3. Void with valid manager/owner PIN (1234)
    r_void = client.post("/orders/void-refund", json={
        "order_id": order_id,
        "type": "void",
        "reason": "Customer changed mind",
        "manager_pin": "1234"
    }, headers=headers_cashier)
    assert r_void.status_code == 200
    assert r_void.json()["status"] == "voided"

def test_table_layout_editor():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Get current layout
    layout = client.get("/layout/dine_in", headers=headers).json()
    assert isinstance(layout, list)

    # 2. Update layout with custom coordinates
    new_layout = [
        {"id": "T1", "label": "T1", "x": 100, "y": 150, "width": 90, "height": 90, "shape": "square"},
        {"id": "VIP-1", "label": "VIP-1", "x": 300, "y": 200, "width": 120, "height": 120, "shape": "round"}
    ]
    r_save = client.post("/layout", json={"channel": "dine_in", "layout": new_layout}, headers=headers)
    assert r_save.status_code == 200

    saved = client.get("/layout/dine_in", headers=headers).json()
    assert len(saved) == 2
    assert saved[1]["id"] == "VIP-1"

def test_super_admin_and_multi_tenant_isolation():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}

    new_code = f"tenant_{uuid.uuid4().hex[:6]}"
    r_create = client.post("/super-admin/tenants", json={
        "code": new_code,
        "name": "Second Branch Cafe",
        "admin_emp_id": "1001",
        "admin_password": "secretpassword"
    }, headers=headers)
    assert r_create.status_code == 200

    # Login to second tenant
    r_login2 = client.post("/auth/login", json={
        "tenant": new_code,
        "emp_id": "1001",
        "password": "secretpassword"
    })
    assert r_login2.status_code == 200
    token2 = r_login2.json()["token"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    # Tenant 2 has no orders or items by default
    items2 = client.get("/items", headers=headers2).json()
    assert len(items2) == 0
