import { motion } from "framer-motion";
import { Category } from "@/data/products";

const CATEGORY_TILES = [
  { slug: "streetwear", name: "Streetwear", image: "/images/categories/streetwear.png" },
  { slug: "anime", name: "Anime", image: "/images/categories/anime.png" },
  { slug: "frases", name: "Frases", image: "/images/categories/frases.png" },
  { slug: "deportes", name: "Deportes", image: "/images/categories/deportes.png" },
  { slug: "vintage", name: "Vintage", image: "/images/categories/vintage.png" },
  { slug: "infantil", name: "Infantil", image: "/images/categories/infantil.png" },
];

export function CategoryTiles({ onSelectCategory }: { onSelectCategory: (cat: Category) => void }) {
  const handleSelect = (slug: string, name: string) => {
    onSelectCategory(name as Category);
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
    <section id="categories" className="py-24 bg-background relative z-10">
      <div className="container px-4 md:px-6 mx-auto">
        <div className="mb-12 text-center md:text-left">
          <h2 className="text-3xl md:text-5xl font-black uppercase tracking-tighter text-white mb-4">
            Explorá por <span className="text-primary">categoría</span>
          </h2>
          <p className="text-lg text-white/70 max-w-2xl font-medium">
            Encontrá el estilo perfecto para tu próxima colección. Diseños agrupados por las tendencias más buscadas.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {CATEGORY_TILES.map((cat, idx) => (
            <motion.button
              key={cat.slug}
              onClick={() => handleSelect(cat.slug, cat.name)}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className="group relative aspect-square md:aspect-[4/3] overflow-hidden rounded-sm bg-black/40 border border-white/10 text-left"
            >
              <img
                src={cat.image}
                alt={cat.name}
                className="w-full h-full object-cover opacity-60 group-hover:scale-110 group-hover:opacity-40 transition-all duration-700"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"></div>
              <div className="absolute inset-0 flex flex-col justify-end p-6 md:p-8">
                <h3 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-white mb-2 group-hover:-translate-y-2 transition-transform duration-300">
                  {cat.name}
                </h3>
                <span className="text-primary font-bold opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                  Ver diseños →
                </span>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </section>
  );
}
