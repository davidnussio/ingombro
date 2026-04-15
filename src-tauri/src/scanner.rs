use crate::types::DirEntry;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
struct ScanProgress {
    #[serde(rename = "currentDir")]
    current_dir: String,
}

pub fn scan_directory(
    dir_path: &str,
    max_depth: u32,
    cancelled: Arc<AtomicBool>,
    app: &AppHandle,
) -> Result<DirEntry, String> {
    let path = Path::new(dir_path);
    if !path.is_dir() {
        return Err("Directory not found".to_string());
    }

    let mut last_progress = std::time::Instant::now();
    scan_recursive(dir_path, 0, max_depth, &cancelled, app, &mut last_progress)
}

fn scan_recursive(
    dir_path: &str,
    depth: u32,
    max_depth: u32,
    cancelled: &Arc<AtomicBool>,
    app: &AppHandle,
    last_progress: &mut std::time::Instant,
) -> Result<DirEntry, String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("SCAN_CANCELLED".to_string());
    }

    let name = Path::new(dir_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| dir_path.to_string());

    let mut entry = DirEntry {
        path: dir_path.to_string(),
        name,
        size: 0,
        children: Some(Vec::new()),
        is_dir: true,
    };

    // Send progress every 200ms
    if last_progress.elapsed().as_millis() > 200 {
        let _ = app.emit("scan-progress", ScanProgress {
            current_dir: dir_path.to_string(),
        });
        *last_progress = std::time::Instant::now();
    }

    let items = match fs::read_dir(dir_path) {
        Ok(items) => items,
        Err(_) => return Ok(entry),
    };

    let children = entry.children.as_mut().unwrap();

    for item in items {
        if cancelled.load(Ordering::Relaxed) {
            return Err("SCAN_CANCELLED".to_string());
        }

        let item = match item {
            Ok(i) => i,
            Err(_) => continue,
        };

        let item_name = item.file_name().to_string_lossy().to_string();
        if item_name.starts_with('.') || item_name == "node_modules" || item_name == ".Trash" {
            continue;
        }

        let full_path = format!("{}/{}", dir_path, item_name);
        let file_type = match item.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };

        if file_type.is_dir() {
            if depth < max_depth {
                match scan_recursive(&full_path, depth + 1, max_depth, cancelled, app, last_progress) {
                    Ok(child) => {
                        entry.size += child.size;
                        children.push(child);
                    }
                    Err(e) if e == "SCAN_CANCELLED" => return Err(e),
                    Err(_) => continue,
                }
            } else {
                let size = get_dir_size_shallow(&full_path);
                children.push(DirEntry {
                    path: full_path,
                    name: item_name,
                    size,
                    children: None,
                    is_dir: true,
                });
                entry.size += size;
            }
        } else if file_type.is_file() {
            let size = get_file_disk_size(&full_path);
            children.push(DirEntry {
                path: full_path,
                name: item_name,
                size,
                children: None,
                is_dir: false,
            });
            entry.size += size;
        }
    }

    children.sort_by(|a, b| b.size.cmp(&a.size));
    Ok(entry)
}

fn get_dir_size_shallow(dir_path: &str) -> u64 {
    let mut total: u64 = 0;
    if let Ok(items) = fs::read_dir(dir_path) {
        for item in items {
            if let Ok(item) = item {
                let name = item.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let full_path = format!("{}/{}", dir_path, name);
                if let Ok(ft) = item.file_type() {
                    if ft.is_file() {
                        total += get_file_disk_size(&full_path);
                    } else if ft.is_dir() {
                        total += get_dir_size_shallow(&full_path);
                    }
                }
            }
        }
    }
    total
}

pub fn get_dir_size_recursive(dir_path: &str) -> u64 {
    let mut total: u64 = 0;
    if let Ok(items) = fs::read_dir(dir_path) {
        for item in items {
            if let Ok(item) = item {
                let full_path = format!("{}/{}", dir_path, item.file_name().to_string_lossy());
                if let Ok(ft) = item.file_type() {
                    if ft.is_file() || ft.is_symlink() {
                        total += get_file_disk_size(&full_path);
                    } else if ft.is_dir() {
                        total += get_dir_size_recursive(&full_path);
                    }
                }
            }
        }
    }
    total
}

/// Get file disk usage. On macOS/Linux uses blocks * 512, on Windows uses file size.
fn get_file_disk_size(path: &str) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let Ok(meta) = fs::metadata(path) {
            return meta.blocks() * 512;
        }
        0
    }
    #[cfg(not(unix))]
    {
        if let Ok(meta) = fs::metadata(path) {
            return meta.len();
        }
        0
    }
}
