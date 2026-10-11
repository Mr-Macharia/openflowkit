# Share-link Worker

Stores encrypted OpenFlowKit documents for `Copy share link`. The app encrypts in the browser
(AES-GCM, key in the link's `#fragment`); this Worker only ever holds ciphertext.

| Route | Does |
|---|---|
| `POST /s` | Body = ciphertext (max 1 MiB), header `X-Turnstile-Token`. Returns `201 { id, deleteToken }`. |
| `GET /s/:id` | The ciphertext, or `404`. |
| `DELETE /s/:id` | `Authorization: Bearer <deleteToken>` → `204`; `403` wrong token; `404` unknown. |

Errors: `400` body is not a share envelope, `413` too large, `403` Turnstile failed, `429` rate limited, `503` Turnstile unreachable.
Only its SHA-256 hash of the delete token is stored (R2 custom metadata).
Rate limit: Cloudflare's Rate Limiting binding, 10 POSTs per 60 s per IP, counted per Cloudflare location.
It is soft by design (eventually consistent); a Durable Object counter is the upgrade if abused.

Config: `ALLOWED_ORIGINS` (optional var, comma-separated) lists the app origins CORS allows; default
`https://app.openflowkit.com`. `http://localhost:*` and `http://127.0.0.1:*` are always allowed for dev.
Example for a staging app: `ALLOWED_ORIGINS = "https://app.openflowkit.com,https://staging.example.com"` under `[vars]`.

## Takedown

Remove a link by id: `npx wrangler r2 object delete openflowkit-shares/<id>`. The Worker can't read content,
so reports go by link: hello@openflowkit.com with "Report a link" in the subject (listed on the docs' share-links page).

## Owner setup (one time)

1. Cloudflare dashboard: enable R2, then `npx wrangler r2 bucket create openflowkit-shares`.
2. Turnstile: a Managed widget for `openflowkit.com` and `openflowkit-app.pages.dev` (subdomains included). Note both keys.
3. From this folder: `npx wrangler secret put TURNSTILE_SECRET` and paste the secret key.
4. `npx wrangler deploy` — it attaches the `share.openflowkit.com` custom domain from `wrangler.toml`.
5. The app is Cloudflare Pages (`openflowkit-app`, builds `main` to production, other branches to previews): set
   `VITE_TURNSTILE_SITE_KEY=<site key>` under Settings → Variables for Production and Preview. Optional: `VITE_SHARE_ORIGIN`.
6. Optional: an R2 lifecycle rule to expire objects. The app has no expiry (`ponytail`: add when users ask).

Local run: `npx wrangler dev` with Turnstile's always-pass test secret `1x0000000000000000000000000000000AA`
and the app's dev build, which defaults to the matching test site key `1x00000000000000000000AA`.
