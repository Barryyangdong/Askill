# 用户机器上的标准部署流程

本文件供 WorkBuddy 执行，不是交给用户自己操作的命令清单。每次从当前机器发现路径、操作系统和端口，禁止使用开发者电脑的固定目录或认证状态。

## 环境与项目

默认接入用户自己的 WorkBuddy（`cli-codebuddy`）。首次部署使用配套 Askill 源码，Windows 运行 `scripts\setup-windows.cmd`，macOS/Linux 运行 `scripts/setup`，检查安装器退出码。仅克隆或更新源码时需要 Git。复用已有项目时保留未提交改动和 `.local`，不执行 reset 或 clean。部署授权只涵盖用户本机的项目，不自动推送代码、创建 Release 或上传用户数据目录。

- 先定位用户已有项目、健康服务和运行时；安装路径使用 `Askill`。用户指定或附带了配套源码包时优先校验并使用该包，在新的空目录解压；没有配套源码时再克隆 `https://github.com/Barryyangdong/Askill`。不覆盖同名非空目录；克隆或解压失败保留原目录并处理具体错误。
- Node 需要 ≥22.18 且 `node -p process.features.typescript` 有值；Python ≥3.11。先复用 WorkBuddy 可执行工具及用户已有运行时，不替换系统默认版本。缺少依赖由 Agent 安装官方发行版：Node 来源 nodejs.org，Python 来源 python.org，Git 来源 git-scm.com；Windows 可通过已安装的 winget 核对对应官方包，macOS/Linux 可复用已有版本管理器。涉及系统授权或安装协议时，仅将必要的官方确认交给用户，确认后续跑。
- 记录本次选定的 Node/Python/Git 绝对路径并带入安装器的进程环境，不能假定安装后的 PATH 已在当前进程刷新。不要把环境变量写进用户全局配置。
- 首次解压带有 `source-manifest.json` 的配套源码后、安装前，执行 `node <Skill目录>/scripts/verify-source.mjs --repo <源码绝对路径>`。逐文件 SHA256 失败时检查解压是否完整并重新解压到新的空目录，不覆盖旧项目。该校验只验证文件一致性，不证明来源可信；仍使用用户指定或已知发行方的包。已有用户改造的项目不强求回到旧清单，更新时保留其改动并正常检查版本；不要为通过校验删除改动。Git 克隆没有清单时 `verified:false`，继续正常版本检查。
- 项目已有 `orchestrator/node_modules`、`desktop/node_modules`、`.venv` 和 `.local` 时先运行 doctor；根据具体缺项修复。首次运行仓库安装器。不要为重装删除 `.local` 或用户虚拟环境。
- 配套源码必须包含 `WorkBuddySetup.tsx`。当前开发版本未推送时，不把公开仓库克隆成功当作新版部署成功；这属于发布阻塞，不能拿上游包替代。

## 自动发现与修复 CLI

下文命令中的 `node` 都代表上一步在当前机器上通过 `scripts/check-node.mjs` 的 Node 绝对路径。WorkBuddy 会话、用户双击窗口和已运行服务可能使用不同版本。遇到 `Unknown file extension ".ts"` 时先核对实际运行的 Node；这个错误发生在读取项目代码阶段，不能据此判断账号状态。

先运行 `configure-workbuddy.mjs --repo <绝对项目目录> --check`。内置 CLI 可用则直接验证，不安装第二份。路径发现由原适配器完成，包含常见目录、系统安装登记和运行进程。

- 返回 `not_installed` 时，先打开本机已装的 WorkBuddy 再检测。发现非标准安装位置时走下文的候选路径验证流程。
- 返回 `confirm_workbuddy_login` 时，在桌面版确认本人已登录、能正常对话，再验证内置 CLI。桌面能对话而内置 CLI 持续认证失败时，使用独立 CLI 流程。
- 返回 `probe_failed` 时，核对项目内 `docs/model-access.md` 的 WorkBuddy 兼容说明及已安装版本。保留受控工具、会话隔离和真实错误信息。

