# 只读审批等待镜像（P0，2026-11-25）

> 目标版本：dsh-famling 0.14.0 P0-1/2/3 的**只读**子集。本文记录实现边界、验收证据与明确未做项。
> 状态：代码与单测已落地；**未**在真实 DSH 宿主做冒烟（本工作副本没有可构建的 DSH 运行环境），因此不得据此宣称"已兼容真实审批事件"。
> 相关规范：`famling-art-rebuild/work/research/02-dsh-integration.md` §2.2 / §4 / §5 P0-1..P0-3。

## 1. 一句话

宿主进程观察 DSH `approval/request` waterfall，只保留 **`{available, pending, oldestAt}`** 三个标量；`state` bridge op 以 **additive** 字段 `approvals` 下发；客户端在等待确认时用既有可访问气泡通道显示一句本地化提示。宠物**没有**审批权，也读不到任何审批内容。

## 2. 隐私边界（硬约束）

新增数据白名单（Host 内存 + bridge 下行）：

| 字段 | 类型/界 | 语义 | 落盘/日志/网络 |
|---|---|---|---|
| `approvals.available` | boolean | 观察者是否成功挂上 `approval/request` | 否 |
| `approvals.pending` | int 0..8 | 当前等待决策的请求数（clamp） | 否 |
| `approvals.oldestAt` | epoch ms \| null | 当前等待 episode 最早开始时间；pending=0 时恒为 null | 否 |

**永不读取/存储/透出**：`toolName`、`reason`、`displayReason`、`callId`、`agent`、session id、工具参数、文件路径、prompt、审批历史/结果、`req.signal` 内容。观察者函数完全不接触 request 形参（单测用"任何属性访问即抛错"的 Proxy 证明）。`reason` 被视同 prompt 级敏感数据。

新增权限面：0。无新网络目标、无新 `localStorage` 键、无系统通知、无 client inject、无版本/清单改动（本次不升版本、不重生成 PLUGIN-MANIFEST）。

## 3. Host 侧实现（`index.js`）

- `trackHostState` 内新增观察者：`ctx.on('approval/request', handler, { prepend: true })`，置于最外层，保证官方 answerer 链仍按原顺序运行（prepend 后仍是"外→内"）。
- **绝不否决**：handler 结构固定为 计数 → `result = next()` → 返回该结果；同步抛错先减计数再原样抛出；promise 只附加 settlement 观察（`then(减计数, 减计数)`），**返回的仍是 next() 的原 promise 对象**，不包装、不改值、不改 rejection。官方 `'never'` 策略在 service 内先于 waterfall 生效，观察者无法绕开。
- 计数：`min(pending+1, 8)`；settle 时 `max(0, pending-1)`，归零时 `oldestAt=null`。`oldestAt` 语义是"当前等待 episode 的首个开始时间"，episode 内不会回退（无法逐请求归因也正是隐私设计的结果）。
- 能力探测即事件订阅本身：`ctx.on` 不存在/抛错 → `approvals.available=false`；`agent/status` 订阅成功但 `approval/request` 订阅失败 → state 仍 available，但 `approvals.available=false`，不伪造 0 支持。
- 闭式快照：`HOST_STATE_FIELDS` 追加 `approvals`；`approvals` 必须恰好 3 个键、值与界合法、`pending=0 ⇒ oldestAt=null`、`available=false ⇒ pending=0`；任何未知键/越界整体回退 `HOST_STATE_UNAVAILABLE`（其中 approvals 为 unavailable 形状）。`hostStateReportValid` 已导出供审计/测试。
- wire 仍为 **2**；旧 client 忽略新子对象；旧 Host 不发送该字段。`hello/probe` 的 capabilities **未**新增 approval 键（本 P0 最小集，见 §6）。

## 4. Client 侧实现（`client.status.js` + 1 行 `client.js` 接线）

- `readStateReport` 对可选 `approvals` 做闭式校验：缺省（旧 Host）→ `{available:false,pending:0,oldestAt:null}`；出现但含未知键/类型错/越界/不一致 → 整份 reply 判为非法（fail-closed，静默重试，不伪造 0）。
- `watchHostStatus(callBridge, statusRef)`：handle 暴露 `approvalAvailable / approvalPending / approvalOldestAt`；失败或 unsupported 时重置为 unavailable/0/null，不残留"等待中"。
- 提示：**每次等待 episode（pending 0→N）只提示一次**，之后同一 episode 内计数变化不重复；归零后再次出现才算新 episode。文案为固定本地拷贝（zh: `有 N 个确认在等`；en: `N approval(s) are waiting`），由 chunk 按 `navigator.language` 选择。只把整数计数交给入口。
- 展示通道复用既有气泡：`client.js` 只把自身 `statusRef` 传给 watcher（+11 B），chunk 在 episode 开始时调用 `statusRef.current.say(line,'speech','status')`。该气泡本来就带 `role="status"` + `aria-live="polite"`，并受既有低打扰闸门约束（气泡开关、页面可见、安静时段）；因此是"可访问的一行提示"，不是新的常驻 DOM 徽标。
- 无新网络/存储/通知/决策回调；kit 仍保持"无 document、无 localStorage、无 fetch、<8 KiB"静态不变量。

## 5. 边界与已知行为

