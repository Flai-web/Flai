/**
 * Netlify serverless function — Google Drive proxy for file downloads
 *
 * WHY THIS EXISTS:
 *   Large files (>25 MB) on Google Drive trigger a "virus scan warning" page
 *   instead of downloading directly. This proxy:
 *     1. Fetches file metadata using a service-account OAuth2 token (same auth
 *        as google-drive-upload.js) so it can access files owned by the service
 *        account — even if they are not publicly listed.
 *     2. For the metadata-only mode (?meta=1), returns filename + size + a
 *        short-lived OAuth token so the browser can stream large files directly
 *        from googleapis.com (bypassing Netlify's 6 MB response limit).
 *     3. For direct proxy downloads (no meta param), streams the file bytes
 *        back to the browser using the OAuth token — no Google HTML warning pages.
 *
 * FIX (was broken):
 *   Previously used a plain API key (GOOGLE_DRIVE_API_KEY) for metadata.
 *   API keys only work for files shared publicly ("anyone with the link").
 *   Files uploaded by the service account are owned by it, and Drive returns
 *   HTTP 404 when an API key (not a token) is used to access them.
 *   Now uses the same service-account JWT -> OAuth2 token flow as
 *   google-drive-upload.js, which has full access to service-account-owned files.
 *
 * Required Netlify environment variables (shared with google-drive-upload):
 *   GOOGLE_SERVICE_ACCOUNT_KEY     – full JSON blob or bare PEM private key
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   – only needed when KEY is a bare PEM string
 */

const { createSign, createPrivateKey } = require("crypto");

// ─── Auth helpers (mirrors google-drive-upload.js) ───────────────────────────

function base64urlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function loadPrivateKey(raw) {
  let pem = raw.replace(/\\n/g, "\n").replace(/\r/g, "");

  if (!pem.includes("\n")) {
    const match = pem.match(
      /(-----BEGIN [A-Z ]+-----)([A-Za-z0-9+/=\s]+)(-----END [A-Z ]+-----)/
    );
    if (match) {
      const body = match[2].replace(/\s/g, "");
      pem = `${match[1]}\n${(body.match(/.{1,64}/g) || []).join("\n")}\n${match[3]}\n`;
    }
  } else {
    const lines = pem.split("\n");
    const header = lines.find((l) => l.startsWith("-----BEGIN"));
    const footer = lines.find((l) => l.startsWith("-----END"));
    const body = lines.filter((l) => l && !l.startsWith("-----")).join("").replace(/\s/g, "");
    if (header && footer && body.length > 0) {
      pem = `${header}\n${(body.match(/.{1,64}/g) || []).join("\n")}\n${footer}\n`;
    }
  }

  try {
    return createPrivateKey({ key: pem, format: "pem" });
  } catch (e) {
    throw new Error("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY: " + e.message);
  }
}

function loadCredentials() {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw Object.assign(
      new Error("Server misconfiguration: GOOGLE_SERVICE_ACCOUNT_KEY is not set."),
      { statusCode: 500 }
    );
  }

  let serviceAccountEmail, privateKeyRaw;
  const trimmed = rawKey.trim();

  if (trimmed.startsWith("{")) {
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch (e) {
      throw Object.assign(new Error("GOOGLE_SERVICE_ACCOUNT_KEY JSON parse failed: " + e.message), { statusCode: 500 });
    }
    serviceAccountEmail = parsed.client_email;
    privateKeyRaw = parsed.private_key;
    if (!serviceAccountEmail || !privateKeyRaw) {
      throw Object.assign(
        new Error("GOOGLE_SERVICE_ACCOUNT_KEY JSON is missing client_email or private_key."),
        { statusCode: 500 }
      );
    }
  } else {
    privateKeyRaw = trimmed;
    serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    if (!serviceAccountEmail) {
      throw Object.assign(
        new Error("GOOGLE_SERVICE_ACCOUNT_KEY is a PEM key but GOOGLE_SERVICE_ACCOUNT_EMAIL is not set."),
        { statusCode: 500 }
      );
    }
  }

  return { serviceAccountEmail, privateKey: loadPrivateKey(privateKeyRaw) };
}

function createJWT(serviceAccountEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64urlEncode(JSON.stringify({
    iss: serviceAccountEmail,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  return `${signingInput}.${base64urlEncode(sign.sign(privateKey))}`;
}

async function getAccessToken(serviceAccountEmail, privateKey) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createJWT(serviceAccountEmail, privateKey),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${text}`);
  }
  return (await res.json()).access_token;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  const { id, meta } = event.queryStringParameters || {};
  if (!id) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing id parameter" }),
    };
  }

  // ── Obtain a service-account OAuth2 token ────────────────────────────────
  let accessToken;
  try {
    const { serviceAccountEmail, privateKey } = loadCredentials();
    accessToken = await getAccessToken(serviceAccountEmail, privateKey);
  } catch (err) {
    console.error("gofile-proxy: auth error:", err.message);
    return {
      statusCode: err.statusCode || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Auth failed: ${err.message}` }),
    };
  }

  // ── Fetch file metadata via OAuth (works for service-account-owned files) ─
  let fileMetadata;
  try {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,size,mimeType`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      const errText = await metaRes.text();
      console.error("gofile-proxy: Drive metadata error:", metaRes.status, errText);
      throw new Error(`Metadata fetch failed: ${metaRes.status}`);
    }
    fileMetadata = await metaRes.json();
  } catch (err) {
    console.error("gofile-proxy: metadata error:", err.message);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message }),
    };
  }

  // ── Metadata-only mode (?meta=1) ─────────────────────────────────────────
  // Returns the OAuth token + metadata so the browser can stream large files
  // directly from googleapis.com — no Netlify 6 MB limit involved.
  if (meta === "1") {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        token: accessToken,
        fileId: fileMetadata.id,
        fileName: fileMetadata.name || "download",
        mimeType: fileMetadata.mimeType || "application/octet-stream",
        size: fileMetadata.size,
        downloadUrl: `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
        // Legacy shape kept for backwards compatibility
        links: [
          {
            name: fileMetadata.name || "Download",
            size: fileMetadata.size,
            mimeType: fileMetadata.mimeType,
            url: `/.netlify/functions/gofile-proxy?id=${id}`,
          },
        ],
      }),
    };
  }

  // ── Proxy the file bytes back to the browser ─────────────────────────────
  // Uses the OAuth token so Drive serves the raw bytes immediately — no HTML
  // "virus scan" warning pages, no confirm-token dance needed.
  try {
    const fileName = fileMetadata.name || "download";
    const mimeType = fileMetadata.mimeType || "application/octet-stream";

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        redirect: "follow",
      }
    );

    if (!driveRes.ok) {
      throw new Error(`Google Drive responded with ${driveRes.status}`);
    }

    const arrayBuffer = await driveRes.arrayBuffer();
    const base64Body = Buffer.from(arrayBuffer).toString("base64");
    const safeFileName = encodeURIComponent(fileName);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${safeFileName}`,
        "Content-Length": String(arrayBuffer.byteLength),
        "Cache-Control": "no-store",
      },
      body: base64Body,
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("gofile-proxy: stream error:", err.message);
    return {
      statusCode: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: `Download failed: ${err.message}` }),
    };
  }
};
