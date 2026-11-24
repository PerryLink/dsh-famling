# DSH 兼容矩阵与自检说明

> 本文件说明本插件（`dsh-famling`）如何声明与验证对 DeepSeek Harness（DSH）的兼容性。依据 DSH 自带参考文档（`dsh-doc` skill 的 `host-plugin.md`、`dsh-version.md`、`plugin-development.md`）整理；所有声明都可用离线脚本复核。

## 1. engines.dsh 语义

- DSH 在安装与激活时用**运行版本**校验 `engines.dsh`。该字段一旦存在就**单独决定**是否兼容，DSH 侧 `peerDependencies` 范围被忽略；字段为空、非法或使用 `workspace:` 会被拒绝，非字符串则清单非法。
- **预发布版本参与匹配**：例如 `^0.2.2-alpha.2` 接受 `0.2.2-rc.1`、`0.2.2`、`0.2.9`，但不接受 `0.3.0`。
- 本包当前声明是**兼容区间**而不是单点：

```text
>=0.2.1-rc.5 <0.3.0 || >=0.2.2-0 <0.3.0 || >=0.2.3-0 <0.3.0-0
```

三段分别覆盖：`0.2.1-rc.5` 起的 0.2.1 线；`0.2.2-0` 起的 0.2.2 预发布与 0.2.2 线；`0.2.3-0` 起的 0.2.3 预发布（上界 `<0.3.0-0` 排除 0.3.0 的全部预发布）。之所以按 minor 逐段写，是因为 SemVer 的预发布规则要求目标版本的 `major.minor.patch` 与某个带预发布后缀的 comparator 相同；单一区间会漏掉后续 minor 的预发布宿主。
- **维护建议**（来自 DSH 的 `dsh-version` 参考）：以实际运行的 DSH 版本为下界、预发布后缀原样复制；新宿主版本发布后，先用 `node scripts/verify-dsh.mjs --dsh-version <版本>` 和真实宿主冒烟复核，再收紧或放宽区间。不要假设 `^0.2.2` 能接受 `0.2.2-alpha.2`（它会拒绝）。

## 2. dsh.compatibility.dshReleases 三版矩阵

| DSH 版本 | 状态 | 验证方式 |
|---|---|---|
| `0.2.2-rc.5` | `compatible` | 该版本区间内 + 宿主冒烟/契约门 |
| `0.2.3-alpha.1` | `compatible` | 该版本区间内 + 离线自检 |
| `0.2.3-alpha.2` | `compatible` | 该版本区间内 + 离线自检 |

维护约定：

1. **只保留最新三版**，新增一版时移除最旧一版；
2. 值只能是 `compatible` / `incompatible` / `unknown`（区分「已验证可用」「已验证不兼容」「尚未验证」）；
3. 该字段**不是 DSH 安装闸门**（安装/激活只看 `engines.dsh`），但第三方 Store 与索引会读取它；
4. 标为 `compatible` 前必须同时满足：`engines.dsh` 接受该版本、`node scripts/verify-dsh.mjs --dsh-version <版本>` 通过、并在该版本宿主上完成冒烟验证（无宿主时用 `unknown`，不要猜）；
5. 矩阵项与 `engines.dsh` 必须自洽——`verify-dsh` 会检查每个 `compatible` 项都落在引擎区间内。

## 3. verify-dsh 用法与退出码

```text
node scripts/verify-dsh.mjs                       # 校验当前包
node scripts/verify-dsh.mjs --dsh-version 0.2.3-alpha.2
node scripts/verify-dsh.mjs --json                # 机器可读
node scripts/verify-dsh.mjs --root <另一个包副本目录>
```

退出码：`0` 全部通过；`1` 至少一项失败；`2` 用法错误（未知参数、非法版本号、root 不是目录）。`--json` 输出形状：`{ ok, target, dshVersion, checks: [{ id, ok, detail }] }`。脚本纯 Node、零依赖、不联网，可在插件目录或临时副本上运行，也适合接入 CI 与发布门禁。

检查项（组）：