确认内置 CLI 缺失、版本不兼容，或 WorkBuddy 能对话而内置 CLI 真实调用失败时，由 Agent 执行：

```text
node <Skill目录>/scripts/install-codebuddy.mjs --prefix <项目数据目录之外的用户专用Askill工具目录>
```

工具目录示例：Windows `%LOCALAPPDATA%/Askill/tools/codebuddy`，macOS/Linux `~/.local/share/Askill/tools/codebuddy`。路径必须展开为绝对路径，不能放进项目 `.local`。脚本只安装官方 npm 包，不改全局 PATH；完整安装直接复用，启动文件缺失或上次安装中断时重跑此脚本修复。Node 的 npm 不在标准相邻目录时，Agent 定位它的 `npm-cli.js` 并传 `--npm-cli <绝对路径>`，不能让用户找文件。

官方来源依据：https://www.codebuddy.cn/docs/cli/installation 。脚本返回 `cli_path`，它只表示安装完成，`verified: false` 不得改写为已连接。独立 CLI 不保证继承桌面登录；需要时由 Agent 打开官方 CLI 登录交互，用户只完成本人授权，不转移认证文件。

### 官方扫码授权（标准流程的一部分）

内置 CLI 返回 401 时，只能确认该次真实请求未获授权。先用安装器返回的独立 CLI 路径执行下文的候选验证命令；已装的独立 CLI 有可能已经登录，验证成功就继续接入。不要把一个 CLI 的错误套用到另一个版本或路径。仅在独立候选返回 `login_codebuddy_cli` 时进入扫码流程，不读取认证文件或要求用户提供登录日志。

当发现或验证返回 `next_action: login_codebuddy_cli`，由 Agent 启动刚安装的官方 `codebuddy` 交互进程，工作目录使用工具目录，不使用用户持仓/研究资料目录。保持用户原生登录环境，禁用工具、项目设置与额外 MCP：`--tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources none --no-session-persistence`。通过参数数组传递空字符串与JSON，避免Windows命令行重写。

使用配套启动脚本：`node <Skill目录>/scripts/login-codebuddy.mjs --repo <项目绝对目录> --cli-path <返回 login_codebuddy_cli 时的 cli_path>`。即使自动发现时没有传路径，也使用此次检测结果中的 `cli_path`。在可交互终端运行；需要用户看终端时打开可见终端。脚本使用 Node 原生参数数组，Windows 不用把空参数和JSON再拼成 PowerShell 命令；登录本身由官方 CLI 处理。退出后仍要执行真实连接测试，不把进程退出码当成已接通。

如果 Windows 上的 Agent 无法打开交互终端，使用上一步已验证的 Node **绝对路径**运行以下命令，按实际路径传参：

```text
"<选定的 node.exe>" "<Skill目录>/scripts/login-codebuddy.mjs" --repo "<项目绝对路径>" --cli-path "<此次返回的 cli_path>" --prepare-windows
```

在 PowerShell 里用调用运算符 `&` 执行上面带引号的可执行文件。将输出的 `launcher_path` 交给用户双击，保持窗口打开直至官方 CLI 确认授权。使用这个生成器，不另写包含中文命令或固定版本路径的批处理，不复制一份绕过项目适配器的登录脚本。交互窗口未启动或脚本退出报错时，先修复启动错误，无需用户重复扫码。

首次启动如有目录信任提示，只选择当前已安装的官方工具目录，不信任父目录。出现登录方式选择时，国内个人账号选 `Log in via Chinese Site`，CLI 会打开 `copilot.tencent.com` 官方页面；海外/企业用户按本人已有账号类型选择，不默认创建另一账号。用户扫码或确认授权，Agent保持进程等待。官方依据：https://www.codebuddy.cn/docs/cli/quickstart 。WorkBuddy能正常聊天不能证明该CLI已有授权，也不能仅凭使用相同账号断言两者额度相同。

