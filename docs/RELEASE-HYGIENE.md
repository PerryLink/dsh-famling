# 发布与包卫生（MB-094 残余，2026-11-20）

> **状态：发布卫生机制已在 0.10.9 工作树落地；0.10.10 版本化同意；0.10.11 猫布偶跨仓同步；0.10.12 宿主自适应外观；上述 0.10.x 均未真实发布。0.11.0（2026-11-21）是首次真实 `npm publish`：体验与预算修复 + 猫/狗 idle 帧重嵌入（212 帧）+ PLUGIN-MANIFEST；0.11.1（同日）新增包内懒加载 `client.behavior.js`，入口 97,460→94,491 B。两次均使用本地 npm token 发布，未启用 provenance / trusted publishing；公开仓 CI 以实际 run 为准。工作树 **0.12.0（未发版，版本号仍 0.11.1 待 root 统一 bump）** 新增宿主粗状态钩子（bridge `op:"state"` + 懒加载 `client.status.js`）：入口 94,491→95,148 B、`files` 24→25；未发布、未启用签名/provenance。**
> 本文与 `scripts/check-package.mjs`、`test/package-hygiene.test.js`、`package.json` 的
> `repository` / `homepage` / `bugs` / `prepack` 合成一组可复核的发布卫生证据；
> 外部链路（npm publish / provenance / 真实 CI / 公网可达性）**未在本轮执行**，见 §5。

## 1. 包元数据（canonical）

`package.json` 是唯一事实源；`scripts/check-package.mjs` 的 `CANONICAL` 常量与本文逐字对应，
`test/package-hygiene.test.js` 再把两者钉住。

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `repository` | `{"type":"git","url":"git+https://github.com/PerryLink/dsh-famling.git"}` | 插件本仓（npm `repository` 指向的 PerryLink/dsh-famling） |
| `homepage` | `https://github.com/PerryLink/dsh-famling#readme` | 与 `repository` 同仓；`PerryLink/famling` 是独立应用，只在 README「两个包」表里作为相关产品链接，不冒充本包主页 |
| `bugs` | `{"url":"https://github.com/PerryLink/dsh-famling/issues"}` | 与 `repository` 同仓的 issue 地址 |
| `license` | `PolyForm-Noncommercial-1.0.0` | 与包内 `LICENSE` 一致 |
| `private` | `false` | 这是要发布的 npm 包（不是仓库根 `private: true` 的应用包） |

一致性规则（代码强制）：`repository.url` 必须是 `git+https://`（不用 ssh / `git://`）；
`homepage` 必须等于 `repository` 或以 `repository#` 开头；`bugs.url` 必须以 `repository/` 开头。
三条 URL 不允许各指一个仓。

> npm registry 里的 `dsh-famling` 目前仍是 2026-11-14 的占位版本（`0.0.1` 为 `latest`，另有
> `0.0.0-stage` / `0.0.2`）；占位 tarball 的 `homepage` 指向独立应用仓。按 npm 语义，
> 元数据随下一次**真实发布**的 tarball 生效——本轮不为了刷元数据而发布（也不是本轮授权范围）。

### 1.1 许可文件与发布面（与 `scripts/license-scan.mjs` 对应）

- `license` = `PolyForm-Noncommercial-1.0.0`，与包内 `LICENSE` 标题逐字一致；`NOTICE` 携带 PolyForm 的 `Required Notice: Copyright (c) 2026 PerryLink contributors`（下游再分发必须保留该行）。
- `LICENSE-ART` 覆盖本包**实际分发**的美术：`client.anims.human.js` / `client.anims.cat.js` / `client.anims.dog.js` 内嵌角色动画帧与 `icon.png`；不再把桌面仓的 `public/characters/**` 等非本包路径写成覆盖范围。
- `files` 白名单必须覆盖 `LICENSE` / `LICENSE-ART` / `NOTICE` / `README.md` / `docs/LEGAL-NOTICE-2026-11-18.md`；`check-package.mjs` 的 `REQUIRED_PACKED` 把它们当作发布面。
- 第三方素材：本包不打包第三方美术/字体/音频（浏览器 TTS/ASR、模型服务与 DSH 宿主按各自条款）。
- 已知发布面缺口：`PLUGIN-MANIFEST.json` 是发布证据工件，不在 npm tarball 内（消费方从 release evidence 获取；是否入包由 root/owner 决定）。

