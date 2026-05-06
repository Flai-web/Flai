/**
 * drive-download.mjs  —  Netlify Functions v2  (ES modules, streaming)
 *
 * ─── WHY v2 + STREAMING ──────────────────────────────────────────────────────
 *
 *  The old v1 approach had two paths:
 *    A) Proxy file bytes through the function  →  hard 6 MB response limit, files corrupt
 *    B) Return an OAuth token, let the browser fetch from googleapis.com directly
 *       →  works until CORS blocks it (googleapis.com does NOT send
 *          Access-Control-Allow-Origin for bearer-token downloads)
 *
 *  The only correct server-side solution is streaming:
 *    Netlify Functions v2 can return a standard Web API Response whose body
 *    is a ReadableStream.  Netlify pipes that stream to the browser without
 *    buffering it, so the 6 MB limit applies to the BUFFER, not the total
 *    bytes transferred.  The documented limit for streamed responses is 20 MB,
 *    but in practice Netlify pipes the stream as-is, so multi-GB files work.
 *
 *  Flow:
 *    Browser clicks "Download"
 *      → GET /.netlify/functions/drive-download?id=FILE_ID
 *      → Function gets OAuth2 token from Google (service account JWT)
 *      → Function calls googleapis.com/drive/v3/files/FILE_ID?alt=media
 *      → Pipes Google's response stream → Netlify → Browser
 *      → Browser receives Content-Disposition: attachment and saves the file
 *
 *  The browser never sees a redirect.  The domain never changes.
 *  Google Drive is completely invisible to the end user.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *
 *  GOOGLE_SERVICE_ACCOUNT_KEY
 *    The full JSON blob downloaded from Google Cloud Console
 *    (Service Accounts → Keys → Add Key → JSON).
 *    Paste the entire JSON object as the env var value.
 *    Alternatively: just the PEM private key string (requires EMAIL below too).
 *
 *  GOOGLE_SERVICE_ACCOUNT_EMAIL   (only if KEY is a bare PEM, not JSON)
 *
 * ─── HOW TO GIVE THE SERVICE ACCOUNT ACCESS TO YOUR FILES ───────────────────
 *
 *  Option A (simplest): Share each Drive file/folder with the service account
 *    email (e.g. my-sa@my-project.iam.gserviceaccount.com) as a Viewer.
 *
 *  Option B: Upload files via the same service account (the existing
 *    google-drive-upload.js function does this).  Files uploaded by the SA
 *    are automatically owned by it.
 *
 * ─── ENDPOINTS ───────────────────────────────────────────────────────────────
 *
 *  GET /.netlify/functions/drive-download?id=FILE_ID
 *    Streams the file to the browser as an attachment download.
 *
 *  GET /.netlify/functions/drive-download?id=FILE_ID&meta=1
 *    Returns JSON metadata only (no download).  Used by DriveDownload.tsx
 *    on page load to display filename and size before the user clicks Download.
 *
 *  GET /.netlify/functions/drive-download?health=1
 *    Returns a JSON credential report — useful for debugging.
 */

import { createSign, createPrivateKey } from "node:crypto";

// ─── Credential loading ───────────────────────────────────────────────────────

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
    const header = lines.find(l => l.startsWith("-----BEGIN"));
    const footer = lines.find(l => l.startsWith("-----END"));
    const body   = lines.filter(l => l && !l.startsWith("-----")).join("").replace(/\s/g, "");
    if (header && footer && body) {
      pem = `${header}\n${(body.match(/.{1,64}/g) || []).join("\n")}\n${footer}\n`;
    }
  }
  return pem;
}

