# The Galleria.Art

Public website foundation for The Galleria.Art.

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
