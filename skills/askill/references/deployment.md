# 用户机器上的标准部署流程

本文件供 WorkBuddy 执行，不是交给用户自己操作的命令清单。每次从当前机器发现路径、操作系统和端口，禁止使用开发者电脑的固定目录或认证状态。

## 环境与项目

- 首次解压带有 `source-manifest.json` 的配套源码后、安装前，执行 `node <Skill目录>/scripts/verify-source.mjs --repo <源码绝对路径>`。逐文件 SHA256 失败时检查解压是否完整并重新解压到新的空目录，不覆盖旧项目。该校验只验证文件一致性，不证明来源可信；仍使用用户指定或已知发行方的包。已有用户改造的项目不强求回到旧清单，更新时保留其改动并正常检查版本；不要为通过校验删除改动。Git 克隆没有清单时 `verified:false`，继续正常版本检查。

- 先定位用户已有项目、健康服务和运行时；安装路径使用 `Askill`。用户指定或附带了配套源码包时优先校验并使用该包，在新的空目录解压；没有配套源码时再克隆 `https://github.com/Barryyangdong/Askill`。不覆盖同名非空目录；克隆或解压失败保留原目录并处理具体错误。
- Node 需要 ≥22.18 且 `node -p process.features.typescript` 有值；Python ≥3.11。先复用 WorkBuddy 可执行工具及用户已有运行时，不替换系统默认版本。缺少依赖由 Agent 安装官方发行版：Node 来源 nodejs.org，Python 来源 python.org，Git 来源 git-scm.com；Windows 可通过已安装的 winget 核对对应官方包，macOS/Linux 可复用已有版本管理器。涉及系统授权或安装协议时，仅将必要的官方确认交给用户，确认后续跑。
- 记录本次选定的 Node/Python/Git 绝对路径并带入安装器的进程环境，不能假定安装后的 PATH 已在当前进程刷新。不要把环境变量写进用户全局配置。
- 项目已有 `orchestrator/node_modules`、`desktop/node_modules`、`.venv` 和 `.local` 时先运行 doctor；根据具体缺项修复。首次运行仓库安装器。不要为重装删除 `.local` 或用户虚拟环境。
- 配套源码必须包含 `WorkBuddySetup.tsx`。当前开发版本未推送时，不把公开仓库克隆成功当作新版部署成功；这属于发布阻塞，不能拿上游包替代。

## 自动发现与修复 CLI

先运行 `configure-workbuddy.mjs --repo <绝对项目目录> --check`。内置 CLI 可用则直接验证，不安装第二份。路径发现由原适配器完成，包含常见目录、系统安装登记和运行进程。

确认内置 CLI 缺失、版本不兼容，或 WorkBuddy 能对话而内置 CLI 真实调用失败时，由 Agent 执行：

```text
node <Skill目录>/scripts/install-codebuddy.mjs --prefix <项目数据目录之外的用户专用Askill工具目录>
```

工具目录示例：Windows `%LOCALAPPDATA%/Askill/tools/codebuddy`，macOS/Linux `~/.local/share/Askill/tools/codebuddy`。路径必须展开为绝对路径，不能放进项目 `.local`。脚本只安装官方 npm 包，不改全局 PATH；已存在则复用。Node 的 npm 不在标准相邻目录时，Agent 定位它的 `npm-cli.js` 并传 `--npm-cli <绝对路径>`，不能让用户找文件。

官方来源依据：https://www.codebuddy.cn/docs/cli/installation 。脚本返回 `cli_path`，它只表示安装完成，`verified: false` 不得改写为已连接。独立 CLI 不保证继承桌面登录；需要时由 Agent 打开官方 CLI 登录交互，用户只完成本人授权，不转移认证文件。

### 官方扫码授权（标准流程的一部分）

当独立 CLI 明确 `not_authenticated`，由 Agent 启动刚安装的官方 `codebuddy` 交互进程，工作目录使用工具目录，不使用用户持仓/研究资料目录。保持用户原生登录环境，禁用工具、项目设置与额外 MCP：`--tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources none --no-session-persistence`。通过参数数组传递空字符串与JSON，避免Windows命令行重写。

