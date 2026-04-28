import { ImageDown, Layers, Printer, Zap } from "lucide-react";
import { motion } from "framer-motion";

export function Benefits() {
  const benefits = [
    {
      icon: <ImageDown className="w-8 h-8 text-primary" />,
      title: "PNG alta resolución",
      desc: "Archivos a 300dpi garantizados para un estampado nítido."
    },
    {
      icon: <Layers className="w-8 h-8 text-primary" />,
      title: "Fondo transparente",
      desc: "Listos para aplicar sobre cualquier color de prenda."
    },
    {
      icon: <Printer className="w-8 h-8 text-primary" />,
      title: "Listo para DTF",
      desc: "Colores optimizados para plotters de impresión textil."
    },
    {
      icon: <Zap className="w-8 h-8 text-primary" />,
      title: "Descarga inmediata",
      desc: "Acceso automático al archivo original tras el pago."
    }
  ];

  return (
    <section className="py-24 bg-background relative z-10">
      <div className="container px-4 md:px-6 mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {benefits.map((b, idx) => (
            <motion.div
              key={b.title}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: idx * 0.1 }}
              className="bg-white/5 border border-white/10 p-8 rounded-sm hover:bg-white/10 transition-colors flex flex-col items-center text-center gap-4"
            >
              <div className="p-4 bg-primary/10 rounded-full">
                {b.icon}
              </div>
              <h3 className="text-xl font-bold text-white">{b.title}</h3>
              <p className="text-white/60 font-medium">{b.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
