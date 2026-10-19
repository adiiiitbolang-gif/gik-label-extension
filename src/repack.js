import { esc, encodeLine } from "./labels.js";
import { fmtQty, liveQty, packCalc } from "./qty.js";

// Repacking: any item, re-portioned into new packs with a label each, at Central Kitchen or the warehouse.
// Only the packaging changes, so no stock moves; each line is kept in "Repack Lines" for reprints.
//   Central Kitchen: items from the Production base, source batch = a production batch.
//   Gudang:          items from the WMS master, source batch = an active WMS stock batch (FIFO order).
export const LOCATIONS = ["Central Kitchen", "Gudang"];

export function createRepack({ $, base, txt, num, fmt, store, status, wms, getItems, getBatches, loadBatches, openLabels, updateBar }) {
  let loc = LOCATIONS.includes(store.get("gik.repack.loc", "")) ? store.get("gik.repack.loc", "") : "";
  let rows = store.get("gik.repack", [{}]);
  const save = () => { store.set("gik.repack", rows); store.set("gik.repack.loc", loc); };

  const items = () => (loc === "Gudang" ? wms.data().items : getItems());
  const itemOf = (r) => items().find((x) => x.id === r.item);

  // Source batches for one item, newest production first (CK) or FIFO first (Gudang).
  function sources(it) {
    if (!it) return [];
    if (loc === "Gudang") {
      return wms.data().batches
        .filter((b) => b.item === it.id && !b.key.startsWith("OB|"))
        .sort((a, b) => a.fifo - b.fifo)
        .map((b) => ({ id: b.id, lot: `#${b.no}`, date: b.arr, exp: b.exp, storage: wms.data().pos.get(b.pos)?.zone || "", hint: `${b.pos} · sisa ${fmt(b.sisa)}` }));
    }
    return getBatches()
      .filter((b) => txt(b.fields["Product Code"]) === it.code)
      .slice(0, 10)
      .map((b) => ({ id: b.record_id, lot: txt(b.fields["Lot Code"]) || txt(b.fields["Batch No"]), date: txt(b.fields["Prod Date (label)"]), exp: txt(b.fields["Expiry (label)"]), storage: txt(b.fields.Storage), hint: txt(b.fields["Label Batch Line"]) }));
  }
  const sourceOf = (r) => sources(itemOf(r)).find((s) => s.id === r.batch);

  async function load() {
    if (loc === "Gudang") await wms.load();
    else await loadBatches();
    render();
  }

  function info(r) {
    const it = itemOf(r);
    if (!it) return "Pick an item";
    const c = packCalc(r.qty, r.split);
    if (!c.total) return `Enter the qty to repack in ${esc(it.unit)}`;
    const parts = c.last ? `${c.count - 1} × ${fmt(c.net)} + 1 × ${fmt(c.last)}` : `${c.count} × ${fmt(c.net)}`;
    return `${parts} ${esc(it.unit)} = <b>${fmt(c.total)} ${esc(it.unit)}</b> · <b>${c.count}</b> label(s)`;
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
        <label class="field kbatch"><span>Source batch</span><select class="num" data-k="batch"><option value="">${src.length ? "No batch" : "No batch found"}</option>${src.map((b, n) => `<option value="${esc(b.id)}" ${b.id === r.batch ? "selected" : ""}>${n === 0 ? "⭐ " : ""}${esc(b.lot)}${b.date ? ` · ${esc(b.date)}` : ""}${b.hint ? ` · ${esc(b.hint)}` : ""}</option>`).join("")}</select></label>
        <label class="field kexp"><span>Expiry</span><input class="num" style="text-align:left" data-k="exp" placeholder="dd/mm/yyyy" value="${esc(r.exp ?? s?.exp ?? "")}"></label>
        <button class="x" data-del aria-label="Remove row">×</button>
        <div class="rowinfo">${info(r)}</div>
      </div>`;
    }).join("");
    updateBar();
  }

  function ready() { return loc ? rows.filter((r) => itemOf(r) && packCalc(r.qty, r.split).total > 0) : []; }

  function bar() {
    if (!loc) return { html: `<span class="danger">Pick a location</span>`, label: "Simpan repack", disabled: true };
    const rs = ready();
    const labels = rs.reduce((t, r) => t + packCalc(r.qty, r.split).count, 0);
    return { html: `<b>${rs.length}</b> item(s) · ${labels} label(s) · <b>${esc(loc)}</b>`, label: "Simpan repack", disabled: !rs.length };
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
    const records = rs.map((r) => {
      const it = itemOf(r);
      const s = sourceOf(r);
      const c = packCalc(r.qty, r.split);
      const exp = String(r.exp ?? s?.exp ?? "").trim();
      const storage = s?.storage || it.storage || "";
      const v = { name: it.name, code: it.code, batch: s?.lot || ref, prod: s?.date || today, exp, run: `Repack ${today.slice(0, 5)} · ${loc}`, net: `${fmt(c.net)} ${it.unit}`, storage, allergens: "", dest: "" };
      const line = encodeLine(v, c.count, c.last ? `${fmt(c.last)} ${it.unit}` : "");
      return { line, fields: {
        "Item Name": it.name, Location: loc, "Item Code": it.code, Unit: it.unit,
        "Pack Size": c.net, Packs: c.count, "Total Qty": c.total, ...(c.last ? { "Last Pack": c.last } : {}),
        "Lot / Batch": s?.lot || "", "Source Date": s?.date || "", Expiry: exp, Storage: storage,
        "Repack Ref": ref, "Repack Date": now.getTime(), "Label Line": line,
      } };
    });
    await base("repack", "create", { records: records.map((x) => ({ fields: x.fields })) });
    rows = [{}];
    save();
    render();
    status(`✅ Repack saved: ${records.length} item(s) · ${esc(ref)}.`, "ok");
    openLabels(records.map((x) => x.line).join("^"), `Repack · ${loc}`);
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
