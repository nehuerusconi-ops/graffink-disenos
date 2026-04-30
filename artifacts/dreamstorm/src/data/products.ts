// Categories are admin-managed at runtime via /api/categories. The string
// type intentionally accepts any value (including custom ones like "Lali"
// or "Airbag" added from the admin panel) — the storefront fetches the
// authoritative list from the API. The literal-union version that lived
// here previously is now seeded into the database on first server boot.
export type Category = string;

export interface ProductSpec {
  key: string;
  value: string;
}

export interface Product {
  id: string;
  name: string;
  category: Category;
  price: number;
  image: string;
  filePath?: string | null;
  isBestSeller?: boolean;
  description?: string | null;
  specifications?: ProductSpec[] | null;
}

/**
 * @deprecated Use `useListCategories()` from `@workspace/api-client-react`
 * to render the live, admin-managed list. This static array is kept only
 * as a documentation reference of the seven categories that get seeded
 * into the database on first server boot.
 */
export const CATEGORIES: Category[] = [
  "Streetwear",
  "Anime",
  "Frases",
  "Deportes",
  "Vintage",
  "Infantil",
  "Plancha armada",
];

export const PLANCHA_ARMADA_CATEGORY: Category = "Plancha armada";

const DEFAULT_SPECS: ProductSpec[] = [
  { key: "Formato", value: "PNG transparente, alta resolución" },
  { key: "Resolución", value: "300 DPI listo para imprimir" },
  { key: "Tamaño máximo", value: "Aprox. 30 × 40 cm (A3) sin perder calidad" },
  { key: "Uso recomendado", value: "Estampado DTF sobre algodón, poliéster y mezclas" },
  { key: "Licencia", value: "Uso personal y comercial sin atribución" },
];

export const PRODUCTS: Product[] = [
  {
    id: "urban-skull",
    name: "Urban Skull",
    category: "Streetwear",
    price: 2500,
    image: "/images/products/urban-skull.png",
    isBestSeller: true,
    description:
      "Calavera con espíritu urbano y trazos a mano alzada, pensada para remeras oversize y buzos canguro. Mezcla actitud old-school con detalles modernos para un acabado bien streetwear.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "street-tiger",
    name: "Street Tiger",
    category: "Streetwear",
    price: 2500,
    image: "/images/products/street-tiger.png",
    isBestSeller: true,
    description:
      "Tigre con expresión salvaje y paleta urbana, ideal para remeras de impacto. Excelente nivel de detalle en pelaje y ojos para que se luzca el DTF en algodón oscuro.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "retro-wave",
    name: "Retro Wave",
    category: "Vintage",
    price: 2000,
    image: "/images/products/retro-wave.png",
    description:
      "Estética synthwave de los 80s con grilla en perspectiva, atardecer neón y tipografía retro. Perfecta para remeras de música, eventos o merch retro.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "anime-fire",
    name: "Anime Fire",
    category: "Anime",
    price: 2800,
    image: "/images/products/anime-fire.png",
    isBestSeller: true,
    description:
      "Personaje estilo anime envuelto en llamas con líneas limpias y sombreado dramático. Pensado para fans del manga que buscan un diseño con presencia y movimiento.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "vintage-motor",
    name: "Vintage Motor",
    category: "Vintage",
    price: 2200,
    image: "/images/products/vintage-motor.png",
    description:
      "Diseño inspirado en moteros clásicos americanos, con tipografías vintage y detalles desgastados. Va perfecto en remeras blancas, negras o grises envejecidas.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "cyber-samurai",
    name: "Cyber Samurai",
    category: "Anime",
    price: 2800,
    image: "/images/products/cyber-samurai.png",
    isBestSeller: true,
    description:
      "Samurai cyberpunk con armadura futurista y luces de neón. Combina la estética japonesa tradicional con tecnología y se luce especialmente sobre prendas oscuras.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "neon-dragon",
    name: "Neon Dragon",
    category: "Streetwear",
    price: 3000,
    image: "/images/products/neon-dragon.png",
    description:
      "Dragón oriental con paleta neón saturada y trazos finos. Diseño llamativo de gran formato pensado para remeras y buzos que buscan ser el centro de atención.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "y2k-aesthetic",
    name: "Y2K Aesthetic",
    category: "Streetwear",
    price: 2500,
    image: "/images/products/y2k-aesthetic.png",
    description:
      "Composición Y2K con efectos cromados, mariposas y degradés holográficos. Recupera la estética de principios de los 2000 con un toque actual.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "messi-goat",
    name: "Campeón del Mundo",
    category: "Deportes",
    price: 2500,
    image: "/images/products/messi-goat.png",
    isBestSeller: true,
    description:
      "Homenaje al campeón del mundo con la celeste y blanca. Composición pensada para remeras y buzos de hinchas, con detalles que se mantienen nítidos en cualquier color de prenda.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "frase-motivacional",
    name: "No Pain No Gain",
    category: "Frases",
    price: 1500,
    image: "/images/products/frase-motivacional.png",
    description:
      "Frase motivacional con tipografía bold ideal para remeras de gym, training o crossfit. Diseño limpio que estampa perfecto en cualquier color de prenda.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "dino-kids",
    name: "Dino Rex",
    category: "Infantil",
    price: 1800,
    image: "/images/products/dino-kids.png",
    description:
      "Dinosaurio amigable con colores vivos, pensado para remeras de niños y niñas. Ilustración alegre que se luce tanto en prendas claras como en colores fuertes.",
    specifications: DEFAULT_SPECS,
  },
  {
    id: "frase-gym",
    name: "Focus",
    category: "Frases",
    price: 1500,
    image: "/images/products/frase-gym.png",
    description:
      "Tipografía minimalista con la palabra «Focus», ideal para remeras de entrenamiento, ropa deportiva o uso diario. Diseño sobrio que combina con cualquier prenda.",
    specifications: DEFAULT_SPECS,
  }
];
