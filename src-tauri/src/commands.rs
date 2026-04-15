use crate::cache::CacheStore;
use crate::cleanables::detect_cleanables;
use crate::entry_info;
use crate::scanner;
use crate::settings;
use crate::stats;
use crate::types::*;
use crate::expand_path;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

pub struct AppState {
    pub cache: CacheStore,
    pub scan_cancelled: Arc<AtomicBool>,
}

#[derive(Serialize)]
pub struct ScanResult {
    pub success: bool,
    #[serde(rename = "rootPath", skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct ChildrenResult {
    pub children: Vec<DirEntry>,
}

#[derive(Serialize)]
pub struct CacheListEntry {
    #[serde(rename = "rootPath")]
    pub root_path: String,
    pub timestamp: u64,
}

#[derive(Serialize)]
pub struct CacheListResult {
    pub entries: Vec<CacheListEntry>,
}

#[derive(Serialize)]
pub struct SimpleResult {
    pub success: bool,
}

#[derive(Serialize)]
pub struct ValidateResult {
    pub valid: bool,
}

#[derive(Serialize)]
pub struct SuggestionsResult {
    pub suggestions: Vec<String>,
}

#[derive(Serialize)]
pub struct DeleteResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(rename = "rootPath", skip_serializing_if = "Option::is_none")]
    pub root_path: Option<String>,
}

