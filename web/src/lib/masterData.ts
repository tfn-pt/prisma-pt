import { readFile } from "node:fs/promises";
import path from "node:path";

export async function getMasterData() {
  const filePath = path.join(process.cwd(), "..", "data", "master_data_rich.json");
  const file = await readFile(filePath, "utf-8");
  return JSON.parse(file);
}
