// libSQL data layer for multi-device sync (Turso). Built behind an OFF-by-default
// frontend flag (see src/lib/db.ts): until flipped, the app keeps using
// tauri-plugin-sql, so this path is additive and non-breaking.
//
// Commands:
//   db_select(sql, params)  -> rows as JSON objects
//   db_execute(sql, params) -> { rowsAffected, lastInsertId }
//   db_sync(url, token, deviceId) -> pull/push the embedded replica
//
// The connection is opened lazily on first use against the same cadence.db the
// app already uses, and an idempotent migrator brings the schema up to date
// (introspection-based, so it is safe on a DB previously migrated by sqlx).

use libsql::{Builder, Connection, Database, Value};
use serde::Serialize;
use serde_json::{Map, Number, Value as Json};
use std::sync::Arc;
use tauri::async_runtime::Mutex;
use tauri::{Manager, State};

#[derive(Default)]
pub struct LibsqlState {
    inner: Mutex<Option<Handle>>,
}

struct Handle {
    // Held to keep the libSQL database alive for the lifetime of `conn`.
    #[allow(dead_code)]
    db: Arc<Database>,
    conn: Connection,
}

#[derive(Serialize)]
pub struct ExecResult {
    #[serde(rename = "rowsAffected")]
    rows_affected: u64,
    #[serde(rename = "lastInsertId")]
    last_insert_id: i64,
}

fn json_to_value(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(if *b { 1 } else { 0 }),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else {
                Value::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        // Arrays/objects aren't used as bind params here; store as text.
        other => Value::Text(other.to_string()),
    }
}

fn value_to_json(v: Value) -> Json {
    match v {
        Value::Null => Json::Null,
        Value::Integer(i) => Json::Number(Number::from(i)),
        Value::Real(f) => Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        Value::Text(s) => Json::String(s),
        Value::Blob(b) => Json::String(format!("<blob:{} bytes>", b.len())),
    }
}

fn bind_params(params: &[Json]) -> Vec<Value> {
    params.iter().map(json_to_value).collect()
}

