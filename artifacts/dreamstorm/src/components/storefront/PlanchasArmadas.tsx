import { motion } from "framer-motion";
import { Layers } from "lucide-react";
import { Product, PLANCHA_ARMADA_CATEGORY } from "@/data/products";
import { ProductCard } from "./ProductCard";

/**
 * Showcase section for pre-built plancha designs (category: "Plancha armada").
 * These are sold as a single ready-to-print sheet at the price set on each product.
 * Hidden when no products in this category exist.
 */
export function PlanchasArmadas({ products }: { products: Product[] }) {
  const planchas = products.filter((p) => p.category === PLANCHA_ARMADA_CATEGORY);

  if (planchas.length === 0) return null;

  return (
    <section
      id="planchas-armadas"
      className="py-24 bg-gradient-to-b from-background via-[#0a0a0a] to-background relative z-10"
      data-testid="section-planchas-armadas"
    >
      <div className="container px-4 md:px-6 mx-auto">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-4 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider">
              <Layers className="h-3.5 w-3.5" />
              Listo para imprimir
            </div>
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-white">
              Planchas <span className="text-primary">ya armadas</span>
            </h2>
            <p className="text-base md:text-lg text-white/70 mt-3 max-w-2xl font-medium">
              Combinaciones pensadas para sacar el máximo provecho a cada plancha DTF.
              Comprás un único archivo, listo para mandar a imprimir.
            </p>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.6 }}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6"
        >
          {planchas.map((product, idx) => (
            <ProductCard key={product.id} product={product} index={idx} />
          ))}
        </motion.div>
      </div>
    </section>
  );
}
