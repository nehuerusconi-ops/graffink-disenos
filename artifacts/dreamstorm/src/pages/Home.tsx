import { useState } from "react";
import { Header } from "@/components/storefront/Header";
import { Hero } from "@/components/storefront/Hero";
import { DesignMarquee } from "@/components/storefront/DesignMarquee";
import { CategoryTiles } from "@/components/storefront/CategoryTiles";
import { BestSellers } from "@/components/storefront/BestSellers";
import { PlanchasArmadas } from "@/components/storefront/PlanchasArmadas";
import { ProductGrid } from "@/components/storefront/ProductGrid";
import { HowItWorks } from "@/components/storefront/HowItWorks";
import { CustomDesign } from "@/components/storefront/CustomDesign";
import { Benefits } from "@/components/storefront/Benefits";
import { Footer } from "@/components/storefront/Footer";
import { CartSheet } from "@/components/storefront/CartSheet";
import { CheckoutDialog } from "@/components/storefront/CheckoutDialog";
import { Category } from "@/data/products";
import { useProducts } from "@/lib/useProducts";

export default function Home() {
  const [selectedCategory, setSelectedCategory] = useState<Category | "All">("All");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const { products, isLoading } = useProducts();

  return (
    <main className="min-h-screen bg-background flex flex-col font-sans">
      <Header />
      <Hero />
      <DesignMarquee products={products} />
      <CategoryTiles onSelectCategory={setSelectedCategory} />
      <BestSellers products={products} />
      <PlanchasArmadas products={products} />
      <ProductGrid
        products={products}
        isLoading={isLoading}
        selectedCategory={selectedCategory}
        onCategorySelect={setSelectedCategory}
      />
      <HowItWorks />
      <CustomDesign />
      <Benefits />
      <Footer />

      <CartSheet onCheckout={() => setIsCheckoutOpen(true)} />
      <CheckoutDialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen} />
    </main>
  );
}
