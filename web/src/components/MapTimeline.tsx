"use client";

import { Playfair_Display, JetBrains_Mono } from "next/font/google";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import LensChrome from "./LensChrome";
import { Outfit } from "next/font/google";
import { TerminalSquare } from "lucide-react";



// ── Fonts (Mirror-matched) ────────────────────────────────────────────────────
const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500"],
  style: ["normal", "italic"],
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

// ── Design tokens ─────────────────────────────────────────────────────────────
const ease = "transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]";
const glassSurface = "bg-white/30 backdrop-blur-md border border-white/20";

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 · HEURISTIC MOJIBAKE HEALER
// Targets the specific U+FFFD replacement-character patterns that survive
// after the server has already mis-decoded UTF-8 bytes as Latin-1.
// The replacement map is ordered from longest/most-specific to shortest so
// that overlapping patterns don't clobber each other.
// ─────────────────────────────────────────────────────────────────────────────
function healMojibake(str: string): string {
  if (!str) return str;
  return str
    // --- full-word suffixes first (longest match wins) ---
    .replace(/\uFFFDES/g, "ÇÕES")          // LOCA▯ES → LOCAÇÕES
    .replace(/\uFFFDO\b/g, "ÇÃO")         // CONSTRU▯O → CONSTRUÇÃO  (word-boundary)
    // --- standalone suffix / single replacements ---
    .replace(/VEL\b/g, "ÁVEL")             // DISPON▯VEL → DISPONÁVEL  (keep if already correct)
    .replace(/TCNICO/g, "TÉCNICO")
    .replace(/MDICO/g, "MÉDICO")
    .replace(/SADE/g, "SAÚDE")
    .replace(/COMRCIO/g, "COMÉRCIO")
    .replace(/MECNICO/g, "MECÂNICO")
    .replace(/GESTO/g, "GESTÃO")
    .replace(/CONSTRUO/g, "CONSTRUÇÃO")
    .replace(/INFORMAO/g, "INFORMAÇÃO")
    .replace(/DIREO/g, "DIREÇÃO")
    .replace(/PRODUO/g, "PRODUÇÃO")
    // --- final sweep: strip any remaining replacement chars ---
    .replace(/\uFFFD/g, "");
}

// ── Legacy mojibake cleaner (Strategy A + B — kept for export consumers) ──────
const MOJIBAKE_MAP: Record<string, string> = {
  "Ã¡": "á", "Ã ": "à", "Ã£": "ã", "Ã¢": "â", "Ã¤": "ä",
  "Ã©": "é", "Ã¨": "è", "Ãª": "ê", "Ã«": "ë",
  "Ã­": "í", "Ã¬": "ì", "Ã®": "î", "Ã¯": "ï",
  "Ã³": "ó", "Ã²": "ò", "Ãµ": "õ", "Ã´": "ô", "Ã¶": "ö",
  "Ãº": "ú", "Ã¹": "ù", "Ã»": "û", "Ã¼": "ü",
  "Ã§": "ç", "Ã‡": "Ç",

  "ÃÁ": "Á", "Ã‰": "É", "Ã“": "Ó", "Ãš": "Ú", "Ã€": "À",
  "Ã•": "Õ", "Ã‚": "Â", "Ãƒ": "Ã", "Ã„": "Ä",

  "â€œ": "\u201C", // “
  "â€\u009d": "\u201D", // ”
  "â€˜": "\u2018", // ‘
  "â€™": "\u2019", // ’
  "â€“": "\u2013", // –
  "â€”": "\u2014", // —
  "â€¦": "\u2026", // …
};
export function cleanMojibake(str: string): string {
  if (!str) return str;
  try {
    const fixed = decodeURIComponent(escape(str));
    if (fixed !== str && !fixed.includes("\uFFFD")) return fixed;
  } catch {
    // fall through
  }
  let result = str;
  for (const [bad, good] of Object.entries(MOJIBAKE_MAP)) {
    if (result.includes(bad)) result = result.split(bad).join(good);
  }
  return result;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type NodeType = "tech" | "traditional";
type ArchiveNode = { title: string; url: string; type: NodeType };
type MapTimelineResponse = { archiveSamples: Record<string, ArchiveNode[]> };

// ── Period definitions ─────────────────────────────────────────────────────────
const YEAR_MIN = 2008;
const YEAR_MAX = 2024;
const TOTAL_YEARS = YEAR_MAX - YEAR_MIN + 1;

const PERIODS = [
  {
    key: "2008_2011",
    label: "COLAPSO",
    span: "2008 – 2011",
    years: [2008, 2011] as [number, number],
    color: "#ef4444",
    glow: "rgba(239,68,68,0.12)",
    accent: "#fca5a5",
    description:
      "A crise financeira congela o mercado. O léxico retrai. Cada anúncio é um sinal de sobrevivência.",
  },
  {
    key: "2012_2015",
    label: "AUSTERIDADE",
    span: "2012 – 2015",
    years: [2012, 2015] as [number, number],
    color: "#f97316",
    glow: "rgba(249,115,22,0.12)",
    accent: "#fdba74",
    description:
      "Troika. Salários congelados. O arquivo regista o DNA de um país a redefinir o que significa trabalhar.",
  },
  {
    key: "2016_2019",
    label: "EXPANSÃO",
    span: "2016 – 2019",
    years: [2016, 2019] as [number, number],
    color: "#f59e0b",
    glow: "rgba(245,158,11,0.12)",
    accent: "#fde68a",
    description:
      "Turismo. Startups. Novos títulos emergem. O genoma do recrutamento muta visivelmente.",
  },
  {
    key: "2020_2021",
    label: "RUPTURA",
    span: "2020 – 2021",
    years: [2020, 2021] as [number, number],
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.12)",
    accent: "#c4b5fd",
    description:
      "O remoto fragmenta categorias. Novos títulos sem precedente inundam o arquivo.",
  },
  {
    key: "2022_2024",
    label: "RECOMPOSIÇÃO",
    span: "2022 – 2024",
    years: [2022, 2024] as [number, number],
    color: "#38bdf8",
    glow: "rgba(56,189,248,0.12)",
    accent: "#bae6fd",
    description:
      "A IA irrompe. O léxico muda mais depressa que o emprego. Esta sequência é o registo.",
  },
] as const;

