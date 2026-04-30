import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, DollarSign, Info, Layers, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useGetAppSettings,
  useUpdateAppSettings,
  getGetAppSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface RateInfo {
  arsToUsd: number;
  source: "env" | "dolarapi" | "default";
  cachedAt: string | null;
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
                <p className="font-semibold text-white/80">Cómo actualizar la tasa:</p>
                <ol className="list-decimal list-inside space-y-1 text-white/60">
                  <li>
                    Configurá la variable de entorno{" "}
                    <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono text-primary">
                      PAYPAL_ARS_TO_USD_RATE
                    </code>{" "}
                    con el nuevo valor (ej: <code className="bg-white/10 px-1 py-0.5 rounded text-xs font-mono">1350</code>).
                  </li>
                  <li>Reiniciá el servidor para que tome el nuevo valor.</li>
                  <li>
                    Si no configurás la variable, el servidor obtiene la tasa automáticamente de{" "}
                    <span className="text-white/80">dolarapi.com</span> (dólar blue) con
                    actualización cada hora. Si no puede conectarse, usa 1200 como respaldo.
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
