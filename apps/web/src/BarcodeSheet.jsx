import React, { useState, useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { IconPrinter, IconCutlery, IconShoppingBag, IconLayers, IconArrowLeft } from "./Icons";

export function BarcodeSvg({ value, width = 1.8, height = 48, showText = true }) {
  const svgRef = useRef(null);

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, String(value), {
          format: "CODE128",
          width,
          height,
          displayValue: showText,
          fontSize: 12,
          fontOptions: "bold",
          margin: 4,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch (e) {
        console.error("JsBarcode render error:", e);
      }
    }
  }, [value, width, height, showText]);

  return (
    <div style={{ textAlign: "center", display: "inline-block", background: "#fff", padding: "2px" }}>
      <svg ref={svgRef} style={{ display: "block", margin: "0 auto", maxWidth: "100%" }} />
    </div>
  );
}

// 6 Core Pantry Departments for Bazar Ingredients
const INGREDIENT_CATEGORIES = {
  "Proteins & Poultry": ["beef", "chicken", "prawn", "fish", "bacon", "egg", "wings", "strips", "thigh", "fillet", "meat", "tori"],
  "Dairy & Cold Storage": ["butter", "milk", "cheese", "cream", "yogurt", "ice cream", "mozzarella", "parmesan"],
  "Bakery & Starches": ["flour", "bread", "ciabatta", "bagel", "croissant", "rice", "pasta", "noodle", "breadcrumbs", "tortilla", "bun", "cornflour", "spaghetti", "fettuccine", "penne", "wrapper", "batter"],
  "Produce & Vegetables": ["lettuce", "tomato", "onion", "garlic", "ginger", "carrot", "cabbage", "capsicum", "cucumber", "lemon", "lime", "spring onion", "mushroom", "coriander", "herb", "parsley", "chilli", "potato", "avocado", "sprout", "cauliflower", "basil", "mint", "pickle", "rosemary", "grape", "spinach", "bean", "vegetable"],
  "Sauces, Pastes & Oils": ["sauce", "oil", "mayo", "mayonnaise", "paste", "ketchup", "mustard", "honey", "vinegar", "syrup", "dressing", "extract"],
  "Spices, Seasonings & Dry": ["salt", "pepper", "sugar", "paprika", "baking powder", "sesame", "ajinomoto", "powder", "cashew", "flakes", "cornstarch", "coffee", "cocoa", "nori", "oregano", "peanut", "chocolate"]
};

export const classifyIngredient = (name = "") => {
  const low = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(INGREDIENT_CATEGORIES)) {
    if (keywords.some(kw => low.includes(kw))) {
      return cat;
    }
  }
  return "Other Pantry";
};

export const formatBazarLabel = (item) => {
  const name = item.name || "";
  const u = (item.base_unit || item.unit || "g").toLowerCase();
  if ((u === "g" || u === "gm") && !name.toLowerCase().includes("gm")) {
    return `${name} 100gm`;
  }
  if (u === "ml" && !name.toLowerCase().includes("ml")) {
    return `${name} 100ml`;
  }
  return name;
};

