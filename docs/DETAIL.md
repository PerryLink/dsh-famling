# Famling · 汀岚

在 DSH 左侧栏左下角、账号信息下方显示一个小型 famling 桌宠入口。

- 显示 72px 像素桌宠：汀岚 / 塞尔凯克卷毛猫（卷毛灰白） / 金毛，台词、动作与聊天人格随形象变化。
- 动画：每角色 12 clip，帧数按 manifest（dog 68 / cat 72 / human 68，共 208 帧；clip：idle 循环、idle_blink 眨眼、pat_head、ball_throw、ball_chase、paw_face、scratch、stand_wag、chase_tail、walk、run、attack），随机微动作只取本形象的 clip。
- 动画按角色懒加载（0.8.6）：入口 client.js 不再内嵌三套 base64；首次显示 human/cat/dog 时通过 DSH `require.async` 拉取 `client.anims.<kind>.js`，入口约 69.0 KiB（0.9.1 内容中心六分类加入后，gzip 19.6 KiB；首屏预算 0.9.1 由 64 KiB 调到 72 KiB，仍 < 拆分前审计基线 25%）、首帧约 130.7 KiB、全量约 316.3 KiB；chunk sha256 进入 embed/verify 门禁。
- 帧时长（0.8.4）：每帧停留时间读 manifest `holdMs`（缺省 1000/fps），非循环 clip 播完后按 `durationMs`/hold 总和回到 idle；cat 伸懒腰 10 帧 / 3200ms 按 300/300/300/350/400/400/400/350/250/150 逐帧播放，不是固定 fps 快放。
- 点击区域（0.8.2）：点击人物头部/身体/尾巴分别触发 pat_head/stand_wag/chase_tail；区域来自与独立 famling 共用的 `regions.json`（96×96 逻辑画布 + idle gating），非 idle/idle_blink 状态或空白区域不动作，不回退随机动作。
- 随机回话（0.8.3）：每条区域规则与每个互动动作都带 `says` 数组，命中时随机挑一条且连续两次不会重复；气泡文案全量来自共用 `regions.json`，不手写重复台词。
- 物种专属互动（0.8.3）：互动菜单由 `ANIMS[character].actions` 数据驱动——汀岚 摸头/递纸/挥手/整理蝴蝶结/聊两句；塞尔凯克卷毛猫 摸头/伸懒腰/洗脸/追尾巴/跑一跑；金毛 摸头/丢球·捡球/捡球/追尾巴/跑一跑（丢球后 500ms 接追球）。猫/人没有球类动作。
- 点击展开本地小面板：输入 / 互动 / 设置 / 内容；互动按钮跑本角色真实存在的 clip，仅本地 UI 状态，不调用模型、不上传数据。
- 聊天人格随形象切换（0.8.1）：输入面板的 `op:"chat"` 请求带当前 `character`（`human`/`cat`/`dog`，缺省或非法回退 `human`）；Host 用 `PERSONAS` 选 system prompt——汀岚安静简洁工作搭子、塞尔凯克卷毛猫（卷毛灰白）懒散高冷短句（轻微傲娇但不冒犯）、金毛友善热情简单直接。三条人格共用安全边界：不冒充真人/官方/专业顾问，不诱导依赖/恋爱/付费/未成年人关系，不输出违法/隐私。
- 语音规则：汀岚可用浏览器 TTS（独立同意）；塞尔凯克卷毛猫/金毛只用空心 thought 气泡，永不调用 `speechSynthesis`。
- 内容中心（0.9.1）：角色 / 声音 / 对话 / 主题 / 背景 / 字体六类集中在人物右侧第 4 个「内容」按钮打开的面板，与设置同级；设置页只保留「内容与角色…」入口与其它设置项。切换即时生效、不刷新页面，不改 DSH 全局主题。
- 内容扩展接口（0.9.1，预留 v2）：`content-extension.mjs` 导出 `CONTENT_EXTENSION_POINTS`（六类 kind：character / voice / dialogue / theme / background / font）、`validateContentPack`、`CONTENT_PACK_EXAMPLE`；纯数据契约，不联网 / 不执行 pack 脚本 / 不注入 HTML；本版本不加载任何 pack。
- 不宣传 roleplay；不替代独立 famling 应用。

限制：这是 DSH 客户端插件，不是完整桌宠；完整可执行版在 `PerryLink/famling`。

## 最终界面结构

