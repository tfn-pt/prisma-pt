"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, ChevronRight, Mail, GitBranch, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Cormorant_Garamond } from "next/font/google";
import Chatbot from "./Chatbot";

// ============================================================================
// FONT — Cormorant Garamond: high-contrast transitional serif
// ============================================================================
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

// ============================================================================
// NAV STRUCTURE
// "SOBRE" is replaced by the "CONTACTOS" hover-dropdown.
// ============================================================================
const navItems = [
  { href: "/rio",     label: "O RIO"     },
  { href: "/espelho", label: "O ESPELHO" },
  { href: "/mapa",    label: "O ARQUIVO"    },
];

const contactItems = [
  {
    label: "Email",
    href: "mailto:tiagonetoac@gmail.com",
    icon: Mail,
    sub: "tiagonetoac@gmail.com",
  },
  {
    label: "GitHub",
    href: "https://github.com/tfn-pt",
    icon: GitBranch,
    sub: "github.com/tfn-pt",
    external: true,
  },
];

// ============================================================================
// ANIMATED JUMP LINK
// Splits text into individual characters. Each springs up −4 px on hover,
// staggered 18 ms per character — the "Pieter Koopt" wave effect.
// ============================================================================
function AnimatedLink({
  href,
  children,
  className,
  onClick,
  external,
}: {
  href?: string;
  children: string;
  className?: string;
  onClick?: () => void;
  external?: boolean;
}) {
  const chars = children.split("");

  const charVariants = {
    rest: { y: 0 },
    hover: (i: number) => ({
      y: [-4, 0],
      transition: {
        delay: i * 0.018,
        duration: 0.38,
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      },
    }),
  };

  const inner = (
    <motion.span
      initial="rest"
      whileHover="hover"
      className={`inline-flex cursor-pointer select-none items-center gap-[0.04em] ${className ?? ""}`}
    >
      {chars.map((ch, i) =>
        ch === " " ? (
          <span key={i} className="inline-block w-[0.3em]" />
        ) : (
          <motion.span
            key={i}
            custom={i}
            variants={charVariants}
            className="inline-block will-change-transform"
          >
            {ch}
          </motion.span>
        )
      )}
    </motion.span>
  );

  if (href) {
    return (
      <Link
        href={href}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick}>
      {inner}
    </button>
  );
}

// ============================================================================
// DESIGN TOKENS
// ============================================================================
const ease = "transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]";

// 30 % frosted glass — primary CTAs & chatbot button
const cta      = "border border-white/20 bg-white/30 backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.22)]";
const ctaHover = "hover:border-white/30 hover:bg-white/40 hover:scale-105 hover:shadow-[0_24px_80px_rgba(255,255,255,0.10)]";

// Ultra-dark glass panel — dropdown cards
const panel =
  "rounded-lg border border-white/10 bg-black/75 shadow-[0_28px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl";

// Nav shell surfaces
const navShell = "bg-white/[0.025] backdrop-blur-md";

// ============================================================================
// HOVER BRIDGE PATTERN (fixes the gap bug)
//
// The key insight: position the dropdown wrapper at `top-full` with NO gap,
// then add `pt-3` INSIDE the wrapper. This creates a visually empty buffer
// zone that is still part of the `group` hit-area — the mouse never escapes.
//
//  ┌──────────────────┐   ← trigger button (inside group)
//  │   group area     │
//  │ ─ ─ ─ ─ ─ ─ ─ ─ │   ← top-full (no CSS gap here!)
//  │   pt-3 buffer    │   ← transparent but hoverable
//  │ ┌──────────────┐ │
//  │ │  visible card│ │   ← actual glassmorphism panel
//  │ └──────────────┘ │
//  └──────────────────┘
// ============================================================================

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function Hairline() {
  return <span className="h-full w-px shrink-0 bg-white/15" aria-hidden="true" />;
}

