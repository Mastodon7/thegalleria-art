const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URLSearchParams } = require("url");
const sharp = require("sharp");

const publicDir = path.join(__dirname, "public");
const seedPath = path.join(__dirname, "seed-content.json");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "content-data");
const dataFile = process.env.CONTENT_DATA_FILE || path.join(dataDir, "content.json");
const mediaDir = process.env.MEDIA_DIR || path.join(dataDir, "media");
const tempUploadDir = path.join(dataDir, "tmp-uploads");
const uploadBasePath = "/uploads";
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 20 * 1024 * 1024);
const maxSourcePixels = Number(process.env.MAX_SOURCE_PIXELS || 100 * 1000 * 1000);
const maxSourceDimension = Number(process.env.MAX_SOURCE_DIMENSION || 16000);
const port = Number(process.env.PORT || 80);
const adminEmail = process.env.ADMIN_EMAIL || "mc@25mprinting.com";
const passwordSalt = process.env.ADMIN_PASSWORD_SALT || "galleria-admin-bootstrap-v1";
const passwordHash = process.env.ADMIN_PASSWORD_HASH ||
  "61a567bd15cf8240b460bb5199b408e73bf6fea3f93d529075a56be811e0b3d9eeb280e43bf340411d87355f2fc85a0dc23765e5644062cdcc875f738ea53ec2";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const adminSessionCookieName = "galleria_admin";
const artistSessionCookieName = "galleria_artist";
const sessionMaxAgeSeconds = 60 * 60 * 8;
const workflowStatuses = ["draft", "pending_review", "approved", "published", "changes_requested", "archived"];
const validStatuses = new Set(workflowStatuses);
const validInvitationStatuses = new Set(["current", "invited", "pending", "accepted", "none"]);
const validInquiryStatuses = new Set(["new", "reviewed", "replied", "archived", "spam"]);
const validArtistInvitationStatuses = new Set(["pending", "accepted", "expired", "revoked"]);
const inquiryRateLimit = new Map();
const inquiryRateLimitWindowMs = 10 * 60 * 1000;
const inquiryRateLimitMax = 6;
const maxInquiryMessageLength = 3000;
const invitationDefaultDays = 14;
const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);
const mediaVariants = [
  { key: "thumbnail", width: 480, quality: 76 },
  { key: "gallery", width: 1200, quality: 82 },
  { key: "large", width: 2400, quality: 88 }
];

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function redirect(response, location, statusCode = 303, headers = {}) {
  response.writeHead(statusCode, { Location: location, ...headers });
  response.end();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf("=");
        return [
          decodeURIComponent(cookie.slice(0, separator)),
          decodeURIComponent(cookie.slice(separator + 1))
        ];
      })
  );
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashPassword(password) {
  return crypto.scryptSync(password, passwordSalt, 64).toString("hex");
}

function verifyPassword(password) {
  return safeCompare(hashPassword(password), passwordHash);
}

function isSecureRequest(request) {
  return request.headers["x-forwarded-proto"] === "https" || request.socket.encrypted;
}

