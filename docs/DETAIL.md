# Famling · 汀岚

在 DSH 左侧栏左下角、账号信息下方显示一个小型 famling 桌宠入口。**0.10.0 起，角色就是主题**：内容中心一级分类固定为 角色 / 自定义 / 内容包 / 市场。

- 显示 72px 像素桌宠：汀岚 / 塞尔凯克卷毛猫（卷毛灰白） / 金毛，台词、动作与聊天人格随形象变化。
- 动画：每角色 12 clip，帧数按 manifest（dog 68 / cat 72 / human 68，共 208 帧；clip：idle 循环、idle_blink 眨眼、pat_head、ball_throw、ball_chase、paw_face、scratch、stand_wag、chase_tail、walk、run、attack），随机微动作只取本形象的 clip。
- 动画按角色懒加载（0.8.6）：入口 client.js 不再内嵌三套 base64；首次显示 human/cat/dog 时通过 DSH `require.async` 拉取 `client.anims.<kind>.js`。0.10.0 实测：入口 **66.1 KiB**（gzip 18.9 KiB；首屏预算 0.9.1 由 64 KiB 调到 72 KiB，0.10.0 未再上调，仍 < 拆分前审计基线 25%）、首帧约 127.9 KiB、全量约 313.5 KiB；chunk sha256 进入 embed/verify 门禁。
- 内容中心 UI 按需加载（0.10.0）：`client.content.js` 是包内懒加载 chunk（24.3 KiB，gzip 7.7 KiB），只在用户首次点「内容」时通过 `require.async('./client.content.js')` 拉取；角色卡不预加载任何角色动画 chunk。
- 帧时长（0.8.4）：每帧停留时间读 manifest `holdMs`（缺省 1000/fps），非循环 clip 播完后按 `durationMs`/hold 总和回到 idle；cat 伸懒腰 10 帧 / 3200ms 按 300/300/300/350/400/400/400/350/250/150 逐帧播放。
- 点击区域（0.8.2）：点击人物头部/身体/尾巴分别触发 pat_head/stand_wag/chase_tail；区域来自与独立 famling 共用的 `regions.json`（96×96 逻辑画布 + idle gating），非 idle/idle_blink 状态或空白区域不动作，不回退随机动作。
- 随机回话（0.8.3）：每条区域规则与每个互动动作都带 `says` 数组，命中时随机挑一条且连续两次不会重复；气泡文案全量来自共用 `regions.json`。
- 物种专属互动（0.8.3）：互动菜单由 `ANIMS[character].actions` 数据驱动——汀岚 摸头/递纸/挥手/整理蝴蝶结/聊两句；塞尔凯克卷毛猫 摸头/伸懒腰/洗脸/追尾巴/跑一跑；金毛 摸头/丢球·捡球/捡球/追尾巴/跑一跑（丢球后 500ms 接追球）。猫/人没有球类动作。
- 点击展开本地小面板：输入 / 互动 / 设置 / 内容；互动按钮跑本角色真实存在的 clip，仅本地 UI 状态，不调用模型、不上传数据。
- 聊天人格随形象切换（0.8.1）：输入面板的 `op:"chat"` 请求带当前 `character`（`human`/`cat`/`dog`，缺省或非法回退 `human`）；Host 用 `PERSONAS` 选 system prompt。三条人格共用安全边界：不冒充真人/官方/专业顾问，不诱导依赖/恋爱/付费/未成年人关系，不输出违法/隐私。
- 语音规则：汀岚可用浏览器 TTS（独立同意）；塞尔凯克卷毛猫/金毛只用空心 thought 气泡，永不调用 `speechSynthesis`。
- 内容中心（0.10.0）：角色 / 自定义 / 内容包 / 市场 四个一级 tabs；设置页只保留「内容与角色…」入口与其它设置项。切换即时生效、不刷新页面，不改 DSH 全局主题。
- 内容扩展接口（0.10.0，预留 v3）：`content-extension.mjs` 导出 `CONTENT_EXTENSION_POINTS`（七类 kind，含 role）、`validateContentPack`、`CONTENT_PACK_EXAMPLE`；纯数据契约，不联网 / 不执行 pack 脚本 / 不注入 HTML / 不加载资产；所有 pack 强制 `usageDeclaration`；本版本不加载任何 pack。
- 不宣传 roleplay；不替代独立 famling 应用。

