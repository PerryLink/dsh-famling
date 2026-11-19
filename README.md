# dsh-famling

> ⚠️ **使用限制（必读）**：本项目及其全部代码、美术、音频、文案、角色素材和衍生物**仅用于技术研究与原型验证**；**不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途**。完整说明见 [docs/LEGAL-NOTICE-2026-11-18.md](docs/LEGAL-NOTICE-2026-11-18.md)。

Famling / 汀岚 的 DSH 兼容版：在 DeepSeek Harness 左侧栏**左下角、账号信息下方**显示一个小型研究/技术演示入口（不是情感陪伴产品）。

## 两个包

本工作线提供两个包，按用途分开：

| 包 | 来源 | 用途 |
|---|---|---|
| **famling** | [PerryLink/famling](https://github.com/PerryLink/famling) | **独立运行的完整桌宠**（pet-only Tauri app；汀岚/猫/狗、UI、TTS、年龄核验等） |
| **dsh-famling** | 本仓 | **DSH 客户端插件**；只提供左下角小型汀岚入口与本地小互动，不替代独立 app |

> `famling` 是独立应用；`dsh-famling` 是放在 DSH 里的轻量伴随入口。两者共享角色/品牌，不共享运行时代码。

## 当前实现（0.10.0）

- slot：`sidebar.footer.action`（DSH 侧栏账号信息下方的 footer 区域）。
- 最终交互结构：人物右侧竖排 **输入 / 互动 / 设置 / 内容** 四个按钮；点击人物的头/身体/尾巴分别触发按区域反应（0.8.2），互动菜单按当前形象渲染物种专属动作并随机挑一句回话（0.8.3，见下）。第 4 个「内容」按钮打开**角色 = 主题**的内容中心（0.10.0，四个一级分类：角色 / 自定义 / 内容包 / 市场）。
- **72px 像素桌宠**（96×96 帧按 `image-rendering: pixelated` 显示为 72px），可切换 **汀岚 / 塞尔凯克卷毛猫（卷毛灰白） / 金毛** 三个形象；点击头部/身体/尾巴分别触发摸头/摇尾/追尾，点击透明或未声明区域不动作。
- 待机是真正的帧动画：3 个角色各 12 clip（帧数按 manifest：dog 68 / cat 72 / human 68，共 208 帧）；`idle` 循环 + `idle_blink` 眨眼替换 + 随机微动作（`paw_face` / `scratch` / `stand_wag` / `chase_tail`）；每帧时长读 manifest 的 `holdMs`（缺省 1000/fps），非循环 clip 按 `durationMs`/hold 总和结束（0.8.4）。
- 输入面板：人物右侧展开文本框 + 语音输入按钮（浏览器 SpeechRecognition），预留 `window.__DSH_FAMLING_BRIDGE__` 给 DSH/Advisers Host。
- 互动面板（0.8.3）：直接读嵌入的 `ANIMS[character].actions`（来自与独立 famling 共用的 `regions.json`），按形象渲染物种专属动作——汀岚：摸头 / 递纸 / 挥手 / 整理蝴蝶结 / 聊两句；塞尔凯克卷毛猫：摸头 / 伸懒腰 / 洗脸 / 追尾巴 / 跑一跑；金毛：摸头 / 丢球·捡球 / 捡球 / 追尾巴 / 跑一跑（丢球后 500ms 自动接追球）。猫和人没有球类/捡球动作，绝不会把 A 角色的动作放到 B 角色身上。
- 内容中心（0.10.0）：**角色就是主题**。一级 tabs 只有 **角色 / 自定义 / 内容包 / 市场**；角色卡展示角色名、一句说明、声音 / 对话 / 外观摘要，点击「一键应用」同时设置 character、voice(TTS 策略)、dialogue mode、theme/background/font，并写入 `dsh-famling/role`；自定义页在选中角色基础上逐项覆盖并支持「恢复角色默认」；内容包页只展示内置内容、声明检查与预留导入接口；市场页只显示「远程市场接口已预留，服务器未配置」，不联网、不伪造商品。内容中心 UI 本身是懒加载的包内 chunk `client.content.js`（首次打开才下载，不预加载任何角色动画 chunk）。
- 设置（0.10.0）：只保留一行 **内容与角色…** 入口（打开内容中心）以及帧动画、说话气泡、Advisers 摘要等其它设置；角色/声音/对话/主题/背景/字体全部移入内容中心。持久化沿用旧键：`dsh-famling/character`、`dsh-famling/settings`（`voiceURI`）、`dsh-famling/dialogue`、`dsh-famling/theme`、`dsh-famling/background`、`dsh-famling/font`，并新增 `dsh-famling/role` 记录当前角色主题；加载时用角色 bundle 回填缺失组件，显式组件键优先。
- 气泡（0.8.3）：点击区域或动作时，从该区域/动作自己的 `says` 数组随机挑一句（同一位置连续点击不会重复同一句）；**汀岚**的台词是实心 speech 气泡，可配合浏览器 TTS（保留原有独立同意）；**塞尔凯克卷毛猫（卷毛灰白）/金毛**只用空心 thought 气泡，永不调用 `speechSynthesis`，内容中心的声音区对它们只显示「思考气泡，无语音」；切到猫/狗时若正在朗读会立即停止。气泡默认白底 `#ffffff`、深色 `#111111` 字、灰色实线/虚线边框（内容中心可切 paper / night 主题），不常驻、不遮挡人物。
- 聊天人格随形象切换（0.8.1）：输入面板的聊天请求会带当前形象（`human`/`cat`/`dog`，缺省 `human`）；Host 按形象选择 system prompt，切猫/狗后回复语气随之变化。
- 输入面板的 LLM/TTS/ASR/记忆需要 Host 桥接；未接入时如实提示，不伪造回复。
- 不宣传 roleplay；不包含完整桌宠/游戏基座。
- 无 roleplay 公开入口；网络请求仅限同源 `/api/famling/bridge`（DSH Host 路由）。内容包/资产包/远程市场均不加载、不联网。

## 多角色动画数据（0.8.0）

三套 96×96 像素动画包（各 12 clip；帧数按 manifest：dog 68 / cat 72 / human 68，共 208 帧）按角色拆成懒加载 chunk（0.8.6）：入口 `client.js` **66.1 KiB**（0.10.0 实测；gzip 18.9 KiB，仍 < 72 KiB 首屏预算，也远低于拆分前 314.8 KiB 基线），`client.anims.human.js`/`cat`/`dog` 在首次显示对应角色时才由 DSH `require.async` 拉取；首帧约 127.9 KiB，全部角色加载后才约 313.5 KiB。0.10.0 新增的 `client.content.js` 内容中心 UI 也只在首次打开「内容」时下载（24.3 KiB，gzip 7.7 KiB）：

- 数据源：私有仓 `desktop-games/public/assets/pet/anim/{human,cat,dog}/`（`manifest.json` + 帧 PNG）。
- 生成器：`scripts/embed-anims.mjs` —— 读取 manifest/PNG、校验三套 clip 契约、把 RGBA 帧**无损**重编码为最小位深索引 PNG（硬 alpha 保留，体积约减半），再按 marker 注入 `client.js`。**禁止手改生成块**，改数据重跑脚本即可。
- 体积（0.10.0 实测）：源 351.6 KiB → 入口 `client.js` 66.1 KiB（gzip 18.9 KiB）；3 个角色 chunk 合计约 247 KiB（human 61.7 / cat 108.0 / dog 77.6 KiB）；内容中心 chunk 24.3 KiB 按需加载。首屏预算仍为 72 KiB（0.9.1 由 64 KiB 调到 72 KiB），0.10.0 未再上调。
- 重新生成：`npm run embed:anims`；只校验不写：`node scripts/embed-anims.mjs --check`；`npm run verify:anims`；量化：`npm run measure:bundle`。
- 校验：`scripts/verify-anims.mjs` 校验角色/clip、按 manifest 的逐角色帧数、`holdMs`/`durationMs` 时长一致性、PNG 尺寸与可见像素、气泡/TTS 策略、动作映射与 i18n key，并检查 `client.content.js` 存在、四个一级 tabs、无 fetch/外部 URL，并在私有资产可用时逐字节比对嵌入块是否过期。
- 静态 QA：`node scripts/embed-anims.mjs --qa` 生成 `scripts/qa/anim-data.js`，浏览器直接打开 `scripts/qa/index.html` 可切角色、播 12 个 clip、看实心/空心气泡并跑数据自检，不需要重启 DSH。

## 点击区域反应（0.8.2）

- 区域数据来自私有仓 `desktop-games/public/characters/{pet-tinglan-anim,pet-cat,pet-dog}/regions.json`，与独立 famling 的 hero 共用同一份 `version/canvas/regions/gestures` 契约：区域是 96×96 逻辑画布上的 `head` / `body` / `tail` 矩形（带 priority）。
- `scripts/embed-anims.mjs` 读取并校验这些文档，写入生成块 `ANIMS[character].regions`；`--check` 会把它纳入过期检测，`--qa` 生成的 `anim-data.js` 也包含区域数据。
- 点击时用图片**实际渲染尺寸**把 `offsetX/offsetY` 映射回 96 逻辑坐标，再按 priority 命中区域；同一相对位置在 64/72/96/144px 等任意显示尺寸下命中一致。
- 命中映射：`head → pat_head`（摸头）、`body → stand_wag`（摇尾/伸展）、`tail → chase_tail`（追尾）；气泡文案来自该区域规则自带的 `says` 随机行（0.8.3），没有台词数据就不说话。
- 只有 `idle` / `idle_blink` 状态响应，正在播放其它 clip 时不打断；命中透明区/未声明区域是明确的 no-op，**不再回退为随机微动作**（随机微动作仍由待机计时器触发）。
- 区域回话（0.8.3）：`regions.json` 的每条区域规则带 3 条 `says`，命中后随机挑一条（连续同区域点击会换一句）；猫/狗仍为空心 thought 气泡、永不 TTS；汀岚为实心 speech + 既有 TTS 同意。

## 物种专属互动与随机回话（0.8.3）

- 互动菜单不再手写固定表：`scripts/embed-anims.mjs` 把 `regions.json` 的 `actions`（id/label/event/followUpEvent/followUpMs/says）和 `gestures[].says` 一起嵌入 `ANIMS[character]`，并纳入 `source-sha256` 与 `--check` 过期检测；改数据后重跑 `npm run embed:anims` 即可。
- 事件 → clip 映射仍手写在 `client.js` 的 `EVENT_CLIPS`（`pat`→`pat_head`、`ball_throw`→`ball_throw`、`ball_chase`→`ball_chase`、`paw_face`→`paw_face`、`run`→`run`；`feed` 复用 stand/wave clip；`talk` 只出气泡、保持 idle）。`scripts/verify-anims.mjs` 会校验映射完整、猫/人没有球类动作、金毛丢球→追球 follow-up，以及每个动作/区域至少 2 条随机回话。
- 随机回话使用“避开上一句”的选择器：同一区域/同一动作连续点击不会返回同一句；气泡文案、TTS 与 thought 策略沿用 0.8.2。

## 帧时长与 holdMs 播放（0.8.4）

- 帧数/时长不再写死：`scripts/embed-anims.mjs` 与 `scripts/verify-anims.mjs` 从每个角色自己的 `manifest.json` 读取帧数与每 clip 的 `fps`/`holdMs`/`durationMs`；各角色帧数可以不同（dog 68 / cat 72 / human 68，共 208；cat `stand_wag` = 10 帧）。
- `client.js` 播放改为逐帧 `setTimeout`：第 n 帧停留 `holdMs[n] ?? round(1000/fps)` 毫秒；非循环 clip 播完最后一帧回到 `idle`，若 manifest 的 `durationMs` 大于 hold 总和则延长最后一帧。cat 伸懒腰 = 300+300+300+350+400+400+400+350+250+150 = **3200ms**（10 帧），不再被固定 `setInterval(1000/fps)` 播快；攻击帧也按 attack 的 holdMs（83/83/63/42/42/63/63）播放。
- `holdMs`/`durationMs` 进入 `source-sha256` 与 `--check`：只改 timing 的 manifest 变更同样会让嵌入块变旧；`verify-anims.mjs` 校验 holdMs 逐帧覆盖、总和等于 durationMs。

## 内容中心：角色就是主题（0.10.0）

内容中心不再把「主题 / 背景 / 字体」当作并列的一级主视觉。**角色就是主题 bundle**：一个角色 = character + voicePolicy + dialogue + theme + background + font 六个组件；点一次「一键应用」= 原子地应用整包。之后用户可以在「自定义」里改任意组件（覆盖角色预设），或一键「恢复角色默认」。

### 四个一级 tabs

| Tab | 内容 | 行为 / 持久化 |
|---|---|---|
| **角色** | 汀岚 / 塞尔凯克卷毛猫 / 金毛（origami bundle 数据预留，素材未安装，不提供卡片） | 每卡展示 glyph 头像、角色名、一句说明、声音 / 对话 / 外观摘要和「一键应用」按钮；当前角色有 ✓ 标记。应用 = 同时写 character、voicePolicy、dialogue、theme/background/font 与 `dsh-famling/role`；不预加载其它角色动画 chunk。 |
| **自定义** | 声音（TTS 策略）/ 对话 / 主题 / 背景 / 字体（保留 0.9.1 能力） | 顶部说明「仅修改当前角色的搭配，不改变角色预设」并显示「角色预设 / 已自定义」；每个组件改动只写对应旧键，角色 id 不变；「恢复角色默认」按当前角色 bundle 重置全部组件。 |
| **内容包** | 当前只有内置包（4 个角色 bundle），没有外部包 | 展示已安装列表、v3 强制 `usageDeclaration` 检查结果（researchOnly=true + 六项禁止用途）、资产包导入入口（**需 Host 支持**，zip/文件夹清单 + sha256 由 Host 解析；本版本不读取文件、不执行脚本、不加载素材、不联网）。 |
| **市场** | 远程市场占位 | 固定显示「远程市场接口已预留，服务器未配置」；展示预留字段 `catalogUrl` / `configKey`（`dsh-famling/market/catalog`、`dsh-famling.market`）；不发网络请求、不展示伪造商品。 |

### 角色 bundle

| role | character | 声音策略 | 对话 | 主题 / 背景 / 字体 |
|---|---|---|---|---|
| `human` | 汀岚 | speech，可浏览器 TTS（仍受独立同意门禁） | `standard` | `default` / `transparent` / `system` |
| `cat` | 塞尔凯克卷毛猫 | thought，无 TTS | `brief` | `paper` / `paper` / `serif` |
| `dog` | 金毛 | thought，无 TTS | `standard` | `night` / `dark` / `mono` |
| `origami` | 预留 | thought，无 TTS | `quiet` | `paper` / `transparent` / `serif`（数据预留，不可应用） |

一键应用会把 TTS 开关改成 bundle 的声音策略；若用户尚未同意 TTS，则保持关闭（不会绕过同意门禁）。切到猫/狗会取消正在进行的浏览器朗读。

### 持久化与回填

- 新键 `dsh-famling/role` 记录当前角色主题（primary）；旧键继续使用：`dsh-famling/character`、`dsh-famling/settings`（`sound` / `voiceURI`）、`dsh-famling/dialogue`、`dsh-famling/theme`、`dsh-famling/background`、`dsh-famling/font`。
- 应用角色 = 写入全部六个组件对应的键 + `dsh-famling/role`；自定义 = 只覆盖被点的那一个组件键，角色 id 不变。
- 加载：先读 `dsh-famling/role`；没有该键时从已存 `character` 反推角色；缺失的组件键用该角色 bundle 回填，已显式保存的组件键优先。0.9.x 用户升级后首次渲染即获得角色回填。
- 内容中心 UI chunk `client.content.js` 在首次打开面板时才通过 `require.async('./client.content.js')` 下载；失败时本地面板显示加载失败，核心互动不受影响。

## 内容扩展接口 v3（预留，不联网）

[`content-extension.mjs`](content-extension.mjs) 是给未来本地/远程内容包的公开契约（package export：`dsh-famling/content-extension`）：

- `CONTENT_EXTENSION_POINTS` — **version 3**（pack `schemaVersion: 3`）、`status: "reserved"`、`transport: { network: false, execute: false, innerHTML: false, worker: false, assets: false }`。
- `CONTENT_KINDS` — **七类**：`role` / `character` / `voice` / `dialogue` / `theme` / `background` / `font`。`role` 是 v3 新增的 bundle kind：apply 必须包含 `character / voicePolicy / dialogue / theme / background / font` 六个组件，entry 还必须带 `compatibility`（`minPluginVersion`，可选 `maxPluginVersion`）。
- **所有 pack 必须含 `usageDeclaration`**：`{ researchOnly: true, prohibitedUses: [六项] }`；六项固定为 `emotional-companionship` / `virtual-partner` / `professional-advice` / `minor-intimacy` / `impersonation` / `illegal-use`。缺失、`researchOnly !== true`、少一项、多一项、重复项或未知字段一律拒绝。role entry 不豁免 pack 级声明；role entry 可选地重复一份 `usageDeclaration`，出现时按同一规则校验。声明模板导出为 `USAGE_DECLARATION_TEMPLATE`。
- **`assets` 预留**：pack 可带 `{ format: "zip" | "folder", files: [{ path, sha256, bytes? }], totalBytes? }`；path 必须是安全相对路径（≤6 段、无 `..`、无 scheme、≤160 字符、带扩展名），sha256 为 64 位小写 hex；**只做数据校验/清单，不读取、不打开、不执行、不加载任何资产**。
- **`remoteCatalog` 预留**：可选 `{ status: "reserved", url?: "https://..." }`；仅作为元数据校验，**不 fetch、不预热、不加载远程目录**。远程 source（`source: "remote"`）默认拒绝，未来 Host 必须显式 `{ allowRemote: true }` 才通过 schema 校验。
- `validateContentPack(pack, { allowRemote? }) → { ok, errors }` — **纯数据**校验，不抛异常、不执行、不联网、不读文件。
- `CONTENT_PACK_EXAMPLE` — 一份合法的 v3 示例 pack（含完整 usageDeclaration、一个 role bundle、一个 theme entry），不会被自动加载。

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
    ]
  },
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

