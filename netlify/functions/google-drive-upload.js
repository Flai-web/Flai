/**
 * Netlify serverless function — Google Drive upload proxy
 *
 * Why this exists:
 *   Calling the Drive upload API directly from the browser with only an API key
 *   returns HTTP 401 because Drive write operations require OAuth2 authorization.
 *   API keys only work for public read operations.
 *
 * How it works:
 *   1. Receives the file as a base64-encoded body from the browser.
 *   2. Uses a Google service-account private key (stored in Netlify env vars)
 *      to self-sign a JWT and exchange it for a short-lived OAuth2 access token.
 *   3. Uploads the file to Drive using that token (multipart upload).
 *   4. Sets the file permission to "anyone → reader" so it can be linked publicly.
 *   5. Returns { fileId, webViewLink, webContentLink } to the browser.
 *
 * Required Netlify environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   – e.g. my-sa@my-project.iam.gserviceaccount.com
 *   GOOGLE_SERVICE_ACCOUNT_KEY     – the PEM private key (include the -----BEGIN … lines)
 *   VITE_GOOGLE_DRIVE_FOLDER_ID    – target Drive folder ID (same var already used client-side)
 *
 * FIX LOG:
 *   - Added DELETE method handler for deleteGoogleDriveFile() client calls
 *   - Added detailed error logging to surface the real 500 cause
 *   - Added private key normalisation for keys stored with spaces instead of \n
 *   - Added Netlify 6 MB body-size guard with a clear error message
 *   - Improved credential-missing error to list exactly which vars are absent
 */

// ─── JWT / token helpers (no external deps, pure Node crypto) ─────────────────

const { createSign } = require("crypto");

