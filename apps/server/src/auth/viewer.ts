import type { Role } from "@dndworldapp/schema";

/** Who is asking, and with what role in the world being asked about. */
export interface Viewer {
  userId: string | null;
  role: Role | null;
}

export const ANONYMOUS: Viewer = { userId: null, role: null };
