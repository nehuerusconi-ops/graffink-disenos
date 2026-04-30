import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useCart } from "./CartContext";
import { Trash2, ShoppingBag, Layers, Minus, Plus } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export function CartSheet({ onCheckout }: { onCheckout: () => void }) {
  const {
    items,
    removeItem,
    updateQuantity,
    totalItems,
    totalPrice,
    itemsTotal,
    isCartOpen,
    setIsCartOpen,
    groupAsPlancha,
    setGroupAsPlancha,
    planchaPrice,
  } = useCart();

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
                    <div
                      key={item.id}
                      className="flex gap-4 items-start bg-white/5 p-3 border border-white/10 rounded-sm"
                    >
                      <div className="w-20 h-20 bg-black/50 rounded-sm overflow-hidden shrink-0">
                        <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-2">
                        <div>
                          <div className="text-xs text-primary font-bold uppercase tracking-wider mb-1">
                            {item.category}
                          </div>
                          <h4 className="text-white font-bold truncate">{item.name}</h4>
                          <div className="text-white/60 font-mono text-xs mt-0.5">
                            ${item.price.toLocaleString("es-AR")} c/u
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="inline-flex items-center border border-white/15 rounded-sm bg-black/40">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10 rounded-none"
                              aria-label={`Quitar una unidad de ${item.name}`}
                              data-testid={`button-decrement-${item.id}`}
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </Button>
                            <span
                              className="min-w-[2rem] text-center text-sm font-mono font-bold text-white px-1 select-none"
                              data-testid={`text-quantity-${item.id}`}
                            >
                              {item.quantity}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/10 rounded-none"
                              aria-label={`Agregar una unidad de ${item.name}`}
                              data-testid={`button-increment-${item.id}`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <span className="text-white font-mono font-bold text-sm whitespace-nowrap">
                            ${(item.price * item.quantity).toLocaleString("es-AR")}
                          </span>
                        </div>

                        {groupAsPlancha && (
                          <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/15 px-1.5 py-0.5 rounded self-start">
                            <Layers className="w-2.5 h-2.5" />
                            Va en la plancha
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(item.id)}
                        className="text-white/40 hover:text-destructive hover:bg-destructive/10 shrink-0"
                        aria-label={`Eliminar ${item.name} del carrito`}
                      >
                        <Trash2 className="w-5 h-5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              
              <div className="p-6 border-t border-white/10 bg-[#0a0a0a]">
                <div className="mb-4 p-3 rounded-sm border border-primary/30 bg-primary/5">
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor="group-as-plancha"
                      className="flex items-start gap-2 cursor-pointer flex-1"
                    >
                      <Layers className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="space-y-0.5">
                        <div className="text-sm font-bold text-white">
                          Armar plancha (+${planchaPrice.toLocaleString("es-AR")})
                        </div>
                        <div className="text-[11px] text-white/50">
                          Sumamos un único costo de armado para que recibas todos
                          los diseños en una sola plancha lista para imprimir.
                        </div>
                      </div>
                    </Label>
                    <Switch
                      id="group-as-plancha"
                      checked={groupAsPlancha}
                      onCheckedChange={setGroupAsPlancha}
                    />
                  </div>
                </div>
                {groupAsPlancha && (
                  <div className="space-y-1 mb-3 text-sm">
                    <div className="flex items-center justify-between text-white/70">
                      <span>Subtotal diseños</span>
                      <span className="font-mono">
                        ${itemsTotal.toLocaleString("es-AR")}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-primary">
                      <span className="flex items-center gap-1.5">
                        <Layers className="h-3 w-3" /> Armar plancha
                      </span>
                      <span className="font-mono">
                        +${planchaPrice.toLocaleString("es-AR")}
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between mb-2 border-t border-white/10 pt-3">
                  <span className="text-white/80 font-bold uppercase text-sm">
                    Total
                  </span>
                  <span className="text-2xl font-black font-mono text-white">
                    ${totalPrice.toLocaleString("es-AR")}
                  </span>
                </div>
                <Button
                  onClick={handleCheckoutClick}
                  className="w-full h-14 text-lg font-bold bg-primary text-white hover:bg-primary/90 mt-2"
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
