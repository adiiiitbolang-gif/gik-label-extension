import { esc } from "./labels.js";

// Fast WMS input (WMS WH Matchaman base), replacing the four Base forms with sheet-style screens.
// Each screen writes exactly the fields its form writes, so every WMS formula and workflow
// (FIFO, Sisa, Cek Batch, Area Outbond nightly cut, notifications) works as before:
//   Inbound  -> Stock Batch: Item, PO Number, Qty Transfer, Arrival Date, Rak/Level Tujuan, Expired Date, Simpan Sementara, Foto
//   Transfer -> Stock Batch: Item, Batch Asal, Qty Transfer, Rak/Level Tujuan
//   Outbond  -> Stock Batch: Tujuan Outlet, Tgl Kirim Rencana, Rak Tujuan, Item, Batch Asal, Qty Transfer
//   Waste    -> Daily Inventory: Type, Date, Tgl Kirim, Destination, Item, Batch Item, Quantity, Attachments
// What the app adds: FIFO batch picked automatically (split over several batches when one is not enough),
// default rack/level from Master Items, and the same hints the forms show, before submitting.

const ACTIVE_BATCH_VIEW = "vew5N17Guu"; // Stock Batch view "Batch aktif - untuk dipilih (Batch Sumber)"
const MODES = [
  { id: "in", label: "Inbound", icon: "📥" },
  { id: "tr", label: "Transfer", icon: "🔁" },
  { id: "out", label: "Outbond", icon: "🚚" },
  { id: "waste", label: "Kirim / Rusak", icon: "🗑" },
];

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
  const drafts = {};
  for (const m of MODES) drafts[m.id] = store.get(`gik.wms.${m.id}`, null) || fresh(m.id);

  function fresh(m) {
    if (m === "in") return { head: { po: "", arrival: today() }, rows: [{}] };
    if (m === "out") return { head: { outlet: "", kirim: today(), rak: "Area Outbond" }, rows: [{}], q: {}, picked: {}, b: {} };
    if (m === "waste") return { head: { type: "Rusak", date: today(), kirim: today(), dest: "" }, rows: [{}] };
    return { head: {}, rows: [{}] };
  }
  const d = () => drafts[mode];
  const save = () => store.set(`gik.wms.${mode}`, drafts[mode]);

  // ---------- data ----------
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
        base("wmsBatches", "fields", null, { page_size: 500 }),
        base("wmsDaily", "fields", null, { page_size: 500 }),
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

  // ---------- Outbond pick sheet ----------
  // 20-30 items per outbond: every item is listed, grouped by category, and within a category
  // in walking order (Lt 2 -> Lt 1 dry -> chiller -> freezer) with its FIFO batch and position.
  // Staff type the qty, walk the route, tick ✓ when the right batch is in hand, then save once.
  let outFilter = "all";
  let outCat = "all";
  let hideZero = store.get("gik.wms.hide0", false);
  const CAT_ORDER = ["Raw Materials", "Work In Process", "KITCHEN INVENTORY (FOOD PRODUCTION RELATED)", "Supporting Inventory", "Chemical", "Medical", "Uniform", "Merchandise"];
  const catOf = (it) => it.cat || "Tanpa kategori";
  const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 50 : i; };
  function outCategories() {
    return [...new Set(data.items.map(catOf))].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));
  }
  let outQuery = "";
  let outOpen = "";
  const ZONE_ORDER = ["Pallet", "Dry Storage", "Chiller", "Freezer", "Outbound"];
  const outDraft = () => {
    const o = drafts.out;
    if (!o.q) Object.assign(o, { q: {}, picked: {}, b: {} });
    return o;
  };

  function routeKey(it) {
    const first = fifo(it.id)[0];
    // Exact position from Master Racks, else any level of the same rak (same zone and floor).
    const p = first ? data.pos.get(first.pos) || [...data.racks.values()].find((r) => r.induk && first.pos.startsWith(`${r.induk} `)) : null;
    const cat = `${String(catRank(catOf(it))).padStart(2, "0")}|${catOf(it)}`;
    if (!first) return { key: `${cat}|2|${it.name}`, group: catOf(it) }; // no stock: end of its category
    if (!p) return { key: `${cat}|1|${it.name}`, group: catOf(it) };
    const floor = p.lantai === "Lt 2" ? 0 : 1;
    const zone = ZONE_ORDER.indexOf(p.zone);
    return { key: `${cat}|0|${floor}|${zone < 0 ? 8 : zone}|${p.induk}|${String(p.level).padStart(2, "0")}|${it.name}`, group: catOf(it) };
  }

  function outItems() {
    const o = outDraft();
    const q = outQuery.trim().toLowerCase();
    return data.items
      .filter((it) => !hideZero || fifo(it.id).length || num(o.q[it.id]) > 0)
      .filter((it) => outCat === "all" || catOf(it) === outCat)
      .filter((it) => !q || `${it.name} ${it.code}`.toLowerCase().includes(q))
      .filter((it) => outFilter === "all" || (num(o.q[it.id]) > 0 && (outFilter === "filled" || !o.picked[it.id])))
      .map((it) => ({ it, ...routeKey(it) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  function outAlloc(it) {
    const o = outDraft();
    return allocate({ item: it.id, qty: o.q[it.id], batch: o.b[it.id] || "" });
  }

  function outRowHtml(it) {
    const o = outDraft();
    const list = fifo(it.id);
    const qty = num(o.q[it.id]);
    const total = list.reduce((t, b) => t + b.sisa, 0);
    const pick = o.b[it.id] ? list.find((b) => b.id === o.b[it.id]) : list[0];
    const loc = pick ? `${o.b[it.id] ? "" : "⭐ "}#${esc(pick.no)} · ${esc(pick.pos)} · sisa ${fmt(pick.sisa)}${pick.exp ? ` · exp ${esc(pick.exp)}` : ""}` : '<span class="danger">Tidak ada batch bersisa</span>';
    let alloc = "";
    if (qty > 0) {
      const a = outAlloc(it);
      if (a.none) alloc = '<span class="danger">Tidak bisa disimpan: tidak ada batch</span>';
      else {
        alloc = `Ambil ${a.parts.map((p) => `<b>${fmt(p.q)}</b> dari #${esc(p.b.no)} (${esc(p.b.pos)})`).join(" + ")}`;
        if (a.notFifo) alloc += ' · <span class="danger">BUKAN FIFO</span>';
        if (a.short > 0) alloc += ` · <span class="danger">kurang ${fmt(a.short)} → MINUS</span>`;
      }
    }
    const batchSel = outOpen === it.id && list.length
      ? `<select class="num obatch" data-k="obatch"><option value="">Auto FIFO (#${esc(list[0].no)})</option>${list.map((b) => `<option value="${b.id}" ${b.id === o.b[it.id] ? "selected" : ""}>#${esc(b.no)} · ${esc(b.pos)} · sisa ${fmt(b.sisa)}${b.exp ? ` · exp ${esc(b.exp)}` : ""}</option>`).join("")}</select>`
      : "";
    const zero = !list.length && !(qty > 0);
    return `<div class="orow${qty > 0 ? " filled" : ""}${o.picked[it.id] ? " picked" : ""}${zero ? " zero" : ""}" data-oi="${it.id}">
      <button class="opick" data-pick aria-label="Sudah diambil ${esc(it.name)}" aria-pressed="${Boolean(o.picked[it.id])}">✓</button>
      <div class="oinfo"><b>${esc(it.name)}</b> <span class="muted">stok ${fmt(total)} ${esc(it.unit)}</span>
        <button class="oloc" data-loc>${loc} ▾</button>${batchSel}
        <div class="oalloc">${alloc}</div></div>
      <label class="oqty"><input class="num" data-k="oqty" inputmode="decimal" enterkeyhint="next" value="${esc(o.q[it.id] ?? "")}" aria-label="Qty ${esc(it.name)}" ${zero ? "disabled" : ""}><span>${esc(it.unit)}</span></label>
    </div>`;
  }

  // Category chips stay pinned at the top of the list while scrolling.
  const catChips = () => `<div class="ocats">${["all", ...outCategories()].map((cat) => `<button class="chip" data-cat="${esc(cat)}" aria-pressed="${outCat === cat}">${cat === "all" ? "Semua kategori" : esc(cat.length > 26 ? `${cat.slice(0, 24)}…` : cat)}</button>`).join("")}</div>`;

  function outSheetHtml() {
    return catChips() + outListHtml();
  }

  function outListHtml() {
    const rows = outItems();
    if (!rows.length) return `<p class="muted">${outFilter === "all" ? (outQuery ? "Tidak ada item yang cocok." : "Tidak ada item di kategori ini.") : "Belum ada item di daftar ini."}</p>`;
    const o = outDraft();
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group).push(r.it);
    }
    let html = "";
    for (const [g, its] of groups) {
      const filled = its.filter((it) => num(o.q[it.id]) > 0).length;
      html += `<div class="ogroup">${esc(g)} <span>${its.length} item${filled ? ` · ${filled} diisi` : ""}</span></div>${its.map(outRowHtml).join("")}`;
    }
    return html;
  }

  function outCounts() {
    const o = outDraft();
    const filled = Object.keys(o.q).filter((id) => num(o.q[id]) > 0);
    return { filled: filled.length, picked: filled.filter((id) => o.picked[id]).length };
  }

  function outHeadHtml() {
    const h = d().head;
    const c = outCounts();
    const chip = (v, label) => `<button class="chip" data-of="${v}" aria-pressed="${outFilter === v}">${label}</button>`;
    return `<div class="field"><span>Tujuan Outlet *</span><div class="chips">${data.opt.outlet.map((o) => `<button class="chip" data-hk="outlet" data-v="${esc(o)}" aria-pressed="${o === h.outlet}">${esc(o)}</button>`).join("")}</div></div>
      <div class="whead">${field("Tgl Kirim Rencana *", inp("kirim", h.kirim, 'type="date"'))}${field("Rak Tujuan *", sel("rak", data.opt.rak, h.rak, "Pilih rak"))}</div>
      <div class="otools">
        <input class="search" data-k="oq" type="search" placeholder="Cari item" value="${esc(outQuery)}" autocomplete="off">
        ${chip("all", "Semua")}${chip("filled", `Diisi (${c.filled})`)}${chip("todo", `Belum ✓ (${c.filled - c.picked})`)}
        <button class="chip" data-hide0 aria-pressed="${hideZero}">Sembunyikan stok 0</button>
      </div>`;
  }

  function renderCountsOnly() {
    const tools = $("whead").querySelector(".otools");
    if (tools) {
      const c = outCounts();
      tools.querySelector('[data-of="filled"]').textContent = `Diisi (${c.filled})`;
      tools.querySelector('[data-of="todo"]').textContent = `Belum ✓ (${c.filled - c.picked})`;
    }
    updateBar();
  }

  function renderOutRows() {
    $("wrows").innerHTML = outSheetHtml();
    const tools = $("whead").querySelector(".otools");
    if (tools) {
      const c = outCounts();
      tools.querySelector('[data-of="filled"]').textContent = `Diisi (${c.filled})`;
      tools.querySelector('[data-of="todo"]').textContent = `Belum ✓ (${c.filled - c.picked})`;
    }
    updateBar();
  }

  function refreshOutRow(id) {
    const el = $("wrows").querySelector(`.orow[data-oi="${id}"]`);
    const it = itemById(id);
    if (!el || !it) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = outRowHtml(it);
    const fresh = tmp.firstElementChild;
    el.className = fresh.className;
    el.querySelector(".oalloc").innerHTML = fresh.querySelector(".oalloc").innerHTML;
    el.querySelector("[data-pick]").setAttribute("aria-pressed", fresh.querySelector("[data-pick]").getAttribute("aria-pressed"));
  }

  // ---------- render ----------
  const sel = (k, options, value, ph) => `<select class="num" data-k="${k}"><option value="">${esc(ph)}</option>${options.map((o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const field = (label, inner, cls = "") => `<label class="field ${cls}"><span>${label}</span>${inner}</label>`;
  const inp = (k, v, attrs = "") => `<input class="num" data-k="${k}" value="${esc(v ?? "")}" ${attrs}>`;

  function headHtml() {
    if (mode === "out") return outHeadHtml();
    const h = d().head;
    if (mode === "in") return `<div class="whead">${field("PO / Surat Jalan *", inp("po", h.po, 'style="text-align:left" placeholder="No PO"'), "w2")}${field("Arrival Date *", inp("arrival", h.arrival, 'type="date"'))}</div>`;
    if (mode === "out") return `<div class="field"><span>Tujuan Outlet *</span><div class="chips">${data.opt.outlet.map((o) => `<button class="chip" data-hk="outlet" data-v="${esc(o)}" aria-pressed="${o === h.outlet}">${esc(o)}</button>`).join("")}</div></div><div class="whead">${field("Tgl Kirim Rencana *", inp("kirim", h.kirim, 'type="date"'))}${field("Rak Tujuan *", sel("rak", data.opt.rak, h.rak, "Pilih rak"))}</div><p class="muted">Stok masuk ke Area Outbond, lalu dipotong otomatis jam 23:30 pada Tgl Kirim.</p>`;
    if (mode === "waste") return `<div class="field"><span>Type *</span><div class="chips">${data.opt.type.map((o) => `<button class="chip" data-hk="type" data-v="${esc(o)}" aria-pressed="${o === h.type}">${esc(o.trim())}</button>`).join("")}</div></div><div class="whead">${field("Tanggal *", inp("date", h.date, 'type="date"'))}${field("Tgl Kirim *", inp("kirim", h.kirim, 'type="date"'))}</div>${h.type.trim() === "Kirim" ? `<div class="field"><span>Destination *</span><div class="chips">${data.opt.dest.map((o) => `<button class="chip" data-hk="dest" data-v="${esc(o)}" aria-pressed="${o === h.dest}">${esc(o)}</button>`).join("")}</div></div>` : ""}`;
    return `<p class="muted">Pindah stok dari batch lama ke rak/level baru. Batch diambil otomatis sesuai FIFO.</p>`;
  }

  // Options split into "belongs to this item" (⭐, first) and the rest, like a filtered picker.
  function grouped(k, mine, all, value, ph, mineLabel) {
    const opt = (o) => `<option ${o === value ? "selected" : ""}>${esc(o)}</option>`;
    const own = mine.filter((o) => all.includes(o));
    const rest = all.filter((o) => !own.includes(o));
    const body = own.length ? `<optgroup label="${esc(mineLabel)}">${own.map(opt).join("")}</optgroup><optgroup label="Lainnya">${rest.map(opt).join("")}</optgroup>` : all.map(opt).join("");
    return `<select class="num" data-k="${k}"><option value="">${esc(ph)}</option>${body}</select>`;
  }

  function rakSelect(r) {
    const it = itemById(r.item);
    return grouped("rak", it ? homeOf(it).induks : [], data.opt.rak, r.rak, "Rak", "⭐ Rak seharusnya");
  }

  function levelSelect(r) {
    const it = itemById(r.item);
    return grouped("level", it && r.rak ? homeOf(it).levelsIn(r.rak) : [], data.opt.level, r.level, "-", "⭐ Level item ini");
  }

  // Batch Sumber: only this item's batches with stock, oldest (FIFO) first.
  function batchSelect(r) {
    if (!r.item) return `<select class="num" data-k="batch" disabled><option>Pilih item dulu</option></select>`;
    const list = fifo(r.item);
    if (!list.length) return `<select class="num" data-k="batch" disabled><option>Tidak ada batch</option></select>`;
    const auto = `<option value="">Auto FIFO (#${esc(list[0].no)}${list.length > 1 ? " +" : ""})</option>`;
    return `<select class="num" data-k="batch">${auto}${list.map((b, n) => `<option value="${b.id}" ${b.id === r.batch ? "selected" : ""}>${n === 0 ? "⭐ " : ""}#${esc(b.no)} · ${esc(b.pos)} · sisa ${fmt(b.sisa)}${b.exp ? ` · exp ${esc(b.exp)}` : ""}</option>`).join("")}</select>`;
  }

  function rowHtml(r, i) {
    const it = itemById(r.item);
    const unit = it ? it.unit : "";
    const pick = `<label class="field pick c4"><span>Item *</span><input class="num" style="text-align:left" data-k="find" placeholder="Cari nama / kode" autocomplete="off" value="${esc(it ? it.name : r.find || "")}"><div class="menu" hidden></div></label>`;
    const qty = field(`Qty${unit ? ` (${esc(unit)})` : ""} *`, inp("qty", r.qty, 'inputmode="decimal"'), "c2");
    const rak = field("Rak", rakSelect(r), "c3");
    const lvl = field("Level", levelSelect(r), "c1");
    let cells = "";
    if (mode === "in") cells = pick + qty + rak + lvl + field("Expired", inp("exp", r.exp, 'type="date"'), "c2") + `<label class="field c2 wtemp"><span>Simpan sementara</span><input type="checkbox" class="chk" data-k="temp" ${r.temp ? "checked" : ""}></label>` + photoBtn(r);
    if (mode === "tr") cells = pick + qty + field("Batch asal", batchSelect(r), "c3") + rak + lvl;
    if (mode === "out") cells = pick + qty + field("Batch asal", batchSelect(r), "c4");
    if (mode === "waste") cells = pick + qty + field("Batch", batchSelect(r), "c4") + photoBtn(r);
    return `<div class="wrow" data-i="${i}">${cells}<button class="x" data-del aria-label="Hapus baris">×</button><div class="rowinfo">${hint(r)}</div></div>`;
  }

  function photoBtn(r) {
    return `<label class="field c1"><span>Foto</span><span class="photo ${r.photo ? "ok" : ""}">${r.photo ? "✓" : r.uploading ? "…" : "📷"}<input type="file" accept="image/*" capture="environment" data-k="photo" hidden></span></label>`;
  }

  function hint(r) {
    const it = itemById(r.item);
    if (!it) return "Pilih item";
    const bits = [];
    if (mode === "in" || mode === "tr") {
      const home = homeOf(it);
      if (home.induks.length) bits.push(`Rak seharusnya: ${esc(home.induks.join(", "))}${r.rak && !home.induks.includes(r.rak) ? ' <span class="danger">(beda rak)</span>' : ""}`);
      const cap = r.rak ? capacity(it.id, r.rak) : "";
      if (cap) bits.push(`Kapasitas: ${esc(cap)}`);
    }
    if (mode === "in" && !r.exp && /raw materials/i.test(it.cat)) bits.push('<span class="danger">Raw Materials: WAJIB isi Expired Date</span>');
    if (mode !== "in") {
      const a = allocate(r);
      const first = fifo(it.id)[0];
      if (!num(r.qty)) bits.push(first ? `FIFO: #${esc(first.no)} · ${esc(first.pos)} · sisa ${fmt(first.sisa)} ${esc(it.unit)}` : '<span class="danger">Tidak ada batch bersisa untuk item ini</span>');
      else if (a.none) bits.push('<span class="danger">Tidak ada batch bersisa untuk item ini — tidak bisa disimpan</span>');
      else {
        bits.push(`Ambil: ${a.parts.map((p) => `#${esc(p.b.no)} ${esc(p.b.pos)} → ${fmt(p.q)}`).join(" + ")}`);
        if (a.notFifo) bits.push('<span class="danger">BUKAN FIFO — ada batch lebih tua</span>');
        if (a.short > 0) bits.push(`<span class="danger">Stok kurang ${fmt(a.short)} ${esc(it.unit)} — batch akan MINUS</span>`);
      }
    }
    return bits.join(" · ");
  }

  function render() {
    $("wmodes").innerHTML = MODES.map((m) => `<button class="chip" data-mode="${m.id}" aria-pressed="${m.id === mode}">${m.icon} ${m.label}</button>`).join("");
    if (!loaded) return;
    $("whead").innerHTML = headHtml();
    $("wrows").innerHTML = mode === "out" ? outSheetHtml() : d().rows.map(rowHtml).join("");
    $("wadd").hidden = mode === "out";
    $("winfo").textContent = `${data.items.length} item · ${data.batches.length} batch bersisa · dimuat ${new Date(data.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    updateBar();
  }

  function refreshRow(i) {
    const el = $("wrows").querySelector(`.wrow[data-i="${i}"]`);
    if (el) el.querySelector(".rowinfo").innerHTML = hint(d().rows[i]);
  }

  // ---------- events ----------
  $("wmodes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    mode = b.dataset.mode;
    store.set("gik.wms.mode", mode);
    render();
  });
  $("wreload").addEventListener("click", () => load(true));
  $("wadd").addEventListener("click", () => { d().rows.push({}); save(); render(); $("wrows").querySelector(".wrow:last-child [data-k=find]")?.focus(); });

  $("whead").addEventListener("click", (e) => {
    const f = e.target.closest("[data-of]");
    if (f) { outFilter = f.dataset.of; $("whead").querySelectorAll("[data-of]").forEach((x) => x.setAttribute("aria-pressed", String(x === f))); return renderOutRows(); }
    const h0 = e.target.closest("[data-hide0]");
    if (h0) { hideZero = !hideZero; store.set("gik.wms.hide0", hideZero); h0.setAttribute("aria-pressed", String(hideZero)); return renderOutRows(); }
    const b = e.target.closest("[data-hk]");
    if (!b) return;
    d().head[b.dataset.hk] = b.dataset.v;
    save();
    render();
  });
  $("whead").addEventListener("input", (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    if (k === "oq") { outQuery = e.target.value; return renderOutRows(); }
    d().head[k] = e.target.value;
    save();
    updateBar();
  });

  $("wrows").addEventListener("input", async (e) => {
    if (mode === "out") {
      const orow = e.target.closest(".orow");
      if (!orow) return;
      const id = orow.dataset.oi;
      const o = outDraft();
      if (e.target.dataset.k === "oqty") {
        o.q[id] = e.target.value.replace(",", ".");
        if (!(num(o.q[id]) > 0)) { delete o.q[id]; delete o.picked[id]; }
      } else if (e.target.dataset.k === "obatch") {
        if (e.target.value) o.b[id] = e.target.value; else delete o.b[id];
      }
      save();
      refreshOutRow(id);
      updateBar();
      return;
    }
    const row = e.target.closest(".wrow");
    if (!row) return;
    const i = +row.dataset.i;
    const r = d().rows[i];
    const k = e.target.dataset.k;
    if (k === "find") {
      r.find = e.target.value;
      r.item = "";
      const q = e.target.value.trim().toLowerCase();
      const menu = row.querySelector(".menu");
      const hits = q ? data.items.filter((it) => `${it.name} ${it.code}`.toLowerCase().includes(q)).slice(0, 8) : [];
      menu.innerHTML = hits.map((it) => `<button type="button" data-item="${it.id}"><b>${esc(it.name)}</b> <span class="muted">${esc(it.code)} · ${esc(it.unit)}</span></button>`).join("");
      menu.hidden = !hits.length;
    } else if (k === "photo") {
      const file = e.target.files?.[0];
      if (!file) return;
      r.uploading = true;
      render();
      try {
        r.photo = await uploadPhoto(file, "wms");
      } catch (err) {
        status(`Foto gagal diupload: ${esc(err.message)}`);
      }
      r.uploading = false;
      save();
      render();
      return;
    } else if (k === "temp") {
      r.temp = e.target.checked;
    } else {
      r[k] = e.target.value.replace(",", ".");
      if (k === "rak") {
        // Item's own rak: take its level there; level list is re-grouped for the new rak.
        const it = itemById(r.item);
        const home = it ? homeOf(it).levelFor(r.rak) : "";
        if (home) r.level = home;
        row.querySelector('[data-k="level"]').outerHTML = levelSelect(r);
      }
    }
    save();
    refreshRow(i);
    updateBar();
  });

  $("wrows").addEventListener("click", (e) => {
    if (mode === "out") {
      const cat = e.target.closest("[data-cat]");
      if (cat) {
        outCat = cat.dataset.cat;
        renderOutRows();
        $("wrows").querySelector(".ocats").scrollIntoView({ block: "start" });
        $("wrows").querySelector('.ocats [aria-pressed="true"]')?.scrollIntoView({ inline: "center", block: "nearest" });
        return;
      }
      const orow = e.target.closest(".orow");
      if (!orow) return;
      const id = orow.dataset.oi;
      const o = outDraft();
      if (e.target.closest("[data-pick]")) {
        if (!(num(o.q[id]) > 0)) return orow.querySelector('[data-k="oqty"]').focus();
        if (o.picked[id]) delete o.picked[id]; else o.picked[id] = true;
        save();
        if (outFilter === "todo") renderOutRows(); else { refreshOutRow(id); renderCountsOnly(); }
      } else if (e.target.closest("[data-loc]")) {
        outOpen = outOpen === id ? "" : id;
        renderOutRows();
      }
      return;
    }
    const row = e.target.closest(".wrow");
    if (!row) return;
    const i = +row.dataset.i;
    const pickBtn = e.target.closest("[data-item]");
    if (pickBtn) {
      const it = itemById(pickBtn.dataset.item);
      const r = d().rows[i];
      Object.assign(r, { item: it.id, find: "", batch: "" });
      if (mode === "in" || mode === "tr") {
        const home = homeOf(it);
        if (home.induks.length === 1 || (home.induks.length && !r.rak)) {
          r.rak = home.induks[0];
          r.level = home.levelFor(r.rak);
        }
      }
      save();
      render();
      $("wrows").querySelector(`.wrow[data-i="${i}"] [data-k="qty"]`)?.focus();
    } else if (e.target.closest("[data-del]")) {
      d().rows.splice(i, 1);
      if (!d().rows.length) d().rows.push({});
      save();
      render();
    }
  });

  // ---------- validate + submit ----------
  function problems() {
    const h = d().head;
    const out = [];
    const rows = mode === "out"
      ? Object.entries(outDraft().q).filter(([, q]) => num(q) > 0).map(([item, qty]) => ({ item, qty, batch: outDraft().b[item] || "" }))
      : d().rows.filter((r) => r.item || r.qty);
    if (!rows.length) out.push(mode === "out" ? "Isi qty item yang dikirim" : "Belum ada baris");
    if (mode === "in" && !h.po?.trim()) out.push("Isi PO / Surat Jalan");
    if (mode === "in" && !h.arrival) out.push("Isi Arrival Date");
    if (mode === "out" && !h.outlet) out.push("Pilih Tujuan Outlet");
    if (mode === "out" && (!h.kirim || !h.rak)) out.push("Isi Tgl Kirim dan Rak Tujuan");
    if (mode === "waste" && (!h.type || !h.date || !h.kirim)) out.push("Isi Type, Tanggal dan Tgl Kirim");
    if (mode === "waste" && h.type?.trim() === "Kirim" && !h.dest) out.push("Pilih Destination");
    rows.forEach((r, n) => {
      if (!r.item) out.push(`Baris ${n + 1}: pilih item`);
      else if (!(num(r.qty) > 0)) out.push(`Baris ${n + 1}: isi Qty`);
      else if (mode !== "in" && allocate(r).none) out.push(`Baris ${n + 1}: tidak ada batch bersisa`);
      if (mode === "tr" && r.item && (!r.rak || !r.level)) out.push(`Baris ${n + 1}: pilih Rak dan Level tujuan`);
      if (r.uploading) out.push(`Baris ${n + 1}: foto masih diupload`);
    });
    return { rows: rows.filter((r) => r.item && num(r.qty) > 0), out };
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
    const c = mode === "out" ? outCounts() : null;
    const ready = mode === "out" ? `<b>${c.filled}</b> item · ✓ ${c.picked}/${c.filled} diambil · ${records().length} baris` : `<b>${p.rows.length}</b> item siap · ${records().length} baris ke WMS`;
    const html = p.out.length ? `<span class="danger">${esc(p.out[0])}${p.out.length > 1 ? ` (+${p.out.length - 1})` : ""}</span>` : ready;
    return { html, label, disabled: p.out.length > 0 };
  }

  function summary() {
    const h = d().head;
    const lines = problems().rows.map((r) => {
      const it = itemById(r.item);
      const a = mode === "in" ? null : allocate(r);
      const where = mode === "in" ? `${r.rak || "-"}${r.level ? ` L${r.level}` : ""}` : a.parts.map((p) => `#${p.b.no}`).join("+");
      return `${esc(it.name)}: ${fmt(num(r.qty))} ${esc(it.unit)} · ${esc(where)}${mode === "tr" ? ` → ${esc(r.rak)} L${esc(r.level)}` : ""}`;
    });
    const title = { in: `Inbound · PO ${h.po}`, tr: "Transfer rak", out: `Outbond → ${h.outlet} · kirim ${h.kirim}`, waste: `${(h.type || "").trim()}${h.dest ? ` → ${h.dest}` : ""}` }[mode];
    const c = mode === "out" ? outCounts() : null;
    const warn = c && c.picked < c.filled ? ` (${c.filled - c.picked} item belum ✓ diambil)` : "";
    return { title: `Simpan ${title}?${warn}`, lines };
  }

  async function submit() {
    const recs = records();
    const table = mode === "waste" ? "wmsDaily" : "wmsBatches";
    for (let i = 0; i < recs.length; i += 400) await base(table, "create", { records: recs.slice(i, i + 400).map((fields) => ({ fields })) });
    const label = MODES.find((m) => m.id === mode).label;
    drafts[mode] = fresh(mode);
    if (mode === "out") { outFilter = "all"; outQuery = ""; outOpen = ""; outCat = "all"; }
    save();
    status(`✅ ${label}: ${recs.length} baris tersimpan di WMS.`, "ok");
    render();
    // Stock and FIFO changed; Lark needs a moment to compute Sisa for the new rows.
    setTimeout(() => load(true).catch(() => {}), 3000);
  }

  render();
  return { load, bar, summary, submit, render };
}
