export type JstToday = {
  key: string;
  date: Date;
};

export function getJstToday(now: Date = new Date()): JstToday {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  const day = jst.getUTCDate();
  const key = [
    String(year),
    String(month + 1).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');

  return {
    key,
    date: new Date(year, month, day),
  };
}

export function getJstTodayKey(now: Date = new Date()): string {
  return getJstToday(now).key;
}

export function msUntilNextJstMidnight(nowMs: number = Date.now()): number {
  const jstNow = new Date(nowMs + 9 * 60 * 60 * 1000);
  const nextJstMidnightUtcMs =
    Date.UTC(
      jstNow.getUTCFullYear(),
      jstNow.getUTCMonth(),
      jstNow.getUTCDate() + 1,
      0,
      0,
      5
    ) -
    9 * 60 * 60 * 1000;

  return Math.max(1000, nextJstMidnightUtcMs - nowMs);
}
