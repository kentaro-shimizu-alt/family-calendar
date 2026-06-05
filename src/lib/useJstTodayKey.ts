'use client';

import { useEffect, useState } from 'react';
import { getJstTodayKey, msUntilNextJstMidnight } from './jstToday';

/**
 * 本日(JST)の日付キー "YYYY-MM-DD" を返すフック。
 *
 * 2026-06-05 くろ: 「日付が変わっても今日マーカーが前日のまま」根本対策。
 * 健太郎環境は常時表示モニタにカレンダーを出しっぱなし＝タブが hidden にも focus にもならず、
 * マウスも乗らないため、従来の visibilitychange + 60秒interval だけでは
 * ブラウザのタイマー凍結/スロットルで再計算が走らず前日が残る。
 *
 * そこで「再計算の契機」を最大化する:
 *  - マウント直後（SSR=サーバ時刻 とのズレを即補正）
 *  - 深夜0時ちょうど（msUntilNextJstMidnight で精密に予約・発火後に再予約）
 *  - 可視化(visibilitychange) / ウィンドウfocus / bfcache復元(pageshow)
 *  - 任意の操作(pointerdown / touchstart) ← 凍結タブでも触れば即補正
 *  - 30秒ごとの軽量interval（差分時のみ setState=再render最小）
 *
 * これらは冪等。getJstTodayKey は端末TZに依存しない（UTC+9h固定算出）。
 */
export function useJstTodayKey(): string {
  const [key, setKey] = useState<string>(() => getJstTodayKey());

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | null = null;
    const recalc = () =>
      setKey((prev) => {
        const next = getJstTodayKey();
        return prev === next ? prev : next;
      });
    const recalcIfVisible = () => {
      if (!document.hidden) recalc();
    };
    const scheduleMidnight = () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      midnightTimer = setTimeout(() => {
        recalc();
        scheduleMidnight(); // 翌日分を再予約（24h固定intervalは端末スリープでズレるため都度算出）
      }, msUntilNextJstMidnight());
    };

    recalc();
    scheduleMidnight();
    document.addEventListener('visibilitychange', recalcIfVisible);
    window.addEventListener('focus', recalc);
    window.addEventListener('pageshow', recalc);
    document.addEventListener('pointerdown', recalcIfVisible, { passive: true });
    document.addEventListener('touchstart', recalcIfVisible, { passive: true });
    const interval = setInterval(recalc, 30 * 1000);

    return () => {
      if (midnightTimer) clearTimeout(midnightTimer);
      document.removeEventListener('visibilitychange', recalcIfVisible);
      window.removeEventListener('focus', recalc);
      window.removeEventListener('pageshow', recalc);
      document.removeEventListener('pointerdown', recalcIfVisible);
      document.removeEventListener('touchstart', recalcIfVisible);
      clearInterval(interval);
    };
  }, []);

  return key;
}
