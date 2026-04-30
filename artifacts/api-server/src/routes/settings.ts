import { Router, type IRouter } from "express";
import {
  db,
  appSettingsTable,
  SETTING_KEY_PLANCHA_PRICE,
  DEFAULT_PLANCHA_PRICE_ARS,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { z } from "zod";

const router: IRouter = Router();

interface AppSettingsResponse {
  planchaGroupingPrice: number;
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

export async function getPlanchaPriceArs(): Promise<number> {
  return readPlanchaPrice();
}

router.get("/settings", async (_req, res): Promise<void> => {
  const planchaGroupingPrice = await readPlanchaPrice();
  const body: AppSettingsResponse = { planchaGroupingPrice };
  res.json(body);
});

const UpdateSchema = z.object({
  planchaGroupingPrice: z.number().int().min(0),
});

router.patch("/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { planchaGroupingPrice } = parsed.data;

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

  const body: AppSettingsResponse = { planchaGroupingPrice };
  res.json(body);
});

export default router;