限制：这是 DSH 客户端插件，不是完整桌宠；完整可执行版在 `PerryLink/famling`。

## 最终界面结构

- 左侧 72px 人物。
- 右侧竖排：输入 / 互动 / 设置 / 内容。
- 输入：右侧文本框 + 语音输入按钮；DSH/Advisers Host 桥接预留；聊天请求带当前形象，Host 据此切换人格。
- 互动：按当前形象渲染物种专属动作（数据来自 `regions.json` actions），点击后跑对应 clip + 随机回话（金毛丢球→追球）；点击人物按头/身/尾区域触发对应动作并从该区域 says 随机回话，空白区域不动作。
- 设置：**内容与角色…** 一行入口（打开内容中心）、帧动画、说话气泡、Advisers 摘要；不再放形象/语音/对话按钮。
- 内容（0.10.0）：打开角色=主题的内容中心，四个一级 tabs；详见下节。
- 气泡：默认白底 #ffffff / 深色 #111111 字 / 灰色实线或虚线边框（内容中心可切 paper / night 主题）；汀岚实心 speech（可用 TTS），猫/狗空心 thought（永不 TTS）；每次点击从对应 says 随机取一句，不遮挡人物。
- 动画数据与点击区域数据由 `scripts/embed-anims.mjs` 生成，勿手改 `client.js` 生成块；`scripts/verify-anims.mjs` + `scripts/qa/index.html` 可脱离 DSH 校验/预览。

## 内容中心：角色就是主题（0.10.0）

人物右侧第 4 个按钮「内容 / Content」打开与设置同级的懒加载面板（`client.content.js`）。角色/声音/对话/主题/背景/字体不再是一级并列主视觉：一个**角色 bundle** 同时包含 character、voicePolicy、dialogue、theme、background、font；点「一键应用」= 原子地应用六个组件。全部为本地 React state + localStorage，切换即时生效、不刷新页面。

### 一级 tabs

| Tab | 内容 | 持久化 / 行为 |
|---|---|---|
| 角色 | 汀岚 / 塞尔凯克卷毛猫 / 金毛三张角色卡（glyph 头像 + 名称 + 一句说明 + 声音/对话/外观摘要 + 「一键应用」+ ✓ 当前标记） | 一键应用同时设置 character、voice(TTS 策略)、dialogue mode、theme/background/font，并写 `dsh-famling/role`；角色卡不预加载其它角色动画 chunk；origami 仅数据预留，素材未安装，不出卡片。 |
| 自定义 | 声音 / 对话 / 主题 / 背景 / 字体分组紧凑控件（保留 0.9.1 能力：TTS 开关与浏览器 voiceURI、standard/brief/quiet、default/paper/night、transparent/paper/dark、system/serif/mono + 字号/行高） | 顶部说明「仅修改当前角色的搭配，不改变角色预设」并显示「角色预设 / 已自定义」；组件改动只写对应旧键，角色 id 不变；「恢复角色默认」按当前角色 bundle 重置全部组件。 |
| 内容包 | 已安装内容（当前只有内置包）、v3 声明检查状态、资产包导入入口（需 Host 支持） | 显示内置 4 bundle 包与「没有导入的外部内容包」；声明检查：researchOnly=true + 六项禁止用途；资产包 zip/文件夹清单 + sha256 由 Host 解析，本版本不读取文件、不执行脚本、不加载素材、不联网。 |
| 市场 | 远程市场占位与接口说明 | 固定显示「远程市场接口已预留，服务器未配置」；展示预留 `catalogUrl` / `configKey` 字段（`dsh-famling/market/catalog` / `dsh-famling.market`）；不发起网络请求、不展示伪造商品。 |

