/**
 * Persistence helpers for the Facturas tab date range.
 *
 * The admin commonly works with the same period for days or weeks at a time
 * (e.g. "Este mes" while reconciling a month). Without persistence the
 * "Desde" / "Hasta" fields reset to empty on every visit and the admin has
 * to re-pick a preset every time. We mirror the last selection in
 * `localStorage` so re-opening the tab on the same device restores it.
 *
 * Two subtleties make this more than a one-line wrapper:
 *
 *   1. An empty range is a meaningful state — if the admin clicks
 *      "Limpiar fechas" we must remember that and re-open empty, instead of
 *      "no key in storage means restore the previous range".
 *   2. A persisted range becomes stale when the calendar year rolls over.
 *      A range like "2025-12-01 / 2025-12-31" is no longer the period the
 *      admin wants to default to in 2026, so we silently discard ranges
 *      whose `to` (or, if `to` is empty, `from`) year is strictly before
 *      the current year and start fresh.
 */

export type DateRange = { from: string; to: string };

export const EMPTY_RANGE: DateRange = { from: "", to: "" };

export const DATE_RANGE_STORAGE_KEY = "dreamstorm:invoices:dateRange";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseYear(s: string): number | null {
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const year = Number.parseInt(m[1]!, 10);
  return Number.isFinite(year) ? year : null;
}

// A persisted date is acceptable when it is either empty (the admin
// explicitly cleared it) or a syntactically valid YYYY-MM-DD string. The
// year-staleness check is applied to the range as a whole, not to each
// endpoint in isolation, so "from" alone or "to" alone never short-circuits
// validation here.
function isWellFormedEndpoint(s: string): boolean {
  return s === "" || ISO_DATE.test(s);
}

// Decide whether a stored range is still relevant. We treat the range as
// stale only when *every* non-empty endpoint is in a year strictly before
// the current calendar year — that way a December range opened in early
// January isn't wiped, but a range from a prior year (the example called
// out in the task) is silently ignored.
function isRangeFreshEnough(range: DateRange, currentYear: number): boolean {
  const years: number[] = [];
  if (range.from) {
    const y = parseYear(range.from);
    if (y === null) return false;
    years.push(y);
  }
  if (range.to) {
    const y = parseYear(range.to);
    if (y === null) return false;
    years.push(y);
  }
  if (years.length === 0) return true;
  return years.some((y) => y >= currentYear);
}

export function loadPersistedDateRange(
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
  now: Date = new Date(),
): DateRange {
  if (!storage) return EMPTY_RANGE;
  let raw: string | null;
  try {
    raw = storage.getItem(DATE_RANGE_STORAGE_KEY);
  } catch {
    return EMPTY_RANGE;
  }
  if (raw === null) return EMPTY_RANGE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_RANGE;
  }
  if (!parsed || typeof parsed !== "object") return EMPTY_RANGE;
  const candidate = parsed as Record<string, unknown>;
  const from = candidate.from;
  const to = candidate.to;
  if (typeof from !== "string" || typeof to !== "string") return EMPTY_RANGE;
  if (!isWellFormedEndpoint(from) || !isWellFormedEndpoint(to)) {
    return EMPTY_RANGE;
  }
  if (from && to && from > to) return EMPTY_RANGE;
  if (!isRangeFreshEnough({ from, to }, now.getFullYear())) return EMPTY_RANGE;
  return { from, to };
}

export function persistDateRange(
  range: DateRange,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify(range));
  } catch {
    // Storage may be unavailable (private mode, quota exceeded, disabled
    // by the browser). Persistence is a UX nicety, not a correctness
    // requirement, so we swallow the failure rather than surface it.
  }
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
