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

async function getAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  // reuse token if it has more than 60 s left (skipped when forceRefresh)
  if (!forceRefresh && _cachedToken && now < _tokenExpiresAt - 60_000) {
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
    // refresh_token itself is invalid (400 invalid_grant) — no retry can help
    console.error(`[gdrive] token refresh failed (${res.status}): ${body}`);
    throw new Error(`Google token refresh failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  _cachedToken = json.access_token;
  _tokenExpiresAt = now + json.expires_in * 1000;
  return _cachedToken;
}

/**
 * Invalidate the cached access token. Forces the next getAccessToken()
 * to hit the refresh endpoint. Called automatically on 401 responses.
 */
function invalidateTokenCache(): void {
  _cachedToken = null;
  _tokenExpiresAt = 0;
}

/**
 * fetch() wrapper that auto-retries once on 401 with a fresh access token.
 * Root-cause fix for the recurring "Google Drive metadata fetch failed (401)":
 * the in-memory token cache can outlive the actual token validity on Vercel
 * cold starts / instance reuse; invalidating + retrying recovers without
 * requiring a manual reauth+redeploy cycle.
 *
 * If the second attempt also returns 401, the refresh_token itself is likely
 * revoked — in that case run `scripts/gdrive_reauth.mjs` to reissue.
 */
async function driveFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  let token = await getAccessToken();
  let headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  let res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    console.warn(
      `[gdrive] 401 on ${init.method || 'GET'} ${url} — invalidating token cache and retrying once`
    );
    invalidateTokenCache();
    token = await getAccessToken(true);
    headers = {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    };
    res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      console.error(
        `[gdrive] 401 persists after token refresh — refresh_token may be revoked. Run scripts/gdrive_reauth.mjs.`
      );
    }
  }

  return res;
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

  const res = await driveFetch(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(body.length),
      },
      body,
    }
  );

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
  // First get metadata to know the mimeType
  const metaRes = await driveFetch(`${DRIVE_API}/files/${fileId}?fields=mimeType`);
  if (!metaRes.ok) {
    const body = await metaRes.text().catch(() => '');
    throw new Error(
      `Google Drive metadata fetch failed (${metaRes.status})${body ? `: ${body.slice(0, 200)}` : ''}`
    );
  }
  const { mimeType } = (await metaRes.json()) as { mimeType: string };

  // Then download the actual bytes
  const dataRes = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
  if (!dataRes.ok) {
    const body = await dataRes.text().catch(() => '');
    throw new Error(
      `Google Drive download failed (${dataRes.status})${body ? `: ${body.slice(0, 200)}` : ''}`
    );
  }

  const arrayBuf = await dataRes.arrayBuffer();
  return { data: Buffer.from(arrayBuf), mimeType };
}

/**
 * Delete a file from Google Drive.
 */
export async function deleteFromGDrive(fileId: string): Promise<void> {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'DELETE',
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
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}/permissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Drive makePublic failed (${res.status}): ${err}`);
  }
}
