import { $, esc, icon, loadManifest, store } from "./hubShared.js";
import { createSession, exposeHost, openLink, takeReturnPath } from "./lark.js";

// Hub: the start page. Lists the apps from apps.json; embedded apps open in viewer.html,
// Lark Base links open inside Lark.
const session = createSession(showUser);
exposeHost(session);

function showUser(s) {
  const name = s?.name || "";
  $("who").hidden = !name;
  $("whoName").textContent = name;
  $("whoInit").textContent = name.trim().charAt(0).toUpperCase();
  const h = new Date().getHours();
  const part = h < 11 ? "pagi" : h < 15 ? "siang" : h < 18 ? "sore" : "malam";
  $("hello").textContent = `Selamat ${part}${name ? `, ${name.split(" ")[0]}` : ""}`;
}

function status(msg) {
  $("status").innerHTML = msg || "";
  $("status").hidden = !msg;
}

function render({ groups, apps }) {
  const last = store.get("gik.lastApp", "");
  const known = new Set(groups.map((g) => g.id));
  const all = [...groups, ...(apps.some((a) => !known.has(a.group)) ? [{ id: "", title: "Lainnya" }] : [])];
  $("groups").innerHTML = all.map((g) => {
    const list = apps.filter((a) => (known.has(a.group) ? a.group : "") === g.id);
    if (!list.length) return "";
    return `<section class="group"><div class="ghead"><h2>${esc(g.title)}</h2>${g.note ? `<span>· ${esc(g.note)}</span>` : ""}</div>
      <div class="tiles">${list.map((a) => tile(a, a.id === last)).join("")}</div></section>`;
  }).join("");
}

function tile(a, isLast) {
  const body = `<span class="ib">${icon(a.icon)}</span><span class="tx"><b>${esc(a.title)}</b><small>${esc(a.desc || "")}</small>${isLast ? '<span class="last">Terakhir dibuka</span>' : ""}</span>`;
  if (a.kind === "link") return `<button class="tile is-link" data-group="${esc(a.group)}" data-link="${esc(a.url)}">${body}${icon("external", "ext")}</button>`;
  return `<a class="tile" data-group="${esc(a.group)}" data-app="${esc(a.id)}" href="viewer.html?app=${encodeURIComponent(a.id)}">${body}</a>`;
}

$("groups").addEventListener("click", async (e) => {
  const app = e.target.closest("[data-app]");
  if (app) store.set("gik.lastApp", app.dataset.app);
  const link = e.target.closest("[data-link]");
  if (link && !(await openLink(link.dataset.link))) status(`Buka link ini di Lark: <a href="${esc(link.dataset.link)}" target="_blank" rel="noopener">${esc(link.dataset.link)}</a>`);
});

$("date").textContent = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
showUser(session.get());

(async () => {
  try {
    render(await loadManifest());
  } catch (e) {
    status(`Daftar aplikasi gagal dimuat: ${esc(e.message)}`);
  }
  try {
    await session.signIn();
    const next = takeReturnPath();
    if (next) location.replace(next);
  } catch (e) {
    status(`Belum masuk ke Lark: ${esc(e.message)}. Buka dari Lark Workplace, atau muat ulang halaman.`);
  }
})();
