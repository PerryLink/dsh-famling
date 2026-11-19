# 插件内容常量单源生成 + JSDoc/checkJs/lint 最小链（MB-107 / E3）

> 状态：已实现并本机实测（2026-11-20，插件 0.10.9 工作树，未改版本、未 commit）。
> 范围：`plugins/dsh-famling`；共享权威仍是 famling 私有仓 `desktop-games`（本任务不修改它）。
> 验收对应：EXECUTION-STATUS MB-107 = “无内容目录/library→插件常量生成器；插件无 tsconfig.json/checkJs/JSDoc/lint 配置；compliance/EVENT_CLIPS 常量仍手冻（有 tests 冻结）”。

## 0. TL;DR

1. 新增 `scripts/gen-content-constants.mjs`：从 famling 的 `public/content/library.json`、三套 `public/characters/<dir>/{regions,behavior}.json`、三套动画 `manifest.json` 与法务 canonical 文档，生成 `client.js` 的两个 `@generated` 块：
   - `// <dsh-famling:content-constants:begin>` … `:end>`（对话模式、主题 id、背景、字体、角色 bundle、`SHARED_CONTENT_SEMANTICS`、`USAGE_DECLARATION`）；
   - `// <dsh-famling:event-clips:begin>` … `:end>`（`EVENT_CLIPS`、`MICRO_LINES`）。
2. 生成块带 `source-sha256`（对全部权威输入做确定性摘要）+ “do not edit” 警告；`npm run check` / `npm run check:content` 在块过期时红。
3. 单源不只覆盖内容目录：`EVENT_CLIPS` 也由三套 `behavior.json` 的 `rules + states.tag + ambient.choices` 与 `regions.json` 的事件面派生，`talk`/idle 明确为 `null`，目标 clip 必须是 manifest 真实 clip id；三套角色对同一事件必须一致，否则生成器报错。
4. 声明差异仍显式保留（D1–D4，见 §2.3），生成器只做确定性映射，不做“静默猜测”。
5. 检查链：`scripts/check-jsdoc.mjs`（零依赖：node --check + 导出 JSDoc 覆盖 + 生成块 banner/lint），`scripts/typecheck.mjs` + `scripts/tsconfig.checkjs.json`（checkJs，找不到 TypeScript 时诚实 skip），均接入 `package.json` 与 `release:check`。
6. 入口预算保持：生成后 `client.js` 97,005 B < 96 KiB（`FIRST_SCREEN_BUDGET_BYTES` 98,304 B，余量 1,299 B），`verify-anims` 通过（实测 94.7 KiB）。

## 1. 权威来源与产物

| 生成的常量 | famling 权威文件 | 说明 |
|---|---|---|
| `DIALOGUE_MODE_IDS` / `DIALOGUE_MODES` | `public/content/library.json.dialoguePacks` | `maxChars` / `bubbleChance` 原值；顺序保持 |
| `THEME_IDS` | `library.json.themes` | 去掉 plugin 未实现的 `high-contrast`（D3 显式 fallback，不静默丢） |
| `BACKGROUND_IDS` / `BACKGROUNDS` | `library.json.backgrounds` | `--dsh-famling-widget-bg` = 共享 `value`；widget-fg 是插件投影（D4 表） |
| `FONT_IDS` / `FONTS` | `library.json.fonts` | 本地字体栈原字符串 |
| `ROLE_IDS` / `ROLE_BUNDLES` | `library.json.rolePresets` + `characters[].products` | 可用性 = `products` 含 `dsh-famling`；canTts = `voiceId !== none`；sound = canTts && available |
| `SHARED_CONTENT_SEMANTICS` | `library.json` 顶层 + `rolePresets[].usageDeclaration/license/aiProvenance` + 法务文档 | schema/version/updatedAt/defaultRole/characterIdMap/statement/ref/SHA/license/AI provenance；SHA 重算并与法务文档交叉校验 |
| `USAGE_DECLARATION` | 同上 | `researchOnly + 6 prohibitedUses`；statement/ref/SHA 引用共享锚 |
| `EVENT_CLIPS` | 三套 `regions.json`（gestures/actions 事件）+ 三套 `behavior.json`（rules/states/ambient）+ 三套 `manifest.json`（clip id 校验） | 见 §2.1 |
| `MICRO_LINES` | 三套 `behavior.json.ambient.choices` + 插件 locale key 表（生成器内 `MICRO_LINE_KEYS`） | 见 §2.2 |

