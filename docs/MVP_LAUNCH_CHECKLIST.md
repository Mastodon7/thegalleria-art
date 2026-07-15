# The Galleria.Art MVP Launch Checklist

Phase 20 is a readiness pass. The app is close to MVP, but launch should happen only after this checklist is reviewed against the production Coolify project.

## Current Architecture

- Runtime: Node.js HTTP server in `server.js`.
- Deployment model: Dockerfile, `node:20-alpine`, app serves on port `80`.
- Public assets: static files in `public/`.
- Persistent data: JSON content store at `DATA_DIR/content.json`.
- Media storage: uploaded and processed media under `DATA_DIR/media`.
- Seed data: `seed-content.json` is merged into persistent content on startup without replacing existing records.
- Authentication: signed HTTP-only cookies for admin and artist sessions.
- Payments: Stripe-ready foundation only; live payments must remain disabled until explicitly configured and approved.

## Required Production Environment

Set these in Coolify. Do not commit real secrets.

- `PUBLIC_SITE_URL=https://thegalleria.art`
- `PUBLIC_CONTACT_EMAIL=mc@25mprinting.com` or the production contact address.
- `SESSION_SECRET`: long random secret for signed sessions.
- `ADMIN_EMAIL`: owner/admin login email.
- `ADMIN_PASSWORD_HASH`: scrypt hash for the production admin password.
- `ADMIN_PASSWORD_SALT`: salt used for the production admin password hash.
- `DATA_DIR=/data`
- `PORT=80`

Optional email:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `PASSWORD_RESET_TOKEN_HOURS=2`

Optional analytics:

- `ANALYTICS_PROVIDER=plausible`
- `ANALYTICS_ID=thegalleria.art`

Stripe placeholders:

- `BILLING_PROVIDER=stripe`
- `STRIPE_MODE=disabled` until test mode is verified.
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_SUCCESS_URL=https://thegalleria.art/artist/billing/?checkout=success`
- `STRIPE_CANCEL_URL=https://thegalleria.art/artist/billing/?checkout=cancel`
- `STRIPE_PORTAL_RETURN_URL=https://thegalleria.art/artist/billing/`
- `DEFAULT_CURRENCY=USD`
- `DEFAULT_TRIAL_DAYS=14`
- `DEFAULT_PLAN_SLUG=starter`

## Coolify Deployment Notes

- Keep the existing Dockerfile deployment model.
- Keep the Coolify app port set to `80`.
- Mount persistent storage at `/data`.
- Do not share the `/data` mount with other Coolify projects.
- Confirm domains:
  - `https://thegalleria.art`
  - `https://www.thegalleria.art`
- After pushing to `main`, confirm Coolify deploys the latest Git commit.
- If auto-deploy does not run, trigger a manual redeploy of only the `thegalleria-art` project.

## Admin Account Setup

- Replace the bootstrap admin password before real artists use the platform.
- Generate and configure `ADMIN_PASSWORD_HASH` and `ADMIN_PASSWORD_SALT`.
- Confirm `/admin/login/` works after deployment.
- Confirm `/admin/` and `/admin/api/content` redirect or return unauthorized when logged out.
- Confirm logout clears the admin session.

## Public Site QA

- [ ] `/` loads the Galleria homepage.
- [ ] `/about/` loads.
- [ ] `/contact/` loads.
- [ ] `/pricing/` loads.
- [ ] `/privacy/` loads.
- [ ] `/terms/` loads.
- [ ] `/sitemap.xml` includes only public published pages.
- [ ] `/robots.txt` excludes admin, artist, invite, reset, upload, and API routes.
- [ ] `/carolyn-elaine/` loads Carolyn Elaine's preserved static portfolio.
- [ ] `/CarolynElaine/` redirects to `/carolyn-elaine/`.
- [ ] `/carolynelaine/` redirects to `/carolyn-elaine/`.
- [ ] `/maya-rivers/` demo dynamic artist page loads.
- [ ] `/maya-rivers/urban-echoes/` demo dynamic gallery page loads.
- [ ] Public pages include title, description, canonical, Open Graph, and Twitter metadata where practical.
- [ ] Public inquiry forms save valid submissions.
- [ ] Public inquiry forms reject invalid submissions and honeypot spam.

