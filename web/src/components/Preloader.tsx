"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

const preloaderLines = [
  "> Querying Arquivo.pt...",
  "> Extracting 2008-2024...",
  "> 20,416 records recovered.",
];

export default function Preloader() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="fixed inset-0 z-[10000] grid place-items-center bg-black text-white"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: "blur(10px)" }}
          transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="w-[min(34rem,calc(100vw-3rem))] font-mono text-xs font-black uppercase tracking-[0.22em] text-white/80 sm:text-sm">
            {preloaderLines.map((line, index) => (
              <motion.p
                key={line}
                className="overflow-hidden whitespace-nowrap border-r border-white/50 py-1"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: "100%", opacity: 1 }}
                transition={{
                  delay: index * 0.56,
                  duration: 0.46,
                  ease: [0.16, 1, 0.3, 1],
                }}
              >
                {line}
              </motion.p>
            ))}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
