import { useState, FormEvent } from "react";
import { Download, Mail, ArrowLeft, ShoppingBag, Loader2, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";
import { useLocation } from "wouter";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imagePath: string;
  filePath?: string | null;
}

interface PurchaseOrder {
  invoiceNumber: number;
  customerName: string;
  items: OrderItem[];
  total: number;
  paymentMethod: string;
  createdAt: string;
}

function formatMethod(method: string): string {
  const map: Record<string, string> = {
    mercadopago: "Mercado Pago",
    transferencia: "Transferencia bancaria",
    paypal: "PayPal",
  };
  return map[method] ?? method;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function MisCompras() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setOrders(null);
    setSearched(false);

    try {
      const res = await fetch(
        `${BASE}/api/orders/by-email?email=${encodeURIComponent(trimmed)}`
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "No se pudieron cargar tus compras.");
        return;
      }
      const data = (await res.json()) as PurchaseOrder[];
      setOrders(data);
      setSearched(true);
    } catch {
      setError("No se pudo conectar al servidor. Intentá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  function toStorageUrl(path: string): string {
    if (path.startsWith("/objects/") || path.startsWith("/public-objects/")) {
      return `${BASE}/api/storage${path}`;
    }
    return path;
  }

  function downloadUrl(item: OrderItem): string {
    return toStorageUrl(item.filePath ?? item.imagePath);
  }

  return (
    <main className="min-h-screen bg-background flex flex-col font-sans">
      <Header />

      <div className="flex-1 px-4 py-16 max-w-2xl mx-auto w-full">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-white/40 hover:text-white/70 text-sm mb-10 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al catálogo
        </button>

        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-primary/15 rounded-lg flex items-center justify-center">
              <ShoppingBag className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-3xl font-black uppercase tracking-tight text-white">
              Mis Compras
            </h1>
          </div>
          <p className="text-white/50 text-sm leading-relaxed">
            Ingresá el email con el que realizaste tu compra para volver a descargar tus diseños.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-3 mb-10">
          <div className="relative flex-1">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
            <Input
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-primary"
            />
          </div>
          <Button
            type="submit"
            disabled={loading}
            className="bg-primary hover:bg-primary/90 text-white font-bold uppercase tracking-wider px-6 shrink-0"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Buscar"
            )}
          </Button>
        </form>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm mb-8">
            {error}
          </div>
        )}

        {searched && orders !== null && orders.length === 0 && (
          <div className="text-center py-20">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-5">
              <PackageOpen className="w-9 h-9 text-white/20" />
            </div>
            <p className="text-white/40 font-medium">No encontramos compras para ese email.</p>
            <p className="text-white/25 text-sm mt-1">
              Revisá que el email sea el mismo que usaste al comprar.
            </p>
          </div>
        )}

        {orders && orders.length > 0 && (
          <div className="space-y-6">
            <p className="text-white/40 text-sm">
              {orders.length === 1
                ? "1 compra encontrada"
                : `${orders.length} compras encontradas`}
            </p>

            {orders.map((order) => (
              <div
                key={order.invoiceNumber}
                className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 bg-white/[0.02]">
                  <div>
                    <span className="text-xs font-mono text-white/30 tracking-widest uppercase">
                      Factura N°
                    </span>
                    <span className="ml-2 text-white font-black text-base font-mono">
                      {String(order.invoiceNumber).padStart(6, "0")}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-white/30 text-xs">{formatDate(order.createdAt)}</p>
                    <p className="text-white/50 text-xs mt-0.5">{formatMethod(order.paymentMethod)}</p>
                  </div>
                </div>

                <div className="divide-y divide-white/[0.06]">
                  {order.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-5 py-4 gap-4"
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <img
                          src={toStorageUrl(item.imagePath)}
                          alt={item.name}
                          className="w-12 h-12 rounded-md object-cover bg-white/5 shrink-0"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <div className="min-w-0">
                          <p className="text-white text-sm font-semibold truncate">
                            {item.name}
                          </p>
                          <p className="text-white/35 text-xs mt-0.5">
                            Cant. {item.quantity} · ${item.price.toLocaleString("es-AR")} ARS c/u
                          </p>
                        </div>
                      </div>

                      <a
                        href={downloadUrl(item)}
                        download
                        className="flex items-center gap-2 bg-primary/15 hover:bg-primary/25 text-primary border border-primary/20 hover:border-primary/40 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Descargar
                      </a>
                    </div>
                  ))}
                </div>

                <div className="px-5 py-3 border-t border-white/[0.06] flex justify-end">
                  <span className="text-white/30 text-xs mr-2">Total pagado:</span>
                  <span className="text-primary font-black text-sm">
                    ${order.total.toLocaleString("es-AR")} ARS
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Footer />
    </main>
  );
}
