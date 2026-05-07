# Download System — Rebuilt from Scratch

## What Was Broken

The 404/502 errors came from a **two-endpoint fallback chain where both endpoints had the same failure mode**:

| Error | Cause |
|---|---|
| `google-drive-upload` → 404 | `GOOGLE_SERVICE_ACCOUNT_KEY` missing **or** service account doesn't have access to the file |
| `gofile-proxy` → 502 | Same root cause — both share identical auth logic. The "fallback" was never actually independent. |
| `AbortError: The operation was aborted` | DataContext's Supabase query was cancelled because the download page errored out and unmounted |

## What's New

### Single consolidated endpoint: `drive-download.js`

Replaces the broken `google-drive-upload?token=1` and `gofile-proxy?meta=1` split.

```
GET /.netlify/functions/drive-download?action=meta&id=FILE_ID
GET /.netlify/functions/drive-download?action=health    ← for debugging
```

**Strategy auto-selection** (server picks best available):

| Strategy | When selected | How download works |
|---|---|---|
| `token` | `GOOGLE_SERVICE_ACCOUNT_KEY` is set and valid | Browser streams directly from `googleapis.com` with `Authorization: Bearer <token>` header — **no Netlify size limits** |
| `direct` | `GOOGLE_DRIVE_API_KEY` is set and file is public | Browser fetches `drive.google.com/uc?export=download&id=…` directly |
| `export` | No credentials at all | Opens Google Drive's download page in a new tab |

This means downloads work at **zero server configuration** — the `export` fallback always fires.

### Files changed

```
netlify/functions/drive-download.js          ← NEW (replaces broken token endpoints)
src/components/DriveDownload.tsx             ← REBUILT (uses new endpoint + strategy-aware download)
src/utils/google-drive-utils.ts             ← UPDATED (getGoogleDriveFile uses new endpoint)
```

Files **not changed** (still work as before):
```
netlify/functions/google-drive-upload.js    ← kept for POST (upload) and DELETE operations
netlify/functions/gofile-proxy.js           ← kept for any other usage, but no longer used by DriveDownload
```

## Migration Steps

1. **Copy the new files** into your project:
   ```
   netlify/functions/drive-download.js       → netlify/functions/drive-download.js
   src/components/DriveDownload.tsx          → src/components/DriveDownload.tsx
   src/utils/google-drive-utils.ts           → src/utils/google-drive-utils.ts
   ```

2. **No env var changes required.** The new function reads the same vars:
   - `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON blob or PEM) — enables `token` strategy
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — only needed if KEY is a bare PEM string
   - `GOOGLE_DRIVE_API_KEY` — enables `direct` strategy for public files

3. **Verify** by visiting:
   ```
   https://your-site.netlify.app/.netlify/functions/drive-download?action=health
   ```
   This returns a JSON report of which credentials are loaded and whether the OAuth2 token exchange works.

4. **Test a download** at `/file/gdrive/YOUR_FILE_ID`. The page shows which strategy is in use.

## Debugging

### Health check
```
GET /.netlify/functions/drive-download?action=health
```
Returns:
```json
{
  "credentials": "✓ service account loaded",
  "apiKey": "✗ not set",
  "tokenTest": "✓ token obtained (ya29.a0AfH6SMC…)"
}
```

### Common issues

**Still getting 404?**
- The `drive-download` function isn't deployed yet. Make sure `netlify/functions/drive-download.js` is committed and Netlify has redeployed.

**Strategy is `export` but you have credentials set?**
- Check `?action=health` — it will show exactly which credential is missing or broken.
- Most common cause: `GOOGLE_SERVICE_ACCOUNT_KEY` is set but the JSON is malformed, or the service account doesn't have the Drive API enabled.

**File downloads but is corrupt?**
- This only affects the `token` strategy. Make sure the file is not a Google Workspace native format (Docs, Sheets, Slides) — those need `?alt=media` with an export MIME type, not a direct download.

**`export` strategy opens Drive's "Too large to scan" warning page?**
- That's expected Google behaviour for files >25 MB. Click "Download anyway". If you want to bypass this, set up the service account credentials so the `token` strategy is used instead.
