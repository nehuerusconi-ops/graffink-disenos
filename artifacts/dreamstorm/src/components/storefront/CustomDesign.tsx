import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Palette, Send, CheckCircle2 } from "lucide-react";

const CONTACT_EMAIL = "graffink.desing@gmail.com";

export function CustomDesign() {
  const [form, setForm] = useState({ name: "", email: "", description: "" });
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent("Consulta diseño personalizado — GraffInk Diseños");
    const body = encodeURIComponent(
      `Nombre: ${form.name}\nEmail: ${form.email}\n\nDescripción del diseño:\n${form.description}`
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
    setSent(true);
  };

  return (
    <section id="personalizado" className="py-32 bg-[#050505] relative z-10 border-t border-white/5">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_100%,rgba(59,130,246,0.08),transparent)] pointer-events-none" />
      <div className="container px-4 md:px-6 mx-auto relative">
        <div className="grid lg:grid-cols-2 gap-16 items-start">

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary font-medium text-sm mb-6">
              <Palette className="h-3.5 w-3.5" />
              Servicio exclusivo
            </div>
            <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-white mb-6 leading-[1.1]">
              TU DISEÑO,<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-400">
                A MEDIDA
              </span>
            </h2>
            <p className="text-xl text-white/60 font-medium leading-relaxed mb-8">
              ¿No encontrás lo que buscás en el catálogo? Nuestro equipo crea el diseño personalizado que necesitás, adaptado a tu marca o colección.
            </p>

            <ul className="space-y-4 mb-10">
              {[
                "Archivos PNG listos para DTF, igual que el catálogo",
                "Revisiones incluidas hasta que quede perfecto",
                "Entrega en 24 a 48 hs hábiles",
                "Precio según complejidad — consultá sin compromiso",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-white/70 font-medium">
                  <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  {item}
                </li>
              ))}
            </ul>

            <a
              href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                "Consulta diseño personalizado — GraffInk Diseños",
              )}`}
              className="inline-flex items-center gap-3 px-6 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-sm transition-colors"
            >
              <Send className="h-5 w-5" />
              Escribinos a {CONTACT_EMAIL}
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.15 }}
          >
            {sent ? (
              <div className="bg-card border border-card-border rounded-md p-10 flex flex-col items-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tight">¡Listo!</h3>
                <p className="text-white/60 font-medium">
                  Te abrimos el cliente de correo para que podamos coordinar tu diseño personalizado.
                </p>
                <Button
                  variant="ghost"
                  onClick={() => { setSent(false); setForm({ name: "", email: "", description: "" }); }}
                  className="text-white/50 hover:text-white"
                >
                  Enviar otra consulta
                </Button>
              </div>
            ) : (
              <div className="bg-card border border-card-border rounded-md p-8">
                <h3 className="text-xl font-black uppercase tracking-tight mb-2">
                  Contanos qué necesitás
                </h3>
                <p className="text-sm text-white/50 mb-6">
                  Completá el formulario y te respondemos a la brevedad.
                </p>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="custom-name">Nombre</Label>
                      <Input
                        id="custom-name"
                        placeholder="Tu nombre"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-email">Email</Label>
                      <Input
                        id="custom-email"
                        type="email"
                        placeholder="Tu email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom-desc">
                      Descripción del diseño
                    </Label>
                    <textarea
                      id="custom-desc"
                      rows={5}
                      placeholder="Describí qué diseño querés: temática, estilo, colores, referencias, tamaño aproximado, para qué producto es..."
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      required
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none text-white/90 placeholder:text-white/30"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full h-12 bg-primary hover:bg-primary/90 font-bold text-white"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Enviar consulta
                  </Button>
                  <p className="text-xs text-white/30 text-center">
                    O escribinos directo a {CONTACT_EMAIL} y te respondemos a la brevedad.
                  </p>
                </form>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
