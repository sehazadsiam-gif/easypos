import React, { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function BarcodeSvg({ value, width = 2, height = 60, showText = true }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, String(value), {
          format: "CODE128",
          width,
          height,
          displayValue: showText,
          fontSize: 14,
          fontOptions: "bold",
          margin: 6,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch (e) {
        console.error("JsBarcode render error:", e);
      }
    }
  }, [value, width, height, showText]);

  return (
    <div style={{ textAlign: "center", display: "inline-block", background: "#fff", padding: "4px" }}>
      <svg ref={svgRef} style={{ display: "block", margin: "0 auto", maxWidth: "100%" }} />
    </div>
  );
}

export function PrintableBarcodeSheet({ items = [], menuItems = [], onBack }) {
  const quantityCodes = [
    { code: "QTY-X1", label: "× 1", desc: "Set quantity / servings to 1" },
    { code: "QTY-X5", label: "× 5", desc: "Set packs / servings to 5" },
    { code: "QTY-X10", label: "× 10", desc: "Set packs / servings to 10" },
    { code: "QTY-X50", label: "× 50", desc: "Set packs / servings to 50" },
    { code: "QTY-PLUS1KG", label: "+ 1 kg (1000 g)", desc: "Add 1 kg to last scanned item" },
    { code: "QTY-PLUS5KG", label: "+ 5 kg (5000 g)", desc: "Add 5 kg to last scanned item" },
    { code: "QTY-PLUS1L", label: "+ 1 L (1000 ml)", desc: "Add 1 L to last scanned item" },
    { code: "QTY-PLUS5L", label: "+ 5 L (5000 ml)", desc: "Add 5 L to last scanned item" },
  ];

  const bazarWithBarcodes = items.filter((i) => i.barcode);
  const approvedMenuWithBarcodes = menuItems.filter((m) => m.barcode);

  return (
    <div style={{ background: "#ffffff", padding: "1.5rem", borderRadius: "10px" }}>
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--blue-primary)" }}>Printable A4 Barcode Sheets (Code 128)</h2>
          <p style={{ margin: "4px 0 0", color: "var(--gray)", fontSize: "0.9rem" }}>
            High-contrast Code 128 barcodes sized for USB barcode scanners.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="primary" onClick={() => window.print()}>🖨 Print A4 Sheet</button>
          {onBack && <button onClick={onBack}>Back</button>}
        </div>
      </div>

      <div className="barcode-print-container">
        <h3 style={{ borderBottom: "2px solid #000", paddingBottom: "4px", margin: "1rem 0" }}>
          1. BAZAR ITEMS ({bazarWithBarcodes.length})
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
          {bazarWithBarcodes.map((item) => (
            <div key={item.id || item.barcode} style={{ border: "2px solid #000", padding: "12px", borderRadius: "6px", textAlign: "center", pageBreakInside: "avoid" }}>
              <BarcodeSvg value={item.barcode} width={2.2} height={64} />
              <div style={{ fontSize: "1.1rem", fontWeight: "bold", marginTop: "4px" }}>
                {item.name}{(item.base_unit === 'g' || item.unit === 'g') && !item.name.toLowerCase().includes('gm') ? ' 100gm' : ''}
              </div>
              <div style={{ color: "#444", fontSize: "0.85rem" }}>
                Pack: <b>{item.pack_unit || ((item.base_unit === 'g' || item.unit === 'g') ? '100gm' : `${item.pack_size} ${item.base_unit || item.unit}`)}</b>
              </div>
            </div>
          ))}
        </div>

        {approvedMenuWithBarcodes.length > 0 && (
          <>
            <h3 style={{ borderBottom: "2px solid #000", paddingBottom: "4px", margin: "2rem 0 1rem" }}>
              2. APPROVED MENU ITEMS ({approvedMenuWithBarcodes.length})
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
              {approvedMenuWithBarcodes.map((m) => (
                <div key={m.id || m.barcode} style={{ border: "2px solid #1d4ed8", padding: "12px", borderRadius: "6px", textAlign: "center", pageBreakInside: "avoid" }}>
                  <BarcodeSvg value={m.barcode} width={2.2} height={64} />
                  <div style={{ fontSize: "1.1rem", fontWeight: "bold", marginTop: "4px" }}>{m.name}</div>
                  {m.price != null && (
                    <div style={{ color: "#444", fontSize: "0.85rem" }}>৳{(m.price / 100).toFixed(2)}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <h3 style={{ borderBottom: "2px solid #000", paddingBottom: "4px", margin: "2rem 0 1rem" }}>
          {approvedMenuWithBarcodes.length > 0 ? "3." : "2."} QUANTITY MODIFIER CODES (SCAN AFTER ITEM)
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
          {quantityCodes.map((q) => (
            <div key={q.code} style={{ border: "2px dashed #000", padding: "12px", borderRadius: "6px", textAlign: "center", pageBreakInside: "avoid" }}>
              <BarcodeSvg value={q.code} width={2.2} height={58} />
              <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#1d4ed8", marginTop: "4px" }}>{q.label}</div>
              <div style={{ fontSize: "0.8rem", color: "#555" }}>{q.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
