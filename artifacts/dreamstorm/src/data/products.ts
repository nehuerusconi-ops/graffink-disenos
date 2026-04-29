export type Category = "Streetwear" | "Anime" | "Frases" | "Deportes" | "Vintage" | "Infantil";

export interface Product {
  id: string;
  name: string;
  category: Category;
  price: number;
  image: string;
  filePath?: string | null;
  isBestSeller?: boolean;
}

export const CATEGORIES: Category[] = [
  "Streetwear",
  "Anime",
  "Frases",
  "Deportes",
  "Vintage",
  "Infantil"
];

export const PRODUCTS: Product[] = [
  {
    id: "urban-skull",
    name: "Urban Skull",
    category: "Streetwear",
    price: 2500,
    image: "/images/products/urban-skull.png",
    isBestSeller: true,
  },
  {
    id: "street-tiger",
    name: "Street Tiger",
    category: "Streetwear",
    price: 2500,
    image: "/images/products/street-tiger.png",
    isBestSeller: true,
  },
  {
    id: "retro-wave",
    name: "Retro Wave",
    category: "Vintage",
    price: 2000,
    image: "/images/products/retro-wave.png",
  },
  {
    id: "anime-fire",
    name: "Anime Fire",
    category: "Anime",
    price: 2800,
    image: "/images/products/anime-fire.png",
    isBestSeller: true,
  },
  {
    id: "vintage-motor",
    name: "Vintage Motor",
    category: "Vintage",
    price: 2200,
    image: "/images/products/vintage-motor.png",
  },
  {
    id: "cyber-samurai",
    name: "Cyber Samurai",
    category: "Anime",
    price: 2800,
    image: "/images/products/cyber-samurai.png",
    isBestSeller: true,
  },
  {
    id: "neon-dragon",
    name: "Neon Dragon",
    category: "Streetwear",
    price: 3000,
    image: "/images/products/neon-dragon.png",
  },
  {
    id: "y2k-aesthetic",
    name: "Y2K Aesthetic",
    category: "Streetwear",
    price: 2500,
    image: "/images/products/y2k-aesthetic.png",
  },
  {
    id: "messi-goat",
    name: "Campeón del Mundo",
    category: "Deportes",
    price: 2500,
    image: "/images/products/messi-goat.png",
    isBestSeller: true,
  },
  {
    id: "frase-motivacional",
    name: "No Pain No Gain",
    category: "Frases",
    price: 1500,
    image: "/images/products/frase-motivacional.png",
  },
  {
    id: "dino-kids",
    name: "Dino Rex",
    category: "Infantil",
    price: 1800,
    image: "/images/products/dino-kids.png",
  },
  {
    id: "frase-gym",
    name: "Focus",
    category: "Frases",
    price: 1500,
    image: "/images/products/frase-gym.png",
  }
];
