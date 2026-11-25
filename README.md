# dsh-famling — DSH 侧栏的像素桌宠

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-famling"><img alt="npm" src="https://img.shields.io/npm/v/dsh-famling?label=npm" /></a>
  <a href="https://github.com/PerryLink/dsh-famling/actions/workflows/plugin-gates.yml"><img alt="gates" src="https://github.com/PerryLink/dsh-famling/actions/workflows/plugin-gates.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-blue" /></a>
  <a href="docs/DSH-COMPATIBILITY.md"><img alt="DSH" src="https://img.shields.io/badge/DSH-0.2.1--rc.5%20..%200.2.3--alpha.x-2f6f6a" /></a>
</p>

> **研究原型。** 汀岚 / 布偶猫 / 金毛三套 96×96 像素动画，默认零常驻按钮，右键或 Shift+F10 打开菜单。
> 非官方项目，不关联 DeepSeek；内容/角色与 AI 资产标注见 [`DECLARATIONS`](https://github.com/PerryLink/famling/blob/main/DECLARATIONS.md) 与 [AI-PROVENANCE](https://github.com/PerryLink/famling/blob/main/AI-PROVENANCE.md)。

## 安装

```sh
dsh plugin --profile web add dsh-famling
```

在 DSH 侧栏账号区下方显示 72px 桌宠。兼容 DSH `>=0.2.1-rc.5 <0.3.0` 的 0.2.x 线；逐版本兼容矩阵见 [docs/DSH-COMPATIBILITY.md](docs/DSH-COMPATIBILITY.md)。

## 使用

- 右键角色、点击「⋯」或按 **Shift+F10** 打开菜单：聊两句 / 互动 / 内容与角色 / 设置 / 更多 / 退出（隐藏，刷新恢复）。
- 设置：低打扰安静时段、减少动态、暂时隐藏、四层缩放、TTS/ASR、数据导出与删除、TTS/ASR 同意。
- 「一起工作」25/50 分钟专注模式：只暂停自动气泡/自动微动作，不拦显式互动；结束一句本地气泡，无系统通知、无历史、无连续天数。

## 当前实现（0.13.5）

- **DSH 兼容自检**：`npm run verify:dsh` 离线校验清单/patch/客户端产物/兼容矩阵/资源/路径卫生（28 项）；`engines.dsh` 是安装闸门，`dsh.compatibility.dshReleases` 是第三方 Store 展示字段。
- **分层门禁**：`npm run check:fast`（静态 + 全量单测）与 `npm run check:release`（fast + 动画/打包/清单/发布不变量）；`prepublishOnly` 跑发布不变量。
- **宿主工作状态**：只读 DSH 粗状态（运行/空闲 + 分类错误码），派生 `idle / working / success / error` 并按时长过期；不读消息、提示词、工具参数或文件内容。
- **气泡优先级**：`ambient < interaction < direct`，低优先级不挤掉高优先级；成功/错误各一句本地化短气泡，默认 60s 错误冷却，安静时段/页面不可见/减少动态时抑制。
- **低打扰与无障碍**：安静时段 22:00–08:00、减少动态、暂时隐藏、健康提醒 2h；无连续天数、无惩罚、无系统通知刷屏。
- **内容与角色**：角色包安装/更新/卸载/回滚/热切换；内容包 v2/v3（许可、AI provenance、compatibility、研究用途声明）+ 离线市场 UI（生产服务器未接）。
- **语音**：TTS/ASR 走 DSH Host 或本地能力；公开包不预生成音频；首次运行展示 AI/语音/发送目的地/危机资源声明并记录同意，可撤回。
- **版本真值**：`package.json` 单一来源，`node test/version-truth.test.js --write` 同步 client 常量/README/LEGAL-NOTICE/locale。

## 数据与隐私

- 插件不保存聊天记录；聊天文本经 DSH Host 发送给你配置的**模型供应商**，不经过本插件自建服务器；危机关键词在本地短路为固定安全资源，文本不会离开本机。
- 只读取宿主粗状态（运行/空闲 + 分类错误码）用于安静/姿态切换；不读取消息、提示词、工具参数、文件内容或窗口标题。
- 本机设置/同意/存档只存本机（`dsh-famling/*` 偏好键）；支持在设置内**清除**本机设置与同意、删除本机数据。
- 无遥测上传、无市场网络请求（市场默认 unconfigured）、无外部 CDN。

## 安全与合规

- 危机资源：**12356**（心理援助）/ **110**（报警）/ **120**（急救）；不提供情感陪伴、虚拟伴侣、专业建议或冒充真人/官方。
- 聊天为**工作助手**型 AI 回复；AI 生成/合成内容按 DSH 与仓内外声明标注；TTS/ASR 同意文本版本化，可单独撤回。
- 使用限制全文见 [docs/legal/USE-RESTRICTIONS-2026-11-19.md](https://github.com/PerryLink/famling/blob/main/docs/legal/USE-RESTRICTIONS-2026-11-19.md)；法律文本仍为 DRAFT，不构成合规结论。

## 许可

- 代码：**PolyForm Noncommercial 1.0.0**（[LICENSE](LICENSE) / [LICENSE-COMMERCIAL](LICENSE-COMMERCIAL.md)）。
- 美术/角色设定：**CC BY-NC-SA 4.0**（[LICENSE-ART](LICENSE-ART)）；角色名/Logo/商标不随 CC 许可授权。

## 已知限制

- 研究原型：无签名/自动更新；DSH 侧栏形态运行在宿主内，独立桌面版见 [Famling 公开仓](https://github.com/PerryLink/famling)。
- 内容包市场只有离线 UI 与协议，无生产服务器/支付/审核。
- 兼容矩阵按 DSH 0.2.3-alpha.2 的离线自检 + 真实宿主验证维护；更高版本需重新跑 `verify:dsh --dsh-version`。

## 开发与文档

```sh
npm test               # 359 tests, 0 fail
npm run check:fast     # 静态 + verify:dsh + 全量单测
npm run check:release  # fast + 动画校验 + 打包 + 清单 + 发布不变量
node scripts/verify-dsh.mjs --dsh-version 0.2.3-alpha.2
```

详见：[docs/DETAIL.md](docs/DETAIL.md)（设计细节）、[docs/DSH-COMPATIBILITY.md](docs/DSH-COMPATIBILITY.md)、[docs/PLUGIN-PAGE.md](docs/PLUGIN-PAGE.md)、[docs/RELEASE-HYGIENE.md](docs/RELEASE-HYGIENE.md)、[docs/INDEPENDENT-REBUILD-2026-11-20.md](docs/INDEPENDENT-REBUILD-2026-11-20.md)、[docs/PUBLIC-REPO-SYNC-2026-11-20.md](docs/PUBLIC-REPO-SYNC-2026-11-20.md)。
