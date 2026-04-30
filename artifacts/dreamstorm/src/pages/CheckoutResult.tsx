import { useEffect, useState, useRef } from "react";
import { useSearch, useLocation } from "wouter";
import { CheckCircle2, Clock, XCircle, Loader2, Mail, ArrowLeft, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";
import { useCart } from "@/components/storefront/CartContext";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

// Polling config: aggressive early polling so the buyer sees the
// "Pago confirmado" state within ~1s when the webhook is fast (PayPal
// captures synchronously, MP webhook is usually 2-5s). We poll once
// every 800 ms for up to ~32s before giving up and showing the
// timed-out message (the webhook may still arrive later by email).
const POLL_INTERVAL_MS = 800;
const POLL_MAX_ATTEMPTS = 40;

type ResultType = "success" | "pending" | "failure";

export default function CheckoutResult({ type }: { type: ResultType }) {
  const searchStr = useSearch();
  const [, navigate] = useLocation();
  const { clearCart } = useCart();
  const [cleared, setCleared] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState<number | null>(null);
  const [pollingState, setPollingState] = useState<"idle" | "polling" | "confirmed" | "timed-out">("idle");
  const attemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const params = new URLSearchParams(searchStr);
  const orderId = params.get("external_reference");

  // Clear cart as soon as MP returns to success URL (cart will be confirmed by polling)
  useEffect(() => {
    if (type === "success" && !cleared) {
      clearCart();
      setCleared(true);
    }
  }, [type, cleared, clearCart]);

  // For MP success: poll /orders/:id/invoice until webhook confirms payment
  useEffect(() => {
    if (type !== "success" || !orderId || pollingState !== "idle") return;

    setPollingState("polling");
    attemptsRef.current = 0;

    const poll = () => {
      attemptsRef.current += 1;
      fetch(`${BASE}/api/orders/${orderId}/invoice`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { invoiceNumber?: number } | null) => {
          if (data?.invoiceNumber) {
            setInvoiceNumber(data.invoiceNumber);
            setPollingState("confirmed");
          } else if (attemptsRef.current < POLL_MAX_ATTEMPTS) {
            timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          } else {
            // Webhook may be delayed — show partial success without invoice number
            setPollingState("timed-out");
          }
        })
        .catch(() => {
          if (attemptsRef.current < POLL_MAX_ATTEMPTS) {
            timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
          } else {
            setPollingState("timed-out");
          }
        });
    };

    // Fire the very first attempt right away (PayPal capture is already done
    // by the time we get here, so often the order is paid on attempt #1).
    poll();

    // If the user tabs away and comes back, force an immediate re-poll
    // instead of waiting up to POLL_INTERVAL_MS.
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        attemptsRef.current < POLL_MAX_ATTEMPTS
      ) {
        if (timerRef.current) clearTimeout(timerRef.current);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [type, orderId, pollingState]);

  const configs = {
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

  if (type === "success") {
    const isPolling = pollingState === "polling";
    const isConfirmed = pollingState === "confirmed";
    const isTimedOut = pollingState === "timed-out";

    return (
      <main className="min-h-screen bg-background flex flex-col font-sans">
        <Header />
        <div className="flex-1 flex items-center justify-center px-4 py-20">
          <div className="max-w-md w-full text-center">
            {isPolling ? (
              <>
                <div className="w-28 h-28 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-8">
                  <Loader2 className="w-16 h-16 text-primary animate-spin" />
                </div>
                <h1 className="text-3xl font-black uppercase tracking-tight text-white mb-3">Procesando pago…</h1>
                <p className="text-white/60 font-medium">Estamos confirmando tu pago con Mercado Pago. Un momento.</p>
              </>
            ) : (
              <>
                <div className="w-28 h-28 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-8">
                  <CheckCircle2 className="w-16 h-16 text-green-400" />
                </div>
                <h1 className="text-3xl font-black uppercase tracking-tight text-white mb-3">¡Pago confirmado!</h1>
                <p className="text-white/70 font-medium mb-2">
                  Tu compra fue procesada exitosamente.
                </p>
                {isConfirmed && invoiceNumber && (
                  <p className="text-sm font-mono text-white/60 bg-white/5 border border-white/10 rounded-md px-4 py-2 inline-block mt-2 mb-4">
                    Factura N° {String(invoiceNumber).padStart(6, "0")}
                  </p>
                )}
                {isTimedOut && (
                  <p className="text-xs text-white/40 mb-4">
                    La confirmación puede tardar unos minutos más. Te avisamos por email.
                  </p>
                )}
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 my-4 text-sm text-white/70 text-left">
                  <Mail className="w-4 h-4 text-primary inline mr-2" />
                  Los links de descarga de tus diseños fueron enviados a tu email.
                </div>
              </>
            )}

            {!isPolling && (
              <div className="flex flex-col gap-3 mt-6">
                <Button
                  size="lg"
                  className="w-full h-12 bg-primary text-white font-bold hover:bg-primary/90"
                  onClick={() => navigate("/mis-compras")}
                >
                  <PackageOpen className="w-4 h-4 mr-2" />
                  Ver mis compras
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-white/60 hover:text-white"
                  onClick={() => navigate("/")}
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Volver al catálogo
                </Button>
              </div>
            )}
          </div>
        </div>
        <Footer />
      </main>
    );
  }

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

          <div className="flex flex-col gap-3 mt-8">
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
