/**
 * 北京时间工具函数
 *
 * 数据库中的 matchDate 存储的是比赛场地的当地时区时间（如墨西哥 UTC-6、美国各地 UTC-4~UTC-7）。
 * 后端服务器运行在北京时区 (UTC+8)，所有对外返回和比较均以北京时间为准。
 *
 * 转换公式: 北京时间 = 场馆当地时区时间 + (8 - 场馆UTC偏移)
 *   - 墨西哥城 (UTC-6): +14h → 2026-06-11 13:00 + 14h = 2026-06-12 03:00
 *   - 多伦多   (UTC-4): +12h → 2026-06-12 13:00 + 12h = 2026-06-13 01:00
 *   - 洛杉矶   (UTC-7): +15h → 2026-06-11 19:00 + 15h = 2026-06-12 10:00
 */

/**
 * 2026年6月各场馆的 UTC 时区偏移（夏令时/夏季）
 * 墨西哥自2023年起取消夏令时，全年 UTC-6
 * 美国/加拿大在6月处于夏令时
 */
const VENUE_UTC_OFFSETS: Record<string, number> = {
  'Estadio Azteca': -6,
  'Estadio Azteca (Mexico City)': -6,
  'Estadio Akron': -6,
  'Estadio Akron (Guadalajara)': -6,
  'Estadio BBVA': -6,
  'Estadio BBVA (Monterrey)': -6,

  'BMO Field': -4,
  'BMO Field (Toronto)': -4,

  'BC Place': -7,
  'BC Place (Vancouver)': -7,

  'AT&T Stadium': -5,
  'AT&T Stadium (Dallas)': -5,
  'AT&T Stadium (Arlington, TX)': -5,

  'Mercedes-Benz Stadium': -4,
  'Mercedes-Benz Stadium (Atlanta)': -4,
  'Mercedes-Benz Stadium (Atlanta, GA)': -4,

  'Gillette Stadium': -4,
  'Gillette Stadium (Boston)': -4,
  'Gillette Stadium (Foxborough, MA)': -4,

  'Hard Rock Stadium': -4,
  'Hard Rock Stadium (Miami)': -4,
  'Hard Rock Stadium (Miami Gardens, FL)': -4,

  'NRG Stadium': -5,
  'NRG Stadium (Houston)': -5,
  'NRG Stadium (Houston, TX)': -5,

  'Arrowhead Stadium': -5,
  'Arrowhead Stadium (Kansas City)': -5,
  'Arrowhead Stadium (Kansas City, MO)': -5,

  'SoFi Stadium': -7,
  'SoFi Stadium (Los Angeles)': -7,
  'SoFi Stadium (Inglewood, CA)': -7,

  "Levi's Stadium": -7,
  "Levi's Stadium (Santa Clara)": -7,
  "Levi's Stadium (Santa Clara, CA)": -7,

  'Lumen Field': -7,
  'Lumen Field (Seattle)': -7,
  'Lumen Field (Seattle, WA)': -7,

  'Lincoln Financial Field': -4,
  'Lincoln Financial Field (Philadelphia)': -4,
  'Lincoln Financial Field (Philadelphia, PA)': -4,

  'MetLife Stadium': -4,
  'MetLife Stadium (New York)': -4,
  'MetLife Stadium (East Rutherford, NJ)': -4,

  'State Farm Stadium': -7,
  'State Farm Stadium (Phoenix)': -7,
  'State Farm Stadium (Glendale, AZ)': -7,
};

const BEIJING_OFFSET = 8;

export function beijingNow(): Date {
  return new Date();
}

export function beijingDateString(): string {
  const d = new Date();
  return formatLocalDate(d);
}

export function beijingDateTimeString(): string {
  const d = new Date();
  return formatLocalDateTime(d);
}

export function beijingDateAddDays(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return formatLocalDate(d);
}

