# dsh-famling × Advisers 0.3.0：Pet Brief 严格校验报告（2026-11-20）

- 范围：`plugins/dsh-famling` 的 **Host bridge `op:"brief"`**（`index.js`）对 Advisers 生产的 `pet-brief.json` 的消费；生产端为 **Advisers 0.3.0**（npm `advisers@0.3.0`，契约 **Pet Brief v0.2 / `schemaVersion: 2`**）。
- 本次改动（task-152）：只改 `index.js`、`test/`、`docs/`、`README.md`；**未改 `client.js` / 版本号 / package.json，未 commit / push，未改 Advisers 仓**。
- 结论：**bridge 从「投影 allowlist」升级为「严格 consumer」**——读取后先按 closed contract v0.2 校验整份文档，再投影固定 allowlist；任何偏差 404 `E_MEMORY` fail-closed，不返回部分对象。0.3.0 输出仍为 contract v0.2，真实 producer 往返、私有 famling fixtures 往返、非法/篡改输入负向用例全部通过。
- 相关消费端（desktop-games / famling）的 TOS v2026.11.3 重同意指引在另一仓：`desktop-games/docs/integration/ADVISERS-030-TOS-AND-BRIDGE-HARDENING-2026-11-20.md`。
- 证据边界：未读真实账本/`~/.advisers`、未跑真实 DSH/Tauri GUI、未做 npm publish/CI；本轮 `npm test` 的 4 个失败项全部来自**并发进行中的私有资产改写**（见 §7），与本轮 brief 路径无关。

## 1. 版本与发布真值

| 项 | 实测值 | 证据 |
|---|---|---|
| npm raw registry `advisers` dist-tags | `latest = 0.3.0`，`next = 0.2.3` | `curl -sS https://registry.npmjs.org/-/package/advisers/dist-tags`（2026-11-20） |
| npm `advisers@0.3.0` 元数据 | license `PolyForm-Noncommercial-1.0.0`，engines `node >=22.16`，`dist.attestations = true` | `curl -sS https://registry.npmjs.org/advisers/latest` |
| 本机 npm CLI 的 `npm view advisers version` | **0.2.3（误导）** | 本机 `npm config get registry` = `https://registry.npmmirror.com`，镜像缓存滞后；不能作为发布状态证据 |
| Advisers 仓 HEAD | `e3f440d`（`docs(release): mark 0.3.0 published …`）；`packages/advisers/package.json` = `0.3.0` | `git -C plugins/advisers log -1` |
| 发布 tag | `v0.3.0`（tag 指向 `1199fbf`；HEAD 是其后的 docs 提交） | `git tag -l / git log` |
| Pet Brief producer 与 tag 的关系 | `git diff v0.3.0..HEAD -- packages/advisers/lib/pet-brief.js …` **为空**（producer 代码 = 发布 tag） | 本机 git |
| dsh-famling | `0.10.11`；bridge wire 2；bridge route `/api/famling/bridge` | `package.json`、`index.js` |

> 注：Advisers 仓内 `docs/PET-BRIEF-PRODUCER.md:117,136` 仍写着「随 `advisers@0.2.0` 发布 / 当前 0.2.1」，0.3.0 发布未同步这两处包版本引用（契约版本本身未变）。这属于 producer 仓文档滞后，不在本插件写范围。

## 2. 0.3.0 对 Pet Brief 消费端意味着什么

1. **契约版本不变**：`packages/advisers/lib/pet-brief.js` 仍为 `PET_BRIEF_SCHEMA_VERSION = 2`、legacy 1、`displayPolicy` 默认 `private`、TTL 5 分钟、每节 ≤10 项；公开契约快照 `docs/pet-brief/schema-v0.2.json` 在 `v0.2.3..v0.3.0` 间无 diff。
2. **producer 实现是性能重构**（+102/−39，due 缓存、top-N 有界插入、name candidates 去重、narrow projection），0.3.0 自带输出等价断言（`test/read-model-projections.test.js:239-247` 的 `assert.deepEqual(projectedBrief, fullBrief)`）。
3. **per-item secrecy clearance**：`secrecy >= 2` 的 matter 及其承诺在计数/截断前整项排除，只把排除数写 `redactions`；消费端看到的是已过滤后的 counts/数组。
4. **TOS v2026.11.3（2026-11-20）**：实质性修订，v2026.11.2 的既存同意不再有效；`pet-brief` 是受门控命令，未重新同意 → exit 3 `E_TOS_REQUIRED`（不生成 brief）。这与文件契约无关，但会让桌面端看到 `NO_FILE`/旧 brief 过期；消费端指引见跨仓文档。
5. 生产端自测（本机 0.3.0 工作树）：`node --experimental-strip-types --test test/pet-brief.test.js` → **28/28 pass**（历史任务实测，本轮未重跑）。