权威输入摘要（`source-sha256`，写进两个生成块的 banner）：

- `public/content/library.json`
- `public/characters/{pet-tinglan-anim,pet-cat,pet-dog}/behavior.json` 与 `regions.json`
- `public/assets/pet/anim/{human,cat,dog}/manifest.json`
- `docs/legal/USE-RESTRICTIONS-2026-11-19.md`

顺序固定、内容确定性着色：同一 famling 提交重复运行 `node scripts/gen-content-constants.mjs` 必须逐字节不变（有测试断言）。

## 2. 派生规则

### 2.1 EVENT_CLIPS

1. 事件面 = 三套 `regions.json` 的 `gestures[].event` ∪ `actions[].event` ∪ 三套 `behavior.json.ambient.choices[].state`（去掉 `idle` / `idle_blink`）。
2. 对每个事件、每个角色：`behavior.rules` 找 `on === event` → `to` 状态 → `states[to].tag`；`tag === "idle"` 映射为 `null`（只出气泡），否则必须是 manifest 的 clip id。
3. 三套角色必须得到同一个目标；任一角色缺 rule 或三套不一致 → 生成器 fail（不猜）。
4. 事件必须已在 `scripts/embed-anims.mjs` 的 `ACTION_EVENTS` 白名单内，否则报错要求先扩白名单 + verify。
5. 当前实测映射：`pat → pat_head`、`stand_wag`、`chase_tail`、`ball_throw`、`ball_chase`、`paw_face`、`scratch`、`run`；`feed → stand_wag`（behavior `feed → play → tag stand_wag`）；`talk → null`（`talk → idle`）。

### 2.2 MICRO_LINES

每个角色取 `behavior.ambient.choices` 的非 idle 状态，经 `states[state].tag` 得到 clip id，再映射到插件 locale key（`MICRO_LINE_KEYS`）。生成的 key 必须同时出现在 `client.js` 的 zh/en 文案表（≥2 次），由 `verify-anims` 与生成器共同校验。若 famling 新增 ambient 微动作而插件没准备文案 key，生成器 fail 并指出缺哪个 key。

### 2.3 已裁定插件差异（生成器内显式表）

| 编号 | 差异 | 生成器处理 | 测试 |
|---|---|---|---|
| D1 | 人形 id：famling `humanoid` vs 插件 `human` | `ROLE_BUNDLES[].character = preset.id`；映射写入 `characterIdMap` | parity：character map |
| D2 | origami 仅 famling 产品 | `available = characters[].products.includes("dsh-famling")`；`ROLE_IDS` 只含 available | parity / client-static |
| D3 | 插件无 high-contrast 主题 | `PLUGIN_THEME_FALLBACK = { "high-contrast": "night" }`；未知主题直接 fail | parity：theme ids |
| D4 | 插件 widget 调色板/字号/背景 fg 是宿主投影 | `THEMES` 仍手写（共享仅 default 气泡色，parity 冻结）；`BACKGROUND_FG` 表；字号 12/行高 1.5、`sound` 规则 | parity：frozen palette / role bundles |

`THEMES` 本体（default/paper/night 的完整 CSS 变量）刻意不在生成块内：SHARED-CONTENT-SEMANTICS D4 明确它是插件宿主投影，共享面只有 theme id/角色分配与 default 气泡色。生成器把 `THEME_IDS` 生成出来，`THEMES` 的 key 集合由 `client-static.test.js` 与 parity 测试约束。

## 3. 命令与失败处理

```powershell
# 重新生成两个 @generated 块（需要兄弟 famling checkout；可用 --famling 指定）
node scripts/gen-content-constants.mjs
# 过期门（干净插件 checkout 无 famling 时退化为静态 marker/语法检查，exit 0 并打印原因）
node scripts/gen-content-constants.mjs --check
```

