import pytest
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.database import Session
from app.models import Tenant, Branch, Terminal, User, Item, Shift, Order, Line, Payment, Ingredient, RecipeItem, TableLayout, StockMovement

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean_db():
    db = Session()
    t = db.query(Tenant).filter_by(code="crown").first()
    assert t is not None
    db.close()

def get_auth_token(role="owner"):
    emp_id = "1001" if role == "owner" else ("1002" if role == "manager" else "1003")
    pw = "258000" if role == "owner" else ("456456" if role == "manager" else "admin123")
    r = client.post("/auth/login", json={"tenant": "crown", "emp_id": emp_id, "password": pw})
    assert r.status_code == 200
    return r.json()["token"]

def test_modular_auth_and_argon2():
    # Owner login with custom password 258000
    r = client.post("/auth/login", json={"tenant": "crown", "emp_id": "1001", "password": "258000"})
    assert r.status_code == 200
    data = r.json()
    assert data["role"] == "owner"
    assert "token" in data
    assert "branch" in data

    # Manager login with custom password 456456
    r_mgr = client.post("/auth/login", json={"tenant": "crown", "emp_id": "1002", "password": "456456"})
    assert r_mgr.status_code == 200
    assert r_mgr.json()["role"] == "manager"

def test_offline_outbox_idempotency_and_sync():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}

    curr = client.get("/shifts/current", headers=headers).json()
    if not curr:
        client.post("/shifts/open", json={"label": "Morning Shift", "opening_cash": 100000}, headers=headers)

    items = client.get("/items", headers=headers).json()
    item1 = items[0]

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

    # Idempotent resend
    r_sync2 = client.post("/sync/outbox", json=sync_payload, headers=headers)
    assert r_sync2.status_code == 200
    assert r_sync2.json()["results"][0]["status"] == "success"

def test_recipes_inventory_stock_movements_and_wastage():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}

    inv = client.get("/inventory", headers=headers).json()
    milk = next(i for i in inv if i["name"] == "Milk")
    initial_stock = milk["current_stock"]

    # Daily Bazar purchase
    bazar_res = client.post("/inventory/daily-bazar", json={
        "ingredient_id": milk["id"],
        "qty_purchased": 5000,
        "total_cost": 50000
    }, headers=headers)
    assert bazar_res.status_code == 200

    # Wastage recording
    waste_res = client.post("/inventory/wastage", json={
        "ingredient_id": milk["id"],
        "qty_lost": 200,
        "reason": "Milk packet expired / spilled"
    }, headers=headers)
    assert waste_res.status_code == 200
    assert waste_res.json()["status"] == "ok"

    # Verify stock movement history
    moves = client.get("/inventory/movements", headers=headers).json()
    assert len(moves) > 0
    assert any(m["type"] == "wastage" for m in moves)

def test_kot_receipt_printing_and_reprint():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}

    jobs = client.get("/printers/jobs?status=pending", headers=headers).json()
    assert len(jobs) > 0
    first_job = jobs[0]

    ack_res = client.post(f"/printers/jobs/{first_job['id']}/ack", headers=headers)
    assert ack_res.status_code == 200
    assert ack_res.json()["status"] == "printed"

def test_void_refund_and_table_transfer():
    cashier_token = get_auth_token("cashier")
    headers_cashier = {"Authorization": f"Bearer {cashier_token}"}

    items = client.get("/items", headers=headers_cashier).json()
    order_uuid = str(uuid.uuid4())
    r_order = client.post("/orders", json={
        "client_uuid": order_uuid,
        "channel": "dine_in",
        "slot": "T2",
        "waiter": "Rahim",
        "lines": [{"item_id": items[0]["id"], "qty": 1}]
    }, headers=headers_cashier)
    order_id = r_order.json()["id"]

    # Table Transfer
    tr_res = client.post(f"/orders/{order_id}/transfer", json={"order_id": order_id, "target_slot": "T5"}, headers=headers_cashier)
    assert tr_res.status_code == 200
    assert tr_res.json()["new_slot"] == "T5"

    # Void with manager PIN
    r_void = client.post("/orders/void-refund", json={
        "order_id": order_id,
        "type": "void",
        "reason": "Customer cancelled table",
        "manager_pin": "1234"
    }, headers=headers_cashier)
    assert r_void.status_code == 200
    assert r_void.json()["status"] == "voided"

def test_super_admin_multi_branch_and_mushak_reports():
    token = get_auth_token("owner")
    headers = {"Authorization": f"Bearer {token}"}

    new_code = f"tenant_{uuid.uuid4().hex[:6]}"
    r_create = client.post("/super-admin/tenants", json={
        "code": new_code,
        "name": "Second Branch Cafe",
        "plan": "standard",
        "admin_emp_id": "1001",
        "admin_password": "secretpassword",
        "branch_name": "Dhanmondi Branch"
    }, headers=headers)
    assert r_create.status_code == 200

    report = client.get("/reports/daily", headers=headers).json()
    assert "mushak_summary" in report
    assert "vat_collected" in report["mushak_summary"]

def test_manager_role_restricted_to_inventory():
    mgr_token = get_auth_token("manager")
    mgr_headers = {"Authorization": f"Bearer {mgr_token}"}

    # Manager has full access to inventory and stock
    r_inv = client.get("/inventory", headers=mgr_headers)
    assert r_inv.status_code == 200

    # Manager is blocked from shift operations
    r_shift = client.post("/shifts/open", json={"label": "Unauthorized Shift", "opening_cash": 1000}, headers=mgr_headers)
    assert r_shift.status_code == 403

    # Manager is blocked from cashiering/sales orders
    r_order = client.post("/orders", json={"channel": "dine_in", "client_uuid": str(uuid.uuid4()), "slot": "T1", "lines": []}, headers=mgr_headers)
    assert r_order.status_code == 403

    # Manager is blocked from viewing financial reports
    r_rep = client.get("/reports/daily", headers=mgr_headers)
    assert r_rep.status_code == 403
