# dsh-famling × Advisers 0.5.0：Pet Brief 复验报告（2026-11-24）

- 范围：`plugins/dsh-famling` Host bridge `op:"brief"`（`index.js`）对 Advisers 生产的 `~/.advisers/pet-brief.json` 的消费。
- 生产端：**Advisers 0.5.0**（npm `advisers@0.5.0`；契约 **Pet Brief v0.2 / `schemaVersion: 2`**）。
- 结论：**契约未变，插件运行时无需改动**；本次只更新兼容性证据、测试与文档，发布 `dsh-famling 0.13.4`。

## 1. 版本与发布真值（2026-11-24 实测）

| 项 | 实测值 | 证据 |
|---|---|---|
| npm `advisers` dist-tags（直连 registry） | `latest = 0.5.0`，`next = 0.5.0` | `npm view advisers version dist-tags --registry=https://registry.npmjs.org` |
| Advisers 仓 tag / HEAD | `v0.5.0`（release commit `ab7f756`）；HEAD `13336fb`（`docs(releasing): record the published 0.5.0 evidence`） | 本机 `git -C plugins/advisers` |
| 包版本 | `packages/advisers/package.json` = `0.5.0` | 同上 |
| Pet Brief producer 与 v0.3.0 的差异 | `git diff v0.3.0..v0.5.0 -- packages/advisers/lib/pet-brief.js docs/pet-brief` **为空** | 本机 git；契约快照未动 |
| 契约常量 | `PET_BRIEF_SCHEMA_VERSION = 2`、legacy 1、TTL 5 分钟、每节 ≤10、displayPolicy `public/private/none`、source `advisers` | `packages/advisers/lib/pet-brief.js:21-36` |
| 消费端注册 | `contracts/CONSUMERS.json` 的 `dsh-famling` 条目仍为 `pet-brief@0.2`（note 记录首次验证 2026-11-20 / 0.3.0） | Advisers 仓 `contracts/CONSUMERS.json` |
| TOS | 生产端 TOS **v2026.11.4**（0.3.0 报告时为 v2026.11.3）；`pet-brief` 仍受 TOS 门控，未重新同意 → 不生成 brief | `packages/advisers/lib/tos/manifest.json` |
| 插件版本 | 本次发布 **0.13.4**；0.13.3 的 bridge 校验代码未改（仅注释/测试/文档） | `package.json` / `git diff` |

> 说明：0.5.0 的发布主题是 portable / disclosable / verifiable（含只读 mail follow-up、schema v22 等），这些能力**不改变 Pet Brief 的 producer 或 closed contract v0.2**；消费端影响仅为 TOS 版本变化（producer 侧门控）。

## 2. 消费端复验（插件 bridge）

插件仍是 0.3.0 时引入的严格 consumer：整份文档先按 closed contract v0.2 校验，再投影 7 个键（counts + today/commitments 各 ≤3 行）；任何偏差 404 `E_MEMORY`，不返回部分对象。0.5.0 输出与 0.3.0 同契约，因此无需运行时改动。

新增/更新：

- `test/pet-brief-compat.test.js`：标题/注释更新为 0.5.0；新增 always-on 的 **captured 0.5.0 producer fixture** 往返测试（fixture 见下）；真实 producer 可选层继续用内存合成账本。
- `test/fixtures/pet-brief-0.5.0.json`：由 Advisers 0.5.0 的 `buildPetBrief` + 内存合成账本生成，**无真实账本、无 ~/.advisers 读取**；sha256 `a3f7cc28368a67875f4c8500418eb616efbe705046c777752bc284a5ff13894b`。测试只前移 TTL（restamp），不改变 payload 字节。
- `index.js`：仅把注释里的「0.3.0 follow-up」标注为「re-verified through 0.5.0」；校验逻辑不变。

## 3. 验证命令与结果

```sh
cd plugins/dsh-famling
ADVISERS_REPO_DIR=../advisers node --test test/pet-brief-compat.test.js
# 15/15 pass：含 captured 0.5.0 fixture + 真实 0.5.0 producer 往返 + canonical v0.2 vectors + 私有 famling fixtures
git -C ../advisers diff v0.3.0..v0.5.0 -- packages/advisers/lib/pet-brief.js docs/pet-brief   # 空
```

复验范围与限制：

- 未运行真实 DSH/Tauri GUI、未读真实 `~/.advisers` 账本；fixture 全部为合成数据。
- Advisers 工作树当前有 0.5.1 WIP 的未提交改动；复验只使用 **v0.5.0 的 producer 代码**与本地已构建的 `packages/core/dist`，未触碰其工作树。
- `contracts/CONSUMERS.json` 的记录说明仍写 0.3.0 首次验证；这是 Advisers 仓的登记文本，若需改为 0.5.0 复验日期，应由 Advisers 维护批次更新。

## 4. 兼容矩阵（contract v0.2 → Advisers 0.5.0 producer → 插件 bridge）

| 场景 | 0.5.0 producer | dsh-famling bridge | 判定 |
|---|---|---|---|
| 合法 v0.2（private/public） | accept | 200，投影 | 兼容 |
| `displayPolicy: none` | accept | 404 `E_MEMORY`（比契约更严格） | 安全 |
| 非法/缺失 `displayPolicy` | reject / warning | 404（closed enum / required） | 收紧 |
| v0.1 legacy | accept + warnings | 200，按 private | 兼容 |
| 未来/未知 schemaVersion | reject | 404 | 兼容 |
| 过期 / TTL >5 分钟 / 时间倒序 / 未来时间 | reject / 无保证 | 404 | 收紧 |
| counts 与数组不一致、单节 >10、重复 id、未知/禁止字段 | reject | 404 | 收紧 |
| `source !== advisers` | reject | 404 | 兼容 |
| 文件 >128 KiB / JSON 损坏 | 正常输出远小于上限 | 404 | 兼容 |

## 5. 发布物

- `dsh-famling@0.13.4`（npm latest）；同 tarball 附 GitHub Release `v0.13.4`。
- 运行时行为与 0.13.3 相同；升级点仅为 Advisers 0.5.0 兼容性证据、fixture、文档与版本号。
- 旧报告 [PET-BRIEF-0.3.0-COMPAT-2026-11-20.md](PET-BRIEF-0.3.0-COMPAT-2026-11-20.md) 保留为历史。