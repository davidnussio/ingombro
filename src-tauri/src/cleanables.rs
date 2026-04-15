use crate::scanner::get_dir_size_recursive;
use crate::types::{Category, CleanableItem, CleanableResult, RiskLevel};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

struct CleanableRule {
    project_type: &'static str,
    category: Category,
    sentinels: &'static [&'static str],
    risk: RiskLevel,
    note: Option<&'static str>,
    is_file: bool,
}

struct VendorDisambig {
    sentinel: &'static str,
    project_type: &'static str,
}

const VENDOR_DISAMBIG: &[VendorDisambig] = &[
    VendorDisambig { sentinel: "go.mod", project_type: "Go" },
    VendorDisambig { sentinel: "Gemfile", project_type: "Ruby" },
    VendorDisambig { sentinel: "composer.json", project_type: "PHP" },
];

fn build_rules() -> HashMap<&'static str, CleanableRule> {
    let mut m = HashMap::new();
    // Node / JS
    m.insert("node_modules", CleanableRule { category: Category::Dev, project_type: "Node / Bun", risk: RiskLevel::Low, sentinels: &["package.json"], note: None, is_file: false });
    m.insert(".parcel-cache", CleanableRule { category: Category::Dev, project_type: "Parcel", risk: RiskLevel::Low, sentinels: &["package.json"], note: None, is_file: false });
    m.insert(".turbo", CleanableRule { category: Category::Dev, project_type: "Monorepo", risk: RiskLevel::Low, sentinels: &["turbo.json"], note: None, is_file: false });
    m.insert(".nx", CleanableRule { category: Category::Dev, project_type: "Monorepo", risk: RiskLevel::Low, sentinels: &["nx.json"], note: None, is_file: false });
    m.insert("coverage", CleanableRule { category: Category::Dev, project_type: "Test artifacts", risk: RiskLevel::Low, sentinels: &["jest.config.js", "vitest.config.ts", ".nycrc"], note: None, is_file: false });
    m.insert("storybook-static", CleanableRule { category: Category::Dev, project_type: "Storybook", risk: RiskLevel::Low, sentinels: &[".storybook/main.js", ".storybook/main.ts"], note: None, is_file: false });
    // Framework output
    m.insert(".next", CleanableRule { category: Category::Dev, project_type: "Next.js", risk: RiskLevel::Low, sentinels: &["next.config.js", "next.config.mjs", "next.config.ts"], note: None, is_file: false });
    m.insert(".nuxt", CleanableRule { category: Category::Dev, project_type: "Nuxt", risk: RiskLevel::Low, sentinels: &["nuxt.config.js", "nuxt.config.ts"], note: None, is_file: false });
    m.insert(".svelte-kit", CleanableRule { category: Category::Dev, project_type: "SvelteKit", risk: RiskLevel::Low, sentinels: &["svelte.config.js", "svelte.config.ts"], note: None, is_file: false });
    m.insert(".astro", CleanableRule { category: Category::Dev, project_type: "Astro", risk: RiskLevel::Low, sentinels: &["astro.config.mjs", "astro.config.ts"], note: None, is_file: false });
    m.insert(".remix", CleanableRule { category: Category::Dev, project_type: "Remix", risk: RiskLevel::Low, sentinels: &["remix.config.js"], note: None, is_file: false });
    m.insert(".angular", CleanableRule { category: Category::Dev, project_type: "Angular", risk: RiskLevel::Low, sentinels: &["angular.json"], note: None, is_file: false });
    m.insert(".docusaurus", CleanableRule { category: Category::Dev, project_type: "Docusaurus", risk: RiskLevel::Low, sentinels: &["docusaurus.config.js"], note: None, is_file: false });
    m.insert("site", CleanableRule { category: Category::Dev, project_type: "MkDocs", risk: RiskLevel::Low, sentinels: &["mkdocs.yml"], note: None, is_file: false });
    // Ambiguous
    m.insert("build", CleanableRule { category: Category::Dev, project_type: "Build artifacts", risk: RiskLevel::Medium, sentinels: &["package.json", "build.gradle", "build.gradle.kts", "CMakeLists.txt", "Makefile"], note: None, is_file: false });
    m.insert("dist", CleanableRule { category: Category::Dev, project_type: "Build artifacts", risk: RiskLevel::Medium, sentinels: &["package.json", "pyproject.toml", "setup.py"], note: None, is_file: false });
    m.insert(".cache", CleanableRule { category: Category::Dev, project_type: "Cache generico", risk: RiskLevel::Medium, sentinels: &[], note: Some("Nessun sentinel — richiedere conferma esplicita"), is_file: false });
    // target — disambiguated
    m.insert("target", CleanableRule { category: Category::Dev, project_type: "Rust / Maven", risk: RiskLevel::Low, sentinels: &["Cargo.toml", "pom.xml"], note: None, is_file: false });
    // Python
    m.insert("__pycache__", CleanableRule { category: Category::Dev, project_type: "Python", risk: RiskLevel::Low, sentinels: &["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"], note: None, is_file: false });
    m.insert(".venv", CleanableRule { category: Category::Dev, project_type: "Python", risk: RiskLevel::Low, sentinels: &["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"], note: None, is_file: false });
    m.insert("venv", CleanableRule { category: Category::Dev, project_type: "Python", risk: RiskLevel::Low, sentinels: &["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"], note: None, is_file: false });
    m.insert(".tox", CleanableRule { category: Category::Dev, project_type: "Python", risk: RiskLevel::Low, sentinels: &["tox.ini", "pyproject.toml"], note: None, is_file: false });
    m.insert(".pytest_cache", CleanableRule { category: Category::Dev, project_type: "Python", risk: RiskLevel::Low, sentinels: &["pytest.ini", "pyproject.toml", "setup.cfg"], note: None, is_file: false });
    m.insert("htmlcov", CleanableRule { category: Category::Dev, project_type: "Python", risk: RiskLevel::Low, sentinels: &["pyproject.toml", ".coveragerc"], note: None, is_file: false });
    m.insert(".mypy_cache", CleanableRule { category: Category::Dev, project_type: "Python", risk: RiskLevel::Low, sentinels: &["mypy.ini", "pyproject.toml"], note: None, is_file: false });
    m.insert(".ruff_cache", CleanableRule { category: Category::Dev, project_type: "Python", risk: RiskLevel::Low, sentinels: &["ruff.toml", "pyproject.toml"], note: None, is_file: false });
    // Java / Kotlin
    m.insert(".gradle", CleanableRule { category: Category::Dev, project_type: "Java/Kotlin", risk: RiskLevel::Low, sentinels: &["build.gradle", "build.gradle.kts", "settings.gradle"], note: None, is_file: false });
    // Ruby
    m.insert(".bundle", CleanableRule { category: Category::Dev, project_type: "Ruby", risk: RiskLevel::Low, sentinels: &["Gemfile"], note: None, is_file: false });
    // Elixir
    m.insert("_build", CleanableRule { category: Category::Dev, project_type: "Elixir", risk: RiskLevel::Low, sentinels: &["mix.exs"], note: None, is_file: false });
    m.insert("deps", CleanableRule { category: Category::Dev, project_type: "Elixir", risk: RiskLevel::Low, sentinels: &["mix.exs"], note: None, is_file: false });
    m.insert(".elixir_ls", CleanableRule { category: Category::Dev, project_type: "Elixir", risk: RiskLevel::Low, sentinels: &["mix.exs"], note: None, is_file: false });
    // Zig
    m.insert("zig-cache", CleanableRule { category: Category::Dev, project_type: "Zig", risk: RiskLevel::Low, sentinels: &["build.zig"], note: None, is_file: false });
    m.insert("zig-out", CleanableRule { category: Category::Dev, project_type: "Zig", risk: RiskLevel::Low, sentinels: &["build.zig"], note: None, is_file: false });
    // Haskell
    m.insert(".stack-work", CleanableRule { category: Category::Dev, project_type: "Haskell", risk: RiskLevel::Low, sentinels: &["stack.yaml", "package.yaml"], note: None, is_file: false });
    // Infrastructure
    m.insert(".terraform", CleanableRule { category: Category::Dev, project_type: "Terraform", risk: RiskLevel::Medium, sentinels: &["*.tf", "terraform.tfvars"], note: Some("Rimuove provider binaries, non i .tfstate"), is_file: false });
    m.insert(".cdk.out", CleanableRule { category: Category::Dev, project_type: "AWS CDK", risk: RiskLevel::Low, sentinels: &["cdk.json"], note: None, is_file: false });
    m.insert(".serverless", CleanableRule { category: Category::Dev, project_type: "Serverless", risk: RiskLevel::Low, sentinels: &["serverless.yml", "serverless.yaml"], note: None, is_file: false });
    // Mobile
    m.insert("Pods", CleanableRule { category: Category::Dev, project_type: "iOS", risk: RiskLevel::Low, sentinels: &["Podfile"], note: None, is_file: false });
    m.insert(".dart_tool", CleanableRule { category: Category::Dev, project_type: "Dart/Flutter", risk: RiskLevel::Low, sentinels: &["pubspec.yaml"], note: None, is_file: false });
    m.insert(".pub-cache", CleanableRule { category: Category::Dev, project_type: "Dart/Flutter", risk: RiskLevel::Low, sentinels: &["pubspec.yaml"], note: None, is_file: false });
    // AI / ML
    m.insert(".ipynb_checkpoints", CleanableRule { category: Category::Ml, project_type: "Jupyter", risk: RiskLevel::Low, sentinels: &["*.ipynb"], note: None, is_file: false });
    m.insert("mlruns", CleanableRule { category: Category::Ml, project_type: "MLflow", risk: RiskLevel::Medium, sentinels: &["MLproject"], note: Some("Contiene run history e artifact"), is_file: false });
    m.insert("wandb", CleanableRule { category: Category::Ml, project_type: "Weights & Biases", risk: RiskLevel::Medium, sentinels: &["*.py", "requirements.txt"], note: Some("Safe se si usa W&B cloud sync"), is_file: false });
    m.insert("lightning_logs", CleanableRule { category: Category::Ml, project_type: "PyTorch Lightning", risk: RiskLevel::Medium, sentinels: &["*.py"], note: Some("Checkpoint e TensorBoard logs"), is_file: false });
    // Office
    m.insert("Thumbs.db", CleanableRule { category: Category::Office, project_type: "Windows", risk: RiskLevel::Low, sentinels: &[], note: None, is_file: true });
    m.insert(".DS_Store", CleanableRule { category: Category::Office, project_type: "macOS", risk: RiskLevel::Low, sentinels: &[], note: None, is_file: true });
    m.insert("Desktop.ini", CleanableRule { category: Category::Office, project_type: "Windows", risk: RiskLevel::Low, sentinels: &[], note: None, is_file: true });
    // Design
    m.insert("RECOVER", CleanableRule { category: Category::Design, project_type: "Illustrator", risk: RiskLevel::High, sentinels: &["*.ai"], note: Some("Eliminare solo dopo aver aperto e salvato il progetto"), is_file: false });
    m.insert(".affinity-autosave", CleanableRule { category: Category::Design, project_type: "Affinity", risk: RiskLevel::High, sentinels: &["*.afdesign", "*.afphoto"], note: Some("Verificare assenza di sessioni aperte"), is_file: false });
    m.insert("Sketch Previews", CleanableRule { category: Category::Design, project_type: "Sketch", risk: RiskLevel::Low, sentinels: &["*.sketch"], note: None, is_file: false });
    // Video
    m.insert("Media Cache", CleanableRule { category: Category::Video, project_type: "Premiere Pro", risk: RiskLevel::Low, sentinels: &["*.prproj"], note: None, is_file: false });
    m.insert("Adobe Premiere Auto-Save", CleanableRule { category: Category::Video, project_type: "Premiere Pro", risk: RiskLevel::High, sentinels: &["*.prproj"], note: Some("Solo se progetto completato e archiviato"), is_file: false });
    m.insert("Render Cache", CleanableRule { category: Category::Video, project_type: "DaVinci Resolve", risk: RiskLevel::Low, sentinels: &["*.drp"], note: None, is_file: false });
    m.insert("Fusion Cache", CleanableRule { category: Category::Video, project_type: "DaVinci Resolve", risk: RiskLevel::Low, sentinels: &["*.drp"], note: None, is_file: false });
    m.insert("Render Files", CleanableRule { category: Category::Video, project_type: "Final Cut Pro", risk: RiskLevel::Low, sentinels: &["*.fcpbundle"], note: None, is_file: false });
    m.insert("Final Cut Backups", CleanableRule { category: Category::Video, project_type: "Final Cut Pro", risk: RiskLevel::High, sentinels: &["*.fcpbundle"], note: Some("~/Movies/Final Cut Pro/ — backup automatici"), is_file: false });
    m.insert("proxy", CleanableRule { category: Category::Video, project_type: "Multi-app", risk: RiskLevel::Medium, sentinels: &["*.prproj", "*.drp", "*.fcpbundle"], note: Some("Safe solo se il footage originale è intatto"), is_file: false });
    // Music / DAW
    m.insert("Bounced Files", CleanableRule { category: Category::Music, project_type: "Logic Pro", risk: RiskLevel::Medium, sentinels: &["*.logicx"], note: Some("Potrebbe essere il deliverable finale"), is_file: false });
    m.insert("Freeze Files", CleanableRule { category: Category::Music, project_type: "Logic Pro", risk: RiskLevel::Low, sentinels: &["*.logicx"], note: None, is_file: false });
    m.insert("Audio Files", CleanableRule { category: Category::Music, project_type: "Logic / Pro Tools", risk: RiskLevel::High, sentinels: &["*.logicx", "*.ptx"], note: Some("Può contenere il fonte audio originale"), is_file: false });
    m.insert("Rendered", CleanableRule { category: Category::Music, project_type: "Ableton Live", risk: RiskLevel::Low, sentinels: &["*.als"], note: None, is_file: false });
    m.insert("Backup (Ableton)", CleanableRule { category: Category::Music, project_type: "Ableton Live", risk: RiskLevel::High, sentinels: &["*.als"], note: Some("Backup automatici Ableton — verificare copia"), is_file: false });
    m.insert("fl_studio_cache", CleanableRule { category: Category::Music, project_type: "FL Studio", risk: RiskLevel::Low, sentinels: &["*.flp"], note: None, is_file: false });

    m
}

