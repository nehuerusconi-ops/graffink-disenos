import { motion } from "framer-motion";
import { MousePointerClick, CreditCard, Download } from "lucide-react";

export function HowItWorks() {
  const steps = [
    {
      num: "01",
      icon: <MousePointerClick className="w-10 h-10 text-primary mb-6" />,
      title: "Elegí tu diseño",
      desc: "Navegá nuestra galería y seleccioná los gráficos que mejor se adapten a tu marca o colección."
    },
    {
      num: "02",
      icon: <CreditCard className="w-10 h-10 text-primary mb-6" />,
      title: "Pagá online",
      desc: "Completá el pago de forma segura a través de Mercado Pago, transferencia bancaria o PayPal."
    },
    {
      num: "03",
      icon: <Download className="w-10 h-10 text-primary mb-6" />,
      title: "Descargá el PNG automáticamente",
      desc: "Recibí el link de descarga al instante. Archivos en alta resolución listos para imprimir en DTF."
    }
  ];

  return (
    <section className="py-32 bg-[#050505] relative z-10 border-y border-white/5">
      <div className="container px-4 md:px-6 mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-20">
          <h2 className="text-4xl md:text-6xl font-black uppercase tracking-tighter text-white mb-6">
            Cómo <span className="text-primary">funciona</span>
          </h2>
          <p className="text-xl text-white/60 font-medium">
            Un proceso simple y directo. Sin suscripciones, sin vueltas. Pagás por lo que usás.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-8 relative">
          {/* Connector line on desktop */}
          <div className="hidden md:block absolute top-12 left-[15%] right-[15%] h-px bg-gradient-to-r from-primary/0 via-primary/30 to-primary/0"></div>

          {steps.map((step, idx) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: idx * 0.2 }}
              className="relative flex flex-col items-center text-center z-10"
            >
              <div className="text-8xl font-black text-white/5 absolute -top-10 left-1/2 -translate-x-1/2 pointer-events-none select-none">
                {step.num}
              </div>
              <div className="bg-[#050505] p-2 rounded-full mb-2">
                {step.icon}
              </div>
              <h3 className="text-2xl font-bold text-white mb-4 tracking-tight">{step.title}</h3>
              <p className="text-white/60 text-lg leading-relaxed">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
