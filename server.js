const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URLSearchParams } = require("url");

const publicDir = path.join(__dirname, "public");
const seedPath = path.join(__dirname, "seed-content.json");
const dataDir = process.env.DATA_DIR || path.join(__dirname, "content-data");
const dataFile = process.env.CONTENT_DATA_FILE || path.join(dataDir, "content.json");
const mediaDir = process.env.MEDIA_DIR || path.join(dataDir, "media");
const uploadBasePath = "/uploads";
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024);
const port = Number(process.env.PORT || 80);
const adminEmail = process.env.ADMIN_EMAIL || "mc@25mprinting.com";
const passwordSalt = process.env.ADMIN_PASSWORD_SALT || "galleria-admin-bootstrap-v1";
const passwordHash = process.env.ADMIN_PASSWORD_HASH ||
  "61a567bd15cf8240b460bb5199b408e73bf6fea3f93d529075a56be811e0b3d9eeb280e43bf340411d87355f2fc85a0dc23765e5644062cdcc875f738ea53ec2";
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const sessionCookieName = "galleria_admin";
const sessionMaxAgeSeconds = 60 * 60 * 8;
const validStatuses = new Set(["draft", "published", "archived"]);
const validInvitationStatuses = new Set(["current", "invited", "pending", "none"]);
const allowedImageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

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

