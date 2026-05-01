import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Product } from "@/data/products";
import { toast } from "sonner";
import { useGetAppSettings } from "@workspace/api-client-react";

export const ORIGINAL_SIZE_LABEL = "Original";

export interface CustomSizeCm {
  width: number;
  height: number;
}

interface CartItem extends Product {
  quantity: number;
  /**
   * Medida elegida por el cliente para este ítem.
   *
   * Por defecto "Original" (entrega instantánea con el archivo subido por el
   * admin). Cualquier otro valor — ya sea un tamaño estándar del catálogo
   * (ej. "20x20 cm") o el sentinel "Personalizado WxH cm" generado a partir
   * de `customSizeCm` — implica que el pedido necesita preparación manual y
   * se entrega en 24hs hábiles.
   */
  selectedSize: string;
  /**
   * Si el cliente eligió "Personalizado" e ingresó dimensiones libres en cm,
   * acá se guardan; el backend las recibe y persiste como `Personalizado
   * WxH cm` con `isCustomSize: true`.
   */
  customSizeCm?: CustomSizeCm;
}

interface CartContextType {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (productId: string, selectedSize: string) => void;
  /**
   * Cambia la cantidad de un diseño en el carrito.
   * Si `quantity <= 0`, elimina el ítem por completo.
   */
  updateQuantity: (productId: string, selectedSize: string, quantity: number) => void;
  /**
   * Cambia la medida elegida de un ítem. Si el nuevo `selectedSize` es
   * "Personalizado", `customSizeCm` debe venir presente y el label que se
   * muestra al cliente se deriva como "Personalizado WxH cm".
   */
  updateItemSize: (
    productId: string,
    currentSelectedSize: string,
    nextSelectedSize: string,
    customSizeCm?: CustomSizeCm,
  ) => void;
  clearCart: () => void;
  totalItems: number;
  /** Suma de items por su precio individual (sin agrupar). */
  itemsTotal: number;
  /**
   * Total efectivo a cobrar.
   * Si groupAsPlancha=true, equivale a `itemsTotal + planchaPrice` (la
   * plancha es un costo adicional de armado, NO reemplaza el precio de los
   * diseños).
   */
  totalPrice: number;
  isCartOpen: boolean;
  setIsCartOpen: (isOpen: boolean) => void;
  groupAsPlancha: boolean;
  setGroupAsPlancha: (v: boolean) => void;
  /** Precio del servicio "armar plancha" (ARS), traído del backend. */
  planchaPrice: number;
  /** Catálogo de medidas estándar configuradas por el admin. */
  availableSizes: string[];
  /**
   * True cuando el pedido necesita preparación manual antes de poder
   * entregarse — el cliente activó "Armar plancha" o eligió al menos una
   * medida no-original. La UI usa este flag para mostrar el banner ámbar de
   * 24hs y, en `MisCompras`, ocultar el botón de descarga inmediata.
   */
  requiresManualPrep: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "graffink_cart";
const LEGACY_CART_STORAGE_KEY = "dreamstorm_cart";

// Hidrata items viejos del localStorage que no tenían `selectedSize` (versión
// pre-medidas). Sin esto, los carritos en curso quedarían inutilizables al
// liberar la nueva feature porque el dedupe por id+selectedSize miraría
// `undefined` y rompería los handlers que asumen string.
function hydrateLegacyItems(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((it: unknown) => {
    const item = it as CartItem;
    if (typeof item.selectedSize === "string" && item.selectedSize.length > 0) {
      return item;
    }
    return { ...item, selectedSize: ORIGINAL_SIZE_LABEL };
  });
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const current = localStorage.getItem(CART_STORAGE_KEY);
      if (current) return hydrateLegacyItems(JSON.parse(current));
      // One-time migration from the previous brand's cart key so in-flight
      // carts are not lost when the brand was renamed to GraffInk Diseños.
      const legacy = localStorage.getItem(LEGACY_CART_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(CART_STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
        return hydrateLegacyItems(JSON.parse(legacy));
      }
      return [];
    } catch {
      return [];
    }
  });

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [groupAsPlancha, setGroupAsPlancha] = useState(false);

  // Reset the plancha-grouping flag whenever the cart is emptied so the next
  // shopping session starts in the default per-item pricing mode.
  useEffect(() => {
    if (items.length === 0 && groupAsPlancha) {
      setGroupAsPlancha(false);
    }
  }, [items.length, groupAsPlancha]);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  // Fetch the configurable plancha price + size catalog once; all consumers
  // reuse it via the shared React Query cache (stale-while-revalidate).
  // Falls back to defaults if the request fails so the cart never freezes.
  const settingsQuery = useGetAppSettings();
  const planchaPrice = settingsQuery.data?.planchaGroupingPrice ?? 1000;
  const availableSizes: string[] = settingsQuery.data?.availableSizes ?? [
    "10x10 cm",
    "15x15 cm",
    "20x20 cm",
    "30x30 cm",
  ];

  // Items con la misma id pero distinto selectedSize son líneas distintas
  // (típicamente "Diseño X — Original" vs "Diseño X — 20x20 cm"). El cliente
  // necesita poder pedir el mismo arte en dos medidas dentro del mismo carrito.
  const addItem = (product: Product) => {
    setItems((prev) => {
      const existing = prev.find(
        (item) => item.id === product.id && item.selectedSize === ORIGINAL_SIZE_LABEL,
      );
      if (existing) {
        return prev.map((item) =>
          item.id === product.id && item.selectedSize === ORIGINAL_SIZE_LABEL
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [
        ...prev,
        { ...product, quantity: 1, selectedSize: ORIGINAL_SIZE_LABEL },
      ];
    });
    toast.success(`"${product.name}" agregado al carrito`);
  };

  const removeItem = (productId: string, selectedSize: string) => {
    setItems((prev) =>
      prev.filter(
        (item) => !(item.id === productId && item.selectedSize === selectedSize),
      ),
    );
  };

  const updateQuantity = (
    productId: string,
    selectedSize: string,
    quantity: number,
  ) => {
    if (quantity <= 0) {
      removeItem(productId, selectedSize);
      return;
    }
    setItems((prev) =>
      prev.map((item) =>
        item.id === productId && item.selectedSize === selectedSize
          ? { ...item, quantity }
          : item,
      ),
    );
  };

  const updateItemSize = (
    productId: string,
    currentSelectedSize: string,
    nextSelectedSize: string,
    customSizeCm?: CustomSizeCm,
  ) => {
    setItems((prev) => {
      const target = prev.find(
        (it) => it.id === productId && it.selectedSize === currentSelectedSize,
      );
      if (!target) return prev;

      // Resolve the user-visible label first. For custom sizes we derive the
      // label from the dimensions so the cart UI shows "Personalizado 12x18 cm"
      // — same convention the backend uses, which keeps the email/admin panel
      // consistent with what the buyer saw at checkout time.
      const resolvedLabel =
        nextSelectedSize === "__custom__" && customSizeCm
          ? `Personalizado ${customSizeCm.width}x${customSizeCm.height} cm`
          : nextSelectedSize;

      // If switching collapses two lines (same product+size after change),
      // merge into the existing one instead of creating a duplicate.
      const collision = prev.find(
        (it) =>
          it.id === productId &&
          it.selectedSize === resolvedLabel &&
          !(it.id === productId && it.selectedSize === currentSelectedSize),
      );
      if (collision) {
        return prev
          .filter(
            (it) => !(it.id === productId && it.selectedSize === currentSelectedSize),
          )
          .map((it) =>
            it.id === productId && it.selectedSize === resolvedLabel
              ? { ...it, quantity: it.quantity + target.quantity }
              : it,
          );
      }

      return prev.map((it) =>
        it.id === productId && it.selectedSize === currentSelectedSize
          ? {
              ...it,
              selectedSize: resolvedLabel,
              customSizeCm:
                nextSelectedSize === "__custom__" && customSizeCm
                  ? customSizeCm
                  : undefined,
            }
          : it,
      );
    });
  };

  const clearCart = () => {
    setItems([]);
    setGroupAsPlancha(false);
  };

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const itemsTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  // Plancha grouping is now an ADDITIVE service fee on top of the item
  // subtotal — checking the toggle adds `planchaPrice` (default $1000) to
  // the cart total, instead of replacing it. This matches the user's
  // pricing model: cobrar los diseños + el costo de armar la plancha.
  const totalPrice =
    groupAsPlancha && items.length > 0 ? itemsTotal + planchaPrice : itemsTotal;

  const requiresManualPrep =
    (groupAsPlancha && items.length > 0) ||
    items.some(
      (it) =>
        it.customSizeCm !== undefined ||
        (it.selectedSize.length > 0 && it.selectedSize !== ORIGINAL_SIZE_LABEL),
    );

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        updateItemSize,
        clearCart,
        totalItems,
        itemsTotal,
        totalPrice,
        isCartOpen,
        setIsCartOpen,
        groupAsPlancha,
        setGroupAsPlancha,
        planchaPrice,
        availableSizes,
        requiresManualPrep,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
