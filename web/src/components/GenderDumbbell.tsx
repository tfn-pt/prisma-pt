"use client";

import { motion } from "framer-motion";
import { Outfit } from "next/font/google";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

const MARKET_AVERAGE = 0.1938;
const SCALE_MAX = 0.38;

const GENDER_DATA = [
  { category: "Indústria Fabril",        rate: 0.3312, total: 637,  note: "Pedem muitas vezes um género" },
  { category: "Telecomunicações",         rate: 0.3097, total: 113  },
  { category: "Restauração & Hotelaria", rate: 0.2813, total: 999,  note: "Pedem muito 'M/F' ou Cozinheira" },
  { category: "Vendas & Comercial",       rate: 0.2711, total: 3442 },
  { category: "Imobiliário",              rate: 0.2673, total: 202  },
  { category: "Segurança",               rate: 0.2478, total: 113  },
  { category: "Saúde",                   rate: 0.2267, total: 816  },
  { category: "Logística & Armazém",     rate: 0.2156, total: 654  },
  { category: "IT",                       rate: 0.2099, total: 3382 },
  { category: "Engenharia",              rate: 0.1894, total: 1193 },
  { category: "Construção & Obras",      rate: 0.1886, total: 1092 },
  { category: "Agricultura & Ambiente",  rate: 0.1786, total: 84   },
  { category: "Administrativo",          rate: 0.1779, total: 759  },
  { category: "Finanças & Contab.",      rate: 0.1642, total: 1023 },
  { category: "Marketing & Comunicação", rate: 0.1526, total: 1501 },
  { category: "Recursos Humanos",        rate: 0.1250, total: 288  },
  { category: "Outros",                  rate: 0.1222, total: 1383 },
  { category: "Educação & Formação",     rate: 0.1056, total: 606  },
  { category: "Design & Criativo",       rate: 0.0924, total: 1774 },
  { category: "Beleza & Estética",       rate: 0.0847, total: 236  },
  { category: "Jurídico & Legal",        rate: 0.0840, total: 119,  note: "Quase nunca pedem género" },
];

function positionPct(rate: number) {
  return (rate / SCALE_MAX) * 100;
}

const avgPos = positionPct(MARKET_AVERAGE);

const HIGHLIGHTS = new Set(["Indústria Fabril", "Restauração & Hotelaria", "Jurídico & Legal"]);

function getColor(rate: number) {
  const deviation = rate - MARKET_AVERAGE;
  if (deviation > 0.05) return { dot: "#f59e0b", line: "#f59e0b55" };
  if (deviation < -0.05) return { dot: "#60a5fa", line: "#60a5fa55" };
  return { dot: "#a1a1aa", line: "#a1a1aa33" };
}

