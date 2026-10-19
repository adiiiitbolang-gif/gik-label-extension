// GIK Production web app backend (Cloudflare Worker).
// Serves the app from ./public and gives it a narrow API:
//   POST /api/login     { code }           requestAccess code -> user token (+ name)
//   POST /api/refresh   { refresh_token }  -> fresh user token
//   GET  /api/jsconfig?url=                 h5sdk.config signature (for openSchema etc.)
//   POST /api/base/<table>/<op>             Base record calls as the signed-in user (X-Lark-Token)
// The app secret never leaves the Worker; Base writes run with the user's own token,
// so Lark keeps the real "Created By" and the user's Base permissions apply.
const LARK = "https://open.larksuite.com/open-apis";

// Only these tables and operations can be reached through the proxy: [base, table].
// "prod" = GIK Production Report base, "wms" = WMS WH Matchaman base.
const TABLES = {
  recipes: ["prod", "tbl8MsZzJTYTGDEq"],
  items: ["prod", "tblrr3ZSa5kuIDbI"],
  batches: ["prod", "tblNKpqO2NH81eZ2"],
  packing: ["prod", "tblCLOQlUrKzd3dU"],
  repack: ["prod", "tblcC0RUenqp0gge"],
  recipeLines: ["prod", "tblDJEP3lgoW6Vc5"],
  wmsItems: ["wms", "tblg4CdVNY6GtBfV"],
  wmsRacks: ["wms", "tblb9pkG6hcxFv7r"],
  wmsLimits: ["wms", "tbll0RfAs94v1dd1"],
  wmsBatches: ["wms", "tbl4eXJZnqUOxzd8"],
  wmsDaily: ["wms", "tblsAGZqPkPn0lOw"],
};
const baseToken = (env, which) => (which === "wms" ? env.WMS_BASE_TOKEN : env.BASE_TOKEN);
const OPS = {
  search: { method: "POST", path: "records/search" },
  create: { method: "POST", path: "records/batch_create" },
  get: { method: "POST", path: "records/batch_get" },
  fields: { method: "GET", path: "fields" },
  update: { method: "POST", path: "records/batch_update" },
};
// Only these tables accept "update" (the app writes the label line after creating repack rows).
const UPDATABLE = new Set(["repack"]);

// Label QR codes: /q/<kind>/<record_id> opens that record in the Production base (short = a sparse, scannable QR).
// [table, grid view]: Lark only opens the record detail when the link also names a view.
const QR_TABLES = { b: ["tblNKpqO2NH81eZ2", "vewzEsXIae"], p: ["tblCLOQlUrKzd3dU", "vewQWtzBEj"], r: ["tblcC0RUenqp0gge", "vewZxpnQWg"] };

let tenantCache = { token: "", exp: 0 };
let ticketCache = { ticket: "", exp: 0 };

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

// The refresh token lives in an HttpOnly cookie (page scripts can't read it), so a browser
// sign-in is renewed silently instead of showing Lark's consent screen on every visit.
const RT = "gik_rt";
const readCookie = (request, name) => (request.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) || "";
const rtCookie = (t) =>
  t.refresh_token
    ? `${RT}=${t.refresh_token}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(60, (t.refresh_token_expires_in || 604800) - 300)}`
    : `${RT}=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

async function larkJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { code: -1, msg: text.slice(0, 300) } };
  }
}

async function tenantToken(env) {
  if (tenantCache.token && Date.now() < tenantCache.exp) return tenantCache.token;
  const { body } = await larkJson(`${LARK}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: env.APP_ID, app_secret: env.APP_SECRET }),
  });
  if (!body.tenant_access_token) throw new Error(`tenant token: ${body.msg}`);
  tenantCache = { token: body.tenant_access_token, exp: Date.now() + (body.expire - 300) * 1000 };
  return tenantCache.token;
}

async function jsTicket(env) {
  if (ticketCache.ticket && Date.now() < ticketCache.exp) return ticketCache.ticket;
  const { body } = await larkJson(`${LARK}/jssdk/ticket/get`, {
    method: "POST",
    headers: { authorization: `Bearer ${await tenantToken(env)}`, "content-type": "application/json" },
  });
  if (!body.data?.ticket) throw new Error(`jsapi ticket: ${body.msg}`);
  ticketCache = { ticket: body.data.ticket, exp: Date.now() + ((body.data.expire_in || 7200) - 300) * 1000 };
  return ticketCache.ticket;
}