| 场景 | 行为 |
|---|---|
| 并发 >8 | 显示上限 8（clamp），实际可能更多；文档与代码一致，不谎报精确值 |
| 同一 episode 计数 1→3→0 | 只提示一次（用首次观测到的 N） |
| 观察者以后 promise 恢复 | 一次失败轮询会清零 handle，恢复后若仍 pending 会再次提示（宁可多一次，不装作没等待） |
| 决策被拒绝/取消/同步抛错 | 计数先归零再原样传播，不会卡在"等待中" |
| 旧 Host（无 event API / 无该字段） | state 仍按旧四态工作；approvals 如实 unavailable/零 |
| 畸形 approvals | 客户端判整份 reply 非法；Host 端闭式校验回退 unavailable |
| 页面隐藏/安静时段/关闭气泡 | 不弹提示（沿用低打扰）；计数仍在本机 handle 内 |

## 6. 明确未做（Not built）

1. **不在宠物上做 Allow/Deny**：DSH 0.2.x 无第三方 answerer 契约；本 P0 零决策权。
2. **无常驻小徽标**：入口字节被 31%/200 B 双门禁锁死（当前 entry=97,572 B），本 P0 只做既有气泡内的一行可访问提示；常驻 HUD 徽标/面板留给懒加载 chunk（P1）。
3. **无逐条列表/会话归属**：不读 id，只可能是聚合计数。
4. **无审批 TTL/自愈扫描**：依赖 answerer promise 的 settlement（官方 `cancelled` 也会 settle）；若宿主出现"永不 settle"的第三方 answerer，计数会保持——这是当前设计已知风险。
5. **无 hello/probe capability 行**、无 `test/dsh-host-smoke.mjs` 真机断言（P0-4 未做，需要可运行的 DSH checkout）。
6. 不读 `approval/asked`/`approval/decided` 审计事件（需要 session id/日志，违背隐私承诺）。
7. 不升版本、不重生成 PLUGIN-MANIFEST、不动 anim chunks。

## 7. 验收（本地单测，已运行）

```bash
cd repos/dsh-famling
node --test test/host-bridge.test.js      # 47 pass (9 new approval-mirror tests)
node --test test/client-status.test.js    # 10 pass (5 new approval/static tests)
node --test test/client-static.test.js    # 37 pass / 1 pre-existing skip (预算门禁含 status kit <8 KiB)
node --test test/version-truth.test.js    # 3 pass (版本未变)
```

覆盖点：
- Host：prepend 选项、同步/异步/reject/同步抛错 的 0→1→0 生命周期、并发独立计数、clamp 8、oldestAt 语义、事件 API 缺失与 approval 订阅失败降级、request 字段零读取（Proxy）、state 输出零敏感字段、`hostStateReportValid` 未知/畸形 approvals 全部拒绝。
- Client：旧 Host 缺省、畸形 approvals fail-closed、handle 计数/时间戳、每一 episode 仅一次提示（zh/en）、失败轮询清零、回调抛错不影响轮询、静态"无 toolName/reason/callId/storage/document/Notification/fetch"。
- 静态预算：`client.status.js` 8,179 B < 8 KiB；`client.js` 97,572 B（31% 门禁 97,576 B、focus 门禁基线 97,558 + 200 B 内）。
- 已知未跑：`npm test` 全量会因 PLUGIN-MANIFEST 漂移门禁失败（本任务明确不重生成清单），属发布集成步骤，不是本 P0 缺陷。

## 8. 变更文件

- `index.js`：approval 常量/跟踪/快照/闭式校验；`hostStateReportValid` 导出。
- `client.status.js`：approvals 解析、handle 字段、episode 一次性提示、语言拷贝。
- `client.js`：1 行接线（把 `statusRef` 交给 watcher）。
- `test/host-bridge.test.js`、`test/client-status.test.js`：新增/更新用例。
- 本文档。

## 9. 剩余风险

- **未做真实宿主验证**：`approval/request` 在 0.2.2-rc.5 之外版本的存在性未实测；能力探测只在订阅层，订阅成功≠事件一定会派发（旧宿主可能 available=true 但长期 0，客户端不会误报等待，仅"支持"语义略宽）。
- **轮询延迟**：沿用既有 30 s 定频轮询，最坏情况下审批出现后 30 s 才被看到；自适应轮询（working 3 s / idle 30 s）属于 P1-1，不在本 P0。低打扰/静默时只有计数没有视觉提示，也是本 P0 "不做常驻徽标"的直接后果。
- **prepend 依赖 cordis listener options**：若某宿主忽略 `ctx.on(name, fn, {prepend:true})` 的第三参，观察者仍不会否决审批，但可能在官方 answerer 认领之后才运行、永远看不到请求（available=true 而 pending 恒 0）；这不是安全缺陷，但会让 HUD 静默失效。
- 入口字节余量仅 **4 B**（31% 门禁 97,576 B / entry 97,572 B）；任何后续 entry 改动都必须同步重算 31%/200 B/75% 预算门禁，禁止"先超再放宽"。
- `client.status.js` 余量仅 **13 B**（8,179 / 8,192 B），后续只能"等字节换字节"。
- clamp=8 与 oldestAt episode 语义在高并发下的展示精度有限（设计取舍）。
- 无 TTL 自愈：依赖 promise settlement；若上游 answerer 永不 settle，HUD 会保持等待态。
