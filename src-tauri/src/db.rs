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

/// Pull/push the embedded replica against the Turso primary.
#[tauri::command]
pub async fn db_sync(
    app: tauri::AppHandle,
    url: String,
    token: String,
    device_id: String,
) -> Result<String, String> {
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
    let rep = db.sync().await.map_err(|e| format!("同步失败: {e}"))?;
    let conn = db.connect().map_err(|e| e.to_string())?;
    conn.query("SELECT 1", ())
        .await
        .map_err(|e| format!("校验查询失败: {e}"))?;
    Ok(format!(
        "device={device_id} synced (frame_no={:?})",
        rep.frame_no()
    ))
}
