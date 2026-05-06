import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';

const BOT_SECRET = process.env.LINEWORKS_CHAKO_BOT_SECRET || '';
const CHAKO_CHANNEL_ID =
  process.env.LINEWORKS_CHAKO_CHANNEL_ID ||
  process.env.LINEWORKS_CHAKO_MAIN_CHANNEL_ID ||
  '';
const TABLE_NAME = process.env.LINEWORKS_CHAKO_MESSAGES_TABLE || 'chako_messages';
const ALLOWED_USER_IDS = (
  process.env.LINEWORKS_CHAKO_ALLOWED_USER_IDS ||
  process.env.CHAKO_ALLOWED_USER_IDS ||
  process.env.LINEWORKS_KENTARO_USER_ID ||
  ''
)
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);
const IGNORED_USER_IDS = (
  process.env.LINEWORKS_CHAKO_IGNORE_USER_IDS ||
  process.env.LINEWORKS_CHAKO_BOT_USER_ID ||
  ''
)
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

type LineWorksEvent = {
  type?: string;
  source?: {
    userId?: string;
    channelId?: string;
    domainId?: number;
  };
  issuedTime?: string;
  content?: {
    type?: string;
    text?: string;
    fileId?: string;
    postback?: string;
    packageId?: string;
    stickerId?: string;
  };
};

function timingSafeEqualText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifySignature(body: string, signature: string): boolean {
  if (!BOT_SECRET || !signature) return false;
  const expected = crypto
    .createHmac('sha256', BOT_SECRET)
    .update(body)
    .digest('base64');
  return timingSafeEqualText(expected, signature);
}

function makeEventId(body: string, ev: LineWorksEvent): string {
  const ts = ev.issuedTime || new Date().toISOString();
  const userId = ev.source?.userId || 'no-user';
  const channelId = ev.source?.channelId || 'no-channel';
  const digest = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  return `lw-chako:${ts}:${userId}:${channelId}:${digest}`;
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'lineworks-webhook-chako',
    table: TABLE_NAME,
    signatureRequired: true,
    hasBotSecret: Boolean(BOT_SECRET),
    hasChannelFilter: Boolean(CHAKO_CHANNEL_ID),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-works-signature') || '';

  if (!BOT_SECRET) {
    return NextResponse.json(
      { error: 'LINEWORKS_CHAKO_BOT_SECRET is required' },
      { status: 500 }
    );
  }

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let ev: LineWorksEvent;
  try {
    ev = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  if (CHAKO_CHANNEL_ID && ev.source?.channelId !== CHAKO_CHANNEL_ID) {
    return NextResponse.json({
      ok: true,
      filtered: 'non-chako-channel',
      received_channel: ev.source?.channelId || 'no-channel',
    });
  }

  const userId = ev.source?.userId || '';
  if (IGNORED_USER_IDS.includes(userId)) {
    return NextResponse.json({ ok: true, filtered: 'ignored-user' });
  }
  if (ALLOWED_USER_IDS.length && !ALLOWED_USER_IDS.includes(userId)) {
    return NextResponse.json({ ok: true, filtered: 'non-allowed-user' });
  }

  const supabase = getSupabase();
  const eventId = makeEventId(body, ev);

  const { error } = await supabase.from(TABLE_NAME).insert({
    event_id: eventId,
    event_type: ev.type,
    source_type: ev.source?.channelId ? 'channel' : 'user',
    source_id: ev.source?.channelId || ev.source?.userId,
    user_id: ev.source?.userId,
    message_type: ev.content?.type,
    message_text: ev.content?.text || null,
    message_id: null,
    reply_token: null,
    raw_event: { platform: 'lineworks_chako', ...ev } as Record<string, unknown>,
  });

  if (error) {
    return NextResponse.json(
      { error: 'supabase insert failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, event_id: eventId });
}
