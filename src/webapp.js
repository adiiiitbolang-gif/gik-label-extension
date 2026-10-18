import { esc, encodeLine, parseLabelData, sheetHtml, injectLabelCss } from "./labels.js";
import { drawLabel, canvasToFile } from "./labelImage.js";
import { setupDirectPrint } from "./directPrint.js";
import { createWms } from "./wms.js";

// GIK Production web app: opened from Lark Workplace (phone/tablet) or a browser.
// Writes go straight to the Production base with the signed-in user's own token (through the Worker),
// so no Base automation runs are used: labels are built and printed right here.
const $ = (id) => document.getElementById(id);
const ua = navigator.userAgent;
const inLark = /Lark|Feishu/i.test(ua) && Boolean(window.h5sdk || window.tt);
const isMobile = /Android|iPhone|iPad/i.test(ua);
// bitable:app covers the Base v1 record calls (search, batch_create, batch_get).
const SCOPES = ["bitable:app"];
const OUTLETS = ["Central Kitchen", "MM Blok M", "MM PP", "MM Kokas", "MM CP", "MM PIM", "Peppino", "Maiku", "Lain2"];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off: drafts just aren't kept */ } },
};

// ---------- sign-in ----------
let sess = (() => { try { return JSON.parse(sessionStorage.getItem("gik.session") || "null"); } catch { return null; } })();
function saveSess(s) {
  sess = s;
  try { sessionStorage.setItem("gik.session", JSON.stringify(s)); } catch { /* fine */ }
  $("who").textContent = s?.name || "";
}

function status(msg, kind = "note") {
  const el = $("status");
  el.className = kind;
  el.innerHTML = msg || "";
  el.hidden = !msg;
}

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || `HTTP ${r.status}`);
  return j;
}

function larkCode(appId) {
  return new Promise((resolve, reject) => {
    const scopeList = SCOPES;
    const run = () => {
      const tt = window.tt;
      const fallback = () => tt.requestAuthCode({ appId, success: (r) => resolve(r.code), fail: (e) => reject(new Error(e?.errString || "sign-in refused")) });
      if (tt?.requestAccess) {
        tt.requestAccess({ appID: appId, scopeList, state: "gik", success: (r) => resolve(r.code), fail: (e) => (e?.errno === 103 ? fallback() : reject(new Error(e?.errString || "sign-in refused"))) });
      } else if (tt?.requestAuthCode) fallback();
      else reject(new Error("Lark sign-in is not available here"));
    };
    if (window.h5sdk?.ready) window.h5sdk.ready(run);
    else run();
  });
}

let signing = null;
function signIn() {
  if (!signing) signing = doSignIn().finally(() => (signing = null));
  return signing;
}

async function doSignIn() {
  if (sess?.token && Date.now() < sess.expires_at) return saveSess(sess);
  if (sess?.refresh_token) {
    try { return saveSess(await post("/api/refresh", sess)); } catch { /* fall through to a new sign-in */ }
  }
  const { appId } = await fetch("/api/config").then((r) => r.json());
  if (inLark) return saveSess(await post("/api/login", { code: await larkCode(appId) }));
  // Plain browser: Lark OAuth redirect.
  const back = location.origin + location.pathname;
  const q = new URLSearchParams(location.search);
  if (q.get("code") && q.get("state") === "gik") {
    history.replaceState(null, "", back);
    return saveSess(await post("/api/login", { code: q.get("code"), redirect_uri: back }));
  }
  const auth = new URL("https://accounts.larksuite.com/open-apis/authen/v1/authorize");
  auth.search = new URLSearchParams({ client_id: appId, redirect_uri: back, state: "gik", scope: `${SCOPES.join(" ")} offline_access` });
  location.href = auth.toString();
  await new Promise(() => {}); // leaving the page
}

// ---------- Base access ----------
async function base(table, op, body, params = {}, retried = false) {
  if (!sess || Date.now() > sess.expires_at) await signIn();
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`/api/base/${table}/${op}${qs ? `?${qs}` : ""}`, {
    method: op === "fields" ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-lark-token": sess.token },
    body: op === "fields" ? undefined : JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if ((r.status === 401 || j.code === 99991677 || j.code === 99991668) && !retried) {
    sess = { ...sess, expires_at: 0 };
    await signIn();
    return base(table, op, body, params, true);
  }
  // Token from an older sign-in without the Base scope: sign in again so Lark asks for it.
  if ((j.code === 99991679 || /re-authorization/i.test(j.msg || "")) && !retried) {
    saveSess(null);
    await signIn();
    return base(table, op, body, params, true);
  }
  if (j.code !== 0) throw new Error(j.msg || `Base error ${j.code}`);
  return j.data;
}

async function searchAll(table, body) {
  const out = [];
  let page_token = "";
  do {
    const d = await base(table, "search", body, { page_size: 500, ...(page_token ? { page_token } : {}) });
    out.push(...(d.items || []));
    page_token = d.has_more ? d.page_token : "";
  } while (page_token);
  return out;
}

// Cell values come back as text runs, option names, link objects or plain numbers.
function txt(x) {
  if (x == null) return "";
  if (Array.isArray(x)) return x.map(txt).join("");
  if (typeof x === "object") {
    if ("text" in x) return String(x.text ?? "");
    if ("value" in x) return txt(x.value);
    if ("name" in x) return String(x.name ?? "");
    return "";
  }
  return String(x);
}
const num = (x) => parseFloat(txt(x)) || 0;
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US");

// ---------- tabs ----------
let tab = store.get("gik.tab", "today");
function show(t) {
  tab = t;
  store.set("gik.tab", t);
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
  document.querySelectorAll("[data-view]").forEach((s) => (s.hidden = s.dataset.view !== t));
  $("bar").hidden = t === "labels" || t === "today";
  if (t === "labels") loadRecent();
  if (t === "today" && booted) loadDay();
  if (t === "wms" && booted) wms.load().catch(() => {});
  updateBar();
}
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));

