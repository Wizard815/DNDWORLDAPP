import fs from "node:fs";
import path from "node:path";
import { paths } from "../env.ts";

/**
 * What a map page leaves on disk besides its asset: the tile pyramid
 * (services/maps.ts tileDirFor + its temp dirs) and the fog mask with its
 * cached player renders (services/fog.ts maskFile/cacheDir). Lives here, not
 * in those modules, because nodes.ts has to call it on a hard delete and
 * both of them already import nodes.ts.
 */
export function removeMapFiles(nodeId: string): void {
  const rm = (target: string) => fs.rmSync(target, { recursive: true, force: true });
  rm(path.join(paths.tiles, nodeId));
  if (fs.existsSync(paths.tiles)) {
    for (const entry of fs.readdirSync(paths.tiles)) {
      if (entry.startsWith(`${nodeId}.tmp-`)) rm(path.join(paths.tiles, entry));
    }
  }
  rm(path.join(paths.fog, `${nodeId}.mask`));
  rm(path.join(paths.fog, "cache", nodeId));
}
