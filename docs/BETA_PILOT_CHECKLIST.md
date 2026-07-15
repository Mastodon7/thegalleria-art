# The Galleria.Art Beta Pilot Checklist

Use this for the first controlled artist pilot. The goal is to prove that a real artist portfolio can be prepared through the admin and artist tools without code changes.

## Pilot Scope

- Keep the beta small and invitation-based.
- Do not enable live Stripe payments during the pilot unless explicitly approved.
- Do not migrate Carolyn Elaine's preserved static portfolio automatically.
- Use admin preview and review workflow before anything goes public.
- Download an operational export before and after any real pilot content changes.

## Carolyn Elaine Strategy

- Carolyn Elaine's existing public portfolio remains preserved at `/carolyn-elaine/`.
- The existing Carolyn route is intentionally static and should not be redesigned in the beta pilot.
- Managed Carolyn portfolio pages can be prepared separately in `/admin/portfolio-pages/`.
- The seed data includes `Carolyn Elaine New Page Draft` as an unpublished admin workflow placeholder.
- Admin preview for Carolyn uses `/admin/preview/artist/artist-carolyn-elaine/`.
- Publishing or integrating managed Carolyn pages should happen only after real content is provided, visual QA is complete, and approval is explicit.
- There is no automatic migration of Carolyn's current portfolio into managed pages.

## Invite A Beta Artist

1. Log in at `/admin/login/`.
2. Open `/admin/invitations/`.
3. Enter the artist email, artist name, professional title, and any internal note.
4. Create the invitation.
5. Send the invitation link privately to the beta artist.
6. Track invitation status in `/admin/users/` and `/admin/invitations/`.

## Help The Artist Log In

- Artist accepts the invite at `/invite/:token/`.
- Artist sets their password and confirms profile basics.
- Artist logs in at `/artist/login/`.
- If they forget the password, use `/password-reset/`.
- Password reset invalidates older sessions.

## Upload Images

- Artists upload images from `/artist/media/`.
- Admin can upload images from `/admin/media/`.
- Supported formats: JPG, PNG, WebP.
- Sharp creates thumbnail, gallery, and large WebP variants.
- Original upload temp files are removed after processing.
- Ready images can be assigned to artist profiles, galleries, artwork, and portfolio pages.
- Failed or processing images should not be used publicly.
- Uploaded media is public by direct `/uploads/...` path, so do not upload confidential images.

## Create Artist Content

Artist-facing flow:

1. Complete profile at `/artist/profile/`.
2. Create or edit galleries at `/artist/galleries/`.
3. Add artwork records at `/artist/artwork/`.
4. Add managed pages at `/artist/portfolio-pages/`.
5. Use `/artist/preview/` before submitting.
6. Submit records for review.

Admin-facing flow:

1. Edit artists at `/admin/artists/`.
2. Edit galleries at `/admin/galleries/`.
3. Edit artwork at `/admin/artwork/`.
4. Edit managed pages at `/admin/portfolio-pages/`.
5. Preview from `/admin/preview/artist/:id/`.
6. Publish only after review.

## Review And Publish

- Draft content is not public.
- Artist submits profile, gallery, artwork, or portfolio pages for review.
- Admin reviews from `/admin/review/`.
- Admin can request changes, approve, publish, or archive.
- Artist sees feedback in the artist portal.
- Only published content appears on public dynamic artist/gallery pages.
- Carolyn managed draft pages remain private unless deliberately published later.

## Inquiries

- Public inquiry forms route messages to admin and the related artist.
- Admin sees all inquiries at `/admin/inquiries/`.
- Artists see only their scoped inquiries at `/artist/inquiries/`.
- Visitor contact details are stored privately and are not rendered on public pages.
- Email delivery is optional; log-only mode should be accepted or Resend should be verified before pilot launch.

## Admin Support Access

1. Open `/admin/users/`.
2. Find the artist.
3. Use support access to enter the artist portal.
4. Confirm the support banner is visible.
5. Help edit artist-owned content.
6. Exit support mode from the banner.
7. Confirm support start, edits, and exit appear in `/admin/audit/`.

Support mode cannot start Stripe Checkout or Customer Portal sessions.

## Carolyn Admin Workflow Test

- Confirm Carolyn appears in `/admin/users/` or `/admin/artists/`.
- Confirm `/carolyn-elaine/` still loads the preserved static portfolio.
- Confirm `/admin/preview/artist/artist-carolyn-elaine/` requires admin login.
- Confirm `Carolyn Elaine New Page Draft` appears in `/admin/portfolio-pages/`.
- Edit the draft only with approved real content.
- Keep the draft unpublished until explicit approval.
- Confirm the draft does not appear in `/carolyn-elaine/`, `/gallery-data.js`, or `/sitemap.xml`.

## Known Beta Limitations

- JSON storage is acceptable for controlled beta, but not ideal for heavy concurrent editing.
- Restore is manual: restore `DATA_DIR/content.json`, `DATA_DIR/media`, and environment variables.
- Portfolio page ordering uses numeric display order.
- Media URLs are public by direct path after upload.
- Live billing remains disabled unless explicitly configured and approved.
- Emails may run in log-only mode unless Resend is configured.
- No public artist self-signup exists; onboarding is invitation-based.

## What Not To Use Yet

- Do not run live Stripe payments.
- Do not import a large artist roster.
- Do not use uploaded media for confidential/private work.
- Do not remove Carolyn's static portfolio.
- Do not publish Carolyn managed pages without real content and approval.
- Do not rely on automated restore; keep manual backups.

## Pilot Completion Checklist

- [ ] Pre-pilot export downloaded.
- [ ] Beta artist invited.
- [ ] Artist accepted invite and logged in.
- [ ] Artist uploaded media.
- [ ] Artist created profile/gallery/artwork/portfolio content.
- [ ] Artist submitted content for review.
- [ ] Admin reviewed and published approved content.
- [ ] Public artist/gallery page appeared.
- [ ] Inquiry submitted and routed.
- [ ] Support mode tested and exited.
- [ ] Audit log reviewed.
- [ ] Post-pilot export downloaded.
