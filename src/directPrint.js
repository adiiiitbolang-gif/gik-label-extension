import { tsplJob, canSerial, canBle, printSerial, printBle } from "./tspl.js";

// Wires the "Print to label printer" button and its two helper links.
// getCanvases(): the label canvases to print, in order.
export function setupDirectPrint({ btn, pickBtn, bleBtn, more, note, getCanvases, label = "Print to label printer" }) {
  const show = (msg, kind = "note") => { note.className = kind; note.innerHTML = msg; note.hidden = !msg; };
  if (!canSerial() && !canBle()) return false;
  btn.hidden = false;
  more.hidden = false;
  pickBtn.hidden = !canSerial();
  bleBtn.hidden = !canBle();

  async function run(mode) {
    const canvases = getCanvases();
    if (!canvases.length) return;
    btn.disabled = true;
    btn.textContent = "Printing…";
    show("");
    try {
      const job = tsplJob(canvases);
      if (mode === "ble") await printBle(job, (p) => (btn.textContent = `Printing… ${Math.round(p * 100)}%`));
      else await printSerial(job, { pick: mode === "pick" });
      show(`✅ Sent ${canvases.length} label(s) to the printer.`, "ok");
    } catch (e) {
      if (e?.name === "NotFoundError") show("No printer chosen. Turn the printer on, pair it in the phone's Bluetooth settings, then try again.");
      else if (e?.name === "SecurityError" || e?.name === "NotAllowedError") show("Chrome blocked the printer connection. Allow Bluetooth for Chrome and try again.");
      else show(`Printing failed: ${String(e?.message || e)}. Try <b>Bluetooth LE printer</b> or <b>Send to printer app</b>.`);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  btn.addEventListener("click", () => run(canSerial() ? "serial" : "ble"));
  pickBtn.addEventListener("click", () => run("pick"));
  bleBtn.addEventListener("click", () => run("ble"));
  return true;
}