## 2. `files` 白名单

npm 只打包 `files` 展开后的文件（外加 `package.json` / `README` / `LICENSE` 等 npm 始终包含项）。
因此 `files` 就是“发布面”，规则由 `check-package.mjs` 强制：

1. **无重复**：本任务修改前 `files` 里 `docs` 出现两次（历史遗留），现已删除——重复条目不算错但会让发布面难以审计。
2. **必须存在**：每个字面条目必须存在；每个 glob（如 `locale/*.json`）必须至少命中一个文件。
3. **运行必需项齐全**：`index.js`、`client.js`、`client.content.js`、`client.behavior.js`、三个懒加载角色 chunk、
   `content-extension.mjs`、`cordis.patch.yml`、`icon.png`、locale、文档、三份许可/声明文件、`package.json`。
4. **`exports` 全覆盖**：`exports` 里每个入口（含 `./locale/*.json` 通配）都必须能在打包集合中找到。
5. **禁止项**：`test/`、`scripts/`、`.github/`、`node_modules/`、`.git/`、`*.tgz`、`package-lock.json`、
   `.npmrc`、`.gitignore` 永不出现在 tarball。
6. **精确清单**：`npm run verify:package` 用 `npm pack --dry-run --json` 取真实打包清单，
   与“`files` 展开 + npm 始终包含项”做**集合相等**比较——多一个、少一个都红。
7. **安装 LOCK（MB-004）**：`package-lock.json` 不进 tarball（npm 语义如此），但它是 clean checkout 的
   可复现安装证据，纳入静态门禁：`lockfileVersion === 3`、name/version/license 与 `package.json` 一致、
   声明的依赖全部在锁里、禁止任何 `file:`/`link:`/绝对路径的私有解析。插件零运行时依赖 ⇒ 当前锁是
   root-only（1 个 package 条目）；将来若加 devDependency，同样必须先更新锁。

## 3. 门禁（scripts）

| 命令 | 做什么 | 何时跑 |
| --- | --- | --- |
| `npm run check:package` | 静态：元数据 + `files` 展开/重复/禁止项 + `exports` 覆盖 | 本地自检 / CI |
| `npm run verify:package` | 静态 + `npm pack --dry-run --json` 清单相等校验（不写 tarball、不联网） | 本地自检 / CI / 发布前 |
| `npm run prepack`（`prepack` 钩子） | 仅静态部分，**成功信息走 stderr** | 每次 `npm pack` / `npm publish` 自动执行 |
| `npm run release:check` | `npm test && npm run check && npm run verify && npm run verify:package` | 发布前总门禁 / CI |
| `node scripts/clean-checkout.mjs` | MB-004：复制到临时目录（无私有仓）→ `npm ci --offline` + 全量测试 + 各门禁；`--json` / `--export DIR` staging | 本地自检 / CI |

**为什么 prepack 只做静态校验、且输出到 stderr**：npm 会把生命周期脚本的 stdout 直接混进
`npm pack --dry-run --json` 的 stdout；prepack 若打印普通日志会破坏 JSON。prepack 成功信息因此写
stderr，`--pack` 模式才能稳定解析真实打包清单。prepack 也不跑完整测试套件：它要能在任何
`npm pack`（包括安装 git 依赖时的打包）里快速、离线、无副作用地只校验“发布面”；完整测试在
`release:check` / CI 里跑。prepack 失败会直接让 `npm pack` 失败（已实测，见 §4），不会带着脏包继续。

没有递归：`verify:package` 启动的 `npm pack --dry-run` 会触发 prepack 的静态校验，但静态校验不会
再调用 npm pack。

## 4. 本机验证记录（2026-11-20，WSL Linux）

环境：Node `v24.22.1`，npm `11.19.1`；全部命令真实执行，未调用外部网络服务。

