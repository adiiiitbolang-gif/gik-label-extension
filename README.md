# GIK Production (Lark web app + Base extension)

Tools for the Lark Base "GIK Production Report Matchaman" and the WMS "WMS WH Matchaman".

## Hub (Lark web app, Cloudflare Worker `gik-production`)

```
/                      hub: app tiles from apps.json            (src/hub.html, hub.js)
/viewer.html?app=<id>  one app full-window in a same-origin iframe (src/viewer.html, viewer.js)
/app.html?tab=<tab>    the app: today | prod | pack | wms | labels (src/webapp.html, webapp.js)
/print.html            standalone label print page
/api/*                 worker/src/index.js (Lark sign-in, Base proxy)
```

- **apps.json** (`src/apps.json`) is the list of tiles. `kind: "embed"` opens `path?tab=` in the viewer
  (only plain `*.html` names are accepted); `kind: "link"` opens a Lark address inside Lark (only
  `*.larksuite.com` / `*.feishu.cn`). The viewer only shows ids from this file, never a URL from the address bar.
- **Sign-in** lives in `src/lark.js`. The hub/viewer (top-level pages) do Lark requestAccess or the
  browser OAuth redirect; the app inside the iframe asks `window.parent.gikHost` for that, and for
  opening links (Lark JSAPI doesn't run inside an iframe). The browser OAuth redirect always returns to `/`,
  which is the registered redirect URL; the hub then sends the user back to the page that asked.
- Switching apps in the viewer that share `app.html` calls `gikApp.show(tab)` inside the iframe: no reload,
  loaded data and drafts stay.
- iframe permissions: `fullscreen; clipboard-read; clipboard-write; serial; bluetooth; web-share`
  (serial/bluetooth = direct printing to the XP-4601B in Chrome, web-share = "Send to printer app").
- Design: see [DESIGN.md](DESIGN.md).

Build and deploy: `npm install && sh build.sh`, then `cd worker && npx wrangler deploy`.

## Base extension (GitHub Pages)

Sidebar extension that prints 50 x 30 mm thermal labels for the selected **Production Batches** record.

- Source: `src/` · built site: `docs/` · build: `sh build.sh`
- `docs/print.html`: standalone print page opened from the "Print label" link (works on phones)
