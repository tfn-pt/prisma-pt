"use client";

import { Playfair_Display } from "next/font/google";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { Tooltip, useTooltip } from "@visx/tooltip";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Search, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type PointerEvent } from "react";
import LensChrome from "./LensChrome";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500"],
  style: ["normal", "italic"],
  display: "swap",
});

const ease = "transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]";
const glassSurface = "bg-white/30 backdrop-blur-md border border-white/20";
const glassInner = "bg-white/[0.07] backdrop-blur-sm border border-white/15";
const CHART_COLOR = "#f59e0b";

type MirrorPoint = {
  year: number;
  count: number;
  total: number;
  share: number;
};

type SampleTitle = {
  title: string;
  url: string;
};

type MirrorResponse = {
  query: string;
  totalMatches: number;
  yearsWithMatches?: number;
  isSignificant?: boolean;
  emptyReason?: string | null;
  firstYear: number | null;
  lastYear: number | null;
  firstShare: number;
  lastShare: number;
  delta: number;
  relativeChange: number | null;
  verdict: "rise" | "decline" | "stable";
  copy: string;
  series: MirrorPoint[];
  sampleTitles: SampleTitle[];
};

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2).replace(".", ",")}%`;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFuzzySubsequence(query: string, target: string): boolean {
  let qIdx = 0;
  let tIdx = 0;
  while (qIdx < query.length && tIdx < target.length) {
    if (query[qIdx] === target[tIdx]) qIdx++;
    tIdx++;
  }
  return qIdx === query.length;
}

function NoDataState({ query, reason }: { query: string; reason?: string | null }) {
  return (
    <motion.div
      key="no-data"
      initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, filter: "blur(8px)" }}
      transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
      className="mt-8 rounded-xl border border-white/15 bg-black/80 p-6 shadow-[0_26px_80px_rgba(0,0,0,0.45)] backdrop-blur-md"
    >
      <p className="font-mono text-xs font-black uppercase tracking-[0.28em] text-zinc-500">
        Sem Rasto
      </p>
      <p className="mt-4 text-3xl font-black uppercase leading-none text-zinc-50">
        {query}
      </p>
      <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400">
        {reason ?? "O arquivo não documenta dados suficientes para traçar uma radiografia clara desta pesquisa."}
      </p>
    </motion.div>
  );
}

function MiniAreaChart({
  series,
  width,
  height,
  chartMode,
}: {
  series: MirrorPoint[];
  width: number;
  height: number;
  chartMode: "share" | "count";
}) {
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } =
    useTooltip<MirrorPoint>();
  const margin = { top: 20, right: 22, bottom: 34, left: 22 };
  const innerWidth = Math.max(width - margin.left - margin.right, 1);
  const innerHeight = Math.max(height - margin.top - margin.bottom, 1);
  const maxShare = Math.max(...series.map((row) => row.share), 0.001);
  const maxCount = Math.max(...series.map((row) => row.count), 1);

  const xScale = scaleLinear({
    domain: [series[0]?.year ?? 2008, series.at(-1)?.year ?? 2024],
    range: [0, innerWidth],
  });

  const yScale = scaleLinear({
    domain: [0, (chartMode === "share" ? maxShare : maxCount) * 1.18],
    range: [innerHeight, 0],
    nice: true,
  });

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!series || series.length === 0) return;
    
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left - margin.left;
    const rawYear = xScale.invert(Math.max(0, Math.min(innerWidth, localX)));
    const nearest = series.reduce((best, point) =>
      Math.abs(point.year - rawYear) < Math.abs(best.year - rawYear) ? point : best,
    );

    showTooltip({
      tooltipData: nearest,
      tooltipLeft: margin.left + xScale(nearest.year),
      tooltipTop: margin.top + yScale(chartMode === "share" ? nearest.share : nearest.count),
    });
  }

  return (
    <div className="relative h-full w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Radiografia temporal da pesquisa no Arquivo.pt"
        onPointerMove={handlePointerMove}
        onPointerLeave={hideTooltip}
      >
          <linearGradient id="mirror-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={CHART_COLOR} stopOpacity="0.34" />
            <stop offset="100%" stopColor={CHART_COLOR} stopOpacity="0" />
          </linearGradient>
        <g transform={`translate(${margin.left},${margin.top})`}>
          <AreaClosed<MirrorPoint>
            data={series}
            x={(point) => xScale(point.year)}
            y={(point) => yScale(chartMode === "share" ? point.share : point.count)}
            yScale={yScale}
            stroke="transparent"
            fill="url(#mirror-area)"
          />
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
            <LinePath<MirrorPoint>
              data={series}
              x={(point) => xScale(point.year)}
              y={(point) => yScale(chartMode === "share" ? point.share : point.count)}
              stroke={CHART_COLOR}
              strokeWidth={2.8}
            />
          </motion.g>
          {series.map((point, index) => (
            <motion.circle
              key={point.year}
              cx={xScale(point.year)}
              cy={yScale(chartMode === "share" ? point.share : point.count)}
              r={tooltipData?.year === point.year ? 5 : point.count > 0 ? 3 : 1.5}
              fill={point.count > 0 ? CHART_COLOR : "#52525b"}
              stroke={tooltipData?.year === point.year ? "#fafafa" : "transparent"}
              strokeWidth={2}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: index * 0.025 }}
            />
          ))}
          {tooltipData ? (
            <line
              x1={xScale(tooltipData.year)}
              x2={xScale(tooltipData.year)}
              y1={0}
              y2={innerHeight}
              stroke="#fafafa"
              strokeDasharray="4 6"
              strokeOpacity={0.32}
            />
          ) : null}
          <rect width={innerWidth} height={innerHeight} fill="transparent" pointerEvents="all" />
          <line x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} stroke="#3f3f46" />
          <text x={0} y={innerHeight + 24} fill="#71717a" fontSize={11} fontWeight={800}>
            {series[0]?.year}
          </text>
          <text x={innerWidth} y={innerHeight + 24} fill="#71717a" fontSize={11} fontWeight={800} textAnchor="end">
            {series.at(-1)?.year}
          </text>
        </g>
      </svg>

      {tooltipData && tooltipLeft != null && tooltipTop != null ? (
        <Tooltip
          left={tooltipLeft}
          top={tooltipTop}
          style={{
            position: "absolute",
            background: "rgba(9,9,11,0.88)",
            border: "1px solid rgba(255,255,255,0.10)",
            borderRadius: 6,
            padding: "6px 10px",
            fontFamily: "monospace",
            fontSize: 11,
            fontWeight: 800,
            color: CHART_COLOR,
            pointerEvents: "none",
          }}
        >
          <div style={{ color: "#71717a", fontSize: 10, fontWeight: 800, letterSpacing: "0.18em", marginBottom: 4 }}>
            {tooltipData.year}
          </div>
          <div style={{ color: chartMode === "count" ? CHART_COLOR : "#71717a", fontWeight: 800 }}>
            {tooltipData.count} anúncios
          </div>
          <div style={{ color: chartMode === "share" ? CHART_COLOR : "#71717a", fontWeight: 800 }}>
            {(tooltipData.share * 100).toFixed(2)}% quota
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}

export default function Mirror({ data }: { data?: unknown }) {
  
  const allAvailableCategories = useMemo(() => {
    const raw = data as any;
    const extracted = new Set<string>();

    if (raw?.time_series?.category_by_year) {
      raw.time_series.category_by_year.forEach((c: any) => extracted.add(c.job_category));
    }
    if (raw?.distributions?.category) {
      raw.distributions.category.forEach((c: any) => extracted.add(c.job_category));
    }

    const failsafe = [
      "Programador", "Motorista", "Cozinheiro", "Enfermeiro", "Professor", "Médico",
      "Advogado", "Contabilista", "Gestor", "Designer", "Arquitecto", "Assistente",
      "Rececionista", "Empregado de Mesa", "Mecânico", "Eletricista", "Técnico",
      "Analista", "Consultor", "Diretor", "Comercial", "Vendedor", "Marketing",
      "Pedreiro", "Carpinteiro", "Soldador", "Canalizador", "Logística", "Farmacêutico",
      "Fisioterapeuta", "Psicólogo", "Jornalista", "Tradutor", "Segurança", "Limpeza",
      "TI", "Restauração", "Engenharia", "Construção", "Administrativo", "RH"
    ];
    failsafe.forEach(f => extracted.add(f));

    return Array.from(extracted).filter(Boolean);
  }, [data]);
  
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[] | null>(null);
  const [chartMode, setChartMode] = useState<"share" | "count">("share");
  const [query, setQuery] = useState("programador");
  const [debouncedQuery, setDebouncedQuery] = useState("programador");
  const [result, setResult] = useState<MirrorResponse | null>(null);
  const [error, setError] = useState<{ query: string; message: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/mirror?suggestions=1", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { suggestions?: string[] };
      })
      .then((payload) => {
        if (payload?.suggestions?.length) setRemoteSuggestions(payload.suggestions);
      })
      .catch((fetchError: Error) => {
        if (fetchError.name !== "AbortError") setRemoteSuggestions(null);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length < 3) return;

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetch(`/api/mirror?q=${encodeURIComponent(debouncedQuery)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || `Pesquisa falhou (${response.status}).`);
        }
        const payload = await response.json();
        return payload as MirrorResponse;
      })
      .then((payload) => {
        setResult(payload);
        setError(null);
      })
      .catch((fetchError: Error) => {
        if (fetchError.name !== "AbortError") setError({ query: debouncedQuery, message: fetchError.message });
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [debouncedQuery]);

  const visibleResult = result; 
  const visibleError = debouncedQuery.length >= 3 && error?.query === debouncedQuery ? error.message : null;
  const hasSignificantResult = Boolean(visibleResult?.isSignificant ?? visibleResult);
  
  const normalizedQuery = normalizeSearch(query);
  const suggestions = remoteSuggestions?.length ? remoteSuggestions : allAvailableCategories;
  
  const autocompleteOptions = useMemo(() => {
    const unique = Array.from(new Set(suggestions));
    if (!normalizedQuery) return unique.slice(0, 12);

    const scored = unique.map((opt) => {
      const normalizedOpt = normalizeSearch(opt);
      let score = 0;
      
      if (normalizedOpt === normalizedQuery) score = 100;
      else if (normalizedOpt.startsWith(normalizedQuery)) score = 75;
      else if (normalizedOpt.includes(normalizedQuery)) score = 50;
      else if (isFuzzySubsequence(normalizedQuery, normalizedOpt)) score = 25;

      return { opt, score };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.opt)
      .slice(0, 12);
  }, [normalizedQuery, suggestions]);
  
  const showAutocomplete = isAutocompleteOpen && query.length > 0;

  function runSuggestionSearch(suggestion: string) {
    const normalized = suggestion.toLowerCase();
    setQuery(normalized);
    setDebouncedQuery(normalized);
    setIsAutocompleteOpen(false);
  }

  const maxSharePoint = useMemo(() => {
    if (!visibleResult?.series || visibleResult.series.length === 0) return null;
    return visibleResult.series.reduce((max, pt) => (pt.share > max.share ? pt : max), visibleResult.series[0]);
  }, [visibleResult]);

  return (
    <section className="relative h-screen overflow-hidden bg-[#05070b] p-3 text-white sm:p-5">
      <div className="relative h-full overflow-hidden rounded-xl border border-white/15 bg-zinc-950">
        <LensChrome />

        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.032)_1px,transparent_1px)] bg-[size:72px_72px]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(251,191,36,0.05),transparent_40%),radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.05),transparent_36%)]" />

        <div className="relative h-full overflow-y-auto px-5 pb-10 pt-28 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-7xl">

            <div className="mb-10 grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
              <div>
                <p className="font-mono text-xs font-black uppercase tracking-[0.32em] text-amber-300">
                  Acto 2
                </p>
                <h2
                  className={`
                    ${playfair.className}
                    mt-4
                    text-[clamp(4rem,11vw,10rem)]
                    font-medium
                    leading-[0.8]
                    tracking-tighter
                    text-zinc-50
                  `}
                >
                  <span className="block not-italic uppercase">O</span>
                  <span className="block italic uppercase">Espelho.</span>
                </h2>
              </div>
              <p className="max-w-2xl text-lg leading-8 text-zinc-300">
                Escreve uma profissão e o Arquivo devolve a sua radiografia estrutural: frequência absoluta em títulos, peso na amostra e exemplos textuais preservados.
              </p>
            </div>

            <div className={`${glassSurface} rounded-xl p-7 shadow-[0_28px_80px_rgba(0,0,0,0.55)] md:p-8`}>
              <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">

                <div className="min-w-0">
                  <label
                    htmlFor="mirror-query"
                    className="font-mono text-xs font-black uppercase tracking-[0.26em] text-zinc-400"
                  >
                    Termo de Pesquisa
                  </label>

                  <div
                    className={`
                      relative
                      mt-4 flex w-full min-w-0 items-center gap-3 rounded-lg
                      ${ease}
                      border border-white/20 bg-white/10 backdrop-blur-sm px-5 py-6
                      focus-within:scale-[1.01] focus-within:border-sky-400/70 focus-within:bg-white/20
                    `}
                  >
                    {isLoading ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-amber-300" />
                    ) : (
                      <Search className="h-5 w-5 shrink-0 text-zinc-400" />
                    )}
                    <input
                      id="mirror-query"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setIsAutocompleteOpen(true);
                      }}
                      onFocus={() => setIsAutocompleteOpen(true)}
                      onBlur={() => {
                        window.setTimeout(() => setIsAutocompleteOpen(false), 200);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          setIsAutocompleteOpen(false);
                          e.currentTarget.blur();
                        }
                      }}
                      placeholder="programador, condutor, cozinheiro..."
                      autoComplete="off"
                      className="min-w-0 flex-1 bg-transparent text-2xl font-black text-zinc-50 outline-none placeholder:text-zinc-600 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] md:text-3xl"
                    />
                    
                    {showAutocomplete ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.75rem)] z-50 overflow-hidden rounded-lg border border-white/15 bg-black/90 shadow-[0_30px_90px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
                        <div className="max-h-72 overflow-y-auto py-2">
                          {autocompleteOptions.length > 0 ? (
                            autocompleteOptions.map((suggestion) => (
                              <button
                                key={suggestion}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  runSuggestionSearch(suggestion);
                                }}
                                className="block w-full px-5 py-3 text-left font-mono text-xs font-black uppercase tracking-[0.16em] text-zinc-300 transition-all duration-300 hover:bg-white/10 hover:text-amber-200"
                              >
                                {suggestion}
                              </button>
                            ))
                          ) : (
                            <div className="px-5 py-4 font-mono text-xs font-bold uppercase tracking-widest text-zinc-400">
                              A procurar por "{query}"...
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5">
                    <p className="font-mono text-[0.65rem] font-black uppercase tracking-[0.24em] text-zinc-500">
                      Categorias e Ocorrências Frequentes
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {suggestions.slice(0, 8).map((suggestion) => {
                        const active = query.trim().toLowerCase() === suggestion.toLowerCase();
                        return (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => runSuggestionSearch(suggestion)}
                            className={`
                              ${ease}
                              border px-3 py-2
                              font-mono text-xs font-black uppercase tracking-[0.16em]
                              ${active
                                ? "border-sky-400/60 bg-sky-400/10 text-sky-300"
                                : "border-white/15 bg-white/10 text-zinc-400 hover:border-white/30 hover:bg-white/20 hover:text-white"
                              }
                            `}
                            data-active={active}
                          >
                            {suggestion}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={`transition-opacity duration-500 ${isLoading ? 'opacity-40' : 'opacity-100'}`}>
                    <AnimatePresence mode="wait">
                      {normalizedQuery.length > 0 && normalizedQuery.length < 3 ? (
                        <NoDataState
                          query={query}
                          reason="Escreve pelo menos 3 caracteres para iniciar o mapeamento."
                        />
                      ) : visibleResult && !visibleResult.isSignificant ? (
                        <NoDataState
                          query={visibleResult.query}
                          reason={visibleResult.emptyReason}
                        />
                      ) : visibleResult ? (
                        <motion.div
                          key={visibleResult.query}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          className="mt-8 rounded-xl border border-white/10 bg-black/40 p-6 backdrop-blur-md"
                        >
                          <div className="flex items-center gap-3">
                            <Activity className="h-5 w-5 text-amber-300" />
                            <p className="font-mono text-[0.65rem] font-black uppercase tracking-[0.22em] text-amber-300">
                              Radiografia de Ocorrências
                            </p>
                          </div>
                          
                          <div className="mt-5 flex items-baseline gap-3">
                            <p className="text-5xl font-black leading-none tracking-tight text-white md:text-6xl">
                              {formatPercent(maxSharePoint?.share ?? visibleResult.lastShare)}
                            </p>
                            <p className="font-mono text-xs uppercase tracking-widest text-zinc-400">
                              Quota máx. ({maxSharePoint?.year})
                            </p>
                          </div>

                          <div className="mt-6 grid grid-cols-2 gap-6 border-t border-white/10 pt-5">
                            <div>
                              <p className="font-mono text-[0.6rem] font-black uppercase tracking-widest text-zinc-500">
                                Total Identificado
                              </p>
                              <p className="mt-1 font-mono text-lg font-bold text-white">
                                {visibleResult.totalMatches} <span className="text-xs text-zinc-400">anúncios</span>
                              </p>
                            </div>
                            <div>
                              <p className="font-mono text-[0.6rem] font-black uppercase tracking-widest text-zinc-500">
                                Diferencial ({visibleResult.firstYear}–{visibleResult.lastYear})
                              </p>
                              <p className="mt-1 font-mono text-lg font-bold text-white">
                                {visibleResult.delta > 0 ? "+" : ""}{formatPercent(visibleResult.delta)} <span className="text-xs text-zinc-400">pp</span>
                              </p>
                            </div>
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                    
                    {visibleError ? (
                      <p className="mt-6 font-mono text-xs uppercase tracking-widest text-red-400">
                        Erro: {visibleError}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div
                  className={`flex flex-col min-h-[420px] min-w-0 overflow-hidden ${glassInner} rounded-xl p-5 transition-opacity duration-500 ${isLoading ? 'opacity-40' : 'opacity-100'}`}
                >
                  {/* Brutalist chart mode toggle */}
                  <div className="mb-4 flex items-center gap-0 border border-zinc-800 w-fit">
                    <button
                      type="button"
                      onClick={() => setChartMode("share")}
                      className={`px-3 py-1.5 font-mono text-[0.6rem] font-black uppercase tracking-[0.2em] transition-none border-r border-zinc-800 ${
                        chartMode === "share"
                          ? "bg-zinc-50 text-zinc-950"
                          : "bg-transparent text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      [ QUOTA % ]
                    </button>
                    <button
                      type="button"
                      onClick={() => setChartMode("count")}
                      className={`px-3 py-1.5 font-mono text-[0.6rem] font-black uppercase tracking-[0.2em] transition-none ${
                        chartMode === "count"
                          ? "bg-zinc-50 text-zinc-950"
                          : "bg-transparent text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      [ VOLUME ABSOLUTO ]
                    </button>
                  </div>

                  {/* MAGIC WRAPPER: Kills the infinite resize loop */}
                  <div className="relative flex-1 min-h-0 w-full mt-2">
                    <AnimatePresence mode="wait">
                      {visibleResult && hasSignificantResult ? (
                        <motion.div
                          key={visibleResult.query}
                          className="absolute inset-0"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          <ParentSize debounceTime={80}>
                            {({ width, height }) => (
                              <MiniAreaChart
                                series={visibleResult.series}
                                width={Math.max(width, 320)}
                                height={Math.max(height, 300)}
                                chartMode={chartMode}
                              />
                            )}
                          </ParentSize>
                        </motion.div>
                      ) : visibleResult && !hasSignificantResult ? (
                        <motion.div
                          key="no-data-chart"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 grid place-items-center text-center"
                        >
                          <div className="max-w-sm rounded-xl border border-white/10 bg-black/80 p-6 backdrop-blur-md">
                            <p className="font-mono text-xs font-black uppercase tracking-[0.24em] text-zinc-500">
                              Sem Registo
                            </p>
                            <p className="mt-3 text-sm leading-6 text-zinc-400">
                              O cruzamento não gerou volume visualizável.
                            </p>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="empty"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 grid place-items-center text-center font-mono text-xs font-black uppercase tracking-[0.24em] text-zinc-500"
                        >
                          Aguardando cruzamento...
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              <div className={`transition-opacity duration-500 ${isLoading ? 'opacity-40' : 'opacity-100'}`}>
                {visibleResult?.sampleTitles.length ? (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 grid gap-3 border-t border-white/10 pt-6 md:grid-cols-2"
                  >
                    <div className="col-span-full mb-1">
                      <p className="font-mono text-[0.65rem] font-black uppercase tracking-[0.24em] text-zinc-500">
                        Instâncias Preservadas
                      </p>
                    </div>
                    {visibleResult.sampleTitles.slice(0, 4).map((sample) => (
                      <a
                        key={`${sample.title}-${sample.url}`}
                        href={sample.url || undefined}
                        target="_blank"
                        rel="noreferrer"
                        className={`
                          ${ease}
                          border-l-2 border-sky-400/50
                          bg-white/[0.03] px-4 py-3
                          text-sm leading-6 text-zinc-300
                          hover:scale-[1.01] hover:bg-white/[0.06] hover:text-white
                        `}
                      >
                        {sample.title}
                      </a>
                    ))}
                  </motion.div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}