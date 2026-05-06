"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Outfit } from "next/font/google";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

// ─── DATA (INVERTED FOR TOP-DOWN HIERARCHY) ──────────────────────────────────
// 100 squares mapping real seniority distribution from master_data_rich.json
// The colorful/elite tiers are now rendered first to sit at the top of the grid.
// ─────────────────────────────────────────────────────────────────────────────
const TIERS = [
  { seniority: "lead",     count: 1,  share: 0.0038, color: "#4c1d95", glowColor: "rgba(76,29,149,0.5)", label: "Lead",       hex: "#a78bfa" },
  { seniority: "director", count: 2,  share: 0.0171, color: "#7f1d1d", glowColor: "rgba(127,29,29,0.5)", label: "Director",   hex: "#ef4444" },
  { seniority: "senior",   count: 2,  share: 0.0224, color: "#92400e", glowColor: "rgba(146,64,14,0.5)", label: "Senior",     hex: "#f59e0b" },
  { seniority: "manager",  count: 10, share: 0.1016, color: "#1d4ed8", glowColor: "rgba(29,78,216,0.5)", label: "Manager",    hex: "#3b82f6" },
  { seniority: "junior",   count: 5,  share: 0.0547, color: "#065f46", glowColor: "rgba(6,95,70,0.5)",   label: "Junior",     hex: "#10b981" },
  { seniority: "mid",      count: 80, share: 0.8004, color: "#1e293b", glowColor: "rgba(30,41,59,0.6)",  label: "Mid-level",  hex: "#64748b" },
];

// The "glass line" now sits after the top 20 squares (after row 1, before row 2)
const GLASS_LINE_AFTER_ROW = 1;

type Square = { seniority: string; color: string; hex: string; glowColor: string };

function buildSquares(): Square[] {
  const out: Square[] = [];
  for (const tier of TIERS) {
    for (let i = 0; i < tier.count; i++) {
      out.push({ seniority: tier.seniority, color: tier.color, hex: tier.hex, glowColor: tier.glowColor });
    }
  }
  return out;
}

