import { useState, useEffect } from "react";
import { getOutbox, queueOutbox, flushOutbox } from "./outbox";

const api = async (path, token, body, method) => {
  const r = await fetch("/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || "Request failed");
  return d;
};

const tk = (p) => "৳" + (p / 100).toFixed(2);
const CHANNELS = [
  ["dine_in", "Dine In"],
  ["takeaway", "Takeaway"],
  ["foodpanda", "Foodpanda"],
  ["foodi", "Foodi"],
  ["pathao", "Pathao"]
];

function Login({ onLogin }) {
  const [f, setF] = useState({ tenant: "crown", emp_id: "1001", password: "admin123" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const go = async () => {
    try {
      onLogin(await api("/auth/login", null, f));
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <div className="login card">
      <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
        <h1 style={{ color: "var(--blue-primary)", margin: 0, fontSize: "1.75rem", letterSpacing: "-0.03em" }}>crownpointofsale</h1>
        <p style={{ color: "var(--gray)", fontSize: "0.88rem", margin: "0.3rem 0 0" }}>Enterprise Cloud Point of Sale</p>
      </div>
      <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--gray)" }}>Business Code</label>
      <input placeholder="crown" value={f.tenant} onChange={set("tenant")} />
      
      <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--gray)" }}>Employee ID</label>
      <input placeholder="1001" value={f.emp_id} onChange={set("emp_id")} />
      
      <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--gray)" }}>Password</label>
      <input
        type="password"
        placeholder="••••••••"
        value={f.password}
        onChange={set("password")}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      {err && <div style={{ color: "var(--red)", fontWeight: 600, fontSize: "0.9rem" }}>{err}</div>}
      <button className="primary" style={{ marginTop: "0.5rem", minHeight: "46px" }} onClick={go}>Sign In to Terminal</button>
      <div style={{ background: "var(--blue-light)", padding: "0.6rem 0.8rem", borderRadius: "8px", fontSize: "0.78rem", color: "var(--blue-primary)", marginTop: "0.5rem" }}>
        Demo Accounts: <b>1001</b> (Owner), <b>1002</b> (Manager), <b>1003</b> (Cashier) | Password: <b>admin123</b>
      </div>
    </div>
  );
}

function Pay({ order, token, onDone, isOffline }) {
  const [method, setMethod] = useState("cash");
  const [amt, setAmt] = useState((order.total / 100).toFixed(2));
  const [err, setErr] = useState("");

  const numpadPress = (val) => {
    if (val === "C") setAmt("");
    else if (val === "DEL") setAmt(prev => prev.slice(0, -1));
    else if (val === "EXACT") setAmt((order.total / 100).toFixed(2));
    else setAmt(prev => prev + val);
  };

  const printBill = async () => {
    try {
      await api(`/orders/${order.id}/print-bill`, token, {});
      alert("Pre-payment Customer Bill sent to printer queue!");
    } catch (e) {
      alert("Could not print bill: " + e.message);
    }
  };

  const go = async () => {
    const amountPaisa = Math.round(parseFloat(amt || "0") * 100);
    if (amountPaisa < order.total) {
      setErr("Tendered amount is less than total bill");
      return;
    }
    const payUuid = crypto.randomUUID();
    if (isOffline) {
      queueOutbox("pay_order", {
        order_client_uuid: order.client_uuid,
        order_id: order.id,
        method,
        amount: amountPaisa
      }, payUuid);
      alert("Offline mode: Payment saved in outbox!");
      onDone();
      return;
    }
    try {
      const r = await api(`/orders/${order.id}/pay`, token, {
        method,
        amount: amountPaisa,
        client_uuid: payUuid
      });
      alert(r.change > 0 ? "Change Due: " + tk(r.change) : "Payment Recorded Successfully");
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 480, margin: "0 auto" }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>Payment · {order.slot || "Order"}</h2>
        <button className="secondary" onClick={printBill}>🖨 Print Bill First</button>
      </div>

      <div style={{ background: "var(--blue-light)", padding: "1rem", borderRadius: "8px", margin: "1rem 0" }}>
        <div className="row" style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--blue-primary)" }}>
          <span>Total Payable</span>
          <span>{tk(order.total)}</span>
        </div>
      </div>

      <div style={{ marginBottom: "0.8rem" }}>
        <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--gray)" }}>Payment Method</label>
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: "0.4rem" }}>
          {["cash", "card", "mfs", "foodpanda", "other"].map((m) => (
            <button
              key={m}
              type="button"
              className={m === method ? "primary" : ""}
              onClick={() => setMethod(m)}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--gray)" }}>Amount Tendered (৳)</label>
      <input
        style={{ width: "100%", fontSize: "1.3rem", fontWeight: "bold", padding: "0.6rem", marginTop: "0.3rem" }}
        value={amt}
        onChange={(e) => setAmt(e.target.value)}
        inputMode="decimal"
      />

      {/* POS Touchscreen Numpad */}
      <div className="numpad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "00"].map((n) => (
          <button key={n} type="button" onClick={() => numpadPress(n)}>{n}</button>
        ))}
        <button type="button" className="action-btn" onClick={() => numpadPress("EXACT")}>Exact</button>
        <button type="button" className="action-btn" onClick={() => numpadPress("DEL")}>⌫</button>
        <button type="button" className="action-btn" onClick={() => numpadPress("C")}>Clear</button>
      </div>

      {err && <p style={{ color: "var(--red)", fontWeight: 600, margin: "0.6rem 0" }}>{err}</p>}

      <div className="row" style={{ marginTop: "1.2rem" }}>
        <button onClick={onDone}>Back</button>
        <button className="primary" style={{ padding: "0.75rem 2rem", fontSize: "1.05rem" }} onClick={go}>Complete Payment</button>
      </div>
    </div>
  );
}

