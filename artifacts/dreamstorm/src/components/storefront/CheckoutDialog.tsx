import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCart } from "./CartContext";
import { CheckCircle2, Loader2, ExternalLink, ArrowLeft, Mail } from "lucide-react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { toast } from "sonner";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const VITE_PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined;

type Step = "details" | "payment" | "paypal-buttons" | "processing" | "success" | "uala-instructions";

interface ConfirmedInfo {
  invoiceNumber?: number;
  customerEmail?: string;
}

export function CheckoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<Step>("details");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [confirmed, setConfirmed] = useState<ConfirmedInfo | null>(null);
  const [dbOrderId, setDbOrderId] = useState<string | null>(null);
  const { items, totalPrice, clearCart } = useCart();

  useEffect(() => {
    if (open) {
      setStep("details");
      setConfirmed(null);
      setDbOrderId(null);
    }
  }, [open]);

  const handleProceedToPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !customerEmail.trim()) {
      toast.error("Completá tu nombre y email");
      return;
    }
    setStep("payment");
  };

  // ---------- Mercado Pago ----------
  const handleMercadoPago = async () => {
    setStep("processing");
    try {
      const resp = await fetch(`${BASE}/api/payments/mercadopago/preference`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          items: items.map((it) => ({
            productId: it.id,
            name: it.name,
            price: it.price,
            quantity: it.quantity,
            imagePath: it.image,
          })),
        }),
      });
      if (!resp.ok) throw new Error("No se pudo crear la preferencia");
      const data = (await resp.json()) as { init_point: string; sandbox_init_point: string };
      const url = import.meta.env.PROD ? data.init_point : (data.sandbox_init_point ?? data.init_point);
      clearCart();
      onOpenChange(false);
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al procesar el pago");
      setStep("payment");
    }
  };

  // ---------- PayPal ----------
  const createPaypalOrder = async () => {
    const resp = await fetch(`${BASE}/api/payments/paypal/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        items: items.map((it) => ({
          productId: it.id,
          name: it.name,
          price: it.price,
          quantity: it.quantity,
          imagePath: it.image,
        })),
      }),
    });
    if (!resp.ok) throw new Error("No se pudo crear el pedido");
    const data = (await resp.json()) as { ppOrderId: string; orderId: string };
    setDbOrderId(data.orderId);
    return data.ppOrderId;
  };

  const onPaypalApprove = async (data: { orderID: string }) => {
    setStep("processing");
    try {
      const resp = await fetch(`${BASE}/api/payments/paypal/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ppOrderId: data.orderID, orderId: dbOrderId }),
      });
      if (!resp.ok) throw new Error("Error al capturar el pago");
      const order = (await resp.json()) as { invoiceNumber: number; customerEmail: string };
      setConfirmed({ invoiceNumber: order.invoiceNumber, customerEmail: order.customerEmail });
      setStep("success");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al procesar el pago de PayPal");
      setStep("payment");
    }
  };

  const handleClose = () => {
    if (step === "success") clearCart();
    onOpenChange(false);
  };

  const canClose = step !== "processing";

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (canClose) {
        if (!o && step === "success") clearCart();
        onOpenChange(o);
      }
    }}>
      <DialogContent className="sm:max-w-[440px] bg-background border-white/10 p-0 overflow-hidden">

        {/* ── Step: details ── */}
        {step === "details" && (
          <div className="flex flex-col">
            <div className="p-6 border-b border-white/10 bg-white/5">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white mb-1">Tus datos</DialogTitle>
                <DialogDescription className="text-white/60 font-medium">
                  Total: <span className="font-mono text-white font-bold">${totalPrice.toLocaleString("es-AR")} ARS</span>
                </DialogDescription>
              </DialogHeader>
            </div>
            <form onSubmit={handleProceedToPayment} className="p-6 flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="cn" className="text-white/80">Nombre y apellido</Label>
                <Input id="cn" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Juan Pérez" required autoFocus />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ce" className="text-white/80">Email</Label>
                <Input id="ce" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="vos@ejemplo.com" required />
                <p className="text-xs text-white/50">Te enviamos los archivos y la factura a este email.</p>
              </div>
              <Button type="submit" size="lg" className="w-full h-12 mt-2 bg-primary text-white hover:bg-primary/90 font-bold">
                Continuar al pago
              </Button>
            </form>
          </div>
        )}

        {/* ── Step: payment ── */}
        {step === "payment" && (
          <div className="flex flex-col">
            <div className="p-6 border-b border-white/10 bg-white/5">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white mb-1">Elegí cómo pagar</DialogTitle>
                <DialogDescription className="text-white/60 font-medium">
                  {items.length} {items.length === 1 ? "diseño" : "diseños"} ·{" "}
                  <span className="font-mono text-white font-bold">${totalPrice.toLocaleString("es-AR")} ARS</span>
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="p-6 flex flex-col gap-3">
              <div className="flex items-center justify-end mb-1">
                <button type="button" onClick={() => setStep("details")} className="text-xs text-white/50 hover:text-white flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" /> Editar datos
                </button>
              </div>

              {/* Mercado Pago */}
              <button
                onClick={handleMercadoPago}
                className="w-full flex items-center p-4 bg-[#009EE3] rounded-lg hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#009EE3]/30 transition-all duration-200"
              >
                <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shrink-0 mr-4">
                  <svg viewBox="0 0 40 40" className="w-9 h-9" aria-hidden="true">
                    <circle cx="20" cy="20" r="20" fill="#009EE3" />
                    <path d="M10 20.5C10 14.7 14.7 10 20.5 10C23.67 10 26.5 11.4 28.47 13.6L24.17 17.5C23.25 16.38 21.96 15.68 20.5 15.68C17.62 15.68 15.28 18.06 15.28 20.5C15.28 22.94 17.62 25.32 20.5 25.32C21.96 25.32 23.25 24.62 24.17 23.5L28.47 27.4C26.5 29.6 23.67 31 20.5 31C14.7 31 10 26.3 10 20.5Z" fill="white" />
                  </svg>
                </div>
                <div className="text-left flex-1">
                  <div className="font-black text-white text-lg leading-tight">Mercado Pago</div>
                  <div className="text-white/80 text-sm font-medium">Tarjeta, débito o saldo MP</div>
                </div>
                <ExternalLink className="w-4 h-4 text-white/60 ml-2 shrink-0" />
              </button>

              {/* Ualá Bis */}
              <button
                onClick={() => setStep("uala-instructions")}
                className="w-full flex items-center p-4 bg-gradient-to-r from-[#7C3AED] to-[#A855F7] rounded-lg hover:-translate-y-0.5 hover:shadow-lg hover:shadow-purple-500/30 transition-all duration-200"
              >
                <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shrink-0 mr-4">
                  <svg viewBox="0 0 40 40" className="w-9 h-9" aria-hidden="true">
                    <circle cx="20" cy="20" r="20" fill="#7C3AED" />
                    <text x="20" y="26" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="14" fill="white" textAnchor="middle">ualá</text>
                  </svg>
                </div>
                <div className="text-left flex-1">
                  <div className="font-black text-white text-lg leading-tight">Ualá Bis</div>
                  <div className="text-white/80 text-sm font-medium">QR o link de pago Ualá</div>
                </div>
              </button>

              {/* PayPal */}
              <button
                onClick={() => setStep("paypal-buttons")}
                className="w-full flex items-center p-4 bg-[#003087] rounded-lg hover:-translate-y-0.5 hover:shadow-lg hover:shadow-blue-900/40 transition-all duration-200"
              >
                <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shrink-0 mr-4">
                  <svg viewBox="0 0 40 40" className="w-9 h-9" aria-hidden="true">
                    <circle cx="20" cy="20" r="20" fill="#003087" />
                    <text x="8" y="25" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="11" fill="#00AEEF">Pay</text>
                    <text x="22" y="25" fontFamily="Arial, sans-serif" fontWeight="900" fontSize="11" fill="white">Pal</text>
                  </svg>
                </div>
                <div className="text-left flex-1">
                  <div className="font-black text-white text-lg leading-tight">PayPal</div>
                  <div className="text-white/80 text-sm font-medium">Pagá en USD desde cualquier país</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ── Step: PayPal buttons ── */}
        {step === "paypal-buttons" && (
          <div className="flex flex-col">
            <div className="p-6 border-b border-white/10 bg-white/5">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white mb-1">Pagar con PayPal</DialogTitle>
                <DialogDescription className="text-white/60 font-medium">
                  Total: <span className="font-mono text-white font-bold">${totalPrice.toLocaleString("es-AR")} ARS</span>
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <button type="button" onClick={() => setStep("payment")} className="text-xs text-white/50 hover:text-white flex items-center gap-1 mb-2">
                <ArrowLeft className="w-3 h-3" /> Volver
              </button>
              {VITE_PAYPAL_CLIENT_ID ? (
                <PayPalScriptProvider options={{ clientId: VITE_PAYPAL_CLIENT_ID, currency: "USD", intent: "capture" }}>
                  <div className="bg-white rounded-lg p-3">
                    <PayPalButtons
                      style={{ layout: "vertical", color: "gold", shape: "rect", label: "paypal" }}
                      createOrder={createPaypalOrder}
                      onApprove={onPaypalApprove}
                      onError={(err) => {
                        console.error("PayPal error", err);
                        toast.error("Error con PayPal. Intentá de nuevo.");
                        setStep("payment");
                      }}
                      onCancel={() => setStep("payment")}
                    />
                  </div>
                </PayPalScriptProvider>
              ) : (
                <div className="text-center text-white/50 text-sm py-4">
                  PayPal no está configurado en este momento.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step: Ualá instructions ── */}
        {step === "uala-instructions" && (
          <div className="flex flex-col">
            <div className="p-6 border-b border-white/10 bg-gradient-to-r from-[#7C3AED]/20 to-[#A855F7]/10">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white mb-1">Pagar con Ualá Bis</DialogTitle>
                <DialogDescription className="text-white/60 font-medium">
                  Total: <span className="font-mono text-white font-bold">${totalPrice.toLocaleString("es-AR")} ARS</span>
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <button type="button" onClick={() => setStep("payment")} className="text-xs text-white/50 hover:text-white flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" /> Volver
              </button>
              <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-sm text-white/80 space-y-3">
                <p className="font-bold text-white">Cómo pagar:</p>
                <ol className="list-decimal list-inside space-y-2 text-white/70">
                  <li>Hacé clic en el botón de abajo para ir al link de cobro de Ualá Bis.</li>
                  <li>Completá el pago por <strong className="text-white">${totalPrice.toLocaleString("es-AR")} ARS</strong>.</li>
                  <li>Envianos el comprobante a nuestro email junto con tu pedido.</li>
                </ol>
                <div className="flex items-start gap-2 mt-3 pt-3 border-t border-white/10">
                  <Mail className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <span className="text-white/60 text-xs">Enviá tu comprobante al email de contacto que figura en el pie de la página para que procesemos tu pedido manualmente.</span>
                </div>
              </div>
              <Button
                size="lg"
                className="w-full h-12 bg-gradient-to-r from-[#7C3AED] to-[#A855F7] text-white font-bold hover:opacity-90"
                onClick={async () => {
                  try {
                    const r = await fetch(`${BASE}/api/payments/uala/link`);
                    const d = (await r.json()) as { url?: string; error?: string };
                    if (d.url) window.open(d.url, "_blank");
                    else toast.error("Link de Ualá no disponible");
                  } catch {
                    toast.error("Error al obtener el link de pago");
                  }
                }}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Ir al link de pago Ualá
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: processing ── */}
        {step === "processing" && (
          <div className="p-16 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-14 h-14 text-primary animate-spin mb-6" />
            <h3 className="text-xl font-bold text-white mb-2">Procesando pago...</h3>
            <p className="text-white/60 font-medium">Por favor, no cierres esta ventana.</p>
          </div>
        )}

        {/* ── Step: success ── */}
        {step === "success" && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-24 h-24 bg-green-500/10 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-12 h-12 text-green-400" />
            </div>
            <h3 className="text-2xl font-black uppercase tracking-tight text-white mb-2">¡Pago confirmado!</h3>
            <p className="text-white/70 font-medium mb-2">Tus diseños fueron enviados a tu email.</p>
            {confirmed?.invoiceNumber != null && (
              <p className="text-xs font-mono text-white/40 mb-2">
                Factura N° {String(confirmed.invoiceNumber).padStart(6, "0")}
              </p>
            )}
            {confirmed?.customerEmail && (
              <p className="text-xs text-white/40 mb-6">{confirmed.customerEmail}</p>
            )}
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-6 text-sm text-white/70 text-left w-full">
              <Mail className="w-4 h-4 text-primary inline mr-2" />
              Revisá tu bandeja de entrada (y spam) para encontrar los links de descarga de tus diseños.
            </div>
            <Button variant="ghost" onClick={handleClose} className="w-full text-white/60 hover:text-white">
              Cerrar
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
