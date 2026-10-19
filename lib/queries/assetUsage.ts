import { useQuery } from "@tanstack/react-query";
import { readAssetUsage } from "@/lib/server-actions/assetsUsage";

export function useAssetUsage() {
  return useQuery({
    queryKey: ["table", "lines", "asset-app-usage"],
    queryFn: async () => {
      const result = await readAssetUsage();
      if (!result.ok) throw new Error(result.error);
      return result.placements;
    },
    refetchInterval: 30_000,
  });
}