| 命令 | 结果 |
| --- | --- |
| `npm test` | **200/200 pass，0 fail，0 skip**（2.06s）；其中新增 `test/package-hygiene.test.js` 10 项 |
| `npm run check`（既有动画一致性门） | exit 0，`check ok: client.js + 3 lazy character chunks match the asset pack` |
| `npm run verify`（既有动画契约门） | exit 0，`[verify-anims] OK` |
| `npm run check:package` | exit 0，`check-package: ok (metadata ok, 15 allowlist entries -> 19 packed files, 5 exports covered)` |
| `npm run verify:package` | exit 0，`check-package: pack ok (19 files, tarball ≈285 KiB, unpacked ≈648 KiB)`——tarball 体积会随 README/文档编辑轻微浮动，稳定判据是 19 个文件与「清单相等」 |
| `npm pack --dry-run --json`（直接调用） | exit 0，stdout 为合法 JSON；stderr 含 `check-package: prepack ok (...)`，证明 prepack 已执行且未污染 JSON |
| `npm run release:check` | exit 0，整链约 6–7s（test + check + verify + verify:package 全绿） |
| **负向实测**（临时副本 `/tmp/famling-gate-probe`，用后删除） | ① 只读副本上 `check:package` / `npm pack --dry-run` 均 exit 0（19 files）——门禁不依赖 `desktop-games` 兄弟目录；② 删掉 `homepage` → `check:package` exit 1，`npm pack --dry-run` 也 exit 1（npm 报 prepack 失败，打包被阻断）；③ `files` 加入 `test` → 10 条问题（禁止项 + 逐个 test 文件泄漏） |

真实 tarball 清单（`npm pack --dry-run --json`，19 个文件）：

```
LICENSE
LICENSE-ART
NOTICE
README.md
client.anims.cat.js
client.anims.dog.js
client.anims.human.js
client.content.js
client.js
content-extension.mjs
cordis.patch.yml
docs/DETAIL.md
docs/LEGAL-NOTICE-2026-11-18.md
docs/RELEASE-HYGIENE.md
icon.png
index.js
locale/en.json
locale/zh.json
package.json
```

### 4.1 2026-11-21 入口预算治理后的发布面（0.11.0 未发版，实测）

新增懒加载行为 chunk `client.behavior.js` 后，本机 `npm run verify:package` 的真实清单为 **24 files**
（`check-package: pack ok (24 files, tarball ≈318.9 KiB, unpacked ≈740 KiB)`；精确字节以 `npm run verify:package` 输出与 `PLUGIN-MANIFEST.json` 为准，24 entries），即在上面 19 文件清单基础上
增加 `client.anims.*` 之外的 `client.behavior.js`。`PLUGIN-MANIFEST.json` 同步记录 24 个 packed 文件
（总字节见 manifest 的 `packed.totalBytes`；文档自身也在打包集合内，改文档会轻微改变该值）。注意：该工作树比 registry 上已发布的 0.11.0 tarball（23 files / 322,561 B）多一个 chunk，
发布前必须 bump 版本并按本节重新生成 manifest。

另：`client.js` 的两处 `@generated` 内容块由 `scripts/gen-content-constants.mjs` 从 `desktop-games` 内容库派生，
内容库（`public/content/library.json` / `public/characters/*`）任何改动都会让块头的 `source-sha256` 变旧；
跨仓同步后必须跑 `npm run gen:content`（不是手改生成块），再重建 `PLUGIN-MANIFEST.json`。

## 4.1 MB-004 追加：独立 checkout + vendored LOCK（2026-11-20）

发布卫生之外，插件现在也能在**无私有 famling 仓**的单独 checkout 里重建与验证（详见
[`INDEPENDENT-REBUILD-2026-11-20.md`](./INDEPENDENT-REBUILD-2026-11-20.md)）：

- `package-lock.json`：root-only lockfileVersion 3；`npm ci --offline` 可复现，`check-package` 校验其
  name/version/license、依赖完整性与“无私有本地解析”。
- `scripts/spec/anim-spec.json`：vendored 语义 spec + 逐帧/逐 chunk SHA-256 LOCK（不含美术字节）；
  `embed-anims --check` 在无私有资产时进入 `standalone spec mode`，`verify-anims` 总是校验它（缺/篡改
  即失败，不再 skip）。
