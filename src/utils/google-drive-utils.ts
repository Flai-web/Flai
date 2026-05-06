/**
 * google-drive-utils.ts — updated to use the new consolidated drive-download endpoint
 *
 * CHANGED:
 *   getGoogleDriveFile() now calls /.netlify/functions/drive-download?action=meta
 *   instead of the broken google-drive-upload?token=1 endpoint.
 *
 *   uploadToGoogleDrive() and deleteGoogleDriveFile() are unchanged — they
 *   still call google-drive-upload (POST / DELETE) which continues to work fine
 *   for file management operations.
 */

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
 * Uses XHR so upload progress events are available.
 */
export async function uploadToGoogleDrive(
  file: File,
  onProgress?: (progress: number) => void
): Promise<GoogleDriveUploadResult> {
  onProgress?.(0);

  const fileData = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  onProgress?.(50);

  return new Promise<GoogleDriveUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(50 + Math.round((e.loaded / e.total) * 50));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          resolve(JSON.parse(xhr.responseText) as GoogleDriveUploadResult);
          onProgress?.(100);
        } catch {
          reject(new Error('Invalid response from upload proxy'));
        }
      } else {
        let message = `Upload failed (HTTP ${xhr.status})`;
        try {
          const errBody = JSON.parse(xhr.responseText);
          if (errBody?.error) message = errBody.error;
        } catch { /* ignore */ }
        reject(new Error(message));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));

    xhr.open('POST', '/.netlify/functions/google-drive-upload');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ fileData, fileName: file.name, mimeType: file.type || 'application/octet-stream' }));
  });
}

/**
 * Get file metadata from Google Drive.
 *
 * Uses the streaming drive-download endpoint with meta=1 query param.
 */
export async function getGoogleDriveFile(fileId: string): Promise<GoogleDriveFileInfo> {
  const res = await fetch(
    `/.netlify/functions/drive-download?id=${encodeURIComponent(fileId)}&meta=1`
  );

  if (!res.ok) {
    throw new Error(`Failed to get file info: ${res.status}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);

  const id = data.fileId || fileId;
  return {
    id,
    name: data.fileName || 'download',
    size: parseInt(data.size || '0', 10),
    mimeType: data.mimeType || 'application/octet-stream',
    webViewLink: `https://drive.google.com/file/d/${id}/view`,
    webContentLink: data.downloadUrl || `https://drive.google.com/uc?export=download&id=${id}`,
  };
}

/**
 * Delete a file from Google Drive via the Netlify proxy.
 */
export async function deleteGoogleDriveFile(fileId: string): Promise<boolean> {
  const response = await fetch(
    `/.netlify/functions/google-drive-upload?deleteId=${fileId}`,
    { method: 'DELETE' }
  );
  if (!response.ok) throw new Error(`Failed to delete file: ${response.status}`);
  return true;
}

/**
 * Extract a Google Drive file ID from various URL formats.
 */
export function extractGoogleDriveId(url: string): string | null {
  if (!url) return null;

  // App's own download route: /file/gdrive/FILE_ID
  const appRoute = url.match(/\/file\/gdrive\/([a-zA-Z0-9_-]+)/);
  if (appRoute) return appRoute[1];

  // Bare ID (no slashes or http)
  if (!url.includes('/') && !url.includes('http')) return url;

  // drive.google.com/file/d/XXXXXX
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return fileMatch[1];

  // ?id=XXXXXX
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch) return idMatch[1];

  // drive.google.com/uc?export=download&id=XXXXXX
  const ucMatch = url.match(/uc\?.*id=([a-zA-Z0-9_-]+)/);
  if (ucMatch) return ucMatch[1];

  return null;
}

export interface DriveFolderSearchResult {
  id: string;
  name: string;
  size: string | null;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string;
  downloadUrl: string;
}

/**
 * Search a Google Drive folder for files whose name contains the query string.
 * The server uses the service account credentials to search within the folder.
 *
 * @param query        Customer name, booking ID, or any substring to search for
 * @param folderId     Optional — overrides the server-side default folder
 */
export async function searchDriveFolder(
  query: string,
  folderId?: string
): Promise<DriveFolderSearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (folderId) params.set('folderId', folderId);

  const res = await fetch(
    `/.netlify/functions/drive-folder-search?${params.toString()}`
  );

  if (!res.ok) {
    let msg = `Search failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.files || []) as DriveFolderSearchResult[];
}
