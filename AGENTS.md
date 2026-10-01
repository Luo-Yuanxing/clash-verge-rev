# Agent Guidelines

本仓库是 Clash Verge Rev 的**个人 fork**（`Luo-Yuanxing/clash-verge-rev`），只有一名开发者。
上游 `clash-verge-rev/clash-verge-rev` 的协作流程、审查策略与提交规范在此**不适用**；
本文件的规则优先于 [CONTRIBUTING.md](CONTRIBUTING.md)、`.github/` 下的任何流程文档，以及上游的版本。

[CLAUDE.md](CLAUDE.md) 与 [GEMINI.md](GEMINI.md) 都指向本文件，因此只维护这一份。

## 分支与推送

- 所有提交与推送**只发生在 `feat/custom-rules-page` 分支**上。
- **永不**把该分支合并进 `main` 或 `dev`；也不要把 `main`/`dev` 合并进来（需要上游修复时用 rebase 或 cherry-pick）。
- 不创建 Pull Request，不推送 `main`/`dev`。
- `origin` 是本人的 fork，SSH 走 443 端口（22 端口被阻断）：
  `ssh://git@ssh.github.com:443/Luo-Yuanxing/clash-verge-rev.git`
- 分支操作（rebase、reset --hard、删除分支、改 remote）先说明影响再执行。

## 已豁免的上游流程

无需遵守：issue 先行、commit 签名（本机无 GPG）、AI 披露行、Changelog 语法与平台分组校验、
`gh aw compile`、AI-slop 审查、`.husky` pre-commit hook。

hook 已通过 `git config --local core.hooksPath .git/hooks-disabled` 关闭。
注意 `pnpm install` 会因 `package.json` 的 `prepare: husky` 把它改回 `.husky/_`，之后重新执行上面那条命令即可。

## 开发偏好

- 沟通与文档用简体中文；代码、注释、commit message 用英文（沿用上游风格）。
- 动手前先说明假设与影响面；能从代码或本文件判断的不要反问。
- 新功能**后端改动尽可能少、复用尽可能多**：先查 `src/components`、`src/hooks`、`src/services`、
  `src-tauri/src/cmd` 是否已有可复用实现，再考虑新增。
- 新功能从最新稳定 tag 起步，不要从 `dev` 起步；动手前保持工作树干净。
- 提交拆小、可多次提交，每个提交只做一件事。
- 不要执行长时间编译的安装（如 `cargo install cargo-make`）；卡住就换方案并汇报，不要一直等。

## i18n

- 只维护 `en` 与 `zh`，其余语言不要求同步（`pnpm i18n:check` 会报 `missing`，可以忽略）。
- 新增文案后跑 `pnpm i18n:types` 更新 `src/types/generated/`。
- 不要运行 `pnpm i18n:format`：它的 `--align --apply` 会给其他语言补键。

## 环境事实（Windows）

- Rust 1.98.1 (MSVC)：`%USERPROFILE%\.cargo\bin`（新开的 shell 里才在 PATH 中）；`cargo-make` 未安装，不要依赖它。
- pnpm 12.8.1：`%LOCALAPPDATA%\pnpm\bin\pnpm.CMD`；Node 24.21.0。
- 依赖与 sidecar 二进制已就绪（`node_modules`、`src-tauri/sidecar`、`src-tauri/resources`）。
- `pnpm install` 会往 `pnpm-lock.yaml` 写 `@pnpm/exe` 条目；提交前用 `git restore pnpm-lock.yaml` 丢弃这一噪声。
- 工作区检出为 CRLF、索引为 LF（`core.autocrlf`）。biome 的 `format:check` 要求工作区文件为 CRLF；
  bash 脚本（`scripts-workflow/*.sh`）要求 LF，`Changelog.md` 保持 LF 才能通过。

## 提交前检查

前端改动：

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

后端 Rust 改动追加 `cargo clippy-all`。

回答结束即可提交。

## 提交风格

参考历史,但一律使用中文作为提交消息

## 补充说明

- 尽可能的不要**编译**等耗时操作,用户会自行检查,且一律不跑测试/验证性代码,但语法检查是必要的
- CRLF和LF以后不要处理