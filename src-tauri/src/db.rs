// Phase-0 spike for multi-device sync via Turso/libSQL embedded replicas.
//
// This is intentionally a SPIKE: it proves the `libsql` dependency compiles and
// links inside the Tauri app and that the embedded-replica + sync() API is
// usable. It does NOT yet replace tauri-plugin-sql as the app's data engine —
// that engine swap is the next step (and is what the frontend `db.ts` will be
// rewritten against). The frontend `syncNow()` already invokes `db_sync`.

use libsql::Builder;
use tauri::Manager;

/// Open the local embedded replica that syncs to the Turso primary, pull/push
/// once, and run a trivial query to confirm the connection works.
///
/// `url`/`token` come from the Settings screen; `device_id` is the stable
/// per-device id (currently informational, will tag writes during the engine swap).
#[tauri::command]
pub async fn db_sync(
    app: tauri::AppHandle,
    url: String,
    token: String,
    device_id: String,
) -> Result<String, String> {
    // Keep the replica next to the app's data dir, separate from cadence.db
    // until the full engine swap lands.
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位 app 数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let replica_path = dir.join("cadence-replica.db");

    let db = Builder::new_remote_replica(replica_path, url, token)
        .build()
        .await
        .map_err(|e| format!("打开 libSQL 副本失败: {e}"))?;

    let synced = db.sync().await.map_err(|e| format!("同步失败: {e}"))?;

    let conn = db.connect().map_err(|e| e.to_string())?;
    conn.query("SELECT 1", ())
        .await
        .map_err(|e| format!("校验查询失败: {e}"))?;

    Ok(format!(
        "device={device_id} synced (frame_no={:?})",
        synced.frame_no()
    ))
}
