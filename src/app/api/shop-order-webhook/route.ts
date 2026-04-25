// =============================================================
// Vercel API Route: /api/shop-order-webhook (POST)
// 配置先: family_calendar/src/app/api/shop-order-webhook/route.ts
//
// 役割: WP CF7プラグイン(tecnest-shop-bridge)からのPOSTを受けて
//       Supabase online_orders テーブルへ INSERT する。
//
// 認証: X-Tecnest-Auth ヘッダー(Vercel 環境変数 SHOP_WEBHOOK_AUTH_TOKEN と一致確認)
//
// 環境変数(Vercel管理画面で設定):
//   SUPABASE_URL = 既存
//   SUPABASE_SERVICE_ROLE_KEY = 既存
//   SHOP_WEBHOOK_AUTH_TOKEN = 新規(ランダム32文字以上推奨)
//
// 実装日: 2026-04-25 (T138/批判1-A-1 対応・ドラフト)
// =============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AUTH_TOKEN = process.env.SHOP_WEBHOOK_AUTH_TOKEN!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function POST(req: NextRequest) {
  // 1. 認証検証
  const auth = req.headers.get('x-tecnest-auth');
  if (!auth || auth !== AUTH_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // 2. 必須フィールド検証
  const required = ['order_id', 'customer_name', 'email', 'cart_json', 'totals_json', 'consent_ts'];
  for (const k of required) {
    if (!payload[k]) {
      return NextResponse.json({ error: `missing field: ${k}` }, { status: 400 });
    }
  }

  // 3. JSON parse(失敗時は空オブジェクトでフォールバック)
  let cart, totals, consent_state;
  try { cart = JSON.parse(payload.cart_json); } catch { cart = {}; }
  try { totals = JSON.parse(payload.totals_json); } catch { totals = {}; }
  try { consent_state = payload.consent_state ? JSON.parse(payload.consent_state) : null; } catch { consent_state = null; }

  // 3-A. テキストフィールドのサニタイズ + 危険スコア計算 (prompt injection / XSS 防御)
  const sanitizeHtml = (s: string): string => {
    if (!s) return s;
    return String(s)
      .replace(/<\s*\/?\s*(script|iframe|object|embed|style|link|meta|form|input|button)[^>]*>/gi, '[removed-tag]')
      .replace(/javascript\s*:/gi, '[removed-js-scheme]')
      .replace(/on\w+\s*=\s*"[^"]*"/gi, '[removed-event]')
      .replace(/on\w+\s*=\s*'[^']*'/gi, '[removed-event]')
      .replace(/data\s*:\s*text\/html/gi, '[removed-data-html]');
  };
  const calcSuspicionScore = (text: string): { score: number; flags: string[] } => {
    if (!text) return { score: 0, flags: [] };
    const flags: string[] = [];
    const patterns: Array<[RegExp, string, number]> = [
      [/<\s*script/i, 'html-script', 50],
      [/<\s*iframe/i, 'html-iframe', 50],
      [/javascript\s*:/i, 'js-scheme', 40],
      [/ignore\s+(previous|above|all)/i, 'pi-ignore-prev', 70],
      [/override\s+(previous|safety|rules)/i, 'pi-override', 70],
      [/system\s*[:：]/i, 'pi-system-prefix', 30],
      [/\[\s*(system|admin|override)\s*\]/i, 'pi-bracket-system', 60],
      [/無視して\s*(以下|前|これまで)/, 'pi-jp-ignore', 70],
      [/これまでの(指示|命令|ルール)を(無視|忘れ)/, 'pi-jp-forget-rules', 80],
      [/パスワードを(全部|すべて|送)/, 'pi-jp-send-pw', 90],
      [/(機密|秘密)情報を(送|教え)/, 'pi-jp-secret', 70],
      [/くろがみれたら/, 'pi-jp-kuro-trigger', 50],
      [/AI(に|へ)?(命令|指示|送信)/, 'pi-jp-ai-cmd', 60],
    ];
    let score = 0;
    for (const [re, flag, w] of patterns) {
      if (re.test(text)) { flags.push(flag); score += w; }
    }
    return { score, flags };
  };

  const cleanedCustomerName = sanitizeHtml(payload.customer_name);
  const cleanedCompany = sanitizeHtml(payload.company || '');
  const cleanedAddress = sanitizeHtml(payload.address || '');
  const cleanedNote = sanitizeHtml(payload.note || '');

  // note は500字までに切詰
  const truncatedNote = cleanedNote.length > 500 ? cleanedNote.slice(0, 500) + '...[truncated]' : cleanedNote;

  // 全テキスト合算で suspicion 計算
  const allText = [cleanedCustomerName, cleanedCompany, cleanedAddress, cleanedNote].join(' ');
  const { score: suspicionScore, flags: suspicionFlags } = calcSuspicionScore(allText);

  // 4. Supabase online_orders へ INSERT(サニタイズ済み値で書込)
  const insertPayload: Record<string, unknown> = {
    order_id: payload.order_id,
    customer_name: cleanedCustomerName,
    company: cleanedCompany || null,
    email: payload.email,
    tel: payload.tel || null,
    zip: payload.zip || null,
    address: cleanedAddress || null,
    note: truncatedNote || null,
    consent_ts: payload.consent_ts,
    consent_state,
    cart,
    totals,
    status: 'received',
    received_at: new Date().toISOString(),
  };
  // 危険スコア >0 なら別カラムにフラグ記録(suspicion_score / suspicion_flags が存在すれば)
  if (suspicionScore > 0) {
    insertPayload.suspicion_score = suspicionScore;
    insertPayload.suspicion_flags = suspicionFlags;
  }
  const { data, error } = await supabase
    .from('online_orders')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    console.error('[shop-order-webhook] Supabase insert failed:', error);
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  // 5. consent_logs テーブルに法的証跡として別途記録(任意)
  if (consent_state) {
    await supabase.from('consent_logs').insert({
      order_id: payload.order_id,
      consent_ts: payload.consent_ts,
      consent_state,
      remote_ip: payload.remote_ip || null,
      user_agent: payload.user_agent || null,
    }).then(({ error: e }) => {
      if (e) console.warn('[shop-order-webhook] consent_logs insert failed:', e);
    });
  }

  // 6. 危険スコアが高い場合は健太郎にLW通知 (best-effort, non-blocking)
  if (suspicionScore >= 50) {
    try {
      // LW通知は family_calendar 側に envがある場合のみ
      const lwBotId = process.env.LINEWORKS_BOT_ID;
      const lwUserId = process.env.LINEWORKS_KENTARO_USER_ID;
      if (lwBotId && lwUserId) {
        // ここではfetch直接ではなく fire-and-forget でログ残すのみ
        console.warn('[shop-order-webhook] HIGH SUSPICION', {
          order_id: payload.order_id,
          score: suspicionScore,
          flags: suspicionFlags,
        });
      }
    } catch (e) {
      console.warn('[shop-order-webhook] notify failed:', e);
    }
  }

  return NextResponse.json({
    ok: true,
    order_id: payload.order_id,
    inserted_at: data?.received_at,
    suspicion_score: suspicionScore,
  }, { status: 200 });
}

// 念のため: GETは405
export async function GET() {
  return NextResponse.json({ error: 'method not allowed' }, { status: 405 });
}
