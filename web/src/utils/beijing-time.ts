/**
 * 前端北京时间工具函数
 *
 * 所有比赛时间均以北京时间为准存储和显示。
 * 浏览器可能处于 UTC 时区，因此需要显式处理时区偏移。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function beijingNow(): Date {
  return new Date(Date.now() + BEIJING_OFFSET_MS);
}

export function beijingDateString(): string {
  const d = new Date(Date.now() + BEIJING_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseBeijingDate(dateStr: string): Date {
  return new Date(dateStr.replace(' ', 'T') + '+08:00');
}

export function formatBeijingTime(dateStr: string): string {
  const d = parseBeijingDate(dateStr);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const s = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}
