//! 自定义规则文件的本地存档：每次写回前留一份改动前的版本，每个 rules 文件最多保留 `RULES_BACKUP_KEEP` 份。

use crate::utils::dirs;
use anyhow::{Result, bail};
use clash_verge_logging::{Type, logging};
use serde::Serialize;
use std::{io::ErrorKind, path::PathBuf};
use tokio::fs;

/// 每个 rules 文件保留的存档份数上限，超出的按时间从旧到新删除
pub const RULES_BACKUP_KEEP: usize = 10;
/// 存档目录，位于 profiles 目录下
const BACKUP_DIR: &str = "rules-backup";
const BACKUP_SUFFIX: &str = ".bak";

/// 一份存档的元信息：文件名、创建时间与大小
#[derive(Debug, Clone, Serialize)]
pub struct RulesBackupInfo {
    pub name: std::string::String,
    /// 存档创建时间，毫秒时间戳
    pub created: i64,
    /// 文件大小，字节
    pub size: u64,
}

fn backup_dir() -> Result<PathBuf> {
    Ok(dirs::app_profiles_dir()?.join(BACKUP_DIR))
}

/// 存档名形如 `<rules 文件名>.<毫秒时间戳>.bak`
fn backup_name(file_name: &str, created: i64) -> std::string::String {
    format!("{file_name}.{created}{BACKUP_SUFFIX}").into()
}

/// 解析存档名里的创建时间；不属于该 rules 文件或格式不符时返回 None
fn parse_created(file_name: &str, name: &str) -> Option<i64> {
    let stamp = name
        .strip_prefix(file_name)?
        .strip_prefix('.')?
        .strip_suffix(BACKUP_SUFFIX)?;

    if stamp.is_empty() || !stamp.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }

    stamp.parse().ok()
}

/// 写入一份存档并裁掉超出的旧档；调用方负责决定何时存档
pub async fn store(file_name: &str, content: &str) -> Result<()> {
    let dir = backup_dir()?;
    fs::create_dir_all(&dir).await?;

    // 同一毫秒内连续写回时让时间戳顺延，避免覆盖上一份存档
    let mut created = chrono::Local::now().timestamp_millis();
    let mut path = dir.join(backup_name(file_name, created));
    while fs::try_exists(&path).await.unwrap_or(false) {
        created += 1;
        path = dir.join(backup_name(file_name, created));
    }

    fs::write(&path, content).await?;
    prune(file_name).await
}

/// 列出某个 rules 文件的存档，按时间从新到旧
pub async fn list(file_name: &str) -> Result<Vec<RulesBackupInfo>> {
    let dir = backup_dir()?;
    let mut entries = match fs::read_dir(&dir).await {
        Ok(entries) => entries,
        Err(err) if err.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };

    let mut backups = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(created) = parse_created(file_name, &name) else {
            continue;
        };

        let size = entry.metadata().await.map_or(0, |meta| meta.len());
        backups.push(RulesBackupInfo {
            name: name.into(),
            created,
            size,
        });
    }

    backups.sort_by(|a, b| b.created.cmp(&a.created));
    Ok(backups)
}

/// 读取一份存档的内容；名字必须属于该 rules 文件，避免越出存档目录
pub async fn read(file_name: &str, name: &str) -> Result<std::string::String> {
    if parse_created(file_name, name).is_none() {
        bail!("invalid rules backup name \"{name}\"");
    }

    let path = backup_dir()?.join(name);
    Ok(fs::read_to_string(&path).await?.into())
}

/// 只保留最新的 `RULES_BACKUP_KEEP` 份存档
async fn prune(file_name: &str) -> Result<()> {
    let dir = backup_dir()?;
    for backup in list(file_name).await?.into_iter().skip(RULES_BACKUP_KEEP) {
        let path = dir.join(backup.name.as_str());
        if let Err(err) = fs::remove_file(&path).await {
            logging!(warn, Type::File, "Failed to remove rules backup {path:?}: {err}");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_created;

    #[test]
    fn parses_the_creation_time_of_its_own_file_only() {
        assert_eq!(parse_created("a.yaml", "a.yaml.1790812345678.bak"), Some(1790812345678));
    }

    #[test]
    fn rejects_foreign_or_malformed_names() {
        assert_eq!(parse_created("a.yaml", "b.yaml.1790812345678.bak"), None);
        assert_eq!(parse_created("a.yaml", "a.yaml.bak"), None);
        assert_eq!(parse_created("a.yaml", "a.yaml.1790812345678"), None);
        assert_eq!(parse_created("a.yaml", "../a.yaml.1790812345678.bak"), None);
        assert_eq!(parse_created("a.yaml", "a.yaml.1790812345678.bak.bak"), None);
    }
}
