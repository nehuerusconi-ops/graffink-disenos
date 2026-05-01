import { Router, type IRouter } from "express";
import {
  db,
  appSettingsTable,
  SETTING_KEY_PLANCHA_PRICE,
  DEFAULT_PLANCHA_PRICE_ARS,
  SETTING_KEY_AVAILABLE_SIZES,
  DEFAULT_AVAILABLE_SIZES,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { z } from "zod";

const router: IRouter = Router();

interface AppSettingsResponse {
  planchaGroupingPrice: number;
  availableSizes: string[];
}

async function readPlanchaPrice(): Promise<number> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, SETTING_KEY_PLANCHA_PRICE));
  if (!row) return DEFAULT_PLANCHA_PRICE_ARS;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_PLANCHA_PRICE_ARS;
}

// Reads the configurable size catalog. Returns the seeded defaults
// (10/15/20/30 cm squares) when the row is missing or the persisted JSON is
// corrupt — never throws, so a bad value can't take down the storefront.
// Exported so payments.ts can validate cart inputs against the live catalog
// without re-implementing the read+fallback logic.
export async function readAvailableSizes(): Promise<string[]> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, SETTING_KEY_AVAILABLE_SIZES));
  if (!row) return [...DEFAULT_AVAILABLE_SIZES];
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (
      Array.isArray(parsed) &&
      parsed.every((x): x is string => typeof x === "string")
    ) {
      return parsed;
    }
  } catch {
    // fall through to defaults
  }
  return [...DEFAULT_AVAILABLE_SIZES];
}

export async function getPlanchaPriceArs(): Promise<number> {
  return readPlanchaPrice();
}

router.get("/settings", async (_req, res): Promise<void> => {
  const [planchaGroupingPrice, availableSizes] = await Promise.all([
    readPlanchaPrice(),
    readAvailableSizes(),
  ]);
  const body: AppSettingsResponse = { planchaGroupingPrice, availableSizes };
  res.json(body);
});

// Both fields are optional so the admin can update either one independently
// without having to round-trip the other. We refuse a PATCH that doesn't
// touch any field so the caller doesn't accidentally fire a no-op write.
const UpdateSchema = z
  .object({
    planchaGroupingPrice: z.number().int().min(0).optional(),
    availableSizes: z
      .array(z.string().trim().min(1).max(40))
      .max(30)
      .optional(),
  })
  .refine(
    (v) => v.planchaGroupingPrice !== undefined || v.availableSizes !== undefined,
    { message: "Tenés que enviar planchaGroupingPrice o availableSizes" },
  );

router.patch("/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { planchaGroupingPrice, availableSizes } = parsed.data;

  if (planchaGroupingPrice !== undefined) {
    await db
      .insert(appSettingsTable)
      .values({
        key: SETTING_KEY_PLANCHA_PRICE,
        value: String(planchaGroupingPrice),
      })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: String(planchaGroupingPrice) },
      });
  }

  if (availableSizes !== undefined) {
    // Dedupe (case-sensitive on purpose — "10x10 cm" and "10X10 cm" are
    // different display strings for the admin's UI) and persist as JSON so
    // the GET handler can hydrate it back into an array.
    const cleaned = Array.from(new Set(availableSizes.map((s) => s.trim()))).filter(
      (s) => s.length > 0,
    );
    await db
      .insert(appSettingsTable)
      .values({
        key: SETTING_KEY_AVAILABLE_SIZES,
        value: JSON.stringify(cleaned),
      })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value: JSON.stringify(cleaned) },
      });
  }

  const [planchaPrice, sizes] = await Promise.all([
    readPlanchaPrice(),
    readAvailableSizes(),
  ]);
  const body: AppSettingsResponse = {
    planchaGroupingPrice: planchaPrice,
    availableSizes: sizes,
  };
  res.json(body);
});

export default router;