// ---------- production ----------
let recipes = [];
let draft = store.get("gik.prod", {}); // recipeId -> { b, q, c, p }
let filledOnly = false;

async function loadRecipes() {
  const items = await searchAll("recipes", {
    field_names: ["Recipe Name", "Output Code", "Product Name", "Output Unit", "Yield Qty", "Active"],
    automatic_fields: false,
  });
  recipes = items
    .map((r) => ({ id: r.record_id, name: txt(r.fields["Recipe Name"]), code: txt(r.fields["Output Code"]), product: txt(r.fields["Product Name"]), unit: txt(r.fields["Output Unit"]), yieldQty: num(r.fields["Yield Qty"]), active: r.fields.Active === true }))
    .filter((r) => r.active && r.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  renderRecipes();
}

function prodRows() {
  return recipes.filter((r) => { const d = draft[r.id]; return d && num(d.q) > 0 && num(d.b) > 0; });
}

function yieldText(r, d) {
  const b = num(d?.b);
  const q = num(d?.q);
  if (!q && !b) return { t: "", warn: false };
  if (q && !b) return { t: "batches?", warn: true };
  if (b && !q) return { t: "output?", warn: true };
  if (!r.yieldQty) return { t: "", warn: false };
  const pct = Math.round((q / (b * r.yieldQty)) * 100);
  return { t: `${pct}%`, warn: pct < 70 || pct > 130 };
}

function renderRecipes() {
  const q = $("psearch").value.trim().toLowerCase();
  const list = recipes.filter((r) => (!q || `${r.name} ${r.code} ${r.product}`.toLowerCase().includes(q)) && (!filledOnly || draft[r.id]));
  $("plist").innerHTML = list.length
    ? list.map((r) => {
        const d = draft[r.id] || {};
        const y = yieldText(r, d);
        const filled = num(d.q) > 0 && num(d.b) > 0;
        return `<div class="prow${filled ? " filled" : ""}" data-id="${r.id}">
          <div class="pinfo"><div class="pname">${esc(r.name)}</div><div class="psub">${esc(r.code)} · 1 batch = ${fmt(r.yieldQty)} ${esc(r.unit)}</div></div>
          <label><span class="lbl-m">Std batches</span><input class="num" data-k="b" inputmode="decimal" enterkeyhint="next" value="${esc(d.b ?? "")}" aria-label="Std batches ${esc(r.name)}"></label>
          <label class="unit"><span class="lbl-m">Output</span><input class="num" data-k="q" inputmode="decimal" enterkeyhint="next" value="${esc(d.q ?? "")}" aria-label="Output ${esc(r.unit)} ${esc(r.name)}"><span>${esc(r.unit)}</span></label>
          <label><span class="lbl-m">Containers</span><input class="num" data-k="c" inputmode="numeric" enterkeyhint="next" value="${esc(d.c ?? "")}" aria-label="Containers ${esc(r.name)}"></label>
          <label class="cprint"><span class="lbl-m">Print</span><input type="checkbox" class="chk" data-k="p" ${d.p ? "checked" : ""} aria-label="Print labels ${esc(r.name)}"></label>
          <div class="yield${y.warn ? " warn" : ""}" data-y>${y.t}</div>
        </div>`;
      }).join("")
    : `<p class="muted">${recipes.length ? "No recipe matches." : "Loading recipes…"}</p>`;
  updateBar();
}

$("plist").addEventListener("input", (e) => {
  const row = e.target.closest(".prow");
  if (!row) return;
  const id = row.dataset.id;
  const d = { ...(draft[id] || {}) };
  const k = e.target.dataset.k;
  d[k] = k === "p" ? e.target.checked : e.target.value.replace(",", ".");
  if (!d.b && !d.q && !d.c && !d.p) delete draft[id];
  else draft[id] = d;
  store.set("gik.prod", draft);
  const r = recipes.find((x) => x.id === id);
  const y = yieldText(r, d);
  const yEl = row.querySelector("[data-y]");
  yEl.textContent = y.t;
  yEl.classList.toggle("warn", y.warn);
  row.classList.toggle("filled", num(d.q) > 0 && num(d.b) > 0);
  updateBar();
});
// Enter jumps to the next input, like moving down a sheet.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.classList?.contains("num")) return;
  const all = [...document.querySelectorAll("main section:not([hidden]) input.num")];
  const next = all[all.indexOf(e.target) + 1];
  if (next) { e.preventDefault(); next.focus(); next.select?.(); }
});
$("psearch").addEventListener("input", renderRecipes);
$("pfilled").addEventListener("click", () => { filledOnly = !filledOnly; $("pfilled").setAttribute("aria-pressed", String(filledOnly)); renderRecipes(); });
$("pclear").addEventListener("click", () => { if (Object.keys(draft).length && confirm("Clear every number on the sheet?")) { draft = {}; store.set("gik.prod", draft); renderRecipes(); } });

