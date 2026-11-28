import uuid
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def get_headers(role="owner"):
    emp_id = "1001" if role == "owner" else ("1002" if role == "manager" else "1003")
    pw = "258000" if role == "owner" else ("456456" if role == "manager" else "admin123")
    r = client.post("/auth/login", json={"tenant": "crown", "emp_id": emp_id, "password": pw})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_central_and_bazar_approve_adds_stock_and_locks_batch():
    owner_h = get_headers("owner")
    staff_h = get_headers("cashier")

    # Create a new bazar item with unique barcode
    bc = f"ING-TEST-{uuid.uuid4().hex[:6].upper()}"
    r_ing = client.post("/inventory", json={
        "name": "Test Flour",
        "unit": "g",
        "barcode": bc,
        "pack_size": 1000,
        "pack_unit": "1 kg",
        "min_stock": 5000,
    }, headers=owner_h)
    assert r_ing.status_code == 200
    ing_id = r_ing.json()["id"]

    # Staff can create a Central draft batch and scan lines
    r_cb = client.post("/batches", json={"batch_type": "central"}, headers=staff_h)
    assert r_cb.status_code == 200
    cb_id = r_cb.json()["id"]

    r_lines = client.put(f"/batches/{cb_id}/lines", json={
        "lines": [{"bazar_item_id": ing_id, "quantity": 2000, "pack_count": 2}]
    }, headers=staff_h)
    assert r_lines.status_code == 200

    # Staff cannot approve
    r_staff_app = client.post(f"/batches/{cb_id}/approve", json={}, headers=staff_h)
    assert r_staff_app.status_code == 403

    # Manager/owner approves Central batch
    r_app = client.post(f"/batches/{cb_id}/approve", json={}, headers=owner_h)
    assert r_app.status_code == 200
    assert r_app.json()["status"] == "approved"

    # Approved batch cannot be edited without owner password (or with wrong password)
    r_edit_no_pw = client.put(f"/batches/{cb_id}/lines", json={
        "lines": [{"bazar_item_id": ing_id, "quantity": 9999, "pack_count": 10}]
    }, headers=owner_h)
    assert r_edit_no_pw.status_code == 403

    r_edit_bad_pw = client.put(f"/batches/{cb_id}/lines", json={
        "lines": [{"bazar_item_id": ing_id, "quantity": 9999, "pack_count": 10}],
        "owner_password": "wrongpassword",
    }, headers=owner_h)
    assert r_edit_bad_pw.status_code == 403

    # With valid owner password, approved central stock batch CAN be edited and reconciles ledger
    r_edit_ok = client.put(f"/batches/{cb_id}/lines", json={
        "lines": [{"bazar_item_id": ing_id, "quantity": 2500, "pack_count": 2.5}],
        "owner_password": "258000",
    }, headers=owner_h)
    assert r_edit_ok.status_code == 200
    assert r_edit_ok.json()["status"] == "approved"

    # Re-edit back to 2000 so downstream stock total assertions remain 2000 + 4000 = 6000
    r_edit_back = client.put(f"/batches/{cb_id}/lines", json={
        "lines": [{"bazar_item_id": ing_id, "quantity": 2000, "pack_count": 2}],
        "owner_password": "258000",
    }, headers=owner_h)
    assert r_edit_back.status_code == 200

    r_del = client.delete(f"/batches/{cb_id}", headers=owner_h)
    assert r_del.status_code == 400

    # Daily Bazar batch adds stock for a date
    r_bb = client.post("/batches", json={"batch_type": "bazar", "batch_date": "2026-11-26"}, headers=staff_h)
    assert r_bb.status_code == 200
    bb_id = r_bb.json()["id"]
    client.put(f"/batches/{bb_id}/lines", json={
        "lines": [{"bazar_item_id": ing_id, "quantity": 4000, "pack_count": 4}]
    }, headers=staff_h)
    r_bapp = client.post(f"/batches/{bb_id}/approve", json={}, headers=owner_h)
    assert r_bapp.status_code == 200

    # Approved Daily Bazar batch cannot be edited without owner password, succeeds with owner password
    assert client.put(f"/batches/{bb_id}/lines", json={
        "lines": [{"bazar_item_id": ing_id, "quantity": 4500, "pack_count": 4.5}]
    }, headers=owner_h).status_code == 403
    assert client.put(f"/batches/{bb_id}/lines", json={
        "lines": [{"bazar_item_id": ing_id, "quantity": 4000, "pack_count": 4}],
        "owner_password": "258000",
    }, headers=owner_h).status_code == 200

    # Check inventory summary: Central (2000) + Bazar (4000) = 6000
    inv = client.get("/inventory", headers=owner_h).json()
    item = next(x for x in inv if x["id"] == ing_id)
    assert item["central_total"] == 2000
    assert item["bazar_total"] == 4000
    assert item["sale_total"] == 0
    assert item["current_stock"] == 6000
    assert item["status"] == "OK"