export function beijingTimestamp(): number {
  return Date.now();
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatLocalDateTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${formatLocalDate(d)} ${h}:${min}:${s}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 根据场馆名称查找 UTC 偏移（小时）
 */
export function getVenueUtcOffset(venue: string | null | undefined): number {
  if (!venue) return 0;
  for (const [key, offset] of Object.entries(VENUE_UTC_OFFSETS)) {
    if (venue.includes(key) || key.includes(venue)) {
      return offset;
    }
  }
  return 0;
}

/**
 * 将场馆当地时区时间转换为北京时间字符串
 * @param dateStr - 场馆当地时区时间，格式 "2026-06-11 13:00:00"
 * @param venue - 场馆名称，用于查找时区偏移
 * @returns 北京时间字符串，格式 "2026-06-12 03:00:00"
 */
export function venueToBeijingTime(
  dateStr: string | null,
  venue: string | null,
): string {
  if (!dateStr) return dateStr || '';

  const venueOffset = getVenueUtcOffset(venue);
  const deltaHours = BEIJING_OFFSET - venueOffset;

  const parts = dateStr.split(' ');
  const datePart = parts[0];
  const timePart = parts[1] || '00:00:00';

  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min, s] = timePart.split(':').map(Number);

  const venueLocalUtcMs = Date.UTC(y, m - 1, d, h || 0, min || 0, s || 0);
  const beijingUtcMs = venueLocalUtcMs + deltaHours * 60 * 60 * 1000;

  const bj = new Date(beijingUtcMs);

  const yy = bj.getUTCFullYear();
  const mm = pad2(bj.getUTCMonth() + 1);
  const dd = pad2(bj.getUTCDate());
  const hh = pad2(bj.getUTCHours());
  const min2 = pad2(bj.getUTCMinutes());
  const ss = pad2(bj.getUTCSeconds());

  return `${yy}-${mm}-${dd} ${hh}:${min2}:${ss}`;
}

/**
 * 将场馆当地时区时间转换为北京时间的 Date 对象（用于比较）
 * @param dateStr - 场馆当地时区时间
 * @param venue - 场馆名称
 */
export function venueToBeijingDate(
  dateStr: string | null,
  venue: string | null,
): Date {
  if (!dateStr) return new Date(0);

  const venueOffset = getVenueUtcOffset(venue);
  const deltaHours = BEIJING_OFFSET - venueOffset;

  const parts = dateStr.split(' ');
  const datePart = parts[0];
  const timePart = parts[1] || '00:00:00';

  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min, s] = timePart.split(':').map(Number);

  const venueLocalUtcMs = Date.UTC(y, m - 1, d, h || 0, min || 0, s || 0);
  return new Date(venueLocalUtcMs + deltaHours * 60 * 60 * 1000);
}

/**
 * 将北京时间转回场馆当地时区时间（用于存储/查询）
 * 一般不需要，但保留以备后用
 */
export function beijingToVenueTime(
  beijingDateStr: string | null,
  venue: string | null,
): string {
  if (!beijingDateStr) return beijingDateStr || '';

  const venueOffset = getVenueUtcOffset(venue);
  const deltaHours = BEIJING_OFFSET - venueOffset;

  const datePart = beijingDateStr.split(' ')[0];
  const timePart = beijingDateStr.split(' ')[1] || '00:00:00';
  const isoStr = `${datePart}T${timePart}`;

  const bjDate = new Date(isoStr);
  if (isNaN(bjDate.getTime())) return beijingDateStr;

  const venueMs = bjDate.getTime() - deltaHours * 60 * 60 * 1000;
  const v = new Date(venueMs);

  const y = v.getUTCFullYear();
  const m = pad2(v.getUTCMonth() + 1);
  const d = pad2(v.getUTCDate());
  const h = pad2(v.getUTCHours());
  const min = pad2(v.getUTCMinutes());
  const s = pad2(v.getUTCSeconds());

  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}
