<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-famling-hero-zh-dark.webp">
  <img src="docs/assets/dsh-famling-hero-zh-light.webp" width="100%" alt="dsh-famling 配图：DeepSeek Harness 侧栏左下角的 72px 像素桌宠 —— 汀岚、布偶猫、金毛三个形象共 212 帧、12 个 clip；入口 95,731 B，精灵帧走懒加载角色 chunk；点击区域挑 clip 与台词，宿主状态只保存在本机有界环形缓冲">
</picture>

# dsh-famling

**Famling / 汀岚 的 DSH 客户端插件。**

*侧栏左下角的研究/技术演示入口 —— 212 帧动画、零常驻按钮、右键 / Shift+F10 分级菜单，全部偏好只存本机。**不是**情感陪伴产品。*

[English](README.en.md) · [简体中文](README.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

</div>

> ⚠️ **使用限制（必读）**：本项目及其全部代码、美术、音频、文案、角色素材和衍生物**仅用于技术研究与原型验证**；**不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途**。完整说明见 [docs/LEGAL-NOTICE-2026-11-18.md](docs/LEGAL-NOTICE-2026-11-18.md)。

Famling / 汀岚 的 DSH 兼容版：在 DeepSeek Harness 左侧栏**左下角、账号信息下方**显示一个小型研究/技术演示入口（不是情感陪伴产品）。

---

## 两个包

本工作线提供两个包，按用途分开：

| 包 | 来源 | 用途 |
|---|---|---|
| **famling** | [PerryLink/famling](https://github.com/PerryLink/famling) | **独立运行的完整桌宠**（pet-only Tauri app；汀岚/猫/狗、UI、TTS、年龄核验等） |
| **dsh-famling** | 本仓 | **DSH 客户端插件**；只提供左下角小型汀岚入口与本地小互动，不替代独立 app |

> `famling` 是独立应用；`dsh-famling` 是放在 DSH 里的轻量伴随入口。两者共享角色/品牌，不共享运行时代码。
>
> **跨产品口径（0.10.2 / E3-T3）**：独立 famling **不提供官方的自由 LLM 角色扮演（RP）或情感陪伴**；本插件提供的是**工作助手型 AI 回复**（非 RP、非情感陪伴，文本发给 DSH 中配置的模型供应商，可能出错）。两者都不应被宣传或改造成情感陪伴/虚拟伴侣产品；完整使用限制见 [docs/LEGAL-NOTICE-2026-11-18.md](docs/LEGAL-NOTICE-2026-11-18.md)。


<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-famling-flow-v5-dark.svg">
  <img src="docs/assets/dsh-famling-flow-v5-light.svg" width="100%" alt="dsh-famling 结构图：DSH 的 sidebar.footer.action slot 挂载 95,731 B 的 client.js 入口，入口按需懒加载一个角色 chunk；点击区域挑一个物种专属 clip 和一句气泡台词；bridge 只提供 chat、task 与本机粗状态，全部同源">
</picture>

*结构：挂载 → 互动 → 观测。入口不带精灵帧载荷 —— 只有显示某个角色时才下载对应的角色 chunk；宿主状态是只在本机的有界环形缓冲，不含会话 id、消息或工具参数。图内只有真实的 slot 与 bridge 名称，五语共用同一张结构图。*

## 当前实现（0.13.1）

- 0.11.0 体验与预算修复：面板/同意弹窗默认表面改用宿主真实 token `--dsw-alias-bg-layer-1` + `light-dark()`（宿主 0.2.2-rc.4 无 `--dsw-alias-bg-elevated`，旧回退链会在浅色宿主落深底深字；light/dark 正文对比度 ≥4.5:1，paper/night 仍为显式主题）；`visibilitychange` 隐藏时停止帧调度、不再 setState，恢复后立即回当前角色 idle；首启安全卡新增「点角色 = 互动；右键 / Shift+F10 = 菜单」（一次性、可关、不新增常驻按钮）；区域点击新增 1.2s 冷却、10s 内同区第 4 次起降为既有 `idle_blink` 轻反应（饱和后 2.5s 冷却，菜单动作始终回应）；猫/狗 idle 6→8 帧、猫 `idle_blink` 慢眨眼 4fps、狗 8fps（12 clip 不变；cat 74 / dog 70 / human 68 = 212 帧，chunk 重嵌入）；新增 `PLUGIN-MANIFEST.json`（逐文件 sha256 + 版本/体积摘要）与桌面 `JOINT-EVIDENCE` 联合证据格式。无新增数据收集 / 网络 / 权限 / 常驻 UI；仍是 C1 unsigned 邀请 beta，能力与限制以本 README 与 LEGAL-NOTICE 为准。
- 0.11.1 入口预算治理（2026-11-21 发布）：新增包内懒加载 `client.behavior.js`（点击区域几何/命中、1.2s 重复点击冷却与饱和降级、随机回话选择、clip 的 `holdMs`/`durationMs` 帧时长），挂载后经 DSH `require.async` 拉取并 memoize；失败时入口回退统一默认帧节奏、区域点击 no-op，不阻塞渲染也不抛错。入口 `client.js` 由 97,460 B / gzip 28,029 B 降到 **94,491 B / gzip 27,087 B / brotli 22,674 B**（净减 2,969 B = 2.90 KiB；31% 门禁 97,576 B 余量 3,085 B，96 KiB 预算余量 3,813 B）；真实挂载总下载（入口 + human + behavior kit）163,463 B = 拆前基线的 **51.93%**（< 52% 首帧门禁）。未改行为语义、存储键、契约与版本（仍 0.11.0）；生成块与 `client.anims.*.js` 未手改。
- 0.13.0 发布（2026-11-21，B1/A4）：新增「一起工作（专注）」25/50 分钟模式——内存-only 的 quiet 窗口，自动环境气泡与随机微动作暂停、显式点击/菜单/聊天仍回应，结束只在本机弹一次气泡（无系统通知、无历史/streak/惩罚、无新增存储键）；专注 UI/文案全在懒加载 `client.content.js`，入口仅 +198 B（95,533→**95,731 B**，31% 门 97,576 → 余 1,845 B、96 KiB → 余 2,573 B、真实挂载 168,802 B = **53.63%** <54%）。同时清收许可：`LICENSE-ART` 覆盖实际美术路径（client.anims.*/icon.png）、NOTICE/README 许可段一致；新增真实 DSH 0.2.2-rc.4 宿主联调证据（46/46）与 rc.4/rc.5 契约门（45/45）文档入包。
- 0.12.0 发布（2026-11-21）：宿主工作状态钩子（粗状态、隐私最小）。host 半用 `ctx.on('agent/status')` / `ctx.on('agent/error')` 维护有界粗状态（≤16 条 `{ state, at }` 环 + 运行计数 + 仅分类的 `lastError.kind`），新增 bridge `op:"state"`（wire 2）返回闭合 schema 校验后的 `available` / `state` / `active` / `updatedAt` / `lastError` / `transitions`；不读、不存、不记录 agent id / 会话 id / 消息 / 提示词 / 工具参数 / 文件内容。事件 API 不存在或订阅抛错时 `available:false`，插件照常激活（`state` 永不伪造状态）。client 半新增包内懒加载 `client.status.js`（与 `client.behavior.js` 同模式）：挂载后经 `require.async` 拉取并 memoize，首个 `state` 拉取在挂载 30s 后，失败静默重试 ≤3 次、响应 `available:false` 立即停止、只用 `setTimeout`（无 `setInterval`），不写任何存储；`running` 复用既有 quiet 抑制（自动气泡与随机微动作 = 0；显式点击/菜单/聊天回复不受影响），不新增美术帧、无新增权限/网络/存储键；缺 chunk 时行为与本版之前完全一致。入口 **95,533 B / gzip 27,409 B / brotli 22,906 B**（较 0.11.1 发布的 94,491 B +1,042 B，其中 task-21 首启有用动作 +385 B；31% 门禁 97,576 B 余 2,043 B、96 KiB 预算余 2,771 B）；真实挂载总下载（入口 + human + behavior kit + status kit）168,604 B = 拆前基线的 **53.57%**（新 kit 计入真实挂载载荷，首帧门禁 52%→**54%**；入口 31% / 96 KiB 门禁不变）；懒加载 `client.content.js` 79,094 B / gzip 22,728 B / brotli 18,549 B（task-21 首启动作 +4,905 B，仅首次安装或首次打开弹窗时下载，不计入首屏与挂载门禁）。
- 0.12.0 发布（2026-11-21，task-21）：首启安全卡新增两个**一次性、可跳过**的有用动作——「10 分钟后提醒我休息一下」复用既有 bridge `op:"task"`（Host 无 `schedule` 时按钮禁用并说明，桥接失败显示可重试错误、绝不伪造成功）与「问一句工作问题」（只打开既有聊天输入面板并预填中性示例问题，不自动发送、不调用模型）；中英文案同步（`check-i18n` 门禁），非阻断、可关闭，仍只写既有 `dsh-famling/first-run/v1`，无新增常驻 UI / 存储键 / 网络 / 权限 / 遥测。动作文案、`task` payload 编排与 busy/done/error 展示都在懒加载 `client.content.js`，入口只注入既有 `callBridge` 与一个瞬态状态。
- 0.12.0 工作树（2026-11-21，task-B1，未发布）：「一起工作」专注模式。右键 → 设置… → 「一起工作（专注）」可选 **25 / 50 分钟**；进行中在角色旁显示一个小的剩余时间徽标（`role="status"`，不新增常驻大 UI），设置行同时显示剩余并可**提前结束**；专注期间复用既有 quiet/low-disturb 语义——自动气泡与随机微动作暂停，显式点击/菜单/聊天回复照常回应；结束只做一次本机气泡提示（不弹系统通知、不记历史、不惩罚、无 streak），状态只在本机内存（`window.__famlingFocus`，不新增存储键）。25/50 选择器、计时器、倒计时、i18n 与提示文案都在懒加载 `client.content.js`；入口只做三件事（两处 quiet 触发点读内存截止时间 + 渲染懒加载徽标 + 借出一次气泡提示）：入口 95,533→**95,731 B**（+198 B；gzip 27,470 B / brotli 22,972 B；31% 门禁余 1,845 B、96 KiB 余 2,573 B），懒加载 `client.content.js` 79,094→85,750 B（不计入首屏/挂载门禁），真实挂载总下载 168,604→**168,802 B = 53.63%**（< 54% 门禁，余 1,169 B）；`npm test` 306→**314** 条（+7 行为 +1 静态预算）；无新增权限/网络/存储键/常驻 UI。
- 0.10.12 宿主自适应外观：猫/狗角色默认背景由 dark/paper 改为 **transparent**（插件 `ROLE_BUNDLES.cat/dog.background` 与 famling `public/content/library.json` rolePresets 同步；沿用 `dsh-famling/background` 显式覆盖，老用户已存的 dark/paper 不被静默清除），背景不再铺满 sidebar，气泡与面板仍保留夜间/纸张主题；右键菜单**不再读取角色主题的 `--dsh-famling-panel-bg/text/border`**，改为 DSH 宿主**真实**变量 `--dsw-alias-bg-layer-1`（回退 `light-dark(#ffffff, #1f2329)`）、`--dsw-alias-label-primary`（回退 `light-dark(#111111, #e8e8e8)`）、`--dsw-alias-border-l2`（宿主 0.2.2-rc.4 并未定义 `--dsw-alias-bg-elevated`，旧回退链在浅色宿主会深底深字），选中项用宿主 accent `--dsw-alias-state-business-primary` + 反色 `--dsw-alias-label-primary-inverted`，`buttonBase` 边框/填充回退改为 `light-dark(...)`；widget 根显式 `color-scheme: inherit` 跟随宿主 `:root` 的 light/dark（不写死 `light dark`，避免宿主显式主题与系统偏好不一致时错配），human/cat/dog 渲染同一宿主菜单表面并随 DSH 昼夜切换。入口 95.2 KiB / 97,441 B（gzip 28,009 B，< 96 KiB 预算）；`client-static` / `client-behavior` / parity / content 测试同步冻结宿主变量与 transparent 背景。
- 0.10.12 未发版 C1 P0 修复：内容面板 / 同意弹窗的默认表面统一走宿主 `--dsw-alias-bg-layer-1` + `light-dark()` 回退（只有 `--dsh-famling-panel-bg/text/border` 缺失时才用回退），light/dark 下正文对比度 ≥ 4.5:1，paper/night 仍是显式主题；标签页隐藏（`visibilitychange`）时停止帧调度、不再 setState，恢复后立即回到当前角色 idle；首启安全卡新增「点角色 = 互动；右键 / Shift+F10 = 菜单」一行（中英同步，仍只写一次 `dsh-famling/first-run/v1`，不新增常驻按钮）；区域点击新增 1.2s 冷却、10s 内同区第 4 次起降为既有 `idle_blink` 轻反应（饱和后 2.5s 冷却），菜单动作始终回应。`client-static` 冻结宿主 token 链与 4.5:1 对比度，`client-behavior` 冻结隐藏暂停与点击节奏。
- 0.10.11 布偶猫跨仓同步（猫像素 / UI 文案 / 重嵌入）：`public/assets/pet/anim/cat/` 改为**同配色蓝重点双色布偶猫**——16 个 palette hex 逐个不变、palette id 改 `cat-ragdoll-anim@0.1`、72 帧 / 12 clip / 96×96 / 地线 y=89 / anchor 48,96 契约不变（白底丝滑直长毛 + 冷灰蓝连帽/面罩/耳/羽状尾 + v10 白 blaze，产品化短腿保留，确定性 Python 渲染、无模型/无 API）。`public/characters/pet-cat/regions.json` 的单源 `src/pet/anim/interactions/cat.json` 洗脸台词改为长毛版本（「长毛不好梳」）并重生成 behavior/regions；插件 `embed:anims` 重新嵌入 cat 帧（72 帧，208 帧总数不变）、`gen:content` 同步 behavior/regions/manifest 单源哈希；UI 文案统一为「布偶猫」/「Ragdoll」（入口、内容中心、聊天人格、locale、README、DETAIL），金毛渲染器标签同步为 v11；版本真值（package / client / client.content / README / LEGAL-NOTICE / locale）统一到 0.10.11。
- 0.10.10 版本化 TTS/ASR 同意（MB-014 / E1）：同意从 `{tts, asr}` 布尔升级为 `dsh-famling/consent/v2` 的逐项 `{version, hash, acceptedAt, withdrawn}` 记录；TTS/ASR 声明的中文（权威）+ 英文 canonical bundle 由 `client.js` 冻结 SHA-256 与日期版本（`2026-11-20.1`），版本或哈希任一不符即 **fail-closed 重弹**，绝不复用旧同意。旧 `dsh-famling/consent/v1` 布尔在懒加载 `client.content.js` 首次加载时一次性迁移为 `withdrawn: true` 记录并删除旧键（旧值无版本/哈希，无法验证 → 必须重新确认）。设置「数据与边界」新增**「撤回语音同意」**（写 `withdrawn: true`、保留 acceptedAt/version/hash 证据、关闭语音并停止 TTS/录音；可随时重新同意），同意弹窗与设置显示声明版本 + SHA-256 前缀；「清除本机设置与同意」仍删除全部 `dsh-famling/*` 键（含 v1/v2）。约定：声明文本任一措辞变化必须同时 bump 版本与哈希（`test/parity-contract.test.js` 重算 canonical bundle 哈希并与入口/懒加载两处冻结锚点比对；`test/client-behavior.test.js` 覆盖接受/迁移/陈旧版本或哈希/撤回/清除，`test/client-static.test.js` 冻结接线）。插件声明版本是插件自有浏览器 TTS/ASR 文本版本（`2026-11-20.1`），与 famling 的 TTS/ASR terms 版本不同源；parity 测试只冻结 famling terms 版本与共享内容语义锚点，不把两套不同来源的声明混成同一版本号。
- 0.10.9 v3 合规字段（MB-032/033 / E3）：content-extension **仍为 v3（不升 v4）**，以**追加可选字段**补齐 `license`（`spdx` / `attribution`，可选 `url` / `file`）、`aiProvenance`（`generated` / `disclosure`，可选 `tools`）与 pack 级 `compatibility`（`minPluginVersion` / 可选 `maxPluginVersion`）；`usageDeclaration` 可追加 canonical `statement` / `statementRef` / `statementSha256`（与 client `SHARED_CONTENT_SEMANTICS` 同源，声明值必须逐字一致）。pre-0.10.9 v3 pack 仍通过校验（缺字段只进 `warnings`，不改变 `ok`）；Host 可用 `validateContentPack(pack, { requireCompliance: true })` 对不受信 pack **fail-closed**，并用 `{ pluginVersion }` 校验兼容区间；hello/probe 的契约 revision 保持 3，老 Host 不受影响。「内容包」页展示内置包的许可 / AI 来源 / 兼容性；双端 parity 测试冻结锚点。版本真值同步至 0.10.9。
- 0.10.7 Host 能力协商（MB-034 / E3-T2）：插件主机半不再把 `llm`/`schedule` 当必需注入（`inject = ['connection']`），最小 Host 上仍能激活；客户端挂载后向同源 bridge 发一次 **`hello`（wire 2）**，Host 返回插件版本、bridge wire 版本、**content-extension v3** 契约、宿主版本及来源、可选服务能力矩阵与逐项 `probes`。缺 `llm` 时聊天、缺 `schedule` 时提醒在 **UI 与发送路径双端降级**（本地明示、不调用模型、不伪造回复）；老 Host 不响应 hello 时回退「兼容模式」并保留旧行为；版本/契约不一致只提示、不崩溃。设置 →「高级 / 调试」显示握手状态、宿主版本、桥接/内容契约版本、能力矩阵与「重新检测 Host 能力」（`probe`）。`content-extension.mjs` 保持 **v3 单版本契约**（新增 `CONTENT_EXTENSION_VERSION` / `CONTENT_EXTENSION_COMPATIBILITY` / `isContentExtensionCompatible`，hello 的 `contract.contentExtension` 直接取该模块）。测试见 `test/host-bridge.test.js` 与 `test/client-behavior.test.js`。
- 0.10.6 低打扰（E7 剩余 / P-04）：设置弹窗新增「**低打扰**」分组——**安静时段**（默认 22:00–08:00 开启，可改起止时间或整体关闭；时段内自动气泡与随机微动作 = 0，点击、菜单互动与聊天回复仍照常回应；`start === end` 视为关闭，避免手滑造成 24h 静默）、**动画偏好**（跟随系统 `prefers-reduced-motion` / 允许动画 / 减少动态；旧 `motion` 布尔值一次性迁移）、**暂时隐藏**（右键「更多」或设置内隐藏 1 小时 / 到明天；状态持久化到 `dsh-famling/hidden-until`，只留一个 ≥24px 的「显示」恢复控件，到点自动恢复）。自动微动作间隔由 11–20s 提高到 **≥60s**；静音只停语音（气泡字幕保留，正在朗读立即停止）。输入面板 / 同意弹窗 / 使用限制弹窗与新增低打扰 UI 均在懒加载 `client.content.js`，首屏预算保持 96 KiB 以内。测试见 `test/client-lowdisturb.test.js` 与 `test/client-behavior.test.js`。
- 0.10.4 四层缩放（MB-053）：设置内新增**整体缩放**（第一层，50%–200%，角色图像 + UI/文本 + 气泡 + 菜单/面板一起缩放）、**UI + 文本 / 图像** 独立轴（第二层，100% = 跟随整体，可单独解耦或一键「跟随整体」）、**组件缩放**（第三层，折叠在「高级 / 调试」内，气泡 / 右键菜单 / 面板 / 内容中心 / 设置弹窗默认全部继承 UI + 文本，可覆盖 75%–150% 或恢复继承）。只作用于本插件 widget 的内联样式与私有 CSS 变量，**不改 DSH 全局主题/宿主缩放**；持久化 `dsh-famling/scale/*`（model/global/ui-text/image/component/*），旧绝对倍率 `dsh-famling/scale` / `dsh-famling/text-scale` 一次性迁移（版本标记后失效但保留备份）；气泡 ≤ 240px 且不溢出视口，菜单/面板按缩放后尺寸夹取，默认值不写键；原生 range 滑块 + `aria-valuetext`/`aria-expanded` 键盘可达。详见「四层缩放（0.10.4）」与 `test/client-scale.test.js`。
- 0.10.3 发布准备：相对 0.10.2 **聊天/UI 行为无变化**；提升版本真值（`package.json` 为源，同步 `client.js`/`client.content.js`/README/LEGAL-NOTICE/locale，`node test/version-truth.test.js --write` 幂等重生成），并修正 `engines.dsh` 允许 0.2.2 预发布宿主（`|| >=0.2.2-0 <0.3.0`，否则 0.2.2-rc.x 会被引擎范围拒绝）；本版本是插件安全地板的对外发布版本。
- slot：`sidebar.footer.action`（DSH 侧栏账号信息下方的 footer 区域）。
- 最终交互结构（0.10.1）：**默认只渲染角色，角色以外零常驻按钮**。右键角色（或 Shift+F10 / ContextMenu 键）打开自绘分级菜单，`fixed` 定位并按视口夹取；键盘 ↑/↓、Home/End、←/→、Enter、Escape、Tab 全部可用，菜单外点或窗口失焦即关闭。一级只有 5 项：**聊两句… / 互动 ▸ / 内容与角色… / 设置… / 更多 ▸**；互动与更多是带「« 返回」的二级页面；复杂内容（内容中心 / 设置 / 提醒 / 使用限制）一律进独立弹窗。点击人物的头/身体/尾巴分别触发按区域反应（0.8.2），互动页按当前形象渲染物种专属动作并随机挑一句回话（0.8.3，见下）。
- **72px 像素桌宠**（96×96 帧按 `image-rendering: pixelated` 显示为 72px），可切换 **汀岚 / 布偶猫（白底蓝重点长毛） / 金毛** 三个形象；点击头部/身体/尾巴分别触发摸头/摇尾/追尾，点击透明或未声明区域不动作。
- 待机是真正的帧动画：3 个角色各 12 clip（帧数按 manifest：dog 70 / cat 74 / human 68，共 212 帧）；`idle` 循环 + `idle_blink` 眨眼替换 + 随机微动作（`paw_face` / `scratch` / `stand_wag` / `chase_tail`）；每帧时长读 manifest 的 `holdMs`（缺省 1000/fps），非循环 clip 按 `durationMs`/hold 总和结束（0.8.4）。
- 输入面板：人物右侧展开文本框 + 语音输入按钮（浏览器 SpeechRecognition），预留 `window.__DSH_FAMLING_BRIDGE__` 给 DSH/Advisers Host。面板内常驻 AI 声明 + 发送去向 + 危机资源三行说明（0.10.2，见「聊天安全地板」）。
- 聊天安全地板（0.10.2 / E3）：Host `op:"chat"` 在**任何模型调用之前**做本地危机关键词短路（自伤/自杀、伤害他人、家暴/性侵、急症）；命中返回固定资源文案（12356 心理援助 / 110 报警 / 120 急救 / 信任的人与专业机构），**不调用 `ctx.llm.stream`、不回显原文、不落盘**，固定文案明确「不是诊断」，误报可忽略。实现与可审计导出：`index.js` 的 `CRISIS_KEYWORDS` / `crisisKeyword`；响应 `meta.safety = "crisis-local-resource"`、`llmCalls: 0`。
- 发送去向与首启告知（0.10.2 / MB-021）：输入面板 AI 声明与设置「数据与边界」明确「聊天为工作助手型 AI 回复，文本经 DSH Host 发给 DSH 中配置的模型供应商；勿发密码/隐私/客户资料」；首次安装显示**一次性、可关闭、非阻断**卡片（只写本地 `dsh-famling/first-run/v1`，不联网；卡片另含一行「点角色 = 互动；右键 / Shift+F10 = 菜单」的两步操作引导，中英同步），卡片 UI 放在懒加载 `client.content.js`，不进首屏预算；0.12.0（task-21）在该卡上增加两个一次性、可跳过的有用动作：10 分钟后休息提醒（走既有 `op:"task"`，Host 无 `schedule` 时禁用并说明）与预填示例问题的聊天入口（只预填、不自动发送、不调用模型）。
- 清除与撤回（0.10.2 / MB-022；0.10.10 / MB-014 版本化）：设置 →「数据与边界」→「清除本机设置与同意」只删除本插件在浏览器 `localStorage` 的 `dsh-famling/*` 键（设置、形象、外观、首启确认、v1/v2 同意记录；等同全量撤回 TTS/ASR 同意）；同处另有独立的**「撤回语音同意」**——只把已存记录标记为 `withdrawn: true` 并关闭语音/停止 TTS/录音，保留设置与最小证据字段，可随时重新同意。两项操作都**不改** DSH 宿主数据、会话与供应商侧数据，同处展示与 DSH 的边界说明。
- AI 聊天开关（0.10.2 / MB-024）：设置内可关闭聊天；关闭后输入面板不发送任何聊天文本（提醒创建仍可用），状态持久化在 `dsh-famling/settings.chat`（默认开启，开启即披露发送去向）。
- 互动面板（0.8.3）：直接读嵌入的 `ANIMS[character].actions`（来自与独立 famling 共用的 `regions.json`），按形象渲染物种专属动作——汀岚：摸头 / 递纸 / 挥手 / 整理蝴蝶结 / 聊两句；布偶猫：摸头 / 伸懒腰 / 洗脸 / 追尾巴 / 跑一跑；金毛：摸头 / 丢球·捡球 / 捡球 / 追尾巴 / 跑一跑（丢球后 500ms 自动接追球）。猫和人没有球类/捡球动作，绝不会把 A 角色的动作放到 B 角色身上。
- 内容中心（0.10.0）：**角色就是主题**。一级 tabs 只有 **角色 / 自定义 / 内容包 / 市场**；角色卡展示角色名、一句说明、声音 / 对话 / 外观摘要，点击「一键应用」同时设置 character、voice(TTS 策略)、dialogue mode、theme/background/font，并写入 `dsh-famling/role`；自定义页在选中角色基础上逐项覆盖并支持「恢复角色默认」；内容包页只展示内置内容、声明检查与预留导入接口；市场页只显示「远程市场接口已预留，服务器未配置」，不联网、不伪造商品。内容中心 UI 本身是懒加载的包内 chunk `client.content.js`（与统一设置弹窗共用，首次打开才下载，不预加载任何角色动画 chunk）。
- 设置（0.10.1）：统一的**设置弹窗**集中所有可调项——语音朗读（仅汀岚；首次开启仍走独立同意弹窗）、**低打扰（安静时段 / 动画偏好 / 暂时隐藏，0.10.6）**、说话气泡、**显示菜单按钮**（默认关闭，开启后角色旁出现「⋯」触发器）、Advisers 摘要、对话模式、气泡/面板主题、背景、字体/字号/行高、内容与角色入口与「恢复角色默认」；底部「高级 / 调试」折叠分组显示版本、当前状态与本地存储键。菜单按钮偏好持久化到 `dsh-famling/menu`（只存开关；菜单展开与子页是临时状态，每次打开都从一级开始）。其余持久化沿用旧键：`dsh-famling/character`、`dsh-famling/settings`（`voiceURI`）、`dsh-famling/dialogue`、`dsh-famling/theme`、`dsh-famling/background`、`dsh-famling/font`，并新增 `dsh-famling/role` 记录当前角色主题；TTS/ASR 同意记录（0.10.10）存 `dsh-famling/consent/v2`（逐项 `{version,hash,acceptedAt,withdrawn}`；旧 v1 在设置 chunk 首次加载时迁移后删除）；加载时用角色 bundle 回填缺失组件，显式组件键优先。
- 气泡（0.8.3）：点击区域或动作时，从该区域/动作自己的 `says` 数组随机挑一句（同一位置连续点击不会重复同一句）；**汀岚**的台词是实心 speech 气泡，可配合浏览器 TTS（保留原有独立同意）；**布偶猫（白底蓝重点长毛）/金毛**只用空心 thought 气泡，永不调用 `speechSynthesis`，内容中心的声音区对它们只显示「思考气泡，无语音」；切到猫/狗时若正在朗读会立即停止。气泡默认白底 `#ffffff`、深色 `#111111` 字、灰色实线/虚线边框（内容中心可切 paper / night 主题），不常驻、不遮挡人物。
- 聊天人格随形象切换（0.8.1）：输入面板的聊天请求会带当前形象（`human`/`cat`/`dog`，缺省 `human`）；Host 按形象选择 system prompt，切猫/狗后回复语气随之变化。
- 输入面板的 LLM/TTS/ASR/记忆需要 Host 桥接；未接入时如实提示，不伪造回复。
- 不宣传 roleplay；不包含完整桌宠/游戏基座。
- 无 roleplay 公开入口；网络请求仅限同源 `/api/famling/bridge`（DSH Host 路由）。内容包/资产包/远程市场均不加载、不联网。

## 四层缩放（0.10.4，MB-053）

设置弹窗按 famling `src/pet/scaling.ts` 的同一语义分四层，全部只作用于本插件 widget 的内联样式与 widget 私有 CSS 变量（`--dsh-famling-ui-scale` / `--dsh-famling-bubble-zoom`、组件 `transform`），**从不写 `document.documentElement`、不改 DSH 全局主题或宿主缩放**：

| 层级 | 位置 | 控件 | 语义 |
|---|---|---|---|
| 1 整体缩放 | 常用 · 第一个控件 | 原生 range 50%–200%（step 5%） | 所有内容一并缩放：角色图像、UI/文本、气泡、菜单、面板 |
| 2 UI + 文本 | 缩放（独立轴） | range 40%–150%，100% = 跟随整体 | 只改文本/控件；「跟随整体」一键复位 |
| 2 图像 | 缩放（独立轴） | range 50%–200%，100% = 跟随整体 | 只改角色/预览图；窗口放不下时自动贴合 |
| 3 组件缩放 | 高级 / 调试（默认折叠） | 每个组件：继承（默认）/ 75% / 125% / 150% | 气泡 / 右键菜单 / 面板 / 内容中心 / 设置弹窗；覆盖值 = 继承的 UI 倍率 × 覆盖倍率，可随时恢复继承 |

- 生效值 = `global × axis` 后按可读性/安全上限 clamp：UI 文本 0.6×–2.5×、图像 0.5×–2×（72px → 36–144px，仍在 240px 侧栏内）、组件 0.5×–2×。气泡宽度硬上限 240px 并按视口夹取左边界，不会溢出侧栏/窗口；菜单与面板用「布局尺寸 ÷ zoom + `transform: scale(zoom)`」在缩放后仍夹在视口内（左/底锚点、`transform-origin` 对齐锚点），内容不裁切。
- 持久化：`dsh-famling/scale/model`（版本标记）+ `dsh-famling/scale/global`、`/ui-text`、`/image`、`/component/<id>`；跟随/默认值不写轴键（恢复跟随 = 删键），恢复默认缩放只写 `global=1` 与版本标记。首次加载若没有版本标记且存在旧绝对倍率键 `dsh-famling/scale`（数字或 `{pet,text}` JSON）或 `dsh-famling/text-scale`，一次性迁移为 `image`/`uiText`（global=100%，等效值不变）；迁移后旧键保留原处但被标记失效，不会重复应用。清除本机设置会删除 `dsh-famling/*` 下全部缩放键。
- 键盘 / ARIA：所有缩放滑块是原生 `<input type="range">`（方向键可用），带 `aria-label` 与 `aria-valuetext`（如「150% · 独立」）；高级组按钮带 `aria-expanded`；组件下拉带 `aria-label`；跟随时「跟随整体」按钮 `disabled`；重置按钮有可读名称；设置弹窗仍是 `role="dialog"`。
- 测试：`test/client-scale.test.js` 覆盖纯模型（clamp/解析/持久化/迁移/上限）+ fake React 行为（三层 IA、整体/独立轴、组件覆盖与继承、持久化/恢复、240px 气泡与视口夹取、菜单缩放夹取、键盘/ARIA、无 fetch）+ 静态门禁（widget 私有样式、无 `document.documentElement`、无外部 URL）。`npm test` 合计 200 项全绿。

## 低打扰（0.10.6，E7 剩余 / P-04）

设置弹窗「低打扰」分组把所有安静控制集中在一处，语义与 famling 桌面壳的 `low-disturb.ts` / `reduce-motion.ts` 对齐（只作用于本插件 widget，不改 DSH 宿主或全局主题）：

| 能力 | 默认 | 行为 | 持久化 |
|---|---|---|---|
| 安静时段 | **开启，22:00–08:00** | 时段内**自动输出 = 0**：自动环境气泡与随机微动作都不产生；点击区域、菜单互动、聊天/提醒回复仍照常。`start === end` 或关闭开关都不会静默。跨午夜窗口（22:00–08:00）按「开始 ≤ 现在 或 现在 < 结束」判定。 | `dsh-famling/settings.quietHours = { enabled, start, end }` |
| 动画偏好 | **跟随系统** | `auto` 读取 `prefers-reduced-motion: reduce`（挂载时读取；显式选择优先）；`on` 强制允许帧动画/眨眼/微动作，`off` 全部冻结为首帧。旧布尔 `motion` 一次性迁移为 `auto`/`off`。 | `dsh-famling/settings.motionMode` |
| 自动微动作节奏 | 60–90s | 由 0.10.5 的 11–20s 提高到 **≥60s**；安静时段内触发时重新计时而不播放。 | 不持久化（运行时节奏） |
| 暂时隐藏 | 关闭 | 「更多 → 暂时隐藏 1 小时 / 暂时隐藏到明天」或设置内同名按钮；隐藏后不渲染角色与气泡，只保留一个 ≥24×24px 的「显示」恢复控件；到截止时间自动恢复。 | `dsh-famling/hidden-until`（毫秒时间戳） |
| 静音 | 关闭 | 只停浏览器 TTS：气泡字幕保留，正在朗读会立即 cancel；猫/狗仍只用空心 thought 气泡且永不 TTS。 | `dsh-famling/settings.sound` |

- 清理入口「清除本机设置与同意」同时删除 `hidden-until` 与 v1/v2 同意记录；设置「高级 / 调试」的存储键列表会列出它们。
- 全部文案与控件在懒加载 `client.content.js`（输入面板/同意弹窗/使用限制弹窗也自 0.10.6 起移入该 chunk；0.10.10 的旧同意迁移与「撤回语音同意」也在该 chunk）；节流/冷却判定与帧时长在懒加载 `client.behavior.js`，入口 `client.js` 保持 96 KiB 首屏预算内。
- 测试：`test/client-lowdisturb.test.js`（纯模型：时间解析、22:00/08:00 边界、非法时段回退、start===end、auto/on/off 优先级、隐藏截止/过期/损坏存储、静态接线）与 `test/client-behavior.test.js`（fake clock：安静时段状态/持久化/非法时间保留；安静时段停微动作但点击仍回应；系统 reduce-motion 与显式覆盖；两种隐藏、提前恢复、到点自动恢复、重载保持；设置内隐藏）；`npm test` 合计全绿（含 MB-004 的 LOCK / vendored spec / clean-checkout 门禁）。

## Host 能力协商 hello/probe（0.10.7，MB-034 / E3-T2）

插件两半共用 bridge wire 2 的握手；目标是「宿主能力未知时仍能工作，缺能力时如实降级」，而不是靠 `engines.dsh` 假设一切存在。

| 项 | 主机半 `index.js` | 客户端 `client.js` |
|---|---|---|
| 必需注入 | 只有 `connection`（认证同源 bridge）；`llm` / `schedule` / `agentDefaultModel` 全部按需 `ctx.get()` 探测，服务后到也能被下一次调用发现 | — |
| 挂载握手 | 注册 `POST /api/famling/bridge` | 挂载后发一次 `{ v: 2, op: "hello", clientVersion, wireVersion: 2, contentExtension: 3, hostVersion?, hostCommit? }`（4s 超时，只发一次） |
| 能力矩阵 | `hello` / `probe` 返回 `capabilities { llm, schedule, agentDefaultModel, brief, bridge }`、逐项 `probes[]`（id / available / method）、`degraded[]` | 存 capability 文档；输入面板与设置据此展示/禁用 |
| 版本/契约 | `plugin.version`（读取本包 package.json）、`wire { version: 2, accepts: [1,2] }`、`contract { bridge: 2, contentExtension: 3, contentExtensionSchema: 3 }`、`host { version, commit?, source }` | `hostVersion` 来自 `window.__DSH_BOOT__.release`（无则不传、Host 不从别处猜）；`versionMismatch` 只提示 |
| 降级 | 缺 `llm` → chat 503 `E_LLM` + `capability:"llm"` + `unavailable:true`（危机本地短路仍工作）；缺 `schedule` → task/task-delete 503 `E_TASK` + `capability:"schedule"` | 缺 `llm`：发送按钮禁用 + 面板/设置明示「未连接模型」，发送路径本地拦截、不伪造回复；缺 `schedule`：提醒入口不渲染 + 明示；老 Host 不响应 hello → 「兼容模式」，保留 0.10.6 行为 |
| 手动探测 | `probe`（wire 2）返回同样的能力/契约 + `generatedAt`，无副作用、不调模型/不建提醒 | 设置 → 高级 / 调试 → 「重新检测 Host 能力」 |

- **版本来源诚实标注**：Host 进程有 `process.env.DSH_CLIENT_VERSION` 时优先用（`source: "env:DSH_CLIENT_VERSION"`），否则用客户端上报的 `__DSH_BOOT__.release`（`source: "client-boot"`），都没有则 `source: "unknown"` / `version: null`，不猜。
- **协议矩阵**：`hello` / `probe` / `state` 只接受 `v: 2`（老客户端发 v1 会收到 426 `E_WIRE`）；`echo` / `chat` / `brief` / `task` / `task-delete` 在 wire 1 与 wire 2 都可用，老客户端无需改动。
- **content-extension v3 兼容**：本版不升 v4；`content-extension.mjs` 导出 `CONTENT_EXTENSION_VERSION = 3`、`CONTENT_EXTENSION_COMPATIBILITY`（单版本、`additive-within-major`）与纯函数 `isContentExtensionCompatible(version)`；hello 的 `contract.contentExtension` 从该模块直接取值，测试冻结二者一致，避免 wire 与 schema 各自漂移。0.10.9 在同一 v3 revision 内追加可选合规字段（license / aiProvenance / pack 级 compatibility / canonical usage statement），因此 hello/probe 的 wire 与 revision **都不变**，老 Host/老 pack 继续工作。
- 测试：`test/host-bridge.test.js`（inject 最小化、hello/probe 字段、版本来源、契约不兼容、缺能力 503、wire 1/2 矩阵）与 `test/client-behavior.test.js`（挂载握手载荷、设置/输入面板降级、老 Host 兼容模式、版本不一致提示、手动 probe）；`test/client-static.test.js` 冻结 `CONTENT_EXTENSION_VERSION` / 兼容策略。

## 多角色动画数据（0.8.0）

三套 96×96 像素动画包（各 12 clip；帧数按 manifest：dog 70 / cat 74 / human 68，共 212 帧）按角色拆成懒加载 chunk（0.8.6）：入口 `client.js` **93.3 KiB**（0.12.0 工作树实测 95,731 B；gzip 27,470 B，< 96 KiB 首屏预算——0.10.1 为右键分级菜单由 72→78 KiB、0.10.4 为四层缩放模型由 78→96 KiB，仍比拆分前 314.8 KiB 基线小 69.59%），`client.anims.human.js`/`cat`/`dog` 在首次显示对应角色时才由 DSH `require.async` 拉取；首帧（入口+human，measure-bundle 口径）约 155.2 KiB（基线 50.49%），真实挂载总下载再加行为/宿主状态 chunk 约 164.8 KiB（53.63%，< 54% 基线门禁），全部角色加载后才约 334.7 KiB。`client.content.js`（内容中心 + 统一设置弹窗 + 首启安全卡 + 缩放控件 + 输入/同意/使用限制弹窗 + Host 能力面板 + 0.10.9 合规元数据展示 + 0.10.10 版本化同意/撤回 + 0.12.0 task-21 首启有用动作 + 「一起工作」专注模式）只在首次安装或首次打开弹窗时下载（83.7 KiB，gzip 24.2 KiB，0.12.0 工作树实测）；`client.behavior.js`（点击几何/区域命中/重复点击冷却/随机回话/帧 holdMs 时长）在挂载后立即下载并 memoize（5.6 KiB，gzip 2.0 KiB，0.12.0 工作树实测）；`client.status.js`（宿主粗状态轮询、隐私最小，4.0 KiB / gzip 1.5 KiB）同模式在挂载后懒加载并 memoize：

- 数据源：私有仓 `desktop-games/public/assets/pet/anim/{human,cat,dog}/`（`manifest.json` + 帧 PNG）。
- 生成器：`scripts/embed-anims.mjs` —— 读取 manifest/PNG、校验三套 clip 契约、把 RGBA 帧**无损**重编码为最小位深索引 PNG（硬 alpha 保留，体积约减半），再按 marker 注入 `client.js`。**禁止手改生成块**，改数据重跑脚本即可。
- 体积（0.12.0 工作树实测，2026-11-21）：入口 `client.js` 93.5 KiB / 95,731 B（gzip 27,470 B，brotli 22,972 B；task-21 首启动作 +385 B、task-B1 专注模式 +198 B）；3 个角色 chunk 合计约 241.2 KiB（human 61.7 / cat 99.8 / dog 79.7 KiB）；内容中心 + 设置 + 首启卡 + 缩放控件 + 输入/同意/使用限制弹窗 + Host 能力面板 + 合规元数据展示 + 版本化同意 + task-21 首启动作 + task-B1「一起工作」专注模式 chunk 83.7 KiB（gzip 24.2 KiB / brotli 19.7 KiB，0.12.0 工作树实测；task-21 +4,905 B、task-B1 +6,656 B）按需加载；行为 chunk `client.behavior.js` 5.6 KiB（gzip 2,043 B / brotli 1,786 B）与宿主状态 chunk `client.status.js` 4.0 KiB（gzip 1,545 B / brotli 1,306 B）在挂载后加载。首屏预算 0.10.1 由 72 KiB 上调到 **78 KiB**（右键分级菜单必须在首屏可用）、0.10.4 因四层缩放模型与面板贴合上调到 **96 KiB**（0.10.6/0.10.7 未再上调）；首启卡、设置内容、低打扰 UI 与输入/同意弹窗仍全部在懒加载 chunk，sprite payload 仍在角色 chunk：入口 = 拆分前审计基线的 **30.41%**（< 31% 门禁），首帧（入口+human）= 158,935 B = 基线的 **50.49%**；真实挂载总下载（入口+human+behavior+status）= 168,802 B = **53.63%**（< 54% 门禁）。
- 重新生成：`npm run embed:anims`；只校验不写：`node scripts/embed-anims.mjs --check`；`npm run verify:anims`；量化：`npm run measure:bundle`。
- 校验：`scripts/verify-anims.mjs` 校验角色/clip、按 manifest 的逐角色帧数、`holdMs`/`durationMs` 时长一致性、PNG 尺寸与可见像素、气泡/TTS 策略、动作映射与 i18n key，并检查 `client.content.js` 存在、四个一级 tabs、无 fetch/外部 URL，检查 `client.behavior.js` 的 chunk 注册/导出集/无网络无 eval/无存储写入与入口单点 `require.async` 接线，并在私有资产可用时逐字节比对嵌入块是否过期。
- 静态 QA：`node scripts/embed-anims.mjs --qa` 生成 `scripts/qa/anim-data.js`，浏览器直接打开 `scripts/qa/index.html` 可切角色、播 12 个 clip、看实心/空心气泡并跑数据自检，不需要重启 DSH。

## 点击区域反应（0.8.2）

- 区域数据来自私有仓 `desktop-games/public/characters/{pet-tinglan-anim,pet-cat,pet-dog}/regions.json`，与独立 famling 的 hero 共用同一份 `version/canvas/regions/gestures` 契约：区域是 96×96 逻辑画布上的 `head` / `body` / `tail` 矩形（带 priority）。
- `scripts/embed-anims.mjs` 读取并校验这些文档，写入生成块 `ANIMS[character].regions`；`--check` 会把它纳入过期检测，`--qa` 生成的 `anim-data.js` 也包含区域数据。
- 点击时用图片**实际渲染尺寸**把 `offsetX/offsetY` 映射回 96 逻辑坐标，再按 priority 命中区域；同一相对位置在 64/72/96/144px 等任意显示尺寸下命中一致。
- 命中映射：`head → pat_head`（摸头）、`body → stand_wag`（摇尾/伸展）、`tail → chase_tail`（追尾）；气泡文案来自该区域规则自带的 `says` 随机行（0.8.3），没有台词数据就不说话。同一区域连续点击有 1.2s 冷却；10s 内同区第 4 次起降为既有 `idle_blink` 轻反应（饱和后 2.5s 冷却），菜单动作不受此限制。命中几何/区域判定/冷却状态机与随机回话选择器在懒加载 `client.behavior.js`，入口只应用判定结果并更新状态。
- 只有 `idle` / `idle_blink` 状态响应，正在播放其它 clip 时不打断；命中透明区/未声明区域是明确的 no-op，**不再回退为随机微动作**（随机微动作仍由待机计时器触发）。
- 区域回话（0.8.3）：`regions.json` 的每条区域规则带 3 条 `says`，命中后随机挑一条（连续同区域点击会换一句）；猫/狗仍为空心 thought 气泡、永不 TTS；汀岚为实心 speech + 既有 TTS 同意。

## 物种专属互动与随机回话（0.8.3）

- 互动菜单不再手写固定表：`scripts/embed-anims.mjs` 把 `regions.json` 的 `actions`（id/label/event/followUpEvent/followUpMs/says）和 `gestures[].says` 一起嵌入 `ANIMS[character]`，并纳入 `source-sha256` 与 `--check` 过期检测；改数据后重跑 `npm run embed:anims` 即可。
- 事件 → clip 映射不再手写：`scripts/gen-content-constants.mjs` 从 famling 的 `public/characters/*/{regions,behavior}.json` + `public/assets/pet/anim/*/manifest.json` 生成 `client.js` 的 `EVENT_CLIPS` 块（`pat`→`pat_head`、`ball_throw`→`ball_throw`、`ball_chase`→`ball_chase`、`paw_face`→`paw_face`、`run`→`run`；`feed` 复用 stand/wave clip；`talk` 只出气泡、保持 idle）；`npm run check:content` 对生成块做过期检测，`scripts/verify-anims.mjs` 继续校验映射完整、猫/人没有球类动作、金毛丢球→追球 follow-up，以及每个动作/区域至少 2 条随机回话。
- 单源与检查链（MB-107/MB-108）：`public/content/library.json` 的角色/对话/外观/用途/合规常量同样由 `gen-content-constants.mjs` 生成到 `client.js` 的 `@generated` 块（声明差异 D1–D4 见 `docs/CONTENT-CONSTANTS-2026-11-20.md`）；`npm run check`（ANIMS + content 双生成块）、`npm run lint`（JSDoc/lint 最小链）与 `npm run typecheck`（checkJs，**含 content-extension.mjs**；缺 TypeScript 时诚实 skip）已纳入 `release:check`。i18n/locale 单一源由 `scripts/check-i18n.mjs` 冻结（10 项检查：client.js `L`、client.content.js `STRINGS`、`locale/*.json` 的键树/引用/死键；随 `npm test` 的 `test/i18n.test.js` 执行）。
- 随机回话使用“避开上一句”的选择器：同一区域/同一动作连续点击不会返回同一句；气泡文案、TTS 与 thought 策略沿用 0.8.2。

## 帧时长与 holdMs 播放（0.8.4）

- 帧数/时长不再写死：`scripts/embed-anims.mjs` 与 `scripts/verify-anims.mjs` 从每个角色自己的 `manifest.json` 读取帧数与每 clip 的 `fps`/`holdMs`/`durationMs`；各角色帧数可以不同（dog 68 / cat 72 / human 68，共 208；cat `stand_wag` = 10 帧）。
- `client.js` 播放改为逐帧 `setTimeout`：第 n 帧停留 `holdMs[n] ?? round(1000/fps)` 毫秒；非循环 clip 播完最后一帧回到 `idle`，若 manifest 的 `durationMs` 大于 hold 总和则延长最后一帧。cat 伸懒腰 = 300+300+300+350+400+400+400+350+250+150 = **3200ms**（10 帧），不再被固定 `setInterval(1000/fps)` 播快；攻击帧也按 attack 的 holdMs（83/83/63/42/42/63/63）播放。
- `holdMs`/`durationMs` 进入 `source-sha256` 与 `--check`：只改 timing 的 manifest 变更同样会让嵌入块变旧；`verify-anims.mjs` 校验 holdMs 逐帧覆盖、总和等于 durationMs。

## 极简 UI 与右键分级菜单（0.10.1）

- **默认零按钮**：footer 里只有 72px 角色图；角色图本身是可 Tab 聚焦的 button，带 `aria-haspopup="menu"` / `aria-expanded`，不渲染任何常驻的输入/互动/设置/内容按钮。
- **打开方式**：右键角色、Shift+F10、或 ContextMenu 键；菜单为自绘 `role="menu"` + `role="menuitem"`，带 `aria-activedescendant` 与 roving tabIndex，菜单外点/窗口失焦/Escape 关闭，关闭后焦点回到角色。
- **键盘**：↑/↓ 循环、Home/End 到首尾、←/→ 返回一级或进入子页、Enter 激活、Escape 关闭、Tab 关闭；每个二级页面第一项是「« 返回」。
- **分级（一级只 5 项）**：聊两句…（输入面板）/ 互动 ▸（当前形象 `ANIMS[character].actions`）/ 内容与角色…（内容中心弹窗）/ 设置…（统一设置弹窗）/ 更多 ▸（提醒… + 使用限制与版本…）。复杂功能不塞一级。
- **视口夹取**：菜单 `position: fixed`，按视口尺寸把 left/top 夹在 8px 边距内；`clampMenuPosition` 为纯函数，行为测试直接断言坐标。
- **菜单按钮**：设置弹窗里的「显示菜单按钮」默认关闭；开启后角色旁出现小的「⋯」触发器（`aria-label` 为「菜单」）。偏好写入 `dsh-famling/menu`（`{ button: boolean }`）；菜单展开状态和子页不持久化，每次打开都从一级开始。
- **降级**：`client.content.js` 加载失败时，内容/设置弹窗显示本地失败提示，右键菜单与角色互动仍可用；`client.behavior.js` 未就绪或加载失败时，帧播放回退统一默认节奏（不使用 `holdMs` 分段），区域点击为本地 no-op（不抛错、不阻塞渲染），菜单动作仍播放 clip、只是不出随机台词。

## 内容中心：角色就是主题（0.10.0）

内容中心不再把「主题 / 背景 / 字体」当作并列的一级主视觉。**角色就是主题 bundle**：一个角色 = character + voicePolicy + dialogue + theme + background + font 六个组件；点一次「一键应用」= 原子地应用整包。之后用户可以在「自定义」里改任意组件（覆盖角色预设），或一键「恢复角色默认」。

### 四个一级 tabs

| Tab | 内容 | 行为 / 持久化 |
|---|---|---|
| **角色** | 汀岚 / 布偶猫 / 金毛（origami bundle 数据预留，素材未安装，不提供卡片） | 每卡展示 glyph 头像、角色名、一句说明、声音 / 对话 / 外观摘要和「一键应用」按钮；当前角色有 ✓ 标记。应用 = 同时写 character、voicePolicy、dialogue、theme/background/font 与 `dsh-famling/role`；不预加载其它角色动画 chunk。 |
| **自定义** | 声音（TTS 策略）/ 对话 / 主题 / 背景 / 字体（保留 0.9.1 能力） | 顶部说明「仅修改当前角色的搭配，不改变角色预设」并显示「角色预设 / 已自定义」；每个组件改动只写对应旧键，角色 id 不变；「恢复角色默认」按当前角色 bundle 重置全部组件。 |
| **内容包** | 当前只有内置包（4 个角色 bundle），没有外部包 | 展示已安装列表、v3 强制 `usageDeclaration` 检查结果（researchOnly=true + 六项禁止用途）、资产包导入入口（**需 Host 支持**，zip/文件夹清单 + sha256 由 Host 解析；本版本不读取文件、不执行脚本、不加载素材、不联网）。 |
| **市场** | 远程市场占位 | 固定显示「远程市场接口已预留，服务器未配置」；展示预留字段 `catalogUrl` / `configKey`（`dsh-famling/market/catalog`、`dsh-famling.market`）；不发网络请求、不展示伪造商品。 |

### 角色 bundle

| role | character | 声音策略 | 对话 | 主题 / 背景 / 字体 |
|---|---|---|---|---|
| `human` | 汀岚 | speech，可浏览器 TTS（仍受独立同意门禁） | `standard` | `default` / `transparent` / `system` |
| `cat` | 布偶猫 | thought，无 TTS | `standard` | `night` / `dark` / `serif` |
| `dog` | 金毛 | thought，无 TTS | `standard` | `paper` / `paper` / `system` |
| `origami` | 预留 | speech（共享 tide 语音策略；数据预留，不可应用） | `standard` | `night`（共享 `high-contrast` 显式映射）/ `transparent` / `mono`（数据预留，不可应用） |

以上六个组件与 famling `public/content/library.json` 的 `rolePresets` 对齐（human: standard/default/transparent/system；cat: standard/night/dark/serif；dog: standard/paper/paper/system）；origami 共享包使用 `high-contrast` 主题，本插件没有该主题，因此显式映射为 `night` 且 `available:false`，不会静默错配。对话模式同样与共享 `dialoguePacks` 对齐：`standard` = 240 字 / 70% 环境气泡、`brief` = 80 字 / 40%、`quiet` = 50 字 / 5%；改这些值必须同时同步 famling 与插件两处。

一键应用会把 TTS 开关改成 bundle 的声音策略；若用户尚未同意 TTS，则保持关闭（不会绕过同意门禁）。切到猫/狗会取消正在进行的浏览器朗读。

### 持久化与回填

- 新键 `dsh-famling/role` 记录当前角色主题（primary），`dsh-famling/menu` 记录「显示菜单按钮」开关；旧键继续使用：`dsh-famling/character`、`dsh-famling/settings`（`sound` / `voiceURI`）、`dsh-famling/dialogue`、`dsh-famling/theme`、`dsh-famling/background`、`dsh-famling/font`。
- 应用角色 = 写入全部六个组件对应的键 + `dsh-famling/role`；自定义 = 只覆盖被点的那一个组件键，角色 id 不变。
- 加载：先读 `dsh-famling/role`；没有该键时从已存 `character` 反推角色；缺失的组件键用该角色 bundle 回填，已显式保存的组件键优先。0.9.x 用户升级后首次渲染即获得角色回填。
- 行为 kit `client.behavior.js` 在挂载后通过一个 memoize 的 `require.async` 入口（`requestBehaviorChunk`）拉取，失败时回退默认帧节奏；内容中心 UI chunk `client.content.js` 在首次打开面板时才通过 `require.async('./client.content.js')` 下载；失败时本地面板显示加载失败，核心互动不受影响。

## 内容扩展接口 v3（预留，不联网）

[`content-extension.mjs`](content-extension.mjs) 是给未来本地/远程内容包的公开契约（package export：`dsh-famling/content-extension`）：

- `CONTENT_EXTENSION_POINTS` — **version 3**（pack `schemaVersion: 3`）、`status: "reserved"`、`transport: { network: false, execute: false, innerHTML: false, worker: false, assets: false }`；0.10.9 起顶层 `compliance` 公布可选合规字段的形状、冻结锚点与严格模式选项。
- `CONTENT_KINDS` — **七类**：`role` / `character` / `voice` / `dialogue` / `theme` / `background` / `font`。`role` 是 v3 新增的 bundle kind：apply 必须包含 `character / voicePolicy / dialogue / theme / background / font` 六个组件，entry 还必须带 `compatibility`（`minPluginVersion`，可选 `maxPluginVersion`）。
- **所有 pack 必须含 `usageDeclaration`**：`{ researchOnly: true, prohibitedUses: [六项] }`；六项固定为 `emotional-companionship` / `virtual-partner` / `professional-advice` / `minor-intimacy` / `impersonation` / `illegal-use`。缺失、`researchOnly !== true`、少一项、多一项、重复项或未知字段一律拒绝。role entry 不豁免 pack 级声明；role entry 可选地重复一份 `usageDeclaration`，出现时按同一规则校验。声明模板导出为 `USAGE_DECLARATION_TEMPLATE`。0.10.9 起还可追加 canonical `statement` / `statementRef` / `statementSha256`，出现时三者必须与 `CONTENT_USAGE_STATEMENT` / `CONTENT_USAGE_STATEMENT_REF` / `CONTENT_USAGE_STATEMENT_SHA256` 逐字一致（严格模式要求 `statement` + `statementRef`）。
- **0.10.9 合规字段（可选、向后兼容）**：pack 可带 `license`（`spdx` + `attribution`，可选 `url` / `file`）、`aiProvenance`（`generated` + `disclosure`，可选 `tools`）与 `compatibility`（`minPluginVersion` + 可选 `maxPluginVersion`）；entry 也可选带 `license` / `aiProvenance`（role entry 的 `compatibility` 仍必填）。声明了就必须逐字段合法（fail-closed），未声明默认只产生 `warnings`，pre-0.10.9 的 v3 pack 继续有效。冻结的第一方锚点导出为 `CONTENT_LICENSE_TEMPLATE` / `CONTENT_AI_PROVENANCE_TEMPLATE`。
- **严格模式与版本门**：`validateContentPack(pack, { requireCompliance: true })` 供 Host 加载不受信 pack 时 fail-closed——缺 `license` / `aiProvenance` / `compatibility` 或 canonical `usageDeclaration.statement` / `statementRef` 直接进 `errors`；`{ pluginVersion: "x.y.z" }` 额外校验 pack 级与 role entry 的兼容区间是否包含当前插件版本（对应纯函数 `isPackCompatibleWithPlugin`）。
- **`assets` 预留**：pack 可带 `{ format: "zip" | "folder", files: [{ path, sha256, bytes? }], totalBytes? }`；path 必须是安全相对路径（≤6 段、无 `..`、无 scheme、≤160 字符、带扩展名），sha256 为 64 位小写 hex；**只做数据校验/清单，不读取、不打开、不执行、不加载任何资产**。
- **`remoteCatalog` 预留**：可选 `{ status: "reserved", url?: "https://..." }`；仅作为元数据校验，**不 fetch、不预热、不加载远程目录**。远程 source（`source: "remote"`）默认拒绝，未来 Host 必须显式 `{ allowRemote: true }` 才通过 schema 校验。
- `validateContentPack(pack, { allowRemote?, requireCompliance?, pluginVersion? }) → { ok, errors, warnings }` — **纯数据**校验：`warnings` 报告缺失的可选合规字段（不改变 `ok`），严格模式/版本门见上；不抛异常、不执行、不联网、不读文件。
- `CONTENT_PACK_EXAMPLE` — 一份合法的 v3 示例 pack（含完整 usageDeclaration + canonical 声明字段、license / aiProvenance / compatibility、一个 role bundle、一个 theme entry；默认与 `requireCompliance: true` 都合法），不会被自动加载。

最小声明与 role 片段：

```json
{
  "schemaVersion": 3,
  "id": "com.example.warm-pack",
  "name": "Warm Example",
  "version": "1.0.0",
  "source": "local",
  "usageDeclaration": {
    "researchOnly": true,
    "prohibitedUses": [
      "emotional-companionship", "virtual-partner", "professional-advice",
      "minor-intimacy", "impersonation", "illegal-use"
    ],
    "statement": "本项目及其全部代码、美术、音频、文案、角色素材和衍生物仅用于技术研究与原型验证，不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途。",
    "statementRef": "docs/legal/USE-RESTRICTIONS-2026-11-19.md",
    "statementSha256": "0353536cefd702014b12a8365c4a486f19848d049652e9692027216adb80c743"
  },
  "license": { "spdx": "CC-BY-4.0", "attribution": "Example pack authors" },
  "aiProvenance": { "generated": false, "disclosure": "Example content is written by hand; no generative AI was used.", "tools": ["deterministic-python-renderer"] },
  "compatibility": { "minPluginVersion": "0.10.0" },
  "entries": [
    {
      "kind": "role",
      "id": "warm-human",
      "name": "Warm Human",
      "version": "1.0.0",
      "source": "local",
      "preview": { "kind": "glyph", "value": "🧑" },
      "permissions": ["apply:role", "store:selection"],
      "compatibility": { "minPluginVersion": "0.10.0" },
      "apply": {
        "character": "human",
        "voicePolicy": { "canTts": true, "mode": "speech", "sound": true },
        "dialogue": { "mode": "standard" },
        "theme": { "variables": { "--dsh-famling-bubble-bg": "#fff3cd", "--dsh-famling-bubble-text": "#3b2f24" } },
        "background": { "kind": "transparent" },
        "font": { "family": "system-ui, sans-serif", "size": 12, "lineHeight": 1.5 }
      }
    }
  ]
}
```

其它校验（与 v2 一致并延续）：纯数据（拒绝函数 / symbol / bigint / 非有限数 / 非 plain object）、未知字段/枚举、超长字符串/数组、JSON ≤ 64 KiB、entries ≤ 32（每 kind ≤ 16）、id/name/description 限制、原型链键（`__proto__` / `constructor` / `prototype`）、图片预览路径穿越/绝对路径/URL、`<` 与控制字符、`url()` / `expression()` / `@import` 等危险 CSS；theme 变量必须 `--dsh-famling-*` 且值为安全颜色；background 只允许 transparent/安全纯色；font 只允许 1..8 个不带引号的本地字体名（拒绝引号、`url()`、`var()`、分号、花括号、`@` 规则）。重复 entry id / 重复 asset path / role 兼容范围倒置都会拒绝。0.10.9 起合规字段同样纯数据校验：`spdx` 2..64 字符、`attribution` ≤ 200、`url` 仅 https（不 fetch）、`file` 仅安全相对路径（不打开）、`aiProvenance.disclosure` ≤ 280 且 `generated=true` 必须有真实声明、`tools` 1..8 个小写工具 id（不执行）、兼容版本必须 `x.y.z`。

本版本**不加载任何 pack**：没有网络请求、没有 pack 脚本执行、没有 `innerHTML`、没有资产解包；内容中心只展示内置目录、声明检查与预留说明。未来接入加载器时也必须是「纯数据 + 在 Host 侧解析/校验 + UI 只渲染数据」。完整 schema、限制与示例见 [docs/DETAIL.md](docs/DETAIL.md)。

> 与独立 famling 的共享内容模型 `famling.content/0.2`（characters / voices / dialoguePacks / themes / backgrounds / fonts / **rolePresets**）是**目标超集关系**：六类仍可与插件 kind 一一映射（`builtin` ≡ `bundled`），v3 的 `role` 是把六类组合成的角色主题 bundle。0.10.1 起插件 `ROLE_BUNDLES` 与共享 `rolePresets` 的六个组件**逐项对齐**（human/cat/dog），`DIALOGUE_MODES` 与共享 `dialoguePacks` 的 maxChars/bubbleChance 对齐；origami 的 `high-contrast` 主题本插件没有，显式映射为 `night` 且 `available:false`。插件契约把“选择/应用”建模为 `apply` + permissions，共享模型是目录条目 + 解析函数；主题 CSS 前缀、语音来源（浏览器 speechSynthesis vs DeepSeek stella/tide）与校验返回结构仍不同。两套契约并存、各自 fail-closed；0.10.9 把 v2 的 license / aiProvenance / compatibility **形状与语义**投影为 v3 的追加可选字段（并冻结双端锚点），但仍不合并两套 schema、不改 v2 包结构，未来收敛仍通过适配层，详见 [docs/DETAIL.md](docs/DETAIL.md)。

## Host bridge（P0/P1/P2/P4 已实现；0.10.7 加 hello/probe；0.12.0 加 state）

- `POST /api/famling/bridge`（同源、owner-only、JSON ≤16KB）；wire 1 与 wire 2 都受理，`hello`/`probe`/`state` 只接受 wire 2
- `op:"hello"`（wire 2）→ 握手：插件版本 / bridge wire / **content-extension v3** 契约 / 宿主版本与来源 / 能力矩阵 / 逐项 probes / `compatible` / `versionMismatch`；不调模型、不读文件、无副作用
- `op:"probe"`（wire 2）→ 重新探测可选 Host 服务（`llm`/`schedule`/`agentDefaultModel`），返回同样的能力/契约 + `generatedAt`；设置内「重新检测 Host 能力」使用它
- `op:"state"`（wire 2）→ 只读粗状态：`{ available, source, state: "idle"|"running"|"unknown", active, updatedAt, lastError: null | { kind, at }, transitions: [{ state, at }] }`。`source:"events"` 来自 `ctx.on("agent/status")` + `ctx.on("agent/error")` 的有界内存环（≤16 条，只有状态 + 时间戳 + 分类 error kind：`aborted`/`auth`/`network`/`rate-limit`/`server`/`timeout`/`tool`/`unknown`）；**不读不存** agent id / 会话 id / 消息 / 提示词 / 工具参数 / 文件内容，不落盘、不上传、不写日志。Host 无事件 API 或订阅抛错时 `available:false` + `source:"unsupported"`，插件照常激活；响应在 host 端按闭合 schema 校验，非法快照整体回退为 unavailable（fail-closed）
- `inject` 只要求 `connection`；缺 `llm`/`schedule` 时插件照常激活，对应能力在响应 `capabilities` 中为 `false`，chat/task 返回 503 `E_LLM`/`E_TASK` + `{ capability, unavailable: true }`
- `op:"echo"` → 本地回显
- `op:"chat"` → Host `ctx.llm.stream`；provider/model 来自 DSH 默认模型选择或本插件 Config，**不写死**（Key 只在 Host）；system prompt 按请求的 `character` 选择人格（非法/缺失回退 `human`）
- `op:"brief"` → 只读 `~/.advisers/pet-brief.json`（≤128 KiB），先按 closed contract v0.2 严格校验整份文档（`schemaVersion 1|2`、closed-schema 未知/禁止字段、`displayPolicy`、ISO 时间与 **5 分钟 TTL 上界**、counts=数组长度、条目/枚举/上限），任何偏差 404 `E_MEMORY` fail-closed；仅成功后才投影计数 + 最多 3 条 today/commitments，不代传 Advisers TOS，不投影 risks/facts/suggestedLines。与 Advisers 0.3.0（Pet Brief 契约 v0.2）的兼容性、校验矩阵与未覆盖项见 [docs/PET-BRIEF-0.3.0-COMPAT-2026-11-20.md](docs/PET-BRIEF-0.3.0-COMPAT-2026-11-20.md)。
- `op:"task"` → `ctx.schedule.create` 一次性提醒（绝对时间；不自己实现定时器）
- TTS/ASR 各自独立同意；默认关闭；浏览器语音会明确说明音频去向；同意记录带声明版本 + SHA-256 + acceptedAt + withdrawn（0.10.10），可单独撤回
- **LLM 聊天已接入 Host bridge**（`op:"chat"` 经 DSH `ctx.llm.stream`，内容会发送给所配置的模型服务商）；TTS/ASR 是浏览器本地能力、各自独立同意；**记忆写入仍未实现**。下一步见 `docs/DSH-FAMLING-BRIDGE-2026-11-17.md`。
- 数据流披露：聊天文本经 DSH Host 发往 DSH 中配置的模型供应商；插件本身不接收、不存储 API Key、不保存聊天记录；`brief` 只读本机 `~/.advisers`，不上传。**危机关键词命中时文本不会离开本机**（本地短路，不调模型）；设置内「AI 聊天」开关关闭后不发送任何聊天文本；「清除本机设置与同意」只删本插件浏览器键，DSH 宿主/会话/供应商数据不受影响。

## Pet Brief 兼容（Advisers 0.3.0，2026-11-20）

Advisers 0.3.0（npm raw registry `latest`；本机 npmmirror 缓存仍显示 0.2.3，不代表发布状态）**不改变 Pet Brief 契约**：仍是 v0.2（`schemaVersion: 2`），v0.1（`1`）按 legacy 可读；0.3.0 的 `pet-brief` 改动是性能重构与 producer 侧 secrecy 过滤，输出等价的证据是 Advisers 仓 `test/read-model-projections.test.js` 的 `assert.deepEqual(projectedBrief, fullBrief)`。**本轮（task-152）把 bridge 从宽松投影边界升级为严格 consumer**：读取后先按 closed contract v0.2 校验整份文档，再投影固定 allowlist；旧版「未知 policy 归一 private / counts 不比对 / 接受未知字段」的宽松行为已移除（fail-closed，404 `E_MEMORY`）。

| 检查项 | 插件行为（实测） |
|---|---|
| 合法 v0.2 private/public | 200，投影 counts + today/commitments 各 ≤3 |
| `displayPolicy: none` | 404 `E_MEMORY`（不渲染派生内容） |
| 未知 displayPolicy / v0.2 缺 displayPolicy | **404 fail-closed**（closed enum / required） |
| v0.1 legacy（无 displayPolicy） | 接受，按 `private` |
| schemaVersion ≥3 / 非法 / 缺失 | 404 fail-closed |
| 过期 / 无 `expiresAt` / 非法时间 / **TTL >5 min** / 时间倒序 / generatedAt 超前 >60 s | 404 |
| 缺/非法 counts、**counts ≠ 数组长度**、损坏 JSON、>128 KiB | 404 |
| 未知/禁止字段（reasoning/api_key/…）、>10 项、重复 id、非法 enum/confidence/超长字符串 | **404 fail-closed**（closed schema，错误消息只含稳定 code） |

测试：`test/pet-brief-compat.test.js`（14 条：11 条 always-on 严格/负向用例 + 3 条可选层——真实 0.3.0 producer、canonical v0.2 26 向量、私有 famling fixtures；「真实 0.3.0 producer 合成账本往返」「canonical v0.2 26 向量」「私有 famling fixtures 往返」在兄弟仓缺失时诚实 skip、在 MB-004 clean-checkout 子进程不注册）；`test/host-bridge.test.js` 26 条。本机实测 `node --test test/pet-brief-compat.test.js test/host-bridge.test.js` = **40/40 pass**，`npm run lint` / `npm run typecheck` / `npm run check:package` 均 ok。完整版本真值、校验矩阵、剩余缺口（G3–G6）与证据见 [docs/PET-BRIEF-0.3.0-COMPAT-2026-11-20.md](docs/PET-BRIEF-0.3.0-COMPAT-2026-11-20.md)。

### 模型选择（2026-11-18 起不再写死）

`op:"chat"` 的 provider/model 按以下顺序解析（`index.js` 的 `resolveSelection`）：

1. **插件 Config 显式覆盖**（可选）：`provider`/`model` 必须成对出现，否则加载时报错；`reasoningEffort` 可选。
2. **DSH 默认模型选择**：从 Host 服务 `agentDefaultModel.currentSelection()` 读取（即 DSH 设置/模型选择器里的默认模型），换模型后宠物对话自动跟随。
3. 两者都取不到时 `chat` 返回 503 `E_LLM`，**不静默回退到写死的模型**。

固定模型（仅在你清楚要这么做时）由用户 patch 层提供，例如：

```yaml
- id: dsh-famling
  name: dsh-famling
  config:
    provider: deepseek-official
    model: deepseek-flash
    reasoningEffort: max   # 可选
```

不要改 DSH 自带的 profile bundle；优先用 DSH 的模型选择器。

## 人格随形象切换（0.8.1）

切形象时图像与聊天人格一起切换：`client.js` 的 `op:"chat"` 请求携带当前 `character`（`human`/`cat`/`dog`，非法或缺失时客户端归一为 `human`）；`index.js` 用它选择 system prompt，Host 侧同样对非法值回退 `human`。

| character | 形象 | 人格要点 | 气泡/语音 |
|---|---|---|---|
| `human` | 汀岚 | 安静、简洁的工作搭子；先给结论 | 实心 speech，可用浏览器 TTS |
| `cat` | 布偶猫（白底蓝重点长毛） | 懒散、高冷、短句；允许轻微傲娇但不冒犯 | 空心 thought，永不 TTS |
| `dog` | 金毛 | 友善、热情、简单直接 | 空心 thought，永不 TTS |

三条人格共用同一组安全边界：不冒充真人/官方/专业顾问；不诱导依赖、恋爱、付费或未成年人情感关系；不输出违法、隐私或冒充内容。人格只是 system prompt 级的语气差异，不是独立角色扮演或情感陪伴；模型仍由 DSH 默认模型选择决定。

## 安装

### A. 从 npm（推荐，0.11.1+）

```sh
dsh plugin --profile web add dsh-famling
```

本包声明 `dsh.bundle` manifest（`cordis.patch.yml`）与 `dsh.client` 前端，npm 包名 `dsh-famling`。

### B. 本地目录

1. 把本目录放到 DSH 插件目录；
2. DSH **Plugins → Add plugin** 选择本目录（或使用 `plugin_manager install_bundle`，target 为本目录绝对路径）；
3. 启用 `dsh-famling`，刷新 Web UI；
4. 查看左侧栏底部账号区域下方是否出现 `汀岚`。
5. 也可用 `npm view dsh-famling` 查看已发布版本（当前 0.11.1）；DSH 插件目录安装仍以 1–4 步为准。

## 发布与包卫生（0.11.1，MB-094 残余，2026-11-21）

本插件以 npm tarball 分发，所以 `package.json` 的元数据与 `files` 白名单就是发布面；这些规则由脚本门禁强制，不是约定：

- **元数据**：`repository` = `git+https://github.com/PerryLink/dsh-famling.git`，`homepage` = 本仓 README，`bugs` = 本仓 issues；三者必须同指一个仓（`dsh-famling` 是 DSH 插件仓；独立应用仓 `PerryLink/famling` 只在上面「两个包」表里作为相关产品链接）。
- **`files` 白名单**：无重复（历史遗留的 `docs` 重复项已删除）、每个条目必须存在、运行必需文件与 `exports` 全部覆盖、`test/`/`scripts/`/`*.tgz` 永不打包；`npm run verify:package` 用 `npm pack --dry-run --json` 做「实际打包清单 = 白名单展开 + npm 始终包含项」的集合相等校验。
- **`prepack`**：每次 `npm pack` / `npm publish` 自动跑静态发布卫生校验；成功信息走 stderr（避免污染 `npm pack --json` 的 stdout），失败直接中断打包。
- **命令**：`npm run check:package`（静态）/ `npm run verify:package`（含 `npm pack --dry-run`）/ `npm run release:check`（test + check + verify + verify:package，发布前总门禁）。
- **已发布**：`npm publish` 0.11.0（2026-11-21，本地 npm token 发布；**未启用 provenance / trusted publishing**）；`npm view dsh-famling version` = 0.11.0。GitHub 公开仓推送后的 CI 首次真实运行以实际 run 为准（本机不伪造 CI 结果）。细节、证据与本机实测记录见 [docs/RELEASE-HYGIENE.md](docs/RELEASE-HYGIENE.md)。

## 独立 checkout 重建与 LOCK（MB-004，2026-11-20）

本插件可以在**没有私有 famling 仓**的单独 checkout 里重建、测试与验证：

- **安装 LOCK**：仓库提交 `package-lock.json`（lockfileVersion 3；插件零运行时依赖 → root-only 锁）；`npm ci` / `npm ci --offline` 可复现安装。`scripts/check-package.mjs` 把 LOCK 纳入发布门禁（name/version/license 与 `package.json` 一致、声明的依赖都在锁里、禁止 `file:`/`link:`/绝对路径的私有解析）。
- **动画 vendored spec/LOCK**：`scripts/spec/anim-spec.json` 保存三套动画的语义契约（clips 帧数/fps/holdMs、regions/actions）、`client.js`/懒加载 chunk/每帧 SHA-256、私有源帧逐文件 SHA-256（**不含 PNG/base64 字节**）。`node scripts/embed-anims.mjs --check` 在无私有资产时进入 `standalone spec mode`（缺 spec 或篡改一律失败，不再 skip）；`node scripts/verify-anims.mjs` 总是校验 vendored spec，私有无资产时打印 `private assets: absent` 而不是跳过字节级比对。
- **clean checkout 门禁**：`node scripts/clean-checkout.mjs` 把包复制到临时目录、把 `FAMLING_ANIM_DIR` / `FAMLING_CHARACTERS_DIR` / `FAMLING_REPO_DIR` 指向不存在路径，真实跑 `npm ci --offline` + 全量 `node --test` + `check` / `verify` / `check-package --pack` / `lint` / `typecheck`；`--json` 输出可复核证据，`--keep` 保留副本。`test/clean-checkout.test.js` 会把该门禁纳入 `npm test`。
- **公开仓同步准备**：`node scripts/clean-checkout.mjs --export DIR` 生成可直接首推的公开仓树（排除 `node_modules` / `.git` / 缓存 / tarball）并对导出树做静态包卫生 + spec 校验；首推、CI 首跑、分支保护与 npm publish 属外部步骤（本工作区不执行、不声称完成）。
- **剩余限制**：单独 checkout 仍有 **10 个跨仓 parity skip**（对照兄弟 famling 仓的 library/behavior/terms/compliance 冻结值；插件侧 frozen 值与 `test/fixtures/content-compliance/` 仍照跑），它们不是构建依赖，clean-checkout 门禁会断言“仅剩这些既知跨仓 skip、无私产资产 skip”。没有 TypeScript 的裸 checkout 里 `typecheck` 按既有设计打印诚实 skip。
- 细节与实测证据：[docs/INDEPENDENT-REBUILD-2026-11-20.md](docs/INDEPENDENT-REBUILD-2026-11-20.md)；公开仓 staging 清单：[docs/PUBLIC-REPO-SYNC-2026-11-20.md](docs/PUBLIC-REPO-SYNC-2026-11-20.md)。

## 验证

![dsh-famling 验证：真实运行 npm test（314 条测试、301 通过、0 失败、13 跳过）与 npm run verify（212 帧、12 个 clip、三个角色分别 68/74/70 帧，首屏 155.2 KiB）](docs/assets/dsh-famling-demo.gif)

*动图是本仓 `npm test` 与 `npm run verify` 的真实 stdout（2026-11-21 在浅克隆里复跑）。13 条跳过需要同级 checkout（Advisers producer、私有 famling fixtures），本克隆没有，因此如实显示为 skipped 而不是藏起来。*


- `node --check client.js`
- `node --check client.content.js`（内容中心懒加载 UI chunk，纯本地渲染）
- `node --check client.behavior.js`（行为 kit 懒加载 chunk，纯交互/时序逻辑，无 DOM 写入）
- `node --check content-extension.mjs`（内容扩展契约，纯数据/无副作用）
- `node --check index.js`
- `node --test test/pet-brief-compat.test.js`（Pet Brief v0.2 × Advisers 0.3.0 兼容：严格 closed-schema、TTL 上界、counts 一致性、displayPolicy、schema 闸门、投影 allowlist 与负向用例；可选「真实 0.3.0 producer 合成账本」与「私有 famling fixtures」两层在兄弟仓缺失时诚实 skip）
- `npm test`（`node --test test/`：Host 桥接 fake-context 测试 + **Host 能力协商 hello/probe/降级（0.10.7）** + 客户端生成块/多角色行为测试 + 极简 UI/右键分级菜单/设置弹窗/键盘测试 + 内容中心四分类/角色 bundle/共享 rolePresets 对齐/内容扩展 v3 契约与 0.10.9 合规字段（license / aiProvenance / compatibility、向后兼容、严格模式）测试 + 插件安全地板（危机短路/发送去向/首启卡/清除撤回/聊天开关/版本真值）测试 + 版本化同意（0.10.10 / MB-014：接受/迁移/陈旧版本或哈希/撤回/清除、canonical 哈希与双端锚点冻结）测试 + 发布卫生（元数据 / files 白名单 / prepack 接线 / 打包清单）测试 + **MB-004 独立重建（package-lock LOCK / vendored anim spec / clean-checkout / 公开仓导出 staging）** 测试（测试项数随并发任务增删，以 `npm test` 实测为准），不调用真实模型）
- `npm run check:package`（静态发布卫生：repository/homepage/bugs 一致、files 无重复且存在、禁止项、exports 全覆盖）
- `npm run verify:package`（静态 + `npm pack --dry-run --json`：实际 tarball 清单必须与白名单展开完全相等）
- `npm run release:check`（发布前总门禁 = test + check + verify + verify:package）
- `node scripts/clean-checkout.mjs`（MB-004：无私有仓的临时 checkout 重建；`--json` 证据 / `--export DIR` 公开仓 staging；`npm test` 内也跑）
- `npm run check`（= `check:anims`：嵌入块与私有动画包一致；无私有资产时用 vendored `anim-spec` 的 `standalone spec mode`）
- `npm run verify`（= `verify:anims`：vendored anim-spec 校验 + 3 角色 × 12 clip、按 manifest 的帧数 68/72/68=208 与 holdMs 时长、点击区域契约、气泡/TTS 策略、动作映射、内容中心四 tabs / 声明检查 / 无 fetch 门禁、行为 chunk 注册与导出集/无网络无 eval、首屏 96 KiB 预算；另打印入口+human 首帧与含 behavior kit 的挂载总下载）
- `npm run measure:bundle`（入口 92.3 KiB / 内容+设置+首启卡+输入/同意弹窗+Host 能力面板+合规元数据展示+版本化同意 chunk 72.5 KiB 等实测；行为 kit 5.6 KiB 需另量，脚本暂不计入）
- 版本真值：`package.json` 是唯一来源；`node test/version-truth.test.js --write` 从 package.json 重新生成 `client.js`/`client.content.js` 的 `PLUGIN_VERSION` 常量（zh/en 标签由它派生）、README「当前实现」、LEGAL-NOTICE「适用插件版本」与 `locale/*.json` 的 `meta.version`，`npm test` 会校验它们全部一致（含安全地板文档真值）。
- `npm run qa:anims` 后浏览器打开 `scripts/qa/index.html`（静态 QA，不重启 DSH）
- 插件详情/图标：`locale/zh.json`、`locale/en.json`、`icon.png`
- 本版本按 DSH 0.2.2-rc 线的 `sidebar.footer.action` slot 编写（本机 DSH checkout 为 `dsh-v0.2.2-rc.4`）；`package.json` 的 `engines.dsh` 同时覆盖 `>=0.2.1-rc.5 <0.3.0` 与 0.2.2 预发布线（`>=0.2.2-0 <0.3.0`）；slot 实际渲染仍需在 DSH Web UI 实测。
## 许可 / License

- © 2026 PerryLink。本项目是非官方项目，与 DeepSeek 无关联。
- 代码：**PolyForm Noncommercial 1.0.0**（`LICENSE`；SPDX `PolyForm-Noncommercial-1.0.0`）。source-available，**不是 OSI 开源**；商业使用需另行取得书面许可。
- 美术：**CC BY-NC-SA 4.0**（`LICENSE-ART`；SPDX `CC-BY-NC-SA-4.0`），覆盖本包实际分发的 `client.anims.*.js` 内嵌角色动画帧与 `icon.png`（汀岚 / 布偶猫 / 金毛 pixel art，源自 `PerryLink/famling`）。
- 再分发必须携带 `LICENSE`、`LICENSE-ART`、`NOTICE`；署名、修改说明与非官方声明要求见 `LICENSE-ART` §3。
- 第三方素材：本包不打包第三方美术/字体/音频；浏览器 TTS/ASR、模型服务与 DSH 宿主按各自条款（边界见 `docs/LEGAL-NOTICE-2026-11-18.md`）。
- 许可方向由项目 owner 于 2026-11-16 决定；许可文本是项目声明（DRAFT，未经律师审核），不是法律意见。

## 限制

- 仅本地小 widget，不是完整 famling；完整应用见 `PerryLink/famling`。
- 内容中心是**角色主题 + 组件覆盖**，不是可编程主题引擎；不加载 pack、不加载资产、不联网。
- 远程市场只有占位 UI 与预留字段，没有服务器、没有商品、没有网络请求；不要把它当作已上线市场。
- `origami` 角色 bundle 仅是数据预留（无动画/素材 chunk），UI 不提供一键应用。
- Host 聊天人格随形象切换（0.8.1）：人格差异只体现在 system prompt，安全边界与 AI 声明不变；切换形象只影响之后的聊天请求，不会改写正在进行或已生成的回复。模型选择仍由 DSH 默认模型选择/插件 Config 决定。
- 动画包标注为 placeholder（非最终美术，非商业授权），与插件整体 PolyForm Noncommercial 许可一致。
- 不是官方 DeepSeek 项目；不使用 DeepSeek 官方 logo/字标。
- 插件不保存个人数据；点击计数不持久化。