// Language dropdown — hover-bridge pattern, no gap bug
function LanguageDropdown() {
  return (
    <div className="group relative flex h-full items-stretch">
      <button
        type="button"
        className={`${ease} flex h-full items-center px-5 font-mono text-xs font-bold uppercase tracking-[0.18em] text-white/55 hover:bg-white/[0.04] hover:text-white`}
        aria-haspopup="true"
      >
        PT
      </button>

      {/*
        Wrapper sits at top-full with NO offset.
        The pt-3 padding IS the invisible bridge between trigger and card.
        pointer-events-none until hovered prevents stray mouse captures.
      */}
      <div
        className={`
          ${ease}
          pointer-events-none
          absolute left-1/2 top-full z-40
          w-28 -translate-x-1/2
          -translate-y-1 opacity-0
          pt-3
          group-hover:pointer-events-auto
          group-hover:translate-y-0
          group-hover:opacity-100
        `}
      >
        <div className={panel}>
          <Link
            href="/en"
            className={`${ease} flex items-center gap-2.5 rounded-lg px-4 py-3 font-mono text-xs font-bold uppercase tracking-[0.16em] text-white/55 hover:bg-white/[0.06] hover:text-white`}
          >
            EN
          </Link>
        </div>
      </div>
    </div>
  );
}

// Bordered nav compartment — fine 1px box, architecturally breathable
function NavCompartment({ href, label }: { href: string; label: string }) {
  return (
    <AnimatedLink
      href={href}
      className={`
        ${ease}
        flex h-full items-center bg-transparent
        px-7 py-3.5
        font-mono text-xs font-semibold uppercase tracking-[0.18em]
        text-white/50
        hover:bg-white/[0.035] hover:text-white
        hover:[text-shadow:0_0_18px_rgba(255,255,255,0.28)]
      `}
    >
      {label}
    </AnimatedLink>
  );
}