function TableTransferModal({ order, tables, token, onClose, onSuccess }) {
  const [targetSlot, setTargetSlot] = useState("");
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!targetSlot) return setErr("Select a target table");
    try {
      await api(`/orders/${order.id}/transfer`, token, { order_id: order.id, target_slot: targetSlot });
      alert(`Order transferred to ${targetSlot}`);
      onSuccess();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 420, margin: "1rem auto" }}>
      <h3>Transfer Table #{order.slot}</h3>
      <p>Move Order #{order.id} ({tk(order.total)}) to another available table.</p>
      <select style={{ width: "100%", marginBottom: "1rem" }} value={targetSlot} onChange={e => setTargetSlot(e.target.value)}>
        <option value="">-- Choose New Table --</option>
        {tables.filter(t => t.id !== order.slot).map(t => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      {err && <p style={{ color: "var(--red)" }}>{err}</p>}
      <div className="row">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={submit}>Confirm Transfer</button>
      </div>
    </div>
  );
}

function VoidRefundModal({ order, token, onClose, onSuccess }) {
  const [type, setType] = useState(order.status === "paid" ? "refund" : "void");
  const [reason, setReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!reason) return setErr("Please specify a reason");
    if (!managerPin) return setErr("Manager authorization PIN is required");
    try {
      await api("/orders/void-refund", token, {
        order_id: order.id,
        type,
        reason,
        manager_pin: managerPin
      });
      alert(`${type.toUpperCase()} approved and logged to ledger.`);
      onSuccess();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 460, margin: "1rem auto" }}>
      <h3 style={{ color: "var(--red)" }}>{type === "void" ? "Void Order" : "Refund Paid Order"} #{order.id}</h3>
      <p>Amount: <b>{tk(order.total)}</b> | Table/Slot: <b>{order.slot}</b></p>
      <p>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Action Type</label>
        <select style={{ width: "100%", marginTop: "0.3rem" }} value={type} onChange={e => setType(e.target.value)}>
          {order.status !== "paid" && <option value="void">Void (Cancel Unsettled Order)</option>}
          {order.status === "paid" && <option value="refund">Refund (Customer Reimbursement)</option>}
        </select>
      </p>
      <p>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Reason for Void/Refund</label>
        <input style={{ width: "100%", marginTop: "0.3rem" }} placeholder="Customer cancellation / Kitchen error" value={reason} onChange={e => setReason(e.target.value)} />
      </p>
      <p>
        <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Manager Approval PIN</label>
        <input type="password" style={{ width: "100%", marginTop: "0.3rem" }} placeholder="••••" value={managerPin} onChange={e => setManagerPin(e.target.value)} />
      </p>
      {err && <p style={{ color: "var(--red)", fontWeight: 600 }}>{err}</p>}
      <div className="row" style={{ marginTop: "1rem" }}>
        <button onClick={onClose}>Back</button>
        <button className="warn" onClick={submit}>Authorize {type.toUpperCase()}</button>
      </div>
    </div>
  );
}