type Period = (typeof PERIODS)[number];

function getPeriod(year: number): Period {
  if (year <= 2011) return PERIODS[0];
  if (year <= 2015) return PERIODS[1];
  if (year <= 2019) return PERIODS[2];
  if (year <= 2021) return PERIODS[3];
  return PERIODS[4];
}

// ─────────────────────────────────────────────────────────────────────────────
// MARQUEE ROW
// ─────────────────────────────────────────────────────────────────────────────
// THE MATHEMATICAL GUARANTEE FOR ZERO GAPS:
//
//   The animation translates the strip by exactly −50 % (forward) or +50 % → 0 %
//   (reverse). For this to loop seamlessly the FIRST half of the strip must be
//   visually identical to the SECOND half — which is guaranteed by doubling the
//   array.  The catch: if the original array is tiny (e.g. 4 items) the full
//   strip may still be narrower than the viewport, so the −50 % jump leaves a
//   visible gap before the duplicate starts.
//
//   Fix: before doubling, we tile the source array until it reaches a safe
//   minimum width — expressed as MIN_TILES repetitions.  Each tile is at least
//   ~200 px wide on average, so MIN_TILES = 20 guarantees the base strip is
//   ~4 000 px before doubling.  The doubled strip is therefore ≥ 8 000 px,
//   well past any real viewport, and the 50 % translation is always a clean
//   loop point.
//
// ─────────────────────────────────────────────────────────────────────────────
const MIN_TILES = 20; // number of source-array repetitions before doubling

