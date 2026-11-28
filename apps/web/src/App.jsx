import { useState, useEffect } from "react";
import { getOutbox, queueOutbox, flushOutbox } from "./outbox";
import { PrintableBarcodeSheet, BarcodeSvg } from "./BarcodeSheet";
import { InventorySuite } from "./InventorySuite";
import { CameraScannerModal } from "./CameraScanner";
import {
  IconCrown, IconLocation, IconSync, IconBarcode, IconInventory,
  IconFloorPlan, IconReports, IconDineIn, IconTakeaway, IconDelivery,
  IconSearch, IconPrinter, IconCheck, IconAlert, IconClose, IconPlus,
  IconEdit, IconLock, IconUser, IconBuilding, IconDownload, IconBell,
  IconArrowRight, IconArrowLeft, IconLogOut, IconShield, IconCutlery, IconCamera
} from "./Icons";

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
  if (!r.ok) throw new Error(d.detail || `Request failed (${r.status})`);
  return d;
};

const tk = (p) => (p != null ? "৳" + (p / 100).toFixed(2) : "Needs Price");

export function CrownLogo({ size = 34, style = {} }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}
    >
      {/* Main Body: Dark Navy Blue (#1C274C) */}
      <path
        d="M15 54C12.7909 54 11 52.2091 11 50V44C11 41.7909 12.7909 40 15 40H15.4L13.1 25.1C12.7 22.4 15.3 20.3 17.8 21.6L25.3 25.5C26.2 26 27.3 25.7 27.9 24.8L30.8 20.3C31.4 19.4 32.6 19.4 33.2 20.3L36.1 24.8C36.7 25.7 37.8 26 38.7 25.5L46.2 21.6C48.7 20.3 51.3 22.4 50.9 25.1L48.6 40H49C51.2091 40 53 41.7909 53 44V50C53 52.2091 51.2091 54 49 54H15Z"
        fill="#1C274C"
      />
      {/* Secondary / Accent Shapes: Muted Light Grey (#8D93A5) */}
      <circle cx="16" cy="15" r="3.5" fill="#8D93A5" />
      <circle cx="32" cy="12" r="4.5" fill="#8D93A5" />
      <circle cx="48" cy="15" r="3.5" fill="#8D93A5" />
      <rect x="21" y="30" width="22" height="9" rx="3" fill="#8D93A5" />
      <rect x="18" y="46" width="28" height="3.5" rx="1.75" fill="#8D93A5" />
    </svg>
  );
}

const CHANNELS = [
  ["dine_in", "Dine In"],
  ["takeaway", "Takeaway"],
  ["foodpanda", "Foodpanda"],
  ["foodi", "Foodi"],
  ["pathao", "Pathao"]
];

