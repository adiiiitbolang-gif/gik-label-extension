// Central Kitchen stock, calculated live from what is already recorded (no copies, no automation runs):
//   in   + WMS Outbond rows with Tujuan Outlet = Central Kitchen (batch no, arrival, expiry from the WMS)
//        + production output (Production Batches)
//   out  - production usage through the BOM: Recipe Lines "Qty per Yield" × batches made (= the Base's Std Used)
//        - Pengiriman to outlets (Packing Lines; old "Central Kitchen" repack rows are not stock moves)
// Outs are taken from the oldest batch first (FIFO); a pengiriman with a known lot takes that lot.
// Repacking changes packaging only, so it does not appear here.
// Everything counts from CK_START: what was physically at CK before that is not known (no opening count yet).
export const CK_START = new Date(2026, 9, 20).getTime(); // 20 Oct 2026, 00:00
export const CK_DEST = "Central Kitchen";

// "Pack @1 Kg" -> { n: 1000, u: "gram" }; "Kg" -> 1000 g; "PACK @ 946 ML" -> 946 ml; "Box@50 pcs" -> 50 pcs.
const BASE = { g: ["gram", 1], gr: ["gram", 1], gram: ["gram", 1], kg: ["gram", 1000], ml: ["ml", 1], l: ["ml", 1000], lt: ["ml", 1000], liter: ["ml", 1000], pcs: ["pcs", 1], pc: ["pcs", 1] };
function unitSize(unit) {
  const s = String(unit || "").toLowerCase().trim();
  const m = s.match(/@\s*([\d.,]+)\s*([a-z]+)/) || s.match(/^([\d.,]*)\s*([a-z]+)$/);
  if (!m) return null;
  const b = BASE[m[2]];
  if (!b) return null;
  const n = m[1] ? parseFloat(m[1].replace(",", ".")) : 1;
  return n > 0 ? { u: b[0], n: n * b[1] } : null;
}
// Factor from a WMS unit to the CK (BOM) unit, or null when they can't be matched.
export function unitFactor(from, to) {
  if (String(from || "").trim().toLowerCase() === String(to || "").trim().toLowerCase()) return 1;
  const a = unitSize(from);
  const b = unitSize(to);
  return a && b && a.u === b.u ? a.n / b.n : null;
}