function createSessionCookie(email, request) {
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Date.now() + sessionMaxAgeSeconds * 1000
  })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const secure = isSecureRequest(request) ? "; Secure" : "";

  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}${secure}`;
}

function clearSessionCookie() {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getSession(request) {
  const token = parseCookies(request)[sessionCookieName];

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

function readSeedContent() {
  return JSON.parse(fs.readFileSync(seedPath, "utf8"));
}

function normalizeContent(content) {
  return {
    version: 1,
    artists: Array.isArray(content.artists) ? content.artists : [],
    galleries: Array.isArray(content.galleries) ? content.galleries : [],
    artwork: Array.isArray(content.artwork) ? content.artwork : [],
    media: Array.isArray(content.media) ? content.media : []
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

  ["artists", "galleries", "artwork", "media"].forEach((collection) => {
    (seed[collection] || []).forEach((seedRecord) => {
      if (!content[collection].some((record) => record.id === seedRecord.id)) {
        content[collection].push(clone(seedRecord));
        changed = true;
      }
    });
  });

  return changed;
}

function ensureContentStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });
  const seed = normalizeContent(readSeedContent());

  if (!fs.existsSync(dataFile)) {
    writeContent(seed);
    return;
  }

  const content = normalizeContent(JSON.parse(fs.readFileSync(dataFile, "utf8")));
  if (mergeMissingSeedRecords(content, seed)) {
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

function buildPublicData(content) {
  const artists = content.artists
    .filter((artist) => artist.status === "published")
    .map((artist) => {
      const galleries = content.galleries
        .filter((gallery) => gallery.artistId === artist.id && gallery.status === "published")
        .sort(sortByDisplayOrder)
        .map((gallery) => ({
          ...gallery,
          artworks: content.artwork
            .filter((artwork) => artwork.galleryId === gallery.id && artwork.status === "published")
            .sort(sortByDisplayOrder)
        }));

      return { ...artist, galleries };
    })
    .filter((artist) => artist.galleries.length);

  return { artists };
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

function sanitizeFilename(filename) {
  const parsed = path.parse(String(filename || "upload"));
  const safeBase = parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "upload";

  return safeBase;
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

  for (const part of parts) {
    if (!part.includes("Content-Disposition") || !part.includes('name="image"')) {
      continue;
    }

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) {
      continue;
    }

    const headers = part.slice(0, headerEnd);
    let content = part.slice(headerEnd + 4);
    content = content.replace(/\r\n--$/, "").replace(/\r\n$/, "");

    const filename = headers.match(/filename="([^"]*)"/i)?.[1] || "upload";
    const mimeType = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim().toLowerCase() || "";

    return {
      originalFilename: path.basename(filename),
      mimeType,
      buffer: Buffer.from(content, "binary")
    };
  }

  return null;
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

function hasValidStatus(value) {
  return validStatuses.has(value);
}

function hasValidInvitationStatus(value) {
  return validInvitationStatuses.has(value);
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
    errors.push("Artist status must be published, draft, or archived.");
  }

  if (!hasValidInvitationStatus(invitationStatus)) {
    errors.push("Invitation status is not valid.");
  }

  if (!isValidEmail(contactEmail)) {
    errors.push("Contact email is not valid.");
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
      heroImage: cleanString(input.heroImage),
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
    errors.push("Gallery status must be published, draft, or archived.");
  }

  return {
    errors,
    record: {
      id: existing?.id || generateId("gallery"),
      artistId,
      title,
      slug,
      coverImage: cleanString(input.coverImage),
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
    errors.push("Artwork status must be published, draft, or archived.");
  }

  if (status === "published" && !isValidImageReference(image)) {
    errors.push("Published artwork requires an existing image path or image URL.");
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
  return content.artists.some((artist) => artist.heroImage === publicPath || artist.profileImage === publicPath) ||
    content.galleries.some((gallery) => gallery.coverImage === publicPath) ||
    content.artwork.some((artwork) => artwork.image === publicPath);
}

function handleMediaUpload(request, response) {
  collectBuffer(request, response, (body) => {
    const upload = parseMultipartUpload(request, body);

    if (!upload || !upload.buffer.length) {
      sendJson(response, 400, { ok: false, message: "Choose an image file to upload." });
      return;
    }

    if (!allowedImageTypes.has(upload.mimeType)) {
      sendJson(response, 422, { ok: false, message: "Unsupported file type. Upload JPG, PNG, or WebP images only." });
      return;
    }

    if (upload.buffer.length > maxUploadBytes) {
      sendJson(response, 413, { ok: false, message: "Image file is too large." });
      return;
    }

    const content = loadContent();
    fs.mkdirSync(mediaDir, { recursive: true });

    const mediaId = generateId("media");
    const extension = allowedImageTypes.get(upload.mimeType);
    const safeBase = sanitizeFilename(upload.originalFilename);
    const storedFilename = `${safeBase}-${mediaId.replace("media-", "").slice(0, 12)}${extension}`;
    const absolutePath = path.join(mediaDir, storedFilename);

    if (!absolutePath.startsWith(`${mediaDir}${path.sep}`)) {
      sendJson(response, 400, { ok: false, message: "Invalid upload path." });
      return;
    }

    if (fs.existsSync(absolutePath)) {
      sendJson(response, 409, { ok: false, message: "A file with that generated name already exists. Please try again." });
      return;
    }

    const size = readImageSize(upload.buffer, upload.mimeType);
    fs.writeFileSync(absolutePath, upload.buffer);

    const record = {
      id: mediaId,
      originalFilename: upload.originalFilename,
      storedFilename,
      publicPath: `${uploadBasePath}/${storedFilename}`,
      mimeType: upload.mimeType,
      size: upload.buffer.length,
      width: size.width || null,
      height: size.height || null,
      uploadedAt: nowIso(),
      updatedAt: nowIso(),
      status: "published"
    };

    content.media.push(record);
    saveContent(content, "media-upload");
    sendJson(response, 200, {
      ok: true,
      message: "Image uploaded successfully.",
      media: record,
      content
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

  if (request.method === "GET" && pathname === "/admin/api/content") {
    sendJson(response, 200, { ok: true, content: loadContent() });
    return;
  }

  if (request.method === "POST" && pathname === "/admin/api/media/upload") {
    handleMediaUpload(request, response);
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
        content: result.content || loadContent()
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
      content: result.content || loadContent()
    });
    return;
  }

  const mediaArchiveMatch = pathname.match(/^\/admin\/api\/media\/([^/]+)\/archive$/);
  if (request.method === "POST" && mediaArchiveMatch) {
    const result = archiveMedia(decodeURIComponent(mediaArchiveMatch[1]));
    sendJson(response, result.statusCode, {
      ok: result.ok,
      message: result.message,
      content: result.content || loadContent()
    });
    return;
  }

  sendJson(response, 404, { ok: false, message: "Admin endpoint was not found." });
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

  if (pathname.startsWith("/admin/api/")) {
    handleAdminApi(request, response, pathname);
    return;
  }

  if (request.method === "POST" && pathname === "/admin/login") {
    handleLogin(request, response);
    return;
  }

  if (pathname === "/admin/login") {
    redirect(response, "/admin/login/", 301);
    return;
  }

  if (request.method === "POST" && pathname === "/admin/logout") {
    redirect(response, "/admin/login/", 303, { "Set-Cookie": clearSessionCookie() });
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

  handleStatic(request, response, pathname);
}

ensureContentStore();

http.createServer(handleRequest).listen(port, () => {
  console.log(`The Galleria.Art is serving on port ${port}`);
});
