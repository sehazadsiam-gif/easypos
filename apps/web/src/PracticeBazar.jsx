import { useState, useEffect, useRef } from "react";
import { PrintableBarcodeSheet, BarcodeSvg } from "./BarcodeSheet";

const tk = (p) => "৳" + (p / 100).toFixed(2);

export function PracticeBazarView({ onExitToPOS }) {
  const [subview, setSubview] = useState("scanner"); // "scanner", "barcodes", "inventory", "items"
  const [practiceItems, setPracticeItems] = useState([]);
  const [tripsHistory, setTripsHistory] = useState([]);
  const [cart, setCart] = useState([]); // { item, pack_count, unit_cost, total_cost }
  const [barcodeInput, setBarcodeInput] = useState("");
  const [lastScanned, setLastScanned] = useState(null);
  const [tripName, setTripName] = useState(`Morning Bazar - Practice`);
  const [shopperName, setShopperName] = useState("Staff");
  const [cameraActive, setCameraActive] = useState(false);
  const [msg, setMsg] = useState("");
  const scanInputRef = useRef(null);
  const videoRef = useRef(null);

  const fetchItems = async () => {
    try {
      const res = await fetch("/api/practice-bazar/items").then(r => r.json());
      setPracticeItems(res);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTrips = async () => {
    try {
      const res = await fetch("/api/practice-bazar/trips").then(r => r.json());
      setTripsHistory(res);
    } catch (e) {}
  };

  useEffect(() => {
    fetchItems();
    fetchTrips();
  }, [subview]);

  // Auto-focus lock for USB barcode gun
  useEffect(() => {
    const focusInterval = setInterval(() => {
      if (subview === "scanner" && !cameraActive && scanInputRef.current) {
        if (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "SELECT") {
          scanInputRef.current.focus();
        }
      }
    }, 1500);
    return () => clearInterval(focusInterval);
  }, [subview, cameraActive]);

  // Handle scanned barcode input (Item or Quantity Modifier)
  const handleBarcodeSubmit = (codeRaw) => {
    const code = codeRaw.trim().toUpperCase();
    if (!code) return;

    // Check if it's a Quantity Modifier Action code
    if (code.startsWith("QTY-")) {
      if (cart.length === 0) {
        setMsg("Scan an item first before scanning a quantity multiplier!");
        setBarcodeInput("");
        return;
      }
      const lastItemIdx = cart.length - 1;
      const target = cart[lastItemIdx];
      let newCount = target.pack_count;

      if (code === "QTY-X1") newCount = 1;
      else if (code === "QTY-X5") newCount = 5;
      else if (code === "QTY-X10") newCount = 10;
      else if (code === "QTY-X50") newCount = 50;
      else if (code === "QTY-PLUS1KG") {
        const addedPacks = 1000 / (target.item.pack_size || 1000);
        newCount += addedPacks;
      } else if (code === "QTY-PLUS5KG") {
        const addedPacks = 5000 / (target.item.pack_size || 1000);
        newCount += addedPacks;
      }

      const updated = [...cart];
      updated[lastItemIdx] = {
        ...target,
        pack_count: newCount,
        total_cost: Math.round(newCount * target.unit_cost)
      };
      setCart(updated);
      setMsg(`Multiplier applied: ${code} on ${target.item.name}`);
      setBarcodeInput("");
      return;
    }

    // Check if it's an Item barcode
    const matchedItem = practiceItems.find(
      i => i.barcode.toUpperCase() === code || i.id.toString() === code
    );

    if (matchedItem) {
      setLastScanned(matchedItem);
      // Check if already in active trip
      const existingIdx = cart.findIndex(c => c.item.id === matchedItem.id);
      if (existingIdx >= 0) {
        const updated = [...cart];
        updated[existingIdx].pack_count += 1;
        updated[existingIdx].total_cost = Math.round(updated[existingIdx].pack_count * updated[existingIdx].unit_cost);
        setCart(updated);
      } else {
        setCart(prev => [
          ...prev,
          {
            item: matchedItem,
            pack_count: 1,
            unit_cost: matchedItem.default_cost || 5000,
            total_cost: matchedItem.default_cost || 5000
          }
        ]);
      }
      setMsg(`Scanned: ${matchedItem.name} (+1 pack)`);
    } else {
      setMsg(`Unrecognized Barcode: ${code}. Verify item barcode.`);
    }

    setBarcodeInput("");
  };

  // Simulate mobile camera scanner viewfinder
  const startCameraScan = () => {
    setCameraActive(true);
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(() => {
        alert("Camera preview simulated. Use manual photo or handheld scanner.");
      });
  };

  const stopCameraScan = () => {
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    }
    setCameraActive(false);
  };

  // Approve Practice Trip
  const approveTrip = async () => {
    if (cart.length === 0) return setMsg("Cart is empty. Scan items first!");
    const payload = {
      trip_name: tripName,
      shopper_name: shopperName,
      lines: cart.map(c => ({
        item_id: c.item.id,
        pack_count: c.pack_count,
        unit_cost: c.unit_cost,
        total_cost: c.total_cost
      }))
    };

    try {
      const res = await fetch("/api/practice-bazar/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(r => r.json());

      if (res.id) {
        alert(`Practice Trip #${res.id} Approved! Practice stock incremented without touching real production inventory.`);
        setCart([]);
        fetchItems();
        fetchTrips();
      }
    } catch (e) {
      setMsg(e.message);
    }
  };

  // 1-Click Reset Sandbox
  const resetSandbox = async () => {
    if (!confirm("Are you sure you want to RESET the entire Practice Sandbox? All practice movements will be cleared.")) return;
    try {
      await fetch("/api/practice-bazar/reset", { method: "POST" });
      alert("Practice Sandbox Reset to Clean Baseline!");
      setCart([]);
      fetchItems();
      fetchTrips();
    } catch (e) {
      alert(e.message);
    }
  };

  // Simulate Kitchen Usage
  const simulateUsage = async (itemId) => {
    const qty = prompt("Quantity consumed in kitchen (e.g. 2000 for 2kg/2L):", "1000");
    if (!qty) return;
    try {
      await fetch("/api/practice-bazar/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, qty_used: parseFloat(qty), reason: "Simulated Shift Prep" })
      });
      fetchItems();
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div style={{ maxWidth: 1240, margin: "0 auto" }}>
      {/* Top Banner Header: Public Practice Mode */}
      <div style={{ background: "linear-gradient(135deg, #1e3a8a, #2563eb)", color: "#fff", padding: "1rem 1.5rem", borderRadius: "12px", marginBottom: "1.2rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.3rem" }}>🛒</span>
            <h2 style={{ margin: 0, fontSize: "1.35rem" }}>Daily Bazar (Practice Sandbox Mode)</h2>
            <span style={{ background: "#f59e0b", color: "#000", fontWeight: 800, padding: "2px 8px", borderRadius: "6px", fontSize: "0.75rem" }}>
              ZERO RISK / ISOLATED
            </span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", opacity: 0.9 }}>
            2-Week Training Environment for Staff & Managers. Practice USB guns and mobile camera scans freely.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }} onClick={resetSandbox}>
            🔄 1-Click Reset Stock
          </button>
          {onExitToPOS && <button style={{ background: "#ffffff", color: "#1e3a8a" }} onClick={onExitToPOS}>Exit Sandbox</button>}
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="nav-tabs" style={{ marginBottom: "1rem" }}>
        <button className={subview === "scanner" ? "active" : ""} onClick={() => setSubview("scanner")}>
          📷 Live Barcode Scanner & Trips
        </button>
        <button className={subview === "barcodes" ? "active" : ""} onClick={() => setSubview("barcodes")}>
          🖨 Print Barcode Sheets (A4)
        </button>
        <button className={subview === "inventory" ? "active" : ""} onClick={() => setSubview("inventory")}>
          📦 Practice Stock & Usage
        </button>
      </div>

      {msg && (
        <div style={{ background: "var(--blue-light)", color: "var(--blue-primary)", padding: "0.75rem 1rem", borderRadius: "8px", fontWeight: 600, marginBottom: "1rem" }} onClick={() => setMsg("")}>
          {msg}
        </div>
      )}

      {/* SUBVIEW: Printable Barcode Sheets */}
      {subview === "barcodes" && (
        <PrintableBarcodeSheet items={practiceItems} onBack={() => setSubview("scanner")} />
      )}

      {/* SUBVIEW: Practice Inventory & Usage */}
      {subview === "inventory" && (
        <div className="card">
          <div className="row" style={{ marginBottom: "1rem" }}>
            <h3 style={{ margin: 0 }}>Practice Stock & Virtual Par Levels</h3>
            <button className="primary" onClick={fetchItems}>Refresh Stock</button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Item Name</th>
                <th>Pack Format</th>
                <th>Current Practice Stock</th>
                <th>Par Level</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {practiceItems.map(i => (
                <tr key={i.id}>
                  <td><code>{i.barcode}</code></td>
                  <td><b>{i.name}</b></td>
                  <td>{i.pack_unit} ({i.pack_size} {i.base_unit})</td>
                  <td style={{ fontSize: "1.05rem", fontWeight: "bold", color: i.current_stock < i.par_level ? "var(--red)" : "var(--green)" }}>
                    {i.current_stock} {i.base_unit}
                  </td>
                  <td>{i.par_level * i.pack_size} {i.base_unit}</td>
                  <td>
                    <button className="secondary" style={{ padding: "0.2rem 0.6rem", minHeight: "30px", fontSize: "0.8rem" }} onClick={() => simulateUsage(i.id)}>
                      Simulate Usage (Deduct)
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SUBVIEW: Live Barcode Scanner & Active Trip */}
      {subview === "scanner" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "1.2rem" }}>
          {/* Left Column: Barcode Inputs & Scanned Trip Cart */}
          <div>
            <div className="card" style={{ marginBottom: "1rem", border: "2px solid var(--blue-primary)" }}>
              <div className="row">
                <h3 style={{ margin: 0, color: "var(--blue-primary)" }}>Scan Barcode / Gun Receiver</h3>
                <div>
                  {!cameraActive ? (
                    <button className="primary" onClick={startCameraScan}>📸 Camera Scan</button>
                  ) : (
                    <button className="warn" onClick={stopCameraScan}>Stop Camera</button>
                  )}
                </div>
              </div>

              {/* Camera Video Viewfinder */}
              {cameraActive && (
                <div style={{ position: "relative", width: "100%", height: "240px", background: "#000", borderRadius: "8px", margin: "1rem 0", overflow: "hidden" }}>
                  <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <div style={{ position: "absolute", top: "50%", left: "10%", right: "10%", height: "2px", background: "red", boxShadow: "0 0 8px red" }} />
                  <div style={{ position: "absolute", bottom: "10px", left: "0", right: "0", textAlign: "center", color: "#fff", background: "rgba(0,0,0,0.6)", padding: "4px" }}>
                    Align Code 128 / UPC barcode inside the red target line
                  </div>
                </div>
              )}

              {/* USB Gun Input Box with Auto-Focus */}
              <div style={{ marginTop: "1rem" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--gray)" }}>
                  Scan Target (Auto-Focus Active):
                </label>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.4rem" }}>
                  <input
                    ref={scanInputRef}
                    placeholder="Scan with USB gun or type barcode (e.g. ITEM-MILK or QTY-X5)"
                    style={{ flex: 1, fontSize: "1.1rem", padding: "0.75rem", border: "2px solid var(--blue-primary)", borderRadius: "8px" }}
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        handleBarcodeSubmit(barcodeInput);
                      }
                    }}
                  />
                  <button className="primary" onClick={() => handleBarcodeSubmit(barcodeInput)}>Enter</button>
                </div>
              </div>

              {/* Quick Modifier Action Chips */}
              <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--gray)", fontWeight: 600 }}>Quick Modifiers:</span>
                {["QTY-X1", "QTY-X5", "QTY-X10", "QTY-X50", "QTY-PLUS1KG", "QTY-PLUS5KG"].map(q => (
                  <button key={q} className="secondary" style={{ padding: "0.2rem 0.6rem", minHeight: "28px", fontSize: "0.75rem" }} onClick={() => handleBarcodeSubmit(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Scanned Items in Active Trip */}
            <div className="card">
              <div className="row" style={{ marginBottom: "0.8rem" }}>
                <h3 style={{ margin: 0 }}>Scanned Trip Items ({cart.length})</h3>
                {cart.length > 0 && <button className="warn" style={{ minHeight: "32px", padding: "0.2rem 0.6rem" }} onClick={() => setCart([])}>Clear Trip</button>}
              </div>

              {cart.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--gray)" }}>
                  <div style={{ fontSize: "2.5rem" }}>⚡</div>
                  <b>No items scanned yet.</b>
                  <p style={{ margin: "0.5rem 0 0", fontSize: "0.9rem" }}>
                    Scan barcodes on test boxes or click sample barcodes below to practice.
                  </p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Pack Size</th>
                      <th>Quantity (Packs)</th>
                      <th>Cost Paid</th>
                      <th>Total</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((c, idx) => (
                      <tr key={idx}>
                        <td>
                          <b>{c.item.name}</b>
                          <div style={{ fontSize: "0.75rem", color: "var(--gray)" }}>{c.item.barcode}</div>
                        </td>
                        <td>{c.item.pack_unit}</td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                            <button style={{ minHeight: "28px", padding: "0.1rem 0.5rem" }} onClick={() => {
                              const updated = [...cart];
                              updated[idx].pack_count = Math.max(1, updated[idx].pack_count - 1);
                              updated[idx].total_cost = Math.round(updated[idx].pack_count * updated[idx].unit_cost);
                              setCart(updated);
                            }}>−</button>
                            <b>{c.pack_count}</b>
                            <button style={{ minHeight: "28px", padding: "0.1rem 0.5rem" }} onClick={() => {
                              const updated = [...cart];
                              updated[idx].pack_count += 1;
                              updated[idx].total_cost = Math.round(updated[idx].pack_count * updated[idx].unit_cost);
                              setCart(updated);
                            }}>+</button>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            style={{ width: "80px", padding: "0.3rem" }}
                            value={(c.total_cost / 100).toFixed(0)}
                            onChange={(e) => {
                              const val = Math.round(parseFloat(e.target.value || "0") * 100);
                              const updated = [...cart];
                              updated[idx].total_cost = val;
                              updated[idx].unit_cost = Math.round(val / (c.pack_count || 1));
                              setCart(updated);
                            }}
                          />
                        </td>
                        <td><b>{tk(c.total_cost)}</b></td>
                        <td>
                          <button className="warn" style={{ minHeight: "28px", padding: "0.1rem 0.5rem" }} onClick={() => {
                            setCart(cart.filter((_, i) => i !== idx));
                          }}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Quick-Click Sample Practice Catalogue */}
            <div className="card" style={{ marginTop: "1rem" }}>
              <h4>Quick Practice Item Buttons (Click to Simulate Scan):</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: "0.5rem" }}>
                {practiceItems.map(item => (
                  <button key={item.id} className="tile" style={{ minHeight: "70px", padding: "0.5rem" }} onClick={() => handleBarcodeSubmit(item.barcode)}>
                    <span style={{ fontSize: "0.85rem" }}>{item.name}</span>
                    <small style={{ color: "var(--blue-primary)", fontWeight: 700 }}>{item.pack_unit}</small>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Trip Approval Card & Recent Trips */}
          <div>
            <div className="card" style={{ marginBottom: "1rem" }}>
              <h3>Approve Practice Trip</h3>
              <p>
                <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Trip Label</label>
                <input style={{ width: "100%", marginTop: "0.3rem" }} value={tripName} onChange={e => setTripName(e.target.value)} />
              </p>
              <p>
                <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Shopper / Staff Name</label>
                <input style={{ width: "100%", marginTop: "0.3rem" }} value={shopperName} onChange={e => setShopperName(e.target.value)} />
              </p>

              <div className="sum">
                <div className="row"><span>Total Items</span><b>{cart.reduce((s, c) => s + c.pack_count, 0)} packs</b></div>
                <div className="row" style={{ fontSize: "1.2rem", fontWeight: "bold", color: "var(--blue-primary)", marginTop: "0.5rem" }}>
                  <span>Grand Total</span>
                  <span>{tk(cart.reduce((s, c) => s + c.total_cost, 0))}</span>
                </div>
              </div>

              <button className="primary" style={{ width: "100%", marginTop: "1rem", minHeight: "46px", fontSize: "1.05rem" }} onClick={approveTrip}>
                Approve & Receive Stock
              </button>
            </div>

            {/* Recent Practice Trips History */}
            <div className="card">
              <h4>Recent Practice Trips</h4>
              <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                {tripsHistory.length === 0 ? <p style={{ color: "var(--gray)", fontSize: "0.85rem" }}>No trips completed yet.</p> : (
                  tripsHistory.map(t => (
                    <div key={t.id} style={{ borderBottom: "1px solid var(--line)", padding: "0.5rem 0" }}>
                      <div className="row">
                        <b>{t.trip_name}</b>
                        <span style={{ color: "var(--blue-primary)", fontWeight: "bold" }}>{tk(t.total_cost)}</span>
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "var(--gray)" }}>
                        {t.shopper_name} · {t.item_count} items · {t.created_at.slice(11, 16)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
