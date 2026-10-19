import { bitable } from "@lark-base-open/js-sdk";
import { esc, sheetHtml, injectLabelCss, qrLink } from "./labels.js";

// Production Batches fields shown on the 50 x 30 mm label.
const TABLE_NAME = "Production Batches";
const F = {
  batch: "Batch No",
  name: "Product Name",
  code: "Product Code",
  prod: "Prod Date (label)",
  exp: "Expiry (label)",
  run: "Label Batch Line",
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

function copies() {
  return Math.max(1, Math.min(200, parseInt($("copies").value, 10) || 1));
}

function render() {
  if (!current) {
    $("sheet").innerHTML = "";
    return;
  }
  $("sheet").innerHTML = sheetHtml(current, copies());
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
  v.qr = qrLink("b", recordId);
  current = v;
  $("copies").value = 1;
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
  injectLabelCss();
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
