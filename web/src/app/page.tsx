import { readFile } from "node:fs/promises";
import path from "node:path";
import Hero from "@/components/Hero";

export const dynamic = "force-static";

async function getMasterData() {
  const filePath = path.join(process.cwd(), "public", "data", "master_data_rich.json");
  const file = await readFile(filePath, "utf-8");
  return JSON.parse(file);
}

export default async function Home() {
  const data = await getMasterData();

  return (
    <main className="bg-zinc-950">
      <Hero data={data} />
    </main>
  );
}
