# Famling · 汀岚

在 DSH 左侧栏左下角、账号信息下方显示一个小型 famling 桌宠入口。**0.10.1 起是极简 UI**：默认只渲染角色，角色以外零常驻按钮；右键角色（或 Shift+F10 / ContextMenu）打开分级菜单。**角色就是主题**：内容中心一级分类固定为 角色 / 自定义 / 内容包 / 市场。**0.10.2 起（0.10.3 发布）有插件安全地板**：聊天危机关键词本地短路、发送去向与首启告知、清除本机设置/同意（撤回）、AI 聊天开关；**0.10.4 起有四层缩放**（整体 / UI+文本 / 图像 / 组件，只作用于本插件 widget，不改 DSH 全局主题）；**0.10.6 起有低打扰控制**（安静时段 / 动画偏好 / 暂时隐藏；入口保持 96 KiB 首屏预算）；**0.10.7 起有 Host 能力协商**（bridge wire 2 的 hello/probe 握手、可选 llm/schedule 降级、content-extension v3 契约握手）；**0.10.9 起 content-extension v3 追加可选合规字段**（license / aiProvenance / pack 级 compatibility / canonical usage statement，向后兼容、严格模式可选）；版本/README/LEGAL/locale/package 真值由测试统一校验。

- 显示 72px 像素桌宠：汀岚 / 塞尔凯克卷毛猫（卷毛灰白） / 金毛，台词、动作与聊天人格随形象变化。
- 动画：每角色 12 clip，帧数按 manifest（dog 68 / cat 72 / human 68，共 208 帧；clip：idle 循环、idle_blink 眨眼、pat_head、ball_throw、ball_chase、paw_face、scratch、stand_wag、chase_tail、walk、run、attack），随机微动作只取本形象的 clip。
- 动画按角色懒加载（0.8.6）：入口 client.js 不再内嵌三套 base64；首次显示 human/cat/dog 时通过 DSH `require.async` 拉取 `client.anims.<kind>.js`。0.10.7 实测：入口 **95.2 KiB**（97,472 B，gzip 27.2 KiB；首屏预算 0.10.1 由 72→78 KiB、0.10.4 为四层缩放模型由 78→**96 KiB**，0.10.6/0.10.7 未再上调；sprite payload 仍走懒加载 chunk，入口 = 拆分前审计基线的 30.97%）、首帧约 156.9 KiB、全量约 342.5 KiB；chunk sha256 进入 embed/verify 门禁。
- 内容中心 + 统一设置弹窗 + 首启安全卡 + 缩放控件按需加载（0.10.2 引入 chunk，0.10.4 扩容，0.10.6 把输入面板/同意/使用限制弹窗也移入）：`client.content.js` 是包内懒加载 chunk（68.1 KiB，gzip 19.1 KiB，0.10.9 实测；0.10.7 增加 Host 能力面板，0.10.9 增加合规元数据展示），只在首次安装显示首启安全卡、打开「内容与角色…」「设置…」「聊两句…」「更多 → 使用限制与版本」、或首次需要 TTS/ASR 同意弹窗时通过 `require.async('./client.content.js')` 拉取；角色卡不预加载任何角色动画 chunk。
- 帧时长（0.8.4）：每帧停留时间读 manifest `holdMs`（缺省 1000/fps），非循环 clip 播完后按 `durationMs`/hold 总和回到 idle；cat 伸懒腰 10 帧 / 3200ms 按 300/300/300/350/400/400/400/350/250/150 逐帧播放。
- 点击区域（0.8.2）：点击人物头部/身体/尾巴分别触发 pat_head/stand_wag/chase_tail；区域来自与独立 famling 共用的 `regions.json`（96×96 逻辑画布 + idle gating），非 idle/idle_blink 状态或空白区域不动作，不回退随机动作。
- 随机回话（0.8.3）：每条区域规则与每个互动动作都带 `says` 数组，命中时随机挑一条且连续两次不会重复；气泡文案全量来自共用 `regions.json`。
- 物种专属互动（0.8.3）：互动菜单由 `ANIMS[character].actions` 数据驱动——汀岚 摸头/递纸/挥手/整理蝴蝶结/聊两句；塞尔凯克卷毛猫 摸头/伸懒腰/洗脸/追尾巴/跑一跑；金毛 摸头/丢球·捡球/捡球/追尾巴/跑一跑（丢球后 500ms 接追球）。猫/人没有球类动作。
- 交互入口（0.10.1）：默认零按钮；右键角色 / Shift+F10 / ContextMenu 打开分级菜单（一级 5 项：聊两句… / 互动 ▸ / 内容与角色… / 设置… / 更多 ▸）。互动页跑本角色真实存在的 clip，仅本地 UI 状态，不调用模型、不上传数据。
- 聊天人格随形象切换（0.8.1）：输入面板的 `op:"chat"` 请求带当前 `character`（`human`/`cat`/`dog`，缺省或非法回退 `human`）；Host 用 `PERSONAS` 选 system prompt。三条人格共用安全边界：不冒充真人/官方/专业顾问，不诱导依赖/恋爱/付费/未成年人关系，不输出违法/隐私。
- 聊天安全地板（0.10.2 / MB-020/021/022/024）：`index.js` 在 `ctx.llm.stream` 之前用 `crisisKeyword` 做本地危机关键词短路（自伤/自杀、伤害他人、家暴/性侵、急症；中文短语子串匹配、英文按词首匹配，避免 `scraped` 误命中 `raped`），命中返回固定 12356/110/120/专业机构文案且 `meta.safety="crisis-local-resource"`、`llmCalls:0`、不回显/不落盘/明确「不是诊断」；输入面板常驻 AI 声明含发送去向（文本经 DSH Host 发给 DSH 中配置的模型供应商）与危机求助；设置「数据与边界」含发送去向、危机资源、与 DSH 的边界说明、「AI 聊天」开关、「清除本机设置与同意」（删除本插件 `dsh-famling/*` 浏览器键 = 撤回 TTS/ASR 同意，不改 DSH/供应商数据）；首次安装显示一次性可关闭安全卡（UI 在懒加载 chunk，仅写 `dsh-famling/first-run/v1`）。
- 语音规则：汀岚可用浏览器 TTS（独立同意）；塞尔凯克卷毛猫/金毛只用空心 thought 气泡，永不调用 `speechSynthesis`。
- 内容中心（0.10.0）：角色 / 自定义 / 内容包 / 市场 四个一级 tabs；入口在右键菜单「内容与角色…」。设置弹窗（0.10.1）集中所有可调项并含折叠的高级/调试组。切换即时生效、不刷新页面，不改 DSH 全局主题。
- 内容扩展接口（0.10.0，预留 v3；0.10.9 补可选合规字段）：`content-extension.mjs` 导出 `CONTENT_EXTENSION_POINTS`（七类 kind，含 role + 0.10.9 `compliance` 元数据）、`validateContentPack`、`CONTENT_PACK_EXAMPLE`；纯数据契约，不联网 / 不执行 pack 脚本 / 不注入 HTML / 不加载资产；所有 pack 强制 `usageDeclaration`；0.10.9 起可选 `license` / `aiProvenance` / pack 级 `compatibility` 与 canonical 声明锚点（向后兼容，`requireCompliance` 严格模式可选）；本版本不加载任何 pack。
- 不宣传 roleplay；不替代独立 famling 应用。

