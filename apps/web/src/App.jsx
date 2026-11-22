import { useState, useEffect, useRef } from "react";
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
  const [f, setF] = useState({ tenant: "crown", emp_id: "", password: "" });
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
      <h1>EasyPOS</h1>
      <p style={{ color: "var(--gray)", margin: "0 0 .5rem 0" }}>Restaurant POS & Inventory System</p>
      <input placeholder="Business code (e.g. crown)" value={f.tenant} onChange={set("tenant")} />
      <input placeholder="Employee ID (e.g. 1001)" value={f.emp_id} onChange={set("emp_id")} />
      <input
        type="password"
        placeholder="Password"
        value={f.password}
        onChange={set("password")}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      {err && <div className="err">{err}</div>}
      <button className="primary" onClick={go}>Log in</button>
      <small style={{ color: "var(--gray)" }}>Default demo accounts: 1001 (Owner), 1002 (Manager), 1003 (Cashier). Pass: admin123</small>
    </div>
  );
}

function Pay({ order, token, onDone, isOffline }) {
  const [method, setMethod] = useState("cash");
  const [amt, setAmt] = useState((order.total / 100).toFixed(2));
  const [err, setErr] = useState("");

  const go = async () => {
    const amountPaisa = Math.round(parseFloat(amt) * 100);
    if (amountPaisa < order.total) {
      setErr("Amount is less than total bill");
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
      alert(r.change > 0 ? "Change due: " + tk(r.change) : "Payment successful");
      onDone();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 440, margin: "0 auto" }}>
      <h2>Payment — {order.slot || "Takeaway"}</h2>
      <div className="row"><span>Total Due</span><b>{tk(order.total)}</b></div>
      <p>
        <label>
          Amount tendered:
          <input
            style={{ width: "100%", marginTop: ".4rem" }}
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
            inputMode="decimal"
          />
        </label>
      </p>
      <div className="grid" style={{ marginBottom: "1rem" }}>
        {["cash", "card", "mfs", "delivery_app", "other"].map((m) => (
          <button
            key={m}
            type="button"
            className={m === method ? "primary" : ""}
            onClick={() => setMethod(m)}
          >
            {m.replace("_", " ")}
          </button>
        ))}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="row">
        <button onClick={onDone}>Cancel</button>
        <button className="primary" onClick={go}>Take Payment</button>
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
    if (!reason) return setErr("Please state a reason");
    if (!managerPin) return setErr("Manager PIN is required");
    try {
      await api("/orders/void-refund", token, {
        order_id: order.id,
        type,
        reason,
        manager_pin: managerPin
      });
      alert(`${type.toUpperCase()} recorded successfully`);
      onSuccess();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 460, margin: "1rem auto" }}>
      <h3>{type === "void" ? "Void Order" : "Refund Paid Order"} #{order.id}</h3>
      <p>Order Total: <b>{tk(order.total)}</b> | Status: <b>{order.status}</b></p>
      <p>
        <label>Type: </label>
        <select value={type} onChange={e => setType(e.target.value)}>
          {order.status !== "paid" && <option value="void">Void (Cancel Unpaid)</option>}
          {order.status === "paid" && <option value="refund">Refund (Return Cash/Funds)</option>}
        </select>
      </p>
      <p>
        <label>Reason for {type}:</label>
        <input style={{ width: "100%", marginTop: ".3rem" }} placeholder="e.g. Customer cancelled / Incorrect item" value={reason} onChange={e => setReason(e.target.value)} />
      </p>
      <p>
        <label>Manager / Owner Authorization PIN:</label>
        <input type="password" style={{ width: "100%", marginTop: ".3rem" }} placeholder="Enter 4-digit PIN (default: 1234 or 9999)" value={managerPin} onChange={e => setManagerPin(e.target.value)} />
      </p>
      {err && <p className="err">{err}</p>}
      <div className="row">
        <button onClick={onClose}>Back</button>
        <button className="warn" onClick={submit}>Authorize {type}</button>
      </div>
    </div>
  );
}

