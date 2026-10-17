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

// v: { name, code, batch, prod, exp, run, net, storage, allergens, dest }
export function labelHtml(v, i, total) {
  return `<div class="label">
    <div class="l-name">${esc(v.name)}</div>
    <div class="l-body">
      <div><b>${esc(v.code)}</b> · ${esc(v.batch)}</div>
      ${v.run ? `<div class="l-run">${esc(v.run)}</div>` : ""}
      <div>Prod ${esc(v.prod)}</div>
      <div class="l-exp">EXP ${esc(v.exp)}</div>
    </div>
    <div class="l-qr">${qrSvg(v.batch)}<div class="l-count">${i}/${total}</div></div>
    <div class="l-foot">${v.net ? `Net <b>${esc(v.net)}</b> · ` : ""}<span class="l-store">${esc(v.storage)}</span>${v.allergens ? `<br>Allergen: ${esc(v.allergens)}` : ""}${v.dest ? `<div class="l-dest">→ ${esc(v.dest)}</div>` : ""}</div>
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
.label{width:50mm;height:30mm;background:#fff;color:#000;font-family:Arial,"Helvetica Neue",Helvetica,sans-serif;padding:1.4mm 1.6mm;display:grid;grid-template-columns:1fr 13mm;grid-template-rows:auto 1fr auto;column-gap:1.2mm;overflow:hidden}
.l-name{grid-column:1/3;font-weight:700;font-size:8.2pt;line-height:1.05;max-height:2.15em;overflow:hidden;border-bottom:.3mm solid #000;padding-bottom:.6mm;margin-bottom:.6mm}
.l-body{font-size:5.6pt;line-height:1.22;display:grid;align-content:start}
.l-run{font-weight:700;font-size:5.8pt}
.l-exp{font-size:7.4pt;font-weight:700;margin-top:.3mm}
.l-qr{grid-row:2/4;grid-column:2;align-self:end;display:grid;justify-items:center;gap:.2mm}
.l-qr svg{width:13mm;height:13mm;display:block}
.l-count{font-size:5pt;font-weight:700}
.l-foot{font-size:5pt;line-height:1.15;align-self:end}
.l-store{font-weight:700;text-transform:uppercase}
.l-dest{font-weight:700;font-size:7pt;text-transform:uppercase;margin-top:.2mm}
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
