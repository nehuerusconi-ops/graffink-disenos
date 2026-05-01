import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCart, ORIGINAL_SIZE_LABEL } from "./CartContext";
import { Trash2, ShoppingBag, Layers, Minus, Plus, Clock, Ruler, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

const CUSTOM_SENTINEL = "__custom__";

export function CartSheet({ onCheckout }: { onCheckout: () => void }) {
  const {
    items,
    removeItem,
    updateQuantity,
    updateItemSize,
    totalItems,
    totalPrice,
    itemsTotal,
    isCartOpen,
    setIsCartOpen,
    groupAsPlancha,
    setGroupAsPlancha,
    planchaPrice,
    availableSizes,
    requiresManualPrep,
  } = useCart();

  // Editor state for the custom size popover, keyed by `productId|selectedSize`
  // so two lines of the same product (different sizes) edit independently.
  const [customDraft, setCustomDraft] = useState<
    Record<string, { width: string; height: string }>
  >({});

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
        behavior: "smooth",
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
                  {items.map((item) => {
                    const lineKey = `${item.id}|${item.selectedSize}`;
                    const isCustomDraftOpen = customDraft[lineKey] !== undefined;
                    const isNonOriginal = item.selectedSize !== ORIGINAL_SIZE_LABEL;

                    // Value the <Select/> shows. If the user previously chose
                    // a custom size, the persisted label is "Personalizado WxH cm",
                    // which isn't part of availableSizes, so we map it to the
                    // sentinel so the trigger displays the right hint.
                    const selectValue = isCustomDraftOpen
                      ? CUSTOM_SENTINEL
                      : item.selectedSize.startsWith("Personalizado ")
                      ? CUSTOM_SENTINEL
                      : item.selectedSize;

                    return (
                      <div
                        key={lineKey}
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

                          {/* Per-item size selector */}
                          <div className="flex items-center gap-2">
                            <Ruler className="h-3.5 w-3.5 text-white/40 shrink-0" />
                            <Select
                              value={selectValue}
                              onValueChange={(next) => {
                                if (next === CUSTOM_SENTINEL) {
                                  setCustomDraft((d) => ({
                                    ...d,
                                    [lineKey]: { width: "", height: "" },
                                  }));
                                  return;
                                }
                                setCustomDraft((d) => {
                                  const { [lineKey]: _, ...rest } = d;
                                  return rest;
                                });
                                updateItemSize(item.id, item.selectedSize, next);
                              }}
                            >
                              <SelectTrigger
                                className="h-8 text-xs bg-black/40 border-white/15"
                                data-testid={`select-size-${item.id}`}
                              >
                                <SelectValue placeholder="Elegir medida" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={ORIGINAL_SIZE_LABEL}>
                                  Original (entrega inmediata)
                                </SelectItem>
                                {availableSizes.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {s}
                                  </SelectItem>
                                ))}
                                <SelectItem value={CUSTOM_SENTINEL}>
                                  Personalizado…
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Custom W×H editor */}
                          {isCustomDraftOpen && (
                            <div className="flex items-end gap-2 bg-black/30 border border-white/15 rounded-sm p-2">
                              <div className="flex-1">
                                <Label
                                  htmlFor={`custom-w-${lineKey}`}
                                  className="text-[10px] text-white/50 uppercase tracking-wider"
                                >
                                  Ancho (cm)
                                </Label>
                                <Input
                                  id={`custom-w-${lineKey}`}
                                  type="number"
                                  inputMode="decimal"
                                  min={1}
                                  max={100}
                                  step="0.5"
                                  className="h-8 mt-1"
                                  value={customDraft[lineKey].width}
                                  onChange={(e) =>
                                    setCustomDraft((d) => ({
                                      ...d,
                                      [lineKey]: {
                                        ...d[lineKey],
                                        width: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <span className="text-white/40 pb-2">×</span>
                              <div className="flex-1">
                                <Label
                                  htmlFor={`custom-h-${lineKey}`}
                                  className="text-[10px] text-white/50 uppercase tracking-wider"
                                >
                                  Alto (cm)
                                </Label>
                                <Input
                                  id={`custom-h-${lineKey}`}
                                  type="number"
                                  inputMode="decimal"
                                  min={1}
                                  max={100}
                                  step="0.5"
                                  className="h-8 mt-1"
                                  value={customDraft[lineKey].height}
                                  onChange={(e) =>
                                    setCustomDraft((d) => ({
                                      ...d,
                                      [lineKey]: {
                                        ...d[lineKey],
                                        height: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 bg-primary hover:bg-primary/90 text-white"
                                onClick={() => {
                                  const w = Number(customDraft[lineKey].width);
                                  const h = Number(customDraft[lineKey].height);
                                  if (
                                    !Number.isFinite(w) ||
                                    !Number.isFinite(h) ||
                                    w < 1 ||
                                    h < 1 ||
                                    w > 100 ||
                                    h > 100
                                  ) {
                                    return;
                                  }
                                  updateItemSize(
                                    item.id,
                                    item.selectedSize,
                                    CUSTOM_SENTINEL,
                                    { width: w, height: h },
                                  );
                                  setCustomDraft((d) => {
                                    const { [lineKey]: _, ...rest } = d;
                                    return rest;
                                  });
                                }}
                              >
                                Aplicar
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-white/50 hover:text-white"
                                onClick={() =>
                                  setCustomDraft((d) => {
                                    const { [lineKey]: _, ...rest } = d;
                                    return rest;
                                  })
                                }
                                aria-label="Cancelar medida personalizada"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}

                          {/* Per-item 24hs hint when non-original size active */}
                          {isNonOriginal && !isCustomDraftOpen && (
                            <div className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 rounded self-start">
                              <Clock className="w-2.5 h-2.5" />
                              Preparación 24hs hábiles
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="inline-flex items-center border border-white/15 rounded-sm bg-black/40">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  updateQuantity(item.id, item.selectedSize, item.quantity - 1)
                                }
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
                                onClick={() =>
                                  updateQuantity(item.id, item.selectedSize, item.quantity + 1)
                                }
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
                          onClick={() => removeItem(item.id, item.selectedSize)}
                          className="text-white/40 hover:text-destructive hover:bg-destructive/10 shrink-0"
                          aria-label={`Eliminar ${item.name} del carrito`}
                        >
                          <Trash2 className="w-5 h-5" />
                        </Button>
                      </div>
                    );
                  })}
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

                {/* Cart-wide 24hs banner — visible whenever any non-original
                    size is selected OR plancha grouping is on. */}
                {requiresManualPrep && (
                  <div
                    className="mb-4 p-3 rounded-sm border border-amber-500/40 bg-amber-500/10 flex items-start gap-2"
                    data-testid="banner-24hs"
                  >
                    <Clock className="h-4 w-4 text-amber-300 mt-0.5 shrink-0" />
                    <div className="text-[12px] text-amber-100/90 leading-snug">
                      <strong className="text-amber-200">Preparación manual:</strong>{" "}
                      este pedido se entrega dentro de las{" "}
                      <strong className="text-amber-200">24hs hábiles</strong>{" "}
                      luego de confirmado el pago.
                    </div>
                  </div>
                )}

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
