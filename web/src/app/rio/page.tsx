import ProfessionRiver from "@/components/ProfessionRiver";
import { getMasterData } from "@/lib/masterData";

export const dynamic = "force-static";

export default async function RioPage() {
  const data = await getMasterData();

  return <ProfessionRiver data={data} />;
}
