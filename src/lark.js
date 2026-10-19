// Lark sign-in and link opening, shared by the hub (index.html), the viewer and the app (app.html).
// The hub and viewer are top-level pages: they do the interactive Lark sign-in (requestAccess in Lark,
// OAuth redirect in a browser) and open links with Lark JSAPI. The app runs inside the viewer's
// same-origin iframe and asks the page around it (window.parent.gikHost) for those two steps.
const ua = navigator.userAgent;
export const inLark = /Lark|Feishu/i.test(ua) && Boolean(window.h5sdk || window.tt);
export const isMobile = /Android|iPhone|iPad/i.test(ua);
// bitable:app covers the Base v1 record calls (search, batch_create, batch_get).
const SCOPES = ["bitable:app"];
const KEY = "gik.session";
const NEXT = "gik.next";

// After a browser sign-in on the hub: the page that started it, if it wasn't the hub.
export function takeReturnPath() {
  try {
    const p = sessionStorage.getItem(NEXT) || "";
    sessionStorage.removeItem(NEXT);
    return p.startsWith("/") && !p.startsWith("//") ? p : "";
  } catch { return ""; }
}

// The page around this one, when it is the GIK hub/viewer on the same origin.
export const host = (() => {
  try { return window.parent !== window ? window.parent.gikHost || null : null; } catch { return null; }
})();
export const embedded = Boolean(host);

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.msg || `HTTP ${r.status}`);
  return j;
}

function larkCode(appId) {
  return new Promise((resolve, reject) => {
    const run = () => {
      const tt = window.tt;
      const fallback = () => tt.requestAuthCode({ appId, success: (r) => resolve(r.code), fail: (e) => reject(new Error(e?.errString || "sign-in refused")) });
      if (tt?.requestAccess) {
        tt.requestAccess({ appID: appId, scopeList: SCOPES, state: "gik", success: (r) => resolve(r.code), fail: (e) => (e?.errno === 103 ? fallback() : reject(new Error(e?.errString || "sign-in refused"))) });
      } else if (tt?.requestAuthCode) fallback();
      else reject(new Error("Lark sign-in is not available here"));
    };
    if (window.h5sdk?.ready) window.h5sdk.ready(run);
    else run();
  });
}

// Kept on the device (not per tab) so the hub, the viewer and the app share one sign-in until it expires.
export function createSession(onChange = () => {}) {
  let sess = (() => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } })();
  let signing = null;

  function save(s) {
    sess = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* fine */ }
    onChange(s);
    return s;
  }

  // force: the current token was refused, so don't trust it even if it looks unexpired.
  async function doSignIn(force) {
    if (!force && sess?.token && Date.now() < sess.expires_at) return save(sess);
    // Renew silently from the saved sign-in (HttpOnly cookie) before asking Lark again.
    try { return save(await post("/api/refresh", {})); } catch { /* no saved sign-in: sign in below */ }
    if (host) return save(await host.signIn({ force: true }));
    const { appId } = await fetch("/api/config").then((r) => r.json());
    if (inLark) return save(await post("/api/login", { code: await larkCode(appId) }));
    // Plain browser: Lark OAuth redirect. "/" (the hub) is the only registered redirect URL,
    // so other pages leave their address in sessionStorage and the hub sends the user back there.
    const back = `${location.origin}/`;
    const q = new URLSearchParams(location.search);
    const code = q.get("code");
    if (code && q.get("state") === "gik" && location.pathname === "/") {
      history.replaceState(null, "", back);
      return save(await post("/api/login", { code, redirect_uri: back }));
    }
    try { sessionStorage.setItem(NEXT, location.pathname === "/" ? "" : location.pathname + location.search); } catch { /* fine */ }
    const auth = new URL("https://accounts.larksuite.com/open-apis/authen/v1/authorize");
    // offline_access gives a refresh token, so Lark's consent screen appears once per device, not every visit.
    auth.search = new URLSearchParams({ client_id: appId, redirect_uri: back, state: "gik", scope: `${SCOPES.join(" ")} offline_access` });
    location.href = auth.toString();
    await new Promise(() => {}); // leaving the page
  }

  return {
    get: () => sess,
    valid: () => Boolean(sess?.token && Date.now() < sess.expires_at),
    save,
    signIn({ force = false } = {}) {
      if (!signing) signing = doSignIn(force).finally(() => (signing = null));
      return signing;
    },
  };
}

let jsReady = null;
function larkJsConfig() {
  if (!jsReady) {
    jsReady = (async () => {
      const page = location.href.split("#")[0];
      const c = await fetch(`/api/jsconfig?url=${encodeURIComponent(page)}`).then((r) => r.json());
      await new Promise((resolve, reject) => window.h5sdk.config({ ...c, jsApiList: ["openSchema"], onSuccess: resolve, onFail: reject }));
    })().catch((e) => { jsReady = null; throw e; });
  }
  return jsReady;
}

// Opens a link from a top-level page. external: true = the phone's browser (for printing), false = inside Lark.
// Resolves false when nothing could open it, so the caller can show the link instead.
export async function openLink(url, { external = false } = {}) {
  if (host) return host.openLink(url, { external });
  if (!inLark) return Boolean(window.open(url, "_blank", "noopener"));
  try {
    await larkJsConfig();
    return await new Promise((resolve) => window.tt.openSchema({ schema: url, external, success: () => resolve(true), fail: () => resolve(fallback(url, external)) }));
  } catch {
    return fallback(url, external);
  }
}
function fallback(url, external) {
  if (external && /Android/i.test(ua)) {
    location.href = `intent://${url.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    return true;
  }
  if (!external) { location.href = url; return true; }
  return false;
}

// Called by the hub and viewer: lets the embedded app reach sign-in and link opening.
export function exposeHost(session) {
  window.gikHost = {
    signIn: (o) => session.signIn(o),
    openLink: (url, o) => openLink(url, o),
  };
}
