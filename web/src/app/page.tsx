import Hero from "@/components/Hero";
import { getMasterData } from "@/lib/masterData";

export const dynamic = "force-static";

export default async function Home() {
  const data = await getMasterData();

  return (
    <main className="bg-zinc-950">
      <Hero data={data} />
    </main>
  );
}
