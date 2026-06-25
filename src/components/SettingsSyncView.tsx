import { useState } from "react";
import {
  SyncStatus,
  loadSyncConfig,
  saveSyncConfig,
  clearSyncConfig,
  getDeviceId,
  currentStatus,
  syncNow,
} from "@/lib/sync";

function relativeTime(iso: string | null): string {
  if (!iso) return "从未";
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return iso.slice(0, 16).replace("T", " ");
}

export function SettingsSyncView() {
  const existing = loadSyncConfig();
  const [url, setUrl] = useState(existing?.url ?? "");
  const [token, setToken] = useState(existing?.token ?? "");
  const [status, setStatus] = useState<SyncStatus>(currentStatus());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const deviceId = getDeviceId();
  const connected = status.state !== "unconfigured";

  const handleConnect = () => {
    if (!url.trim() || !token.trim()) {
      setNote("请填写数据库 URL 和 Auth Token");
      return;
    }
    saveSyncConfig({ url: url.trim(), token: token.trim() });
    setStatus(currentStatus());
    setNote("已保存同步配置");
  };

  const handleSync = async () => {
    setBusy(true);
    setNote(null);
    setStatus((s) => ({ ...s, state: "syncing" }));
    const result = await syncNow();
    setStatus(result);
    if (result.message) setNote(result.message);
    setBusy(false);
  };

  const handleLogout = () => {
    clearSyncConfig();
    setUrl("");
    setToken("");
    setStatus(currentStatus());
    setNote("已退出同步");
  };

  const STATE_LABEL: Record<SyncStatus["state"], string> = {
    unconfigured: "未配置",
    idle: "已连接",
    syncing: "同步中…",
    error: "出错",
  };

  return (
    <div className="mx-auto h-full max-w-xl overflow-y-auto p-6">
      <h2 className="text-lg font-semibold">设置 · 多设备同步</h2>
      <p className="mt-1 text-xs text-gray-500">
        通过 Turso / libSQL 在电脑端与苹果端之间同步任务。读走本地副本(离线可用),
        写经云端对账,行级 last-write-wins。
      </p>

      {note && (
        <div className="mt-4 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {note}
        </div>
      )}

      {/* 账户与同步 */}
      <section className="mt-5 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">账户与同步</h3>
        <label className="mt-3 block text-xs text-gray-500">数据库 URL</label>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="libsql://your-db.turso.io"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <label className="mt-3 block text-xs text-gray-500">Auth Token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="••••••••••••"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <button
          onClick={handleConnect}
          className="mt-3 rounded bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          {connected ? "更新配置" : "连接"}
        </button>
      </section>

      {/* 同步状态 */}
      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">同步状态</h3>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">状态</dt>
            <dd
              className={
                status.state === "error"
                  ? "text-red-600"
                  : status.state === "idle"
                    ? "text-green-600"
                    : "text-gray-700"
              }
            >
              {STATE_LABEL[status.state]}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">上次同步</dt>
            <dd className="text-gray-700">{relativeTime(status.lastSyncedAt)}</dd>
          </div>
        </dl>
        <button
          onClick={handleSync}
          disabled={busy || !connected}
          className="mt-3 rounded border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          立即同步
        </button>
      </section>

      {/* 本设备 */}
      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">本设备</h3>
        <p className="mt-2 break-all text-xs text-gray-500">设备 ID:{deviceId}</p>
      </section>

      {/* 实验性:数据引擎 */}
      <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">实验性 · 数据引擎</h3>
        <p className="mt-1 text-xs text-gray-500">
          切到 libSQL 引擎后,本地读写经 libSQL,并可与 Turso 同步。默认关闭(用
          tauri-plugin-sql)。切换后需重启应用生效。
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            defaultChecked={localStorage.getItem("cadence.useLibsql") === "1"}
            onChange={(e) => {
              localStorage.setItem(
                "cadence.useLibsql",
                e.target.checked ? "1" : "0",
              );
              setNote("已切换数据引擎,请重启应用生效。");
            }}
          />
          启用 libSQL 引擎(实验)
        </label>
      </section>

      {connected && (
        <button
          onClick={handleLogout}
          className="mt-5 text-sm text-red-600 hover:underline"
        >
          退出同步
        </button>
      )}
    </div>
  );
}
