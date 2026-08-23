import type { FieldType, FieldVisibility, MarkerShape, NodeKind, Role, Visibility } from "@dndworldapp/schema";

/** Row shapes, mirroring migrations/*.sql. SQLite booleans are 0/1 integers. */

export type UserRow = {
  id: string;
  username: string;
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
  /** Nullable, lazily backfilled — see services/assets.ts::ensureAssetDimensions. */
  width: number | null;
  height: number | null;
  created_by: string | null;
  created_at: number;
}

export type TemplateRow = {
  id: string;
  world_id: string;
  name: string;
  icon: string | null;
  /** JSON: TemplateFieldDef[] — parsed at the service layer. */
  field_schema: string;
  default_body_md: string;
  created_at: number;
  updated_at: number;
}

export type FieldRow = {
  id: string;
  node_id: string;
  key: string;
  type: FieldType;
  value_text: string | null;
  value_num: number | null;
  value_ref: string | null;
  sort_key: string;
  visibility: FieldVisibility;
}

export type MapRow = {
  node_id: string;
  asset_id: string;
  min_zoom: number;
  max_zoom: number;
  tiling_status: "none" | "pending" | "running" | "ready" | "error";
  tiling_error: string | null;
  fog_enabled: number;
  fog_mask_updated_at: number | null;
  created_at: number;
  updated_at: number;
}

export type MapMarkerRow = {
  id: string;
  map_node_id: string;
  layer_id: string | null;
  target_node_id: string | null;
  parent_marker_id: string | null;
  shape: MarkerShape;
  x: number;
  y: number;
  points: string | null;
  label: string | null;
  icon: string | null;
  color: string | null;
  members: string | null;
  revealed: number;
  visibility: FieldVisibility;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}
