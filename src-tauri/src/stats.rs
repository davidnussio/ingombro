use crate::types::{StatsData, StatsEntry};
use crate::app_dir;
use std::fs;
use std::path::PathBuf;

fn stats_path() -> PathBuf {
    app_dir().join("stats.json")
}

pub fn load_stats() -> StatsData {
    let path = stats_path();
    if path.exists() {
        if let Ok(data) = fs::read_to_string(&path) {
            if let Ok(s) = serde_json::from_str::<StatsData>(&data) {
                return s;
            }
        }
    }
    StatsData { entries: vec![] }
}

pub fn save_stats(data: &StatsData) -> Result<(), String> {
    let path = stats_path();
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn record_deletion(freed_bytes: u64, delete_count: u32) -> Result<(), String> {
    let mut stats = load_stats();
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    if let Some(entry) = stats.entries.iter_mut().find(|e| e.date == today) {
        entry.freed_bytes += freed_bytes;
        entry.delete_count += delete_count;
    } else {
        stats.entries.push(StatsEntry {
            date: today,
            freed_bytes,
            delete_count,
        });
    }

    stats.entries.sort_by(|a, b| a.date.cmp(&b.date));
    if stats.entries.len() > 90 {
        let start = stats.entries.len() - 90;
        stats.entries = stats.entries[start..].to_vec();
    }

    save_stats(&stats)
}
