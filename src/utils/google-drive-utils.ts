/**
 * Google Drive utilities
 *
 * WHY the upload goes through a serverless proxy:
 *   The Google Drive upload/permissions APIs require an OAuth2 Bearer token.
 *   API keys (VITE_GOOGLE_DRIVE_API_KEY) only work for public *read* operations —
 *   calling the upload endpoint with just ?key=… returns HTTP 401.
 *
 *   The Netlify function at /.netlify/functions/google-drive-upload signs a JWT
 *   with the service-account private key (env var, never exposed to the browser),
 *   exchanges it for a short-lived access token, and performs the upload server-side.
 *
 * Read-only helpers (getGoogleDriveFile, extractGoogleDriveId) still use the API
 * key directly since they only read public file metadata.
 */

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_DRIVE_API_KEY;

export interface GoogleDriveUploadResult {
  success: boolean;
  fileId: string;
  fileName: string;
  webViewLink: string;
  webContentLink: string;
}

export interface GoogleDriveFileInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  webViewLink: string;
  webContentLink: string;
}

/**
 * Upload a file to Google Drive via the Netlify serverless proxy.
 *
 * The proxy uses a Google service account to authenticate, so no OAuth2
 * popup is needed and the upload works for any logged-in admin user.
 *
 * @param file        The File object to upload.
 * @param onProgress  Optional callback called with 0–100 progress values.
 *                    Progress is reported in two phases:
 *                      0–50  encoding phase (FileReader)
 *                      50–100 upload phase  (XHR progress events)
 */
export async function uploadToGoogleDrive(
  file: File,
  onProgress?: (progress: number) => void
): Promise<GoogleDriveUploadResult> {
  // ── Phase 1: base64-encode the file (0 → 50 %) ──────────────────────────
  onProgress?.(0);

  const fileData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix
      const base64 = result.split(',')[1] ?? result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  onProgress?.(50);

  // ── Phase 2: POST to the Netlify proxy (50 → 100 %) ─────────────────────
  return new Promise<GoogleDriveUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        // Map the upload's 0–100 into the overall 50–100 range
        const uploadProgress = Math.round((e.loaded / e.total) * 50);
        onProgress(50 + uploadProgress);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const response: GoogleDriveUploadResult = JSON.parse(xhr.responseText);
          onProgress?.(100);
          resolve(response);
        } catch {
          reject(new Error('Invalid response from upload proxy'));
        }
      } else {
        // Extract the detailed error message returned by the Netlify function
        let message = `Upload failed (HTTP ${xhr.status})`;
        try {
          const errBody = JSON.parse(xhr.responseText);
          if (errBody?.error) message = errBody.error;
        } catch { /* ignore parse errors */ }
        console.error('google-drive-upload proxy error:', xhr.status, xhr.responseText);
        reject(new Error(message));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.open('POST', '/.netlify/functions/google-drive-upload');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({
      fileData,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
    }));
  });
}

/**
 * Get file information from Google Drive (read-only — API key is sufficient).
 */
export async function getGoogleDriveFile(fileId: string): Promise<GoogleDriveFileInfo> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,size,mimeType,webViewLink,webContentLink&key=${GOOGLE_API_KEY}`;

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Google Drive API error:', response.status, errorText);
    throw new Error(`Failed to get file: ${response.status}`);
  }

  const data = await response.json();

  return {
    id: data.id,
    name: data.name,
    size: parseInt(data.size || '0'),
    mimeType: data.mimeType,
    webViewLink: data.webViewLink,
    webContentLink:
      data.webContentLink ||
      `https://drive.google.com/uc?export=download&id=${data.id}`,
  };
}

/**
 * Delete a file from Google Drive.
 * Deletion also requires OAuth2 — this calls the proxy with DELETE method.
 */
export async function deleteGoogleDriveFile(fileId: string): Promise<boolean> {
  const response = await fetch(
    `/.netlify/functions/google-drive-upload?deleteId=${fileId}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    throw new Error(`Failed to delete file: ${response.status}`);
  }

  return true;
}

/**
 * Extract a Google Drive file ID from various URL formats.
 */
export function extractGoogleDriveId(url: string): string | null {
  // Bare ID (no slashes or http)
  if (!url.includes('/') && !url.includes('http')) {
    return url;
  }

  // drive.google.com/file/d/XXXXXX
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];

  // drive.google.com/open?id=XXXXXX
  const openMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return openMatch[1];

  // drive.google.com/uc?export=download&id=XXXXXX
  const ucMatch = url.match(/uc\?.*id=([a-zA-Z0-9_-]+)/);
  if (ucMatch) return ucMatch[1];

  return null;
}