export default function GenderDumbbell() {
  const sorted = [...GENDER_DATA].sort((a, b) => b.rate - a.rate);

  return (
    <section className={`${outfit.className} relative py-28 px-5 sm:px-8 lg:px-10`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_60%_40%,rgba(245,158,11,0.05),transparent_45%),radial-gradient(circle_at_30%_60%,rgba(96,165,250,0.05),transparent_45%)]" />

      <div className="mx-auto max-w-7xl">
        <motion.header
          className="mb-20 grid gap-8 lg:grid-cols-[1fr_30rem]"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <div>
            <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-amber-400">
              PRISMA / Capítulo III / Homens e Mulheres
            </p>
            <h2 className="mt-3 text-[clamp(3rem,7vw,7rem)] font-900 leading-[0.88] tracking-tight text-[#f7f3eb]">
              O Espelho
              <br />
              <span className="text-white/40">do Género</span>
            </h2>
          </div>
          <div className="self-end">
            <p className="text-sm leading-relaxed text-white/60">
              A linha do meio mostra o normal em Portugal: em média,{" "}
              <span className="font-black text-amber-400">19,4%</span> dos anúncios procuram alguém de um <span className="text-white">género específico</span> (por exemplo, escrevendo "M/F" ou pedindo uma "Cozinheira"). As bolinhas mostram se cada área de trabalho faz isto muito mais do que o normal (para a direita) ou quase nunca o faz (para a esquerda).
            </p>
            <div className="mt-5 flex flex-wrap gap-5">
              {[
                { color: "#f59e0b", label: "Muito acima do normal" },
                { color: "#a1a1aa", label: "Dentro do normal" },
                { color: "#60a5fa", label: "Quase nunca pedem" },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full shadow-[0_0_12px_rgba(255,255,255,0.2)]" style={{ backgroundColor: color }} />
                  <span className="text-xs font-bold uppercase tracking-[0.12em] text-white/60">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.header>

        <div className="rounded-xl border border-white/10 bg-black/50 p-6 backdrop-blur-xl sm:p-8">
          <div className="relative mb-6 flex items-end pb-3">
            <div className="absolute inset-x-0 top-0 h-full" style={{ marginLeft: "13rem" }}>
              {[0, 10, 20, 30].map((pct) => {
                const pos = positionPct(pct / 100);
                return (
                  <div
                    key={pct}
                    className="absolute top-0 bottom-0"
                    style={{ left: `${pos}%` }}
                  >
                    <div className="h-full w-px bg-white/[0.08]" />
                    <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[0.52rem] font-black text-white/30 whitespace-nowrap">
                      {pct}%
                    </span>
                  </div>
                );
              })}
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-white/30"
                style={{ left: `${avgPos}%` }}
              >
                <div
                  className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/20 bg-black/90 px-2 py-1 text-[0.52rem] font-black text-white/90 shadow-lg backdrop-blur-xl"
                >
                  Média Normal (19,4%)
                </div>
              </div>
            </div>
            <div className="w-52 shrink-0 text-[0.54rem] font-black uppercase tracking-[0.16em] text-white/30">
              Setor de Trabalho
            </div>
          </div>

          <div className="flex flex-col divide-y divide-white/[0.04]">
            {sorted.map((item, idx) => {
              const dotPos = positionPct(item.rate);
              const isAbove = item.rate > MARKET_AVERAGE;
              const isHighlight = HIGHLIGHTS.has(item.category);
              const { dot, line: lineColor } = getColor(item.rate);

              const lineLeft = Math.min(avgPos, dotPos);
              const lineRight = Math.max(avgPos, dotPos);
              const lineWidth = lineRight - lineLeft;

              return (
                <motion.div
                  key={item.category}
                  className="group relative flex items-center gap-0 py-2.5"
                  initial={{ opacity: 0, x: -15 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.03, duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="w-52 shrink-0 pr-4">
                    <span
                      className={`text-[0.64rem] font-bold uppercase tracking-[0.09em] transition-colors duration-300 group-hover:text-white ${
                        isHighlight ? "text-white/80" : "text-white/45"
                      }`}
                    >
                      {item.category}
                    </span>
                    {item.note && (
                      <span className="mt-0.5 block text-[0.48rem] text-white/40 leading-tight">
                        {item.note}
                      </span>
                    )}
                  </div>

                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/[0.04]" />

                    <div
                      className="absolute top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-white/20"
                      style={{ left: `${avgPos}%` }}
                    />

                    <motion.div
                      className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                      style={{
                        left: `${lineLeft}%`,
                        width: `${lineWidth}%`,
                        backgroundColor: lineColor,
                      }}
                      initial={{ scaleX: 0, transformOrigin: isAbove ? "0% 50%" : "100% 50%" }}
                      whileInView={{ scaleX: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.03 + 0.25, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    />

                    <motion.div
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                      style={{
                        left: `${dotPos}%`,
                        width: isHighlight ? "12px" : "8px",
                        height: isHighlight ? "12px" : "8px",
                        backgroundColor: dot,
                        borderColor: isHighlight ? "rgba(255,255,255,0.4)" : "transparent",
                        boxShadow: isHighlight ? `0 0 16px ${dot}88` : "none",
                      }}
                      initial={{ scale: 0 }}
                      whileInView={{ scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: idx * 0.03 + 0.4, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    />

                    <div
                      className={`absolute top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-black/90 px-1.5 py-0.5 text-[0.52rem] font-black backdrop-blur-xl transition-opacity duration-200 ${
                        isHighlight
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100"
                      }`}
                      style={{
                        left: isAbove
                          ? `calc(${dotPos}% + 8px)`
                          : undefined,
                        right: !isAbove
                          ? `calc(${100 - dotPos}% + 8px)`
                          : undefined,
                        color: dot,
                      }}
                    >
                      {(item.rate * 100).toFixed(1)}%
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="relative mt-4 h-5" style={{ marginLeft: "13rem" }}>
            {[0, 5, 10, 15, 20, 25, 30, 35].map((pct) => {
              const pos = positionPct(pct / 100);
              if (pos > 100) return null;
              return (
                <span
                  key={pct}
                  className="absolute top-0 text-[0.5rem] font-black text-white/20"
                  style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
                >
                  {pct}%
                </span>
              );
            })}
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            {
              sector: "Indústria Fabril",
              rate: "33,1%",
              delta: "+13,7pp",
              color: "#f59e0b",
              insight:
                "É a área que mais pede um género. Usa se muito palavras como 'Operário' em vez de algo que dê para ambos.",
            },
            {
              sector: "Restauração & Hotelaria",
              rate: "28,1%",
              delta: "+8,7pp",
              color: "#fb923c",
              insight:
                "Depois da pandemia, começaram a pedir mais 'Cozinheiras' ou 'Empregados' específicos para voltar a abrir.",
            },
            {
              sector: "Jurídico & Legal",
              rate: "8,4%",
              delta: "−11,0pp",
              color: "#60a5fa",
              insight:
                "É a área mais neutra! Em anúncios para escritórios de advogados, quase não importa o género da pessoa.",
            },
          ].map(({ sector, rate, delta, color, insight }) => (
            <motion.div
              key={sector}
              className="rounded-xl border border-white/10 bg-black/50 p-5 backdrop-blur-xl"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-white/40">
                    {sector}
                  </p>
                  <p className="mt-1 text-2xl font-black" style={{ color }}>
                    {rate}
                  </p>
                </div>
                <span
                  className="shrink-0 rounded-md border px-2 py-1 text-[0.56rem] font-black"
                  style={{ color, borderColor: `${color}33`, backgroundColor: `${color}11` }}
                >
                  {delta}
                </span>
              </div>
              <p className="text-[0.62rem] leading-5 text-white/45">{insight}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}