function lotFor(code) {
  const d = new Date();
  return `${code}-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function batchLine(rec) {
  const f = rec.fields;
  const containers = num(f["Containers (labels)"]);
  const v = {
    name: txt(f["Product Name"]),
    code: txt(f["Product Code"]),
    batch: txt(f["Lot Code"]) || txt(f["Batch No"]),
    prod: txt(f["Prod Date (label)"]),
    exp: txt(f["Expiry (label)"]),
    run: txt(f["Label Batch Line"]),
    net: txt(f["Label Net"]) || `${fmt(num(f["Actual Output Qty"]))} ${txt(f.Unit)}`,
    storage: txt(f.Storage),
    allergens: txt(f.Allergens),
    dest: "",
  };
  return encodeLine(v, containers || 1);
}

async function submitProduction() {
  const rows = prodRows();
  const now = Date.now();
  const created = await base("batches", "create", {
    records: rows.map((r) => {
      const d = draft[r.id];
      const fields = { Recipe: [r.id], "Actual Output Qty": num(d.q), "Recipe Runs (batch)": num(d.b), "Lot Code": lotFor(r.code), Status: "Done", "Production Date": now, "Print labels?": "No" };
      if (num(d.c) > 0) fields["Containers (labels)"] = Math.round(num(d.c));
      return { fields };
    }),
  });
  const ids = created.records.map((x) => x.record_id);
  const printIds = ids.filter((_, i) => draft[rows[i].id].p);
  for (const r of rows) delete draft[r.id];
  store.set("gik.prod", draft);
  renderRecipes();
  status(`✅ Saved ${ids.length} production batch(es).`, "ok");
  if (printIds.length) {
    const recs = await getRecords("batches", printIds);
    openLabels(recs.map(batchLine).join("^"), `Production · ${printIds.length} product(s)`);
  }
}

async function getRecords(table, ids) {
  const d = await base(table, "get", { record_ids: ids, automatic_fields: false });
  const byId = Object.fromEntries((d.records || []).map((r) => [r.record_id, r]));
  return ids.map((id) => byId[id]).filter(Boolean);
}

// ---------- packing ----------
let items = [];
let batches = []; // recent production batches, for the optional batch pick
let outlet = store.get("gik.outlet", "");
let krows = store.get("gik.pack", [{}]);

async function loadItems() {
  const list = await searchAll("items", { field_names: ["Item", "Code", "Product Name", "Unit"], automatic_fields: false });
  items = list.map((r) => ({ id: r.record_id, code: txt(r.fields.Code), name: txt(r.fields["Product Name"]), unit: txt(r.fields.Unit) })).filter((i) => i.code);
  renderPacking();
}

async function loadBatches() {
  const list = await searchAll("batches", {
    field_names: ["Batch No", "Lot Code", "Product Name", "Product Code", "Prod Date (label)", "Expiry (label)", "Label Batch Line", "Label Net", "Actual Output Qty", "Unit", "Storage", "Allergens", "Containers (labels)", "Production Date"],
    sort: [{ field_name: "Production Date", desc: true }],
    automatic_fields: false,
  });
  batches = list.slice(0, 300);
}

function renderOutlets() {
  $("outlets").innerHTML = OUTLETS.map((o) => `<button class="chip" data-o="${esc(o)}" aria-pressed="${o === outlet}">${esc(o)}</button>`).join("");
  $("cknote").hidden = outlet !== "Central Kitchen";
}
$("outlets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-o]");
  if (!b) return;
  outlet = b.dataset.o;
  store.set("gik.outlet", outlet);
  renderOutlets();
  updateBar();
});

function rowCalc(r) {
  const split = num(r.split);
  const qty = num(r.qty);
  const labels = num(r.labels);
  const count = split > 0 ? (labels > 0 ? labels : qty > 0 ? Math.ceil(qty / split) : 1) : labels > 0 ? labels : 1;
  const total = split > 0 && labels > 0 ? split * labels : qty;
  return { count, total, net: split > 0 ? split : total };
}

function rowInfo(r) {
  const it = items.find((i) => i.id === r.item);
  if (!it) return "Pick a product";
  const c = rowCalc(r);
  if (!c.total) return "Enter Qty, or Split × Labels";
  return `${c.count} label(s) × ${fmt(c.net)} ${esc(it.unit)} · total ${fmt(c.total)} ${esc(it.unit)}`;
}

function renderPacking() {
  renderOutlets();
  $("krows").innerHTML = krows.map((r, i) => {
    const it = items.find((x) => x.id === r.item);
    const mine = it ? batches.filter((b) => txt(b.fields["Product Code"]) === it.code).slice(0, 10) : [];
    return `<div class="krow" data-i="${i}">
      <label class="field pick"><span>Product</span><input class="num" style="text-align:left" data-k="find" placeholder="Search code or name" autocomplete="off" value="${esc(it ? `${it.code} · ${it.name}` : r.find || "")}"><div class="menu" hidden></div></label>
      <label class="field"><span>Split</span><input class="num" data-k="split" inputmode="decimal" value="${esc(r.split ?? "")}"></label>
      <label class="field"><span>Labels</span><input class="num" data-k="labels" inputmode="numeric" value="${esc(r.labels ?? "")}"></label>
      <label class="field"><span>Qty</span><input class="num" data-k="qty" inputmode="decimal" value="${esc(r.qty ?? "")}"></label>
      <label class="field kbatch"><span>Batch</span><select class="num" data-k="batch"><option value="">Latest (auto)</option>${mine.map((b) => `<option value="${b.record_id}" ${b.record_id === r.batch ? "selected" : ""}>${esc(txt(b.fields["Lot Code"]) || txt(b.fields["Batch No"]))} · ${esc(txt(b.fields["Prod Date (label)"]).slice(0, 5))}</option>`).join("")}</select></label>
      <button class="x" data-del aria-label="Remove row">×</button>
      <div class="rowinfo">${rowInfo(r)}</div>
    </div>`;
  }).join("");
  updateBar();
}

function saveRows() { store.set("gik.pack", krows); }

$("krows").addEventListener("input", (e) => {
  const row = e.target.closest(".krow");
  if (!row) return;
  const i = +row.dataset.i;
  const k = e.target.dataset.k;
  if (k === "find") {
    krows[i] = { ...krows[i], find: e.target.value, item: "" };
    const q = e.target.value.trim().toLowerCase();
    const menu = row.querySelector(".menu");
    const hits = q ? items.filter((it) => `${it.code} ${it.name}`.toLowerCase().includes(q)).slice(0, 8) : [];
    menu.innerHTML = hits.map((it) => `<button type="button" data-item="${it.id}"><b>${esc(it.code)}</b> · ${esc(it.name)}</button>`).join("");
    menu.hidden = !hits.length;
  } else {
    krows[i] = { ...krows[i], [k]: e.target.value.replace(",", ".") };
    row.querySelector(".rowinfo").innerHTML = rowInfo(krows[i]);
  }
  saveRows();
  updateBar();
});
$("krows").addEventListener("click", (e) => {
  const row = e.target.closest(".krow");
  if (!row) return;
  const i = +row.dataset.i;
  const pick = e.target.closest("[data-item]");
  if (pick) {
    krows[i] = { ...krows[i], item: pick.dataset.item, find: "", batch: "" };
    saveRows();
    renderPacking();
    row.parentElement.querySelector(`.krow[data-i="${i}"] [data-k="split"]`)?.focus();
  } else if (e.target.closest("[data-del]")) {
    krows.splice(i, 1);
    if (!krows.length) krows.push({});
    saveRows();
    renderPacking();
  }
});
$("kadd").addEventListener("click", () => { krows.push({}); saveRows(); renderPacking(); $("krows").querySelector(".krow:last-child [data-k=find]")?.focus(); });

function packRows() { return krows.filter((r) => r.item && rowCalc(r).total > 0); }

async function submitPacking() {
  const rows = packRows();
  const now = Date.now();
  const created = await base("packing", "create", {
    records: rows.map((r) => {
      const fields = { Item: [r.item], Outlet: outlet, "Packing Date": now, "Print labels?": "No" };
      if (num(r.split) > 0) fields.Split = num(r.split);
      if (num(r.labels) > 0) fields.Labels = Math.round(num(r.labels));
      if (num(r.qty) > 0) fields.Qty = num(r.qty);
      if (r.batch) fields["Batch (optional)"] = [r.batch];
      return { fields };
    }),
  });
  const ids = created.records.map((x) => x.record_id);
  krows = [{}];
  saveRows();
  renderPacking();
  status(`✅ Packed ${ids.length} product(s) for ${esc(outlet)}.`, "ok");
  if ($("kprint").checked) {
    const recs = await getRecords("packing", ids);
    openLabels(recs.map((r) => txt(r.fields["Label Line"])).filter(Boolean).join("^"), `Packing → ${outlet}`);
  }
}

// ---------- bottom bar + confirm ----------
function updateBar() {
  if (tab === "prod") {
    const rows = prodRows();
    const missing = recipes.filter((r) => { const d = draft[r.id]; return d && (num(d.q) > 0) !== (num(d.b) > 0); }).length;
    $("sum").innerHTML = `<b>${rows.length}</b> product(s) ready${missing ? ` · <span class="danger">${missing} need both batches and output</span>` : ""}`;
    $("submit").textContent = "Submit production";
    $("submit").disabled = !rows.length || missing > 0;
  } else if (tab === "pack") {
    const rows = packRows();
    const labels = rows.reduce((t, r) => t + rowCalc(r).count, 0);
    $("sum").innerHTML = outlet ? `<b>${rows.length}</b> product(s) · ${labels} label(s) → <b>${esc(outlet)}</b>` : `<span class="danger">Pick an outlet</span>`;
    $("submit").textContent = "Submit packing";
    $("submit").disabled = !rows.length || !outlet;
  } else if (tab === "wms" && wms) {
    const b = wms.bar();
    $("sum").innerHTML = b.html;
    $("submit").textContent = b.label;
    $("submit").disabled = b.disabled;
  }
}

$("submit").addEventListener("click", () => {
  if (tab === "wms") {
    const s = wms.summary();
    $("ctitle").textContent = s.title;
    $("clist").innerHTML = s.lines.map((l) => `<li>${l}</li>`).join("");
    return $("confirm").showModal();
  }
  const lines = tab === "prod"
    ? prodRows().map((r) => { const d = draft[r.id]; return `${esc(r.name)}: ${fmt(num(d.b))} batch → ${fmt(num(d.q))} ${esc(r.unit)}${d.p ? ` · 🖨 ${num(d.c) || 1}` : ""}`; })
    : packRows().map((r) => { const it = items.find((x) => x.id === r.item); const c = rowCalc(r); return `${esc(it.name)}: ${c.count} × ${fmt(c.net)} ${esc(it.unit)}`; });
  $("ctitle").textContent = tab === "prod" ? "Submit production?" : `Submit packing → ${outlet}?`;
  $("clist").innerHTML = lines.map((l) => `<li>${l}</li>`).join("");
  $("confirm").showModal();
});
$("cno").addEventListener("click", () => $("confirm").close());
$("cyes").addEventListener("click", async () => {
  $("confirm").close();
  $("submit").disabled = true;
  status("Saving…");
  try {
    if (tab === "prod") await submitProduction();
    else if (tab === "wms") await wms.submit();
    else await submitPacking();
  } catch (e) {
    status(`Could not save: ${esc(e.message)}. Nothing was lost, try again.`);
  }
  updateBar();
});

// ---------- labels ----------
let labelData = "";

function labelList(data) {
  const out = [];
  for (const g of parseLabelData(data)) {
    const n = Math.max(1, Math.min(200, g.count));
    for (let i = 1; i <= n; i++) out.push({ v: i === n && g.lastNet ? { ...g.v, net: g.lastNet } : g.v, i, total: n });
  }
  return out;
}

function openLabels(data, title) {
  labelData = data;
  const list = labelList(data);
  $("lbltitle").textContent = `${title} · ${list.length} label(s)`;
  $("previews").innerHTML = "";
  list.slice(0, 40).forEach((l) => $("previews").appendChild(drawLabel(l.v, l.i, l.total)));
  $("lblnote").hidden = true;
  $("lblset").hidden = !list.length;
  $("printsheet").innerHTML = parseLabelData(data).map((g) => sheetHtml(g.v, g.count, g.lastNet)).join("");
  $("printnow").hidden = inLark && isMobile; // Lark's phone webview has no print dialog
  show("labels");
  window.scrollTo(0, 0);
}

function lblNote(msg) { $("lblnote").innerHTML = msg; $("lblnote").hidden = !msg; }

$("share").addEventListener("click", async () => {
  lblNote("");
  const list = labelList(labelData);
  const files = await Promise.all(list.map((l, k) => canvasToFile(drawLabel(l.v, l.i, l.total), `label-${String(k + 1).padStart(2, "0")}.png`)));
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: "Labels" }); } catch (e) { if (e?.name !== "AbortError") lblNote("Sharing failed here. Tap <b>Open in browser to print</b>."); }
  } else {
    lblNote("This screen can't share images to other apps. Tap <b>Open in browser to print</b>, then <b>Send to printer app</b> there.");
  }
});

let jsReady = null;
function larkJsConfig() {
  if (!jsReady) {
    jsReady = (async () => {
      const page = location.href.split("#")[0];
      const c = await fetch(`/api/jsconfig?url=${encodeURIComponent(page)}`).then((r) => r.json());
      await new Promise((resolve, reject) => window.h5sdk.config({ ...c, jsApiList: ["openSchema"], onSuccess: resolve, onFail: reject }));
    })().catch((e) => { jsReady = null; throw e; });
  }
  return jsReady;
}

$("openext").addEventListener("click", async () => {
  const url = `${location.origin}/print.html?L=${labelData}`;
  if (!inLark) return window.open(url, "_blank");
  try {
    await larkJsConfig();
    window.tt.openSchema({ schema: url, external: true, fail: () => fallbackOpen(url) });
  } catch {
    fallbackOpen(url);
  }
});
function fallbackOpen(url) {
  if (/Android/i.test(ua)) location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
  else lblNote(`Open this link in Safari/Chrome: <a href="${esc(url)}" target="_blank">print page</a>`);
}
$("printnow").addEventListener("click", () => window.print());

// Outside Lark (Chrome): print straight to the XP-4601B over Bluetooth, no printer app needed.
if (!inLark) {
  setupDirectPrint({
    btn: $("direct"), pickBtn: $("pick"), bleBtn: $("ble"), more: $("directMore"), note: $("directNote"),
    getCanvases: () => labelList(labelData).map((l) => drawLabel(l.v, l.i, l.total)),
  });
  if (!$("direct").hidden) $("openext").hidden = true;
  else $("openext").textContent = "Open print page";
}

async function loadRecent() {
  try {
    await loadBatches();
    $("recentB").innerHTML = batches.slice(0, 15).map((b) => `<div class="lrow"><div class="t"><b>${esc(txt(b.fields["Product Name"]))}</b><span class="muted">${esc(txt(b.fields["Lot Code"]) || txt(b.fields["Batch No"]))} · ${esc(txt(b.fields["Label Batch Line"]))} · ${esc(txt(b.fields["Prod Date (label)"]))}</span></div><button class="ghost" data-b="${b.record_id}">Labels</button></div>`).join("") || `<p class="muted">No batches yet.</p>`;
    const packs = await searchAll("packing", { field_names: ["Packing Ref", "Outlet", "Packing Summary", "Packing Label Data", "Created At"], sort: [{ field_name: "Created At", desc: true }], automatic_fields: false });
    const seen = new Map();
    for (const p of packs) { const ref = txt(p.fields["Packing Ref"]); if (ref && !seen.has(ref)) seen.set(ref, p); if (seen.size >= 15) break; }
    $("recentP").innerHTML = [...seen.values()].map((p) => `<div class="lrow"><div class="t"><b>${esc(txt(p.fields.Outlet))} · ${esc(txt(p.fields["Packing Ref"]))}</b><span class="muted">${esc(txt(p.fields["Packing Summary"]).split("\n").join(" · "))}</span></div><button class="ghost" data-p="${p.record_id}">Labels</button></div>`).join("") || `<p class="muted">No packing yet.</p>`;
    recentPacks = Object.fromEntries([...seen.values()].map((p) => [p.record_id, p]));
  } catch (e) {
    $("recentB").innerHTML = `<p class="note">Could not load: ${esc(e.message)}</p>`;
  }
}
let recentPacks = {};
$("v-labels").addEventListener("click", (e) => {
  const b = e.target.closest("[data-b]");
  const p = e.target.closest("[data-p]");
  if (b) { const rec = batches.find((x) => x.record_id === b.dataset.b); if (rec) openLabels(batchLine(rec), txt(rec.fields["Product Name"])); }
  if (p) { const rec = recentPacks[p.dataset.p]; if (rec) openLabels(txt(rec.fields["Packing Label Data"]), `Packing → ${txt(rec.fields.Outlet)}`); }
});

// ---------- today dashboard ----------
let day = new Date();
day.setHours(0, 0, 0, 0);
let dayData = { batches: [], packs: [] };

const DAY_MS = 86400000;
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const time = (ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const pct = (x) => { const n = num(x); return n ? Math.round(n <= 3 ? n * 100 : n) : 0; };

// Newest first; stop paging once records are older than the day.
async function fetchDay(table, fields, dateField, start, end) {
  const out = [];
  let page_token = "";
  for (;;) {
    const d = await base(table, "search", { field_names: fields, sort: [{ field_name: dateField, desc: true }], automatic_fields: false }, { page_size: 200, ...(page_token ? { page_token } : {}) });
    const items = d.items || [];
    for (const r of items) {
      const t = num(r.fields[dateField]);
      if (t >= start && t < end) out.push(r);
    }
    const last = items.length ? num(items[items.length - 1].fields[dateField]) : 0;
    if (!d.has_more || last < start) break;
    page_token = d.page_token;
  }
  return out.reverse(); // oldest first within the day
}

async function loadDay() {
  const start = day.getTime();
  const end = start + DAY_MS;
  $("dtitle").textContent = sameDay(day, new Date()) ? "Today" : day.toLocaleDateString("en-GB", { weekday: "long" });
  $("dsub").textContent = day.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  $("dnext").disabled = sameDay(day, new Date());
  $("kpis").innerHTML = `<p class="muted">Loading…</p>`;
  try {
    const [b, p] = await Promise.all([
      fetchDay("batches", ["Batch No", "Lot Code", "Product Name", "Product Code", "Prod Date (label)", "Expiry (label)", "Label Batch Line", "Label Net", "Actual Output Qty", "Unit", "Storage", "Allergens", "Containers (labels)", "Production Date", "Recipe Runs (batch)", "Yield %", "Created By"], "Production Date", start, end),
      fetchDay("packing", ["Item Name", "Item Code", "Outlet", "Total Qty", "Unit", "Label Count", "Container Net", "Packing Ref", "Packing Date", "Created By", "Label Line"], "Packing Date", start, end),
    ]);
    dayData = { batches: b, packs: p };
    renderDay();
  } catch (e) {
    $("kpis").innerHTML = `<p class="note">Could not load: ${esc(e.message)}</p>`;
  }
}

// Packing rows grouped by submission (Packing Ref).
function groupPacks(rows) {
  const m = new Map();
  for (const r of rows) {
    const ref = txt(r.fields["Packing Ref"]) || r.record_id;
    if (!m.has(ref)) m.set(ref, []);
    m.get(ref).push(r);
  }
  return [...m.entries()].map(([ref, rs]) => ({ ref, rows: rs, outlet: txt(rs[0].fields.Outlet), at: num(rs[0].fields["Packing Date"]), by: txt(rs[0].fields["Created By"]) }));
}

function packHtml(g) {
  const lines = g.rows.map((r) => `<li>${esc(txt(r.fields["Item Name"]))} — ${fmt(num(r.fields["Label Count"]))} × ${fmt(num(r.fields["Container Net"]))} ${esc(txt(r.fields.Unit))} <span class="muted">(${fmt(num(r.fields["Total Qty"]))})</span></li>`).join("");
  return `<div class="pk"><div class="t"><b>${esc(time(g.at))}</b> <span class="muted">· ${esc(g.by)} · ${esc(g.ref)}</span><ul>${lines}</ul></div><button class="ghost" data-pref="${esc(g.ref)}">Labels</button></div>`;
}

function renderDay() {
  const { batches: bs, packs: ps } = dayData;
  const out = ps.filter((r) => txt(r.fields.Outlet) !== "Central Kitchen");
  const ck = ps.filter((r) => txt(r.fields.Outlet) === "Central Kitchen");
  const outlets = [...new Set(out.map((r) => txt(r.fields.Outlet)))];

  // Balance per product made that day: produced vs packed to outlets (repacks excluded).
  const bal = new Map();
  for (const b of bs) {
    const code = txt(b.fields["Product Code"]);
    const e = bal.get(code) || { name: txt(b.fields["Product Name"]), unit: txt(b.fields.Unit), made: 0, sent: 0 };
    e.made += num(b.fields["Actual Output Qty"]);
    bal.set(code, e);
  }
  for (const r of out) {
    const e = bal.get(txt(r.fields["Item Code"]));
    if (e) e.sent += num(r.fields["Total Qty"]);
  }
  const balRows = [...bal.values()];
  const waiting = balRows.filter((e) => e.made - e.sent > 0.0001).length;

  $("kpis").innerHTML = [
    { k: "Produced", v: bal.size, s: `${bs.length} batch entr${bs.length === 1 ? "y" : "ies"}`, go: "s-prod" },
    { k: "Sent to outlets", v: outlets.length, s: `${groupPacks(out).length} packing(s)`, go: "s-out" },
    { k: "Repacked (CK)", v: new Set(ck.map((r) => txt(r.fields["Item Code"]))).size, s: `${ck.length} line(s)`, go: "s-ck" },
    { k: "Still to pack", v: waiting, s: "products with stock left", go: "s-bal", alert: waiting > 0 },
  ].map((x) => `<button class="kpi${x.alert ? " alert" : ""}" data-go="${x.go}"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="s">${x.s}</div></button>`).join("");

  $("dprod").innerHTML = bs.length
    ? bs.map((b) => {
        const y = pct(b.fields["Yield %"]);
        const meta = [time(num(b.fields["Production Date"])), txt(b.fields["Label Batch Line"]), txt(b.fields["Lot Code"]) || txt(b.fields["Batch No"]), txt(b.fields["Created By"])].filter(Boolean).join(" · ");
        return `<div class="lrow"><div class="t"><b>${esc(txt(b.fields["Product Name"]))}</b><span class="muted">${esc(meta)}</span></div>${y ? `<span class="badge ${y < 70 || y > 130 ? "warn" : "ok"}">${y}%</span>` : ""}<button class="ghost" data-bid="${b.record_id}">Labels</button></div>`;
      }).join("")
    : `<p class="muted">No production entered.</p>`;

  $("dout").innerHTML = outlets.length
    ? outlets.map((o) => {
        const gs = groupPacks(out.filter((r) => txt(r.fields.Outlet) === o));
        const items = new Set(gs.flatMap((g) => g.rows.map((r) => txt(r.fields["Item Code"])))).size;
        return `<details class="grp"><summary><span class="t">${esc(o)}</span><span class="badge">${items} item(s)</span><span class="badge">${gs.length} packing(s)</span></summary>${gs.map(packHtml).join("")}</details>`;
      }).join("")
    : `<p class="muted">Nothing packed to outlets.</p>`;

  const ckGroups = groupPacks(ck);
  $("dck").innerHTML = ckGroups.length
    ? `<details class="grp" open><summary><span class="t">Central Kitchen</span><span class="badge">${ckGroups.length} repack(s)</span></summary>${ckGroups.map(packHtml).join("")}</details>`
    : `<p class="muted">No repacking.</p>`;

  $("dbal").innerHTML = balRows.length
    ? `<table class="bal"><thead><tr><th>Product</th><th>Made</th><th>Packed</th><th>Left</th></tr></thead><tbody>${balRows.map((e) => {
        const left = e.made - e.sent;
        return `<tr><td>${esc(e.name)}</td><td>${fmt(e.made)} ${esc(e.unit)}</td><td>${fmt(e.sent)}</td><td><span class="badge ${left > 0.0001 ? "warn" : "ok"}">${fmt(left)}</span></td></tr>`;
      }).join("")}</tbody></table><p class="muted">Packed = sent to outlets on this day (Central Kitchen repacks not counted).</p>`
    : `<p class="muted">Nothing produced.</p>`;
}

$("v-today").addEventListener("click", (e) => {
  const go = e.target.closest("[data-go]");
  if (go) return $(go.dataset.go).scrollIntoView({ behavior: "smooth" });
  const jump = e.target.closest(".jump a");
  if (jump) {
    e.preventDefault();
    return document.querySelector(jump.getAttribute("href")).scrollIntoView({ behavior: "smooth" });
  }
  const bid = e.target.closest("[data-bid]");
  if (bid) {
    const rec = dayData.batches.find((x) => x.record_id === bid.dataset.bid);
    if (rec) openLabels(batchLine(rec), txt(rec.fields["Product Name"]));
  }
  const pref = e.target.closest("[data-pref]");
  if (pref) {
    const rows = dayData.packs.filter((r) => (txt(r.fields["Packing Ref"]) || r.record_id) === pref.dataset.pref);
    openLabels(rows.map((r) => txt(r.fields["Label Line"])).filter(Boolean).join("^"), `Packing → ${txt(rows[0].fields.Outlet)}`);
  }
});
$("dprev").addEventListener("click", () => { day = new Date(day.getTime() - DAY_MS); loadDay(); });
$("dnext").addEventListener("click", () => { if (!sameDay(day, new Date())) { day = new Date(day.getTime() + DAY_MS); loadDay(); } });
$("dtoday").addEventListener("click", () => { day = new Date(); day.setHours(0, 0, 0, 0); loadDay(); });
$("dreload").addEventListener("click", loadDay);

// Sticky section links sit right under the header.
const setTop = () => document.documentElement.style.setProperty("--toph", `${document.querySelector(".top").offsetHeight}px`);
addEventListener("resize", setTop);
setTop();

// Photo -> Lark media token for an attachment field (resized so uploads stay quick on mobile data).
async function uploadPhoto(file, which) {
  if (!sess || Date.now() > sess.expires_at) await signIn();
  let blob = file;
  try {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.8));
  } catch { /* send the original */ }
  const r = await fetch(`/api/upload?base=${which}&name=${encodeURIComponent((file.name || "foto").replace(/\.\w+$/, "") + ".jpg")}`, {
    method: "POST",
    headers: { "content-type": blob.type || "image/jpeg", "x-lark-token": sess.token },
    body: blob,
  });
  const j = await r.json().catch(() => ({}));
  if (j.code !== 0 || !j.data?.file_token) throw new Error(j.msg || `HTTP ${r.status}`);
  return j.data.file_token;
}

const wms = createWms({ $, base, searchAll, txt, num, fmt, store, status, uploadPhoto, updateBar: () => updateBar() });

let booted = false;

// ---------- start ----------
injectLabelCss();
show(tab);
renderRecipes();
renderPacking();
(async () => {
  try {
    status("Signing in with Lark…");
    await signIn();
    booted = true;
    status("");
    await Promise.all([loadRecipes(), loadItems(), loadBatches().then(renderPacking), tab === "today" ? loadDay() : null, tab === "wms" ? wms.load() : null]);
  } catch (e) {
    status(`Sign-in or loading failed: ${esc(e.message)}. Open this app from Lark Workplace.`);
  }
})();
