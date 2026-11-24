---
name: dsh-famling-dev
description: "dsh-famling 插件开发总则：改代码/文档前后的门禁、生成块与预算约束、隐私红线、版本与发布纪律。"
whenToUse: "在本仓库修改 dsh-famling 的 host/client 代码、生成块、locale/文档、测试或准备发布时使用；用户说『改一下插件』『加个功能』『发布』时先读本文件。"
metadata:
  language: "zh"
  category: "development"
disable-model-invocation: true
user-invocable: true
---

# dsh-famling 开发总则

本文件是仓库内 agent/人类贡献者的最短执行链；详细事实以 `docs/DETAIL.md`、`docs/DSH-COMPATIBILITY.md`、`docs/RELEASE-HYGIENE.md` 为准。

## 1. 改之前先跑基线

```sh
node --test test/*.test.js        # 基线应全绿（当前 359 条；clean-checkout 在副本路径会 skip，正常）
node scripts/verify-dsh.mjs       # 28 项离线 DSH 清单/产物自检
```

## 2. 三条不可协商

1. **生成块不可手改**：`client.js` 的 `<dsh-famling:anims|actions|event-clips|scale|content|content-constants|lazy|lowdisturb>` 与 `client.content.js`、`client.anims.*.js` 的生成区只能由 `scripts/embed-anims.mjs` / `scripts/gen-content-constants.mjs` / `scripts/embed-anims.mjs --qa` 重生成；改完跑 `node scripts/check`。
2. **首屏预算不可破**：`client.js` 硬门禁 96 KiB、31% / 52% / mount(当前 55%) 比例门禁在 `test/client-static.test.js`；新功能优先进懒加载 chunk（`client.behavior/content/status`），不要为省事把 UI/文案塞进入口。
3. **隐私红线**：host 半不读、不存、不记录 agent/session id、消息、提示词、工具参数、文件路径；工作状态只能用 `agent/status` / `agent/error` 的枚举与时间戳派生。

## 3. 改完必跑的门禁

```sh
node scripts/check:fast 2>/dev/null || node scripts/check-fast.mjs    # JSDoc/typecheck/生成块/verify-dsh/全量单测
node scripts/check-release.mjs                                       # fast + 动画 + 打包 + 清单 + 发布不变量
node scripts/verify-dsh.mjs --dsh-version 0.2.3-alpha.2               # 指定宿主版本时
```

- 改了任何**会被打包**的文件（入口/懒加载/文档/locale/icon 等）→ 重生成 `PLUGIN-MANIFEST.json`：`node scripts/plugin-manifest.mjs`，再跑 `node scripts/plugin-manifest.mjs --check`。
- 改了内联 zh/en 字典 → `node scripts/check-i18n.mjs`（或靠测试）必须键集对等、无死键。
- 改了版本号 → 只在 owner 批准发布时 bump `package.json`，然后 `node test/version-truth.test.js --write` 同步 client/README/LEGAL-NOTICE/locale，再跑全量门禁。

## 4. 发布纪律

- 未经 owner 明确批准：**不 npm publish、不打 tag、不改公开仓、不 commit**；本地 `npm pack` 仅用于取证。
- 发布前最小集合：`node scripts/check-release.mjs` + `npm pack --dry-run --json` + `node test/dsh-host-smoke.mjs --checkout <DSH checkout>`（真实宿主冒烟，Windows/Chromium 环境）。
- `dsh.compatibility.dshReleases` 只保最新三版；标 `compatible` 前必须满足：`engines.dsh` 接受、`verify-dsh --dsh-version` 通过、真实宿主冒烟通过（无宿主时标 `unknown`，不要猜）。
- 不声称 signed/合规/正式发布；当前是 C1 unsigned 研究原型。

## 5. 文档同步

- 行为/契约变化：`docs/DETAIL.md`；DSH 清单/兼容：`docs/DSH-COMPATIBILITY.md`；门禁/发布记录：`docs/RELEASE-HYGIENE.md`；插件页读者：`docs/PLUGIN-PAGE.md`。
- 新增用户可见文案必须 zh/en 成对，且 `docs/PLUGIN-PAGE.md`/README 的用户承诺要能由实现与测试证明。
