import { sheetHtml, multiSheetHtml, injectLabelCss, esc, parseLabelData } from "./labels.js";
import { drawLabel, canvasToFile } from "./labelImage.js";
import { setupDirectPrint } from "./directPrint.js";

// Standalone print page, opened from Lark (desktop button or phone message card).
// Two modes:
//   single batch: ?n=&c=&b=&p=&e=&r=&q=&s=&a=&d=      (one product, copies chosen here)
//   packing:      ?L=<line>^<line>...                   (each line: n|c|b|p|e|r|q|s|a|d|k|last, every part URL-encoded;
//                                                         q = net per container, last = net of the last container)
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);

// Read L from the raw query string: the "|" and "^" separators must not be decoded before splitting.
function packingLines() {
  const raw = location.search.slice(1).split("&").find((p) => p.startsWith("L="));
  return raw ? parseLabelData(raw.slice(2)) : null;
}

const lines = packingLines();
const single = {
  name: qs.get("n") || "", code: qs.get("c") || "", batch: qs.get("b") || "", prod: qs.get("p") || "",
  exp: qs.get("e") || "", run: qs.get("r") || "", net: qs.get("q") || "", storage: qs.get("s") || "",
  allergens: qs.get("a") || "", dest: qs.get("d") || "",
};
const hasData = lines ? lines.length > 0 : Boolean(single.batch);

injectLabelCss();
$("copies").value = 1;
if (lines) {
  const total = lines.reduce((t, l) => t + l.count, 0);
  const first = lines[0]?.v || {};
  $("title").textContent = /^repack/i.test(first.run || "") ? "Repack labels" : first.dest ? `Pengiriman → ${first.dest}` : "Production labels";
  $("sub").textContent = `${total} label(s) · ${lines.length} item(s)`;
  $("stepperWrap").hidden = true;
  $("lineList").innerHTML = lines.map((l) => `<li><b>${esc(l.v.name)}</b><span>${l.lastNet && l.lastNet !== l.v.net && l.count > 1 ? `${l.count - 1} × ${esc(l.v.net)} + 1 × ${esc(l.lastNet)}` : `${l.count} × ${esc(l.v.net)}`}</span></li>`).join("");
  $("lineList").hidden = false;
} else {
  $("title").textContent = single.name || "No batch selected";
  $("sub").textContent = single.batch;
}
if (!hasData) { $("empty").hidden = false; $("view").hidden = true; }

// One label large; ‹ › flips through them (the same image the label printer gets).
let at = 0;
function showOne() {
  const list = labelList();
  if (!list.length) return;
  at = Math.min(at, list.length - 1);
  const l = list[at];
  $("one").replaceChildren(drawLabel(l.v, l.i, l.total));
  $("pos").textContent = `Label ${at + 1} of ${list.length}`;
  $("prev").disabled = $("next").disabled = list.length < 2;
}
$("prev").addEventListener("click", () => { const n = labelList().length; at = (at - 1 + n) % n; showOne(); });
$("next").addEventListener("click", () => { at = (at + 1) % labelList().length; showOne(); });

function render() {
  if (!hasData) return ($("sheet").innerHTML = "");
  $("sheet").innerHTML = lines ? multiSheetHtml(lines) : sheetHtml(single, $("copies").value);
  showOne();
}

$("copies").addEventListener("input", render);
$("minus").addEventListener("click", () => { $("copies").value = Math.max(1, (parseInt($("copies").value, 10) || 1) - 1); render(); });
$("plus").addEventListener("click", () => { $("copies").value = Math.min(200, (parseInt($("copies").value, 10) || 1) + 1); render(); });
$("printBtn").addEventListener("click", () => {
  render();
  try {
    window.print();
  } catch {
    $("inapp").hidden = false;
  }
});

// Lark's in-app browser on phones can't print; offer to reopen the page in the phone's own browser.
const ua = navigator.userAgent;
const inLarkApp = /Lark|Feishu/i.test(ua) && /Android|iPhone|iPad/i.test(ua);
if (inLarkApp) {
  $("inapp").hidden = false;
  $("printBtn").hidden = true;
  if (/Android/i.test(ua)) {
    const href = location.href;
    const intent = `intent://${href.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
    $("chromeBtn").href = intent;
    $("chromeBtn").hidden = false;
  }
}
render();
// One-tap links: open the print dialog right away (not inside Lark's in-app browser, which can't print).
if (hasData && qs.get("autoprint") === "1" && !inLarkApp) setTimeout(() => { try { window.print(); } catch { $("inapp").hidden = false; } }, 400);

// Every label as { v, i, total }, in print order.
function labelList() {
  if (!hasData) return [];
  const groups = lines ? lines : [{ v: single, count: $("copies").value, lastNet: "" }];
  const out = [];
  for (const g of groups) {
    const n = Math.max(1, Math.min(200, parseInt(g.count, 10) || 1));
    for (let i = 1; i <= n; i++) out.push({ v: i === n && g.lastNet ? { ...g.v, net: g.lastNet } : g.v, i, total: n });
  }
  return out;
}

// Direct printing (Chrome, not inside Lark): TSPL over Bluetooth to the label printer.
if (hasData && !inLarkApp) {
  setupDirectPrint({
    btn: $("directBtn"), pickBtn: $("pickBtn"), bleBtn: $("bleBtn"), more: $("directMore"), note: $("directNote"),
    getCanvases: () => labelList().map((l) => drawLabel(l.v, l.i, l.total)),
  });
  // Bluetooth printing available: that is the main button; the print dialog moves under "More ways".
  if (!$("directBtn").hidden) {
    $("printBtn").className = "ghost";
    $("printBtn").textContent = "Print with the print dialog";
    $("more").prepend($("printBtn"));
  }
}

async function labelFiles() {
  const list = labelList();
  return Promise.all(list.map((l, k) => canvasToFile(drawLabel(l.v, l.i, l.total), `label-${String(k + 1).padStart(2, "0")}-${(l.v.code || "item").replace(/[^\w-]/g, "")}.png`)));
}

function note(msg) {
  $("shareNote").textContent = msg;
  $("shareNote").hidden = !msg;
}

// Share sheet: the thermal printer's own app (Labelife, NIIMBOT, iPrint, ...) appears as a target on Android/iOS.
$("shareBtn").addEventListener("click", async () => {
  note("");
  const files = await labelFiles();
  if (!files.length) return;
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: "Labels" });
    } catch (e) {
      if (e && e.name !== "AbortError") note("Sharing failed. Use Save label images instead, then open them in your printer app.");
    }
  } else {
    note(inLarkApp ? 'Sharing is not available inside Lark. Tap "Open in Chrome to print" first.' : "This browser can't share files. Use Save label images, then open them in your printer app.");
  }
});

$("saveBtn").addEventListener("click", async () => {
  const files = await labelFiles();
  const box = $("saveList");
  box.innerHTML = "";
  files.forEach((f) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    a.textContent = f.name;
    box.appendChild(a);
    a.click();
  });
  box.hidden = !files.length;
});