fn sentinel_exists(dir_path: &str, sentinel: &str) -> bool {
    if sentinel.contains('*') {
        // Glob pattern matching
        let pattern = format!("{}/{}", dir_path, sentinel);
        if let Ok(paths) = glob::glob(&pattern) {
            for entry in paths {
                if entry.is_ok() {
                    return true;
                }
            }
        }
        return false;
    }
    // Direct path check (supports nested like ".storybook/main.js")
    Path::new(dir_path).join(sentinel).exists()
}

pub fn detect_cleanables(root_path: &str, max_depth: u32) -> CleanableResult {
    let rules = build_rules();
    let rule_names: std::collections::HashSet<&str> = rules.keys().copied().collect();
    let mut items: Vec<CleanableItem> = Vec::new();

    fn walk(
        dir_path: &str,
        depth: u32,
        max_depth: u32,
        rules: &HashMap<&str, CleanableRule>,
        rule_names: &std::collections::HashSet<&str>,
        items: &mut Vec<CleanableItem>,
    ) {
        if depth > max_depth {
            return;
        }
        let entries = match fs::read_dir(dir_path) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            if name == ".Trash" {
                continue;
            }
            let full_path = format!("{}/{}", dir_path, name);
            let ft = match entry.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };

            // Handle special files (non-directory): .DS_Store, Thumbs.db, Desktop.ini
            if !ft.is_dir() {
                if let Some(rule) = rules.get(name.as_str()) {
                    if rule.is_file {
                        let confirmed = rule.sentinels.is_empty()
                            || rule.sentinels.iter().any(|s| sentinel_exists(dir_path, s));
                        if confirmed {
                            #[cfg(unix)]
                            let file_size = {
                                use std::os::unix::fs::MetadataExt;
                                fs::metadata(&full_path)
                                    .map(|m| m.blocks() * 512)
                                    .unwrap_or(0)
                            };
                            #[cfg(not(unix))]
                            let file_size = fs::metadata(&full_path).map(|m| m.len()).unwrap_or(0);

                            if file_size > 0 {
                                items.push(CleanableItem {
                                    path: full_path,
                                    project_path: dir_path.to_string(),
                                    project_type: rule.project_type.to_string(),
                                    folder_name: name,
                                    size: file_size,
                                    risk: rule.risk.clone(),
                                    category: rule.category.clone(),
                                    note: rule.note.map(|s| s.to_string()),
                                });
                            }
                        }
                    }
                }
                continue;
            }

            // Vendor disambiguation
            if name == "vendor" {
                let mut vendor_type: Option<&str> = None;
                for v in VENDOR_DISAMBIG {
                    if Path::new(dir_path).join(v.sentinel).exists() {
                        vendor_type = Some(v.project_type);
                        break;
                    }
                }
                if let Some(pt) = vendor_type {
                    let size = get_dir_size_recursive(&full_path);
                    if size > 0 {
                        items.push(CleanableItem {
                            path: full_path,
                            project_path: dir_path.to_string(),
                            project_type: pt.to_string(),
                            folder_name: name,
                            size,
                            risk: RiskLevel::Low,
                            category: Category::Dev,
                            note: None,
                        });
                    }
                    continue;
                }
            }

            if let Some(rule) = rules.get(name.as_str()) {
                if !rule.is_file {
                    // Disambiguate target/
                    let mut resolved_type = rule.project_type.to_string();
                    if name == "target" {
                        if Path::new(dir_path).join("Cargo.toml").exists() {
                            resolved_type = "Rust".to_string();
                        } else if Path::new(dir_path).join("pom.xml").exists() {
                            resolved_type = "Java/Maven".to_string();
                        }
                    }

                    let confirmed = rule.sentinels.is_empty()
                        || rule.sentinels.iter().any(|s| sentinel_exists(dir_path, s));

                    if confirmed {
                        let size = get_dir_size_recursive(&full_path);
                        if size > 0 {
                            items.push(CleanableItem {
                                path: full_path,
                                project_path: dir_path.to_string(),
                                project_type: resolved_type,
                                folder_name: name,
                                size,
                                risk: rule.risk.clone(),
                                category: rule.category.clone(),
                                note: rule.note.map(|s| s.to_string()),
                            });
                        }
                        continue; // Don't recurse into cleanable folders
                    }
                }
            }

            // Recurse into non-cleanable directories
            if !name.starts_with('.') || rule_names.contains(name.as_str()) {
                walk(&full_path, depth + 1, max_depth, rules, rule_names, items);
            }
        }
    }

    walk(root_path, 0, max_depth, &rules, &rule_names, &mut items);
    items.sort_by(|a, b| b.size.cmp(&a.size));
    let total_size = items.iter().map(|i| i.size).sum();
    CleanableResult { items, total_size }
}
