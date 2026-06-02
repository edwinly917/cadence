import os from "node:os";
import path from "node:path";

const BUNDLE_ID = "com.willyliu.cadence";
const DB_FILE = "cadence.db";

/**
 * Resolve the SQLite file the Tauri app uses. Mirrors tauri_plugin_sql's
 * appConfigDir resolution of the "sqlite:cadence.db" URL.
 */
export function resolveDbPath(override?: string): string {
  if (override && override.trim()) return override.trim();
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", BUNDLE_ID, DB_FILE);
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), BUNDLE_ID, DB_FILE);
  }
  return path.join(home, ".config", BUNDLE_ID, DB_FILE);
}
