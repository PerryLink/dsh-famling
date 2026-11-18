# dsh-famling

Famling / 汀岚 的 DSH 兼容版：在 DeepSeek Harness 左侧栏**左下角、账号信息下方**显示一个小型桌宠入口。

## 两个包

本工作线提供两个包，按用途分开：

| 包 | 来源 | 用途 |
|---|---|---|
| **famling** | [PerryLink/famling](https://github.com/PerryLink/famling) | **独立运行的完整桌宠**（pet-only Tauri app；汀岚/猫/狗、UI、TTS、年龄核验等） |
| **dsh-famling** | 本仓 | **DSH 客户端插件**；只提供左下角小型汀岚入口与本地小互动，不替代独立 app |

> `famling` 是独立应用；`dsh-famling` 是放在 DSH 里的轻量伴随入口。两者共享角色/品牌，不共享运行时代码。

## 当前实现

- slot：`sidebar.footer.action`（DSH 侧栏账号信息下方的 footer 区域）。
- 最终交互结构：人物右侧竖排 **输入 / 互动 / 设置** 三个按钮；点击人物的头/身体/尾巴分别触发按区域反应（0.8.2），互动菜单按当前形象渲染物种专属动作并随机挑一句回话（0.8.3，见下）。
- **72px 像素桌宠**（96×96 帧按 `image-rendering: pixelated` 显示为 72px），可切换 **汀岚 / 塞尔凯克卷毛猫（卷毛灰白） / 金毛** 三个形象；点击头部/身体/尾巴分别触发摸头/摇尾/追尾，点击透明或未声明区域不动作。
- 待机是真正的帧动画：3 个角色各 12 clip（帧数按 manifest：dog 68 / cat 72 / human 68，共 208 帧）；`idle` 循环 + `idle_blink` 眨眼替换 + 随机微动作（`paw_face` / `scratch` / `stand_wag` / `chase_tail`）；每帧时长读 manifest 的 `holdMs`（缺省 1000/fps），非循环 clip 按 `durationMs`/hold 总和结束（0.8.4）。
- 输入面板：人物右侧展开文本框 + 语音输入按钮（浏览器 SpeechRecognition），预留 `window.__DSH_FAMLING_BRIDGE__` 给 DSH/Advisers Host。
- 互动面板（0.8.3）：直接读嵌入的 `ANIMS[character].actions`（来自与独立 famling 共用的 `regions.json`），按形象渲染物种专属动作——汀岚：摸头 / 递纸 / 挥手 / 整理蝴蝶结 / 聊两句；塞尔凯克卷毛猫：摸头 / 伸懒腰 / 洗脸 / 追尾巴 / 跑一跑；金毛：摸头 / 丢球·捡球 / 捡球 / 追尾巴 / 跑一跑（丢球后 500ms 自动接追球）。猫和人没有球类/捡球动作，绝不会把 A 角色的动作放到 B 角色身上。
- 设置：形象切换、语音朗读、帧动画、说话气泡开关，存本机 localStorage（形象键 `dsh-famling/character`，默认汀岚）。
- 气泡（0.8.3）：点击区域或动作时，从该区域/动作自己的 `says` 数组随机挑一句（同一位置连续点击不会重复同一句）；**汀岚**的台词是实心 speech 气泡，可配合浏览器 TTS（保留原有独立同意）；**塞尔凯克卷毛猫（卷毛灰白）/金毛**只用空心 thought 气泡，永不调用 `speechSynthesis`，设置里的语音朗读对它们禁用并提示“仅汀岚可用”；切到猫/狗时若正在朗读会立即停止。气泡白底 `#ffffff`、深色 `#111111` 字、灰色实线/虚线边框，不常驻、不遮挡人物。
- 聊天人格随形象切换（0.8.1）：输入面板的聊天请求会带当前形象（`human`/`cat`/`dog`，缺省 `human`）；Host 按形象选择 system prompt，切猫/狗后回复语气随之变化。
- 输入面板的 LLM/TTS/ASR/记忆需要 Host 桥接；未接入时如实提示，不伪造回复。
- 不宣传 roleplay；不包含完整桌宠/游戏基座。
- 无 roleplay 公开入口；网络请求仅限同源 `/api/famling/bridge`（DSH Host 路由）。

## 多角色动画数据（0.8.0）

三套 96×96 像素动画包（各 12 clip；帧数按 manifest：dog 68 / cat 72 / human 68，共 208 帧）以 base64 PNG 形式嵌在 `client.js` 的生成块中（`const ANIMS` + `const SPRITES`）：

- 数据源：私有仓 `desktop-games/public/assets/pet/anim/{human,cat,dog}/`（`manifest.json` + 帧 PNG）。
- 生成器：`scripts/embed-anims.mjs` —— 读取 manifest/PNG、校验三套 clip 契约、把 RGBA 帧**无损**重编码为最小位深索引 PNG（硬 alpha 保留，体积约减半），再按 marker 注入 `client.js`。**禁止手改生成块**，改数据重跑脚本即可。
- 体积：源 351.6 KiB → 嵌入 PNG 167.8 KiB（base64 224.0 KiB），`client.js` 约 302 KiB。
- 校验：`scripts/verify-anims.mjs` 校验角色/clip、按 manifest 的逐角色帧数、`holdMs`/`durationMs` 时长一致性、PNG 尺寸与可见像素、气泡/TTS 策略、动作映射与 i18n key，并在私有资产可用时逐字节比对嵌入块是否过期。
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
- `node --check index.js`
- `npm test`（`node --test test/`：Host 桥接 fake-context 测试 + 客户端生成块/多角色行为测试，不调用真实模型）
- `npm run check:anims`（嵌入块与私有动画包一致）
- `npm run verify:anims`（3 角色 × 12 clip、按 manifest 的帧数 68/72/68=208 与 holdMs 时长、点击区域契约、气泡/TTS 策略、动作映射）
- `npm run qa:anims` 后浏览器打开 `scripts/qa/index.html`（静态 QA，不重启 DSH）
- 插件详情/图标：`locale/zh.json`、`locale/en.json`、`icon.png`
- 本版本已用 DSH 0.2.2-rc.3 的 `sidebar.footer.action` slot 编写；实际渲染需在 DSH Web UI 验证。
- 代码：**PolyForm Noncommercial 1.0.0**（`LICENSE`）；
- 头像/图标/汀岚美术：**CC BY-NC-SA 4.0**（`LICENSE-ART`）；
- 非商业 + 同协议 + 署名；商业需书面许可。

## 限制

- 仅本地小 widget，不是完整 famling；完整应用见 `PerryLink/famling`。
- Host 聊天人格随形象切换（0.8.1）：人格差异只体现在 system prompt，安全边界与 AI 声明不变；切换形象只影响之后的聊天请求，不会改写正在进行或已生成的回复。模型选择仍由 DSH 默认模型选择/插件 Config 决定。
- 动画包标注为 placeholder（非最终美术，非商业授权），与插件整体 PolyForm Noncommercial 许可一致。
- 不是官方 DeepSeek 项目；不使用 DeepSeek 官方 logo/字标。
- 插件不保存个人数据；点击计数不持久化。