export function PrintableBarcodeSheet({ items = [], menuItems = [], onBack }) {
  const [sectionFilter, setSectionFilter] = useState("all"); // "all", "dishes", "ingredients", "modifiers"
  const [specificCategory, setSpecificCategory] = useState("all");
  const [density, setDensity] = useState("3col"); // "3col" (A4 stickers) or "2col" (large)

  const quantityCodes = [
    { code: "QTY-X1", label: "× 1", desc: "Set quantity / count to 1", category: "Multipliers" },
    { code: "QTY-X5", label: "× 5", desc: "Set packs / count to 5", category: "Multipliers" },
    { code: "QTY-X10", label: "× 10", desc: "Set packs / count to 10", category: "Multipliers" },
    { code: "QTY-X50", label: "× 50", desc: "Set packs / count to 50", category: "Multipliers" },
    { code: "QTY-PLUS1KG", label: "+ 1 kg (1000gm)", desc: "Add 1 kg to scanned item", category: "Metric Units" },
    { code: "QTY-PLUS5KG", label: "+ 5 kg (5000gm)", desc: "Add 5 kg to scanned item", category: "Metric Units" },
    { code: "QTY-PLUS1L", label: "+ 1 L (1000ml)", desc: "Add 1 L to scanned item", category: "Metric Units" },
    { code: "QTY-PLUS5L", label: "+ 5 L (5000ml)", desc: "Add 5 L to scanned item", category: "Metric Units" },
  ];

  const bazarWithBarcodes = items.filter((i) => i.barcode);
  const menuWithBarcodes = menuItems.filter((m) => m.barcode);

  // Group Bazar items by classified department
  const groupedIngredients = {};
  bazarWithBarcodes.forEach(item => {
    const cat = classifyIngredient(item.name);
    if (!groupedIngredients[cat]) groupedIngredients[cat] = [];
    groupedIngredients[cat].push(item);
  });

  // Group Menu items by category
  const groupedDishes = {};
  menuWithBarcodes.forEach(m => {
    const cat = m.category || "General";
    if (!groupedDishes[cat]) groupedDishes[cat] = [];
    groupedDishes[cat].push(m);
  });

  // Calculate filtered counts
  const showDishes = sectionFilter === "all" || sectionFilter === "dishes";
  const showIngredients = sectionFilter === "all" || sectionFilter === "ingredients";
  const showModifiers = sectionFilter === "all" || sectionFilter === "modifiers";

  return (
    <div style={{ background: "#ffffff", padding: "1.2rem", borderRadius: "12px" }}>
      {/* Interactive Toolbar (Hidden during Print) */}
      <div className="no-print" style={{ borderBottom: "2px solid #e2e8f0", paddingBottom: "1.25rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.85rem", flexWrap: "wrap" }}>
            {onBack && (
              <button className="btn-back" onClick={onBack} style={{ marginTop: "2px" }}>
                <IconArrowLeft size={15} />
                <span>Back</span>
              </button>
            )}
            <div>
              <h2 style={{ margin: 0, color: "var(--brand-primary)", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <IconPrinter size={22} />
                <span>Organized Barcode Printing Sheets</span>
              </h2>
              <p style={{ margin: "4px 0 0", color: "var(--ink-muted)", fontSize: "0.88rem" }}>
                Organized by departments and menu categories. Formatted for standard A4 sticker paper (3 columns) or reference cards.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <button className="primary" onClick={() => window.print()} style={{ fontWeight: 700, padding: "0.5rem 1.25rem", fontSize: "0.95rem", display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              <IconPrinter size={16} />
              <span>Print Selected Sheets</span>
            </button>
          </div>
        </div>

        {/* Section Tabs */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.2rem", flexWrap: "wrap" }}>
          <button
            className={sectionFilter === "all" ? "primary" : "secondary"}
            style={{ fontSize: "0.85rem", padding: "6px 14px", borderRadius: "8px" }}
            onClick={() => { setSectionFilter("all"); setSpecificCategory("all"); }}
          >
            All Sections ({menuWithBarcodes.length + bazarWithBarcodes.length + quantityCodes.length})
          </button>
          <button
            className={sectionFilter === "dishes" ? "primary" : "secondary"}
            style={{ fontSize: "0.85rem", padding: "6px 14px", borderRadius: "8px" }}
            onClick={() => { setSectionFilter("dishes"); setSpecificCategory("all"); }}
          >
            Menu Dishes ({menuWithBarcodes.length})
          </button>
          <button
            className={sectionFilter === "ingredients" ? "primary" : "secondary"}
            style={{ fontSize: "0.85rem", padding: "6px 14px", borderRadius: "8px" }}
            onClick={() => { setSectionFilter("ingredients"); setSpecificCategory("all"); }}
          >
            Bazar Ingredients ({bazarWithBarcodes.length})
          </button>
          <button
            className={sectionFilter === "modifiers" ? "primary" : "secondary"}
            style={{ fontSize: "0.85rem", padding: "6px 14px", borderRadius: "8px" }}
            onClick={() => { setSectionFilter("modifiers"); setSpecificCategory("all"); }}
          >
            Quantity Modifiers ({quantityCodes.length})
          </button>
        </div>

        {/* Department Filter Sub-Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem", flexWrap: "wrap", gap: "0.75rem", background: "#f8fafc", padding: "0.75rem 1rem", borderRadius: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-muted)" }}>Filter Category:</span>
            <select
              value={specificCategory}
              onChange={(e) => setSpecificCategory(e.target.value)}
              style={{ fontSize: "0.85rem", padding: "5px 10px", borderRadius: "6px", border: "1.5px solid #cbd5e1" }}
            >
              <option value="all">All Categories in this section</option>
              {sectionFilter === "dishes" && Object.keys(groupedDishes).map(c => <option key={c} value={c}>{c}</option>)}
              {sectionFilter === "ingredients" && Object.keys(groupedIngredients).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-muted)" }}>Grid Density:</span>
            <button
              onClick={() => setDensity("3col")}
              style={{ padding: "4px 10px", fontSize: "0.8rem", background: density === "3col" ? "var(--brand-primary)" : "#fff", color: density === "3col" ? "#fff" : "var(--ink)" }}
            >
              3-Column (A4 Standard)
            </button>
            <button
              onClick={() => setDensity("2col")}
              style={{ padding: "4px 10px", fontSize: "0.8rem", background: density === "2col" ? "var(--brand-primary)" : "#fff", color: density === "2col" ? "#fff" : "var(--ink)" }}
            >
              2-Column (Large)
            </button>
          </div>
        </div>
      </div>

      {/* PRINT CONTAINER */}
      <div className="barcode-print-container">
        {/* Print Header for Physical Paper */}
        <div className="print-only-header" style={{ display: "none", borderBottom: "2px solid #000", paddingBottom: "6px", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <b style={{ fontSize: "16pt", letterSpacing: "-0.02em" }}>crownpointofsale</b>
              <span style={{ fontSize: "10pt", marginLeft: "10px", color: "#475569" }}>Official Barcode Catalog Sheet</span>
            </div>
            <div style={{ fontSize: "9pt", color: "#64748b" }}>
              Generated: {new Date().toLocaleDateString("en-GB")}
            </div>
          </div>
        </div>

        {/* 1. MENU DISHES */}
        {showDishes && (
          <div style={{ marginBottom: "2rem" }}>
            <div className="barcode-category-header" style={{ background: "#1e1b4b", color: "#ffffff", padding: "8px 14px", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, letterSpacing: "0.02em" }}>
                SECTION 1: MENU DISHES (SELLING)
              </h3>
              <span style={{ fontSize: "0.82rem", background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: "4px" }}>
                POS Counter Scannable
              </span>
            </div>

            {Object.entries(groupedDishes).map(([category, dishes]) => {
              if (specificCategory !== "all" && specificCategory !== category) return null;
              return (
                <div key={category} style={{ marginBottom: "1.25rem" }}>
                  <div className="barcode-category-header" style={{ borderBottom: "1.5px solid #6366f1", paddingBottom: "4px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <h4 style={{ margin: 0, color: "#312e81", fontSize: "1rem", fontWeight: 800 }}>
                      • {category} ({dishes.length} Items)
                    </h4>
                    <small style={{ color: "#64748b", fontSize: "0.75rem" }}>Category: {category}</small>
                  </div>
                  <div className={`barcode-sheet-grid ${density === "3col" ? "cols-3" : "cols-2"}`}>
                    {dishes.map((m) => (
                      <div
                        key={m.id || m.barcode}
                        className="barcode-label-card"
                        style={{
                          border: "1.5px solid #cbd5e1",
                          borderRadius: "8px",
                          padding: "8px",
                          textAlign: "center",
                          background: "#ffffff",
                          breakInside: "avoid",
                          pageBreakInside: "avoid",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b", fontWeight: 700, borderBottom: "1px solid #f1f5f9", paddingBottom: "3px", marginBottom: "4px" }}>
                          <span>{m.category || "DISH"}</span>
                          <span style={{ color: "#1e1b4b" }}>{m.price ? `৳${(m.price / 100).toFixed(0)}` : "Selling"}</span>
                        </div>
                        <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a", margin: "2px 0 4px", lineHeight: 1.2, minHeight: "28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {m.name}
                        </div>
                        <BarcodeSvg value={m.barcode} width={density === "3col" ? 1.5 : 1.9} height={density === "3col" ? 42 : 52} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 2. BAZAR INGREDIENTS */}
        {showIngredients && (
          <div style={{ marginBottom: "2rem" }}>
            <div className="barcode-category-header" style={{ background: "#065f46", color: "#ffffff", padding: "8px 14px", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, letterSpacing: "0.02em" }}>
                SECTION 2: BAZAR INGREDIENTS (STOCK & PURCHASES)
              </h3>
              <span style={{ fontSize: "0.82rem", background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: "4px" }}>
                Bazar & Opening Stock Intake
              </span>
            </div>

            {Object.entries(groupedIngredients).map(([dept, ingList]) => {
              if (specificCategory !== "all" && specificCategory !== dept) return null;
              return (
                <div key={dept} style={{ marginBottom: "1.25rem" }}>
                  <div className="barcode-category-header" style={{ borderBottom: "1.5px solid #10b981", paddingBottom: "4px", marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <h4 style={{ margin: 0, color: "#065f46", fontSize: "1rem", fontWeight: 800 }}>
                      {dept} ({ingList.length} Items)
                    </h4>
                    <small style={{ color: "#64748b", fontSize: "0.75rem" }}>Department Intake</small>
                  </div>
                  <div className={`barcode-sheet-grid ${density === "3col" ? "cols-3" : "cols-2"}`}>
                    {ingList.map((item) => (
                      <div
                        key={item.id || item.barcode}
                        className="barcode-label-card"
                        style={{
                          border: "1.5px solid #cbd5e1",
                          borderRadius: "8px",
                          padding: "8px",
                          textAlign: "center",
                          background: "#ffffff",
                          breakInside: "avoid",
                          pageBreakInside: "avoid",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b", fontWeight: 700, borderBottom: "1px solid #f1f5f9", paddingBottom: "3px", marginBottom: "4px" }}>
                          <span>{dept.split(" ")[0].replace(",", "") || "BAZAR"}</span>
                          <span style={{ color: "#0f766e" }}>{item.pack_unit || `${item.pack_size || 100}${item.base_unit || item.unit}`}</span>
                        </div>
                        <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#0f172a", margin: "2px 0 4px", lineHeight: 1.2, minHeight: "28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {formatBazarLabel(item)}
                        </div>
                        <BarcodeSvg value={item.barcode} width={density === "3col" ? 1.5 : 1.9} height={density === "3col" ? 42 : 52} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 3. QUANTITY MODIFIERS (COUNTER CHEAT SHEET) */}
        {showModifiers && (
          <div style={{ marginBottom: "1.25rem" }}>
            <div className="barcode-category-header" style={{ background: "#4338ca", color: "#ffffff", padding: "8px 14px", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, letterSpacing: "0.02em" }}>
                SECTION 3: SCANNER MODIFIER CHEAT CODES
              </h3>
              <span style={{ fontSize: "0.82rem", background: "rgba(255,255,255,0.2)", padding: "2px 8px", borderRadius: "4px" }}>
                Scan After Item to Multiply
              </span>
            </div>
            <div className={`barcode-sheet-grid ${density === "3col" ? "cols-3" : "cols-2"}`}>
              {quantityCodes.map((q) => (
                <div
                  key={q.code}
                  className="barcode-label-card"
                  style={{
                    border: "2px dashed #4338ca",
                    borderRadius: "8px",
                    padding: "8px",
                    textAlign: "center",
                    background: "#f8fafc",
                    breakInside: "avoid",
                    pageBreakInside: "avoid"
                  }}
                >
                  <div style={{ fontSize: "0.72rem", color: "#4338ca", fontWeight: 800, marginBottom: "2px" }}>
                    {q.category.toUpperCase()}
                  </div>
                  <div style={{ fontSize: "1.15rem", fontWeight: 900, color: "#1e1b4b" }}>
                    {q.label}
                  </div>
                  <BarcodeSvg value={q.code} width={1.6} height={42} />
                  <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "2px" }}>
                    {q.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