def test_unit_conversion_and_recipe_approval_workflow():
    owner_h = get_headers("owner")
    staff_h = get_headers("cashier")

    # Create bazar items: g and ml
    bc_g = f"ING-G-{uuid.uuid4().hex[:5].upper()}"
    bc_ml = f"ING-ML-{uuid.uuid4().hex[:5].upper()}"
    ing_g = client.post("/inventory", json={"name": "Cocoa", "unit": "g", "barcode": bc_g, "pack_size": 500, "min_stock": 100}, headers=owner_h).json()["id"]
    ing_ml = client.post("/inventory", json={"name": "Cream", "unit": "ml", "barcode": bc_ml, "pack_size": 1000, "min_stock": 100}, headers=owner_h).json()["id"]

    # Create menu item (no price required)
    bc_menu = f"MENU-MOCHA-{uuid.uuid4().hex[:5].upper()}"
    r_menu = client.post("/items", json={"name": "Mocha Special", "barcode": bc_menu, "price": None}, headers=owner_h)
    assert r_menu.status_code == 200
    menu_id = r_menu.json()["id"]

    # Unapproved menu item is hidden from approved-only menu
    approved_menu = client.get("/items?approved_only=true", headers=staff_h).json()
    assert all(m["id"] != menu_id for m in approved_menu)

    # Unapproved menu item cannot be scanned/added to Daily Sale
    sb_id = client.post("/batches", json={"batch_type": "sale"}, headers=staff_h).json()["id"]
    r_bad_sale = client.put(f"/batches/{sb_id}/lines", json={
        "lines": [{"menu_item_id": menu_id, "quantity": 1}]
    }, headers=staff_h)
    assert r_bad_sale.status_code == 400
    assert "Recipe not approved" in r_bad_sale.json()["detail"]

    # Incompatible unit rejected (e.g., L for 'g' item)
    r_incompat = client.post(f"/recipes/{menu_id}/draft", json={
        "ingredients": [{"bazar_item_id": ing_g, "amount": 1, "unit": "L"}]
    }, headers=staff_h)
    assert r_incompat.status_code == 400

    # Staff saves draft recipe using kg and L -> converts to g and ml integers
    r_draft = client.post(f"/recipes/{menu_id}/draft", json={
        "ingredients": [
            {"bazar_item_id": ing_g, "amount": 0.25, "unit": "kg"},  # 250 g
            {"bazar_item_id": ing_ml, "amount": 1.5, "unit": "L"},   # 1500 ml
        ]
    }, headers=staff_h)
    assert r_draft.status_code == 200
    assert r_draft.json()["status"] == "draft"
    qty_map = {x["bazar_item_id"]: x["qty_base"] for x in r_draft.json()["ingredients"]}
    assert qty_map[ing_g] == 250
    assert qty_map[ing_ml] == 1500

    # Still hidden from menu until approved
    approved_menu2 = client.get("/items?approved_only=true", headers=staff_h).json()
    assert all(m["id"] != menu_id for m in approved_menu2)

    # Staff cannot approve recipe
    assert client.post(f"/recipes/{menu_id}/approve", headers=staff_h).status_code == 403

    # Manager approves recipe v1
    r_rec_app = client.post(f"/recipes/{menu_id}/approve", headers=owner_h)
    assert r_rec_app.status_code == 200
    assert r_rec_app.json()["status"] == "approved"
    assert r_rec_app.json()["version"] == 1

    # Now visible on approved menu
    approved_menu3 = client.get("/items?approved_only=true", headers=staff_h).json()
    assert any(m["id"] == menu_id for m in approved_menu3)

    # Approved menu item cannot be edited without owner password
    assert client.patch(f"/items/{menu_id}", json={"price": 45000}, headers=owner_h).status_code == 403
    assert client.patch(f"/items/{menu_id}", json={"price": 45000, "owner_password": "wrong"}, headers=owner_h).status_code == 403
    assert client.patch(f"/items/{menu_id}", json={"price": 45000, "owner_password": "258000"}, headers=owner_h).status_code == 200

    # Editing approved recipe requires owner password
    r_draft2_fail = client.post(f"/recipes/{menu_id}/draft", json={
        "ingredients": [{"bazar_item_id": ing_g, "amount": 500, "unit": "g"}]
    }, headers=staff_h)
    assert r_draft2_fail.status_code == 403

    r_draft2 = client.post(f"/recipes/{menu_id}/draft", json={
        "ingredients": [{"bazar_item_id": ing_g, "amount": 500, "unit": "g"}],
        "owner_password": "258000",
    }, headers=staff_h)
    assert r_draft2.status_code == 200
    assert r_draft2.json()["version"] == 2
    assert r_draft2.json()["status"] == "draft"

    # Approving an update over an already-approved recipe also requires owner password
    assert client.post(f"/recipes/{menu_id}/approve", json={}, headers=owner_h).status_code == 403

    rec_info = client.get(f"/recipes/{menu_id}", headers=owner_h).json()
    assert rec_info["approved_recipe"]["version"] == 1
    assert rec_info["draft_recipe"]["version"] == 2


