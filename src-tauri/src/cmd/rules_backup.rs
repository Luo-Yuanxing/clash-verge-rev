use super::{CmdResult, StringifyErr as _};
use crate::{config::Config, module::rules_backup};
use std::path::Path;

/// 取订阅的规则文件名（相对 profiles 目录）：只有 rules 类型的配置才有存档
async fn rules_file_name(index: &str) -> anyhow::Result<String> {
    let profiles = Config::profiles().await;
    let guard = profiles.latest_arc();
    let item = guard.get_item(index)?;

    anyhow::ensure!(
        item.itype.as_deref() == Some("rules"),
        "profile \"{index}\" is not a rules file"
    );

    let file = item.file.as_ref().ok_or_else(|| anyhow::anyhow!("file field is null"))?;
    Ok(Path::new(file.as_str())
        .file_name()
        .map_or_else(|| file.to_string(), |name| name.to_string_lossy().into_owned()))
}

/// 列出某个订阅自定义规则的存档，按时间从新到旧
#[tauri::command]
pub async fn list_rules_backups(index: String) -> CmdResult<Vec<rules_backup::RulesBackupInfo>> {
    let file = rules_file_name(&index).await.stringify_err()?;
    rules_backup::list(&file).await.stringify_err()
}

/// 读取一份存档的内容用于预览
#[tauri::command]
pub async fn read_rules_backup(index: String, name: String) -> CmdResult<String> {
    let file = rules_file_name(&index).await.stringify_err()?;
    rules_backup::read(&file, &name)
        .await
        .map(Into::into)
        .stringify_err()
}
