import qrcode from "qrcode-generator";
import { batchQty, dateLine } from "./labels.js";

// Draws one 50 x 30 mm label as a PNG for thermal-printer apps (share sheet / save).
// 203 dpi is the common thermal head resolution: 50 mm = 400 px, 30 mm = 240 px.
const W = 400;
const H = 240;
const PAD = 10;
const FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';

function fitLines(ctx, text, maxWidth, maxLines) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function drawQr(ctx, text, x, y, size) {
  const qr = qrcode(0, "M");
  qr.addData(text || "-");
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(size / n);
  const off = Math.floor((size - cell * n) / 2);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(x + off + c * cell, y + off + r * cell, cell, cell);
}

function clip(ctx, text, maxWidth) {
  let t = String(text || "");
  while (t && ctx.measureText(t).width > maxWidth) t = t.slice(0, -1);
  return t;
}

// Largest font (bold or not) from `max` down to `min` px that fits the width.
function fit(ctx, text, maxWidth, max, min, bold) {
  for (let px = max; px >= min; px--) {
    ctx.font = `${bold ? "bold " : ""}${px}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) return px;
  }
  return min;
}

// Same layout as labelHtml (labels.js): name on top; batch · qty, Prod/Repack date, big EXP on the left;
// QR (link to the source record) on the right; storage tag + count at the bottom.
// v: { name, code, batch, prod, exp, run, net, storage, qr }
export function drawLabel(v, i, total) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  // 1. Item name: up to 2 lines across the full width, then a rule.
  ctx.font = `bold 27px ${FONT}`;
  const nameLines = fitLines(ctx, v.name, W - PAD * 2, 2);
  let y = PAD;
  for (const l of nameLines) {
    ctx.fillText(l, PAD, y);
    y += 29;
  }
  ctx.fillRect(PAD, y + 1, W - PAD * 2, 3);
  y += 12;

  const qrSize = 120;
  const qrX = W - PAD - qrSize;
  const textW = qrX - PAD - 10;
  const bodyTop = y;

  // 2. Batch · qty   3. Prod / Repack date   4. EXP (largest)
  const bq = batchQty(v);
  fit(ctx, bq, textW, 21, 14, true);
  ctx.fillText(clip(ctx, bq, textW), PAD, y);
  y += 27;
  const dl = dateLine(v);
  fit(ctx, dl, textW, 21, 14, false);
  ctx.fillText(clip(ctx, dl, textW), PAD, y);
  y += 27;
  const ex = `EXP ${v.exp || "-"}`;
  fit(ctx, ex, textW, 32, 18, true);
  ctx.fillText(clip(ctx, ex, textW), PAD, y);

  // Storage tag (white on black) and label count along the bottom.
  const footY = H - PAD - 26;
  if (v.storage) {
    ctx.font = `bold 18px ${FONT}`;
    const tag = String(v.storage).toUpperCase();
    const tw = Math.min(textW - 50, ctx.measureText(tag).width + 16);
    ctx.fillRect(PAD, footY, tw, 26);
    ctx.fillStyle = "#fff";
    ctx.fillText(clip(ctx, tag, tw - 16), PAD + 8, footY + 4);
    ctx.fillStyle = "#000";
  }
  ctx.font = `bold 17px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${i}/${total}`, qrX - 10, footY + 5);
  ctx.textAlign = "left";

  // QR centred in the space right of the text.
  const qrY = bodyTop + Math.max(0, (H - PAD - bodyTop - qrSize) / 2);
  drawQr(ctx, v.qr || v.batch, qrX, qrY, qrSize);
  return canvas;
}

export function canvasToFile(canvas, name) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(new File([b], name, { type: "image/png" })), "image/png"));
}