### 角色 bundle 与回填

| role | character | 声音策略 | 对话 | theme / background / font |
|---|---|---|---|---|
| human | 汀岚 | speech，可浏览器 TTS（仍受独立同意） | standard | default / transparent / system |
| cat | 塞尔凯克卷毛猫 | thought，永不 TTS | brief | paper / paper / serif |
| dog | 金毛 | thought，永不 TTS | standard | night / dark / mono |
| origami | 预留 | thought，永不 TTS | quiet | paper / transparent / serif（数据预留，不可应用） |

持久化键（全部沿用 0.9.x，新增 role）：

- `dsh-famling/role`：当前角色主题（primary）。
- `dsh-famling/character`：当前形象（human/cat/dog）。
- `dsh-famling/settings`：sound / motion / bubble / voiceURI。
- `dsh-famling/dialogue`：standard / brief / quiet。
- `dsh-famling/theme`：default / paper / night。
- `dsh-famling/background`：transparent / paper / dark。
- `dsh-famling/font`（JSON）：family / size / lineHeight。

应用角色 = 一次写六个组件键 + role；自定义 = 只覆盖单个组件键，role 仍记录“角色 + 覆盖”。加载顺序：读 role；没有时从已存 character 反推；缺失组件用该角色 bundle 回填，显式组件键优先（0.9.x 升级用户首次渲染即获得回填）。TTS 开关仍受独立同意门禁：bundle 只设置策略，未同意时保持关闭；切到猫/狗取消正在朗读的语音。

### 懒加载与预算

入口 `client.js` 66.1 KiB（gzip 18.9 KiB）< 72 KiB 首屏预算；内容中心 UI `client.content.js` 24.3 KiB（gzip 7.7 KiB）首次打开才下载；三个角色动画 chunk 仍只在显示对应角色时下载。DSH 模块表通过包内相对 chunk 名 `client.content.js` 解析，不走网络/CDN；chunk 失败时客户端显示本地「内容中心加载失败」面板，核心互动不受影响。

## 内容扩展接口 CONTENT_EXTENSION_POINTS v3（预留）

公开契约：[content-extension.mjs](../content-extension.mjs)（package export：`dsh-famling/content-extension`）。`version: 3`（pack `schemaVersion: 3`）、`status: "reserved"`：schema 已发布，本版本没有任何 pack 加载器。

导出：

- `CONTENT_EXTENSION_POINTS`：version / status / transport（`network:false, execute:false, innerHTML:false, worker:false, assets:false`）/ pack schema（schemaVersion、fields、optionalFields、sources、limits、idPattern、versionPattern、usageDeclaration、assets、remoteCatalog）/ entry schema（**七类 kinds**：role / character / voice / dialogue / theme / background / font；fields、roleFields、idPattern、preview 类型与路径策略、permissions、各 kind 的 apply 形状、role 的六组件与 compatibility、本地字体栈策略）/ validation。
- `validateContentPack(pack, { allowRemote? }) → { ok, errors }`：纯数据校验，不抛异常、不执行、不解析 URL、不读文件、不联网。
- `CONTENT_PACK_EXAMPLE`：合法 v3 示例 pack（完整 usageDeclaration + 一个 role bundle + 一个 theme entry）。
- `PROHIBITED_USES` / `USAGE_DECLARATION_TEMPLATE`：六项禁止用途的 canonical 列表与声明模板。

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

