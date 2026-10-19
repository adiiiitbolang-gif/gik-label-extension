import { $, esc, icon, loadManifest, embedSrc, store } from "./hubShared.js";
import { createSession, exposeHost, inLark, isMobile } from "./lark.js";

// Viewer: one app from apps.json in a full-window same-origin iframe.
// ?app=<id> must be an enabled "embed" entry of the manifest; nothing else from the address is used.
const session = createSession();
exposeHost(session); // the app inside asks this page for Lark sign-in and for opening links

if (inLark && isMobile) document.documentElement.classList.add("lark-phone");
$("back").innerHTML = icon("back");
$("reload").innerHTML = icon("reload");
$("full").innerHTML = icon("expand");

let apps = [];
let current = null;
let frame = null;
let loadTimer = 0;

function stateMsg(html, spinning = false) {
  $("vstate").hidden = false;
  $("vstate").innerHTML = `${spinning ? '<div class="spin"></div>' : ""}<span class="${spinning ? "muted" : ""}">${html}</span>`;
}

function fail(msg) {
  frame?.remove();
  frame = null;
  document.title = "GIK Production";
  $("vname").textContent = "Tidak tersedia";
  $("vicon").innerHTML = icon("grid");
  $("vstate").hidden = false;
  $("vstate").innerHTML = `<b>${esc(msg)}</b><a class="primary" href="./">Kembali ke menu</a>`;
}

function setCurrent(a) {
  current = a;
  store.set("gik.lastApp", a.id);
  document.title = `${a.title} · GIK Production`;
  $("vname").textContent = a.title;
  $("vicon").innerHTML = icon(a.icon);
  $("vtitle").dataset.group = a.group || "";
  const q = new URLSearchParams(location.search);
  if (q.get("app") !== a.id) history.replaceState(null, "", `viewer.html?app=${encodeURIComponent(a.id)}`);
  document.querySelectorAll(".switch button").forEach((b) => (b.dataset.app === a.id ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
}

function mount(a) {
  setCurrent(a);
  frame?.remove();
  stateMsg("Memuat aplikasi…", true);
  frame = document.createElement("iframe");
  frame.title = a.title;
  // serial/bluetooth: direct printing to the label printer from Chrome; web-share: "Send to printer app".
  frame.allow = "fullscreen; clipboard-read; clipboard-write; serial; bluetooth; web-share";
  frame.allowFullscreen = true;
  frame.addEventListener("load", () => {
    clearTimeout(loadTimer);
    // A same-origin page we can't read means the server answered with something else (an error page).
    let ok = false;
    try { ok = Boolean(frame.contentDocument?.body?.childElementCount); } catch { ok = false; }
    if (ok) $("vstate").hidden = true;
    else fail("Aplikasi gagal dimuat.");
  });
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => stateMsg('Masih memuat… koneksi lambat? <button class="primary" id="retry">Coba lagi</button>'), 20000);
  frame.src = embedSrc(a);
  $("vbody").prepend(frame);
}

// Same page (all tabs of app.html): switch inside it, so loaded data and drafts stay.
function open(a) {
  if (frame && current && a.path === current.path && $("vstate").hidden) {
    try {
      const inner = frame.contentWindow.gikApp;
      if (inner) { inner.show(a.tab); setCurrent(a); return; }
    } catch { /* fall back to loading it */ }
  }
  mount(a);
}

function renderSwitch() {
  const html = apps.filter((a) => a.kind === "embed").map((a) =>
    `<button data-app="${esc(a.id)}">${icon(a.icon)}<span>${esc(a.title)}</span></button>`).join("");
  $("swTop").innerHTML = html;
  $("swBot").innerHTML = html;
}

document.addEventListener("click", (e) => {
  const b = e.target.closest(".switch button[data-app]");
  if (b) { const a = apps.find((x) => x.id === b.dataset.app); if (a && a.id !== current?.id) open(a); }
  if (e.target.closest("#retry") && current) mount(current);
});
$("reload").addEventListener("click", () => current && mount(current));

// The app reports tab changes made inside it (e.g. "Labels" opening after a submit).
addEventListener("message", (e) => {
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
  if (e.data?.type === "gik:tab") {
    const a = apps.find((x) => x.kind === "embed" && x.path === current?.path && x.tab === e.data.tab);
    if (a && a.id !== current.id) setCurrent(a);
  }
});

// Fullscreen on the iframe's wrapper (not offered where the browser can't, e.g. iPhone).
if (document.fullscreenEnabled) {
  $("full").hidden = false;
  $("full").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : $("vbody").requestFullscreen()).catch(() => {}));
  document.addEventListener("fullscreenchange", () => {
    const on = Boolean(document.fullscreenElement);
    $("full").innerHTML = icon(on ? "shrink" : "expand");
    $("full").setAttribute("aria-label", on ? "Keluar layar penuh" : "Layar penuh");
  });
}

(async () => {
  try {
    ({ apps } = await loadManifest());
  } catch (e) {
    return fail(`Daftar aplikasi gagal dimuat: ${e.message}`);
  }
  renderSwitch();
  const id = new URLSearchParams(location.search).get("app");
  const a = apps.find((x) => x.id === id && x.kind === "embed");
  if (!a) return fail(id ? `Aplikasi "${id}" tidak ada atau tidak aktif.` : "Tidak ada aplikasi yang dipilih.");
  mount(a);
})();
