import { Product } from "@/data/products";
import { ProductCard } from "./ProductCard";
import { motion } from "framer-motion";

export function BestSellers({ products }: { products: Product[] }) {
  const bestSellers = products.filter((p) => p.isBestSeller);

  if (bestSellers.length === 0) return null;

  return (
    <section id="bestsellers" className="py-24 bg-[#0a0a0a] relative z-10 overflow-hidden">
      <div className="container px-4 md:px-6 mx-auto">
        <div className="flex items-end justify-between mb-12">
          <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-white">
            Más <span className="text-primary">vendidos</span>
          </h2>
        </div>

        <div className="flex overflow-x-auto snap-x snap-mandatory gap-6 pb-8 hide-scrollbar">
          {bestSellers.map((product, idx) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, x: 50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className="snap-start shrink-0 w-[280px] sm:w-[320px] md:w-[380px] relative"
            >
              <div className="absolute -top-10 -left-6 text-[120px] font-black text-white/5 z-0 select-none pointer-events-none">
                0{idx + 1}
              </div>
              <div className="relative z-10 h-full">
                <ProductCard product={product} index={idx} />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
