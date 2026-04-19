/**
 * LINE WORKS Bot Callback endpoint
 *
 * 受信したイベントを既存 line_messages テーブルに保存
 * (platform: lineworks / event_id prefix: lw: )
 *
 * 必須env:
 *   - LINEWORKS_BOT_SECRET (将来の署名検証用・現状スキップ)
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *
 * 2026-04-20 初版
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getSupabase } from '@/lib/supabase';

const BOT_SECRET = process.env.LINEWORKS_BOT_SECRET || '';

function verifySignature(body: string, signature: string): boolean {
  if (!BOT_SECRET) return true; // 未設定時は署名検証をスキップ(TODO)
  if (!signature) return false;
  const hash = crypto
    .createHmac('sha256', BOT_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'lineworks-webhook' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-works-signature') || '';

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  type LineWorksEvent = {
    type?: string;
    source?: { userId?: string; channelId?: string; domainId?: number };
    issuedTime?: string;
    content?: {
      type?: string;
      text?: string;
      fileId?: string;
      postback?: string;
    };
  };

  let ev: LineWorksEvent;
  try {
    ev = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const supabase = getSupabase();

  // event_id: LINE WORKSにはwebhookEventIdがないため、timestamp+userIdで合成
  const ts = ev.issuedTime || new Date().toISOString();
  const userId = ev.source?.userId || '';
  const eventId = `lw:${ts}:${userId}`;

  await supabase.from('line_messages').insert({
    event_id: eventId,
    event_type: ev.type,
    source_type: ev.source?.channelId ? 'channel' : 'user',
    source_id: ev.source?.channelId || ev.source?.userId,
    user_id: ev.source?.userId,
    message_type: ev.content?.type,
    message_text: ev.content?.text || null,
    message_id: null,
    reply_token: null,
    raw_event: { platform: 'lineworks', ...ev } as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}