1. **package 元数据**：name / semver version / license / repository + homepage + bugs；`main` 指向包内文件；`icon` 为包内相对路径、格式受支持且不超过 256 KiB；`exports[./package.json]` 存在。
2. **DSH 清单**：`dsh.bundle.patch` 指向真实文件，解析后 `insert` 首项 `id` 与 `name` 都等于包名；`dsh.client.platform` 为 `web`、`immediately` 为 `false`、`inject` 为非空字符串数组且每项以 `@deepseek-ai/` 开头。
3. **兼容矩阵**：`dshReleases` 为普通对象且 1..3 项、键为 semver、值为允许枚举；给出 `--dsh-version` 时校验引擎区间接受该版本、矩阵项（若有）为 `compatible`。
4. **客户端产物**：`client.js` 通过 `window.__ModuleLoader__.load` 注册且模块 id 为包名；三个 `client.anims.*.js` chunk 存在并以同一 id 注册；生成块 begin/end 成对；`client.js` 与 `client.content.js` 的 `PLUGIN_VERSION` 与 package.json 一致。
5. **资源/文档**：`cordis.patch.yml`、`icon.png`、`locale/zh.json` 与 `locale/en.json`（可解析、`meta.version` 一致、`meta.title` / `meta.description` 非空）、`meta.detail` 指向包内现存文件且不超过 1 MiB（DSH `pluginManager.detailMaxBytes` 默认值）、`docs/DETAIL.md`、`README.md`、`LICENSE`、`LICENSE-ART`、`NOTICE`。
6. **卫生**：打包文本文件不含私有机器绝对路径（Windows 盘符路径、WSL 挂载路径、Unix home 目录路径、file URL）与 `sk-` 形态的疑似密钥；`~` 缩写只允许插件明示的用户本机数据路径（Advisers 简报、DSH home、浏览器缓存）。
7. **files 白名单**：每个条目至少展开出 1 个真实文件；所有必需运行时文件、`main` / `icon` / 各 `exports` 目标都被白名单覆盖。

## 4. 与 DSH 插件清单规范对照

| 清单字段 | 本包取值 | DSH 侧读取与要求 | verify-dsh 检查 |
|---|---|---|---|
| `main` | `index.js` | 包根插件 Host 半入口 | `package-main` |
| `icon` | `icon.png` | 包根 icon 优先于 `./icon`；SVG/PNG/JPEG/WebP，不超过 256 KiB，包内相对路径，拒绝 URL、绝对路径与逃逸符号链接 | `package-icon` |
| `exports[./package.json]` | `./package.json` | DSH 通过它读取清单与 icon 等元数据 | `package-exports` |
| `exports[./locale/*.json]`、`exports[./icon]` | 同路径 | Plugin Manager 不激活插件即读取 `meta.title` / `meta.description` / `meta.detail` 与图标 | `locale-meta` / `locale-detail` / `files-required` |
| `dsh.bundle.patch` | `./cordis.patch.yml` | patch 的 `insert` 首项 id/name 必须与包名一致 | `patch-file` / `patch-insert` |
| `dsh.client.platform` / `immediately` / `inject` | `web` / `false` / 3 个 `@deepseek-ai/*` | footer 入口不阻塞首屏；注入宿主 UI 包才可注册 | `dsh-client-*` |
| locale `meta.detail` | `docs/PLUGIN-PAGE.md` | 插件详情页文档；缺省回退 README；文件缺失、超限或格式错会显示失败而不是回退 | `locale-detail` |
| `files` | 运行时文件 + `docs` + `icon.png` + locale | 打包后仍须包含 patch、locale、detail 文档目录、图标与全部运行时文件 | `files-allowlist` / `files-required` |

## 5. 已知降级与边界

- Host 能力协商：Hello/Probe 握手缺 `llm` 时聊天输入禁用并明示、缺 `schedule` 时提醒入口降级；老 Host 不响应 hello 时进入兼容模式并保留旧行为，**不伪造回复或提醒**。
- 宿主工作状态：新增的 `workState` / `workSince` 字段为可选追加；旧 Host 缺少字段时客户端按 idle 处理，旧客户端遇到未知字段 fail-closed（可接受降级）。
- 客户端产物一致性：`verify-dsh` 只负责模块 id、版本、生成块成对等清单级不变量；动画帧与内容常量的一致性由 `scripts/embed-anims.mjs --check`、`scripts/verify-anims.mjs`、`scripts/gen-content-constants.mjs --check` 负责。
- 本文件描述的是**声明的兼容区间与本地可验证的不变量**，不等于已在所有宿主版本上完成渲染验收；真实安装与渲染仍需按 `docs/DSH-HOST-SMOKE-2026-11-21.md` 的口径做宿主冒烟。