浏览器没有弹出时，只打开该CLI本轮输出的官方登录链接，不猜测state、不读取认证文件、不把登录链接写入日志/部署记录/分发包。链接过期或用户取消时重新发起官方流程；不要循环生成链接。扫码后重新执行真实验证，不能将“浏览器授权完成”代替模型回复成功。验证成功再保存路径和当前浏览器配置；登录进程用完正常退出。

候选 CLI 使用以下命令真实验证并在成功后保存路径：

```text
node <Skill目录>/scripts/configure-workbuddy.mjs --repo <绝对项目目录> --cli-path <安装脚本返回路径> --verify --persist-cli --ui-url <实际页面地址>
```

验证或保存失败时保留旧配置。已显式设置 `CODEBUDDY_BIN` 时先核对用户指定的值。若返回 `restart_existing_service: true`，取成功结果的 `cli_path`（已验证的可执行文件绝对路径）。确认当前实例属于此项目并已运行配套新版后，通过页面代理向 `POST /api/local-agents/codebuddy/path` 提交 `{"path":"<cli_path>","require_ready":true}`，核对响应为 `ready`。接口沿用本机代理鉴权。旧实例或无法确认版本时，等该实例的研究任务结束，按原启动方式重启该实例，从磁盘加载已验证的路径。没有运行服务则直接启动。

## 启动与浏览器接入

- 使用仓库启动器自动选择端口，保留输出到本机 `.local` 日志。Windows 使用 `Start-Process -WindowStyle Hidden` 启动 PowerShell 安装器/启动器；参数中的路径正确引用，不能把路径拼成任意 shell 命令。macOS/Linux 使用持久会话或 `setsid`，不要使用会被启动器挂断的 `nohup`。
- 从启动器成功输出获取实际页面地址，通过页面代理 `/api/health` 与页面 HTML 检查服务。已有实例先确认属于当前项目再复用；不要扫描/占用无关服务。端口变化意味着浏览器配置可能不同，要重新完成该地址的接入。
- 执行 `configure-workbuddy.mjs --repo <项目目录> --verify --ui-url <实际页面地址>`。成功后由 Agent 在用户要使用的浏览器打开 `setup_url`；空配置时页面自动测试并保存；已有有效 WorkBuddy 配置时显示复用提示。成功后地址会移除 `setup=workbuddy`，刷新页面不会再发起接入测试。不要在临时浏览器保存后宣称用户常用浏览器也已配置。
- 如果 WorkBuddy 无法观察页面，保留 `browser_saved: false`，交付链接供用户打开，不能仅凭命令行结果报告浏览器已保存。页面本身会自动完成测试与保存。
- 原配置损坏或存储不可读时，记录页面提示并保留原数据。用户希望切换现有 AI 来源时，由用户确认后走设置页的测试保存流程。

## 验收与中断恢复

接入后在实际工作台发送一个不含私人资料的简短问题，看见模型回复再标记工作台对话通过。同一临时错误最多重试两次，持续失败则记录错误码和阻塞条件。验证始终使用用户选定的 WorkBuddy。展示盘面时保留真实数据时点与缺值，次日条件沿用工作台锁定规则。

分别记录：依赖就绪、项目启动、CLI 已发现、真实连接通过、当前浏览器保存、工作台真实回复。前一步不能替代后一步。只记录阶段与脱敏错误，不记录身份、令牌或问答中的私人资料。

再次启动从当前状态检查，复用成功步骤，不重复安装、不清数据、不无限重试。用户完成必要授权后，自动从验证步骤恢复，不让用户再跑命令。断网、权限拒绝、磁盘不足等错误保留具体原因，由 Agent 修复可处理部分；无法处理时报告实际阻塞，不给“已全部完成”的假结果。
