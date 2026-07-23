use serde_json::json;
/// 记忆文件管理命令
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

/// 缓存 agent workspace 路径，避免每次操作都调 CLI（Windows 上 spawn Node.js 进程很慢）
static WORKSPACE_CACHE: std::sync::LazyLock<Mutex<WorkspaceCache>> =
    std::sync::LazyLock::new(|| Mutex::new(WorkspaceCache::default()));

#[derive(Default)]
struct WorkspaceCache {
    map: HashMap<String, PathBuf>,
    fetched_at: u64,
}

impl WorkspaceCache {
    fn is_fresh(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        now - self.fetched_at < 60 // 60 秒 TTL
    }
}

/// 检查路径是否包含不安全字符（目录遍历、绝对路径等）
fn is_unsafe_path(path: &str) -> bool {
    path.contains("..")
        || path.contains('\0')
        || path.starts_with('/')
        || path.starts_with('\\')
        || (path.len() >= 2 && path.as_bytes()[1] == b':') // Windows 绝对路径 C:\
}

/// 根据 agent_id 获取 workspace 路径（直接读 openclaw.json，带缓存）
/// 不再调用 CLI，毫秒级响应
async fn agent_workspace(agent_id: &str) -> Result<PathBuf, String> {
    // 先查缓存
    {
        let cache = WORKSPACE_CACHE.lock().unwrap();
        if cache.is_fresh() {
            if let Some(ws) = cache.map.get(agent_id) {
                return Ok(ws.clone());
            }
            if !cache.map.is_empty() {
                return Err(format!("Agent「{agent_id}」不存在或无 workspace"));
            }
        }
    }

    // 缓存过期或为空，从 openclaw.json 读取
    let config_path = super::openclaw_dir().join("openclaw.json");
    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("读取 openclaw.json 失败: {e}"))?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("解析 JSON 失败: {e}"))?;

    let default_workspace = config
        .get("agents")
        .and_then(|a| a.get("defaults"))
        .and_then(|d| d.get("workspace"))
        .and_then(|w| w.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| super::openclaw_dir().join("workspace"));
    // 解析符号链接
    let default_workspace = fs::canonicalize(&default_workspace).unwrap_or(default_workspace);

    let mut new_map = HashMap::new();
    // main agent 使用默认 workspace
    new_map.insert("main".to_string(), default_workspace);

    if let Some(arr) = config
        .get("agents")
        .and_then(|a| a.get("list"))
        .and_then(|l| l.as_array())
    {
        for a in arr {
            let id = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
            if id.is_empty() {
                continue;
            }
            let ws = a
                .get("workspace")
                .and_then(|v| v.as_str())
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    if id == "main" {
                        super::openclaw_dir().join("workspace")
                    } else {
                        super::openclaw_dir()
                            .join("agents")
                            .join(id)
                            .join("workspace")
                    }
                });
            // 解析符号链接，确保软连接的 workspace 也能正确访问
            let ws = fs::canonicalize(&ws).unwrap_or(ws);
            new_map.insert(id.to_string(), ws);
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let result = new_map.get(agent_id).cloned();
    {
        let mut cache = WORKSPACE_CACHE.lock().unwrap();
        cache.map = new_map;
        cache.fetched_at = now;
    }

    result.ok_or_else(|| format!("Agent「{agent_id}」不存在或无 workspace"))
}

async fn memory_dir_for_agent(agent_id: &str, category: &str) -> Result<PathBuf, String> {
    let ws = agent_workspace(agent_id).await?;
    Ok(match category {
        "memory" => ws.join("memory"),
        "archive" => {
            // 归档目录在 agent workspace 同级的 workspace-memory
            // 对 main: ~/.openclaw/workspace-memory
            // 对其他: ~/.openclaw/agents/{id}/workspace-memory
            if let Some(parent) = ws.parent() {
                parent.join("workspace-memory")
            } else {
                ws.join("memory-archive")
            }
        }
        "core" => ws.clone(),
        _ => ws.join("memory"),
    })
}

async fn resolve_memory_file_path_for_agent(
    aid: &str,
    file_path: &str,
    category: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(cat) = category {
        let dir = memory_dir_for_agent(aid, cat).await?;
        return Ok(dir.join(file_path));
    }

    let candidates = [
        memory_dir_for_agent(aid, "memory").await,
        memory_dir_for_agent(aid, "archive").await,
        memory_dir_for_agent(aid, "core").await,
    ];

    for dir in candidates.iter().flatten() {
        let full = dir.join(file_path);
        if full.exists() {
            return Ok(full);
        }
    }

    Ok(memory_dir_for_agent(aid, "memory").await?.join(file_path))
}

#[tauri::command]
pub async fn list_memory_files(
    category: String,
    agent_id: Option<String>,
) -> Result<Vec<String>, String> {
    let aid = agent_id.as_deref().unwrap_or("main");
    let dir = memory_dir_for_agent(aid, &category).await?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut files = Vec::new();
    collect_files(&dir, &dir, &mut files, &category)?;
    files.sort();
    Ok(files)
}

