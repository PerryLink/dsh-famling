# dsh-famling × Advisers 0.5.1：Pet Brief 兼容性记录（2026-11-25）

- 范围：dsh-famling Host bridge `op:"brief"` 对 Advisers 生产的 `~/.advisers/pet-brief.json` 的消费。
- 生产端：**Advisers 0.5.1**（npm `advisers@0.5.1`，2026-11-24 发布；GitHub tag `v0.5.1`）。
- 结论：**Pet Brief 契约未变，插件运行时无需改动**；本记录只更新兼容性证据。

## 1. 版本真值

| 项 | 实测 | 证据 |
|---|---|---|
| npm `advisers` dist-tags | `latest = 0.5.1` | registry.npmjs.org（2026-11-25 查询） |
| Advisers 仓 tag / 最近 release | `v0.5.1`（2026-11-24 17:05 UTC） | GitHub API releases |
| 0.5.0 → 0.5.1 的 Pet Brief 变更 | **无**：`packages/advisers/lib/pet-brief.js`、`docs/pet-brief/*`、`contracts/CONSUMERS.json` 均未在 diff 中 | GitHub compare `v0.5.0...v0.5.1` |
| TOS 版本 | 2026.11.4（0.5.1 release 未升级；D10b 才升级） | Advisers `CHANGELOG.md` 0.5.1 节 |
| 本机 Advisers 工作副本 | `repos/advisers` 已更新到 v0.5.1 | 本地 `package.json` / CHANGELOG |

## 2. 兼容矩阵

| 场景 | 0.5.0 | 0.5.1 |
|---|---|---|
| Pet Brief producer / closed contract v0.2 | 通过（0.13.4 已验证） | 通过（契约文件未变） |
| `schemaVersion: 2` / legacy 1 / TTL 5min | 不变 | 不变 |
| displayPolicy（public/private/none） | 不变 | 不变 |
| TOS 门控（未重新同意 → 不生成 brief） | 不变 | 不变 |
| 插件侧严格 consumer / 7 键投影 | 不变 | 不变 |

## 3. 复验方式

```bash
# 1) 本地 Advisers 工作副本
git -C repos/advisers describe --tags --always   # v0.5.1

# 2) 契约文件对比（应为空）
git -C repos/advisers diff v0.5.0..v0.5.1 -- packages/advisers/lib/pet-brief.js docs/pet-brief contracts/CONSUMERS.json

# 3) 插件测试（无外部 checkout 时 producer 检查会 skip，不伪造通过）
node --test test/pet-brief-compat.test.js
```

## 4. 说明

- 0.5.1 是 0.5.0 的补丁版本（数据库 schema v22→v23、mail follow-up/证据/质量门等），不涉及 Pet Brief producer；
- 插件侧 **0.13.5** 的 bridge 代码与测试不需要改动；
- 如果后续 Advisers 升级到会改 Pet Brief 的版本，再按 `PET-BRIEF-0.5.0-COMPAT-2026-11-24.md` 的方式重新抓 fixture/复验。