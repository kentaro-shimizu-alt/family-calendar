'use client';

import { useEffect, useState } from 'react';
import { getJstTodayKey, msUntilNextJstMidnight } from './jstToday';

function createJstTodayWorker(): Worker | null {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return null;
  }

  const source = `
    const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

    function pad2(value) {
      return String(value).padStart(2, '0');
    }

    function getJstTodayKey(nowMs = Date.now()) {
      const jst = new Date(nowMs + JST_OFFSET_MS);
      return [
        String(jst.getUTCFullYear()),
        pad2(jst.getUTCMonth() + 1),
        pad2(jst.getUTCDate()),
      ].join('-');
    }

    function msUntilNextJstMidnight(nowMs = Date.now()) {
      const jstNow = new Date(nowMs + JST_OFFSET_MS);
      const nextJstMidnightUtcMs =
        Date.UTC(
          jstNow.getUTCFullYear(),
          jstNow.getUTCMonth(),
          jstNow.getUTCDate() + 1,
          0,
          0,
          5
        ) - JST_OFFSET_MS;
      return Math.max(1000, nextJstMidnightUtcMs - nowMs);
    }

    let midnightTimer = null;

    function postToday(reason) {
      self.postMessage({ type: 'jst-today-key', key: getJstTodayKey(), reason, now: Date.now() });
    }

    function scheduleMidnight() {
      if (midnightTimer) clearTimeout(midnightTimer);
      midnightTimer = setTimeout(() => {
        postToday('worker-midnight');
        scheduleMidnight();
      }, msUntilNextJstMidnight());
    }

    self.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'check') postToday('main-check');
    });

    postToday('worker-start');
    scheduleMidnight();
    setInterval(() => postToday('worker-interval'), 15000);
  `;

  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return worker;
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/**
 * 本日(JST)の日付キー "YYYY-MM-DD" を返すフック。
 *
 * 2026-06-05 くろ: 初版（midnight timer + 30s interval + visibility/focus/操作）
 * 2026-06-19 くろ: 「毎回再発」根本治癒版（深夜0時に再renderが起きず前日マーカーで固まる問題）
 *
 * == 健太郎環境の特性 ==
 * 常時表示モニタにカレンダーを出しっぱなし＝
 *  - タブは hidden にならない(visibilitychange 発火しない)
 *  - ウィンドウは focus されない(focus 発火しない)
 *  - マウス/タッチ操作は来ない(pointerdown/touchstart 発火しない)
 *  - Chromium は「アクティブ操作されない長時間アイドルタブ」の
 *    setTimeout/setInterval を間欠化(最悪1Hz凍結)
 *  → 旧実装の midnight timer / 30s interval / イベントリスナは全部死ぬ
 *
 * == 治癒のキモ ==
 * 1) requestAnimationFrame(rAF) 連鎖を新設。rAF は setTimeout と違う系統で、
 *    画面が描画されている限り走り続ける(throttle policy が別)。
 *    可視タブでは最悪でも 1Hz 程度で必ず呼ばれる。深夜0時跨ぎでも止まらない。
 *    軽量化のため「rAF 内で日付キー算出だけし、変化があれば setState」とする。
 *
 * 2) 壁時計ドリフト検出: 各 rAF tick で performance.now() / Date.now() の差を計測。
 *    PCスリープ・タイマースロットルで Date.now() が大きく飛んだら強制 recalc。
 *
 * 3) BroadcastChannel/storage event: 別タブ/別ウィンドウが先に深夜0時を検知したら相互通知。
 *
 * 4) 従来の契機(midnight timer/interval/visibility/focus/pageshow/操作)は冗長として残す。
 *    どれか一つでも生きていれば直る＝多重防御。
 *
 * 5) 2026-06-27: Web Worker heartbeat を追加。
 *    月送りを触ると直る＝React再描画の契機が欠けている症状なので、メイン画面とは別イベントループから
 *    15秒ごと・JST深夜直後に今日キーを通知し、再描画を起こす。
 *
 * すべて冪等。getJstTodayKey は端末TZ非依存(UTC+9固定算出・サマータイム影響なし)。
 */
