# Famling · 汀岚

在 DSH 左侧栏左下角、账号信息下方显示一个小型 famling 桌宠入口。

- 显示 72px 像素桌宠：汀岚 / 布偶猫 / 金毛，台词、动作与聊天人格随形象变化。
- 动画：每角色 12 clip / 68 帧（idle 循环、idle_blink 眨眼、pat_head、ball_throw、ball_chase、paw_face、scratch、stand_wag、chase_tail、walk、run、attack），随机微动作只取本形象的 clip。
- 点击展开本地小面板：输入 / 互动 / 设置；互动按钮按形象映射到本角色真实存在的 clip，仅本地 UI 状态，不调用模型、不上传数据。
- 聊天人格随形象切换（0.8.1）：输入面板的 `op:"chat"` 请求带当前 `character`（`human`/`cat`/`dog`，缺省或非法回退 `human`）；Host 用 `PERSONAS` 选 system prompt——汀岚安静简洁工作搭子、布偶猫懒散高冷短句（轻微傲娇但不冒犯）、金毛友善热情简单直接。三条人格共用安全边界：不冒充真人/官方/专业顾问，不诱导依赖/恋爱/付费/未成年人关系，不输出违法/隐私。
- 语音规则：汀岚可用浏览器 TTS（独立同意）；布偶猫/金毛只用空心 thought 气泡，永不调用 `speechSynthesis`。
- 不宣传 roleplay；不替代独立 famling 应用。

限制：这是 DSH 客户端插件，不是完整桌宠；完整可执行版在 `PerryLink/famling`。

## 最终界面结构

- 左侧 72px 人物。
- 右侧竖排：输入 / 互动 / 设置。
- 输入：右侧文本框 + 语音输入按钮；DSH/Advisers Host 桥接预留；聊天请求带当前形象，Host 据此切换人格。
- 互动：自由选择动作；点击人物随机动作。
- 设置：形象（汀岚/布偶猫/金毛）、语音、帧动画、气泡开关；形象持久化到 `dsh-famling/character`。
- 气泡：汀岚实心 speech；猫/狗空心 thought；不遮挡人物。
- 动画数据由 `scripts/embed-anims.mjs` 生成，勿手改 `client.js` 生成块；`scripts/verify-anims.mjs` + `scripts/qa/index.html` 可脱离 DSH 校验/预览。