async fn column_exists(conn: &Connection, table: &str, col: &str) -> Result<bool, String> {
    let mut rows = conn
        .query(&format!("PRAGMA table_info({table})"), ())
        .await
        .map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        // column 1 of table_info is the name
        if let Ok(Value::Text(name)) = row.get_value(1) {
            if name == col {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

async fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    col: &str,
    decl: &str,
) -> Result<(), String> {
    if !column_exists(conn, table, col).await? {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}"), ())
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Idempotent migrator: brings the schema to v004 regardless of how far a prior
/// engine (sqlx) had taken it. Every step is guarded (IF NOT EXISTS / column check).
async fn migrate(conn: &Connection) -> Result<(), String> {
    // 001 base table + indexes
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           title TEXT NOT NULL,
           description TEXT,
           dimension TEXT NOT NULL,
           importance INTEGER NOT NULL,
           urgency INTEGER NOT NULL,
           position REAL NOT NULL DEFAULT 1000,
           ddl_type TEXT,
           ddl_date TEXT,
           status TEXT NOT NULL DEFAULT 'active',
           tags TEXT,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           completed_at TEXT,
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE INDEX IF NOT EXISTS idx_tasks_status_dimension ON tasks(status, dimension);
         CREATE INDEX IF NOT EXISTS idx_tasks_quadrant_position ON tasks(dimension, importance, urgency, position);
         CREATE INDEX IF NOT EXISTS idx_tasks_ddl ON tasks(ddl_date) WHERE ddl_date IS NOT NULL;",
    )
    .await
    .map_err(|e| e.to_string())?;

    // 002 soft ddl
    add_column_if_missing(conn, "tasks", "ddl_duration_days", "INTEGER").await?;
    add_column_if_missing(conn, "tasks", "ddl_set_at", "TEXT").await?;

    // 003 provenance + pending inbox
    add_column_if_missing(conn, "tasks", "source", "TEXT").await?;
    add_column_if_missing(conn, "tasks", "source_ref", "TEXT").await?;
    add_column_if_missing(conn, "tasks", "ingest_confidence", "REAL").await?;
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source_ref ON tasks(source_ref) WHERE source_ref IS NOT NULL;
         CREATE TABLE IF NOT EXISTS pending_items (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           dedupe_key TEXT NOT NULL,
           source TEXT NOT NULL DEFAULT 'feishu',
           source_chat_id TEXT, source_chat_name TEXT,
           source_message_id TEXT, source_sender TEXT, source_msg_ts TEXT,
           raw_text TEXT NOT NULL,
           guess_title TEXT NOT NULL, guess_description TEXT,
           guess_dimension TEXT, guess_importance INTEGER, guess_urgency INTEGER,
           guess_ddl_type TEXT, guess_ddl_date TEXT, guess_ddl_duration_days INTEGER,
           confidence REAL NOT NULL DEFAULT 0,
           status TEXT NOT NULL DEFAULT 'pending',
           triaged_task_id INTEGER,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_dedupe ON pending_items(dedupe_key);
         CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_items(status, created_at);",
    )
    .await
    .map_err(|e| e.to_string())?;

    // 004 sync identity
    for (table, col, decl) in [
        ("tasks", "uuid", "TEXT"),
        ("tasks", "device_id", "TEXT"),
        ("tasks", "deleted_at", "TEXT"),
        ("pending_items", "uuid", "TEXT"),
        ("pending_items", "device_id", "TEXT"),
        ("pending_items", "deleted_at", "TEXT"),
    ] {
        add_column_if_missing(conn, table, col, decl).await?;
    }
    let backfill = "
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
      substr(lower(hex(randomblob(2))), 2) || '-' ||
      substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) ||
      '-' || lower(hex(randomblob(6)))";
    conn.execute(
        &format!("UPDATE tasks SET uuid = ({backfill}) WHERE uuid IS NULL"),
        (),
    )
    .await
    .map_err(|e| e.to_string())?;
    conn.execute(
        &format!("UPDATE pending_items SET uuid = ({backfill}) WHERE uuid IS NULL"),
        (),
    )
    .await
    .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_uuid ON tasks(uuid);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_uuid ON pending_items(uuid);
         CREATE INDEX IF NOT EXISTS idx_tasks_alive ON tasks(status, deleted_at);",
    )
    .await
    .map_err(|e| e.to_string())?;

    // 005 customizable two-level categories (mirrors migrations/005_categories.sql).
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS categories (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           uuid TEXT NOT NULL UNIQUE,
           parent_uuid TEXT,
           kind TEXT NOT NULL,
           name TEXT NOT NULL,
           is_preset INTEGER NOT NULL DEFAULT 0,
           position REAL NOT NULL DEFAULT 1000,
           created_at TEXT NOT NULL DEFAULT (datetime('now')),
           updated_at TEXT NOT NULL DEFAULT (datetime('now')),
           deleted_at TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_categories_alive ON categories(deleted_at, kind, parent_uuid, position);",
    )
    .await
    .map_err(|e| e.to_string())?;
    add_column_if_missing(conn, "tasks", "subcategory_uuid", "TEXT").await?;
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_tasks_subcategory ON tasks(subcategory_uuid) WHERE subcategory_uuid IS NOT NULL;",
    )
    .await
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO categories (uuid, parent_uuid, kind, name, is_preset, position) VALUES
           ('00000000-0000-4000-8000-000000000001', NULL, 'work', '工作', 1, 1000),
           ('00000000-0000-4000-8000-000000000002', NULL, 'life', '生活', 1, 2000)",
        (),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

async fn ensure_open(app: &tauri::AppHandle, state: &State<'_, LibsqlState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if guard.is_some() {
        return Ok(());
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位 app 数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("cadence.db");
    let db = Builder::new_local(path)
        .build()
        .await
        .map_err(|e| format!("打开 libSQL 失败: {e}"))?;
    let conn = db.connect().map_err(|e| e.to_string())?;
    migrate(&conn).await?;
    *guard = Some(Handle {
        db: Arc::new(db),
        conn,
    });
    Ok(())
}