export function useJstTodayKey(): string {
  const [key, setKey] = useState<string>(() => getJstTodayKey());

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let rafHandle: number | null = null;
    let bc: BroadcastChannel | null = null;
    let worker: Worker | null = null;
    let lastWallMs = Date.now();
    let lastPerfMs =
      typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    let lastRafCheckMs = 0;

    const publishTodayChange = (next: string) => {
      try { bc?.postMessage({ type: 'jst-today-key', key: next }); } catch {}
      try { localStorage.setItem('jst-today-key-broadcast', next + ':' + Date.now()); } catch {}
    };

    const recalc = () => {
      setKey((prev) => {
        const next = getJstTodayKey();
        if (prev !== next) publishTodayChange(next);
        return prev === next ? prev : next;
      });
    };
    const recalcIfVisible = () => {
      if (typeof document === 'undefined' || !document.hidden) recalc();
    };

    const scheduleMidnight = () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      midnightTimer = setTimeout(() => {
        recalc();
        scheduleMidnight();
      }, msUntilNextJstMidnight());
    };

    // ---- rAF 連鎖（最大の救い手）----
    // rAF は setTimeout と独立した経路。可視タブでは画面更新と同期して必ず動く。
    // ただし高頻度で setState するとレンダリング負荷になるので、500ms 間隔で日付チェック。
    const rafLoop = () => {
      const now = Date.now();
      const perf =
        typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
      // 壁時計ドリフト検出（スリープ復帰・タイマースロットルで Date.now が perf より大きく進んだ場合）
      const wallDelta = now - lastWallMs;
      const perfDelta = perf - lastPerfMs;
      const drift = wallDelta - perfDelta;
      // 2秒以上のドリフト = スリープ復帰やタイマー凍結明け → 強制 recalc
      if (drift > 2000) {
        recalc();
        // 凍結中に midnight timer が消失している可能性 → 予約も貼り直す
        scheduleMidnight();
      }
      // 500ms 経過したら通常 recalc（軽量比較のみ・差分時のみ setState）
      if (now - lastRafCheckMs >= 500) {
        recalc();
        lastRafCheckMs = now;
      }
      lastWallMs = now;
      lastPerfMs = perf;
      rafHandle = requestAnimationFrame(rafLoop);
    };

    // 初期化
    recalc();
    scheduleMidnight();
    lastRafCheckMs = Date.now();
    rafHandle = requestAnimationFrame(rafLoop);
    // 30秒 interval は rAF のバックアップ（バックグラウンドでも仕様上1Hz以上で動く）
    interval = setInterval(recalc, 30 * 1000);

    worker = createJstTodayWorker();
    if (worker) {
      worker.onmessage = (ev: MessageEvent) => {
        if (ev?.data?.type === 'jst-today-key') recalc();
      };
      try { worker.postMessage({ type: 'check' }); } catch {}
    }

    // イベント契機（rAF が死んでいる時の保険）
    document.addEventListener('visibilitychange', recalcIfVisible);
    window.addEventListener('focus', recalc);
    window.addEventListener('pageshow', recalc);
    window.addEventListener('online', recalc);
    document.addEventListener('pointerdown', recalcIfVisible, { passive: true });
    document.addEventListener('touchstart', recalcIfVisible, { passive: true });

    // 別タブ/別ウィンドウからの midnight 通知
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('jst-today-key');
        bc.onmessage = (ev) => {
          if (ev?.data?.type === 'jst-today-key' || ev?.data?.type === 'jst-midnight') recalc();
        };
      }
    } catch {}
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'jst-today-key-broadcast') recalc();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      if (interval) clearInterval(interval);
      if (rafHandle != null) cancelAnimationFrame(rafHandle);
      try { worker?.terminate(); } catch {}
      try { bc?.close(); } catch {}
      document.removeEventListener('visibilitychange', recalcIfVisible);
      window.removeEventListener('focus', recalc);
      window.removeEventListener('pageshow', recalc);
      window.removeEventListener('online', recalc);
      document.removeEventListener('pointerdown', recalcIfVisible);
      document.removeEventListener('touchstart', recalcIfVisible);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return key;
}
