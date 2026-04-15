mod cache;
mod cleanables;
mod commands;
mod entry_info;
mod scanner;
mod settings;
mod stats;
mod types;

use commands::AppState;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub fn app_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    home.join(".ingombro")
}

pub fn expand_path(p: &str) -> String {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    let result = if p.starts_with("~/") {
        home.join(&p[2..]).to_string_lossy().to_string()
    } else if p == "~" {
        home.to_string_lossy().to_string()
    } else {
        let path = Path::new(p);
        if path.is_absolute() {
            p.to_string()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("/"))
                .join(p)
                .to_string_lossy()
                .to_string()
        }
    };
    // Remove trailing slash unless root
    if result.len() > 1 && result.ends_with('/') {
        result[..result.len() - 1].to_string()
    } else {
        result
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ensure app directory exists
    let _ = std::fs::create_dir_all(app_dir());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            cache: cache::CacheStore::new(),
            scan_cancelled: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_directory,
            commands::get_children,
            commands::get_cache_list,
            commands::delete_cache_entry,
            commands::cancel_scan,
            commands::validate_path,
            commands::list_dir,
            commands::delete_entry,
            commands::get_settings,
            commands::save_settings,
            commands::detect_cleanables_cmd,
            commands::get_cached_cleanables,
            commands::save_cached_cleanables,
            commands::batch_delete,
            commands::get_entry_info,
            commands::get_stats,
            commands::record_deletion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