- `scripts/clean-checkout.mjs`：临时 checkout 内真实跑 `npm ci --offline` + `node --test` + `check` +
  `verify` + `check-package --pack` + `lint` + `typecheck`；`test/clean-checkout.test.js` 把它纳入 `npm test`。
- `scripts/clean-checkout.mjs --export DIR`：公开仓首推 staging（`PUBLIC-REPO-SYNC-2026-11-20.md`）；
  首推/CI/npm publish 仍是外部步骤，不伪造。

执行证据（2026-11-20，本工作树；`node scripts/clean-checkout.mjs --json`）：`ok: true`，整包临时副本（无 `node_modules`/`.git`），
**0 test failures**，10 个既知跨仓 parity skip（全部 `famling` 相关），embed `standalone spec mode`，
verify `OK`，package `pack ok`，typecheck 在无 TypeScript 的临时副本里诚实 skip。发布面文件数会随文档
增补变化，以 `verify:package` 的实际清单为准。

## 5. 未做 / 外部依赖（不伪造完成）

| 项 | 状态 | 原因 / 后续 |
| --- | --- | --- |
| `npm publish`（0.11.0） | **已执行（2026-11-21）** | 本地 npm token 发布（authorized by owner），`npm view dsh-famling version` = 0.11.0；发布前 release:check 绿。见 §8 发布记录 |
| npm provenance / trusted publishing | **未做** | 需要 GitHub Actions + OIDC + 公开仓；插件目录无 `.git`/CI |
| `npm deprecate dsh-famling@0.0.1` 等占位版本 | **未做** | 需要 npm 发布权限；占位包不阻塞本地门禁 |
| 插件 CI workflow（`.github/workflows`） | **未做** | 本任务的授权写范围不含 `.github`；门槛命令已封装成 `release:check`，接 CI 时直接调用 |
| 公网可达性校验（GitHub 链接是否 404） | **未做 / 不声称** | 2026-11-19 的路线图记录这两个 GitHub 仓匿名访问为私有；本门禁只校验 URL 形状与三者一致性，不做网络请求。仓库转公开后无需改代码；若仓库迁移才需同步 `CANONICAL` + 本文 |

## 6. 维护规则

- **改版本**：仍以 `package.json` 为唯一源，跑 `node test/version-truth.test.js --write` 同步其它引用；
  不要把版本号硬编码进新文档。
- **改发布面**：先改 `files` 与（如新增入口）`exports`，再跑 `npm run verify:package`；
  不要用 `.npmignore` 反向排除——白名单是唯一发布面。
- **仓库迁移/改名**：只改 `scripts/check-package.mjs` 的 `CANONICAL`、`package.json`、本文；
  `test/package-hygiene.test.js` 从 `CANONICAL` 取值，会自动跟着红/绿。
- **不要**把 `test/`、`scripts/`、私有资产、`*.tgz` 加进 `files`；门禁会红。

## 7. 参考

- `scripts/check-package.mjs` —— 门禁实现（唯一事实源）
- `test/package-hygiene.test.js` —— 元数据/白名单/打包清单的钉死测试
- `package.json` —— `repository` / `homepage` / `bugs` / `prepack`
- `docs/DETAIL.md` —— 插件契约细节；`docs/LEGAL-NOTICE-2026-11-18.md` —— 使用限制原文
- 工作区计划文档 `docs/plan/CI-SUPPLY-CHAIN-2026-11-20.md` §8.1 —— MB-094 残余项的原始方案（本任务据此补齐插件侧）

## 8. 首次真实发布记录（0.11.0，2026-11-21）

