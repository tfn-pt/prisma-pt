"use client";

import { motion } from "framer-motion";

export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.main initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[9998] bg-black"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 0] }}
        transition={{ duration: 0.78, ease: [0.16, 1, 0.3, 1] }}
      />
      {children}
    </motion.main>
  );
}
