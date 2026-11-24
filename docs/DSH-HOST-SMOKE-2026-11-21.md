# DSH 真实宿主联调报告（A3 / 2026-11-21）

> 范围：在只读 DSH checkout 上，用临时 `DSH_HOME` 安装本插件并真实启动 Web 宿主，headless Chromium + CDP 做浏览器级验证；并用 `git show <tag>:<path>` 对 0.2.1-rc.4 / rc.5 做静态契约门。
> 不签名、不上传、不发布、不跑外部 PR、不 commit/push；未改动 DSH checkout 工作树，未触碰真实 `~/.dsh`。
>
> 脱敏说明：本报告中的本机绝对路径已替换为占位符（`<DSH checkout>` / `<plugin checkout>`），不包含开发者机器上的目录。

## 1. 结论

| 验证项 | 结果 | 证据 |
|---|---|---|
| 真实 DSH Web 宿主渲染 sidebar footer 角色（72px） | **PASS** | `browser.pet-72px`：img 72x72、x=8 y=590、aria-label `Tinglan` |
| 右键菜单 / Shift+F10 / Escape | **PASS** | `#dsh-famling-menu` role=menu；6 组菜单项；键盘入口同一菜单 |
| hello / probe wire（host.version / source） | **PASS** | hello: wire v2、host.version `0.2.2-rc.4`、source `client-boot`、compatible true；probe: wire v2（版本自报见风险 R2） |
| 一轮真实 Agent turn 观察到 busy/quiet | **PASS** | 插件桥 `state`：`running -> idle`（相差 360ms）、`source=events`、`lastError=null` |
| 静态宿主契约 rc.4 / rc.5 / HEAD | **PASS** 45/45 | 8 个契约文件 rc.4 与 rc.5 blob **完全相同**；rc.5→HEAD 位置移动但语义模式全在 |
| 动态自动化门 | **PASS** 46/46 | `test/dsh-host-smoke.mjs`（约 18s/轮，可重跑） |
| rc.4 / rc.5 双版本宿主实例 | **未做** | 本机只有一份已构建 checkout；见风险 R1，以静态断言替代 |

动态证据：`test/dsh-host-smoke.evidence.json`（startedAt `2026-11-21T03:21:54Z`，finishedAt `03:22:13Z`，46/46）。
契约证据：`test/dsh-host-smoke.contract.json`（45/45）。
截图：`test/dsh-host-smoke.screenshot.png`（agent turn 后，角色在左下角 72px）。

## 2. 环境与隔离

| 项 | 值 |
|---|---|
| 宿主 checkout | `<DSH checkout>`（只读；仅 `git show/rev-parse/status` 读取；本机绝对路径已脱敏） |
| 宿主版本 | `0.2.2-rc.4`（`apps/cli/package.json`） |
| 宿主 commit | `ca33fd6843b205e279c7ccb6cb73a472c78f5760`，`git describe` = `dsh-v0.2.2-alpha.3-2986-gca33fd6843` |
| 宿主工作树 dirty（**既有，非本任务**） | `package.json`、`packages/boot/app-boot/src/profile-resolution/resolver.ts`、`pnpm-lock.yaml` |
| 插件 | `dsh-famling@0.12.0`；本轮 `npm pack` 产物 348,547 B，sha256 `1e64c83c06d97144f7f3bad8ab505c6fc0d0c6ed0f2bf265a9e1f7ceec0d8b52`（共享工作树有 A4 并发编辑，sha 随其收口变化） |
| 运行环境 | WSL2 Ubuntu 24.04.4，node v24.22.1，pnpm 12.21.0，npm 11.19.1 |
| 浏览器 | Chromium 131.0.6778.33（`~/.cache/ms-playwright/chromium-1148`，本机缺 libnss3 等，脚本运行时用 `apt-get download`+`dpkg-deb -x` 解到临时目录，不装系统包） |
| 临时 DSH_HOME | `/tmp/dsh-host-smoke-*/home`（mkdtemp；web profile 全新建） |
| 模型 | DSH 自带 `@deepseek-ai/dsh-llm-mock-server`（Scriptable Messages 端点，`DEEPSEEK_BASE_URL` 注入；无真实 key、无外网模型调用） |

隔离说明：测试子进程的环境先剔除所有继承的 `DSH_*` / `DEEPSEEK_*`，再显式设置临时 `DSH_HOME`；真实 `~/.dsh` 未被测试进程读写（脚本每次 mkdtemp）。`npm pack` 只读插件目录，不写 checkout。

## 3. 复现命令

