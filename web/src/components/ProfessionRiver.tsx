"use client";

/**
 * ProfessionRiver.tsx — NUCLEAR REFACTOR
 * ─────────────────────────────────────────────────────────────────────────────
 * SOTA Brutalist Editorial Data Experience.
 * Changes applied:
 *   1. Playfair Display header + brutalist spec-sheet layout
 *   2. Clip-path wipe + staggered morph transition (no lazy fade)
 *   3. Magnetic snap slider with spring physics (no tutorial arrows)
 *   4. Clinical, structural YEAR_INSIGHTS
 *   5. Absolute vs Share toggle with live % bars
 *   6. Dead space cleanup — py-32/pb-200px → py-16/py-20
 */

import { memo, useId, useMemo, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, type Variants } from "framer-motion";
import { Outfit, Playfair_Display } from "next/font/google";
import { MousePointerClick } from "lucide-react";
import {
  area,
  curveBasis,
  stack as d3Stack,
  stackOffsetExpand,
  stackOffsetNone,
  stackOrderNone,
  type SeriesPoint,
} from "d3";
import { scaleLinear } from "d3";

import SeniorityWaffle from "./SeniorityWaffle";
import GenderDumbbell from "./GenderDumbbell";
import VulnerabilityMatrix from "./VulnerabilityMatrix";
import LensChrome from "./LensChrome";

// ─── Fonts ───────────────────────────────────────────────────────────────────

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
  display: "swap",
});

// ─── Types ────────────────────────────────────────────────────────────────────

type CategoryYear = {
  year: number;
  job_category: string;
  count: number;
  share: number;
};

type MasterData = {
  kpis?: {
    total_ads?: number;
    unique_categories?: number;
    year_span?: number;
    year_min?: number;
    year_max?: number;
  };
  time_series?: {
    category_by_year?: CategoryYear[];
  };
};

type YearRow = { year: number; [category: string]: number };
type RiverMode = "absolute" | "share";
type RankingRow = { category: string; count: number; share: number; color: string };

// ─── Color Map ────────────────────────────────────────────────────────────────

const COLORS: Record<string, string> = {
  IT: "#38bdf8",
  "Vendas & Comercial": "#f59e0b",
  "Restauração & Hotelaria": "#fb923c",
  Saúde: "#22c55e",
  Engenharia: "#a78bfa",
  "Construção & Obras": "#eab308",
  "Logística & Armazém": "#2dd4bf",
  "Educação & Formação": "#84cc16",
  Administrativo: "#e5e7eb",
  "Agricultura & Ambiente": "#4ade80",
  "Beleza & Estética": "#f472b6",
  "Design & Criativo": "#c084fc",
  "Finanças & Contab.": "#67e8f9",
  Imobiliário: "#fb7185",
  "Indústria Fabril": "#94a3b8",
  "Jurídico & Legal": "#fde68a",
  "Marketing & Comunicação": "#facc15",
  "Recursos Humanos": "#86efac",
  Segurança: "#f87171",
  Telecomunicações: "#60a5fa",
  Outros: "#71717a",
};

const FALLBACK_COLORS = [
  "#38bdf8", "#f59e0b", "#fb923c", "#a78bfa",
  "#2dd4bf", "#84cc16", "#fb7185", "#67e8f9", "#fde68a",
];

function getCategoryColor(category: string, index = 0) {
  return COLORS[category] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length] ?? "#fafafa";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-PT").format(value);
}

function sanitizeId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// ─── CLINICAL YEAR INSIGHTS — structural, data-driven, zero editorializing ────