def test_sale_deduction_negative_stock_and_reversal():
    owner_h = get_headers("owner")

    # Setup item & ingredients
    bc_g = f"ING-S-{uuid.uuid4().hex[:5].upper()}"
    ing_id = client.post("/inventory", json={"name": "Espresso", "unit": "g", "barcode": bc_g, "pack_size": 1000, "min_stock": 500}, headers=owner_h).json()["id"]
    bc_menu = f"MENU-ESP-{uuid.uuid4().hex[:5].upper()}"
    menu_id = client.post("/items", json={"name": "Double Espresso", "barcode": bc_menu}, headers=owner_h).json()["id"]

    client.post(f"/recipes/{menu_id}/draft", json={
        "ingredients": [{"bazar_item_id": ing_id, "amount": 20, "unit": "g"}]
    }, headers=owner_h)
    client.post(f"/recipes/{menu_id}/approve", headers=owner_h)

    # Add 100g via Central Inventory
    cb_id = client.post("/batches", json={"batch_type": "central"}, headers=owner_h).json()["id"]
    client.put(f"/batches/{cb_id}/lines", json={"lines": [{"bazar_item_id": ing_id, "quantity": 100, "pack_count": 1}]}, headers=owner_h)
    client.post(f"/batches/{cb_id}/approve", json={}, headers=owner_h)

    # Sell 3 servings -> deducts 60g (remaining 40g)
    sb_id = client.post("/batches", json={"batch_type": "sale", "batch_date": "2026-11-26"}, headers=owner_h).json()["id"]
    r_sl = client.put(f"/batches/{sb_id}/lines", json={"lines": [{"menu_item_id": menu_id, "quantity": 3}]}, headers=owner_h)
    assert r_sl.status_code == 200
    assert r_sl.json()["lines"][0]["recipe_version"] == 1
    assert client.post(f"/batches/{sb_id}/approve", json={}, headers=owner_h).status_code == 200

    # Approved Daily Sale batch cannot be edited without owner password, succeeds with owner password
    assert client.put(f"/batches/{sb_id}/lines", json={"lines": [{"menu_item_id": menu_id, "quantity": 2}]}, headers=owner_h).status_code == 403
    r_sale_edit = client.put(f"/batches/{sb_id}/lines", json={"lines": [{"menu_item_id": menu_id, "quantity": 3}], "owner_password": "258000"}, headers=owner_h)
    assert r_sale_edit.status_code == 200

    inv = client.get("/inventory", headers=owner_h).json()
    item = next(x for x in inv if x["id"] == ing_id)
    assert item["current_stock"] == 40
    assert item["sale_total"] == 60
    assert item["status"] == "LOW"  # 40 < min_stock 500

    # Try selling 5 more (needs 100g, only 40g available) -> rejected without override
    sb2_id = client.post("/batches", json={"batch_type": "sale", "batch_date": "2026-11-26"}, headers=owner_h).json()["id"]
    client.put(f"/batches/{sb2_id}/lines", json={"lines": [{"menu_item_id": menu_id, "quantity": 5}]}, headers=owner_h)
    r_fail = client.post(f"/batches/{sb2_id}/approve", json={"allow_negative_stock": False}, headers=owner_h)
    assert r_fail.status_code == 400
    assert "Not enough stock" in r_fail.json()["detail"]

    # Manager ticks "Approve with negative stock" -> succeeds (-60g)
    r_ok = client.post(f"/batches/{sb2_id}/approve", json={"allow_negative_stock": True}, headers=owner_h)
    assert r_ok.status_code == 200

    # Reverse the second sale ledger entry requires owner password -> restores +100g back to 40g
    ledger = client.get(f"/inventory/ledger?bazar_item_id={ing_id}&type=sale", headers=owner_h).json()
    sale2_entry = next(e for e in ledger if e["batch_id"] == sb2_id)
    assert client.post(f"/inventory/ledger/{sale2_entry['id']}/reverse", json={"reason": "Wrong scan count"}, headers=owner_h).status_code == 403
    r_rev = client.post(f"/inventory/ledger/{sale2_entry['id']}/reverse", json={"reason": "Wrong scan count", "owner_password": "258000"}, headers=owner_h)
    assert r_rev.status_code == 200
    assert r_rev.json()["quantity"] == 100

    inv_after = client.get("/inventory", headers=owner_h).json()
    item_after = next(x for x in inv_after if x["id"] == ing_id)
    assert item_after["current_stock"] == 40


