#!/usr/bin/env node
/**
 * galleria-admin.js — minimal CLI for the thegalleria.art admin API.
 *
 * Built so Claude Code (or a human) can make CMS content changes
 * (artists / galleries / artwork / portfolio-pages) without opening
 * a browser. It logs in with form-based admin auth, keeps the session
 * cookie in memory for the duration of one invocation, and calls the
 * existing /admin/api/* routes in server.js.
 *
 * IMPORTANT — scope of this tool:
 *   - Carolyn Elaine's live portfolio at /carolyn-elaine/ is a STATIC
 *     file (public/carolyn-elaine/index.html) served directly from the
 *     repo, NOT part of the general CMS content model. Its title / meta
 *     line / description paragraph per artwork block ARE editable live
 *     through this script (see carolyn-get / carolyn-set below) — the
 *     server applies overrides at render time. Anything beyond those
 *     three fields (adding a whole new artwork section, swapping an
 *     image file, restructuring markup) still requires editing the HTML
 *     directly, committing, and `git push origin main` (Coolify
 *     auto-deploys on push).
 *   - Everything else (artists, galleries, artwork, portfolio-pages,
 *     invitations, media, plans) lives in content.json and IS reachable
 *     through this script.
 *
 * Auth:
 *   Set these env vars (do not hardcode credentials in this file):
 *     GALLERIA_BASE_URL      (default: https://thegalleria.art)
 *     GALLERIA_ADMIN_EMAIL
 *     GALLERIA_ADMIN_PASSWORD
 *
 * Usage:
 *   node scripts/galleria-admin.js content
 *   node scripts/galleria-admin.js save artwork '{"id":"artwork-...", "title":"..."}'
 *   node scripts/galleria-admin.js archive artwork artwork-123
 *   node scripts/galleria-admin.js export public
 *   node scripts/galleria-admin.js export operational
 *   node scripts/galleria-admin.js export inquiries
 *   node scripts/galleria-admin.js carolyn-get
 *   node scripts/galleria-admin.js carolyn-set gathered '{"title":"...", "meta":"...", "paragraph":"..."}'
 *
 * "save" accepts artists | galleries | artwork | portfolio-pages as the
 * record type (matches the server's POST /admin/api/(artists|galleries|
 * artwork|portfolio-pages) route). Include the record's existing "id"
 * field to update it, or omit it to create a new record — see
 * validateArtwork / equivalent validators in server.js for required
 * fields per type before writing a payload.
 *
 * "carolyn-set" accepts one of: whispers | tears | light | narrative |
 * bjs-mom | brookfield | gathered, matching the data-artwork-id
 * attribute on each section in public/carolyn-elaine/index.html. Payload
 * keys are title / meta / paragraph — include only the fields you want
 * to change, existing overridden fields are preserved.
 */

const BASE_URL = process.env.GALLERIA_BASE_URL || "https://thegalleria.art";
const EMAIL = process.env.GALLERIA_ADMIN_EMAIL;
const PASSWORD = process.env.GALLERIA_ADMIN_PASSWORD;

function usageAndExit(message) {
  if (message) console.error(message);
  console.error(
    "Usage: galleria-admin.js <content|save|archive|export> [args...]"
  );
  process.exit(1);
}

async function login() {
  if (!EMAIL || !PASSWORD) {
    usageAndExit(
      "Set GALLERIA_ADMIN_EMAIL and GALLERIA_ADMIN_PASSWORD env vars first."
    );
  }
  const body = new URLSearchParams({ email: EMAIL, password: PASSWORD });
  const res = await fetch(`${BASE_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual"
  });
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie || res.status !== 303) {
    throw new Error(
      `Login failed (status ${res.status}). Check credentials / that ADMIN_EMAIL, ADMIN_PASSWORD_HASH, ADMIN_PASSWORD_SALT are set in Coolify and the app was redeployed.`
    );
  }
  return setCookie.split(";")[0];
}

async function api(cookie, method, path, payload) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`Non-JSON response (status ${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`Request failed (status ${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const [, , command, ...args] = process.argv;
  if (!command) usageAndExit();

  const cookie = await login();

  if (command === "content") {
    const result = await api(cookie, "GET", "/admin/api/content");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "save") {
    const [type, jsonPayload] = args;
    if (!["artists", "galleries", "artwork", "portfolio-pages"].includes(type)) {
      usageAndExit("Type must be one of: artists, galleries, artwork, portfolio-pages");
    }
    if (!jsonPayload) usageAndExit("Provide a JSON payload string as the second argument.");
    const payload = JSON.parse(jsonPayload);
    const result = await api(cookie, "POST", `/admin/api/${type}`, payload);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "archive") {
    const [type, id] = args;
    if (!["artists", "galleries", "artwork", "portfolio-pages"].includes(type)) {
      usageAndExit("Type must be one of: artists, galleries, artwork, portfolio-pages");
    }
    if (!id) usageAndExit("Provide the record id as the second argument.");
    const result = await api(cookie, "POST", `/admin/api/${type}/${encodeURIComponent(id)}/archive`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "export") {
    const [name] = args;
    if (!["public", "operational", "inquiries"].includes(name)) {
      usageAndExit("Export name must be one of: public, operational, inquiries");
    }
    const result = await api(cookie, "GET", `/admin/api/exports/${name}.json`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "carolyn-get") {
    const result = await api(cookie, "GET", "/admin/api/carolyn-elaine/overrides");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "carolyn-set") {
    const [artworkId, jsonPayload] = args;
    const knownIds = ["whispers", "tears", "light", "narrative", "bjs-mom", "brookfield", "gathered"];
    if (!knownIds.includes(artworkId)) {
      usageAndExit(`artworkId must be one of: ${knownIds.join(", ")}`);
    }
    if (!jsonPayload) usageAndExit('Provide a JSON payload, e.g. \'{"title":"...","meta":"...","paragraph":"..."}\'');
    const payload = { artworkId, ...JSON.parse(jsonPayload) };
    const result = await api(cookie, "POST", "/admin/api/carolyn-elaine/overrides", payload);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  usageAndExit(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
