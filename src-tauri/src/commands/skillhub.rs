//! SkillHub SDK — 纯 HTTP + zip 操作，不依赖 Tauri 框架。
//! 供 skills.rs Tauri 命令层薄包装调用。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const COS_BASE: &str = "https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com";
const API_BASE: &str = "https://lightmake.site/api/v1";
const XIAPING_BASE: &str = "https://xiaping.coze.com/api";
const GITHUB_API_BASE: &str = "https://api.github.com";
const INDEX_TTL: Duration = Duration::from_secs(600); // 10 分钟缓存

// ── 数据结构 ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillHubItem {
    pub slug: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, alias = "displayName")]
    pub display_name: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub description_zh: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub owner_name: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub categories: Option<Vec<String>>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub logo: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    #[serde(default)]
    pub downloads: Option<u64>,
    #[serde(default)]
    pub installs: Option<u64>,
    #[serde(default)]
    pub stars: Option<u64>,
    #[serde(default)]
    pub labels: Option<serde_json::Value>,
    #[serde(default)]
    pub updated_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<SkillHubItem>,
}

#[derive(Debug, Deserialize)]
struct IndexResponse {
    #[serde(default)]
    skills: Vec<SkillHubItem>,
}

// ── 全量索引缓存 ──────────────────────────────────────────

static INDEX_CACHE: Mutex<Option<(Instant, Vec<SkillHubItem>)>> = Mutex::new(None);

// ── HTTP 客户端 ──────────────────────────────────────────

fn client() -> Result<reqwest::Client, String> {
    super::build_http_client(Duration::from_secs(30), Some("ClawPanel-SkillHub/1.0"))
}

// ── 公开接口 ──────────────────────────────────────────────

/// 搜索 SkillHub
pub async fn search(query: &str, limit: u32) -> Result<Vec<SkillHubItem>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let url = format!(
        "{}/search?q={}&limit={}",
        API_BASE,
        urlencoding::encode(q),
        limit
    );
    let resp = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("SkillHub 搜索请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("SkillHub 搜索失败: HTTP {}", resp.status()));
    }
    let data: SearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("SkillHub 搜索结果解析失败: {e}"))?;
    Ok(data.results)
}

/// 拉取全量索引（带 10 分钟内存缓存）
pub async fn fetch_index() -> Result<Vec<SkillHubItem>, String> {
    // 命中缓存
    if let Ok(guard) = INDEX_CACHE.lock() {
        if let Some((ts, ref items)) = *guard {
            if ts.elapsed() < INDEX_TTL {
                return Ok(items.clone());
            }
        }
    }
    // 拉取远程索引
    let url = format!("{}/skills.json", COS_BASE);
    let resp = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("拉取技能索引失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("拉取技能索引失败: HTTP {}", resp.status()));
    }
    let data: IndexResponse = resp
        .json()
        .await
        .map_err(|e| format!("解析技能索引失败: {e}"))?;
    let items = data.skills;
    // 写入缓存
    if let Ok(mut guard) = INDEX_CACHE.lock() {
        *guard = Some((Instant::now(), items.clone()));
    }
    Ok(items)
}

/// 搜索虾评技能市场
pub async fn search_xiaping(query: &str, limit: u32) -> Result<Vec<SkillHubItem>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let url = format!(
        "{}/skills/search?q={}&limit={}",
        XIAPING_BASE,
        urlencoding::encode(q),
        limit
    );
    let resp = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("虾评搜索请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("虾评搜索失败: HTTP {}", resp.status()));
    }
    // 虾评返回格式可能是数组或 { results: [...] }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("虾评搜索响应读取失败: {e}"))?;
    let items: Vec<SkillHubItem> = if text.trim_start().starts_with('[') {
        serde_json::from_str(&text).map_err(|e| format!("虾评搜索结果解析失败: {e}"))?
    } else {
        let wrapper: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("虾评搜索结果解析失败: {e}"))?;
        if let Some(arr) = wrapper.get("results").and_then(|v| v.as_array()) {
            serde_json::from_value(serde_json::Value::Array(arr.clone()))
                .map_err(|e| format!("虾评搜索结果解析失败: {e}"))?
        } else if let Some(arr) = wrapper.get("skills").and_then(|v| v.as_array()) {
            serde_json::from_value(serde_json::Value::Array(arr.clone()))
                .map_err(|e| format!("虾评搜索结果解析失败: {e}"))?
        } else {
            vec![]
        }
    };
    Ok(items)
}

