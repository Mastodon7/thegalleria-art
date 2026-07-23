---
name: galleria-admin
description: Make content changes to thegalleria.art (the-galleria-art repo) — either by editing Carolyn Elaine's static preserved portfolio and deploying, or by calling the admin API for CMS-managed artists/galleries/artwork/portfolio-pages. Use whenever asked to update text, titles, or images on thegalleria.art, or on Carolyn Elaine's portfolio pages specifically.
---

# thegalleria.art content editing

This site (`github.com/Mastodon7/thegalleria-art`, deployed via Coolify,
auto-deploy on push to `main`) has **two separate content systems**. Figure
out which one applies before editing anything.

## 1. Carolyn Elaine's preserved static portfolio — `/carolyn-elaine/`

This route is served directly from `public/carolyn-elaine/index.html` in the
repo. It is intentionally static and is NOT part of the CMS/content.json
system, even though Carolyn also has a CMS artist record for unrelated
managed-pages experiments (do not confuse the two).

Each artwork block in that file carries a `data-artwork-id` attribute:
`whispers`, `tears`, `light`, `narrative`, `bjs-mom`, `brookfield`, `gathered`.
The server (`applyCarolynStaticOverrides` in `server.js`) rewrites the title,
meta line, and description paragraph of a block at render time from
`content.carolynStaticOverrides[artworkId]` if an override exists — no git
push required for those three fields. Use `carolyn-get` / `carolyn-set` via
`scripts/galleria-admin.js` (see Commands below).

**Still requires a git push + Coolify deploy:** adding a brand-new artwork
section, changing which image file a block uses, editing anything outside
title/meta/paragraph (e.g. the artist statement, selected-clients list,
contact info), or adding a new `data-artwork-id` block for a section that
doesn't have one yet.

To make one of those structural edits:
1. Edit `public/carolyn-elaine/index.html` directly.
2. `git add public/carolyn-elaine/index.html`
3. `git commit -m "..."`
4. `git push origin main` — this must be run somewhere with real GitHub
   push credentials (the human's Mac, or a Claude Code session that has
   them; a sandboxed Cowork session usually does NOT).
5. Coolify auto-deploys on push. Verify in Coolify → the app →
   Deployments for a "Success" entry matching the new commit SHA. If it
   didn't auto-trigger, hit Redeploy manually.
6. **Always verify against the live URL** (`https://thegalleria.art/carolyn-elaine/`)
   after deploy — do not report the task done from a local file edit alone.

Either way — script call or git push — **always re-fetch the live URL**
afterward to confirm the change actually rendered before telling anyone
it's done.

## 2. Everything else — CMS-managed content (artists, galleries, artwork, portfolio-pages, invitations, media, plans)

This lives in `DATA_DIR/content.json` on the server (seeded once from
`seed-content.json`, then never re-read from the repo). Editing the repo's
`seed-content.json` does nothing to a live site once it has booted once.

Use `scripts/galleria-admin.js` in this repo — a small dependency-free
Node CLI that logs into `/admin/login/` and calls the `/admin/api/*` routes.

### Setup

Requires Node 18+ (for global `fetch`). Set env vars before running:

```
export GALLERIA_BASE_URL=https://thegalleria.art   # optional, this is the default
export GALLERIA_ADMIN_EMAIL=<admin login email>
export GALLERIA_ADMIN_PASSWORD=<admin login password>
```

Never commit real credentials. Get them from the human, or from Coolify's
environment variables for this app (`ADMIN_EMAIL` / the password that hashes
to `ADMIN_PASSWORD_HASH`) if you're the one who set them.

### Commands

```
node scripts/galleria-admin.js content
# dumps the full live content.json via GET /admin/api/content

node scripts/galleria-admin.js save artwork '{"id":"artwork-...", "title":"New title", ...}'
# creates/updates a record. type is one of: artists | galleries | artwork | portfolio-pages
# include the existing "id" to update, omit it to create new.
# Pull the current record from `content` first and edit that JSON in place —
# don't guess at the shape.

node scripts/galleria-admin.js archive artwork artwork-123

node scripts/galleria-admin.js export public        # or: operational | inquiries

node scripts/galleria-admin.js carolyn-get
# dumps current overrides for Carolyn's static page, keyed by artworkId

node scripts/galleria-admin.js carolyn-set gathered '{"title":"Where Two Or Three Are Gathered","meta":"Covenant United Church of Christ · South Holland, Illinois · 2021"}'
# updates title/meta/paragraph for one artwork block on /carolyn-elaine/
# live immediately, no push/deploy needed. Omit fields you don't want to change.
```

Draft/updated CMS records still go through the site's normal review/publish
flow (`/admin/review/`) before they appear publicly, per
`docs/BETA_PILOT_CHECKLIST.md` — a `save` call alone may not make something
public immediately depending on its `status` field.

## Resetting the admin login

The admin account is env-var driven, not stored in content.json:
`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT` (scrypt, see
`hashPassword()` in `server.js`). To set a new password, generate a hash
locally (never send the real target password through untrusted channels)
and have the human paste the three values into Coolify → this app →
Environment Variables, then redeploy:

```js
const crypto = require("crypto");
const salt = crypto.randomBytes(16).toString("hex");
const hash = crypto.scryptSync("<new password>", salt, 64).toString("hex");
console.log({ ADMIN_PASSWORD_SALT: salt, ADMIN_PASSWORD_HASH: hash });
```

Agents should not type secret values directly into Coolify fields — generate
the hash and hand the values to the human to paste in.
