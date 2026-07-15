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
const publicSiteUrl = (process.env.PUBLIC_SITE_URL || "https://thegalleria.art").replace(/\/+$/, "");
const adminEmail = process.env.ADMIN_EMAIL || "mc@25mprinting.com";
const publicContactEmail = process.env.PUBLIC_CONTACT_EMAIL || adminEmail;
const emailFrom = process.env.EMAIL_FROM || "";
const resendApiKey = process.env.RESEND_API_KEY || "";
const analyticsProvider = process.env.ANALYTICS_PROVIDER || "";
const analyticsId = process.env.ANALYTICS_ID || process.env.PLAUSIBLE_DOMAIN || "";
const billingProvider = process.env.BILLING_PROVIDER || "none";
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "";
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const stripeMode = process.env.STRIPE_MODE || process.env.BILLING_MODE || (stripeSecretKey ? "test" : "disabled");
const billingMode = stripeMode;
const defaultCurrency = (process.env.DEFAULT_CURRENCY || "USD").toUpperCase();
const defaultTrialDays = Number(process.env.DEFAULT_TRIAL_DAYS || 14);
const defaultPlanSlug = process.env.DEFAULT_PLAN_SLUG || "starter";
const stripeSuccessUrl = process.env.STRIPE_SUCCESS_URL || `${publicSiteUrl}/artist/billing/?checkout=success`;
const stripeCancelUrl = process.env.STRIPE_CANCEL_URL || `${publicSiteUrl}/artist/billing/?checkout=cancel`;
const stripePortalReturnUrl = process.env.STRIPE_PORTAL_RETURN_URL || `${publicSiteUrl}/artist/billing/`;
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
const validBillingStatuses = new Set(["trial", "active", "past_due", "canceled", "comped", "legacy", "demo", "not_configured"]);
const validSubscriptionStatuses = new Set(["trialing", "active", "past_due", "canceled", "incomplete", "none", "not_configured"]);
const validDomainStatuses = new Set(["not_configured", "pending_verification", "verified", "active", "error"]);
const validPortfolioPageTypes = new Set(["cover", "artist_statement", "artwork_feature", "gallery_grid", "text_page", "contact_page"]);
const reservedPublicSlugs = new Set([
  "admin",
  "artist",
  "artists",
  "galleries",
  "login",
  "invite",
  "api",
  "media",
  "pricing",
  "about",
  "contact",
  "privacy",
  "terms",
  "uploads",
  "password-reset",
  "sitemap.xml",
  "robots.txt",
  "gallery-data.js"
]);
const stripeWebhookEvents = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed"
];
const inquiryRateLimit = new Map();
const inquiryRateLimitWindowMs = 10 * 60 * 1000;
const inquiryRateLimitMax = 6;
const maxInquiryMessageLength = 3000;
const limitNearThreshold = 0.8;
const invitationDefaultDays = 14;
const passwordResetTokenHours = Number(process.env.PASSWORD_RESET_TOKEN_HOURS || 2);
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
  response.writeHead(statusCode, secureHeaders({ Location: location, ...headers }));
  response.end();
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, secureHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  }));
  response.end(JSON.stringify(payload));
}

function secureHeaders(headers = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    ...headers
  };
}