/// 搜索 GitHub 开源 Skill 仓库
pub async fn search_github(query: &str, limit: u32) -> Result<Vec<SkillHubItem>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    // GitHub Code Search API 搜索包含 SKILL.md 的仓库
    let url = format!(
        "{}/search/code?q=filename:SKILL.md+{}&per_page={}",
        GITHUB_API_BASE,
        urlencoding::encode(q),
        limit.min(30) // GitHub Code Search 最多 100 条/页
    );
    let mut request = client()?
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json");
    // 如果有 GITHUB_TOKEN 环境变量，带上认证
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
    }
    let resp = request
        .send()
        .await
        .map_err(|e| format!("GitHub 搜索请求失败: {e}"))?;
    if !resp.status().is_success() {
        // GitHub Code Search 需要认证，匿名可能返回 401/403
        if resp.status().as_u16() == 401 || resp.status().as_u16() == 403 {
            return Err("GitHub 代码搜索需要认证，请设置 GITHUB_TOKEN 环境变量".into());
        }
        return Err(format!("GitHub 搜索失败: HTTP {}", resp.status()));
    }
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("GitHub 搜索结果解析失败: {e}"))?;
    let items_val = data.get("items").and_then(|v| v.as_array());
    let mut items = Vec::new();
    if let Some(arr) = items_val {
        for entry in arr.iter().take(limit as usize) {
            let repo = entry.get("repository").unwrap_or(entry);
            let full_name = repo.get("full_name").and_then(|v| v.as_str()).unwrap_or("");
            let description = repo.get("description").and_then(|v| v.as_str());
            let html_url = repo.get("html_url").and_then(|v| v.as_str());
            let stars = repo.get("stargazers_count").and_then(|v| v.as_u64());
            let owner = repo.get("owner").and_then(|o| o.get("login")).and_then(|v| v.as_str());
            // 将 GitHub 仓库映射为 SkillHubItem 格式
            let slug = full_name.replace('/', "-");
            items.push(SkillHubItem {
                slug,
                name: Some(full_name.to_string()),
                display_name: Some(full_name.to_string()),
                summary: description.map(|s| s.to_string()),
                description: description.map(|s| s.to_string()),
                description_zh: None,
                version: None,
                author: owner.map(|s| s.to_string()),
                owner_name: owner.map(|s| s.to_string()),
                category: Some("github".to_string()),
                tags: Some(vec!["github".to_string()]),
                categories: None,
                homepage: html_url.map(|s| s.to_string()),
                icon: None,
                logo: repo.get("owner").and_then(|o| o.get("avatar_url")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                avatar: None,
                avatar_url: repo.get("owner").and_then(|o| o.get("avatar_url")).and_then(|v| v.as_str()).map(|s| s.to_string()),
                image: None,
                downloads: None,
                installs: None,
                stars,
                labels: None,
                updated_at: repo.get("updated_at").and_then(|v| v.as_str()).and_then(|s| {
                    // 解析 ISO 8601 时间为 Unix 时间戳
                    chrono::DateTime::parse_from_rfc3339(s)
                        .ok()
                        .map(|dt| dt.timestamp() as u64)
                }),
            });
        }
    }
    Ok(items)
}

/// 多源聚合搜索：同时搜索 SkillHub + 虾评 + GitHub，合并去重
/// 每个源独立超时（8秒），任一源失败不影响其他源的结果
pub async fn search_all(query: &str, limit: u32) -> Result<Vec<SkillHubItem>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }

    // 每个源加 8 秒超时，避免某个源拖慢整体搜索
    let timeout = Duration::from_secs(8);
    let skillhub_res = tokio::time::timeout(timeout, search(q, limit)).await;
    let xiaping_res = tokio::time::timeout(timeout, search_xiaping(q, limit)).await;
    let github_res = tokio::time::timeout(timeout, search_github(q, limit.min(20))).await;

    let mut items = Vec::new();
    let mut seen_slugs = std::collections::HashSet::new();

    // 1. SkillHub 结果（优先级最高）
    if let Ok(Ok(skillhub_items)) = skillhub_res {
        for item in skillhub_items {
            let key = item.slug.to_lowercase();
            if seen_slugs.insert(key) {
                items.push(item);
            }
        }
    }

    // 2. 虾评结果
    if let Ok(Ok(xiaping_items)) = xiaping_res {
        for mut item in xiaping_items {
            let key = item.slug.to_lowercase();
            if seen_slugs.insert(key.clone()) {
                if item.category.as_deref().unwrap_or("").is_empty() {
                    item.category = Some("xiaping".to_string());
                }
                if item.tags.is_none() {
                    item.tags = Some(vec!["xiaping".to_string()]);
                }
                items.push(item);
            }
        }
    }

    // 3. GitHub 结果
    if let Ok(Ok(github_items)) = github_res {
        for item in github_items {
            let key = item.slug.to_lowercase();
            if seen_slugs.insert(key) {
                items.push(item);
            }
        }
    }

    // 限制总数
    items.truncate(limit as usize);
    Ok(items)
}

/// 下载 Skill zip（COS 镜像优先，回退主站 API）
pub async fn download_zip(slug: &str) -> Result<Vec<u8>, String> {
    let c = client()?;
    // 1. 优先 COS 镜像（国内 CDN）
    let cos_url = format!("{}/skills/{}.zip", COS_BASE, slug);
    match c.get(&cos_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            return resp
                .bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| format!("COS 下载读取失败: {e}"));
        }
        _ => {}
    }
    // 2. 回退主站 API
    let api_url = format!("{}/download?slug={}", API_BASE, urlencoding::encode(slug));
    let resp = c
        .get(&api_url)
        .send()
        .await
        .map_err(|e| format!("主站下载请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败: HTTP {}", resp.status()));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("下载读取失败: {e}"))
}

