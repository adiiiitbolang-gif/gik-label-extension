import { sheetHtml, multiSheetHtml, injectLabelCss, esc } from "./labels.js";

// Standalone print page, opened from Lark (desktop button or phone message card).
// Two modes:
//   single batch: ?n=&c=&b=&p=&e=&r=&q=&s=&a=&d=      (one product, copies chosen here)
//   packing:      ?L=<line>^<line>...                   (each line: n|c|b|p|e|r|q|s|a|d|k, every part URL-encoded)
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const KEYS = ["name", "code", "batch", "prod", "exp", "run", "net", "storage", "allergens", "dest"];

// Read L from the raw query string: the "|" and "^" separators must not be decoded before splitting.
function packingLines() {
  const raw = location.search.slice(1).split("&").find((p) => p.startsWith("L="));
  if (!raw) return null;
  return raw
    .slice(2)
    .split(/\^|%5E/i)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\||%7C/i).map((x) => {
        try { return decodeURIComponent(x); } catch { return x; }
      });
      const v = {};
      KEYS.forEach((k, i) => (v[k] = parts[i] || ""));
      return { v, count: parseInt(parts[10], 10) || 1 };
    });
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
  $("title").textContent = `${first.run || "Packing"} → ${first.dest || ""} · ${lines.length} item(s), ${total} label(s)`;
  $("stepperWrap").hidden = true;
  $("lineList").innerHTML = lines.map((l) => `<li><b>${esc(l.v.name)}</b> · ${esc(l.v.net)} · ${l.count} label(s)</li>`).join("");
  $("lineList").hidden = false;
} else {
  $("title").textContent = single.batch ? `${single.batch} · ${single.name}` : "No batch selected";
}
if (!hasData) $("empty").hidden = false;

function render() {
  if (!hasData) return ($("sheet").innerHTML = "");
  $("sheet").innerHTML = lines ? multiSheetHtml(lines) : sheetHtml(single, $("copies").value);
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