```sh
cd <plugin checkout>

# 动态：真实宿主 + CDP 浏览器（约 20s；需要已构建 checkout、node>=22、pnpm/npm、Chrome/Chromium）
node test/dsh-host-smoke.mjs \
  --checkout <DSH checkout> \
  --json test/dsh-host-smoke.evidence.json \
  --screenshot test/dsh-host-smoke.screenshot.png

# 静态：rc.4 / rc.5 / HEAD 契约门（约 2s，无宿主、无网络）
node test/dsh-host-smoke.contract.mjs --checkout <DSH checkout>
```

可选参数：`--workdir DIR`（默认 mkdtemp）、`--chrome PATH`、`--chrome-lib-dir DIR`、`--no-ensure-chrome-deps`（离线时用预置 lib 目录）、`--port/--mock-port`、`--headed`、`--clean`、`--timeout MS`、`--plugin-name`。

## 4. 真实验证细节（真实输出摘要）

### 4.1 安装路径（走宿主自己的规则，不手改 profile）

- `npm pack` → `dsh-famling-0.12.0.tgz`（348,547 B，sha256 `1e64c83c…`，以证据 JSON 为准）。
- `pnpm dsh plugin --profile web add <tarball>`（`DSH_HOME=/tmp/.../home`）exit 0；宿主自动把 `dsh-famling` 写进 `dsh.profile.bundles`，依赖记为 `file:/tmp/...tgz`。
- profile `node_modules/dsh-famling/package.json` 存在，installed version `0.12.0`，`cordis.patch.yml` 落到 profile；宿主 `engines.dsh` 检查通过。
- 全过程没有任何手写 profile/patch 的步骤；插件里的 `dsh.bundle.patch` 与 `dsh.client.platform="web"` 由宿主解析。

### 4.2 宿主 HTTP 契约

- `GET /`（token 交换后的 Cookie）→ 200，43,086 B；`__DSH_BOOT__` 含 entry `dsh-famling`，`inject=["@deepseek-ai/dsh-client-ui-sidebar","@deepseek-ai/dsh-client-ui-layout","@deepseek-ai/dsh-client-ui-renderer"]`；boot release `{version:"0.2.2-rc.4"}`；全场 77 entries。
- `GET /plugins/??dsh-famling/client.js&rev=…` → 200，94,586 B（组合脚本按当前工作树字节拼装），body 以 `window.__ModuleLoader__.load({ id: 'dsh-famling' …` 开头。
- `POST /api/famling/bridge {"op":"hello",…}` → 200：`wire v2 accepts [1,2]`、`host.version="0.2.2-rc.4"`、`host.source="client-boot"`、`compatible=true`、`versionMismatch=false`、`capabilities={llm,schedule,agentDefaultModel,brief,bridge}=true`。
- `POST ... {"op":"probe"}` → 200，wire v2（版本自报为 null/unknown，见 R2）。
- `POST ... {"op":"state"}` → 200：`available=true`、`source="events"`（`agent/status` 订阅在真实宿主成立）。
- 无 Cookie 的同一 `POST` → **401**（owner Peer 认证策略生效，说明桥不是匿名路由）。

### 4.3 浏览器（CDP 真实渲染，非 jsdom/fake）

- 角色：`button[aria-haspopup=menu]` 内含 inline PNG；`getBoundingClientRect` = **72x72**，位于 sidebar footer（x=8, y=590，`window.innerHeight - bottom < 160`）；`aria-label="Tinglan"`；img 的 width/height 属性均为 72。
- 右键：`MouseEvent('contextmenu')` 后 `#dsh-famling-menu` 出现，`role=menu`、`aria-label=Menu`；菜单项真实渲染为 `Chat… | Play ▸ | Content & characters… | Settings… | More ▸ | Quit (hide; refresh to restore)`（英文 locale）；Escape 关闭。
- 键盘：角色聚焦后 `Shift+F10` 打开同一菜单（随后 Escape 关闭）。
- 浏览器侧 `fetch('/api/famling/bridge', hello)` → ok=true、compatible=true、host.version 0.2.2-rc.4（同源 Cookie 路径成立）。
- 真实 Agent turn：新会话 → workspace picker（`Edit path` 写入临时 workspace 目录）→ composer 输入并点 Send → 插件桥 `state` 记录 `running`（1795231332360）→ `idle`（1795231332771，相差 411ms），`active=0`、`lastError=null`；聊天区渲染出 mock 模型的 `Hello from the mock model. This is the famling real-host smoke reply.`（Usage 72 tok，Completed in 1s）。
- 截图：`test/dsh-host-smoke.screenshot.png`（turn 后），工作目录内另有 `screenshot-menu-open.png`（菜单展开，含插件 first-run notice）。

### 4.4 busy/quiet 的证据边界

模型调用走 DSH 自带 mock Messages 服务，**不是真实 provider**；但 turn 本身真实经过 DSH agent loop，所以 `agent/status` 的 `running -> idle` 是真实宿主事件（`source=events`，非插件伪造）。

## 5. rc.4 / rc.5 契约对比（静态断言）

