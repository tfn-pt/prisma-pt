"use client";

import { Bebas_Neue, DM_Mono } from "next/font/google";
import { useEffect, useRef, useState } from "react";

const bebas = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas",
});
const mono = DM_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
});

// ─── Period config ─────────────────────────────────────────────────────────
const PERIODS: Record<string, { label: string; color: string; dim: string }> = {
  pre_crisis_baseline_2008_2011:   { label: "Pré-Crise",     color: "#60a5fa", dim: "rgba(96,165,250,0.07)"  },
  recovery_2012_2015:             { label: "Recuperação",   color: "#34d399", dim: "rgba(52,211,153,0.07)"  },
  pre_pandemic_2016_2019:         { label: "Expansão",      color: "#fbbf24", dim: "rgba(251,191,36,0.07)"  },
  pandemic_remote_shock_2020_2021:{ label: "Pandemia",      color: "#f87171", dim: "rgba(248,113,113,0.07)" },
  post_pandemic_2022_2024:        { label: "Pós-Pandemia",  color: "#a78bfa", dim: "rgba(167,139,250,0.07)" },
};

// ─── Intersection-observer hook ────────────────────────────────────────────
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

// ─── Animated counter ──────────────────────────────────────────────────────
function CountUp({
  target,
  decimals = 0,
  duration = 1800,
  active = true,
}: {
  target: number;
  decimals?: number;
  duration?: number;
  active?: boolean;
}) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    let startTime: number | null = null;
    const tick = (ts: number) => {
      if (!startTime) startTime = ts;
      const p = Math.min((ts - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(parseFloat((ease * target).toFixed(decimals)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration, decimals, active]);
  return (
    <>
      {decimals > 0
        ? val.toFixed(decimals).replace(".", ",")
        : val.toLocaleString("pt-PT")}
    </>
  );
}

// ─── SVG Sparkline ─────────────────────────────────────────────────────────
function Sparkline({
  values,
  color,
  width = 320,
  height = 80,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pad = height * 0.1;

  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: height - pad - ((v - min) / range) * (height - 2 * pad),
  }));

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#sg)" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Peak dot */}
      {(() => {
        const peakIdx = values.indexOf(max);
        const p = pts[peakIdx];
        return <circle cx={p.x} cy={p.y} r="3" fill={color} />;
      })()}
    </svg>
  );
}

