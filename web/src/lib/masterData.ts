import { readFile } from "node:fs/promises";
import path from "node:path";

export type MasterData = {
  kpis?: {
    total_ads?: number;
    unique_categories?: number;
    year_span?: number;
    year_min?: number;
    year_max?: number;
  };
  metadata: {
    records: number;
    years: number[];
  };
  time_series: {
    yearly_volume: Array<{
      year: number;
      records: number;
    }>;
    category_by_year: Array<{
      year: number;
      job_category: string;
      count: number;
      share: number;
    }>;
  };
  distributions: {
    category: Array<{
      job_category: string;
      count: number;
      share: number;
    }>;
  };
};

export type ArchiveRecord = {
  year: number;
  title: string;
  category: string;
  url: string;
};

const masterDataPath = path.join(process.cwd(), "public", "data", "master_data_rich.json");
const archiveRecordsPath = path.join(process.cwd(), "public", "data", "archive_records.json");

let masterDataPromise: Promise<MasterData> | null = null;
let archiveRecordsPromise: Promise<ArchiveRecord[]> | null = null;

export async function getMasterData() {
  if (!masterDataPromise) {
    masterDataPromise = readFile(masterDataPath, "utf-8").then(
      (file) => JSON.parse(file) as MasterData,
    );
  }

  return masterDataPromise;
}

export async function getArchiveRecords() {
  if (!archiveRecordsPromise) {
    archiveRecordsPromise = readFile(archiveRecordsPath, "utf-8").then(
      (file) => JSON.parse(file) as ArchiveRecord[],
    );
  }

  return archiveRecordsPromise;
}
