import { useState, useMemo } from "react";
import { CATEGORIES, Category, Product, PLANCHA_ARMADA_CATEGORY } from "@/data/products";
import { ProductCard } from "./ProductCard";
import { Input } from "@/components/ui/input";
import { Search, Loader2 } from "lucide-react";

// Categories shown in the main storefront filter bar. "Plancha armada" is
// excluded — those products live in their own dedicated section.
const STOREFRONT_CATEGORIES = CATEGORIES.filter((c) => c !== PLANCHA_ARMADA_CATEGORY);

export function ProductGrid({
  products,
  isLoading,
  selectedCategory,
  onCategorySelect,
}: {
  products: Product[];
  isLoading: boolean;
  selectedCategory: Category | "All";
  onCategorySelect: (cat: Category | "All") => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProducts = useMemo(() => {
    return products
      // Hide pre-built planchas from the main grid; they live in their own section.
      .filter((p) => p.category !== PLANCHA_ARMADA_CATEGORY)
      .filter((product) => {
        const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === "All" || product.category === selectedCategory;
        return matchesSearch && matchesCategory;
      });
  }, [products, searchQuery, selectedCategory]);

  return (
    <section id="products" className="py-24 bg-background relative z-10">
      <div className="container px-4 md:px-6 mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
          <div>
            <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter mb-4 text-white">
              Todos los <span className="text-primary">diseños</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onCategorySelect("All")}
                className={`px-4 py-1.5 text-sm font-bold uppercase rounded-full transition-colors border ${
                  selectedCategory === "All"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-white/70 border-white/20 hover:border-white/50 hover:text-white"
                }`}
              >
                Todos
              </button>
              {STOREFRONT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => onCategorySelect(cat)}
                  className={`px-4 py-1.5 text-sm font-bold uppercase rounded-full transition-colors border ${
                    selectedCategory === cat
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-transparent text-white/70 border-white/20 hover:border-white/50 hover:text-white"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="relative w-full md:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
            <Input
              type="text"
              placeholder="Buscar por nombre..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/50 focus-visible:ring-primary rounded-sm h-11"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-white/40" />
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-24 border border-dashed border-white/10 rounded-sm">
            <p className="text-xl text-white/50 font-medium">No se encontraron diseños.</p>
            <button
              onClick={() => { setSearchQuery(""); onCategorySelect("All"); }}
              className="mt-4 text-primary hover:underline font-bold"
            >
              Limpiar filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredProducts.map((product, idx) => (
              <ProductCard key={product.id} product={product} index={idx} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