#[tauri::command]
pub async fn db_select(
    app: tauri::AppHandle,
    state: State<'_, LibsqlState>,
    sql: String,
    params: Vec<Json>,
) -> Result<Vec<Json>, String> {
    ensure_open(&app, &state).await?;
    let guard = state.inner.lock().await;
    let handle = guard.as_ref().ok_or("libSQL 未初始化")?;
    let mut rows = handle
        .conn
        .query(&sql, bind_params(&params))
        .await
        .map_err(|e| e.to_string())?;

    let mut out: Vec<Json> = Vec::new();
    let cols = rows.column_count();
    let names: Vec<String> = (0..cols)
        .map(|i| rows.column_name(i).unwrap_or("?").to_string())
        .collect();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let mut obj = Map::new();
        for i in 0..cols {
            let v = row.get_value(i).map_err(|e| e.to_string())?;
            obj.insert(names[i as usize].clone(), value_to_json(v));
        }
        out.push(Json::Object(obj));
    }
    Ok(out)
}

#[tauri::command]
pub async fn db_execute(
    app: tauri::AppHandle,
    state: State<'_, LibsqlState>,
    sql: String,
    params: Vec<Json>,
) -> Result<ExecResult, String> {
    ensure_open(&app, &state).await?;
    let guard = state.inner.lock().await;
    let handle = guard.as_ref().ok_or("libSQL 未初始化")?;
    let rows_affected = handle
        .conn
        .execute(&sql, bind_params(&params))
        .await
        .map_err(|e| e.to_string())?;
    let last_insert_id = handle.conn.last_insert_rowid();
    Ok(ExecResult {
        rows_affected,
        last_insert_id,
    })
}

/// Pull/push the app's embedded replica against the Turso primary.
///
/// Critically, this opens the SAME `cadence.db` that `db_select`/`db_execute`
/// read and write, as an embedded remote replica, and then keeps that synced
/// handle as the live connection in `LibsqlState`. Previously this synced a
/// separate `cadence-replica.db` that the UI never read, so pressing “立即同步”
/// updated `lastSyncedAt` without ever pushing local data or pulling remote
/// data into the database the app actually displays.
///
/// NOTE: a libSQL file may be held open by only one `Database` at a time, so we
/// drop any existing (local) handle before adopting the file as a replica.
/// First-sync reconciliation of data written before adoption against an empty
/// primary should be verified against a real Turso instance before relying on
/// it; this path is gated behind the off-by-default libSQL engine.
#[tauri::command]
pub async fn db_sync(
    app: tauri::AppHandle,
    state: State<'_, LibsqlState>,
    url: String,
    token: String,
    device_id: String,
) -> Result<String, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位 app 数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("cadence.db");

    let mut guard = state.inner.lock().await;
    // Release any existing local handle so the file is free to be reopened as a
    // replica. On error below the state stays None and the next db_select call
    // reopens it locally via ensure_open.
    *guard = None;

    let db = Builder::new_remote_replica(path, url, token)
        .build()
        .await
        .map_err(|e| format!("打开 libSQL 副本失败: {e}"))?;
    let rep = db.sync().await.map_err(|e| format!("同步失败: {e}"))?;
    let conn = db.connect().map_err(|e| e.to_string())?;
    // Remote may be brand new / behind on schema; bring it up to date.
    migrate(&conn).await?;
    conn.query("SELECT 1", ())
        .await
        .map_err(|e| format!("校验查询失败: {e}"))?;

    // Keep the synced replica as the live handle so subsequent reads/writes go
    // through it (and get pushed on the next sync).
    *guard = Some(Handle {
        db: Arc::new(db),
        conn,
    });

    Ok(format!(
        "device={device_id} synced (frame_no={:?})",
        rep.frame_no()
    ))
}
