/**
 * drive-download.mjs  —  Netlify Functions v2  (ES modules, streaming)
 *
 * ─── AUTH STRATEGY ───────────────────────────────────────────────────────────
 *
 *  1. Primary: Service-account OAuth2 token (full access to SA-owned files).
 *  2. Fallback (metadata): VITE_GOOGLE_API_KEY — works for any file shared as
 *     "anyone with the link" (viewer). This covers files uploaded by users, not
 *     the service account.
 *  3. Fallback (download): Public export URL via drive.google.com/uc — works
 *     for any publicly shared file without needing auth at all.
 *
 * ─── REQUIRED ENV VARS ───────────────────────────────────────────────────────
 *
 *  GOOGLE_SERVICE_ACCOUNT_KEY         