function OrderView({ channel, slot, token, cfg, onDone, onPay, isOffline }) {
  const [items, setItems] = useState([]);
  const [cart, setCart] = useState({});
  const [waiter, setWaiter] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api("/items", token).then(setItems).catch(() => {});
  }, [token]);

  const sub = items.reduce((s, i) => s + i.price * (cart[i.id] || 0), 0);
  const vat = Math.round((sub * cfg.vat) / 100);
  const svc = channel === "dine_in" ? Math.round((sub * cfg.service) / 100) : 0;
  const total = sub + vat + svc;

  const add = (id, d) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) + d) }));

  const submit = async (payNow) => {
    const lines = Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([item_id, qty]) => ({ item_id: +item_id, qty }));
    if (!lines.length) return setErr("Add at least one item");
    if (channel === "dine_in" && !waiter) return setErr("Enter the waiter name");

    const client_uuid = crypto.randomUUID();
    const payload = { client_uuid, channel, slot, waiter, lines };

    if (isOffline) {
      queueOutbox("create_order", payload, client_uuid);
      alert("Offline mode: Order queued in outbox and will auto-sync!");
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
        <h3>Select Menu Items</h3>
        <div className="grid">
          {items.map((i) => (
            <button key={i.id} className="tile" onClick={() => add(i.id, 1)}>
              <span>{i.name}</span>
              <small>{tk(i.price)} · <span style={{ color: "var(--teal)" }}>{i.station}</span></small>
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>{slot || "Order"}</h2>
        {channel === "dine_in" && (
          <p>
            <input
              placeholder="Waiter name"
              value={waiter}
              onChange={(e) => setWaiter(e.target.value)}
              style={{ width: "100%" }}
            />
          </p>
        )}
        {items
          .filter((i) => cart[i.id])
          .map((i) => (
            <div className="row" key={i.id} style={{ marginBottom: ".4rem" }}>
              <span>{i.name} × {cart[i.id]}</span>
              <div>
                <button onClick={() => add(i.id, -1)}>−</button>
                <button onClick={() => add(i.id, 1)}>+</button>
              </div>
            </div>
          ))}
        <div className="sum">
          <div className="row"><span>Subtotal</span><span>{tk(sub)}</span></div>
          <div className="row"><span>VAT {cfg.vat}%</span><span>{tk(vat)}</span></div>
          {svc > 0 && <div className="row"><span>Service {cfg.service}%</span><span>{tk(svc)}</span></div>}
          <div className="row"><b>Total</b><b>{tk(total)}</b></div>
        </div>
        {err && <p className="err">{err}</p>}
        <div className="row" style={{ marginTop: "1rem" }}>
          <button onClick={onDone}>Back</button>
          <button onClick={() => submit(false)}>Send to KOT</button>
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
  const [selectedIng, setSelectedIng] = useState("");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = async () => {
    try {
      const inv = await api("/inventory", token);
      setInventory(inv);
      if (inv.length > 0 && !selectedIng) setSelectedIng(inv[0].id);
      const bz = await api("/inventory/daily-bazar", token);
      setBazar(bz);
    } catch (e) {
      setMsg(e.message);
    }
  };

  useEffect(() => { refresh(); }, [token]);

  const recordBazar = async () => {
    if (!qty || !cost) return setMsg("Please fill in quantity and total cost");
    try {
      await api("/inventory/daily-bazar", token, {
        ingredient_id: parseInt(selectedIng),
        qty_purchased: parseInt(qty),
        total_cost: Math.round(parseFloat(cost) * 100)
      });
      setMsg("Daily Bazar purchase recorded!");
      setQty("");
      setCost("");
      refresh();
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="card">
      <div className="row">
        <h2>Inventory & Daily Bazar</h2>
        <button onClick={onBack}>Back to POS</button>
      </div>
      <div className="nav-tabs">
        <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>Stock & Auto-Deduct</button>
        <button className={tab === "bazar" ? "active" : ""} onClick={() => setTab("bazar")}>Daily Bazar Entry</button>
      </div>
      {msg && <p className="ok-msg" onClick={() => setMsg("")}>{msg}</p>}

      {tab === "inventory" && (
        <div>
          <p>Current Raw Ingredient Stock Levels (automatically deducted when orders are placed):</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Unit</th>
                <th>Current Stock</th>
                <th>Cost / Unit</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map(i => (
                <tr key={i.id}>
                  <td><b>{i.name}</b></td>
                  <td>{i.unit}</td>
                  <td>{i.current_stock} {i.unit}</td>
                  <td>{tk(i.cost_per_unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "bazar" && (
        <div>
          <h3>Record Daily Market Purchase (Bazar)</h3>
          <div className="card" style={{ maxWidth: 440, marginBottom: "1.5rem" }}>
            <p>
              <label>Select Ingredient:</label>
              <select style={{ width: "100%" }} value={selectedIng} onChange={e => setSelectedIng(e.target.value)}>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </select>
            </p>
            <p>
              <label>Quantity Purchased:</label>
              <input style={{ width: "100%" }} type="number" placeholder="e.g. 5000" value={qty} onChange={e => setQty(e.target.value)} />
            </p>
            <p>
              <label>Total Cost (৳):</label>
              <input style={{ width: "100%" }} type="number" placeholder="e.g. 500" value={cost} onChange={e => setCost(e.target.value)} />
            </p>
            <button className="primary" onClick={recordBazar}>Save Bazar Purchase</button>
          </div>

          <h3>Recent Bazar History</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Total Cost</th>
                <th>Recorded By</th>
              </tr>
            </thead>
            <tbody>
              {bazar.map(b => (
                <tr key={b.id}>
                  <td>{b.purchased_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{b.ingredient_name}</td>
                  <td>{b.qty_purchased} {b.unit}</td>
                  <td>{tk(b.total_cost)}</td>
                  <td>{b.purchased_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PrintAgentMonitor({ token, onBack }) {
  const [jobs, setJobs] = useState([]);
  const [station, setStation] = useState("");

  const fetchJobs = async () => {
    try {
      const data = await api(`/printers/jobs?status=pending${station ? "&station=" + station : ""}`, token);
      setJobs(data);
    } catch (e) {}
  };

  useEffect(() => {
    fetchJobs();
    const iv = setInterval(fetchJobs, 3000);
    return () => clearInterval(iv);
  }, [station, token]);

  const ack = async (id) => {
    await api(`/printers/jobs/${id}/ack`, token, {});
    fetchJobs();
  };

  return (
    <div className="card">
      <div className="row">
        <h2>KOT & Bill Print Agent Dispatcher</h2>
        <button onClick={onBack}>Back</button>
      </div>
      <p>Simulates the local print spooler/agent picking up station KOTs and customer bills.</p>
      <div className="row" style={{ justifyContent: "flex-start", gap: "1rem" }}>
        <label>Filter Station:</label>
        <select value={station} onChange={e => setStation(e.target.value)}>
          <option value="">All Stations</option>
          <option value="kitchen">Kitchen</option>
          <option value="bar">Bar</option>
          <option value="counter">Counter</option>
        </select>
        <button onClick={fetchJobs}>Refresh</button>
      </div>

      <div style={{ marginTop: "1rem" }}>
        {jobs.length === 0 ? <p>No pending print jobs in queue.</p> : (
          jobs.map(j => (
            <div key={j.id} className="card" style={{ marginBottom: "1rem", background: "#fbfcfb" }}>
              <div className="row">
                <b>Job #{j.id} · Station: {j.station.toUpperCase()} · Type: {j.type}</b>
                <button className="primary" onClick={() => ack(j.id)}>Simulate Print (Ack)</button>
              </div>
              <pre style={{ background: "#222", color: "#68d391", padding: "1rem", borderRadius: "6px", overflowX: "auto" }}>
                {j.payload}
              </pre>
            </div>
          ))
        )}
      </div>
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
          x: Math.max(10, Math.min(700, e.clientX - offset.x)),
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
      setMsg("Table layout saved successfully!");
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="card" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}>
      <div className="row">
        <h2>Interactive Draggable Table Floor Plan</h2>
        <div>
          <button onClick={addTable} style={{ marginRight: ".5rem" }}>+ Add Table</button>
          <button className="primary" onClick={save} style={{ marginRight: ".5rem" }}>Save Layout</button>
          <button onClick={onBack}>Back</button>
        </div>
      </div>
      <p style={{ color: "var(--gray)" }}>Click and drag any table to reposition it on the restaurant floor.</p>
      {msg && <p className="ok-msg">{msg}</p>}

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

function SuperAdminBillingView({ token, onBack }) {
  const [tenants, setTenants] = useState([]);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState("");

  const refresh = async () => {
    try {
      const data = await api("/super-admin/tenants", token);
      setTenants(data);
    } catch (e) {
      setMsg(e.message);
    }
  };

  useEffect(() => { refresh(); }, [token]);

  const createTenant = async () => {
    if (!newCode || !newName) return setMsg("Please enter tenant code and name");
    try {
      await api("/super-admin/tenants", token, {
        code: newCode,
        name: newName,
        admin_emp_id: "1001",
        admin_password: "admin" + newCode
      });
      setMsg("New tenant created successfully!");
      setNewCode("");
      setNewName("");
      refresh();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const toggleTenant = async (id) => {
    try {
      await api(`/super-admin/tenants/${id}/toggle-status`, token, {});
      refresh();
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="card">
      <div className="row">
        <h2>Super-Admin & Multi-Tenant Billing Hub</h2>
        <button onClick={onBack}>Back</button>
      </div>
      <p>Tenant isolation, status toggling, and multi-branch management.</p>
      {msg && <p className="ok-msg" onClick={() => setMsg("")}>{msg}</p>}

      <div className="card" style={{ maxWidth: 440, margin: "1rem 0" }}>
        <h3>Create New Tenant Branch</h3>
        <p><input style={{ width: "100%" }} placeholder="Unique code (e.g. gulshan_branch)" value={newCode} onChange={e => setNewCode(e.target.value)} /></p>
        <p><input style={{ width: "100%" }} placeholder="Branch / Restaurant name" value={newName} onChange={e => setNewName(e.target.value)} /></p>
        <button className="primary" onClick={createTenant}>Provision Tenant</button>
      </div>

      <h3>Provisioned Tenants</h3>
      <table className="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Code</th>
            <th>Name</th>
            <th>Total Orders</th>
            <th>Users</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map(t => (
            <tr key={t.id}>
              <td>{t.id}</td>
              <td><b>{t.code}</b></td>
              <td>{t.name}</td>
              <td>{t.order_count}</td>
              <td>{t.user_count}</td>
              <td><span className={t.active ? "ok-msg" : "err"}>{t.active ? "Active" : "Suspended"}</span></td>
              <td>
                <button onClick={() => toggleTenant(t.id)}>
                  {t.active ? "Suspend" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
      setMsg(`Synced ${res.synced} offline items to server!`);
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
      if (navigator.onLine && getOutbox().length > 0) {
        triggerSync();
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [token, view.name]);

  if (!me) return <Login onLogin={setMe} />;

  const home = () => setView({ name: "home" });

  const openShift = async () => {
    const label = prompt("Shift name", "Shift 1");
    if (!label) return;
    const c = parseFloat(prompt("Opening cash (৳)", "0") || "0");
    try {
      await api("/shifts/open", token, { label, opening_cash: Math.round(c * 100) });
      refresh();
    } catch (e) { setMsg(e.message); }
  };

  const closeShift = async () => {
    const c = parseFloat(prompt("Counted cash (৳)", "0") || "0");
    try {
      const r = await api("/shifts/close", token, { closing_cash: Math.round(c * 100) });
      setMsg(`Shift closed. Expected ${tk(r.expected_cash)}, counted ${tk(r.counted_cash)}, difference ${tk(r.difference)}`);
      refresh();
    } catch (e) { setMsg(e.message); }
  };

  const report = async () => {
    try {
      const r = await api("/reports/daily", token);
      setMsg(`Total: ${tk(r.total)} | Shifts: ${Object.entries(r.by_shift).map(([k, v]) => `${k}: ${tk(v)}`).join(", ")} | Cost: ${tk(r.total_cost)} (${r.food_cost_pct}%) | Voids/Refunds: ${tk(r.voids_refunds_total || 0)}`);
    } catch (e) { setMsg(e.message); }
  };

  const currentLayoutSlots = tablesLayout.length > 0 ? tablesLayout.map(t => t.id) : ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"];
  const slots = view.channel === "dine_in" ? currentLayoutSlots : ["1", "2", "3", "4", "5", "6"];

  return (
    <>
      <header>
        <div>
          <b>EasyPOS · {me.tenant}</b>
          <span style={{ marginLeft: "1rem" }} className={`status-badge ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "● Online" : "○ Offline"}
          </span>
          {outboxCount > 0 && (
            <button onClick={triggerSync} style={{ marginLeft: ".5rem", padding: ".2rem .5rem", fontSize: ".8rem" }}>
              Sync Outbox ({outboxCount})
            </button>
          )}
        </div>
        <span>{shift ? `${shift.label} (${tk(shift.opening_cash)})` : "No shift open"} · {me.name} ({me.role})</span>
        <div>
          {shift ? <button onClick={closeShift}>Close Shift</button> : <button onClick={openShift}>Open Shift</button>}{" "}
          <button onClick={() => setMe(null)}>Log Out</button>
        </div>
      </header>

      <main>
        {msg && <p className="card ok-msg" onClick={() => setMsg("")}>{msg}</p>}

        {voidRefundTarget && (
          <VoidRefundModal
            order={voidRefundTarget}
            token={token}
            onClose={() => setVoidRefundTarget(null)}
            onSuccess={() => { setVoidRefundTarget(null); refresh(); }}
          />
        )}

        {view.name === "home" && (
          <div>
            <div className="grid">
              {CHANNELS.map(([k, n]) => (
                <button className="tile" key={k} onClick={() => setView({ name: "layout", channel: k })}>
                  {n}
                </button>
              ))}
              <button className="tile" onClick={() => setView({ name: "inventory" })}>
                Inventory & Bazar
              </button>
              <button className="tile" onClick={() => setView({ name: "print_agent" })}>
                KOT / Print Spool
              </button>
              <button className="tile" onClick={() => setView({ name: "table_editor" })}>
                Table Floor Editor
              </button>
              {me.role === "owner" && (
                <button className="tile" onClick={() => setView({ name: "super_admin" })}>
                  Super Admin
                </button>
              )}
              <button className="tile" onClick={report}>
                Reports (Food Cost %)
              </button>
            </div>

            {open.length > 0 && (
              <div style={{ marginTop: "2rem" }}>
                <h3>Active Open Orders ({open.length})</h3>
                <div className="grid">
                  {open.map(o => (
                    <div key={o.id} className="card" style={{ padding: ".8rem" }}>
                      <b>#{o.id} - {o.slot}</b> ({o.channel})
                      <div>Total: {tk(o.total)}</div>
                      <div className="row" style={{ marginTop: ".5rem" }}>
                        <button onClick={() => setView({ name: "pay", order: o })}>Pay</button>
                        <button className="warn" onClick={() => setVoidRefundTarget(o)}>Void</button>
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
            <div className="row">
              <h3>{CHANNELS.find(c => c[0] === view.channel)?.[1] || view.channel} Layout</h3>
              <button onClick={home}>Back to Home</button>
            </div>
            <div className="grid" style={{ marginTop: "1rem" }}>
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
                    <span>{s}</span>
                    {o && <span>{tk(o.total)}</span>}
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
        {view.name === "print_agent" && <PrintAgentMonitor token={token} onBack={home} />}
        {view.name === "table_editor" && <TableLayoutEditor token={token} onBack={home} />}
        {view.name === "super_admin" && <SuperAdminBillingView token={token} onBack={home} />}
      </main>
    </>
  );
}