断言对象：`dsh-v0.2.1-rc.4`（插件 engines 排除的最后一版）与 `dsh-v0.2.1-rc.5`（engines 起始版），外加本次实际启动的 `HEAD`（0.2.2-rc.4）。全部用 `git show <ref>:<path>` 读 git 对象，不依赖工作树。

| 契约 | 文件 | rc.4 | rc.5 | HEAD | rc.4==rc.5 |
|---|---|---|---|---|---|
| sidebar.footer.action 类型声明 | `packages/client/ui-sidebar/src/client/contract/slots.ts` | L56 | L56 | L75 | 是 |
| sidebar.footer.action 运行时声明 | `packages/client/ui-sidebar/src/client/index.ts` | L92 | L92 | L103 | 是 |
| slots.register + slots.inject | `packages/client/ui-renderer/src/client/registry.ts` | L209/L181 | L209/L181 | L233/L205 | 是 |
| list slot 要求 id | `packages/client/ui-slots/src/index.ts` | L1233/1234 | L1233/1234 | L1295/1296 | 是 |
| ConnectionFetchRoute（POST + buffered） | `packages/client/connection/src/rpc.ts` | L147/150/153/175 | 同 | L140/143/146/168 | 是 |
| connection.fetch.register 注册与校验 | `packages/client/connection/src/rpc-host.ts` | L118/L401 | 同 | L112/L334 | 是 |
| agent/status 事件与 AgentStatus | `packages/core/agent/src/runtime-types.ts` | L109/L280 | 同 | L136/L310 | 是 |
| client module 的 `platform==='web'` 门 | `packages/client/modules/src/index.ts` | L862 | L862 | L928 | 是 |

- **8 个契约文件在 rc.4 与 rc.5 的 blob 完全相同**（证据 JSON `hashes[].fromEqualsTo=true`）。因此插件把下界写成 `0.2.1-rc.5` 并不能由这四类契约的静态位置解释；它更像是对「rc.5 宿主整体行为」的准入声明。
- rc.5 → HEAD：8 个文件全部移动（行号变化、rpc-host 大幅重构），但 8 类语义模式全部仍在。**结论：契约断言必须按语义模式做，不能按文件/行号硬编码**；本门即按模式断言，并在 HEAD 真实宿主上动态复验。
- 插件 hello/probe wire（插件侧常量，跨宿主版本由本脚本断言）：`index.js` L28 `BRIDGE_WIRE_VERSION=2`、L30 accepts v1/v2、L33 `BRIDGE_PATH='/api/famling/bridge'`、L212 hello、L236 probe、L403 state、L809 hello/probe/state 需 wire 2；`client.js` L21 同版、L856 浏览器 hello 带 `clientVersion/wireVersion`、L1196 probe、L1475 `ctx.slots.inject('sidebar.footer.action')`。
- engines 评估：`">=0.2.1-rc.5 <0.3.0 || >=0.2.2-0 <0.3.0"` → 拒绝 `0.2.1-rc.4`、接受 `0.2.1-rc.5` 与 `0.2.2-rc.4`（脚本内置 semver 比较，无第三方依赖）。

## 6. 开发过程中的失败与修正（如实记录）

| 轮次 | 现象 | 根因/修正 |
|---|---|---|
| 1 | `npm pack tarball missing: …/npm notice filename: dsh-famling-0.12.0.tgz` | 解析 stdout/stderr 混流时把 `npm notice filename:` 行当作路径；改为扫描目标目录取最新 `.tgz` |
| 2 | 浏览器阶段 45s 等待 `DevToolsActivePort` 超时 | 自动探测先命中 WSL 下 Windows `chrome.exe`（`--version` 经 interop 可跑，但 Linux user-data-dir/TCP 不通）；非 win32 平台排除 `.exe`，并改为候选失败时懒加载 Chromium 依赖库 |
| 3 | `no usable Chrome/Chromium binary` | playwright Chromium 缺 `libnss3/libnspr4/libasound`；`apt-get download` + `dpkg-deb -x` 到 workdir，LD_LIBRARY_PATH 收集所有含 `.so` 的目录 |
| 4 | `page evaluate failed: Uncaught SyntaxError: Unexpected token 'if'` | 页面表达式用字符串拼接缺分号；改为把真实函数 `fn.toString()` 序列化 + JSON 参数注入 |
| 5 | PASS 46/46 | — |

以上失败均为测试脚本自身缺陷，不是插件渲染/宿主加载失败；修正后同一脚本连续通过。

## 7. 未验证 / 风险

