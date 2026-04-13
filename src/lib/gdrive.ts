/**
 * Google Drive REST API v3 client
 * No npm deps — pure fetch() with OAuth2 refresh-token flow.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REFRESH_TOKEN
 *   GOOGLE_DRIVE_FOLDER_ID   (target folder for uploads)
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// ---- access token cache ----
let _cachedToken: string | null = null;
let _tokenExpiresAt = 0; // unix ms

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // reuse token if it has more than 60 s left
  if (_cachedToken && now < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Drive env vars missing: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN must be set.'
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  _cachedToken = json.access_token;
  _tokenExpiresAt = now + json.expires_in * 1000;
  return _cachedToken;
}

// ---- public helpers ----

export function isGDriveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_FOLDER_ID
  );
}

/**
 * Upload a file to the configured Google Drive folder.
 * Returns the Drive fileId.
 */
export async function uploadToGDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const token = await getAccessToken();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;

  // Use multipart upload for files < 5 MB; resumable for larger.
  // Simple multipart covers our typical photo sizes well.
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const boundary = `gdrive_boundary_${Date.now()}`;

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Drive upload failed (${res.status}): ${err}`);
  }

  const json = (await res.json()) as { id: string };
  return json.id;
}

/**
 * Download file bytes from Google Drive.
 * Returns { data: Buffer, mimeType: string }.
 */
export async function downloadFromGDrive(
  fileId: string
): Promise<{ data: Buffer; mimeType: string }> {
  const token = await getAccessToken();

  // First get metadata to know the mimeType
  const metaRes = await fetch(`${DRIVE_API}/files/${fileId}?fields=mimeType`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    throw new Error(`Google Drive metadata fetch failed (${metaRes.status})`);
  }
  const { mimeType } = (await metaRes.json()) as { mimeType: string };

  // Then download the actual bytes
  const dataRes = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!dataRes.ok) {
    throw new Error(`Google Drive download failed (${dataRes.status})`);
  }

  const arrayBuf = await dataRes.arrayBuffer();
  return { data: Buffer.from(arrayBuf), mimeType };
}

/**
 * Delete a file from Google Drive.
 */
export async function deleteFromGDrive(fileId: string): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  // 204 = success, 404 = already gone — both are acceptable
  if (!res.ok && res.status !== 404) {
    throw new Error(`Google Drive delete failed (${res.status})`);
  }
}

/**
 * Make a Drive file publicly readable (anyone with the link).
 * Useful if you want direct Drive URLs instead of proxying.
 */
export async function makePublic(fileId: string): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Drive makePublic failed (${res.status}): ${err}`);
  }
}
