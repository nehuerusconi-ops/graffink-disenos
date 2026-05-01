/**
 * Tests for the Facturas tab date-range persistence helpers.
 *
 * The admin commonly works with the same period for days at a time. We pin
 * down three behaviours so a future refactor cannot silently regress them:
 *
 *   1. A round trip restores the exact range the admin last picked.
 *   2. An empty range (admin clicked "Limpiar fechas") survives a reload —
 *      it must NOT be treated as "no preference, restore the old one".
 *   3. A stale range from a previous calendar year is silently discarded so
 *      the admin doesn't open the tab in January and see a December range
 *      from last year.
 *
 * Storage is injected explicitly in every test so we don't have to share
 * the global `localStorage` between cases.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DATE_RANGE_STORAGE_KEY,
  EMPTY_RANGE,
  loadPersistedDateRange,
  persistDateRange,
} from "./invoicesDateRangeStorage";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  raw(): Map<string, string> {
    return this.map;
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
});

describe("loadPersistedDateRange", () => {
  it("returns an empty range when nothing has been stored", () => {
    expect(loadPersistedDateRange(storage, new Date("2026-05-01T12:00:00Z"))).toEqual(
      EMPTY_RANGE,
    );
  });

  it("restores a range that was just persisted (round trip)", () => {
    persistDateRange({ from: "2026-05-01", to: "2026-05-31" }, storage);
    expect(
      loadPersistedDateRange(storage, new Date("2026-05-15T12:00:00Z")),
    ).toEqual({ from: "2026-05-01", to: "2026-05-31" });
  });

  it("remembers an explicitly cleared range as empty", () => {
    persistDateRange({ from: "2026-05-01", to: "2026-05-31" }, storage);
    persistDateRange(EMPTY_RANGE, storage);
    expect(
      loadPersistedDateRange(storage, new Date("2026-05-15T12:00:00Z")),
    ).toEqual(EMPTY_RANGE);
  });

  it("discards a range whose endpoints are entirely in a past year", () => {
    persistDateRange({ from: "2025-12-01", to: "2025-12-31" }, storage);
    expect(
      loadPersistedDateRange(storage, new Date("2026-01-05T12:00:00Z")),
    ).toEqual(EMPTY_RANGE);
  });

  it("keeps a range that crosses into the current year", () => {
    persistDateRange({ from: "2025-12-15", to: "2026-01-15" }, storage);
    expect(
      loadPersistedDateRange(storage, new Date("2026-01-20T12:00:00Z")),
    ).toEqual({ from: "2025-12-15", to: "2026-01-15" });
  });

  it("keeps a single-endpoint range when its year matches the current year", () => {
    persistDateRange({ from: "", to: "2026-03-01" }, storage);
    expect(
      loadPersistedDateRange(storage, new Date("2026-04-01T12:00:00Z")),
    ).toEqual({ from: "", to: "2026-03-01" });
  });

  it("discards a single-endpoint range from a past year", () => {
    persistDateRange({ from: "2025-06-01", to: "" }, storage);
    expect(
      loadPersistedDateRange(storage, new Date("2026-02-01T12:00:00Z")),
    ).toEqual(EMPTY_RANGE);
  });

  it("discards malformed JSON instead of throwing", () => {
    storage.setItem(DATE_RANGE_STORAGE_KEY, "{not valid json");
    expect(loadPersistedDateRange(storage, new Date("2026-05-01"))).toEqual(
      EMPTY_RANGE,
    );
  });

  it("discards a payload whose shape is unexpected", () => {
    storage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify({ from: 5, to: null }));
    expect(loadPersistedDateRange(storage, new Date("2026-05-01"))).toEqual(
      EMPTY_RANGE,
    );
  });

  it("discards a malformed YYYY-MM-DD endpoint", () => {
    storage.setItem(
      DATE_RANGE_STORAGE_KEY,
      JSON.stringify({ from: "2026/05/01", to: "2026-05-31" }),
    );
    expect(loadPersistedDateRange(storage, new Date("2026-05-15"))).toEqual(
      EMPTY_RANGE,
    );
  });

  it("discards an inverted range (from > to)", () => {
    persistDateRange({ from: "2026-05-31", to: "2026-05-01" }, storage);
    expect(
      loadPersistedDateRange(storage, new Date("2026-05-15T12:00:00Z")),
    ).toEqual(EMPTY_RANGE);
  });

  it("returns an empty range when storage is unavailable", () => {
    expect(loadPersistedDateRange(null, new Date("2026-05-01"))).toEqual(
      EMPTY_RANGE,
    );
  });

  it("survives a getItem that throws (e.g. SecurityError)", () => {
    const throwing: Pick<Storage, "getItem"> = {
      getItem(): string | null {
        throw new Error("denied");
      },
    };
    expect(loadPersistedDateRange(throwing, new Date("2026-05-01"))).toEqual(
      EMPTY_RANGE,
    );
  });
});

describe("persistDateRange", () => {
  it("writes the range as JSON under the documented key", () => {
    persistDateRange({ from: "2026-05-01", to: "2026-05-31" }, storage);
    expect(storage.raw().get(DATE_RANGE_STORAGE_KEY)).toBe(
      JSON.stringify({ from: "2026-05-01", to: "2026-05-31" }),
    );
  });

  it("writes an explicit empty range so it can be restored as empty", () => {
    persistDateRange(EMPTY_RANGE, storage);
    expect(storage.raw().get(DATE_RANGE_STORAGE_KEY)).toBe(
      JSON.stringify(EMPTY_RANGE),
    );
  });

  it("does nothing when storage is unavailable", () => {
    expect(() => persistDateRange(EMPTY_RANGE, null)).not.toThrow();
  });

  it("swallows setItem failures (quota exceeded, private mode)", () => {
    const throwing: Pick<Storage, "setItem"> = {
      setItem(): void {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() =>
      persistDateRange({ from: "2026-05-01", to: "2026-05-31" }, throwing),
    ).not.toThrow();
  });
});
