import { invoke } from "@tauri-apps/api/core";

// Turso/libSQL multi-device sync — frontend config + status. The actual replica
// + push/pull lives behind a Tauri command `db_sync` (Rust libSQL). Until that
// command is registered, syncNow() surfaces a clear "engine not wired" state.

const CFG_KEY = "cadence.sync.config";
const DEVICE_KEY = "cadence.sync.deviceId";
const LAST_KEY = "cadence.sync.lastSyncedAt";

export interface SyncConfig {
  url: string; // libsql://<db>.turso.io
  token: string; // auth token
}

export type SyncState = "unconfigured" | "idle" | "syncing" | "error";

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt: string | null;
  message?: string;
}

export function loadSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as SyncConfig;
    return c.url && c.token ? c : null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(c: SyncConfig): void {
  localStorage.setItem(CFG_KEY, JSON.stringify(c));
}

export function clearSyncConfig(): void {
  localStorage.removeItem(CFG_KEY);
}

/** Stable per-device id, generated once and persisted locally. */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getLastSyncedAt(): string | null {
  return localStorage.getItem(LAST_KEY);
}

export function currentStatus(): SyncStatus {
  if (!loadSyncConfig()) return { state: "unconfigured", lastSyncedAt: null };
  return { state: "idle", lastSyncedAt: getLastSyncedAt() };
}

/**
 * Trigger a sync round. Calls the Rust `db_sync` command with the configured
 * Turso credentials + this device id. Returns the resulting status; never
 * throws (errors are folded into the status so callers can render them).
 */
export async function syncNow(): Promise<SyncStatus> {
  const cfg = loadSyncConfig();
  if (!cfg) return { state: "unconfigured", lastSyncedAt: getLastSyncedAt() };
  try {
    await invoke("db_sync", {
      url: cfg.url,
      token: cfg.token,
      deviceId: getDeviceId(),
    });
    const now = new Date().toISOString();
    localStorage.setItem(LAST_KEY, now);
    return { state: "idle", lastSyncedAt: now };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The command won't exist until the libSQL engine is wired in src-tauri.
    const friendly = /not.*(found|registered)|missing|db_sync/i.test(msg)
      ? "同步引擎尚未接入(待 libSQL 集成);配置已保存。"
      : msg;
    return { state: "error", lastSyncedAt: getLastSyncedAt(), message: friendly };
  }
}
