/// Expert team configuration commands.
///
/// This first slice stores custom expert profiles and expert groups locally.
/// Runtime orchestration can build on the same files without changing the UI
/// contract.
use chrono::Utc;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;

fn state_dir() -> PathBuf {
    super::openclaw_dir().join("clawpanel")
}

fn experts_path() -> PathBuf {
    state_dir().join("experts.json")
}

fn groups_path() -> PathBuf {
    state_dir().join("expert-groups.json")
}

fn read_array(path: PathBuf) -> Result<Vec<Value>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取失败: {e}"))?;
    let value: Value = serde_json::from_str(&content).map_err(|e| format!("解析失败: {e}"))?;
    value
        .as_array()
        .cloned()
        .ok_or_else(|| "配置文件顶层必须是数组".to_string())
}

fn write_array(path: PathBuf, items: &[Value]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    let json = serde_json::to_string_pretty(items).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("写入失败: {e}"))
}

fn validate_id(id: &str, label: &str) -> Result<(), String> {
    let id = id.trim();
    if id.is_empty() {
        return Err(format!("{label} ID 不能为空"));
    }
    if id.len() > 80 {
        return Err(format!("{label} ID 不能超过 80 个字符"));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err(format!("{label} ID 只能包含字母、数字、点、下划线和短横线"));
    }
    Ok(())
}

fn normalized_object(mut value: Value, label: &str) -> Result<Value, String> {
    let obj = value.as_object_mut().ok_or(format!("{label} 必须是对象"))?;
    let id = obj
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    validate_id(id, label)?;
    obj.insert("id".to_string(), Value::String(id.to_string()));

    let now = Utc::now().to_rfc3339();
    if obj
        .get("createdAt")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        obj.insert("createdAt".to_string(), Value::String(now.clone()));
    }
    obj.insert("updatedAt".to_string(), Value::String(now));
    Ok(value)
}

fn upsert(path: PathBuf, value: Value, label: &str) -> Result<Value, String> {
    let value = normalized_object(value, label)?;
    let id = value
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let mut items = read_array(path.clone())?;
    if let Some(existing) = items
        .iter_mut()
        .find(|item| item.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
    {
        let created_at = existing.get("createdAt").cloned();
        *existing = value.clone();
        if let (Some(created_at), Some(obj)) = (created_at, existing.as_object_mut()) {
            obj.insert("createdAt".to_string(), created_at);
        }
    } else {
        items.push(value.clone());
    }
    items.sort_by(|a, b| {
        a.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| a.get("id").and_then(|v| v.as_str()).unwrap_or(""))
            .to_ascii_lowercase()
            .cmp(
                &b.get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or_else(|| b.get("id").and_then(|v| v.as_str()).unwrap_or(""))
                    .to_ascii_lowercase(),
            )
    });
    write_array(path, &items)?;
    Ok(value)
}

fn delete_by_id(path: PathBuf, id: &str, label: &str) -> Result<Value, String> {
    validate_id(id, label)?;
    let mut items = read_array(path.clone())?;
    let before = items.len();
    items.retain(|item| item.get("id").and_then(|v| v.as_str()) != Some(id));
    if before == items.len() {
        return Err(format!("{label}「{id}」不存在"));
    }
    write_array(path, &items)?;
    Ok(json!({ "ok": true }))
}

fn prune_expert_from_groups(expert_id: &str) -> Result<(), String> {
    let path = groups_path();
    let mut groups = read_array(path.clone())?;
    let mut changed = false;
    for group in &mut groups {
        let Some(obj) = group.as_object_mut() else {
            continue;
        };
        if obj.get("moderatorExpertId").and_then(|v| v.as_str()) == Some(expert_id) {
            obj.remove("moderatorExpertId");
            changed = true;
        }
        if let Some(members) = obj.get_mut("members").and_then(|v| v.as_array_mut()) {
            let before = members.len();
            members.retain(|member| {
                member
                    .get("expertId")
                    .and_then(|v| v.as_str())
                    .map(|id| id != expert_id)
                    .unwrap_or(true)
            });
            changed |= before != members.len();
        }
    }
    if changed {
        write_array(path, &groups)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_experts() -> Result<Value, String> {
    Ok(Value::Array(read_array(experts_path())?))
}

#[tauri::command]
pub fn save_expert(expert: Value) -> Result<Value, String> {
    upsert(experts_path(), expert, "专家")
}

#[tauri::command]
pub fn delete_expert(id: String) -> Result<Value, String> {
    let result = delete_by_id(experts_path(), id.trim(), "专家")?;
    prune_expert_from_groups(id.trim())?;
    Ok(result)
}

#[tauri::command]
pub fn list_expert_groups() -> Result<Value, String> {
    Ok(Value::Array(read_array(groups_path())?))
}

#[tauri::command]
pub fn save_expert_group(mut group: Value) -> Result<Value, String> {
    let obj = group.as_object_mut().ok_or("专家团必须是对象")?;
    if obj.get("members").is_none() {
        obj.insert("members".to_string(), Value::Array(Vec::new()));
    }
    if !obj.get("members").map(|v| v.is_array()).unwrap_or(false) {
        return Err("专家团 members 必须是数组".to_string());
    }
    if obj
        .get("mode")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        obj.insert("mode".to_string(), Value::String("panel".to_string()));
    }
    if !obj.contains_key("budget") {
        obj.insert("budget".to_string(), Value::Object(Map::new()));
    }
    upsert(groups_path(), group, "专家团")
}

#[tauri::command]
pub fn delete_expert_group(id: String) -> Result<Value, String> {
    delete_by_id(groups_path(), id.trim(), "专家团")
}
