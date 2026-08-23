import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AssetDto } from "@dndworldapp/schema";
import sharp from "sharp";
import { db } from "../db/index.ts";
import type { AssetRow } from "../db/types.ts";
import { paths } from "../env.ts";
import { badRequest, notFound } from "../lib/errors.ts";
import { shortId } from "../lib/id.ts";

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/avif",
]);

const selectBySha = db.prepare("SELECT * FROM assets WHERE world_id = ? AND sha256 = ?");
const selectById = db.prepare("SELECT * FROM assets WHERE id = ?");
const insertAsset = db.prepare(`
  INSERT INTO assets (id, world_id, sha256, mime, bytes, orig_name, created_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateDimensions = db.prepare("UPDATE assets SET width = ?, height = ? WHERE id = ?");

function extensionFor(mime: string, origName: string): string {
  const fromName = path.extname(origName).toLowerCase();
  if (fromName.length > 1 && fromName.length <= 6) return fromName;
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/svg+xml") return ".svg";
  if (mime === "image/avif") return ".avif";
  return ".bin";
}

/** Content-addressed: the same image uploaded twice costs one file on disk. */
export function storeAsset(
  worldId: string,
  userId: string | null,
  data: Buffer,
  mime: string,
  origName: string,
): AssetDto {
  if (!ALLOWED_MIME.has(mime)) {
    throw badRequest(`Unsupported file type: ${mime}`);
  }

  const sha = createHash("sha256").update(data).digest("hex");
  const existing = selectBySha.get(worldId, sha) as AssetRow | undefined;
  if (existing !== undefined) return toDto(existing);

  const ext = extensionFor(mime, origName);
  const dir = path.join(paths.assets, sha.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sha}${ext}`), data);

  const id = shortId(12);
  insertAsset.run(id, worldId, sha, mime, data.byteLength, origName, userId, Date.now());
  return toDto(selectBySha.get(worldId, sha) as AssetRow);
}

export function toDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    url: `/media/${row.sha256.slice(0, 2)}/${row.sha256}${extensionFor(row.mime, row.orig_name)}`,
    mime: row.mime,
    bytes: row.bytes,
    origName: row.orig_name,
  };
}

export function filePathFor(row: AssetRow): string {
  return path.join(paths.assets, row.sha256.slice(0, 2), `${row.sha256}${extensionFor(row.mime, row.orig_name)}`);
}

export function getAssetRow(assetId: string): AssetRow | null {
  return (selectById.get(assetId) as AssetRow | undefined) ?? null;
}

/**
 * Lazily backfills width/height by reading only the file's header (sharp's own
 * metadata() call is already a header read, not a full decode) — mirrors Kanka's
 * own Image::ensureDimensions(). Not computed at upload time, so ordinary editor
 * image uploads never pay this cost; only a map, which needs pixel bounds, calls it.
 */
export async function ensureAssetDimensions(assetId: string): Promise<{ width: number; height: number }> {
  const row = getAssetRow(assetId);
  if (row === null) throw notFound("No such asset.");
  if (row.width !== null && row.height !== null) return { width: row.width, height: row.height };

  const { width, height } = await sharp(filePathFor(row)).metadata();
  if (width === undefined || height === undefined) {
    throw badRequest("Could not read that image's dimensions.");
  }
  updateDimensions.run(width, height, assetId);
  return { width, height };
}
