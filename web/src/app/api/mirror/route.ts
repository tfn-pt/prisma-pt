import { toSafeExternalUrl } from "@/lib/arquivoLinks";
import { getArchiveRecords, getMasterData } from "@/lib/masterData";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_SIGNIFICANT_MATCHES = 5;
const MIN_SIGNIFICANT_YEARS = 2;
const MIN_QUERY_LENGTH = 3;

type JobRecord = {
  year: number;
  title: string;
  url: string;
  category: string;
  normalizedTitle: string;
  normalizedCategory: string;
};

type DatasetCache = {
  records: JobRecord[];
  years: number[];
  totalsByYear: Map<number, number>;
  suggestions: string[];
};

let datasetPromise: Promise<DatasetCache> | null = null;

function repairMojibake(value: string) {
  if (!/[ÃƒÃ‚Ã¢]/.test(value)) return value.trim();
  try {
    return Buffer.from(value, "latin1").toString("utf8").trim();
  } catch {
    return value.trim();
  }
}

function normalize(value: string) {
  return repairMojibake(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createStrictMatcher(normalizedQuery: string) {
  const exactQuery = normalizedQuery.trim();
  const boundaryPattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(exactQuery)}($|[^a-z0-9])`, "i");

  return (value: string) => value === exactQuery || boundaryPattern.test(value);
}

function buildEmptyResponse(query: string, years: number[], totalsByYear: Map<number, number>, reason: string) {
  const series = years.map((year) => {
    const total = totalsByYear.get(year) ?? 0;

    return {
      year,
      count: 0,
      total,
      share: 0,
    };
  });

  return {
    query,
    normalizedQuery: normalize(query),
    totalMatches: 0,
    yearsWithMatches: 0,
    isSignificant: false,
    emptyReason: reason,
    firstYear: series[0]?.year ?? null,
    lastYear: series[series.length - 1]?.year ?? null,
    firstShare: 0,
    lastShare: 0,
    delta: 0,
    relativeChange: null,
    verdict: "stable" as const,
    copy: reason,
    series,
    sampleTitles: [],
  };
}

async function loadDataset(): Promise<DatasetCache> {
  if (datasetPromise) return datasetPromise;

  datasetPromise = (async () => {
    const [masterData, archiveRecords] = await Promise.all([getMasterData(), getArchiveRecords()]);
    const years = [...masterData.metadata.years].sort((a, b) => a - b);
    const totalsByYear = new Map<number, number>(
      masterData.time_series.yearly_volume.map((row) => [row.year, row.records]),
    );
    const records: JobRecord[] = [];
    const suggestionCounts = new Map<string, { label: string; count: number }>();

    function addSuggestion(label: string) {
      const repaired = repairMojibake(label);
      const normalized = normalize(repaired);
      if (normalized.length < MIN_QUERY_LENGTH || normalized.length > 72) return;

      const current = suggestionCounts.get(normalized);
      suggestionCounts.set(normalized, {
        label: current?.label ?? repaired,
        count: (current?.count ?? 0) + 1,
      });
    }

    for (const row of masterData.distributions.category) {
      addSuggestion(row.job_category);
    }

    for (const record of archiveRecords) {
      const year = record.year;
      const title = repairMojibake(record.title ?? "");
      const category = repairMojibake(record.category ?? "");

      if (!Number.isFinite(year) || !title) continue;

      addSuggestion(title);
      if (category) addSuggestion(category);

      records.push({
        year,
        title,
        url: toSafeExternalUrl(record.url),
        category,
        normalizedTitle: normalize(title),
        normalizedCategory: normalize(category),
      });
    }

    const suggestions = Array.from(suggestionCounts.values())
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt"))
      .slice(0, 50)
      .map((suggestion) => suggestion.label);

    return { records, years, totalsByYear, suggestions };
  })();

  return datasetPromise;
}

function buildCopy(query: string, firstShare: number, lastShare: number, delta: number) {
  const start = `${(firstShare * 100).toFixed(1).replace(".", ",")}%`;
  const end = `${(lastShare * 100).toFixed(1).replace(".", ",")}%`;

  if (delta < -0.002) {
    return `A profissÃ£o "${query}" caiu de ${start} para ${end}. Portugal deixou de a recrutar com a mesma forÃ§a.`;
  }

  if (delta > 0.002) {
    return `A profissÃ£o "${query}" subiu de ${start} para ${end}. Portugal passou a precisar mais deste trabalho.`;
  }

  return `A profissÃ£o "${query}" manteve-se perto do mesmo peso: ${start} para ${end}. A mudanÃ§a Ã© discreta, mas visÃ­vel no rasto anual.`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q") ?? "";
  const query = rawQuery.trim();
  const normalizedQuery = normalize(query);
  const dataset = await loadDataset();

  if (searchParams.get("suggestions") === "1") {
    return NextResponse.json({ suggestions: dataset.suggestions });
  }

  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      buildEmptyResponse(
        query,
        dataset.years,
        dataset.totalsByYear,
        "Escolhe uma sugestao ou escreve pelo menos 3 caracteres para pesquisar.",
      ),
    );
  }

  const matchesStrictly = createStrictMatcher(normalizedQuery);
  const matchesByYear = new Map<number, number>();
  const sampleTitles: { title: string; url: string }[] = [];

  for (const record of dataset.records) {
    if (!matchesStrictly(record.normalizedTitle) && !matchesStrictly(record.normalizedCategory)) continue;

    matchesByYear.set(record.year, (matchesByYear.get(record.year) ?? 0) + 1);
    if (sampleTitles.length < 5) {
      sampleTitles.push({ title: record.title, url: record.url });
    }
  }

  const series = dataset.years.map((year) => {
    const total = dataset.totalsByYear.get(year) ?? 0;
    const count = matchesByYear.get(year) ?? 0;

    return {
      year,
      count,
      total,
      share: total > 0 ? Number((count / total).toFixed(5)) : 0,
    };
  });

  const totalMatches = series.reduce((sum, row) => sum + row.count, 0);
  const yearsWithMatches = series.filter((row) => row.count > 0).length;
  const isSignificant =
    totalMatches >= MIN_SIGNIFICANT_MATCHES && yearsWithMatches >= MIN_SIGNIFICANT_YEARS;
  const first = series[0];
  const last = series[series.length - 1];
  const firstShare = first?.share ?? 0;
  const lastShare = last?.share ?? 0;
  const delta = Number((lastShare - firstShare).toFixed(5));
  const relativeChange =
    firstShare > 0 ? Number(((lastShare - firstShare) / firstShare).toFixed(4)) : null;
  const verdict = delta < -0.002 ? "decline" : delta > 0.002 ? "rise" : "stable";

  return NextResponse.json({
    query,
    normalizedQuery,
    totalMatches,
    yearsWithMatches,
    isSignificant,
    emptyReason: isSignificant
      ? null
      : "O arquivo nÃ£o preserva rasto significativo para esta pesquisa.",
    firstYear: first?.year ?? null,
    lastYear: last?.year ?? null,
    firstShare,
    lastShare,
    delta,
    relativeChange,
    verdict,
    copy: isSignificant
      ? buildCopy(query, firstShare, lastShare, delta)
      : "O arquivo nÃ£o preserva rasto significativo para esta pesquisa.",
    series,
    sampleTitles: isSignificant ? sampleTitles : [],
  });
}