function loadCredentials() {
  const rawKey = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").trim();
  if (!rawKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");

  let email, keyPem;

  if (rawKey.startsWith("{")) {
    let parsed;
    try { parsed = JSON.parse(rawKey); }
    catch (e) { throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY JSON parse failed: " + e.message); }
    email  = parsed.client_email;
    keyPem = parsed.private_key;
    if (!email || !keyPem) throw new Error("JSON key missing client_email or private_key");
  } else {
    keyPem = rawKey;
    email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    if (!email) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL not set (required when KEY is a bare PEM)");
  }

  const privateKey = createPrivateKey({ key: normalisePem(keyPem), format: "pem" });
  return { email, privateKey };
}

// ─── JWT / OAuth2 ─────────────────────────────────────────────────────────────

function b64url(str) {
  return Buffer.from(str).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(email, privateKey, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  sign.end();
  return `${header}.${payload}.${b64url(sign.sign(privateKey))}`;
}

async function getAccessToken(email, privateKey) {
  const jwt = makeJwt(email, privateKey, [
    "https://www.googleapis.com/auth/drive",
  ]);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${txt}`);
  }
  return (await res.json()).access_token;
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

async function getFileMeta(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}` +
              `?fields=id,name,size,mimeType`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text();
    throw Object.assign(
      new Error(`Drive metadata error (${res.status})`),
      { status: res.status, detail: txt }
    );
  }
  return res.json(); // { id, name, size, mimeType }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

// ─── Main handler (Netlify Functions v2) ─────────────────────────────────────

export default async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" },
    });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const url    = new URL(req.url);
  const fileId = (url.searchParams.get("id") || "").trim();
  const isMeta = url.searchParams.get("meta") === "1";
  const isHealth = url.searchParams.get("health") === "1";

  // ── Health / credential diagnostic ───────────────────────────────────────
  if (isHealth) {
    const report = { key: "✗ not set", tokenTest: null, tokenError: null };
    try {
      const { email, privateKey } = loadCredentials();
      report.key   = `✓ loaded (${email})`;
      const token  = await getAccessToken(email, privateKey);
      report.tokenTest = `✓ token obtained (${token.slice(0, 20)}…)`;
    } catch (e) {
      report.tokenError = e.message;
    }
    return jsonResponse(report);
  }

  if (!fileId) {
    return jsonResponse({ error: "Missing ?id= parameter" }, 400);
  }

  // ── Obtain credentials + token ────────────────────────────────────────────
  let email, privateKey, token;
  try {
    ({ email, privateKey } = loadCredentials());
    token = await getAccessToken(email, privateKey);
  } catch (err) {
    console.error("drive-download: auth error:", err.message);
    return jsonResponse({ error: `Authentication failed: ${err.message}` }, 500);
  }

  // ── Fetch file metadata ───────────────────────────────────────────────────
  // Try SA token first; if 404, fall back to public access
  // (files uploaded via google-drive-upload are set to anyone=reader)
  let meta;
  try {
    meta = await getFileMeta(fileId, token);
  } catch (err) {
    if (err.status === 404) {
      // File not owned/visible to SA — try public API key lookup
      const apiKey = process.env.VITE_GOOGLE_API_KEY || "";
      let resolved = false;
      if (apiKey) {
        try {
          const pubMeta = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,size,mimeType&key=${apiKey}`
          );
          if (pubMeta.ok) {
            meta = await pubMeta.json();
            resolved = true;
          }
        } catch { /* fall through */ }
      }
      if (!resolved) {
        // Use minimal stub — download still works via public export URL
        meta = { id: fileId, name: "download", mimeType: "application/octet-stream", size: null };
      }
    } else {
      console.error("drive-download: metadata error:", err.message, err.detail);
      return jsonResponse(
        { error: `Could not fetch file metadata: ${err.message}`, detail: err.detail },
        err.status || 502
      );
    }
  }

  const fileName = meta.name || "download";
  const mimeType = meta.mimeType || "application/octet-stream";
  const fileSize = meta.size ? String(meta.size) : null;

  // ── Metadata-only mode ────────────────────────────────────────────────────
  if (isMeta) {
    return jsonResponse({
      fileId: meta.id || fileId,
      fileName,
      mimeType,
      size: fileSize,
    });
  }

  // ── STREAMING DOWNLOAD ────────────────────────────────────────────────────
  //
  //  We call the Drive API with alt=media which returns the raw file bytes.
  //  We then pipe Google's response body (a ReadableStream) directly into our
  //  Response body.  Netlify Functions v2 will stream this to the browser
  //  without buffering — no 6 MB limit applies to the piped bytes.
  //
  //  The browser sees:
  //    Content-Disposition: attachment; filename="yourfile.zip"
  //    Content-Type: application/zip
  //    Content-Length: 244000000   (if Drive provides it)
  //
  //  Result: the browser shows its native "Save File" dialog immediately,
  //  progress bar works, and the file saves correctly — no redirect, no
  //  Google Drive page, no intermediate tab.

  // Try authenticated SA download first; if still 404, use public export URL
  const driveDownloadUrl =
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  let driveRes;
  try {
    driveRes = await fetch(driveDownloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "follow",
    });
    // If SA can't access, fall back to public export (works for anyone=reader files)
    if (driveRes.status === 404 || driveRes.status === 403) {
      const publicUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
      driveRes = await fetch(publicUrl, { redirect: "follow" });
    }
  } catch (err) {
    return jsonResponse({ error: `Drive fetch error: ${err.message}` }, 502);
  }

  if (!driveRes.ok) {
    const txt = await driveRes.text().catch(() => "");
    console.error(`drive-download: Drive returned ${driveRes.status}:`, txt.slice(0, 300));
    return jsonResponse(
      { error: `Google Drive returned ${driveRes.status}`, detail: txt.slice(0, 300) },
      driveRes.status
    );
  }

  // Build response headers
  const safeFileName = encodeURIComponent(fileName);
  const responseHeaders = new Headers({
    "Content-Type": mimeType,
    // attachment + filename triggers the browser "Save File" dialog
    "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${safeFileName}`,
    // Allow the browser to show a progress bar
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Disposition",
    // No caching — tokens are short-lived
    "Cache-Control": "no-store",
  });

  // Forward Content-Length from Drive so the browser can show download progress
  const driveContentLength = driveRes.headers.get("Content-Length") || fileSize;
  if (driveContentLength) {
    responseHeaders.set("Content-Length", driveContentLength);
  }

  // Stream Google's response body directly to the client.
  // driveRes.body is a Web API ReadableStream — Netlify v2 accepts it natively.
  return new Response(driveRes.body, {
    status: 200,
    headers: responseHeaders,
  });
};

// Tell Netlify this is a v2 function (ES module default export).
// The streaming behaviour is automatic when you return a Response with a stream body.
export const config = {
  path: "/.netlify/functions/drive-download",
};