function Login({ onLogin, onInstall, canInstall }) {
  const [f, setF] = useState({ tenant: "", emp_id: "", password: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const go = async () => {
    if (!f.emp_id.trim() || !f.password) {
      setErr("Please enter your employee ID and security PIN/password.");
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const payload = {
        tenant: f.tenant.trim() || "crown",
        emp_id: f.emp_id.trim(),
        password: f.password
      };
      const res = await api("/auth/login", null, payload);
      onLogin(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-viewport">
      <div className="auth-header-pill">
        <span className="live-dot" style={{ background: "#10b981" }}></span>
        <span>Enterprise Cloud Terminal Node</span>
      </div>

      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo-aura">
            <CrownLogo size={46} />
          </div>
          <h1 className="auth-title">crownpointofsale</h1>
          <p className="auth-subtitle">
            Enterprise Point of Sale & Terminal Console
          </p>
        </div>

        {/* Credentials Form */}
        <div className="auth-form-field">
          <label className="auth-form-label">
            <span>Business Slug</span>
            <span style={{ color: "#94a3b8", fontWeight: 500 }}>Workspace</span>
          </label>
          <div className="auth-input-wrapper">
            <span className="auth-input-icon">
              <IconBuilding size={16} color="#94a3b8" />
            </span>
            <input
              className="auth-input"
              placeholder="crown"
              value={f.tenant}
              onChange={set("tenant")}
              autoComplete="organization"
            />
          </div>
        </div>

        <div className="auth-form-field">
          <label className="auth-form-label">
            <span>Staff Employee ID</span>
            <span style={{ color: "#94a3b8", fontWeight: 500 }}>ID Number</span>
          </label>
          <div className="auth-input-wrapper">
            <span className="auth-input-icon">
              <IconUser size={16} color="#94a3b8" />
            </span>
            <input
              className="auth-input"
              placeholder="Enter Employee ID"
              value={f.emp_id}
              onChange={set("emp_id")}
              autoFocus
              autoComplete="username"
            />
          </div>
        </div>

        <div className="auth-form-field">
          <label className="auth-form-label">
            <span>Security PIN / Password</span>
            <span style={{ color: "#94a3b8", fontWeight: 500 }}>Required</span>
          </label>
          <div className="auth-input-wrapper">
            <span className="auth-input-icon">
              <IconLock size={16} color="#94a3b8" />
            </span>
            <input
              type="password"
              className="auth-input"
              placeholder="Enter PIN or Password"
              value={f.password}
              onChange={set("password")}
              onKeyDown={(e) => e.key === "Enter" && go()}
              autoComplete="current-password"
            />
          </div>
        </div>

        {err && (
          <div style={{
            background: "var(--rose-light)",
            border: "1px solid var(--rose-border)",
            color: "var(--rose)",
            padding: "0.65rem 0.85rem",
            borderRadius: "10px",
            fontSize: "0.85rem",
            fontWeight: 700,
            marginBottom: "0.75rem",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem"
          }}>
            <IconAlert size={16} color="var(--rose)" />
            <span>{err}</span>
          </div>
        )}

        <button
          className="auth-submit-btn"
          onClick={go}
          disabled={loading}
        >
          <span>{loading ? "Authenticating..." : "Sign In to Terminal"}</span>
          <IconArrowRight size={18} />
        </button>

        {canInstall && (
          <button
            type="button"
            onClick={onInstall}
            style={{
              width: "100%",
              marginTop: "0.85rem",
              padding: "0.65rem 1rem",
              borderRadius: "12px",
              border: "1.5px dashed #4f46e5",
              background: "#eef2ff",
              color: "#4338ca",
              fontWeight: 700,
              fontSize: "0.84rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              cursor: "pointer"
            }}
          >
            <IconDownload size={16} />
            <span>Install Crown POS Desktop / Tablet App</span>
          </button>
        )}

        <div className="auth-footer">
          <IconShield size={14} color="#94a3b8" />
          <span>256-Bit Financial Encryption</span>
          <span>·</span>
          <span>Offline Terminal Node Ready</span>
        </div>
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
        <button className="secondary" onClick={printBill} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          <IconPrinter size={15} />
          <span>Print Bill First</span>
        </button>
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
        <button className="btn-back" onClick={onDone}>
          <IconArrowLeft size={15} />
          <span>Back</span>
        </button>
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
        <button className="btn-back" onClick={onClose}>
          <IconArrowLeft size={15} />
          <span>Cancel</span>
        </button>
        <button className="warn" onClick={submit}>Authorize {type.toUpperCase()}</button>
      </div>
    </div>
  );
}

function OrderView({ channel, slot, token, cfg, onDone, onPay, isOffline }) {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState({});
  const [waiter, setWaiter] = useState("");
  const [err, setErr] = useState("");
  const [showOrderCamera, setShowOrderCamera] = useState(false);

  useEffect(() => {
    api("/items", token).then(setItems).catch(() => {});
  }, [token]);

  const categories = ["All", ...new Set(items.map(i => i.category || "General"))];
  const filteredItems = items.filter(i => {
    const matchesCat = category === "All" || (i.category || "General") === category;
    const matchesSearch = !search.trim() || 
      i.name.toLowerCase().includes(search.toLowerCase()) || 
      (i.barcode && i.barcode.toLowerCase().includes(search.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const cartTotalItems = Object.values(cart).reduce((a, b) => a + b, 0);
  const sub = items.reduce((s, i) => s + (i.price || 0) * (cart[i.id] || 0), 0);
  const vat = Math.round((sub * cfg.vat) / 100);
  const svc = channel === "dine_in" ? Math.round((sub * cfg.service) / 100) : 0;
  const total = sub + vat + svc;

  const add = (id, d) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] || 0) + d) }));
  const clearCart = () => setCart({});

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
        {/* Search Bar & Categories */}
        <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
            <input
              placeholder="Search dishes (e.g. Tori, Sushi, Croissant, Wings...)"
              style={{ width: "100%", paddingLeft: "1.2rem", borderRadius: "999px", background: "#ffffff" }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", minHeight: "26px", padding: "0 8px", border: "none", background: "transparent", color: "var(--ink-muted)", cursor: "pointer", display: "flex", alignItems: "center" }}
              >
                <IconClose size={14} />
              </button>
            )}
          </div>
          <button
            className="secondary"
            onClick={() => setShowOrderCamera(true)}
            style={{ borderRadius: "999px", padding: "0.45rem 1rem", minHeight: "40px", display: "inline-flex", alignItems: "center", gap: "0.45rem" }}
            title="Scan menu barcode with camera"
          >
            <IconCamera size={16} />
            <span>Camera Scan</span>
          </button>
          <div style={{ fontSize: "0.85rem", color: "var(--ink-muted)", fontWeight: 600 }}>
            Showing <b>{filteredItems.length}</b> of {items.length} items
          </div>
        </div>

        {showOrderCamera && (
          <CameraScannerModal
            title="Scan Menu Item Barcode"
            subtitle="Point camera at a MENU barcode to add directly to the order cart"
            continuous={true}
            onScan={(code) => {
              const clean = code.trim().toUpperCase();
              const matched = items.find((it) => it.barcode && it.barcode.toUpperCase() === clean);
              if (matched) {
                add(matched);
                setErr("");
              } else {
                setErr(`No menu item found for barcode: ${clean}`);
              }
            }}
            onClose={() => setShowOrderCamera(false)}
          />
        )}

        {/* Category Pills */}
        <div className="nav-tabs" style={{ marginBottom: "1.2rem" }}>
          {categories.map(c => {
            const count = c === "All" ? items.length : items.filter(i => (i.category || "General") === c).length;
            return (
              <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>
                {c} <span style={{ opacity: 0.65, fontSize: "0.78rem" }}>({count})</span>
              </button>
            );
          })}
        </div>

        {/* Menu Items Grid */}
        <div className="grid">
          {filteredItems.map((i) => {
            const inCartQty = cart[i.id] || 0;
            return (
              <button
                key={i.id}
                className="tile"
                onClick={() => add(i.id, 1)}
                style={{
                  border: inCartQty > 0 ? "2px solid var(--brand-primary)" : "1.5px solid var(--line)",
                  background: inCartQty > 0 ? "var(--brand-light)" : "#ffffff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
                  <span style={{ fontSize: "0.95rem", fontWeight: 700, lineHeight: 1.3 }}>{i.name}</span>
                  {inCartQty > 0 && (
                    <span style={{
                      background: "var(--brand-primary)",
                      color: "#fff",
                      fontSize: "0.78rem",
                      fontWeight: 800,
                      borderRadius: "999px",
                      padding: "2px 8px",
                      boxShadow: "0 2px 6px rgba(79, 70, 229, 0.4)",
                      animation: "popIn 0.2s ease-out"
                    }}>
                      +{inCartQty}
                    </span>
                  )}
                </div>

                <div style={{ width: "100%", marginTop: "0.6rem" }}>
                  {i.barcode && (
                    <div style={{ marginBottom: "0.4rem", textAlign: "left" }}>
                      <span style={{
                        background: "rgba(79, 70, 229, 0.08)",
                        color: "var(--brand-primary)",
                        fontFamily: "monospace",
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: "4px"
                      }}>
                        {i.barcode}
                      </span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{
                      background: "#f1f5f9",
                      color: "var(--ink-muted)",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      textTransform: "uppercase"
                    }}>
                      {i.station || "kitchen"}
                    </span>
                    <b style={{ color: "var(--brand-primary)", fontSize: "1.1rem" }}>{tk(i.price)}</b>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cart Sidebar */}
      <div className="card" style={{ display: "flex", flexDirection: "column", height: "fit-content", position: "sticky", top: "80px" }}>
        <div className="row" style={{ borderBottom: "1.5px solid var(--line)", paddingBottom: "0.75rem", marginBottom: "0.8rem" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.3rem", color: "var(--brand-primary)" }}>{slot || "Order Ticket"}</h2>
            <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
              Channel: <b>{channel === "dine_in" ? "Dine In" : channel}</b> · {cartTotalItems} items
            </div>
          </div>
          {cartTotalItems > 0 && (
            <button
              onClick={clearCart}
              style={{ minHeight: "28px", padding: "0.2rem 0.6rem", fontSize: "0.75rem", color: "var(--rose)", borderColor: "var(--rose-border)" }}
            >
              Clear Cart
            </button>
          )}
        </div>

        {channel === "dine_in" && (
          <p style={{ margin: "0 0 0.8rem 0" }}>
            <input
              placeholder="Waiter / Server Name *"
              value={waiter}
              onChange={(e) => setWaiter(e.target.value)}
              style={{ width: "100%", padding: "0.6rem 0.9rem", fontWeight: 500 }}
            />
          </p>
        )}

        <div style={{ maxHeight: "320px", overflowY: "auto", paddingRight: "4px" }}>
          {cartTotalItems === 0 ? (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--ink-muted)" }}>
              <div style={{ marginBottom: "0.6rem", display: "flex", justifyContent: "center" }}>
                <IconCutlery size={36} color="#94a3b8" />
              </div>
              <b>Your ticket is empty</b>
              <p style={{ margin: "4px 0 0", fontSize: "0.82rem" }}>Tap any dish on the left to add it to the ticket</p>
            </div>
          ) : (
            items
              .filter((i) => cart[i.id])
              .map((i) => (
                <div className="row" key={i.id} style={{ marginBottom: "0.6rem", borderBottom: "1px solid var(--line)", paddingBottom: "0.5rem" }}>
                  <div style={{ flex: 1, paddingRight: "0.5rem" }}>
                    <b style={{ fontSize: "0.92rem" }}>{i.name}</b>
                    <div style={{ fontSize: "0.8rem", color: "var(--ink-muted)" }}>
                      {tk(i.price)} × {cart[i.id]} = <b>{tk((i.price || 0) * cart[i.id])}</b>
                    </div>
                  </div>
                  <div className="row" style={{ gap: "0.35rem" }}>
                    <button style={{ minHeight: "32px", width: "32px", padding: 0, borderRadius: "50%", fontWeight: 800 }} onClick={() => add(i.id, -1)}>−</button>
                    <span style={{ fontWeight: 800, minWidth: "24px", textAlign: "center", fontSize: "0.95rem" }}>{cart[i.id]}</span>
                    <button style={{ minHeight: "32px", width: "32px", padding: 0, borderRadius: "50%", fontWeight: 800 }} onClick={() => add(i.id, 1)}>+</button>
                  </div>
                </div>
              ))
          )}
        </div>

        <div className="sum">
          <div className="row" style={{ marginBottom: "0.35rem", color: "var(--ink-muted)" }}>
            <span>Subtotal</span>
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>{tk(sub)}</span>
          </div>
          <div className="row" style={{ marginBottom: "0.35rem", color: "var(--ink-muted)" }}>
            <span>Mushak VAT ({cfg.vat}%)</span>
            <span style={{ fontWeight: 600, color: "var(--ink)" }}>{tk(vat)}</span>
          </div>
          {svc > 0 && (
            <div className="row" style={{ marginBottom: "0.35rem", color: "var(--ink-muted)" }}>
              <span>Service Charge ({cfg.service}%)</span>
              <span style={{ fontWeight: 600, color: "var(--ink)" }}>{tk(svc)}</span>
            </div>
          )}
          <div className="row" style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--brand-primary)", marginTop: "0.75rem", borderTop: "1.5px solid var(--line)", paddingTop: "0.6rem" }}>
            <span>Grand Total</span>
            <span>{tk(total)}</span>
          </div>
        </div>

        {err && (
          <p style={{ color: "var(--rose)", fontWeight: 700, margin: "0.6rem 0", fontSize: "0.88rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <IconAlert size={16} color="var(--rose)" />
            <span>{err}</span>
          </p>
        )}

        <div className="row" style={{ marginTop: "1.25rem", gap: "0.6rem" }}>
          <button className="btn-back" onClick={onDone} style={{ flex: 0.9, justifyContent: "center" }}>
            <IconArrowLeft size={15} />
            <span>Back</span>
          </button>
          <button className="secondary" onClick={() => submit(false)} style={{ flex: 1.2, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
            <IconPrinter size={15} />
            <span>Send KOT</span>
          </button>
          <button className="primary" onClick={() => submit(true)} style={{ flex: 1.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
            <IconCheck size={16} />
            <span>Pay Now</span>
          </button>
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
  const [barcodeScan, setBarcodeScan] = useState("");
  const [showLegacyCamera, setShowLegacyCamera] = useState(false);
  const [scannedCart, setScannedCart] = useState([]);
  const [tripName, setTripName] = useState("Morning Bazar Trip");
  const [shopperName, setShopperName] = useState("Staff");
  const [showBarcodeSheet, setShowBarcodeSheet] = useState(false);
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

  const handleBarcodeScan = (codeRaw) => {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return;

    if (code.startsWith("QTY-")) {
      if (scannedCart.length === 0) return setMsg("Scan ingredient first!");
      const last = scannedCart[scannedCart.length - 1];
      let newCount = last.pack_count;
      if (code === "QTY-X1") newCount = 1;
      else if (code === "QTY-X5") newCount = 5;
      else if (code === "QTY-X10") newCount = 10;
      else if (code === "QTY-X50") newCount = 50;
      else if (code === "QTY-PLUS1KG") newCount += (1000 / (last.ing.pack_size || 1000));
      else if (code === "QTY-PLUS5KG") newCount += (5000 / (last.ing.pack_size || 1000));

      const updated = [...scannedCart];
      updated[scannedCart.length - 1] = {
        ...last,
        pack_count: newCount,
        total_cost: Math.round(newCount * last.unit_cost)
      };
      setScannedCart(updated);
      setBarcodeScan("");
      return;
    }

    const matched = inventory.find(i => (i.barcode && i.barcode.toUpperCase() === code) || i.id.toString() === code);
    if (matched) {
      const existing = scannedCart.findIndex(c => c.ing.id === matched.id);
      if (existing >= 0) {
        const updated = [...scannedCart];
        updated[existing].pack_count += 1;
        updated[existing].total_cost = Math.round(updated[existing].pack_count * updated[existing].unit_cost);
        setScannedCart(updated);
      } else {
        const estCost = Math.round((matched.cost_per_unit || 10) * (matched.pack_size || 1000));
        setScannedCart(prev => [...prev, { ing: matched, pack_count: 1, unit_cost: estCost, total_cost: estCost }]);
      }
      setMsg(`Scanned into production bazar: ${matched.name}`);
    } else {
      setMsg(`No ingredient matching barcode ${code}`);
    }
    setBarcodeScan("");
  };

  const approveProductionTrip = async () => {
    if (scannedCart.length === 0) return setMsg("Scanned trip is empty!");
    const payload = {
      trip_name: tripName,
      shopper_name: shopperName,
      lines: scannedCart.map(c => ({
        ingredient_id: c.ing.id,
        pack_count: c.pack_count,
        unit_cost: c.unit_cost,
        total_cost: c.total_cost
      }))
    };

    try {
      await api("/inventory/bazar-trips", token, payload);
      alert("Production Daily Bazar Trip approved and atomic stock incremented!");
      setScannedCart([]);
      refresh();
    } catch (e) {
      setMsg(e.message);
    }
  };

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

  if (showBarcodeSheet) {
    return <PrintableBarcodeSheet items={inventory} onBack={() => setShowBarcodeSheet(false)} />;
  }

  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0, color: "var(--blue-primary)" }}>Inventory & Stock Management</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="secondary" onClick={() => setShowBarcodeSheet(true)} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            <IconPrinter size={15} />
            <span>Print Ingredient Barcodes</span>
          </button>
          <button onClick={onBack}>Back to POS</button>
        </div>
      </div>

      <div className="nav-tabs" style={{ marginTop: "1rem" }}>
        <button className={tab === "scanner" ? "active" : ""} onClick={() => setTab("scanner")} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          <IconCamera size={15} />
          <span>Production Barcode Scanner</span>
        </button>
        <button className={tab === "inventory" ? "active" : ""} onClick={() => setTab("inventory")}>Stock Levels</button>
        <button className={tab === "bazar" ? "active" : ""} onClick={() => setTab("bazar")}>Manual Bazar Entry</button>
        <button className={tab === "wastage" ? "active" : ""} onClick={() => setTab("wastage")}>Wastage / Adjustment</button>
        <button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}>Stock Movement Ledger</button>
      </div>

      {msg && <p style={{ color: "var(--blue-primary)", background: "var(--blue-light)", padding: "0.5rem", borderRadius: "6px", fontWeight: 600 }}>{msg}</p>}

      {tab === "scanner" && (
        <div className="split-right">
          <div>
            <div className="card" style={{ marginBottom: "1rem", border: "2px solid var(--blue-primary)" }}>
              <h3>Production Barcode Scanner Receiver</h3>
              <p style={{ color: "var(--gray)", fontSize: "0.85rem", margin: "0 0 0.5rem 0" }}>
                Auto-focus active. Trigger your handheld barcode gun on ingredient packages or use modifier codes.
              </p>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <input
                  placeholder="Scan barcode or type ING-MILK-1L / QTY-X5"
                  style={{ flex: "1 1 200px", fontSize: "1.05rem", padding: "0.65rem", border: "2px solid var(--blue-primary)", borderRadius: "6px" }}
                  value={barcodeScan}
                  onChange={e => setBarcodeScan(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleBarcodeScan(barcodeScan)}
                />
                <button className="secondary" onClick={() => setShowLegacyCamera(true)} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                  <IconCamera size={16} />
                  <span>Camera</span>
                </button>
                <button className="primary" onClick={() => handleBarcodeScan(barcodeScan)}>Enter</button>
              </div>
              {showLegacyCamera && (
                <CameraScannerModal
                  title="Camera Barcode Scanner"
                  subtitle="Scan ingredient or modifier barcodes directly into the trip cart"
                  continuous={true}
                  onScan={(code) => handleBarcodeScan(code)}
                  onClose={() => setShowLegacyCamera(false)}
                />
              )}

              <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--gray)" }}>Quick Modifiers:</span>
                {["QTY-X1", "QTY-X5", "QTY-X10", "QTY-X50", "QTY-PLUS1KG", "QTY-PLUS5KG"].map(q => (
                  <button key={q} className="secondary" style={{ padding: "0.1rem 0.5rem", minHeight: "26px", fontSize: "0.75rem" }} onClick={() => handleBarcodeScan(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="row">
                <h4>Scanned Production Items ({scannedCart.length})</h4>
                {scannedCart.length > 0 && <button className="warn" style={{ minHeight: "28px", padding: "0.1rem 0.5rem" }} onClick={() => setScannedCart([])}>Clear</button>}
              </div>
              {scannedCart.length === 0 ? <p style={{ color: "var(--gray)" }}>Scan barcodes to build morning check-in trip.</p> : (
                <table className="data-table">
                  <thead>
                    <tr><th>Ingredient</th><th>Pack Size</th><th>Packs</th><th>Cost Paid</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {scannedCart.map((c, idx) => (
                      <tr key={idx}>
                        <td><b>{c.ing.name}</b> <br /><small style={{ color: "var(--gray)" }}>{c.ing.barcode}</small></td>
                        <td>{c.ing.pack_unit || "pack"}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            <button style={{ minHeight: "24px", padding: "0.1rem 0.4rem" }} onClick={() => {
                              const u = [...scannedCart]; u[idx].pack_count = Math.max(1, u[idx].pack_count - 1);
                              u[idx].total_cost = Math.round(u[idx].pack_count * u[idx].unit_cost); setScannedCart(u);
                            }}>−</button>
                            <b>{c.pack_count}</b>
                            <button style={{ minHeight: "24px", padding: "0.1rem 0.4rem" }} onClick={() => {
                              const u = [...scannedCart]; u[idx].pack_count += 1;
                              u[idx].total_cost = Math.round(u[idx].pack_count * u[idx].unit_cost); setScannedCart(u);
                            }}>+</button>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            style={{ width: "80px", padding: "0.2rem" }}
                            value={(c.total_cost / 100).toFixed(0)}
                            onChange={e => {
                              const val = Math.round(parseFloat(e.target.value || "0") * 100);
                              const u = [...scannedCart]; u[idx].total_cost = val;
                              u[idx].unit_cost = Math.round(val / (c.pack_count || 1)); setScannedCart(u);
                            }}
                          />
                        </td>
                        <td><button className="warn" style={{ minHeight: "24px", padding: "0.1rem 0.4rem", display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => setScannedCart(scannedCart.filter((_, i) => i !== idx))}><IconClose size={13} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <h3>Approve Production Trip</h3>
            <p><label style={{ fontSize: "0.85rem" }}>Trip Label</label>
              <input style={{ width: "100%" }} value={tripName} onChange={e => setTripName(e.target.value)} />
            </p>
            <p><label style={{ fontSize: "0.85rem" }}>Shopper / Staff</label>
              <input style={{ width: "100%" }} value={shopperName} onChange={e => setShopperName(e.target.value)} />
            </p>
            <div className="sum">
              <div className="row"><span>Total Payable</span><b>{tk(scannedCart.reduce((s, c) => s + c.total_cost, 0))}</b></div>
            </div>
            <button className="primary" style={{ width: "100%", marginTop: "1rem", minHeight: "44px" }} onClick={approveProductionTrip}>
              Approve & Receive Stock
            </button>
          </div>
        </div>
      )}

      {tab === "inventory" && (
        <table className="data-table">
          <thead>
            <tr><th>Barcode</th><th>Ingredient</th><th>Unit</th><th>Current Stock</th><th>Cost/Unit</th></tr>
          </thead>
          <tbody>
            {inventory.map(i => (
              <tr key={i.id}>
                <td><code>{i.barcode || "N/A"}</code></td>
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
                {inventory.map(i => <option key={i.id} value={i.id}>{i.name}{(i.unit === 'g' || i.unit === 'gm') && !i.name.toLowerCase().includes('gm') ? ' 100gm' : (i.unit === 'ml' && !i.name.toLowerCase().includes('ml') ? ' 100ml' : '')} ({i.unit})</option>)}
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
                {inventory.map(i => <option key={i.id} value={i.id}>{i.name}{(i.unit === 'g' || i.unit === 'gm') && !i.name.toLowerCase().includes('gm') ? ' 100gm' : (i.unit === 'ml' && !i.name.toLowerCase().includes('ml') ? ' 100ml' : '')} ({i.unit})</option>)}
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
                <td><b>{m.ingredient_name}{!m.ingredient_name?.toLowerCase().includes('gm') && (m.unit === 'g' || m.unit === 'gm') ? ' 100gm' : ''}</b></td>
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
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <button className="btn-back" onClick={onBack}>
            <IconArrowLeft size={15} />
            <span>Dashboard</span>
          </button>
          <h2 style={{ margin: 0, color: "var(--blue-primary)" }}>Interactive Table Floor Plan</h2>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="secondary" onClick={addTable}>+ Add Table</button>
          <button className="primary" onClick={save}>Save Layout</button>
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

function BarcodeCatalogView({ token, onBack }) {
  const [tab, setTab] = useState("all");
  const [subCat, setSubCat] = useState("All");
  const [search, setSearch] = useState("");
  const [dishes, setDishes] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBarcode, setSelectedBarcode] = useState(null);

  useEffect(() => {
    Promise.all([
      api("/items", token).catch(() => []),
      api("/inventory", token).catch(() => [])
    ]).then(([d, ing]) => {
      setDishes(d);
      setIngredients(ing);
      setLoading(false);
    });
  }, [token]);

  const allItems = [
    ...dishes.map(d => ({ ...d, itemType: "dish", typeLabel: "Menu Dish" })),
    ...ingredients.map(i => ({ ...i, itemType: "ingredient", typeLabel: "Bazar Ingredient" }))
  ];

  const filtered = allItems.filter(item => {
    if (tab === "dishes" && item.itemType !== "dish") return false;
    if (tab === "ingredients" && item.itemType !== "ingredient") return false;
    if (subCat !== "All") {
      const cat = item.category || "General";
      if (cat !== subCat) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchBarcode = item.barcode && item.barcode.toLowerCase().includes(q);
      return matchName || matchBarcode;
    }
    return true;
  });

  const dishesCategories = ["All", ...new Set(dishes.map(d => d.category || "General"))];
  const activeCategories = tab === "dishes" ? dishesCategories : [];

  return (
    <div className="card" style={{ maxWidth: "1280px", margin: "0 auto", padding: "1.5rem" }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1.2rem", borderBottom: "1.5px solid var(--line)", paddingBottom: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button className="btn-back" onClick={onBack}>
              <IconArrowLeft size={15} />
              <span>Dashboard</span>
            </button>
            <h2 style={{ margin: 0, color: "var(--brand-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <CrownLogo size={28} /> crownpointofsale Barcode Catalog
            </h2>
          </div>
          <p style={{ margin: "6px 0 0", color: "var(--ink-muted)", fontSize: "0.9rem" }}>
            Total <b>{dishes.length} Menu Dishes</b> (<code>MENU-</code>) and <b>{ingredients.length} Bazar Ingredients</b> (<code>ING-</code>). Scannable with any standard USB barcode scanner.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="primary" onClick={() => window.print()} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            <IconPrinter size={16} />
            <span>Print Barcode Sheet</span>
          </button>
        </div>
      </div>

      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div className="nav-tabs" style={{ margin: 0 }}>
          <button className={tab === "all" ? "active" : ""} onClick={() => { setTab("all"); setSubCat("All"); }}>
            All Barcodes ({allItems.length})
          </button>
          <button className={tab === "dishes" ? "active" : ""} onClick={() => { setTab("dishes"); setSubCat("All"); }}>
            Menu Dishes ({dishes.length})
          </button>
          <button className={tab === "ingredients" ? "active" : ""} onClick={() => { setTab("ingredients"); setSubCat("All"); }}>
            Bazar Ingredients ({ingredients.length})
          </button>
        </div>
        <div style={{ flex: "1 1 220px", maxWidth: "280px" }}>
          <input
            type="text"
            placeholder="Search name, MENU-, ING-..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", fontSize: "0.9rem" }}
          />
        </div>
      </div>

      {activeCategories.length > 1 && (
        <div className="no-print nav-tabs" style={{ marginBottom: "1rem" }}>
          {activeCategories.map(c => (
            <button key={c} className={subCat === c ? "active" : ""} onClick={() => setSubCat(c)} style={{ fontSize: "0.8rem", padding: "4px 10px" }}>
              {c}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p>Loading barcodes...</p>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {filtered.map(item => {
            const isDish = item.itemType === "dish";
            return (
              <div
                key={item.barcode || item.id}
                className="card"
                style={{
                  padding: "1rem",
                  border: selectedBarcode === item.barcode ? "2px solid var(--brand-primary)" : isDish ? "1.5px solid #c7d2fe" : "1.5px solid #e2e8f0",
                  background: selectedBarcode === item.barcode ? "var(--brand-light)" : "#fff",
                  borderRadius: "12px",
                  textAlign: "center",
                  cursor: "pointer",
                  pageBreakInside: "avoid"
                }}
                onClick={() => setSelectedBarcode(selectedBarcode === item.barcode ? null : item.barcode)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                  <span style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: isDish ? "rgba(79, 70, 229, 0.1)" : "rgba(16, 185, 129, 0.1)",
                    color: isDish ? "var(--brand-primary)" : "#065f46"
                  }}>
                    {isDish ? "MENU DISH" : "BAZAR INGREDIENT"}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "var(--ink-muted)", fontWeight: 600 }}>
                    {item.category || item.unit || ""}
                  </span>
                </div>

                <div style={{ fontSize: "1rem", fontWeight: 800, margin: "0.2rem 0 0.5rem", color: "var(--ink)", minHeight: "42px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {item.name}{!isDish ? ((item.unit === 'g' || item.base_unit === 'g' || item.unit === 'gm') && !item.name.toLowerCase().includes('gm') ? ' 100gm' : ((item.unit === 'ml' || item.base_unit === 'ml') && !item.name.toLowerCase().includes('ml') ? ' 100ml' : '')) : ''}
                </div>

                {item.barcode && (
                  <div style={{ background: "#ffffff", padding: "6px", borderRadius: "8px", border: "1px solid #f1f5f9", margin: "0.4rem 0" }}>
                    <BarcodeSvg value={item.barcode} width={1.8} height={52} />
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem", fontSize: "0.82rem" }}>
                  <code style={{ fontSize: "0.78rem", fontWeight: 700, color: isDish ? "var(--brand-primary)" : "#0f766e" }}>
                    {item.barcode}
                  </code>
                  <b style={{ color: "var(--ink)" }}>
                    {isDish ? (item.price ? tk(item.price) : "Needs Price") : (item.cost_per_unit ? `৳${(item.cost_per_unit / 100).toFixed(2)}/${item.unit}` : item.pack_unit || item.unit)}
                  </b>
                </div>
              </div>
            );
          })}
        </div>
      )}
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
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const token = me?.token;

  useEffect(() => {
    if (!showLogoutConfirm) return;
    const onKey = (e) => { if (e.key === "Escape") setShowLogoutConfirm(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLogoutConfirm]);

  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const installPwa = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

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

  const handleLogin = (user) => {
    setMe(user);
    if (user.role === "manager") {
      setView({ name: "inventory" });
    } else {
      setView({ name: "home" });
    }
  };

  if (!me) return <Login onLogin={handleLogin} onInstall={installPwa} canInstall={!!installPrompt} />;

  const home = () => setView(me?.role === "manager" ? { name: "inventory" } : { name: "home" });

  const canGoBack = view.name !== "home" && !(me?.role === "manager" && view.name === "inventory");

  const goBack = () => {
    if (view.name === "order" && view.channel) {
      setView({ name: "layout", channel: view.channel });
    } else if (view.name === "pay" && view.order?.channel) {
      setView({ name: "layout", channel: view.order.channel });
    } else {
      home();
    }
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    setMe(null);
    setView({ name: "home" });
    setShift(null);
    setOpen([]);
    setMsg("");
  };

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
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
          {canGoBack && (
            <button className="btn-back" onClick={goBack} title="Go back to previous screen">
              <IconArrowLeft size={16} />
              <span>Back</span>
            </button>
          )}
          <div className="brand-badge" onClick={home} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "0.65rem" }} title="Return to Dashboard">
            <CrownLogo size={36} />
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
              <span style={{ fontSize: "1.25rem", fontWeight: 900, letterSpacing: "-0.035em", background: "linear-gradient(135deg, #1e1b4b 0%, #4338ca 55%, #d97706 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                crownpointofsale
              </span>
              <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", marginTop: "2px" }}>
                Cloud POS
              </span>
            </div>
          </div>
          <span style={{ fontSize: "0.82rem", color: "var(--ink-muted)", fontWeight: 600, background: "var(--paper-subtle)", padding: "3px 10px", borderRadius: "999px", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <IconLocation size={14} color="#64748b" />
            <span>{me.branch || "Uttara"}</span>
          </span>
          <span className={`status-badge ${isOnline ? "online" : "offline"}`}>
            <span className="live-dot" style={{ background: isOnline ? "var(--emerald)" : "var(--rose)" }}></span>
            {isOnline ? "Online" : "Offline Outbox"}
          </span>
          {outboxCount > 0 && (
            <button className="secondary" onClick={triggerSync} style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem", minHeight: "32px", animation: "pulseLive 2s infinite", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              <IconSync size={14} />
              <span>Sync Outbox ({outboxCount})</span>
            </button>
          )}
          {installPrompt && (
            <button
              onClick={installPwa}
              style={{
                padding: "0.25rem 0.75rem",
                fontSize: "0.8rem",
                minHeight: "32px",
                background: "linear-gradient(135deg, #059669 0%, #047857 100%)",
                color: "#ffffff",
                border: "none",
                borderRadius: "8px",
                boxShadow: "0 2px 6px rgba(5, 150, 105, 0.35)",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                fontWeight: 700
              }}
            >
              <IconDownload size={14} />
              <span>Install App</span>
            </button>
          )}
          <button className="secondary" onClick={() => setView({ name: "barcode_catalog" })} style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem", minHeight: "32px", background: "var(--brand-light)", color: "var(--brand-primary)", border: "1.5px solid var(--brand-primary)", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
            <IconBarcode size={15} />
            <span>Barcode Catalog</span>
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.88rem", background: "var(--paper-subtle)", padding: "0.3rem 0.75rem", borderRadius: "8px" }}>
            {me.role === "manager" ? (
              <span style={{ color: "var(--brand-primary)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                <IconInventory size={15} />
                <span>Manager · Inventory Portal</span>
              </span>
            ) : shift ? (
              <span style={{ color: "var(--brand-primary)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                <span className="live-dot" style={{ background: "var(--emerald)" }}></span>
                <span>{shift.label}</span>
                <small style={{ color: "var(--ink-muted)", fontWeight: 500 }}>({tk(shift.opening_cash)})</small>
              </span>
            ) : (
              <span style={{ color: "var(--rose)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                <span className="live-dot" style={{ background: "var(--rose)" }}></span>
                <span>Register Closed</span>
              </span>
            )}
            {" · "}
            <b>{me.name}</b> <small style={{ color: "var(--ink-muted)" }}>({me.role === "owner" ? "Owner · Executive" : me.role})</small>
          </span>
          {me.role !== "manager" && (
            shift ? (
              <button className="warn" style={{ minHeight: "36px", padding: "0.35rem 0.95rem" }} onClick={closeShift}>
                Close Shift
              </button>
            ) : (
              <button className="primary" style={{ minHeight: "36px", padding: "0.35rem 0.95rem" }} onClick={openShift}>
                Open Shift
              </button>
            )
          )}
          <span className="header-divider" aria-hidden="true"></span>
          <button className="btn-logout" onClick={() => setShowLogoutConfirm(true)} title="Sign out of terminal">
            <IconLogOut size={15} />
            <span>Log Out</span>
          </button>
        </div>
      </header>

      {showLogoutConfirm && (
        <div className="modal-backdrop" onClick={() => setShowLogoutConfirm(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-icon">
              <IconLogOut size={24} />
            </div>
            <h3 style={{ margin: "0 0 0.4rem", fontSize: "1.2rem", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.02em" }}>
              Sign out of terminal?
            </h3>
            <p style={{ margin: "0 0 1.4rem", color: "var(--ink-muted)", fontSize: "0.9rem", lineHeight: 1.5 }}>
              Signed in as <b style={{ color: "var(--ink)" }}>{me.name}</b>.
              {shift && me.role !== "manager"
                ? ` Your active shift (${shift.label}) will remain open until closed.`
                : " You will be returned to the secure staff sign-in screen."}
            </p>
            <div style={{ display: "flex", gap: "0.65rem", justifyContent: "flex-end" }}>
              <button onClick={() => setShowLogoutConfirm(false)} style={{ minHeight: "40px", padding: "0.5rem 1.15rem" }}>
                Cancel
              </button>
              <button className="danger-solid" onClick={confirmLogout} style={{ minHeight: "40px", padding: "0.5rem 1.25rem", display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
                <IconLogOut size={15} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <main>
        {msg && (
          <div className="toast-msg" onClick={() => setMsg("")} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <IconBell size={16} />
            <div style={{ flex: 1 }}>{msg}</div>
            <IconClose size={14} style={{ opacity: 0.7 }} />
          </div>
        )}

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
          me.role === "manager" ? (
            <InventorySuite token={token} api={api} userRole={me.role} onBack={home} />
          ) : (
          <div>
            <div style={{ marginBottom: "1.5rem" }}>
              <h2 style={{ margin: "0 0 0.4rem 0", color: "var(--ink)", letterSpacing: "-0.02em" }}>Welcome, {me.name}</h2>
              <p style={{ margin: 0, color: "var(--ink-muted)", fontSize: "0.92rem" }}>
                Select a sales channel or launch the barcode-driven inventory manager below.
              </p>
            </div>

            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "1.25rem" }}>
              {CHANNELS.map(([k, n]) => {
                const count = open.filter(o => o.channel === k).length;
                return (
                  <button className="tile" key={k} onClick={() => setView({ name: "layout", channel: k })} style={{ minHeight: "125px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                      <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-primary)" }}>
                        {k === "dine_in" ? <IconDineIn size={20} /> : k === "takeaway" ? <IconTakeaway size={20} /> : <IconDelivery size={20} />}
                      </div>
                      {count > 0 && (
                        <span style={{ background: "var(--gold-light)", color: "#92400e", fontWeight: 800, fontSize: "0.78rem", padding: "2px 8px", borderRadius: "999px" }}>
                          {count} Open
                        </span>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--brand-primary)" }}>{n}</div>
                      <span style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>
                        {count > 0 ? `${count} active orders pending` : "Start new order ticket"}
                      </span>
                    </div>
                  </button>
                );
              })}

              <button className="tile" onClick={() => setView({ name: "inventory" })} style={{ minHeight: "125px" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-primary)" }}>
                  <IconInventory size={20} />
                </div>
                <div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--brand-primary)" }}>Inventory & Stock</div>
                  <span style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>Daily Bazar, Opening Stock & Ledger</span>
                </div>
              </button>

              <button className="tile" onClick={() => setView({ name: "table_editor" })} style={{ minHeight: "125px" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-primary)" }}>
                  <IconFloorPlan size={20} />
                </div>
                <div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--brand-primary)" }}>Floor Plan</div>
                  <span style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>Interactive Table Layout</span>
                </div>
              </button>

              <button className="tile" onClick={report} style={{ minHeight: "125px" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-primary)" }}>
                  <IconReports size={20} />
                </div>
                <div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--brand-primary)" }}>Reports</div>
                  <span style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>Mushak 6.3 & Cost Tracking</span>
                </div>
              </button>

              <button className="tile" onClick={() => setView({ name: "barcode_catalog" })} style={{ minHeight: "125px", border: "1.5px solid var(--brand-primary)", background: "rgba(79, 70, 229, 0.04)" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: "var(--brand-light)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-primary)" }}>
                  <IconBarcode size={20} />
                </div>
                <div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--brand-primary)" }}>Barcode Catalog</div>
                  <span style={{ fontSize: "0.82rem", color: "var(--ink-muted)" }}>Menu, Beverages & Ingredient Codes</span>
                </div>
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
        ))}

        {view.name === "layout" && (
          <div>
            <div className="row" style={{ marginBottom: "1rem", justifyContent: "flex-start", gap: "0.85rem" }}>
              <button className="btn-back" onClick={home}>
                <IconArrowLeft size={15} />
                <span>Dashboard</span>
              </button>
              <h3 style={{ margin: 0, color: "var(--blue-primary)" }}>
                {CHANNELS.find(c => c[0] === view.channel)?.[1] || view.channel} Channel
              </h3>
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
            onDone={goBack}
            onPay={(o) => setView({ name: "pay", order: o })}
          />
        )}

        {view.name === "pay" && (
          <Pay
            order={view.order}
            token={token}
            isOffline={!isOnline}
            onDone={goBack}
          />
        )}

        {view.name === "inventory" && <InventorySuite token={token} api={api} userRole={me.role} onBack={home} />}
        {view.name === "table_editor" && <TableLayoutEditor token={token} onBack={home} />}
        {view.name === "barcode_catalog" && <BarcodeCatalogView token={token} onBack={home} />}
      </main>
    </>
  );
}
