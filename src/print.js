import { sheetHtml, injectLabelCss } from "./labels.js";

// Standalone print page: opened from the "Print label" link in Production Batches (desktop or phone).
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const v = {
  name: qs.get("n") || "",
  code: qs.get("c") || "",
  batch: qs.get("b") || "",
  prod: qs.get("p") || "",
  exp: qs.get("e") || "",
  run: qs.get("r") || "",
  net: qs.get("q") || "",
  storage: qs.get("s") || "",
  allergens: qs.get("a") || "",
  dest: qs.get("d") || "",
};

injectLabelCss();
$("copies").value = 1;
$("title").textContent = v.batch ? `${v.batch} · ${v.name}` : "No batch selected";
if (!v.batch) $("empty").hidden = false;

function render() {
  $("sheet").innerHTML = v.batch ? sheetHtml(v, $("copies").value) : "";
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
// Lark's in-app browser on phones may not support printing; show how to open in the system browser.
if (/Lark|Feishu/i.test(navigator.userAgent) && /Android|iPhone|iPad/i.test(navigator.userAgent)) $("inapp").hidden = false;
render();
// "Print 1 label" link: open the print dialog right away.
if (v.batch && qs.get("autoprint") === "1") setTimeout(() => { try { window.print(); } catch { $("inapp").hidden = false; } }, 400);
