"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useState } from "react";

export default function CustomCursor() {
  const [pressed, setPressed] = useState(false);
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);
  const x = useSpring(cursorX, { stiffness: 360, damping: 32, mass: 0.35 });
  const y = useSpring(cursorY, { stiffness: 360, damping: 32, mass: 0.35 });

  useEffect(() => {
    function move(event: PointerEvent) {
      cursorX.set(event.clientX - 16);
      cursorY.set(event.clientY - 16);
    }

    function down() {
      setPressed(true);
    }

    function up() {
      setPressed(false);
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, [cursorX, cursorY]);

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[9999] hidden h-8 w-8 rounded-full bg-white md:block"
      style={{
        x,
        y,
        mixBlendMode: "difference",
      }}
      animate={{ scale: pressed ? 0.72 : 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    />
  );
}
