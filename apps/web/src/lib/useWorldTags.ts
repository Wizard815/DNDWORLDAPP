import { useQuery } from "@tanstack/react-query";
import { api } from "../api.ts";

/** The world's tags (name, color, counts) — shared by the chip editor, the editor's `#` autocomplete and the Tags view. */
export function useWorldTags(worldId: string | null) {
  return useQuery({
    queryKey: ["tags", worldId],
    queryFn: () => api.tags(worldId!),
    enabled: worldId !== null,
    staleTime: 30_000,
  });
}