export function createCkStock({ searchAll, txt, num, getItems }) {
  let data = { items: new Map(), at: 0 };
  let loading = null;
  const linkIds = (x) => (Array.isArray(x) ? x.flatMap((v) => v.record_ids || (v.id ? [v.id] : [])) : []);

  async function load(force = false) {
    if (data.at && !force) return data;
    if (loading) return loading;
    loading = (async () => {
      const [ob, wmsItems, batches, lines, packs] = await Promise.all([
        searchAll("wmsBatches", { field_names: ["Batch No", "Item", "Qty Transfer", "Tgl Kirim Rencana", "Tgl Datang Teks", "Tgl Expired Teks", "Kunci FIFO", "Tujuan Outlet", "Tahan Kirim"], filter: { conjunction: "and", conditions: [{ field_name: "Tujuan Outlet", operator: "is", value: [CK_DEST] }] }, automatic_fields: false }),
        searchAll("wmsItems", { field_names: ["Product Code", "Unit"], automatic_fields: false }),
        searchAll("batches", { field_names: ["Recipe", "Product Code", "Product Name", "Lot Code", "Batch No", "Actual Output Qty", "Unit", "Scale Factor", "Production Date", "Prod Date (label)", "Expiry (label)", "Storage"], automatic_fields: false }),
        searchAll("recipeLines", { field_names: ["Recipe", "Ingredient Code", "Qty per Yield", "Ingredient Unit"], automatic_fields: false }),
        searchAll("packing", { field_names: ["Item Code", "Outlet", "Total Qty", "Batch Used", "Packing Date"], automatic_fields: false }),
      ]);
      const items = new Map(); // code -> { code, name, unit, cat, lots: [], used, sent, inQty, warn }
      const prodItems = new Map(getItems().map((i) => [i.code, i]));
      // CK counts in the BOM unit (what recipes use); items not in any recipe keep their own unit.
      const bomUnit = new Map(lines.map((l) => [txt(l.fields["Ingredient Code"]), txt(l.fields["Ingredient Unit"])]).filter(([c, u]) => c && u));
      const entry = (code) => {
        if (!items.has(code)) {
          const it = prodItems.get(code);
          items.set(code, { code, name: it?.name || code, unit: bomUnit.get(code) || it?.unit || "", cat: it?.cat || "", storage: it?.storage || "", lots: [], inQty: 0, used: 0, sent: 0, warn: "" });
        }
        return items.get(code);
      };
      const wmsById = new Map(wmsItems.map((r) => [r.record_id, { code: txt(r.fields["Product Code"]), unit: txt(r.fields.Unit) }]));
      const today = Date.now();

      // In: warehouse -> CK (Outbond rows), converted from the WMS unit to the CK unit.
      for (const r of ob) {
        const f = r.fields;
        const when = num(f["Tgl Kirim Rencana"]);
        if (when < CK_START || when > today || f["Tahan Kirim"] === true) continue;
        const wi = wmsById.get(linkIds(f.Item)[0]);
        if (!wi?.code) continue;
        const e = entry(wi.code);
        const k = unitFactor(wi.unit, e.unit || wi.unit);
        if (!e.unit) e.unit = wi.unit;
        if (k == null) { e.warn = `Unit WMS "${wi.unit}" ≠ "${e.unit}"`; continue; }
        const q = num(f["Qty Transfer"]) * k;
        e.inQty += q;
        e.lots.push({ id: `ob:${r.record_id}`, lot: `#${txt(f["Batch No"])}`, date: txt(f["Tgl Datang Teks"]), exp: txt(f["Tgl Expired Teks"]), fifo: num(f["Kunci FIFO"]) || when, qty: q, left: q, from: "WMS" });
      }

      // In: what CK made. Out: what it used, through the BOM.
      const bom = new Map(); // recipe id -> [{ code, qty }]
      for (const l of lines) for (const rid of linkIds(l.fields.Recipe)) {
        if (!bom.has(rid)) bom.set(rid, []);
        bom.get(rid).push({ code: txt(l.fields["Ingredient Code"]), qty: num(l.fields["Qty per Yield"]) });
      }
      const usage = new Map();
      for (const b of batches) {
        const f = b.fields;
        const when = num(f["Production Date"]);
        if (when < CK_START) continue;
        const code = txt(f["Product Code"]);
        const out = num(f["Actual Output Qty"]);
        if (code && out > 0) {
          const e = entry(code);
          if (!e.unit) e.unit = txt(f.Unit);
          e.inQty += out;
          e.lots.push({ id: `pb:${b.record_id}`, rec: b.record_id, lot: txt(f["Lot Code"]) || txt(f["Batch No"]), date: txt(f["Prod Date (label)"]), exp: txt(f["Expiry (label)"]), storage: txt(f.Storage), fifo: when, qty: out, left: out, from: "Produksi" });
        }
        const runs = num(f["Scale Factor"]);
        for (const rid of linkIds(f.Recipe)) for (const l of bom.get(rid) || []) {
          if (l.code) usage.set(l.code, (usage.get(l.code) || 0) + l.qty * runs);
        }
      }

      const take = (e, qty, lot) => {
        let left = qty;
        const pool = e.lots.filter((x) => x.left > 0).sort((a, b) => a.fifo - b.fifo);
        const first = lot ? pool.filter((x) => x.lot === lot) : [];
        for (const x of [...first, ...pool]) {
          if (left <= 0) break;
          const t = Math.min(x.left, left);
          x.left -= t;
          left -= t;
        }
        return left; // not covered by any known batch
      };
      for (const [code, qty] of usage) { const e = entry(code); e.used += qty; e.short = (e.short || 0) + take(e, qty); }
      for (const p of packs) {
        const f = p.fields;
        if (num(f["Packing Date"]) < CK_START || txt(f.Outlet) === CK_DEST) continue;
        const e = entry(txt(f["Item Code"]));
        const q = num(f["Total Qty"]);
        e.sent += q;
        e.short = (e.short || 0) + take(e, q, txt(f["Batch Used"]));
      }
      for (const e of items.values()) {
        e.left = e.inQty - e.used - e.sent;
        e.lots.sort((a, b) => a.fifo - b.fifo);
      }
      data = { items, at: Date.now() };
      return data;
    })().finally(() => (loading = null));
    return loading;
  }

  return {
    load,
    get: () => data,
    item: (code) => data.items.get(code),
    // Batches still at CK for one item, oldest first.
    lots: (code) => (data.items.get(code)?.lots || []).filter((x) => x.left > 0.0001),
  };
}