使用配套启动脚本：`node <Skill目录>/scripts/login-codebuddy.mjs --repo <项目绝对目录> --cli-path <安装脚本返回的CLI路径>`。在可交互终端运行；需要用户看终端时打开可见终端。脚本使用 Node 原生参数数组，Windows 不用把空参数和JSON再拼成 PowerShell 命令；登录本身由官方 CLI 处理。退出后仍要执行真实连接测试，不把进程退出码当成已接通。

首次启动如有目录信任提示，只选择当前已安装的官方工具目录，不信任父目录。出现登录方式选择时，国内个人账号选 `Log in via Chinese Site`，CLI 会打开 `copilot.tencent.com` 官方页面；海外/企业用户按本人已有账号类型选择，不默认创建另一账号。用户扫码或确认授权，Agent保持进程等待。官方依据：https://www.codebuddy.cn/docs/cli/quickstart 。WorkBuddy能正常聊天不能证明该CLI已有授权，也不能仅凭使用相同账号断言两者额度相同。

浏览器没有弹出时，只打开该CLI本轮输出的官方登录链接，不猜测state、不读取认证文件、不把登录链接写入日志/部署记录/分发包。链接过期或用户取消时重新发起官方流程；不要循环生成链接。扫码后重新执行真实验证，不能将“浏览器授权完成”代替模型回复成功。验证成功再保存路径和当前浏览器配置；登录进程用完正常退出。

候选 CLI 使用以下命令真实验证并在成功后保存路径：

```text
node <Skill目录>/scripts/configure-workbuddy.mjs --repo <绝对项目目录> --cli-path <安装脚本返回路径> --verify --persist-cli --ui-url <实际页面地址>
```

失败不保存路径。若 `CODEBUDDY_BIN` 已显式指定，先核对该值，不自动覆盖用户环境配置。若返回 `restart_existing_service: true`，优先通过当前实例原有接口 `POST <页面地址>/api/local-agents/codebuddy/path` 提交 `{"path":"已验证的CLI绝对路径"}`，让运行服务立即加载该路径，检查响应为 `ready`。此接口沿用本机代理鉴权，不读取服务令牌；不要传给其他实例或远程服务。接口不可用才在确认属于此项目且没有运行中的研究任务后重启该项目服务；不要杀其他服务或中止研究任务。没有运行服务则直接启动。

## 启动与浏览器接入

- 使用仓库启动器自动选择端口，保留输出到本机 `.local` 日志。Windows 使用 `Start-Process -WindowStyle Hidden` 启动 PowerShell 安装器/启动器；参数中的路径正确引用，不能把路径拼成任意 shell 命令。macOS/Linux 使用持久会话或 `setsid`，不要使用会被启动器挂断的 `nohup`。
- 从启动器成功输出获取实际页面地址，通过页面代理 `/api/health` 与页面 HTML 检查服务。已有实例先确认属于当前项目再复用；不要扫描/占用无关服务。端口变化意味着浏览器配置可能不同，要重新完成该地址的接入。
- 执行 `configure-workbuddy.mjs --repo <项目目录> --verify --ui-url <实际页面地址>`。成功后由 Agent 在用户要使用的浏览器打开 `setup_url`；页面自动测试并保存，无需用户选择模型、填路径或点测试。不要在临时浏览器保存后宣称用户常用浏览器也已配置。
- 如果 WorkBuddy 无法观察页面，保留 `browser_saved: false`，交付链接供用户打开，不能仅凭命令行结果报告浏览器已保存。页面本身会自动完成测试与保存。
- 自动接入不得覆盖另一来源；有已有配置时通过原测试保存流程确认切换意图。

## 验收与中断恢复

分别记录：依赖就绪、项目启动、CLI 已发现、真实连接通过、当前浏览器保存、工作台真实回复。前一步不能替代后一步。只记录阶段与脱敏错误，不记录身份、令牌或问答中的私人资料。

再次启动从当前状态检查，复用成功步骤，不重复安装、不清数据、不无限重试。用户完成必要授权后，自动从验证步骤恢复，不让用户再跑命令。断网、权限拒绝、磁盘不足等错误保留具体原因，由 Agent 修复可处理部分；无法处理时报告实际阻塞，不给“已全部完成”的假结果。
