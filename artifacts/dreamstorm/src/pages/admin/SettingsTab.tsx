import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, DollarSign, Info } from "lucide-react";
import { Button } from "@/components/ui/button";

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