## 3. 插件当前消费实现（严格校验）

实现在 `index.js`：

| 层 | 行为 | 位置 |
|---|---|---|
| 路径 | `ADVISERS_HOME`（若设）→ 否则 `USERPROFILE/.advisers` → 否则 `HOME/.advisers` + `/pet-brief.json` | `advisersHome()` |
| 大小 | UTF-8 字节 > **128 KiB** → 404 `E_MEMORY` | `PET_BRIEF_MAX_BYTES`、`readBriefProjection` |
| JSON | 解析失败 → 404 `E_MEMORY`，消息只含 `E_MALFORMED_JSON` | `readBriefProjection` |
| 契约版本 | `schemaVersion` 仅 `1`（legacy）/`2`；其它（含缺失/未来/非整数）→ fail-closed | `validatePetBriefStrict` |
| closed schema | 根/条目/counts 均 allowlist；未知字段与禁止字段（reasoning/CoT/prompt/key/token/emotional）→ reject | `PET_BRIEF_ROOT_KEYS`、`PET_BRIEF_ITEM_KEYS`、`PET_BRIEF_FORBIDDEN_KEYS` |
| required | v0.2 要求全部 13 个根字段（含 `displayPolicy`）；v0.1（legacy）只缺 `displayPolicy` | `PET_BRIEF_REQUIRED_V02/V01` |
| displayPolicy | `public/private/none` 三值；`none` 先通过 schema 再被 bridge 拒绝（404）；未知值 reject（**不再归一 private**） | `validatePetBriefStrict`、`readBriefProjection` |
| 时间 | `generatedAt`/`expiresAt` 必须 ISO 8601 带时区；`expiresAt > generatedAt`；`now < expiresAt`；**TTL 上界 `expiresAt - generatedAt <= 5 min`**；`generatedAt` 不得超前当前时间 60 s（时钟偏移/篡改护栏） | `petBriefParseInstant`、`E_TIME_ORDER/E_TTL/E_EXPIRED/E_TIME_FUTURE` |
| counts | 四键均为整数 `0..10` 且**等于对应数组长度**；缺键/多键/负数/小数/字符串 reject | `petBriefValidateCounts`、`E_COUNTS/E_COUNTS_MISMATCH` |
| 条目 | 每节 ≤10；`id` 1–64 字符且节内唯一；各字段类型/长度/enum/confidence 0..1 全部校验 | `petBriefValidateArraySection` |
| suggestedLines/redactions | 分别 ≤3 / ≤10 项，字符串 1..40 / 1..80 字符；空串 reject | `petBriefValidateLines/Redactions` |
| mood | `calm|focused|concerned|pleased` | `validatePetBriefStrict` |
| 失败语义 | 任一错误 → 404 `E_MEMORY`，`message` 只含去重后的稳定错误码（≤3 个），**不回显字段值/路径**；不返回部分 brief | `readBriefProjection` |
| 投影 | 成功时仍只输出 7 键：`schemaVersion/displayPolicy/generatedAt/expiresAt/counts` + `today`/`commitments` 各截 3 条、字段 allowlist；`risks/facts/suggestedLines/redactions/mood/source` 不出现 | `readBriefProjection` |

要点：校验发生在投影之前，且是「整份文档」级；投影 allowlist 继续作为第二道输出约束，不会因为输入新增字段而扩大响应面。

## 4. 兼容矩阵（contract v0.2 → 0.3.0 producer → 插件 bridge）

