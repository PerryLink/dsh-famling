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
- 最终交互结构：人物右侧竖排 **输入 / 互动 / 设置** 三个按钮；点击人物随机播放互动动作。
- **72px 像素桌宠**（96×96 帧按 `image-rendering: pixelated` 显示为 72px），可切换 **汀岚 / 布偶猫 / 金毛** 三个形象；点击人物随机播放该形象的微动作。
- 待机是真正的帧动画：12 clip / 68 帧 × 3 角色的完整动画包；`idle` 循环 + `idle_blink` 眨眼替换 + 随机微动作（`paw_face` / `scratch` / `stand_wag` / `chase_tail`）。
- 输入面板：人物右侧展开文本框 + 语音输入按钮（浏览器 SpeechRecognition），预留 `window.__DSH_FAMLING_BRIDGE__` 给 DSH/Advisers Host。
- 互动面板：按形象映射到该角色真实存在的 clip——三个角色都有 `pat_head` / `ball_throw` / `ball_chase`；汀岚另有挥手、伸懒腰、抬手，布偶猫另有洗脸、站起来、追尾巴，金毛另有摇尾巴、追尾巴、挠痒。绝不会把 A 角色的动作放到 B 角色身上。
- 设置：形象切换、语音朗读、帧动画、说话气泡开关，存本机 localStorage（形象键 `dsh-famling/character`，默认汀岚）。
- 气泡：**汀岚**的台词是实心 speech 气泡，可配合浏览器 TTS（保留原有独立同意）；**布偶猫/金毛**只用空心 thought 气泡，永不调用 `speechSynthesis`，设置里的语音朗读对它们禁用并提示“仅汀岚可用”；切到猫/狗时若正在朗读会立即停止。气泡不常驻、不遮挡人物。
- 输入面板的 LLM/TTS/ASR/记忆需要 Host 桥接；未接入时如实提示，不伪造回复。
- 不宣传 roleplay；不包含完整桌宠/游戏基座。
- 无 roleplay 公开入口；网络请求仅限同源 `/api/famling/bridge`（DSH Host 路由）。

## 多角色动画数据（0.8.0）

三套 96×96 像素动画包（各 12 clip / 68 帧，共 204 帧）以 base64 PNG 形式嵌在 `client.js` 的生成块中（`const ANIMS` + `const SPRITES`）：

- 数据源：私有仓 `desktop-games/public/assets/pet/anim/{human,cat,dog}/`（`manifest.json` + 帧 PNG）。
- 生成器：`scripts/embed-anims.mjs` —— 读取 manifest/PNG、校验三套 clip 契约、把 RGBA 帧**无损**重编码为最小位深索引 PNG（硬 alpha 保留，体积约减半），再按 marker 注入 `client.js`。**禁止手改生成块**，改数据重跑脚本即可。
- 体积：源 281.4 KiB → 嵌入 PNG 142.8 KiB（base64 190.6 KiB），`client.js` 约 245 KiB。
- 校验：`scripts/verify-anims.mjs` 校验角色/clip/帧数、PNG 尺寸与可见像素、气泡/TTS 策略、动作映射与 i18n key，并在私有资产可用时逐字节比对嵌入块是否过期。
- 静态 QA：`node scripts/embed-anims.mjs --qa` 生成 `scripts/qa/anim-data.js`，浏览器直接打开 `scripts/qa/index.html` 可切角色、播 12 个 clip、看实心/空心气泡并跑数据自检，不需要重启 DSH。

## Host bridge（P0/P1/P2/P4 已实现）

- `POST /api/famling/bridge`（同源、owner-only、JSON ≤16KB）
- `op:"echo"` → 本地回显
- `op:"chat"` → Host `ctx.llm.stream`；provider/model 来自 DSH 默认模型选择或本插件 Config，**不写死**（Key 只在 Host）
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

不要改 DSH 自带的 profile bundle；优先用 DSH 的模型选择器。```

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
- `npm run verify:anims`（3 角色 × 12 clip × 68 帧、气泡/TTS 策略、动作映射）
- `npm run qa:anims` 后浏览器打开 `scripts/qa/index.html`（静态 QA，不重启 DSH）
- 插件详情/图标：`locale/zh.json`、`locale/en.json`、`icon.png`
- 本版本已用 DSH 0.2.2-rc.3 的 `sidebar.footer.action` slot 编写；实际渲染需在 DSH Web UI 验证。
- 代码：**PolyForm Noncommercial 1.0.0**（`LICENSE`）；
- 头像/图标/汀岚美术：**CC BY-NC-SA 4.0**（`LICENSE-ART`）；
- 非商业 + 同协议 + 署名；商业需书面许可。

## 限制

- 仅本地小 widget，不是完整 famling；完整应用见 `PerryLink/famling`。
- Host 聊天人格仍是汀岚（`index.js` 的 system prompt 未按形象切换）；切到猫/狗时回复会以猫/狗的空心气泡呈现，但文本语气仍来自汀岚人格。客户端动画/语音规则不受影响。
- 动画包标注为 placeholder（非最终美术，非商业授权），与插件整体 PolyForm Noncommercial 许可一致。
- 不是官方 DeepSeek 项目；不使用 DeepSeek 官方 logo/字标。
- 插件不保存个人数据；点击计数不持久化。