function base64urlEncode(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Normalise a PEM private key coming from a Netlify env var.
 * Netlify stores env vars as single-line strings; the key may have:
 *   - literal \n sequences  →  replace with real newlines
 *   - spaces inside the base64 body  →  restore newlines every 64 chars
 */
function normalisePrivateKey(raw) {
  // Step 1: turn literal \n into real newlines
  let key = raw.replace(/\\n/g, "\n");

  // Step 2: if the key still has no newlines inside the body, re-fold it.
  if (!key.includes("\n")) {
    key = key
      .replace("-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----\n")
      .replace("-----BEGIN PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----\n")
      .replace("-----END RSA PRIVATE KEY-----", "\n-----END RSA PRIVATE KEY-----")
      .replace("-----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----");
  }

  // Step 3: if the base64 body lines are longer than 64 chars (spaces used
  // as separators in some copy-paste flows), re-fold properly.
  const lines = key.split("\n");
  const header = lines.find((l) => l.startsWith("-----BEGIN"));
  const footer = lines.find((l) => l.startsWith("-----END"));
  const body = lines
    .filter((l) => l && !l.startsWith("-----"))
    .join("")
    .replace(/\s/g, "");

  if (body.length > 0 && header && footer) {
    const folded = body.match(/.{1,64}/g).join("\n");
    key = `${header}\n${folded}\n${footer}`;
  }

  return key;
}

/**
 * Load and validate credentials from environment variables.
 * Throws a 500-tagged Error if required vars are missing.
 */
function loadCredentials() {
  const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const folderId = process.env.VITE_GOOGLE_DRIVE_FOLDER_ID;

  const missing = [];
  if (!serviceAccountEmail) missing.push("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if (!privateKeyRaw) missing.push("GOOGLE_SERVICE_ACCOUNT_KEY");

  if (missing.length > 0) {
    throw Object.assign(
      new Error(
        `Server misconfiguration: missing env var(s): ${missing.join(", ")}. ` +
          "Set them in Netlify → Site settings → Environment variables."
      ),
      { statusCode: 500 }
    );
  }

  const privateKey = normalisePrivateKey(privateKeyRaw);
  return { serviceAccountEmail, privateKey, folderId };
}

/**
 * Create a signed JWT for the Google service account.
 * Scope: https://www.googleapis.com/auth/drive.file
 */
function createJWT(serviceAccountEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64urlEncode(
    JSON.stringify({
      iss: serviceAccountEmail,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();

  // Google service account keys use PKCS#8 PEM — Node's createSign accepts this directly.
  const signature = base64urlEncode(sign.sign(privateKey));
  return `${signingInput}.${signature}`;
}

/**
 * Exchange the JWT for a short-lived OAuth2 access token.
 */
async function getAccessToken(serviceAccountEmail, privateKey) {
  const jwt = createJWT(serviceAccountEmail, privateKey);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  // ── GET /diagnose — check env vars and test token exchange ────────────────
  if (event.httpMethod === "GET") {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const folderId = process.env.VITE_GOOGLE_DRIVE_FOLDER_ID;

    const diag = {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: email ? `✓ set (${email})` : "✗ MISSING",
      GOOGLE_SERVICE_ACCOUNT_KEY: keyRaw
        ? `✓ set (${keyRaw.length} chars, starts: ${keyRaw.slice(0, 27).replace(/\\n/g, "↵")})`
        : "✗ MISSING",
      VITE_GOOGLE_DRIVE_FOLDER_ID: folderId ? `✓ set (${folderId})` : "✗ MISSING (optional)",
      tokenTest: null,
      tokenError: null,
    };

    if (email && keyRaw) {
      try {
        const key = normalisePrivateKey(keyRaw);
        const token = await getAccessToken(email, key);
        diag.tokenTest = `✓ OAuth2 token obtained (${token.slice(0, 20)}…)`;
      } catch (e) {
        diag.tokenError = e.message;
      }
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(diag, null, 2) };
  }

  // ── DELETE — remove a file from Google Drive ──────────────────────────────
  if (event.httpMethod === "DELETE") {
    try {
      const deleteId =
        event.queryStringParameters?.deleteId ||
        (() => {
          try {
            return JSON.parse(event.body || "{}").fileId;
          } catch {
            return null;
          }
        })();

      if (!deleteId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Missing deleteId query parameter or fileId in body" }),
        };
      }

      const { serviceAccountEmail, privateKey } = loadCredentials();
      const accessToken = await getAccessToken(serviceAccountEmail, privateKey);

      const delRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${deleteId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      // Drive returns 204 No Content on success
      if (delRes.status === 204 || delRes.ok) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ success: true, deletedFileId: deleteId }),
        };
      }

      const errText = await delRes.text();
      console.error(`Drive delete failed (${delRes.status}):`, errText);
      throw new Error(`Drive delete failed (${delRes.status}): ${errText}`);
    } catch (err) {
      console.error("google-drive-upload DELETE error:", err);
      return {
        statusCode: err.statusCode || 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // ── 1. Guard against Netlify's 6 MB request body limit ────────────────
    // base64 overhead is ~33 %, so a 4.5 MB source file becomes ~6 MB encoded.
    const bodyLength = Buffer.byteLength(event.body || "", "utf8");
    const MAX_BODY = 6 * 1024 * 1024; // 6 MB
    if (bodyLength > MAX_BODY) {
      return {
        statusCode: 413,
        headers: corsHeaders,
        body: JSON.stringify({
          error:
            `File is too large to upload via this proxy ` +
            `(${(bodyLength / 1024 / 1024).toFixed(1)} MB encoded; Netlify limit is 6 MB). ` +
            "Please use Gofile upload or a direct link instead.",
        }),
      };
    }

    // ── 2. Parse request body ──────────────────────────────────────────────
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const { fileData, fileName, mimeType } = body;

    if (!fileData || !fileName || !mimeType) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Missing required fields: fileData, fileName, mimeType",
        }),
      };
    }

    // ── 3. Read service account credentials from env ───────────────────────
    const { serviceAccountEmail, privateKey, folderId } = loadCredentials();

    // ── 4. Get OAuth2 access token ─────────────────────────────────────────
    let accessToken;
    try {
      accessToken = await getAccessToken(serviceAccountEmail, privateKey);
    } catch (err) {
      console.error("google-drive-upload: OAuth2 token error:", err.message);
      throw new Error(`Authentication failed: ${err.message}`);
    }

    // ── 5. Build multipart body for Drive upload ───────────────────────────
    const metadata = JSON.stringify({
      name: fileName,
      mimeType,
      ...(folderId ? { parents: [folderId] } : {}),
    });

    const boundary = "flai_drive_boundary_" + Date.now();
    const fileBytes = Buffer.from(fileData, "base64");

    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
      ),
      fileBytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    // ── 6. Upload to Google Drive ──────────────────────────────────────────
    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": multipartBody.length,
        },
        body: multipartBody,
      }
    );

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      console.error(`Drive upload failed (${uploadRes.status}):`, errorText);
      throw new Error(`Drive upload failed (${uploadRes.status}): ${errorText}`);
    }

    const uploadedFile = await uploadRes.json();
    const fileId = uploadedFile.id;

    // ── 7. Make the file publicly readable ────────────────────────────────
    const permRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      }
    );

    if (!permRes.ok) {
      // Non-fatal: log but don't fail the upload.
      console.warn(
        `Failed to set public permission on ${fileId}:`,
        await permRes.text()
      );
    }

    // ── 8. Return result ───────────────────────────────────────────────────
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        fileId,
        fileName: uploadedFile.name || fileName,
        webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
        webContentLink: `https://drive.google.com/uc?export=download&id=${fileId}`,
      }),
    };
  } catch (err) {
    console.error("google-drive-upload error:", err);
    return {
      statusCode: err.statusCode || 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
