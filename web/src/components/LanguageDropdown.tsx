"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const LANGUAGES = [
  { code: "PT", label: "Português" },
];

export default function LanguageDropdown() {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState("PT");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <motion.button
        type="button"
        onClick={() => setOpen((value) => !value)}
        whileTap={{ scale: 0.97 }}
        className="system-control inline-flex h-9 items-center gap-2 px-3 font-mono text-[0.68rem] font-black uppercase tracking-[0.18em]"
        aria-expanded={open}
        aria-label="Selecionar idioma"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={language}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            {language}
          </motion.span>
        </AnimatePresence>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.22 }}>
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        </motion.span>
      </motion.button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="system-panel absolute left-0 top-11 z-50 w-44 overflow-hidden py-1"
          >
            {LANGUAGES.map((lang) => {
              const active = lang.code === language;
              return (
                <button
                  key={lang.code}
                  type="button"
                  onClick={() => {
                    setLanguage(lang.code);
                    setOpen(false);
                  }}
                  className="group relative flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.055]"
                  data-active={active}
                >
                  {active ? <span className="absolute inset-y-1 left-0 w-0.5 bg-amber-300" /> : null}
                  <span className="font-mono text-[0.68rem] font-black tracking-[0.18em] text-zinc-100">
                    {lang.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.68rem] font-semibold tracking-[0.04em] text-zinc-500 group-hover:text-zinc-300">
                    {lang.label}
                  </span>
                  <Check className={`h-3.5 w-3.5 text-amber-300 transition-opacity ${active ? "opacity-100" : "opacity-0"}`} />
                </button>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}