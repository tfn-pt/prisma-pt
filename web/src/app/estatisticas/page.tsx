import MapTimeline from "@/components/MapTimeline";
import { getMasterData } from "@/lib/masterData";

export const dynamic = "force-static";

export default async function EstatisticasPage() {
  const data = await getMasterData();

  return <MapTimeline data={data} />;
}
