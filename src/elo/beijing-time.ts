/**
 * 北京时间工具函数
 *
 * 后端服务器运行在 UTC+8 (北京时间) 时区。
 * 所有比赛时间、日期计算均以北京时间为准。
 * new Date() 在服务器上返回的就是北京时间，因此直接使用本地方法获取日期即可，
 * 不要使用 toISOString()（会转为 UTC 导致偏差）。
 */

export function beijingNow(): Date {
  return new Date();
}

export function beijingDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function beijingDateTimeString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

export function beijingDateAddDays(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function beijingTimestamp(): number {
  return Date.now();
}