| 场景 | producer 0.3.0 | dsh-famling bridge | 判定 |
|---|---|---|---|
| 合法 v0.2（private/public） | accept | 200，投影 | 兼容 |
| `displayPolicy: none` | accept（consumer 必须不渲染） | 404 `E_MEMORY`（比契约更严格） | 安全 |
| 非法 `displayPolicy`（如 `audience`） | reject `E_ENUM` | **404**（closed enum，不再归一） | 收紧（P2 缺口关闭） |
| v0.2 缺 `displayPolicy` | accept + warning | **404 E_REQUIRED**（producer 正常输出总带该字段） | 收紧（closed schema） |
| v0.1 legacy（`schemaVersion: 1`，无 displayPolicy） | accept + warnings | 200，按 private | 兼容 |
| 未知版本（≥3 / 0 / 非整数） | reject fail-closed | 404 `E_MEMORY` | 兼容 |
| 过期 / 缺 `expiresAt` / 非法时间 | reject | 404 | 兼容 |
| TTL 超过 5 分钟 / 时间倒序 / generatedAt 超前 >60 s | producer 自身按 5 min 生成；篡改场景无保证 | **404** | 收紧（G2 关闭） |
| 缺/非法 `counts` | reject | 404 | 兼容 |
| `counts` 与数组不一致 | reject | **404** | 收紧（G1 关闭） |
| 单节 >10 项 | reject | **404** | 收紧（G1 关闭） |
| 禁止字段 `reasoning`/`api_key`/情绪字段 | reject | **404**（递归全文档） | 收紧（G1 关闭） |
| 任意未知根/条目/counts 字段 | reject | **404**（closed schema） | 收紧（G1 关闭） |
| 重复 id / 非法 mood / 无时区 ISO / 超长字符串 | reject | **404** | 收紧（G1 关闭） |
| `source !== "advisers"` | producer 校验 const | **404** | 收紧（G1 关闭） |
| 文件 >128 KiB / JSON 损坏 | 正常输出远小于上限 | 404 `E_MEMORY` | 兼容 |

**影响面**：bridge 仍是本机只读投影、手动触发、默认输出 allowlist；收紧后的变化是「对被篡改/损坏文件的接受度」从宽松变为 fail-closed，不会扩大数据外泄面，也不会把 producer 未打算展示的字段上屏。

## 5. 测试

`test/pet-brief-compat.test.js` 重写为 **14 条**（11 条 always-on + 3 条可选层）：

1. 合法 v0.2 只投影 counts + today/commitments 各 ≤3，且不投影其他 producer 字段；
2. 投影截断 3 条但保留真实 counts；
3. v0.1 legacy 接受并按 private；v0.2 `displayPolicy` 必填、未知值/`none` 行为；
4. **closed schema 负向**：未知根字段、禁止字段（reasoning/api_key/affection）、未知嵌套字段、未知 counts 字段全部 404；
5. **counts 一致性负向**：四节长度不一致、越界、缺键、数组、负数、小数、字符串；
6. **TTL 上界负向**：过期、缺/非法/数值 expiresAt、>5 min、倒序、generatedAt 超前 >60 s；恰好 5 min 仍接受；
7. schemaVersion 未来/非法 fail-closed；
8. 条目/节形状负向：重复 id、11 项、非法 status/risk/confidence/mood、非数组、空/超长字符串、suggestedLines/redactions 上限；
9. `source`/缺必填字段拒绝，且错误消息不回显字段值或字段名；
10. 损坏 JSON / >128 KiB；
11. **可选**：真实 Advisers 0.3.0 producer（内存合成账本）→ bridge 往返 + secrecy 排除 + `none` 拒绝；
12. **可选**：私有 famling consumer fixtures（v0.2/v0.1）往返；
13. **可选**：canonical `testcases-v0.2.json` 26 向量对照——producer `reject` → 404，`accept*` → 200；两处有意更严格（v0.2 缺 `displayPolicy`、`displayPolicy: none`），与 §4 矩阵一致。

`test/host-bridge.test.js` 中 `op:"brief"` 用例更新为**合法 v0.2**（含 source/mood/红actions/一致 counts、TTL <5 min），并新增「未知字段/`reasoning` 篡改 → 404 且不回显」用例；其余 host bridge 用例不变。

## 6. 仍存在的缺口（本轮未改）

| # | 缺口 | 影响 | 建议 |
|---|---|---|---|
| G3 | `displayPolicy: public` 与 `private` 在 bridge 输出/客户端展示无差异 | 契约方向安全，但 public 无额外语义 | 文档已如实标注；无需为 public 增加特殊展示 |
| G4 | 读取路径信任 `ADVISERS_HOME/USERPROFILE/HOME`；未校验文件属主/符号链接/TOCTOU | 本机路径边界由用户环境决定；共享主机需用户自行约束 | 与既有安全审计一致；若跨平台打包再补 Rust/CLI 侧路径约束 |
| G5 | Advisers 的 `contracts/CONSUMERS.json` 未登记 `dsh-famling` bridge；`docs/PET-BRIEF-CONSUMERS.md` 写「唯一已接消费者」 | 跨仓消费清单不完整，后续契约变更评估会漏掉插件 | 建议 Advisers 维护方补登记（本地文件只读投影 consumer）；producer 文档包版本引用也建议同步 |
| G6 | bridge 无法从文件通道观察 producer 的 `E_TOS_REQUIRED`（未同意时 producer 根本不写文件；消息在 CLI stderr） | 桌面端只能看到 `NO_FILE`/过期，不能自动区分「没装/没跑」与「需重新同意 TOS」 | 本轮**不新增 producer 探测通道**；desktop-games 消费端已支持识别 reader 抛出的 `E_TOS_REQUIRED`（结构化或字符串）并给出固定重同意指引；若未来 Host/Tauri 提供 producer 状态诊断，可直接复用该指引。详见跨仓文档 |