- 纯数据：函数 / symbol / bigint / undefined / 非 plain object / 非有限数一律拒绝；未知字段一律拒绝（pack、entry、preview、apply、usageDeclaration、assets、remoteCatalog）。
- 长度：JSON ≤ 65536 字节；entries ≤ 32（每 kind ≤ 16）；id ≤ 64；name ≤ 64；description ≤ 240；文本 ≤ 280；预览文本 ≤ 120；变量 ≤ 24；变量值 ≤ 80；权限 ≤ 8；嵌套深度 ≤ 8；数组/对象规模有上限。
- 枚举：kind ∈ role|character|voice|dialogue|theme|background|font；source ∈ bundled|local|remote；permission ∈ apply:role|select:character|select:voice|select:dialogue|apply:theme|apply:background|apply:font|store:selection（entry 必须含本 kind 对应权限）；preview.kind ∈ glyph|text|color|image；dialogue apply.mode ∈ standard|brief|quiet；background apply.kind ∈ transparent|color；theme 变量名必须匹配 `^--dsh-famling-[a-z0-9-]{1,32}$`。
- 路径：image preview 相对路径、≤3 段、无 `..`、无绝对路径/盘符/URL scheme/反斜杠、≤160 字符且以 .png/.webp/.jpg 结尾；asset path 见上。
- CSS：变量值只接受 hex / rgb() rgba() hsl() hsla() / 2–24 位字母关键字，拒绝 url()、expression()、`@import`、分号、尖括号与控制字符。
- 背景/字体：background 的 kind=color 必须有安全颜色 value，kind=transparent 不得带 value；font.family 必须是 1..8 个不带引号的本地字体名（字母/数字/空格/点/下划线/连字符，≤200 字符），size 为 10..24 的整数，lineHeight 为 1..2.5 的有限数；拒绝引号、url()、var()、分号、花括号与 `@` 规则等任何 CSS 注入。
- 原型污染：任何层级出现 `__proto__` / `constructor` / `prototype` 均拒绝。
- 重复：同一 (kind,id) / 同一 asset path 重复拒绝；entry.source 必须与 pack.source 一致；role compatibility 的 min 不得大于 max。

未来加载器的硬约束：不 eval / 不 new Function / 不执行 pack 脚本 / 不 innerHTML / 不加载远程字体与样式表 / 不自动解包资产；只读取上述纯数据字段，由 Host 侧解析与校验后交给 UI 渲染。

### 与独立 famling 共享模型（famling.content/0.1）的关系

独立 famling 仓另有内容目录规范 `famling.content/0.1`（`public/content/README.md`、`src/pet/content-library.ts`），是目标超集；dsh-famling 0.10.0 的七类 kind 可与其目录映射：role 是 v3 新增的角色主题 bundle（character + voicePolicy + dialogue + theme + background + font 的组合），其余六类仍一一映射（characters ↔ character、voices ↔ voice、dialoguePacks ↔ dialogue、themes ↔ theme、backgrounds ↔ background、fonts ↔ font；`builtin` ≡ `bundled`）。差异仍然存在：插件契约把“选择/应用”建模为 `apply` + permissions，共享模型是目录条目 + 解析函数；主题 CSS 前缀分别为 `--dsh-famling-*` / `--famling-content-*`；插件背景只支持纯色/透明（无 pattern/图片）、字体只支持本地字体栈；插件声音来自浏览器 `speechSynthesis`，共享目录是 DeepSeek stella/tide，二者不能互相覆盖；两个校验器返回结构不同（插件 `{ ok, errors: string[] }`）。两套契约并存、各自 fail-closed；未来收敛通过适配层把共享目录六类内置内容投影为插件 entry（保留 0.9.x/0.10.x 存储键与 UI），不直接加载共享 pack。

## 使用限制（canonical，必读）

> 本项目及其全部代码、美术、音频、文案、角色素材和衍生物仅用于技术研究与原型验证，不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途。

- 完整说明与短句 SHA-256：`docs/LEGAL-NOTICE-2026-11-18.md` §0；canonical 源为 famling 仓 `desktop-games/docs/legal/USE-RESTRICTIONS-2026-11-19.md`。
- 本插件不是情感陪伴/虚拟伴侣产品；禁止冒充真人或官方、对外服务运营、删除/伪造 AI 标识、绕过 TTS/ASR 同意或其它安全门禁。
- 内容包 v3 的 `usageDeclaration` 与上述 canonical 限制对齐：所有 pack 必须声明仅用于研究/原型，并禁止情感陪伴、虚拟伴侣、专业建议、未成年人亲密、冒充真人/官方与违法用途；缺失或非法声明一律拒绝。