def test_qty_prefix_rejected_on_barcodes():
    owner_h = get_headers("owner")
    r1 = client.post("/inventory", json={"name": "Bad", "unit": "g", "barcode": "QTY-X5"}, headers=owner_h)
    assert r1.status_code == 400
    r2 = client.post("/items", json={"name": "Bad Menu", "barcode": "QTY-PLUS1KG"}, headers=owner_h)
    assert r2.status_code == 400


def test_clear_inventory_requires_owner_password():
    owner_h = get_headers("owner")
    mgr_h = get_headers("manager")

    bc = f"ING-CLR-{uuid.uuid4().hex[:5].upper()}"
    ing_id = client.post("/inventory", json={
        "name": "Clear Test Sugar", "unit": "g", "barcode": bc, "pack_size": 100, "min_stock": 100
    }, headers=owner_h).json()["id"]

    # Add 500g via Monthly Opening Stock (central) and 300g via Daily Bazar (bazar)
    cb = client.post("/batches", json={"batch_type": "central"}, headers=owner_h).json()["id"]
    client.put(f"/batches/{cb}/lines", json={"lines": [{"bazar_item_id": ing_id, "quantity": 500, "pack_count": 5}]}, headers=owner_h)
    client.post(f"/batches/{cb}/approve", json={}, headers=owner_h)

    bb = client.post("/batches", json={"batch_type": "bazar"}, headers=owner_h).json()["id"]
    client.put(f"/batches/{bb}/lines", json={"lines": [{"bazar_item_id": ing_id, "quantity": 300, "pack_count": 3}]}, headers=owner_h)
    client.post(f"/batches/{bb}/approve", json={}, headers=owner_h)

    # Without owner password or with manager password -> rejected 403
    assert client.post("/inventory/clear", json={"scope": "bazar"}, headers=mgr_h).status_code == 403
    assert client.post("/inventory/clear", json={"scope": "bazar", "owner_password": "456456"}, headers=mgr_h).status_code == 403
    assert client.post("/inventory/clear", json={"scope": "all", "owner_password": "wrong"}, headers=owner_h).status_code == 403

    # Clear Daily Bazar with valid owner password -> leaves central 500g intact
    r_clr_bazar = client.post("/inventory/clear", json={"scope": "bazar", "owner_password": "258000"}, headers=mgr_h)
    assert r_clr_bazar.status_code == 200
    inv = client.get("/inventory", headers=owner_h).json()
    item = next(x for x in inv if x["id"] == ing_id)
    assert item["bazar_total"] == 0
    assert item["central_total"] == 500
    assert item["current_stock"] == 500

    # Clear All Inventory & Stocks with valid owner password -> resets stock to 0 while keeping item
    r_clr_all = client.post("/inventory/clear", json={"scope": "all", "owner_password": "258000"}, headers=owner_h)
    assert r_clr_all.status_code == 200
    inv2 = client.get("/inventory", headers=owner_h).json()
    item2 = next(x for x in inv2 if x["id"] == ing_id)
    assert item2["central_total"] == 0
    assert item2["current_stock"] == 0