async function sha1Hex(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function oauthToken(env, extra) {
  const { body } = await larkJson(`${LARK}/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ client_id: env.APP_ID, client_secret: env.APP_SECRET, ...extra }),
  });
  if (!body.access_token) throw new Error(body.error_description || body.msg || "login failed");
  return body;
}

async function userInfo(token) {
  const { body } = await larkJson(`${LARK}/authen/v1/user_info`, { headers: { authorization: `Bearer ${token}` } });
  return body.data || {};
}

function session(t, u) {
  return {
    token: t.access_token,
    renewable: Boolean(t.refresh_token),
    expires_at: Date.now() + (t.expires_in - 120) * 1000,
    name: u?.name || u?.en_name || "",
    open_id: u?.open_id || "",
  };
}

async function api(request, env, url) {
  const p = url.pathname;
  if (p === "/api/config") return json({ appId: env.APP_ID });

  if (p === "/api/login" && request.method === "POST") {
    // redirect_uri only for the browser sign-in; the in-Lark requestAccess code has none.
    const { code, redirect_uri } = await request.json();
    const t = await oauthToken(env, { grant_type: "authorization_code", code, ...(redirect_uri ? { redirect_uri } : {}) });
    return json(session(t, await userInfo(t.access_token)), 200, { "set-cookie": rtCookie(t) });
  }

  if (p === "/api/refresh" && request.method === "POST") {
    const refresh_token = readCookie(request, RT);
    if (!refresh_token) return json({ code: 401, msg: "no saved sign-in" }, 401);
    let t;
    try {
      t = await oauthToken(env, { grant_type: "refresh_token", refresh_token });
    } catch (e) {
      return json({ code: 401, msg: String(e.message || e) }, 401, { "set-cookie": rtCookie({}) });
    }
    return json(session(t, await userInfo(t.access_token)), 200, { "set-cookie": rtCookie(t) });
  }

  if (p === "/api/jsconfig") {
    const page = url.searchParams.get("url") || "";
    const ticket = await jsTicket(env);
    const timestamp = Date.now();
    const nonceStr = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const signature = await sha1Hex(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${page}`);
    return json({ appId: env.APP_ID, timestamp, nonceStr, signature });
  }

  // Photo for an attachment field: raw image body -> Lark media upload into that base.
  if (p === "/api/upload" && request.method === "POST") {
    const token = request.headers.get("x-lark-token");
    if (!token) return json({ code: 401, msg: "not signed in" }, 401);
    const which = url.searchParams.get("base") === "wms" ? "wms" : "prod";
    const name = (url.searchParams.get("name") || "photo.jpg").replace(/[^\w.\- ]/g, "_").slice(0, 100);
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 20 * 1024 * 1024) return json({ code: 413, msg: "file too large" }, 413);
    const form = new FormData();
    form.append("file_name", name);
    form.append("parent_type", (request.headers.get("content-type") || "").startsWith("image/") ? "bitable_image" : "bitable_file");
    form.append("parent_node", baseToken(env, which));
    form.append("size", String(buf.byteLength));
    form.append("file", new Blob([buf], { type: request.headers.get("content-type") || "application/octet-stream" }), name);
    const { status, body } = await larkJson(`${LARK}/drive/v1/medias/upload_all`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    return json(body, status === 200 && body.code === 0 ? 200 : status >= 400 ? status : 400);
  }

  const m = p.match(/^\/api\/base\/(\w+)\/(\w+)$/);
  if (m) {
    const table = TABLES[m[1]];
    const op = OPS[m[2]];
    const token = request.headers.get("x-lark-token");
    if (!table || !op || (m[2] === "update" && !UPDATABLE.has(m[1]))) return json({ code: 404, msg: "unknown table or operation" }, 404);
    if (!token) return json({ code: 401, msg: "not signed in" }, 401);
    const qs = new URLSearchParams();
    for (const k of ["page_size", "page_token", "user_id_type"]) if (url.searchParams.has(k)) qs.set(k, url.searchParams.get(k));
    const target = `${LARK}/bitable/v1/apps/${baseToken(env, table[0])}/tables/${table[1]}/${op.path}${qs.size ? `?${qs}` : ""}`;
    const init = { method: op.method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" } };
    if (op.method === "POST") init.body = await request.text();
    const { status, body } = await larkJson(target, init);
    return json(body, status === 200 && body.code === 0 ? 200 : status >= 400 ? status : 400);
  }

  return json({ code: 404, msg: "not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const q = url.pathname.match(/^\/q\/([bpr])\/(rec\w{4,40})$/);
    if (q) {
      const [tbl, view] = QR_TABLES[q[1]];
      const target = `https://${env.BASE_HOST}/base/${env.BASE_TOKEN}?table=${tbl}&view=${view}&record=${q[2]}`;
      return Response.redirect(target, 302);
    }
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url);
      } catch (e) {
        return json({ code: 500, msg: String(e.message || e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