| 项 | 值 |
| --- | --- |
| 版本 | `0.11.0`（registry `dist-tags.latest` = `0.11.0`） |
| registry 时间 | `2026-11-20T16:55:05.471Z`（UTC；= 2026-11-21 00:55 +08） |
| 发布方式 | 本地 `npm publish --tag latest --access public`；npm token 从工作区既有安全文件加载（不回显/不落盘）；**未启用 provenance / trusted publishing** |
| tarball | `dsh-famling-0.11.0.tgz`；322,561 B；23 files；unpacked 748,568 B |
| tarball sha256（本地按同一打包器计算） | `fb81fd158572393fe89ff4cb2e966c11dd33e0ccfc65db369b9bcd7f6fc389e7` |
| npm shasum（发布输出） | `fa6f07b6bc1c9431970f5fd9a9caeedffb284076` |
| 发布前门禁 | `npm run release:check` exit 0（test 280/280 + check + verify + verify:package + lint + typecheck） |
| 未做 / 不声称 | provenance、trusted publishing、GitHub 公开仓 CI 首个真实 run（以公开仓推送后的实际 run 为准）、任何签名/合规结论 |
| 发布内容 | 0.11.0 体验与预算修复（宿主面板对比度、隐藏标签页暂停、首启 coach、点击冷却）+ 猫/狗 idle 重嵌入（212 帧）+ `PLUGIN-MANIFEST.json`；无新增数据收集/网络/权限/存储键 |

> **发布面（2026-11-21）**：**0.13.0 已于 2026-11-21 发布**（见 §8.3，新增一起工作专注模式/许可清收/DSH 真机证据文档）；**0.12.0 已于 2026-11-21 发布**（见 §8.2）：新增 bridge `op:"state"` + 懒加载 `client.status.js`（宿主粗状态轮询）与 task-21 首启安全卡两个一次性有用动作（提醒 / 预填提问；无新增存储键/网络），`files` 25 项；tarball 336,041 B / unpacked 786,146 B、入口 95,533 B。上表保留 0.11.0/0.11.1 发布史实；C1 联合证据里的插件字节以 `PLUGIN-MANIFEST.json` 的最终 digest 为准。

### 8.1 0.11.1（2026-11-21）

| 项 | 值 |
| --- | --- |
| 版本 | `0.11.1`（registry `latest` = `0.11.1`） |
| registry 时间 | `2026-11-20T17:34:59.503Z`（UTC；= 2026-11-21 01:34 +08） |
| 发布方式 | 本地 `npm publish --tag latest --access public`（同一安全 token 路径）；未启用 provenance / trusted publishing |
| tarball | `dsh-famling-0.11.1.tgz`；326,682 B；24 files；unpacked 758,269 B |
| tarball sha256（本地同打包器计算） | `b5074cc00362dbdc9fecd184826b935b2fc67144f6e5d54bae6c72256d36480b` |
| npm shasum | `aa5b6887ee9cfe2dddba6ea32df1a3f7dd1baf06` |
| 相对 0.11.0 | 入口 97,460→94,491 B（−2,969 B）：新增包内懒加载 `client.behavior.js`（命中/冷却/饱和/随机回话/帧时长）；`files` 23→24；无 runtime 契约变更、无新增存储键/网络/权限 |
| 未做 / 不声称 | provenance、trusted publishing、签名/合规；公开仓 CI 结果以实际 run 为准 |

### 8.2 0.12.0（2026-11-21）

| 项 | 值 |
| --- | --- |
| 版本 | `0.12.0`（registry `latest` = `0.12.0`） |
| registry 时间 | `2026-11-20T18:26:10.002Z`（UTC；= 2026-11-21 02:26 +08） |
| 发布方式 | 本地 `npm publish --tag latest --access public`；未启用 provenance / trusted publishing |
| tarball | `dsh-famling-0.12.0.tgz`；336,041 B；25 files；unpacked 786,146 B |
| tarball sha256（本地同打包器计算） | `ce25390d7dd8214367be75ceecec04205983a1ddbddb5968e75c799844291a4b` |
| npm shasum | `2f771058984c3f4d35553545c3c870493bd8d0cb` |
| 内容 | 入口预算治理（94,491 B 基线 → 95,533 B，新增 lazy `client.behavior.js` 5,768 B + `client.status.js` 4,099 B）；宿主 `agent/status` 粗状态桥（`op:"state"`，有界环/闭合 schema/fail-closed）；首启安全卡两个一次性有用动作（10 分钟休息提醒 / 预填工作问题，不自动发送）；`files` 24→25；无新增存储键/权限/遥测。 |
| 未做 / 不声称 | provenance、trusted publishing、签名/合规/DLC/市场/私有仓真实 CI；公开仓 CI 以实际 run 为准 |