> 0.3.0 TOS 重新同意是 **producer 运维项**，不是 Pet Brief 契约变化；插件不会代用户同意、不会传递 `--accept-tos`、不修改 Advisers 同意记录。

## 7. 本轮实测证据（2026-11-20，本机）

| 命令 | 结果 |
|---|---|
| `node --test test/pet-brief-compat.test.js test/host-bridge.test.js`（插件根） | **40 tests / 40 pass / 0 fail / 0 skip**；其中 brief compat 14/14、host-bridge 26/26 |
| `npm run lint` | `check-jsdoc: ok`（58 exported declarations / 3 generated marker pairs / 7 runtime files） |
| `npm run typecheck` | `checkJs ok`（tsc 来自 desktop-games/node_modules） |
| `npm run check:package` | `ok`（metadata ok，15 allowlist entries → 23 packed files） |
| `node --check index.js` | exit 0 |
| `npm test`（全量 261 tests） | **258 pass / 3 fail / 0 skip**；3 个失败全部是并发私有资产改写导致的生成物过期：`embedded animation data…`、`gen-content-constants --check`、`generated model is deterministic…`。本轮只改 `index.js`/`test`/`docs`/`README.md`，未触碰动画/regions/content 生成物；`npm run check:anims`/`check:content` 同样报告 client 生成块陈旧（并发任务 149/150/151 正在改私有 `public/assets/pet/anim/{cat,dog}` 等）。**这些不是 brief 路径回归**；资产任务收尾后需重新跑 `npm run embed:anims` / `npm run gen:content` 并从干净工作树复跑 `release:check`。 |
| 真实 0.3.0 producer 往返（可选层） | 通过：producer `validatePetBrief` ok，bridge 200，secrecy=3 事项/姓名/证据 quote 不出现 |
| canonical v0.2 26 向量（可选层） | 通过：producer `reject` 全部 404；producer `accept*` 全部 200；仅 `missing_display_policy` / `display_none` 两处按严格 consumer 策略 404（§4 已记录） |
| 私有 famling fixtures（可选层） | 通过：v0.2 + v0.1 fixture 只前移 TTL 后 bridge 200，counts/截断/schemaVersion 一致 |

**未执行/未声称**：真实账本运行、`~/.advisers/pet-brief.json` 真实文件读取、真实 DSH Host/Web UI 联调、Tauri/Windows 真机、npm publish、GitHub CI、v0.2.3 producer 逐字节 A/B。

## 8. 复现

```sh
cd plugins/dsh-famling
node --test test/pet-brief-compat.test.js test/host-bridge.test.js   # 40/40
npm run lint && npm run typecheck && npm run check:package

# 只看 adapter 契约（不依赖任何兄弟仓）
DSH_FAMLING_STANDALONE_CHILD=1 FAMLING_REPO_DIR=/nonexistent ADVISERS_REPO_DIR=/nonexistent \
  node --test test/pet-brief-compat.test.js   # 11 always-on tests; optional layers unregistered

# 资产任务收尾后的发布门（当前会被并发资产改写卡住）
npm run embed:anims && npm run gen:content && npm test && npm run release:check
```

## 9. 相关文件

- 插件实现：`index.js`（`validatePetBriefStrict` / `readBriefProjection` / `op:"brief"`）
- 插件测试：`test/pet-brief-compat.test.js`、`test/host-bridge.test.js`
- 契约快照：`plugins/advisers/docs/pet-brief/schema-v0.2.json`、`testcases-v0.2.json`
- 消费端 TOS 重同意指引：`desktop-games/docs/integration/ADVISERS-030-TOS-AND-BRIDGE-HARDENING-2026-11-20.md`；`desktop-games/src/pet/advisers/face.ts`、`tests/advisers-tos-reconsent.test.ts`