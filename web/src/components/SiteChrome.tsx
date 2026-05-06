"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChevronRight, Mail, GitBranch, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Chatbot from "@/components/Chatbot";

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

const ease = "transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]";
const cta = "border border-white/20 bg-white/30 backdrop-blur-md shadow-[0_20px_60px_rgba(0,0,0,0.22)]";
const ctaHover = "hover:border-white/30 hover:bg-white/40 hover:scale-105 hover:shadow-[0_24px_80px_rgba(255,255,255,0.10)]";
const panel = "rounded-lg border border-white/10 bg-black/75 shadow-[0_28px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl";
const navShell = "bg-white/[0.025] backdrop-blur-md";

function Hairline() {
  return <span className="h-full w-px shrink-0 bg-white/15" aria-hidden="true" />;
}

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

function ContactosDropdown() {
  return (
    <div className="group relative flex h-full items-stretch">
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

export default function SiteChrome() {
  const pathname = usePathname();
  const [isChatbotOpen, setIsChatbotOpen] = useState(false);

  if (pathname === "/") return null;

  return (
    <>
      <header className="fixed left-0 top-0 z-50 w-full border-b border-white/15 bg-black/20 backdrop-blur-md">
        <nav className="mx-auto grid h-16 max-w-7xl grid-cols-[auto_1fr_auto] sm:h-[72px]">
          <div className={`flex h-full items-stretch border-r border-l border-white/15 ${navShell}`}>
            <AnimatedLink
              href="/"
              className={`${ease} flex h-full items-center px-6 text-sm font-extrabold uppercase tracking-[0.2em] text-white/80 hover:bg-white/[0.04] hover:text-white sm:px-9`}
            >
              PRISMA
            </AnimatedLink>
            <Hairline />
            <LanguageDropdown />
          </div>

          <div className="hidden h-full items-center justify-center lg:flex">
            <div className="flex h-9 items-stretch divide-x divide-white/10 overflow-visible rounded-sm border border-white/10">
              {navItems.map((item) => (
                <NavCompartment key={item.href} href={item.href} label={item.label} />
              ))}
              <div className="border-l border-white/10 first:border-l-0">
                <ContactosDropdown />
              </div>
            </div>
          </div>

          <div className={`flex h-full items-center justify-end border-l border-r border-white/15 ${navShell} p-2 sm:p-3`}>
            <GlassCta href="/rio">
              <span className="hidden sm:inline">Explorar Dados</span>
              <span className="sm:hidden">Explorar</span>
            </GlassCta>
          </div>
        </nav>
      </header>

      <motion.button
        type="button"
        onClick={() => setIsChatbotOpen((v) => !v)}
        className={`
          ${ease} ${cta} group
          fixed bottom-5 right-5 z-50
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

        <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.95)]">
          <span className="absolute inset-0 animate-ping rounded-full bg-sky-300" />
        </span>
      </motion.button>

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
    </>
  );
}