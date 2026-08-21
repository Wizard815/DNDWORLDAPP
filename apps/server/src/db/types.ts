import type { NodeKind, Role, Visibility } from "@dndworldapp/schema";

/** Row shapes, mirroring migrations/*.sql. SQLite booleans are 0/1 integers. */

export type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  is_server_admin: number;
  created_at: number;
}

export type SessionRow = {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  user_agent: string | null;
}

export type WorldRow = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  settings: string;
  created_at: number;
  updated_at: number;
}

export type MembershipRow = {
  world_id: string;
  user_id: string;
  role: Role;
  created_at: number;
}

export type NodeRow = {
  id: string;
  world_id: string;
  parent_id: string | null;
  template_id: string | null;
  kind: NodeKind;
  title: string;
  slug: string;
  body_md: string;
  icon: string | null;
  cover_asset_id: string | null;
  sort_key: string;
  visibility: Visibility;
  is_archived: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export type PostRow = {
  id: string;
  node_id: string;
  title: string;
  body_md: string;
  visibility: Visibility;
  sort_key: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export type AssetRow = {
  id: string;
  world_id: string;
  sha256: string;
  mime: string;
  bytes: number;
  orig_name: string;
  created_by: string | null;
  created_at: number;
}
