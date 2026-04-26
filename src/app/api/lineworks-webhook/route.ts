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

  // メインchannelフィルタ (2026-04-26 健太郎指示・案A実装):
  //   - 受信処理は健太郎+くろBot 2人ルーム(LINEWORKS_MAIN_CHANNEL_ID)のみ
  //   - 3人ルーム / 個別DM / その他 channel 等からの受信は即200で破棄
  //   - Supabase line_messages 未書込 → Realtime通知発火せず → くろ完全無認識
  //   - env未設定時は従来通り全件受信(セーフフォールバック)
  const MAIN_CHANNEL_ID = process.env.LINEWORKS_MAIN_CHANNEL_ID || '';
  if (MAIN_CHANNEL_ID && ev.source?.channelId !== MAIN_CHANNEL_ID) {
    return NextResponse.json({
      ok: true,
      filtered: 'non-main-channel',
      received_channel: ev.source?.channelId || 'no-channel',
    });
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

  // 既読マーク(ベストエフォート): LINE WORKS 公式未提供だが将来 API 提供時の切替点
  // 失敗しても受信処理に影響させない(fire-and-forget)
  // 注: Vercel Edge/Serverless から外部APIを待たず投げっぱなしにするため await しない
  if (ev.type === 'message' && ev.source?.userId) {
    tryMarkAsRead(ev.source.userId).catch(() => {
      // 意図的に握りつぶす。受信処理の正常応答を優先
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * LINE WORKS 既読マーク(ベストエフォート)
 *
 * LINE WORKS Bot API は公式に既読APIを提供していない(2026-04-20時点・フォーラム確認済)。
 * 将来 API 提供されたときの差替点として用意。複数候補URLを試して全部落ちたら諦める。
 *
 * Service Account トークンは LINEWORKS_CLIENT_ID/SECRET/SERVICE_ACCOUNT/PRIVATE_KEY
 * から JWT で取得する必要があるが、Vercel 環境では鍵ファイルを持てないため、
 * 環境変数 LINEWORKS_PRIVATE_KEY_PEM (改行は \\n エンコード) から読む。
 * 未設定なら黙って skip (= no-op)。
 */
async function tryMarkAsRead(userId: string): Promise<void> {
  const clientId = process.env.LINEWORKS_CLIENT_ID;
  const clientSecret = process.env.LINEWORKS_CLIENT_SECRET;
  const serviceAccount = process.env.LINEWORKS_SERVICE_ACCOUNT;
  const botId = process.env.LINEWORKS_BOT_ID;
  const privateKeyRaw = process.env.LINEWORKS_PRIVATE_KEY_PEM;
  if (!clientId || !clientSecret || !serviceAccount || !botId || !privateKeyRaw) {
    return; // 設定不足: 黙って skip
  }
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  // Edge でも動くよう jsonwebtoken は避けて最小 JWT 組立
  // ただし RS256 署名は Web Crypto でないと厳しい → node runtime 前提
  let token: string;
  try {
    const jwt = await import('jsonwebtoken');
    const nowSec = Math.floor(Date.now() / 1000);
    const assertion = jwt.default.sign(
      {
        iss: clientId,
        sub: serviceAccount,
        iat: nowSec,
        exp: nowSec + 3600,
      },
      privateKey,
      { algorithm: 'RS256' }
    );
    const tokenRes = await fetch('https://auth.worksmobile.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        assertion,
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'bot',
      }).toString(),
    });
    if (!tokenRes.ok) return;
    const tokenData = await tokenRes.json();
    token = tokenData.access_token;
  } catch {
    return;
  }

  const candidates = [
    `https://www.worksapis.com/v1.0/bots/${botId}/users/${userId}/read`,
    `https://www.worksapis.com/v1.0/bots/${botId}/users/${userId}/messages/markAsRead`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      if (res.ok) return; // 1つでも通ったら終わり
    } catch {
      // 候補失敗は無視して次へ
    }
  }
  // 全候補失敗 = 公式未提供想定どおり。諦める
}