其它校验（与 v2 一致并延续）：纯数据（拒绝函数 / symbol / bigint / 非有限数 / 非 plain object）、未知字段/枚举、超长字符串/数组、JSON ≤ 64 KiB、entries ≤ 32（每 kind ≤ 16）、id/name/description 限制、原型链键（`__proto__` / `constructor` / `prototype`）、图片预览路径穿越/绝对路径/URL、`<` 与控制字符、`url()` / `expression()` / `@import` 等危险 CSS；theme 变量必须 `--dsh-famling-*` 且值为安全颜色；background 只允许 transparent/安全纯色；font 只允许 1..8 个不带引号的本地字体名（拒绝引号、`url()`、`var()`、分号、花括号、`@` 规则）。重复 entry id / 重复 asset path / role 兼容范围倒置都会拒绝。

本版本**不加载任何 pack**：没有网络请求、没有 pack 脚本执行、没有 `innerHTML`、没有资产解包；内容中心只展示内置目录、声明检查与预留说明。未来接入加载器时也必须是「纯数据 + 在 Host 侧解析/校验 + UI 只渲染数据」。完整 schema、限制与示例见 [docs/DETAIL.md](docs/DETAIL.md)。

> 与独立 famling 的共享内容模型 `famling.content/0.1`（characters / voices / dialoguePacks / themes / backgrounds / fonts）是**目标超集关系**：六类仍可与插件 kind 一一映射（`builtin` ≡ `bundled`），v3 的 `role` 是把六类组合成的角色主题 bundle；插件契约把“选择/应用”建模为 `apply` + permissions，共享模型是目录条目 + 解析函数；主题 CSS 前缀、语音来源（浏览器 speechSynthesis vs DeepSeek stella/tide）与校验返回结构仍不同。两套契约并存、各自 fail-closed，收敛通过适配层（content-extension 后续 MAJOR），详见 [docs/DETAIL.md](docs/DETAIL.md)。