// ─── SVG Arc (gender donut) ────────────────────────────────────────────────
function ArcRing({
  value,
  max = 100,
  color,
  size = 200,
  strokeWidth = 6,
}: {
  value: number;
  max?: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}) {
  const r = (size - strokeWidth * 2) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (value / max) * circ;
  const center = size / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      {/* Track */}
      <circle cx={center} cy={center} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeWidth} />
      {/* Fill */}
      <circle
        cx={center} cy={center} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 2s cubic-bezier(0.34,1.56,0.64,1) 0.2s" }}
      />
      {/* Inner tick marks */}
      {[0, 25, 50, 75].map((pct) => {
        const angle = ((pct / 100) * 360 - 90) * (Math.PI / 180);
        const rx = center + (r - strokeWidth * 1.8) * Math.cos(angle);
        const ry = center + (r - strokeWidth * 1.8) * Math.sin(angle);
        return (
          <circle key={pct} cx={rx} cy={ry} r={1} fill="rgba(255,255,255,0.12)" />
        );
      })}
    </svg>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function Hero({ data }: { data: any }) {
  const [mounted, setMounted] = useState(false);
  const [barsIn, setBarsIn] = useState(false);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  const [heroRef, heroInView]     = useInView(0.01);
  const [statsRef, statsInView]   = useInView(0.1);
  const [chartRef, chartInView]   = useInView(0.1);
  const [genderRef, genderInView] = useInView(0.1);
  const [catsRef, catsInView]     = useInView(0.1);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!chartInView) return;
    const t = setTimeout(() => setBarsIn(true), 150);
    return () => clearTimeout(t);
  }, [chartInView]);

  const kpis = data.kpis;
  const yearlyVolume: { year: number; records: number; period: string }[] = data.time_series.yearly_volume;
  const maxBar = Math.max(...yearlyVolume.map((y) => y.records));

  // Category aggregation
  const catTotals: Record<string, number> = {};
  (data.time_series.category_by_year ?? []).forEach((e: any) => {
    catTotals[e.job_category] = (catTotals[e.job_category] || 0) + e.count;
  });
  const topCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCat = topCats[0]?.[1] ?? 1;

  const sparseYears = new Set<number>(
    (data.data_quality.sparse_years ?? [])
      .filter((y: any) => y.flag === "sparse_archive")
      .map((y: any) => y.year as number)
  );

  const periods: { period: string; start_year: number; end_year: number; records: number }[] =
    data.metadata.periods;
  const maxPeriodRecords = Math.max(...periods.map((p) => p.records));

  const genderRate = kpis.gender_marker_rate * 100;
  const sparkValues = yearlyVolume.map((y) => y.records);

  // Marquee facts
  const facts = [
    `${kpis.total_ads.toLocaleString("pt-PT")} anúncios arquivados`,
    `${kpis.year_span} anos de dados · ${kpis.year_min}–${kpis.year_max}`,
    `Pico em ${kpis.peak_year} · ${kpis.peak_year_count.toLocaleString("pt-PT")} anúncios`,
    `${kpis.unique_locations} localizações distintas`,
    `${genderRate.toFixed(1).replace(".", ",")}% com marcador de género`,
    "Fonte: Arquivo.pt",
    "Mercado de Trabalho Português",
  ];

  return (
    <div
      className={`${bebas.variable} ${mono.variable}`}
      style={{ minHeight: "100vh", background: "#080809", color: "#f0efe8", overflowX: "hidden" }}
    >
      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1 · HERO VIEWPORT
      ═══════════════════════════════════════════════════════════════════ */}
      <section
        ref={heroRef}
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          paddingTop: "72px", // clear fixed header
        }}
      >
        <div
          style={{
            flex: 1,
            maxWidth: "1280px",
            width: "100%",
            margin: "0 auto",
            padding: "60px 40px 0",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Eyebrow — period colour strip + label */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "16px",
              marginBottom: "48px",
              opacity: mounted ? 1 : 0,
              transform: mounted ? "none" : "translateY(8px)",
              transition: "opacity 0.7s ease, transform 0.7s ease",
            }}
          >
            <div style={{ display: "flex", gap: "3px" }}>
              {Object.values(PERIODS).map((cfg) => (
                <div
                  key={cfg.label}
                  style={{
                    width: "28px",
                    height: "3px",
                    background: cfg.color,
                    borderRadius: "2px",
                  }}
                />
              ))}
            </div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "9px",
                letterSpacing: "0.2em",
                color: "#3c3c46",
                textTransform: "uppercase",
              }}
            >
              Análise Histórica · {kpis.year_min}–{kpis.year_max} · Arquivo.pt
            </span>
          </div>

          {/* Main grid: headline + sparkline widget */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 380px",
              gap: "60px",
              alignItems: "start",
              flex: 1,
            }}
          >
            {/* Left: headline */}
            <div
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? "none" : "translateY(20px)",
                transition: "opacity 0.9s ease 0.1s, transform 0.9s ease 0.1s",
              }}
            >
              <h1
                style={{
                  fontFamily: "var(--font-bebas)",
                  fontSize: "clamp(80px, 11.5vw, 160px)",
                  lineHeight: "0.875",
                  letterSpacing: "0.01em",
                  margin: "0 0 40px",
                  color: "#f0efe8",
                }}
              >
                <span style={{ display: "block", color: "#fbbf24" }}>{kpis.year_span} Anos</span>
                <span style={{ display: "block" }}>do Emprego</span>
                <span style={{ display: "block", WebkitTextStroke: "1px rgba(240,239,232,0.2)", color: "transparent" }}>
                  em Portugal
                </span>
              </h1>

              <p
                style={{
                  maxWidth: "480px",
                  fontSize: "15px",
                  lineHeight: "1.8",
                  color: "#5a5a64",
                  fontWeight: 400,
                  marginBottom: "48px",
                }}
              >
                Uma radiografia do mercado de trabalho português através dos arquivos da web — desde a crise financeira de 2008, passando pela expansão pré-pandémica e o choque de 2020, até à nova realidade de 2024.
              </p>

              {/* CTA row */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                <a
                  href="/rio"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "10px",
                    background: "#fbbf24",
                    color: "#080809",
                    padding: "15px 32px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  Explorar O Rio →
                </a>
                <a
                  href="/espelho"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "10px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#6a6a74",
                    padding: "15px 32px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                  }}
                >
                  O Espelho
                </a>
                <a
                  href="/estatisticas"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "10px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#6a6a74",
                    padding: "15px 32px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                  }}
                >
                  O Arquivo
                </a>
              </div>
            </div>

            {/* Right: sparkline widget */}
            <div
              style={{
                opacity: mounted ? 1 : 0,
                transform: mounted ? "none" : "translateY(16px)",
                transition: "opacity 0.9s ease 0.3s, transform 0.9s ease 0.3s",
                display: "flex",
                flexDirection: "column",
                gap: "0",
              }}
            >
              {/* Big number */}
              <div
                style={{
                  background: "#0e0e10",
                  border: "1px solid rgba(255,255,255,0.06)",
                  padding: "32px 28px 20px",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "8px",
                    letterSpacing: "0.18em",
                    color: "#3c3c46",
                    textTransform: "uppercase",
                    marginBottom: "10px",
                  }}
                >
                  Total arquivado
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-bebas)",
                    fontSize: "clamp(48px, 6vw, 80px)",
                    lineHeight: "1",
                    color: "#fbbf24",
                    letterSpacing: "0.01em",
                  }}
                >
                  {mounted ? (
                    <CountUp target={kpis.total_ads} duration={2200} active={heroInView} />
                  ) : (
                    "—"
                  )}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "8px",
                    letterSpacing: "0.12em",
                    color: "#2a2a34",
                    textTransform: "uppercase",
                    marginTop: "6px",
                  }}
                >
                  anúncios de emprego
                </div>
              </div>

              {/* Sparkline panel */}
              <div
                style={{
                  background: "#0e0e10",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderTop: "none",
                  padding: "20px 28px 24px",
                }}
              >
                <Sparkline values={sparkValues} color="#fbbf24" height={80} />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontFamily: "var(--font-mono)",
                    fontSize: "7px",
                    letterSpacing: "0.12em",
                    color: "#2a2a34",
                    textTransform: "uppercase",
                    marginTop: "8px",
                  }}
                >
                  <span>{kpis.year_min}</span>
                  <span>Anúncios / Ano</span>
                  <span>{kpis.year_max}</span>
                </div>
              </div>

              {/* Mini stat row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "1px",
                  background: "rgba(255,255,255,0.05)",
                  marginTop: "1px",
                }}
              >
                {[
                  { label: `Pico ${kpis.peak_year}`, value: kpis.peak_year_count, color: "#fbbf24" },
                  { label: "Localizações", value: kpis.unique_locations, color: "#60a5fa" },
                ].map((s, i) => (
                  <div key={i} style={{ background: "#0e0e10", padding: "20px 20px" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-bebas)",
                        fontSize: "28px",
                        lineHeight: "1",
                        color: s.color,
                        letterSpacing: "0.01em",
                      }}
                    >
                      {mounted ? (
                        <CountUp target={s.value} duration={1800 + i * 200} active={heroInView} />
                      ) : (
                        "—"
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "7px",
                        letterSpacing: "0.14em",
                        color: "#2a2a34",
                        textTransform: "uppercase",
                        marginTop: "6px",
                      }}
                    >
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Marquee ticker */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.05)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            overflow: "hidden",
            marginTop: "60px",
          }}
        >
          <div style={{ display: "flex", animation: "marquee 40s linear infinite", whiteSpace: "nowrap" }}>
            {[...facts, ...facts, ...facts].map((f, i) => (
              <span
                key={i}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "8px",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "#2a2a34",
                  padding: "13px 36px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "36px",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: "4px",
                    height: "4px",
                    borderRadius: "50%",
                    background: "#fbbf24",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2 · KPI STRIP
      ═══════════════════════════════════════════════════════════════════ */}
      <section ref={statsRef} style={{ maxWidth: "1280px", margin: "0 auto", padding: "100px 40px 0" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "1px",
            background: "rgba(255,255,255,0.05)",
          }}
        >
          {(
            [
              { label: "Anúncios Arquivados", value: kpis.total_ads, decimals: 0, suffix: "", color: "#f0efe8", sub: `${kpis.year_min}–${kpis.year_max}` },
              { label: `Ano de Pico`, value: kpis.peak_year_count, decimals: 0, suffix: "", color: "#fbbf24", sub: String(kpis.peak_year) },
              { label: "Localizações Únicas", value: kpis.unique_locations, decimals: 0, suffix: "", color: "#60a5fa", sub: "todo o país" },
              { label: "Marcador de Género", value: genderRate, decimals: 1, suffix: "%", color: "#f87171", sub: "1 em cada 3" },
            ] as const
          ).map((kpi, i) => (
            <div
              key={i}
              style={{
                background: "#0c0c0e",
                padding: "44px 36px",
                opacity: statsInView ? 1 : 0,
                transform: statsInView ? "none" : "translateY(12px)",
                transition: `opacity 0.7s ease ${i * 0.1}s, transform 0.7s ease ${i * 0.1}s`,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-bebas)",
                  fontSize: "clamp(48px, 5.5vw, 72px)",
                  lineHeight: "1",
                  color: kpi.color,
                  letterSpacing: "0.01em",
                }}
              >
                {mounted && statsInView ? (
                  <CountUp target={kpi.value} decimals={kpi.decimals} duration={1600 + i * 250} active />
                ) : (
                  "—"
                )}
                {kpi.suffix}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "8px",
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "#3a3a44",
                  marginTop: "12px",
                }}
              >
                {kpi.label}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "8px",
                  color: "#222228",
                  marginTop: "4px",
                  letterSpacing: "0.1em",
                }}
              >
                {kpi.sub}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 3 · BAR CHART
      ═══════════════════════════════════════════════════════════════════ */}
      <section ref={chartRef} style={{ maxWidth: "1280px", margin: "100px auto 0", padding: "0 40px" }}>
        {/* Section header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginBottom: "36px",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "8px",
                letterSpacing: "0.22em",
                color: "#fbbf24",
                textTransform: "uppercase",
                marginBottom: "12px",
              }}
            >
              Volume temporal
            </div>
            <h2
              style={{
                fontFamily: "var(--font-bebas)",
                fontSize: "clamp(32px, 4.5vw, 56px)",
                lineHeight: "1",
                margin: 0,
                color: "#f0efe8",
                letterSpacing: "0.01em",
              }}
            >
              Anúncios por Ano · {kpis.year_min}–{kpis.year_max}
            </h2>
          </div>

          {/* Legend */}
          <div style={{ display: "flex", gap: "18px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {Object.values(PERIODS).map((cfg) => (
              <span
                key={cfg.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "7px",
                  letterSpacing: "0.12em",
                  color: cfg.color,
                  textTransform: "uppercase",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "2px",
                    background: cfg.color,
                    display: "inline-block",
                  }}
                />
                {cfg.label}
              </span>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div style={{ position: "relative" }}>
          {/* Y-axis lines */}
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <div
              key={frac}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `calc(${frac * 100}%)`,
                borderTop: "1px dashed rgba(255,255,255,0.04)",
                pointerEvents: "none",
                zIndex: 1,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  right: 0,
                  top: "-14px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "7px",
                  color: "#2a2a34",
                  letterSpacing: "0.08em",
                }}
              >
                {Math.round(maxBar * frac).toLocaleString("pt-PT")}
              </span>
            </div>
          ))}

          {/* Bars container */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              height: "300px",
              gap: "4px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
              position: "relative",
            }}
          >
            {yearlyVolume.map((y, i) => {
              const cfg = PERIODS[y.period];
              const pct = (y.records / maxBar) * 100;
              const isSparse = sparseYears.has(y.year);
              const isPeak = y.year === kpis.peak_year;
              const isHovered = hoveredBar === i;

              return (
                <div
                  key={y.year}
                  onMouseEnter={() => setHoveredBar(i)}
                  onMouseLeave={() => setHoveredBar(null)}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    height: "100%",
                    position: "relative",
                    cursor: "default",
                  }}
                >
                  {/* Tooltip */}
                  {isHovered && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 10px)",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "#18181a",
                        border: `1px solid ${cfg?.color ?? "#333"}`,
                        padding: "10px 14px",
                        whiteSpace: "nowrap",
                        zIndex: 10,
                        pointerEvents: "none",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-bebas)",
                          fontSize: "22px",
                          color: cfg?.color ?? "#fff",
                          lineHeight: "1",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {y.records.toLocaleString("pt-PT")}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "7px",
                          color: "#4a4a54",
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          marginTop: "3px",
                        }}
                      >
                        {y.year} · {cfg?.label ?? ""}
                      </div>
                    </div>
                  )}

                  {/* Peak flag */}
                  {isPeak && barsIn && !isHovered && (
                    <div
                      style={{
                        position: "absolute",
                        top: "-24px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "7px",
                        color: "#fbbf24",
                        whiteSpace: "nowrap",
                        textAlign: "center",
                        animation: "fadeUp 0.5s ease both 0.8s",
                      }}
                    >
                      ↑ pico
                    </div>
                  )}

                  {/* Bar */}
                  <div
                    style={{
                      width: "100%",
                      height: barsIn ? `${pct}%` : "0%",
                      background: cfg?.color ?? "#555",
                      opacity: isSparse ? 0.2 : isHovered ? 1 : 0.72,
                      transition: `height 0.85s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.03}s, opacity 0.2s`,
                      position: "relative",
                    }}
                  >
                    {isPeak && (
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          right: 0,
                          height: "2px",
                          background: "#fff",
                          opacity: 0.5,
                        }}
                      />
                    )}
                  </div>

                  {/* Year label */}
                  <span
                    style={{
                      position: "absolute",
                      bottom: "-22px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "7px",
                      color: isHovered ? cfg?.color ?? "#fff" : "#252530",
                      transform: "rotate(-45deg)",
                      transformOrigin: "50% 0",
                      whiteSpace: "nowrap",
                      transition: "color 0.2s",
                    }}
                  >
                    {y.year}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "7px",
            color: "#1e1e28",
            marginTop: "44px",
            textAlign: "right",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Barras translúcidas · arquivo escasso (cobertura reduzida)
        </p>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 4 · CATEGORIES + GENDER
      ═══════════════════════════════════════════════════════════════════ */}
      <section style={{ maxWidth: "1280px", margin: "100px auto 0", padding: "0 40px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "3fr 2fr",
            gap: "1px",
            background: "rgba(255,255,255,0.05)",
          }}
        >
          {/* Categories panel */}
          <div ref={catsRef} style={{ background: "#0c0c0e", padding: "56px 48px" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "8px",
                letterSpacing: "0.22em",
                color: "#fbbf24",
                textTransform: "uppercase",
                marginBottom: "10px",
              }}
            >
              Sectores em destaque
            </div>
            <h3
              style={{
                fontFamily: "var(--font-bebas)",
                fontSize: "clamp(28px, 3.5vw, 44px)",
                lineHeight: "1",
                color: "#f0efe8",
                letterSpacing: "0.01em",
                margin: "0 0 44px",
              }}
            >
              Top Categorias · 2008–2024
            </h3>

            {topCats.map(([cat, count], i) => {
              const pct = (count / maxCat) * 100;
              const isTop = i === 0;
              return (
                <div
                  key={cat}
                  style={{
                    marginBottom: "24px",
                    opacity: catsInView ? 1 : 0,
                    transform: catsInView ? "none" : "translateX(-8px)",
                    transition: `opacity 0.6s ease ${i * 0.08}s, transform 0.6s ease ${i * 0.08}s`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginBottom: "9px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: "14px" }}>
                      <span
                        style={{
                          fontFamily: "var(--font-bebas)",
                          fontSize: "16px",
                          color: isTop ? "#fbbf24" : "#222230",
                          letterSpacing: "0.02em",
                          lineHeight: "1",
                          minWidth: "22px",
                        }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        style={{
                          fontSize: "13px",
                          color: isTop ? "#e8e8e0" : "#6a6a74",
                          fontWeight: isTop ? 500 : 400,
                          lineHeight: "1.3",
                        }}
                      >
                        {cat}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "9px",
                        color: isTop ? "#fbbf24" : "#2e2e38",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {count.toLocaleString("pt-PT")}
                    </span>
                  </div>
                  <div
                    style={{
                      height: "2px",
                      background: "rgba(255,255,255,0.04)",
                      borderRadius: "1px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: catsInView ? `${pct}%` : "0%",
                        background: isTop
                          ? "linear-gradient(90deg, #fbbf24, #f59e0b)"
                          : "rgba(255,255,255,0.1)",
                        borderRadius: "1px",
                        transition: `width 1.1s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.1}s`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Gender panel */}
          <div
            ref={genderRef}
            style={{
              background: "#0c0c0e",
              padding: "56px 44px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "8px",
                  letterSpacing: "0.22em",
                  color: "#f87171",
                  textTransform: "uppercase",
                  marginBottom: "10px",
                }}
              >
                Diversidade nos anúncios
              </div>
              <h3
                style={{
                  fontFamily: "var(--font-bebas)",
                  fontSize: "clamp(28px, 3.5vw, 44px)",
                  lineHeight: "1",
                  color: "#f0efe8",
                  letterSpacing: "0.01em",
                  margin: "0 0 44px",
                }}
              >
                Marcador de Género
              </h3>
            </div>

            {/* Arc donut */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "24px",
              }}
            >
              <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <ArcRing
                  value={genderInView ? genderRate : 0}
                  color="#f87171"
                  size={200}
                  strokeWidth={7}
                />
                <div style={{ position: "absolute", textAlign: "center" }}>
                  <div
                    style={{
                      fontFamily: "var(--font-bebas)",
                      fontSize: "48px",
                      color: "#f87171",
                      lineHeight: "1",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {mounted && genderInView ? (
                      <CountUp target={genderRate} decimals={1} duration={2200} active />
                    ) : (
                      "0,0"
                    )}
                    %
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "7px",
                      color: "#3a3a44",
                      letterSpacing: "0.1em",
                      marginTop: "4px",
                    }}
                  >
                    dos anúncios
                  </div>
                </div>
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "14px", color: "#b0b0b8", lineHeight: "1.6", fontWeight: 400 }}>
                  usava linguagem de género
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "8px",
                    color: "#2e2e38",
                    marginTop: "8px",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                  }}
                >
                  1 em cada 3 anúncios arquivados
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "28px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: "var(--font-mono)",
                  fontSize: "7px",
                  color: "#222230",
                  marginBottom: "7px",
                  letterSpacing: "0.1em",
                }}
              >
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
              <div
                style={{
                  height: "4px",
                  background: "rgba(255,255,255,0.04)",
                  borderRadius: "2px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: genderInView ? `${genderRate}%` : "0%",
                    background: "linear-gradient(90deg, #f87171, #fca5a5)",
                    borderRadius: "2px",
                    transition: "width 2s cubic-bezier(0.34,1.56,0.64,1) 0.3s",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 5 · PERIOD CARDS
      ═══════════════════════════════════════════════════════════════════ */}
      <section style={{ maxWidth: "1280px", margin: "100px auto 0", padding: "0 40px" }}>
        <div style={{ marginBottom: "36px" }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "8px",
              letterSpacing: "0.22em",
              color: "#fbbf24",
              textTransform: "uppercase",
              marginBottom: "12px",
            }}
          >
            Periodização histórica
          </div>
          <h2
            style={{
              fontFamily: "var(--font-bebas)",
              fontSize: "clamp(32px, 4.5vw, 56px)",
              lineHeight: "1",
              margin: 0,
              color: "#f0efe8",
              letterSpacing: "0.01em",
            }}
          >
            Cinco Períodos, Uma Transformação
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: "1px",
            background: "rgba(255,255,255,0.04)",
          }}
        >
          {periods.map((period, i) => {
            const cfg = PERIODS[period.period];
            const periodDetail =
              data.period_detail?.[period.period] ?? data.periods?.[period.period];
            const topCat = periodDetail?.top_categories?.[0]?.job_category ?? null;
            const heightPct = (period.records / maxPeriodRecords) * 100;

            return (
              <div
                key={period.period}
                style={{
                  background: "#0c0c0e",
                  padding: "36px 24px",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                {/* Background fill bar (aesthetic) */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    width: "100%",
                    height: `${heightPct * 0.45}%`,
                    background: cfg?.color ?? "#333",
                    opacity: 0.05,
                    pointerEvents: "none",
                  }}
                />

                <div style={{ position: "relative" }}>
                  {/* Color line */}
                  <div
                    style={{
                      width: "36px",
                      height: "3px",
                      background: cfg?.color ?? "#333",
                      marginBottom: "22px",
                      borderRadius: "2px",
                    }}
                  />

                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "7px",
                      letterSpacing: "0.16em",
                      color: cfg?.color ?? "#666",
                      textTransform: "uppercase",
                      marginBottom: "16px",
                    }}
                  >
                    {cfg?.label ?? period.period}
                  </div>

                  <div
                    style={{
                      fontFamily: "var(--font-bebas)",
                      fontSize: "clamp(24px, 3vw, 38px)",
                      lineHeight: "1",
                      color: "#f0efe8",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {period.records.toLocaleString("pt-PT")}
                  </div>

                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "7px",
                      color: "#252530",
                      marginTop: "5px",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {period.start_year}–{period.end_year}
                  </div>

                  {topCat && (
                    <div
                      style={{
                        fontSize: "10px",
                        color: "#3a3a44",
                        marginTop: "18px",
                        lineHeight: "1.4",
                        paddingTop: "14px",
                        borderTop: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      <span style={{ color: cfg?.color, opacity: 0.7, marginRight: "4px" }}>↑</span>
                      {topCat}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════════════════════════════ */}
      <footer
        style={{
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "100px 40px 60px",
        }}
      >
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.04)",
            paddingTop: "32px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "7px",
              letterSpacing: "0.14em",
              color: "#1e1e28",
              textTransform: "uppercase",
            }}
          >
            Fonte: Arquivo.pt · {data.metadata.records.toLocaleString("pt-PT")} registos · schema v
            {data.schema_version}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "7px",
              letterSpacing: "0.14em",
              color: "#1e1e28",
              textTransform: "uppercase",
            }}
          >
            {data.data_quality.snapshot_dates.min} → {data.data_quality.snapshot_dates.max}
          </span>
        </div>
      </footer>

      {/* ─── Global keyframes ─────────────────────────────────────────── */}
      <style>{`
        @keyframes marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-33.333%); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateX(-50%) translateY(6px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