export default function SeniorityWaffle() {
  const squares = useMemo(() => buildSquares(), []);

  return (
    <section className={`${outfit.className} relative py-28 px-5 sm:px-8 lg:px-10`}>
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(29,78,216,0.06),transparent_50%),radial-gradient(circle_at_70%_50%,rgba(239,68,68,0.06),transparent_50%)]" />

      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <motion.header
          className="mb-20"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-[0.62rem] font-black uppercase tracking-[0.3em] text-blue-400">
            PRISMA / Capítulo II / Hierarquia
          </p>
          <h2 className="mt-3 text-[clamp(3rem,7vw,7rem)] font-black leading-[0.88] text-[#f7f3eb]">
            O Tecto
            <br />
            <span className="text-white/40">de Vidro</span>
          </h2>
          <p className="mt-6 max-w-xl text-xs leading-6 text-white/50">
            Em cada 100 anúncios de emprego em Portugal, 80 existem no mesmo patamar.{" "}
            <span className="text-white/80">O mercado não tem escada. Tem um corredor longo.</span>
          </p>
        </motion.header>

        {/* Layout flipped: Waffle constrained to max ~400px, Sidebar gets the rest */}
        <div className="grid gap-12 lg:gap-16 lg:grid-cols-[360px_1fr] xl:grid-cols-[400px_1fr] items-start">
          
          {/* ── Waffle Grid (Smaller & Inverted) ── */}
          <div className="relative w-full">
            <div className="relative grid grid-cols-10 gap-1 sm:gap-[6px]">
              {squares.map((sq, i) => {
                const row = Math.floor(i / 10);
                // Elite is now everything at or above the glass line (Rows 0 and 1)
                const isElite = row <= GLASS_LINE_AFTER_ROW;

                return (
                  <motion.div
                    key={i}
                    className="group relative aspect-square cursor-default rounded-[3px]"
                    style={{ backgroundColor: sq.color }}
                    initial={{ opacity: 0, scale: 0.3 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.008, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    whileHover={{ scale: 1.18, zIndex: 10, backgroundColor: sq.hex }}
                  >
                    {isElite && (
                      <div
                        className="pointer-events-none absolute inset-0 rounded-[3px]"
                        style={{ boxShadow: `inset 0 0 8px ${sq.hex}55, 0 0 12px ${sq.hex}33` }}
                      />
                    )}
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-zinc-950/95 px-2 py-1 opacity-0 backdrop-blur-xl transition-opacity duration-200 group-hover:opacity-100">
                      <p className="text-[0.54rem] font-black uppercase tracking-[0.16em] text-white/70">
                        {sq.seniority}
                      </p>
                    </div>
                  </motion.div>
                );
              })}

              {/* Glass Line — Now sitting at 20% from the top */}
              <motion.div
                className="pointer-events-none absolute left-0 right-0 z-10 flex items-center gap-3"
                style={{ top: "calc(20% - 3px)" }}
                initial={{ opacity: 0, scaleX: 0 }}
                whileInView={{ opacity: 1, scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.9, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="h-[1.5px] flex-1 bg-white/70 shadow-[0_0_18px_rgba(255,255,255,0.55)]" />
                <span className="shrink-0 rounded-md border border-white/20 bg-black/90 px-2.5 py-1 text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/80 backdrop-blur-xl">
                  TECTO DE VIDRO
                </span>
                <div className="h-[1.5px] flex-1 bg-white/70 shadow-[0_0_18px_rgba(255,255,255,0.55)]" />
              </motion.div>
            </div>

            {/* Annotation cards (Swapped order to match top-down flow) */}
            <div className="mt-6 grid grid-cols-2 gap-4">
              <motion.div
                className="rounded-lg border border-white/10 bg-black/60 p-4 backdrop-blur-xl"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 1.2, duration: 0.5 }}
              >
                <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-amber-400/80">
                  Liderança real
                </p>
                <p className="mt-1 text-2xl font-black text-white">3,9%</p>
                <p className="text-xs text-white/35">Senior + Director + Lead</p>
              </motion.div>
              <motion.div
                className="rounded-lg border border-white/10 bg-black/60 p-4 backdrop-blur-xl"
                initial={{ opacity: 0, x: 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 1.3, duration: 0.5 }}
              >
                <p className="text-[0.58rem] font-black uppercase tracking-[0.2em] text-white/40">
                  Zona Mid-level
                </p>
                <p className="mt-1 text-2xl font-black text-white">80</p>
                <p className="text-xs text-white/35">em 100 anúncios</p>
              </motion.div>
            </div>
          </div>

          {/* ── Sidebar (Stats & Colors at the top) ── */}
          <div className="flex flex-col gap-5">
            
            {/* 1. Stats cluster moved to the top */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { val: "2,2%", label: "Atingem Senior",   color: "#f59e0b" },
                { val: "1,7%", label: "Atingem Director", color: "#ef4444" },
                { val: "10,2%", label: "São Managers",    color: "#3b82f6" },
                { val: "80%",  label: "Ficam no Mid",     color: "#64748b" },
              ].map(({ val, label, color }) => (
                <div key={label} className="rounded-lg border border-white/10 bg-black/60 p-4 backdrop-blur-xl">
                  <p className="text-2xl font-black" style={{ color }}>{val}</p>
                  <p className="mt-1 text-[0.54rem] font-bold uppercase tracking-[0.14em] text-white/40">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            {/* 2. Tier legend (Colors) */}
            <div className="rounded-xl border border-white/10 bg-black/50 p-5 backdrop-blur-xl">
              <p className="mb-5 text-[0.58rem] font-black uppercase tracking-[0.22em] text-white/40">
                Distribuição por nível
              </p>
              <div className="flex flex-col gap-3.5">
                {TIERS.map((tier) => (
                  <div key={tier.seniority} className="flex items-center gap-3">
                    <div className="h-3.5 w-3.5 shrink-0 rounded-sm" style={{ backgroundColor: tier.hex }} />
                    <div className="flex flex-1 items-center justify-between gap-2">
                      <span className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-white/70">
                        {tier.label}
                      </span>
                      <span className="text-[0.65rem] font-black text-white/50">
                        {(tier.share * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-white/5">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: tier.hex }}
                        initial={{ width: 0 }}
                        whileInView={{ width: `${(tier.share / 0.8004) * 100}%` }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.4, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. Pull quote moved to the bottom */}
            <motion.div
              className="rounded-xl border border-white/10 bg-black/50 p-6 backdrop-blur-xl"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              <p className="text-xl font-medium leading-relaxed text-white/80">
                "O mercado de trabalho português não filtra por talento. Filtra por tempo no corredor."
              </p>
              <p className="mt-4 text-[0.56rem] font-black uppercase tracking-[0.18em] text-white/30">
                ANÁLISE PRISMA / ARQUIVO.PT
              </p>
            </motion.div>

          </div>
        </div>
      </div>
    </section>
  );
}