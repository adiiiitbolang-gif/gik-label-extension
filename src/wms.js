import { esc } from "./labels.js";
import { fmtQty, liveQty } from "./qty.js";

// Fast WMS input (WMS WH Matchaman base), replacing the four Base forms.
// Each mode writes exactly the fields its form writes, so every WMS formula and workflow
// (FIFO, Sisa, Cek Batch, Area Outbond nightly cut, notifications) works as before:
//   Inbound  -> Stock Batch: Item, PO Number, Qty Transfer, Arrival Date, Rak/Level Tujuan, Expired Date, Simpan Sementara, Foto
//   Transfer -> Stock Batch: Item, Batch Asal, Qty Transfer, Rak/Level Tujuan
//   Outbond  -> Stock Batch: Tujuan Outlet, Tgl Kirim Rencana, Rak Tujuan, Item, Batch Asal, Qty Transfer
//   Waste    -> Daily Inventory: Type, Date, Tgl Kirim, Destination, Item, Batch Item, Quantity, Attachments
// Input is one item list for every mode: all items by category (search + category chips pinned on top),
// in walking order inside a category, a qty box per item; filling a qty opens that mode's own fields.
// The app picks the FIFO batch (split over several batches when one is not enough), defaults rak/level
// from Master Items and shows the same hints the forms show.

const ACTIVE_BATCH_VIEW = "vew5N17Guu"; // Stock Batch view "Batch aktif - untuk dipilih (Batch Sumber)"
const MODES = [
  { id: "in", label: "Inbound", icon: "📥" },
  { id: "tr", label: "Transfer", icon: "🔁" },
  { id: "out", label: "Outbond", icon: "🚚" },
  { id: "waste", label: "Kirim / Rusak", icon: "🗑" },
];
const CAT_ORDER = ["Raw Materials", "Work In Process", "KITCHEN INVENTORY (FOOD PRODUCTION RELATED)", "Supporting Inventory", "Chemical", "Medical", "Uniform", "Merchandise"];
const ZONE_ORDER = ["Pallet", "Dry Storage", "Chiller", "Freezer", "Outbound"];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayMs = (s) => { const [y, m, d] = String(s || "").split("-").map(Number); return y ? new Date(y, m - 1, d).getTime() : 0; };

// Link cells come back as [{ record_ids: [...] }] (search) or { link_record_ids } (get).
function linkIds(x) {
  if (!x) return [];
  if (Array.isArray(x)) return x.flatMap((e) => e?.record_ids || e?.link_record_ids || (e?.id ? [e.id] : typeof e === "string" ? [e] : []));
  return x.link_record_ids || x.record_ids || [];
}

