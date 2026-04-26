// =============================================================
// Vercel API Route: /api/imap-poll (POST/GET)
// 配置先: family_calendar/src/app/api/imap-poll/route.ts
//
// 役割: order@tecnest.biz の IMAP受信箱を polling し、
//       新着メールを Supabase mail_messages テーブルに INSERT する。
//       メインくろ(主Claude session) は本処理に関与せず、
//       Supabase Realtime で別の専任くろ(spawn_mail_kuro.mjs)が監視する。
//
// 認証: x-imap-poll-auth ヘッダ(Vercel env IMAP_POLL_AUTH_TOKEN と一致)
//       (cron経由 or 手動trigger用)
//
// 環境変数(Vercel管理画面で設定):
//   SUPABASE_URL = 既存
//   SUPABASE_SERVICE_ROLE_KEY = 既存
//   IMAP_POLL_AUTH_TOKEN = 新規(ランダム32文字以上推奨)
//   IMAP_HOST = 例 sv*.xserver.jp
//   IMAP_PORT = 993 (SSL)
//   IMAP_USER = 例 order@tecnest.biz
//   IMAP_PASS = メールパスワード
//   IMAP_TLS = '1' (SSL/TLS有効)
//
// 動作:
//   - env未設定時は skip(空 200 返却)・コードはdeploy可能
//   - 認証OK時: IMAP接続→UNSEENメール取得→Supabase insert→既読マーク
//   - mail_messages.processed=false でinsert → 専任くろが Realtime で拾う
//
// 設計方針(2026-04-27 健太郎指示):
//   - メインくろ(主session) は IMAP内容を見ない・トークン消費ゼロ
//   - 専任くろ(別 spawn process) がmail_messages監視・独自判断
//   - 致命エラー時のみメインくろにLW通知(notifyMainKuro)
//
// 実装日: 2026-04-27 初版
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

const AUTH_TOKEN = process.env.IMAP_POLL_AUTH_TOKEN || '';

// IMAP env (未設定時はskip)
const IMAP_HOST = process.env.IMAP_HOST || '';
const IMAP_PORT = parseInt(process.env.IMAP_PORT || '993', 10);
const IMAP_USER = process.env.IMAP_USER || '';
const IMAP_PASS = process.env.IMAP_PASS || '';
const IMAP_TLS = (process.env.IMAP_TLS || '1') === '1';

export const maxDuration = 60; // Vercel timeout 60s

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'imap-poll',
    env_configured: {
      auth_token: !!AUTH_TOKEN,
      imap_host: !!IMAP_HOST,
      imap_user: !!IMAP_USER,
      imap_pass: !!IMAP_PASS,
    },
  });
}

export async function POST(req: NextRequest) {
  // 認証検証
  const auth = req.headers.get('x-imap-poll-auth');
  if (!AUTH_TOKEN) {
    return NextResponse.json({
      ok: false,
      skipped: 'auth-token-not-configured',
    }, { status: 200 });
  }
  if (auth !== AUTH_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // IMAP env未設定なら skip(コードは動くが何もしない)
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
    return NextResponse.json({
      ok: true,
      skipped: 'imap-env-not-configured',
      missing: {
        host: !IMAP_HOST,
        user: !IMAP_USER,
        pass: !IMAP_PASS,
      },
    }, { status: 200 });
  }

  try {
    // 動的import(env未設定時のbuild失敗回避)
    const { ImapFlow } = await import('imapflow');
    const { simpleParser } = await import('mailparser');

    const client = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: IMAP_TLS,
      auth: {
        user: IMAP_USER,
        pass: IMAP_PASS,
      },
      logger: false,
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const supabase = getSupabase();

    let processedCount = 0;
    const insertedIds: number[] = [];
    const errors: string[] = [];

    try {
      // UNSEENメールのみ取得
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const msg of (client as any).fetch({ seen: false }, {
        envelope: true,
        bodyStructure: true,
        source: true,
        uid: true,
        flags: true,
      })) {
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          const eventId = `mail:${IMAP_USER}:${msg.uid}:${parsed.messageId || msg.envelope?.messageId || msg.uid}`;

          // 重複チェック
          const { data: existing } = await supabase
            .from('mail_messages')
            .select('id')
            .eq('event_id', eventId)
            .maybeSingle();

          if (existing) {
            processedCount++;
            continue;
          }

          // 本文(text/plain優先・なければhtml→strip)
          const bodyText = parsed.text
            || (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ').slice(0, 10000) : '');

          // 添付一覧(ファイル名のみ・本体は保存しない)
          const attachments = (parsed.attachments || []).map((a) => ({
            filename: a.filename || 'unnamed',
            contentType: a.contentType,
            size: a.size,
          }));

          const fromAddr = parsed.from?.value?.[0]?.address || '';
          const fromName = parsed.from?.value?.[0]?.name || '';
          const toAddr = (parsed.to as { value?: { address?: string }[] } | undefined)?.value?.[0]?.address || IMAP_USER;
          const subject = parsed.subject || '(no subject)';
          const receivedAt = parsed.date?.toISOString() || new Date().toISOString();

          const { data: inserted, error } = await supabase
            .from('mail_messages')
            .insert({
              event_id: eventId,
              account: IMAP_USER,
              from_address: fromAddr,
              from_name: fromName,
              to_address: toAddr,
              subject: subject.slice(0, 500),
              body_text: bodyText.slice(0, 50000),
              body_html_size: parsed.html ? String(parsed.html).length : 0,
              attachments,
              raw_message_id: parsed.messageId || null,
              imap_uid: msg.uid,
              received_at: receivedAt,
              processed: false,
              replied: false,
            })
            .select('id')
            .single();

          if (error) {
            errors.push(`uid=${msg.uid}: ${error.message}`);
            continue;
          }

          insertedIds.push(inserted!.id);
          processedCount++;

          // 既読マーク(processedがtrueになってから他クライアントが見ても問題ないように)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (client as any).messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
        } catch (parseErr) {
          errors.push(`uid=${msg.uid}: parse fail ${(parseErr as Error).message}`);
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }

    return NextResponse.json({
      ok: true,
      processed: processedCount,
      inserted: insertedIds.length,
      inserted_ids: insertedIds,
      errors,
    });
  } catch (e) {
    const err = e as Error;
    console.error('[imap-poll] failed:', err);
    return NextResponse.json({
      ok: false,
      error: err.message,
    }, { status: 500 });
  }
}
