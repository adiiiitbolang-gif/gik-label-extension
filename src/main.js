import { bitable } from "@lark-base-open/js-sdk";
import qrcode from "qrcode-generator";

// Production Batches fields shown on the 50 x 30 mm label.
const TABLE_NAME = "Production Batches";
const F = {
  batch: "Batch No",
  name: "Product Name",
  code: "Product Code",
  prod: "Prod Date (label)",
  exp: "Expiry (label)",
  net: "Label Net",
  count: "Containers (labels)",
  storage: "Storage",
  allergens: "Allergens",
  dest: "Destination",
};

const $ = (id) => document.getElementById(id);
let table = null;
let fieldIds = {};
let current = null;

function esc(t) {
  return String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text || "-");
  qr.make();
  const n = qr.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + 1} ${r + 1}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + 2} ${n + 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

function labelHtml(v, i, total) {
  return `<div class="label">
    <div class="l-name">${esc(v.name)}</div>
    <div class="l-body">
      <div><b>${esc(v.code)}</b></div>
      <div>Batch <b>${esc(v.batch)}</b></div>
      <div>Prod ${esc(v.prod)}</div>
      <div class="l-exp">EXP ${esc(v.exp)}</div>
    </div>
    <div class="l-qr">${qrSvg(v.batch)}<div class="l-count">${i}/${total}</div></div>
    <div class="l-foot">${v.net ? `Net <b>${esc(v.net)}</b> · ` : ""}<span class="l-store">${esc(v.storage)}</span>${v.allergens ? `<br>Allergen: ${esc(v.allergens)}` : ""}${v.dest ? `<br>To: ${esc(v.dest)}` : ""}</div>
  </div>`;
}

function copies() {
  return Math.max(1, Math.min(200, parseInt($("copies").value, 10) || 1));
}

function render() {
  if (!current) {
    $("sheet").innerHTML = "";
    return;
  }
  const n = copies();
  let html = "";
  for (let i = 1; i <= n; i++) html += labelHtml(current, i, n);
  $("sheet").innerHTML = html;
}

async function loadRecord(recordId) {
  if (!recordId) return;
  const v = {};
  await Promise.all(
    Object.entries(F).map(async ([k, name]) => {
      try {
        v[k] = fieldIds[name] ? await table.getCellString(fieldIds[name], recordId) : "";
      } catch {
        v[k] = "";
      }
    })
  );
  current = v;
  $("copies").value = parseInt(v.count, 10) || 1;
  $("picked").textContent = `${v.batch} · ${v.name}`;
  $("batchSelect").value = recordId;
  setStatus("");
  render();
}

function setStatus(msg) {
  $("status").textContent = msg;
  $("status").hidden = !msg;
}

async function fillBatchList() {
  const ids = await table.getRecordIdList();
  const rows = await Promise.all(
    ids.map(async (id) => ({ id, batch: await table.getCellString(fieldIds[F.batch], id), name: await table.getCellString(fieldIds[F.name], id) }))
  );
  rows.sort((a, b) => (a.batch < b.batch ? 1 : -1));
  $("batchSelect").innerHTML =
    `<option value="">Choose a batch…</option>` +
    rows.slice(0, 100).map((r) => `<option value="${esc(r.id)}">${esc(r.batch)} · ${esc(r.name)}</option>`).join("");
}

function printInPlace() {
  render();
  try {
    window.print();
  } catch {
    printInWindow();
  }
}

function printInWindow() {
  render();
  const css = document.getElementById("label-css").textContent;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(current?.batch || "Labels")}</title><style>${css}
    body{margin:0;background:#fff}.sheet{display:block}.label{box-shadow:none;page-break-after:always;break-after:page}.label:last-child{page-break-after:auto;break-after:auto}</style></head>
    <body><div class="sheet">${$("sheet").innerHTML}</div><script>setTimeout(function(){window.print()},300)<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (w) {
    w.document.open();
    w.document.write(doc);
    w.document.close();
    return;
  }
  const url = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
  const a = $("fallbackLink");
  a.href = url;
  a.hidden = false;
  setStatus("Pop-up was blocked. Use the link below to open the print page.");
}

async function init() {
  $("copies").addEventListener("input", render);
  $("printBtn").addEventListener("click", printInPlace);
  $("windowBtn").addEventListener("click", printInWindow);
  $("batchSelect").addEventListener("change", (e) => loadRecord(e.target.value));
  try {
    table = await bitable.base.getTableByName(TABLE_NAME);
  } catch {
    setStatus(`Table "${TABLE_NAME}" was not found in this base.`);
    return;
  }
  const metas = await table.getFieldMetaList();
  fieldIds = Object.fromEntries(metas.map((m) => [m.name, m.id]));
  const missing = Object.values(F).filter((n) => !fieldIds[n]);
  if (missing.length) setStatus(`Missing fields: ${missing.join(", ")}`);
  await fillBatchList();
  const tableId = table.id;
  const useSelection = async (sel) => {
    if (sel && sel.tableId === tableId && sel.recordId) await loadRecord(sel.recordId);
  };
  await useSelection(await bitable.base.getSelection());
  bitable.base.onSelectionChange((e) => useSelection(e.data));
}

init().catch((err) => setStatus("Could not connect to Base: " + (err?.message || err)));
