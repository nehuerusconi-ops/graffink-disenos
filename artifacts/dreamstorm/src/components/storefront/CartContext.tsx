import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Product } from "@/data/products";
import { toast } from "sonner";
import { useGetAppSettings } from "@workspace/api-client-react";

interface CartItem extends Product {
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  addItem: (product: Product) => void;
  removeItem: (productId: string) => void;
  /**
   * Cambia la cantidad de un diseño en el carrito.
   * Si `quantity <= 0`, elimina el ítem por completo.
   */
  updateQuantity: (productId: string, quantity: number) => void;
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
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const CART_STORAGE_KEY = "graffink_cart";
const LEGACY_CART_STORAGE_KEY = "dreamstorm_cart";

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      const current = localStorage.getItem(CART_STORAGE_KEY);
      if (current) return JSON.parse(current);
      // One-time migration from the previous brand's cart key so in-flight
      // carts are not lost when the brand was renamed to GraffInk Diseños.
      const legacy = localStorage.getItem(LEGACY_CART_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(CART_STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
        return JSON.parse(legacy);
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

  // Fetch the configurable plancha price once; all consumers reuse it via the
  // shared React Query cache (stale-while-revalidate). Falls back to 1000 ARS
  // (matches DEFAULT_PLANCHA_PRICE_ARS in the DB schema) if the request fails.
  const settingsQuery = useGetAppSettings();
  const planchaPrice = settingsQuery.data?.planchaGroupingPrice ?? 1000;

  const addItem = (product: Product) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    toast.success(`"${product.name}" agregado al carrito`);
  };

  const removeItem = (productId: string) => {
    setItems((prev) => prev.filter((item) => item.id !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(productId);
      return;
    }
    setItems((prev) =>
      prev.map((item) =>
        item.id === productId ? { ...item, quantity } : item
      )
    );
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

  return (
    <CartContext.Provider
      value={{
        items,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalItems,
        itemsTotal,
        totalPrice,
        isCartOpen,
        setIsCartOpen,
        groupAsPlancha,
        setGroupAsPlancha,
        planchaPrice,
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