def test_owner_edit_and_delete_menu_ingredient_and_batch():
    owner_h = get_headers("owner")
    mgr_h = get_headers("manager")

    # 1. Create ingredient and test edit/delete with owner password
    bc_i = f"ING-ED-{uuid.uuid4().hex[:5].upper()}"
    ing_id = client.post("/inventory", json={"name": "Old Ing", "unit": "g", "barcode": bc_i, "pack_size": 100, "min_stock": 100}, headers=owner_h).json()["id"]

    assert client.patch(f"/inventory/{ing_id}", json={"name": "New Ing", "cost_per_unit": 500}, headers=mgr_h).status_code == 403
    r_upd_ing = client.patch(f"/inventory/{ing_id}", json={"name": "New Ing", "cost_per_unit": 500, "owner_password": "258000"}, headers=owner_h)
    assert r_upd_ing.status_code == 200
    assert r_upd_ing.json()["name"] == "New Ing"
    assert r_upd_ing.json()["cost_per_unit"] == 500

    # 2. Create approved bazar batch and delete it with owner password
    bb = client.post("/batches", json={"batch_type": "bazar"}, headers=owner_h).json()["id"]
    client.put(f"/batches/{bb}/lines", json={"lines": [{"bazar_item_id": ing_id, "quantity": 200, "pack_count": 2}]}, headers=owner_h)
    client.post(f"/batches/{bb}/approve", json={}, headers=owner_h)
    assert client.post(f"/batches/{bb}/delete", json={}, headers=owner_h).status_code == 403
    assert client.post(f"/batches/{bb}/delete", json={"owner_password": "258000"}, headers=owner_h).status_code == 200

    # 3. Create menu item, edit name/price, and delete with owner password
    bc_m = f"MENU-ED-{uuid.uuid4().hex[:5].upper()}"
    menu_id = client.post("/items", json={"name": "Old Drink", "barcode": bc_m, "station": "bar"}, headers=owner_h).json()["id"]
    r_upd_m = client.patch(f"/items/{menu_id}", json={"name": "New Drink", "price": 25000, "owner_password": "258000"}, headers=owner_h)
    assert r_upd_m.status_code == 200
    assert r_upd_m.json()["name"] == "New Drink"
    assert r_upd_m.json()["price"] == 25000

    assert client.post(f"/items/{menu_id}/delete", json={"owner_password": "wrong"}, headers=owner_h).status_code == 403
    assert client.post(f"/items/{menu_id}/delete", json={"owner_password": "258000"}, headers=owner_h).status_code == 200

    # 4. Delete ingredient with owner password
    assert client.post(f"/inventory/{ing_id}/delete", json={}, headers=owner_h).status_code == 403
    assert client.post(f"/inventory/{ing_id}/delete", json={"owner_password": "258000"}, headers=owner_h).status_code == 200


def test_pos_order_deducts_stock_ledger_in_inventory():
    owner_h = get_headers("owner")

    # Ensure shift is open
    client.post("/shifts/open", json={"label": "Test Shift", "opening_cash": 0}, headers=owner_h)

    bc_i = f"ING-POS-{uuid.uuid4().hex[:5].upper()}"
    ing_id = client.post("/inventory", json={"name": "POS Beans", "unit": "g", "barcode": bc_i, "pack_size": 100, "min_stock": 10}, headers=owner_h).json()["id"]
    bc_m = f"MENU-POS-{uuid.uuid4().hex[:5].upper()}"
    menu_id = client.post("/items", json={"name": "POS Espresso", "barcode": bc_m, "price": 18000, "station": "bar"}, headers=owner_h).json()["id"]

    client.post(f"/recipes/{menu_id}/draft", json={"ingredients": [{"bazar_item_id": ing_id, "amount": 10, "unit": "g"}]}, headers=owner_h)
    client.post(f"/recipes/{menu_id}/approve", headers=owner_h)

    # Add 100g via Daily Bazar
    bb = client.post("/batches", json={"batch_type": "bazar"}, headers=owner_h).json()["id"]
    client.put(f"/batches/{bb}/lines", json={"lines": [{"bazar_item_id": ing_id, "quantity": 100, "pack_count": 1}]}, headers=owner_h)
    client.post(f"/batches/{bb}/approve", json={}, headers=owner_h)

    # Sell 3x via POS Order -> must deduct 30g from StockLedger & Inventory Summary
    r_ord = client.post("/orders", json={
        "client_uuid": str(uuid.uuid4()),
        "channel": "takeaway",
        "slot": "1",
        "lines": [{"item_id": menu_id, "qty": 3}],
    }, headers=owner_h)
    assert r_ord.status_code == 200

    inv = client.get("/inventory", headers=owner_h).json()
    item = next(x for x in inv if x["id"] == ing_id)
    assert item["bazar_total"] == 100
    assert item["sale_total"] == 30
    assert item["current_stock"] == 70