## Host bridge（P0/P1/P2/P4 已实现）

- `POST /api/famling/bridge`（同源、owner-only、JSON ≤16KB）
- `op:"echo"` → 本地回显
- `op:"chat"` → Host `ctx.llm.stream`；provider/model 来自 DSH 默认模型选择或本插件 Config，**不写死**（Key 只在 Host）；system prompt 按请求的 `character` 选择人格（非法/缺失回退 `human`）
- `op:"brief"` → 只读 `~/.advisers/pet-brief.json`，只投影计数/今天/承诺，不代传 Advisers TOS
- `op:"task"` → `ctx.schedule.create` 一次性提醒（绝对时间；不自己实现定时器）
- TTS/ASR 各自独立同意；默认关闭；浏览器语音会明确说明音频去向
- **LLM 聊天已接入 Host bridge**（`op:"chat"` 经 DSH `ctx.llm.stream`，内容会发送给所配置的模型服务商）；TTS/ASR 是浏览器本地能力、各自独立同意；**记忆写入仍未实现**。下一步见 `docs/DSH-FAMLING-BRIDGE-2026-11-17.md`。
- 数据流披露：聊天文本经 DSH Host 发往模型供应商；插件本身不接收、不存储 API Key；`brief` 只读本机 `~/.advisers`，不上传。

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
| `cat` | 塞尔凯克卷毛猫（卷毛灰白） | 懒散、高冷、短句；允许轻微傲娇但不冒犯 | 空心 thought，永不 TTS |
| `dog` | 金毛 | 友善、热情、简单直接 | 空心 thought，永不 TTS |

