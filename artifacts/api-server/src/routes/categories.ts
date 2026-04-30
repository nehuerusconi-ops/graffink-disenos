import { Router, type IRouter } from "express";
import { eq, asc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, categoriesTable, productsTable } from "@workspace/db";
import { CreateCategoryBody, DeleteCategoryParams } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------
// We use a simple deterministic slug derived from the name: lowercase, strip
// accents, keep [a-z0-9] and dashes. Spanish accents are normalised so that
// "Más Vendidos" → "mas-vendidos".
function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// One-time seeder
// ---------------------------------------------------------------------------
// Runs on server boot. If the categories table is empty, inserts the seven
// categories that lived as a hardcoded TS union before this feature so that
// existing products keep their filter on the storefront. "Plancha armada" is
// flagged as a system category and cannot be deleted from the admin UI.
const SEED_CATEGORIES: ReadonlyArray<{
  name: string;
  isSystem: boolean;
  sortOrder: number;
}> = [
  { name: "Streetwear", isSystem: false, sortOrder: 10 },
  { name: "Anime", isSystem: false, sortOrder: 20 },
  { name: "Frases", isSystem: false, sortOrder: 30 },
  { name: "Deportes", isSystem: false, sortOrder: 40 },
  { name: "Vintage", isSystem: false, sortOrder: 50 },
  { name: "Infantil", isSystem: false, sortOrder: 60 },
  { name: "Plancha armada", isSystem: true, sortOrder: 1000 },
];

export async function seedCategoriesIfEmpty(): Promise<void> {
  try {
    const existing = await db.select({ id: categoriesTable.id }).from(categoriesTable).limit(1);
    if (existing.length > 0) return;
    await db.insert(categoriesTable).values(
      SEED_CATEGORIES.map((c) => ({
        id: randomUUID(),
        name: c.name,
        slug: slugify(c.name),
        isSystem: c.isSystem,
        sortOrder: c.sortOrder,
      })),
    );
    logger.info({ count: SEED_CATEGORIES.length }, "Seeded initial categories");
  } catch (err) {
    logger.error({ err }, "Failed to seed categories");
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get("/categories", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(categoriesTable)
    .orderBy(asc(categoriesTable.sortOrder), asc(categoriesTable.name));
  res.json(rows);
});

router.post("/categories", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const name = parsed.data.name.trim();
  if (name.length === 0) {
    res.status(400).json({ error: "El nombre no puede estar vacío" });
    return;
  }

  const slug = slugify(name);
  if (slug.length === 0) {
    res
      .status(400)
      .json({ error: "El nombre debe contener al menos una letra o número" });
    return;
  }

  // Case-insensitive uniqueness check by slug (covers "Lali" vs "lali" vs "LALI").
  const [conflict] = await db
    .select({ id: categoriesTable.id })
    .from(categoriesTable)
    .where(eq(categoriesTable.slug, slug));
  if (conflict) {
    res.status(409).json({ error: "Ya existe una categoría con ese nombre" });
    return;
  }

  // Compute next sortOrder so admin-added categories land at the end (just
  // before the reserved "Plancha armada" slot at 1000) without colliding.
  const [maxRow] = await db
    .select({ maxOrder: sql<number>`COALESCE(MAX(${categoriesTable.sortOrder}), 0)` })
    .from(categoriesTable);
  const nextSortOrder = (maxRow?.maxOrder ?? 0) + 10;

  try {
    const [row] = await db
      .insert(categoriesTable)
      .values({
        id: randomUUID(),
        name,
        slug,
        isSystem: false,
        sortOrder: nextSortOrder,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    // Race-safe: if two simultaneous POSTs hit the same name/slug between
    // our pre-check and the INSERT, postgres will raise a unique violation
    // (SQLSTATE 23505). Map that back to the same 409 we return for the
    // pre-check so the contract is consistent.
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === "23505") {
      res.status(409).json({ error: "Ya existe una categoría con ese nombre" });
      return;
    }
    req.log.error({ err }, "Failed to create category");
    res.status(400).json({ error: "No se pudo crear la categoría" });
  }
});

router.delete("/categories/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Categoría no encontrada" });
    return;
  }

  if (existing.isSystem) {
    res.status(409).json({
      error:
        "No se puede borrar una categoría del sistema (ej: Plancha armada).",
    });
    return;
  }

  // Block deletion if any product still uses this category — otherwise the
  // storefront would end up with orphan filter pills and the admin product
  // form would show a stale value.
  const [usage] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(productsTable)
    .where(eq(productsTable.category, existing.name));
  const inUse = Number(usage?.count ?? 0);
  if (inUse > 0) {
    res.status(409).json({
      error: `No se puede borrar: hay ${inUse} ${
        inUse === 1 ? "producto" : "productos"
      } en esta categoría. Cambialos de categoría primero.`,
    });
    return;
  }

  await db.delete(categoriesTable).where(eq(categoriesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
