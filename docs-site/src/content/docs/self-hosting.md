---
title: Self-hosting
description: Run your own copy of OpenFlowKit — Docker, any static host, the Content Security Policy, and the optional share-link Worker.
---

OpenFlowKit is a static web app: HTML, JavaScript and assets, with no backend of its own.
Documents live in each visitor's browser, so a self-hosted copy stores nothing on your server.
The only server-side part is optional: the Worker that holds encrypted [share links](/share-links/).

## Docker

```sh
docker build -t openflowkit .
docker run --rm -p 3045:3045 openflowkit      # http://localhost:3045/
```

The image builds the app with Node 22 and serves it with nginx on port 3045, using
`nginx/nginx.conf`: the same security headers as the hosted app, long-lived caching for
`/assets/`, and `index.html` never cached.

## Any static host

```sh
npm install
npm run build      # writes dist/
```

Serve `dist/` from anything that serves files. The app uses hash URLs (`/#/d/<id>`), so it needs
no rewrite rules. `public/_headers` carries the same headers for hosts that read that file;
`wrangler.toml` deploys `dist/` as Cloudflare static assets. Building needs Node 22.22 or newer.
For development, `npm run dev` serves the app at the URL Vite prints.

## The Content Security Policy decides what the browser may reach

| Directive | Allows | Why |
| --- | --- | --- |
| `connect-src` | `'self'`, any `https:`, and `http://localhost` / `http://127.0.0.1` on any port | Bring-your-own-key AI to any HTTPS provider; Ollama, LM Studio and the agent bridge on your machine; GitHub for repo maps |
| `script-src` / `frame-src` | `https://challenges.cloudflare.com` | Cloudflare Turnstile, only when someone makes a share link |
| `img-src` | `'self'`, `data:`, `blob:`, `https:` | Pasted image URLs |
| `frame-ancestors` | `'none'` | The app can't be framed |

A plain-`http` model gateway on another host (say `http://10.0.0.5:11434`) is blocked. Put it
behind HTTPS, or edit `connect-src` in `nginx/nginx.conf` and `public/_headers`.

## Share links (optional)

**Share** always offers an [editable copy](/share-links/#editable-copy) link: it needs no
server. The **view-only link** needs the share Worker and a Cloudflare Turnstile site key; without
them the option says "Needs a share server". The Docker image passes no build variables, so a
plain Docker build has only editable links. To turn on view-only links:

1. Deploy the share Worker from `worker/` to your Cloudflare account, with an R2 bucket and a
   Turnstile secret. `worker/README.md` has the steps.
2. Build the app with `VITE_TURNSTILE_SITE_KEY=<site key>` and, for your own Worker,
   `VITE_SHARE_ORIGIN=https://share.example.com`. Without `VITE_SHARE_ORIGIN` the app uses
   `https://share.openflowkit.com`.
3. Add your app's origin to the Worker's `ALLOWED_ORIGINS` variable (comma-separated) so CORS
   lets it through.

The Worker only ever holds ciphertext: the app encrypts in the browser and the key stays in the
link's `#fragment`. Publish an abuse contact next to the feature, since you can only take a
link down by its id.

## What it does not do

- **No accounts, sync or database.** There is nothing to back up on the server; each person's
  documents are in their own browser. Ask people to export JSON for backups.
- **No offline install.** The app registers no service worker; a browser needs your server to
  load it.
- **No server-side AI.** AI requests go from each visitor's browser to the provider they chose,
  with their own key.

## Where to go next

- [FAQ](/faq/): what leaves the browser, and when.
- [Share links](/share-links/): what the Worker stores and for how long.
- [The openflowkit CLI](/cli/): render and check diagrams without hosting anything.
