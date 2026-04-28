import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCart } from "./CartContext";
import { CheckCircle2, Loader2, Download } from "lucide-react";
import { FaPaypal, FaCreditCard } from "react-icons/fa6";

export function CheckoutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [state, setState] = useState<"review" | "processing" | "success">("review");
  const { items, totalPrice, clearCart } = useCart();

  useEffect(() => {
    if (open) {
      setState("review");
    }
  }, [open]);

  const handlePayment = () => {
    setState("processing");
    setTimeout(() => {
      setState("success");
    }, 1500);
  };

  const handleClose = () => {
    clearCart();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (state !== "processing") {
        if (!o && state === "success") {
          clearCart();
        }
        onOpenChange(o);
      }
    }}>
      <DialogContent className="sm:max-w-[425px] bg-background border-white/10 p-0 overflow-hidden">
        {state === "review" && (
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
              <h4 className="text-sm font-bold uppercase tracking-wider text-white/80 mb-2">Elegí cómo pagar</h4>
              
              <button 
                onClick={handlePayment}
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
                onClick={handlePayment}
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
                onClick={handlePayment}
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

        {state === "processing" && (
          <div className="p-12 flex flex-col items-center justify-center text-center">
            <Loader2 className="w-12 h-12 text-primary animate-spin mb-6" />
            <h3 className="text-xl font-bold text-white mb-2">Procesando pago...</h3>
            <p className="text-white/60 font-medium">Por favor, no cierres esta ventana.</p>
          </div>
        )}

        {state === "success" && (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-500" />
            </div>
            <h3 className="text-2xl font-black uppercase tracking-tight text-white mb-2">Pago confirmado</h3>
            <p className="text-white/60 font-medium mb-8">Tu archivo está listo para descargar.</p>
            
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