限制：这是 DSH 客户端插件，不是完整桌宠；完整可执行版在 `PerryLink/famling`。

## 最终界面结构（0.10.1）

- 默认只显示 72px 人物；角色图本身是唯一常驻 button（可 Tab 聚焦，`aria-haspopup="menu"` / `aria-expanded`），角色以外零按钮。
- 右键角色 / Shift+F10 / ContextMenu 打开自绘分级菜单：一级 5 项 **聊两句… / 互动 ▸ / 内容与角色… / 设置… / 更多 ▸**；互动/更多是带「« 返回」的二级页面。菜单 `role="menu"` + `role="menuitem"`、`aria-activedescendant`、roving tabIndex；`position: fixed` 并按视口夹取（8px 边距）；方向键/Home/End/←→/Enter/Escape/Tab 全可用；菜单外点、窗口失焦关闭，关闭后焦点回到角色。
- 聊两句…：文本框 + 语音输入；聊天请求带当前形象，Host 据此切换人格。面板常驻 AI 声明（含发送去向与危机求助 12356/110/120）；「AI 聊天」关闭后发送按钮禁用且不发请求；Host 侧危机关键词命中时本地短路返回固定资源、不调模型。
- 互动 ▸：按当前形象渲染物种专属动作（数据来自 `regions.json` actions），点击后跑对应 clip + 随机回话（金毛丢球→追球）；点击人物按头/身/尾区域触发对应动作并从该区域 says 随机回话，空白区域不动作。
- 设置…：统一设置弹窗——**四层缩放（0.10.4：常用「整体缩放」+ 独立轴「UI + 文本 / 图像」+ 高级折叠「组件缩放」）**、**低打扰（0.10.6：安静时段 / 动画偏好 / 暂时隐藏）**、语音朗读（仅汀岚）、说话气泡、**显示菜单按钮（默认关闭）**、**数据与边界（0.10.2：AI 聊天开关、发送去向、危机资源、DSH 边界、清除本机设置与同意）**、Advisers 摘要、对话模式、气泡/面板主题、背景、字体/字号/行高、内容与角色入口、恢复角色默认；底部「高级 / 调试」折叠组显示版本、当前状态、全部本地存储键与 **Host 握手块（0.10.7：hello 状态、宿主版本、bridge/内容契约版本、能力矩阵、降级项、「重新检测 Host 能力」）**。
- 首启安全卡（0.10.2）：未确认时显示一次性、非阻断、可关闭卡片（发送去向 + AI 声明 + 12356/110/120 危机资源），确认只写 `dsh-famling/first-run/v1`；卡片 UI 在懒加载 chunk，不占首屏预算。
- 内容与角色…：角色=主题的内容中心弹窗（四个一级 tabs，见下节）；导入/市场都留在内容包/市场 tab 内，不占一级菜单。
- 更多 ▸：提醒…（输入面板 + 提醒表单）、使用限制与版本…（弹窗）。
- 菜单按钮：开启后角色旁出现小的「⋯」触发器（`aria-label` 为「菜单」）；偏好持久化到 `dsh-famling/menu`（`{ button: boolean }`），菜单展开状态与子页不持久化，每次打开都从一级开始。
- 气泡：默认白底 #ffffff / 深色 #111111 字 / 灰色实线或虚线边框（内容中心可切 paper / night 主题）；汀岚实心 speech（可用 TTS），猫/狗空心 thought（永不 TTS）；每次点击从对应 says 随机取一句，不遮挡人物。
- 动画数据与点击区域数据由 `scripts/embed-anims.mjs` 生成，勿手改 `client.js` 生成块；`scripts/verify-anims.mjs` + `scripts/qa/index.html` 可脱离 DSH 校验/预览。

