use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct EntryInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    #[serde(rename = "modifiedAt")]
    pub modified_at: f64,
    #[serde(rename = "createdAt")]
    pub created_at: f64,
    #[serde(rename = "fileCount", skip_serializing_if = "Option::is_none")]
    pub file_count: Option<u32>,
    #[serde(rename = "dirCount", skip_serializing_if = "Option::is_none")]
    pub dir_count: Option<u32>,
    #[serde(rename = "largestFile", skip_serializing_if = "Option::is_none")]
    pub largest_file: Option<NameSize>,
    #[serde(rename = "newestFile", skip_serializing_if = "Option::is_none")]
    pub newest_file: Option<NameModified>,
    #[serde(rename = "typeDistribution", skip_serializing_if = "Option::is_none")]
    pub type_distribution: Option<Vec<TypeDist>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension: Option<String>,
    #[serde(rename = "previewType", skip_serializing_if = "Option::is_none")]
    pub preview_type: Option<String>,
    #[serde(rename = "textPreview", skip_serializing_if = "Option::is_none")]
    pub text_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NameSize {
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NameModified {
    pub name: String,
    #[serde(rename = "modifiedAt")]
    pub modified_at: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TypeDist {
    pub label: String,
    pub percentage: u32,
    pub color: String,
}

const TEXT_EXTENSIONS: &[&str] = &[
    ".txt", ".md", ".json", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".xml",
    ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bash", ".zsh",
    ".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".swift",
    ".kt", ".scala", ".lua", ".r", ".sql", ".graphql", ".env", ".gitignore",
    ".dockerfile", ".makefile", ".cmake", ".gradle", ".properties", ".csv", ".tsv",
    ".log", ".lock", ".editorconfig", ".prettierrc", ".eslintrc",
];

const IMAGE_EXTENSIONS: &[&str] = &[".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"];

struct TypeCategory {
    label: &'static str,
    extensions: &'static [&'static str],
    color: &'static str,
}

const TYPE_CATEGORIES: &[TypeCategory] = &[
    TypeCategory { label: "code", extensions: &[".js", ".ts", ".tsx", ".jsx", ".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".swift", ".kt", ".scala", ".lua", ".r", ".sh", ".bash", ".zsh"], color: "#6c5ce7" },
    TypeCategory { label: "images", extensions: &[".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico", ".tiff"], color: "#00b894" },
    TypeCategory { label: "documents", extensions: &[".md", ".txt", ".pdf", ".doc", ".docx", ".rtf", ".csv", ".tsv"], color: "#0984e3" },
    TypeCategory { label: "config", extensions: &[".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf", ".xml", ".env", ".lock"], color: "#fdcb6e" },
    TypeCategory { label: "styles", extensions: &[".css", ".scss", ".sass", ".less", ".styl"], color: "#e84393" },
    TypeCategory { label: "html", extensions: &[".html", ".htm", ".hbs", ".ejs", ".pug"], color: "#e17055" },
];

fn get_file_size(path: &str) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fs::metadata(path).map(|m| m.blocks() * 512).unwrap_or(0)
    }
    #[cfg(not(unix))]
    {
        fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    }
}

pub fn get_entry_info(entry_path: &str) -> Result<EntryInfo, String> {
    let meta = fs::metadata(entry_path).map_err(|e| e.to_string())?;
    let name = Path::new(entry_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let modified_at = meta.modified().map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as f64).unwrap_or(0.0);
    let created_at = meta.created().map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as f64).unwrap_or(0.0);

    if meta.is_dir() {
        let mut file_count: u32 = 0;
        let mut dir_count: u32 = 0;
        let mut largest: Option<NameSize> = None;
        let mut newest: Option<NameModified> = None;
        let mut ext_counts: HashMap<String, u32> = HashMap::new();
        let mut total_size: u64 = 0;

        if let Ok(items) = fs::read_dir(entry_path) {
            for item in items.flatten() {
                let iname = item.file_name().to_string_lossy().to_string();
                if iname.starts_with('.') { continue; }
                let ipath = format!("{}/{}", entry_path, iname);
                if let Ok(imeta) = fs::metadata(&ipath) {
                    if imeta.is_dir() {
                        dir_count += 1;
                    } else if imeta.is_file() {
                        file_count += 1;
                        let fsize = get_file_size(&ipath);
                        total_size += fsize;
                        if largest.as_ref().map_or(true, |l| fsize > l.size) {
                            largest = Some(NameSize { name: iname.clone(), size: fsize });
                        }
                        let mtime = imeta.modified().map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as f64).unwrap_or(0.0);
                        if newest.as_ref().map_or(true, |n| mtime > n.modified_at) {
                            newest = Some(NameModified { name: iname.clone(), modified_at: mtime });
                        }
                        if let Some(ext) = Path::new(&iname).extension() {
                            let ext_str = format!(".{}", ext.to_string_lossy().to_lowercase());
                            *ext_counts.entry(ext_str).or_insert(0) += 1;
                        }
                    }
                }
            }
        }

        let total_files: u32 = ext_counts.values().sum();
        let type_distribution = if total_files > 0 {
            let mut cats: Vec<TypeDist> = Vec::new();
            let mut matched: std::collections::HashSet<String> = std::collections::HashSet::new();
            for cat in TYPE_CATEGORIES {
                let count: u32 = ext_counts.iter()
                    .filter(|(ext, _)| cat.extensions.contains(&ext.as_str()))
                    .map(|(ext, c)| { matched.insert(ext.clone()); *c })
                    .sum();
                if count > 0 {
                    cats.push(TypeDist { label: cat.label.to_string(), percentage: (count * 100 / total_files), color: cat.color.to_string() });
                }
            }
            let other: u32 = ext_counts.iter().filter(|(ext, _)| !matched.contains(*ext)).map(|(_, c)| *c).sum();
            if other > 0 {
                cats.push(TypeDist { label: "other".to_string(), percentage: (other * 100 / total_files), color: "#dfe6e9".to_string() });
            }
            cats.sort_by(|a, b| b.percentage.cmp(&a.percentage));
            Some(cats)
        } else {
            None
        };

        Ok(EntryInfo {
            path: entry_path.to_string(), name, size: total_size, is_dir: true,
            modified_at, created_at,
            file_count: Some(file_count), dir_count: Some(dir_count),
            largest_file: largest, newest_file: newest, type_distribution,
            extension: None, preview_type: None, text_preview: None,
        })
    } else {
        let size = get_file_size(entry_path);
        let ext = Path::new(entry_path).extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase()));
        let ext_str = ext.as_deref().unwrap_or("");

        let (preview_type, text_preview) = if IMAGE_EXTENSIONS.contains(&ext_str) {
            (Some("image".to_string()), None)
        } else if TEXT_EXTENSIONS.contains(&ext_str) || name.to_lowercase() == "makefile" || name.to_lowercase() == "dockerfile" {
            let preview = fs::read_to_string(entry_path).ok().map(|s| {
                if s.len() > 5120 { format!("{}…", &s[..5120]) } else { s }
            });
            (Some("text".to_string()), preview)
        } else {
            (Some("none".to_string()), None)
        };

        Ok(EntryInfo {
            path: entry_path.to_string(), name, size, is_dir: false,
            modified_at, created_at,
            file_count: None, dir_count: None,
            largest_file: None, newest_file: None, type_distribution: None,
            extension: ext, preview_type, text_preview,
        })
    }
}
