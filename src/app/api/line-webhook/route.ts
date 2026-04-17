/**
 * LINE Messaging API webhook endpoint
 *
 * 受信したイベントを:
 *   1. 署名検証（HMAC-SHA256）
 *   2. Supabase `line_messages` テーブルに保存
 *   3. 不在検知→自動応答メッセージ（オプション）
 *
 * 必須env:
 *   - LINE_CHANNEL_SECRET       : 署名検証用
 *   - LINE_CHANNEL_ACCESS_TOKEN : push/reply送信用
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   - LINE_FALLBACK_ENABLED     : "true" で不在時自動応答オン
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { getSupabase } from '@/lib/supabase';

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const FALLBACK_ENABLED = process.env.LINE_FALLBACK_ENABLED === 'true';
const FALLBACK_WINDOW_MS = 90_000; // 90秒以内に主セッション処理されなければフォールバック（将来cron連動）

function verifySignature(body: string, signature: string): boolean {
  if (!CHANNEL_SECRET) return false;
  const hash = crypto
    .createHmac('sha256', CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

async function replyFallback(replyToken: string, text: string): Promise<void> {
  if (!ACCESS_TOKEN) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }],
      }),
    });
  } catch (e) {
    console.error('[line-webhook] fallback reply failed', e);
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'line-webhook' });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-line-signature') || '';
  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: { events?: Array<Record<string, unknown>> };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const events = payload.events || [];
  const supabase = getSupabase();

  for (const ev of events) {
    const evAny = ev as {
      type?: string;
      timestamp?: number;
      webhookEventId?: string;
      replyToken?: string;
      source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
      message?: { type?: string; text?: string; id?: string };
    };

    await supabase.from('line_messages').insert({
      event_id: `${evAny.webhookEventId || ''}_${evAny.timestamp || 0}`,
      event_type: evAny.type,
      source_type: evAny.source?.type,
      source_id: evAny.source?.userId || evAny.source?.groupId || evAny.source?.roomId,
      user_id: evAny.source?.userId,
      message_type: evAny.message?.type,
      message_text: evAny.message?.text || null,
      message_id: evAny.message?.id || null,
      reply_token: evAny.replyToken || null,
      raw_event: ev,
    });

    // フォールバック: 主セッションが落ちてる想定の自動応答
    if (FALLBACK_ENABLED && evAny.type === 'message' && evAny.replyToken) {
      // ここでは即応答しない（主セッションに優先権を与える）。
      // 将来: Vercel Cron で受信から90秒経っても replied=false のメッセージがあれば自動で push する。
      // 現状は受信のみ記録。
    }
  }

  return NextResponse.json({ ok: true });
}