function sendHtml(response, statusCode, html, headers = {}) {
  response.writeHead(statusCode, secureHeaders({
    "Content-Type": "text/html; charset=utf-8",
    ...headers
  }));
  response.end(html);
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

function createSupportArtistSessionCookie(adminSession, artist, account, request, options = {}) {
  return createSignedSessionCookie(artistSessionCookieName, {
    email: account?.email || artist.contactEmail || adminSession.email,
    artistId: artist.id,
    role: "artist",
    supportMode: true,
    adminEmail: adminSession.email,
    returnTo: cleanString(options.returnTo || "/admin/users/"),
    supportNote: cleanLimitedString(options.note || "", 700)
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
    plans: Array.isArray(content.plans) ? content.plans : [],
    galleries: Array.isArray(content.galleries) ? content.galleries : [],
    artwork: Array.isArray(content.artwork) ? content.artwork : [],
    media: Array.isArray(content.media) ? content.media : [],
    inquiries: Array.isArray(content.inquiries) ? content.inquiries : [],
    invitations: Array.isArray(content.invitations) ? content.invitations : [],
    notifications: Array.isArray(content.notifications) ? content.notifications : [],
    billingEvents: Array.isArray(content.billingEvents) ? content.billingEvents : [],
    emailLog: Array.isArray(content.emailLog) ? content.emailLog : [],
    passwordResetTokens: Array.isArray(content.passwordResetTokens) ? content.passwordResetTokens : [],
    adminAccounts: Array.isArray(content.adminAccounts) ? content.adminAccounts : [],
    auditLog: Array.isArray(content.auditLog) ? content.auditLog : [],
    statusHistory: Array.isArray(content.statusHistory) ? content.statusHistory : [],
    artistAccounts: Array.isArray(content.artistAccounts) ? content.artistAccounts : [],
    redirects: Array.isArray(content.redirects) ? content.redirects : [],
    portfolioPages: Array.isArray(content.portfolioPages) ? content.portfolioPages : []
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

  ["artists", "plans", "galleries", "artwork", "media", "inquiries", "invitations", "notifications", "billingEvents", "emailLog", "passwordResetTokens", "adminAccounts", "auditLog", "statusHistory", "artistAccounts", "redirects", "portfolioPages"].forEach((collection) => {
    (seed[collection] || []).forEach((seedRecord) => {
      if (!content[collection].some((record) => record.id === seedRecord.id)) {
        content[collection].push(clone(seedRecord));
        changed = true;
      }
    });
  });

  return changed;
}

function ensurePhase16Defaults(content) {
  let changed = false;
  const mediaDefaults = {
    starter: 50,
    professional: 250,
    "gallery-studio": 1000
  };

  content.plans.forEach((plan) => {
    if (plan.mediaLimit === undefined) {
      plan.mediaLimit = mediaDefaults[plan.slug] || 0;
      changed = true;
    }
  });

  content.artists.forEach((artist) => {
    const shouldIgnore = artist.billingStatus === "legacy" || artist.billingStatus === "comped";
    [
      ["ignoreLimits", shouldIgnore],
      ["customGalleryLimit", 0],
      ["customArtworkLimit", 0],
      ["customMediaLimit", 0],
      ["customStorageLimit", 0],
      ["limitOverrideNotes", shouldIgnore ? "Legacy or comped account preserved without quota interruption." : ""]
    ].forEach(([key, value]) => {
      if (artist[key] === undefined) {
        artist[key] = value;
        changed = true;
      }
    });
  });

  return changed;
}

function ensurePhase18Defaults(content) {
  let changed = false;

  content.artists.forEach((artist) => {
    const slug = normalizeSlug(artist.slug);
    if (slug && artist.slug !== slug) {
      artist.slug = slug;
      changed = true;
    }
    const canonicalPath = artist.slug === "carolyn-elaine" ? "/carolyn-elaine/" : `/${artist.slug}/`;
    [
      ["publicPath", canonicalPath],
      ["canonicalPath", canonicalPath],
      ["customUrlLabel", ""],
      ["seoTitle", ""],
      ["seoDescription", ""],
      ["socialTitle", ""],
      ["socialDescription", ""],
      ["socialImage", ""],
      ["canonicalUrlOverride", ""],
      ["noindex", false],
      ["customDomain", ""],
      ["domainStatus", "not_configured"],
      ["domainVerificationToken", ""],
      ["domainVerifiedAt", ""],
      ["sslStatus", "not_configured"]
    ].forEach(([key, value]) => {
      if (artist[key] === undefined) {
        artist[key] = value;
        changed = true;
      }
    });
  });

  content.galleries.forEach((gallery) => {
    const artist = content.artists.find((item) => item.id === gallery.artistId);
    const slug = normalizeSlug(gallery.slug);
    if (slug && gallery.slug !== slug) {
      gallery.slug = slug;
      changed = true;
    }
    const canonicalPath = artist && gallery.slug ? `/${artist.slug}/${gallery.slug}/` : "";
    [
      ["publicPath", canonicalPath],
      ["canonicalPath", canonicalPath],
      ["customUrlLabel", ""],
      ["seoTitle", ""],
      ["seoDescription", ""],
      ["socialTitle", ""],
      ["socialDescription", ""],
      ["socialImage", ""],
      ["canonicalUrlOverride", ""],
      ["noindex", false]
    ].forEach(([key, value]) => {
      if (gallery[key] === undefined) {
        gallery[key] = value;
        changed = true;
      }
    });
  });

  return changed;
}

function ensurePhase19Defaults(content) {
  let changed = false;

  content.portfolioPages.forEach((page) => {
    [
      ["subtitle", ""],
      ["pageType", "text_page"],
      ["galleryId", ""],
      ["featuredImage", ""],
      ["bodyContent", ""],
      ["artworkIds", []],
      ["mediaIds", []],
      ["location", ""],
      ["year", ""],
      ["medium", ""],
      ["dimensions", ""],
      ["clientInfo", ""],
      ["ctaLabel", ""],
      ["ctaUrl", ""],
      ["seoTitle", ""],
      ["seoDescription", ""],
      ["submittedAt", ""],
      ["publishedAt", ""]
    ].forEach(([key, value]) => {
      if (page[key] === undefined) {
        page[key] = Array.isArray(value) ? [] : value;
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
  const phase16Defaults = ensurePhase16Defaults(content);
  const phase18Defaults = ensurePhase18Defaults(content);
  const phase19Defaults = ensurePhase19Defaults(content);
  const changed = mergedSeed || generatedInvitations || phase16Defaults || phase18Defaults || phase19Defaults;
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

function emailServiceStatus() {
  const configured = Boolean(resendApiKey && emailFrom);
  return {
    configured,
    provider: configured ? "resend" : "log-only",
    mode: configured ? "live" : "log-only",
    from: configured ? emailFrom : "",
    publicContactEmail
  };
}

function billingProviderStatus() {
  const publishableConfigured = Boolean(stripePublishableKey);
  const secretConfigured = Boolean(stripeSecretKey);
  const webhookConfigured = Boolean(stripeWebhookSecret);
  const selectedMode = ["disabled", "test", "live"].includes(stripeMode) ? stripeMode : "disabled";
  const configured = Boolean(publishableConfigured && secretConfigured && selectedMode !== "disabled");
  return {
    configured,
    provider: configured ? (billingProvider === "none" ? "stripe" : billingProvider) : "none",
    mode: configured ? selectedMode : "disabled",
    publishableKeyConfigured: publishableConfigured,
    secretKeyConfigured: secretConfigured,
    webhookSecretConfigured: webhookConfigured,
    publishableKeyPreview: publishableConfigured ? maskSecret(stripePublishableKey) : "",
    webhookEndpoint: absoluteUrl("/api/stripe/webhook"),
    publicPricingVisible: true,
    defaultTrialDays,
    defaultPlanSlug,
    defaultCurrency,
    successUrl: stripeSuccessUrl,
    cancelUrl: stripeCancelUrl,
    portalReturnUrl: stripePortalReturnUrl,
    requiredEnvironment: [
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_MODE",
      "STRIPE_SUCCESS_URL",
      "STRIPE_CANCEL_URL",
      "STRIPE_PORTAL_RETURN_URL",
      "DEFAULT_CURRENCY",
      "DEFAULT_TRIAL_DAYS"
    ],
    requiredWebhookEvents: stripeWebhookEvents,
    supportContactEmail: publicContactEmail
  };
}

function maskSecret(value) {
  const secret = cleanString(value);
  if (!secret) {
    return "";
  }
  if (secret.length <= 10) {
    return `${secret.slice(0, 3)}...`;
  }
  return `${secret.slice(0, 7)}...${secret.slice(-4)}`;
}

function activePlans(content) {
  return content.plans
    .filter((plan) => plan.status === "active")
    .sort(sortByDisplayOrder);
}

function planById(content, id) {
  return content.plans.find((plan) => plan.id === id) || null;
}

function planBySlug(content, slug) {
  return content.plans.find((plan) => plan.slug === slug) || null;
}

function defaultPlan(content) {
  return planBySlug(content, defaultPlanSlug) || activePlans(content)[0] || content.plans[0] || null;
}

function artistPlan(content, artist) {
  return planById(content, artist.planId) || defaultPlan(content);
}

function planStripePriceId(plan, interval = "monthly") {
  if (!plan) {
    return "";
  }

  const liveMode = billingMode === "live";
  const annual = interval === "annual";
  if (annual) {
    return liveMode
      ? cleanString(plan.stripeLiveAnnualPriceId || plan.stripeAnnualPriceId)
      : cleanString(plan.stripeTestAnnualPriceId || plan.stripeAnnualPriceId);
  }

  return liveMode
    ? cleanString(plan.stripeLiveMonthlyPriceId || plan.stripeMonthlyPriceId)
    : cleanString(plan.stripeTestMonthlyPriceId || plan.stripeMonthlyPriceId);
}

function planHasStripePrice(plan) {
  return Boolean(planStripePriceId(plan, "monthly") || planStripePriceId(plan, "annual"));
}

function stripeReadiness(content) {
  const status = billingProviderStatus();
  const active = activePlans(content);
  const plansMapped = active.length > 0 && active.every((plan) => planHasStripePrice(plan));
  const checklist = [
    { key: "publishable_key", label: "Publishable key configured", complete: status.publishableKeyConfigured },
    { key: "secret_key", label: "Secret key configured", complete: status.secretKeyConfigured },
    { key: "webhook_secret", label: "Webhook signing secret configured", complete: status.webhookSecretConfigured },
    { key: "mode", label: "Stripe mode selected", complete: status.mode === "test" || status.mode === "live" },
    { key: "plans_mapped", label: "Active plans mapped to Stripe price IDs", complete: plansMapped },
    { key: "webhook_endpoint", label: "Webhook endpoint configured in Stripe", complete: status.webhookSecretConfigured },
    { key: "test_checkout", label: "Test checkout available", complete: status.mode === "test" && status.secretKeyConfigured && plansMapped },
    { key: "live_checkout", label: "Live checkout enabled", complete: status.mode === "live" && status.secretKeyConfigured && plansMapped }
  ];

  return {
    ...status,
    activePlanCount: active.length,
    mappedPlanCount: active.filter(planHasStripePrice).length,
    checkoutAvailable: status.configured && active.some(planHasStripePrice),
    portalAvailable: status.configured,
    checklist
  };
}

function artistPlanOption(plan) {
  return {
    ...plan,
    checkoutMonthlyAvailable: Boolean(planStripePriceId(plan, "monthly")),
    checkoutAnnualAvailable: Boolean(planStripePriceId(plan, "annual"))
  };
}

function mediaStorageBytes(media) {
  const variantBytes = Object.values(media?.variants || {})
    .reduce((sum, variant) => sum + Number(variant?.size || 0), 0);
  return variantBytes || Number(media?.size || media?.originalSize || 0);
}

function artistUsage(content, artistId) {
  const galleries = content.galleries.filter((gallery) => gallery.artistId === artistId && gallery.status !== "archived");
  const artwork = content.artwork.filter((item) => item.artistId === artistId && item.status !== "archived");
  const media = content.media.filter((item) => item.ownerArtistId === artistId && item.status !== "archived");
  const storageBytes = media.reduce((sum, item) => sum + mediaStorageBytes(item), 0);
  return {
    galleries: galleries.length,
    publishedGalleries: galleries.filter((gallery) => gallery.status === "published").length,
    featuredGalleries: galleries.filter((gallery) => gallery.featured).length,
    artwork: artwork.length,
    publishedArtwork: artwork.filter((item) => item.status === "published").length,
    media: media.length,
    storageBytes,
    storageMb: Math.ceil(storageBytes / (1024 * 1024))
  };
}

function artistLimitOverrides(artist = {}) {
  return {
    ignoreLimits: parseBoolean(artist.ignoreLimits),
    customGalleryLimit: Number(artist.customGalleryLimit || 0),
    customArtworkLimit: Number(artist.customArtworkLimit || 0),
    customMediaLimit: Number(artist.customMediaLimit || 0),
    customStorageLimit: Number(artist.customStorageLimit || 0),
    notes: cleanLimitedString(artist.limitOverrideNotes || "", 700)
  };
}

function accountLimitsAreUnlimited(artist = {}) {
  const billingStatusValue = cleanString(artist.billingStatus);
  const overrides = artistLimitOverrides(artist);
  return overrides.ignoreLimits || billingStatusValue === "comped" || billingStatusValue === "legacy";
}

function planLimitValue(plan, artist, planKey, overrideKey) {
  const overrides = artistLimitOverrides(artist);
  const overrideValue = Number(overrides[overrideKey] || 0);
  return overrideValue > 0 ? overrideValue : Number(plan?.[planKey] || 0);
}

function quotaMetric(key, label, current, limit, unit = "count") {
  const numericLimit = Number(limit || 0);
  const numericCurrent = Number(current || 0);
  if (numericLimit <= 0) {
    return { key, label, current: numericCurrent, limit: 0, percentUsed: 0, status: "unlimited", unit };
  }
  const percentUsed = Math.round((numericCurrent / numericLimit) * 100);
  const status = numericCurrent > numericLimit ? "over_limit" : percentUsed >= limitNearThreshold * 100 ? "near_limit" : "ok";
  return { key, label, current: numericCurrent, limit: numericLimit, percentUsed, status, unit };
}

function usageEvaluation(content, artist) {
  const plan = artistPlan(content, artist);
  const usage = artistUsage(content, artist.id);
  const overrides = artistLimitOverrides(artist);
  const unlimited = accountLimitsAreUnlimited(artist);
  const metrics = [
    quotaMetric("galleries", "Galleries", usage.galleries, unlimited ? 0 : planLimitValue(plan, artist, "galleryLimit", "customGalleryLimit")),
    quotaMetric("artwork", "Artwork", usage.artwork, unlimited ? 0 : planLimitValue(plan, artist, "artworkLimit", "customArtworkLimit")),
    quotaMetric("media", "Media Files", usage.media, unlimited ? 0 : planLimitValue(plan, artist, "mediaLimit", "customMediaLimit")),
    quotaMetric("storageMb", "Media Storage", usage.storageMb, unlimited ? 0 : planLimitValue(plan, artist, "mediaStorageLimit", "customStorageLimit"), "mb"),
    quotaMetric("publishedGalleries", "Published Galleries", usage.publishedGalleries, unlimited ? 0 : planLimitValue(plan, artist, "galleryLimit", "customGalleryLimit")),
    quotaMetric("publishedArtwork", "Published Artwork", usage.publishedArtwork, unlimited ? 0 : planLimitValue(plan, artist, "artworkLimit", "customArtworkLimit"))
  ];
  const over = metrics.filter((metric) => metric.status === "over_limit");
  const near = metrics.filter((metric) => metric.status === "near_limit");

  return {
    usage,
    plan,
    overrides,
    unlimited,
    status: unlimited ? "unlimited" : over.length ? "over_limit" : near.length ? "near_limit" : "ok",
    metrics,
    warnings: [
      ...near.map((metric) => `${metric.label} is near the ${metric.limit.toLocaleString()} limit.`),
      ...over.map((metric) => `${metric.label} is over the ${metric.limit.toLocaleString()} limit.`)
    ]
  };
}

function metricByKey(evaluation, key) {
  return evaluation.metrics.find((metric) => metric.key === key) || null;
}

function formatLimitValue(metric) {
  const value = Number(metric?.limit || 0).toLocaleString();
  return metric?.unit === "mb" ? `${value} MB` : value;
}

function blockedLimitMessage(metric) {
  return `${metric.label} has reached the ${formatLimitValue(metric)} plan limit. Please contact The Galleria.Art to adjust the account.`;
}

function evaluateLimitForIncrement(evaluation, key, increment) {
  const metric = metricByKey(evaluation, key);
  if (!metric || metric.status === "unlimited" || Number(metric.limit || 0) <= 0) {
    return { ok: true };
  }

  const nextValue = Number(metric.current || 0) + Number(increment || 0);
  if (nextValue > Number(metric.limit || 0)) {
    return {
      ok: false,
      metric: {
        ...metric,
        current: nextValue,
        percentUsed: Math.round((nextValue / Number(metric.limit || 1)) * 100),
        status: "over_limit"
      }
    };
  }

  return { ok: true };
}

function enforceArtistLimit(content, artistId, action, options = {}) {
  const artist = content.artists.find((item) => item.id === artistId);
  if (!artist) {
    return { ok: false, statusCode: 404, message: "Artist was not found." };
  }

  const evaluation = usageEvaluation(content, artist);
  const checks = {
    gallery_create: [["galleries", 1]],
    artwork_create: [["artwork", 1]],
    media_upload: [
      ["media", 1],
      ["storageMb", Math.ceil(Number(options.estimatedStorageBytes || 0) / (1024 * 1024))]
    ],
    publish_gallery: [["publishedGalleries", options.alreadyPublished ? 0 : 1]],
    publish_artwork: [["publishedArtwork", options.alreadyPublished ? 0 : 1]]
  }[action] || [];

  for (const [key, increment] of checks) {
    const result = evaluateLimitForIncrement(evaluation, key, increment);
    if (!result.ok) {
      return {
        ok: false,
        statusCode: 409,
        message: blockedLimitMessage(result.metric),
        metric: result.metric,
        evaluation
      };
    }
  }

  return { ok: true, evaluation };
}

function recordLimitBlocked(content, artist, action, result, actorType = "system", actorId = "") {
  if (!artist) {
    return;
  }

  addNotification(content, {
    audience: "artist",
    artistId: artist.id,
    type: "limit_blocked",
    title: "Plan limit reached",
    message: result.message,
    link: "/artist/billing/",
    relatedType: "artist",
    relatedId: `${artist.id}:${action}:${result.metric?.key || "limit"}`
  });
  addAuditEvent(content, {
    actorType,
    actorId: actorId || artist.contactEmail || artist.id,
    action: `${action}.blocked_by_limit`,
    targetType: "artist",
    targetId: artist.id,
    summary: result.message,
    metadata: {
      metric: result.metric?.key || "",
      limit: result.metric?.limit || 0,
      attemptedValue: result.metric?.current || 0
    }
  });
}

function addLimitThresholdNotifications(content, artist, evaluation) {
  if (evaluation.unlimited) {
    return;
  }

  evaluation.metrics
    .filter((metric) => metric.status === "near_limit" || metric.status === "over_limit")
    .forEach((metric) => {
      const relatedId = `${artist.id}:${metric.key}:${metric.status}`;
      if (content.notifications.some((notification) => notification.type === "limit_threshold" && notification.relatedId === relatedId)) {
        return;
      }
      addNotification(content, {
        audience: "artist",
        artistId: artist.id,
        type: "limit_threshold",
        title: metric.status === "over_limit" ? "Plan limit exceeded" : "Plan limit approaching",
        message: metric.status === "over_limit"
          ? `${metric.label} is over the ${formatLimitValue(metric)} plan limit.`
          : `${metric.label} is near the ${formatLimitValue(metric)} plan limit.`,
        link: "/artist/billing/",
        relatedType: "artist",
        relatedId
      });
      addAuditEvent(content, {
        actorType: "system",
        actorId: "quota",
        action: metric.status === "over_limit" ? "account.moved_over_limit" : "account.near_limit",
        targetType: "artist",
        targetId: artist.id,
        summary: `${artist.name} ${metric.status === "over_limit" ? "moved over" : "is near"} ${metric.label}.`,
        metadata: {
          metric: metric.key,
          current: metric.current,
          limit: metric.limit
        }
      });
    });
}

function billingSnapshot(content, artist) {
  const plan = artistPlan(content, artist);
  const evaluation = usageEvaluation(content, artist);
  const readiness = stripeReadiness(content);
  return {
    plan,
    usage: evaluation.usage,
    usageEvaluation: evaluation,
    warnings: evaluation.warnings,
    billingStatus: artist.billingStatus || "not_configured",
    subscriptionStatus: artist.subscriptionStatus || "not_configured",
    trialStartAt: artist.trialStartAt || "",
    trialEndAt: artist.trialEndAt || "",
    currentPeriodStart: artist.currentPeriodStart || "",
    currentPeriodEnd: artist.currentPeriodEnd || "",
    cancelAtPeriodEnd: Boolean(artist.cancelAtPeriodEnd),
    externalCustomerConfigured: Boolean(artist.externalCustomerId),
    providerStatus: readiness,
    checkoutAvailable: readiness.checkoutAvailable && planHasStripePrice(plan),
    portalAvailable: readiness.portalAvailable && Boolean(artist.externalCustomerId)
  };
}

function addAuditEvent(content, event = {}) {
  content.auditLog.push({
    id: generateId("audit"),
    actorType: cleanString(event.actorType || "system"),
    actorId: cleanLimitedString(event.actorId || "", 180),
    action: cleanString(event.action || "event"),
    targetType: cleanString(event.targetType || ""),
    targetId: cleanLimitedString(event.targetId || "", 180),
    summary: cleanLimitedString(event.summary || "", 500),
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {},
    createdAt: nowIso()
  });
}

function addNotification(content, notification = {}) {
  content.notifications.push({
    id: generateId("notification"),
    audience: cleanString(notification.audience || "admin"),
    artistId: cleanString(notification.artistId || ""),
    type: cleanString(notification.type || "system"),
    title: cleanLimitedString(notification.title || "Notification", 160),
    message: cleanLimitedString(notification.message || "", 900),
    link: cleanString(notification.link || ""),
    relatedType: cleanString(notification.relatedType || ""),
    relatedId: cleanString(notification.relatedId || ""),
    readAt: "",
    createdAt: nowIso()
  });
}

function addBillingEvent(content, event = {}) {
  content.billingEvents.push({
    id: generateId("billing"),
    type: cleanString(event.type || "billing.event"),
    artistId: cleanString(event.artistId || ""),
    accountEmail: cleanLimitedString(event.accountEmail || "", 180),
    status: cleanString(event.status || "logged"),
    message: cleanLimitedString(event.message || "", 700),
    error: cleanLimitedString(event.error || "", 700),
    provider: cleanString(event.provider || "stripe"),
    providerEventId: cleanLimitedString(event.providerEventId || "", 180),
    createdAt: nowIso()
  });
}

function notificationSafe(notification) {
  return {
    id: notification.id,
    audience: notification.audience,
    artistId: notification.artistId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    link: notification.link,
    relatedType: notification.relatedType,
    relatedId: notification.relatedId,
    readAt: notification.readAt,
    createdAt: notification.createdAt
  };
}

function trimOperationalLogs(content) {
  content.emailLog = content.emailLog.slice(-250);
  content.notifications = content.notifications.slice(-500);
  content.billingEvents = content.billingEvents.slice(-500);
  content.auditLog = content.auditLog.slice(-1000);
  content.passwordResetTokens = content.passwordResetTokens.filter((token) =>
    !token.usedAt && new Date(token.expiresAt).getTime() > Date.now() - 24 * 60 * 60 * 1000
  );
}

function absoluteUrl(pathname = "/") {
  if (/^https?:\/\//i.test(pathname)) {
    return pathname;
  }
  return `${publicSiteUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function recordEmail(content, email) {
  const status = emailServiceStatus();
  const logRecord = {
    id: generateId("email"),
    to: cleanLimitedString(email.to, 180),
    subject: cleanLimitedString(email.subject, 240),
    template: cleanString(email.template || "message"),
    status: status.configured ? "queued" : "log-only",
    provider: status.provider,
    bodyText: cleanLimitedString(email.text, 5000),
    createdAt: nowIso()
  };
  content.emailLog.push(logRecord);

  if (status.configured && typeof fetch === "function") {
    fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [email.to],
        subject: email.subject,
        text: email.text
      })
    }).catch((error) => {
      console.error("Email send failed:", error.message);
    });
  } else {
    console.log(`[email:${logRecord.status}] ${email.to} - ${email.subject}\n${email.text}`);
  }
}

function emailTemplate(template, to, subject, lines) {
  return {
    template,
    to,
    subject,
    text: [
      "The Galleria.Art",
      "",
      ...lines.filter((line) => line !== null && line !== undefined),
      "",
      "The Galleria.Art"
    ].join("\n")
  };
}

function adminAccountFor(content, email = adminEmail) {
  return content.adminAccounts.find((account) =>
    account.email.toLowerCase() === email.toLowerCase() &&
    account.status !== "archived"
  ) || null;
}

function verifyAdminPassword(email, password) {
  const content = loadContent();
  const account = adminAccountFor(content, email);
  if (account?.passwordHash && account?.passwordSalt) {
    const hash = crypto.scryptSync(password, account.passwordSalt, 64).toString("hex");
    return safeCompare(hash, account.passwordHash);
  }
  return email.toLowerCase() === adminEmail.toLowerCase() && verifyPassword(password);
}

function upsertAdminPassword(content, email, password) {
  const now = nowIso();
  const salt = crypto.randomBytes(16).toString("hex");
  const nextHash = crypto.scryptSync(password, salt, 64).toString("hex");
  let account = adminAccountFor(content, email);

  if (!account) {
    account = {
      id: generateId("admin-account"),
      email,
      passwordHash: nextHash,
      passwordSalt: salt,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    content.adminAccounts.push(account);
    return account;
  }

  account.passwordHash = nextHash;
  account.passwordSalt = salt;
  account.updatedAt = now;
  return account;
}

function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function passwordResetUrl(token) {
  return absoluteUrl(`/password-reset/${encodeURIComponent(token)}/`);
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
    planId,
    billingStatus,
    subscriptionStatus,
    trialStartAt,
    trialEndAt,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    externalCustomerId,
    externalSubscriptionId,
    ignoreLimits,
    customGalleryLimit,
    customArtworkLimit,
    customMediaLimit,
    customStorageLimit,
    limitOverrideNotes,
    customDomain,
    domainStatus,
    domainVerificationToken,
    domainVerifiedAt,
    sslStatus,
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

function optimizePortfolioPageForPublic(content, page) {
  return {
    ...publicRecord(page),
    featuredImage: resolveImagePath(content, page.featuredImage, "gallery"),
    largeImage: resolveImagePath(content, page.featuredImage, "large")
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
      const portfolioPages = content.portfolioPages
        .filter((page) => page.artistId === artist.id && page.status === "published")
        .sort(sortByDisplayOrder)
        .map((page) => optimizePortfolioPageForPublic(content, page));

      return { ...optimizeArtistForPublic(content, artist), galleries, portfolioPages };
    })
    .filter((artist) => artist.galleries.length || artist.portfolioPages.length);

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

  const portfolioPages = content.portfolioPages
    .filter((page) => page.artistId === artist.id && page.status === "published")
    .sort(sortByDisplayOrder)
    .map((page) => optimizePortfolioPageForPublic(content, page));

  return { ...optimizeArtistForPublic(content, artist), galleries, portfolioPages };
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

  const portfolioPages = content.portfolioPages
    .filter((page) => page.artistId === artist.id && page.status !== "archived")
    .sort(sortByDisplayOrder)
    .map((page) => optimizePortfolioPageForPublic(content, page));

  return { ...optimizeArtistForPublic(content, artist), galleries, portfolioPages };
}

function publicPathForArtist(artist) {
  return artist.publicPath || artist.canonicalPath || `/${artist.slug}/`;
}

function findRedirectForPath(content, pathname) {
  const normalizedPath = normalizePublicPath(pathname);
  return content.redirects.find((redirect) =>
    redirect.status === "active" &&
    redirect.oldPath === normalizedPath &&
    !pathUsesReservedSlug(redirect.newPath)
  ) || null;
}

function sendRedirectForPath(response, pathname) {
  const redirectRecord = findRedirectForPath(loadContent(), pathname);
  if (!redirectRecord) {
    return false;
  }

  redirect(response, redirectRecord.newPath, 301);
  return true;
}

function findPublishedArtistForPath(content, pathname, options = {}) {
  const artistPathMatch = pathname.match(/^\/artists\/([^/]+)\/?$/);
  const rootSlugMatch = pathname.match(/^\/([^/]+)\/?$/);
  const slug = artistPathMatch?.[1] || rootSlugMatch?.[1];

  if (!slug || isReservedPublicSlug(slug)) {
    return null;
  }

  return content.artists.find((artist) =>
    artist.status === "published" &&
    artist.slug === slug &&
    (options.includeCarolyn || artist.slug !== "carolyn-elaine")
  ) || null;
}

function findPublishedGalleryForPath(content, pathname) {
  const match = pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (!match || isReservedPublicSlug(match[1]) || isReservedPublicSlug(match[2])) {
    return null;
  }

  const artist = content.artists.find((item) => item.status === "published" && item.slug === match[1]);
  if (!artist) {
    return null;
  }

  const gallery = content.galleries.find((item) =>
    item.artistId === artist.id &&
    item.status === "published" &&
    item.slug === match[2]
  );

  return gallery ? { artist, gallery } : null;
}

function publicContentWithGallery(content, artist, gallery) {
  return {
    ...optimizeArtistForPublic(content, artist),
    galleries: [{
      ...optimizeGalleryForPublic(content, gallery),
      artworks: content.artwork
        .filter((artwork) => artwork.galleryId === gallery.id && artwork.status === "published")
        .sort(sortByDisplayOrder)
        .map((artwork) => optimizeArtworkForPublic(content, artwork))
    }],
    portfolioPages: content.portfolioPages
      .filter((page) => page.artistId === artist.id && page.galleryId === gallery.id && page.status === "published")
      .sort(sortByDisplayOrder)
      .map((page) => optimizePortfolioPageForPublic(content, page))
  };
}

function portfolioPageImages(content, artist, page) {
  const artworkImages = (page.artworkIds || [])
    .map((id) => content.artwork.find((item) => item.id === id && item.artistId === artist.id && item.status === "published"))
    .filter(Boolean)
    .map((artwork) => ({
      id: artwork.id,
      title: artwork.title,
      meta: [artwork.year, artwork.location, artwork.medium].filter(Boolean).join(" - "),
      image: resolveImagePath(content, artwork.image, "gallery"),
      largeImage: resolveImagePath(content, artwork.image, "large"),
      artworkId: artwork.id
    }));
  const mediaImages = (page.mediaIds || [])
    .map((id) => content.media.find((media) => media.id === id && media.status === "ready"))
    .filter(Boolean)
    .map((media) => ({
      id: media.id,
      title: media.originalFilename || media.publicPath,
      meta: "",
      image: mediaPath(media, "gallery"),
      largeImage: mediaPath(media, "large") || mediaPath(media, "gallery")
    }));
  const featured = page.featuredImage ? [{
    id: `${page.id}-featured`,
    title: page.title,
    meta: [page.year, page.location, page.medium].filter(Boolean).join(" - "),
    image: page.featuredImage,
    largeImage: page.largeImage || page.featuredImage
  }] : [];
  const bySrc = new Map([...featured, ...artworkImages, ...mediaImages].filter((item) => item.image).map((item) => [item.image, item]));
  return [...bySrc.values()];
}

function renderPortfolioPageSection(content, artist, page, startIndex = 0) {
  const images = portfolioPageImages(content, artist, page);
  const meta = [page.year, page.location, page.medium, page.dimensions].filter(Boolean).join(" - ");
  const copy = cleanString(page.bodyContent);
  const copyHtml = copy
    ? escapeHtml(copy)
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
      .join("")
    : "";
  const imageGrid = images.length ? `
    <div class="dynamic-artwork-grid portfolio-page-grid">
      ${images.map((image, index) => `
        <article class="dynamic-artwork-card">
          <button class="dynamic-lightbox-trigger" type="button" data-index="${startIndex + index}" data-src="${escapeHtml(image.largeImage || image.image)}" data-title="${escapeHtml(image.title)}" data-meta="${escapeHtml(image.meta)}"${image.artworkId ? ` data-artwork-id="${escapeHtml(image.artworkId)}"` : ""} aria-label="View ${escapeHtml(image.title)}">
            <img src="${escapeHtml(image.image)}" alt="${escapeHtml(image.title)}" loading="lazy">
          </button>
        </article>
      `).join("")}
    </div>
  ` : "";

  return `
    <section class="dynamic-gallery-section managed-portfolio-page page-type-${escapeHtml(page.pageType)}" aria-labelledby="portfolio-page-${escapeHtml(page.id)}">
      <div class="section-inner">
        <div class="section-heading">
          <p class="section-kicker">${escapeHtml(page.pageType.replaceAll("_", " "))}</p>
          <h2 id="portfolio-page-${escapeHtml(page.id)}">${escapeHtml(page.title)}</h2>
        </div>
        ${page.subtitle ? `<p class="dynamic-gallery-description">${escapeHtml(page.subtitle)}</p>` : ""}
        ${meta ? `<p class="admin-muted">${escapeHtml(meta)}</p>` : ""}
        ${copyHtml ? `<div class="managed-portfolio-copy">${copyHtml}</div>` : ""}
        ${imageGrid}
        ${page.clientInfo ? `<p class="admin-muted">${escapeHtml(page.clientInfo)}</p>` : ""}
        ${page.ctaLabel && page.ctaUrl ? `<a class="home-button" href="${escapeHtml(page.ctaUrl)}">${escapeHtml(page.ctaLabel)}</a>` : ""}
      </div>
    </section>
  `;
}

function metadataForArtist(content, artist, heroImage, options = {}) {
  const canonicalPath = options.gallery ? publicPathForGallery(artist, options.gallery) : publicPathForArtist(artist);
  const record = options.gallery || artist;
  const baseTitle = options.gallery ? `${options.gallery.title} by ${artist.name}` : artist.name;
  const fallbackDescription = options.gallery?.description || artist.shortDescription || `${artist.name} at The Galleria.Art`;
  const shareImage = metaImageForRecord(content, record, [options.gallery?.coverImage, artist.heroImage, heroImage]);
  return {
    title: cleanString(record.seoTitle) || `${baseTitle} | The Galleria.Art`,
    description: cleanString(record.seoDescription) || fallbackDescription,
    canonicalUrl: publicRecordCanonicalUrl(record, canonicalPath),
    ogTitle: cleanString(record.socialTitle) || cleanString(record.seoTitle) || baseTitle,
    ogDescription: cleanString(record.socialDescription) || cleanString(record.seoDescription) || fallbackDescription,
    ogImage: absoluteUrl(shareImage),
    noindex: parseBoolean(record.noindex) || Boolean(options.noindex)
  };
}

function renderPublicArtistPage(artist, options = {}) {
  const galleries = artist.galleries || [];
  const renderContent = loadContent();
  const primaryGallery = galleries[0] || {};
  const artworks = galleries.flatMap((gallery) =>
    (gallery.artworks || []).map((artwork) => ({ ...artwork, galleryTitle: gallery.title }))
  );
  const heroImage = primaryGallery.coverImage || artist.heroImage || artworks[0]?.image || "";
  const location = [artist.city, artist.region, artist.country].filter(Boolean).join(", ");
  const managedPages = (artist.portfolioPages || []).filter((page) => page.status === "published" || options.noindex);
  const metadata = metadataForArtist(renderContent, artist, heroImage, {
    gallery: options.gallery || null,
    noindex: options.noindex
  });
  const inquirySourcePath = options.gallery ? publicPathForGallery(artist, options.gallery) : publicPathForArtist(artist);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${metadata.noindex ? '<meta name="robots" content="noindex, nofollow">' : ""}
  <meta name="description" content="${escapeHtml(metadata.description)}">
  <link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}">
  <meta property="og:title" content="${escapeHtml(metadata.ogTitle)}">
  <meta property="og:description" content="${escapeHtml(metadata.ogDescription)}">
  <meta property="og:url" content="${escapeHtml(metadata.canonicalUrl)}">
  <meta property="og:type" content="profile">
  <meta property="og:image" content="${escapeHtml(metadata.ogImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(metadata.ogTitle)}">
  <meta name="twitter:description" content="${escapeHtml(metadata.ogDescription)}">
  <meta name="twitter:image" content="${escapeHtml(metadata.ogImage)}">
  <title>${escapeHtml(metadata.title)}</title>
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

    ${managedPages.map((page) => renderPortfolioPageSection(renderContent, artist, page)).join("")}

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
          <input name="sourceUrl" type="hidden" value="${escapeHtml(inquirySourcePath)}">
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
      <a href="/pricing/">Pricing</a>
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
  if (!publicArtist.galleries.length && !publicArtist.portfolioPages.length) {
    return false;
  }

  response.writeHead(200, secureHeaders({ "Content-Type": "text/html; charset=utf-8" }));
  response.end(injectAnalytics(renderPublicArtistPage(publicArtist)));
  return true;
}

function sendPublicGalleryPage(response, pathname) {
  const content = loadContent();
  const match = findPublishedGalleryForPath(content, pathname);
  if (!match) {
    return false;
  }

  const publicArtist = publicContentWithGallery(content, match.artist, match.gallery);
  if (!publicArtist.galleries[0]?.artworks?.length && !publicArtist.portfolioPages.length) {
    return false;
  }

  response.writeHead(200, secureHeaders({ "Content-Type": "text/html; charset=utf-8" }));
  response.end(injectAnalytics(renderPublicArtistPage(publicArtist, { gallery: publicArtist.galleries[0] })));
  return true;
}

function sendPublicGalleryData(response) {
  const publicData = buildPublicData(loadContent());
  response.writeHead(200, secureHeaders({ "Content-Type": "text/javascript; charset=utf-8" }));
  response.end(`window.GalleriaData = ${JSON.stringify(publicData, null, 2)};\n`);
}

function formatPlanPrice(plan) {
  const amount = Number(plan.monthlyPrice || 0);
  if (!amount) {
    return "By invitation";
  }
  return `$${amount.toLocaleString()} / month`;
}

function renderPricingPage(content) {
  const plans = activePlans(content);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Plans and pricing foundation for The Galleria.Art hosted online gallery services.">
  <link rel="canonical" href="${escapeHtml(absoluteUrl("/pricing/"))}">
  <meta property="og:title" content="Pricing | The Galleria.Art">
  <meta property="og:description" content="Refined hosted online gallery plans for artists, creators, galleries, and studios.">
  <meta property="og:url" content="${escapeHtml(absoluteUrl("/pricing/"))}">
  <meta property="og:type" content="website">
  <meta property="og:image" content="${escapeHtml(absoluteUrl("/images/whispers-main.jpeg"))}">
  <meta name="twitter:card" content="summary_large_image">
  <title>Pricing | The Galleria.Art</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="home-page pricing-page">
  <header class="site-header" aria-label="The Galleria.Art">
    <a class="site-brand" href="/">The Galleria.Art</a>
    <nav class="site-nav" aria-label="Public navigation">
      <a href="/">Home</a>
      <a href="/pricing/">Pricing</a>
      <a href="/contact/">Contact</a>
      <a href="/artist/login/">Artist Login</a>
    </nav>
  </header>

  <main>
    <section class="pricing-hero">
      <div class="section-inner">
        <p class="welcome-line">PLANS</p>
        <h1>Hosted gallery presence, prepared with care.</h1>
        <div class="gold-divider" aria-hidden="true"></div>
        <p class="hero-support">The Galleria.Art is invitation-based while billing is being prepared. Plans below are the current service foundation and may be refined before live payment collection begins.</p>
      </div>
    </section>

    <section class="product-section" aria-labelledby="pricing-title">
      <div class="section-inner">
        <div class="section-heading">
          <p class="section-kicker">Pricing Foundation</p>
          <h2 id="pricing-title">Artist and gallery plans</h2>
        </div>
        <div class="pricing-grid">
          ${plans.map((plan) => `
            <article class="pricing-card">
              <p class="section-kicker">${escapeHtml(plan.slug)}</p>
              <h3>${escapeHtml(plan.name)}</h3>
              <strong>${escapeHtml(formatPlanPrice(plan))}</strong>
              ${plan.annualPrice ? `<span>$${Number(plan.annualPrice).toLocaleString()} annually</span>` : "<span>Annual billing optional later</span>"}
              <p>${escapeHtml(plan.description)}</p>
              <ul>
                <li>${Number(plan.galleryLimit || 0).toLocaleString()} ${Number(plan.galleryLimit || 0) === 1 ? "gallery" : "galleries"}</li>
                <li>${Number(plan.artworkLimit || 0).toLocaleString()} artwork records</li>
                <li>${Number(plan.mediaLimit || 0) ? `${Number(plan.mediaLimit).toLocaleString()} media files` : "Flexible media library"}</li>
                <li>${Number(plan.mediaStorageLimit || 0).toLocaleString()} MB media storage</li>
                ${plan.featuredGalleryEligible ? "<li>Featured gallery eligible</li>" : ""}
                ${plan.customDomainEligible ? "<li>Custom domain eligible</li>" : ""}
              </ul>
              <a class="home-button" href="/contact/">Request Invitation</a>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <nav aria-label="Footer navigation">
      <a href="/about/">About</a>
      <a href="/contact/">Contact</a>
      <a href="/pricing/">Pricing</a>
      <a href="/artist/login/">Artist Login</a>
      <a href="/privacy/">Privacy</a>
      <a href="/terms/">Terms</a>
    </nav>
    <p>&copy; 2026 The Galleria.Art. All rights reserved.</p>
  </footer>
</body>
</html>`;
}

function sendPricingPage(response) {
  sendHtml(response, 200, injectAnalytics(renderPricingPage(loadContent())));
}

function sitemapUrls() {
  const content = loadContent();
  const urls = [
    { loc: absoluteUrl("/"), lastmod: "" },
    { loc: absoluteUrl("/about/"), lastmod: "" },
    { loc: absoluteUrl("/contact/"), lastmod: "" },
    { loc: absoluteUrl("/pricing/"), lastmod: "" },
    { loc: absoluteUrl("/privacy/"), lastmod: "" },
    { loc: absoluteUrl("/terms/"), lastmod: "" },
    { loc: absoluteUrl("/carolyn-elaine/"), lastmod: "" }
  ];

  buildPublicData(content).artists
    .filter((artist) => !parseBoolean(artist.noindex))
    .forEach((artist) => {
      urls.push({ loc: publicRecordCanonicalUrl(artist, publicPathForArtist(artist)), lastmod: artist.updatedAt || "" });
      (artist.galleries || [])
        .filter((gallery) => !parseBoolean(gallery.noindex))
        .forEach((gallery) => {
          urls.push({ loc: publicRecordCanonicalUrl(gallery, publicPathForGallery(artist, gallery)), lastmod: gallery.updatedAt || "" });
        });
  });

  return urls
    .filter((url, index, all) => all.findIndex((item) => item.loc === url.loc) === index)
    .sort((left, right) => left.loc.localeCompare(right.loc));
}

function sendSitemap(response) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls().map((url) => `  <url><loc>${escapeHtml(url.loc)}</loc>${url.lastmod ? `<lastmod>${escapeHtml(url.lastmod.slice(0, 10))}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
  response.writeHead(200, secureHeaders({ "Content-Type": "application/xml; charset=utf-8" }));
  response.end(xml);
}

function sendRobots(response) {
  response.writeHead(200, secureHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
  response.end([
    "User-agent: *",
    "Disallow: /admin/",
    "Disallow: /artist/",
    "Disallow: /invite/",
    "Disallow: /password-reset/",
    "Disallow: /api/",
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml")}`,
    ""
  ].join("\n"));
}

function analyticsSnippet() {
  if (!analyticsId) {
    return "";
  }

  if (analyticsProvider === "plausible" || analyticsId.includes(".")) {
    return `<script defer data-domain="${escapeHtml(analyticsId)}" src="https://plausible.io/js/script.js"></script>`;
  }

  return "";
}

function injectAnalytics(html) {
  const snippet = analyticsSnippet();
  return snippet ? html.replace("</head>", `  ${snippet}\n</head>`) : html;
}

function shouldInjectAnalytics(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".html" || !analyticsId) {
    return false;
  }

  const relative = path.relative(publicDir, filePath);
  return !relative.startsWith("admin/") && !relative.startsWith("artist/");
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
      response.writeHead(error.code === "ENOENT" ? 404 : 500, secureHeaders({
        "Content-Type": "text/plain; charset=utf-8"
      }));
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(statusCode, secureHeaders({ "Content-Type": contentType }));
    response.end(shouldInjectAnalytics(filePath) ? injectAnalytics(content.toString("utf8")) : content);
  });
}

function sendAdminFile(response, filePath, session) {
  fs.readFile(filePath, "utf8", (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, secureHeaders({
        "Content-Type": "text/plain; charset=utf-8"
      }));
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, secureHeaders({
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "text/plain; charset=utf-8"
    }));

    if (path.extname(filePath).toLowerCase() === ".html") {
      response.end(content.replaceAll("{{ADMIN_EMAIL}}", escapeHtml(session.email)));
      return;
    }

    response.end(content);
  });
}

function supportBannerHtml(context) {
  if (!context.support?.active) {
    return "";
  }

  return `
    <div class="support-banner" role="status">
      <div>
        <strong>Support mode</strong>
        <span>Viewing as ${escapeHtml(context.artist.name)} (${escapeHtml(context.support.artistEmail || context.account.email)})</span>
        <small>Admin: ${escapeHtml(context.support.adminEmail)}</small>
      </div>
      <form action="/artist/support/exit" method="post">
        <button type="submit">Exit support mode</button>
      </form>
    </div>`;
}

function sendArtistFile(response, filePath, context) {
  fs.readFile(filePath, "utf8", (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, secureHeaders({
        "Content-Type": "text/plain; charset=utf-8"
      }));
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, secureHeaders({
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "text/plain; charset=utf-8"
    }));

    if (path.extname(filePath).toLowerCase() === ".html") {
      response.end(content
        .replace('<div class="admin-shell">', `${supportBannerHtml(context)}\n  <div class="admin-shell">`)
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

async function stripeRequest(endpoint, params = {}) {
  if (!stripeSecretKey) {
    throw new Error("Stripe secret key is not configured.");
  }

  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      body.append(key, String(value));
    }
  });

  const response = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    payload = { error: { message: text || "Unexpected Stripe response." } };
  }

  if (!response.ok) {
    throw new Error(payload.error?.message || "Stripe request failed.");
  }

  return payload;
}

function verifyStripeSignature(body, signatureHeader) {
  if (!stripeWebhookSecret) {
    return { ok: false, message: "Stripe webhook secret is not configured." };
  }

  const parts = cleanString(signatureHeader).split(",").reduce((accumulator, part) => {
    const [key, value] = part.split("=");
    if (key && value) {
      accumulator[key] = accumulator[key] || [];
      accumulator[key].push(value);
    }
    return accumulator;
  }, {});
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];

  if (!timestamp || !signatures.length) {
    return { ok: false, message: "Stripe signature header is missing required values." };
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
    return { ok: false, message: "Stripe webhook timestamp is outside the allowed tolerance." };
  }

  const expected = crypto
    .createHmac("sha256", stripeWebhookSecret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const match = signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, "hex");
    return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  });

  return match ? { ok: true } : { ok: false, message: "Stripe webhook signature verification failed." };
}

