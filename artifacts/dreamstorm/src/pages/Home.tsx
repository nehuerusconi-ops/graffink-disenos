import { useState } from "react";
import { Header } from "@/components/storefront/Header";
import { Hero } from "@/components/storefront/Hero";
import { CategoryTiles } from "@/components/storefront/CategoryTiles";
import { BestSellers } from "@/components/storefront/BestSellers";
import { ProductGrid } from "@/components/storefront/ProductGrid";
import { HowItWorks } from "@/components/storefront/HowItWorks";
import { Benefits } from "@/components/storefront/Benefits";
import { Footer } from "@/components/storefront/Footer";
import { CartSheet } from "@/components/storefront/CartSheet";
import { CheckoutDialog } from "@/components/storefront/CheckoutDialog";
import { Category } from "@/data/products";

export default function Home() {
  const [selectedCategory, setSelectedCategory] = useState<Category | "All">("All");
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  return (
    <main className="min-h-screen bg-background flex flex-col font-sans">
      <Header />
      <Hero />
      <CategoryTiles onSelectCategory={setSelectedCategory} />
      <BestSellers />
      <ProductGrid 
        selectedCategory={selectedCategory} 
        onCategorySelect={setSelectedCategory} 
      />
      <HowItWorks />
      <Benefits />
      <Footer />
      
      <CartSheet onCheckout={() => setIsCheckoutOpen(true)} />
      <CheckoutDialog open={isCheckoutOpen} onOpenChange={setIsCheckoutOpen} />
    </main>
  );
}