- 左侧 72px 人物。
- 右侧竖排：输入 / 互动 / 设置 / 内容。
- 输入：右侧文本框 + 语音输入按钮；DSH/Advisers Host 桥接预留；聊天请求带当前形象，Host 据此切换人格。
- 互动：按当前形象渲染物种专属动作（数据来自 `regions.json` actions），点击后跑对应 clip + 随机回话（金毛丢球→追球）；点击人物按头/身/尾区域触发对应动作并从该区域 says 随机回话，空白区域不动作。
- 设置：**内容与角色…** 一行入口（打开内容中心）、帧动画、说话气泡、Advisers 摘要；不再放形象/语音/对话按钮。
- 内容（0.9.1）：打开内容中心，分类 角色 / 声音 / 对话 / 主题 / 背景 / 字体；形象持久化到 `dsh-famling/character`，声音选择在 `dsh-famling/settings`（`voiceURI`），对话模式在 `dsh-famling/dialogue`，主题在 `dsh-famling/theme`，背景在 `dsh-famling/background`，字体/字号/行高在 `dsh-famling/font`（JSON）。
- 气泡：默认白底 #ffffff / 深色 #111111 字 / 灰色实线或虚线边框（内容中心可切 paper / night 主题）；汀岚实心 speech（可用 TTS），猫/狗空心 thought（永不 TTS）；每次点击从对应 says 随机取一句，不遮挡人物。
- 动画数据与点击区域数据由 `scripts/embed-anims.mjs` 生成，勿手改 `client.js` 生成块；`scripts/verify-anims.mjs` + `scripts/qa/index.html` 可脱离 DSH 校验/预览。

## 内容中心（0.9.1）

人物右侧第 4 个按钮「内容 / Content」打开与设置同级的面板；设置页只保留「内容与角色…」入口。全部为本地 React state + localStorage，切换即时生效、不刷新页面。

| Tab | 内置内容 | 持久化 | 行为 |
|---|---|---|---|
| 角色 | 汀岚 / 塞尔凯克卷毛猫 / 金毛 | `dsh-famling/character` | 卡片 = glyph 头像 + 名称 + 一句说明 + 当前标记；点击即时换 72px 帧动画、气泡/TTS 策略、聊天人格（chat 请求带 character）。卡片不预加载另外两个动画 chunk，保持懒加载。 |
| 声音 | 浏览器 speechSynthesis 声音 | `dsh-famling/settings.voiceURI` | 仅 human 显示 TTS 开关（独立同意）与 `getVoices()` 列表；朗读时 `utterance.voice` = 选中声音；猫/狗显示「思考气泡，无语音」，永不调用 TTS。 |
| 对话 | standard / brief / quiet | `dsh-famling/dialogue` | standard 原样；brief 截断 >90 字回话并以 `…` 结尾；quiet 仅约 35% ambient 气泡（区域/动作/微动作），direct（聊天回复、系统错误）始终显示。says 仍来自嵌入 `regions.json`。 |
| 主题 | default / paper / night | `dsh-famling/theme` | 以 widget 根节点 CSS 变量应用：`--dsh-famling-bubble-bg` / `-bubble-text` / `-bubble-border` / `-bubble-thought-border` / `-panel-bg` / `-panel-text` / `-panel-border` / `-accent`；气泡与面板读取 `var(...)`；无网络字体。default 仍为白底 `#ffffff` + 深色 `#111111`。 |
| 背景 | transparent / paper / dark | `dsh-famling/background` | 纯 CSS 背板：`transparent`（默认，不画）/ `paper` `#f6f1e7` / `dark` `#14161a`；只作用于 widget 背板，并给气泡/面板加同色 `--dsh-famling-widget-bg` 外圈；不修改 DSH 全局主题、不加载图片/渐变/网络资源。 |
| 字体 | system / serif / mono + 字号 11/12/14px + 行高 1.4/1.5/1.8 | `dsh-famling/font`（JSON） | 本地安全字体栈（system-ui / Georgia 系 / ui-monospace 系），无网络字体；字体族、字号、行高通过 `--dsh-famling-font-family` / `--dsh-famling-font-size` / `--dsh-famling-line-height` 应用到面板与气泡。 |

## 内容扩展接口 CONTENT_EXTENSION_POINTS（预留）

公开契约：[content-extension.mjs](../content-extension.mjs)（package export：`dsh-famling/content-extension`）。`version: 2`（pack `schemaVersion: 2`）、`status: "reserved"`：schema 已发布，本版本没有任何 pack 加载器。

导出：

- `CONTENT_EXTENSION_POINTS`：version / status / transport（`network:false, execute:false, innerHTML:false, worker:false`）/ pack schema（schemaVersion、fields、sources、limits、idPattern、versionPattern）/ entry schema（**六类 kinds**：character / voice / dialogue / theme / background / font；fields、idPattern、preview 类型与路径策略、permissions、各 kind 的 apply 形状、本地字体栈策略）/ validation。
- `validateContentPack(pack, { allowRemote? }) → { ok, errors }`：纯数据校验，不抛异常、不执行、不解析 URL。
- `CONTENT_PACK_EXAMPLE`：合法示例 pack。

entry 字段（除 description 外均必需）：kind / id / name / preview / apply / source / permissions / version。示例：

```json
{
  "schemaVersion": 2,
  "id": "com.example.warm-pack",
  "name": "Warm Example",
  "version": "1.0.0",
  "source": "local",
  "permissions": ["apply:theme", "store:selection"],
  "entries": [
    {
      "kind": "theme",
      "id": "warm",
      "name": "Warm",
      "version": "1.0.0",
      "source": "local",
      "preview": { "kind": "color", "value": "#ffcc00" },
      "permissions": ["apply:theme", "store:selection"],
      "apply": { "variables": { "--dsh-famling-bubble-bg": "#fff3cd", "--dsh-famling-bubble-text": "#3b2f24" } }
    }
  ]
}
```

