import { esc, encodeLine, qrLink } from "./labels.js";
import { fmtQty, liveQty, packCalc } from "./qty.js";

// Repacking: any item, re-portioned into new packs with a label each, at Central Kitchen or the warehouse.
// Only the packaging changes, so no stock moves; each line is kept in "Repack Lines" for reprints.
//   Central Kitchen: items from the Production base.   Gudang: items from the WMS master.
// Source batch and expiry, wherever the repack happens:
//   Finished Goods / WIP: a production batch from the Production base; its expiry is used as is.
//   Raw materials & others: an active WMS stock batch (FIFO first); its expiry is prefilled and can be corrected.
// Label: name · batch + qty · repack date · expiry; the QR opens the Repack Lines row.
export const LOCATIONS = ["Central Kitchen", "Gudang"];
const PRODUCED = ["Finished Goods", "Work In Process"];
export const isProduced = (it) => PRODUCED.includes(it?.cat);

export function createRepack({ $, base, txt, num, fmt, store, status, wms, ck, getItems, getBatches, loadBatches, openLabels, updateBar }) {
  let loc = LOCATIONS.includes(store.get("gik.repack.loc", "")) ? store.get("gik.repack.loc", "") : "";
  let rows = store.get("gik.repack", [{}]);
  const save = () => { store.set("gik.repack", rows); store.set("gik.repack.loc", loc); };

  const items = () => (loc === "Gudang" ? wms.data().items : getItems());
  const itemOf = (r) => items().find((x) => x.id === r.item);

  // Source batches for one item: production batches (FG/WIP, newest first) or WMS stock batches (FIFO first).
  function sources(it) {
    if (!it) return [];
    // At CK: only what CK still holds (received from the warehouse or made there), oldest first.
    if (loc === "Central Kitchen") {
      const unit = ck.item(it.code)?.unit || it.unit;
      return ck.lots(it.code).map((x) => ({ id: x.id, lot: x.lot, date: x.date, exp: x.exp, storage: x.storage || "", left: x.left, hint: `sisa ${fmt(x.left)} ${unit} · ${x.from}` }));
    }
    if (isProduced(it)) {
      return getBatches()
        .filter((b) => txt(b.fields["Product Code"]) === it.code)
        .slice(0, 10)
        .map((b) => ({ id: b.record_id, lot: txt(b.fields["Lot Code"]) || txt(b.fields["Batch No"]), date: txt(b.fields["Prod Date (label)"]), exp: txt(b.fields["Expiry (label)"]), storage: txt(b.fields.Storage), hint: `prod ${txt(b.fields["Prod Date (label)"])}` }));
    }
    const d = wms.data();
    const wi = loc === "Gudang" ? it : d.items.find((x) => x.code === it.code);
    if (!wi) return [];
    return d.batches
      .filter((b) => b.item === wi.id && !b.key.startsWith("OB|"))
      .sort((a, b) => a.fifo - b.fifo)
      .map((b) => ({ id: b.id, lot: `#${b.no}`, date: b.arr, exp: b.exp, storage: d.pos.get(b.pos)?.zone || "", hint: `${b.pos} · sisa ${fmt(b.sisa)}` }));
  }
  const sourceOf = (r) => sources(itemOf(r)).find((s) => s.id === r.batch);

  // Both sources can be needed in either place (a CK raw material has WMS batches, a WIP at Gudang has a production batch).
  async function load() {
    await Promise.all([wms.load(), loadBatches(), loc === "Central Kitchen" ? ck.load(true) : null]);
    render();
  }
  const expOf = (r) => { const s = sourceOf(r); return isProduced(itemOf(r)) ? s?.exp || "" : String(r.exp ?? s?.exp ?? "").trim(); };
  // What still stops this row from being saved, or "".
  function missing(r) {
    const it = itemOf(r);
    if (!it || !(packCalc(r.qty, r.split).total > 0)) return "";
    if (loc === "Central Kitchen" && !sources(it).length) return "No stock of this item at CK (nothing received or made yet)";
    if (isProduced(it) && !sourceOf(r)) return "Pick the production batch (expiry comes from it)";
    if (!expOf(r)) return "Enter the expiry date";
    return "";
  }

  function info(r) {
    const it = itemOf(r);
    if (!it) return "Pick an item";
    const c = packCalc(r.qty, r.split);
    if (!c.total) return `Enter the qty to repack in ${esc(it.unit)}`;
    const m = missing(r);
    if (m) return `<span class="danger">${esc(m)}</span>`;
    const s = sourceOf(r);
    const over = s?.left != null && c.total > s.left + 0.0001 ? ` · <span class="danger">more than batch has left (${fmt(s.left)})</span>` : "";
    const parts = c.last ? `${c.count - 1} × ${fmt(c.net)} + 1 × ${fmt(c.last)}` : `${c.count} × ${fmt(c.net)}`;
    return `${parts} ${esc(it.unit)} = <b>${fmt(c.total)} ${esc(it.unit)}</b> · <b>${c.count}</b> label(s)${over}`;
  }

  function render() {
    $("rlocs").innerHTML = LOCATIONS.map((l) => `<button class="chip" data-loc="${esc(l)}" aria-pressed="${l === loc}">${esc(l)}</button>`).join("");
    $("rbody").hidden = !loc;
    $("rnote").textContent = loc === "Gudang" ? "Item & batch dari WMS (urut FIFO). Stok tidak berubah, hanya kemasan + label." : loc ? "Item dari Production Base, batch dari produksi. Stok tidak berubah, hanya kemasan + label." : "";
    if (!loc) return updateBar();
    if (loc === "Gudang" && !wms.data().at) { $("rrows").innerHTML = `<p class="muted">Loading WMS items…</p>`; return updateBar(); }
    $("rrows").innerHTML = rows.map((r, i) => {
      const it = itemOf(r);
      const src = sources(it);
      const s = sourceOf(r);
      return `<div class="krow rrow" data-i="${i}">
        <label class="field pick kpick"><span>Item</span><input class="num" style="text-align:left" data-k="find" placeholder="Search code or name" autocomplete="off" value="${esc(it ? `${it.code} · ${it.name}` : r.find || "")}"><div class="menu" hidden></div></label>
        <label class="field kqty"><span>Qty to repack</span><span class="unit"><input class="num" data-k="qty" inputmode="decimal" enterkeyhint="next" value="${esc(fmtQty(r.qty))}">${it ? `<span class="u">${esc(it.unit)}</span>` : ""}</span></label>
        <label class="field ksplit"><span>Per pack</span><span class="unit"><input class="num" data-k="split" inputmode="decimal" enterkeyhint="next" placeholder="all" value="${esc(fmtQty(r.split))}">${it ? `<span class="u">${esc(it.unit)}</span>` : ""}</span></label>
        <label class="field kbatch"><span>${isProduced(it) ? "Production batch" : "Stock batch"}</span><select class="num" data-k="batch"><option value="">${src.length ? (isProduced(it) ? "Pick a batch" : "No batch") : "No batch found"}</option>${src.map((b, n) => `<option value="${esc(b.id)}" ${b.id === r.batch ? "selected" : ""}>${n === 0 ? "⭐ " : ""}${esc(b.lot)}${b.date ? ` · ${esc(b.date)}` : ""}${b.hint ? ` · ${esc(b.hint)}` : ""}</option>`).join("")}</select></label>
        <label class="field kexp"><span>Expiry${isProduced(it) ? " (from batch)" : ""}</span><input class="num" style="text-align:left" data-k="exp" placeholder="dd/mm/yyyy" value="${esc(it ? expOf(r) : "")}" ${isProduced(it) ? "readonly" : ""}></label>
        <button class="x" data-del aria-label="Remove row">×</button>
        <div class="rowinfo">${info(r)}</div>
      </div>`;
    }).join("");
    updateBar();
  }

  function ready() { return loc ? rows.filter((r) => itemOf(r) && packCalc(r.qty, r.split).total > 0 && !missing(r)) : []; }

  function bar() {
    if (!loc) return { html: `<span class="danger">Pick a location</span>`, label: "Simpan repack", disabled: true };
    const rs = ready();
    const labels = rs.reduce((t, r) => t + packCalc(r.qty, r.split).count, 0);
    const todo = rows.filter((r) => missing(r)).length;
    return { html: `<b>${rs.length}</b> item(s) · ${labels} label(s) · <b>${esc(loc)}</b>${todo ? ` · <span class="danger">${todo} incomplete</span>` : ""}`, label: "Simpan repack", disabled: !rs.length || todo > 0 };
  }

  function summary() {
    return {
      title: `Simpan repack · ${loc}?`,
      lines: ready().map((r) => { const it = itemOf(r); const c = packCalc(r.qty, r.split); return `${esc(it.name)}: ${fmt(c.total)} ${esc(it.unit)} → ${c.count} label(s)`; }),
    };
  }

  const pad = (n) => String(n).padStart(2, "0");
  async function submit() {
    const rs = ready();
    const now = new Date();
    const ref = `RP-${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const today = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    const rowsOut = rs.map((r) => {
      const it = itemOf(r);
      const s = sourceOf(r);
      const c = packCalc(r.qty, r.split);
      const exp = expOf(r);
      const storage = s?.storage || it.storage || "";
      const v = { name: it.name, code: it.code, batch: s?.lot || ref, prod: today, exp, run: `Repack · ${loc}`, net: `${fmt(c.net)} ${it.unit}`, storage, allergens: "", dest: "" };
      return { v, c, unit: it.unit, fields: {
        "Item Name": it.name, Location: loc, "Item Code": it.code, Unit: it.unit,
        "Pack Size": c.net, Packs: c.count, "Total Qty": c.total, ...(c.last ? { "Last Pack": c.last } : {}),
        "Lot / Batch": s?.lot || "", "Source Date": s?.date || "", Expiry: exp, Storage: storage,
        "Repack Ref": ref, "Repack Date": now.getTime(),
      } };
    });
    const created = await base("repack", "create", { records: rowsOut.map((x) => ({ fields: x.fields })) });
    const ids = (created.records || []).map((x) => x.record_id);
    // The QR needs the new row's id, so the label line is written right after.
    const lines = rowsOut.map((x, k) => encodeLine({ ...x.v, qr: qrLink("r", ids[k]) }, x.c.count, x.c.last ? `${fmt(x.c.last)} ${x.unit}` : ""));
    if (ids.length === lines.length) {
      try { await base("repack", "update", { records: ids.map((id, k) => ({ record_id: id, fields: { "Label Line": lines[k] } })) }); } catch { /* labels still print now; reprint needs the line */ }
    }
    rows = [{}];
    save();
    render();
    status(`✅ Repack saved: ${rowsOut.length} item(s) · ${esc(ref)}.`, "ok");
    openLabels(lines.join("^"), `Repack · ${loc}`);
  }

  $("rlocs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-loc]");
    if (!b || b.dataset.loc === loc) return;
    // Items differ per location, so rows picked for the other place start over.
    if (rows.some((r) => r.item) && !confirm("Ganti lokasi? Baris yang sudah diisi akan dikosongkan.")) return;
    loc = b.dataset.loc;
    rows = [{}];
    save();
    render();
    load().catch((err) => status(`Could not load items: ${esc(err.message)}`));
  });

  $("rrows").addEventListener("input", (e) => {
    const row = e.target.closest(".rrow");
    if (!row) return;
    const i = +row.dataset.i;
    const k = e.target.dataset.k;
    if (k === "find") {
      rows[i] = { ...rows[i], find: e.target.value, item: "" };
      const q = e.target.value.trim().toLowerCase();
      const menu = row.querySelector(".menu");
      const hits = q ? items().filter((it) => `${it.code} ${it.name}`.toLowerCase().includes(q)).slice(0, 8) : [];
      menu.innerHTML = hits.map((it) => `<button type="button" data-item="${esc(it.id)}"><b>${esc(it.code)}</b> · ${esc(it.name)} <span class="muted">${esc(it.unit)}</span></button>`).join("");
      menu.hidden = !hits.length;
    } else if (k === "exp") {
      rows[i] = { ...rows[i], exp: e.target.value };
    } else if (k === "qty" || k === "split") {
      rows[i] = { ...rows[i], [k]: liveQty(e.target) };
      row.querySelector(".rowinfo").innerHTML = info(rows[i]);
    }
    save();
    updateBar();
  });
  $("rrows").addEventListener("change", (e) => {
    if (e.target.dataset.k !== "batch") return;
    const i = +e.target.closest(".rrow").dataset.i;
    rows[i] = { ...rows[i], batch: e.target.value };
    delete rows[i].exp; // take the new batch's expiry
    save();
    render();
  });
  $("rrows").addEventListener("click", (e) => {
    const row = e.target.closest(".rrow");
    if (!row) return;
    const i = +row.dataset.i;
    const pick = e.target.closest("[data-item]");
    if (pick) {
      const first = sources(items().find((x) => x.id === pick.dataset.item))[0];
      rows[i] = { item: pick.dataset.item, find: "", qty: rows[i].qty, split: rows[i].split, batch: first?.id || "" };
      save();
      render();
      $("rrows").querySelector(`.rrow[data-i="${i}"] [data-k="qty"]`)?.focus();
    } else if (e.target.closest("[data-del]")) {
      rows.splice(i, 1);
      if (!rows.length) rows.push({});
      save();
      render();
    }
  });
  $("radd").addEventListener("click", () => { rows.push({}); save(); render(); $("rrows").querySelector(".rrow:last-child [data-k=find]")?.focus(); });

  return { load, render, bar, summary, submit, location: () => loc };
}