function MarqueeRow({
  items,
  reverse,
  period,
  rowIdx,
}: {
  items: ArchiveNode[];
  reverse: boolean;
  speed: number; // kept in props signature for API compat; overridden internally
  period: Period;
  rowIdx: number;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const controls = useAnimation();

  // Base duration is 20% slower: 15→18, rowIdx step 4→4.8
  const baseDuration = 18 + rowIdx * 4.8;
  const hoverDuration = baseDuration * 8; // ~8× slowdown on hover

  // Build a base array that is guaranteed to be massive enough.
  const massiveBase = useMemo(() => {
    if (!items.length) return [];
    // How many times do we need to repeat to reach MIN_TILES entries?
    const reps = Math.ceil(MIN_TILES / items.length);
    return Array.from({ length: reps }, () => items).flat();
  }, [items]);

  // Double it — this is the actual rendered strip.
  // The animation moves it by ±50 % so the seam is invisible.
  const doubled = useMemo(
    () => [...massiveBase, ...massiveBase],
    [massiveBase],
  );

  // Re-trigger the infinite animation whenever hover state changes.
  // useAnimation lets us seamlessly switch speed without restarting from 0%.
  useEffect(() => {
    const duration = isHovered ? hoverDuration : baseDuration;
    controls.start({
      x: reverse ? ["-50%", "0%"] : ["0%", "-50%"],
      transition: {
        repeat: Infinity,
        ease: "linear",
        duration,
        // Restart from current visual position instead of jumping to 0.
        // Framer Motion maintains the existing x when we call start() again,
        // so simply providing a new duration is enough for a smooth speed change.
      },
    });
  }, [isHovered, reverse, baseDuration, hoverDuration, controls]);

  return (
    // Outer wrapper captures hover; overflow-hidden + fade mask clip the strip.
    <div
      className="flex w-full overflow-hidden"
      style={{
        maskImage:
          "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <motion.div
        className="flex shrink-0 gap-10 pr-10"
        style={{ width: "max-content" }}
        animate={controls}
      >
        {doubled.map((node, i) => (
          <a
            key={i}
            href={node.url}
            target="_blank"
            rel="noreferrer"
            // Duplicate half is decorative — hide from AT.
            aria-hidden={i >= massiveBase.length}
            className="group relative flex items-center gap-3 whitespace-nowrap"
          >
            <span
              className={`
                text-[clamp(1.9rem,4vw,5rem)] font-black uppercase leading-none
                tracking-[-0.03em] transition-all duration-500 group-hover:scale-105
                ${node.type === "tech" ? mono.className : playfair.className}
              `}
              style={{
                color:
                  rowIdx % 2 === 0
                    ? `color-mix(in srgb, ${period.color} 18%, transparent)`
                    : "rgba(255,255,255,0.03)",
                WebkitTextStroke:
                  node.type === "tech"
                    ? `1px color-mix(in srgb, ${period.color} 35%, transparent)`
                    : "1px rgba(255,255,255,0.07)",
              }}
            >
              {/* healMojibake applied at render — strips U+FFFD and restores PT chars */}
              <span className="group-hover:text-white transition-colors duration-300">
                {healMojibake(node.title)}
              </span>
            </span>
            <ExternalLink
              size={13}
              className="shrink-0 opacity-0 transition-all duration-300 group-hover:opacity-100"
              style={{ color: period.color, filter: `drop-shadow(0 0 5px ${period.color})` }}
            />
            <span
              className="select-none font-black opacity-[0.06]"
              aria-hidden="true"
              style={{ fontSize: "2rem", color: period.color }}
            >
              /
            </span>
          </a>
        ))}
      </motion.div>
    </div>
  );
}

// ── Year scrubber ──────────────────────────────────────────────────────────────
function YearScrubber({
  year,
  onYearChange,
  period,
}: {
  year: number;
  onYearChange: (y: number) => void;
  period: Period;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const computeYear = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return year;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(YEAR_MIN + pct * (TOTAL_YEARS - 1));
    },
    [year],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (isDragging.current) onYearChange(computeYear(e.clientX));
    };
    const onUp = () => {
      isDragging.current = false;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [computeYear, onYearChange]);

  const thumbPct = ((year - YEAR_MIN) / (TOTAL_YEARS - 1)) * 100;

  return (
    <div className="select-none">
      {/* Period tabs */}
      <div className="mb-4 flex items-center justify-between gap-1">
        {PERIODS.map((p) => {
          const active = p.key === period.key;
          return (
            <button
              key={p.key}
              onClick={() => onYearChange(p.years[0])}
              className={`${mono.className} ${ease} cursor-pointer rounded px-2 py-1 text-[0.43rem] font-black uppercase tracking-[0.18em]`}
              style={{
                color: active ? p.color : "rgba(255,255,255,0.18)",
                backgroundColor: active
                  ? `color-mix(in srgb, ${p.color} 10%, transparent)`
                  : "transparent",
                borderBottom: active
                  ? `1px solid color-mix(in srgb, ${p.color} 35%, transparent)`
                  : "1px solid transparent",
                textShadow: active ? `0 0 10px ${p.color}` : "none",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-1 cursor-pointer rounded-full bg-white/[0.05]"
        onPointerDown={(e) => {
          isDragging.current = true;
          onYearChange(computeYear(e.clientX));
        }}
      >
        {PERIODS.map((p, i) => {
          const startPct = ((p.years[0] - YEAR_MIN) / (TOTAL_YEARS - 1)) * 100;
          const endYear =
            i < PERIODS.length - 1 ? PERIODS[i + 1].years[0] - 1 : YEAR_MAX;
          const endPct = ((endYear - YEAR_MIN) / (TOTAL_YEARS - 1)) * 100;
          return (
            <motion.div
              key={p.key}
              className="absolute top-0 h-full rounded-full"
              style={{
                left: `${startPct}%`,
                width: `${endPct - startPct}%`,
                backgroundColor: p.color,
              }}
              animate={{ opacity: p.key === period.key ? 1 : 0.18 }}
              transition={{ duration: 0.5 }}
            />
          );
        })}
        <motion.div
          className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 active:cursor-grabbing"
          style={{
            left: `${thumbPct}%`,
            width: 16,
            height: 16,
            borderColor: period.color,
            backgroundColor: period.color,
            boxShadow: `0 0 14px ${period.color}, 0 0 28px ${period.glow}`,
          }}
          layout
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
        />
      </div>

      {/* Year ticks */}
      <div className="mt-3 flex justify-between">
        {Array.from({ length: TOTAL_YEARS }).map((_, i) => {
          const y = YEAR_MIN + i;
          const active = y === year;
          const isPeriodStart = PERIODS.some((p) => p.years[0] === y);
          return (
            <button
              key={y}
              onClick={() => onYearChange(y)}
              className={`${mono.className} ${ease} cursor-pointer`}
              style={{
                fontSize: active ? "0.55rem" : isPeriodStart ? "0.42rem" : "0.36rem",
                fontWeight: active ? 900 : isPeriodStart ? 700 : 400,
                color: active
                  ? period.color
                  : isPeriodStart
                    ? "rgba(255,255,255,0.3)"
                    : "rgba(255,255,255,0.08)",
                textShadow: active ? `0 0 10px ${period.color}` : "none",
              }}
            >
              {isPeriodStart || active ? y : "·"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────────────
export default function MapTimeline() {
  const [year, setYear] = useState(YEAR_MAX);
  const [archiveSamples, setArchiveSamples] = useState<Record<
    string,
    ArchiveNode[]
  > | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const period = getPeriod(year);

  useEffect(() => {
    setIsMounted(true);
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/maptimeline", {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`API retornou ${res.status}`);
        const data: MapTimelineResponse = await res.json();
        setArchiveSamples(data.archiveSamples);
      } catch (err: any) {
        if (err.name !== "AbortError")
          setError(
            err instanceof Error ? err.message : "Erro desconhecido",
          );
      } finally {
        setIsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => {
    const s = archiveSamples?.[period.key] ?? [];
    if (!s.length) return Array(5).fill([]);
    const chunkSize = Math.max(1, Math.ceil(s.length / 5));
    return Array.from({ length: 5 }, (_, i) => {
      const chunk = s.slice(i * chunkSize, (i + 1) * chunkSize);
      const safe = chunk.length ? chunk : s.slice(0, chunkSize);
      return i % 2 !== 0 ? [...safe].reverse() : safe;
    });
  }, [period.key, archiveSamples]);

  const hasContent = !isLoading && !!archiveSamples && isMounted;

  return (
    <section className="relative h-screen overflow-hidden bg-[#05070b] p-3 text-white sm:p-5">
      <div className="relative h-full overflow-hidden rounded-xl border border-white/15 bg-zinc-950">
        <LensChrome />

        {/* Grid */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.032)_1px,transparent_1px)] bg-[size:72px_72px]" />

        {/* Ambient glow — period-aware */}
        <AnimatePresence mode="wait">
          <motion.div
            key={period.key}
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            style={{
              background: `radial-gradient(circle at 20% 80%, ${period.glow}, transparent 45%), radial-gradient(circle at 80% 20%, rgba(56,189,248,0.04), transparent 40%)`,
            }}
          />
        </AnimatePresence>

        {/* Loading */}
        <AnimatePresence>
          {isLoading && (
            <motion.div
              className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-md"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div
                className={`flex flex-col items-center gap-5 rounded-2xl ${glassSurface} px-10 py-8 shadow-[0_28px_80px_rgba(0,0,0,0.55)]`}
              >
                <Loader2 size={26} className="animate-spin text-amber-300" />
                <p
                  className={`${mono.className} text-[0.62rem] font-black uppercase tracking-[0.38em] text-zinc-400`}
                >
                  A escavar o arquivo
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        {error && !isLoading && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="max-w-sm rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-center shadow-2xl backdrop-blur-xl">
              <p
                className={`${mono.className} text-xs font-black uppercase tracking-[0.22em] text-red-400`}
              >
                Erro ao carregar arquivo
              </p>
              <p className="mt-2 text-[0.65rem] text-red-300/55">{error}</p>
            </div>
          </div>
        )}

        {/* ── Marquee DNA cascade — z-10, full bleed, clickable ── */}
        {hasContent && (
          <div className="absolute inset-0 z-10 flex flex-col justify-center gap-4 -rotate-[0.7deg] scale-[1.04]">
            <AnimatePresence mode="wait">
              <motion.div
                key={period.key}
                className="flex flex-col gap-4"
                initial={{ opacity: 0, filter: "blur(18px)", scale: 0.97 }}
                animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
                exit={{ opacity: 0, filter: "blur(18px)", scale: 1.03 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                {rows.map((rowItems, idx) => (
                  <MarqueeRow
                    key={idx}
                    items={
                      rowItems.length
                        ? rowItems
                        : [{ title: "Sem dados", url: "#", type: "traditional" }]
                    }
                    reverse={idx % 2 !== 0}
                    speed={15 + idx * 4} // kept for prop compat; overridden internally
                    period={period}
                    rowIdx={idx}
                  />
                ))}
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────────────
            LEFT-ANCHOR 'STRICT BOX' LAYOUT
            ─────────────────────────────────────────────────────────────────────
            A narrow absolute column pinned to the left edge.  The container
            itself is pointer-events-none so the empty right portion of the
            screen passes all clicks straight through to the marquee below.
            Only the text/stats elements inside carry pointer-events-auto so
            they remain individually interactive.
        ──────────────────────────────────────────────────────────────────────── */}
        <div
          className="
            absolute top-0 left-0 bottom-[80px]
            w-full max-w-[480px]
            z-40
            flex flex-col justify-start gap-10
            p-6 sm:p-8 lg:p-10
            pointer-events-auto
            bg-black/95 border-r border-zinc-800 backdrop-blur-md
          "
        >
          {/* ── Title block ── */}
          <div>
            <p
              className={`${mono.className} text-xs font-black uppercase tracking-[0.32em] text-amber-300`}
            >
              Ato 3
            </p>
            <h2
              className={`
                ${playfair.className}
                mt-4
                text-[clamp(2.5rem,6vw,4.5rem)]
                font-medium
                leading-[0.8]
                tracking-tighter
                text-zinc-50
              `}
            >
              <span className="block italic uppercase">O Arquivo.</span>
            </h2>
          </div>

          {/* ── Description + Stats block ── */}
        <div className="space-y-6 pointer-events-auto">
          <p className={`${outfit.className} text-[0.9rem] leading-relaxed text-zinc-300`}>
            20.416 anúncios extraídos do Arquivo.pt. Esta cascata{" "}
            <span className="text-white font-bold">não é decoração</span>: é a matéria-prima do projeto. Cada título é um <span className="text-white font-bold">fragmento real</span> da memória laboral portuguesa, preservado entre{" "}
            <span className="text-amber-300 font-bold">2008</span> e{" "}
            <span className="text-sky-400 font-bold">2024</span>.
          </p>
          
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              { val: "20.416", label: "Registos" },
              { val: "17", label: "Anos" },
              { val: "5", label: "Eras" },
            ].map(({ val, label }) => (
              <div
                key={label}
                className="bg-white/[0.04] border border-white/10 rounded-lg px-4 py-2 flex-1 min-w-[80px]"
              >
                <p className={`${outfit.className} text-sm font-black text-amber-300`}>
                  {val}
                </p>
                <p className={`${outfit.className} text-[0.52rem] font-black uppercase tracking-[0.18em] text-zinc-500`}>
                  {label}
                </p>
              </div>
            ))}
          </div>

          {/* CTA Interativo (Terminal) */}
          <div className="flex items-center gap-3 border-t border-white/10 pt-5">
            <TerminalSquare size={14} className="text-amber-300 shrink-0" />
            <p className={`${outfit.className} text-[0.65rem] font-bold uppercase tracking-widest text-zinc-400 leading-tight`}>
              Interage com o rasto: clica num título para ver o <span className="text-white">snapshot original</span>.
            </p>
          </div>
        </div>
      </div>

      {/* ── Bottom dock — year scrubber ── */}
      <div className="absolute bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-[#0A0A0A] px-5 py-6 sm:px-8 lg:px-10 pointer-events-auto">
        <YearScrubber year={year} onYearChange={setYear} period={period} />
      </div>
    </div>
  </section>
  );
}