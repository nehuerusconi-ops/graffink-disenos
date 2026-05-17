import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider, useAuth } from "@clerk/react";
import { dark } from "@clerk/themes";
import { Router, Route, Switch } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/components/storefront/CartContext";
import { queryClient } from "@/lib/queryClient";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import Home from "@/pages/Home";
import SignInPage from "@/pages/SignIn";
import SignUpPage from "@/pages/SignUp";
import AdminPage from "@/pages/Admin";
import CheckoutResult from "@/pages/CheckoutResult";
import MisCompras from "@/pages/MisCompras";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function AuthTokenInitializer() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(async () => {
      try {
        return await getToken();
      } catch (error) {
        console.warn("Failed to resolve Clerk token for API auth:", error);
        return null;
      }
    });

    return () => {
      setAuthTokenGetter(null);
    };
  }, [getToken]);

  return null;
}

function MissingClerkConfig() {
  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-black uppercase tracking-tight mb-3">
          Falta configurar la autenticación
        </h1>
        <p className="text-white/70 text-sm">
          La variable <code className="text-primary">VITE_CLERK_PUBLISHABLE_KEY</code>{" "}
          no está definida. Revisá las credenciales del proyecto.
        </p>
      </div>
    </main>
  );
}

function App() {
  if (!PUBLISHABLE_KEY) {
    return <MissingClerkConfig />;
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      {...(import.meta.env.PROD
        ? { proxyUrl: `${BASE}/api/__clerk` }
        : {})}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      appearance={{
        baseTheme: dark,
        layout: {
          logoImageUrl: `${BASE}/logo.png`,
          logoLinkUrl: "/",
          socialButtonsPlacement: "bottom",
        },
        variables: {
          colorPrimary: "#3b82f6",
          colorBackground: "#0f0f0f",
          colorText: "#ffffff",
          colorInputBackground: "#1a1a1a",
          colorInputText: "#ffffff",
          fontFamily: "Inter, sans-serif",
          borderRadius: "0.25rem",
        },
        elements: {
          card: "bg-card border border-card-border shadow-2xl",
          headerTitle: "text-2xl font-black uppercase tracking-tight",
          formButtonPrimary:
            "bg-primary hover:bg-primary/90 font-bold uppercase tracking-wider",
        },
      }}
    >
      <AuthTokenInitializer />
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <CartProvider>
            <Router base={BASE}>
              <Switch>
                <Route path="/sign-in" component={SignInPage} />
                <Route path="/sign-in/:rest*" component={SignInPage} />
                <Route path="/sign-up" component={SignUpPage} />
                <Route path="/sign-up/:rest*" component={SignUpPage} />
                <Route path="/admin" component={AdminPage} />
                <Route path="/admin/:rest*" component={AdminPage} />
                <Route path="/checkout/success" component={() => <CheckoutResult type="success" />} />
                <Route path="/checkout/pending" component={() => <CheckoutResult type="pending" />} />
                <Route path="/checkout/failure" component={() => <CheckoutResult type="failure" />} />
                <Route path="/mis-compras" component={MisCompras} />
                <Route path="/" component={Home} />
                <Route component={Home} />
              </Switch>
            </Router>
            <Toaster position="bottom-right" />
          </CartProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
