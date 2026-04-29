import { Product } from "@/data/products";

export function DesignMarquee({ products }: { products: Product[] }) {
  const bestSellers = products.filter((p) => p.isBestSeller);
  if (bestSellers.length === 0) return null;

  const doubled = [...bestSellers, ...bestSellers, ...bestSellers];

  return (
    <div
      className="w-full overflow-hidden bg-[#0a0a0a] py-5 border-y border-white/5 relative"
      aria-hidden="true"
    >
      {/* Left/right fade masks */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-24 z-10 bg-gradient-to-r from-[#0a0a0a] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-24 z-10 bg-gradient-to-l from-[#0a0a0a] to-transparent" />

      <div
        className="flex gap-4 w-max"
        style={{
          animation: "marquee-scroll 40s linear infinite",
        }}
      >
        {doubled.map((p, i) => (
          <div
            key={`${p.id}-${i}`}
            className="shrink-0 w-28 h-28 sm:w-36 sm:h-36 rounded-sm overflow-hidden border border-white/10 bg-black/40"
          >
            <img
              src={
                p.image.startsWith("/objects/")
                  ? `/api/storage${p.image}`
                  : p.image
              }
              alt={p.name}
              className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity"
              draggable={false}
            />
          </div>
        ))}
      </div>

      <style>{`
        @keyframes marquee-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-33.333%); }
        }
      `}</style>
    </div>
  );
}
