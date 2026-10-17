import qrcode from "qrcode-generator";

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

// v: { name, code, batch, prod, exp, run, net, storage, allergens, dest }
export function drawLabel(v, i, total) {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  // Product name: up to 2 lines, then a rule.
  ctx.font = `bold 26px ${FONT}`;
  const nameLines = fitLines(ctx, v.name, W - PAD * 2, 2);
  let y = PAD;
  for (const l of nameLines) {
    ctx.fillText(l, PAD, y);
    y += 28;
  }
  ctx.fillRect(PAD, y + 2, W - PAD * 2, 2);
  y += 10;

  const qrSize = 104;
  const qrX = W - PAD - qrSize;
  const textW = qrX - PAD - 6;

  ctx.font = `bold 17px ${FONT}`;
  ctx.fillText(clip(ctx, `${v.code} · ${v.batch}`, textW), PAD, y);
  y += 21;
  if (v.run) {
    ctx.font = `bold 17px ${FONT}`;
    ctx.fillText(clip(ctx, v.run, textW), PAD, y);
    y += 21;
  }
  ctx.font = `17px ${FONT}`;
  ctx.fillText(clip(ctx, `Prod ${v.prod}`, textW), PAD, y);
  y += 22;
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillText(clip(ctx, `EXP ${v.exp}`, textW), PAD, y);

  // Footer: net + storage, then outlet in bold.
  let fy = H - PAD - (v.dest ? 44 : 20);
  ctx.font = `16px ${FONT}`;
  const foot = `${v.net ? `Net ${v.net} · ` : ""}${String(v.storage || "").toUpperCase()}`;
  ctx.fillText(clip(ctx, foot, textW), PAD, fy);
  if (v.dest) {
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText(clip(ctx, `→ ${String(v.dest).toUpperCase()}`, textW), PAD, fy + 20);
  }

  drawQr(ctx, v.batch, qrX, H - PAD - qrSize - 18, qrSize);
  ctx.font = `bold 15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(`${i}/${total}`, qrX + qrSize / 2, H - PAD - 16);
  return canvas;
}

export function canvasToFile(canvas, name) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(new File([b], name, { type: "image/png" })), "image/png"));
}