export function createWms(ctx) {
  const { $, base, searchAll, txt, num, fmt, store, status, uploadPhoto, updateBar } = ctx;
  let mode = store.get("gik.wms.mode", "in");
  let loaded = false;
  let loading = null;
  const data = { items: [], racks: new Map(), pos: new Map(), limits: [], batches: [], opt: { rak: [], level: [], outlet: [], type: [], dest: [] }, at: 0 };

  // ---------- drafts (kept on the phone) ----------
  function fresh(m) {
    const sheet = { q: {}, x: {}, picked: {} };
    if (m === "in") return { head: { po: "", arrival: today() }, ...sheet };
    if (m === "out") return { head: { outlet: "", kirim: today(), rak: "Area Outbond" }, ...sheet };
    if (m === "waste") return { head: { type: "Rusak", date: today(), kirim: today(), dest: "" }, ...sheet };
    return { head: {}, ...sheet };
  }
  const drafts = {};
  for (const m of MODES) {
    const saved = store.get(`gik.wms.${m.id}`, null);
    drafts[m.id] = saved?.q && saved?.x ? saved : { ...fresh(m.id), head: { ...fresh(m.id).head, ...(saved?.head || {}) } };
  }
  const d = () => drafts[mode];
  const save = () => store.set(`gik.wms.${mode}`, drafts[mode]);
  const xOf = (id) => (d().x[id] ||= {});

  // List view state (shared by the modes; search is cleared when switching mode).
  let filter = "all"; // all | filled | todo
  let cat = "all";
  let query = "";
  let open = ""; // item whose batch picker is open
  let hideZero = store.get("gik.wms.hide0", false);
  const needsStock = () => mode !== "in";

  // ---------- data ----------
  // Lark returns field settings 100 per page; Stock Batch has more than that.
  async function allFields(table) {
    const items = [];
    let page_token = "";
    do {
      const r = await base(table, "fields", null, { page_size: 100, ...(page_token ? { page_token } : {}) });
      items.push(...(r.items || []));
      page_token = r.has_more ? r.page_token : "";
    } while (page_token);
    return { items };
  }
  async function load(force = false) {
    if (loaded && !force) return;
    if (loading) return loading;
    loading = (async () => {
      $("winfo").textContent = "Loading WMS data…";
      const [items, racks, limits, batches, fb, fd] = await Promise.all([
        searchAll("wmsItems", { field_names: ["Product Name", "Product Code", "Unit", "Category", "Rack Position"], automatic_fields: false }),
        searchAll("wmsRacks", { field_names: ["Rack Name", "Rak Induk", "Level", "Zone", "Lantai"], automatic_fields: false }),
        searchAll("wmsLimits", { field_names: ["Item", "Rak Induk Posisi", "Level Posisi", "Teks Sisa"], automatic_fields: false }),
        searchAll("wmsBatches", { view_id: ACTIVE_BATCH_VIEW, field_names: ["Batch No", "Item", "Kunci Item", "Kunci FIFO", "Sisa", "Posisi Tujuan", "Tgl Datang Teks", "Tgl Expired Teks"], automatic_fields: false }),
        allFields("wmsBatches"),
        allFields("wmsDaily"),
      ]);
      data.racks = new Map(racks.map((r) => [r.record_id, { name: txt(r.fields["Rack Name"]), induk: txt(r.fields["Rak Induk"]), level: String(num(r.fields.Level) || ""), zone: txt(r.fields.Zone), lantai: txt(r.fields.Lantai) }]));
      data.pos = new Map([...data.racks.values()].map((r) => [r.name, r]));
      data.items = items
        .map((r) => ({ id: r.record_id, name: txt(r.fields["Product Name"]), code: txt(r.fields["Product Code"]), unit: txt(r.fields.Unit), cat: txt(r.fields.Category), racks: linkIds(r.fields["Rack Position"]) }))
        .filter((i) => i.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      data.limits = limits.map((r) => ({ item: linkIds(r.fields.Item)[0], induk: txt(r.fields["Rak Induk Posisi"]), level: num(r.fields["Level Posisi"]), teks: txt(r.fields["Teks Sisa"]) }));
      data.batches = batches
        .map((r) => ({ id: r.record_id, no: txt(r.fields["Batch No"]), item: linkIds(r.fields.Item)[0], key: txt(r.fields["Kunci Item"]), fifo: num(r.fields["Kunci FIFO"]), sisa: num(r.fields.Sisa), pos: txt(r.fields["Posisi Tujuan"]), arr: txt(r.fields["Tgl Datang Teks"]), exp: txt(r.fields["Tgl Expired Teks"]) }))
        .filter((b) => b.sisa > 0);
      const opts = (fields, name) => ((fields.items || []).find((f) => f.field_name === name)?.property?.options || []).map((o) => o.name);
      data.opt = { rak: opts(fb, "Rak Tujuan"), level: opts(fb, "Level Tujuan"), outlet: opts(fb, "Tujuan Outlet"), type: opts(fd, "Type"), dest: opts(fd, "Destination") };
      data.at = Date.now();
      loaded = true;
      render();
    })().catch((e) => {
      $("winfo").innerHTML = `<span class="danger">Could not load WMS data: ${esc(e.message)}</span>`;
      throw e;
    }).finally(() => (loading = null));
    return loading;
  }

  const itemById = (id) => data.items.find((i) => i.id === id);

  // Same source as the form hints "Rak Tujuan Seharusnya" / "Level Seharusnya".
  function homeOf(it) {
    const list = it.racks.map((id) => data.racks.get(id)).filter(Boolean);
    return {
      list,
      induks: [...new Set(list.map((r) => r.induk).filter(Boolean))],
      levelFor: (induk) => list.find((r) => r.induk === induk)?.level || "",
      levelsIn: (induk) => [...new Set(list.filter((r) => r.induk === induk).map((r) => r.level).filter(Boolean))],
    };
  }

  // Same as form hint "Kapasitas Level".
  function capacity(itemId, induk) {
    const l = data.limits.filter((x) => x.item === itemId && x.induk === induk).sort((a, b) => a.level - b.level);
    return l.length ? l.map((x) => x.teks).join(" | ") : "";
  }

  // FIFO = same order as "FIFO Order"/"FIFO Helper": batches of this item with stock, outside Area Outbond, by Kunci FIFO.
  const fifo = (itemId) => data.batches.filter((b) => b.item === itemId && !b.key.startsWith("OB|")).sort((a, b) => a.fifo - b.fifo);

  // Split a quantity over batches: auto = FIFO order; manual = the one batch picked.
  function allocate(row) {
    const qty = num(row.qty);
    const list = fifo(row.item);
    if (!row.item || !(qty > 0)) return { parts: [], short: 0, none: false };
    if (row.batch) {
      const b = data.batches.find((x) => x.id === row.batch) || { id: row.batch, no: "?", sisa: 0, pos: "" };
      return { parts: [{ b, q: qty }], short: Math.max(0, qty - b.sisa), none: false, manual: true, notFifo: list[0] && list[0].id !== row.batch };
    }
    if (!list.length) return { parts: [], short: qty, none: true };
    const parts = [];
    let left = qty;
    for (const b of list) {
      if (left <= 0) break;
      const q = Math.min(b.sisa, left);
      parts.push({ b, q });
      left -= q;
    }
    if (left > 0) parts[parts.length - 1].q += left; // more than all stock: the last batch goes minus, as the form would allow
    return { parts, short: left, none: false };
  }

  const rowOf = (id) => ({ item: id, qty: d().q[id], ...(d().x[id] || {}) });

  // ---------- ordering: category, then walking route ----------
  const catOf = (it) => it.cat || "Tanpa kategori";
  const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 50 : i; };
  const categories = () => [...new Set(data.items.map(catOf))].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));

  // Position used for the route: the FIFO batch (taking stock out) or the item's home rack (putting stock in).
  function placeOf(it) {
    if (mode === "in") return homeOf(it).list[0] || null;
    const first = fifo(it.id)[0];
    if (!first) return null;
    return data.pos.get(first.pos) || [...data.racks.values()].find((r) => r.induk && first.pos.startsWith(`${r.induk} `)) || { name: first.pos };
  }

  function routeKey(it) {
    const c = `${String(catRank(catOf(it))).padStart(2, "0")}|${catOf(it)}`;
    const p = placeOf(it);
    if (needsStock() && !fifo(it.id).length) return `${c}|2|${it.name}`; // no stock: end of its category
    if (!p || !p.zone) return `${c}|1|${it.name}`;
    const zone = ZONE_ORDER.indexOf(p.zone);
    return `${c}|0|${p.lantai === "Lt 2" ? 0 : 1}|${zone < 0 ? 8 : zone}|${p.induk}|${String(p.level).padStart(2, "0")}|${it.name}`;
  }

  function listItems() {
    const q = query.trim().toLowerCase();
    const dr = d();
    return data.items
      .filter((it) => !needsStock() || !hideZero || fifo(it.id).length || num(dr.q[it.id]) > 0)
      .filter((it) => cat === "all" || catOf(it) === cat)
      .filter((it) => !q || `${it.name} ${it.code}`.toLowerCase().includes(q))
      .filter((it) => filter === "all" || (num(dr.q[it.id]) > 0 && (filter === "filled" || !dr.picked[it.id])))
      .map((it) => ({ it, key: routeKey(it) }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => r.it);
  }

  function counts() {
    const dr = d();
    const filled = Object.keys(dr.q).filter((id) => num(dr.q[id]) > 0);
    return { filled: filled.length, picked: filled.filter((id) => dr.picked[id]).length };
  }

  // ---------- small builders ----------
  const sel = (k, options, value, ph) => `<select class="num" data-k="${k}"><option value="">${esc(ph)}</option>${options.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const field = (label, inner, cls = "") => `<label class="field ${cls}"><span>${label}</span>${inner}</label>`;
  const inp = (k, v, attrs = "") => `<input class="num" data-k="${k}" value="${esc(v ?? "")}" ${attrs}>`;

  // Options split into "belongs to this item" (⭐, first) and the rest, like a filtered picker.
  function grouped(k, mine, all, value, ph, mineLabel) {
    const opt = (o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`;
    const own = mine.filter((o) => all.includes(o));
    const rest = all.filter((o) => !own.includes(o));
    const body = own.length ? `<optgroup label="${esc(mineLabel)}">${own.map(opt).join("")}</optgroup><optgroup label="Lainnya">${rest.map(opt).join("")}</optgroup>` : all.map(opt).join("");
    return `<select class="num" data-k="${k}"><option value="">${esc(ph)}</option>${body}</select>`;
  }
  const rakSelect = (it, x) => grouped("rak", homeOf(it).induks, data.opt.rak, x.rak, "Rak", "⭐ Rak seharusnya");
  const levelSelect = (it, x) => grouped("level", x.rak ? homeOf(it).levelsIn(x.rak) : [], data.opt.level, x.level, "-", "⭐ Level item ini");
  const photoBtn = (x) => `<label class="field"><span>Foto</span><span class="photo ${x.photo ? "ok" : ""}">${x.photo ? "✓" : x.uploading ? "…" : "📷"}<input type="file" accept="image/*" capture="environment" data-k="photo" hidden></span></label>`;

  // ---------- header (each mode's own fields) ----------
  function headHtml() {
    const h = d().head;
    const chips = (k, list, value, label = (o) => o) => `<div class="chips">${list.map((o) => `<button class="chip" data-hk="${k}" data-v="${esc(o)}" aria-pressed="${o === value}">${esc(label(o))}</button>`).join("")}</div>`;
    if (mode === "in") return `<div class="whead">${field("PO / Surat Jalan *", inp("po", h.po, 'style="text-align:left" placeholder="No PO"'), "w2")}${field("Arrival Date *", inp("arrival", h.arrival, 'type="date"'))}</div>`;
    if (mode === "out") return `<div class="field"><span>Tujuan Outlet *</span>${chips("outlet", data.opt.outlet, h.outlet)}</div><div class="whead">${field("Tgl Kirim Rencana *", inp("kirim", h.kirim, 'type="date"'))}${field("Rak Tujuan *", sel("rak", data.opt.rak, h.rak, "Pilih rak"))}</div><p class="muted">Stok masuk ke Area Outbond, lalu dipotong otomatis jam 23:30 pada Tgl Kirim.</p>`;
    if (mode === "waste") return `<div class="field"><span>Type *</span>${chips("type", data.opt.type, h.type, (o) => o.trim())}</div><div class="whead">${field("Tanggal *", inp("date", h.date, 'type="date"'))}${field("Tgl Kirim *", inp("kirim", h.kirim, 'type="date"'))}</div>${h.type.trim() === "Kirim" ? `<div class="field"><span>Destination *</span>${chips("dest", data.opt.dest, h.dest)}</div>` : ""}`;
    return `<p class="muted">Pindah stok dari batch lama ke rak/level baru. Batch diambil otomatis sesuai FIFO.</p>`;
  }

  // ---------- pinned toolbar: search, filters, category chips ----------
  function toolbarHtml() {
    const c = counts();
    const chip = (v, label) => `<button class="chip" data-of="${v}" aria-pressed="${filter === v}">${label}</button>`;
    return `<div class="otop">
      <input class="search" data-k="q" type="search" placeholder="🔍 Cari item / kode" value="${esc(query)}" autocomplete="off" enterkeyhint="search">
      <div class="orow-chips">${chip("all", "Semua")}${chip("filled", `Diisi (${c.filled})`)}${mode === "out" ? chip("todo", `Belum ✓ (${c.filled - c.picked})`) : ""}${needsStock() ? `<button class="chip" data-hide0 aria-pressed="${hideZero}">Sembunyikan stok 0</button>` : ""}</div>
      <div class="ocats">${["all", ...categories()].map((k) => `<button class="chip" data-cat="${esc(k)}" aria-pressed="${cat === k}">${k === "all" ? "Semua kategori" : esc(k.length > 26 ? `${k.slice(0, 24)}…` : k)}</button>`).join("")}</div>
    </div>`;
  }

  function updateCounts() {
    const c = counts();
    const t = $("wrows").querySelector(".otop");
    if (!t) return;
    const f = t.querySelector('[data-of="filled"]');
    if (f) f.textContent = `Diisi (${c.filled})`;
    const td = t.querySelector('[data-of="todo"]');
    if (td) td.textContent = `Belum ✓ (${c.filled - c.picked})`;
  }

  // ---------- item rows ----------
  function locHtml(it) {
    const x = d().x[it.id] || {};
    if (mode === "in") {
      const home = homeOf(it);
      const where = home.list.map((r) => r.name).join(", ");
      return where ? `⭐ Rak seharusnya: ${esc(where)}` : '<span class="muted">Belum ada posisi rak di Master Items</span>';
    }
    const list = fifo(it.id);
    const pick = x.batch ? list.find((b) => b.id === x.batch) : list[0];
    if (!pick) return '<span class="danger">Tidak ada batch bersisa</span>';
    return `<button class="oloc" data-loc>${x.batch ? "" : "⭐ "}#${esc(pick.no)} · ${esc(pick.pos)} · sisa ${fmt(pick.sisa)}${pick.exp ? ` · exp ${esc(pick.exp)}` : ""} ▾</button>`;
  }

  function batchPicker(it) {
    const list = fifo(it.id);
    const x = d().x[it.id] || {};
    if (open !== it.id || !list.length) return "";
    return `<select class="num obatch" data-k="batch"><option value="">Auto FIFO (#${esc(list[0].no)}${list.length > 1 ? " +" : ""})</option>${list.map((b, n) => `<option value="${b.id}" ${b.id === x.batch ? "selected" : ""}>${n === 0 ? "⭐ " : ""}#${esc(b.no)} · ${esc(b.pos)} · sisa ${fmt(b.sisa)}${b.exp ? ` · exp ${esc(b.exp)}` : ""}</option>`).join("")}</select>`;
  }

  // Fields that only appear once a qty is filled, different per mode.
  function extrasHtml(it) {
    if (!(num(d().q[it.id]) > 0)) return "";
    const x = xOf(it.id);
    if (mode === "in") {
      return `<div class="oext">${field("Rak", rakSelect(it, x))}${field("Level", levelSelect(it, x))}${field("Expired", inp("exp", x.exp, 'type="date"'))}<label class="field"><span>Simpan sementara</span><input type="checkbox" class="chk" data-k="temp" ${x.temp ? "checked" : ""}></label>${photoBtn(x)}</div>`;
    }
    if (mode === "tr") return `<div class="oext">${field("Rak tujuan *", rakSelect(it, x))}${field("Level *", levelSelect(it, x))}</div>`;
    if (mode === "waste") return `<div class="oext">${photoBtn(x)}</div>`;
    return "";
  }

  function hintHtml(it) {
    const r = rowOf(it.id);
    const bits = [];
    if (mode === "in" || mode === "tr") {
      if (num(r.qty) > 0) {
        const home = homeOf(it);
        if (r.rak && home.induks.length && !home.induks.includes(r.rak)) bits.push('<span class="danger">beda dari rak seharusnya</span>');
        const cap = r.rak ? capacity(it.id, r.rak) : "";
        if (cap) bits.push(`Kapasitas: ${esc(cap)}`);
      }
    }
    if (mode === "in" && num(r.qty) > 0 && !r.exp && /raw materials/i.test(it.cat)) bits.push('<span class="danger">Raw Materials: WAJIB isi Expired Date</span>');
    if (needsStock() && num(r.qty) > 0) {
      const a = allocate(r);
      if (a.none) bits.push('<span class="danger">Tidak bisa disimpan: tidak ada batch</span>');
      else {
        bits.push(`Ambil ${a.parts.map((p) => `<b>${fmt(p.q)}</b> dari #${esc(p.b.no)} (${esc(p.b.pos)})`).join(" + ")}`);
        if (a.notFifo) bits.push('<span class="danger">BUKAN FIFO</span>');
        if (a.short > 0) bits.push(`<span class="danger">kurang ${fmt(a.short)} → MINUS</span>`);
      }
    }
    return bits.join(" · ");
  }

  function rowHtml(it) {
    const dr = d();
    const qty = num(dr.q[it.id]);
    const stock = fifo(it.id).reduce((t, b) => t + b.sisa, 0);
    const zero = needsStock() && !stock && !(qty > 0);
    const cls = `orow${mode === "out" ? "" : " nopick"}${qty > 0 ? " filled" : ""}${dr.picked[it.id] ? " picked" : ""}${zero ? " zero" : ""}`;
    return `<div class="${cls}" data-oi="${it.id}">
      ${mode === "out" ? `<button class="opick" data-pick aria-label="Sudah diambil ${esc(it.name)}" aria-pressed="${Boolean(dr.picked[it.id])}">✓</button>` : ""}
      <div class="oinfo"><b>${esc(it.name)}</b> <span class="muted">${esc(it.code)} · stok ${fmt(stock)} ${esc(it.unit)}</span>
        <div class="oplace">${locHtml(it)}</div>${batchPicker(it)}
        <div class="oextwrap">${extrasHtml(it)}</div>
        <div class="oalloc">${hintHtml(it)}</div></div>
      <label class="oqty"><input class="num" data-k="qty" inputmode="decimal" enterkeyhint="next" value="${esc(fmtQty(dr.q[it.id]))}" aria-label="Qty ${esc(it.name)}" ${zero ? "disabled" : ""}><span>${esc(it.unit)}</span></label>
    </div>`;
  }

  function listHtml() {
    const items = listItems();
    if (!items.length) return `<p class="muted">${filter !== "all" ? "Belum ada item di daftar ini." : query ? "Tidak ada item yang cocok." : "Tidak ada item di kategori ini."}</p>`;
    const dr = d();
    const groups = new Map();
    for (const it of items) {
      const g = catOf(it);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(it);
    }
    let html = "";
    for (const [g, its] of groups) {
      const filled = its.filter((it) => num(dr.q[it.id]) > 0).length;
      html += `<div class="ogroup">${esc(g)} <span>${its.length} item${filled ? ` · ${filled} diisi` : ""}</span></div>${its.map(rowHtml).join("")}`;
    }
    return html;
  }

  function renderList() {
    const el = $("wrows").querySelector(".olist");
    if (el) el.innerHTML = listHtml();
    updateCounts();
    updateBar();
  }

  // Update one row in place, keeping focus in its qty box while typing.
  function refreshRow(id, { extras = false } = {}) {
    const el = $("wrows").querySelector(`.orow[data-oi="${id}"]`);
    const it = itemById(id);
    if (!el || !it) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = rowHtml(it);
    const f = tmp.firstElementChild;
    el.className = f.className;
    el.querySelector(".oalloc").innerHTML = f.querySelector(".oalloc").innerHTML;
    el.querySelector(".oplace").innerHTML = f.querySelector(".oplace").innerHTML;
    const pick = el.querySelector("[data-pick]");
    if (pick) pick.setAttribute("aria-pressed", f.querySelector("[data-pick]").getAttribute("aria-pressed"));
    const wrap = el.querySelector(".oextwrap");
    if (extras || !wrap.innerHTML !== !f.querySelector(".oextwrap").innerHTML) wrap.innerHTML = f.querySelector(".oextwrap").innerHTML;
    const group = [...$("wrows").querySelectorAll(".ogroup")].find((g) => g.firstChild.textContent.trim() === catOf(it));
    if (group) {
      const its = listItems().filter((x) => catOf(x) === catOf(it));
      const filled = its.filter((x) => num(d().q[x.id]) > 0).length;
      group.querySelector("span").textContent = `${its.length} item${filled ? ` · ${filled} diisi` : ""}`;
    }
  }

  function render() {
    $("wmodes").innerHTML = MODES.map((m) => `<button class="chip" data-mode="${m.id}" aria-pressed="${m.id === mode}">${m.icon} ${m.label}</button>`).join("");
    $("wadd").hidden = true;
    if (!loaded) return;
    $("whead").innerHTML = headHtml();
    $("wrows").innerHTML = `${toolbarHtml()}<div class="olist">${listHtml()}</div>`;
    $("winfo").textContent = `${data.items.length} item · ${data.batches.length} batch bersisa · dimuat ${new Date(data.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    updateBar();
  }

  // ---------- events ----------
  $("wmodes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    mode = b.dataset.mode;
    store.set("gik.wms.mode", mode);
    query = "";
    filter = "all";
    open = "";
    render();
  });
  $("wreload").addEventListener("click", () => load(true));

  $("whead").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hk]");
    if (!b) return;
    d().head[b.dataset.hk] = b.dataset.v;
    save();
    $("whead").innerHTML = headHtml();
    updateBar();
  });
  $("whead").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    d().head[k] = e.target.value;
    save();
    updateBar();
  });

  $("wrows").addEventListener("input", async (e) => {
    const k = e.target.dataset.k;
    if (k === "q") { query = e.target.value; return renderList(); }
    const row = e.target.closest(".orow");
    if (!row) return;
    const id = row.dataset.oi;
    const it = itemById(id);
    const dr = d();
    const x = xOf(id);
    if (k === "qty") {
      const had = num(dr.q[id]) > 0;
      dr.q[id] = liveQty(e.target);
      if (!(num(dr.q[id]) > 0)) { delete dr.q[id]; delete dr.picked[id]; }
      // First qty for an item: default rak/level to where the item belongs.
      if (!had && num(dr.q[id]) > 0 && (mode === "in" || mode === "tr") && !x.rak) {
        const home = homeOf(it);
        if (home.induks.length) { x.rak = home.induks[0]; x.level = home.levelFor(x.rak); }
      }
      save();
      refreshRow(id);
      updateCounts();
      updateBar();
      return;
    }
    if (k === "photo") {
      const file = e.target.files?.[0];
      if (!file) return;
      x.uploading = true;
      refreshRow(id, { extras: true });
      try {
        x.photo = await uploadPhoto(file, "wms");
      } catch (err) {
        status(`Foto gagal diupload: ${esc(err.message)}`);
      }
      x.uploading = false;
    } else if (k === "temp") {
      x.temp = e.target.checked;
    } else if (k === "batch") {
      if (e.target.value) x.batch = e.target.value; else delete x.batch;
    } else if (k) {
      x[k] = e.target.value;
      if (k === "rak") {
        const home = homeOf(it).levelFor(x.rak);
        if (home) x.level = home;
        save();
        return refreshRow(id, { extras: true });
      }
    }
    save();
    refreshRow(id, { extras: k === "photo" });
    updateBar();
  });

  $("wrows").addEventListener("click", (e) => {
    const of = e.target.closest("[data-of]");
    if (of) {
      filter = of.dataset.of;
      $("wrows").querySelectorAll("[data-of]").forEach((b) => b.setAttribute("aria-pressed", String(b === of)));
      return renderList();
    }
    const h0 = e.target.closest("[data-hide0]");
    if (h0) {
      hideZero = !hideZero;
      store.set("gik.wms.hide0", hideZero);
      h0.setAttribute("aria-pressed", String(hideZero));
      return renderList();
    }
    const c = e.target.closest("[data-cat]");
    if (c) {
      cat = c.dataset.cat;
      $("wrows").querySelectorAll("[data-cat]").forEach((b) => b.setAttribute("aria-pressed", String(b === c)));
      c.scrollIntoView({ inline: "center", block: "nearest" });
      renderList();
      $("wrows").querySelector(".otop").scrollIntoView({ block: "start" });
      return;
    }
    const row = e.target.closest(".orow");
    if (!row) return;
    const id = row.dataset.oi;
    const dr = d();
    if (e.target.closest("[data-pick]")) {
      if (!(num(dr.q[id]) > 0)) return row.querySelector('[data-k="qty"]').focus();
      if (dr.picked[id]) delete dr.picked[id]; else dr.picked[id] = true;
      save();
      if (filter === "todo") renderList(); else { refreshRow(id); updateCounts(); updateBar(); }
    } else if (e.target.closest("[data-loc]")) {
      open = open === id ? "" : id;
      const tmp = document.createElement("div");
      tmp.innerHTML = rowHtml(itemById(id));
      row.replaceWith(tmp.firstElementChild);
    }
  });

  // ---------- validate + submit ----------
  function problems() {
    const h = d().head;
    const out = [];
    const rows = Object.keys(d().q).filter((id) => num(d().q[id]) > 0 && itemById(id)).map(rowOf);
    if (!rows.length) out.push("Isi qty di item yang mau disimpan");
    if (mode === "in" && !h.po?.trim()) out.push("Isi PO / Surat Jalan");
    if (mode === "in" && !h.arrival) out.push("Isi Arrival Date");
    if (mode === "out" && !h.outlet) out.push("Pilih Tujuan Outlet");
    if (mode === "out" && (!h.kirim || !h.rak)) out.push("Isi Tgl Kirim dan Rak Tujuan");
    if (mode === "waste" && (!h.type || !h.date || !h.kirim)) out.push("Isi Type, Tanggal dan Tgl Kirim");
    if (mode === "waste" && h.type?.trim() === "Kirim" && !h.dest) out.push("Pilih Destination");
    for (const r of rows) {
      const name = itemById(r.item).name;
      if (needsStock() && allocate(r).none) out.push(`${name}: tidak ada batch bersisa`);
      if (mode === "tr" && (!r.rak || !r.level)) out.push(`${name}: pilih Rak dan Level tujuan`);
      if (r.uploading) out.push(`${name}: foto masih diupload`);
    }
    return { rows, out };
  }

  function records() {
    const h = d().head;
    const recs = [];
    for (const r of problems().rows) {
      if (mode === "in") {
        const f = { Item: [r.item], "PO Number": h.po.trim(), "Qty Transfer": num(r.qty), "Arrival Date": dayMs(h.arrival) };
        if (r.rak) f["Rak Tujuan"] = r.rak;
        if (r.level) f["Level Tujuan"] = r.level;
        if (r.exp) f["Expired Date"] = dayMs(r.exp);
        if (r.temp) f["Simpan Sementara?(belum sempat taruh rak)"] = true;
        if (r.photo) f.Foto = [{ file_token: r.photo }];
        recs.push(f);
        continue;
      }
      for (const p of allocate(r).parts) {
        if (mode === "tr") recs.push({ Item: [r.item], "Batch Asal": [p.b.id], "Qty Transfer": p.q, "Rak Tujuan": r.rak, "Level Tujuan": r.level });
        if (mode === "out") recs.push({ "Tujuan Outlet": h.outlet, "Tgl Kirim Rencana": dayMs(h.kirim), "Rak Tujuan": h.rak, Item: [r.item], "Batch Asal": [p.b.id], "Qty Transfer": p.q });
        if (mode === "waste") {
          const f = { Type: h.type, Date: dayMs(h.date), "Tgl Kirim": dayMs(h.kirim), Item: [r.item], "Batch Item": [p.b.id], Quantity: p.q };
          if (h.type.trim() === "Kirim") f.Destination = h.dest;
          if (r.photo) f.Attachments = [{ file_token: r.photo }];
          recs.push(f);
        }
      }
    }
    return recs;
  }

  function bar() {
    if (!loaded) return { html: "Memuat data WMS…", label: "Simpan", disabled: true };
    const p = problems();
    const label = { in: "Simpan Inbound", tr: "Simpan Transfer", out: "Simpan Outbond", waste: `Simpan ${(d().head.type || "").trim() || "Kirim/Rusak"}` }[mode];
    const c = counts();
    const ready = `<b>${c.filled}</b> item${mode === "out" ? ` · ✓ ${c.picked}/${c.filled} diambil` : ""} · ${records().length} baris ke WMS`;
    const html = p.out.length ? `<span class="danger">${esc(p.out[0])}${p.out.length > 1 ? ` (+${p.out.length - 1})` : ""}</span>` : ready;
    return { html, label, disabled: p.out.length > 0 };
  }

  function summary() {
    const h = d().head;
    const lines = problems().rows.map((r) => {
      const it = itemById(r.item);
      const where = mode === "in" ? `${r.rak || "-"}${r.level ? ` L${r.level}` : ""}${r.exp ? ` · exp ${r.exp}` : ""}` : allocate(r).parts.map((p) => `#${p.b.no}`).join("+");
      return `${esc(it.name)}: ${fmt(num(r.qty))} ${esc(it.unit)} · ${esc(where)}${mode === "tr" ? ` → ${esc(r.rak)} L${esc(r.level)}` : ""}`;
    });
    const title = { in: `Inbound · PO ${h.po}`, tr: "Transfer rak", out: `Outbond → ${h.outlet} · kirim ${h.kirim}`, waste: `${(h.type || "").trim()}${h.dest ? ` → ${h.dest}` : ""}` }[mode];
    const c = counts();
    const warn = mode === "out" && c.picked < c.filled ? ` (${c.filled - c.picked} item belum ✓ diambil)` : "";
    return { title: `Simpan ${title}?${warn}`, lines };
  }

  async function submit() {
    const recs = records();
    const table = mode === "waste" ? "wmsDaily" : "wmsBatches";
    for (let i = 0; i < recs.length; i += 400) await base(table, "create", { records: recs.slice(i, i + 400).map((fields) => ({ fields })) });
    const label = MODES.find((m) => m.id === mode).label;
    drafts[mode] = fresh(mode);
    filter = "all";
    query = "";
    open = "";
    save();
    status(`✅ ${label}: ${recs.length} baris tersimpan di WMS.`, "ok");
    render();
    // Stock and FIFO changed; Lark needs a moment to compute Sisa for the new rows.
    setTimeout(() => load(true).catch(() => {}), 3000);
  }

  render();
  return { load, bar, summary, submit, render };
}