## Admin QA

- [ ] Login and logout.
- [ ] Dashboard loads counts and review summaries.
- [ ] Users/accounts directory loads.
- [ ] Support impersonation starts and exits safely.
- [ ] Artists list and editor save.
- [ ] Galleries list and editor save.
- [ ] Artwork list and editor save.
- [ ] Portfolio Pages list and editor save.
- [ ] Media library loads.
- [ ] Media upload accepts JPG, PNG, and WebP.
- [ ] Unsupported uploads fail safely.
- [ ] Inquiries list and detail save.
- [ ] Invitations can be created and revoked.
- [ ] Review queue supports request changes, approve, publish, and archive.
- [ ] Plans load and save.
- [ ] Billing settings show Stripe readiness clearly.
- [ ] Audit log filters work.
- [ ] Settings exports download.

## Artist Portal QA

- [ ] Artist login and logout.
- [ ] Dashboard loads.
- [ ] Onboarding checklist reflects profile/gallery/artwork state.
- [ ] Profile editor saves scoped artist data.
- [ ] Galleries editor saves only the logged-in artist's galleries.
- [ ] Artwork editor saves only the logged-in artist's artwork.
- [ ] Portfolio Pages editor saves only the logged-in artist's pages.
- [ ] Media upload works for allowed files.
- [ ] Inquiries show only the logged-in artist's inquiries.
- [ ] Billing page works without Stripe configured.
- [ ] Public View and Private Preview work.
- [ ] Support banner is visible during impersonation.
- [ ] Billing checkout and portal actions are blocked during support impersonation.

## Auth And Access Control QA

- [ ] Public users cannot access `/admin/`.
- [ ] Public users cannot access `/artist/`.
- [ ] Artists cannot access `/admin/`.
- [ ] Artists cannot access another artist's data through artist APIs.
- [ ] Admin can access all admin areas.
- [ ] Support mode records audit events.
- [ ] Password reset token works once.
- [ ] Password reset invalidates older admin/artist sessions.
- [ ] Invalid reset token fails safely.
- [ ] Invite token works once.
- [ ] Reused, revoked, or expired invite token fails safely.

## Data Persistence QA

Use a temporary local or staging `DATA_DIR`, create records, restart the server, and confirm:

- [ ] Artist records persist.
- [ ] Gallery records persist.
- [ ] Artwork records persist.
- [ ] Portfolio pages persist.
- [ ] Media metadata persists.
- [ ] Inquiries persist.
- [ ] Invitations persist.
- [ ] Audit logs persist.
- [ ] Plan and billing settings persist.

## Media And Image Processing QA

- [ ] JPG upload creates thumbnail, gallery, and large variants.
- [ ] PNG upload creates thumbnail, gallery, and large variants.
- [ ] WebP upload creates thumbnail, gallery, and large variants.
- [ ] Unsupported file type is rejected.
- [ ] Oversized upload is rejected.
- [ ] Temporary upload files are removed after processing.
- [ ] Ready uploaded images can be assigned to artists, galleries, artwork, and portfolio pages.
- [ ] Processing or failed images are not selectable publicly.
- [ ] Public pages use optimized variants where available.
- [ ] Carolyn Elaine static images remain untouched.

## Review And Publishing QA

- [ ] Artist creates draft profile/gallery/artwork/portfolio page.
- [ ] Artist submits for review.
- [ ] Admin requests changes.
- [ ] Artist sees requested changes.
- [ ] Artist resubmits.
- [ ] Admin approves or publishes.
- [ ] Only published content appears publicly.
- [ ] Unpublished previews require admin or artist authentication.
- [ ] Status history is recorded.
- [ ] Audit entries are recorded.

## Inquiry QA

- [ ] Public inquiry submission saves to persistent storage.
- [ ] Required validation works.
- [ ] Honeypot spam is rejected.
- [ ] Admin sees all inquiries.
- [ ] Artist sees only assigned inquiries.
- [ ] Visitor contact information is never rendered publicly.
- [ ] Reply by email links work when email is available.
- [ ] Log-only email mode degrades safely when email is not configured.

