import { toSafeExternalUrl } from "@/lib/arquivoLinks";
import { getArchiveRecords, getMasterData } from "@/lib/masterData";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobRecord = {
  year: number;
  title: string;
  url: string;
  category: string;
};

type DatasetCache = {
  records: JobRecord[];
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

async function loadDataset(): Promise<DatasetCache> {
  if (datasetPromise) return datasetPromise;

  datasetPromise = (async () => {
    const [masterData, archiveRecords] = await Promise.all([getMasterData(), getArchiveRecords()]);
    const activeYears = new Set(masterData.metadata.years);
    const records: JobRecord[] = [];

    for (const record of archiveRecords) {
      const year = record.year;
      const title = repairMojibake(record.title ?? "");
      const category = repairMojibake(record.category ?? "");

      if (!Number.isFinite(year) || !title) continue;
      if (!activeYears.has(year)) continue;

      records.push({
        year,
        title,
        url: toSafeExternalUrl(record.url),
        category,
      });
    }

    return { records };
  })();

  return datasetPromise;
}

function getPeriodKey(year: number): string {
  if (year <= 2011) return "2008_2011";
  if (year <= 2015) return "2012_2015";
  if (year <= 2019) return "2016_2019";
  if (year <= 2021) return "2020_2021";
  return "2022_2024";
}

function shuffleArray<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function GET() {
  try {
    const dataset = await loadDataset();
    const periodGroups: Record<string, JobRecord[]> = {
      "2008_2011": [],
      "2012_2015": [],
      "2016_2019": [],
      "2020_2021": [],
      "2022_2024": [],
    };

    for (const record of dataset.records) {
      const period = getPeriodKey(record.year);
      if (periodGroups[period]) {
        periodGroups[period].push(record);
      }
    }

    const SAMPLES_PER_PERIOD = 6;
    const archiveSamples: Record<string, Array<{ title: string; url: string; type: "tech" | "traditional" }>> = {};

    for (const [period, records] of Object.entries(periodGroups)) {
      const shuffled = shuffleArray(records);
      const samples = shuffled.slice(0, SAMPLES_PER_PERIOD).map((record) => {
        const techKeywords = [
          "programador",
          "developer",
          "engineer",
          "designer",
          "data",
          "analyst",
          "architect",
          "cloud",
          "cybersecurity",
          "product",
          "ai",
          "prompt",
          "software",
          "frontend",
          "backend",
          "fullstack",
          "remote",
          "tech",
        ];
        const isTech = techKeywords.some(
          (keyword) =>
            record.title.toLowerCase().includes(keyword) ||
            record.category.toLowerCase().includes(keyword),
        );

        return {
          title: record.title,
          url: record.url,
          type: isTech ? ("tech" as const) : ("traditional" as const),
        };
      });

      archiveSamples[period] = samples;
    }

    return NextResponse.json({ archiveSamples });
  } catch (error) {
    console.error("MapTimeline API Error:", error);
    return NextResponse.json({ error: "Failed to load archive data" }, { status: 500 });
  }
}