- **R1 rc.4/rc.5 未起宿主实例**：本机只有一份已构建 checkout（HEAD 0.2.2-rc.4）；从 tag 起第二实例需要另建 clone + `pnpm install` + `pnpm run build`（写新目录、显著耗时），当前不做。静态契约已覆盖版本差异；动态只覆盖 HEAD。
- **R2 `probe` 的 host.version/source 为 null/unknown**：`hello` 的版本来自浏览器 boot report（`source=client-boot`）；`probe` 无 client 载荷，source 启动又没有 `DSH_CLIENT_VERSION`，因此自报 unknown。**风险**：只调用 `probe` 的 JOINT-EVIDENCE 消费者拿不到宿主版本；建议由 A2/host-hook 决定是否设置 `DSH_CLIENT_VERSION` 或让插件读宿主 release service（本任务未改运行时代码）。
- **R3 模型是 mock**：未使用真实 provider/key（不碰真实凭据）。agent loop 与 agent/status 是真实的，但真实模型下的时序（更长 running）未覆盖。
- **R4 仅 web 平台**：桌面 Tauri/Electron 宿主、托盘、原生 WebView 不在本任务范围。
- **R5 首次运行需要网络**：Chromium 缺库时脚本会 `apt-get download` 3 个 deb（不装系统包）。离线环境用 `--no-ensure-chrome-deps --chrome-lib-dir DIR`，缺库则如实失败。
- **R6 并发编辑**：插件目录是共享工作树，A4 等并发修改了 `LICENSE-ART`/`NOTICE`/`README.md`/`docs/RELEASE-HYGIENE.md`，本轮 tarball sha 与已发布 npm 产物不同；`PLUGIN-MANIFEST.json` 因此当前是 stale（见 R7）。
- **R7 `npm test` 当前 2 红（非本任务造成）**：`plugin-manifest --check` 报 9 problem（源于 A4 的 packed 文件编辑），clean-checkout 用例随之失败。**本任务新增 `docs/DSH-HOST-SMOKE-2026-11-21.md` 是 packed 文件（`files` 含 `docs`），会让该清单再多一项**；需要 root 在 A 轮所有文档/许可改动落地后统一 `node scripts/plugin-manifest.mjs` 重生成并复跑。本任务不修改 `PLUGIN-MANIFEST.json`（不在写 scope）。
- **R8** 未签名/未上传/未发布；未触碰 release 与外部 PR。

## 8. 交付物清单

| 文件 | 大小 | 说明 |
|---|---|---|
| `test/dsh-host-smoke.mjs` | 57,030 B | 真实宿主 + 真实浏览器动态联调（自动 npm pack、宿主安装、起宿主/mock、CDP、证据） |
| `test/dsh-host-smoke.contract.mjs` | 21,704 B | rc.4/rc.5/HEAD 静态契约门（git 对象读取 + semver） |
| `test/dsh-host-smoke.evidence.json` | 21,744 B | 动态证据（46/46；含 host/plugin/environment/steps/checks/observations/artifacts） |
| `test/dsh-host-smoke.contract.json` | 30,457 B | 契约证据（45/45；含每版本 blob、行号、engine 结果） |
| `test/dsh-host-smoke.screenshot.png` | 65,527 B | agent turn 后的真实 GUI 截图（左下角 72px 角色） |
| `docs/DSH-HOST-SMOKE-2026-11-21.md` | 本文件 | 报告 |

说明：`test/*.mjs` 不在 `package.json` 的 `files` allowlist，不会进 npm tarball；两个 `*.json` 与 PNG 是可入库的固定名证据（内容含时间/commit/sha，可审计）。

## 9. 需要 root 集成的事项

1. **把静态契约门纳入 A2 release:check 前置**：`node test/dsh-host-smoke.contract.mjs` 快（约 2s）、无宿主、无网络、只读 git；适合每次 release 验证。
2. **动态 smoke 作为「有已构建 checkout 的机器」上的手动/定期 gate**（约 20s），不要放进默认 CI（需要宿主构建产物与 Chromium 依赖）。
3. **PLUGIN-MANIFEST.json 重生成**：等 A4/A5 与本文档全部落地后，统一 `node scripts/plugin-manifest.mjs` 并复跑 `npm test`（见 R7；本任务不越权改该文件）。
4. **R2（probe 无 host 版本）交 A2/host-hook 决策**：若要 probe 自报版本，需要宿主环境变量或插件读取宿主 release 服务；这会改插件运行时代码，本任务只报告。
5. **A5 evidence 索引**应收录 `test/dsh-host-smoke.evidence.json` + `test/dsh-host-smoke.contract.json`（固定文件名 + 内容自带每次运行的时间/commit/sha）。
6. **双版本实例（可选）**：若需要 rc.4/rc.5 真机对比，需要 root 提供第二份已构建 checkout（或在 /tmp 允许 clone+build），本任务写 scope 不含。

---

*生成：2026-11-21（Asia/Shanghai）。脚本与证据可独立复跑；本报告中的数字均来自本轮真实输出，未使用占位或估算。*