- 默认 famling 路径：`<plugin>/../../desktop-games`；可用 `--famling DIR` 或 `FAMLING_REPO_DIR` 覆盖。
- `--check` 发现块过期 → exit 1，并提示运行 `npm run gen:content`。
- 生成前会自行 `new Function` 解析两个块并与派生模型逐值比对；写盘后仍可用 `npm run verify` 做浏览器契约级校验。
- 生成块内**禁止手改**：`lint` 会检查 banner/do-not-edit/marker 对唯一性，`check:content` 会因内容漂移直接红。

## 4. JSDoc / lint / checkJs 最小链

### 4.1 `npm run lint` = `scripts/check-jsdoc.mjs`（零依赖）

1. **语法**：对包内全部 `.js`/`.mjs` 跑 `node --check`（26 个文件实测）。
2. **JSDoc 覆盖**（`JSDOC_FILES`）：`content-extension.mjs`、`scripts/{gen-content-constants,check-jsdoc,typecheck}.mjs`——每个 `export const` 前必须有 `/** … */`；每个 `export function` 必须有 `@param`（含可选参数 `[name]`）与 `@returns`。本任务补齐了 `content-extension.mjs` 原先 16 处缺口（6 个导出常量 + 5 个 helper 的 param/returns + 其余函数注释）。
3. **生成物 lint**：`client.js` 的 `anims` / `content-constants` / `event-clips` 三个 marker 对必须各唯一且首尾有序；每块必须有 `@generated by scripts/…` 与 “do not edit”；三个懒加载 chunk 必须带 embed-anims banner。
4. **runtime lint**：7 个随包运行文件禁止 `debugger`。
5. **既有债务显式列出**：`scripts/{embed-anims,verify-anims,check-package,measure-bundle}.mjs` 的 JSDoc 覆盖尚未强制（先于 MB-107 存在、不在本任务授权范围），输出中逐文件列出，避免“静默通过”。

### 4.2 `npm run typecheck` = `scripts/typecheck.mjs` + `scripts/tsconfig.checkjs.json`

- scope：`scripts/*.mjs` 工具链 7 个文件（gen/check-jsdoc/typecheck/embed-anims/verify-anims/check-package/measure-bundle），`allowJs + checkJs + noEmit`。
- 解析顺序：`FAMLING_TSC` → 插件本地 `node_modules/typescript/bin/tsc` → 兄弟 `desktop-games/node_modules/typescript/bin/tsc` → `DSH_CHECKOUT/node_modules/typescript/bin/tsc`；`@types/node` 同理（`FAMLING_TYPES_ROOT` 可覆盖），由脚本把 `--typeRoots` 传给 tsc。
- **诚实 skip**：找不到 TypeScript/@types 时打印 `[typecheck] skipped: …` 并 exit 0；找到则真实跑 tsc，失败 exit 非 0。本机实测使用 `desktop-games/node_modules` 的 TypeScript 5.9.3，`[typecheck] checkJs ok`。
- 排除项（写进 `scripts/tsconfig.checkjs.json` 注释）：`client.js` / `client.content.js` / `client.anim.*.js` 不是 ES module（经 `window.__ModuleLoader__` 注册），无法直接 checkJs；`content-extension.mjs` 的 v3 校验器有约 40 个历史 `unknown` 收窄错误，属 MB-108 后续（其契约仍由 parity 测试 + JSDoc 门禁覆盖）。

### 4.3 package.json 接线

```json
{
  "check": "node scripts/embed-anims.mjs --check && node scripts/gen-content-constants.mjs --check",
  "gen:content": "node scripts/gen-content-constants.mjs",
  "check:content": "node scripts/gen-content-constants.mjs --check",
  "lint": "node scripts/check-jsdoc.mjs",
  "typecheck": "node scripts/typecheck.mjs",
  "release:check": "npm test && npm run check && npm run verify && npm run verify:package && npm run lint && npm run typecheck"
}
```

## 5. 测试与实测证据（2026-11-20）

