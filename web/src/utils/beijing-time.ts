/**
 * 前端北京时间工具函数
 *
 * 后端返回的 matchDate 已经是北京时间字符串（如 "2026-06-12 03:00:00"）。
 * parseBeijingDate 通过 +08:00 后缀将其正确转换为 UTC 时间戳。
 * 因此日期比较直接使用 UTC 时间戳即可，无需额外偏移。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function beijingNow(): Date {
  return new Date();
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
  const b = parseBeijingParts(dateStr);
  return `${b.year}-${b.month}-${b.day} ${b.hours}:${b.minutes}:${b.seconds}`;
}

export interface BeijingParts {
  year: string;
  month: string;
  day: string;
  hours: string;
  minutes: string;
  seconds: string;
  weekday: string;
  weekdayNum: number;
}

export function parseBeijingParts(dateStr: string): BeijingParts {
  const [datePart, timePart = '00:00:00'] = dateStr.split(' ');
  const [year, month, day] = datePart.split('-');
  const [hours, minutes, seconds] = timePart.split(':');

  const d = new Date(`${year}-${month}-${day}`);
  const weekdayNum = d.getDay();

  return {
    year,
    month,
    day,
    hours: hours || '00',
    minutes: minutes || '00',
    seconds: seconds || '00',
    weekday: WEEKDAYS[weekdayNum],
    weekdayNum,
  };
}