## 四层缩放（0.10.4，MB-053）

设置弹窗按 famling `src/pet/scaling.ts` 的同一语义分四层，全部只作用于本插件 widget 的内联样式与私有 CSS 变量，**从不写 `document.documentElement`、不改 DSH 全局主题或宿主缩放**：

| 层级 | 位置 | 控件 | 语义 |
|---|---|---|---|
| 1 整体缩放 | 常用 · 第一个控件 | 原生 range 50%–200%（step 5%） | 所有内容一并缩放：角色图像、UI/文本、气泡、菜单、面板 |
| 2 UI + 文本 | 缩放（独立轴） | range 40%–150%，100% = 跟随整体 | 只改文本/控件；「跟随整体」一键复位 |
| 2 图像 | 缩放（独立轴） | range 50%–200%，100% = 跟随整体 | 只改角色/预览图；窗口放不下时自动贴合 |
| 3 组件缩放 | 高级 / 调试（默认折叠） | 每个组件：继承（默认）/ 75% / 125% / 150% | 气泡 / 右键菜单 / 面板 / 内容中心 / 设置弹窗；覆盖值 = 继承 UI 倍率 × 覆盖倍率，可恢复继承 |

- 生效值 = `global × axis` 后 clamp：UI 文本 0.6×–2.5×、图像 0.5×–2×（72px → 36–144px）、组件 0.5×–2×。气泡宽度硬上限 240px 且左边界按视口夹取；菜单/面板用「布局尺寸 ÷ zoom + transform scale」在缩放后仍夹在视口内。
- 持久化 `dsh-famling/scale/model` + `/global` + `/ui-text` + `/image` + `/component/<id>`；默认/跟随值不写轴键，恢复默认只写 `global=1` 与版本标记。旧绝对倍率 `dsh-famling/scale`（数字或 `{pet,text}` JSON）/ `dsh-famling/text-scale` 只在没有版本标记时一次性迁移（global=100%，等效值不变），旧键保留但失效；清除本机设置会删除全部 `dsh-famling/*` 缩放键。
- 键盘 / ARIA：原生 range（方向键可用）+ `aria-label`/`aria-valuetext`；高级组 `aria-expanded`；组件下拉 `aria-label`；跟随时「跟随整体」`disabled`；设置弹窗 `role="dialog"`。
- 测试：`test/client-scale.test.js`（纯模型 + fake React 行为 + 无业务 bridge 请求），`npm test` 合计 200 项。

## 低打扰：安静时段 / 动画偏好 / 暂时隐藏（0.10.6，E7 剩余 / P-04）

与 famling 桌面壳 `src/pet/low-disturb.ts` + `src/pet/reduce-motion.ts` 的统一语义（C-11：安静 = 关闭自动/环境输出，交互回应仍可用；显式设置 > 系统偏好）：

| 能力 | 默认 | 运行时语义 | 持久化 |
|---|---|---|---|
| 安静时段 | 开启，22:00–08:00 | 时段内自动环境气泡与随机微动作 = 0；用户点击/菜单动作/聊天/提醒回复**不受影响**。跨午夜按「开始 ≤ now 或 now < 结束」；`start === end` 或关闭开关 → 不静默。 | `dsh-famling/settings.quietHours = { enabled, start, end }` |
| 动画偏好 | auto（跟随系统） | `auto` 挂载时读取 `prefers-reduced-motion: reduce`；`on` 强制帧动画/眨眼/微动作；`off` 冻结为首帧。旧 `motion` 布尔迁移：`false → off`、`true/缺失 → auto`。系统偏好运行中变化需重新加载（预算内不挂 change 监听）。 | `dsh-famling/settings.motionMode = auto / on / off` |
| 自动微动作 | 60–90s | P-04：间隔由 0.10.5 的 11–20s 提高到 ≥60s；安静时段触发时重新计时、不播放。 | 运行时 |
| 暂时隐藏 | 关闭 | 「更多」或设置内「隐藏 1 小时 / 隐藏到明天」；隐藏时只渲染一个 ≥24×24px 的「显示」恢复控件（`aria-label`），可提前恢复；`hidden-until` 过期/损坏视为未隐藏。 | `dsh-famling/hidden-until`（毫秒） |
| 静音 | 关闭 | 只停 TTS：气泡字幕保留；正在朗读的 utterance 立即 cancel；猫/狗仍为 thought 且永不 TTS。 | `dsh-famling/settings.sound` |

- 设置弹窗新增「低打扰」分组（`client.content.js` 的 `lowDisturbGroup`）：开关、两个 `input[type=time]`（非法/空值保留原值）、三选一动画偏好（`aria-pressed`）、状态行（当前是否在安静时段）与两个隐藏按钮；「更多」菜单与设置内隐藏入口指向同一实现。
- 隐藏不是永久退出：`exit`（退出，刷新恢复）仍与隐藏分开；隐藏按截止时间自动恢复，且跨重载保持（`loadHiddenUntil` 只接受未来时间戳）。
- 首屏预算：输入面板/同意弹窗/使用限制弹窗与低打扰 UI 文案全部在懒加载 `client.content.js`；`client.js` 只保留纯模型与接线。
- 测试：`test/client-lowdisturb.test.js`（纯模型边界 + 静态接线）与 `test/client-behavior.test.js`（fake clock / matchMedia / hidden 存储行为），`npm test` 合计 200 项。