#[derive(Serialize)]
pub struct BatchDeleteResult {
    pub success: bool,
    #[serde(rename = "deletedCount")]
    pub deleted_count: u32,
    #[serde(rename = "deletedSize")]
    pub deleted_size: u64,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct CachedCleanablesResult {
    pub found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanables: Option<CleanableResult>,
}

#[derive(Serialize)]
pub struct StatsResult {
    pub entries: Vec<StatsEntry>,
    #[serde(rename = "totalFreed")]
    pub total_freed: u64,
    #[serde(rename = "totalDeleted")]
    pub total_deleted: u32,
}

#[tauri::command]
pub async fn scan_directory(
    dir_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ScanResult, String> {
    let target = expand_path(&dir_path);
    if !Path::new(&target).is_dir() {
        return Ok(ScanResult { success: false, root_path: None, error: Some("Directory not found".into()) });
    }

    state.scan_cancelled.store(false, Ordering::Relaxed);
    let cancelled = state.scan_cancelled.clone();
    let max_depth = settings::load_settings().max_depth;

    let result = tokio::task::spawn_blocking(move || {
        scanner::scan_directory(&target, max_depth, cancelled, &app)
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(tree) => {
            let root_path = tree.path.clone();
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
            state.cache.upsert_entry(CacheEntry {
                timestamp: now,
                root_path: root_path.clone(),
                tree,
                cleanables: None,
            });
            Ok(ScanResult { success: true, root_path: Some(root_path), error: None })
        }
        Err(e) if e == "SCAN_CANCELLED" => {
            Ok(ScanResult { success: false, root_path: None, error: Some("SCAN_CANCELLED".into()) })
        }
        Err(e) => Ok(ScanResult { success: false, root_path: None, error: Some(e) }),
    }
}

#[tauri::command]
pub fn get_children(dir_path: String, state: State<'_, AppState>) -> ChildrenResult {
    let resolved = expand_path(&dir_path);
    let children = state.cache.find_dir_entry(&resolved).unwrap_or_default();
    ChildrenResult { children }
}

#[tauri::command]
pub fn get_cache_list(state: State<'_, AppState>) -> CacheListResult {
    let data = state.cache.get_data();
    let mut seen = std::collections::HashSet::new();
    let entries: Vec<CacheListEntry> = data.entries.iter()
        .filter(|e| seen.insert(e.root_path.clone()))
        .map(|e| CacheListEntry { root_path: e.root_path.clone(), timestamp: e.timestamp })
        .collect();
    CacheListResult { entries }
}

#[tauri::command]
pub fn delete_cache_entry(root_path: String, state: State<'_, AppState>) -> SimpleResult {
    state.cache.update(|data| {
        data.entries.retain(|e| e.root_path != root_path);
    });
    SimpleResult { success: true }
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> SimpleResult {
    state.scan_cancelled.store(true, Ordering::Relaxed);
    SimpleResult { success: true }
}

#[tauri::command]
pub fn validate_path(dir_path: String) -> ValidateResult {
    let resolved = expand_path(&dir_path);
    ValidateResult { valid: Path::new(&resolved).is_dir() }
}

#[tauri::command]
pub fn list_dir(partial: String) -> SuggestionsResult {
    let input = if partial.is_empty() { "~".to_string() } else { partial };
    let expanded = expand_path(&input);
    let home = dirs::home_dir().unwrap_or_default().to_string_lossy().to_string();

    let (dir_to_list, prefix) = if input.ends_with('/') || Path::new(&expanded).is_dir() {
        (expanded.clone(), String::new())
    } else {
        let parent = Path::new(&expanded).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(expanded.clone());
        let base = Path::new(&expanded).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        (parent, base)
    };

    if !Path::new(&dir_to_list).is_dir() {
        return SuggestionsResult { suggestions: vec![] };
    }

    let mut suggestions: Vec<String> = Vec::new();
    if let Ok(items) = fs::read_dir(&dir_to_list) {
        for item in items.flatten() {
            if let Ok(ft) = item.file_type() {
                if !ft.is_dir() { continue; }
            }
            let name = item.file_name().to_string_lossy().to_string();
            if name.starts_with('.') { continue; }
            if !prefix.is_empty() && !name.to_lowercase().starts_with(&prefix) { continue; }
            let full = format!("{}/{}", dir_to_list, name);
            let display = if full.starts_with(&home) {
                format!("~{}", &full[home.len()..])
            } else {
                full
            };
            suggestions.push(display);
            if suggestions.len() >= 20 { break; }
        }
    }
    suggestions.sort();
    SuggestionsResult { suggestions }
}

#[tauri::command]
pub fn delete_entry(entry_path: String, state: State<'_, AppState>) -> DeleteResult {
    let resolved = expand_path(&entry_path);
    if !Path::new(&resolved).exists() {
        return DeleteResult { success: false, error: Some("Path does not exist".into()), root_path: None };
    }

    let s = settings::load_settings();
    let delete_result: Result<(), String> = if s.delete_mode == "trash" {
        trash::delete(&resolved).map_err(|e| e.to_string())
    } else {
        if Path::new(&resolved).is_dir() {
            fs::remove_dir_all(&resolved).map_err(|e| e.to_string())
        } else {
            fs::remove_file(&resolved).map_err(|e| e.to_string())
        }
    };

    match delete_result {
        Ok(_) => {
            state.cache.remove_dir_from_cache(&resolved);
            let data = state.cache.get_data();
            let root = data.entries.first().map(|e| e.root_path.clone());
            DeleteResult { success: true, error: None, root_path: root }
        }
        Err(e) => DeleteResult { success: false, error: Some(e), root_path: None },
    }
}

#[tauri::command]
pub fn get_settings() -> AppSettings {
    settings::load_settings()
}

#[tauri::command]
pub fn save_settings(
    max_cache_entries: u32,
    delete_mode: String,
    max_depth: u32,
    state: State<'_, AppState>,
) -> SimpleResult {
    let s = AppSettings {
        max_cache_entries: max_cache_entries.clamp(1, 50),
        delete_mode: if delete_mode == "permanent" { "permanent".into() } else { "trash".into() },
        max_depth: max_depth.clamp(1, 30),
    };
    let _ = settings::save_settings(&s);
    // Trim cache
    state.cache.update(|data| {
        data.entries.truncate(s.max_cache_entries as usize);
    });
    SimpleResult { success: true }
}

#[tauri::command]
pub async fn detect_cleanables_cmd(root_path: String) -> Result<CleanableResult, String> {
    let resolved = expand_path(&root_path);
    if !Path::new(&resolved).is_dir() {
        return Ok(CleanableResult { items: vec![], total_size: 0 });
    }
    let result = tokio::task::spawn_blocking(move || detect_cleanables(&resolved, 8))
        .await
        .map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn get_cached_cleanables(root_path: String, state: State<'_, AppState>) -> CachedCleanablesResult {
    let resolved = expand_path(&root_path);
    match state.cache.get_cached_cleanables(&resolved) {
        Some(c) => CachedCleanablesResult { found: true, cleanables: Some(c) },
        None => CachedCleanablesResult { found: false, cleanables: None },
    }
}

#[tauri::command]
pub fn save_cached_cleanables(
    root_path: String,
    cleanables: CleanableResult,
    state: State<'_, AppState>,
) -> SimpleResult {
    let resolved = expand_path(&root_path);
    SimpleResult { success: state.cache.save_cached_cleanables(&resolved, cleanables) }
}

#[tauri::command]
pub fn batch_delete(paths: Vec<String>, state: State<'_, AppState>) -> BatchDeleteResult {
    let s = settings::load_settings();
    let mut deleted_count: u32 = 0;
    let mut deleted_size: u64 = 0;
    let mut errors: Vec<String> = Vec::new();

    for p in &paths {
        let resolved = expand_path(p);
        if !Path::new(&resolved).exists() {
            errors.push(format!("{}: not found", p));
            continue;
        }
        let size = scanner::get_dir_size_recursive(&resolved);

        let result: Result<(), String> = if s.delete_mode == "trash" {
            trash::delete(&resolved).map_err(|e| e.to_string())
        } else {
            if Path::new(&resolved).is_dir() {
                fs::remove_dir_all(&resolved).map_err(|e| e.to_string())
            } else {
                fs::remove_file(&resolved).map_err(|e| e.to_string())
            }
        };

        match result {
            Ok(_) => {
                deleted_count += 1;
                deleted_size += size;
                state.cache.remove_dir_from_cache(&resolved);
            }
            Err(e) => errors.push(format!("{}: {}", p, e)),
        }
    }

    BatchDeleteResult {
        success: errors.is_empty(),
        deleted_count,
        deleted_size,
        errors,
    }
}

#[tauri::command]
pub fn get_entry_info(entry_path: String) -> Result<entry_info::EntryInfo, String> {
    let resolved = expand_path(&entry_path);
    entry_info::get_entry_info(&resolved)
}

#[tauri::command]
pub fn get_stats(days: u32) -> StatsResult {
    let stats = stats::load_stats();
    let cutoff = chrono::Local::now() - chrono::Duration::days(days as i64);
    let cutoff_str = cutoff.format("%Y-%m-%d").to_string();
    let filtered: Vec<StatsEntry> = stats.entries.into_iter().filter(|e| e.date >= cutoff_str).collect();
    let total_freed = filtered.iter().map(|e| e.freed_bytes).sum();
    let total_deleted = filtered.iter().map(|e| e.delete_count).sum();
    StatsResult { entries: filtered, total_freed, total_deleted }
}

#[tauri::command]
pub fn record_deletion(freed_bytes: u64, delete_count: u32) -> SimpleResult {
    let _ = stats::record_deletion(freed_bytes, delete_count);
    SimpleResult { success: true }
}
