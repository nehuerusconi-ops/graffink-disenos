import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCart } from "./CartContext";
import { CheckCircle2, Loader2, ExternalLink, ArrowLeft, Mail, ShieldCheck, Lock, Landmark, Copy } from "lucide-react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { MercadoPagoLogo, PaypalLogoWhite } from "./PaymentLogos";
import { toast } from "sonner";
import { isAcceptableDniInput, dniForPayload as buildDniForPayload } from "./dniInput";

const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
const VITE_PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined;

type Step = "details" | "payment" | "paypal-buttons" | "processing" | "success" | "transferencia-instructions";

interface ConfirmedInfo {
  invoiceNumber?: number;
  customerEmail?: string;
  /**
   * Echo del flag del backend tras confirmar el pago. Cuando es true, la
   * pantalla de éxito muestra "Tu pedido se entrega en 24hs hábiles" en
   * lugar del copy de descarga inmediata.
   */
  requiresManualPrep?: boolean;
}

interface PaypalRateInfo {
  arsToUsd: number;
  source: "env" | "dolarapi" | "default";
  cachedAt: string | null;
}

export function CheckoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<Step>("details");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerDni, setCustomerDni] = useState("");
  const [confirmed, setConfirmed] = useState<ConfirmedInfo | null>(null);
  const [paypalRate, setPaypalRate] = useState<PaypalRateInfo | null>(null);
  const [paypalRateLoading, setPaypalRateLoading] = useState(false);
  const [paypalRateError, setPaypalRateError] = useState<string | null>(null);
  // Use a ref to store the dbOrderId synchronously — avoids async state update issues
  // where onPaypalApprove closure could capture a stale null before setState flushes.
  const dbOrderIdRef = useRef<string | null>(null);
  const { items, totalPrice, clearCart, groupAsPlancha, requiresManualPrep } = useCart();

  // Payload helper — translates the cart's per-line `selectedSize` /
  // `customSizeCm` into the shape the backend expects:
  //   - "Original" → omit selectedSize so the server treats it as default.
  //   - custom dims → send `customSize: { width, height }` and DO NOT send
  //     selectedSize (the server derives the label).
  //   - any other string → send as `selectedSize`; the server validates
  //     against the live availableSizes catalog.
  const buildItemsPayload = () =>
    items.map((it) => {
      if (it.customSizeCm) {
        return {
          productId: it.id,
          quantity: it.quantity,
          customSize: it.customSizeCm,
        };
      }
      if (it.selectedSize && it.selectedSize !== "Original") {
        return {
          productId: it.id,
          quantity: it.quantity,
          selectedSize: it.selectedSize,
        };
      }
      return { productId: it.id, quantity: it.quantity };
    });

  useEffect(() => {
    if (open) {
      setStep("details");
      setConfirmed(null);
      setPaypalRate(null);
      setPaypalRateError(null);
      dbOrderIdRef.current = null;
    }
  }, [open]);

  // Fetch the ARS→USD rate whenever the user reaches a step that displays the
  // PayPal option. Re-fetched on each entry so the rate stays fresh if the user
  // toggles between payment methods.
  useEffect(() => {
    if (step !== "payment" && step !== "paypal-buttons") return;
    let cancelled = false;
    const controller = new AbortController();
    setPaypalRateLoading(true);
    setPaypalRateError(null);
    fetch(`${BASE}/api/payments/paypal/rate`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("rate request failed");
        return (await r.json()) as PaypalRateInfo;
      })
      .then((data) => {
        if (!cancelled) setPaypalRate(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPaypalRateError("No se pudo obtener el tipo de cambio");
      })
      .finally(() => {
        if (!cancelled) setPaypalRateLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [step]);

  const usdAmount =
    paypalRate && paypalRate.arsToUsd > 0
      ? totalPrice / paypalRate.arsToUsd
      : null;

  const handleProceedToPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !customerEmail.trim()) {
      toast.error("Completá tu nombre y email");
      return;
    }
    if (!isAcceptableDniInput(customerDni)) {
      toast.error("Ingresá un DNI (7-8 dígitos) o CUIT (11 dígitos)");
      return;
    }
    setStep("payment");
  };

  // Always send the sanitised DNI (digits only, empty allowed).
  const dniForPayload = (): string | undefined => buildDniForPayload(customerDni);

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
          customerDni: dniForPayload(),
          items: buildItemsPayload(),
          groupAsPlancha,
        }),
      });
      if (!resp.ok) {
        const err = (await resp.json().catch(() => ({}))) as { error?: string; code?: string };
        throw new Error(err.error ?? "No se pudo crear la preferencia");
      }
      const data = (await resp.json()) as { init_point: string; sandbox_init_point: string };
      const url = data.init_point ?? data.sandbox_init_point;
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
        customerDni: dniForPayload(),
        items: buildItemsPayload(),
        groupAsPlancha,
      }),
    });
    if (!resp.ok) {
      const errBody = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error ?? "No se pudo crear el pedido");
    }
    const data = (await resp.json()) as { ppOrderId: string; orderId: string };
    // Store orderId in ref immediately (synchronous) so the onApprove closure always has it
    dbOrderIdRef.current = data.orderId;
    return data.ppOrderId;
  };

  const onPaypalApprove = async (data: { orderID: string }) => {
    setStep("processing");
    const captureOrderId = dbOrderIdRef.current;
    if (!captureOrderId) {
      toast.error("Error interno: no se pudo identificar la orden. Contactá al soporte.");
      setStep("payment");
      return;
    }
    try {
      const resp = await fetch(`${BASE}/api/payments/paypal/capture-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ppOrderId: data.orderID, orderId: captureOrderId }),
      });
      if (!resp.ok) throw new Error("Error al capturar el pago");
      const order = (await resp.json()) as {
        invoiceNumber: number;
        customerEmail: string;
        requiresManualPrep?: boolean;
      };
      setConfirmed({
        invoiceNumber: order.invoiceNumber,
        customerEmail: order.customerEmail,
        // Fall back to the cart-side flag in case the server response shape
        // ever drops the field — guarantees the buyer never sees the wrong
        // delivery promise after a non-original-size purchase.
        requiresManualPrep: order.requiresManualPrep ?? requiresManualPrep,
      });
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
    <DialogContent className="sm:max-w-110 bg-background border-white/10 p-0 overflow-hidden">

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
              <div className="space-y-2">
                <Label htmlFor="cdni" className="text-white/80">
                  DNI o CUIT <span className="text-white/40 font-normal">(opcional)</span>
                </Label>
                <Input
                  id="cdni"
                  inputMode="numeric"
                  value={customerDni}
                  onChange={(e) => setCustomerDni(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  placeholder="20123456789"
                />
                <p className="text-xs text-white/50">DNI (7-8 dígitos) o CUIT (11 dígitos). Aparecerá en el comprobante adjunto al mail.</p>
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
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] uppercase tracking-widest text-white/40 font-semibold">Métodos disponibles</span>
                <button type="button" onClick={() => setStep("details")} className="text-xs text-white/50 hover:text-white flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" /> Editar datos
                </button>
              </div>

              {/* Mercado Pago */}
              <button
                onClick={handleMercadoPago}
                className="group w-full flex items-center gap-3 p-4 bg-[#009EE3] rounded-xl border border-white/10 hover:border-white/30 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#009EE3]/40 transition-all duration-200"
              >
                <div className="bg-white rounded-lg p-2 shrink-0 shadow-sm">
                  <MercadoPagoLogo className="h-10 w-10 object-contain" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <span className="text-white font-bold text-base leading-tight">Mercado Pago</span>
                </div>
                <ExternalLink className="w-4 h-4 text-white/70 ml-1 shrink-0 group-hover:translate-x-0.5 transition-transform" />
              </button>

              {/* Transferencia bancaria */}
              <button
                onClick={() => setStep("transferencia-instructions")}
               className="group w-full flex items-center gap-3 p-4 bg-linear-to-br from-emerald-700 to-emerald-600 rounded-xl border border-white/10 hover:border-white/30 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-500/40 transition-all duration-200"
              
              >
                <div className="bg-white rounded-lg p-2 shrink-0 shadow-sm flex items-center justify-center h-14 w-14">
                  <Landmark className="h-8 w-8 text-emerald-700" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold text-base leading-tight">Transferencia bancaria</span>
                    <span className="text-[9px] uppercase tracking-wider bg-white/20 text-white px-1.5 py-0.5 rounded font-bold">CVU</span>
                  </div>
                  <div className="text-white/85 text-xs font-medium mt-1 leading-snug">
                    Transferí desde cualquier banco o billetera virtual. Confirmación manual.
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 text-white/70 text-[10px] font-medium">
                    <ShieldCheck className="w-3 h-3" /> Pago verificado por el equipo
                  </div>
                </div>
                <ArrowLeft className="w-4 h-4 text-white/70 ml-1 shrink-0 rotate-180 group-hover:translate-x-0.5 transition-transform" />
              </button>

              {/* PayPal */}
              <button
                onClick={() => setStep("paypal-buttons")}
                className="group w-full flex items-center gap-3 p-4 bg-[#003087] rounded-xl border border-white/10 hover:border-white/30 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-blue-900/50 transition-all duration-200"
              >
                <div className="bg-white rounded-lg p-2 shrink-0 shadow-sm flex items-center justify-center h-14 w-14">
                  <PaypalLogoWhite className="h-8 w-auto [&_text]:fill-[#003087] [&_circle:first-child]:fill-[#003087]/10 [&_circle:nth-child(2)]:fill-[#003087]" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold text-base leading-tight">PayPal</span>
                    <span className="text-[9px] uppercase tracking-wider bg-[#FFC439] text-[#003087] px-1.5 py-0.5 rounded font-black">Internacional</span>
                  </div>
                  <div className="text-white/85 text-xs font-medium mt-1 leading-snug">
                    Pagá en USD desde cualquier país con tu cuenta PayPal o tarjeta
                  </div>
                  {paypalRateLoading && !usdAmount ? (
                    <div className="flex items-center gap-1.5 mt-1.5 text-white/70 text-[11px] font-medium">
                      <Loader2 className="w-3 h-3 animate-spin" /> Calculando equivalente en USD…
                    </div>
                  ) : usdAmount != null && paypalRate ? (
                    <div className="mt-1.5 text-[#FFC439] text-[11px] font-bold font-mono leading-tight">
                      ≈ USD {usdAmount.toFixed(2)}{" "}
                      <span className="text-white/60 font-normal">
                        (1 USD = ${paypalRate.arsToUsd.toLocaleString("es-AR")} ARS)
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1.5 mt-2 text-white/70 text-[10px] font-medium">
                    <ShieldCheck className="w-3 h-3" /> Protección al comprador PayPal
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-white/70 ml-1 shrink-0 group-hover:translate-x-0.5 transition-transform" />
              </button>

              {/* Trust signals */}
              <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-white/5">
                <div className="flex items-center gap-1.5 text-white/50 text-[11px] font-medium">
                  <Lock className="w-3 h-3" /> Pago 100% seguro
                </div>
                <div className="w-px h-3 bg-white/10" />
                <div className="flex items-center gap-1.5 text-white/50 text-[11px] font-medium">
                  <ShieldCheck className="w-3 h-3" /> SSL encriptado
                </div>
                <div className="w-px h-3 bg-white/10" />
                <div className="flex items-center gap-1.5 text-white/50 text-[11px] font-medium">
                  <CheckCircle2 className="w-3 h-3" /> Entrega inmediata
                </div>
              </div>
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

              {/* Exchange rate disclosure — buyers see exactly what PayPal will charge in USD */}
             <div className="bg-linear-to-br from-[#003087]/30 to-[#003087]/10 border border-[#FFC439]/30 rounded-lg p-4">
                {paypalRateLoading && !usdAmount ? (
                  <div className="flex items-center gap-2 text-white/70 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Calculando el monto en USD…
                  </div>
                ) : paypalRateError && !usdAmount ? (
                  <p className="text-sm text-amber-300">{paypalRateError}. Vas a ver el monto exacto en la pantalla de PayPal.</p>
                ) : usdAmount != null && paypalRate ? (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold">PayPal te va a cobrar</div>
                    <div className="text-2xl font-black text-[#FFC439] font-mono leading-tight">
                      USD {usdAmount.toFixed(2)}
                    </div>
                    <div className="text-xs text-white/70 font-medium">
                      Equivalente a <span className="font-mono text-white">${totalPrice.toLocaleString("es-AR")} ARS</span> al tipo de cambio{" "}
                      <span className="font-mono text-white">$1 USD = ${paypalRate.arsToUsd.toLocaleString("es-AR")} ARS</span>
                    </div>
                  </div>
                ) : null}
              </div>

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

        {/* ── Step: Transferencia bancaria instructions ── */}
        {step === "transferencia-instructions" && (
          <TransferenciaStep
            totalPrice={totalPrice}
            onBack={() => setStep("payment")}
          />
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
            {confirmed?.requiresManualPrep ? (
              <p className="text-white/70 font-medium mb-2">
                Estamos preparando tus diseños. Te llegan al email en{" "}
                <strong className="text-amber-200">24hs hábiles</strong>.
              </p>
            ) : (
              <p className="text-white/70 font-medium mb-2">Tus diseños fueron enviados a tu email.</p>
            )}
            {confirmed?.invoiceNumber != null && (
              <p className="text-xs font-mono text-white/40 mb-2">
                Factura N° {String(confirmed.invoiceNumber).padStart(6, "0")}
              </p>
            )}
            {confirmed?.customerEmail && (
              <p className="text-xs text-white/40 mb-6">{confirmed.customerEmail}</p>
            )}
            {confirmed?.requiresManualPrep ? (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6 text-sm text-amber-100/90 text-left w-full">
                <Mail className="w-4 h-4 text-amber-300 inline mr-2" />
                Pediste medidas no originales o el armado de plancha. Vamos a
                exportar los archivos a tu medida y te los mandamos por email
                dentro de las 24hs hábiles.
              </div>
            ) : (
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 mb-6 text-sm text-white/70 text-left w-full">
                <Mail className="w-4 h-4 text-primary inline mr-2" />
                Revisá tu bandeja de entrada (y spam) para encontrar los links de descarga de tus diseños.
              </div>
            )}
            <Button variant="ghost" onClick={handleClose} className="w-full text-white/60 hover:text-white">
              Cerrar
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bank transfer (Transferencia bancaria) step
// ---------------------------------------------------------------------------
// Fetches the CVU + holder from the server (so the operator can change the
// account in one place without redeploying the frontend) and renders a
// copy-friendly screen. The buyer transfers the total from their own bank
// app and then sends the receipt to the store email; the admin confirms
// the order manually from the admin panel.

interface TransferenciaInfo {
  cvu: string;
  holder: string;
}

function TransferenciaStep({
  totalPrice,
  onBack,
}: {
  totalPrice: number;
  onBack: () => void;
}) {
  const [info, setInfo] = useState<TransferenciaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BASE}/api/payments/transferencia/info`, {
          method: "POST",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as TransferenciaInfo;
        if (!cancelled) {
          setInfo(d);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("No pudimos cargar los datos de la cuenta. Reintentá.");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyToClipboard(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("No se pudo copiar. Copialo a mano.");
    }
  }

  return (
    <div className="flex flex-col">
      <div className="p-6 border-b border-white/10 bg-linear-to-r from-emerald-700/20 to-emerald-600/10">
        <DialogHeader>
          <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white mb-1">
            Pagar por transferencia
          </DialogTitle>
          <DialogDescription className="text-white/60 font-medium">
            Total a transferir:{" "}
            <span className="font-mono text-white font-bold">
              ${totalPrice.toLocaleString("es-AR")} ARS
            </span>
          </DialogDescription>
        </DialogHeader>
      </div>
      <div className="p-6 flex flex-col gap-4">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-white/50 hover:text-white flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" /> Volver
        </button>

        {loading && (
          <div className="flex items-center justify-center py-8 text-white/60 text-sm">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando datos…
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {info && !loading && (
          <>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">
                  CVU
                </div>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-white text-sm sm:text-base tracking-tight break-all select-all">
                    {info.cvu}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(info.cvu, "CVU")}
                    aria-label="Copiar CVU"
                    className="shrink-0 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 text-xs font-bold transition-colors"
                  >
                    <Copy className="w-4 h-4" /> Copiar
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">
                  Titular
                </div>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm sm:text-base select-all">
                    {info.holder}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(info.holder, "Titular")}
                    aria-label="Copiar nombre del titular"
                    className="shrink-0 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 text-xs font-bold transition-colors"
                  >
                    <Copy className="w-4 h-4" /> Copiar
                  </button>
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-white/50 font-bold mb-1">
                  Importe
                </div>
                <div className="flex items-stretch gap-2">
                  <div className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-white text-base sm:text-lg font-bold select-all">
                    ${totalPrice.toLocaleString("es-AR")}
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(String(totalPrice), "Importe")}
                    aria-label="Copiar importe"
                    className="shrink-0 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 text-xs font-bold transition-colors"
                  >
                    <Copy className="w-4 h-4" /> Copiar
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-lg p-4 text-sm text-white/80 space-y-2">
              <p className="font-bold text-white">Cómo pagar:</p>
              <ol className="list-decimal list-inside space-y-1.5 text-white/70">
                <li>Abrí tu app de banco o billetera virtual.</li>
                <li>
                  Hacé una transferencia al CVU de arriba por{" "}
                  <strong className="text-white">
                    ${totalPrice.toLocaleString("es-AR")} ARS
                  </strong>
                  .
                </li>
                <li>
                  Mandanos el comprobante por email para que confirmemos tu
                  pedido y te enviemos los diseños.
                </li>
              </ol>
              <div className="flex items-start gap-2 mt-3 pt-3 border-t border-white/10">
                <Mail className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-white/60 text-xs">
                  Enviá el comprobante al email de contacto que figura al pie de
                  la página. Procesamos el pedido manualmente apenas lo
                  recibimos.
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