function createSignedSessionCookie(cookieName, session, request) {
  const payload = Buffer.from(JSON.stringify({
    ...session,
    exp: Date.now() + sessionMaxAgeSeconds * 1000
  })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const secure = isSecureRequest(request) ? "; Secure" : "";

  return `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}${secure}`;
}

function createSessionCookie(email, request) {
  return createSignedSessionCookie(adminSessionCookieName, { email, role: "admin" }, request);
}

function createArtistSessionCookie(account, request) {
  return createSignedSessionCookie(artistSessionCookieName, {
    email: account.email,
    artistId: account.artistId,
    role: "artist"
  }, request);
}

function clearSessionCookie(cookieName = adminSessionCookieName) {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getSignedSession(request, cookieName) {
  const token = parseCookies(request)[cookieName];

  if (!token || !token.includes(".")) {
    return null;
  }

  const [payload, signature] = token.split(".");

  if (!safeCompare(sign(payload), signature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.email || session.exp < Date.now()) {
      return null;
    }
    return session;
  } catch (error) {
    return null;
  }
}

function getSession(request) {
  return getSignedSession(request, adminSessionCookieName);
}

function getArtistSession(request) {
  return getSignedSession(request, artistSessionCookieName);
}

function readSeedContent() {
  return JSON.parse(fs.readFileSync(seedPath, "utf8"));
}

function normalizeContent(content) {
  return {
    version: 1,
    artists: Array.isArray(content.artists) ? content.artists : [],
    galleries: Array.isArray(content.galleries) ? content.galleries : [],
    artwork: Array.isArray(content.artwork) ? content.artwork : [],
    media: Array.isArray(content.media) ? content.media : [],
    inquiries: Array.isArray(content.inquiries) ? content.inquiries : [],
    invitations: Array.isArray(content.invitations) ? content.invitations : [],
    statusHistory: Array.isArray(content.statusHistory) ? content.statusHistory : [],
    artistAccounts: Array.isArray(content.artistAccounts) ? content.artistAccounts : []
  };
}

function backupDataFile(reason) {
  if (!fs.existsSync(dataFile)) {
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(dataDir, `content.${stamp}.${reason}.bak.json`);
  fs.copyFileSync(dataFile, backupFile);
}

function writeContent(content, options = {}) {
  fs.mkdirSync(dataDir, { recursive: true });

  if (options.backup) {
    backupDataFile(options.reason || "write");
  }

  const tmpFile = `${dataFile}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(normalizeContent(content), null, 2)}\n`);
  fs.renameSync(tmpFile, dataFile);
}

function mergeMissingSeedRecords(content, seed) {
  let changed = false;

  ["artists", "galleries", "artwork", "media", "inquiries", "invitations", "statusHistory", "artistAccounts"].forEach((collection) => {
    (seed[collection] || []).forEach((seedRecord) => {
      if (!content[collection].some((record) => record.id === seedRecord.id)) {
        content[collection].push(clone(seedRecord));
        changed = true;
      }
    });
  });

  return changed;
}

function futureIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function generateInvitationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function ensureInvitationTokens(content) {
  let changed = false;

  content.invitations.forEach((invitation) => {
    if (!invitation.token && invitation.status === "pending") {
      invitation.token = generateInvitationToken();
      changed = true;
    }

    if (!invitation.expiresAt && invitation.status === "pending") {
      invitation.expiresAt = futureIso(invitationDefaultDays);
      changed = true;
    }
  });

  return changed;
}

function ensureContentStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.mkdirSync(tempUploadDir, { recursive: true });
  const seed = normalizeContent(readSeedContent());
  ensureInvitationTokens(seed);

  if (!fs.existsSync(dataFile)) {
    writeContent(seed);
    return;
  }

  const content = normalizeContent(JSON.parse(fs.readFileSync(dataFile, "utf8")));
  const mergedSeed = mergeMissingSeedRecords(content, seed);
  const generatedInvitations = ensureInvitationTokens(content);
  const changed = mergedSeed || generatedInvitations;
  if (changed) {
    writeContent(content, { backup: true, reason: "seed-merge" });
  }
}

function loadContent() {
  ensureContentStore();
  return normalizeContent(JSON.parse(fs.readFileSync(dataFile, "utf8")));
}

function saveContent(content, reason = "save") {
  writeContent(content, { backup: true, reason });
}

function sortByDisplayOrder(left, right) {
  return Number(left.displayOrder || 0) - Number(right.displayOrder || 0);
}

function mediaVariant(media, preferred = "gallery") {
  if (!media?.variants) {
    return null;
  }

  return media.variants[preferred] ||
    media.variants.gallery ||
    media.variants.large ||
    media.variants.thumbnail ||
    null;
}

function mediaPath(media, preferred = "gallery") {
  return mediaVariant(media, preferred)?.path || media?.publicPath || "";
}

function mediaContainsPath(media, imagePath) {
  if (!media || !imagePath) {
    return false;
  }

  return media.publicPath === imagePath ||
    Object.values(media.variants || {}).some((variant) => variant?.path === imagePath);
}

function findMediaByPath(content, imagePath) {
  return content.media.find((media) => mediaContainsPath(media, imagePath));
}

function resolveImagePath(content, imagePath, preferred = "gallery") {
  const media = findMediaByPath(content, imagePath);
  if (media?.status === "ready") {
    return mediaPath(media, preferred) || imagePath;
  }

  return imagePath;
}

function readyMediaForSelect(media) {
  return media.status === "ready" || (!media.status && media.publicPath);
}

function publicRecord(record) {
  const {
    adminReviewNote,
    artistReviewNote,
    submittedAt,
    submittedByArtistId,
    reviewedAt,
    reviewedByAdminId,
    reviewUpdatedAt,
    ...safeRecord
  } = record || {};

  return safeRecord;
}

function optimizeArtistForPublic(content, artist) {
  return {
    ...publicRecord(artist),
    heroImage: resolveImagePath(content, artist.heroImage, "gallery")
  };
}

function optimizeGalleryForPublic(content, gallery) {
  return {
    ...publicRecord(gallery),
    coverImage: resolveImagePath(content, gallery.coverImage, "gallery")
  };
}

function optimizeArtworkForPublic(content, artwork) {
  return {
    ...publicRecord(artwork),
    image: resolveImagePath(content, artwork.image, "gallery"),
    largeImage: resolveImagePath(content, artwork.image, "large")
  };
}

function buildPublicData(content) {
  const artists = content.artists
    .filter((artist) => artist.status === "published")
    .map((artist) => {
      const galleries = content.galleries
        .filter((gallery) => gallery.artistId === artist.id && gallery.status === "published")
        .sort(sortByDisplayOrder)
        .map((gallery) => ({
          ...optimizeGalleryForPublic(content, gallery),
          artworks: content.artwork
            .filter((artwork) => artwork.galleryId === gallery.id && artwork.status === "published")
            .sort(sortByDisplayOrder)
            .map((artwork) => optimizeArtworkForPublic(content, artwork))
        }));

      return { ...optimizeArtistForPublic(content, artist), galleries };
    })
    .filter((artist) => artist.galleries.length);

  return { artists };
}

function publicContentWithArtist(content, artist) {
  const galleries = content.galleries
    .filter((gallery) => gallery.artistId === artist.id && gallery.status === "published")
    .sort(sortByDisplayOrder)
    .map((gallery) => ({
      ...optimizeGalleryForPublic(content, gallery),
      artworks: content.artwork
        .filter((artwork) => artwork.galleryId === gallery.id && artwork.status === "published")
        .sort(sortByDisplayOrder)
        .map((artwork) => optimizeArtworkForPublic(content, artwork))
    }));

  return { ...optimizeArtistForPublic(content, artist), galleries };
}

function previewContentWithArtist(content, artist) {
  const galleries = content.galleries
    .filter((gallery) => gallery.artistId === artist.id && gallery.status !== "archived")
    .sort(sortByDisplayOrder)
    .map((gallery) => ({
      ...optimizeGalleryForPublic(content, gallery),
      artworks: content.artwork
        .filter((artwork) => artwork.galleryId === gallery.id && artwork.status !== "archived")
        .sort(sortByDisplayOrder)
        .map((artwork) => optimizeArtworkForPublic(content, artwork))
    }));

  return { ...optimizeArtistForPublic(content, artist), galleries };
}

function publicPathForArtist(artist) {
  return artist.canonicalPath || `/${artist.slug}/`;
}

function findPublishedArtistForPath(content, pathname) {
  const artistPathMatch = pathname.match(/^\/artists\/([^/]+)\/?$/);
  const rootSlugMatch = pathname.match(/^\/([^/]+)\/?$/);
  const slug = artistPathMatch?.[1] || rootSlugMatch?.[1];

  if (!slug || ["about", "admin", "artist", "contact", "privacy", "terms", "uploads"].includes(slug)) {
    return null;
  }

  return content.artists.find((artist) =>
    artist.status === "published" &&
    artist.slug === slug &&
    artist.slug !== "carolyn-elaine"
  ) || null;
}

function renderPublicArtistPage(artist) {
  const galleries = artist.galleries || [];
  const primaryGallery = galleries[0] || {};
  const artworks = galleries.flatMap((gallery) =>
    (gallery.artworks || []).map((artwork) => ({ ...artwork, galleryTitle: gallery.title }))
  );
  const heroImage = primaryGallery.coverImage || artist.heroImage || artworks[0]?.image || "";
  const location = [artist.city, artist.region, artist.country].filter(Boolean).join(", ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(artist.shortDescription || `${artist.name} at The Galleria.Art`)}">
  <title>${escapeHtml(artist.name)} | The Galleria.Art</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="home-page public-artist-page">
  <header class="site-header" aria-label="The Galleria.Art">
    <a class="site-brand" href="/">The Galleria.Art</a>
    <nav class="site-nav" aria-label="Public navigation">
      <a href="/">Home</a>
      <a href="/#current-galleries">Galleries</a>
      <a href="/contact/">Contact</a>
    </nav>
  </header>

  <main>
    <section class="dynamic-artist-hero"${heroImage ? ` style="--artist-hero-image: url('${escapeHtml(heroImage)}')"` : ""}>
      <div class="dynamic-artist-hero-inner">
        <p class="welcome-line">${escapeHtml(artist.professionalTitle || artist.category || "Artist")}</p>
        <h1>${escapeHtml(artist.name)}</h1>
        <div class="gold-divider" aria-hidden="true"></div>
        <p class="hero-support">${escapeHtml(artist.shortDescription || "")}</p>
        ${location ? `<p class="dynamic-artist-location">${escapeHtml(location)}</p>` : ""}
      </div>
    </section>

    <section class="dynamic-gallery-section" aria-labelledby="gallery-title">
      <div class="section-inner">
        <div class="section-heading">
          <p class="section-kicker">Public Gallery</p>
          <h2 id="gallery-title">${escapeHtml(primaryGallery.title || "Gallery")}</h2>
        </div>
        ${primaryGallery.description ? `<p class="dynamic-gallery-description">${escapeHtml(primaryGallery.description)}</p>` : ""}
        <div class="dynamic-artwork-grid">
          ${artworks.map((artwork, index) => `
            <article class="dynamic-artwork-card">
              <button class="dynamic-lightbox-trigger" type="button" data-index="${index}" data-src="${escapeHtml(artwork.largeImage || artwork.image)}" data-title="${escapeHtml(artwork.title)}" data-meta="${escapeHtml([artwork.year, artwork.location, artwork.medium].filter(Boolean).join(" - "))}" data-artist-id="${escapeHtml(artist.id)}" data-gallery-id="${escapeHtml(artwork.galleryId || primaryGallery.id || "")}" data-artwork-id="${escapeHtml(artwork.id)}" aria-label="View ${escapeHtml(artwork.title)}">
                <img src="${escapeHtml(artwork.image)}" alt="${escapeHtml(artwork.alt || artwork.title)}" loading="lazy">
              </button>
              <div>
                <p>${escapeHtml(artwork.galleryTitle || "")}</p>
                <h3>${escapeHtml(artwork.title)}</h3>
                <span>${escapeHtml([artwork.year, artwork.location].filter(Boolean).join(" - "))}</span>
                <p>${escapeHtml(artwork.description || "")}</p>
                <button class="dynamic-inquiry-link" type="button" data-inquiry-select="${escapeHtml(artwork.id)}">Inquire About This Work</button>
              </div>
            </article>
          `).join("")}
        </div>
      </div>
    </section>

    <section class="invitation-section" aria-labelledby="inquiry-title">
      <div class="section-inner invitation-copy">
        <p class="section-kicker">Inquiry</p>
        <h2 id="inquiry-title">Inquire About This Work</h2>
        <p>Send a private inquiry about ${escapeHtml(artist.name)} or a specific artwork. The Galleria.Art will route the message to the appropriate artist contact.</p>
        <form class="inquiry-form" data-inquiry-form>
          <input name="inquiryType" type="hidden" value="artist">
          <input name="artistId" type="hidden" value="${escapeHtml(artist.id)}">
          <input name="galleryId" type="hidden" value="${escapeHtml(primaryGallery.id || "")}">
          <input name="sourceUrl" type="hidden" value="${escapeHtml(publicPathForArtist(artist))}">
          <label>
            <span>Name</span>
            <input name="name" autocomplete="name" required>
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" required>
          </label>
          <label>
            <span>Phone Optional</span>
            <input name="phone" autocomplete="tel">
          </label>
          <label>
            <span>Preferred Contact</span>
            <select name="preferredContactMethod">
              <option value="email">Email</option>
              <option value="phone">Phone</option>
              <option value="either">Either</option>
            </select>
          </label>
          <label class="admin-field-wide">
            <span>Artwork Optional</span>
            <select name="artworkId" data-inquiry-artwork-select>
              <option value="">General inquiry about ${escapeHtml(artist.name)}</option>
              ${artworks.map((artwork) => `<option value="${escapeHtml(artwork.id)}">${escapeHtml(artwork.title)}</option>`).join("")}
            </select>
          </label>
          <label class="admin-field-wide">
            <span>Message</span>
            <textarea name="message" maxlength="${maxInquiryMessageLength}" required></textarea>
          </label>
          <label class="inquiry-honeypot" aria-hidden="true">
            <span>Website</span>
            <input name="companyWebsite" tabindex="-1" autocomplete="off">
          </label>
          <button class="home-button" type="submit">Send Inquiry</button>
          <p class="inquiry-feedback" data-inquiry-feedback aria-live="polite"></p>
        </form>
      </div>
    </section>
  </main>

  <div class="dynamic-lightbox" id="dynamic-lightbox" role="dialog" aria-modal="true" aria-label="Artwork viewer" hidden>
    <button class="dynamic-lightbox-close" type="button" aria-label="Close artwork viewer">X</button>
    <button class="dynamic-lightbox-prev" type="button" aria-label="Previous artwork">&lt;</button>
    <figure>
      <img id="dynamic-lightbox-image" alt="">
      <figcaption>
        <strong id="dynamic-lightbox-title"></strong>
        <span id="dynamic-lightbox-meta"></span>
        <button class="dynamic-inquiry-link" id="dynamic-lightbox-inquire" type="button">Inquire About This Work</button>
      </figcaption>
    </figure>
    <button class="dynamic-lightbox-next" type="button" aria-label="Next artwork">&gt;</button>
  </div>

  <footer class="site-footer">
    <nav aria-label="Footer navigation">
      <a href="/about/">About</a>
      <a href="/contact/">Contact</a>
      <a href="/artist/login/">Artist Login</a>
      <a href="/privacy/">Privacy</a>
      <a href="/terms/">Terms</a>
    </nav>
    <p>&copy; 2026 The Galleria.Art. All rights reserved.</p>
  </footer>
  <script src="/dynamic-gallery.js"></script>
  <script src="/inquiry.js"></script>
</body>
</html>`;
}

function sendPublicArtistPage(response, pathname) {
  const content = loadContent();
  const artist = findPublishedArtistForPath(content, pathname);

  if (!artist) {
    return false;
  }

  const publicArtist = publicContentWithArtist(content, artist);
  if (!publicArtist.galleries.length) {
    return false;
  }

  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(renderPublicArtistPage(publicArtist));
  return true;
}

function sendPublicGalleryData(response) {
  const publicData = buildPublicData(loadContent());
  response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
  response.end(`window.GalleriaData = ${JSON.stringify(publicData, null, 2)};\n`);
}

function serveUploadedMedia(response, pathname) {
  let requestedPath;

  try {
    requestedPath = decodeURIComponent(pathname.replace(`${uploadBasePath}/`, ""));
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const normalizedPath = path.normalize(requestedPath);
  const absolutePath = path.join(mediaDir, normalizedPath);

  if (absolutePath !== mediaDir && !absolutePath.startsWith(`${mediaDir}${path.sep}`)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  sendFile(response, absolutePath);
}

function sendFile(response, filePath, statusCode = 200) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(statusCode, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
    });
    response.end(content);
  });
}

function sendAdminFile(response, filePath, session) {
  fs.readFile(filePath, "utf8", (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "text/plain; charset=utf-8"
    });

    if (path.extname(filePath).toLowerCase() === ".html") {
      response.end(content.replaceAll("{{ADMIN_EMAIL}}", escapeHtml(session.email)));
      return;
    }

    response.end(content);
  });
}

function sendArtistFile(response, filePath, context) {
  fs.readFile(filePath, "utf8", (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "text/plain; charset=utf-8"
    });

    if (path.extname(filePath).toLowerCase() === ".html") {
      response.end(content
        .replaceAll("{{ARTIST_EMAIL}}", escapeHtml(context.account.email))
        .replaceAll("{{ARTIST_NAME}}", escapeHtml(context.artist.name)));
      return;
    }

    response.end(content);
  });
}

function protectAdminRoute(request, response, pathname) {
  const session = getSession(request);
  if (!session) {
    redirect(response, "/admin/login/", 302);
    return;
  }

  let requestedPath;

  try {
    requestedPath = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const normalizedPath = path.normalize(requestedPath);
  let absolutePath = path.join(publicDir, normalizedPath);

  if (absolutePath !== publicDir && !absolutePath.startsWith(`${publicDir}${path.sep}`)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.stat(absolutePath, (error, stats) => {
    if (!error && stats.isDirectory()) {
      absolutePath = path.join(absolutePath, "index.html");
    }

    sendAdminFile(response, absolutePath, session);
  });
}

function protectArtistRoute(request, response, pathname) {
  const context = getArtistContext(request);
  if (!context) {
    redirect(response, "/artist/login/", 302);
    return;
  }

  let requestedPath;

  try {
    requestedPath = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const normalizedPath = path.normalize(requestedPath);
  let absolutePath = path.join(publicDir, normalizedPath);

  if (absolutePath !== publicDir && !absolutePath.startsWith(`${publicDir}${path.sep}`)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.stat(absolutePath, (error, stats) => {
    if (!error && stats.isDirectory()) {
      absolutePath = path.join(absolutePath, "index.html");
    }

    sendArtistFile(response, absolutePath, context);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function collectBody(request, callback) {
  let body = "";

  request.on("data", (chunk) => {
    body += chunk;

    if (body.length > 1000000) {
      request.destroy();
    }
  });

  request.on("end", () => callback(body));
}

function collectBuffer(request, response, callback) {
  const chunks = [];
  let size = 0;

  request.on("data", (chunk) => {
    size += chunk.length;

    if (size > maxUploadBytes + 2048) {
      sendJson(response, 413, { ok: false, message: "Image file is too large." });
      request.destroy();
      return;
    }

    chunks.push(chunk);
  });

  request.on("end", () => callback(Buffer.concat(chunks)));
}

function collectJson(request, response, callback) {
  collectBody(request, (body) => {
    let payload;

    try {
      payload = body ? JSON.parse(body) : {};
    } catch (error) {
      sendJson(response, 400, { ok: false, message: "Invalid request data." });
      return;
    }

    callback(payload);
  });
}

function cleanString(value) {
  return String(value || "").trim();
}

function cleanLimitedString(value, maxLength) {
  return cleanString(value).slice(0, maxLength);
}

function clientKey(request) {
  return cleanString(request.headers["x-forwarded-for"]).split(",")[0] ||
    request.socket.remoteAddress ||
    "unknown";
}

function rateLimitInquiry(request) {
  const key = clientKey(request);
  const now = Date.now();
  const entry = inquiryRateLimit.get(key) || { count: 0, resetAt: now + inquiryRateLimitWindowMs };

  if (entry.resetAt <= now) {
    entry.count = 0;
    entry.resetAt = now + inquiryRateLimitWindowMs;
  }

  entry.count += 1;
  inquiryRateLimit.set(key, entry);
  return entry.count <= inquiryRateLimitMax;
}

function sanitizeFilename(filename) {
  const parsed = path.parse(String(filename || "upload"));
  const safeBase = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "upload";

  return safeBase;
}

function detectImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (buffer.length >= 12 &&
    buffer[0] === 0x89 &&
    buffer.toString("ascii", 1, 4) === "PNG") {
    return "image/png";
  }

  if (buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }

  return "";
}

function uploadExtension(filename) {
  const extension = path.extname(String(filename || "")).toLowerCase();
  return extension === ".jpeg" ? ".jpg" : extension;
}

function updateMediaRecord(content, id, patch) {
  const index = content.media.findIndex((media) => media.id === id);
  if (index >= 0) {
    content.media[index] = { ...content.media[index], ...patch, updatedAt: nowIso() };
    return content.media[index];
  }

  return null;
}

async function processMediaUpload(upload, options = {}) {
  const now = nowIso();
  const mediaId = generateId("media");
  const detectedMimeType = detectImageMime(upload.buffer);
  const declaredExtension = uploadExtension(upload.originalFilename);
  const safeBase = sanitizeFilename(upload.originalFilename);
  const uniqueSuffix = mediaId.replace("media-", "").slice(0, 12);
  const storedBaseFilename = `${safeBase}-${uniqueSuffix}`;
  const tempFilename = `${storedBaseFilename}${declaredExtension || ".upload"}`;
  const tempPath = path.join(tempUploadDir, tempFilename);
  const content = loadContent();
  const record = {
    id: mediaId,
    originalFilename: upload.originalFilename,
    storedBaseFilename,
    storedFilename: "",
    publicPath: "",
    mimeType: detectedMimeType || upload.mimeType,
    originalSize: upload.buffer.length,
    originalWidth: null,
    originalHeight: null,
    variants: {},
    uploadedBy: options.uploadedBy || "admin",
    ownerArtistId: options.ownerArtistId || "",
    status: "processing",
    errorMessage: "",
    createdAt: now,
    uploadedAt: now,
    updatedAt: now
  };

  content.media.push(record);
  saveContent(content, "media-processing-start");

  try {
    if (!allowedImageTypes.has(upload.mimeType) || !allowedImageTypes.has(detectedMimeType)) {
      throw new Error("Unsupported file type. Upload JPG, PNG, or WebP images only.");
    }

    if (uploadExtension(upload.originalFilename) !== allowedImageTypes.get(detectedMimeType)) {
      throw new Error("File extension does not match the uploaded image type.");
    }

    if (upload.buffer.length > maxUploadBytes) {
      throw new Error("Image file is too large. Upload images up to 20 MB.");
    }

    fs.mkdirSync(tempUploadDir, { recursive: true });
    fs.writeFileSync(tempPath, upload.buffer);

    const image = sharp(tempPath, { limitInputPixels: maxSourcePixels }).rotate();
    const metadata = await image.metadata();
    const originalWidth = Number(metadata.width || 0);
    const originalHeight = Number(metadata.height || 0);

    if (!originalWidth || !originalHeight) {
      throw new Error("Image dimensions could not be read.");
    }

    if (originalWidth > maxSourceDimension || originalHeight > maxSourceDimension || originalWidth * originalHeight > maxSourcePixels) {
      throw new Error("Image dimensions are too large for processing.");
    }

    const variants = {};

    for (const variant of mediaVariants) {
      const outputFilename = `${storedBaseFilename}-${variant.key}.webp`;
      const outputPath = path.join(mediaDir, outputFilename);

      if (!outputPath.startsWith(`${mediaDir}${path.sep}`)) {
        throw new Error("Invalid media output path.");
      }

      const output = await sharp(tempPath, { limitInputPixels: maxSourcePixels })
        .rotate()
        .resize({ width: variant.width, withoutEnlargement: true })
        .webp({ quality: variant.quality })
        .toBuffer({ resolveWithObject: true });

      fs.writeFileSync(outputPath, output.data);
      variants[variant.key] = {
        path: `${uploadBasePath}/${outputFilename}`,
        width: output.info.width,
        height: output.info.height,
        size: output.info.size,
        mimeType: "image/webp"
      };
    }

    const finalContent = loadContent();
    const readyRecord = updateMediaRecord(finalContent, mediaId, {
      storedFilename: path.basename(variants.large?.path || variants.gallery?.path || variants.thumbnail?.path || ""),
      publicPath: variants.large?.path || variants.gallery?.path || variants.thumbnail?.path || "",
      mimeType: "image/webp",
      originalWidth,
      originalHeight,
      width: variants.large?.width || variants.gallery?.width || variants.thumbnail?.width || originalWidth,
      height: variants.large?.height || variants.gallery?.height || variants.thumbnail?.height || originalHeight,
      size: variants.large?.size || variants.gallery?.size || variants.thumbnail?.size || upload.buffer.length,
      variants,
      status: "ready",
      errorMessage: ""
    });
    saveContent(finalContent, "media-processing-ready");
    return { ok: true, media: readyRecord, content: finalContent };
  } catch (error) {
    const failedContent = loadContent();
    const failedRecord = updateMediaRecord(failedContent, mediaId, {
      status: "failed",
      errorMessage: error.message || "Image processing failed."
    });
    saveContent(failedContent, "media-processing-failed");
    return {
      ok: false,
      media: failedRecord,
      content: failedContent,
      message: error.message || "Image processing failed."
    };
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

function parseMultipartUpload(request, buffer) {
  const contentType = request.headers["content-type"] || "";
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);

  if (!boundaryMatch) {
    return null;
  }

  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
  const body = buffer.toString("binary");
  const parts = body.split(boundary);
  const fields = {};
  let upload = null;

  for (const part of parts) {
    if (!part.includes("Content-Disposition")) {
      continue;
    }

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      continue;
    }

    const headers = part.slice(0, headerEnd);
    let content = part.slice(headerEnd + 4);
    content = content.replace(/\r\n--$/, "").replace(/\r\n$/, "");

    const fieldName = headers.match(/name="([^"]*)"/i)?.[1] || "";
    if (!fieldName) {
      continue;
    }

    if (fieldName !== "image") {
      fields[fieldName] = Buffer.from(content, "binary").toString("utf8").trim();
      continue;
    }

    const filename = headers.match(/filename="([^"]*)"/i)?.[1] || "upload";
    const mimeType = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "";

    upload = {
      originalFilename: path.basename(filename),
      mimeType,
      buffer: Buffer.from(content, "binary"),
      fields
    };
  }

  if (upload) {
    upload.fields = fields;
  }

  return upload;
}

function readPngSize(buffer) {
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  return {};
}

function readJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return {};
  }

  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);

    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }

    offset += 2 + length;
  }

  return {};
}

function readWebpSize(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return {};
  }

  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }

  if (chunk === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }

  if (chunk === "VP8L" && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    };
  }

  return {};
}

function readImageSize(buffer, mimeType) {
  if (mimeType === "image/png") {
    return readPngSize(buffer);
  }

  if (mimeType === "image/jpeg") {
    return readJpegSize(buffer);
  }

  if (mimeType === "image/webp") {
    return readWebpSize(buffer);
  }

  return {};
}

function parseBoolean(value) {
  return value === true || value === "true" || value === "on" || value === "yes";
}

function parseLinks(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }

  return String(value || "")
    .split(",")
    .map(cleanString)
    .filter(Boolean);
}

function isValidEmail(value) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidImageReference(value) {
  return /^\/[^\s]+/.test(value) || /^https?:\/\/[^\s]+$/i.test(value);
}

function isReadyUploadReference(content, value) {
  if (!value || !value.startsWith(`${uploadBasePath}/`)) {
    return true;
  }

  const media = findMediaByPath(content, value);
  return Boolean(media && media.status === "ready");
}

function isArtistAllowedImageReference(context, value) {
  if (!value || !value.startsWith(`${uploadBasePath}/`)) {
    return true;
  }

  const media = findMediaByPath(context.content, value);
  if (!media || media.status !== "ready") {
    return false;
  }

  if (media.ownerArtistId === context.artist.id) {
    return true;
  }

  const galleries = context.content.galleries.filter((gallery) => gallery.artistId === context.artist.id);
  const artwork = context.content.artwork.filter((item) => item.artistId === context.artist.id);
  return artistScopedMedia(context.content, context.artist, galleries, artwork)
    .some((item) => mediaContainsPath(item, value));
}

function hasValidStatus(value) {
  return validStatuses.has(value);
}

function hasValidInvitationStatus(value) {
  return validInvitationStatuses.has(value);
}

function hasValidInquiryStatus(value) {
  return validInquiryStatuses.has(value);
}

function hasValidArtistInvitationStatus(value) {
  return validArtistInvitationStatuses.has(value);
}

function generateId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function collectionNameFor(resource) {
  if (resource === "artwork") {
    return "artwork";
  }

  if (resource === "gallery") {
    return "galleries";
  }

  return "artists";
}

function publicArtistUrl(artist) {
  return artist.canonicalPath || `/${artist.slug}/`;
}

function validateArtist(input, content, existing) {
  const errors = [];
  const name = cleanString(input.name);
  const slug = cleanString(input.slug);
  const status = cleanString(input.status || "draft");
  const invitationStatus = cleanString(input.invitationStatus || "none");
  const contactEmail = cleanString(input.contactEmail);
  const heroImage = cleanString(input.heroImage);

  if (!name) {
    errors.push("Artist name is required.");
  }

  if (!slug) {
    errors.push("Artist slug is required.");
  }

  if (slug && content.artists.some((artist) => artist.id !== existing?.id && artist.slug === slug)) {
    errors.push("Artist slug must be unique.");
  }

  if (!hasValidStatus(status)) {
    errors.push("Artist status is not valid.");
  }

  if (!hasValidInvitationStatus(invitationStatus)) {
    errors.push("Invitation status is not valid.");
  }

  if (!isValidEmail(contactEmail)) {
    errors.push("Contact email is not valid.");
  }

  if (heroImage && (!isValidImageReference(heroImage) || !isReadyUploadReference(content, heroImage))) {
    errors.push("Hero image must be a ready uploaded image, existing image path, or image URL.");
  }

  return {
    errors,
    record: {
      id: existing?.id || generateId("artist"),
      name,
      slug,
      canonicalPath: existing?.canonicalPath || (slug === "carolyn-elaine" ? "/carolyn-elaine/" : `/${slug}/`),
      professionalTitle: cleanString(input.professionalTitle),
      city: cleanString(input.city),
      region: cleanString(input.region),
      country: cleanString(input.country),
      medium: cleanString(input.medium),
      category: cleanString(input.category),
      heroImage,
      shortDescription: cleanString(input.shortDescription),
      bio: cleanString(input.bio),
      contactEmail,
      website: cleanString(input.website),
      socialLinks: parseLinks(input.socialLinks),
      status,
      featured: parseBoolean(input.featured),
      invitationStatus,
      protected: Boolean(existing?.protected),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso()
    }
  };
}

function validateGallery(input, content, existing) {
  const errors = [];
  const title = cleanString(input.title);
  const slug = cleanString(input.slug);
  const artistId = cleanString(input.artistId);
  const status = cleanString(input.status || "draft");
  const artist = content.artists.find((item) => item.id === artistId);
  const coverImage = cleanString(input.coverImage);

  if (!title) {
    errors.push("Gallery title is required.");
  }

  if (!slug) {
    errors.push("Gallery slug is required.");
  }

  if (!artist) {
    errors.push("Associated artist is required.");
  }

  if (slug && artistId && content.galleries.some((gallery) => gallery.id !== existing?.id && gallery.artistId === artistId && gallery.slug === slug)) {
    errors.push("Gallery slug must be unique for the artist.");
  }

  if (!hasValidStatus(status)) {
    errors.push("Gallery status is not valid.");
  }

  if (coverImage && (!isValidImageReference(coverImage) || !isReadyUploadReference(content, coverImage))) {
    errors.push("Cover image must be a ready uploaded image, existing image path, or image URL.");
  }

  return {
    errors,
    record: {
      id: existing?.id || generateId("gallery"),
      artistId,
      title,
      slug,
      coverImage,
      description: cleanString(input.description),
      status,
      featured: parseBoolean(input.featured),
      displayOrder: Number(input.displayOrder || 0),
      protected: Boolean(existing?.protected),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso()
    }
  };
}

function validateArtwork(input, content, existing) {
  const errors = [];
  const title = cleanString(input.title);
  const artistId = cleanString(input.artistId);
  const galleryId = cleanString(input.galleryId);
  const image = cleanString(input.image);
  const status = cleanString(input.status || "draft");
  const artist = content.artists.find((item) => item.id === artistId);
  const gallery = content.galleries.find((item) => item.id === galleryId);

  if (!title) {
    errors.push("Artwork title is required.");
  }

  if (!artist) {
    errors.push("Associated artist is required.");
  }

  if (!gallery) {
    errors.push("Associated gallery is required.");
  }

  if (gallery && artist && gallery.artistId !== artist.id) {
    errors.push("Selected gallery must belong to the selected artist.");
  }

  if (!hasValidStatus(status)) {
    errors.push("Artwork status is not valid.");
  }

  if (status === "published" && (!isValidImageReference(image) || !isReadyUploadReference(content, image))) {
    errors.push("Published artwork requires an existing image path or image URL.");
  }

  if (image && !isReadyUploadReference(content, image)) {
    errors.push("Artwork image must be a ready uploaded image, existing image path, or image URL.");
  }

  return {
    errors,
    record: {
      id: existing?.id || generateId("artwork"),
      artistId,
      galleryId,
      title,
      image,
      alt: cleanString(input.alt),
      year: cleanString(input.year),
      location: cleanString(input.location),
      medium: cleanString(input.medium),
      dimensions: cleanString(input.dimensions),
      description: cleanString(input.description),
      displayOrder: Number(input.displayOrder || 0),
      status,
      protected: Boolean(existing?.protected),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso()
    }
  };
}

function upsertRecord(resource, input) {
  const content = loadContent();
  const collectionName = collectionNameFor(resource);
  const collection = content[collectionName];
  const existing = input.id ? collection.find((item) => item.id === input.id) : null;
  const validators = {
    artist: validateArtist,
    gallery: validateGallery,
    artwork: validateArtwork
  };
  const { errors, record } = validators[resource](input, content, existing);

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  if (existing) {
    const index = collection.findIndex((item) => item.id === existing.id);
    collection[index] = { ...existing, ...record, protected: existing.protected };
  } else {
    collection.push(record);
  }

  saveContent(content, `${resource}-save`);
  return {
    ok: true,
    statusCode: 200,
    message: `${resource[0].toUpperCase()}${resource.slice(1)} saved successfully.`,
    content
  };
}

function archiveRecord(resource, id) {
  const content = loadContent();
  const collectionName = collectionNameFor(resource);
  const collection = content[collectionName];
  const record = collection.find((item) => item.id === id);

  if (!record) {
    return { ok: false, statusCode: 404, message: "Record was not found." };
  }

  if (record.protected) {
    return { ok: false, statusCode: 403, message: "This seed record is protected and cannot be archived." };
  }

  record.status = "archived";
  record.featured = false;
  record.updatedAt = nowIso();
  saveContent(content, `${resource}-archive`);

  return {
    ok: true,
    statusCode: 200,
    message: "Record archived successfully.",
    content
  };
}

function isMediaInUse(content, publicPath) {
  const media = findMediaByPath(content, publicPath);
  const matches = (imagePath) => imagePath === publicPath || mediaContainsPath(media, imagePath);

  return content.artists.some((artist) => matches(artist.heroImage) || matches(artist.profileImage)) ||
    content.galleries.some((gallery) => matches(gallery.coverImage)) ||
    content.artwork.some((artwork) => matches(artwork.image));
}

function handleMediaUpload(request, response, options = {}) {
  collectBuffer(request, response, async (body) => {
    const contentForResponse = options.contentForResponse || ((content) => publicSafeContent(content));
    const upload = parseMultipartUpload(request, body);

    if (!upload || !upload.buffer.length) {
      sendJson(response, 400, { ok: false, message: "Choose an image file to upload." });
      return;
    }

    if (!allowedImageTypes.has(upload.mimeType) || !allowedImageTypes.has(detectImageMime(upload.buffer))) {
      sendJson(response, 422, { ok: false, message: "Unsupported file type. Upload JPG, PNG, or WebP images only." });
      return;
    }

    if (upload.buffer.length > maxUploadBytes) {
      sendJson(response, 413, { ok: false, message: "Image file is too large. Upload images up to 20 MB." });
      return;
    }

    const ownerArtistId = cleanString(options.ownerArtistId || upload.fields?.ownerArtistId);
    if (ownerArtistId && !loadContent().artists.some((artist) => artist.id === ownerArtistId)) {
      sendJson(response, 422, { ok: false, message: "Selected media owner was not found." });
      return;
    }

    const result = await processMediaUpload(upload, {
      uploadedBy: options.uploadedBy || "admin",
      ownerArtistId
    });

    if (!result.ok) {
      sendJson(response, 422, {
        ok: false,
        message: result.message,
        media: result.media,
        content: contentForResponse(result.content)
      });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      message: "Image uploaded and processed successfully.",
      media: result.media,
      content: contentForResponse(result.content)
    });
  });
}

function archiveMedia(id) {
  const content = loadContent();
  const media = content.media.find((item) => item.id === id);

  if (!media) {
    return { ok: false, statusCode: 404, message: "Media record was not found." };
  }

  if (isMediaInUse(content, media.publicPath)) {
    return { ok: false, statusCode: 409, message: "This image is currently assigned to a record. Remove it from records before archiving." };
  }

  media.status = "archived";
  media.updatedAt = nowIso();
  saveContent(content, "media-archive");

  return {
    ok: true,
    statusCode: 200,
    message: "Image archived successfully.",
    content
  };
}

function publishedArtistById(content, id) {
  return content.artists.find((artist) => artist.id === id && artist.status === "published") || null;
}

function publishedGalleryById(content, id) {
  return content.galleries.find((gallery) => gallery.id === id && gallery.status === "published") || null;
}

function publishedArtworkById(content, id) {
  return content.artwork.find((item) => item.id === id && item.status === "published") || null;
}

function inquiryContextFromInput(content, input) {
  let artistId = cleanString(input.artistId);
  let galleryId = cleanString(input.galleryId);
  let artworkId = cleanString(input.artworkId);
  let artist = null;
  let gallery = null;
  let artwork = null;

  if (artworkId) {
    artwork = publishedArtworkById(content, artworkId);
    if (!artwork) {
      return { errors: ["Selected artwork is not available for inquiry."] };
    }
    artistId = artwork.artistId;
    galleryId = artwork.galleryId;
  }

  if (galleryId) {
    gallery = publishedGalleryById(content, galleryId);
    if (!gallery) {
      return { errors: ["Selected gallery is not available for inquiry."] };
    }
    if (artwork && artwork.galleryId !== gallery.id) {
      return { errors: ["Selected artwork does not belong to this gallery."] };
    }
    artistId = gallery.artistId;
  }

  if (artistId) {
    artist = publishedArtistById(content, artistId);
    if (!artist) {
      return { errors: ["Selected artist is not available for inquiry."] };
    }
    if (gallery && gallery.artistId !== artist.id) {
      return { errors: ["Selected gallery does not belong to this artist."] };
    }
    if (artwork && artwork.artistId !== artist.id) {
      return { errors: ["Selected artwork does not belong to this artist."] };
    }
  }

  return { artist, gallery, artwork, artistId, galleryId, artworkId };
}

function sanitizePreferredContactMethod(value) {
  const method = cleanString(value).toLowerCase();
  return ["email", "phone", "either"].includes(method) ? method : "";
}

function validatePublicInquiry(content, input) {
  const errors = [];
  const name = cleanLimitedString(input.name, 120);
  const email = cleanLimitedString(input.email, 160).toLowerCase();
  const phone = cleanLimitedString(input.phone, 80);
  const message = cleanLimitedString(input.message, maxInquiryMessageLength);
  const preferredContactMethod = sanitizePreferredContactMethod(input.preferredContactMethod);
  const context = inquiryContextFromInput(content, input);

  if (context.errors) {
    errors.push(...context.errors);
  }

  if (!name) {
    errors.push("Name is required.");
  }

  if (!email) {
    errors.push("Email is required.");
  } else if (!isValidEmail(email)) {
    errors.push("Enter a valid email address.");
  }

  if (!message) {
    errors.push("Message is required.");
  } else if (message.length < 10) {
    errors.push("Message must be at least 10 characters.");
  }

  if (cleanString(input.message).length > maxInquiryMessageLength) {
    errors.push(`Message must be ${maxInquiryMessageLength} characters or less.`);
  }

  const inquiryType = context.artwork ? "artwork" : context.gallery ? "gallery" : context.artist ? "artist" : cleanString(input.inquiryType) || "general";

  return {
    errors,
    record: {
      id: generateId("inquiry"),
      inquiryType,
      artistId: context.artistId || "",
      galleryId: context.galleryId || "",
      artworkId: context.artworkId || "",
      sourceUrl: cleanLimitedString(input.sourceUrl, 500),
      visitorName: name,
      visitorEmail: email,
      visitorPhone: phone,
      message,
      preferredContactMethod,
      status: "new",
      assignedArtistId: context.artistId || "",
      assignedAdminId: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      internalNotes: "",
      sourceMetadata: {}
    }
  };
}

function parseInquiryPayload(request, response, callback) {
  collectBody(request, (body) => {
    const contentType = request.headers["content-type"] || "";
    let payload = {};

    try {
      if (contentType.includes("application/json")) {
        payload = body ? JSON.parse(body) : {};
      } else {
        payload = Object.fromEntries(new URLSearchParams(body));
      }
    } catch (error) {
      sendJson(response, 400, { ok: false, message: "Invalid request data." });
      return;
    }

    callback(payload);
  });
}

function handlePublicInquiry(request, response) {
  if (!rateLimitInquiry(request)) {
    sendJson(response, 429, { ok: false, message: "Please wait a few minutes before sending another inquiry." });
    return;
  }

  parseInquiryPayload(request, response, (input) => {
    if (cleanString(input.companyWebsite || input.website)) {
      sendJson(response, 200, { ok: true, message: "Thank you. Your inquiry has been received." });
      return;
    }

    const content = loadContent();
    const result = validatePublicInquiry(content, input);

    if (result.errors.length) {
      sendJson(response, 422, {
        ok: false,
        message: "Please fix the highlighted fields.",
        errors: result.errors
      });
      return;
    }

    result.record.sourceMetadata = {
      referrer: cleanLimitedString(request.headers.referer, 500),
      userAgent: cleanLimitedString(request.headers["user-agent"], 300)
    };

    content.inquiries.push(result.record);
    saveContent(content, "inquiry-create");
    sendJson(response, 200, {
      ok: true,
      message: "Thank you. Your inquiry has been received.",
      inquiryId: result.record.id
    });
  });
}

function inquiryBelongsToArtist(content, inquiry, artistId) {
  if (!inquiry || !artistId) {
    return false;
  }

  if (inquiry.artistId === artistId || inquiry.assignedArtistId === artistId) {
    return true;
  }

  const gallery = content.galleries.find((item) => item.id === inquiry.galleryId);
  const artwork = content.artwork.find((item) => item.id === inquiry.artworkId);
  return gallery?.artistId === artistId || artwork?.artistId === artistId;
}

function artistInquirySafe(inquiry) {
  return {
    id: inquiry.id,
    inquiryType: inquiry.inquiryType,
    artistId: inquiry.artistId,
    galleryId: inquiry.galleryId,
    artworkId: inquiry.artworkId,
    sourceUrl: inquiry.sourceUrl,
    visitorName: inquiry.visitorName,
    visitorEmail: inquiry.visitorEmail,
    visitorPhone: inquiry.visitorPhone,
    message: inquiry.message,
    preferredContactMethod: inquiry.preferredContactMethod,
    status: inquiry.status,
    createdAt: inquiry.createdAt,
    updatedAt: inquiry.updatedAt
  };
}

function artistScopedInquiries(content, artistId) {
  return (content.inquiries || [])
    .filter((inquiry) => inquiryBelongsToArtist(content, inquiry, artistId))
    .map(artistInquirySafe);
}

function updateInquiry(id, input, options = {}) {
  const content = loadContent();
  const inquiry = content.inquiries.find((item) => item.id === id);

  if (!inquiry) {
    return { ok: false, statusCode: 404, message: "Inquiry was not found." };
  }

  if (options.artistId && !inquiryBelongsToArtist(content, inquiry, options.artistId)) {
    return { ok: false, statusCode: 404, message: "Inquiry was not found." };
  }

  const status = cleanString(input.status || inquiry.status || "new");
  if (!hasValidInquiryStatus(status)) {
    return { ok: false, statusCode: 422, message: "Inquiry status is not valid." };
  }

  inquiry.status = status;
  inquiry.updatedAt = nowIso();

  if (options.admin) {
    inquiry.internalNotes = cleanLimitedString(input.internalNotes, 4000);
  }

  saveContent(content, "inquiry-update");
  return {
    ok: true,
    statusCode: 200,
    message: "Inquiry updated.",
    content
  };
}

function requestOrigin(request) {
  const proto = request.headers["x-forwarded-proto"] || (request.socket.encrypted ? "https" : "http");
  return `${proto}://${request.headers.host || "localhost"}`;
}

function invitationUrl(request, invitation) {
  return `${requestOrigin(request)}/invite/${encodeURIComponent(invitation.token)}`;
}

function slugify(value) {
  return String(value || "artist")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "artist";
}

function uniqueArtistSlug(content, value, existingId = "") {
  const base = slugify(value);
  let slug = base;
  let count = 2;

  while (content.artists.some((artist) => artist.id !== existingId && artist.slug === slug)) {
    slug = `${base}-${count}`;
    count += 1;
  }

  return slug;
}

function parseExpiration(value) {
  const raw = cleanString(value);
  if (!raw) {
    return futureIso(invitationDefaultDays);
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date.setHours(23, 59, 59, 999);
  }

  return date.toISOString();
}

function invitationIsExpired(invitation) {
  return Boolean(invitation?.expiresAt && new Date(invitation.expiresAt).getTime() < Date.now());
}

function refreshInvitationStatus(content, invitation) {
  if (invitation?.status === "pending" && invitationIsExpired(invitation)) {
    invitation.status = "expired";
    invitation.updatedAt = nowIso();
    saveContent(content, "invitation-expired");
  }

  return invitation;
}

function createDraftArtistForInvitation(content, input, email) {
  const name = cleanString(input.artistName);
  if (!name) {
    return "";
  }

  const now = nowIso();
  const slug = uniqueArtistSlug(content, name);
  const artist = {
    id: generateId("artist"),
    name,
    slug,
    canonicalPath: `/${slug}/`,
    professionalTitle: cleanString(input.professionalTitle),
    city: "",
    region: "",
    country: "",
    medium: "",
    category: "",
    heroImage: "",
    shortDescription: "",
    bio: "",
    contactEmail: email,
    website: "",
    socialLinks: [],
    status: "draft",
    featured: false,
    invitationStatus: "pending",
    protected: false,
    createdAt: now,
    updatedAt: now
  };

  content.artists.push(artist);
  return artist.id;
}

function createInvitation(input, session, request) {
  const content = loadContent();
  const errors = [];
  const email = cleanLimitedString(input.email, 160).toLowerCase();
  const expiresAt = parseExpiration(input.expiresAt);
  const now = nowIso();

  if (!email) {
    errors.push("Artist email is required.");
  } else if (!isValidEmail(email)) {
    errors.push("Enter a valid artist email.");
  }

  if (!expiresAt) {
    errors.push("Expiration date is not valid.");
  } else if (new Date(expiresAt).getTime() <= Date.now()) {
    errors.push("Expiration date must be in the future.");
  }

  if (email && content.invitations.some((invitation) =>
    invitation.email.toLowerCase() === email &&
    invitation.status === "pending" &&
    !invitationIsExpired(invitation)
  )) {
    errors.push("A pending invitation already exists for this email.");
  }

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  const artistId = createDraftArtistForInvitation(content, input, email);
  const invitation = {
    id: generateId("invitation"),
    email,
    artistId,
    invitedByAdminId: session?.email || adminEmail,
    token: generateInvitationToken(),
    status: "pending",
    createdAt: now,
    updatedAt: now,
    expiresAt,
    acceptedAt: "",
    revokedAt: "",
    notes: cleanLimitedString(input.notes, 1500)
  };

  content.invitations.push(invitation);
  saveContent(content, "invitation-create");
  return {
    ok: true,
    statusCode: 200,
    message: "Invitation created.",
    invitation,
    invitationUrl: invitationUrl(request, invitation),
    content
  };
}

function revokeInvitation(id) {
  const content = loadContent();
  const invitation = content.invitations.find((item) => item.id === id);

  if (!invitation) {
    return { ok: false, statusCode: 404, message: "Invitation was not found." };
  }

  if (invitation.status !== "pending") {
    return { ok: false, statusCode: 409, message: "Only pending invitations can be revoked." };
  }

  invitation.status = "revoked";
  invitation.revokedAt = nowIso();
  invitation.updatedAt = nowIso();
  saveContent(content, "invitation-revoke");
  return {
    ok: true,
    statusCode: 200,
    message: "Invitation revoked.",
    content
  };
}

function findInvitationByToken(content, token) {
  const cleanToken = cleanString(token);
  if (!cleanToken) {
    return null;
  }

  return content.invitations.find((invitation) => invitation.token === cleanToken) || null;
}

function hashArtistPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function validateInvitePassword(password, confirmPassword) {
  const errors = [];

  if (!password || password.length < 10) {
    errors.push("Password must be at least 10 characters.");
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    errors.push("Password must include at least one letter and one number.");
  }

  if (password !== confirmPassword) {
    errors.push("Password and confirmation must match.");
  }

  return errors;
}

function invitationUnavailableReason(invitation) {
  if (!invitation) {
    return "This invitation link was not found.";
  }

  if (invitation.status === "accepted") {
    return "This invitation has already been accepted.";
  }

  if (invitation.status === "revoked") {
    return "This invitation has been revoked.";
  }

  if (invitation.status === "expired") {
    return "This invitation has expired.";
  }

  return "";
}

function renderInvitePage(invitation, options = {}) {
  const artist = options.artist || {};
  const errors = options.errors || [];
  const unavailable = invitationUnavailableReason(invitation);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Artist Invitation | The Galleria.Art</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="admin-page admin-login-page invite-page">
  <main class="admin-login-shell invite-shell">
    <section class="admin-card admin-login-card invite-card" aria-labelledby="invite-title">
      <p class="section-kicker">Artist Invitation</p>
      <h1 id="invite-title">Join The Galleria.Art</h1>
      ${unavailable ? `
        <p class="admin-alert">${escapeHtml(unavailable)}</p>
        <a class="admin-return" href="/contact/">Contact The Galleria.Art</a>
      ` : `
        <p class="admin-muted">Invitation for ${escapeHtml(invitation.email)}. Set your password and confirm the basic artist profile details below.</p>
        ${errors.length ? `<div class="admin-message error"><strong>Please fix the highlighted fields.</strong><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></div>` : ""}
        <form class="admin-form invite-accept-form" action="/invite/${encodeURIComponent(invitation.token)}" method="post">
          <label>
            <span>Email</span>
            <input name="email" type="email" value="${escapeHtml(invitation.email)}" disabled>
          </label>
          <label>
            <span>Artist Name</span>
            <input name="artistName" value="${escapeHtml(options.input?.artistName ?? artist.name ?? "")}" required>
          </label>
          <label>
            <span>Professional Title</span>
            <input name="professionalTitle" value="${escapeHtml(options.input?.professionalTitle ?? artist.professionalTitle ?? "")}">
          </label>
          <label>
            <span>City</span>
            <input name="city" value="${escapeHtml(options.input?.city ?? artist.city ?? "")}">
          </label>
          <label>
            <span>State / Region</span>
            <input name="region" value="${escapeHtml(options.input?.region ?? artist.region ?? "")}">
          </label>
          <label>
            <span>Medium</span>
            <input name="medium" value="${escapeHtml(options.input?.medium ?? artist.medium ?? "")}">
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autocomplete="new-password" required>
          </label>
          <label>
            <span>Confirm Password</span>
            <input name="confirmPassword" type="password" autocomplete="new-password" required>
          </label>
          <button class="admin-submit home-button" type="submit">Accept Invitation</button>
        </form>
        <p class="admin-note">Passwords are stored as server-side hashes. Your profile will remain private until it is ready to publish.</p>
      `}
    </section>
  </main>
</body>
</html>`;
}

function sendInvitePage(request, response, token) {
  const content = loadContent();
  const invitation = refreshInvitationStatus(content, findInvitationByToken(content, token));
  const artist = invitation?.artistId ? content.artists.find((item) => item.id === invitation.artistId) : null;

  response.writeHead(invitation && !invitationUnavailableReason(invitation) ? 200 : 404, {
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(renderInvitePage(invitation, { artist }));
}

function acceptInvitation(request, response, token) {
  collectBody(request, (body) => {
    const input = Object.fromEntries(new URLSearchParams(body));
    const content = loadContent();
    const invitation = refreshInvitationStatus(content, findInvitationByToken(content, token));
    const unavailable = invitationUnavailableReason(invitation);

    if (unavailable) {
      response.writeHead(409, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderInvitePage(invitation));
      return;
    }

    const errors = validateInvitePassword(input.password || "", input.confirmPassword || "");
    const artistName = cleanLimitedString(input.artistName, 140);

    if (!artistName) {
      errors.push("Artist name is required.");
    }

    if (errors.length) {
      const artist = invitation.artistId ? content.artists.find((item) => item.id === invitation.artistId) : null;
      response.writeHead(422, { "Content-Type": "text/html; charset=utf-8" });
      response.end(renderInvitePage(invitation, { artist, errors, input }));
      return;
    }

    const now = nowIso();
    let artist = invitation.artistId ? content.artists.find((item) => item.id === invitation.artistId) : null;

    if (!artist) {
      const slug = uniqueArtistSlug(content, artistName);
      artist = {
        id: generateId("artist"),
        name: artistName,
        slug,
        canonicalPath: `/${slug}/`,
        professionalTitle: cleanLimitedString(input.professionalTitle, 140),
        city: cleanLimitedString(input.city, 90),
        region: cleanLimitedString(input.region, 90),
        country: "",
        medium: cleanLimitedString(input.medium, 140),
        category: "",
        heroImage: "",
        shortDescription: "",
        bio: "",
        contactEmail: invitation.email,
        website: "",
        socialLinks: [],
        status: "draft",
        featured: false,
        invitationStatus: "accepted",
        protected: false,
        createdAt: now,
        updatedAt: now
      };
      content.artists.push(artist);
      invitation.artistId = artist.id;
    } else {
      artist.name = artistName;
      artist.slug = artist.slug || uniqueArtistSlug(content, artistName, artist.id);
      artist.canonicalPath = artist.canonicalPath || `/${artist.slug}/`;
      artist.professionalTitle = cleanLimitedString(input.professionalTitle, 140);
      artist.city = cleanLimitedString(input.city, 90);
      artist.region = cleanLimitedString(input.region, 90);
      artist.medium = cleanLimitedString(input.medium, 140);
      artist.contactEmail = artist.contactEmail || invitation.email;
      artist.status = artist.status === "published" ? "published" : "draft";
      artist.invitationStatus = "accepted";
      artist.updatedAt = now;
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashArtistPassword(input.password || "", salt);
    let account = content.artistAccounts.find((item) => item.email.toLowerCase() === invitation.email.toLowerCase());

    if (!account) {
      account = {
        id: generateId("artist-account"),
        artistId: artist.id,
        email: invitation.email,
        passwordHash,
        passwordSalt: salt,
        status: "active",
        demo: false,
        createdAt: now,
        updatedAt: now,
        acceptedAt: now,
        lastLoginAt: now
      };
      content.artistAccounts.push(account);
    } else {
      account.artistId = artist.id;
      account.passwordHash = passwordHash;
      account.passwordSalt = salt;
      account.status = "active";
      account.acceptedAt = account.acceptedAt || now;
      account.lastLoginAt = now;
      account.updatedAt = now;
    }

    invitation.status = "accepted";
    invitation.acceptedAt = now;
    invitation.updatedAt = now;
    saveContent(content, "invitation-accept");
    redirect(response, "/artist/", 303, {
      "Set-Cookie": createArtistSessionCookie(account, request)
    });
  });
}

function recordTitle(record, type) {
  if (type === "artist") {
    return record.name || "Artist profile";
  }

  return record.title || "Untitled";
}

function collectionForReviewType(content, type) {
  if (type === "artist") {
    return content.artists;
  }

  if (type === "gallery") {
    return content.galleries;
  }

  if (type === "artwork") {
    return content.artwork;
  }

  return null;
}

function findReviewRecord(content, type, id) {
  const collection = collectionForReviewType(content, type);
  return collection?.find((item) => item.id === id) || null;
}

function reviewRecordArtistId(record, type) {
  return type === "artist" ? record?.id : record?.artistId;
}

function recordStatusHistory(content, type, record, previousStatus, newStatus, changedBy, note = "") {
  content.statusHistory.push({
    id: generateId("status-history"),
    recordType: type,
    recordId: record.id,
    previousStatus: previousStatus || "",
    newStatus,
    changedBy,
    note: cleanLimitedString(note, 1500),
    createdAt: nowIso()
  });
}

function transitionReviewRecord(content, type, record, nextStatus, changedBy, note = "", patch = {}) {
  const previousStatus = record.status || "draft";
  record.status = nextStatus;
  record.updatedAt = nowIso();
  Object.assign(record, patch);
  recordStatusHistory(content, type, record, previousStatus, nextStatus, changedBy, note);
}

function reviewQueueItems(content) {
  const items = [];

  ["artist", "gallery", "artwork"].forEach((type) => {
    const collection = collectionForReviewType(content, type) || [];
    collection.forEach((record) => {
      if (["pending_review", "changes_requested", "approved"].includes(record.status)) {
        items.push({
          id: `${type}:${record.id}`,
          type,
          recordId: record.id,
          artistId: reviewRecordArtistId(record, type),
          title: recordTitle(record, type),
          status: record.status,
          submittedAt: record.submittedAt || record.updatedAt || record.createdAt,
          artistReviewNote: record.artistReviewNote || "",
          adminReviewNote: record.adminReviewNote || ""
        });
      }
    });
  });

  return items.sort((left, right) => String(right.submittedAt || "").localeCompare(String(left.submittedAt || "")));
}

function submitReviewRecord(context, type, id, input) {
  const content = loadContent();
  const record = findReviewRecord(content, type, id);

  if (!record || reviewRecordArtistId(record, type) !== context.artist.id) {
    return { ok: false, statusCode: 404, message: "Record was not found." };
  }

  if (record.protected) {
    return { ok: false, statusCode: 403, message: "This record cannot be submitted from the artist portal." };
  }

  if (record.status === "archived") {
    return { ok: false, statusCode: 409, message: "Archived records cannot be submitted for review." };
  }

  const now = nowIso();
  transitionReviewRecord(content, type, record, "pending_review", context.account.email, input.note || "", {
    submittedAt: now,
    submittedByArtistId: context.artist.id,
    artistReviewNote: cleanLimitedString(input.note, 1500),
    adminReviewNote: ""
  });

  saveContent(content, "review-submit");
  return {
    ok: true,
    statusCode: 200,
    message: "Submitted for review.",
    content
  };
}

function adminReviewRecord(type, id, input, session) {
  const content = loadContent();
  const record = findReviewRecord(content, type, id);
  const action = cleanString(input.action || input.status);
  const note = cleanLimitedString(input.note || input.adminReviewNote, 1500);
  const allowed = new Set(["approved", "published", "changes_requested", "archived"]);

  if (!record) {
    return { ok: false, statusCode: 404, message: "Review record was not found." };
  }

  if (record.protected) {
    return { ok: false, statusCode: 403, message: "This protected record cannot be changed through review." };
  }

  if (!allowed.has(action)) {
    return { ok: false, statusCode: 422, message: "Review action is not valid." };
  }

  const now = nowIso();
  transitionReviewRecord(content, type, record, action, session?.email || adminEmail, note, {
    reviewedAt: now,
    reviewedByAdminId: session?.email || adminEmail,
    adminReviewNote: note,
    reviewUpdatedAt: now
  });

  saveContent(content, "review-admin-action");
  return {
    ok: true,
    statusCode: 200,
    message: action === "changes_requested" ? "Changes requested." : `Record marked ${action}.`,
    content
  };
}

function verifyArtistPassword(password, account) {
  if (!account?.passwordHash || !account?.passwordSalt) {
    return false;
  }

  const hash = crypto.scryptSync(password, account.passwordSalt, 64).toString("hex");
  return safeCompare(hash, account.passwordHash);
}

function publicSafeContent(content) {
  return {
    ...content,
    artistAccounts: (content.artistAccounts || []).map((account) => ({
      id: account.id,
      artistId: account.artistId,
      email: account.email,
      status: account.status,
      demo: Boolean(account.demo),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      acceptedAt: account.acceptedAt,
      lastLoginAt: account.lastLoginAt
    }))
  };
}

function getArtistContext(request) {
  const session = getArtistSession(request);
  if (!session?.artistId || session.role !== "artist") {
    return null;
  }

  const content = loadContent();
  const account = content.artistAccounts.find((item) =>
    item.artistId === session.artistId &&
    item.email === session.email &&
    item.status !== "archived"
  );
  const artist = content.artists.find((item) => item.id === session.artistId);

  if (!account || !artist) {
    return null;
  }

  return { account, artist, content };
}

function artistScopedMedia(content, artist, galleries, artwork) {
  const paths = new Set([
    artist.heroImage,
    artist.profileImage,
    ...galleries.map((gallery) => gallery.coverImage),
    ...artwork.map((item) => item.image)
  ].filter(Boolean));
  const mediaRecords = content.media.filter((media) =>
    media.ownerArtistId === artist.id ||
    [...paths].some((imagePath) => mediaContainsPath(media, imagePath))
  );

  paths.forEach((publicPath) => {
    if (!mediaRecords.some((media) => mediaContainsPath(media, publicPath))) {
      mediaRecords.push({
        id: `referenced-${crypto.createHash("sha1").update(publicPath).digest("hex").slice(0, 12)}`,
        originalFilename: path.basename(publicPath),
        storedFilename: path.basename(publicPath),
        publicPath,
        mimeType: mimeTypes[path.extname(publicPath).toLowerCase()] || "image",
        size: null,
        width: null,
        height: null,
        uploadedAt: null,
        status: "referenced"
      });
    }
  });

  return mediaRecords;
}

function buildArtistPortalContent(context) {
  const galleries = context.content.galleries
    .filter((gallery) => gallery.artistId === context.artist.id)
    .sort(sortByDisplayOrder);
  const galleryIds = new Set(galleries.map((gallery) => gallery.id));
  const artwork = context.content.artwork
    .filter((item) => item.artistId === context.artist.id && galleryIds.has(item.galleryId))
    .sort(sortByDisplayOrder);
  const ownedIds = new Set([
    context.artist.id,
    ...galleries.map((gallery) => gallery.id),
    ...artwork.map((item) => item.id)
  ]);

  return {
    account: {
      email: context.account.email,
      demo: Boolean(context.account.demo),
      status: context.account.status,
      acceptedAt: context.account.acceptedAt,
      lastLoginAt: context.account.lastLoginAt
    },
    artist: context.artist,
    galleries,
    artwork,
    media: artistScopedMedia(context.content, context.artist, galleries, artwork),
    inquiries: artistScopedInquiries(context.content, context.artist.id),
    statusHistory: context.content.statusHistory.filter((entry) => ownedIds.has(entry.recordId))
  };
}

function sendArtistPortalContent(response, context) {
  sendJson(response, 200, {
    ok: true,
    content: buildArtistPortalContent(context)
  });
}

function requireArtistForApi(request, response) {
  const context = getArtistContext(request);

  if (context) {
    return context;
  }

  sendJson(response, 401, { ok: false, message: "Artist login required." });
  return null;
}

function handleArtistLogin(request, response) {
  collectBody(request, (body) => {
    const form = new URLSearchParams(body);
    const email = (form.get("email") || "").trim().toLowerCase();
    const password = form.get("password") || "";
    const content = loadContent();
    const account = content.artistAccounts.find((item) =>
      item.email.toLowerCase() === email &&
      item.status !== "archived"
    );

    if (account && verifyArtistPassword(password, account)) {
      account.lastLoginAt = nowIso();
      account.updatedAt = nowIso();
      saveContent(content, "artist-login");
      redirect(response, "/artist/", 303, {
        "Set-Cookie": createArtistSessionCookie(account, request)
      });
      return;
    }

    redirect(response, "/artist/login/?error=1");
  });
}

function updateArtistProfile(context, input) {
  const content = context.content;
  const artist = content.artists.find((item) => item.id === context.artist.id);
  const errors = [];
  const contactEmail = cleanString(input.contactEmail);
  const heroImage = cleanString(input.heroImage);

  if (!cleanString(input.name)) {
    errors.push("Artist name is required.");
  }

  if (!isValidEmail(contactEmail)) {
    errors.push("Contact email is not valid.");
  }

  if (heroImage && (!isValidImageReference(heroImage) || !isArtistAllowedImageReference(context, heroImage))) {
    errors.push("Hero image must be a ready uploaded image, existing image path, or image URL.");
  }

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  Object.assign(artist, {
    name: cleanString(input.name),
    professionalTitle: cleanString(input.professionalTitle),
    city: cleanString(input.city),
    region: cleanString(input.region),
    country: cleanString(input.country),
    medium: cleanString(input.medium),
    category: cleanString(input.category),
    heroImage,
    shortDescription: cleanString(input.shortDescription),
    bio: cleanString(input.bio),
    website: cleanString(input.website),
    contactEmail,
    socialLinks: parseLinks(input.socialLinks),
    status: ["published", "approved"].includes(artist.status) ? "draft" : artist.status,
    adminReviewNote: "",
    updatedAt: nowIso()
  });

  saveContent(content, "artist-profile-save");
  return { ok: true, statusCode: 200, message: "Profile saved.", context: { ...context, artist, content } };
}

function updateArtistGallery(context, id, input) {
  const content = context.content;
  const gallery = content.galleries.find((item) => item.id === id && item.artistId === context.artist.id);
  const errors = [];

  if (!gallery) {
    return { ok: false, statusCode: 404, message: "Gallery was not found." };
  }

  if (!cleanString(input.title)) {
    errors.push("Gallery title is required.");
  }

  const coverImage = cleanString(input.coverImage);
  if (coverImage && (!isValidImageReference(coverImage) || !isArtistAllowedImageReference(context, coverImage))) {
    errors.push("Cover image must be a ready uploaded image, existing image path, or image URL.");
  }

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  Object.assign(gallery, {
    title: cleanString(input.title),
    description: cleanString(input.description),
    coverImage,
    status: ["published", "approved"].includes(gallery.status) ? "draft" : gallery.status,
    adminReviewNote: "",
    displayOrder: Number(input.displayOrder || 0),
    updatedAt: nowIso()
  });

  saveContent(content, "artist-gallery-save");
  return { ok: true, statusCode: 200, message: "Gallery saved.", context: { ...context, content } };
}

function updateArtistArtwork(context, id, input) {
  const content = context.content;
  const artwork = content.artwork.find((item) => item.id === id && item.artistId === context.artist.id);
  const ownGallery = content.galleries.find((gallery) =>
    gallery.id === cleanString(input.galleryId || artwork?.galleryId) &&
    gallery.artistId === context.artist.id
  );
  const errors = [];

  if (!artwork) {
    return { ok: false, statusCode: 404, message: "Artwork was not found." };
  }

  if (!ownGallery) {
    errors.push("Selected gallery must belong to this artist.");
  }

  if (!cleanString(input.title)) {
    errors.push("Artwork title is required.");
  }

  const image = cleanString(input.image);
  if (image && (!isValidImageReference(image) || !isArtistAllowedImageReference(context, image))) {
    errors.push("Artwork image must be a ready uploaded image, existing image path, or image URL.");
  }

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  Object.assign(artwork, {
    galleryId: ownGallery.id,
    title: cleanString(input.title),
    image,
    alt: cleanString(input.alt),
    year: cleanString(input.year),
    location: cleanString(input.location),
    medium: cleanString(input.medium),
    dimensions: cleanString(input.dimensions),
    description: cleanString(input.description),
    status: ["published", "approved"].includes(artwork.status) ? "draft" : artwork.status,
    adminReviewNote: "",
    displayOrder: Number(input.displayOrder || 0),
    updatedAt: nowIso()
  });

  saveContent(content, "artist-artwork-save");
  return { ok: true, statusCode: 200, message: "Artwork saved.", context: { ...context, content } };
}

function handleArtistApi(request, response, pathname) {
  const context = requireArtistForApi(request, response);
  if (!context) {
    return;
  }

  if (request.method === "GET" && pathname === "/artist/api/content") {
    sendArtistPortalContent(response, context);
    return;
  }

  if (request.method === "POST" && pathname === "/artist/api/media/upload") {
    handleMediaUpload(request, response, {
      uploadedBy: "artist",
      ownerArtistId: context.artist.id,
      contentForResponse: (content) => buildArtistPortalContent({ ...context, content })
    });
    return;
  }

  if (request.method === "POST" && pathname === "/artist/api/profile") {
    collectJson(request, response, (input) => {
      const result = updateArtistProfile(context, input);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        errors: result.errors || [],
        content: result.context ? buildArtistPortalContent(result.context) : buildArtistPortalContent(context)
      });
    });
    return;
  }

  const galleryMatch = pathname.match(/^\/artist\/api\/galleries\/([^/]+)$/);
  if (request.method === "POST" && galleryMatch) {
    collectJson(request, response, (input) => {
      const result = updateArtistGallery(context, decodeURIComponent(galleryMatch[1]), input);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        errors: result.errors || [],
        content: result.context ? buildArtistPortalContent(result.context) : buildArtistPortalContent(context)
      });
    });
    return;
  }

  const artworkMatch = pathname.match(/^\/artist\/api\/artwork\/([^/]+)$/);
  if (request.method === "POST" && artworkMatch) {
    collectJson(request, response, (input) => {
      const result = updateArtistArtwork(context, decodeURIComponent(artworkMatch[1]), input);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        errors: result.errors || [],
        content: result.context ? buildArtistPortalContent(result.context) : buildArtistPortalContent(context)
      });
    });
    return;
  }

  const inquiryMatch = pathname.match(/^\/artist\/api\/inquiries\/([^/]+)$/);
  if (request.method === "POST" && inquiryMatch) {
    collectJson(request, response, (input) => {
      const result = updateInquiry(decodeURIComponent(inquiryMatch[1]), input, { artistId: context.artist.id });
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        content: result.content ? buildArtistPortalContent({ ...context, content: result.content }) : buildArtistPortalContent(context)
      });
    });
    return;
  }

  const reviewSubmitMatch = pathname.match(/^\/artist\/api\/review\/(artist|gallery|artwork)\/([^/]+)\/submit$/);
  if (request.method === "POST" && reviewSubmitMatch) {
    collectJson(request, response, (input) => {
      const type = reviewSubmitMatch[1];
      const id = type === "artist" ? context.artist.id : decodeURIComponent(reviewSubmitMatch[2]);
      const result = submitReviewRecord(context, type, id, input);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        content: result.content ? buildArtistPortalContent({ ...context, content: result.content }) : buildArtistPortalContent(context)
      });
    });
    return;
  }

  sendJson(response, 404, { ok: false, message: "Artist endpoint was not found." });
}

function requireAdminForApi(request, response) {
  if (getSession(request)) {
    return true;
  }

  sendJson(response, 401, { ok: false, message: "Unauthorized access. Please log in again." });
  return false;
}

function handleAdminApi(request, response, pathname) {
  if (!requireAdminForApi(request, response)) {
    return;
  }
  const adminSession = getSession(request);

  if (request.method === "GET" && pathname === "/admin/api/content") {
    sendJson(response, 200, { ok: true, content: publicSafeContent(loadContent()) });
    return;
  }

  if (request.method === "POST" && pathname === "/admin/api/media/upload") {
    handleMediaUpload(request, response, { uploadedBy: "admin" });
    return;
  }

  const saveMatch = pathname.match(/^\/admin\/api\/(artists|galleries|artwork)$/);
  if (request.method === "POST" && saveMatch) {
    const resource = saveMatch[1] === "artists" ? "artist" : saveMatch[1] === "galleries" ? "gallery" : "artwork";
    collectJson(request, response, (input) => {
      const result = upsertRecord(resource, input);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        errors: result.errors || [],
        content: publicSafeContent(result.content || loadContent())
      });
    });
    return;
  }

  const archiveMatch = pathname.match(/^\/admin\/api\/(artists|galleries|artwork)\/([^/]+)\/archive$/);
  if (request.method === "POST" && archiveMatch) {
    const resource = archiveMatch[1] === "artists" ? "artist" : archiveMatch[1] === "galleries" ? "gallery" : "artwork";
    const result = archiveRecord(resource, decodeURIComponent(archiveMatch[2]));
    sendJson(response, result.statusCode, {
      ok: result.ok,
      message: result.message,
      content: publicSafeContent(result.content || loadContent())
    });
    return;
  }

  const mediaArchiveMatch = pathname.match(/^\/admin\/api\/media\/([^/]+)\/archive$/);
  if (request.method === "POST" && mediaArchiveMatch) {
    const result = archiveMedia(decodeURIComponent(mediaArchiveMatch[1]));
    sendJson(response, result.statusCode, {
      ok: result.ok,
      message: result.message,
      content: publicSafeContent(result.content || loadContent())
    });
    return;
  }

  const inquiryMatch = pathname.match(/^\/admin\/api\/inquiries\/([^/]+)$/);
  if (request.method === "POST" && inquiryMatch) {
    collectJson(request, response, (input) => {
      const result = updateInquiry(decodeURIComponent(inquiryMatch[1]), input, { admin: true });
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        content: publicSafeContent(result.content || loadContent())
      });
    });
    return;
  }

  if (request.method === "POST" && pathname === "/admin/api/invitations") {
    collectJson(request, response, (input) => {
      const result = createInvitation(input, adminSession, request);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        errors: result.errors || [],
        invitationUrl: result.invitationUrl || "",
        invitation: result.invitation || null,
        content: publicSafeContent(result.content || loadContent())
      });
    });
    return;
  }

  const invitationRevokeMatch = pathname.match(/^\/admin\/api\/invitations\/([^/]+)\/revoke$/);
  if (request.method === "POST" && invitationRevokeMatch) {
    const result = revokeInvitation(decodeURIComponent(invitationRevokeMatch[1]));
    sendJson(response, result.statusCode, {
      ok: result.ok,
      message: result.message,
      content: publicSafeContent(result.content || loadContent())
    });
    return;
  }

  const reviewActionMatch = pathname.match(/^\/admin\/api\/review\/(artist|gallery|artwork)\/([^/]+)$/);
  if (request.method === "POST" && reviewActionMatch) {
    collectJson(request, response, (input) => {
      const result = adminReviewRecord(reviewActionMatch[1], decodeURIComponent(reviewActionMatch[2]), input, adminSession);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        content: publicSafeContent(result.content || loadContent())
      });
    });
    return;
  }

  sendJson(response, 404, { ok: false, message: "Admin endpoint was not found." });
}

function sendPreviewPage(response, artist) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(renderPublicArtistPage(artist).replace("</body>", '<div class="preview-ribbon">Private Preview</div></body>'));
}

function sendAdminPreview(request, response, artistId) {
  if (!getSession(request)) {
    redirect(response, "/admin/login/", 302);
    return;
  }

  const content = loadContent();
  const artist = content.artists.find((item) => item.id === artistId);
  if (!artist || artist.status === "archived") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Preview not found");
    return;
  }

  sendPreviewPage(response, previewContentWithArtist(content, artist));
}

function sendArtistPreview(request, response) {
  const context = getArtistContext(request);
  if (!context) {
    redirect(response, "/artist/login/", 302);
    return;
  }

  if (context.artist.status === "archived") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Preview not found");
    return;
  }

  sendPreviewPage(response, previewContentWithArtist(context.content, context.artist));
}

function handleLogin(request, response) {
  collectBody(request, (body) => {
    const form = new URLSearchParams(body);
    const email = (form.get("email") || "").trim().toLowerCase();
    const password = form.get("password") || "";

    if (email === adminEmail.toLowerCase() && verifyPassword(password)) {
      redirect(response, "/admin/", 303, {
        "Set-Cookie": createSessionCookie(adminEmail, request)
      });
      return;
    }

    redirect(response, "/admin/login/?error=1");
  });
}

function handleStatic(request, response, pathname) {
  let requestedPath;

  try {
    requestedPath = decodeURIComponent(pathname);
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
  const normalizedPath = path.normalize(relativePath);
  const absolutePath = path.join(publicDir, normalizedPath);

  if (absolutePath !== publicDir && !absolutePath.startsWith(`${publicDir}${path.sep}`)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.stat(absolutePath, (error, stats) => {
    if (!error && stats.isDirectory()) {
      sendFile(response, path.join(absolutePath, "index.html"));
      return;
    }

    sendFile(response, absolutePath);
  });
}

function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  if (["/CarolynElaine", "/CarolynElaine/", "/carolynelaine", "/carolynelaine/"].includes(pathname)) {
    redirect(response, "/carolyn-elaine/", 301);
    return;
  }

  if (request.method === "GET" && pathname === "/gallery-data.js") {
    sendPublicGalleryData(response);
    return;
  }

  if (request.method === "GET" && pathname.startsWith(`${uploadBasePath}/`)) {
    serveUploadedMedia(response, pathname);
    return;
  }

  if (pathname === "/admin") {
    redirect(response, "/admin/", 301);
    return;
  }

  if (pathname === "/artist") {
    redirect(response, "/artist/", 301);
    return;
  }

  if (pathname.startsWith("/admin/api/")) {
    handleAdminApi(request, response, pathname);
    return;
  }

  if (pathname.startsWith("/artist/api/")) {
    handleArtistApi(request, response, pathname);
    return;
  }

  if (request.method === "POST" && pathname === "/admin/login") {
    handleLogin(request, response);
    return;
  }

  if (request.method === "POST" && pathname === "/artist/login") {
    handleArtistLogin(request, response);
    return;
  }

  if (pathname === "/admin/login") {
    redirect(response, "/admin/login/", 301);
    return;
  }

  if (pathname === "/artist/login") {
    redirect(response, "/artist/login/", 301);
    return;
  }

  if (request.method === "POST" && pathname === "/admin/logout") {
    redirect(response, "/admin/login/", 303, { "Set-Cookie": clearSessionCookie() });
    return;
  }

  if (request.method === "POST" && pathname === "/artist/logout") {
    redirect(response, "/artist/login/", 303, { "Set-Cookie": clearSessionCookie(artistSessionCookieName) });
    return;
  }

  if (request.method === "POST" && pathname === "/api/inquiries") {
    handlePublicInquiry(request, response);
    return;
  }

  const inviteMatch = pathname.match(/^\/invite\/([^/]+)\/?$/);
  if (inviteMatch && request.method === "GET") {
    sendInvitePage(request, response, decodeURIComponent(inviteMatch[1]));
    return;
  }

  if (inviteMatch && request.method === "POST") {
    acceptInvitation(request, response, decodeURIComponent(inviteMatch[1]));
    return;
  }

  const adminPreviewMatch = pathname.match(/^\/admin\/preview\/artist\/([^/]+)\/?$/);
  if (adminPreviewMatch && request.method === "GET") {
    sendAdminPreview(request, response, decodeURIComponent(adminPreviewMatch[1]));
    return;
  }

  if (pathname === "/artist/preview/" && request.method === "GET") {
    sendArtistPreview(request, response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  if (pathname.startsWith("/admin/") && !pathname.startsWith("/admin/login/")) {
    protectAdminRoute(request, response, pathname);
    return;
  }

  if (pathname.startsWith("/artist/") && !pathname.startsWith("/artist/login/")) {
    protectArtistRoute(request, response, pathname);
    return;
  }

  if (request.method === "GET" && sendPublicArtistPage(response, pathname)) {
    return;
  }

  handleStatic(request, response, pathname);
}

ensureContentStore();

http.createServer(handleRequest).listen(port, () => {
  console.log(`The Galleria.Art is serving on port ${port}`);
});
