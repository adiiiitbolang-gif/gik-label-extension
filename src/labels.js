import qrcode from "qrcode-generator";

// Shared 50 x 30 mm label markup, used by the Base extension and the standalone print page.
export function esc(t) {
  return String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function qrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text || "-");
  qr.make();
  const n = qr.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + 1} ${r + 1}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + 2} ${n + 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// "MM-WIP0006 · PRD-0012", or just the lot when it already starts with the code ("MM-WIP0006-261018").
export function codeLine(v) {
  const code = String(v.code || "");
  const batch = String(v.batch || "");
  return code && batch.startsWith(code) ? batch : [code, batch].filter(Boolean).join(" · ");
}

// Label data string, as built by the app and the print links:
// lines joined by "^", each line n|c|b|p|e|r|q|s|a|d|k|last|qr with every part URL-encoded.
// k = labels, last = net of a smaller last container, qr = link printed as the QR code.
export const LINE_KEYS = ["name", "code", "batch", "prod", "exp", "run", "net", "storage", "allergens", "dest"];

// QR target: the record the goods came from (production batch / repack), opened in Lark through the worker.
export const QR_BASE = "https://gik-production.gik-matchaman.workers.dev/q";
export const qrLink = (kind, recordId) => (recordId ? `${QR_BASE}/${kind}/${recordId}` : "");
// "Repack 19/10/2026" for repacks (run starts with "Repack"), otherwise "Prod <date>".
export const dateLine = (v) => `${/^repack/i.test(v.run || "") ? "Repack" : "Prod"} ${v.prod || "-"}`;
// "MM-FG0001-261018 · 10 Pcs"
export const batchQty = (v) => [v.batch || v.code, v.net].filter(Boolean).join(" · ");

// Split before decoding so encoded "|" and "^" inside values stay intact.
export function parseLabelData(raw) {
  return String(raw || "")
    .split(/\^|%5E/i)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\||%7C/i).map((x) => {
        try { return decodeURIComponent(x); } catch { return x; }
      });
      const v = {};
      LINE_KEYS.forEach((k, i) => (v[k] = parts[i] || ""));
      v.qr = parts[12] || "";
      return { v, count: parseInt(parts[10], 10) || 1, lastNet: parts[11] || "" };
    });
}

export function encodeLine(v, count = 1, lastNet = "") {
  return [...LINE_KEYS.map((k) => encodeURIComponent(v[k] || "")), count, encodeURIComponent(lastNet), encodeURIComponent(v.qr || "")].join("|");
}

// v: { name, code, batch, prod, exp, run, net, storage, qr }
// Layout: name across the top; batch · qty, Prod/Repack date, big EXP on the left; QR on the right; storage tag + count at the bottom.
export function labelHtml(v, i, total) {
  return `<div class="label">
    <div class="l-name">${esc(v.name)}</div>
    <div class="l-body">
      <div class="l-batch">${esc(batchQty(v))}</div>
      <div class="l-date">${esc(dateLine(v))}</div>
      <div class="l-exp">EXP ${esc(v.exp || "-")}</div>
    </div>
    <div class="l-qr">${qrSvg(v.qr || v.batch)}</div>
    <div class="l-foot">${v.storage ? `<span class="l-store">${esc(v.storage)}</span>` : "<span></span>"}<span class="l-count">${i}/${total}</span></div>
  </div>`;
}

// lines: [{ v, count }] — every label is numbered within its own line.
export function multiSheetHtml(lines) {
  return lines.map((l) => sheetHtml(l.v, l.count, l.lastNet)).join("");
}

// lastNet: net quantity of the last container when it holds less (e.g. 95 pcs as 9 x 10 + 1 x 5).
export function sheetHtml(v, count, lastNet = "") {
  const n = Math.max(1, Math.min(200, parseInt(count, 10) || 1));
  let html = "";
  for (let i = 1; i <= n; i++) html += labelHtml(i === n && lastNet ? { ...v, net: lastNet } : v, i, n);
  return html;
}

export const LABEL_CSS = `
.label{width:50mm;height:30mm;background:#fff;color:#000;font-family:Arial,"Helvetica Neue",Helvetica,sans-serif;padding:1.3mm 1.5mm;display:grid;grid-template-columns:1fr 15mm;grid-template-rows:auto 1fr auto;column-gap:1.2mm;row-gap:.6mm;overflow:hidden}
.l-name{grid-column:1/3;font-weight:700;font-size:8.6pt;line-height:1.08;max-height:2.2em;overflow:hidden;border-bottom:.35mm solid #000;padding-bottom:.6mm}
.l-body{display:grid;align-content:start;gap:.35mm;min-width:0}
.l-batch{font-size:6.6pt;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.l-date{font-size:6.6pt;line-height:1.15}
.l-exp{font-size:9.5pt;font-weight:700;line-height:1.1}
.l-qr{grid-row:2/4;grid-column:2;align-self:center}
.l-qr svg{width:15mm;height:15mm;display:block}
.l-foot{display:flex;justify-content:space-between;align-items:center;min-width:0}
.l-store{background:#000;color:#fff;font-size:6.2pt;font-weight:700;text-transform:uppercase;padding:.25mm 1.2mm;border-radius:.6mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.l-count{font-size:6pt;font-weight:700}
@page{size:50mm 30mm;margin:0}
@media print{
  html,body{background:#fff!important;margin:0;padding:0}
  .ui{display:none!important}
  .sheet{display:block;padding:0}
  .sheet .label{box-shadow:none;page-break-after:always;break-after:page}
  .sheet .label:last-child{page-break-after:auto;break-after:auto}
}
`;

export function injectLabelCss() {
  document.getElementById("label-css").textContent = LABEL_CSS;
}
