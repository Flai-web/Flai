/**
 * drive-folder-search.js — Netlify serverless function
 *
 * Searches a Google Drive folder for files whose name contains a given
 * customer name or booking ID, then returns the matching file(s) so the
 * admin can link one to a booking.
 *
 * ─── FLOW ────────────────────────────────────────────────────────────────────
 *
 *  GET /.netlify/functions/drive-folder-search?q=SEARCH_TERM&folderId=FOLDER_ID
 *
 *    → Authenticates with the service account
 *    → Lists files in the given folder whose name contains SEARCH_TERM
 *    → Returns an array of { id, name, size, mimeType, modifiedTime }
 *
 *  The folderId parameter is optional — if omitted, VITE_GOOGLE_DRIVE_PUBLIC_FOLDER_ID
 *  env var is used as the default public delivery folder.
 *
 * ─── ENV VARS ────────────────────────────────────────────────────────────────
 *
 *  GOOGLE_SERVICE_ACCOUNT_KEY      — full JSON blob (recommended) or bare PEM
 *  GOOGLE_SERVICE_ACCOUNT_EMAIL    — only if KEY is a bare PEM string
 *  VITE_GOOGLE_DRIVE_PUBLIC_FOLDER_ID — default folder to search in
 */

"use strict";

const { createSign, createPrivateKey } = require("crypto");

// ─── JWT / OAuth2 helpers ─────────────────────────────────────────────────────

function b64url(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function normalisePem(raw) {
  let pem = raw.replace(/\\n/g, "\n").replace(/\r/g, "");
  if (!pem.includes("\n")) {
    const m = pem.match(/(-----BEGIN [A-Z ]+-----)([A-Za-z0-9+/=\s]+)(-----END [A-Z ]+-----)/);
    if (m) {
      const body = m[2].replace(/\s/g, "");
      pem = `${m[1]}\n${(body.match(/.{1,64}/g) || []).join("\n")}\n${m[3]}\n`;
    }
  } else {
    const lines = pem.split("\n");
    const header = lines.find((l) => l.startsWith("-----BEGIN"));
    const footer = lines.find((l) => l.startsWith("-----END"));
    const body = lines.filter((l) => l && !l.startsWith("-----")).join("").replace(/\s/g, "");
    if (header && footer && body) {
      pem = `${header}\n${(body.match(/.{1,64}/g) || []).join("\n")}\n${footer}\n`;
    }
  }
  return pem;
}

function loadCredentials() {
  const rawKey = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!rawKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");

  let email, keyRaw;
  if (rawKey.startsWith("{")) {
    let parsed;
    try { parsed = JSON.parse(rawKey); } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY JSON parse failed: " + e.message);
    }
    email  = parsed.client_email;
    keyRaw = parsed.private_key;
    if (!email || !keyRaw) throw new Error("JSON key missing client_email or private_key");
  } else {
    keyRaw = rawKey;
    email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    if (!email) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL not set");
  }

  const privateKey = createPrivateKey({ key: normalisePem(keyRaw), format: "pem" });
  return { email, privateKey };
}

function makeJwt(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const input = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(input);
  sign.end();
  return `${input}.${b64url(sign.sign(privateKey))}`;
}

async function getAccessToken(email, privateKey) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: makeJwt(email, privateKey),
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${txt}`);
  }
  return (await res.json()).access_token;
}

// ─── Drive search ─────────────────────────────────────────────────────────────

/**
 * Search for files in a Drive folder whose name contains the query string.
 * Uses the Drive v3 files.list API with a 'name contains' filter.
 */
async function searchFolderFiles(token, folderId, query) {
  // Build a Drive query:
  //   - file is in the target folder
  //   - name contains the search term (case-insensitive in Drive)
  //   - not trashed
  const driveQuery = [
    `'${folderId}' in parents`,
    `name contains '${query.replace(/'/g, "\\'")}'`,
    `trashed = false`,
  ].join(" and ");

  const fields = "files(id,name,size,mimeType,modifiedTime,webViewLink)";
  const url = `https://www.googleapis.com/drive/v3/files` +
    `?q=${encodeURIComponent(driveQuery)}` +
    `&fields=${encodeURIComponent(fields)}` +
    `&orderBy=modifiedTime+desc` +
    `&pageSize=20` +
    `&supportsAllDrives=true` +
    `&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Drive search failed (${res.status}): ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.files || [];
}

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const qs = event.queryStringParameters || {};
  const query    = (qs.q || "").trim();
  const folderId = (qs.folderId || process.env.VITE_GOOGLE_DRIVE_PUBLIC_FOLDER_ID || "").trim();

  if (!query) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing ?q= search term" }) };
  }
  if (!folderId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: JSON.stringify({ error: "Missing folderId parameter and VITE_GOOGLE_DRIVE_PUBLIC_FOLDER_ID env var is not set" }),
    };
  }

  try {
    const { email, privateKey } = loadCredentials();
    const token = await getAccessToken(email, privateKey);
    const files = await searchFolderFiles(token, folderId, query);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        query,
        folderId,
        count: files.length,
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          size: f.size || null,
          mimeType: f.mimeType || "application/octet-stream",
          modifiedTime: f.modifiedTime || null,
          webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          downloadUrl: `${process.env.URL || ""}/.netlify/functions/drive-download?id=${f.id}`,
        })),
      }),
    };
  } catch (err) {
    console.error("drive-folder-search error:", err.message);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