其它 kind 的 `apply` 数据形状：

- `background`：`{ "kind": "transparent" }` 或 `{ "kind": "color", "value": "#f6f1e7" }`（安全颜色）。
- `font`：`{ "family": "Georgia, serif", "size": 14, "lineHeight": 1.6 }`（family 必填，size/lineHeight 可选）。

校验规则（`validateContentPack`）：

- 纯数据：函数 / symbol / bigint / undefined / Date 等非 plain object / 非有限数一律拒绝；未知字段一律拒绝（pack、entry、preview、apply）。
- 长度：JSON ≤ 65536 字节；entries ≤ 32（每 kind ≤ 16）；id ≤ 64；name ≤ 64；description ≤ 240；文本 ≤ 280；预览文本 ≤ 120；变量 ≤ 24；变量值 ≤ 80；权限 ≤ 8；嵌套深度 ≤ 8；数组/对象规模有上限。
- 枚举：kind ∈ character|voice|dialogue|theme|background|font；source ∈ bundled|local|remote；permission ∈ select:character|select:voice|select:dialogue|apply:theme|apply:background|apply:font|store:selection（entry 必须含本 kind 对应权限）；preview.kind ∈ glyph|text|color|image；dialogue apply.mode ∈ standard|brief|quiet；background apply.kind ∈ transparent|color；theme 变量名必须匹配 `^--dsh-famling-[a-z0-9-]{1,32}$`。
- 路径：image preview 必须相对路径、≤3 段、无 `..`、无绝对路径/盘符/URL scheme/反斜杠、≤160 字符且以 `.png/.webp/.jpg` 结尾。
- CSS：变量值只接受 hex / `rgb()` `rgba()` `hsl()` `hsla()` / 2–24 位字母关键字，拒绝 `url()`、`expression()`、`@import`、分号、尖括号与控制字符。
- 背景/字体：`background` 的 `kind=color` 必须有安全颜色 `value`，`kind=transparent` 不得带 `value`；`font.family` 必须是 1..8 个不带引号的本地字体名（字母/数字/空格/点/下划线/连字符，≤200 字符），`size` 为 10..24 的整数，`lineHeight` 为 1..2.5 的有限数；拒绝引号、`url()`、`var()`、分号、花括号与 @ 规则等任何 CSS 注入。
- 原型污染：任何层级出现 `__proto__` / `constructor` / `prototype` 均拒绝。
- 远程：`source: "remote"` 默认拒绝；未来启用网络的 Host 需显式 `{ allowRemote: true }`，加载器必须自己做网络隔离、校验与缓存——本包不会 fetch 任何 pack URL。
- 重复：同一 (kind,id) 重复拒绝；entry.source 必须与 pack.source 一致。

未来加载器的硬约束：不 eval / 不 new Function / 不执行 pack 脚本 / 不 innerHTML / 不加载远程字体与样式表；只读取上述纯数据字段，由 Host 侧解析与校验后交给 UI 渲染。

### 与独立 famling 共享模型（famling.content/0.1）的关系

独立 famling 仓另有内容目录规范 `famling.content/0.1`（`public/content/README.md`、`src/pet/content-library.ts`），是目标超集；dsh-famling 0.9.1 的六类 kind 可与其六类目录一一映射：characters ↔ character、voices ↔ voice、dialoguePacks ↔ dialogue、themes ↔ theme、backgrounds ↔ background、fonts ↔ font；`builtin` ≡ `bundled`。差异仍然存在：插件契约把“选择/应用”建模为 `apply` + permissions，共享模型是目录条目 + 解析函数；主题 CSS 前缀分别为 `--dsh-famling-*` / `--famling-content-*`；插件背景只支持纯色/透明（无 pattern/图片）、字体只支持本地字体栈；插件声音来自浏览器 `speechSynthesis`，共享目录是 DeepSeek stella/tide，二者不能互相覆盖；两个校验器返回结构不同（插件 `{ ok, errors: string[] }`）。两套契约并存、各自 fail-closed；未来收敛通过适配层把共享目录六类内置内容投影为插件 entry（保留 0.9.x 存储键与 UI），不直接加载共享 pack。

## 使用限制（canonical，必读）

> 本项目及其全部代码、美术、音频、文案、角色素材和衍生物仅用于技术研究与原型验证，不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途。

- 完整说明与短句 SHA-256：`docs/LEGAL-NOTICE-2026-11-18.md` §0；canonical 源为 famling 仓 `desktop-games/docs/legal/USE-RESTRICTIONS-2026-11-19.md`。
- 本插件不是情感陪伴/虚拟伴侣产品；禁止冒充真人或官方、对外服务运营、删除/伪造 AI 标识、绕过 TTS/ASR 同意或其它安全门禁。