三条人格共用同一组安全边界：不冒充真人/官方/专业顾问；不诱导依赖、恋爱、付费或未成年人情感关系；不输出违法、隐私或冒充内容。人格只是 system prompt 级的语气差异，不是独立角色扮演或情感陪伴；模型仍由 DSH 默认模型选择决定。

## 安装（本地）

1. 把本目录放到 DSH 插件目录；
2. DSH **Plugins → Add plugin** 选择本目录（或使用 `plugin_manager install_bundle`，target 为本目录绝对路径）；
3. 启用 `dsh-famling`，刷新 Web UI；
4. 查看左侧栏底部账号区域下方是否出现 `汀岚`。

## 验证

- `node --check client.js`
- `node --check client.content.js`（内容中心懒加载 UI chunk，纯本地渲染）
- `node --check content-extension.mjs`（内容扩展契约，纯数据/无副作用）
- `node --check index.js`
- `npm test`（`node --test test/`：Host 桥接 fake-context 测试 + 客户端生成块/多角色行为测试 + 内容中心四分类/角色 bundle/内容扩展 v3 契约测试，**76 项**，不调用真实模型）
- `npm run check`（= `check:anims`：嵌入块与私有动画包一致）
- `npm run verify`（= `verify:anims`：3 角色 × 12 clip、按 manifest 的帧数 68/72/68=208 与 holdMs 时长、点击区域契约、气泡/TTS 策略、动作映射、内容中心四 tabs / 声明检查 / 无 fetch 门禁）
- `npm run measure:bundle`（入口 66.1 KiB / 内容 chunk 24.3 KiB 等实测）
- `npm run qa:anims` 后浏览器打开 `scripts/qa/index.html`（静态 QA，不重启 DSH）
- 插件详情/图标：`locale/zh.json`、`locale/en.json`、`icon.png`
- 本版本已用 DSH 0.2.2-rc.3 的 `sidebar.footer.action` slot 编写；实际渲染需在 DSH Web UI 验证。
- 代码：**PolyForm Noncommercial 1.0.0**（`LICENSE`）；
- 头像/图标/汀岚美术：**CC BY-NC-SA 4.0**（`LICENSE-ART`）；
- 非商业 + 同协议 + 署名；商业需书面许可。

## 限制

- 仅本地小 widget，不是完整 famling；完整应用见 `PerryLink/famling`。
- 内容中心是**角色主题 + 组件覆盖**，不是可编程主题引擎；不加载 pack、不加载资产、不联网。
- 远程市场只有占位 UI 与预留字段，没有服务器、没有商品、没有网络请求；不要把它当作已上线市场。
- `origami` 角色 bundle 仅是数据预留（无动画/素材 chunk），UI 不提供一键应用。
- Host 聊天人格随形象切换（0.8.1）：人格差异只体现在 system prompt，安全边界与 AI 声明不变；切换形象只影响之后的聊天请求，不会改写正在进行或已生成的回复。模型选择仍由 DSH 默认模型选择/插件 Config 决定。
- 动画包标注为 placeholder（非最终美术，非商业授权），与插件整体 PolyForm Noncommercial 许可一致。
- 不是官方 DeepSeek 项目；不使用 DeepSeek 官方 logo/字标。
- 插件不保存个人数据；点击计数不持久化。