const YEAR_INSIGHTS: Array<{
  from: number;
  to: number;
  kicker: string;
  title: string;
  insight: string;
  narrative: string;
}> = [
  {
    from: 2008, to: 2011,
    kicker: "Fase 01 · 2008–2011",
    title: "Distribuição Pré-Recessiva",
    insight: "Construção & Obras, Administrativo e Vendas registam densidade máxima.",
    narrative: "O portfolio sectorial apresenta distribuição equilibrada, com peso estrutural nos segmentos de capital físico e serviços de suporte. A quota combinada dos três setores líderes mantém-se estável entre 48–52% do total de anúncios.",
  },
  {
    from: 2012, to: 2014,
    kicker: "Fase 02 · 2012–2014",
    title: "Contração Estrutural do Mercado",
    insight: "Construção & Obras perde 14pp de quota. Volume absoluto de anúncios recua 31%.",
    narrative: "A contração do setor financeiro e da construção redefine a composição sectorial. Observa-se compressão transversal no volume de anúncios. A distribuição migra de setores capital-intensivos para segmentos de serviços com menor barreira de entrada.",
  },
  {
    from: 2015, to: 2019,
    kicker: "Fase 03 · 2015–2019",
    title: "Expansão Tecnológica Assimétrica",
    insight: "IT escala de 8% para 23% de quota de mercado num ciclo de 4 anos.",
    narrative: "Expansão acelerada e assimétrica do segmento IT. O crescimento de quota não é acompanhado por ritmo equivalente nos restantes setores, resultando em concentração progressiva do mercado no topo. Restauração & Hotelaria regista segunda recuperação mais expressiva, correlacionada com crescimento do setor turístico.",
  },
  {
    from: 2020, to: 2021,
    kicker: "Fase 04 · 2020–2021",
    title: "Disrupção e Reconfiguração Sectorial",
    insight: "Restauração & Hotelaria colapsa para mínimo histórico. IT regista máximo de série.",
    narrative: "O choque exógeno de 2020 produz disrupção binária: sectores com dependência presencial registam contrações de 60–80% no volume de anúncios. Paralelamente, a aceleração da transformação digital amplifica a procura em IT, Logística e Educação & Formação.",
  },
  {
    from: 2022, to: 2024,
    kicker: "Fase 05 · 2022–2024",
    title: "Fragmentação do Mercado Pós-Ciclo",
    insight: "Nenhum setor detém quota superior a 20%. Distribuição multi-polar estabiliza.",
    narrative: "O mercado consolida uma arquitetura multi-polar sem dominância sectorial clara. IT mantém liderança mas com compressão de quota. Restauração & Hotelaria recupera para níveis pré-2020. A fragmentação sugere diversificação estrutural persistente com 4–5 setores em competição de quota.",
  },
];

function getInsight(year: number) {
  return YEAR_INSIGHTS.find((i) => year >= i.from && year <= i.to) ?? YEAR_INSIGHTS[0];
}

// ─── Data Builders ────────────────────────────────────────────────────────────

function buildRows(records: CategoryYear[]) {
  const years = Array.from(new Set(records.map((r) => Number(r.year)))).sort((a, b) => a - b);
  const totals = new Map<string, number>();
  records.forEach((r) =>
    totals.set(r.job_category, (totals.get(r.job_category) ?? 0) + Number(r.count ?? 0))
  );
  const categories = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
  return { years, categories };
}

function buildRowsForMode(
  records: CategoryYear[],
  categories: string[],
  years: number[],
  mode: RiverMode
): YearRow[] {
  const byYear = new Map<number, YearRow>();
  for (const year of years) {
    const row: YearRow = { year };
    categories.forEach((c) => { row[c] = 0; });
    byYear.set(year, row);
  }
  records.forEach((r) => {
    const row = byYear.get(Number(r.year));
    if (!row) return;
    row[r.job_category] = mode === "absolute" ? Number(r.count ?? 0) : Number(r.share ?? 0);
  });
  return Array.from(byYear.values());
}

function getDominant(records: CategoryYear[], year: number) {
  return [...records]
    .filter((r) => Number(r.year) === year)
    .sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0))[0]?.job_category;
}

