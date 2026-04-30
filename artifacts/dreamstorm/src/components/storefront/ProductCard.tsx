import { useState } from "react";
import { motion } from "framer-motion";
import { Product } from "@/data/products";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Eye } from "lucide-react";
import { useCart } from "./CartContext";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function ProductCard({ product, index }: { product: Product; index: number }) {
  const { addItem } = useCart();
  const [open, setOpen] = useState(false);

  const hasDetails =
    (product.description && product.description.trim().length > 0) ||
    (product.specifications && product.specifications.length > 0);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.5, delay: index * 0.05 }}
        className="group relative flex flex-col bg-card border border-white/10 rounded-sm overflow-hidden hover:border-primary/50 transition-colors"
      >
        <div className="relative aspect-square overflow-hidden bg-black/40 p-4">
          {product.isBestSeller && (
            <Badge className="absolute top-3 left-3 z-10 bg-primary text-primary-foreground hover:bg-primary font-bold rounded-none">
              HOT
            </Badge>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10 flex flex-col justify-end gap-2 p-4">
            <Button
              onClick={() => addItem(product)}
              className="w-full font-bold rounded-none bg-white text-black hover:bg-primary hover:text-white transition-colors"
              data-testid={`button-add-${product.id}`}
            >
              <ShoppingCart className="mr-2 h-4 w-4" />
              Agregar al carrito
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpen(true)}
              className="w-full font-bold rounded-none border-white/30 bg-black/40 text-white hover:bg-white hover:text-black"
              data-testid={`button-details-${product.id}`}
            >
              <Eye className="mr-2 h-4 w-4" />
              Ver detalles
            </Button>
          </div>
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-contain filter drop-shadow-2xl group-hover:scale-110 transition-transform duration-500"
          />
        </div>
        <div className="p-4 flex flex-col gap-1">
          <div className="text-xs font-medium text-primary tracking-wider uppercase">
            {product.category}
          </div>
          <div className="flex justify-between items-start gap-2">
            <h3 className="font-bold text-lg leading-tight text-white line-clamp-1">{product.name}</h3>
            <span className="font-mono font-bold text-white/90 whitespace-nowrap">
              ${product.price.toLocaleString("es-AR")}
            </span>
          </div>
        </div>
      </motion.div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl bg-card border-white/10 p-0 overflow-hidden">
          <div className="grid md:grid-cols-2 gap-0">
            <div className="aspect-square bg-black/60 p-6 flex items-center justify-center">
              <img
                src={product.image}
                alt={product.name}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-6 flex flex-col gap-4 max-h-[80vh] overflow-y-auto">
              <DialogHeader className="space-y-2 text-left">
                <div className="text-xs font-medium text-primary tracking-wider uppercase">
                  {product.category}
                </div>
                <DialogTitle className="text-2xl font-black uppercase tracking-tight text-white">
                  {product.name}
                </DialogTitle>
                <div className="text-3xl font-black font-mono text-primary">
                  ${product.price.toLocaleString("es-AR")}
                </div>
                <DialogDescription className="sr-only">
                  Detalles del diseño {product.name}
                </DialogDescription>
              </DialogHeader>

              {product.description && product.description.trim().length > 0 && (
                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white/60">
                    Descripción
                  </h4>
                  <p className="text-sm text-white/80 whitespace-pre-line leading-relaxed">
                    {product.description}
                  </p>
                </div>
              )}

              {product.specifications && product.specifications.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white/60">
                    Especificaciones
                  </h4>
                  <dl className="grid grid-cols-1 gap-2 text-sm">
                    {product.specifications.map((spec, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 border-b border-white/5 pb-1.5"
                      >
                        <dt className="text-white/60 font-medium">{spec.key}</dt>
                        <dd className="text-white font-mono text-right">{spec.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {!hasDetails && (
                <p className="text-sm text-white/50">
                  Diseño DTF de alta calidad. Listo para estampar sobre tela.
                </p>
              )}

              <div className="mt-auto pt-4">
                <Button
                  onClick={() => {
                    addItem(product);
                    setOpen(false);
                  }}
                  className="w-full h-12 font-bold rounded-none bg-primary text-white hover:bg-primary/90"
                  data-testid={`button-add-from-modal-${product.id}`}
                >
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Agregar al carrito
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
