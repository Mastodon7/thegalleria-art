# The Galleria.Art

Public website foundation for The Galleria.Art.

For MVP launch readiness, production setup, and the final QA checklist, see [`docs/MVP_LAUNCH_CHECKLIST.md`](docs/MVP_LAUNCH_CHECKLIST.md).

The root domain presents the gallery platform landing page. Carolyn Elaine's preserved portfolio is available at:

- `/carolyn-elaine/`
- `/CarolynElaine/` redirects to `/carolyn-elaine/`
- `/carolynelaine/` redirects to `/carolyn-elaine/`

## Admin foundation

The private owner login is available at `/admin/login/`. The protected landing page is `/admin/`.

This phase adds a small Node server so admin authentication happens server-side instead of in public browser code. The bootstrap admin email defaults to `mc@25mprinting.com`, and the temporary password is stored as a server-side hash. For production, set these environment variables in the hosting panel:

- `SESSION_SECRET`: long random value used to sign admin sessions.
- `ADMIN_EMAIL`: owner login email, if different from the default.
- `ADMIN_PASSWORD_HASH`: server-side scrypt hash for a replacement password.
- `ADMIN_PASSWORD_SALT`: salt used to create the replacement hash.

Without a backend/runtime, a static-only site cannot provide a truly private admin login. This foundation keeps storage simple with signed HTTP-only cookies and no database.

## Admin management foundation

Phase 4 adds protected admin management pages for artists, galleries, artwork, and settings:

- `/admin/artists/`
- `/admin/galleries/`
- `/admin/artwork/`
- `/admin/settings/`

The shared content model includes artist, gallery, and artwork records. Public pages filter for published records only.

## Persistent content storage

Phase 5 adds writable JSON content storage for artists, galleries, and artwork. The server seeds initial data from `seed-content.json` and writes live content to `DATA_DIR/content.json`.

For Coolify, keep the Dockerfile deployment and mount persistent storage at `/data` or set `DATA_DIR` to another persistent path. The server creates backup files before save/archive writes and does not overwrite existing content on startup.

## Admin media uploads

Phase 6 adds protected media uploads at `/admin/media/`. Uploaded JPG, PNG, and WebP images are stored in `DATA_DIR/media` by default and served publicly from `/uploads/...` so published artist, gallery, and artwork records can reuse them.

For Coolify, the same persistent `/data` mount used for `DATA_DIR` should remain in place. That keeps both `content.json` and uploaded media files outside the transient build output.

Phase 8 processes new uploads with Sharp. Original uploads are written only to `DATA_DIR/tmp-uploads` during processing, then removed. Ready media records contain WebP thumbnail, gallery, and large variants; failed or processing media should not be selectable for public fields.

## Email, notifications, and recovery

Phase 12 adds transactional email hooks, in-app notifications, and password recovery. Email is optional:

- `RESEND_API_KEY`: enables live Resend transactional email.
- `EMAIL_FROM`: verified sender address for live email.
- `PUBLIC_CONTACT_EMAIL`: public contact/routing email shown in admin settings.
- `PUBLIC_SITE_URL`: canonical site URL used in email links, defaults to `https://thegalleria.art`.
- `PASSWORD_RESET_TOKEN_HOURS`: reset link lifetime, defaults to `2`.

If email is not configured, messages are stored in the protected admin email log and printed server-side. Pages continue working in log-only mode.

## Production hardening

Phase 13 adds `/sitemap.xml`, `/robots.txt`, richer public metadata, admin-only exports, and `/admin/audit/`.

- `ANALYTICS_PROVIDER=plausible` and `ANALYTICS_ID=thegalleria.art` can enable public-page analytics.
- Admin exports are available from `/admin/settings/`.
- Audit events are visible at `/admin/audit/`.

## Plans and billing foundation

Phase 14 adds public pricing at `/pricing/`, protected plan management at `/admin/plans/`, and artist billing status at `/artist/billing/`. Billing remains configuration-ready and does not collect payments unless provider setup is intentionally added.

- `BILLING_PROVIDER`: optional provider name, defaults to `none`.
- `STRIPE_MODE`: `disabled`, `test`, or `live`; defaults to `disabled` unless a Stripe secret is present.
- `STRIPE_PUBLISHABLE_KEY`: public Stripe key status shown in admin.
- `STRIPE_SECRET_KEY`: server-side Stripe API key for test/live Checkout and Customer Portal sessions.
- `STRIPE_WEBHOOK_SECRET`: server-side webhook signing secret for `/api/stripe/webhook`.
- `STRIPE_SUCCESS_URL`: Checkout success return URL.
- `STRIPE_CANCEL_URL`: Checkout cancel return URL.
- `STRIPE_PORTAL_RETURN_URL`: Customer Portal return URL.
- `DEFAULT_CURRENCY`: default plan currency, defaults to `USD`.
- `DEFAULT_TRIAL_DAYS`: default trial display value, defaults to `14`.
- `DEFAULT_PLAN_SLUG`: default plan assignment fallback, defaults to `starter`.

Phase 15 adds `/admin/billing/settings/`, Stripe readiness checks, plan Stripe price ID mapping fields, test/live Checkout session structure, Customer Portal session structure, and a signed webhook endpoint. Online billing remains disabled when Stripe keys or plan price IDs are missing. Live mode should only be used after test mode, Checkout, Customer Portal, and webhook handling have been verified in Stripe.

## Storage limits and quotas

Phase 16 connects artist plans to server-side quota checks. The admin artist editor can set custom gallery, artwork, media, and storage limits or ignore limits for legacy/comped/custom accounts. Carolyn Elaine remains protected with an ignore-limits override.

Usage is calculated per artist for galleries, published galleries, artwork, published artwork, media records, and media storage. Storage counts processed media variant sizes when available, with legacy metadata as a fallback. Limit warnings appear near 80% usage, and new uploads/creates/publishes are blocked only when the next action would exceed a hard limit. Existing content is never deleted or unpublished automatically.

## Artist portal demo

Phase 7 adds the first protected artist-facing demo portal at `/artist/login/`.

Demo artist account:

- Email: `demo.artist@thegalleria.art`
- Temporary password: `DemoArtist123!`

The password is stored in seed data as a server-side hash. The demo artist is Maya Rivers, with a published sample gallery at `/maya-rivers/`. Artist portal edits are scoped to the logged-in artist and do not expose admin tools.

## Coolify

1. Push this folder to a GitHub repository.
2. In Coolify choose Public Repository or Private Repository.
3. Build Pack: Dockerfile.
4. Port: 80.
5. Add domains:
   - `https://thegalleria.art`
   - `https://www.thegalleria.art`
6. Deploy.
