import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCart } from "./CartContext";
import { CheckCircle2, Loader2, Download, ArrowLeft } from "lucide-react";
import { FaPaypal, FaCreditCard } from "react-icons/fa6";
import { useCreateOrder } from "@workspace/api-client-react";
import type { OrderInputPaymentMethod, Order } from "@workspace/api-client-react";
import { toast } from "sonner";

type Step = "details" | "payment" | "processing" | "success";

export function CheckoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState<Step>("details");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [confirmedOrder, setConfirmedOrder] = useState<Order | null>(null);
  const { items, totalPrice, clearCart } = useCart();
  const createOrder = useCreateOrder();

  useEffect(() => {
    if (open) {
      setStep("details");
      setConfirmedOrder(null);
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

  const handlePayment = async (paymentMethod: OrderInputPaymentMethod) => {
    setStep("processing");
    try {
      const order = await createOrder.mutateAsync({
        data: {
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          paymentMethod,
          items: items.map((it) => ({
            productId: it.id,
            name: it.name,
            price: it.price,
            quantity: it.quantity,
            imagePath: it.image,
          })),
        },
      });
      setConfirmedOrder(order);
      setStep("success");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al procesar el pago");
      setStep("payment");
    }
  };

  const handleClose = () => {
    clearCart();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (step !== "processing") {
        if (!o && step === "success") {
          clearCart();
        }
        onOpenChange(o);
      }
    }}>
      <DialogContent className="sm:max-w-[425px] bg-background border-white/10 p-0 overflow-hidden">
        {step === "details" && (
          <div className="flex flex-col">
            <div className="p-6 border-b border-white/10 bg-white/5">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white mb-2">
                  Tus datos
                </DialogTitle>
                <DialogDescription className="text-white/60 font-medium">
                  Total a pagar: <span className="font-mono text-white font-bold">${totalPrice.toLocaleString("es-AR")} ARS</span>
                </DialogDescription>
              </DialogHeader>
            </div>
            <form onSubmit={handleProceedToPayment} className="p-6 flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="customer-name" className="text-white/80">Nombre y apellido</Label>
                <Input
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Juan Pérez"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-email" className="text-white/80">Email</Label>
                <Input
                  id="customer-email"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="vos@ejemplo.com"
                  required
                />
                <p className="text-xs text-white/50">Te enviamos la factura a este email.</p>
              </div>
              <Button type="submit" size="lg" className="w-full h-12 mt-2 bg-primary text-white hover:bg-primary/90 font-bold">
                Continuar al pago
              </Button>
            </form>
          </div>
        )}

        {step === "payment" && (
          <div className="flex flex-col">
            <div className="p-6 border-b border-white/10 bg-white/5">
              <DialogHeader>
                <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white mb-2">
                  Resumen de compra
                </DialogTitle>
                <DialogDescription className="text-white/60 font-medium">
                  {items.length} {items.length === 1 ? "diseño" : "diseños"} • Total a pagar:{" "}
                  <span className="font-mono text-white font-bold">${totalPrice.toLocaleString("es-AR")} ARS</span>
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-bold uppercase tracking-wider text-white/80">Elegí cómo pagar</h4>
                <button
                  type="button"
                  onClick={() => setStep("details")}
                  className="text-xs text-white/50 hover:text-white flex items-center gap-1"
                >
                  <ArrowLeft className="w-3 h-3" /> Editar datos
                </button>
              </div>

              <button
                onClick={() => handlePayment("mercadopago")}
                className="group relative w-full flex items-center p-4 bg-[#009EE3] rounded-md hover:-translate-y-1 hover:shadow-lg hover:shadow-[#009EE3]/20 transition-all duration-200"
              >
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shrink-0 mr-4">
                  <FaCreditCard className="w-6 h-6 text-[#009EE3]" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-bold text-white text-lg leading-tight">Mercado Pago</div>
                  <div className="text-white/80 text-sm font-medium">Pagá con tarjeta, débito o saldo</div>
                </div>
              </button>

              <button
                onClick={() => handlePayment("uala")}
                className="group relative w-full flex items-center p-4 bg-[#A855F7] rounded-md hover:-translate-y-1 hover:shadow-lg hover:shadow-[#A855F7]/20 transition-all duration-200"
              >
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shrink-0 mr-4">
                  <span className="font-black text-[#A855F7] text-xl">U</span>
                </div>
                <div className="text-left flex-1">
                  <div className="font-bold text-white text-lg leading-tight">Ualá Bis</div>
                  <div className="text-white/80 text-sm font-medium">Pagá con QR o tarjeta Ualá</div>
                </div>
              </button>

              <button
                onClick={() => handlePayment("paypal")}
                className="group relative w-full flex items-center p-4 bg-[#003087] rounded-md hover:-translate-y-1 hover:shadow-lg hover:shadow-[#003087]/20 transition-all duration-200"
              >
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shrink-0 mr-4">
                  <FaPaypal className="w-6 h-6 text-[#003087]" />
                </div>
                <div className="text-left flex-1">
                  <div className="font-bold text-white text-lg leading-tight">PayPal</div>
                  <div className="text-white/80 text-sm font-medium">Pagá en dólares desde cualquier país</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="p-12 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-6" />
            <h3 className="text-xl font-bold text-white mb-2">Procesando pago...</h3>
            <p className="text-white/60 font-medium">Por favor, no cierres esta ventana.</p>
          </div>
        )}

        {step === "success" && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <h3 className="text-2xl font-black uppercase tracking-tight text-white mb-2">Pago confirmado</h3>
            <p className="text-white/60 font-medium mb-2">Tu archivo está listo para descargar.</p>
            {confirmedOrder && (
              <p className="text-xs font-mono text-white/50 mb-6">
                Factura N° {String(confirmedOrder.invoiceNumber).padStart(6, "0")}
              </p>
            )}

            {items[0] && (
              <div className="w-32 h-32 bg-white/5 rounded-sm border border-white/10 p-2 mb-8 relative">
                <img src={items[0].image} alt="Preview" className="w-full h-full object-contain" />
              </div>
            )}

            <div className="w-full flex flex-col gap-3">
              <a
                href="/images/sample-design.png"
                download="dreamstorm-design.png"
                className="w-full"
              >
                <Button size="lg" className="w-full h-14 text-lg font-bold bg-primary text-white hover:bg-primary/90">
                  <Download className="mr-2 w-5 h-5" />
                  Descargar PNG
                </Button>
              </a>
              <Button variant="ghost" onClick={handleClose} className="w-full text-white/60 hover:text-white">
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