| 命令 | 结果 |
|---|---|
| `node scripts/gen-content-constants.mjs --check` | `check ok`，`source-sha256 6b96ec3b…` |
| `node scripts/gen-content-constants.mjs` | `client.js updated (91,633 -> 96,737 B)`，补注释后最终 97,005 B；再跑一次 unchanged（幂等） |
| `npm test` | 200 → **216/216 pass**（新增 `test/content-constants.test.js` 9 条 + `test/jsdoc-chain.test.js` 7 条；原 200 条全绿） |
| `npm run check` | embed-anims `check ok` + gen content `check ok` |
| `npm run verify` | `verify-anims OK`；first-screen client.js **94.7 KiB**（<96 KiB） |
| `npm run lint` | syntax 24 files / JSDoc 58 exports / generated 3+3 / runtime 7 → ok |
| `npm run typecheck` | `[typecheck] tsc: …/typescript/bin/tsc` → `checkJs ok` |
| `npm run verify:package` | `check-package: pack ok`（20 packed files，tarball 290.8 KiB） |
| `npm run measure:bundle` | entry 94.7 KiB；first paint 156.5 KiB；all lazy 342.1 KiB（均低于拆分前基线）；内容 chunk 68.1 KiB |

新测试 `test/content-constants.test.js`：

- 生成块 banner/digest/唯一 marker；
- `--check` 当前块为最新；干净插件 checkout（`--famling /nonexistent/...`）退化为静态检查且 exit 0；
- `EVENT_CLIPS` 与**独立**从 behavior rules 重算的结果一致、目标 clip 真实存在、三套角色一致；
- `MICRO_LINES` 覆盖每个非 idle ambient 动作且 locale key 双语言存在；
- 内容常量与 library 逐字段一致（含 SHA 重算、D3 映射）；
- 生成器确定性 + 工作树不 stale；事件表无重复手写副本；设计文档随包发布。

跨仓 parity 仍由既有 `test/parity-contract.test.js`（13 条）与 famling `tests/parity-contract.test.ts`（12 条）覆盖，本任务未改动共享值，故全部保持绿。

## 6. 与其他任务/文档的关系

- MB-030/031（共享语义 + parity）：本任务把“手写冻结值”升级为“生成 + parity 复核”，共享值未变。
- MB-104（regions/behavior/插件 EVENT_CLIPS 单源）：本任务完成插件侧 `EVENT_CLIPS` 生成；famling 侧 `regions.json`/`behavior.json` 仍是手写权威（未在本任务授权范围），生成器只读。
- MB-103（动画 timing 单源）/ embed-anims：互不冲突；`client.js` 内三块 marker 独立，各自 `--check`。
- SHARED-CONTENT-SEMANTICS §2 表：第 7/9–14/20 面现在由生成器保证；改共享值流程仍按该文档 §5（先改 famling，再跑 `npm run gen:content` + 两端 parity）。
- `README.md` 已按 lead 授权同步“EVENT_CLIPS 不再手写 / 单源与检查链”两行；`docs/DETAIL.md` 增补生成器与门禁指针。

## 7. 残余与后续

1. **无 git/CI 提交证据**：插件目录当前无 git（MB-004 延续），本任务只在工作树落地，未 commit/push。
2. **根 `tsconfig.json` 未新增**：本任务 write scope 不含包根新文件，故 checkJs 配置放在 `scripts/tsconfig.checkjs.json`，由 `npm run typecheck` 消费；若希望编辑器默认发现，需再授权新增根 `tsconfig.json`（内容可 `extends: "./scripts/tsconfig.checkjs.json"`）。
3. **content-extension.mjs 未进 checkJs**：约 40 个既有 `unknown` 收窄错误，留给 MB-108；当前由 JSDoc 门禁 + parity 契约双层覆盖。
4. **4 个既有 scripts 的 JSDoc 债务**：embed-anims/verify-anims/check-package/measure-bundle，已显式列出，可作 MB-108 子项。
5. **生成器依赖兄弟 checkout**：干净插件 checkout 的 `check:content` 只做静态 marker/语法检查；要验证内容漂移需在含 famling 的工作区运行（与 embed-anims 同策略）。