function isoFromUnix(value) {
  const timestamp = Number(value || 0);
  return timestamp ? new Date(timestamp * 1000).toISOString() : "";
}

function billingStatusFromSubscriptionStatus(status) {
  if (status === "trialing") {
    return "trial";
  }
  if (status === "active") {
    return "active";
  }
  if (status === "canceled" || status === "incomplete_expired") {
    return "canceled";
  }
  if (["past_due", "unpaid", "incomplete"].includes(status)) {
    return "past_due";
  }
  return "not_configured";
}

function findPlanByStripePrice(content, priceId) {
  const id = cleanString(priceId);
  if (!id) {
    return null;
  }

  return content.plans.find((plan) => [
    plan.stripeMonthlyPriceId,
    plan.stripeAnnualPriceId,
    plan.stripeTestMonthlyPriceId,
    plan.stripeTestAnnualPriceId,
    plan.stripeLiveMonthlyPriceId,
    plan.stripeLiveAnnualPriceId
  ].some((candidate) => cleanString(candidate) === id)) || null;
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
    addAuditEvent(finalContent, {
      actorType: options.uploadedBy === "artist" ? "artist" : "admin",
      actorId: options.ownerArtistId || adminEmail,
      action: "media.uploaded",
      targetType: "media",
      targetId: mediaId,
      summary: `Media uploaded: ${upload.originalFilename}`
    });
    if (options.ownerArtistId) {
      const artist = finalContent.artists.find((item) => item.id === options.ownerArtistId);
      if (artist) {
        addLimitThresholdNotifications(finalContent, artist, usageEvaluation(finalContent, artist));
      }
    }
    trimOperationalLogs(finalContent);
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

function isSafePublicHref(value) {
  return !value || /^\/(?!\/)[^\s]*$/.test(value) || /^#[^\s]*$/.test(value) || /^https?:\/\/[^\s]+$/i.test(value) || /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
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

function hasValidBillingStatus(value) {
  return validBillingStatuses.has(value);
}

function hasValidSubscriptionStatus(value) {
  return validSubscriptionStatuses.has(value);
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

  if (resource === "portfolioPage") {
    return "portfolioPages";
  }

  return "artists";
}

function publicArtistUrl(artist) {
  return artist.canonicalPath || `/${artist.slug}/`;
}

function normalizeSlug(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function isReservedPublicSlug(slug) {
  return reservedPublicSlugs.has(normalizeSlug(slug));
}

function publicPathForGallery(artist, gallery) {
  return gallery?.canonicalPath || `/${artist?.slug || ""}/${gallery?.slug || ""}/`;
}

function publicRecordCanonicalUrl(record, pathname) {
  const override = cleanString(record?.canonicalUrlOverride);
  if (!override) {
    return absoluteUrl(pathname);
  }
  return override.startsWith("/") ? absoluteUrl(override) : override;
}

function cleanDomain(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

function isValidDomain(value) {
  const domain = cleanDomain(value);
  return !domain || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain);
}

function canUseImageForMeta(content, value, fallbacks = []) {
  const image = cleanString(value);
  if (!image) {
    return true;
  }

  const media = findMediaByPath(content, image);
  if (media) {
    return media.status === "ready";
  }

  return image.startsWith("/images/") || fallbacks.includes(image);
}

function metaImageForRecord(content, record, fallbacks = []) {
  const candidates = [
    record?.socialImage,
    record?.coverImage,
    record?.heroImage,
    ...fallbacks,
    "/images/whispers-main.jpeg"
  ].filter(Boolean);
  const selected = candidates.find((candidate) => canUseImageForMeta(content, candidate, fallbacks));
  return selected ? resolveImagePath(content, selected, "large") : "/images/whispers-main.jpeg";
}

function maybeCreateRedirect(content, oldPath, newPath, recordType, recordId, actorId = adminEmail) {
  const cleanOldPath = normalizePublicPath(oldPath);
  const cleanNewPath = normalizePublicPath(newPath);
  if (!cleanOldPath || !cleanNewPath || cleanOldPath === cleanNewPath || pathUsesReservedSlug(cleanOldPath)) {
    return null;
  }

  const existing = content.redirects.find((redirect) => redirect.oldPath === cleanOldPath);
  if (existing) {
    existing.newPath = cleanNewPath;
    existing.status = "active";
    existing.updatedAt = nowIso();
    return existing;
  }

  const redirectRecord = {
    id: generateId("redirect"),
    oldPath: cleanOldPath,
    newPath: cleanNewPath,
    recordType,
    recordId,
    status: "active",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  content.redirects.push(redirectRecord);
  addAuditEvent(content, {
    actorType: "admin",
    actorId,
    action: "redirect.created",
    targetType: recordType,
    targetId: recordId,
    summary: `Redirect created from ${cleanOldPath} to ${cleanNewPath}`
  });
  return redirectRecord;
}

function normalizePublicPath(value) {
  const raw = cleanString(value);
  if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) {
    return "";
  }
  const pathOnly = raw.split(/[?#]/)[0];
  const withLeading = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  const withTrailing = withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
  return withTrailing.replace(/\/{2,}/g, "/");
}

function pathUsesReservedSlug(pathname) {
  const firstSegment = normalizePublicPath(pathname).split("/").filter(Boolean)[0] || "";
  return isReservedPublicSlug(firstSegment);
}

function validateArtist(input, content, existing) {
  const errors = [];
  const name = cleanString(input.name);
  const slug = normalizeSlug(input.slug);
  const status = cleanString(input.status || "draft");
  const invitationStatus = cleanString(input.invitationStatus || "none");
  const contactEmail = cleanString(input.contactEmail);
  const heroImage = cleanString(input.heroImage);
  const socialImage = cleanString(input.socialImage || existing?.socialImage);
  const customDomain = cleanDomain(input.customDomain || existing?.customDomain);
  const domainStatus = cleanString(input.domainStatus || existing?.domainStatus || "not_configured");
  const planId = cleanString(input.planId || existing?.planId || defaultPlan(content)?.id || "");
  const billingStatus = cleanString(input.billingStatus || existing?.billingStatus || "not_configured");
  const subscriptionStatus = cleanString(input.subscriptionStatus || existing?.subscriptionStatus || "not_configured");
  const plan = planId ? planById(content, planId) : null;

  if (!name) {
    errors.push("Artist name is required.");
  }

  if (!slug) {
    errors.push("Artist slug is required.");
  }

  if (slug && isReservedPublicSlug(slug)) {
    errors.push("Artist slug is reserved.");
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

  if (planId && !plan) {
    errors.push("Selected billing plan was not found.");
  }

  if (!hasValidBillingStatus(billingStatus)) {
    errors.push("Billing status is not valid.");
  }

  if (!hasValidSubscriptionStatus(subscriptionStatus)) {
    errors.push("Subscription status is not valid.");
  }

  if (!isValidEmail(contactEmail)) {
    errors.push("Contact email is not valid.");
  }

  if (heroImage && (!isValidImageReference(heroImage) || !isReadyUploadReference(content, heroImage))) {
    errors.push("Hero image must be a ready uploaded image, existing image path, or image URL.");
  }

  if (socialImage && (!isValidImageReference(socialImage) || !canUseImageForMeta(content, socialImage, [heroImage, existing?.heroImage]))) {
    errors.push("Social image must be a ready uploaded image or existing public image.");
  }

  if (!validDomainStatuses.has(domainStatus)) {
    errors.push("Domain status is not valid.");
  }

  if (!isValidDomain(customDomain)) {
    errors.push("Custom domain must be a valid domain name.");
  }

  const canonicalPath = slug === "carolyn-elaine" ? "/carolyn-elaine/" : `/${slug}/`;

  return {
    errors,
    record: {
      id: existing?.id || generateId("artist"),
      name,
      slug,
      publicPath: canonicalPath,
      canonicalPath,
      customUrlLabel: cleanString(input.customUrlLabel || existing?.customUrlLabel),
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
      seoTitle: cleanLimitedString(input.seoTitle || existing?.seoTitle, 90),
      seoDescription: cleanLimitedString(input.seoDescription || existing?.seoDescription, 180),
      socialTitle: cleanLimitedString(input.socialTitle || existing?.socialTitle, 90),
      socialDescription: cleanLimitedString(input.socialDescription || existing?.socialDescription, 220),
      socialImage,
      canonicalUrlOverride: cleanString(input.canonicalUrlOverride || existing?.canonicalUrlOverride),
      noindex: parseBoolean(input.noindex ?? existing?.noindex),
      customDomain,
      domainStatus,
      domainVerificationToken: cleanString(input.domainVerificationToken || existing?.domainVerificationToken || (customDomain ? `galleria-${crypto.randomBytes(8).toString("hex")}` : "")),
      domainVerifiedAt: domainStatus === "verified" || domainStatus === "active" ? cleanString(input.domainVerifiedAt || existing?.domainVerifiedAt || nowIso()) : "",
      sslStatus: cleanString(input.sslStatus || existing?.sslStatus || "not_configured"),
      status,
      featured: parseBoolean(input.featured),
      invitationStatus,
      planId,
      billingStatus,
      subscriptionStatus,
      trialStartAt: cleanString(input.trialStartAt || existing?.trialStartAt),
      trialEndAt: cleanString(input.trialEndAt || existing?.trialEndAt),
      currentPeriodStart: cleanString(input.currentPeriodStart || existing?.currentPeriodStart),
      currentPeriodEnd: cleanString(input.currentPeriodEnd || existing?.currentPeriodEnd),
      cancelAtPeriodEnd: parseBoolean(input.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd),
      externalCustomerId: cleanString(input.externalCustomerId || existing?.externalCustomerId),
      externalSubscriptionId: cleanString(input.externalSubscriptionId || existing?.externalSubscriptionId),
      ignoreLimits: parseBoolean(input.ignoreLimits ?? existing?.ignoreLimits),
      customGalleryLimit: Number(input.customGalleryLimit || existing?.customGalleryLimit || 0),
      customArtworkLimit: Number(input.customArtworkLimit || existing?.customArtworkLimit || 0),
      customMediaLimit: Number(input.customMediaLimit || existing?.customMediaLimit || 0),
      customStorageLimit: Number(input.customStorageLimit || existing?.customStorageLimit || 0),
      limitOverrideNotes: cleanLimitedString(input.limitOverrideNotes || existing?.limitOverrideNotes, 700),
      protected: Boolean(existing?.protected),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso()
    }
  };
}

function validatePlan(input, content, existing) {
  const errors = [];
  const name = cleanString(input.name);
  const slug = cleanString(input.slug);
  const status = cleanString(input.status || "active");
  const monthlyPrice = Number(input.monthlyPrice || 0);
  const annualPrice = Number(input.annualPrice || 0);
  const billingInterval = cleanString(input.billingInterval || existing?.billingInterval || "monthly");

  if (!name) {
    errors.push("Plan name is required.");
  }

  if (!slug) {
    errors.push("Plan slug is required.");
  }

  if (slug && content.plans.some((plan) => plan.id !== existing?.id && plan.slug === slug)) {
    errors.push("Plan slug must be unique.");
  }

  if (!["active", "draft", "archived"].includes(status)) {
    errors.push("Plan status is not valid.");
  }

  if (!["monthly", "annual", "both"].includes(billingInterval)) {
    errors.push("Billing interval is not valid.");
  }

  if (monthlyPrice < 0 || annualPrice < 0) {
    errors.push("Plan prices cannot be negative.");
  }

  return {
    errors,
    record: {
      id: existing?.id || generateId("plan"),
      name,
      slug,
      description: cleanLimitedString(input.description, 500),
      monthlyPrice,
      annualPrice,
      currency: cleanString(input.currency || defaultCurrency).toUpperCase(),
      artistLimit: Number(input.artistLimit || 1),
      galleryLimit: Number(input.galleryLimit || 1),
      artworkLimit: Number(input.artworkLimit || 12),
      mediaLimit: Number(input.mediaLimit || existing?.mediaLimit || 0),
      mediaStorageLimit: Number(input.mediaStorageLimit || 250),
      featuredGalleryEligible: parseBoolean(input.featuredGalleryEligible),
      customDomainEligible: parseBoolean(input.customDomainEligible),
      stripeProductId: cleanString(input.stripeProductId || existing?.stripeProductId),
      stripeMonthlyPriceId: cleanString(input.stripeMonthlyPriceId || existing?.stripeMonthlyPriceId),
      stripeAnnualPriceId: cleanString(input.stripeAnnualPriceId || existing?.stripeAnnualPriceId),
      stripeTestMonthlyPriceId: cleanString(input.stripeTestMonthlyPriceId || existing?.stripeTestMonthlyPriceId),
      stripeTestAnnualPriceId: cleanString(input.stripeTestAnnualPriceId || existing?.stripeTestAnnualPriceId),
      stripeLiveMonthlyPriceId: cleanString(input.stripeLiveMonthlyPriceId || existing?.stripeLiveMonthlyPriceId),
      stripeLiveAnnualPriceId: cleanString(input.stripeLiveAnnualPriceId || existing?.stripeLiveAnnualPriceId),
      billingInterval,
      status,
      displayOrder: Number(input.displayOrder || 0),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso()
    }
  };
}

function upsertPlan(input, session) {
  const content = loadContent();
  const existing = input.id ? content.plans.find((plan) => plan.id === input.id) : null;
  const { errors, record } = validatePlan(input, content, existing);

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  if (existing) {
    const index = content.plans.findIndex((plan) => plan.id === existing.id);
    content.plans[index] = { ...existing, ...record };
  } else {
    content.plans.push(record);
  }

  addAuditEvent(content, {
    actorType: "admin",
    actorId: session?.email || adminEmail,
    action: existing ? "plan.updated" : "plan.created",
    targetType: "plan",
    targetId: record.id,
    summary: `${existing ? "Updated" : "Created"} plan ${record.name}`
  });
  trimOperationalLogs(content);
  saveContent(content, "plan-save");
  return {
    ok: true,
    statusCode: 200,
    message: "Plan saved successfully.",
    content
  };
}

function validateGallery(input, content, existing) {
  const errors = [];
  const title = cleanString(input.title);
  const slug = normalizeSlug(input.slug);
  const artistId = cleanString(input.artistId);
  const status = cleanString(input.status || "draft");
  const artist = content.artists.find((item) => item.id === artistId);
  const coverImage = cleanString(input.coverImage);
  const socialImage = cleanString(input.socialImage || existing?.socialImage);

  if (!title) {
    errors.push("Gallery title is required.");
  }

  if (!slug) {
    errors.push("Gallery slug is required.");
  }

  if (slug && isReservedPublicSlug(slug)) {
    errors.push("Gallery slug is reserved.");
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

  if (socialImage && (!isValidImageReference(socialImage) || !canUseImageForMeta(content, socialImage, [coverImage, artist?.heroImage]))) {
    errors.push("Social image must be a ready uploaded image or existing public image.");
  }

  const canonicalPath = artist ? `/${artist.slug}/${slug}/` : "";

  return {
    errors,
    record: {
      id: existing?.id || generateId("gallery"),
      artistId,
      title,
      slug,
      publicPath: canonicalPath,
      canonicalPath,
      customUrlLabel: cleanString(input.customUrlLabel || existing?.customUrlLabel),
      coverImage,
      description: cleanString(input.description),
      seoTitle: cleanLimitedString(input.seoTitle || existing?.seoTitle, 90),
      seoDescription: cleanLimitedString(input.seoDescription || existing?.seoDescription, 180),
      socialTitle: cleanLimitedString(input.socialTitle || existing?.socialTitle, 90),
      socialDescription: cleanLimitedString(input.socialDescription || existing?.socialDescription, 220),
      socialImage,
      canonicalUrlOverride: cleanString(input.canonicalUrlOverride || existing?.canonicalUrlOverride),
      noindex: parseBoolean(input.noindex ?? existing?.noindex),
      status,
      featured: parseBoolean(input.featured),
      displayOrder: Number(input.displayOrder || 0),
      protected: Boolean(existing?.protected),
      createdAt: existing?.createdAt || nowIso(),
      updatedAt: nowIso()
    }
  };
}

function parseIdList(value) {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }

  return cleanString(value)
    .split(",")
    .map((item) => cleanString(item))
    .filter(Boolean);
}

function validatePortfolioPage(input, content, existing, scope = {}) {
  const errors = [];
  const hasField = (name) => Object.prototype.hasOwnProperty.call(input, name);
  const artistId = cleanString(scope.artistId || input.artistId || existing?.artistId);
  const galleryId = cleanString(hasField("galleryId") ? input.galleryId : existing?.galleryId);
  const artist = content.artists.find((item) => item.id === artistId);
  const gallery = galleryId ? content.galleries.find((item) => item.id === galleryId && item.artistId === artistId) : null;
  const title = cleanString(input.title);
  const pageType = cleanString(input.pageType || existing?.pageType || "text_page");
  const status = cleanString(input.status || existing?.status || "draft");
  const featuredImage = cleanString(hasField("featuredImage") ? input.featuredImage : hasField("heroImage") ? input.heroImage : existing?.featuredImage);
  const artworkIds = parseIdList(hasField("artworkIds") ? input.artworkIds : existing?.artworkIds);
  const mediaIds = parseIdList(hasField("mediaIds") ? input.mediaIds : existing?.mediaIds);
  const ctaUrl = cleanString(input.ctaUrl);

  if (!artist) {
    errors.push("Artist is required.");
  }

  if (!title) {
    errors.push("Portfolio page title is required.");
  }

  if (!validPortfolioPageTypes.has(pageType)) {
    errors.push("Portfolio page type is not valid.");
  }

  if (!hasValidStatus(status)) {
    errors.push("Portfolio page status is not valid.");
  }

  if (galleryId && !gallery) {
    errors.push("Selected gallery must belong to this artist.");
  }

  if (featuredImage && (!isValidImageReference(featuredImage) || !isReadyUploadReference(content, featuredImage))) {
    errors.push("Featured image must be a ready uploaded image, existing image path, or image URL.");
  }

  if (!isSafePublicHref(ctaUrl)) {
    errors.push("CTA URL must be an internal path, page anchor, email link, or http/https URL.");
  }

  artworkIds.forEach((id) => {
    if (!content.artwork.some((item) => item.id === id && item.artistId === artistId && item.status !== "archived")) {
      errors.push(`Related artwork was not found: ${id}`);
    }
  });

  mediaIds.forEach((id) => {
    if (!content.media.some((item) => item.id === id && item.ownerArtistId === artistId && item.status === "ready")) {
      errors.push(`Related media was not found: ${id}`);
    }
  });

  return {
    errors,
    record: {
      id: existing?.id || generateId("portfolio-page"),
      artistId,
      galleryId,
      title,
      subtitle: cleanString(input.subtitle),
      pageType,
      displayOrder: Number(input.displayOrder || existing?.displayOrder || 0),
      status,
      featuredImage,
      bodyContent: cleanLimitedString(input.bodyContent || input.description || "", 6000),
      artworkIds,
      mediaIds,
      location: cleanString(input.location),
      year: cleanString(input.year),
      medium: cleanString(input.medium),
      dimensions: cleanString(input.dimensions),
      clientInfo: cleanString(input.clientInfo),
      ctaLabel: cleanString(input.ctaLabel),
      ctaUrl,
      seoTitle: cleanLimitedString(hasField("seoTitle") ? input.seoTitle : existing?.seoTitle, 90),
      seoDescription: cleanLimitedString(hasField("seoDescription") ? input.seoDescription : existing?.seoDescription, 180),
      artistReviewNote: existing?.artistReviewNote || "",
      adminReviewNote: existing?.adminReviewNote || "",
      submittedAt: existing?.submittedAt || "",
      publishedAt: status === "published" ? cleanString(existing?.publishedAt || nowIso()) : cleanString(existing?.publishedAt),
      protected: Boolean(existing?.protected),
      demo: Boolean(existing?.demo),
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
    artwork: validateArtwork,
    portfolioPage: validatePortfolioPage
  };
  const { errors, record } = validators[resource](input, content, existing);

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  if (resource === "gallery" || resource === "artwork") {
    const artist = content.artists.find((item) => item.id === record.artistId);
    const actions = [];
    if (!existing) {
      actions.push(resource === "gallery" ? "gallery_create" : "artwork_create");
    }
    if (record.status === "published" && existing?.status !== "published") {
      actions.push(resource === "gallery" ? "publish_gallery" : "publish_artwork");
    }

    for (const action of actions) {
      const limitResult = enforceArtistLimit(content, record.artistId, action, { alreadyPublished: existing?.status === "published" });
      if (!limitResult.ok) {
        recordLimitBlocked(content, artist, action, limitResult, "admin", adminEmail);
        trimOperationalLogs(content);
        saveContent(content, `${resource}-limit-blocked`);
        return {
          ok: false,
          statusCode: limitResult.statusCode,
          message: limitResult.message,
          errors: [limitResult.message],
          content
        };
      }
    }
  }

  const previousArtist = resource === "artist"
    ? existing
    : content.artists.find((artist) => artist.id === existing?.artistId);
  const previousPath = existing && resource === "artist"
    ? publicPathForArtist(existing)
    : existing && resource === "gallery"
      ? publicPathForGallery(previousArtist, existing)
      : "";

  if (existing) {
    const index = collection.findIndex((item) => item.id === existing.id);
    collection[index] = { ...existing, ...record, protected: existing.protected };
  } else {
    collection.push(record);
  }

  if (existing && resource === "artist" && existing.slug !== record.slug) {
    maybeCreateRedirect(content, previousPath, publicPathForArtist(record), "artist", record.id);
    content.galleries
      .filter((gallery) => gallery.artistId === record.id)
      .forEach((gallery) => {
        const oldGalleryPath = `/${existing.slug}/${gallery.slug}/`;
        gallery.publicPath = `/${record.slug}/${gallery.slug}/`;
        gallery.canonicalPath = gallery.publicPath;
        gallery.updatedAt = nowIso();
        maybeCreateRedirect(content, oldGalleryPath, gallery.publicPath, "gallery", gallery.id);
      });
    addAuditEvent(content, {
      actorType: "admin",
      actorId: adminEmail,
      action: "artist.slug.changed",
      targetType: "artist",
      targetId: record.id,
      summary: `Artist slug changed from ${existing.slug} to ${record.slug}`
    });
  }

  if (existing && resource === "gallery" && existing.slug !== record.slug) {
    const artist = content.artists.find((item) => item.id === record.artistId);
    maybeCreateRedirect(content, previousPath, publicPathForGallery(artist, record), "gallery", record.id);
    addAuditEvent(content, {
      actorType: "admin",
      actorId: adminEmail,
      action: "gallery.slug.changed",
      targetType: "gallery",
      targetId: record.id,
      summary: `Gallery slug changed from ${existing.slug} to ${record.slug}`
    });
  }

  const seoKeys = ["seoTitle", "seoDescription", "socialTitle", "socialDescription", "socialImage", "canonicalUrlOverride", "noindex"];
  if (existing && ["artist", "gallery"].includes(resource) && seoKeys.some((key) => String(existing[key] || "") !== String(record[key] || ""))) {
    addAuditEvent(content, {
      actorType: "admin",
      actorId: adminEmail,
      action: `${resource}.seo.updated`,
      targetType: resource,
      targetId: record.id,
      summary: `SEO metadata updated for ${record.name || record.title || record.id}`
    });
  }

  const domainKeys = ["customDomain", "domainStatus", "domainVerificationToken", "domainVerifiedAt", "sslStatus"];
  if (existing && resource === "artist" && domainKeys.some((key) => String(existing[key] || "") !== String(record[key] || ""))) {
    addAuditEvent(content, {
      actorType: "admin",
      actorId: adminEmail,
      action: existing.domainStatus !== record.domainStatus ? "domain.status.changed" : "domain.fields.updated",
      targetType: "artist",
      targetId: record.id,
      summary: `Domain readiness updated for ${record.name}`
    });
  }

  if (resource === "artist" && existing && (
    existing.planId !== record.planId ||
    existing.billingStatus !== record.billingStatus ||
    existing.subscriptionStatus !== record.subscriptionStatus
  )) {
    addNotification(content, {
      audience: "artist",
      artistId: record.id,
      type: "plan_changed",
      title: "Billing status updated",
      message: "Your plan or billing status was updated by The Galleria.Art.",
      link: "/artist/billing/",
      relatedType: "artist",
      relatedId: record.id
    });
    addAuditEvent(content, {
      actorType: "admin",
      actorId: adminEmail,
      action: "artist.billing.updated",
      targetType: "artist",
      targetId: record.id,
      summary: `Billing updated for ${record.name}`,
      metadata: {
        previousPlanId: existing.planId || "",
        nextPlanId: record.planId || "",
        previousBillingStatus: existing.billingStatus || "",
        nextBillingStatus: record.billingStatus || ""
      }
    });
  }

  if (resource === "artist" && existing && (
    parseBoolean(existing.ignoreLimits) !== parseBoolean(record.ignoreLimits) ||
    Number(existing.customGalleryLimit || 0) !== Number(record.customGalleryLimit || 0) ||
    Number(existing.customArtworkLimit || 0) !== Number(record.customArtworkLimit || 0) ||
    Number(existing.customMediaLimit || 0) !== Number(record.customMediaLimit || 0) ||
    Number(existing.customStorageLimit || 0) !== Number(record.customStorageLimit || 0) ||
    cleanString(existing.limitOverrideNotes) !== cleanString(record.limitOverrideNotes)
  )) {
    addAuditEvent(content, {
      actorType: "admin",
      actorId: adminEmail,
      action: "limit.override.changed",
      targetType: "artist",
      targetId: record.id,
      summary: `Limit override changed for ${record.name}`
    });
  }

  if (existing && resource === "portfolioPage" && Number(existing.displayOrder || 0) !== Number(record.displayOrder || 0)) {
    addAuditEvent(content, {
      actorType: "admin",
      actorId: adminEmail,
      action: "portfolioPage.reordered",
      targetType: "portfolio-page",
      targetId: record.id,
      summary: `Portfolio page reordered: ${record.title}`
    });
  }

  if (existing && resource === "portfolioPage" && existing.status !== record.status) {
    const action = record.status === "published"
      ? "portfolioPage.published"
      : existing.status === "published"
        ? "portfolioPage.unpublished"
        : `portfolioPage.status.${record.status}`;
    addAuditEvent(content, {
      actorType: "admin",
      actorId: adminEmail,
      action,
      targetType: "portfolio-page",
      targetId: record.id,
      summary: `Portfolio page status changed to ${record.status}: ${record.title}`
    });
  }

  if ((resource === "artist" || resource === "gallery" || resource === "artwork" || resource === "portfolioPage") && record.artistId) {
    const artist = content.artists.find((item) => item.id === record.artistId);
    if (artist) {
      addLimitThresholdNotifications(content, artist, usageEvaluation(content, artist));
    }
  }

  addAuditEvent(content, {
    actorType: "admin",
    actorId: adminEmail,
    action: existing ? `${resource}.updated` : `${resource}.created`,
    targetType: resource,
    targetId: record.id,
    summary: `${resource} ${existing ? "updated" : "created"}: ${record.name || record.title || record.id}`
  });
  trimOperationalLogs(content);
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
  addAuditEvent(content, {
    actorType: "admin",
    actorId: adminEmail,
    action: `${resource}.archived`,
    targetType: resource,
    targetId: record.id,
    summary: `${resource} archived: ${record.name || record.title || record.id}`
  });
  trimOperationalLogs(content);
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
    content.artwork.some((artwork) => matches(artwork.image)) ||
    content.portfolioPages.some((page) => matches(page.featuredImage) || (page.mediaIds || []).some((id) => media?.id === id));
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

    if (ownerArtistId) {
      const content = loadContent();
      const artist = content.artists.find((item) => item.id === ownerArtistId);
      const limitResult = enforceArtistLimit(content, ownerArtistId, "media_upload", {
        estimatedStorageBytes: upload.buffer.length
      });
      if (!limitResult.ok) {
        recordLimitBlocked(content, artist, "media_upload", limitResult, options.uploadedBy === "artist" ? "artist" : "admin", options.uploadedBy === "artist" ? ownerArtistId : adminEmail);
        trimOperationalLogs(content);
        saveContent(content, "media-upload-blocked");
        sendJson(response, limitResult.statusCode, {
          ok: false,
          message: limitResult.message,
          content: contentForResponse(content)
        });
        return;
      }
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
  addAuditEvent(content, {
    actorType: "admin",
    actorId: adminEmail,
    action: "media.archived",
    targetType: "media",
    targetId: media.id,
    summary: `Media archived: ${media.originalFilename || media.publicPath}`
  });
  trimOperationalLogs(content);
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
    const context = inquiryContext(content, result.record);
    addNotification(content, {
      audience: "admin",
      type: "inquiry_received",
      title: "New collector inquiry",
      message: `${result.record.visitorName} sent an inquiry${context.artist?.name ? ` for ${context.artist.name}` : ""}.`,
      link: "/admin/inquiries/",
      relatedType: "inquiry",
      relatedId: result.record.id
    });
    if (context.artist) {
      addNotification(content, {
        audience: "artist",
        artistId: context.artist.id,
        type: "inquiry_received",
        title: "New collector inquiry",
        message: `${result.record.visitorName} sent an inquiry through The Galleria.Art.`,
        link: "/artist/inquiries/",
        relatedType: "inquiry",
        relatedId: result.record.id
      });
    }
    addAuditEvent(content, {
      actorType: "public",
      actorId: result.record.visitorEmail,
      action: "inquiry.created",
      targetType: "inquiry",
      targetId: result.record.id,
      summary: "Collector inquiry submitted",
      metadata: {
        artistId: context.artist?.id || "",
        galleryId: result.record.galleryId || "",
        artworkId: result.record.artworkId || ""
      }
    });
    queueInquiryEmails(content, result.record);
    trimOperationalLogs(content);
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

  addAuditEvent(content, {
    actorType: options.admin ? "admin" : "artist",
    actorId: options.admin ? adminEmail : options.artistId,
    action: "inquiry.updated",
    targetType: "inquiry",
    targetId: inquiry.id,
    summary: `Inquiry status changed to ${status}`
  });
  trimOperationalLogs(content);
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

function artistById(content, id) {
  return content.artists.find((artist) => artist.id === id) || null;
}

function galleryById(content, id) {
  return content.galleries.find((gallery) => gallery.id === id) || null;
}

function artworkById(content, id) {
  return content.artwork.find((artwork) => artwork.id === id) || null;
}

function inquiryContext(content, inquiry) {
  const artist = artistById(content, inquiry.artistId || inquiry.assignedArtistId) ||
    artistById(content, galleryById(content, inquiry.galleryId)?.artistId) ||
    artistById(content, artworkById(content, inquiry.artworkId)?.artistId);
  const gallery = galleryById(content, inquiry.galleryId);
  const artwork = artworkById(content, inquiry.artworkId);
  return { artist, gallery, artwork };
}

function reviewContext(content, type, record) {
  const artistId = reviewRecordArtistId(record, type);
  return {
    artist: artistById(content, artistId),
    title: recordTitle(record, type),
    type
  };
}

function queueInvitationEmail(content, invitation, request) {
  recordEmail(content, emailTemplate("artist-invitation", invitation.email, "Your invitation to The Galleria.Art", [
    "You have been invited to create your private artist portal for The Galleria.Art.",
    "",
    `Invitation link: ${invitationUrl(request, invitation)}`,
    `Expires: ${new Date(invitation.expiresAt).toLocaleString()}`,
    "",
    "Use this secure link to set your password and begin preparing your gallery profile."
  ]));
}

function queueInvitationAcceptedEmail(content, invitation, artist) {
  recordEmail(content, emailTemplate("invitation-accepted-admin", adminEmail, "Artist invitation accepted", [
    `${artist.name || invitation.email} accepted an artist invitation.`,
    `Artist: ${artist.name || ""}`,
    `Email: ${invitation.email}`,
    `Admin: ${absoluteUrl("/admin/artists/")}`
  ]));
}

function queueInquiryEmails(content, inquiry) {
  const context = inquiryContext(content, inquiry);
  const contextLine = [context.artist?.name, context.gallery?.title, context.artwork?.title].filter(Boolean).join(" / ") || "General inquiry";
  const lines = [
    `From: ${inquiry.visitorName} <${inquiry.visitorEmail}>`,
    inquiry.visitorPhone ? `Phone: ${inquiry.visitorPhone}` : "",
    `Context: ${contextLine}`,
    `Source: ${inquiry.sourceUrl || ""}`,
    "",
    inquiry.message
  ];

  recordEmail(content, emailTemplate("collector-inquiry-admin", adminEmail, "New collector inquiry", lines));

  if (context.artist?.contactEmail && isValidEmail(context.artist.contactEmail)) {
    recordEmail(content, emailTemplate("collector-inquiry-artist", context.artist.contactEmail, "New inquiry through The Galleria.Art", [
      `A visitor sent an inquiry about ${contextLine}.`,
      "",
      `From: ${inquiry.visitorName} <${inquiry.visitorEmail}>`,
      inquiry.visitorPhone ? `Phone: ${inquiry.visitorPhone}` : "",
      `Preferred contact: ${inquiry.preferredContactMethod || "email"}`,
      "",
      inquiry.message
    ]));
  }
}

function queueReviewSubmittedEmail(content, type, record) {
  const context = reviewContext(content, type, record);
  recordEmail(content, emailTemplate("review-submitted-admin", adminEmail, "Artist item submitted for review", [
    `${context.artist?.name || "An artist"} submitted ${context.type}: ${context.title}.`,
    `Review queue: ${absoluteUrl("/admin/review/")}`
  ]));
}

function queueReviewDecisionEmail(content, type, record, action, note) {
  const context = reviewContext(content, type, record);
  const subject = action === "changes_requested" ? "Changes requested on The Galleria.Art" : "Your Galleria.Art submission was updated";
  const artistEmail = context.artist?.contactEmail;
  if (!artistEmail || !isValidEmail(artistEmail)) {
    return;
  }

  recordEmail(content, emailTemplate(action === "changes_requested" ? "review-changes-requested" : "review-approved-published", artistEmail, subject, [
    `${context.type}: ${context.title}`,
    `Status: ${action}`,
    note ? `Admin note: ${note}` : "",
    "",
    `Artist portal: ${absoluteUrl("/artist/")}`
  ]));
}

function queuePasswordResetEmail(content, email, token) {
  recordEmail(content, emailTemplate("password-reset", email, "Reset your The Galleria.Art password", [
    "A password reset was requested for this email address.",
    "",
    `Reset link: ${passwordResetUrl(token)}`,
    `This link expires in ${passwordResetTokenHours} hour${passwordResetTokenHours === 1 ? "" : "s"}.`,
    "",
    "If you did not request this, you can ignore this message."
  ]));
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
    planId: defaultPlan(content)?.id || "",
    billingStatus: "trial",
    subscriptionStatus: "trialing",
    trialStartAt: now,
    trialEndAt: new Date(Date.now() + defaultTrialDays * 24 * 60 * 60 * 1000).toISOString(),
    currentPeriodStart: "",
    currentPeriodEnd: "",
    cancelAtPeriodEnd: false,
    externalCustomerId: "",
    externalSubscriptionId: "",
    ignoreLimits: false,
    customGalleryLimit: 0,
    customArtworkLimit: 0,
    customMediaLimit: 0,
    customStorageLimit: 0,
    limitOverrideNotes: "",
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
  addNotification(content, {
    audience: "admin",
    type: "invitation_created",
    title: "Invitation created",
    message: `Invitation prepared for ${email}.`,
    link: "/admin/invitations/",
    relatedType: "invitation",
    relatedId: invitation.id
  });
  addAuditEvent(content, {
    actorType: "admin",
    actorId: session?.email || adminEmail,
    action: "invitation.created",
    targetType: "invitation",
    targetId: invitation.id,
    summary: `Invitation created for ${email}`
  });
  queueInvitationEmail(content, invitation, request);
  trimOperationalLogs(content);
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
  addAuditEvent(content, {
    actorType: "admin",
    actorId: adminEmail,
    action: "invitation.revoked",
    targetType: "invitation",
    targetId: invitation.id,
    summary: `Invitation revoked for ${invitation.email}`
  });
  trimOperationalLogs(content);
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

function renderPasswordResetRequestPage(options = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Password Reset | The Galleria.Art</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="admin-page admin-login-page">
  <main class="admin-login-shell">
    <section class="admin-card admin-login-card" aria-labelledby="reset-title">
      <p class="section-kicker">Account Access</p>
      <h1 id="reset-title">Reset Password</h1>
      ${options.sent ? '<p class="admin-message success"><strong>If that account exists, a reset email has been prepared.</strong></p>' : ""}
      <p class="admin-muted">Enter the email for an admin or artist account. Reset links expire quickly and can only be used once.</p>
      <form class="admin-form" action="/password-reset/" method="post">
        <label>
          <span>Account Type</span>
          <select name="accountType">
            <option value="artist">Artist</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label>
          <span>Email</span>
          <input name="email" type="email" autocomplete="username" required>
        </label>
        <button class="home-button admin-submit" type="submit">Send Reset Link</button>
      </form>
      <a class="admin-return" href="/">Return to public site</a>
    </section>
  </main>
</body>
</html>`;
}

function resetTokenRecord(content, token) {
  const tokenHash = hashResetToken(token);
  return content.passwordResetTokens.find((record) => record.tokenHash === tokenHash) || null;
}

function resetTokenUnavailable(record) {
  if (!record || record.usedAt) {
    return "This reset link is invalid or has already been used.";
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    return "This reset link has expired.";
  }

  return "";
}

function renderPasswordResetForm(token, options = {}) {
  const unavailable = options.unavailable || "";
  const errors = options.errors || [];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Set New Password | The Galleria.Art</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="admin-page admin-login-page">
  <main class="admin-login-shell">
    <section class="admin-card admin-login-card" aria-labelledby="reset-form-title">
      <p class="section-kicker">Account Access</p>
      <h1 id="reset-form-title">Set New Password</h1>
      ${unavailable ? `
        <p class="admin-alert">${escapeHtml(unavailable)}</p>
        <a class="admin-return" href="/password-reset/">Request a new reset link</a>
      ` : `
        ${errors.length ? `<div class="admin-message error"><strong>Please fix the highlighted fields.</strong><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul></div>` : ""}
        <form class="admin-form" action="/password-reset/${encodeURIComponent(token)}/" method="post">
          <label>
            <span>New Password</span>
            <input name="password" type="password" autocomplete="new-password" required>
          </label>
          <label>
            <span>Confirm Password</span>
            <input name="confirmPassword" type="password" autocomplete="new-password" required>
          </label>
          <button class="home-button admin-submit" type="submit">Change Password</button>
        </form>
      `}
    </section>
  </main>
</body>
</html>`;
}

function findPasswordResetAccount(content, accountType, email) {
  if (accountType === "admin") {
    return email.toLowerCase() === adminEmail.toLowerCase() || adminAccountFor(content, email)
      ? { accountType: "admin", email, targetId: email }
      : null;
  }

  const account = content.artistAccounts.find((item) =>
    item.email.toLowerCase() === email.toLowerCase() &&
    item.status !== "archived"
  );
  return account ? { accountType: "artist", email: account.email, targetId: account.artistId } : null;
}

function handlePasswordResetRequest(request, response) {
  collectBody(request, (body) => {
    const input = Object.fromEntries(new URLSearchParams(body));
    const email = cleanLimitedString(input.email, 180).toLowerCase();
    const accountType = cleanString(input.accountType) === "admin" ? "admin" : "artist";
    const content = loadContent();
    const account = findPasswordResetAccount(content, accountType, email);

    if (account) {
      const token = generatePasswordResetToken();
      const now = nowIso();
      const expires = new Date();
      expires.setHours(expires.getHours() + passwordResetTokenHours);
      content.passwordResetTokens.push({
        id: generateId("password-reset"),
        tokenHash: hashResetToken(token),
        accountType: account.accountType,
        email: account.email,
        targetId: account.targetId,
        expiresAt: expires.toISOString(),
        usedAt: "",
        createdAt: now
      });
      addNotification(content, {
        audience: account.accountType === "admin" ? "admin" : "artist",
        artistId: account.accountType === "artist" ? account.targetId : "",
        type: "password_reset_requested",
        title: "Password reset requested",
        message: "A password reset link was requested for this account.",
        link: account.accountType === "admin" ? "/admin/settings/" : "/artist/",
        relatedType: "account",
        relatedId: account.targetId
      });
      addAuditEvent(content, {
        actorType: account.accountType,
        actorId: account.email,
        action: "password_reset.requested",
        targetType: "account",
        targetId: account.targetId,
        summary: "Password reset requested"
      });
      queuePasswordResetEmail(content, account.email, token);
      trimOperationalLogs(content);
      saveContent(content, "password-reset-request");
    } else {
      addAuditEvent(content, {
        actorType: accountType,
        actorId: email,
        action: "password_reset.requested_unknown",
        targetType: "account",
        targetId: "",
        summary: "Password reset requested for unknown account"
      });
      trimOperationalLogs(content);
      saveContent(content, "password-reset-request-unknown");
    }

    sendHtml(response, 200, renderPasswordResetRequestPage({ sent: true }));
  });
}

function sendPasswordResetForm(response, token) {
  const content = loadContent();
  const record = resetTokenRecord(content, token);
  const unavailable = resetTokenUnavailable(record);
  sendHtml(response, unavailable ? 404 : 200, renderPasswordResetForm(token, { unavailable }));
}

function handlePasswordResetComplete(request, response, token) {
  collectBody(request, (body) => {
    const input = Object.fromEntries(new URLSearchParams(body));
    const content = loadContent();
    const record = resetTokenRecord(content, token);
    const unavailable = resetTokenUnavailable(record);

    if (unavailable) {
      sendHtml(response, 409, renderPasswordResetForm(token, { unavailable }));
      return;
    }

    const errors = validateInvitePassword(input.password || "", input.confirmPassword || "");
    if (errors.length) {
      sendHtml(response, 422, renderPasswordResetForm(token, { errors }));
      return;
    }

    if (record.accountType === "admin") {
      upsertAdminPassword(content, record.email, input.password || "");
    } else {
      const account = content.artistAccounts.find((item) =>
        item.email.toLowerCase() === record.email.toLowerCase() &&
        item.status !== "archived"
      );
      if (!account) {
        sendHtml(response, 404, renderPasswordResetForm(token, { unavailable: "This account could not be found." }));
        return;
      }
      const salt = crypto.randomBytes(16).toString("hex");
      account.passwordHash = hashArtistPassword(input.password || "", salt);
      account.passwordSalt = salt;
      account.updatedAt = nowIso();
    }

    record.usedAt = nowIso();
    addNotification(content, {
      audience: record.accountType === "admin" ? "admin" : "artist",
      artistId: record.accountType === "artist" ? record.targetId : "",
      type: "password_changed",
      title: "Password changed",
      message: "The password for this account was changed through password recovery.",
      link: record.accountType === "admin" ? "/admin/login/" : "/artist/login/",
      relatedType: "account",
      relatedId: record.targetId
    });
    addAuditEvent(content, {
      actorType: record.accountType,
      actorId: record.email,
      action: "password_reset.completed",
      targetType: "account",
      targetId: record.targetId,
      summary: "Password reset completed"
    });
    trimOperationalLogs(content);
    saveContent(content, "password-reset-complete");
    redirect(response, record.accountType === "admin" ? "/admin/login/?reset=1" : "/artist/login/?reset=1");
  });
}

function sendInvitePage(request, response, token) {
  const content = loadContent();
  const invitation = refreshInvitationStatus(content, findInvitationByToken(content, token));
  const artist = invitation?.artistId ? content.artists.find((item) => item.id === invitation.artistId) : null;

  sendHtml(response, invitation && !invitationUnavailableReason(invitation) ? 200 : 404, renderInvitePage(invitation, { artist }));
}

function acceptInvitation(request, response, token) {
  collectBody(request, (body) => {
    const input = Object.fromEntries(new URLSearchParams(body));
    const content = loadContent();
    const invitation = refreshInvitationStatus(content, findInvitationByToken(content, token));
    const unavailable = invitationUnavailableReason(invitation);

    if (unavailable) {
      sendHtml(response, 409, renderInvitePage(invitation));
      return;
    }

    const errors = validateInvitePassword(input.password || "", input.confirmPassword || "");
    const artistName = cleanLimitedString(input.artistName, 140);

    if (!artistName) {
      errors.push("Artist name is required.");
    }

    if (errors.length) {
      const artist = invitation.artistId ? content.artists.find((item) => item.id === invitation.artistId) : null;
      sendHtml(response, 422, renderInvitePage(invitation, { artist, errors, input }));
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
    addNotification(content, {
      audience: "admin",
      type: "invitation_accepted",
      title: "Invitation accepted",
      message: `${artist.name} accepted an artist invitation.`,
      link: "/admin/artists/",
      relatedType: "artist",
      relatedId: artist.id
    });
    addNotification(content, {
      audience: "artist",
      artistId: artist.id,
      type: "invitation_accepted",
      title: "Welcome to The Galleria.Art",
      message: "Your artist portal is active. You can prepare your profile, galleries, artwork, and submit updates for review.",
      link: "/artist/",
      relatedType: "artist",
      relatedId: artist.id
    });
    addAuditEvent(content, {
      actorType: "artist",
      actorId: invitation.email,
      action: "invitation.accepted",
      targetType: "artist",
      targetId: artist.id,
      summary: `${artist.name} accepted an invitation`
    });
    queueInvitationAcceptedEmail(content, invitation, artist);
    trimOperationalLogs(content);
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

  if (type === "portfolio-page") {
    return content.portfolioPages;
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

  ["artist", "gallery", "artwork", "portfolio-page"].forEach((type) => {
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

  addNotification(content, {
    audience: "admin",
    type: "review_submitted",
    title: "Artist item submitted",
    message: `${context.artist.name} submitted ${type}: ${recordTitle(record, type)}.`,
    link: "/admin/review/",
    relatedType: type,
    relatedId: record.id
  });
  addNotification(content, {
    audience: "artist",
    artistId: context.artist.id,
    type: "review_submitted",
    title: "Submitted for review",
    message: `${recordTitle(record, type)} is now waiting for admin review.`,
    link: "/artist/",
    relatedType: type,
    relatedId: record.id
  });
  addAuditEvent(content, {
    actorType: "artist",
    actorId: context.account.email,
    action: "review.submitted",
    targetType: type,
    targetId: record.id,
    summary: `${recordTitle(record, type)} submitted for review`
  });
  if (type === "portfolio-page") {
    addAuditEvent(content, {
      actorType: "artist",
      actorId: context.account.email,
      action: "portfolioPage.submitted",
      targetType: "portfolio-page",
      targetId: record.id,
      summary: `Portfolio page submitted for review: ${recordTitle(record, type)}`
    });
  }
  queueReviewSubmittedEmail(content, type, record);
  trimOperationalLogs(content);
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

  if (action === "published" && (type === "gallery" || type === "artwork")) {
    const artistId = reviewRecordArtistId(record, type);
    const artist = content.artists.find((item) => item.id === artistId);
    const limitResult = enforceArtistLimit(content, artistId, type === "gallery" ? "publish_gallery" : "publish_artwork", {
      alreadyPublished: record.status === "published"
    });
    if (!limitResult.ok) {
      recordLimitBlocked(content, artist, `${type}_publish`, limitResult, "admin", session?.email || adminEmail);
      trimOperationalLogs(content);
      saveContent(content, "review-limit-blocked");
      return {
        ok: false,
        statusCode: limitResult.statusCode,
        message: limitResult.message,
        content
      };
    }
  }

  const now = nowIso();
  transitionReviewRecord(content, type, record, action, session?.email || adminEmail, note, {
    reviewedAt: now,
    reviewedByAdminId: session?.email || adminEmail,
    adminReviewNote: note,
    reviewUpdatedAt: now,
    ...(type === "portfolio-page" && action === "published" ? { publishedAt: now } : {})
  });

  const artistId = reviewRecordArtistId(record, type);
  addNotification(content, {
    audience: "artist",
    artistId,
    type: action === "changes_requested" ? "changes_requested" : "published",
    title: action === "changes_requested" ? "Changes requested" : "Review updated",
    message: `${recordTitle(record, type)} was marked ${action}.`,
    link: "/artist/",
    relatedType: type,
    relatedId: record.id
  });
  addAuditEvent(content, {
    actorType: "admin",
    actorId: session?.email || adminEmail,
    action: `review.${action}`,
    targetType: type,
    targetId: record.id,
    summary: `${recordTitle(record, type)} marked ${action}`
  });
  if (type === "portfolio-page") {
    addAuditEvent(content, {
      actorType: "admin",
      actorId: session?.email || adminEmail,
      action: `portfolioPage.${action}`,
      targetType: "portfolio-page",
      targetId: record.id,
      summary: `Portfolio page marked ${action}: ${recordTitle(record, type)}`
    });
  }
  queueReviewDecisionEmail(content, type, record, action, note);
  trimOperationalLogs(content);
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
  const {
    passwordResetTokens,
    adminAccounts,
    artistAccounts,
    ...safeContent
  } = content;

  return {
    ...safeContent,
    emailStatus: emailServiceStatus(),
    billingStatus: stripeReadiness(content),
    artistBilling: content.artists.map((artist) => ({
      artistId: artist.id,
      plan: artistPlan(content, artist),
      usage: artistUsage(content, artist.id),
      usageEvaluation: usageEvaluation(content, artist),
      warnings: usageEvaluation(content, artist).warnings
    })),
    billingEvents: (content.billingEvents || []).slice(-100).reverse(),
    adminAccounts: (adminAccounts || []).map((account) => ({
      id: account.id,
      email: account.email,
      status: account.status,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt
    })),
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
    })),
    emailLog: (content.emailLog || []).map((email) => ({
      id: email.id,
      to: email.to,
      subject: email.subject,
      template: email.template,
      status: email.status,
      provider: email.provider,
      bodyText: email.bodyText,
      createdAt: email.createdAt
    }))
  };
}

function getArtistContext(request) {
  const session = getArtistSession(request);
  if (!session?.artistId || session.role !== "artist") {
    return null;
  }

  const content = loadContent();
  let account = content.artistAccounts.find((item) =>
    item.artistId === session.artistId &&
    item.email === session.email &&
    item.status !== "archived"
  );
  const artist = content.artists.find((item) => item.id === session.artistId);

  if (!artist) {
    return null;
  }

  if (session.supportMode) {
    const adminSession = getSession(request);
    if (!adminSession || adminSession.email !== session.adminEmail) {
      return null;
    }

    account = account || {
      id: `support-account-${artist.id}`,
      artistId: artist.id,
      email: session.email || artist.contactEmail || adminSession.email,
      status: "support",
      demo: Boolean(artist.demo),
      createdAt: artist.createdAt,
      updatedAt: artist.updatedAt
    };

    return {
      account,
      artist,
      content,
      support: {
        active: true,
        adminEmail: adminSession.email,
        artistEmail: account.email,
        returnTo: session.returnTo || "/admin/users/",
        note: session.supportNote || ""
      }
    };
  }

  if (!account) {
    return null;
  }

  return { account, artist, content };
}

function artistScopedMedia(content, artist, galleries, artwork) {
  const portfolioPages = content.portfolioPages.filter((page) => page.artistId === artist.id && page.status !== "archived");
  const paths = new Set([
    artist.heroImage,
    artist.profileImage,
    ...galleries.map((gallery) => gallery.coverImage),
    ...artwork.map((item) => item.image),
    ...portfolioPages.map((page) => page.featuredImage)
  ].filter(Boolean));
  const mediaIds = new Set(portfolioPages.flatMap((page) => page.mediaIds || []));
  const mediaRecords = content.media.filter((media) =>
    mediaIds.has(media.id) ||
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
  const portfolioPages = context.content.portfolioPages
    .filter((page) => page.artistId === context.artist.id && page.status !== "archived")
    .sort(sortByDisplayOrder);
  const ownedIds = new Set([
    context.artist.id,
    ...galleries.map((gallery) => gallery.id),
    ...artwork.map((item) => item.id),
    ...portfolioPages.map((page) => page.id)
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
    plans: activePlans(context.content).map(artistPlanOption),
    billing: billingSnapshot(context.content, context.artist),
    galleries,
    artwork,
    portfolioPages,
    media: artistScopedMedia(context.content, context.artist, galleries, artwork),
    inquiries: artistScopedInquiries(context.content, context.artist.id),
    notifications: context.content.notifications
      .filter((notification) => notification.audience === "artist" && notification.artistId === context.artist.id)
      .map(notificationSafe),
    statusHistory: context.content.statusHistory.filter((entry) => ownedIds.has(entry.recordId)),
    support: context.support || { active: false }
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

function markNotificationRead(content, id, scope = {}) {
  const notification = content.notifications.find((item) => item.id === id);
  if (!notification) {
    return { ok: false, statusCode: 404, message: "Notification was not found." };
  }

  if (scope.artistId && (notification.audience !== "artist" || notification.artistId !== scope.artistId)) {
    return { ok: false, statusCode: 404, message: "Notification was not found." };
  }

  notification.readAt = notification.readAt || nowIso();
  return { ok: true, statusCode: 200, message: "Notification marked as read.", notification };
}

async function createStripeCheckoutForArtist(context, input = {}) {
  const content = loadContent();
  const artist = content.artists.find((item) => item.id === context.artist.id);
  const account = content.artistAccounts.find((item) => item.artistId === context.artist.id && item.email === context.account.email);
  const plan = planById(content, cleanString(input.planId)) || artistPlan(content, artist);
  const interval = cleanString(input.interval) === "annual" ? "annual" : "monthly";
  const readiness = stripeReadiness(content);
  const priceId = planStripePriceId(plan, interval);

  if (!artist || !account) {
    return { ok: false, statusCode: 401, message: "Artist login required." };
  }

  if (!readiness.checkoutAvailable) {
    return { ok: false, statusCode: 400, message: "Online billing is not enabled yet. Please contact The Galleria.Art." };
  }

  if (!priceId) {
    return { ok: false, statusCode: 422, message: "This plan does not have a Stripe price ID yet." };
  }

  try {
    const session = await stripeRequest("/checkout/sessions", {
      mode: "subscription",
      success_url: stripeSuccessUrl,
      cancel_url: stripeCancelUrl,
      customer: artist.externalCustomerId || "",
      customer_email: artist.externalCustomerId ? "" : account.email,
      client_reference_id: artist.id,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      "metadata[artistId]": artist.id,
      "metadata[accountEmail]": account.email,
      "metadata[planId]": plan.id,
      "metadata[interval]": interval,
      "subscription_data[metadata][artistId]": artist.id,
      "subscription_data[metadata][planId]": plan.id
    });

    addBillingEvent(content, {
      type: "checkout.session.created",
      artistId: artist.id,
      accountEmail: account.email,
      status: "created",
      message: `Created Stripe Checkout session for ${plan.name}.`,
      providerEventId: session.id
    });
    addAuditEvent(content, {
      actorType: "artist",
      actorId: account.email,
      action: "checkout.session.created",
      targetType: "artist",
      targetId: artist.id,
      summary: `Created Stripe Checkout session for ${artist.name}`
    });
    trimOperationalLogs(content);
    saveContent(content, "stripe-checkout-session");
    return { ok: true, statusCode: 200, message: "Checkout session created.", redirectUrl: session.url };
  } catch (error) {
    addBillingEvent(content, {
      type: "checkout.session.error",
      artistId: artist.id,
      accountEmail: account.email,
      status: "error",
      message: "Stripe Checkout session could not be created.",
      error: error.message
    });
    trimOperationalLogs(content);
    saveContent(content, "stripe-checkout-error");
    return { ok: false, statusCode: 502, message: error.message || "Stripe Checkout is not available." };
  }
}

async function createStripePortalForArtist(context) {
  const content = loadContent();
  const artist = content.artists.find((item) => item.id === context.artist.id);
  const account = content.artistAccounts.find((item) => item.artistId === context.artist.id && item.email === context.account.email);
  const readiness = stripeReadiness(content);

  if (!artist || !account) {
    return { ok: false, statusCode: 401, message: "Artist login required." };
  }

  if (!readiness.portalAvailable || !artist.externalCustomerId) {
    return { ok: false, statusCode: 400, message: "Manage Billing is not available yet. Please contact The Galleria.Art." };
  }

  try {
    const session = await stripeRequest("/billing_portal/sessions", {
      customer: artist.externalCustomerId,
      return_url: stripePortalReturnUrl
    });
    addBillingEvent(content, {
      type: "billing_portal.session.created",
      artistId: artist.id,
      accountEmail: account.email,
      status: "created",
      message: "Created Stripe Customer Portal session.",
      providerEventId: session.id
    });
    addAuditEvent(content, {
      actorType: "artist",
      actorId: account.email,
      action: "billing_portal.session.created",
      targetType: "artist",
      targetId: artist.id,
      summary: `Created Stripe Customer Portal session for ${artist.name}`
    });
    trimOperationalLogs(content);
    saveContent(content, "stripe-portal-session");
    return { ok: true, statusCode: 200, message: "Customer portal session created.", redirectUrl: session.url };
  } catch (error) {
    addBillingEvent(content, {
      type: "billing_portal.session.error",
      artistId: artist.id,
      accountEmail: account.email,
      status: "error",
      message: "Stripe Customer Portal session could not be created.",
      error: error.message
    });
    trimOperationalLogs(content);
    saveContent(content, "stripe-portal-error");
    return { ok: false, statusCode: 502, message: error.message || "Stripe Customer Portal is not available." };
  }
}

function findArtistForStripeObject(content, object = {}) {
  const metadata = object.metadata || {};
  const artistId = cleanString(metadata.artistId || object.client_reference_id);
  if (artistId) {
    const artist = content.artists.find((item) => item.id === artistId);
    if (artist) {
      return artist;
    }
  }

  const customerId = cleanString(object.customer);
  const subscriptionId = cleanString(object.subscription || object.id);
  return content.artists.find((artist) =>
    (customerId && artist.externalCustomerId === customerId) ||
    (subscriptionId && artist.externalSubscriptionId === subscriptionId)
  ) || null;
}

function applyStripeSubscriptionToArtist(content, artist, subscription = {}) {
  if (!artist) {
    return;
  }

  const priceId = subscription.items?.data?.[0]?.price?.id || "";
  const matchedPlan = findPlanByStripePrice(content, priceId);
  const subscriptionStatus = cleanString(subscription.status || "none");

  artist.externalCustomerId = cleanString(subscription.customer || artist.externalCustomerId);
  artist.externalSubscriptionId = cleanString(subscription.id || artist.externalSubscriptionId);
  artist.subscriptionStatus = hasValidSubscriptionStatus(subscriptionStatus) ? subscriptionStatus : "none";
  artist.billingStatus = billingStatusFromSubscriptionStatus(subscriptionStatus);
  artist.currentPeriodStart = isoFromUnix(subscription.current_period_start);
  artist.currentPeriodEnd = isoFromUnix(subscription.current_period_end);
  artist.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  artist.trialStartAt = isoFromUnix(subscription.trial_start) || artist.trialStartAt || "";
  artist.trialEndAt = isoFromUnix(subscription.trial_end) || artist.trialEndAt || "";
  artist.planId = matchedPlan?.id || artist.planId;
  artist.updatedAt = nowIso();
}

function handleStripeWebhookEvent(content, event) {
  const object = event?.data?.object || {};
  let artist = findArtistForStripeObject(content, object);
  let status = "received";
  let message = `Received ${event.type}.`;

  if (event.type === "checkout.session.completed") {
    artist = artist || findArtistForStripeObject(content, {
      ...object,
      metadata: object.metadata || {},
      client_reference_id: object.client_reference_id
    });
    if (artist) {
      artist.externalCustomerId = cleanString(object.customer || artist.externalCustomerId);
      artist.externalSubscriptionId = cleanString(object.subscription || artist.externalSubscriptionId);
      const plan = planById(content, cleanString(object.metadata?.planId));
      artist.planId = plan?.id || artist.planId;
      artist.billingStatus = object.payment_status === "paid" ? "active" : artist.billingStatus || "trial";
      artist.subscriptionStatus = object.subscription ? "active" : artist.subscriptionStatus || "none";
      artist.updatedAt = nowIso();
      status = "updated";
      message = `Checkout completed for ${artist.name}.`;
    }
  }

  if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    if (artist) {
      applyStripeSubscriptionToArtist(content, artist, object);
      status = "updated";
      message = `Subscription ${cleanString(object.status || "updated")} for ${artist.name}.`;
    }
  }

  if (event.type === "invoice.payment_succeeded" && artist) {
    artist.billingStatus = "active";
    artist.subscriptionStatus = artist.subscriptionStatus === "trialing" ? "active" : artist.subscriptionStatus || "active";
    artist.updatedAt = nowIso();
    status = "updated";
    message = `Invoice payment succeeded for ${artist.name}.`;
  }

  if (event.type === "invoice.payment_failed" && artist) {
    artist.billingStatus = "past_due";
    artist.subscriptionStatus = "past_due";
    artist.updatedAt = nowIso();
    status = "updated";
    message = `Invoice payment failed for ${artist.name}.`;
  }

  addBillingEvent(content, {
    type: event.type,
    artistId: artist?.id || "",
    accountEmail: artist?.contactEmail || "",
    status,
    message,
    providerEventId: event.id
  });
  addAuditEvent(content, {
    actorType: "stripe",
    actorId: "stripe",
    action: "stripe.webhook.received",
    targetType: artist ? "artist" : "billing",
    targetId: artist?.id || event.id || "",
    summary: message,
    metadata: {
      eventId: event.id || "",
      eventType: event.type || ""
    }
  });
}

function handleStripeWebhook(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  collectBody(request, (body) => {
    const verification = verifyStripeSignature(body, request.headers["stripe-signature"]);
    const content = loadContent();

    if (!verification.ok) {
      addBillingEvent(content, {
        type: "stripe.webhook.rejected",
        status: "rejected",
        message: "Rejected Stripe webhook.",
        error: verification.message
      });
      trimOperationalLogs(content);
      saveContent(content, "stripe-webhook-rejected");
      sendJson(response, 400, { ok: false, message: verification.message });
      return;
    }

    let event;
    try {
      event = JSON.parse(body);
    } catch (error) {
      sendJson(response, 400, { ok: false, message: "Invalid Stripe webhook JSON." });
      return;
    }

    handleStripeWebhookEvent(content, event);
    trimOperationalLogs(content);
    saveContent(content, "stripe-webhook");
    sendJson(response, 200, { ok: true, received: true });
  });
}

function exportPublicContent(content) {
  return buildPublicData(content);
}

function exportOperationalContent(content) {
  const safe = publicSafeContent(content);
  return {
    exportedAt: nowIso(),
    artists: safe.artists,
    galleries: safe.galleries,
    artwork: safe.artwork,
    media: safe.media,
    inquiries: safe.inquiries,
    invitations: safe.invitations.map((invitation) => ({
      ...invitation,
      token: invitation.token ? "[redacted]" : ""
    })),
    notifications: safe.notifications,
    emailLog: safe.emailLog,
    auditLog: safe.auditLog,
    statusHistory: safe.statusHistory
  };
}

function sendExportJson(response, filename, payload) {
  response.writeHead(200, secureHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store"
  }));
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
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
      addAuditEvent(content, {
        actorType: "artist",
        actorId: email,
        action: "auth.login.success",
        targetType: "artist",
        targetId: account.artistId,
        summary: "Artist login successful"
      });
      trimOperationalLogs(content);
      saveContent(content, "artist-login");
      redirect(response, "/artist/", 303, {
        "Set-Cookie": createArtistSessionCookie(account, request)
      });
      return;
    }

    addAuditEvent(content, {
      actorType: "artist",
      actorId: email,
      action: "auth.login.failure",
      targetType: "artist",
      targetId: "",
      summary: "Artist login failed"
    });
    trimOperationalLogs(content);
    saveContent(content, "artist-login-failed");
    redirect(response, "/artist/login/?error=1");
  });
}

function supportAuditActor(context) {
  if (!context.support?.active) {
    return null;
  }

  return {
    actorType: "admin_support",
    actorId: context.support.adminEmail,
    metadata: {
      artistEmail: context.support.artistEmail || context.account.email,
      note: context.support.note || ""
    }
  };
}

function updateArtistProfile(context, input) {
  const content = context.content;
  const artist = content.artists.find((item) => item.id === context.artist.id);
  const errors = [];
  const contactEmail = cleanString(input.contactEmail);
  const heroImage = cleanString(input.heroImage);
  const slug = normalizeSlug(input.slug || artist.slug);
  const socialImage = cleanString(input.socialImage || artist.socialImage);

  if (!cleanString(input.name)) {
    errors.push("Artist name is required.");
  }

  if (!slug) {
    errors.push("Public URL slug is required.");
  }

  if (slug && isReservedPublicSlug(slug)) {
    errors.push("Public URL slug is reserved.");
  }

  if (slug && content.artists.some((item) => item.id !== artist.id && item.slug === slug)) {
    errors.push("Public URL slug is already in use.");
  }

  if (!isValidEmail(contactEmail)) {
    errors.push("Contact email is not valid.");
  }

  if (heroImage && (!isValidImageReference(heroImage) || !isArtistAllowedImageReference(context, heroImage))) {
    errors.push("Hero image must be a ready uploaded image, existing image path, or image URL.");
  }

  if (socialImage && (!isValidImageReference(socialImage) || !canUseImageForMeta(content, socialImage, [heroImage, artist.heroImage]))) {
    errors.push("Social image must be a ready uploaded image or existing public image.");
  }

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  const previousSlug = artist.slug;
  const canonicalPath = slug === "carolyn-elaine" ? "/carolyn-elaine/" : `/${slug}/`;
  Object.assign(artist, {
    name: cleanString(input.name),
    slug,
    publicPath: canonicalPath,
    canonicalPath,
    customUrlLabel: cleanString(input.customUrlLabel || artist.customUrlLabel),
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
    seoTitle: cleanLimitedString(input.seoTitle || artist.seoTitle, 90),
    seoDescription: cleanLimitedString(input.seoDescription || artist.seoDescription, 180),
    socialTitle: cleanLimitedString(input.socialTitle || artist.socialTitle, 90),
    socialDescription: cleanLimitedString(input.socialDescription || artist.socialDescription, 220),
    socialImage,
    canonicalUrlOverride: cleanString(input.canonicalUrlOverride || artist.canonicalUrlOverride),
    noindex: parseBoolean(input.noindex ?? artist.noindex),
    status: ["published", "approved"].includes(artist.status) ? "draft" : artist.status,
    adminReviewNote: "",
    updatedAt: nowIso()
  });

  if (previousSlug !== artist.slug) {
    content.galleries
      .filter((gallery) => gallery.artistId === artist.id)
      .forEach((gallery) => {
        gallery.publicPath = `/${artist.slug}/${gallery.slug}/`;
        gallery.canonicalPath = gallery.publicPath;
        gallery.updatedAt = nowIso();
      });
    addAuditEvent(content, {
      actorType: context.support?.active ? "admin_support" : "artist",
      actorId: context.support?.adminEmail || context.account.email,
      action: "artist.slug.changed",
      targetType: "artist",
      targetId: artist.id,
      summary: `Artist slug changed from ${previousSlug} to ${artist.slug}`
    });
  }

  addAuditEvent(content, {
    actorType: context.support?.active ? "admin_support" : "artist",
    actorId: context.support?.adminEmail || context.account.email,
    action: "artist.seo.updated",
    targetType: "artist",
    targetId: artist.id,
    summary: `Artist profile SEO fields updated for ${artist.name}`
  });

  const supportActor = supportAuditActor(context);
  if (supportActor) {
    addAuditEvent(content, {
      ...supportActor,
      action: "support.artist_profile.updated",
      targetType: "artist",
      targetId: artist.id,
      summary: `Support updated profile for ${artist.name}`
    });
    trimOperationalLogs(content);
  }
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

  const slug = normalizeSlug(input.slug || gallery.slug);
  if (!slug) {
    errors.push("Gallery slug is required.");
  }

  if (slug && isReservedPublicSlug(slug)) {
    errors.push("Gallery slug is reserved.");
  }

  if (slug && content.galleries.some((item) => item.id !== gallery.id && item.artistId === context.artist.id && item.slug === slug)) {
    errors.push("Gallery slug is already in use.");
  }

  const coverImage = cleanString(input.coverImage);
  const socialImage = cleanString(input.socialImage || gallery.socialImage);
  if (coverImage && (!isValidImageReference(coverImage) || !isArtistAllowedImageReference(context, coverImage))) {
    errors.push("Cover image must be a ready uploaded image, existing image path, or image URL.");
  }

  if (socialImage && (!isValidImageReference(socialImage) || !canUseImageForMeta(content, socialImage, [coverImage, context.artist.heroImage]))) {
    errors.push("Social image must be a ready uploaded image or existing public image.");
  }

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors };
  }

  const previousSlug = gallery.slug;
  Object.assign(gallery, {
    title: cleanString(input.title),
    slug,
    publicPath: publicPathForGallery(context.artist, { slug }),
    canonicalPath: publicPathForGallery(context.artist, { slug }),
    customUrlLabel: cleanString(input.customUrlLabel || gallery.customUrlLabel),
    description: cleanString(input.description),
    coverImage,
    seoTitle: cleanLimitedString(input.seoTitle || gallery.seoTitle, 90),
    seoDescription: cleanLimitedString(input.seoDescription || gallery.seoDescription, 180),
    socialTitle: cleanLimitedString(input.socialTitle || gallery.socialTitle, 90),
    socialDescription: cleanLimitedString(input.socialDescription || gallery.socialDescription, 220),
    socialImage,
    canonicalUrlOverride: cleanString(input.canonicalUrlOverride || gallery.canonicalUrlOverride),
    noindex: parseBoolean(input.noindex ?? gallery.noindex),
    status: ["published", "approved"].includes(gallery.status) ? "draft" : gallery.status,
    adminReviewNote: "",
    displayOrder: Number(input.displayOrder || 0),
    updatedAt: nowIso()
  });

  if (previousSlug !== gallery.slug) {
    addAuditEvent(content, {
      actorType: context.support?.active ? "admin_support" : "artist",
      actorId: context.support?.adminEmail || context.account.email,
      action: "gallery.slug.changed",
      targetType: "gallery",
      targetId: gallery.id,
      summary: `Gallery slug changed from ${previousSlug} to ${gallery.slug}`
    });
  }

  addAuditEvent(content, {
    actorType: context.support?.active ? "admin_support" : "artist",
    actorId: context.support?.adminEmail || context.account.email,
    action: "gallery.seo.updated",
    targetType: "gallery",
    targetId: gallery.id,
    summary: `Gallery SEO fields updated for ${gallery.title}`
  });

  const supportActor = supportAuditActor(context);
  if (supportActor) {
    addAuditEvent(content, {
      ...supportActor,
      action: "support.gallery.updated",
      targetType: "gallery",
      targetId: gallery.id,
      summary: `Support updated gallery ${gallery.title}`
    });
    trimOperationalLogs(content);
  }
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

  const supportActor = supportAuditActor(context);
  if (supportActor) {
    addAuditEvent(content, {
      ...supportActor,
      action: "support.artwork.updated",
      targetType: "artwork",
      targetId: artwork.id,
      summary: `Support updated artwork ${artwork.title}`
    });
    trimOperationalLogs(content);
  }
  saveContent(content, "artist-artwork-save");
  return { ok: true, statusCode: 200, message: "Artwork saved.", context: { ...context, content } };
}

function upsertArtistPortfolioPage(context, id, input) {
  const content = loadContent();
  const existing = id ? content.portfolioPages.find((page) => page.id === id && page.artistId === context.artist.id) : null;
  const statusInput = existing?.status === "published" || existing?.status === "approved" ? "draft" : (input.status || existing?.status || "draft");
  const { errors, record } = validatePortfolioPage({ ...input, status: statusInput }, content, existing, { artistId: context.artist.id });

  if (errors.length) {
    return { ok: false, statusCode: 422, message: "Please fix the highlighted fields.", errors, content };
  }

  record.artistId = context.artist.id;
  record.adminReviewNote = "";
  if (existing) {
    const index = content.portfolioPages.findIndex((page) => page.id === existing.id);
    content.portfolioPages[index] = { ...existing, ...record, protected: existing.protected };
  } else {
    content.portfolioPages.push(record);
  }

  addAuditEvent(content, {
    actorType: context.support?.active ? "admin_support" : "artist",
    actorId: context.support?.adminEmail || context.account.email,
    action: existing ? "portfolioPage.updated" : "portfolioPage.created",
    targetType: "portfolio-page",
    targetId: record.id,
    summary: `${existing ? "Updated" : "Created"} portfolio page ${record.title}`
  });
  if (existing && Number(existing.displayOrder || 0) !== Number(record.displayOrder || 0)) {
    addAuditEvent(content, {
      actorType: context.support?.active ? "admin_support" : "artist",
      actorId: context.support?.adminEmail || context.account.email,
      action: "portfolioPage.reordered",
      targetType: "portfolio-page",
      targetId: record.id,
      summary: `Portfolio page reordered: ${record.title}`
    });
  }
  if (context.support?.active) {
    addAuditEvent(content, {
      actorType: "admin_support",
      actorId: context.support.adminEmail,
      action: "support.portfolioPage.updated",
      targetType: "portfolio-page",
      targetId: record.id,
      summary: `Support edited portfolio page ${record.title}`
    });
  }
  trimOperationalLogs(content);
  saveContent(content, "artist-portfolio-page-save");
  return { ok: true, statusCode: 200, message: "Portfolio page saved.", content };
}

async function handleArtistApi(request, response, pathname) {
  const context = requireArtistForApi(request, response);
  if (!context) {
    return;
  }

  if (request.method === "GET" && pathname === "/artist/api/content") {
    sendArtistPortalContent(response, context);
    return;
  }

  if (request.method === "POST" && pathname === "/artist/api/billing/checkout") {
    collectJson(request, response, async (input) => {
      const result = await createStripeCheckoutForArtist(context, input);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        redirectUrl: result.redirectUrl || "",
        content: buildArtistPortalContent(result.context || context)
      });
    });
    return;
  }

  if (request.method === "POST" && pathname === "/artist/api/billing/portal") {
    const result = await createStripePortalForArtist(context);
    sendJson(response, result.statusCode, {
      ok: result.ok,
      message: result.message,
      redirectUrl: result.redirectUrl || "",
      content: buildArtistPortalContent(context)
    });
    return;
  }

  const artistNotificationReadMatch = pathname.match(/^\/artist\/api\/notifications\/([^/]+)\/read$/);
  if (request.method === "POST" && artistNotificationReadMatch) {
    const content = loadContent();
    const result = markNotificationRead(content, decodeURIComponent(artistNotificationReadMatch[1]), { artistId: context.artist.id });
    if (result.ok) {
      saveContent(content, "artist-notification-read");
    }
    sendJson(response, result.statusCode, {
      ok: result.ok,
      message: result.message,
      content: buildArtistPortalContent({ ...context, content })
    });
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

  const portfolioPageMatch = pathname.match(/^\/artist\/api\/portfolio-pages\/([^/]+)$/);
  if (request.method === "POST" && portfolioPageMatch) {
    collectJson(request, response, (input) => {
      const pageId = decodeURIComponent(portfolioPageMatch[1]);
      const result = upsertArtistPortfolioPage(context, pageId === "new" ? "" : pageId, input);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        errors: result.errors || [],
        content: result.content ? buildArtistPortalContent({ ...context, content: result.content }) : buildArtistPortalContent(context)
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

  const reviewSubmitMatch = pathname.match(/^\/artist\/api\/review\/(artist|gallery|artwork|portfolio-page)\/([^/]+)\/submit$/);
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

function startSupportSession(request, response, artistId, adminSession, input = {}) {
  const content = loadContent();
  const artist = content.artists.find((item) => item.id === artistId && item.status !== "archived");

  if (!artist) {
    sendJson(response, 404, { ok: false, message: "Artist was not found." });
    return;
  }

  const account = content.artistAccounts.find((item) =>
    item.artistId === artist.id &&
    item.status !== "archived"
  ) || null;
  const note = cleanLimitedString(input.note || "", 700);
  const returnTo = cleanString(input.returnTo || input.sourcePage || "/admin/users/");

  addAuditEvent(content, {
    actorType: "admin",
    actorId: adminSession.email,
    action: "support.access.started",
    targetType: "artist",
    targetId: artist.id,
    summary: `Support access started for ${artist.name}`,
    metadata: {
      artistEmail: account?.email || artist.contactEmail || "",
      sourcePage: cleanString(input.sourcePage || "/admin/users/"),
      note
    }
  });
  trimOperationalLogs(content);
  saveContent(content, "support-access-started");

  sendJson(response, 200, {
    ok: true,
    message: "Support mode started.",
    redirectUrl: "/artist/",
    content: publicSafeContent(content)
  }, {
    "Set-Cookie": createSupportArtistSessionCookie(adminSession, artist, account, request, { note, returnTo })
  });
}

function exitSupportSession(request, response) {
  const artistSession = getArtistSession(request);
  const adminSession = getSession(request);

  if (!artistSession?.supportMode || !adminSession || adminSession.email !== artistSession.adminEmail) {
    redirect(response, "/artist/", 303);
    return;
  }

  const content = loadContent();
  const artist = content.artists.find((item) => item.id === artistSession.artistId);
  addAuditEvent(content, {
    actorType: "admin",
    actorId: adminSession.email,
    action: "support.access.ended",
    targetType: "artist",
    targetId: artistSession.artistId || "",
    summary: `Support access ended${artist ? ` for ${artist.name}` : ""}`,
    metadata: {
      artistEmail: artistSession.email || artist?.contactEmail || "",
      sourcePage: artistSession.returnTo || "/admin/users/",
      note: artistSession.supportNote || ""
    }
  });
  trimOperationalLogs(content);
  saveContent(content, "support-access-ended");

  redirect(response, artistSession.returnTo || "/admin/users/", 303, {
    "Set-Cookie": clearSessionCookie(artistSessionCookieName)
  });
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

  if (request.method === "GET" && pathname === "/admin/api/exports/public.json") {
    sendExportJson(response, "galleria-public-content.json", exportPublicContent(loadContent()));
    return;
  }

  if (request.method === "GET" && pathname === "/admin/api/exports/operational.json") {
    sendExportJson(response, "galleria-operational-backup.json", exportOperationalContent(loadContent()));
    return;
  }

  if (request.method === "GET" && pathname === "/admin/api/exports/inquiries.json") {
    const content = loadContent();
    sendExportJson(response, "galleria-inquiries.json", {
      exportedAt: nowIso(),
      inquiries: content.inquiries || []
    });
    return;
  }

  const adminNotificationReadMatch = pathname.match(/^\/admin\/api\/notifications\/([^/]+)\/read$/);
  if (request.method === "POST" && adminNotificationReadMatch) {
    const content = loadContent();
    const result = markNotificationRead(content, decodeURIComponent(adminNotificationReadMatch[1]));
    if (result.ok) {
      saveContent(content, "admin-notification-read");
    }
    sendJson(response, result.statusCode, {
      ok: result.ok,
      message: result.message,
      content: publicSafeContent(content)
    });
    return;
  }

  if (request.method === "POST" && pathname === "/admin/api/media/upload") {
    handleMediaUpload(request, response, { uploadedBy: "admin" });
    return;
  }

  const supportStartMatch = pathname.match(/^\/admin\/api\/support\/artist\/([^/]+)\/start$/);
  if (request.method === "POST" && supportStartMatch) {
    collectJson(request, response, (input) => {
      startSupportSession(request, response, decodeURIComponent(supportStartMatch[1]), adminSession, input);
    });
    return;
  }

  if (request.method === "POST" && pathname === "/admin/api/plans") {
    collectJson(request, response, (input) => {
      const result = upsertPlan(input, adminSession);
      sendJson(response, result.statusCode, {
        ok: result.ok,
        message: result.message,
        errors: result.errors || [],
        content: publicSafeContent(result.content || loadContent())
      });
    });
    return;
  }

  const saveMatch = pathname.match(/^\/admin\/api\/(artists|galleries|artwork|portfolio-pages)$/);
  if (request.method === "POST" && saveMatch) {
    const resource = saveMatch[1] === "artists" ? "artist" : saveMatch[1] === "galleries" ? "gallery" : saveMatch[1] === "portfolio-pages" ? "portfolioPage" : "artwork";
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

  const archiveMatch = pathname.match(/^\/admin\/api\/(artists|galleries|artwork|portfolio-pages)\/([^/]+)\/archive$/);
  if (request.method === "POST" && archiveMatch) {
    const resource = archiveMatch[1] === "artists" ? "artist" : archiveMatch[1] === "galleries" ? "gallery" : archiveMatch[1] === "portfolio-pages" ? "portfolioPage" : "artwork";
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

  const reviewActionMatch = pathname.match(/^\/admin\/api\/review\/(artist|gallery|artwork|portfolio-page)\/([^/]+)$/);
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
  sendHtml(response, 200, renderPublicArtistPage(artist, { noindex: true }).replace("</body>", '<div class="preview-ribbon">Private Preview</div></body>'));
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

    if (verifyAdminPassword(email, password)) {
      const content = loadContent();
      addAuditEvent(content, {
        actorType: "admin",
        actorId: email,
        action: "auth.login.success",
        targetType: "admin",
        targetId: email,
        summary: "Admin login successful"
      });
      trimOperationalLogs(content);
      saveContent(content, "admin-login");
      redirect(response, "/admin/", 303, {
        "Set-Cookie": createSessionCookie(email, request)
      });
      return;
    }

    const content = loadContent();
    addAuditEvent(content, {
      actorType: "admin",
      actorId: email,
      action: "auth.login.failure",
      targetType: "admin",
      targetId: email,
      summary: "Admin login failed"
    });
    trimOperationalLogs(content);
    saveContent(content, "admin-login-failed");
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

  if (request.method === "GET" && pathname === "/sitemap.xml") {
    sendSitemap(response);
    return;
  }

  if (request.method === "GET" && pathname === "/robots.txt") {
    sendRobots(response);
    return;
  }

  if ((request.method === "GET" || request.method === "HEAD") && (pathname === "/pricing/" || pathname === "/pricing")) {
    if (pathname === "/pricing") {
      redirect(response, "/pricing/", 301);
      return;
    }
    sendPricingPage(response);
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

  if (request.method === "POST" && pathname === "/artist/support/exit") {
    exitSupportSession(request, response);
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

  if (pathname === "/api/stripe/webhook") {
    handleStripeWebhook(request, response);
    return;
  }

  if (pathname === "/password-reset") {
    redirect(response, "/password-reset/", 301);
    return;
  }

  if (pathname === "/password-reset/" && request.method === "GET") {
    sendHtml(response, 200, renderPasswordResetRequestPage());
    return;
  }

  if (pathname === "/password-reset/" && request.method === "POST") {
    handlePasswordResetRequest(request, response);
    return;
  }

  const passwordResetMatch = pathname.match(/^\/password-reset\/([^/]+)\/?$/);
  if (passwordResetMatch && request.method === "GET") {
    sendPasswordResetForm(response, decodeURIComponent(passwordResetMatch[1]));
    return;
  }

  if (passwordResetMatch && request.method === "POST") {
    handlePasswordResetComplete(request, response, decodeURIComponent(passwordResetMatch[1]));
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
    response.writeHead(405, secureHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
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

  if ((request.method === "GET" || request.method === "HEAD") && sendRedirectForPath(response, pathname)) {
    return;
  }

  if (request.method === "GET" && sendPublicGalleryPage(response, pathname)) {
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
