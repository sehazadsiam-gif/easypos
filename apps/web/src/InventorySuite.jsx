import { useState, useEffect, useRef } from "react";
import { PrintableBarcodeSheet, BarcodeSvg } from "./BarcodeSheet";
import { IconAlert, IconClose, IconCheck, IconEdit, IconPlus, IconPrinter, IconSearch } from "./Icons";

const todayISO = () => new Date().toISOString().slice(0, 10);

const formatQty = (qty, baseUnit) => {
  const n = Number(qty || 0);
  if (baseUnit === "g" || baseUnit === "gm") {
    return `${n}gm`;
  }
  if (baseUnit === "ml") {
    if (Math.abs(n) >= 1000) {
      return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 2)}L (${n}ml)`;
    }
    return `${n}ml`;
  }
  return `${n} ${baseUnit || ""}`.trim();
};

export const formatBazarName = (name, unit = "g") => {
  if (!name) return "";
  const u = (unit || "g").toLowerCase();
  if ((u === "g" || u === "gm") && !name.toLowerCase().includes("gm")) {
    return `${name} 100gm`;
  }
  if (u === "ml" && !name.toLowerCase().includes("ml")) {
    return `${name} 100ml`;
  }
  return name;
};

const tk = (p) => (p != null && p > 0 ? "৳" + (p / 100).toFixed(2) : "Needs Price");

function BatchScannerView({ batchType, token, api, userRole, onChanged }) {
  const isManager = userRole === "owner" || userRole === "manager";
  const isSale = batchType === "sale";
  const hasDate = batchType === "bazar" || batchType === "sale";

  const [bazarItems, setBazarItems] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [batches, setBatches] = useState([]);
  const [activeBatch, setActiveBatch] = useState(null);
  const [batchDate, setBatchDate] = useState(todayISO());
  const [lines, setLines] = useState([]);
  const [allowNegative, setAllowNegative] = useState(false);
  const [scanInput, setScanInput] = useState("");
  const [msg, setMsg] = useState({ text: "", type: "info" });
  const scanRef = useRef(null);

  const refocusScan = () => {
    setTimeout(() => scanRef.current?.focus(), 20);
  };

  const loadData = async () => {
    try {
      const [inv, allMenu, batchList] = await Promise.all([
        api("/inventory", token),
        api("/items", token),
        api(`/batches?batch_type=${batchType}`, token),
      ]);
      setBazarItems(inv);
      setMenuItems(allMenu);
      setBatches(batchList);
    } catch (e) {
      setMsg({ text: e.message, type: "error" });
    }
  };

  useEffect(() => {
    setActiveBatch(null);
    setLines([]);
    setAllowNegative(false);
    setMsg({ text: "", type: "info" });
    loadData();
    refocusScan();
  }, [batchType, token]);

  // Keep scan box focused when no other input/select is active
  useEffect(() => {
    const id = setInterval(() => {
      const tag = document.activeElement?.tagName;
      if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
        scanRef.current?.focus();
      }
    }, 1500);
    return () => clearInterval(id);
  }, []);

  const ensureDraftBatch = async () => {
    if (activeBatch && activeBatch.status === "draft") return activeBatch;
    const created = await api("/batches", token, {
      batch_type: batchType,
      batch_date: hasDate ? batchDate : todayISO(),
    });
    setActiveBatch(created);
    return created;
  };

  const syncLinesToServer = async (batchObj, nextLines, negFlag = allowNegative) => {
    const payload = {
      batch_date: hasDate ? batchDate : batchObj.batch_date,
      allow_negative_stock: negFlag,
      lines: nextLines.map((l) =>
        isSale
          ? { menu_item_id: l.menu_item_id, quantity: l.quantity }
          : { bazar_item_id: l.bazar_item_id, quantity: l.quantity, pack_count: l.pack_count || 1 }
      ),
    };
    const updated = await api(`/batches/${batchObj.id}/lines`, token, payload, "PUT");
    setActiveBatch(updated);
    setLines(updated.lines || []);
    loadData();
    return updated;
  };

  const openBatch = async (id) => {
    try {
      const b = await api(`/batches/${id}`, token);
      setActiveBatch(b);
      setBatchDate(b.batch_date || todayISO());
      setLines(b.lines || []);
      setAllowNegative(Boolean(b.allow_negative_stock));
      setMsg({ text: `Loaded ${b.status.toUpperCase()} batch #${b.id}`, type: "info" });
      refocusScan();
    } catch (e) {
      setMsg({ text: e.message, type: "error" });
    }
  };

  const startNewDraft = () => {
    setActiveBatch(null);
    setLines([]);
    setAllowNegative(false);
    setBatchDate(todayISO());
    setMsg({ text: "Started new draft batch. Ready to scan.", type: "info" });
    refocusScan();
  };

  const handleScan = async (raw) => {
    const code = raw.trim().toUpperCase();
    setScanInput("");
    if (!code) {
      refocusScan();
      return;
    }
    if (activeBatch && activeBatch.status === "approved") {
      setMsg({ text: "Approved batch is locked. Start a new draft to scan.", type: "error" });
      refocusScan();
      return;
    }

    // Quantity modifier barcodes
    if (code.startsWith("QTY-")) {
      if (lines.length === 0) {
        setMsg({ text: "Scan an item first before scanning a quantity code.", type: "error" });
        refocusScan();
        return;
      }
      const next = [...lines];
      const last = { ...next[next.length - 1] };

      if (isSale) {
        if (code === "QTY-X1") last.quantity = 1;
        else if (code === "QTY-X5") last.quantity = 5;
        else if (code === "QTY-X10") last.quantity = 10;
        else if (code === "QTY-X50") last.quantity = 50;
        else {
          setMsg({ text: `Modifier ${code} is only for weight/volume items.`, type: "error" });
          refocusScan();
          return;
        }
      } else {
        const pSize = last.pack_size || 1;
        if (code === "QTY-X1") { last.pack_count = 1; last.quantity = Math.round(pSize); }
        else if (code === "QTY-X5") { last.pack_count = 5; last.quantity = Math.round(5 * pSize); }
        else if (code === "QTY-X10") { last.pack_count = 10; last.quantity = Math.round(10 * pSize); }
        else if (code === "QTY-X50") { last.pack_count = 50; last.quantity = Math.round(50 * pSize); }
        else if (code === "QTY-PLUS1KG") {
          if (last.base_unit !== "g") { setMsg({ text: "QTY-PLUS1KG only applies to gram (g) items.", type: "error" }); refocusScan(); return; }
          last.quantity += 1000;
        } else if (code === "QTY-PLUS5KG") {
          if (last.base_unit !== "g") { setMsg({ text: "QTY-PLUS5KG only applies to gram (g) items.", type: "error" }); refocusScan(); return; }
          last.quantity += 5000;
        } else if (code === "QTY-PLUS1L") {
          if (last.base_unit !== "ml") { setMsg({ text: "QTY-PLUS1L only applies to ml items.", type: "error" }); refocusScan(); return; }
          last.quantity += 1000;
        } else if (code === "QTY-PLUS5L") {
          if (last.base_unit !== "ml") { setMsg({ text: "QTY-PLUS5L only applies to ml items.", type: "error" }); refocusScan(); return; }
          last.quantity += 5000;
        } else {
          setMsg({ text: `Unknown quantity code: ${code}`, type: "error" });
          refocusScan();
          return;
        }
      }

      next[next.length - 1] = last;
      try {
        const batchObj = await ensureDraftBatch();
        await syncLinesToServer(batchObj, next);
        setMsg({ text: `Applied ${code} to ${last.name}`, type: "info" });
      } catch (e) {
        setMsg({ text: e.message, type: "error" });
      }
      refocusScan();
      return;
    }

    // Item scan
    if (isSale) {
      const matched = menuItems.find((m) => m.barcode && m.barcode.toUpperCase() === code);
      if (!matched) {
        setMsg({ text: `Unknown menu barcode: ${code}`, type: "error" });
        refocusScan();
        return;
      }
      if (matched.recipe_status !== "approved") {
        setMsg({ text: `Recipe not approved for ${matched.name}`, type: "error" });
        refocusScan();
        return;
      }

      const next = [...lines];
      const idx = next.findIndex((l) => l.menu_item_id === matched.id);
      if (idx >= 0) {
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
      } else {
        next.push({ menu_item_id: matched.id, name: matched.name, barcode: matched.barcode, quantity: 1 });
      }
      try {
        const batchObj = await ensureDraftBatch();
        await syncLinesToServer(batchObj, next);
        setMsg({ text: `Scanned: ${matched.name} (+1 serving)`, type: "info" });
      } catch (e) {
        setMsg({ text: e.message, type: "error" });
      }
    } else {
      const matched = bazarItems.find((i) => i.barcode && i.barcode.toUpperCase() === code);
      if (!matched) {
        setMsg({ text: `Unknown bazar item barcode: ${code}`, type: "error" });
        refocusScan();
        return;
      }

      const packSize = matched.pack_size || 1;
      const next = [...lines];
      const idx = next.findIndex((l) => l.bazar_item_id === matched.id);
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          quantity: next[idx].quantity + packSize,
          pack_count: (next[idx].pack_count || 1) + 1,
        };
      } else {
        next.push({
          bazar_item_id: matched.id,
          name: matched.name,
          barcode: matched.barcode,
          base_unit: matched.base_unit,
          pack_size: packSize,
          quantity: packSize,
          pack_count: 1,
        });
      }
      try {
        const batchObj = await ensureDraftBatch();
        await syncLinesToServer(batchObj, next);
        setMsg({ text: `Scanned: ${matched.name} (+${formatQty(packSize, matched.base_unit)})`, type: "info" });
      } catch (e) {
        setMsg({ text: e.message, type: "error" });
      }
    }
    refocusScan();
  };

  const adjustLine = async (idx, delta) => {
    if (activeBatch?.status === "approved") return;
    const next = [...lines];
    const step = isSale ? 1 : (next[idx].pack_size || 1);
    const newQty = next[idx].quantity + delta * step;
    if (newQty <= 0) return;
    next[idx] = { ...next[idx], quantity: newQty };
    try {
      const batchObj = await ensureDraftBatch();
      await syncLinesToServer(batchObj, next);
    } catch (e) {
      setMsg({ text: e.message, type: "error" });
    }
    refocusScan();
  };

  const setManualQty = async (idx, valStr) => {
    if (activeBatch?.status === "approved") return;
    const val = parseInt(valStr, 10);
    if (!val || val <= 0) return;
    const next = [...lines];
    next[idx] = { ...next[idx], quantity: val };
    try {
      const batchObj = await ensureDraftBatch();
      await syncLinesToServer(batchObj, next);
    } catch (e) {
      setMsg({ text: e.message, type: "error" });
    }
  };

  const removeLine = async (idx) => {
    if (activeBatch?.status === "approved") return;
    const next = lines.filter((_, i) => i !== idx);
    try {
      const batchObj = await ensureDraftBatch();
      await syncLinesToServer(batchObj, next);
    } catch (e) {
      setMsg({ text: e.message, type: "error" });
    }
    refocusScan();
  };

  const approveBatch = async () => {
    if (!activeBatch || lines.length === 0) {
      setMsg({ text: "Scan at least one item before approving.", type: "error" });
      return;
    }
    const label = batchType === "central" ? "Monthly Opening Stock" : batchType === "bazar" ? "Daily Bazar" : "Daily Sale";
    if (!window.confirm(`Confirm APPROVE ${label} Batch #${activeBatch.id}? Approved batches cannot be edited or deleted.`)) {
      refocusScan();
      return;
    }
    try {
      const approved = await api(`/batches/${activeBatch.id}/approve`, token, {
        allow_negative_stock: allowNegative,
      });
      setActiveBatch(approved);
      setLines(approved.lines || []);
      setMsg({ text: `${label} Batch #${approved.id} APPROVED and locked in ledger!`, type: "info" });
      loadData();
      onChanged?.();
    } catch (e) {
      setMsg({ text: e.message, type: "error" });
    }
    refocusScan();
  };

  const isLocked = activeBatch?.status === "approved";
  const warnings = activeBatch?.stock_warnings || [];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1rem", alignItems: "start" }}>
      <div>
        <div className="card" style={{ border: "2px solid var(--blue-primary)", marginBottom: "1rem" }}>
          <div className="row" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ margin: 0, color: "var(--blue-primary)" }}>
                {batchType === "central" && "Monthly Opening Stock (Starting Count)"}
                {batchType === "bazar" && "Daily Bazar (Purchases)"}
                {batchType === "sale" && "Daily Sale (Menu Deductions)"}
              </h3>
              <small style={{ color: "var(--gray)" }}>
                {activeBatch ? `Batch #${activeBatch.id} · ${activeBatch.status.toUpperCase()}` : "New Draft Batch"}
              </small>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              {hasDate && (
                <input
                  type="date"
                  value={batchDate}
                  disabled={isLocked}
                  onChange={async (e) => {
                    setBatchDate(e.target.value);
                    if (activeBatch && activeBatch.status === "draft") {
                      await syncLinesToServer(activeBatch, lines, allowNegative);
                    }
                  }}
                />
              )}
              <button className="secondary" onClick={startNewDraft}>+ New Draft</button>
            </div>
          </div>

          <div className="scanner-container" style={{ margin: "0.8rem 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
                <span className="live-dot" style={{ background: "var(--emerald)", display: "inline-block", width: "8px", height: "8px", borderRadius: "50%" }}></span>
                Hardware Laser Scanner Active (Auto-Focused)
              </span>
              <span style={{ fontSize: "0.75rem", background: "#334155", color: "#f8fafc", padding: "2px 8px", borderRadius: "4px" }}>
                CODE-128
              </span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                ref={scanRef}
                autoFocus
                disabled={isLocked}
                placeholder={
                  isSale
                    ? "Scan or type MENU barcode (e.g. MENU-JAPANESE-TOR) or QTY-X5..."
                    : "Scan or type BAZAR barcode (e.g. ING-CHICKEN-THI-G) or QTY-X5..."
                }
                style={{
                  flex: 1,
                  fontSize: "1.1rem",
                  padding: "0.85rem 1rem",
                  borderRadius: "8px",
                }}
                value={scanInput}
                onChange={(e) => setScanInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleScan(scanInput)}
              />
              <button
                className="primary"
                style={{ minHeight: "48px", padding: "0 1.5rem", fontWeight: 700 }}
                disabled={isLocked}
                onClick={() => handleScan(scanInput)}
              >
                Scan Barcode
              </button>
            </div>
          </div>

          <div style={{ marginTop: "0.6rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--gray)" }}>Qty Codes:</span>
            {(isSale
              ? ["QTY-X1", "QTY-X5", "QTY-X10", "QTY-X50"]
              : ["QTY-X1", "QTY-X5", "QTY-X10", "QTY-X50", "QTY-PLUS1KG", "QTY-PLUS5KG", "QTY-PLUS1L"]
            ).map((q) => (
              <button
                key={q}
                type="button"
                className="secondary"
                disabled={isLocked}
                style={{ minHeight: "34px", padding: "0.25rem 0.65rem", fontSize: "0.8rem" }}
                onClick={() => handleScan(q)}
              >
                {q}
              </button>
            ))}
          </div>

          {isSale && (
            <div style={{ marginTop: "0.8rem", paddingTop: "0.6rem", borderTop: "1px dashed var(--line)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--gray)", marginBottom: "0.3rem" }}>
                Quick Tap Menu Barcodes:
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {menuItems
                  .filter((m) => m.recipe_status === "approved" && m.barcode)
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={isLocked}
                      style={{ minHeight: "32px", padding: "0.2rem 0.6rem", fontSize: "0.8rem", background: "#f8fafc" }}
                      onClick={() => handleScan(m.barcode)}
                    >
                      {m.name} <code style={{ fontSize: "0.75rem", color: "var(--blue-primary)" }}>({m.barcode})</code>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {msg.text && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.65rem 0.9rem",
                borderRadius: "8px",
                fontWeight: 600,
                background: msg.type === "error" ? "var(--red-light)" : "var(--blue-light)",
                color: msg.type === "error" ? "var(--red)" : "var(--blue-primary)",
              }}
            >
              {msg.text}
            </div>
          )}
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0 }}>Scanned Lines ({lines.length})</h4>
          {lines.length === 0 ? (
            <p style={{ color: "var(--gray)" }}>Scan a barcode above or type a code and press Enter.</p>
          ) : (
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>{isSale ? "Servings" : "Quantity (Base Units)"}</th>
                  {isSale && <th>Ingredients Used</th>}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td>
                      <b>{isSale ? l.name : formatBazarName(l.name, l.base_unit)}</b>
                      <div style={{ fontSize: "0.78rem", color: "var(--gray)" }}>
                        <code>{l.barcode}</code>
                        {isSale && l.recipe_version && ` · Recipe v${l.recipe_version}`}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                        <button
                          disabled={isLocked}
                          style={{ minHeight: "40px", minWidth: "40px", fontSize: "1.1rem" }}
                          onClick={() => adjustLine(idx, -1)}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          disabled={isLocked}
                          style={{ width: "90px", padding: "0.45rem", textAlign: "center", fontWeight: 700 }}
                          value={l.quantity}
                          onChange={(e) => setManualQty(idx, e.target.value)}
                        />
                        <button
                          disabled={isLocked}
                          style={{ minHeight: "40px", minWidth: "40px", fontSize: "1.1rem" }}
                          onClick={() => adjustLine(idx, 1)}
                        >
                          +
                        </button>
                        {!isSale && (
                          <small style={{ color: "var(--gray)" }}>{formatQty(l.quantity, l.base_unit)}</small>
                        )}
                      </div>
                    </td>
                    {isSale && (
                      <td>
                        {(l.ingredients_used || []).map((iu) => (
                          <div key={iu.bazar_item_id} style={{ fontSize: "0.82rem" }}>
                            {iu.name}: <b>{formatQty(iu.total_used, iu.base_unit)}</b>{" "}
                            <span style={{ color: iu.current_stock - iu.total_used < 0 ? "var(--red)" : "var(--gray)" }}>
                              (stock: {formatQty(iu.current_stock, iu.base_unit)})
                            </span>
                          </div>
                        ))}
                      </td>
                    )}
                    <td>
                      <button
                        className="warn"
                        disabled={isLocked}
                        style={{ minHeight: "40px" }}
                        onClick={() => removeLine(idx)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {isSale && warnings.length > 0 && (
            <div style={{ marginTop: "1rem", padding: "0.85rem", borderRadius: "8px", background: "var(--red-light)", color: "#991b1b" }}>
              <b style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                <IconAlert size={15} color="#991b1b" /> Insufficient Stock:
              </b>
              <ul style={{ margin: "0.4rem 0" }}>
                {warnings.map((w) => (
                  <li key={w.bazar_item_id}>
                    {w.name}: needed {formatQty(w.needed, w.base_unit)}, available {formatQty(w.available, w.base_unit)}
                  </li>
                ))}
              </ul>
              {isManager && !isLocked && (
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 700, marginTop: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={allowNegative}
                    onChange={(e) => setAllowNegative(e.target.checked)}
                  />
                  Approve with negative stock
                </label>
              )}
            </div>
          )}

          <div style={{ marginTop: "1.2rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--gray)", fontSize: "0.85rem" }}>
              {isLocked
                ? `Approved by ${activeBatch.approved_by || "Manager"}`
                : isManager
                ? "Ready for Manager/Owner approval"
                : "Draft saved · Only Manager/Owner can approve"}
            </span>
            {!isLocked && (
              <button
                className="primary"
                disabled={!isManager || lines.length === 0}
                style={{ minHeight: "48px", padding: "0 2rem", fontSize: "1.05rem", opacity: !isManager || lines.length === 0 ? 0.5 : 1 }}
                onClick={approveBatch}
              >
                APPROVE
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h4 style={{ marginTop: 0 }}>Batches History</h4>
        {batches.length === 0 ? (
          <p style={{ color: "var(--gray)", fontSize: "0.85rem" }}>No batches yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "0.5rem", maxHeight: "520px", overflowY: "auto" }}>
            {batches.map((b) => (
              <button
                key={b.id}
                onClick={() => openBatch(b.id)}
                style={{
                  textAlign: "left",
                  padding: "0.65rem",
                  background: activeBatch?.id === b.id ? "var(--blue-light)" : "#fff",
                  borderColor: activeBatch?.id === b.id ? "var(--blue-primary)" : "var(--line)",
                }}
              >
                <div className="row">
                  <b>#{b.id} · {b.batch_date}</b>
                  <span
                    style={{
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: b.status === "approved" ? "var(--green-light)" : "var(--amber-light)",
                      color: b.status === "approved" ? "#065f46" : "#92400e",
                    }}
                  >
                    {b.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--gray)", marginTop: "3px" }}>
                  {b.line_count} items · by {b.created_by}
                  {b.approved_by ? ` · Verified: ${b.approved_by}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecipesView({ token, api, userRole }) {
  const isManager = userRole === "owner" || userRole === "manager";
  const [recipes, setRecipes] = useState([]);
  const [bazarItems, setBazarItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [draftLines, setDraftLines] = useState([]);
  const [newMenu, setNewMenu] = useState({ name: "", barcode: "", price: "" });
  const [showAddMenuModal, setShowAddMenuModal] = useState(false);
  const [wizardStep, setWizardStep] = useState(1); // 1 = Menu Info, 2 = Recipe Ingredients
  const [createdMenuItem, setCreatedMenuItem] = useState(null);
  const [showQuickBazarModal, setShowQuickBazarModal] = useState(false);
  const [quickBazar, setQuickBazar] = useState({ name: "", unit: "g", pack_size: "100", min_stock: "100" });
  const [msg, setMsg] = useState("");

  const load = async () => {
    try {
      const [recs, inv] = await Promise.all([api("/recipes", token), api("/inventory", token)]);
      setRecipes(recs);
      setBazarItems(inv);
      if (!selectedId && recs.length > 0) selectItem(recs[0].item_id);
    } catch (e) {
      setMsg(e.message);
    }
  };

  useEffect(() => { load(); }, [token]);

  const selectItem = async (itemId) => {
    setSelectedId(itemId);
    try {
      const d = await api(`/recipes/${itemId}`, token);
      setDetail(d);
      const source = d.draft_recipe || d.approved_recipe;
      setDraftLines(
        source
          ? source.ingredients.map((i) => ({
              bazar_item_id: i.bazar_item_id,
              amount: i.input_amount ?? i.qty_base,
              unit: i.input_unit || i.base_unit,
            }))
          : []
      );
    } catch (e) {
      setMsg(e.message);
    }
  };

  const startAddMenuWizard = () => {
    setNewMenu({ name: "", barcode: "", price: "" });
    setCreatedMenuItem(null);
    setDraftLines([]);
    setWizardStep(1);
    setShowAddMenuModal(true);
  };

  const submitMenuInfoStep = async () => {
    if (!newMenu.name.trim()) return alert("Menu item name is required");
    try {
      const pricePaisa = newMenu.price ? Math.round(parseFloat(newMenu.price) * 100) : null;
      const created = await api("/items", token, {
        name: newMenu.name.trim(),
        barcode: newMenu.barcode.trim() || null,
        price: pricePaisa,
      });
      setCreatedMenuItem(created);
      setWizardStep(2); // Immediately advance to ingredients step
      if (bazarItems.length > 0) {
        setDraftLines([{ bazar_item_id: bazarItems[0].id, amount: 1, unit: bazarItems[0].base_unit }]);
      } else {
        setDraftLines([]);
      }
    } catch (e) {
      alert("Error adding menu item: " + e.message);
    }
  };

  const handleCreateQuickBazar = async () => {
    if (!quickBazar.name.trim()) return alert("Ingredient name is required");
    try {
      const created = await api("/inventory", token, {
        name: quickBazar.name.trim(),
        unit: quickBazar.unit,
        pack_size: parseFloat(quickBazar.pack_size || "100"),
        pack_unit: quickBazar.unit === "g" ? `${quickBazar.pack_size || 100}gm` : quickBazar.unit === "ml" ? `${quickBazar.pack_size || 100}ml` : `${quickBazar.pack_size} ${quickBazar.unit}`,
        min_stock: parseInt(quickBazar.min_stock || "100", 10),
      });
      // Refresh bazar items
      const updatedInv = await api("/inventory", token);
      setBazarItems(updatedInv);
      // Auto-add this newly created ingredient to draftLines
      setDraftLines((prev) => [
        ...prev,
        {
          bazar_item_id: created.id,
          amount: quickBazar.unit === "pcs" ? 1 : 100,
          unit: quickBazar.unit,
        },
      ]);
      setQuickBazar({ name: "", unit: "g", pack_size: "1000", min_stock: "0" });
      setShowQuickBazarModal(false);
      alert(`Ingredient "${created.name}" created (Barcode: ${created.barcode}) and added to recipe!`);
    } catch (e) {
      alert("Error creating ingredient: " + e.message);
    }
  };

  const finishMenuWizard = async (autoApprove = true) => {
    if (!createdMenuItem) return;
    if (draftLines.length === 0) {
      if (!confirm("No ingredients added yet. Save empty recipe draft?")) return;
    }
    try {
      if (draftLines.length > 0) {
        await api(`/recipes/${createdMenuItem.id}/draft`, token, {
          ingredients: draftLines.map((l) => ({
            bazar_item_id: parseInt(l.bazar_item_id, 10),
            amount: parseFloat(l.amount),
            unit: l.unit,
          })),
        });
        if (autoApprove && isManager) {
          await api(`/recipes/${createdMenuItem.id}/approve`, token, {});
        }
      }
      setShowAddMenuModal(false);
      setMsg(`Menu item "${createdMenuItem.name}" and recipe ${autoApprove ? "approved" : "saved as draft"}!`);
      await load();
      selectItem(createdMenuItem.id);
    } catch (e) {
      alert("Error saving recipe: " + e.message);
    }
  };

  const addLine = () => {
    if (bazarItems.length === 0) {
      setShowQuickBazarModal(true);
      return;
    }
    const first = bazarItems[0];
    setDraftLines([...draftLines, { bazar_item_id: first.id, amount: 1, unit: first.base_unit }]);
  };

  const saveDraft = async () => {
    if (!selectedId) return;
    try {
      await api(`/recipes/${selectedId}/draft`, token, {
        ingredients: draftLines.map((l) => ({
          bazar_item_id: parseInt(l.bazar_item_id, 10),
          amount: parseFloat(l.amount),
          unit: l.unit,
        })),
      });
      setMsg("Draft recipe saved! (Old approved version stays active until approved)");
      await load();
      selectItem(selectedId);
    } catch (e) {
      setMsg(e.message);
    }
  };

  const approveRecipe = async () => {
    if (!selectedId) return;
    try {
      await api(`/recipes/${selectedId}/approve`, token, {});
      setMsg("Recipe approved and active on Menu & Daily Sale!");
      await load();
      selectItem(selectedId);
    } catch (e) {
      setMsg(e.message);
    }
  };

  const allowedUnitsFor = (bazarId) => {
    const b = bazarItems.find((x) => x.id === parseInt(bazarId, 10));
    if (!b) return ["g", "kg", "ml", "L", "pcs"];
    if (b.base_unit === "g") return ["g", "kg"];
    if (b.base_unit === "ml") return ["ml", "L"];
    return ["pcs"];
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "1rem", alignItems: "start" }}>
      <div className="card">
        <div className="row" style={{ marginBottom: "0.75rem" }}>
          <h4 style={{ margin: 0 }}>Menu Items ({recipes.length})</h4>
          {isManager && (
            <button className="primary" style={{ minHeight: "36px", padding: "0.2rem 0.8rem", fontSize: "0.85rem" }} onClick={startAddMenuWizard}>
              + Add Menu Item
            </button>
          )}
        </div>
        <div style={{ display: "grid", gap: "0.4rem", maxHeight: "560px", overflowY: "auto" }}>
          {recipes.map((r) => (
            <button
              key={r.item_id}
              onClick={() => selectItem(r.item_id)}
              style={{
                textAlign: "left",
                background: selectedId === r.item_id ? "var(--blue-light)" : "#fff",
                borderColor: selectedId === r.item_id ? "var(--blue-primary)" : "var(--line)",
              }}
            >
              <div className="row">
                <b>{r.name}</b>
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: r.recipe_status === "approved" ? "var(--green-light)" : r.recipe_status === "draft" ? "var(--amber-light)" : "#e2e8f0",
                    color: r.recipe_status === "approved" ? "#065f46" : r.recipe_status === "draft" ? "#92400e" : "#475569",
                  }}
                >
                  {r.recipe_status.toUpperCase()}
                </span>
              </div>
              <small style={{ color: "var(--gray)" }}>{r.barcode} · {tk(r.price)}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {msg && <p style={{ background: "var(--blue-light)", color: "var(--blue-primary)", padding: "0.6rem", borderRadius: "6px", fontWeight: 600 }}>{msg}</p>}
        {detail ? (
          <>
            <div className="row" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: 0 }}>{detail.name}</h3>
                <small style={{ color: "var(--gray)" }}>
                  Barcode: <code>{detail.barcode}</code> · Price: {tk(detail.price)}
                </small>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="secondary" onClick={() => setShowQuickBazarModal(true)}>+ New Bazar Item</button>
                <button className="secondary" onClick={addLine}>+ Add Ingredient Line</button>
              </div>
            </div>

            {detail.approved_recipe && (
              <div style={{ background: "var(--green-light)", padding: "0.6rem 0.85rem", borderRadius: "8px", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                <b>Active Approved Recipe (v{detail.approved_recipe.version}):</b>{" "}
                {detail.approved_recipe.ingredients.map((i) => `${i.bazar_item_name}: ${formatQty(i.qty_base, i.base_unit)}`).join(", ")}
              </div>
            )}

            {detail.draft_recipe && (
              <div style={{ background: "var(--amber-light)", padding: "0.6rem 0.85rem", borderRadius: "8px", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                <b>Pending Draft (v{detail.draft_recipe.version})</b> — not yet approved.
              </div>
            )}

            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr><th>Bazar Item</th><th>Amount</th><th>Unit</th><th>Remove</th></tr>
              </thead>
              <tbody>
                {draftLines.map((ln, idx) => {
                  const units = allowedUnitsFor(ln.bazar_item_id);
                  return (
                    <tr key={idx}>
                      <td>
                        <select
                          style={{ width: "100%" }}
                          value={ln.bazar_item_id}
                          onChange={(e) => {
                            const newId = parseInt(e.target.value, 10);
                            const newB = bazarItems.find((x) => x.id === newId);
                            const next = [...draftLines];
                            next[idx] = { ...ln, bazar_item_id: newId, unit: newB?.base_unit || "g" };
                            setDraftLines(next);
                          }}
                        >
                          {bazarItems.map((b) => (
                            <option key={b.id} value={b.id}>{formatBazarName(b.name, b.base_unit)} ({b.base_unit})</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step="any"
                          style={{ width: "110px" }}
                          value={ln.amount}
                          onChange={(e) => {
                            const next = [...draftLines];
                            next[idx] = { ...ln, amount: e.target.value };
                            setDraftLines(next);
                          }}
                        />
                      </td>
                      <td>
                        <select
                          value={units.includes(ln.unit) ? ln.unit : units[0]}
                          onChange={(e) => {
                            const next = [...draftLines];
                            next[idx] = { ...ln, unit: e.target.value };
                            setDraftLines(next);
                          }}
                        >
                          {units.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className="warn" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "28px", padding: "0 8px" }} onClick={() => setDraftLines(draftLines.filter((_, i) => i !== idx))}><IconClose size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="row" style={{ marginTop: "1rem" }}>
              <button className="secondary" onClick={saveDraft}>Save Draft</button>
              {isManager && detail.draft_recipe && (
                <button className="primary" onClick={approveRecipe}>Approve Recipe (v{detail.draft_recipe.version})</button>
              )}
            </div>
          </>
        ) : (
          <p style={{ color: "var(--gray)" }}>Select a menu item or click "+ Add Menu Item" to start.</p>
        )}
      </div>

      {/* MODAL: Wizard to Add Menu Item + Immediately Add Recipe Ingredients */}
      {showAddMenuModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem" }}>
          <div className="card" style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", overflowY: "auto", background: "#fff" }}>
            <div className="row" style={{ borderBottom: "1px solid var(--line)", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, color: "var(--blue-primary)" }}>
                {wizardStep === 1 ? "Step 1: Add Menu Item" : `Step 2: Recipe for ${createdMenuItem?.name}`}
              </h3>
              <button onClick={() => setShowAddMenuModal(false)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "28px", padding: "0 8px" }}><IconClose size={14} /></button>
            </div>

            {wizardStep === 1 ? (
              <div style={{ display: "grid", gap: "0.8rem" }}>
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Item Name *</label>
                  <input
                    placeholder="e.g. Hazelnut Latte, Beef Burger"
                    style={{ width: "100%" }}
                    value={newMenu.name}
                    onChange={(e) => setNewMenu({ ...newMenu, name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Barcode (Optional - auto-generated if blank)</label>
                  <input
                    placeholder="e.g. MENU-HAZELNUT-LATTE (leave blank to auto-create)"
                    style={{ width: "100%" }}
                    value={newMenu.barcode}
                    onChange={(e) => setNewMenu({ ...newMenu, barcode: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Selling Price ৳ (Optional)</label>
                  <input
                    type="number"
                    placeholder="e.g. 250"
                    style={{ width: "100%" }}
                    value={newMenu.price}
                    onChange={(e) => setNewMenu({ ...newMenu, price: e.target.value })}
                  />
                </div>
                <div className="row" style={{ marginTop: "1rem" }}>
                  <button onClick={() => setShowAddMenuModal(false)}>Cancel</button>
                  <button className="primary" onClick={submitMenuInfoStep}>Next: Add Recipe Ingredients →</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: "0.8rem" }}>
                <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--gray)" }}>
                  Specify the ingredients required for 1 serving of <b>{createdMenuItem?.name}</b>. Missing ingredients can be created right now!
                </p>

                <div className="row">
                  <b>Recipe Ingredients ({draftLines.length})</b>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="secondary" style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }} onClick={() => setShowQuickBazarModal(true)}>
                      + New Bazar Item
                    </button>
                    <button className="secondary" style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }} onClick={addLine}>
                      + Line
                    </button>
                  </div>
                </div>

                <div style={{ maxHeight: "250px", overflowY: "auto", border: "1px solid var(--line)", borderRadius: "8px", padding: "0.5rem" }}>
                  {draftLines.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "1rem", color: "var(--gray)" }}>
                      No ingredients yet. Click <b>"+ New Bazar Item"</b> or <b>"+ Line"</b> to add ingredients.
                    </div>
                  ) : (
                    draftLines.map((ln, idx) => {
                      const units = allowedUnitsFor(ln.bazar_item_id);
                      return (
                        <div key={idx} className="row" style={{ marginBottom: "0.5rem", gap: "0.4rem" }}>
                          <select
                            style={{ flex: 2 }}
                            value={ln.bazar_item_id}
                            onChange={(e) => {
                              const newId = parseInt(e.target.value, 10);
                              const newB = bazarItems.find((x) => x.id === newId);
                              const next = [...draftLines];
                              next[idx] = { ...ln, bazar_item_id: newId, unit: newB?.base_unit || "g" };
                              setDraftLines(next);
                            }}
                          >
                            {bazarItems.map((b) => (
                              <option key={b.id} value={b.id}>{formatBazarName(b.name, b.base_unit)} ({b.base_unit})</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            step="any"
                            style={{ width: "80px" }}
                            value={ln.amount}
                            onChange={(e) => {
                              const next = [...draftLines];
                              next[idx] = { ...ln, amount: e.target.value };
                              setDraftLines(next);
                            }}
                          />
                          <select
                            style={{ width: "70px" }}
                            value={units.includes(ln.unit) ? ln.unit : units[0]}
                            onChange={(e) => {
                              const next = [...draftLines];
                              next[idx] = { ...ln, unit: e.target.value };
                              setDraftLines(next);
                            }}
                          >
                            {units.map((u) => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <button className="warn" style={{ minHeight: "34px", padding: "0.2rem 0.5rem", display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => setDraftLines(draftLines.filter((_, i) => i !== idx))}>
                            <IconClose size={13} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="row" style={{ marginTop: "1rem" }}>
                  <button className="secondary" onClick={() => finishMenuWizard(false)}>Save as Draft</button>
                  <button className="primary" onClick={() => finishMenuWizard(true)}>Save & Approve Recipe</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QUICK BAZAR MODAL: Add ingredient right inside recipe workflow */}
      {showQuickBazarModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 110, padding: "1rem" }}>
          <div className="card" style={{ maxWidth: 460, width: "100%", background: "#fff" }}>
            <div className="row" style={{ borderBottom: "1px solid var(--line)", paddingBottom: "0.5rem", marginBottom: "0.8rem" }}>
              <h3 style={{ margin: 0, color: "var(--blue-primary)" }}>+ Add New Bazar Item (Ingredient)</h3>
              <button onClick={() => setShowQuickBazarModal(false)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: "28px", padding: "0 8px" }}><IconClose size={14} /></button>
            </div>
            <p style={{ margin: "0 0 0.8rem", fontSize: "0.82rem", color: "var(--gray)" }}>
              Create a new raw ingredient and auto-generate its Code128 barcode.
            </p>
            <div style={{ display: "grid", gap: "0.6rem" }}>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Ingredient Name *</label>
                <input
                  placeholder="e.g. Vanilla Syrup, Beef Patty, Fresh Butter 100gm"
                  style={{ width: "100%" }}
                  value={quickBazar.name}
                  onChange={(e) => setQuickBazar({ ...quickBazar, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Base Unit</label>
                  <select style={{ width: "100%" }} value={quickBazar.unit} onChange={(e) => setQuickBazar({ ...quickBazar, unit: e.target.value })}>
                    <option value="g">g (grams)</option>
                    <option value="ml">ml (milliliters)</option>
                    <option value="pcs">pcs (pieces)</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Pack Size</label>
                  <input
                    type="number"
                    placeholder="100"
                    style={{ width: "100%" }}
                    value={quickBazar.pack_size}
                    onChange={(e) => setQuickBazar({ ...quickBazar, pack_size: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Par Level / Min Stock ({quickBazar.unit})</label>
                <input
                  type="number"
                  placeholder="100"
                  style={{ width: "100%" }}
                  value={quickBazar.min_stock}
                  onChange={(e) => setQuickBazar({ ...quickBazar, min_stock: e.target.value })}
                />
              </div>
              <div className="row" style={{ marginTop: "0.8rem" }}>
                <button onClick={() => setShowQuickBazarModal(false)}>Cancel</button>
                <button className="primary" onClick={handleCreateQuickBazar}>Add Ingredient & Generate Barcode</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuApprovedView({ token, api, userRole }) {
  const [items, setItems] = useState([]);
  const [selectedBarcode, setSelectedBarcode] = useState(null);
  const [editingItemId, setEditingItemId] = useState(null);
  const [editPrice, setEditPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");

  const loadItems = () => {
    api("/items", token).then(setItems).catch(() => {});
  };

  useEffect(() => {
    loadItems();
  }, [token]);

  const handleStartEdit = (m, e) => {
    e.stopPropagation();
    setEditingItemId(m.id);
    setEditPrice(m.price ? (m.price / 100).toString() : "");
  };

  const handleSavePrice = async (item_id, e) => {
    e.stopPropagation();
    const parsed = parseFloat(editPrice);
    if (isNaN(parsed) || parsed < 0) {
      alert("Please enter a valid selling price in Taka (e.g. 399)");
      return;
    }
    setSaving(true);
    try {
      const pricePaisa = parsed > 0 ? Math.round(parsed * 100) : 0;
      await api(`/items/${item_id}`, token, {
        method: "PATCH",
        body: { price: pricePaisa }
      });
      setEditingItemId(null);
      loadItems();
    } catch (err) {
      alert("Failed to update price: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  const categories = ["All", ...new Set(items.map(i => i.category || "General"))];
  const filtered = items.filter(m => {
    const matchesCat = category === "All" || (m.category || "General") === category;
    const matchesSearch = !search.trim() || 
      m.name.toLowerCase().includes(search.toLowerCase()) || 
      (m.barcode && m.barcode.toLowerCase().includes(search.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const unpricedCount = items.filter(i => !i.price || i.price <= 0).length;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: "1rem", flexWrap: "wrap", gap: "1rem", justifyContent: "space-between" }}>
        <div>
          <h3 style={{ margin: 0, color: "var(--blue-primary)" }}>Menu & Manual Selling Prices ({items.length})</h3>
          <p style={{ color: "var(--gray)", fontSize: "0.85rem", margin: "4px 0 0" }}>
            Click <b>Set Price</b> on any dish to manually enter its selling price in Taka.
            {unpricedCount > 0 && (
              <span style={{ marginLeft: "8px", background: "#fef3c7", color: "#92400e", padding: "3px 8px", borderRadius: "999px", fontWeight: 700, fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                <IconAlert size={13} color="#92400e" /> {unpricedCount} dishes need selling price
              </span>
            )}
          </p>
        </div>
        <div>
          <input
            type="text"
            placeholder="Search dish or barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "220px", padding: "6px 10px" }}
          />
        </div>
      </div>

      {/* Category Filter Pills */}
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

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
        {filtered.map((m) => {
          const isEditing = editingItemId === m.id;
          const hasPrice = m.price != null && m.price > 0;
          return (
            <div
              key={m.id}
              className="card"
              style={{
                padding: "1rem",
                border: selectedBarcode === m.barcode ? "2px solid var(--blue-primary)" : hasPrice ? "1.5px solid var(--line)" : "2px dashed #f59e0b",
                background: selectedBarcode === m.barcode ? "var(--blue-light)" : "#fff",
                borderRadius: "12px",
                boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                cursor: "pointer"
              }}
              onClick={() => setSelectedBarcode(selectedBarcode === m.barcode ? null : m.barcode)}
            >
              <div>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
                  <b style={{ fontSize: "1rem", color: "var(--ink)", lineHeight: 1.3 }}>{m.name}</b>
                  <span style={{ 
                    background: hasPrice ? "var(--green-light)" : "#fef3c7", 
                    color: hasPrice ? "#065f46" : "#b45309", 
                    fontSize: "0.72rem", 
                    fontWeight: 700, 
                    padding: "2px 6px", 
                    borderRadius: "4px" 
                  }}>
                    {hasPrice ? "Priced" : "Needs Price"}
                  </span>
                </div>

                <div style={{ fontSize: "0.78rem", color: "var(--gray)", marginBottom: "0.5rem" }}>
                  Category: <b>{m.category || "General"}</b> · Station: <b>{m.station || "kitchen"}</b>
                </div>

                {m.barcode && (
                  <div style={{ margin: "0.4rem 0", background: "#fff", padding: "6px", borderRadius: "6px", border: "1px solid #f1f5f9", textAlign: "center" }}>
                    <BarcodeSvg value={m.barcode} width={1.6} height={42} />
                    <div style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#64748b", marginTop: "2px" }}>{m.barcode}</div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: "0.8rem", borderTop: "1px solid #f1f5f9", paddingTop: "0.6rem" }}>
                {isEditing ? (
                  <div onClick={(e) => e.stopPropagation()} style={{ background: "#f8fafc", padding: "8px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                      Enter Selling Price in Taka (৳):
                    </label>
                    <div className="row" style={{ gap: "4px" }}>
                      <input
                        type="number"
                        step="1"
                        placeholder="e.g. 399"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSavePrice(m.id, e);
                          if (e.key === "Escape") setEditingItemId(null);
                        }}
                        style={{ flex: 1, padding: "6px 8px", fontSize: "0.95rem", fontWeight: 700 }}
                      />
                      <button className="primary" style={{ padding: "6px 12px", fontSize: "0.82rem" }} disabled={saving} onClick={(e) => handleSavePrice(m.id, e)}>
                        {saving ? "..." : "Save"}
                      </button>
                      <button style={{ padding: "6px 8px", fontSize: "0.82rem", display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => { e.stopPropagation(); setEditingItemId(null); }}>
                        <IconClose size={13} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontSize: "0.75rem", color: "var(--gray)", display: "block" }}>Selling Price:</span>
                      <b style={{ color: hasPrice ? "var(--blue-primary)" : "#d97706", fontSize: "1.05rem" }}>
                        {hasPrice ? tk(m.price) : "Not Set (—)"}
                      </b>
                    </div>
                    <button
                      className={hasPrice ? "" : "primary"}
                      style={{ fontSize: "0.8rem", padding: "5px 12px", borderRadius: "6px" }}
                      onClick={(e) => handleStartEdit(m, e)}
                    >
                      {hasPrice ? "Edit Price" : "Set Price"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InventoryOverviewView({ token, api, userRole }) {
  const isManager = userRole === "owner" || userRole === "manager";
  const [summary, setSummary] = useState([]);
  const [ledger, setLedger] = useState([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterItem, setFilterItem] = useState("");
  const [filterType, setFilterType] = useState("");
  const [newBazar, setNewBazar] = useState({ name: "", barcode: "", unit: "g", pack_size: "100", min_stock: "100" });
  const [lastCreatedBazar, setLastCreatedBazar] = useState(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    try {
      const qs = new URLSearchParams();
      if (startDate) qs.set("start_date", startDate);
      if (endDate) qs.set("end_date", endDate);
      const lqs = new URLSearchParams(qs);
      if (filterItem) lqs.set("bazar_item_id", filterItem);
      if (filterType) lqs.set("type", filterType);

      const [inv, led] = await Promise.all([
        api(`/inventory?${qs.toString()}`, token),
        api(`/inventory/ledger?${lqs.toString()}`, token),
      ]);
      setSummary(inv);
      setLedger(led);
      setMsg("");
    } catch (e) {
      setMsg(e.message);
    }
  };

  useEffect(() => { load(); }, [token, startDate, endDate, filterItem, filterType]);

  const addBazarItem = async () => {
    if (!newBazar.name.trim()) return setMsg("Item name is required");
    try {
      const created = await api("/inventory", token, {
        name: newBazar.name.trim(),
        barcode: newBazar.barcode.trim() ? newBazar.barcode.trim().toUpperCase() : null,
        unit: newBazar.unit,
        pack_size: parseFloat(newBazar.pack_size || "100"),
        pack_unit: newBazar.unit === "g" ? `${newBazar.pack_size || 100}gm` : newBazar.unit === "ml" ? `${newBazar.pack_size || 100}ml` : `${newBazar.pack_size} ${newBazar.unit}`,
        min_stock: parseInt(newBazar.min_stock || "100", 10),
      });
      setNewBazar({ name: "", barcode: "", unit: "g", pack_size: "100", min_stock: "100" });
      setLastCreatedBazar(created);
      setMsg(`Bazar item "${created.name}" created! Barcode generated: ${created.barcode}`);
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const reverseEntry = async (entryId) => {
    const reason = window.prompt("Enter reason for reversal:");
    if (!reason || !reason.trim()) return;
    try {
      await api(`/inventory/ledger/${entryId}/reverse`, token, { reason: reason.trim() });
      setMsg("Reversal entry recorded in ledger.");
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const lowItems = summary.filter((i) => i.status === "LOW");

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {msg && <p className="card" style={{ background: "var(--blue-light)", color: "var(--blue-primary)", fontWeight: 600, margin: 0 }}>{msg}</p>}

      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <h3 style={{ margin: 0, color: "var(--blue-primary)" }}>Inventory Stock Summary</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.82rem" }}>From:</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <label style={{ fontSize: "0.82rem" }}>To:</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            {(startDate || endDate) && (
              <button className="secondary" onClick={() => { setStartDate(""); setEndDate(""); }}>Clear</button>
            )}
          </div>
        </div>

        <table className="data-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Bazar Item</th>
              <th>Monthly Opening Stock</th>
              <th>Bazar</th>
              <th>Sale</th>
              <th>Current Stock</th>
              <th>Min Stock</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((i) => (
              <tr key={i.id} style={{ background: i.status === "LOW" ? "var(--red-light)" : "transparent" }}>
                <td><b>{formatBazarName(i.name, i.base_unit || i.unit)}</b> <br /><small><code>{i.barcode}</code></small></td>
                <td>{formatQty(i.central_total, i.base_unit)}</td>
                <td>{formatQty(i.bazar_total, i.base_unit)}</td>
                <td>{formatQty(i.sale_total, i.base_unit)}</td>
                <td><b>{formatQty(i.current_stock, i.base_unit)}</b></td>
                <td>{formatQty(i.min_stock, i.base_unit)}</td>
                <td>
                  <span style={{ fontWeight: 700, color: i.status === "LOW" ? "var(--red)" : "var(--green)" }}>
                    {i.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div className="card">
          <h4 style={{ marginTop: 0, color: "var(--red)" }}>Shopping List ({lowItems.length} Low)</h4>
          {lowItems.length === 0 ? (
            <p style={{ color: "var(--gray)" }}>All items are above minimum stock.</p>
          ) : (
            <table className="data-table" style={{ width: "100%" }}>
              <thead><tr><th>Item</th><th>Current</th><th>Min</th><th>Suggested Buy</th></tr></thead>
              <tbody>
                {lowItems.map((i) => (
                  <tr key={i.id}>
                    <td><b>{formatBazarName(i.name, i.base_unit || i.unit)}</b></td>
                    <td>{formatQty(i.current_stock, i.base_unit)}</td>
                    <td>{formatQty(i.min_stock, i.base_unit)}</td>
                    <td style={{ color: "var(--blue-primary)", fontWeight: 700 }}>{formatQty(i.suggested_buy, i.base_unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {isManager && (
          <div className="card">
            <h4 style={{ marginTop: 0 }}>Add Bazar Item (Manual Entry)</h4>
            <p style={{ margin: "0 0 0.6rem", fontSize: "0.82rem", color: "var(--gray)" }}>
              Add ingredient name and details. A scannable Code128 barcode will be generated automatically if barcode is left blank.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <input placeholder="Name (e.g. Fresh Butter 100gm)" value={newBazar.name} onChange={(e) => setNewBazar({ ...newBazar, name: e.target.value })} />
              <input placeholder="Barcode (optional - auto-generated)" value={newBazar.barcode} onChange={(e) => setNewBazar({ ...newBazar, barcode: e.target.value })} />
              <select value={newBazar.unit} onChange={(e) => setNewBazar({ ...newBazar, unit: e.target.value })}>
                <option value="g">g (grams)</option>
                <option value="ml">ml (milliliters)</option>
                <option value="pcs">pcs (pieces)</option>
              </select>
              <input type="number" placeholder="Default Pack Size" value={newBazar.pack_size} onChange={(e) => setNewBazar({ ...newBazar, pack_size: e.target.value })} />
              <input type="number" placeholder="Min Stock (base unit)" value={newBazar.min_stock} onChange={(e) => setNewBazar({ ...newBazar, min_stock: e.target.value })} />
              <button className="primary" onClick={addBazarItem}>+ Add & Generate Barcode</button>
            </div>

            {lastCreatedBazar && (
              <div style={{ marginTop: "1rem", padding: "0.75rem", border: "2px solid var(--green)", borderRadius: "8px", background: "var(--green-light)", textAlign: "center" }}>
                <div style={{ fontWeight: 700, color: "#065f46", marginBottom: "0.4rem", display: "inline-flex", alignItems: "center", gap: "0.4rem", justifyContent: "center" }}>
                  <IconCheck size={16} color="#065f46" /> Successfully Created: {lastCreatedBazar.name}
                </div>
                <BarcodeSvg value={lastCreatedBazar.barcode} width={2.2} height={50} />
                <div style={{ fontSize: "0.8rem", color: "#065f46", marginTop: "4px" }}>
                  Barcode: <b>{lastCreatedBazar.barcode}</b> (Ready to scan or print on sheets)
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <h4 style={{ margin: 0 }}>Movement History (Append-Only Ledger)</h4>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <select value={filterItem} onChange={(e) => setFilterItem(e.target.value)}>
              <option value="">All Items</option>
              {summary.map((i) => <option key={i.id} value={i.id}>{formatBazarName(i.name, i.base_unit || i.unit)}</option>)}
            </select>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">All Types</option>
              <option value="central">Monthly Opening Stock</option>
              <option value="bazar">Bazar</option>
              <option value="sale">Sale</option>
              <option value="reversal">Reversal</option>
            </select>
          </div>
        </div>
        <table className="data-table" style={{ width: "100%" }}>
          <thead>
            <tr><th>Date</th><th>Item</th><th>Type</th><th>Qty</th><th>Who</th><th>Reason</th><th>Action</th></tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td><b>{formatBazarName(e.bazar_item_name, e.unit)}</b></td>
                <td><span style={{ textTransform: "uppercase", fontSize: "0.78rem", fontWeight: 700 }}>{e.type}</span></td>
                <td style={{ color: e.quantity < 0 ? "var(--red)" : "var(--green)", fontWeight: 700 }}>
                  {e.quantity > 0 ? `+${formatQty(e.quantity, e.unit)}` : formatQty(e.quantity, e.unit)}
                </td>
                <td>{e.created_by}</td>
                <td>{e.reason}</td>
                <td>
                  {isManager && e.type !== "reversal" && (
                    <button className="warn" style={{ minHeight: "32px", padding: "0.2rem 0.6rem" }} onClick={() => reverseEntry(e.id)}>
                      Reverse
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function InventorySuite({ token, api, userRole, onBack }) {
  const [tab, setTab] = useState("central");
  const [bazarItems, setBazarItems] = useState([]);
  const [approvedMenu, setApprovedMenu] = useState([]);

  const loadSheetsData = async () => {
    try {
      const [inv, menu] = await Promise.all([
        api("/inventory", token),
        api("/items?approved_only=true", token),
      ]);
      setBazarItems(inv);
      setApprovedMenu(menu);
    } catch {}
  };

  useEffect(() => {
    if (tab === "barcodes") loadSheetsData();
  }, [tab, token]);

  if (tab === "barcodes") {
    return <PrintableBarcodeSheet items={bazarItems} menuItems={approvedMenu} onBack={() => setTab("central")} />;
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, color: "var(--blue-primary)" }}>Barcode Inventory & Recipes</h2>
        {userRole !== "manager" && <button onClick={onBack}>Back to POS</button>}
      </div>

      <div className="nav-tabs">
        <button className={tab === "central" ? "active" : ""} onClick={() => setTab("central")}>Monthly Opening Stock</button>
        <button className={tab === "bazar" ? "active" : ""} onClick={() => setTab("bazar")}>Daily Bazar</button>
        <button className={tab === "sale" ? "active" : ""} onClick={() => setTab("sale")}>Daily Sale</button>
        <button className={tab === "recipes" ? "active" : ""} onClick={() => setTab("recipes")}>Recipes</button>
        <button className={tab === "menu" ? "active" : ""} onClick={() => setTab("menu")}>Menu</button>
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Inventory</button>
        <button className={tab === "barcodes" ? "active" : ""} onClick={() => setTab("barcodes")} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
          <IconPrinter size={15} />
          <span>Barcode Sheets</span>
        </button>
      </div>

      {(tab === "central" || tab === "bazar" || tab === "sale") && (
        <BatchScannerView batchType={tab} token={token} api={api} userRole={userRole} />
      )}
      {tab === "recipes" && <RecipesView token={token} api={api} userRole={userRole} />}
      {tab === "menu" && <MenuApprovedView token={token} api={api} userRole={userRole} />}
      {tab === "overview" && <InventoryOverviewView token={token} api={api} userRole={userRole} />}
    </div>
  );
}
