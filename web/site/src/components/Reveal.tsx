"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/** Fades/slides content in the first time it scrolls into view. */
export function Reveal({ children, delay = 0, y = 28 }: { children: ReactNode; delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Icon({ d, size = 24 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  wallet: "M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7zm0 0V6a2 2 0 0 1 2-2h11M17 13.5h.01",
  swap: "M7 7h13l-4-4M17 17H4l4 4",
  bank: "M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 21h18M12 3l9 5H3l9-5z",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zm-3 9 2 2 4-4",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7l1-8z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  apple: "M16 3c-1 1-2 2-2 3 1 0 2-1 3-2M12 7c-2 0-3-1-4-1-3 0-5 3-5 6 0 4 3 9 5 9 1 0 2-1 4-1s3 1 4 1c2 0 4-4 5-6-2-1-3-3-3-5 0-2 1-3 2-4-1-1-3-2-4-2-1 0-3 1-4 1z",
  play: "M5 3l15 9-15 9V3z",
} as const;
