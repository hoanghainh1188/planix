/**
 * Nạp lịch lễ từ file seed — SPEC.md §5.4.
 *
 * Mỗi file là MỘT địa điểm cho MỘT năm. Chia nhỏ như vậy để thêm năm mới về sau chỉ là
 * thả thêm một file, không phải sửa file cũ — lịch lễ do nhà nước công bố từng năm, và
 * năm đã công bố thì không nên bị đụng tới nữa.
 *
 * Cờ `complete` là chốt chặn quan trọng: seed thiếu ngày lễ trông y hệt seed đầy đủ, và
 * engine sẽ lặng lẽ coi những ngày đó là ngày làm việc. Với lịch Việt Nam thiếu Tết, đó
 * là 5 ngày công bịa ra trong mỗi năm, và không ai phát hiện cho tới khi giao trễ.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { toDateOnly, type DateOnly } from '../../domain/date-only.js';
import type { HolidayEntry } from '../../io/holiday-csv.js';

const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), 'holidays');

const HolidaySeedSchema = z.strictObject({
  locationId: z.string().min(1),
  year: z.number().int(),
  source: z.string().min(1),
  retrievedAt: z.string().min(1),
  /** Bỏ trống nghĩa là đủ. Khai `false` khi còn ngày chưa biết. */
  complete: z.boolean().optional(),
  pending: z.array(z.string()).optional(),
  holidays: z.array(
    z.strictObject({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      name: z.string().min(1),
    }),
  ),
});

export interface HolidaySeed {
  readonly locationId: string;
  readonly year: number;
  readonly source: string;
  readonly complete: boolean;
  readonly pending: readonly string[];
  readonly entries: readonly HolidayEntry[];
}

export class IncompleteHolidaySeedError extends Error {
  readonly seed: HolidaySeed;
  constructor(seed: HolidaySeed) {
    super(
      `Holiday seed ${seed.locationId}-${seed.year} is incomplete and was not loaded. ` +
        `Missing: ${seed.pending.join('; ')}. ` +
        `Fill the file, or pass allowIncomplete if a partial calendar is genuinely acceptable.`,
    );
    this.name = 'IncompleteHolidaySeedError';
    this.seed = seed;
  }
}

function parseSeed(raw: string): HolidaySeed {
  const parsed = HolidaySeedSchema.parse(JSON.parse(raw));
  const entries = parsed.holidays
    .map((h) => ({ date: toDateOnly(h.date), name: h.name }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const wrongYear = entries.find((e) => Number(e.date.slice(0, 4)) !== parsed.year);
  if (wrongYear !== undefined) {
    throw new Error(
      `Seed ${parsed.locationId}-${parsed.year} contains ${wrongYear.date}, which is a different year.`,
    );
  }

  return {
    locationId: parsed.locationId,
    year: parsed.year,
    source: parsed.source,
    complete: parsed.complete ?? true,
    pending: parsed.pending ?? [],
    entries,
  };
}

export function loadSeed(locationId: string, year: number): HolidaySeed {
  const file = join(SEED_DIR, `${locationId.toLowerCase()}-${year}.json`);
  return parseSeed(readFileSync(file, 'utf8'));
}

/** Các năm đã có seed cho một địa điểm, tăng dần. Dùng để biết nguồn phủ tới đâu. */
export function availableYears(locationId: string): number[] {
  const prefix = `${locationId.toLowerCase()}-`;
  return readdirSync(SEED_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => Number(f.slice(prefix.length, -'.json'.length)))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export interface ResolveOptions {
  /** Nạp cả seed khai `complete: false`. Mặc định false — thà không có còn hơn thiếu. */
  readonly allowIncomplete?: boolean;
}

/** Lấy entry của một năm, ném lỗi nếu seed chưa đủ và người gọi chưa chấp nhận điều đó. */
export function resolveSeed(
  locationId: string,
  year: number,
  options: ResolveOptions = {},
): readonly HolidayEntry[] {
  const seed = loadSeed(locationId, year);
  if (!seed.complete && options.allowIncomplete !== true) {
    throw new IncompleteHolidaySeedError(seed);
  }
  return seed.entries;
}

export type { DateOnly };