## DSH 宿主能力协商 hello/probe（0.10.7，MB-034 / E3-T2）

目标：插件在**能力未知或缺失**的 DSH Host 上仍能激活并如实降级，不靠 `engines.dsh` 假设 llm/schedule 一定存在。主机半与客户端半通过同源 bridge 的 **wire 2** 握手；wire 1 老客户端行为不变。

### 主机半（index.js）

- `export const inject = ['connection']`：只有认证同源 bridge 是必需服务；`llm` / `schedule` / `agentDefaultModel` 每次调用通过 `hostService(ctx, name)`（`ctx.get(name)` → `ctx[name]` 回退）读取，服务后加载也能被下一次调用发现。
- `detectHost(ctx) → { services, capabilities, probes, degraded }` 是唯一宿主适配层：`capabilities = { llm, schedule, agentDefaultModel, brief, bridge }`，`probes[] = { id, available, method }`，`degraded` = 不可用能力 id 列表。纯读、无副作用。
- `hostIdentity(payload)` 版本来源：`process.env.DSH_CLIENT_VERSION` → `source: "env:DSH_CLIENT_VERSION"`；否则客户端 `hello.hostVersion`（来自 `window.__DSH_BOOT__.release`）→ `source: "client-boot"`；都没有 → `version: null, source: "unknown"`。不猜、不伪造。
- `handleHello(ctx, payload)`：校验/返回 `v: 2`、`plugin: { name, version }`（读本包 package.json）、`wire: { version: 2, min: 1, accepts: [1,2] }`、`contract: { bridge: 2, contentExtension: 3, contentExtensionSchema: 3 }`、`host: { version, commit?, source, engines }`、`client` 上报值、`capabilities`、`probes`、`degraded`、`compatible`、`versionMismatch`。`contentExtension` 直接取 `content-extension.mjs` 的 `CONTENT_EXTENSION_VERSION`。
- `handleProbe(ctx)`：同样的能力/契约 + `generatedAt`；无副作用，不调模型、不建提醒。
- bridge 版本策略：`v === 1 || v === 2` 才受理；`hello` / `probe` 要求 `v: 2`（否则 426 `E_WIRE`）；`echo` / `chat` / `brief` / `task` / `task-delete` 在 wire 1/2 均可用。
- 缺能力错误：chat 无 llm → 503 `E_LLM` + `{ capability: "llm", unavailable: true }`；task/task-delete 无 schedule → 503 `E_TASK` + `{ capability: "schedule", unavailable: true }`。危机关键词短路在任何模型/服务检查之前，因此无 llm 时仍返回本地资源。

### 客户端半（client.js）

- 挂载后发一次 `POST /api/famling/bridge`：
  `{ v: 2, op: "hello", clientVersion: PLUGIN_VERSION, wireVersion: 2, contentExtension: 3, hostVersion?, hostCommit? }`，4s 超时，失败/超时/非 JSON 一律降级为 `{ legacy: true }`。
- 成功时把 capability 文档存入 state；`sendInput` 在 `settings.chat` 开关之后检查 `host.capabilities.llm === false` → 本地气泡提示、不发 bridge；`sendTask` 同理检查 `schedule`。
- 输入面板（client.content.js）在 `llm === false` 时禁用发送并显示 `noModelDetail`；`schedule === false` 时提醒入口替换为 `noScheduleDetail`。
- 设置 → 高级 / 调试 → Host 块：握手状态（已握手 / 兼容模式 / 检测中）、宿主版本、bridge 契约 v2、内容扩展契约 v3、能力矩阵、降级项、版本不一致提示、「重新检测 Host 能力」（`op: "probe"`）。
- 老 Host（无 hello）→ 「兼容模式」，客户端保持 0.10.6 行为（乐观允许 chat/reminder，由 Host 的错误兜底）；不阻塞角色渲染。
- 版本/契约不一致只提示，不阻塞、不崩溃。

### content-extension v3 兼容

本版**不升 v4**：`content-extension.mjs` 的 pack/entry schema 仍为 v3，并新增：

- `CONTENT_EXTENSION_VERSION = 3`（契约 revision，`CONTENT_EXTENSION_POINTS.version` 引用它）。
- `CONTENT_EXTENSION_COMPATIBILITY = { current: 3, supportedPackSchemaVersions: [3], policy: "additive-within-major", breakingChange: "..." }`（冻结）。
- `isContentExtensionCompatible(version)`：仅接受整数 3，未知/旧/新版本 fail-closed。
- hello/probe 的 `contract.contentExtension` 与该模块同源；测试同时冻结模块常量与 wire 字段，防止 schema 与握手各自漂移。

0.10.9（MB-032/033）在**同一条 v3 revision** 内追加可选合规字段（不升 v4、不改 wire）：

