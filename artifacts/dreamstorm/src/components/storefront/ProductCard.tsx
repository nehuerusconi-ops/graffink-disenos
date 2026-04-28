import { motion } from "framer-motion";
import { Product } from "@/data/products";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { useCart } from "./CartContext";
import { Badge } from "@/components/ui/badge";

export function ProductCard({ product, index }: { product: Product; index: number }) {
  const { addItem } = useCart();

  return (
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10 flex flex-col justify-end p-4">
          <Button 
            onClick={() => addItem(product)}
            className="w-full font-bold rounded-none bg-white text-black hover:bg-primary hover:text-white transition-colors"
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            Agregar al carrito
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
  );
}
