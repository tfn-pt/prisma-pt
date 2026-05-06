import Mirror from "@/components/Mirror";
import { getMasterData } from "@/lib/masterData";

export const dynamic = "force-static";

export default async function EspelhoPage() {
  const data = await getMasterData();

  return <Mirror data={data} />;
}