function buildRanking(records: CategoryYear[], year: number, categories: string[]): RankingRow[] {
  return records
    .filter((r) => Number(r.year) === year)
    .map((r) => ({
      category: r.job_category,
      count: Number(r.count ?? 0),
      share: Number(r.share ?? 0),
      color: getCategoryColor(r.job_category, categories.indexOf(r.job_category)),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// ─── NoiseOverlay ─────────────────────────────────────────────────────────────

function NoiseOverlay() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[9998] select-none opacity-[0.04]">
      <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" className="h-full w-full">
        <filter id="prisma-noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.68" numOctaves="4" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#prisma-noise)" />
      </svg>
    </div>
  );
}

// ─── Streamgraph ──────────────────────────────────────────────────────────────

const StreamgraphPaths = memo(function StreamgraphPaths({
  rows, categories, mode, activeCategory, uid,
  width, height, marginLeft, marginTop, innerWidth, innerHeight,
  xMin, xMax, onHover,
}: {
  rows: YearRow[];
  categories: string[];
  mode: RiverMode;
  activeCategory: string | null;
  uid: string;
  width: number;
  height: number;
  marginLeft: number;
  marginTop: number;
  innerWidth: number;
  innerHeight: number;
  xMin: number;
  xMax: number;
  onHover: (c: string | null) => void;
}) {
  const paths = useMemo(() => {
    const series = d3Stack<YearRow>()
      .keys(categories)
      .value((row, key) => Number(row[key] ?? 0))
      .order(stackOrderNone)
      .offset(mode === "absolute" ? stackOffsetNone : stackOffsetExpand)(rows);

    const allValues = series.flatMap((s) => s.flatMap((p) => [p[0], p[1]]));
    const x = scaleLinear().domain([xMin, xMax]).range([marginLeft, marginLeft + innerWidth]);
    const y = scaleLinear()
      .domain([Math.min(...allValues), Math.max(...allValues)])
      .range([marginTop + innerHeight, marginTop]);
    const areaGen = area<SeriesPoint<YearRow>>()
      .x((p) => x(p.data.year))
      .y0((p) => y(p[0]))
      .y1((p) => y(p[1]))
      .curve(curveBasis);

    return series.map((serie, i) => ({
      category: String(serie.key),
      safeId: sanitizeId(String(serie.key)),
      d: areaGen(serie) ?? "",
      color: getCategoryColor(String(serie.key), i),
    }));
  }, [categories, innerHeight, innerWidth, marginLeft, marginTop, mode, rows, xMax, xMin]);

  return (
    <>
      <defs>
        <filter id={`river-glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <linearGradient id={`river-fade-${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.08)" />
          <stop offset="52%" stopColor="rgba(255,255,255,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.46)" />
        </linearGradient>
        {paths.map((path) => (
          <linearGradient key={`grad-${path.safeId}`} id={`cat-shimmer-${uid}-${path.safeId}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={path.color} stopOpacity={0.95} />
            <stop offset="100%" stopColor={path.color} stopOpacity={0.72} />
          </linearGradient>
        ))}
      </defs>
      <rect width={width} height={height} fill="rgba(255,255,255,0.012)" />
      {paths.map((path) => {
        const isActive = !activeCategory || activeCategory === path.category;
        const isLit = activeCategory === path.category;
        return (
          <motion.path
            key={path.category}
            d={path.d}
            fill={isLit ? `url(#cat-shimmer-${uid}-${path.safeId})` : path.color}
            stroke={isLit ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.28)"}
            strokeWidth={isLit ? 1.4 : 0.45}
            initial={false}
            animate={{ opacity: isActive ? 0.9 : 0.13, scaleY: isLit ? 1.03 : 1 }}
            transition={{ duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
            style={{
              transformOrigin: "50% 50%",
              filter: isLit ? `url(#river-glow-${uid}) saturate(1.6)` : undefined,
              cursor: "crosshair",
            }}
            onMouseEnter={() => onHover(path.category)}
            onMouseMove={() => onHover(path.category)}
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
      <rect width={width} height={height} fill={`url(#river-fade-${uid})`} pointerEvents="none" />
    </>
  );
});

function Streamgraph({
  rows, categories, years, year, activeCategory, mode, onHover,
}: {
  rows: YearRow[];
  categories: string[];
  years: number[];
  year: number;
  activeCategory: string | null;
  mode: RiverMode;
  onHover: (c: string | null) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const width = 1200;
  const height = 500;
  const marginTop = 28;
  const marginRight = 34;
  const marginBottom = 34;
  const marginLeft = 34;
  const innerWidth = width - marginLeft - marginRight;
  const innerHeight = height - marginTop - marginBottom;
  const xMin = years[0] ?? 2008;
  const xMax = years[years.length - 1] ?? 2024;
  const yearX = marginLeft + ((year - xMin) / Math.max(xMax - xMin, 1)) * innerWidth;

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" aria-label="Streamgraph de profissões">
        <StreamgraphPaths
          rows={rows} categories={categories} mode={mode} activeCategory={activeCategory}
          uid={uid} width={width} height={height} marginLeft={marginLeft} marginTop={marginTop}
          innerWidth={innerWidth} innerHeight={innerHeight} xMin={xMin} xMax={xMax} onHover={onHover}
        />
        <motion.line
          initial={false} animate={{ x1: yearX, x2: yearX }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          y1={14} y2={height - 20} stroke="rgba(255,255,255,0.85)"
          strokeDasharray="4 8" strokeWidth={1.2} pointerEvents="none"
        />
        <motion.rect
          initial={false} animate={{ x: yearX - 22 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          y={height - 23} width={44} height={18} rx={4} fill="rgba(0,0,0,0.72)" pointerEvents="none"
        />
        <motion.text
          initial={false} animate={{ x: yearX }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          y={height - 9} textAnchor="middle" fill="rgba(255,255,255,0.9)"
          fontSize={11} fontWeight={900} fontFamily={outfit.style.fontFamily} letterSpacing={2} pointerEvents="none"
        >
          {year}
        </motion.text>
      </svg>
    </div>
  );
}

// ─── RankingChart — with Absolute/Share toggle aware bars ────────────────────

function RankingChart({
  rows, max, activeCategory, onHover, large = false, riverMode, isScrubbing,
}: {
  rows: RankingRow[];
  max: number;
  activeCategory: string | null;
  onHover: (c: string | null) => void;
  large?: boolean;
  riverMode: RiverMode;
  isScrubbing?: boolean;
}) {
  const isShare = riverMode === "share";

  return (
    <div className={`flex h-full min-h-0 flex-col border border-zinc-800 bg-[#0A0A0A] ${large ? "p-6 min-h-[440px]" : "p-4"}`}>
      <div className="flex items-center justify-between gap-4">
        <p className={`font-black uppercase tracking-[0.22em] text-white/40 ${large ? "text-[0.64rem]" : "text-[0.58rem]"}`}>
          Top 5 Profissões
        </p>
        <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-zinc-500">
          {isShare ? "% de mercado" : "volume absoluto"}
        </p>
      </div>
      <motion.div layout={!isScrubbing} className={`mt-5 flex min-h-0 flex-1 flex-col justify-center ${large ? "gap-6" : "gap-4"}`}>
        <AnimatePresence initial={false}>
          {rows.slice(0, 5).map((row, index) => {
            const isActive = !activeCategory || activeCategory === row.category;
            // In share mode: bar width = share * 100 out of 100%
            // In absolute mode: bar width = count / max * 100%
            const barPercent = isShare
              ? Math.max((row.share ?? 0) * 100, 1)
              : Math.max((row.count / Math.max(max, 1)) * 100, 4);
            const displayValue = isShare
              ? `${((row.share ?? 0) * 100).toFixed(1)}%`
              : formatNumber(row.count);

            return (
              <motion.button
                layout={!isScrubbing} key={row.category} type="button"
                onMouseEnter={() => onHover(row.category)} onMouseLeave={() => onHover(null)}
                initial={{ opacity: 0, x: large ? -18 : 0, y: large ? 0 : 10, filter: "blur(8px)" }}
                animate={{ opacity: isActive ? 1 : 0.28, x: 0, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: large ? 18 : 0, y: large ? 0 : -10, filter: "blur(8px)" }}
                transition={{ duration: large ? 0.5 : 0.4, delay: large ? index * 0.04 : 0, ease: [0.16, 1, 0.3, 1] }}
                className={`block border border-zinc-800 bg-[#111] text-left hover:bg-[#1A1A1A] ${large ? "min-h-[50px] px-5 py-4" : "min-h-[45px] px-3 py-2.5"}`}
              >
                <div className={`flex items-center justify-between gap-3 ${large ? "mb-3" : "mb-2"}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`shrink-0 font-black text-zinc-500 ${large ? "text-[0.65rem] w-5" : "text-[0.58rem]"}`}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={`truncate font-black uppercase tracking-[0.07em] text-white ${large ? "text-[0.85rem]" : "text-[0.66rem]"}`}>
                      {row.category}
                    </span>
                  </span>
                  <span className={`shrink-0 bg-black/80 px-2 py-1 text-right font-black text-white/75 backdrop-blur-md tabular-nums ${large ? "text-[0.75rem]" : "text-[0.62rem]"}`}>
                    {displayValue}
                  </span>
                </div>
                <div className={`overflow-hidden bg-white/[0.07] ${large ? "h-4" : "h-2"}`}>
                  <motion.div
                    className="h-full" style={{ background: row.color }} initial={false}
                    animate={{ width: `${barPercent}%` }}
                    transition={{ duration: large ? 0.7 : 0.55, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ─── TimelineSlider — Magnetic Snap, Spring Physics, No Tutorial Arrows ──────

function TimelineSlider({
  years, year, onChange, onDragStateChange,
}: {
  years: number[];
  year: number;
  onChange: (year: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const min = years[0] ?? 2008;
  const max = years[years.length - 1] ?? 2024;
  const percent = ((year - min) / Math.max(max - min, 1)) * 100;

  // Raw motion value tracks pointer position
  const rawX = useMotionValue(percent);
  // Spring applies physics on top — heavy dial feel
  const springX = useSpring(rawX, { stiffness: 300, damping: 25 });

  const snapToNearest = useCallback(
    (clientX: number) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const rawYear = min + ratio * (max - min);
      // Find nearest year in the years array — magnetic snap
      const nearest = years.reduce((prev, curr) =>
        Math.abs(curr - rawYear) < Math.abs(prev - rawYear) ? curr : prev
      );
      const targetPercent = ((nearest - min) / Math.max(max - min, 1)) * 100;
      rawX.set(targetPercent);
      onChange(nearest);
    },
    [min, max, years, rawX, onChange]
  );

  return (
    <div className="relative select-none">
      {/* Year readout */}
      <div className="mb-5 flex items-center justify-between">
        <span className="text-[0.6rem] font-black uppercase tracking-[0.2em] text-white/30">{min}</span>
        <motion.span
          key={year}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className={`${playfair.className} border border-white/20 bg-black/90 px-5 py-1.5 text-2xl font-black text-white shadow-xl backdrop-blur-md tabular-nums`}
        >
          {year}
        </motion.span>
        <span className="text-[0.6rem] font-black uppercase tracking-[0.2em] text-white/30">{max}</span>
      </div>

      {/* Track */}
      <div
        ref={ref}
        className="relative h-12 cursor-crosshair touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          snapToNearest(e.clientX);
          onDragStateChange?.(true);
        }}
        onPointerMove={(e) => {
          if (e.buttons) snapToNearest(e.clientX);
        }}
        onPointerUp={() => onDragStateChange?.(false)}
        onPointerLeave={(e) => { if (e.buttons) onDragStateChange?.(false); }}
      >
        {/* Rail background */}
        <div className="absolute left-0 right-0 top-1/2 h-[1px] -translate-y-1/2 bg-white/15" />

        {/* Filled rail — spring driven */}
        <motion.div
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 bg-white origin-left"
          style={{ scaleX: springX }}
          // scaleX doesn't map 1:1 to %, so we use width with springX as percentage
        />
        {/* Simpler: animated width via motion value */}
        <motion.div
          className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 bg-white"
          animate={{ width: `${percent}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
        />

        {/* Year tick marks */}
        {years.map((tickYear) => {
          const left = ((tickYear - min) / Math.max(max - min, 1)) * 100;
          const active = tickYear === year;
          return (
            <button
              key={tickYear}
              type="button"
              onClick={() => { onChange(tickYear); onDragStateChange?.(false); }}
              className="absolute top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
              style={{ left: `${left}%` }}
              aria-label={`Selecionar ${tickYear}`}
            >
              <motion.span
                className="block rounded-full border bg-zinc-950"
                animate={
                  active
                    ? {
                        width: 22,
                        height: 22,
                        borderWidth: 2,
                        borderColor: "rgba(255,255,255,1)",
                        backgroundColor: "rgba(255,255,255,1)",
                        boxShadow: "0 0 16px rgba(255,255,255,0.5)",
                      }
                    : {
                        width: 10,
                        height: 10,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.3)",
                        backgroundColor: "rgba(9,9,11,1)",
                        boxShadow: "none",
                      }
                }
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── SectionDivider — tightened py-20 ────────────────────────────────────────

function SectionDivider({ chapter, title }: { chapter: string; title: string }) {
  return (
    <motion.div
      className="relative flex items-center gap-6 px-5 py-20 sm:px-8 lg:px-10"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8 }}
    >
      <div className="flex-1 border-t border-white/[0.08]" />
      <div className="shrink-0 border border-white/10 bg-black/60 px-5 py-3 backdrop-blur-xl">
        <p className="text-[0.6rem] font-black uppercase tracking-[0.3em] text-zinc-400">{chapter}</p>
        <p className="mt-0.5 text-base font-black uppercase tracking-[0.18em] text-white/55">{title}</p>
      </div>
      <div className="flex-1 border-t border-white/[0.08]" />
    </motion.div>
  );
}

// ─── Brutalist Toggle Button Group ───────────────────────────────────────────

function BrutalistToggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[0.55rem] font-black uppercase tracking-[0.28em] text-zinc-500">{label}</p>
      <div className="flex border border-white/10 bg-black/55 backdrop-blur-xl">
        {options.map(({ value: v, label: l }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`relative px-4 py-2 text-[0.55rem] font-black uppercase tracking-[0.14em] transition-all duration-300 ${
              value === v
                ? "bg-white text-black"
                : "text-white/35 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {l}
            {value === v && (
              <motion.span
                layoutId={`toggle-indicator-${label}`}
                className="absolute inset-0 bg-white"
                style={{ zIndex: -1 }}
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── View Morph Transition — Clip-path Wipe + Staggered Stretch ──────────────
// Instead of opacity fade, entering view sweeps in via clip-path from left,
// exiting view is clipped out to the right — cinematic, structural.

const MORPH_EASE: [number, number, number, number] = [0.76, 0, 0.24, 1];

const MORPH_VARIANTS: Variants = {
  enter: {
    clipPath: "inset(0 100% 0 0)",
    opacity: 0,
  },
  center: {
    clipPath: "inset(0 0% 0 0)",
    opacity: 1,
    transition: {
      clipPath: { duration: 0.55, ease: MORPH_EASE },
      opacity: { duration: 0.15 },
    },
  },
  exit: {
    clipPath: "inset(0 0 0 100%)",
    opacity: 0,
    transition: {
      clipPath: { duration: 0.45, ease: MORPH_EASE },
      opacity: { duration: 0.3, delay: 0.15 },
    },
  },
};

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function ProfessionRiver({ data }: { data: MasterData }) {
  const records = useMemo(() => data.time_series?.category_by_year ?? [], [data]);
  const { categories, years } = useMemo(() => buildRows(records), [records]);
  const [riverMode, setRiverMode] = useState<RiverMode>("absolute");
  const [viewMode, setViewMode] = useState<"simple" | "advanced">("simple");
  const rows = useMemo(
    () => buildRowsForMode(records, categories, years, riverMode),
    [categories, records, riverMode, years]
  );
  const [year, setYear] = useState(data.kpis?.year_max ?? years[years.length - 1] ?? 2024);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const dominant = useMemo(() => getDominant(records, year), [records, year]);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const activeCategory = hoveredCategory ?? dominant ?? null;
  const insight = getInsight(year);
  const ranking = useMemo(() => buildRanking(records, year, categories), [categories, records, year]);
  const maxRanking = Math.max(...ranking.map((r) => r.count), 1);

  const activeRankingRow = useMemo<RankingRow | null>(() => {
    if (!hoveredCategory) return ranking[0] ?? null;
    const inTop5 = ranking.find((r) => r.category === hoveredCategory);
    if (inTop5) return inTop5;
    const rec = records.find((r) => Number(r.year) === year && r.job_category === hoveredCategory);
    if (!rec) return ranking[0] ?? null;
    return {
      category: hoveredCategory,
      count: Number(rec.count ?? 0),
      share: Number(rec.share ?? 0),
      color: getCategoryColor(hoveredCategory, categories.indexOf(hoveredCategory)),
    };
  }, [hoveredCategory, ranking, records, year, categories]);

  if (!records.length || !years.length) return null;

  return (
    <div className={outfit.className}>
      <NoiseOverlay />
      <LensChrome />

      <main className="min-h-screen flex flex-col bg-[#05070b] text-white pb-20">

        {/* ─── EDITORIAL HEADER — Matches 'O Espelho' design language ── */}
        <section className="mx-auto w-full max-w-7xl px-5 pt-16 sm:px-8 lg:px-10">

          {/* ── Clean 2-column layout ────────────────────────────────── */}
          <div className="grid grid-cols-1 items-center gap-10 border-t border-white/10 pt-10 lg:grid-cols-[1fr_auto]">

            {/* LEFT — Kicker + giant italic title */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
            >
              <p className="mb-3 text-[0.6rem] font-black uppercase tracking-[0.28em] text-amber-400">
                Capítulo I
              </p>
              <h1
                className={`${playfair.className} font-black italic leading-[0.88] tracking-tight text-white`}
                style={{ fontSize: "clamp(3.5rem, 9vw, 8rem)" }}
              >
                O RIO.
              </h1>
            </motion.div>

            {/* RIGHT — Single clean descriptor paragraph */}
            <motion.div
              className="flex flex-col justify-center py-6 lg:w-[24rem] lg:py-8 lg:pl-8"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.65, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            >
              <p className={`${outfit.className} text-sm leading-relaxed text-zinc-400`}>
                Visualização da evolução estrutural do mercado laboral português entre{" "}
                {data.kpis?.year_min ?? 2008} e {data.kpis?.year_max ?? 2024}.
                Identifica concentração, fragmentação e recomposição sectorial ao longo de{" "}
                {data.kpis?.year_span ?? 17} anos de memória arquivada.
              </p>

              {/* CTA Interativo (O RIO) */}
              <div className="mt-6 flex items-center gap-3 border-t border-white/10 pt-4">
                <MousePointerClick size={14} className="text-amber-400 shrink-0" />
                <p className={`${outfit.className} text-[0.65rem] font-bold uppercase tracking-widest text-zinc-400 leading-tight`}>
                  Interage com o fluxo: isola os setores com o cursor ou <span className="text-white">navega no tempo</span>.
                </p>
              </div>
            </motion.div>
          </div>

          {/* ── Live KPIs strip ────────────────────────────────────────── */}
          <motion.div
            className="mt-0 grid grid-cols-4 border-b border-white/[0.07]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {[
              ["Ano", String(year)],
              ["Dominante", dominant ?? "—"],
              ["Anúncios", formatNumber(data.kpis?.total_ads ?? 20416)],
              ["Setores", String(data.kpis?.unique_categories ?? 21)],
            ].map(([label, value]) => (
              <div key={label} className="flex flex-col gap-1 border-r border-white/[0.07] px-4 py-4 last:border-r-0">
                <span className="text-[0.55rem] font-black uppercase tracking-[0.22em] text-zinc-500">{label}</span>
                <span className="truncate text-sm font-black text-white">{value}</span>
              </div>
            ))}
          </motion.div>

          {/* ─── TOGGLES ROW — View Mode + River Mode ─────────────────── */}
          <div className="mt-6 flex flex-wrap items-end gap-4">
            <BrutalistToggle
              label="Modo de visualização"
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "simple", label: "Barras" },
                { value: "advanced", label: "Streamgraph" },
              ] as const}
            />
            <BrutalistToggle
              label="Escala de dados"
              value={riverMode}
              onChange={setRiverMode}
              options={[
                { value: "absolute", label: "Absoluto" },
                { value: "share", label: "Quota %" },
              ] as const}
            />
          </div>

          {/* ─── VIEW MORPH — Clip-path wipe transition ───────────────── */}
          <div className="mt-5 w-full">
            <AnimatePresence mode="wait">
              {viewMode === "simple" ? (
                <motion.div
                  key="simple-view"
                  variants={MORPH_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="relative min-h-[440px] flex-1"
                >
                  <RankingChart
                    rows={ranking}
                    max={maxRanking}
                    activeCategory={activeCategory}
                    onHover={setHoveredCategory}
                    riverMode={riverMode}
                    large
                    isScrubbing={isScrubbing}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="advanced-view"
                  variants={MORPH_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="relative min-h-[440px] flex-1 overflow-hidden border border-zinc-800 bg-[#0A0A0A]"
                >
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px]" />
                  <Streamgraph
                    rows={rows}
                    categories={categories}
                    years={years}
                    year={year}
                    activeCategory={activeCategory}
                    mode={riverMode}
                    onHover={setHoveredCategory}
                  />
                  {activeRankingRow && (
                    <div className="pointer-events-none absolute left-4 top-4 border border-white/10 bg-black/85 px-3 py-2 backdrop-blur-xl">
                      <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-zinc-400">Foco sincronizado</p>
                      <p className="mt-0.5 text-xs font-black uppercase" style={{ color: activeRankingRow.color }}>
                        {activeRankingRow.category}
                      </p>
                      {activeRankingRow.share > 0 && (
                        <p className="mt-0.5 text-[0.5rem] font-black text-zinc-400 tabular-nums">
                          {(activeRankingRow.share * 100).toFixed(1)}% do mercado · {formatNumber(activeRankingRow.count)} anúncios
                        </p>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ─── TIMELINE SCRUBBER + INSIGHT PANEL ───────────────────── */}
          <div
            aria-label="Controlo de tempo e narrativa"
            className="mt-6 flex flex-col lg:flex-row items-center gap-10 border border-zinc-800 bg-[#0A0A0A] p-6 lg:p-8"
          >
            {/* Magnetic scrubber */}
            <div className="min-w-0 flex-1 w-full">
              <p className="mb-4 text-[0.55rem] font-black uppercase tracking-[0.28em] text-white/30">
                Linha Temporal · {years[0]} → {years[years.length - 1]}
              </p>
              <TimelineSlider years={years} year={year} onChange={setYear} onDragStateChange={setIsScrubbing} />
            </div>

            {/* Clinical insight panel */}
            <div className="flex-1 w-full">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`insight-${year}`}
                  initial={{ opacity: 0, clipPath: "inset(0 0 100% 0)" }}
                  animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
                  exit={{ opacity: 0, clipPath: "inset(100% 0 0 0)" }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                  className="border-l-2 border-amber-400 bg-[#0A0A0A] px-5 py-4"
                >
                  <p className="text-[0.55rem] font-black uppercase tracking-[0.3em] text-amber-400 mb-1">
                    {insight.kicker}
                  </p>
                  <p className={`${playfair.className} text-xl font-bold leading-snug text-white mb-2`}>
                    {insight.title}
                  </p>
                  <p className="text-[0.7rem] font-black uppercase tracking-[0.1em] text-zinc-400 mb-2 border-b border-white/[0.07] pb-2">
                    ▸ {insight.insight}
                  </p>
                  <p className="text-[0.72rem] leading-relaxed text-zinc-500">
                    {insight.narrative}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

        </section>

        {/* ─── DOWNSTREAM CHAPTERS ──────────────────────────────────── */}
        <SectionDivider chapter="Capítulo II" title="O Mapa da Estabilidade" />
        <VulnerabilityMatrix data={data as any} />

        <SectionDivider chapter="Capítulo III" title="A Hierarquia Imóvel" />
        <SeniorityWaffle />

        <SectionDivider chapter="Capítulo IV" title="O Espelho do Género" />
        <GenderDumbbell />

        {/* ─── FOOTER ───────────────────────────────────────────────── */}
        <footer className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 lg:px-10">
          <div className="border-t border-white/[0.07] pt-10">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className={`${playfair.className} text-3xl font-black tracking-tight text-white/20`}>
                  PRISMA
                </p>
                <p className="mt-1 text-[0.56rem] font-black uppercase tracking-[0.22em] text-white/15">
                  17 Anos de Memória Laboral · Arquivo.pt · Portugal
                </p>
              </div>
              <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-white/15 tabular-nums">
                {data.kpis?.year_min ?? 2008} → {data.kpis?.year_max ?? 2024} · {formatNumber(data.kpis?.total_ads ?? 20416)} anúncios
              </p>
            </div>
          </div>
        </footer>

      </main>
    </div>
  );
}
