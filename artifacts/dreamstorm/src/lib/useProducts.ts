import { useListProducts } from "@workspace/api-client-react";
import type { Product as ApiProduct } from "@workspace/api-client-react";
import type { Product } from "@/data/products";

function toClientProduct(p: ApiProduct): Product {
  return {
    id: p.id,
    name: p.name,
    category: p.category as Product["category"],
    price: p.price,
    image: p.imagePath,
    filePath: p.filePath,
    isBestSeller: p.isBestSeller,
    description: p.description ?? null,
    specifications: p.specifications ?? null,
  };
}

export function useProducts() {
  const query = useListProducts<ApiProduct[]>();
  const products: Product[] = (query.data ?? []).map(toClientProduct);
  return { ...query, products };
}