- pack / entry 可选 `license`（`spdx` + `attribution`，可选 `url` / `file`）与 `aiProvenance`（`generated` + `disclosure`，可选 `tools`）；pack 还可选 `compatibility`（`minPluginVersion` + 可选 `maxPluginVersion`）。role entry 的 `compatibility` 仍必填。
- `usageDeclaration` 可追加 canonical `statement` / `statementRef` / `statementSha256`，出现时必须等于冻结锚点（`CONTENT_USAGE_STATEMENT` / `_REF` / `_SHA256`，与 client `SHARED_CONTENT_SEMANTICS` 同源）。
- 字段缺失默认只进 `warnings`（`ok` 不变），pre-0.10.9 的 v3 pack 继续合法；Host 可用 `{ requireCompliance: true }` 严格 fail-closed，用 `{ pluginVersion: "x.y.z" }` 校验 pack/role 兼容区间（纯函数 `isPackCompatibleWithPlugin`）。
- 冻结的第一方锚点：`CONTENT_LICENSE_TEMPLATE` / `CONTENT_AI_PROVENANCE_TEMPLATE`；内容中心「内容包」页展示内置包的许可 / AI 来源 / 兼容性。

### 测试

- `test/host-bridge.test.js`：inject 最小化、最小 Host 激活、hello 字段/版本来源/契约不兼容、probe 无副作用、缺能力 503、wire 1/2 矩阵、版本不一致提示。
- `test/client-behavior.test.js`：挂载 hello 载荷（含 `__DSH_BOOT__.release`）、缺 llm/schedule 的发送与面板降级、老 Host 兼容模式、版本/契约不一致提示、手动 probe。
- `test/client-static.test.js`：静态冻结 `CONTENT_EXTENSION_VERSION` / 兼容策略 / hello wire 字段，以及 v3 合规字段的可选性与示例 pack。
- `test/content-extension-compliance.test.js`（0.10.9）：旧 v3 pack 向后兼容（warning-only）、canonical 声明锚点、license / aiProvenance / compatibility 的 fail-closed 校验、严格模式必需字段、`pluginVersion` 版本门、纯函数 `isPackCompatibleWithPlugin` 与校验器纯数据/不抛异常。
- `test/parity-contract.test.js`：双端冻结 license / aiProvenance / canonical usage statement 锚点（含 SHA-256 重算）与 `CONTENT_LIMITS` 新上限。

## 内容中心：角色就是主题（0.10.0）

右键菜单 →「内容与角色…」打开懒加载面板（`client.content.js`）。角色/声音/对话/主题/背景/字体不再是一级并列主视觉：一个**角色 bundle** 同时包含 character、voicePolicy、dialogue、theme、background、font；点「一键应用」= 原子地应用六个组件。全部为本地 React state + localStorage，切换即时生效、不刷新页面。

### 一级 tabs

| Tab | 内容 | 持久化 / 行为 |
|---|---|---|
| 角色 | 汀岚 / 塞尔凯克卷毛猫 / 金毛三张角色卡（glyph 头像 + 名称 + 一句说明 + 声音/对话/外观摘要 + 「一键应用」+ ✓ 当前标记） | 一键应用同时设置 character、voice(TTS 策略)、dialogue mode、theme/background/font，并写 `dsh-famling/role`；角色卡不预加载其它角色动画 chunk；origami 仅数据预留，素材未安装，不出卡片。 |
| 自定义 | 声音 / 对话 / 主题 / 背景 / 字体分组紧凑控件（保留 0.9.1 能力：TTS 开关与浏览器 voiceURI、standard/brief/quiet、default/paper/night、transparent/paper/dark、system/serif/mono + 字号/行高） | 顶部说明「仅修改当前角色的搭配，不改变角色预设」并显示「角色预设 / 已自定义」；组件改动只写对应旧键，角色 id 不变；「恢复角色默认」按当前角色 bundle 重置全部组件。 |
| 内容包 | 已安装内容（当前只有内置包）、v3 声明检查状态、0.10.9 合规元数据展示、资产包导入入口（需 Host 支持） | 显示内置 4 bundle 包与「没有导入的外部内容包」；声明检查：researchOnly=true + 六项禁止用途；合规元数据：内置包的 license（spdx + attribution）/ AI 来源（generated + disclosure）/ compatibility（content-extension v3 + minPluginVersion）；资产包 zip/文件夹清单 + sha256 由 Host 解析，本版本不读取文件、不执行脚本、不加载素材、不联网。 |
| 市场 | 远程市场占位与接口说明 | 固定显示「远程市场接口已预留，服务器未配置」；展示预留 `catalogUrl` / `configKey` 字段（`dsh-famling/market/catalog` / `dsh-famling.market`）；不发起网络请求、不展示伪造商品。 |

### 角色 bundle 与回填

| role | character | 声音策略 | 对话 | theme / background / font |
|---|---|---|---|---|
| human | 汀岚 | speech，可浏览器 TTS（仍受独立同意） | standard | default / transparent / system |
| cat | 塞尔凯克卷毛猫 | thought，永不 TTS | standard | night / dark / serif |
| dog | 金毛 | thought，永不 TTS | standard | paper / paper / system |
| origami | 预留 | thought，永不 TTS | standard | night（共享 high-contrast 显式映射）/ transparent / mono（数据预留，不可应用） |

以上六个组件与 famling `public/content/library.json` 的 `rolePresets` 对齐；origami 共享包使用 `high-contrast` 主题，本插件没有该主题，所以显式映射为 `night` 且 `available:false`，绝不静默错配。对话模式与共享 `dialoguePacks` 对齐：standard = 240 字 / 70%、brief = 80 字 / 40%、quiet = 50 字 / 5%；改值必须同改 famling 与插件。

