// GIK Production web app backend (Cloudflare Worker).
// Serves the app from ./public and gives it a narrow API:
//   POST /api/login     { code }           requestAccess code -> user token (+ name)
//   POST /api/refresh   { refresh_token }  -> fresh user token
//   GET  /api/jsconfig?url=                 h5sdk.config signature (for openSchema etc.)
//   POST /api/base/<table>/<op>             Base record calls as the signed-in user (X-Lark-Token)
// The app secret never leaves the Worker; Base writes run with the user's own token,
// so Lark keeps the real "Created By" and the user's Base permissions apply.
const LARK = "https://open.larksuite.com/open-apis";

// Only these tables and operations can be reached through the proxy.
const TABLES = {
  recipes: "tbl8MsZzJTYTGDEq",
  items: "tblrr3ZSa5kuIDbI",
  batches: "tblNKpqO2NH81eZ2",
  packing: "tblCLOQlUrKzd3dU",
};
const OPS = {
  search: { method: "POST", path: "records/search" },
  create: { method: "POST", path: "records/batch_create" },
  get: { method: "POST", path: "records/batch_get" },
  fields: { method: "GET", path: "fields" },
};

let tenantCache = { token: "", exp: 0 };
let ticketCache = { ticket: "", exp: 0 };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

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
    refresh_token: t.refresh_token,
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
    return json(session(t, await userInfo(t.access_token)));
  }

  if (p === "/api/refresh" && request.method === "POST") {
    const { refresh_token, name, open_id } = await request.json();
    const t = await oauthToken(env, { grant_type: "refresh_token", refresh_token });
    return json(session(t, { name, open_id }));
  }

  if (p === "/api/jsconfig") {
    const page = url.searchParams.get("url") || "";
    const ticket = await jsTicket(env);
    const timestamp = Date.now();
    const nonceStr = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const signature = await sha1Hex(`jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${page}`);
    return json({ appId: env.APP_ID, timestamp, nonceStr, signature });
  }

  const m = p.match(/^\/api\/base\/(\w+)\/(\w+)$/);
  if (m) {
    const table = TABLES[m[1]];
    const op = OPS[m[2]];
    const token = request.headers.get("x-lark-token");
    if (!table || !op) return json({ code: 404, msg: "unknown table or operation" }, 404);
    if (!token) return json({ code: 401, msg: "not signed in" }, 401);
    const qs = new URLSearchParams();
    for (const k of ["page_size", "page_token", "user_id_type"]) if (url.searchParams.has(k)) qs.set(k, url.searchParams.get(k));
    const target = `${LARK}/bitable/v1/apps/${env.BASE_TOKEN}/tables/${table}/${op.path}${qs.size ? `?${qs}` : ""}`;
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