/// 下载并安装 Skill：zip → 解压到 skills_dir/{slug}/
pub async fn install(slug: &str, skills_dir: &Path) -> Result<PathBuf, String> {
    validate_slug(slug)?;
    let target_dir = skills_dir.join(slug);
    let zip_bytes = download_zip(slug).await?;
    extract_zip(&zip_bytes, &target_dir)?;
    Ok(target_dir)
}

/// 安装用户上传的 Skill zip
pub fn install_zip(zip_bytes: &[u8], name: &str, skills_dir: &Path) -> Result<PathBuf, String> {
    let slug = normalize_install_name(name)?;
    let target_dir = skills_dir.join(slug);
    extract_zip(zip_bytes, &target_dir)?;
    Ok(target_dir)
}

// ── 内部工具 ──────────────────────────────────────────────

/// 校验 slug 安全性
fn validate_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty() {
        return Err("Skill slug 不能为空".into());
    }
    if slug.contains("..") || slug.contains('/') || slug.contains('\\') {
        return Err(format!("无效的 Skill slug: {slug}"));
    }
    Ok(())
}

fn normalize_install_name(name: &str) -> Result<String, String> {
    let without_zip = name.trim().trim_end_matches(".zip").trim_end_matches(".ZIP");
    let slug = without_zip
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '.' || ch == '-' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    validate_slug(&slug)?;
    Ok(slug)
}

/// 将 zip 字节解压到目标目录
fn extract_zip(zip_bytes: &[u8], target_dir: &Path) -> Result<(), String> {
    use std::io::Cursor;
    use zip::ZipArchive;

    // 清理旧目录
    if target_dir.exists() {
        std::fs::remove_dir_all(target_dir).map_err(|e| format!("清理旧目录失败: {e}"))?;
    }
    std::fs::create_dir_all(target_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let target_root = target_dir
        .canonicalize()
        .map_err(|e| format!("解析目标目录失败: {e}"))?;

    let reader = Cursor::new(zip_bytes);
    let mut archive = ZipArchive::new(reader).map_err(|e| format!("打开 zip 失败: {e}"))?;

    // 收集所有文件名，检测是否都在同一个顶层目录下（常见的 zip 打包方式）
    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index_raw(i).ok().map(|f| f.name().to_string()))
        .collect();
    let strip_prefix = detect_single_root_dir(&names);
    let mut files_written = 0usize;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("读取 zip 条目失败: {e}"))?;

        let raw_name = file.name().to_string();

        // 如果 zip 内有单一根目录，剥掉它
        let relative = if let Some(ref prefix) = strip_prefix {
            match raw_name.strip_prefix(prefix.as_str()) {
                Some(rest) if !rest.is_empty() => rest.to_string(),
                _ => continue, // 跳过根目录本身
            }
        } else {
            raw_name.clone()
        };

        if relative.is_empty() {
            continue;
        }

        let Some(out_path) = safe_zip_output_path(&target_root, &relative) else {
            continue;
        };
        if file.is_dir() {
            std::fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            let mut outfile = std::fs::File::create(&out_path)
                .map_err(|e| format!("创建文件失败 {relative}: {e}"))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("写入文件失败 {relative}: {e}"))?;
            files_written += 1;
        }
    }

    if files_written == 0 || !target_root.join("SKILL.md").exists() {
        let _ = std::fs::remove_dir_all(&target_root);
        return Err("Skill zip 无效：缺少 SKILL.md".into());
    }
    Ok(())
}

fn safe_zip_output_path(target_root: &Path, entry_name: &str) -> Option<PathBuf> {
    let normalized = entry_name.replace('\\', "/");
    if normalized.is_empty()
        || normalized.starts_with('/')
        || normalized
            .as_bytes()
            .get(1)
            .copied()
            == Some(b':')
    {
        return None;
    }
    let mut out = target_root.to_path_buf();
    for part in normalized.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return None;
        }
        out.push(part);
    }
    if out != target_root && out.starts_with(target_root) {
        Some(out)
    } else {
        None
    }
}

/// 检测 zip 是否有单一顶层目录（如 `skill-name/...`），返回要剥掉的前缀
fn detect_single_root_dir(names: &[String]) -> Option<String> {
    let mut root: Option<String> = None;
    for name in names {
        let first_segment = name.split('/').next().unwrap_or("");
        if first_segment.is_empty() {
            continue;
        }
        match &root {
            None => root = Some(format!("{}/", first_segment)),
            Some(existing) => {
                if !name.starts_with(existing.as_str()) {
                    return None; // 多个顶层目录
                }
            }
        }
    }
    root
}
