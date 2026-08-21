# waitlist-worker

The early-access signup endpoint behind the form on `/gaming-assistant`.

A Cloudflare Worker on `POST /api/waitlist`, writing to a D1 (SQLite) database. It is a
separate npm package from the site and **deploys through a different pipeline** — see
[Deploying](#deploying).

## Why it is not on the Mac mini

The site is static Astro with no SSR adapter, and `../CLAUDE.md` is emphatic that it stays
that way. So the form needs a backend outside the Astro build. It could have been a local
service behind Caddy — that is the shape the deferred *Ask Kowalski* chat gateway plan
uses — but this one stores a table of real people's names and email addresses, and the Mac
mini also holds Google OAuth tokens, a GitHub PAT, the Cloudflare tunnel credentials and
`holdings.json`. A Worker route is evaluated at the edge, so the request never reaches the
tunnel.

Being **same-origin** with the site is the other load-bearing property: it lets the browser
`fetch` satisfy the production CSP (`default-src 'self'`) with no `connect-src` amendment.

## Routes

Registered on **both** `aleclay10.dev` and `www.aleclay10.dev`. `www` serves the site
rather than redirecting to the apex — it answers 200 with its own `Origin` — so a route on
the apex alone would leave the form 404ing for anyone who arrived via `www`. The Worker's
origin allow-list matches.

## Request handling

| | |
|---|---|
| `POST` + `application/json` | → `200 {ok:true}` / `400 {error}` — the enhanced path |
| `POST` + form-encoded | → `303` to `/gaming-assistant/thanks` — the no-JS path |
| Any other method | `405` |
| Any other path | `404` |
| `Origin` not on the allow-list | `403` |

The form works with **no JavaScript at all**; the page script only upgrades it to an inline
result. Do not add anything that breaks the bare `<form>` POST.

## Notable behaviour

- **Duplicate submissions upsert.** `ON CONFLICT(email)` refreshes name and notes; the
  response is byte-identical whether or not the address was already present, because a
  different answer for a known address is an email-enumeration oracle.
- **`created_at`, `status` and `unsubscribe_token` are never touched on conflict** — so
  resubmitting the form cannot silently re-opt-in someone who unsubscribed.
- **Honeypot** (`company`): filled ⇒ report success, write nothing.
- **`country` is stored, not the IP.** Enough to spot abuse, without a PII-grade
  identifier per visitor.
- **`unsubscribe_token` is minted at insert**, so every row is unsubscribable before a
  single email is ever sent.

Rate limiting is a Cloudflare Rate Limiting rule on the path, configured in the zone
dashboard — not in this code. Turnstile is deliberately **not** used: it needs `script-src`
and `frame-src` for `challenges.cloudflare.com`, and adding an explicit `script-src` means
it stops inheriting `default-src` and must re-include `'self'`. That is the riskiest edit
available on this site. Revisit only if real spam arrives.

## Local development

```sh
npm install
npm run schema:local     # apply schema.sql to the local miniflare D1
npm run dev              # http://localhost:8787
npm run typecheck
```

`npx astro check` at the repo root **excludes this directory** (see `../tsconfig.json`):
Worker globals like `D1Database` come from `@cloudflare/workers-types` and are meaningless
against the site's browser/Astro lib. Type-check it with `npm run typecheck` here.

```sh
curl -i -X POST http://127.0.0.1:8787/api/waitlist \
  -H 'origin: https://aleclay10.dev' -H 'content-type: application/json' \
  -d '{"first_name":"Ada","last_name":"Lovelace","email":"ada@example.com","notes":"hi"}'
```

## Deploying

**This does not ship with the site.** The static site deploys only when Alec pushes a
signed git tag; this Worker deploys with `wrangler`, independently and immediately.

> **Deploy the Worker before the frontend ships**, or the form goes live pointing at a
> 404. The frontend cannot reach production without a signed tag, so the safe order is:
> deploy Worker → merge PR → tag.

First time:

```sh
export CLOUDFLARE_ACCOUNT_ID=…                       # not committed: this repo is public
export CLOUDFLARE_API_TOKEN="$(security find-generic-password -a "$USER" -s CLOUDFLARE_API_TOKEN -w)"
npx wrangler d1 create aleclay10-waitlist            # paste database_id into wrangler.toml
npm run schema:remote
npm run deploy
```

The API token needs exactly: Account → **Workers Scripts : Edit**, Account → **D1 : Edit**,
Zone → **Workers Routes : Edit** on `aleclay10.dev`. Nothing else — in particular no DNS
rights. Store it in the macOS Keychain, following the `ELEVENLABS_API_KEY` precedent in
`~/agent/tools.md`.

## Reading the list

```sh
npx wrangler d1 execute aleclay10-waitlist --remote \
  --command "SELECT created_at, first_name, last_name, email, notes FROM waitlist ORDER BY id DESC LIMIT 50;"
```

## Emailing the list — read before you do

`aleclay10.dev` is deliberately configured to send **nothing**: SPF `v=spf1 -all`, DMARC
`p=reject; sp=reject; adkim=s; aspf=s`, and a null MX. That is audit finding **F-2**, and
`~/portfolio/check-email-auth.sh` exists to assert it. The reasoning is not generic hygiene:
the agent on this host reads Alec's mail, so a spoofable `@aleclay10.dev` is a
prompt-injection delivery path.

**Send from a subdomain — `updates.aleclay10.dev` — and leave the apex alone.** DMARC
`sp=reject` is inherited, and `adkim=s` means the DKIM `d=` domain must equal the `From:`
domain exactly, so DKIM must be published for the subdomain and `From:` must be
`@updates.aleclay10.dev`. Add SPF and DKIM on the subdomain only.

**Re-run `bash ../check-email-auth.sh` after any DNS change. It must still exit 0.**
