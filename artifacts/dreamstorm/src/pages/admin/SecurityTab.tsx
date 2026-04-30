import { useState, useMemo } from "react";
import { useListWebhookSecurityEvents } from "@workspace/api-client-react";
import type { WebhookSecurityEvent } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldAlert, Search } from "lucide-react";

const SOURCE_LABELS: Record<string, string> = {
  mercadopago: "Mercado Pago",
};

const REASON_LABELS: Record<string, string> = {
  invalid_signature: "Firma inválida",
};

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function SecurityTab() {
  const { data: events, isLoading, error } = useListWebhookSecurityEvents<
    WebhookSecurityEvent[]
  >();
  const [ipQuery, setIpQuery] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const filtered = useMemo(() => {
    if (!events) return [];
    const q = ipQuery.trim().toLowerCase();
    const fromTs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toTs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;
    return events.filter((e) => {
      if (q && !(e.ip ?? "").toLowerCase().includes(q)) return false;
      const ts = new Date(e.createdAt).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      return true;
    });
  }, [events, ipQuery, fromDate, toDate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-white/50" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24 border border-dashed border-red-500/20 rounded-sm">
        <ShieldAlert className="h-10 w-10 text-red-500/50 mx-auto mb-3" />
        <p className="text-red-400/80 text-sm">
          No se pudo cargar el registro de seguridad.
        </p>
      </div>
    );
  }

  const todayStr = ymd(new Date());

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end justify-between">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wider">
            Registro de seguridad{" "}
            <span className="text-white/40">({events?.length ?? 0})</span>
          </h2>
          <p className="text-sm text-white/50">
            Intentos de webhook rechazados por firma inválida. Se conservan los
            500 más recientes.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <Input
              value={ipQuery}
              onChange={(e) => setIpQuery(e.target.value)}
              placeholder="Filtrar por IP"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              max={todayStr}
              className="w-[150px]"
              aria-label="Desde"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              max={todayStr}
              className="w-[150px]"
              aria-label="Hasta"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24 border border-dashed border-white/10 rounded-sm">
          <ShieldAlert className="h-10 w-10 text-white/20 mx-auto mb-3" />
          <p className="text-white/50">
            {events && events.length > 0
              ? "No hay eventos para esos filtros."
              : "No se han registrado intentos rechazados. Bien."}
          </p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-white/40 border-b border-white/5">
                  <th className="px-4 py-3 font-bold">Fecha</th>
                  <th className="px-4 py-3 font-bold">Origen</th>
                  <th className="px-4 py-3 font-bold">Motivo</th>
                  <th className="px-4 py-3 font-bold">IP</th>
                  <th className="px-4 py-3 font-bold">x-request-id</th>
                  <th className="px-4 py-3 font-bold">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr
                    key={e.id}
                    className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3 text-white/80 whitespace-nowrap font-mono text-xs">
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-white/70">
                      {SOURCE_LABELS[e.source] ?? e.source}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border bg-red-500/10 text-red-400 border-red-500/20">
                        {REASON_LABELS[e.reason] ?? e.reason}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-white/80">
                      {e.ip ?? <span className="text-white/30">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-white/60">
                      {e.xRequestId ?? <span className="text-white/30">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-white/50">
                      {e.detail ?? <span className="text-white/30">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