持久化键（全部沿用 0.9.x，新增 role）：

- `dsh-famling/role`：当前角色主题（primary）。
- `dsh-famling/menu`（0.10.1）：`{ button: boolean }`，只记录「显示菜单按钮」开关；菜单展开/子页是临时状态。
- `dsh-famling/character`：当前形象（human/cat/dog）。
- `dsh-famling/settings`：sound / **motionMode（0.10.6：auto/on/off，旧 motion 布尔迁移）** / **quietHours（0.10.6：{enabled,start,end}，默认 22:00–08:00 开启）** / bubble / voiceURI / **chat（0.10.2 AI 聊天开关，默认 true）**。
- `dsh-famling/hidden-until`（0.10.6）：暂时隐藏截止的毫秒时间戳；过期/损坏视为未隐藏，清除本机设置时删除。
- `dsh-famling/first-run/v1`（0.10.2）：首启安全卡确认标记（`"1"`）；删除后下次启动重新显示一次性卡片。
- `dsh-famling/consent/v1`：TTS/ASR 独立同意 `{tts, asr}`；设置内「清除本机设置与同意」= 撤回。
- 以上 `dsh-famling/*` 键均可由设置「数据与边界 → 清除本机设置与同意」一次性删除；该操作不触碰 DSH 宿主/会话/供应商数据。版本参考值见 `package.json`，由 `test/version-truth.test.js` 校验。
- `dsh-famling/dialogue`：standard / brief / quiet。
- `dsh-famling/theme`：default / paper / night。
- `dsh-famling/background`：transparent / paper / dark。
- `dsh-famling/font`（JSON）：family / size / lineHeight。

应用角色 = 一次写六个组件键 + role；自定义 = 只覆盖单个组件键，role 仍记录“角色 + 覆盖”。加载顺序：读 role；没有时从已存 character 反推；缺失组件用该角色 bundle 回填，显式组件键优先（0.9.x 升级用户首次渲染即获得回填）。TTS 开关仍受独立同意门禁：bundle 只设置策略，未同意时保持关闭；切到猫/狗取消正在朗读的语音。

### 懒加载与预算

入口 `client.js` 95.2 KiB（97,472 B / gzip 27.2 KiB）< 96 KiB 首屏预算（0.10.1 由 72→78 KiB，右键菜单必须在首屏可用；0.10.4 四层缩放模型/面板贴合由 78→96 KiB；0.10.6/0.10.7 未再上调预算；sprite payload 仍全部走懒加载 chunk，入口 = 拆分前审计基线的 30.97%，首帧 156.9 KiB = 51.1%）；内容中心 + 统一设置弹窗 + 首启安全卡 + 缩放控件 + 输入/同意/使用限制弹窗 + Host 能力面板 + 合规元数据展示 `client.content.js` 68.1 KiB（gzip 19.1 KiB，0.10.9 实测）首次安装或首次打开才下载；三个角色动画 chunk 仍只在显示对应角色时下载。DSH 模块表通过包内相对 chunk 名 `client.content.js` 解析，不走网络/CDN；chunk 失败时客户端分别显示本地「内容中心加载失败」/「设置面板加载失败」提示，右键菜单、角色互动与聊天仍可用。

## 内容扩展接口 CONTENT_EXTENSION_POINTS v3（预留）

公开契约：[content-extension.mjs](../content-extension.mjs)（package export：`dsh-famling/content-extension`）。`version: 3`（pack `schemaVersion: 3`）、`status: "reserved"`：schema 已发布，本版本没有任何 pack 加载器。

导出：

- `CONTENT_EXTENSION_POINTS`：version / status / transport（`network:false, execute:false, innerHTML:false, worker:false, assets:false`）/ **compliance（0.10.9：可选合规字段形状、冻结锚点与严格模式选项）** / pack schema（schemaVersion、fields、optionalFields、sources、limits、idPattern、versionPattern、usageDeclaration、assets、remoteCatalog）/ entry schema（**七类 kinds**：role / character / voice / dialogue / theme / background / font；fields、optionalFields、roleFields、idPattern、preview 类型与路径策略、permissions、各 kind 的 apply 形状、role 的六组件与 compatibility、本地字体栈策略）/ validation。
- `validateContentPack(pack, { allowRemote?, requireCompliance?, pluginVersion? }) → { ok, errors, warnings }`：纯数据校验，不抛异常、不执行、不解析 URL、不读文件、不联网；`warnings` 报告缺失的可选合规字段（不改变 `ok`）。
- `CONTENT_PACK_EXAMPLE`：合法 v3 示例 pack（完整 usageDeclaration + canonical 声明字段、license / aiProvenance / compatibility、一个 role bundle + 一个 theme entry；默认与严格模式都合法）。
- `CONTENT_EXTENSION_VERSION` / `CONTENT_EXTENSION_COMPATIBILITY` / `isContentExtensionCompatible(version)`（0.10.7）：v3 单版本兼容策略（`additive-within-major`；未知/非整数版本 fail-closed），hello/probe 的 `contract.contentExtension` 直接引用该版本号；0.10.9 的合规字段不改变该 revision。
- `CONTENT_USAGE_STATEMENT` / `CONTENT_USAGE_STATEMENT_REF` / `CONTENT_USAGE_STATEMENT_SHA256`：canonical 研究用途短句、来源文件与 SHA-256 锚点（与 client `SHARED_CONTENT_SEMANTICS` 同源）。
- `CONTENT_LICENSE_TEMPLATE` / `CONTENT_AI_PROVENANCE_TEMPLATE`：冻结的第一方许可与 AI 来源锚点（parity 测试与 client 块逐项对齐）。
- `isPackCompatibleWithPlugin(compatibility, pluginVersion)`：兼容区间纯函数，畸形输入 fail-closed。
- `PROHIBITED_USES` / `USAGE_DECLARATION_TEMPLATE`：六项禁止用途的 canonical 列表与**最小**声明模板（0.10.9 的 canonical 字段是可追加项，不进入该模板）。