// CONTACTOS dropdown — same hover-bridge pattern as LanguageDropdown
function ContactosDropdown() {
  return (
    <div className="group relative flex h-full items-stretch">
      {/* Trigger — sits flush inside the divided compartment strip */}
      <button
        type="button"
        className={`
          ${ease}
          flex h-full items-center bg-transparent
          px-7 py-3.5
          font-mono text-xs font-semibold uppercase tracking-[0.18em]
          text-white/50
          hover:bg-white/[0.035] hover:text-white
          hover:[text-shadow:0_0_18px_rgba(255,255,255,0.28)]
        `}
        aria-haspopup="true"
      >
        CONTACTOS
      </button>

      {/*
        Hover bridge: top-full + pt-4 transparent buffer.
        The dropdown is wider than the trigger so we centre it.
      */}
      <div
        className={`
          ${ease}
          pointer-events-none
          absolute left-1/2 top-full z-40
          w-64 -translate-x-1/2
          -translate-y-1 opacity-0
          pt-4
          group-hover:pointer-events-auto
          group-hover:translate-y-0
          group-hover:opacity-100
        `}
      >
        <div className={`${panel} overflow-hidden`}>
          {contactItems.map((item, idx) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                className={`
                  ${ease}
                  group/item flex items-center gap-3.5
                  px-4 py-3.5
                  hover:bg-white/[0.055]
                  ${idx !== contactItems.length - 1 ? "border-b border-white/[0.07]" : ""}
                `}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
                  <Icon className="h-3.5 w-3.5 text-white/50 group-hover/item:text-white/80" />
                </span>
                <span className="min-w-0">
                  <span className={`${ease} block font-mono text-[0.65rem] font-bold uppercase tracking-[0.16em] text-white/50 group-hover/item:text-white`}>
                    {item.label}
                  </span>
                  <span className="block truncate font-mono text-[0.6rem] text-white/30 group-hover/item:text-white/55">
                    {item.sub}
                  </span>
                </span>
                <ChevronRight
                  className={`${ease} ml-auto h-3.5 w-3.5 shrink-0 text-white/20 group-hover/item:translate-x-0.5 group-hover/item:text-white/50`}
                />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Frosted glass CTA — 30% white, breathable
function GlassCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`${ease} ${cta} ${ctaHover} group inline-flex items-center gap-3 rounded-lg px-5 py-[0.85rem] font-mono text-xs font-bold uppercase tracking-[0.16em] text-white`}
    >
      {children}
      <ChevronRight
        className={`${ease} h-4 w-4 text-white/80 group-hover:translate-x-1 group-hover:text-white`}
      />
    </Link>
  );
}

// ============================================================================
// TYPES
// ============================================================================
type HeroData = {
  kpis?: { year_min?: number; year_max?: number };
};

// ============================================================================
// HERO — Main export
// ============================================================================
export default function Hero({ data }: { data: HeroData }) {
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);
  const yearMin = data.kpis?.year_min ?? 2008;
  const yearMax = data.kpis?.year_max ?? 2024;

  return (
    <main className="relative h-screen overflow-hidden bg-[#05070b] p-3 text-white sm:p-5">
      <section className="relative h-full overflow-hidden rounded-xl border border-white/15 bg-black">

        {/* ── Background video ────────────────────────────────────────────── */}
        <video
          aria-hidden="true"
          autoPlay muted loop playsInline preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src="/media/hero_bg_loop.mp4" type="video/mp4" />
        </video>

        {/* ── Gradient overlay — cinematic bottom-heavy vignette ───────────── */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.08) 30%, rgba(0,0,0,0.62) 72%, rgba(0,0,0,0.92) 100%)",
          }}
        />

        {/* ==================================================================
            NAVIGATION BAR
        =================================================================== */}
        <nav className="relative z-20 grid h-16 grid-cols-[auto_1fr_auto] border-b border-white/15 bg-black/20 backdrop-blur-md sm:h-[72px]">

          {/* Left cell — Brand + Language */}
          <div className={`flex h-full items-stretch border-r border-white/15 ${navShell}`}>
            <AnimatedLink
              href="/"
              className={`${ease} flex h-full items-center px-6 text-sm font-extrabold uppercase tracking-[0.2em] text-white/80 hover:bg-white/[0.04] hover:text-white sm:px-9`}
            >
              PRISMA
            </AnimatedLink>
            <Hairline />
            <LanguageDropdown />
          </div>

          {/* Centre — compartment strip with CONTACTOS dropdown */}
          <div className="hidden h-full items-center justify-center lg:flex">
            {/*
              Single outer border + divide-x = flush 1px hairlines between
              every compartment. ContactosDropdown is injected at the end,
              replacing the former "SOBRE" static link.
            */}
            <div className="flex h-9 items-stretch divide-x divide-white/10 overflow-visible rounded-sm border border-white/10">
              {navItems.map((item) => (
                <NavCompartment key={item.href} href={item.href} label={item.label} />
              ))}
              {/* Contactos gets its own group-hover scope but inherits the border */}
              <div className="border-l border-white/10 first:border-l-0">
                <ContactosDropdown />
              </div>
            </div>
          </div>

          {/* Right cell — Explorar Dados CTA */}
          <div className={`flex h-full items-center justify-end border-l border-white/15 ${navShell} p-2 sm:p-3`}>
            <GlassCta href="/rio">
              <span className="hidden sm:inline">Explorar Dados</span>
              <span className="sm:hidden">Explorar</span>
            </GlassCta>
          </div>
        </nav>

        {/* ==================================================================
            HERO CONTENT — absolute bottom-left anchor
        =================================================================== */}
        <div className="relative z-10 flex h-[calc(100%-4rem)] flex-col sm:h-[calc(100%-72px)]">

          {/* Flex spacer — pushes text block to the bottom */}
          <div className="flex-1" />

          <motion.div
            className="w-full px-6 pb-28 sm:px-10 sm:pb-24 lg:px-16 lg:pb-20"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.14 } } }}
          >
            {/*
              H1 — Cormorant Garamond, weight 500 (medium).
              clamp(3.5rem, 7.5vw, 7.5rem) = monumental at large viewports,
              graceful at mobile.
              whitespace-nowrap locks exactly 2 lines.
              NO hover effects — pure typographic sculpture.
            */}
            <h1
              className={`
                ${cormorant.className}
                text-[clamp(3.5rem,7.5vw,7.5rem)]
                font-medium
                leading-[0.88]
                tracking-tight
                text-[#f7f3eb]
                drop-shadow-[0_24px_80px_rgba(0,0,0,0.82)]
              `}
            >
              <motion.span
                className="block whitespace-nowrap uppercase"
                variants={{
                  hidden: { opacity: 0, y: 32, filter: "blur(12px)" },
                  visible: {
                    opacity: 1, y: 0, filter: "blur(0px)",
                    transition: { duration: 1.0, ease: [0.16, 1, 0.3, 1] },
                  },
                }}
              >
                17 Anos de Emprego
              </motion.span>

              <motion.span
                className="block whitespace-nowrap italic uppercase"
                variants={{
                  hidden: { opacity: 0, y: 32, filter: "blur(12px)" },
                  visible: {
                    opacity: 1, y: 0, filter: "blur(0px)",
                    transition: { duration: 1.0, ease: [0.16, 1, 0.3, 1], delay: 0.12 },
                  },
                }}
              >
                Em Portugal
              </motion.span>
            </h1>

            {/* Editorial sub-copy */}
            <motion.p
              className="mt-8 max-w-[500px] font-mono text-[1.05rem] leading-relaxed text-white/58"
              variants={{
                hidden: { opacity: 0, y: 20 },
                visible: {
                  opacity: 1, y: 0,
                  transition: { duration: 0.85, ease: [0.16, 1, 0.3, 1], delay: 0.1 },
                },
              }}
            >
              Uma radiografia do mercado de trabalho português. Recuperámos mais de 
              20.000 ofertas de emprego de vários portais web através do Arquivo.pt. 
              Quase duas décadas de evolução histórica (2008–2024).
  
            </motion.p>

            {/* Primary CTA */}
            <motion.div
              className="mt-10"
              variants={{
                hidden: { opacity: 0, y: 16 },
                visible: {
                  opacity: 1, y: 0,
                  transition: { duration: 0.75, ease: [0.16, 1, 0.3, 1], delay: 0.16 },
                },
              }}
            >
              <GlassCta href="/rio">Iniciar</GlassCta>
            </motion.div>
          </motion.div>
        </div>

        {/* ── Footer watermark ─────────────────────────────────────────────── */}
        <footer className="pointer-events-none absolute bottom-6 left-1/2 z-10 hidden -translate-x-1/2 font-mono text-[0.58rem] font-bold uppercase tracking-[0.24em] text-white/28 sm:block">
          ARQUIVO.PT — DADOS HISTÓRICOS {yearMin}–{yearMax}
        </footer>

        {/* ── Cassandra chatbot trigger ────────────────────────────────────── */}
        <motion.button
          type="button"
          onClick={() => setIsChatbotOpen((v) => !v)}
          className={`
            ${ease} ${cta} group
            absolute bottom-5 right-5 z-20
            inline-flex items-center gap-3 rounded-full px-4 py-3
            text-white
            hover:bg-white/40 hover:scale-105
            hover:[box-shadow:0_0_34px_rgba(96,165,250,0.22),0_24px_90px_rgba(0,0,0,0.36)]
          `}
          aria-expanded={isChatbotOpen}
          aria-label="Falar com Cassandra"
          whileTap={{ scale: 0.97 }}
        >
          <span className="relative grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10">
            <Sparkles className="absolute h-5 w-5 text-sky-200/60 blur-[0.5px]" />
            <Bot className="relative h-5 w-5 text-white/90" />
          </span>

          <span className="hidden pr-1 sm:inline">
            <motion.span
              className="inline-flex select-none font-mono text-xs font-bold uppercase tracking-[0.12em] text-white"
              whileHover={{ y: -2 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              Falar com Cassandra
            </motion.span>
          </span>

          {/* Live pulse dot */}
          <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.95)]">
            <span className="absolute inset-0 animate-ping rounded-full bg-sky-300" />
          </span>
        </motion.button>

        {/* Chatbot panel */}
        <AnimatePresence>
          {isChatbotOpen && (
            <Chatbot
              embedded
              defaultOpen
              launcherHidden
              onClose={() => setIsChatbotOpen(false)}
            />
          )}
        </AnimatePresence>
      </section>
    </main>
  );
}
