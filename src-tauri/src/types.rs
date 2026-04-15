use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<DirEntry>>,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub timestamp: u64,
    #[serde(rename = "rootPath")]
    pub root_path: String,
    pub tree: DirEntry,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanables: Option<CleanableResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheData {
    pub entries: Vec<CacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(rename = "maxCacheEntries")]
    pub max_cache_entries: u32,
    #[serde(rename = "deleteMode")]
    pub delete_mode: String,
    #[serde(rename = "maxDepth")]
    pub max_depth: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            max_cache_entries: 10,
            delete_mode: "trash".to_string(),
            max_depth: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Dev,
    Ml,
    Office,
    Design,
    Video,
    Music,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanableItem {
    pub path: String,
    #[serde(rename = "projectPath")]
    pub project_path: String,
    #[serde(rename = "projectType")]
    pub project_type: String,
    #[serde(rename = "folderName")]
    pub folder_name: String,
    pub size: u64,
    pub risk: RiskLevel,
    pub category: Category,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanableResult {
    pub items: Vec<CleanableItem>,
    #[serde(rename = "totalSize")]
    pub total_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsEntry {
    pub date: String,
    #[serde(rename = "freedBytes")]
    pub freed_bytes: u64,
    #[serde(rename = "deleteCount")]
    pub delete_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsData {
    pub entries: Vec<StatsEntry>,
}
