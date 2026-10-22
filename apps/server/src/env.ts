import path from "node:path";

const DEV_SECRET = "dev-insecure-secret-do-not-ship";

function required(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const env = {
  port: Number(required("PORT", "8080")),
  host: required("HOST", "0.0.0.0"),
  dataDir: path.resolve(required("DATA_DIR", "./data")),
  baseUrl: required("BASE_URL", "http://localhost:8080"),
  sessionSecret: required("SESSION_SECRET", DEV_SECRET),
  logLevel: required("LOG_LEVEL", "info"),
  isProduction: process.env.NODE_ENV === "production",
  /** The login screen's one-click read-only "Guest Login". Set GUEST_LOGIN=off to remove it. */
  guestLogin: (process.env.GUEST_LOGIN ?? "on").toLowerCase() !== "off",
};

export const paths = {
  db: path.join(env.dataDir, "worldapp.db"),
  assets: path.join(env.dataDir, "assets"),
  tiles: path.join(env.dataDir, "tiles"),
  /** Fog-of-war masks and the player-view renders made from them — see services/fog.ts. */
  fog: path.join(env.dataDir, "fog"),
};

/** Refuse to boot a production container with the development secret. */
export function assertProductionSafe(): void {
  if (env.isProduction && env.sessionSecret === DEV_SECRET) {
    throw new Error(
      "SESSION_SECRET is unset. Generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
}

export const cookieSecure = env.baseUrl.startsWith("https://");
