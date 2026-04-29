import { useEffect, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { CheckCircle2, Clock, XCircle, Mail, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";
import { useCart } from "@/components/storefront/CartContext";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

type ResultType = "success" | "pending" | "failure";

export default function CheckoutResult({ type }: { type: ResultType }) {
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const { clearCart } = useCart();
  const [cleared, setCleared] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState<number | null>(null);
  const [fetchingInvoice, setFetchingInvoice] = useState(false);

  const params = new URLSearchParams(searchStr);
  const orderId = params.get("external_reference");
  const paymentId = params.get("payment_id");

  // On success: clear cart and fetch the invoice number using the orderId from MP
  useEffect(() => {
    if (type === "success") {
      if (!cleared) {
        clearCart();
        setCleared(true);
      }
      if (orderId && !invoiceNumber && !fetchingInvoice) {
        setFetchingInvoice(true);
        fetch(`${BASE}/api/orders/${orderId}/invoice`)
          .then((r) => r.ok ? r.json() : null)
          .then((data: { invoiceNumber?: number } | null) => {
            if (data?.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
          })
          .catch(() => null)
          .finally(() => setFetchingInvoice(false));
      }
    }
  }, [type, cleared, clearCart, orderId, invoiceNumber, fetchingInvoice]);

  const configs = {
    success: {
      icon: <CheckCircle2 className="w-16 h-16 text-green-400" />,
      bg: "bg-green-500/10",
      title: "¡Pago confirmado!",
      description: "Tu compra fue procesada exitosamente. Te enviamos los links de descarga a tu email.",
      sub: "Revisá tu bandeja de entrada (y spam por las dudas).",
    },
    pending: {
      icon: <Clock className="w-16 h-16 text-yellow-400" />,
      bg: "bg-yellow-500/10",
      title: "Pago pendiente",
      description: "Tu pago está siendo procesado. Te avisaremos por email cuando se confirme.",
      sub: "Esto puede tardar hasta 24 horas hábiles.",
    },
    failure: {
      icon: <XCircle className="w-16 h-16 text-red-400" />,
      bg: "bg-red-500/10",
      title: "Pago no completado",
      description: "No pudimos procesar tu pago. Podés intentarlo de nuevo.",
      sub: "Si el problema persiste, contactanos.",
    },
  };

  const cfg = configs[type];

  return (
    <main className="min-h-screen bg-background flex flex-col font-sans">
      <Header />
      <div className="flex-1 flex items-center justify-center px-4 py-20">
        <div className="max-w-md w-full text-center">
          <div className={`w-28 h-28 ${cfg.bg} rounded-full flex items-center justify-center mx-auto mb-8`}>
            {cfg.icon}
          </div>
          <h1 className="text-3xl font-black uppercase tracking-tight text-white mb-3">{cfg.title}</h1>
          <p className="text-white/70 font-medium mb-2">{cfg.description}</p>
          <p className="text-white/40 text-sm mb-2">{cfg.sub}</p>

          {/* Invoice number — fetched server-side after MP redirect */}
          {type === "success" && invoiceNumber && (
            <p className="text-sm font-mono text-white/60 bg-white/5 border border-white/10 rounded-md px-4 py-2 inline-block mt-2 mb-4">
              Factura N° {String(invoiceNumber).padStart(6, "0")}
            </p>
          )}

          {type === "success" && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 my-4 text-sm text-white/70 text-left">
              <Mail className="w-4 h-4 text-primary inline mr-2" />
              Los links de descarga de tus diseños fueron enviados a tu email.
            </div>
          )}

          <div className="flex flex-col gap-3 mt-6">
            {type === "failure" && (
              <Button
                size="lg"
                className="w-full h-12 bg-primary text-white font-bold hover:bg-primary/90"
                onClick={() => navigate("/")}
              >
                Volver a intentar
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full text-white/60 hover:text-white"
              onClick={() => navigate("/")}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Volver al catálogo
            </Button>
          </div>
        </div>
      </div>
      <Footer />
    </main>
  );
}
