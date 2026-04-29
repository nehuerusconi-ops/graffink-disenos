import { useGetOrderStats } from "@workspace/api-client-react";
import { Loader2, TrendingUp, ShoppingBag, CalendarDays, DollarSign } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const PAYMENT_LABELS: Record<string, string> = {
  mercadopago: "Mercado Pago",
  uala: "Ualá Bis",
  paypal: "PayPal",
};

function formatARS(value: number): string {
  return `$${value.toLocaleString("es-AR")}`;
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof TrendingUp;
}) {
  return (
    <div className="bg-card border border-card-border rounded-md p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold uppercase tracking-widest text-white/50">
          {label}
        </span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="text-3xl font-black tracking-tight">{value}</p>
      {hint && <p className="text-xs text-white/40 mt-1">{hint}</p>}
    </div>
  );
}

export function SalesTab() {
  const { data: stats, isLoading } = useGetOrderStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-white/50" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-24 border border-dashed border-white/10 rounded-sm">
        <p className="text-white/50">No se pudieron cargar las estadísticas.</p>
      </div>
    );
  }

  const chartData = stats.revenueByDay.map((d) => ({
    date: new Date(d.date).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
    }),
    Ingresos: d.revenue,
    Ventas: d.orders,
  }));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Ingresos totales"
          value={formatARS(stats.totalRevenue)}
          hint={`${stats.totalOrders} ventas en total`}
          icon={DollarSign}
        />
        <StatCard
          label="Hoy"
          value={formatARS(stats.revenueToday)}
          hint={`${stats.ordersToday} ${stats.ordersToday === 1 ? "venta" : "ventas"}`}
          icon={CalendarDays}
        />
        <StatCard
          label="Últimos 7 días"
          value={formatARS(stats.revenueThisWeek)}
          icon={TrendingUp}
        />
        <StatCard
          label="Este mes"
          value={formatARS(stats.revenueThisMonth)}
          icon={ShoppingBag}
        />
      </div>

      <div className="bg-card border border-card-border rounded-md p-6">
        <h3 className="text-sm font-bold uppercase tracking-widest text-white/70 mb-1">
          Ingresos últimos 30 días
        </h3>
        <p className="text-xs text-white/40 mb-6">
          Evolución diaria de ventas confirmadas
        </p>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="rgba(255,255,255,0.4)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="rgba(255,255,255,0.4)"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
              />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                formatter={(value: number, name: string) =>
                  name === "Ingresos" ? [formatARS(value), name] : [value, name]
                }
              />
              <Area
                type="monotone"
                dataKey="Ingresos"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#salesGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-card border border-card-border rounded-md p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/70 mb-4">
            Diseños más vendidos
          </h3>
          {stats.topProducts.length === 0 ? (
            <p className="text-white/40 text-sm py-6 text-center">
              Todavía no hay ventas.
            </p>
          ) : (
            <ul className="space-y-3">
              {stats.topProducts.map((p, i) => (
                <li
                  key={p.productId}
                  className="flex items-center justify-between gap-4 text-sm border-b border-white/5 last:border-0 pb-3 last:pb-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-7 h-7 flex items-center justify-center rounded-sm bg-primary/10 text-primary text-xs font-black shrink-0">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold truncate">{p.name}</p>
                      <p className="text-xs text-white/50">
                        {p.quantity} {p.quantity === 1 ? "unidad vendida" : "unidades vendidas"}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono font-bold text-primary shrink-0">
                    {formatARS(p.revenue)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-md p-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-white/70 mb-4">
            Ingresos por método de pago
          </h3>
          {stats.revenueByMethod.length === 0 ? (
            <p className="text-white/40 text-sm py-6 text-center">
              Todavía no hay ventas.
            </p>
          ) : (
            <ul className="space-y-3">
              {stats.revenueByMethod.map((m) => {
                const max = Math.max(...stats.revenueByMethod.map((x) => x.revenue), 1);
                const pct = (m.revenue / max) * 100;
                return (
                  <li key={m.method} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-bold">{PAYMENT_LABELS[m.method] ?? m.method}</span>
                      <span className="font-mono text-white/70">
                        {formatARS(m.revenue)}{" "}
                        <span className="text-white/40">({m.orders})</span>
                      </span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