## Billing And Stripe Readiness

- [ ] Pricing page loads public plans.
- [ ] Admin plan editor loads and saves.
- [ ] Artist billing page loads without Stripe configured.
- [ ] Admin billing settings clearly show missing keys.
- [ ] Checkout buttons are disabled or return a clear unavailable message when Stripe is missing.
- [ ] Test Checkout is attempted only with test keys and mapped test price IDs.
- [ ] Live mode remains disabled until explicitly approved.
- [ ] Stripe webhook endpoint is configured in Stripe before real billing.

## Backup And Export

- [ ] Admin public content export downloads.
- [ ] Admin operational backup export downloads.
- [ ] Inquiry export downloads.
- [ ] Exports redact password hashes, salts, reset tokens, and invitation tokens where applicable.
- [ ] Restore is not automated in the MVP; restoring requires replacing or merging `DATA_DIR/content.json`, copying `DATA_DIR/media`, and restoring required environment variables manually.
- [ ] Keep off-platform backups of `/data`.

## SEO And Analytics

- [ ] Sitemap excludes protected and unpublished routes.
- [ ] Robots file blocks admin, artist, invite, reset, upload, and API paths.
- [ ] Public pages have canonical URLs.
- [ ] Public pages have Open Graph metadata.
- [ ] Missing analytics config does not break public pages.
- [ ] Analytics is only injected when provider and ID are configured.

## Responsive QA

Check desktop and phone:

- [ ] Homepage.
- [ ] Carolyn Elaine portfolio.
- [ ] Dynamic artist and gallery pages.
- [ ] Inquiry forms.
- [ ] Admin dashboard and tables.
- [ ] Admin media upload.
- [ ] Admin portfolio page editor.
- [ ] Artist dashboard.
- [ ] Artist media upload.
- [ ] Artist portfolio page editor.
- [ ] Support banner.

## Error State QA

- [ ] Missing public record returns a static 404 or safe fallback.
- [ ] Unauthorized protected route redirects to the correct login.
- [ ] Expired invite shows a safe message.
- [ ] Invalid reset token shows a safe message.
- [ ] Failed upload returns a clear error.
- [ ] Failed save returns validation errors.
- [ ] Failed inquiry submit returns a clear error.
- [ ] Missing email config logs instead of breaking.
- [ ] Missing Stripe config returns an unavailable message.
- [ ] Public responses do not expose stack traces.

## Seed And Demo Data

- Demo artist: Maya Rivers.
- Demo artist email: `demo.artist@thegalleria.art`.
- Demo artist password is stored only as a hash in `seed-content.json`; do not expose passwords on public pages.
- Demo invitation records are labeled as demo/pending.
- Carolyn Elaine records are protected and must not be deleted, redesigned, or repurposed.

## Known MVP Limitations

- Content storage is JSON-file based, not a database.
- JSON writes are not transaction-locked; avoid simultaneous admin/artist editing during MVP launch windows.
- There is no automated restore UI.
- Billing is Stripe-ready but not enabled without explicit production configuration.
- Email can run in log-only mode when Resend is not configured.
- Portfolio page ordering uses numeric display order fields, not drag-and-drop.
- Media cleanup is conservative; archived media is not physically deleted automatically.
- Uploaded media is publicly accessible by direct `/uploads/...` path once uploaded, even when it is not linked from a published page.
- Admin/shared media may not count toward an artist's quota unless assigned with an owner or referenced by artist-owned content.
- No formal automated test suite exists yet; use this checklist plus local route/API checks before launch.

## Final Launch Gate

- [ ] Latest commit is deployed by Coolify.
- [ ] `/admin/settings/` export is downloaded as a pre-launch backup.
- [ ] Admin password has been replaced.
- [ ] `SESSION_SECRET` is set and stable.
- [ ] `/data` persistence is confirmed by restart.
- [ ] Carolyn Elaine portfolio is checked manually.
- [ ] A demo artist workflow is checked manually.
- [ ] Live payments remain disabled unless explicitly approved.
