import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FaInstagram, FaTiktok } from "react-icons/fa6";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";

export function Footer() {
  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("¡Gracias por suscribirte! Te avisaremos de los nuevos ingresos.");
  };

  const scrollTo = (id: string) => {
    const element = document.getElementById(id);
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
    <footer id="footer" className="bg-[#050505] pt-24 pb-12 border-t border-white/10">
      <div className="container px-4 md:px-6 mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 lg:gap-8 mb-16">
          
          <div className="col-span-1 lg:col-span-2">
            <div className="text-3xl font-black tracking-tighter text-white uppercase flex items-center gap-2 mb-6">
              <span className="text-primary">GraffInk</span>&nbsp;Diseños
            </div>
            <p className="text-white/60 text-lg max-w-sm mb-8 font-medium">
              Diseños DTF profesionales para marcas que quieren destacar. Archivos listos para imprimir, sin vueltas.
            </p>
            <div className="flex gap-4">
              <a href="#" className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-primary hover:border-primary transition-colors">
                <FaInstagram className="w-5 h-5" />
              </a>
              <a href="#" className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-primary hover:border-primary transition-colors">
                <FaTiktok className="w-5 h-5" />
              </a>
              <a href="#" className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white hover:bg-primary hover:border-primary transition-colors">
                <MessageCircle className="w-5 h-5" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold uppercase tracking-wider mb-6">Navegación</h4>
            <ul className="flex flex-col gap-4">
              <li><button onClick={() => scrollTo("hero")} className="text-white/60 hover:text-primary transition-colors font-medium">Inicio</button></li>
              <li><button onClick={() => scrollTo("categories")} className="text-white/60 hover:text-primary transition-colors font-medium">Categorías</button></li>
              <li><button onClick={() => scrollTo("products")} className="text-white/60 hover:text-primary transition-colors font-medium">Diseños</button></li>
              <li><button onClick={() => scrollTo("bestsellers")} className="text-white/60 hover:text-primary transition-colors font-medium">Más vendidos</button></li>
              <li><button onClick={() => scrollTo("personalizado")} className="text-white/60 hover:text-primary transition-colors font-medium">Diseño personalizado</button></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-bold uppercase tracking-wider mb-6">Newsletter</h4>
            <p className="text-white/60 mb-4 font-medium">Sumate para recibir los nuevos diseños antes que nadie.</p>
            <form onSubmit={handleSubscribe} className="flex flex-col gap-3">
              <Input 
                type="email" 
                placeholder="Tu email..." 
                required 
                className="bg-white/5 border-white/10 text-white placeholder:text-white/40 h-12"
              />
              <Button type="submit" className="h-12 w-full font-bold bg-primary text-white hover:bg-primary/90">
                Suscribirse
              </Button>
            </form>
          </div>

        </div>

        <div className="pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-white/40 text-sm font-medium">
            © 2026 GraffInk Diseños. Todos los derechos reservados.
          </p>
          <div className="flex gap-6 text-sm font-medium text-white/40">
            <a href="#" className="hover:text-white transition-colors">Términos y condiciones</a>
            <a href="#" className="hover:text-white transition-colors">Política de privacidad</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