### 强制 usageDeclaration

每个 pack（bundled/local/remote）都必须含：

```json
{
  "researchOnly": true,
  "prohibitedUses": [
    "emotional-companionship", "virtual-partner", "professional-advice",
    "minor-intimacy", "impersonation", "illegal-use"
  ]
}
```

缺失/`researchOnly !== true`、少一项、多一项、重复、未知 token 或未知字段一律拒绝。role entry 不豁免 pack 级声明。

### 合规字段（0.10.9，可选且向后兼容）

v3 在 0.10.9 以**追加可选字段**补齐合规元数据（不升 v4）：

| 字段 | 位置 | 形状 | 缺失时 |
|---|---|---|---|
| `license` | pack / entry 可选 | `{ spdx, attribution, url?, file? }`；spdx 2..64 字符（如 `CC-BY-4.0` / `LicenseRef-...`），attribution ≤200 纯文本，url 仅 https（不 fetch），file 仅安全相对路径（不打开） | 只进 `warnings` |
| `aiProvenance` | pack / entry 可选 | `{ generated: boolean, disclosure, tools? }`；disclosure ≤280 纯文本，`generated=true` 需真实声明；tools 1..8 个小写工具 id（不执行） | 只进 `warnings` |
| `compatibility` | pack 可选；role entry 必填 | `{ minPluginVersion, maxPluginVersion? }`，`x.y.z`；非法/倒置拒绝 | pack 级只进 `warnings`；role entry 缺失拒绝 |

`usageDeclaration` 还可追加 `statement` / `statementRef` / `statementSha256`；出现时必须与 `CONTENT_USAGE_STATEMENT` / `_REF` / `_SHA256` 完全一致（逐字 + SHA-256），否则拒绝。声明了任何合规字段就按上述规则 fail-closed；没声明默认只产生 `warnings`，pre-0.10.9 的 v3 pack 继续有效。内容中心「内容包」页展示内置包的许可 / AI 来源 / 兼容性。

### 严格模式与版本门（0.10.9）

Host 加载不受信 pack 时使用：

```js
validateContentPack(pack, { requireCompliance: true, pluginVersion: '0.10.9' })
// => { ok, errors, warnings }
```

- `requireCompliance: true`：缺 `pack.license` / `pack.aiProvenance` / `pack.compatibility` / `usageDeclaration.statement` / `usageDeclaration.statementRef` 直接进 `errors`（fail-closed）。
- `pluginVersion`：pack 级与 role entry 的兼容区间必须包含该版本；对应纯函数 `isPackCompatibleWithPlugin(compatibility, version)`。
- `warnings` 只报告缺失的可选合规字段，任何情况下都不会自行把 `ok` 变 false；`errors` 仍 fail-closed。

### role kind

role entry 的 `apply` 必须且只能包含六个组件：character / voicePolicy / dialogue / theme / background / font；entry 还必须带 `compatibility`（`minPluginVersion`，可选 `maxPluginVersion`）。pack 级 `usageDeclaration` 是强制的；role entry 也可选地重复一份 `usageDeclaration` 作为更显式的声明，出现时同样按同一规则校验。voicePolicy 必须自洽（canTts=true ⇔ mode="speech"；sound=true 仅允许 canTts=true）；theme / background / font 复用各自 kind 的安全数据形状。role 预览支持 glyph/text/color/image，声明仍由 pack 级 usageDeclaration 覆盖。

### assets（清单/哈希，不加载）

pack 可选 `assets`：

```json
{
  "format": "zip",
  "files": [{ "path": "art/human/idle-0.png", "sha256": "<64 lowercase hex>", "bytes": 1024 }],
  "totalBytes": 1024
}
```

path 必须是安全相对路径（≤6 段、无 `..`、无绝对路径/scheme/冒号/反斜杠、≤160 字符、带扩展名）；sha256 必填且为 64 位小写 hex；files 1..32；不允许重复 path；totalBytes 不得小于 files 字节和。**只做数据校验与清单，不打开 zip、不读取文件夹、不加载素材、不执行任何内容。**

### remoteCatalog（预留字段，不联网）

pack 可选 `remoteCatalog: { status: "reserved", url?: "https://..." }`。status 只接受 `reserved`；url 必须是 https、≤240 字符、无凭据；仅作为元数据保存/校验，**本包永远不会 fetch 它**。远程 source（source: "remote"）默认拒绝，未来启用网络的 Host 必须显式传 `{ allowRemote: true }` 才通过 schema 校验，且仍须自行做网络隔离、校验与缓存。

### 其它校验（与 v2 一致并延续）

