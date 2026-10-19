// Shared by the hub and the viewer: the app manifest and the tile icons.
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// 24px stroke icons (currentColor).
const PATHS = {
  pot: '<path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M2 10h20M9 6.5c0-1.2 1.2-1.3 1.2-2.5M13.8 6.5c0-1.2 1.2-1.3 1.2-2.5"/>',
  box: '<path d="M21 7.5 12 3 3 7.5 12 12z"/><path d="M3 7.5v9L12 21l9-4.5v-9M12 12v9M7.5 5.2l9 4.6"/>',
  warehouse: '<path d="M3 21V8.5L12 3l9 5.5V21"/><path d="M7 21v-9h10v9M7 15h10M7 18h10"/>',
  chart: '<path d="M3 21h18"/><rect x="5" y="11" width="3" height="7" rx="1"/><rect x="10.5" y="6" width="3" height="12" rx="1"/><rect x="16" y="13" width="3" height="5" rx="1"/>',
  printer: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7zM17.5 11h.01"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M9 9v12"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M3 14.5h18M9 4v16"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
  shrink: '<path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/>',
};
export const icon = (name, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || PATHS.grid}</svg>`;

// Only same-origin pages with a plain file name can be embedded; links must be Lark addresses.
const PAGE = /^[\w-]+\.html$/;
const LARK = /^https:\/\/[\w-]+(\.[\w-]+)*\.(larksuite|feishu)\.(com|cn)\//;
export async function loadManifest() {
  const r = await fetch("apps.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(`apps.json: HTTP ${r.status}`);
  const m = await r.json();
  const apps = (m.apps || []).filter((a) =>
    a.enabled !== false && a.id && a.title &&
    ((a.kind === "embed" && PAGE.test(a.path || "")) || (a.kind === "link" && LARK.test(a.url || ""))));
  return { groups: m.groups || [], apps };
}

export const embedSrc = (a) => `${a.path}${a.tab ? `?tab=${encodeURIComponent(a.tab)}` : ""}`;

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* fine */ } },
};
