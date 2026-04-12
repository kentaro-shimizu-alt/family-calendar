import { NextRequest, NextResponse } from 'next/server';
import { downloadFromGDrive } from '@/lib/gdrive';

/**
 * GET /api/gdrive-image/[id]
 *
 * Transparent proxy: fetches the file from Google Drive and returns it to
 * the browser as a normal image response.  This avoids storing public Drive
 * share links in the database and lets us control cache headers centrally.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const fileId = params.id;
  if (!fileId) {
    return NextResponse.json({ error: 'missing file id' }, { status: 400 });
  }

  try {
    const { data, mimeType } = await downloadFromGDrive(fileId);

    return new NextResponse(data as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': mimeType || 'application/octet-stream',
        'Content-Length': String(data.length),
        // Cache for 1 year — Drive file IDs are immutable once created
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (e: any) {
    // Return 404 for missing files, 502 for other Drive errors
    const status = e.message?.includes('404') ? 404 : 502;
    return NextResponse.json({ error: e.message }, { status });
  }
}
