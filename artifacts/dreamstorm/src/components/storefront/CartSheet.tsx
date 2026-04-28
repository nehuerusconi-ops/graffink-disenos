import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCart } from "./CartContext";
import { Trash2, ShoppingBag } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export function CartSheet({ onCheckout }: { onCheckout: () => void }) {
  const { items, removeItem, totalItems, totalPrice, isCartOpen, setIsCartOpen } = useCart();

  const handleCheckoutClick = () => {
    setIsCartOpen(false);
    onCheckout();
  };

  const scrollToProducts = () => {
    setIsCartOpen(false);
    const element = document.getElementById("products");
    if (element) {
      const offset = 80;
      const bodyRect = document.body.getBoundingClientRect().top;
      const elementRect = element.getBoundingClientRect().top;
      window.scrollTo({
        top: elementRect - bodyRect - offset,
        behavior: "smooth"
      });
    }
  };

  return (
    <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
      <SheetContent className="w-full sm:max-w-md bg-background border-l border-white/10 p-0 flex flex-col">
        <SheetHeader className="p-6 border-b border-white/10">
          <SheetTitle className="text-2xl font-black uppercase tracking-tight text-white">Tu carrito ({totalItems})</SheetTitle>
          <SheetDescription className="hidden">Contenido de tu carrito de compras.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-24 h-24 rounded-full bg-white/5 border border-dashed border-white/20 flex items-center justify-center mb-6">
                <ShoppingBag className="w-10 h-10 text-white/40" />
              </div>
              <p className="text-white/60 mb-6 font-medium">
                Tu carrito está vacío. Explorá los diseños y agregá tus favoritos.
              </p>
              <Button onClick={scrollToProducts} className="font-bold">
                Ver diseños
              </Button>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 p-6">
                <div className="flex flex-col gap-6">
                  {items.map((item) => (
                    <div key={item.id} className="flex gap-4 items-center bg-white/5 p-3 border border-white/10 rounded-sm">
                      <div className="w-20 h-20 bg-black/50 rounded-sm overflow-hidden shrink-0">
                        <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-primary font-bold uppercase tracking-wider mb-1">
                          {item.category}
                        </div>
                        <h4 className="text-white font-bold truncate">{item.name}</h4>
                        <div className="text-white/80 font-mono text-sm mt-1">
                          {item.quantity} x ${item.price.toLocaleString("es-AR")}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(item.id)}
                        className="text-white/40 hover:text-destructive hover:bg-destructive/10 shrink-0"
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              
              <div className="p-6 border-t border-white/10 bg-[#0a0a0a]">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-white/80 font-bold uppercase text-sm">Total</span>
                  <span className="text-2xl font-black font-mono text-white">
                    ${totalPrice.toLocaleString("es-AR")}
                  </span>
                </div>
                <Button 
                  onClick={handleCheckoutClick}
                  className="w-full h-14 text-lg font-bold bg-primary text-white hover:bg-primary/90"
                >
                  Finalizar compra
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