fn collect_files(
    base: &PathBuf,
    dir: &PathBuf,
    files: &mut Vec<String>,
    category: &str,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("读取目录失败: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // core 类别只读根目录的文件（不递归子目录）
            if category != "core" {
                collect_files(base, &path, files, category)?;
            }
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if matches!(ext, "md" | "txt" | "json" | "jsonl") {
                let rel = path
                    .strip_prefix(base)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|_| path.to_string_lossy().to_string());
                // 统一使用 POSIX 路径分隔符，确保 ZIP 内路径跨平台兼容
                #[cfg(target_os = "windows")]
                let rel = rel.replace('\\', "/");
                files.push(rel);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn read_memory_file(
    path: String,
    agent_id: Option<String>,
    category: Option<String>,
) -> Result<String, String> {
    if is_unsafe_path(&path) {
        return Err("非法路径".to_string());
    }

    let aid = agent_id.as_deref().unwrap_or("main");

    // If category is provided, try the category-specific directory first.
    // This prevents reading a stale copy from a different directory when
    // files with the same name exist in multiple categories.
    if let Some(cat) = category.as_deref() {
        if let Ok(dir) = memory_dir_for_agent(aid, cat).await {
            let full = dir.join(&path);
            if full.exists() {
                return fs::read_to_string(&full).map_err(|e| format!("读取失败: {e}"));
            }
        }
    }

    // Fallback: search all directories (backward compatibility)
    let candidates = [
        memory_dir_for_agent(aid, "memory").await,
        memory_dir_for_agent(aid, "archive").await,
        memory_dir_for_agent(aid, "core").await,
    ];

    for dir in candidates.iter().flatten() {
        let full = dir.join(&path);
        if full.exists() {
            return fs::read_to_string(&full).map_err(|e| format!("读取失败: {e}"));
        }
    }

    Err(format!("文件不存在: {path}"))
}

#[tauri::command]
pub async fn resolve_memory_file_path(
    path: String,
    agent_id: Option<String>,
    category: Option<String>,
) -> Result<serde_json::Value, String> {
    if is_unsafe_path(&path) {
        return Err("非法路径".to_string());
    }

    let aid = agent_id.as_deref().unwrap_or("main");
    let full = resolve_memory_file_path_for_agent(aid, &path, category.as_deref()).await?;
    let directory = full
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(json!({
        "path": full.to_string_lossy().to_string(),
        "directory": directory,
        "exists": full.exists(),
    }))
}

fn open_os_path(target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Err(format!("路径不存在: {}", target.to_string_lossy()));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = Command::new("explorer");
        c.arg(target);
        c
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = Command::new("open");
        c.arg(target);
        c
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = Command::new("xdg-open");
        c.arg(target);
        c
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("打开路径失败: {e}"))
}

#[tauri::command]
pub fn open_path(path: String, mode: Option<String>) -> Result<(), String> {
    if path.trim().is_empty() || path.contains('\0') {
        return Err("非法路径".to_string());
    }

    let requested = PathBuf::from(&path);
    let target = match mode.as_deref() {
        Some("folder") => {
            if requested.is_dir() {
                requested
            } else {
                requested
                    .parent()
                    .map(|p| p.to_path_buf())
                    .ok_or_else(|| "无法解析文件所在目录".to_string())?
            }
        }
        _ => requested,
    };

    open_os_path(&target)
}

#[tauri::command]
pub async fn write_memory_file(
    path: String,
    content: String,
    category: Option<String>,
    agent_id: Option<String>,
) -> Result<(), String> {
    if is_unsafe_path(&path) {
        return Err("非法路径".to_string());
    }

    let aid = agent_id.as_deref().unwrap_or("main");
    let cat = category.unwrap_or_else(|| "memory".to_string());
    let base = memory_dir_for_agent(aid, &cat).await?;

    let full_path = base.join(&path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::write(&full_path, &content).map_err(|e| format!("写入失败: {e}"))
}

#[tauri::command]
pub async fn delete_memory_file(
    path: String,
    agent_id: Option<String>,
    category: Option<String>,
) -> Result<(), String> {
    if is_unsafe_path(&path) {
        return Err("非法路径".to_string());
    }

    let aid = agent_id.as_deref().unwrap_or("main");

    if let Some(cat) = category.as_deref() {
        let dir = memory_dir_for_agent(aid, cat).await?;
        let full = dir.join(&path);
        if full.exists() {
            return fs::remove_file(&full).map_err(|e| format!("删除失败: {e}"));
        }
    }

    let candidates = [
        memory_dir_for_agent(aid, "memory").await,
        memory_dir_for_agent(aid, "archive").await,
        memory_dir_for_agent(aid, "core").await,
    ];

    for dir in candidates.iter().flatten() {
        let full = dir.join(&path);
        if full.exists() {
            return fs::remove_file(&full).map_err(|e| format!("删除失败: {e}"));
        }
    }

    Err(format!("文件不存在: {path}"))
}

#[tauri::command]
pub async fn export_memory_zip(
    category: String,
    agent_id: Option<String>,
) -> Result<String, String> {
    let aid = agent_id.as_deref().unwrap_or("main");
    let dir = memory_dir_for_agent(aid, &category).await?;
    if !dir.exists() {
        return Err("目录不存在".to_string());
    }

    let mut files = Vec::new();
    collect_files(&dir, &dir, &mut files, &category)?;
    if files.is_empty() {
        return Err("没有可导出的文件".to_string());
    }

    let export_dir = super::openclaw_dir().join("exports").join("memory");
    fs::create_dir_all(&export_dir).map_err(|e| format!("创建打包目录失败: {e}"))?;
    let zip_name = format!(
        "openclaw-{}-{}.zip",
        category,
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    );
    let zip_path = export_dir.join(&zip_name);

    let file = fs::File::create(&zip_path).map_err(|e| format!("创建 zip 失败: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for rel_path in &files {
        let full_path = dir.join(rel_path);
        zip.start_file(rel_path, options)
            .map_err(|e| format!("写入 zip 失败: {e}"))?;
        let mut input =
            fs::File::open(&full_path).map_err(|e| format!("读取 {rel_path} 失败: {e}"))?;
        std::io::copy(&mut input, &mut zip)
            .map_err(|e| format!("写入内容失败: {e}"))?;
    }

    zip.finish().map_err(|e| format!("完成 zip 失败: {e}"))?;
    Ok(zip_path.to_string_lossy().to_string())
}
