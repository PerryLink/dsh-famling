# Famling · 汀岚

在 DSH 左侧栏左下角、账号信息下方显示一个小型 famling 桌宠入口。

- 显示 72px 像素桌宠：汀岚 / 塞尔凯克卷毛猫（卷毛灰白） / 金毛，台词、动作与聊天人格随形象变化。
- 动画：每角色 12 clip，帧数按 manifest（dog 68 / cat 72 / human 68，共 208 帧；clip：idle 循环、idle_blink 眨眼、pat_head、ball_throw、ball_chase、paw_face、scratch、stand_wag、chase_tail、walk、run、attack），随机微动作只取本形象的 clip。
- 动画按角色懒加载（0.8.6）：入口 client.js 不再内嵌三套 base64；首次显示 human/cat/dog 时通过 DSH `require.async` 拉取 `client.anims.<kind>.js`，入口约 50 KiB、首帧约 113 KiB、全量约 297 KiB；chunk sha256 进入 embed/verify 门禁。
- 帧时长（0.8.4）：每帧停留时间读 manifest `holdMs`（缺省 1000/fps），非循环 clip 播完后按 `durationMs`/hold 总和回到 idle；cat 伸懒腰 10 帧 / 3200ms 按 300/300/300/350/400/400/400/350/250/150 逐帧播放，不是固定 fps 快放。
- 点击区域（0.8.2）：点击人物头部/身体/尾巴分别触发 pat_head/stand_wag/chase_tail；区域来自与独立 famling 共用的 `regions.json`（96×96 逻辑画布 + idle gating），非 idle/idle_blink 状态或空白区域不动作，不回退随机动作。
- 随机回话（0.8.3）：每条区域规则与每个互动动作都带 `says` 数组，命中时随机挑一条且连续两次不会重复；气泡文案全量来自共用 `regions.json`，不手写重复台词。
- 物种专属互动（0.8.3）：互动菜单由 `ANIMS[character].actions` 数据驱动——汀岚 摸头/递纸/挥手/整理蝴蝶结/聊两句；塞尔凯克卷毛猫 摸头/伸懒腰/洗脸/追尾巴/跑一跑；金毛 摸头/丢球·捡球/捡球/追尾巴/跑一跑（丢球后 500ms 接追球）。猫/人没有球类动作。
- 点击展开本地小面板：输入 / 互动 / 设置；互动按钮跑本角色真实存在的 clip，仅本地 UI 状态，不调用模型、不上传数据。
- 聊天人格随形象切换（0.8.1）：输入面板的 `op:"chat"` 请求带当前 `character`（`human`/`cat`/`dog`，缺省或非法回退 `human`）；Host 用 `PERSONAS` 选 system prompt——汀岚安静简洁工作搭子、塞尔凯克卷毛猫（卷毛灰白）懒散高冷短句（轻微傲娇但不冒犯）、金毛友善热情简单直接。三条人格共用安全边界：不冒充真人/官方/专业顾问，不诱导依赖/恋爱/付费/未成年人关系，不输出违法/隐私。
- 语音规则：汀岚可用浏览器 TTS（独立同意）；塞尔凯克卷毛猫/金毛只用空心 thought 气泡，永不调用 `speechSynthesis`。
- 不宣传 roleplay；不替代独立 famling 应用。

限制：这是 DSH 客户端插件，不是完整桌宠；完整可执行版在 `PerryLink/famling`。

## 最终界面结构

- 左侧 72px 人物。
- 右侧竖排：输入 / 互动 / 设置。
- 输入：右侧文本框 + 语音输入按钮；DSH/Advisers Host 桥接预留；聊天请求带当前形象，Host 据此切换人格。
- 互动：按当前形象渲染物种专属动作（数据来自 `regions.json` actions），点击后跑对应 clip + 随机回话（金毛丢球→追球）；点击人物按头/身/尾区域触发对应动作并从该区域 says 随机回话，空白区域不动作。
- 设置：形象（汀岚/塞尔凯克卷毛猫/金毛）、语音、帧动画、气泡开关；形象持久化到 `dsh-famling/character`。
- 气泡：白底 #ffffff / 深色 #111111 字 / 灰色实线或虚线边框；汀岚实心 speech（可用 TTS），猫/狗空心 thought（永不 TTS）；每次点击从对应 says 随机取一句，不遮挡人物。
- 动画数据与点击区域数据由 `scripts/embed-anims.mjs` 生成，勿手改 `client.js` 生成块；`scripts/verify-anims.mjs` + `scripts/qa/index.html` 可脱离 DSH 校验/预览。

## 使用限制（canonical，必读）

> 本项目及其全部代码、美术、音频、文案、角色素材和衍生物仅用于技术研究与原型验证，不得用于情感陪伴、虚拟伴侣、心理治疗/医疗/法律/金融建议、未成年人亲密关系、冒充真人/官方，或任何违反法律法规/平台规则的用途。

- 完整说明与短句 SHA-256：`docs/LEGAL-NOTICE-2026-11-18.md` §0；canonical 源为 famling 仓 `desktop-games/docs/legal/USE-RESTRICTIONS-2026-11-19.md`。
- 本插件不是情感陪伴/虚拟伴侣产品；禁止冒充真人或官方、对外服务运营、删除/伪造 AI 标识、绕过 TTS/ASR 同意或其它安全门禁。