function OrderView({ channel, slot, token, cfg, onDone, onPay, isOffline }) {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState({});
  const [waiter, setWaiter] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/items", token).then(setItems).catch(() => {});
  }, [token]);

  const categories = ["All", ...new Set(items.map(i => i.category || "General"))];
  const filteredItems = category === "All" ? items : items.filter(i => (i.category || "General") === category);

  const sub = items.reduce((s, i) => s + i.price * (cart[i.id] || 0), 0);
  const vat = Math.round((sub * cfg.vat) / 100);
  const svc = channel === "dine_in" ? Math.round((sub * cfg.service) / 100) : 0;
  const total = sub + vat + svc;

  const add = (id, d) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) + d) }));

  const submit = async (payNow) => {
    const lines = Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([item_id, qty]) => ({ item_id: +item_id, qty }));
    if (!lines.length) return setErr("Please add at least one item");
    if (channel === "dine_in" && !waiter) return setErr("Please select or enter the server/waiter name");

    const client_uuid = crypto.randomUUID();
    const payload = { client_uuid, channel, slot, waiter, lines };

    if (isOffline) {
      queueOutbox("create_order", payload, client_uuid);
      alert("Offline mode: Order queued in outbox.");
      const mockOrder = {
        id: "offline-" + client_uuid.slice(0, 6),
        client_uuid,
        channel,
        slot,
        waiter,
        subtotal: sub,
        vat,
        service: svc,
        total,
        status: "open"
      };
      payNow ? onPay(mockOrder) : onDone();
      return;
    }

    try {
      const o = await api("/orders", token, payload);
      payNow ? onPay(o) : onDone();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="order">
      <div>
        <div className="nav-tabs">
          {categories.map(c => (
            <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>

        <div className="grid">
          {filteredItems.map((i) => (
            <button key={i.id} className="tile" onClick={() => add(i.id, 1)}>
              <div>
                <span style={{ fontSize: "0.95rem" }}>{i.name}</span>
                <div style={{ fontSize: "0.75rem", color: "var(--gray)", marginTop: "2px" }}>
                  <span style={{ background: "var(--blue-light)", color: "var(--blue-primary)", padding: "1px 5px", borderRadius: "4px" }}>
                    {i.station}
                  </span>
                </div>
              </div>
              <b style={{ color: "var(--blue-primary)", fontSize: "1.05rem" }}>{tk(i.price)}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: "0 0 0.8rem 0" }}>{slot || "Order"}</h2>
        {channel === "dine_in" && (
          <p style={{ margin: "0 0 0.8rem 0" }}>
            <input
              placeholder="Waiter / Server Name"
              value={waiter}
              onChange={(e) => setWaiter(e.target.value)}
              style={{ width: "100%", padding: "0.6rem" }}
            />
          </p>
        )}

        <div style={{ maxHeight: "300px", overflowY: "auto" }}>
          {items
            .filter((i) => cart[i.id])
            .map((i) => (
              <div className="row" key={i.id} style={{ marginBottom: "0.5rem", borderBottom: "1px solid var(--line)", paddingBottom: "0.4rem" }}>
                <div>
                  <b>{i.name}</b>
                  <div style={{ fontSize: "0.8rem", color: "var(--gray)" }}>{tk(i.price)} each</div>
                </div>
                <div className="row" style={{ gap: "0.3rem" }}>
                  <button style={{ minHeight: "32px", padding: "0.2rem 0.6rem" }} onClick={() => add(i.id, -1)}>−</button>
                  <span style={{ fontWeight: "bold", minWidth: "20px", textAlign: "center" }}>{cart[i.id]}</span>
                  <button style={{ minHeight: "32px", padding: "0.2rem 0.6rem" }} onClick={() => add(i.id, 1)}>+</button>
                </div>
              </div>
            ))}
        </div>

        <div className="sum">
          <div className="row"><span>Subtotal</span><span>{tk(sub)}</span></div>
          <div className="row"><span>VAT ({cfg.vat}%)</span><span>{tk(vat)}</span></div>
          {svc > 0 && <div className="row"><span>Service Charge ({cfg.service}%)</span><span>{tk(svc)}</span></div>}
          <div className="row" style={{ fontSize: "1.15rem", fontWeight: "bold", color: "var(--blue-primary)", marginTop: "0.5rem" }}>
            <span>Total</span><span>{tk(total)}</span>
          </div>
        </div>

        {err && <p style={{ color: "var(--red)", fontWeight: 600 }}>{err}</p>}

        <div className="row" style={{ marginTop: "1.2rem" }}>
          <button onClick={onDone}>Cancel</button>
          <button className="secondary" onClick={() => submit(false)}>Send to KOT</button>
          <button className="primary" onClick={() => submit(true)}>Pay Now</button>
        </div>
      </div>
    </div>
  );
}

function InventoryDailyBazarView({ token, onBack }) {
  const [tab, setTab] = useState("inventory");
  const [inventory, setInventory] = useState([]);
  const [bazar, setBazar] = useState([]);
  const [movements, setMovements] = useState([]);
  const [selectedIng, setSelectedIng] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [wasteReason, setWasteReason] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = async () => {
    try {
      const inv = await api("/inventory", token);
      setInventory(inv);
      if (inv.length > 0 && !selectedIng) setSelectedIng(inv[0].id);
      const bz = await api("/inventory/daily-bazar", token);
      setBazar(bz);
      const mv = await api("/inventory/movements", token);
      setMovements(mv);
    } catch (e) {
      setMsg(e.message);
    }
  };

  useEffect(() => { refresh(); }, [token]);

  const recordBazar = async () => {
    if (!qty || !cost) return setMsg("Enter quantity and cost");
    try {
      await api("/inventory/daily-bazar", token, {
        ingredient_id: parseInt(selectedIng),
        qty_purchased: parseInt(qty),
        total_cost: Math.round(parseFloat(cost) * 100)
      });
      setMsg("Daily Bazar purchase recorded!");
      setQty(""); setCost("");
      refresh();
    } catch (e) { setMsg(e.message); }
  };

  const recordWastage = async () => {
    if (!qty || !wasteReason) return setMsg("Enter quantity and reason");
    try {
      await api("/inventory/wastage", token, {
        ingredient_id: parseInt(selectedIng),
        qty_lost: parseInt(qty),
        reason: wasteReason
      });
      setMsg("Wastage recorded and subtracted from stock.");
      setQty(""); setWasteReason("");
      refresh();
    } catch (e) { setMsg(e.message); }
  };

  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0, color: "var(--blue-primary)" }}>Inventory & Stock Management</h2>
        <button onClick={onBack}>Back to POS</button>
      </div>

      <div className="nav-tabs" style={{ marginTop: "1rem" }}>
        <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>Stock Levels</button>
        <button className={tab === "bazar" ? "active" : ""} onClick={() => setTab("bazar")}>Daily Bazar Entry</button>
        <button className={tab === "wastage" ? "active" : ""} onClick={() => setTab("wastage")}>Wastage / Adjustment</button>
        <button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}>Stock Movement Ledger</button>
      </div>

      {msg && <p style={{ color: "var(--green)", fontWeight: 600 }}>{msg}</p>}

      {tab === "inventory" && (
        <table className="data-table">
          <thead>
            <tr><th>Ingredient</th><th>Unit</th><th>Current Stock</th><th>Cost/Unit</th></tr>
          </thead>
          <tbody>
            {inventory.map(i => (
              <tr key={i.id}>
                <td><b>{i.name}</b></td>
                <td>{i.unit}</td>
                <td><span style={{ fontWeight: 600 }}>{i.current_stock}</span> {i.unit}</td>
                <td>{tk(i.cost_per_unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "bazar" && (
        <div>
          <div className="card" style={{ maxWidth: 440, margin: "1rem 0" }}>
            <h3>Record Market Purchase</h3>
            <p>
              <label>Ingredient</label>
              <select style={{ width: "100%" }} value={selectedIng} onChange={e => setSelectedIng(e.target.value)}>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </select>
            </p>
            <p>
              <label>Quantity</label>
              <input style={{ width: "100%" }} type="number" placeholder="5000" value={qty} onChange={e => setQty(e.target.value)} />
            </p>
            <p>
              <label>Total Cost (৳)</label>
              <input style={{ width: "100%" }} type="number" placeholder="500" value={cost} onChange={e => setCost(e.target.value)} />
            </p>
            <button className="primary" onClick={recordBazar}>Save Bazar Purchase</button>
          </div>
        </div>
      )}

      {tab === "wastage" && (
        <div>
          <div className="card" style={{ maxWidth: 440, margin: "1rem 0" }}>
            <h3>Record Ingredient Spoilage / Wastage</h3>
            <p>
              <label>Ingredient</label>
              <select style={{ width: "100%" }} value={selectedIng} onChange={e => setSelectedIng(e.target.value)}>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </select>
            </p>
            <p>
              <label>Quantity Lost</label>
              <input style={{ width: "100%" }} type="number" placeholder="200" value={qty} onChange={e => setQty(e.target.value)} />
            </p>
            <p>
              <label>Reason</label>
              <input style={{ width: "100%" }} placeholder="Expired / spilled / prep mistake" value={wasteReason} onChange={e => setWasteReason(e.target.value)} />
            </p>
            <button className="warn" onClick={recordWastage}>Deduct as Wastage</button>
          </div>
        </div>
      )}

      {tab === "movements" && (
        <table className="data-table">
          <thead>
            <tr><th>Timestamp</th><th>Ingredient</th><th>Type</th><th>Change</th><th>Cost</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {movements.map(m => (
              <tr key={m.id}>
                <td>{m.date.slice(0, 16).replace("T", " ")}</td>
                <td><b>{m.ingredient_name}</b></td>
                <td><span style={{ textTransform: "capitalize" }}>{m.type.replace("_", " ")}</span></td>
                <td style={{ color: m.qty_change < 0 ? "var(--red)" : "var(--green)", fontWeight: 600 }}>
                  {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change} {m.unit}
                </td>
                <td>{tk(m.cost_paisa)}</td>
                <td>{m.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TableLayoutEditor({ token, onBack }) {
  const [tables, setTables] = useState([]);
  const [draggingId, setDraggingId] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api("/layout/dine_in", token).then(setTables).catch(() => {});
  }, [token]);

  const handleMouseDown = (id, e) => {
    const t = tables.find(x => x.id === id);
    if (!t) return;
    setDraggingId(id);
    setOffset({ x: e.clientX - t.x, y: e.clientY - t.y });
  };

  const handleMouseMove = (e) => {
    if (!draggingId) return;
    setTables(ts => ts.map(t => {
      if (t.id === draggingId) {
        return {
          ...t,
          x: Math.max(10, Math.min(750, e.clientX - offset.x)),
          y: Math.max(10, Math.min(420, e.clientY - offset.y))
        };
      }
      return t;
    }));
  };

  const handleMouseUp = () => setDraggingId(null);

  const addTable = () => {
    const nextId = "T" + (tables.length + 1);
    setTables([...tables, { id: nextId, label: nextId, x: 50, y: 50, width: 80, height: 80, shape: "square" }]);
  };

  const save = async () => {
    try {
      await api("/layout", token, { channel: "dine_in", layout: tables });
      setMsg("Table layout saved!");
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="card" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      <div className="row">
        <h2 style={{ margin: 0, color: "var(--blue-primary)" }}>Interactive Table Floor Plan</h2>
        <div>
          <button className="secondary" onClick={addTable} style={{ marginRight: "0.5rem" }}>+ Add Table</button>
          <button className="primary" onClick={save} style={{ marginRight: "0.5rem" }}>Save Layout</button>
          <button onClick={onBack}>Back</button>
        </div>
      </div>
      <p style={{ color: "var(--gray)", fontSize: "0.9rem" }}>Drag tables to match your restaurant floor plan.</p>
      {msg && <p style={{ color: "var(--green)", fontWeight: 600 }}>{msg}</p>}

      <div className="floor-canvas">
        {tables.map(t => (
          <div
            key={t.id}
            className={`floor-table ${t.shape || "square"}`}
            style={{
              left: t.x,
              top: t.y,
              width: t.width || 80,
              height: t.height || 80
            }}
            onMouseDown={(e) => handleMouseDown(t.id, e)}
          >
            {t.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [view, setView] = useState({ name: "home" });
  const [shift, setShift] = useState(null);
  const [open, setOpen] = useState([]);
  const [cfg, setCfg] = useState({ vat: 5, service: 10 });
  const [msg, setMsg] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [outboxCount, setOutboxCount] = useState(getOutbox().length);
  const [voidRefundTarget, setVoidRefundTarget] = useState(null);
  const [transferTarget, setTransferTarget] = useState(null);
  const [tablesLayout, setTablesLayout] = useState([]);

  const token = me?.token;

  const refresh = async () => {
    if (!token) return;
    try {
      const curShift = await api("/shifts/current", token);
      setShift(curShift);
      const openOrders = await api("/orders/open", token);
      setOpen(openOrders);
      const layout = await api("/layout/dine_in", token);
      setTablesLayout(layout);
    } catch (e) {}
  };

  const triggerSync = async () => {
    if (!token) return;
    const res = await flushOutbox(token, api);
    setOutboxCount(getOutbox().length);
    if (res.synced > 0) {
      setMsg(`Synced ${res.synced} offline items!`);
      refresh();
    }
  };

  useEffect(() => {
    api("/config").then(setCfg).catch(() => {});
    const onOnline = () => { setIsOnline(true); triggerSync(); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => {
      setOutboxCount(getOutbox().length);
      if (navigator.onLine && getOutbox().length > 0) triggerSync();
    }, 4000);
    return () => clearInterval(interval);
  }, [token, view.name]);

  if (!me) return <Login onLogin={setMe} />;

  const home = () => setView({ name: "home" });

  const openShift = async () => {
    const label = prompt("Shift label (e.g. Morning Shift)", "Shift 1");
    if (!label) return;
    const c = parseFloat(prompt("Opening cash in register (৳)", "0") || "0");
    try {
      await api("/shifts/open", token, { label, opening_cash: Math.round(c * 100) });
      refresh();
    } catch (e) { setMsg(e.message); }
  };

  const closeShift = async () => {
    const c = parseFloat(prompt("Counted cash in register (৳)", "0") || "0");
    try {
      const r = await api("/shifts/close", token, { closing_cash: Math.round(c * 100) });
      setMsg(`Shift closed. Expected: ${tk(r.expected_cash)}, Counted: ${tk(r.counted_cash)}, Diff: ${tk(r.difference)}`);
      refresh();
    } catch (e) { setMsg(e.message); }
  };

  const report = async () => {
    try {
      const r = await api("/reports/daily", token);
      setMsg(`Total Sales: ${tk(r.total)} | Mushak VAT: ${tk(r.total_vat)} | Food Cost: ${tk(r.total_cost)} (${r.food_cost_pct}%) | Shifts: ${Object.entries(r.by_shift).map(([k, v]) => `${k}: ${tk(v)}`).join(", ")}`);
    } catch (e) { setMsg(e.message); }
  };

  const currentLayoutSlots = tablesLayout.length > 0 ? tablesLayout.map(t => t.id) : ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"];
  const slots = view.channel === "dine_in" ? currentLayoutSlots : ["1", "2", "3", "4", "5", "6"];

  return (
    <>
      <header>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span className="brand-badge">👑 crownpointofsale</span>
          <span style={{ fontSize: "0.85rem", color: "var(--gray)", fontWeight: 500 }}>({me.branch || "Uttara"})</span>
          <span className={`status-badge ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "● Online" : "○ Offline"}
          </span>
          {outboxCount > 0 && (
            <button className="secondary" onClick={triggerSync} style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem", minHeight: "30px" }}>
              Sync Outbox ({outboxCount})
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <span style={{ fontSize: "0.88rem" }}>
            {shift ? <span style={{ color: "var(--blue-primary)", fontWeight: 600 }}>{shift.label} ({tk(shift.opening_cash)})</span> : "No shift open"} · {me.name} ({me.role})
          </span>
          {shift ? <button className="warn" style={{ minHeight: "36px", padding: "0.3rem 0.8rem" }} onClick={closeShift}>Close Shift</button> : <button className="primary" style={{ minHeight: "36px", padding: "0.3rem 0.8rem" }} onClick={openShift}>Open Shift</button>}
          <button style={{ minHeight: "36px", padding: "0.3rem 0.8rem" }} onClick={() => setMe(null)}>Log Out</button>
        </div>
      </header>

      <main>
        {msg && <p className="card" style={{ background: "var(--blue-light)", color: "var(--blue-primary)", fontWeight: 600 }} onClick={() => setMsg("")}>{msg}</p>}

        {voidRefundTarget && (
          <VoidRefundModal
            order={voidRefundTarget}
            token={token}
            onClose={() => setVoidRefundTarget(null)}
            onSuccess={() => { setVoidRefundTarget(null); refresh(); }}
          />
        )}

        {transferTarget && (
          <TableTransferModal
            order={transferTarget}
            tables={tablesLayout}
            token={token}
            onClose={() => setTransferTarget(null)}
            onSuccess={() => { setTransferTarget(null); refresh(); }}
          />
        )}

        {view.name === "home" && (
          <div>
            <div className="grid">
              {CHANNELS.map(([k, n]) => (
                <button className="tile" key={k} onClick={() => setView({ name: "layout", channel: k })}>
                  <span style={{ fontSize: "1.05rem", color: "var(--blue-primary)" }}>{n}</span>
                  <span style={{ fontSize: "0.8rem", color: "var(--gray)" }}>Open orders</span>
                </button>
              ))}
              <button className="tile" onClick={() => setView({ name: "inventory" })}>
                <span style={{ fontSize: "1.05rem", color: "var(--blue-primary)" }}>Inventory & Stock</span>
                <span style={{ fontSize: "0.8rem", color: "var(--gray)" }}>Bazar & Wastage</span>
              </button>
              <button className="tile" onClick={() => setView({ name: "table_editor" })}>
                <span style={{ fontSize: "1.05rem", color: "var(--blue-primary)" }}>Floor Plan</span>
                <span style={{ fontSize: "0.8rem", color: "var(--gray)" }}>Table Editor</span>
              </button>
              <button className="tile" onClick={report}>
                <span style={{ fontSize: "1.05rem", color: "var(--blue-primary)" }}>Reports</span>
                <span style={{ fontSize: "0.8rem", color: "var(--gray)" }}>Mushak 6.3 & Cost %</span>
              </button>
            </div>

            {open.length > 0 && (
              <div style={{ marginTop: "2rem" }}>
                <h3 style={{ color: "var(--blue-primary)", margin: "0 0 1rem 0" }}>Active Open Orders ({open.length})</h3>
                <div className="grid">
                  {open.map(o => (
                    <div key={o.id} className="card" style={{ padding: "1rem" }}>
                      <div className="row">
                        <b>#{o.id} · {o.slot}</b>
                        <span style={{ background: "var(--blue-light)", color: "var(--blue-primary)", fontSize: "0.75rem", padding: "2px 6px", borderRadius: "4px" }}>
                          {o.channel}
                        </span>
                      </div>
                      <div style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0.5rem 0", color: "var(--blue-primary)" }}>
                        {tk(o.total)}
                      </div>
                      <div className="row" style={{ marginTop: "0.5rem", gap: "0.3rem" }}>
                        <button className="primary" style={{ minHeight: "34px", padding: "0.2rem 0.6rem" }} onClick={() => setView({ name: "pay", order: o })}>Pay</button>
                        <button className="secondary" style={{ minHeight: "34px", padding: "0.2rem 0.6rem" }} onClick={() => setTransferTarget(o)}>Move</button>
                        <button className="warn" style={{ minHeight: "34px", padding: "0.2rem 0.6rem" }} onClick={() => setVoidRefundTarget(o)}>Void</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {view.name === "layout" && (
          <div>
            <div className="row" style={{ marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, color: "var(--blue-primary)" }}>
                {CHANNELS.find(c => c[0] === view.channel)?.[1] || view.channel} Channel
              </h3>
              <button onClick={home}>Back to Home</button>
            </div>
            <div className="grid">
              {slots.map((s) => {
                const o = open.find((x) => x.channel === view.channel && x.slot === s);
                return (
                  <button
                    key={s}
                    className={"tile" + (o ? " busy" : "")}
                    onClick={() => {
                      if (o) setView({ name: "pay", order: o });
                      else if (shift) setView({ name: "order", channel: view.channel, slot: s });
                      else setMsg("Open a shift first");
                    }}
                  >
                    <span style={{ fontSize: "1.1rem" }}>{s}</span>
                    {o ? <b style={{ fontSize: "1.05rem" }}>{tk(o.total)}</b> : <span style={{ fontSize: "0.8rem", color: "var(--gray)" }}>Available</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {view.name === "order" && (
          <OrderView
            channel={view.channel}
            slot={view.slot}
            token={token}
            cfg={cfg}
            isOffline={!isOnline}
            onDone={home}
            onPay={(o) => setView({ name: "pay", order: o })}
          />
        )}

        {view.name === "pay" && (
          <Pay
            order={view.order}
            token={token}
            isOffline={!isOnline}
            onDone={home}
          />
        )}

        {view.name === "inventory" && <InventoryDailyBazarView token={token} onBack={home} />}
        {view.name === "table_editor" && <TableLayoutEditor token={token} onBack={home} />}
      </main>
    </>
  );
}
