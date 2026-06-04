use tauri_plugin_sql::{Migration, MigrationKind};

mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_tasks_table",
            sql: include_str!("../migrations/001_create_tasks.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "soft_ddl_duration",
            sql: include_str!("../migrations/002_soft_ddl_duration.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "pending_inbox_and_source_provenance",
            sql: include_str!("../migrations/003_pending_inbox.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "sync_identity",
            sql: include_str!("../migrations/004_sync_identity.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:cadence.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![db::db_sync])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