### 8.3 0.13.0（2026-11-21）

| 项 | 值 |
| --- | --- |
| 版本 | `0.13.0`（registry `latest` = `0.13.0`） |
| registry 时间 | `2026-11-21T03:31:20.554Z`（UTC；= 2026-11-21 11:31 +08） |
| 发布方式 | 本地 `npm publish --tag latest --access public`；未启用 provenance / trusted publishing |
| tarball | `dsh-famling-0.13.0.tgz`；349,068 B；26 files；unpacked 818,485 B |
| tarball sha256 | `11bd57c0253364b7f412f2b804d1647128e8bdd2338145e33e3d5f043dc65aa9` |
| npm shasum / integrity | `86dd9c8bd3e2120e76e451272b71ccb91e2ac8ad` / `sha512-SJE8KlvQRr1CF/YSlha0qDbU0GXDOgq+CbPs46QBEkWwfQ5iwNAeg5pSvcF/wS4NVBahzObkRwcw3h1NZMErSA==` |
| 内容 | 「一起工作（专注）」25/50 分钟（内存-only quiet 窗口，显式交互仍回应；无存储键/通知/历史/streak；入口 +198 B → 95,731 B）；`LICENSE-ART` 覆盖实际 `client.anims.*`/`icon.png` 并向 `NOTICE` 边界收敛；真实 DSH 0.2.2-rc.4 宿主联调 46/46 与 rc.4/rc.5 契约门 45/45 文档入包；`files` 25→26 |
| 联合证据 | `2026-11-21-c1-final-06586af` 的 JOINT-EVIDENCE 已绑定本 tarball sha256（与 registry dist 一致），见 desktop `release:c1` packet |
| 未做 / 不声称 | provenance、trusted publishing、签名/合规/DLC/市场/私有仓真实 CI |

### 8.2 0.12.0 工作树（未发版，2026-11-21）

| 项 | 值 |
| --- | --- |
| 状态 | **未 `npm publish`**；版本号仍 `0.11.1`，由 root 统一 bump 后再发布 |
| 相对 0.11.1 | 新增 bridge `op:"state"`（wire 2，宿主粗状态）+ 懒加载 `client.status.js` + task-21 首启安全卡两个一次性有用动作（「10 分钟后提醒我休息一下」复用既有 `op:"task"`、「问一句工作问题」只预填不发送；无新增常驻 UI / 存储键 / 网络 / 权限 / 遥测）；入口 94,491→**95,533 B**（+1,042 B，其中 task-21 +385 B；gzip 27,409 B / brotli 22,906 B）；懒加载 `client.content.js` 74,189→79,094 B（task-21 +4,905 B，不计入首屏/挂载门禁）；`files` 24→25；`PLUGIN-MANIFEST.json` 已按工作树重新生成 |
| 门禁 | `npm test` 306/306 绿；真实挂载载荷 163,463→168,604 B = 53.57%，首帧门禁 52%→**54%**（status kit 计入真实挂载下载；入口 31% / 96 KiB 门禁不变，余量 2,043 B / 2,771 B；mount 门禁余 1,367 B） |
| task-B1 增量（「一起工作」专注模式，2026-11-21，未发布） | 入口 95,533→**95,731 B**（+198 B；gzip 27,470 / brotli 22,972；31% 门禁余 1,845 B、96 KiB 余 2,573 B）；懒加载 `client.content.js` 79,094→85,750 B（25/50 选择器、倒计时徽标、一次性提示与 zh/en 文案；不计入首屏/挂载门禁）；真实挂载 168,604→**168,802 B = 53.63%**（< 54%，余 1,169 B）；`npm test` **314/314** 绿；无新增存储键/权限/网络/系统通知/常驻 UI；状态仅内存、刷新即清；`PLUGIN-MANIFEST.json` 已按本任务工作树重新生成 |
| 未做 / 不声称 | provenance、trusted publishing、signed/合规结论、公开仓 CI 实测 run |

