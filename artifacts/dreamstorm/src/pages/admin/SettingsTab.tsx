import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  DollarSign,
  Info,
  Layers,
  Save,
  Tag,
  Plus,
  Trash2,
  Lock,
  Ruler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useGetAppSettings,
  useUpdateAppSettings,
  getGetAppSettingsQueryKey,
  useListCategories,
  useCreateCategory,
  useDeleteCategory,
  getListCategoriesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface RateInfo {
  arsToUsd: number;
  source: "env" | "dolarapi" | "default";
  cachedAt: string | null;
  /**
   * Optional — older builds of the API don't return it. When present indicates
   * whether PayPal is hitting api-m.paypal.com (live) or api-m.sandbox.paypal.com
   * (sandbox).
   */
  mode?: "live" | "sandbox";
}

const SOURCE_LABELS: Record<RateInfo["source"], string> = {
  env: "Variable de entorno",
  dolarapi: "dolarapi.com (automático)",
  default: "Valor por defecto",
};

const SOURCE_VARIANTS: Record<RateInfo["source"], "default" | "secondary" | "outline"> = {
  env: "default",
  dolarapi: "secondary",
  default: "outline",
};

export function SettingsTab() {
  const [rateInfo, setRateInfo] = useState<RateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchRate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/paypal/rate");
      if (!res.ok) throw new Error("Error al obtener la tasa");
      const data = (await res.json()) as RateInfo;
      setRateInfo(data);
    } catch {
      setError("No se pudo obtener la tasa actual. Verificá que el servidor esté corriendo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchRate();
  }, []);

  // ---------------------------------------------------------------------------
  // Precio de "Armar plancha" (agrupar carrito como una sola plancha)
  // ---------------------------------------------------------------------------
  const queryClient = useQueryClient();
  const settingsQuery = useGetAppSettings();
  const updateSettingsMut = useUpdateAppSettings();
  const [planchaPriceInput, setPlanchaPriceInput] = useState<string>("");

  useEffect(() => {
    if (settingsQuery.data && planchaPriceInput === "") {
      setPlanchaPriceInput(String(settingsQuery.data.planchaGroupingPrice));
    }
  }, [settingsQuery.data, planchaPriceInput]);

  // ---------------------------------------------------------------------------
  // Medidas estándar (selector de tamaño por ítem en el carrito)
  // ---------------------------------------------------------------------------
  // El catálogo `availableSizes` se persiste como JSON en app_settings y se
  // expone vía useGetAppSettings (también consumido por CartContext). El PATCH
  // tiene semántica REPLACE: enviamos siempre la lista completa post-edición
  // para que el orden y los borrados queden reflejados sin pasos intermedios.
  const [newSizeInput, setNewSizeInput] = useState<string>("");

  const currentSizes: string[] = settingsQuery.data?.availableSizes ?? [];

  const persistSizes = async (next: string[]) => {
    await updateSettingsMut.mutateAsync({ data: { availableSizes: next } });
    await queryClient.invalidateQueries({ queryKey: getGetAppSettingsQueryKey() });
  };

  const handleAddSize = async () => {
    const candidate = newSizeInput.trim();
    if (candidate.length === 0) {
      toast.error("Escribí una medida antes de agregar");
      return;
    }
    if (candidate.length > 40) {
      toast.error("Máximo 40 caracteres");
      return;
    }
    if (currentSizes.includes(candidate)) {
      toast.error("Esa medida ya está en la lista");
      return;
    }
    try {
      await persistSizes([...currentSizes, candidate]);
      setNewSizeInput("");
      toast.success(`Medida “${candidate}” agregada`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    }
  };

  const handleDeleteSize = async (size: string) => {
    if (!window.confirm(`¿Borrar la medida “${size}”?`)) return;
    try {
      await persistSizes(currentSizes.filter((s) => s !== size));
      toast.success(`Medida “${size}” eliminada`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al borrar");
    }
  };

  // ---------------------------------------------------------------------------
  // Categorías administrables
  // ---------------------------------------------------------------------------
  const categoriesQuery = useListCategories();
  const createCategoryMut = useCreateCategory();
  const deleteCategoryMut = useDeleteCategory();
  const [newCategoryName, setNewCategoryName] = useState("");

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (name.length === 0) {
      toast.error("Escribí un nombre antes de agregar");
      return;
    }
    try {
      await createCategoryMut.mutateAsync({ data: { name } });
      await queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
      setNewCategoryName("");
      toast.success(`Categoría “${name}” creada`);
    } catch (err: unknown) {
      // Orval surfaces axios-style errors with a `response.data.error` string
      // when the server returns a JSON body. Fallback to message otherwise so
      // the admin always sees something actionable.
      const fallback = err instanceof Error ? err.message : "Error al crear";
      const apiMsg =
        typeof err === "object" && err !== null && "response" in err
          ? ((err as { response?: { data?: { error?: string } } }).response?.data
              ?.error ?? fallback)
          : fallback;
      toast.error(apiMsg);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!window.confirm(`¿Borrar la categoría “${name}”?`)) return;
    try {
      await deleteCategoryMut.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListCategoriesQueryKey() });
      toast.success(`Categoría “${name}” borrada`);
    } catch (err: unknown) {
      const fallback = err instanceof Error ? err.message : "Error al borrar";
      const apiMsg =
        typeof err === "object" && err !== null && "response" in err
          ? ((err as { response?: { data?: { error?: string } } }).response?.data
              ?.error ?? fallback)
          : fallback;
      toast.error(apiMsg);
    }
  };

  const handleSavePlanchaPrice = async () => {
    const n = Number(planchaPriceInput);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      toast.error("Ingresá un precio válido (entero ≥ 0)");
      return;
    }
    try {
      await updateSettingsMut.mutateAsync({
        data: { planchaGroupingPrice: n },
      });
      // Invalidate the cached /api/settings query so any other consumer in the
      // SPA (notably CartProvider, which reads planchaGroupingPrice to compute
      // the grouped-cart total in the storefront) immediately sees the new
      // price without needing a page refresh.
      await queryClient.invalidateQueries({ queryKey: getGetAppSettingsQueryKey() });
      toast.success("Precio de plancha actualizado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-black uppercase tracking-tight">Configuración</h2>
        <p className="text-sm text-white/50 mt-1">
          Ajustes del sistema y variables de entorno.
        </p>
      </div>

      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-bold uppercase tracking-wider">
            <Tag className="h-4 w-4 text-primary" />
            Categorías del catálogo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-category">Agregar nueva categoría</Label>
            <div className="flex gap-2">
              <Input
                id="new-category"
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder='Ej: "Lali", "Airbag", "Navidad"'
                maxLength={60}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAddCategory();
                  }
                }}
              />
              <Button
                onClick={() => void handleAddCategory()}
                disabled={createCategoryMut.isPending}
                className="bg-primary hover:bg-primary/90"
              >
                {createCategoryMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" /> Agregar
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-white/10 pt-4">
            <p className="text-sm text-white/60 font-semibold uppercase tracking-wider">
              Categorías actuales
            </p>
            {categoriesQuery.isLoading ? (
              <div className="flex items-center gap-2 text-white/50 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando categorías…
              </div>
            ) : categoriesQuery.isError ? (
              <p className="text-sm text-red-400">No se pudo cargar el listado.</p>
            ) : (
              <ul className="divide-y divide-white/10 border border-white/10 rounded-sm">
                {(categoriesQuery.data ?? []).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{c.name}</span>
                      {c.isSystem && (
                        <Badge
                          variant="secondary"
                          className="gap-1 text-[10px] uppercase"
                        >
                          <Lock className="h-3 w-3" /> Sistema
                        </Badge>
                      )}
                    </div>
                    {c.isSystem ? (
                      <span className="text-xs text-white/40">Protegida</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleDeleteCategory(c.id, c.name)}
                        disabled={deleteCategoryMut.isPending}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
                {(categoriesQuery.data ?? []).length === 0 && (
                  <li className="px-3 py-3 text-sm text-white/50">
                    Todavía no hay categorías cargadas.
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="flex gap-2 text-sm text-white/60 border-t border-white/10 pt-4">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <p>
              Las categorías que agregues acá aparecen automáticamente como
              filtros en el catálogo público y en el desplegable del formulario
              de productos. <strong>“Plancha armada”</strong> es una categoría
              del sistema y no se puede borrar porque alimenta una sección
              propia de la home. No vas a poder borrar una categoría si todavía
              hay diseños usándola — primero cambialos de categoría.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-bold uppercase tracking-wider">
            <Ruler className="h-4 w-4 text-primary" />
            Medidas estándar
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-size">Agregar medida disponible</Label>
            <div className="flex gap-2">
              <Input
                id="new-size"
                type="text"
                value={newSizeInput}
                onChange={(e) => setNewSizeInput(e.target.value)}
                placeholder='Ej: "25x25 cm", "A4", "40x60 cm"'
                maxLength={40}
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAddSize();
                  }
                }}
              />
              <Button
                onClick={() => void handleAddSize()}
                disabled={updateSettingsMut.isPending}
                className="bg-primary hover:bg-primary/90"
                data-testid="button-add-size"
              >
                {updateSettingsMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" /> Agregar
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-white/10 pt-4">
            <p className="text-sm text-white/60 font-semibold uppercase tracking-wider">
              Medidas actuales
            </p>
            {settingsQuery.isLoading ? (
              <div className="flex items-center gap-2 text-white/50 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando medidas…
              </div>
            ) : settingsQuery.isError ? (
              <p className="text-sm text-red-400">No se pudo cargar el listado.</p>
            ) : (
              <ul className="divide-y divide-white/10 border border-white/10 rounded-sm">
                {currentSizes.map((s) => (
                  <li
                    key={s}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <span className="font-semibold text-white">{s}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDeleteSize(s)}
                      disabled={updateSettingsMut.isPending}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      data-testid={`button-delete-size-${s}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
                {currentSizes.length === 0 && (
                  <li className="px-3 py-3 text-sm text-white/50">
                    Todavía no hay medidas configuradas. Los clientes solo
                    podrán pedir “Original” o “Personalizado”.
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="flex gap-2 text-sm text-white/60 border-t border-white/10 pt-4">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
            <p>
              Las medidas configuradas acá aparecen en el desplegable de cada
              ítem del carrito. Si el cliente elige una medida distinta de
              <strong> “Original”</strong> (o el modo
              <strong> Personalizado</strong>), el pedido se marca como{" "}
              <strong className="text-amber-200">preparación 24hs hábiles</strong>{" "}
              y vas a recibir un email para re-exportar el archivo a esa medida.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-bold uppercase tracking-wider">
            <Layers className="h-4 w-4 text-primary" />
            Precio armar plancha
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando precio actual…
            </div>
          ) : settingsQuery.isError ? (
            <p className="text-sm text-red-400">No se pudo cargar el precio actual.</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="plancha-price">Precio del servicio “Armar plancha” (ARS)</Label>
                <div className="flex gap-2">
                  <Input
                    id="plancha-price"
                    type="number"
                    min={0}
                    step="100"
                    value={planchaPriceInput}
                    onChange={(e) => setPlanchaPriceInput(e.target.value)}
                    placeholder="1000"
                    className="flex-1"
                  />
                  <Button
                    onClick={() => void handleSavePlanchaPrice()}
                    disabled={updateSettingsMut.isPending}
                    className="bg-primary hover:bg-primary/90"
                  >
                    {updateSettingsMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-2" /> Guardar
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 text-sm text-white/60 border-t border-white/10 pt-4">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                <p>
                  Cuando un cliente activa la opción <strong>“Armar plancha”</strong> en el
                  carrito, este valor se <strong>suma</strong> al subtotal de los diseños
                  como un cargo único por el servicio de armado en una sola plancha
                  imprimible. El comprobante muestra cada diseño con su precio individual y
                  agrega una línea final “Armar plancha” con este monto.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-bold uppercase tracking-wider">
            <DollarSign className="h-4 w-4 text-primary" />
            Tipo de cambio ARS → USD (PayPal)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-white/50 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando tasa actual…
            </div>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : rateInfo ? (
            <div className="space-y-3">
              {rateInfo.mode && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">Modo de PayPal</span>
                  {rateInfo.mode === "live" ? (
                    <Badge className="bg-green-600 hover:bg-green-600 text-white border-transparent">
                      LIVE — cobrando dinero real
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500 hover:bg-amber-500 text-black border-transparent">
                      SANDBOX — modo prueba
                    </Badge>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/60">Tasa activa</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold font-mono">
                    1 USD = {rateInfo.arsToUsd.toLocaleString("es-AR")} ARS
                  </span>
                  <Badge variant={SOURCE_VARIANTS[rateInfo.source]}>
                    {SOURCE_LABELS[rateInfo.source]}
                  </Badge>
                </div>
              </div>
              {rateInfo.cachedAt && (
                <p className="text-xs text-white/40">
                  Última actualización: {new Date(rateInfo.cachedAt).toLocaleString("es-AR")} (cache 1 hora)
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void fetchRate()}
                className="text-white/50 hover:text-white gap-2 px-0"
              >
                <RefreshCw className="h-3 w-3" />
                Actualizar
              </Button>
            </div>
          ) : null}

          <div className="border-t border-white/10 pt-4 space-y-3">
            <div className="flex gap-2 text-sm text-white/60">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
              <div className="space-y-2">
                <p>
                  PayPal requiere cobrar en USD. El servidor convierte automáticamente los precios
                  en ARS usando esta tasa antes de crear cada orden.
                </p>
                <p className="font-semibold text-white/80">Cómo cambiar entre prueba y real:</p>
                <ol className="list-decimal list-inside space-y-1 text-white/60">
                  <li>
                    Cargá las credenciales en los secrets{" "}
                    <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono text-primary">
                      PAYPAL_CLIENT_ID
                    </code>
                    ,{" "}
                    <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono text-primary">
                      PAYPAL_CLIENT_SECRET
                    </code>{" "}
                    y{" "}
                    <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono text-primary">
                      VITE_PAYPAL_CLIENT_ID
                    </code>{" "}
                    (las dos primeras son del servidor, la tercera es la que usa el botón en el navegador).
                  </li>
                  <li>
                    Seteá el secret{" "}
                    <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono text-primary">
                      PAYPAL_MODE
                    </code>{" "}
                    en <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono">live</code> para cobrar de verdad,
                    o en <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono">sandbox</code> para hacer pruebas sin movimiento real.
                  </li>
                  <li>Reiniciá el servidor y verificá arriba que el badge diga LIVE.</li>
                </ol>
                <p className="font-semibold text-white/80 pt-2">Tasa de cambio:</p>
                <ol className="list-decimal list-inside space-y-1 text-white/60">
                  <li>
                    Para fijarla manualmente, cargá el secret{" "}
                    <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono text-primary">
                      PAYPAL_ARS_TO_USD_RATE
                    </code>{" "}
                    (ej: <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono">1350</code>).
                  </li>
                  <li>
                    Si no la cargás, se toma automáticamente de{" "}
                    <span className="text-white/80">dolarapi.com</span> (dólar blue, cache 1 hora). Si falla, usa 1200 como respaldo.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
