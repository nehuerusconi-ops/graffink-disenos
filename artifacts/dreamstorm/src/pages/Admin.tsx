import { useLocation } from "wouter";
import {
  ClerkLoaded,
  ClerkLoading,
  UserButton,
  RedirectToSignIn,
  useAuth,
} from "@clerk/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, Package, BarChart3, FileText } from "lucide-react";
import { ProductsTab } from "./admin/ProductsTab";
import { SalesTab } from "./admin/SalesTab";
import { InvoicesTab } from "./admin/InvoicesTab";

export default function AdminPage() {
  return (
    <>
      <ClerkLoading>
        <main className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/40" />
        </main>
      </ClerkLoading>
      <ClerkLoaded>
        <AdminGate />
      </ClerkLoaded>
    </>
  );
}

function AdminGate() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return <RedirectToSignIn />;
  return <AdminContent />;
}

function AdminContent() {
  const [, navigate] = useLocation();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-white/10 bg-[#0a0a0a] sticky top-0 z-40">
        <div className="container px-4 md:px-6 mx-auto h-16 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3 hover-elevate active-elevate-2 px-2 py-1 rounded-sm"
          >
            <img src="/logo.png" alt="DTF LAB" className="h-10" />
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">
              Panel
            </span>
          </button>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="text-white/70 hover:text-white"
            >
              <LogOut className="h-4 w-4 mr-2" /> Volver al sitio
            </Button>
            <UserButton />
          </div>
        </div>
      </header>

      <div className="container px-4 md:px-6 mx-auto py-8">
        <Tabs defaultValue="products" className="w-full">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tighter">
                Panel de control
              </h1>
              <p className="text-sm text-white/50 mt-1">
                Gestioná tu catálogo, ingresos y facturación.
              </p>
            </div>
            <TabsList className="bg-card border border-card-border h-auto p-1 self-start">
              <TabsTrigger value="products" className="data-[state=active]:bg-primary data-[state=active]:text-white px-4 py-2 font-bold uppercase tracking-wider text-xs">
                <Package className="h-4 w-4 mr-2" /> Diseños
              </TabsTrigger>
              <TabsTrigger value="sales" className="data-[state=active]:bg-primary data-[state=active]:text-white px-4 py-2 font-bold uppercase tracking-wider text-xs">
                <BarChart3 className="h-4 w-4 mr-2" /> Ganancias
              </TabsTrigger>
              <TabsTrigger value="invoices" className="data-[state=active]:bg-primary data-[state=active]:text-white px-4 py-2 font-bold uppercase tracking-wider text-xs">
                <FileText className="h-4 w-4 mr-2" /> Facturación
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="products" className="mt-0">
            <ProductsTab />
          </TabsContent>
          <TabsContent value="sales" className="mt-0">
            <SalesTab />
          </TabsContent>
          <TabsContent value="invoices" className="mt-0">
            <InvoicesTab />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
