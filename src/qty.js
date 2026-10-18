// Quantity boxes in Indonesian style, like the WMS formulas show stock: "1.500" (dot = thousands), "1,5" (comma = decimal).
// The draft keeps the plain number ("1500", "1.5"); only the box shows the separators.

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Plain stored value -> text for the box.
export function fmtQty(v) {
  if (v === "" || v == null) return "";
  const [i, dec] = String(v).split(".");
  return dec !== undefined ? `${group(i)},${dec}` : group(i);
}

// Reformat a box while typing (caret kept after the same digit) and return the plain value.
export function liveQty(input) {
  const raw = input.value;
  const caret = input.selectionStart ?? raw.length;
  const before = raw.slice(0, caret).replace(/[^\d,]/g, "").length;
  let clean = raw.replace(/[^\d,]/g, "");
  const comma = clean.indexOf(",");
  if (comma >= 0) clean = clean.slice(0, comma + 1) + clean.slice(comma + 1).replace(/,/g, "");
  const [intPart, dec] = clean.split(",");
  const int = intPart.replace(/^0+(?=\d)/, "");
  const shown = dec !== undefined ? `${group(int)},${dec}` : group(int);
  if (shown !== raw) {
    input.value = shown;
    let pos = 0;
    for (let seen = 0; pos < shown.length && seen < before; pos++) if (/[\d,]/.test(shown[pos])) seen++;
    try { input.setSelectionRange(pos, pos); } catch { /* number-like inputs without selection API */ }
  }
  if (!int && !dec) return "";
  return dec ? `${int || "0"}.${dec}` : int;
}
