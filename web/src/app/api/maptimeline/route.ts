import { readFile } from "node:fs/promises";
import path from "node:path";
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
  if (!/[ÃÂâ]/.test(value)) return value.trim();
  try {
    return Buffer.from(value, "latin1").toString("utf8").trim();
  } catch {
    return value.trim();
  }
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

async function loadDataset(): Promise<DatasetCache> {
  if (datasetPromise) return datasetPromise;

  datasetPromise = (async () => {
    const primaryCsvPath = path.join(process.cwd(), "..", "data", "dataset_final_enriched.csv");
    const fallbackCsvPath = path.join(process.cwd(), "..", "data", "dataset_final.csv");
    let csv: string;

    try {
      csv = await readFile(primaryCsvPath, "utf-8");
    } catch {
      csv = await readFile(fallbackCsvPath, "utf-8");
    }

    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = parseCsvLine(lines[0]);
    const yearIndex = header.indexOf("year");
    const titleIndex = header.indexOf("title");
    const categoryIndex = header.indexOf("job_category");
    const waybackUrlIndex = header.indexOf("wayback_url");
    const originalUrlIndex = header.indexOf("original_url");

    if (yearIndex < 0 || titleIndex < 0) {
      throw new Error("CSV missing required year/title columns.");
    }

    const records: JobRecord[] = [];

    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line);
      const year = Number(cells[yearIndex]);
      const title = repairMojibake(cells[titleIndex] ?? "");
      const category = categoryIndex >= 0 ? repairMojibake(cells[categoryIndex] ?? "") : "";
      const waybackUrl = waybackUrlIndex >= 0 ? cells[waybackUrlIndex] ?? "" : "";
      const originalUrl = originalUrlIndex >= 0 ? cells[originalUrlIndex] ?? "" : "";

      if (!Number.isFinite(year) || !title) continue;

      records.push({
        year,
        title,
        url: waybackUrl || originalUrl,
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
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function GET() {
  try {
    const dataset = await loadDataset();

    // Group records by period
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

    // Extract random samples per period (max 6 per period as in original)
    const SAMPLES_PER_PERIOD = 6;
    const archiveSamples: Record<string, Array<{ title: string; url: string; type: "tech" | "traditional" }>> = {};

    for (const [period, records] of Object.entries(periodGroups)) {
      const shuffled = shuffleArray(records);
      const samples = shuffled.slice(0, SAMPLES_PER_PERIOD).map((record) => {
        // Heuristic: detect if it's a tech job by keywords
        const techKeywords = ["programador", "developer", "engineer", "designer", "data", "analyst", "architect", "cloud", "cybersecurity", "product", "ai", "prompt", "software", "frontend", "backend", "fullstack", "remote", "tech"];
        const isTech = techKeywords.some((keyword) =>
          record.title.toLowerCase().includes(keyword) || record.category.toLowerCase().includes(keyword)
        );

        return {
          title: record.title,
          url: record.url,
          type: isTech ? ("tech" as const) : ("traditional" as const),
        };
      });

      archiveSamples[period] = samples;
    }

    return NextResponse.json({
      archiveSamples,
    });
  } catch (error) {
    console.error("MapTimeline API Error:", error);
    return NextResponse.json(
      { error: "Failed to load archive data" },
      { status: 500 }
    );
  }
}
