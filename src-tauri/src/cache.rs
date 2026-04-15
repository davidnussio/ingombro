use crate::types::{CacheData, CacheEntry, CleanableResult, DirEntry};
use crate::settings::load_settings;
use crate::app_dir;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Mutex;

fn cache_path() -> PathBuf {
    app_dir().join("cache.json.gz")
}

pub struct CacheStore {
    data: Mutex<CacheData>,
}

impl CacheStore {
    pub fn new() -> Self {
        let data = load_cache_from_disk();
        Self {
            data: Mutex::new(data),
        }
    }

    pub fn get_data(&self) -> CacheData {
        self.data.lock().unwrap().clone()
    }

    pub fn update<F>(&self, f: F)
    where
        F: FnOnce(&mut CacheData),
    {
        let mut data = self.data.lock().unwrap();
        f(&mut data);
        save_cache_to_disk(&data);
    }

    pub fn upsert_entry(&self, entry: CacheEntry) {
        self.update(|data| {
            let settings = load_settings();
            data.entries.retain(|e| e.root_path != entry.root_path);
            data.entries.insert(0, entry);
            data.entries
                .truncate(settings.max_cache_entries as usize);
        });
    }

    pub fn find_entry(&self, root_path: &str) -> Option<CacheEntry> {
        let data = self.data.lock().unwrap();
        data.entries
            .iter()
            .find(|e| e.root_path == root_path)
            .cloned()
    }

    pub fn find_dir_entry(&self, dir_path: &str) -> Option<Vec<DirEntry>> {
        let data = self.data.lock().unwrap();
        for cache_entry in &data.entries {
            if dir_path.starts_with(&cache_entry.root_path)
                || cache_entry.root_path == dir_path
            {
                if let Some(found) = find_in_tree(&cache_entry.tree, dir_path) {
                    return found.children.clone();
                }
            }
        }
        None
    }

    pub fn remove_dir_from_cache(&self, target_path: &str) -> bool {
        let mut data = self.data.lock().unwrap();
        let mut modified = false;
        for entry in &mut data.entries {
            if remove_from_tree(&mut entry.tree, target_path) > 0 {
                modified = true;
                break;
            }
        }
        if modified {
            save_cache_to_disk(&data);
        }
        modified
    }

    pub fn get_cached_cleanables(&self, root_path: &str) -> Option<CleanableResult> {
        let data = self.data.lock().unwrap();
        data.entries
            .iter()
            .find(|e| e.root_path == root_path)
            .and_then(|e| e.cleanables.clone())
    }

    pub fn save_cached_cleanables(
        &self,
        root_path: &str,
        cleanables: CleanableResult,
    ) -> bool {
        let mut data = self.data.lock().unwrap();
        if let Some(entry) = data.entries.iter_mut().find(|e| e.root_path == root_path) {
            entry.cleanables = Some(cleanables);
            save_cache_to_disk(&data);
            return true;
        }
        false
    }
}

fn find_in_tree<'a>(entry: &'a DirEntry, path: &str) -> Option<&'a DirEntry> {
    if entry.path == path {
        return Some(entry);
    }
    if let Some(children) = &entry.children {
        for child in children {
            if let Some(found) = find_in_tree(child, path) {
                return Some(found);
            }
        }
    }
    None
}

fn remove_from_tree(entry: &mut DirEntry, target: &str) -> u64 {
    if let Some(children) = &mut entry.children {
        if let Some(idx) = children.iter().position(|c| c.path == target) {
            let removed_size = children[idx].size;
            children.remove(idx);
            entry.size -= removed_size;
            return removed_size;
        }
        for child in children.iter_mut() {
            let removed = remove_from_tree(child, target);
            if removed > 0 {
                entry.size -= removed;
                return removed;
            }
        }
    }
    0
}

fn load_cache_from_disk() -> CacheData {
    let path = cache_path();
    if !path.exists() {
        return CacheData { entries: vec![] };
    }
    match fs::read(&path) {
        Ok(compressed) => {
            let mut decoder = GzDecoder::new(&compressed[..]);
            let mut json = String::new();
            if decoder.read_to_string(&mut json).is_ok() {
                if let Ok(data) = serde_json::from_str::<CacheData>(&json) {
                    return data;
                }
            }
            // Try as plain JSON (migration)
            if let Ok(json) = String::from_utf8(compressed) {
                if let Ok(data) = serde_json::from_str::<CacheData>(&json) {
                    return data;
                }
            }
            CacheData { entries: vec![] }
        }
        Err(_) => CacheData { entries: vec![] },
    }
}

fn save_cache_to_disk(data: &CacheData) {
    let path = cache_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(data) {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        if encoder.write_all(json.as_bytes()).is_ok() {
            if let Ok(compressed) = encoder.finish() {
                let _ = fs::write(&path, compressed);
            }
        }
    }
}