- 纯数据：函数 / symbol / bigint / undefined / 非 plain object / 非有限数一律拒绝；未知字段一律拒绝（pack、entry、preview、apply、usageDeclaration、assets、remoteCatalog、license、aiProvenance、compatibility）。
- 长度：JSON ≤ 65536 字节；entries ≤ 32（每 kind ≤ 16）；id ≤ 64；name ≤ 64；description ≤ 240；文本 ≤ 280；预览文本 ≤ 120；变量 ≤ 24；变量值 ≤ 80；权限 ≤ 8；嵌套深度 ≤ 8；数组/对象规模有上限。
- 枚举：kind ∈ role|character|voice|dialogue|theme|background|font；source ∈ bundled|local|remote；permission ∈ apply:role|select:character|select:voice|select:dialogue|apply:theme|apply:background|apply:font|store:selection（entry 必须含本 kind 对应权限）；preview.kind ∈ glyph|text|color|image；dialogue apply.mode ∈ standard|brief|quiet；background apply.kind ∈ transparent|color；theme 变量名必须匹配 `^--dsh-famling-[a-z0-9-]{1,32}$`。
- 路径：image preview 相对路径、≤3 段、无 `..`、无绝对路径/盘符/URL scheme/反斜杠、≤160 字符且以 .png/.webp/.jpg 结尾；asset path 见上。
- CSS：变量值只接受 hex / rgb() rgba() hsl() hsla() / 2–24 位字母关键字，拒绝 url()、expression()、`@import`、分号、尖括号与控制字符。
- 背景/字体：background 的 kind=color 必须有安全颜色 value，kind=transparent 不得带 value；font.family 必须是 1..8 个不带引号的本地字体名（字母/数字/空格/点/下划线/连字符，≤200 字符），size 为 10..24 的整数，lineHeight 为 1..2.5 的有限数；拒绝引号、url()、var()、分号、花括号与 `@` 规则等任何 CSS 注入。
- 原型污染：任何层级出现 `__proto__` / `constructor` / `prototype` 均拒绝。
- 重复：同一 (kind,id) / 同一 asset path 重复拒绝；entry.source 必须与 pack.source 一致；role compatibility 的 min 不得大于 max。
- 0.10.9 合规字段（可选，声明即 fail-closed）：license.spdx 2..64 字符、attribution 1..200 纯文本、url 仅无凭据 https（不 fetch）、file 仅安全相对路径（不打开）；aiProvenance.generated 布尔、disclosure 1..280 且 generated=true 需真实声明、tools 1..8 个小写工具 id（不执行、不重复）；compatibility 版本必须 `x.y.z`；usageDeclaration.statement / statementRef / statementSha256 出现时必须等于 canonical 锚点。未声明的可选字段只进 `warnings`（严格模式下才进 `errors`）。

未来加载器的硬约束：不 eval / 不 new Function / 不执行 pack 脚本 / 不 innerHTML / 不加载远程字体与样式表 / 不自动解包资产；只读取上述纯数据字段，由 Host 侧解析与校验后交给 UI 渲染。

### 与独立 famling 共享模型（famling.content/0.2）的关系

独立 famling 仓另有内容目录规范 `famling.content/0.2`（`public/content/README.md`、`public/content/library.json`、`src/pet/content-library.ts`），是目标超集；dsh-famling 0.10.x 的七类 kind 可与其目录映射：role 是 v3 新增的角色主题 bundle（character + voicePolicy + dialogue + theme + background + font 的组合），其内置 `rolePresets` 与插件 `ROLE_BUNDLES` 的六个组件逐项对齐（origami 的 high-contrast 显式映射 night）；其余六类仍一一映射（characters ↔ character、voices ↔ voice、dialoguePacks ↔ dialogue、themes ↔ theme、backgrounds ↔ background、fonts ↔ font；`builtin` ≡ `bundled`）。差异仍然存在：插件契约把“选择/应用”建模为 `apply` + permissions，共享模型是目录条目 + 解析函数；主题 CSS 前缀分别为 `--dsh-famling-*` / `--famling-content-*`；插件背景只支持纯色/透明（无 pattern/图片）、字体只支持本地字体栈；插件声音来自浏览器 `speechSynthesis`，共享目录是 DeepSeek stella/tide，二者不能互相覆盖；两个校验器返回结构不同（插件 `{ ok, errors: string[] }`）。两套契约并存、各自 fail-closed；未来收敛通过适配层把共享目录六类内置内容投影为插件 entry（保留 0.9.x/0.10.x 存储键与 UI），不直接加载共享 pack。

## 使用限制（canonical，必读）

> 本项目及其全部代码、美术、音频、文案、角色素材和衍生物仅用于技术研究与原型验证，不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途。

- 完整说明与短句 SHA-256：`docs/LEGAL-NOTICE-2026-11-18.md` §0；canonical 源为 famling 仓 `desktop-games/docs/legal/USE-RESTRICTIONS-2026-11-19.md`。
- 本插件不是情感陪伴/虚拟伴侣产品；禁止冒充真人或官方、对外服务运营、删除/伪造 AI 标识、绕过 TTS/ASR 同意或其它安全门禁。
- 内容包 v3 的 `usageDeclaration` 与上述 canonical 限制对齐：所有 pack 必须声明仅用于研究/原型，并禁止情感陪伴、虚拟伴侣、专业建议、未成年人亲密、冒充真人/官方与违法用途；缺失或非法声明一律拒绝。
