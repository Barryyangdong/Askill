---
name: askill
description: 在 WorkBuddy 中自动部署、启动和修复短线王（Askill）本地研究工作台，自动发现并配置 WorkBuddy 内置 CodeBuddy CLI，验证连接后交付可用页面。适用于首次安装、再次启动和连接故障。
---

# 短线王

服务 WorkBuddy 用户，默认使用 WorkBuddy 内置 CodeBuddy CLI（产品 provider 为 `cli-codebuddy`），不要求用户选择 Codex、购买 API Key 或自行排查安装目录。目标是交付能使用的工作台，而不只是给安装命令。

这是每位用户首次安装和后续修复时的正常流程，不是开发者本机的一次性配置。开始时读取 [标准部署流程](references/deployment.md)，由 WorkBuddy 执行发现、安装、启动、修复和验收；用户只处理无法代办的本人授权。不得拿开发机跑通代替新用户流程验收。

## 自动部署与启动

首次使用配套源码包时，先按标准部署流程运行 `scripts/verify-source.mjs` 校验解压完整性；检查失败先修复源码包，不进入 CLI 登录排障。已有用户改造目录按正常升级流程保留改动。

1. 定位现有 Askill 项目，保留 `.local` 数据。没有项目时使用用户指定的发行包或 `https://github.com/Barryyangdong/Askill` 克隆到 `Askill` 目录；已有目录不覆盖、不执行 reset/clean。若仓库尚未包含本 Skill 对应的自动接入组件，明确版本不匹配，不声称旧版本已支持自动配置。
2. 检查 Node ≥22.18、Python ≥3.11；需要克隆/更新源码时再检查 Git。复用已有运行时；缺少时由 Agent 从官方来源安装或使用已提供的免安装包，不让用户自行寻找依赖。安装失败保留具体错误并处理，不能关闭杀毒或系统安全保护。
3. 执行项目已有安装器：Windows `scripts\setup-windows.cmd`，macOS/Linux `scripts/setup`。已有部署先体检，不重复安装正常依赖。新安装需检查退出码。
4. 从本 Skill 的目录运行 `node scripts/configure-workbuddy.mjs --repo <项目绝对路径> --check`。使用输出中的状态继续处理，见下节。
5. 已有健康服务时复用；没有则运行项目启动器。Windows 后台启动使用隐藏窗口，并将 stdout/stderr 留在项目 `.local` 中供 Agent 检查；macOS/Linux使用启动器支持的持久方式。读取启动器实际端口，不假定默认端口可用，不杀占用端口的其他进程。
6. 运行 `node scripts/configure-workbuddy.mjs --repo <项目绝对路径> --verify --ui-url <实际本机页面地址>`，验证成功后打开返回的 `setup_url`。页面将自动进行真实连接测试并保存到当前浏览器；普通打开设置页不会触发自动接入。不用用户手动找模型、填路径或点击测试。
7. 观察“WorkBuddy 已通过真实连接测试并保存”，然后进入工作台发送一个不含私人资料的简短问题，确认真实回复后再报告“工作台对话已验证”。只跑检测不能报告业务已打通。失败由 Agent 继续按错误修复；临时故障最多重试两次，持续失败记录错误码与阻塞条件，不无限循环、不改用其他模型冒充成功。

## WorkBuddy CLI 自动修复

- `ready`（`ok: true`）：继续真实连接验证，复用用户在 WorkBuddy 的现有登录；检测到账号不代表模型调用已成功。
- `not_installed`：先启动用户已安装的 WorkBuddy，再重新检测。项目已支持常见安装目录、Windows 卸载登记、运行进程位置以及显式 `CODEBUDDY_BIN`；不要全盘扫描认证文件。Agent 发现非标准安装目录时可用项目现有 `setCodeBuddyLocation` 接口持久保存路径，不要求用户猜目录。
- 桌面安装确实不含可用 CLI 或内置运行包不兼容时，调用 `scripts/install-codebuddy.mjs` 自动安装/复用官方 `@tencent-ai/codebuddy-code`，然后通过 `configure-workbuddy.mjs --cli-path … --verify --persist-cli` 在真实验证成功后保存路径。具体参数与服务重载见标准部署流程；不得让用户自行安装、填路径，也不要因为终端 PATH 未刷新就重复安装。
- `not_authenticated`：由 Agent 打开已发现的 WorkBuddy，确认用户可在里面正常发送消息；仅本人登录/扫码需要用户操作，不把路径配置交给用户。不读取、复制或软链认证文件，不索要密码。用户完成后自动重检并继续剩余步骤。
- 检测 `ready` 但真实验证返回 `next_action: confirm_workbuddy_login`：不能报告已接通，也不能仅凭账号信息要求反复登录。若 WorkBuddy 内可正常对话，按 CLI 兼容问题处理，检查官方独立 CLI 的可用性；保留现有配置，不能移植桌面端凭据或关闭隔离。
- `probe_failed`、版本或运行包异常：保留真实错误，先检查已安装版本和项目兼容说明 `docs/model-access.md` 的 WorkBuddy 部分。复用原适配器的精简运行包处理和隔离逻辑，不通过关闭受控工具/会话隔离来“修好”连接。
- 已有其他 AI 配置：不覆盖。Agent 核对这是用户希望切换的当前实例后，通过设置页现有“测试并保存”流程切换；失败保持旧配置。

## 交付边界

页面名为短线王，英文名与安装目录用 Askill。源码改动未发布时，不把上游安装包说成新版 Askill。安装 Skill 不等于发布代码；不自动 push、建 Release 或上传 `.local`。

成交、持仓、成本、盈亏和交易日志只在本地，不能作为连接测试内容。使用现有受控工具，不给研究线程添加 Shell 或任意文件权限。保留数据时间、缺值和明日验证锁定规则，不把现在取到的历史行情当成当时快照。
