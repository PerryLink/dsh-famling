/* dsh-famling panels (package-local lazy chunk): content center + settings
 *
 * Loaded by client.js through the DSH module table's require.async only when
 * the content center or the unified settings popup is opened. It is pure UI
 * over the catalog/props passed in by client.js: no network requests, no file
 * access, no eval/new Function, no innerHTML and no pack/asset loading. The
 * content center has four tabs (roles / customize / packs / market); a role IS
 * the theme bundle. The settings popup centralizes every adjustable item and
 * folds the advanced/debug group, including the data/boundaries section (sending
 * destination, crisis resources, AI-chat switch, clear-local-data/withdrawal).
 * The one-time first-run safety card (MB-021) is also rendered from this chunk so
 * the first-screen entry budget is not charged for it.
 *
 * The chunk registers the same package module id and a "chunk" file name the
 * DSH client module loader accepts; client.js keeps the first-screen entry
 * inside its 72 KiB budget by keeping this UI out of client.js.
 */
window.__ModuleLoader__.load({
  id: 'dsh-famling',
  chunk: 'client.content.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const DECLARATION_TOKENS = [
      'emotional-companionship', 'virtual-partner', 'professional-advice',
      'minor-intimacy', 'impersonation', 'illegal-use',
    ]
    const BUILTIN_PACK = { id: 'dsh-famling.builtin', entries: 4, source: 'bundled' }
    // Frozen first-party compliance anchors, shared with content-extension.mjs v3
    // (CONTENT_LICENSE_TEMPLATE / CONTENT_AI_PROVENANCE_TEMPLATE) and the client
    // SHARED_CONTENT_SEMANTICS block. Metadata only: the UI never fetches or
    // opens anything; parity tests freeze these values against both ends.
    const BUILTIN_COMPLIANCE = {
      license: {
        spdx: 'LicenseRef-PolyForm-Noncommercial-1.0.0',
        attribution: 'Famling maintainers; placeholder art under LICENSE-ART (CC BY-NC-SA 4.0)',
      },
      aiProvenance: {
        generated: false,
        disclosure: '内置占位像素帧由确定性脚本生成，未使用生成式 AI；最终美术替换后须更新本声明。',
      },
      compatibility: { schemaVersion: 3, minPluginVersion: '0.10.9' },
    }
    const PLUGIN_VERSION = '0.10.9'

    const STRINGS = {
      zh: {
        title: '内容中心', close: '关闭',
        settingsTitle: '设置', settingsHint: '常用设置在前；高级与调试折叠在下面。',
        scaleGlobal: '整体缩放（所有内容一并缩放）',
        scaleGlobalHint: '100% = 默认大小；角色、UI/文本、气泡与面板一起缩放，窗口放不下时自动贴合、不裁切。',
        scaleReset: '恢复默认缩放',
        scaleGroup: '缩放（独立轴）', scaleUiText: 'UI + 文本', scaleImage: '图像',
        scaleFollow: '跟随整体', scaleFollowing: '跟随整体', scaleIndependent: '独立',
        scaleUiTextHint: '100% = 跟随整体缩放；单独调整后只有 UI/文本变化，角色图像不动。',
        scaleImageHint: '100% = 跟随整体缩放；单独调整后只有角色/预览图变化，UI/文本不动。',
        scaleComponentsTitle: '组件缩放（默认全部继承）',
        scaleComponentsHint: '组件缩放比「整体缩放」更下一级：默认继承 UI + 文本；只覆盖需要单独调整的组件，可随时恢复继承。',
        scaleInherit: '继承（跟随 UI + 文本）', scaleActual: '实际 ',
        commonGroup: '常用', appearanceGroup: '外观', roleGroup: '角色与内容', memoryGroup: 'Advisers',
        lowDisturbGroup: '低打扰',
        quietHours: '安静时段',
        quietEnabled: '开启安静时段（暂停自动气泡与自动微动作）',
        quietHint: '安静时段内不产生自动气泡/微动作；点击、菜单互动与聊天回复仍可用。',
        quietStart: '开始', quietEnd: '结束',
        quietNow: '当前在安静时段内', quietOutside: '当前不在安静时段', quietOff: '已关闭',
        motionPref: '动画偏好', motionAuto: '跟随系统', motionOn: '允许动画', motionOff: '减少动态',
        motionHint: '默认跟随系统 prefers-reduced-motion；也可显式允许或减少动画。',
        motionSystemReduce: '系统已请求减少动态', motionSystemAllow: '系统未请求减少动态',
        hide: '暂时隐藏', hideHour: '隐藏 1 小时', hideTomorrow: '隐藏到明天',
        hideHint: '隐藏期间不显示角色与气泡；可点「显示」提前恢复，或到时间自动恢复。',
        consentAsr: '语音输入前需独立确认：浏览器语音识别可能把音频发送给浏览器厂商；仅在你点击麦克风后录音，可随时关闭。',
        allow: '同意并开启', cancel: '暂不开启',
        sound: '语音朗读', mic: '语音输入',
        notice: '使用限制与版本',
        useRestrictions: '⚠️ 使用限制：本项目及全部代码、美术、音频、文案、角色素材仅用于技术研究与原型验证，不得用于情感陪伴、虚拟伴侣、医疗/心理/法律/金融建议或任何违规用途。',
        memory: '读取 Advisers 摘要',
        motion: '帧动画', bubble: '说话气泡', showMenuButton: '显示菜单按钮',
        menuButtonHint: '默认关闭：右键角色或按 Shift+F10 / ContextMenu 打开菜单；开启后角色旁出现「⋯」。',
        advancedGroup: '高级 / 调试', version: 'dsh-famling ' + PLUGIN_VERSION + ' · 研究原型', debug: '当前状态', storageKeys: '本地存储键',
        hostGroup: 'Host 连接与能力', hostStatus: '握手', hostReady: '已握手（hello）', hostLegacy: '兼容模式（宿主未响应 hello）', hostPending: '检测中…',
        hostVersion: '宿主版本', hostWire: '桥接契约', hostContent: '内容扩展契约', hostDegraded: '降级项',
        hostCapLlm: '模型服务', hostCapSchedule: '提醒服务', hostCapBrief: 'Advisers 简报',
        hostAvailable: '可用', hostUnavailable: '不可用', hostUnknown: '未知',
        hostMismatch: '插件版本与宿主不一致：请刷新页面或重装插件；不匹配时不会崩溃。',
        hostNoLlm: '未连接模型服务：聊天已降级关闭，不会伪造回复。',
        hostNoSchedule: '当前宿主不支持提醒服务：提醒入口已禁用。',
        probeHost: '重新检测 Host 能力', probeHint: '通过 hello/probe 重新读取宿主能力；不会调用模型或创建提醒。',
        noModelDetail: '未连接模型服务（宿主缺少 llm）：发送不会调用任何模型，也不会伪造回复。',
        noScheduleDetail: '当前宿主不支持提醒服务（schedule）：提醒已禁用。',
        dataGroup: '数据与边界', chat: 'AI 聊天（发送给模型供应商）',
        chatHint: '默认开启：聊天文本经 DSH Host 发送给 DSH 中配置的模型供应商；关闭后不发送任何聊天文本（提醒仍可用）。',
        boundaryHint: '本插件只运行在 DSH 内：模型、Key、会话与供应商数据由 DSH 和你配置的供应商管理；插件不保存聊天记录。',
        clearLocal: '清除本机设置与同意', clearHint: '仅删除本插件在浏览器 localStorage 的 dsh-famling/* 键（设置、形象、外观、同意记录）；不改 DSH 宿主数据或供应商侧数据。',
        firstRunTitle: '首次使用说明', firstRunAck: '我知道了',
        where: '发送去向：文本会经 DSH Host 发给 DSH 中配置的模型供应商；请勿发送密码、他人隐私或客户资料。',
        crisisLine: '心理危机可联系 12356（心理援助）；紧急情况 110（报警）/ 120（急救），或信任的人与专业机构。',
        clearDone: '已清除本机设置与同意（含撤回语音同意）；再次修改设置前不会写回存储。',
        contentEntry: '内容与角色…', hideBrief: '隐藏',
        tabs: { roles: '角色', custom: '自定义', packs: '内容包', market: '市场' },
        rolesHint: '角色就是主题：一键应用会同时切换声音 / 对话 / 外观（气泡 / 面板风格 / 字体）。',
        current: '当前', applyRole: '一键应用', currentRole: '当前角色',
        voice: '声音', dialogue: '对话', look: '外观',
        voiceSpeech: '浏览器 TTS', voiceSilent: '无声思考气泡',
        roleReserved: 'Origami 角色包为预留项：素材尚未安装，暂不提供一键应用。',
        characters: { human: '汀岚', cat: '塞尔凯克卷毛猫', dog: '金毛', origami: '折纸' },
        characterDescriptions: { human: '安静简洁的工作搭子', cat: '懒散高冷的卷毛灰白猫', dog: '友善热情的金毛寻回犬', origami: '预留的折纸角色' },
        customHint: '仅修改当前角色的搭配，不改变角色预设；切换角色会应用新角色的一整套声音 / 对话 / 外观。',
        preset: '角色预设', overridden: '已自定义（覆盖角色预设）', restoreRole: '恢复角色默认',
        voiceGroup: '声音（TTS 策略）', dialogueGroup: '对话模式', themeGroup: '气泡 / 面板主题', backgroundGroup: '背景', fontGroup: '字体',
        voiceList: '声音（系统）', voiceSystem: '系统默认声音', voiceEmpty: '浏览器暂未提供声音列表。',
        voiceSilent: '塞尔凯克卷毛猫 / 金毛只用「心里话」思考气泡，没有语音（不会调用浏览器 TTS）。',
        consentTts: '开启语音朗读前需独立确认：使用浏览器系统语音，不是 DeepSeek stella/tide；回复文本会被朗读，可随时关闭。',
        dialogueModes: { standard: { name: '标准', desc: '完整回话与气泡' }, brief: { name: '简短', desc: '过滤过长回话' }, quiet: { name: '安静', desc: '降低气泡出现频率' } },
        themes: { default: { name: '默认', desc: '白底深色字' }, paper: { name: '纸张', desc: '暖米色纸感气泡' }, night: { name: '夜间', desc: '深色气泡与面板' } },
        backgrounds: { transparent: '透明', paper: '纸张', dark: '暗色' }, backgroundDescriptions: { transparent: '透明，不画背板', paper: '暖白纸张背板', dark: '深色背板' },
        fonts: { system: '系统', serif: '衬线', mono: '等宽' }, fontDescriptions: { system: '系统 UI 本地字体栈', serif: '衬线本地字体栈', mono: '等宽本地字体栈' },
        fontSize: '字号', lineHeight: '行高',
        packsHint: '本版本只加载包内内置内容；外部内容包需要未来 Host 集成加载器。',
        installed: '已安装内容包', builtinPack: '内置角色主题包（4 个角色 bundle）', bundled: '随插件内置',
        externalEmpty: '没有导入的外部内容包。',
        declaration: '防违法用途声明检查', declarationOk: '通过：researchOnly=true，六项禁止用途全部声明。', declarationFailed: '未通过：',
        declarationDetail: '禁止用途：情感陪伴 / 虚拟伴侣 / 专业建议 / 未成年人亲密 / 冒充真人或官方 / 违法用途。',
        importPack: '导入内容包（需 Host 支持）',
        importHint: '资产包（zip / 文件夹）导入接口预留：清单与 sha256 由 Host 解析；本版本不读取文件、不执行脚本、不加载素材、不联网。',
        compliance: '合规元数据（content-extension v3）',
        licenseLabel: '许可与署名', aiLabel: 'AI 来源', compatLabel: '兼容性',
        packsNoNetwork: '内容包只做纯数据校验（content-extension.mjs v3）：用途声明、许可、AI 来源与兼容性字段都按纯数据校验，不执行脚本、不联网。',
        marketStatus: '远程市场接口已预留，服务器未配置。',
        marketNoNetwork: '不会发起任何网络请求，也不会展示伪造商品；市场加载器需由未来 Host 显式启用。',
        catalogUrl: '目录地址 / catalog URL', configKey: '配置键 / config', notConfigured: '未配置',
        marketReserved: '字段已预留：catalogUrl / configKey；当前仅展示占位信息，不拉取目录。',
      },
      en: {
        title: 'Content Center', close: 'Close',
        settingsTitle: 'Settings', settingsHint: 'Common settings first; advanced/debug fold below.',
        scaleGlobal: 'Overall scale (everything together)',
        scaleGlobalHint: '100% = shipped size; character, UI/text, bubbles and panels scale together and auto-fit the window instead of clipping.',
        scaleReset: 'Reset scale',
        scaleGroup: 'Scale (independent axes)', scaleUiText: 'UI + text', scaleImage: 'Image',
        scaleFollow: 'Follow overall', scaleFollowing: 'follows overall', scaleIndependent: 'independent',
        scaleUiTextHint: '100% = follow the overall scale; when changed on its own only UI/text moves, the character image stays.',
        scaleImageHint: '100% = follow the overall scale; when changed on its own only the character/preview image moves, UI/text stays.',
        scaleComponentsTitle: 'Component scale (inherit by default)',
        scaleComponentsHint: 'One level below the overall scale: every component inherits UI + text by default; override only what you need and restore inheritance at any time.',
        scaleInherit: 'Inherit (follow UI + text)', scaleActual: 'actual ',
        commonGroup: 'Common', appearanceGroup: 'Appearance', roleGroup: 'Role & content', memoryGroup: 'Advisers',
        lowDisturbGroup: 'Low disturbance',
        quietHours: 'Quiet hours',
        quietEnabled: 'Enable quiet hours (pause automatic bubbles and micro actions)',
        quietHint: 'During quiet hours no automatic bubbles or micro actions appear; taps, menu actions and chat replies still work.',
        quietStart: 'Start', quietEnd: 'End',
        quietNow: 'currently inside quiet hours', quietOutside: 'currently outside quiet hours', quietOff: 'off',
        motionPref: 'Animation preference', motionAuto: 'Follow system', motionOn: 'Allow animation', motionOff: 'Reduce motion',
        motionHint: 'Defaults to the system prefers-reduced-motion setting; you can also allow or reduce motion explicitly.',
        motionSystemReduce: 'the system requests reduced motion', motionSystemAllow: 'the system does not request reduced motion',
        hide: 'Hide temporarily', hideHour: 'Hide for 1 hour', hideTomorrow: 'Hide until tomorrow',
        hideHint: 'While hidden the character and bubbles are not shown; click "Show" to restore early or wait for the deadline.',
        consentAsr: 'Voice input needs separate confirmation: browser speech recognition may send audio to the browser vendor; the microphone starts only after your click and can be switched off.',
        allow: 'Agree and enable', cancel: 'Not now',
        sound: 'Voice', mic: 'Voice input',
        notice: 'Usage & version',
        useRestrictions: '⚠️ Use restriction: this project and all code, art, audio, text and character assets are for technical research and prototype validation only. Do not use them for emotional companionship, virtual partners, medical/psychological/legal/financial advice, or any unlawful purpose.',
        memory: 'Read Advisers summary',
        motion: 'Frame animation', bubble: 'Speech bubble', showMenuButton: 'Show menu button',
        menuButtonHint: 'Off by default: right-click the pet or press Shift+F10 / ContextMenu; when on, a "⋯" appears next to the pet.',
        advancedGroup: 'Advanced / debug', version: 'dsh-famling ' + PLUGIN_VERSION + ' · research prototype', debug: 'State', storageKeys: 'Local keys',
        hostGroup: 'Host connection & capabilities', hostStatus: 'Handshake', hostReady: 'handshaken (hello)', hostLegacy: 'compatible mode (Host did not answer hello)', hostPending: 'detecting…',
        hostVersion: 'Host version', hostWire: 'Bridge contract', hostContent: 'Content-extension contract', hostDegraded: 'Degraded',
        hostCapLlm: 'LLM service', hostCapSchedule: 'Schedule service', hostCapBrief: 'Advisers brief',
        hostAvailable: 'available', hostUnavailable: 'unavailable', hostUnknown: 'unknown',
        hostMismatch: 'Plugin version and Host disagree: refresh the page or reinstall the plugin; a mismatch never crashes.',
        hostNoLlm: 'No LLM service connected: chat is degraded off and never fakes a reply.',
        hostNoSchedule: 'This Host has no schedule service: reminders are disabled.',
        probeHost: 'Re-detect Host capabilities', probeHint: 'Re-reads Host capabilities through hello/probe; never calls a model or creates a reminder.',
        noModelDetail: 'No LLM service connected (Host lacks llm): sending calls no model and never fakes a reply.',
        noScheduleDetail: 'This Host has no schedule service: reminders are disabled.',
        dataGroup: 'Data & boundaries', chat: 'AI chat (sends to the model provider)',
        chatHint: 'On by default: chat text goes through the DSH Host to the model provider configured in DSH; when off no chat text is sent (reminders still work).',
        boundaryHint: 'This plugin only runs inside DSH: model, key, session and provider data are managed by DSH and your provider; the plugin stores no chat history.',
        clearLocal: 'Clear local settings & consent', clearHint: 'Deletes only this plugin\'s dsh-famling/* local storage keys (settings, character, appearance, consent); DSH host data and provider-side data are untouched.',
        firstRunTitle: 'First-run notice', firstRunAck: 'Got it',
        where: 'Where it goes: text is sent through the DSH Host to the model provider configured in DSH; never send passwords, private data of others, or client material.',
        crisisLine: 'Mental-health crisis: contact 12356 (psychological assistance); emergencies 110 (police) / 120 (ambulance), or a trusted person and a professional service.',
        clearDone: 'Local settings and consent cleared (voice consent withdrawn); nothing is written back until you change a setting again.',
        contentEntry: 'Content & characters…', hideBrief: 'Hide',
        tabs: { roles: 'Roles', custom: 'Customize', packs: 'Packs', market: 'Market' },
        rolesHint: 'A role IS the theme: one click applies voice / dialogue / appearance (bubbles / panel style / fonts) together.',
        current: 'Current', applyRole: 'Apply role', currentRole: 'Current role',
        voice: 'Voice', dialogue: 'Dialogue', look: 'Look',
        voiceSpeech: 'browser TTS', voiceSilent: 'silent thought bubbles',
        roleReserved: 'Origami is a reserved role pack: its art is not installed, so one-click apply is disabled.',
        characters: { human: 'Tinglan', cat: 'Selkirk Rex', dog: 'Golden Retriever', origami: 'Origami' },
        characterDescriptions: { human: 'Quiet, concise work companion', cat: 'Laid-back, aloof curly grey-white cat', dog: 'Friendly, enthusiastic Golden Retriever', origami: 'Reserved origami role' },
        customHint: 'Only changes the current role combination; the role preset stays unchanged. Switching roles applies the new role full voice/dialogue/look bundle.',
        preset: 'role preset', overridden: 'customized (overrides the role preset)', restoreRole: 'Restore role defaults',
        voiceGroup: 'Voice (TTS policy)', dialogueGroup: 'Dialogue mode', themeGroup: 'Bubble / panel theme', backgroundGroup: 'Background', fontGroup: 'Font',
        voiceList: 'Voice (system)', voiceSystem: 'System default voice', voiceEmpty: 'The browser exposes no voices yet.',
        voiceSilent: 'The Selkirk Rex cat and Golden Retriever only use silent thought bubbles; browser TTS is never called for them.',
        consentTts: 'Voice playback needs separate confirmation: it uses the browser system voice, not DeepSeek stella/tide; replies may be read aloud and can be switched off.',
        dialogueModes: { standard: { name: 'Standard', desc: 'Full replies and bubbles' }, brief: { name: 'Brief', desc: 'Filters over-long replies' }, quiet: { name: 'Quiet', desc: 'Fewer ambient bubbles' } },
        themes: { default: { name: 'Default', desc: 'White bubble with dark text' }, paper: { name: 'Paper', desc: 'Warm paper-toned bubbles' }, night: { name: 'Night', desc: 'Dark bubbles and panels' } },
        backgrounds: { transparent: 'Transparent', paper: 'Paper', dark: 'Dark' }, backgroundDescriptions: { transparent: 'Transparent backdrop', paper: 'Warm paper backdrop', dark: 'Dark backdrop' },
        fonts: { system: 'System', serif: 'Serif', mono: 'Mono' }, fontDescriptions: { system: 'System UI local font stack', serif: 'Serif local font stack', mono: 'Monospace local font stack' },
        fontSize: 'Size', lineHeight: 'Line height',
        packsHint: 'This version loads only bundled content; external packs need a future Host loader.',
        installed: 'Installed packs', builtinPack: 'Bundled role theme pack (4 role bundles)', bundled: 'bundled with the plugin',
        externalEmpty: 'No imported external content packs.',
        declaration: 'Illegal-use declaration check', declarationOk: 'Passed: researchOnly=true and all six prohibited uses declared.', declarationFailed: 'Failed: ',
        declarationDetail: 'Prohibited: emotional companionship / virtual partner / professional advice / minor intimacy / impersonating a real person or official / illegal use.',
        importPack: 'Import content pack (Host support required)',
        importHint: 'Asset-pack (zip / folder) import interface is reserved: the Host owns manifests and sha256 checks. This version reads no files, executes no scripts, loads no assets and makes no network requests.',
        compliance: 'Compliance metadata (content-extension v3)',
        licenseLabel: 'Licence & attribution', aiLabel: 'AI provenance', compatLabel: 'Compatibility',
        packsNoNetwork: 'Content packs are validated as pure data only (content-extension.mjs v3): usage declaration, licence, AI provenance and compatibility fields are all pure-data checked; no script execution, no network.',
        marketStatus: 'The remote market interface is reserved; no server is configured.',
        marketNoNetwork: 'No network request is made and no fake products are shown; a future Host must explicitly enable the market loader.',
        catalogUrl: 'Catalog URL', configKey: 'Config key', notConfigured: 'not configured',
        marketReserved: 'Reserved fields: catalogUrl / configKey; this screen is a placeholder and never fetches a catalog.',
      },
    }

    function declarationProblems(declaration) {
      const problems = []
      if (!declaration || declaration.researchOnly !== true) problems.push('researchOnly')
      const uses = declaration && Array.isArray(declaration.prohibitedUses) ? declaration.prohibitedUses : []
      for (const token of DECLARATION_TOKENS) if (!uses.includes(token)) problems.push(token)
      return problems
    }

    function captionStyle() {
      return { fontSize: 11, lineHeight: 1.45, color: 'var(--dsw-alias-label-caption, #9aa0a6)' }
    }

    function mark(T, active) {
      return active ? h('span', { key: 'mark', style: { flex: 'none', fontSize: 10, color: 'var(--dsh-famling-accent, #7aa2ff)' } }, '✓ ' + T.current) : null
    }

    function card(buttonBase, T, key, active, onClick, ariaLabel, children) {
      return h('button', {
        key, type: 'button', 'aria-pressed': active, 'aria-label': ariaLabel, onClick,
        style: { ...buttonBase, display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 8px', marginBottom: 5, textAlign: 'left', border: active ? '1px solid var(--dsh-famling-accent, #7aa2ff)' : buttonBase.border },
      }, children)
    }

    function cardText(name, desc) {
      return h('span', { key: 'text', style: { flex: 1, minWidth: 0 } }, [
        h('strong', { key: 'name', style: { display: 'block' } }, name),
        h('span', { key: 'desc', style: { display: 'block', ...captionStyle() } }, desc),
      ])
    }

    function swatch(background) {
      return h('span', { key: 'swatch', 'aria-hidden': true, style: { flex: 'none', width: 18, height: 18, borderRadius: 4, border: '1px solid rgba(127,127,127,.55)', background } })
    }

    function section(T, title, key, children) {
      return h('div', { key, style: { marginTop: 8, paddingTop: 7, borderTop: '1px dashed var(--dsh-famling-panel-border, rgba(255,255,255,.22))' } }, [
        h('strong', { key: 'title', style: { display: 'block', marginBottom: 5 } }, title),
        ...children,
      ])
    }

    function roleSummary(bundle, T) {
      const voice = bundle.voicePolicy.canTts ? T.voiceSpeech : T.voiceSilent
      const dialogue = (T.dialogueModes[bundle.dialogue] || { name: bundle.dialogue }).name
      const theme = (T.themes[bundle.theme] || { name: bundle.theme }).name
      const background = T.backgrounds[bundle.background] || bundle.background
      const font = T.fonts[bundle.font.family] || bundle.font.family
      return T.voice + ': ' + voice + ' · ' + T.dialogue + ': ' + dialogue + ' · ' + T.look + ': ' + theme + ' / ' + background + ' / ' + font
    }

    function roleDefaulted(bundle, state) {
      return bundle.character === state.character
        && bundle.dialogue === state.dialogueMode
        && bundle.theme === state.themeId
        && bundle.background === state.backgroundId
        && bundle.font.family === state.fontChoice.family
        && bundle.font.size === state.fontChoice.size
        && bundle.font.lineHeight === state.fontChoice.lineHeight
    }

    function createContentCenter(props) {
      const {
        lang, tab, setTab, character, roleId, canTts, ttsConsent, voices, settings,
        dialogueMode, themeId, backgroundId, fontChoice,
        setSettings, setDialogueMode, setThemeId, setBackgroundId, setFontChoice,
        onToggleSound, onApplyRole, onRestoreRole, onClose, panelStyle, panelBox, buttonBase, catalog,
      } = props
      const T = STRINGS[lang] || STRINGS.zh
      const {
        ROLE_IDS, ROLE_BUNDLES, THEMES, BACKGROUNDS, FONTS, DIALOGUE_MODE_IDS,
        THEME_IDS, BACKGROUND_IDS, FONT_IDS, FONT_SIZES, FONT_LINE_HEIGHTS,
        CONTENT_AVATARS, USAGE_DECLARATION, MARKET_CONFIG,
      } = catalog
      const role = ROLE_BUNDLES[roleId] || ROLE_BUNDLES.human
      const defaulted = roleDefaulted(role, { character, dialogueMode, themeId, backgroundId, fontChoice })
      const declaration = declarationProblems(USAGE_DECLARATION)
      const declarationOk = declaration.length === 0

      const roleCards = ROLE_IDS.map((id) => {
        const bundle = ROLE_BUNDLES[id]
        if (!bundle || bundle.available === false) return null
        const name = T.characters[id] || id
        const active = roleId === id && character === bundle.character
        return h('div', {
          key: 'role-' + id, 'data-role': id,
          style: { border: active ? '1px solid var(--dsh-famling-accent, #7aa2ff)' : '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 8, padding: 8, marginBottom: 6 },
        }, [
          h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 8 } }, [
            h('span', { key: 'avatar', 'aria-hidden': true, style: { flex: 'none', width: 28, textAlign: 'center', fontSize: 22 } }, CONTENT_AVATARS[id] || '•'),
            h('span', { key: 'text', style: { flex: 1, minWidth: 0 } }, [
              h('strong', { key: 'name', style: { display: 'block' } }, name),
              h('span', { key: 'desc', style: { display: 'block', ...captionStyle() } }, (T.characterDescriptions || {})[id] || ''),
            ]),
            mark(T, active),
          ]),
          h('div', { key: 'body', style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } }, [
            h('span', { key: 'summary', style: { flex: 1, minWidth: 0, ...captionStyle() } }, roleSummary(bundle, T)),
            h('button', {
              key: 'apply', type: 'button', 'aria-label': T.applyRole + ' ' + name,
              onClick: () => onApplyRole(id),
              style: { ...buttonBase, padding: '3px 8px', fontSize: 11, flex: 'none' },
            }, T.applyRole),
          ]),
        ])
      }).filter((node) => node !== null)
      const reserved = Object.keys(ROLE_BUNDLES).filter((id) => ROLE_BUNDLES[id].available === false)
      if (reserved.length > 0) roleCards.push(h('p', { key: 'reserved', style: { margin: '2px 0 0', ...captionStyle() } }, T.roleReserved))

      const rolesBody = [
        h('p', { key: 'hint', style: { margin: '0 0 8px', ...captionStyle() } }, T.rolesHint),
        ...roleCards,
      ]

      const voiceSection = section(T, T.voiceGroup, 'voice', [
        canTts ? h('label', { key: 'sound', style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' } }, [
          h('input', { type: 'checkbox', checked: settings.sound, onChange: onToggleSound }),
          h('span', null, T.voice),
        ]) : h('p', { key: 'silent', style: { margin: '0 0 6px', ...captionStyle() } }, T.voiceSilent),
        canTts && !ttsConsent ? h('p', { key: 'consent', style: { margin: '0 0 6px', ...captionStyle() } }, T.consentTts) : null,
        canTts ? h('div', { key: 'list' }, [
          h('div', { key: 'label', style: { marginBottom: 4 } }, T.voiceList),
          voices.length > 0 ? h('select', {
            key: 'select', value: settings.voiceURI || '', onChange: (event) => setSettings((value) => ({ ...value, voiceURI: event.target.value })),
            style: { width: '100%', background: 'var(--dsw-alias-bg-l1, rgba(255,255,255,.06))', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 6, padding: 5, font: 'inherit' },
          }, [h('option', { key: 'auto', value: '' }, T.voiceSystem), ...voices.map((voice) => h('option', { key: voice.voiceURI, value: voice.voiceURI }, (voice.name || voice.voiceURI) + (voice.lang ? ' · ' + voice.lang : '')))]) : h('p', { key: 'empty', style: { margin: 0, ...captionStyle() } }, T.voiceEmpty),
        ]) : null,
      ])

      const dialogueSection = section(T, T.dialogueGroup, 'dialogue', DIALOGUE_MODE_IDS.map((id) => card(buttonBase, T, 'dialogue-' + id, dialogueMode === id, () => setDialogueMode(id), T.dialogue + ' · ' + T.dialogueModes[id].name, [
        cardText(T.dialogueModes[id].name, T.dialogueModes[id].desc),
        mark(T, dialogueMode === id),
      ])))

      const themeSection = section(T, T.themeGroup, 'theme', THEME_IDS.map((id) => card(buttonBase, T, 'theme-' + id, themeId === id, () => setThemeId(id), T.themeGroup + ' · ' + T.themes[id].name, [
        swatch(THEMES[id].vars['--dsh-famling-bubble-bg']),
        cardText(T.themes[id].name, T.themes[id].desc),
        mark(T, themeId === id),
      ])))

      const backgroundSection = section(T, T.backgroundGroup, 'background', BACKGROUND_IDS.map((id) => card(buttonBase, T, 'background-' + id, backgroundId === id, () => setBackgroundId(id), T.backgroundGroup + ' · ' + T.backgrounds[id], [
        swatch(BACKGROUNDS[id].vars['--dsh-famling-widget-bg'] === 'transparent' ? 'repeating-linear-gradient(45deg, rgba(127,127,127,.4) 0 2px, transparent 2px 6px)' : BACKGROUNDS[id].vars['--dsh-famling-widget-bg']),
        cardText(T.backgrounds[id], (T.backgroundDescriptions || {})[id] || ''),
        mark(T, backgroundId === id),
      ])))

      const fontSection = section(T, T.fontGroup, 'font', [
        ...FONT_IDS.map((id) => card(buttonBase, T, 'font-' + id, fontChoice.family === id, () => setFontChoice((value) => ({ ...value, family: id })), T.fontGroup + ' · ' + T.fonts[id], [
          h('span', { key: 'aa', 'aria-hidden': true, style: { flex: 'none', width: 24, textAlign: 'center', fontFamily: FONTS[id].family, fontSize: 16 } }, 'Aa'),
          cardText(T.fonts[id], (T.fontDescriptions || {})[id] || ''),
          mark(T, fontChoice.family === id),
        ])),
        h('div', { key: 'size', style: { marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
          h('span', { key: 'label', style: { ...captionStyle() } }, T.fontSize),
          ...FONT_SIZES.map((size) => h('button', { key: 'size-' + size, type: 'button', 'aria-label': T.fontSize + ' ' + size + 'px', 'aria-pressed': fontChoice.size === size, onClick: () => setFontChoice((value) => ({ ...value, size })), style: { ...buttonBase, padding: '2px 7px', fontSize: 11, fontWeight: fontChoice.size === size ? 600 : 400 } }, size + 'px')),
        ]),
        h('div', { key: 'line', style: { marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } }, [
          h('span', { key: 'label', style: { ...captionStyle() } }, T.lineHeight),
          ...FONT_LINE_HEIGHTS.map((lineHeight) => h('button', { key: 'line-' + lineHeight, type: 'button', 'aria-label': T.lineHeight + ' ' + lineHeight, 'aria-pressed': fontChoice.lineHeight === lineHeight, onClick: () => setFontChoice((value) => ({ ...value, lineHeight })), style: { ...buttonBase, padding: '2px 7px', fontSize: 11, fontWeight: fontChoice.lineHeight === lineHeight ? 600 : 400 } }, String(lineHeight))),
        ]),
      ])

      const customBody = [
        h('p', { key: 'hint', style: { margin: '0 0 7px', ...captionStyle() } }, T.customHint),
        h('div', { key: 'current', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, flexWrap: 'wrap' } }, [
          h('span', { key: 'label', style: { flex: 1, minWidth: 0 } }, T.currentRole + ': ' + (T.characters[role.character] || role.character) + ' · ' + (defaulted ? T.preset : T.overridden)),
          h('button', { key: 'restore', type: 'button', onClick: onRestoreRole, style: { ...buttonBase, padding: '3px 8px', fontSize: 11 } }, T.restoreRole),
        ]),
        voiceSection,
        dialogueSection,
        themeSection,
        backgroundSection,
        fontSection,
      ]

      const packsBody = [
        h('p', { key: 'hint', style: { margin: '0 0 8px', ...captionStyle() } }, T.packsHint),
        h('strong', { key: 'installed', style: { display: 'block', marginBottom: 5 } }, T.installed),
        h('div', { key: 'builtin', style: { border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 8, padding: 8, marginBottom: 6 } }, [
          h('strong', { key: 'name', style: { display: 'block' } }, T.builtinPack),
          h('span', { key: 'meta', style: { display: 'block', ...captionStyle() } }, BUILTIN_PACK.id + ' · ' + T.bundled + ' · ' + BUILTIN_PACK.entries + ' ' + T.tabs.roles),
        ]),
        h('p', { key: 'empty', style: { margin: '0 0 8px', ...captionStyle() } }, T.externalEmpty),
        h('div', { key: 'declaration', style: { border: '1px solid ' + (declarationOk ? 'rgba(80,160,100,.55)' : '#a63d35'), borderRadius: 8, padding: 8, marginBottom: 6 } }, [
          h('strong', { key: 'title', style: { display: 'block' } }, T.declaration),
          h('span', { key: 'status', style: { display: 'block', ...captionStyle() } }, declarationOk ? '✓ ' + T.declarationOk : '! ' + T.declarationFailed + declaration.join(', ')),
          h('span', { key: 'detail', style: { display: 'block', marginTop: 3, ...captionStyle() } }, T.declarationDetail),
        ]),
        h('div', { key: 'compliance', style: { border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 8, padding: 8, marginBottom: 6 } }, [
          h('strong', { key: 'title', style: { display: 'block' } }, T.compliance),
          h('span', { key: 'license', style: { display: 'block', ...captionStyle() } }, T.licenseLabel + ': ' + BUILTIN_COMPLIANCE.license.spdx + ' · ' + BUILTIN_COMPLIANCE.license.attribution),
          h('span', { key: 'ai', style: { display: 'block', marginTop: 3, ...captionStyle() } }, T.aiLabel + ': generated=' + String(BUILTIN_COMPLIANCE.aiProvenance.generated) + ' · ' + BUILTIN_COMPLIANCE.aiProvenance.disclosure),
          h('span', { key: 'compat', style: { display: 'block', marginTop: 3, ...captionStyle() } }, T.compatLabel + ': content-extension v3 · minPluginVersion ' + BUILTIN_COMPLIANCE.compatibility.minPluginVersion),
        ]),
        h('button', { key: 'import', type: 'button', disabled: true, title: T.importHint, style: { ...buttonBase, padding: '5px 8px', opacity: 0.6, cursor: 'not-allowed', marginBottom: 5 } }, T.importPack),
        h('p', { key: 'import-hint', style: { margin: '0 0 6px', ...captionStyle() } }, T.importHint),
        h('p', { key: 'network', style: { margin: 0, ...captionStyle() } }, T.packsNoNetwork),
      ]

      const marketBody = [
        h('div', { key: 'status', style: { border: '1px dashed var(--dsh-famling-panel-border, rgba(255,255,255,.22))', borderRadius: 8, padding: 8, marginBottom: 6 } }, [
          h('strong', { key: 'title', style: { display: 'block' } }, T.marketStatus),
          h('span', { key: 'network', style: { display: 'block', ...captionStyle() } }, T.marketNoNetwork),
        ]),
        h('div', { key: 'catalog', style: { display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 } }, [
          h('span', { key: 'url', style: { ...captionStyle() } }, T.catalogUrl + ': ' + (MARKET_CONFIG.catalogUrl || T.notConfigured)),
          h('span', { key: 'key', style: { ...captionStyle() } }, T.configKey + ': ' + MARKET_CONFIG.configKey),
          h('span', { key: 'urlkey', style: { ...captionStyle() } }, 'catalogUrlKey: ' + MARKET_CONFIG.catalogUrlKey),
        ]),
        h('p', { key: 'reserved', style: { margin: 0, ...captionStyle() } }, T.marketReserved),
      ]

      const body = tab === 'custom' ? customBody : tab === 'packs' ? packsBody : tab === 'market' ? marketBody : rolesBody
      const tabIds = ['roles', 'custom', 'packs', 'market']

      const contentBox = panelBox || { zoom: 1, width: 360, maxHeight: 640 }
      return h('div', { role: 'dialog', 'aria-label': T.title, style: { ...panelStyle, width: contentBox.width, maxWidth: contentBox.width, maxHeight: contentBox.maxHeight, overflowY: 'auto', transform: 'scale(' + contentBox.zoom + ')', transformOrigin: 'left bottom' } }, [
        h('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 } }, [
          h('strong', { key: 't', style: { flex: 1 } }, T.title),
          h('button', { key: 'x', type: 'button', onClick: onClose, 'aria-label': T.close, style: { ...buttonBase, padding: '2px 6px' } }, '×'),
        ]),
        h('div', { key: 'tabs', role: 'tablist', style: { display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' } }, tabIds.map((id) => h('button', {
          key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, onClick: () => setTab(id),
          style: { ...buttonBase, padding: '4px 8px', fontWeight: tab === id ? 600 : 400 },
        }, T.tabs[id]))),
        h('div', { key: 'body' }, body),
      ])
    }

    /** Unified settings popup: every adjustable item in one dialog, with the
     *  advanced/debug group folded behind a toggle (state owned by client.js,
     *  because hooks cannot be added conditionally inside this factory). */
    function createSettingsPanel(props) {
      const {
        lang, character, roleId, canTts, ttsConsent, voices, settings, setSettings, menuButton,
        dialogueMode, themeId, backgroundId, fontChoice, brief, briefError, host, onProbeHost, advancedOpen,
        aiNotice, useRestrictions, onToggleAdvanced, updateSetting,
        localDataCleared, onToggleChat, onClearLocalData,
        setDialogueMode, setThemeId, setBackgroundId, setFontChoice,
        quietHours, quietActive, onToggleQuiet, onQuietTime,
        motionMode, motionSystem, motionOn, onMotionMode, onHideFor,
        onToggleSound, onToggleMenuButton, onLoadBrief, onHideBrief, onOpenContent, onRestoreRole,
        scaleSettings, resolvedScales,
        onGlobalScale, onUiTextScale, onImageScale, onComponentScale, onResetScales, scaleCatalog,
        onClose, panelStyle, panelBox, buttonBase, catalog,
      } = props
      const T = STRINGS[lang] || STRINGS.zh
      const { DIALOGUE_MODE_IDS, THEME_IDS, BACKGROUND_IDS, FONT_IDS, FONT_SIZES, FONT_LINE_HEIGHTS, ROLE_BUNDLES } = catalog
      const role = ROLE_BUNDLES[roleId] || ROLE_BUNDLES.human
      const roleName = (T.characters || {})[role.character] || role.character
      const counts = (brief && brief.counts) || { today: 0, commitments: 0 }
      const storageKeys = ['dsh-famling/first-run/v1', 'dsh-famling/menu', 'dsh-famling/role', 'dsh-famling/character', 'dsh-famling/settings', 'dsh-famling/dialogue', 'dsh-famling/theme', 'dsh-famling/background', 'dsh-famling/font', 'dsh-famling/hidden-until', 'dsh-famling/consent/v1'].concat(scaleCatalog ? scaleCatalog.storageKeys : [])
      const box = panelBox || { zoom: 1, width: 310, maxHeight: 680 }
      const scale = scaleCatalog || null
      const percent = (value) => Math.round(value * 100) + '%'
      const follows = (value) => Math.abs(value - 1) < 1e-9
      const axisValueText = (axis) => percent(scaleSettings.global * axis) + ' · ' + (follows(axis) ? T.scaleFollowing : T.scaleIndependent)
      const panelDialogStyle = { ...panelStyle, width: box.width, maxWidth: box.width, maxHeight: box.maxHeight, overflowY: 'auto', transform: 'scale(' + box.zoom + ')', transformOrigin: 'left bottom' }
      const toggle = (key, label, note, checked, onChange) => h('label', {
        key, style: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', cursor: 'pointer' },
      }, [
        h('input', { key: 'input', type: 'checkbox', checked: Boolean(checked), onChange }),
        h('span', { key: 'text', style: { flex: 1, minWidth: 0 } }, [
          h('span', { key: 'label', style: { display: 'block' } }, label),
          note ? h('span', { key: 'note', style: { display: 'block', ...captionStyle() } }, note) : null,
        ]),
      ])
      const choice = (key, active, label, ariaLabel, onClick) => h('button', {
        key, type: 'button', 'aria-label': ariaLabel, 'aria-pressed': active, onClick,
        style: { ...buttonBase, padding: '2px 7px', fontSize: 11, fontWeight: active ? 600 : 400 },
      }, label)
      const row = (key, label, children) => h('div', {
        key, style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 4 },
      }, [h('span', { key: 'label', style: { ...captionStyle(), flex: 'none', minWidth: 46 } }, label), ...children])
      /** Native range slider (keyboard/screen-reader operable for free) storing a
       *  relative multiplier; the value reads as a percent with follow/independent. */
      const slider = (key, label, ariaLabel, range, valuePercent, onChange, valueText, hint) => h('div', { key, style: { marginTop: 5 } }, [
        h('label', { key: 'label', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } }, [
          h('span', { key: 'text', style: { flex: 1, minWidth: 0 } }, label),
          h('span', { key: 'value', style: { flex: 'none', fontVariantNumeric: 'tabular-nums' } }, valueText),
        ]),
        h('input', {
          key: 'input', type: 'range', min: range.min, max: range.max, step: range.step,
          value: valuePercent, 'aria-label': ariaLabel, 'aria-valuetext': valueText,
          onChange: (event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(next / 100) },
          style: { width: '100%', margin: '2px 0 0' },
        }),
        hint ? h('p', { key: 'hint', style: { margin: '2px 0 0', ...captionStyle() } }, hint) : null,
      ])
      // First level: ONE overall scale (所有内容一并缩放). The independent axes
      // and component overrides live strictly below it (next group / advanced).
      const scaleRows = scale ? [
        slider('scale-global', T.scaleGlobal, T.scaleGlobal, scale.global, Math.round(scaleSettings.global * 100), onGlobalScale, percent(scaleSettings.global), T.scaleGlobalHint),
        h('div', { key: 'scale-reset', style: { marginTop: 4 } }, [
          h('button', { key: 'reset', type: 'button', 'aria-label': T.scaleReset, onClick: onResetScales, style: { ...buttonBase, padding: '2px 7px', fontSize: 11 } }, T.scaleReset),
        ]),
      ] : []
      const common = section(T, T.commonGroup, 'common', [
        ...scaleRows,
        toggle('bubble', T.bubble, null, settings.bubble, () => updateSetting('bubble')),
        toggle('menu-button', T.showMenuButton, T.menuButtonHint, menuButton, onToggleMenuButton),
      ])
      // Second level: UI + 文本 / 图像 can deviate from 整体缩放 independently.
      const independent = scale ? section(T, T.scaleGroup, 'scale-axis', [
        slider('scale-ui-text', T.scaleUiText, T.scaleUiText, scale.uiText, Math.round(scaleSettings.uiText * 100), onUiTextScale, axisValueText(scaleSettings.uiText), T.scaleUiTextHint),
        h('div', { key: 'follow-ui-text', style: { marginTop: 3 } }, [
          h('button', { key: 'follow', type: 'button', disabled: follows(scaleSettings.uiText), 'aria-label': T.scaleUiText + ' ' + T.scaleFollow, onClick: () => onUiTextScale(1), style: { ...buttonBase, padding: '2px 7px', fontSize: 11 } }, T.scaleFollow),
        ]),
        slider('scale-image', T.scaleImage, T.scaleImage, scale.image, Math.round(scaleSettings.image * 100), onImageScale, axisValueText(scaleSettings.image), T.scaleImageHint),
        h('div', { key: 'follow-image', style: { marginTop: 3 } }, [
          h('button', { key: 'follow', type: 'button', disabled: follows(scaleSettings.image), 'aria-label': T.scaleImage + ' ' + T.scaleFollow, onClick: () => onImageScale(1), style: { ...buttonBase, padding: '2px 7px', fontSize: 11 } }, T.scaleFollow),
        ]),
      ]) : null

      // Low disturbance (0.10.6, E7/P-04): quiet hours, animation preference and
      // temporary hide. The runtime semantics live in client.js; this is UI only.
      const timeInputStyle = { background: 'var(--dsw-alias-bg-l1, rgba(255,255,255,.06))', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 6, padding: 2, font: 'inherit' }
      const lowDisturb = section(T, T.lowDisturbGroup, 'low-disturb', [
        toggle('quiet', T.quietEnabled, T.quietHint, quietHours.enabled, onToggleQuiet),
        h('div', { key: 'quiet-time', style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 5 } }, [
          h('span', { key: 'label', style: { ...captionStyle(), flex: 'none' } }, T.quietHours),
          h('input', { key: 'start', type: 'time', value: quietHours.start, 'aria-label': T.quietHours + ' ' + T.quietStart, onChange: (event) => onQuietTime('start', event.target.value), style: timeInputStyle }),
          h('span', { key: 'dash', 'aria-hidden': true }, '–'),
          h('input', { key: 'end', type: 'time', value: quietHours.end, 'aria-label': T.quietHours + ' ' + T.quietEnd, onChange: (event) => onQuietTime('end', event.target.value), style: timeInputStyle }),
        ]),
        h('p', { key: 'quiet-status', role: 'status', style: { margin: '4px 0 0', ...captionStyle() } }, T.quietHours + '：' + (quietHours.enabled ? (quietActive ? T.quietNow : T.quietOutside) : T.quietOff) + '（' + quietHours.start + '–' + quietHours.end + '）'),
        h('div', { key: 'motion', style: { marginTop: 7 } }, [
          h('span', { key: 'label', style: { display: 'block', marginBottom: 3 } }, T.motionPref),
          h('div', { key: 'choices', style: { display: 'flex', gap: 5, flexWrap: 'wrap' } }, [
            choice('motion-auto', motionMode === 'auto', T.motionAuto, T.motionPref + ' · ' + T.motionAuto, () => onMotionMode('auto')),
            choice('motion-on', motionMode === 'on', T.motionOn, T.motionPref + ' · ' + T.motionOn, () => onMotionMode('on')),
            choice('motion-off', motionMode === 'off', T.motionOff, T.motionPref + ' · ' + T.motionOff, () => onMotionMode('off')),
          ]),
          h('p', { key: 'motion-hint', style: { margin: '4px 0 0', ...captionStyle() } }, T.motionHint + ' ' + (motionSystem ? T.motionSystemReduce : T.motionSystemAllow) + '；' + T.motionPref + '：' + (motionOn ? T.motionOn : T.motionOff) + '。'),
        ]),
        h('div', { key: 'hide', style: { display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' } }, [
          h('button', { key: 'hour', type: 'button', onClick: () => onHideFor('hour'), style: { ...buttonBase, padding: '3px 8px', fontSize: 11 } }, T.hideHour),
          h('button', { key: 'tomorrow', type: 'button', onClick: () => onHideFor('tomorrow'), style: { ...buttonBase, padding: '3px 8px', fontSize: 11 } }, T.hideTomorrow),
        ]),
        h('p', { key: 'hide-hint', style: { margin: '4px 0 0', ...captionStyle() } }, T.hideHint),
      ])
      // MB-021/022/024: sending destination, crisis resources, the DSH boundary,
      // the chat kill switch and clear-local-data/consent-withdrawal live here.
      // Clearing touches only this plugin's own dsh-famling/* keys; the DSH host,
      // its sessions and the model provider's data are owned and kept by them.
      const clearLocal = () => {
        for (const key of storageKeys) { try { localStorage.removeItem(key) } catch {} }
        onClearLocalData()
      }
      const data = section(T, T.dataGroup, 'data', [
        toggle('chat', T.chat, T.chatHint, settings.chat !== false, onToggleChat),
        h('p', { key: 'where', style: { margin: '4px 0 0', ...captionStyle() } }, T.where),
        h('p', { key: 'crisis', style: { margin: '4px 0 0', ...captionStyle() } }, T.crisisLine),
        h('p', { key: 'boundary', style: { margin: '4px 0 0', ...captionStyle() } }, T.boundaryHint),
        h('button', { key: 'clear', type: 'button', onClick: clearLocal, style: { ...buttonBase, marginTop: 6, padding: '4px 8px', fontSize: 11, border: '1px solid #a63d35' } }, T.clearLocal),
        h('p', { key: 'clearHint', style: { margin: '5px 0 0', ...captionStyle() } }, T.clearHint),
        localDataCleared ? h('p', { key: 'clearStatus', role: 'status', style: { margin: '5px 0 0', fontSize: 11, color: 'var(--dsh-famling-accent, #7aa2ff)' } }, T.clearDone) : null,
      ])
      const voice = section(T, T.voiceGroup, 'voice', [
        canTts ? toggle('sound', T.voice, null, settings.sound, onToggleSound)
          : h('p', { key: 'silent', style: { margin: '0 0 4px', ...captionStyle() } }, T.voiceSilent),
        canTts && !ttsConsent ? h('p', { key: 'consent', style: { margin: '0 0 4px', ...captionStyle() } }, T.consentTts) : null,
        canTts && voices.length > 0 ? h('select', {
          key: 'voices', value: settings.voiceURI || '', 'aria-label': T.voiceList,
          onChange: (event) => setSettings((value) => ({ ...value, voiceURI: event.target.value })),
          style: { width: '100%', marginTop: 4, background: 'var(--dsw-alias-bg-l1, rgba(255,255,255,.06))', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 6, padding: 5, font: 'inherit' },
        }, [h('option', { key: 'auto', value: '' }, T.voiceSystem), ...voices.map((item) => h('option', { key: item.voiceURI, value: item.voiceURI }, (item.name || item.voiceURI) + (item.lang ? ' · ' + item.lang : '')))]) : null,
      ])
      const memory = section(T, T.memoryGroup, 'memory', [
        h('button', { key: 'load', type: 'button', onClick: onLoadBrief, style: { ...buttonBase, padding: '3px 8px', fontSize: 11 } }, T.memory),
        brief ? h('div', { key: 'brief', style: { marginTop: 5, fontSize: 11, lineHeight: 1.5 } }, [
          h('button', { key: 'hide', type: 'button', onClick: onHideBrief, 'aria-label': T.hideBrief, style: { float: 'right', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-caption, #9aa0a6)', cursor: 'pointer', fontSize: 12 } }, T.hideBrief),
          h('div', { key: 'counts' }, T.today + ': ' + counts.today + ' · ' + T.commitments + ': ' + counts.commitments),
          ...(brief.today || []).slice(0, 2).map((item, index) => h('div', { key: 't' + index, style: { color: 'var(--dsw-alias-label-caption, #9aa0a6)' } }, '· ' + item.title)),
        ]) : null,
        briefError ? h('div', { key: 'err', style: { fontSize: 11, color: 'var(--dsw-alias-label-caption, #9aa0a6)' } }, briefError) : null,
      ])
      const appearance = section(T, T.appearanceGroup, 'appearance', [
        row('dialogue', T.dialogue, DIALOGUE_MODE_IDS.map((id) => choice('dialogue-' + id, dialogueMode === id, T.dialogueModes[id].name, T.dialogue + ' · ' + T.dialogueModes[id].name, () => setDialogueMode(id)))),
        row('theme', T.themeGroup, THEME_IDS.map((id) => choice('theme-' + id, themeId === id, T.themes[id].name, T.themeGroup + ' · ' + T.themes[id].name, () => setThemeId(id)))),
        row('background', T.backgroundGroup, BACKGROUND_IDS.map((id) => choice('background-' + id, backgroundId === id, T.backgrounds[id], T.backgroundGroup + ' · ' + T.backgrounds[id], () => setBackgroundId(id)))),
        row('font', T.fontGroup, FONT_IDS.map((id) => choice('font-' + id, fontChoice.family === id, T.fonts[id], T.fontGroup + ' · ' + T.fonts[id], () => setFontChoice((value) => ({ ...value, family: id }))))),
        row('size', T.fontSize, FONT_SIZES.map((size) => choice('size-' + size, fontChoice.size === size, size + 'px', T.fontSize + ' ' + size + 'px', () => setFontChoice((value) => ({ ...value, size }))))),
        row('line', T.lineHeight, FONT_LINE_HEIGHTS.map((lineHeight) => choice('line-' + lineHeight, fontChoice.lineHeight === lineHeight, String(lineHeight), T.lineHeight + ' ' + lineHeight, () => setFontChoice((value) => ({ ...value, lineHeight }))))),
      ])
      const roleGroup = section(T, T.roleGroup, 'role', [
        h('p', { key: 'current', style: { margin: '0 0 5px', ...captionStyle() } }, T.currentRole + ': ' + roleName),
        h('div', { key: 'actions', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
          h('button', { key: 'content', type: 'button', onClick: onOpenContent, style: { ...buttonBase, padding: '3px 8px', fontSize: 11 } }, T.contentEntry),
          h('button', { key: 'restore', type: 'button', onClick: onRestoreRole, style: { ...buttonBase, padding: '3px 8px', fontSize: 11 } }, T.restoreRole),
        ]),
      ])
      // Third level (inside the folded advanced group): per-component overrides;
      // every component inherits UI + 文本 by default and can be restored.
      const componentScale = scale ? h('div', { key: 'component-scale', style: { marginBottom: 8 } }, [
        h('strong', { key: 'title', style: { display: 'block', marginBottom: 4 } }, T.scaleComponentsTitle),
        h('p', { key: 'hint', style: { margin: '0 0 6px', ...captionStyle() } }, T.scaleComponentsHint),
        ...scale.components.map((component) => {
          const override = scaleSettings.components[component.id]
          const label = lang === 'en' ? component.en : component.zh
          const actual = (resolvedScales && resolvedScales.components[component.id]) || 1
          return h('div', { key: 'component-' + component.id, style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' } }, [
            h('span', { key: 'label', style: { flex: 'none', minWidth: 64 } }, label),
            h('select', {
              key: 'select', value: typeof override === 'number' ? String(override) : '1', 'aria-label': label + ' ' + T.scaleComponentsTitle,
              onChange: (event) => onComponentScale(component.id, event.target.value === '1' ? null : Number(event.target.value)),
              style: { background: 'var(--dsw-alias-bg-l1, rgba(255,255,255,.06))', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 6, padding: 3, font: 'inherit' },
            }, [h('option', { key: 'inherit', value: '1' }, T.scaleInherit), ...scale.componentOptions.map((value) => h('option', { key: String(value), value: String(value) }, Math.round(value * 100) + '%'))]),
            h('span', { key: 'actual', style: { ...captionStyle(), flex: 'none' } }, T.scaleActual + Math.round(actual * 100) / 100 + '×'),
          ])
        }),
      ]) : null
      // Host hello/probe handshake (0.10.7): state comes from client.js; this panel
      // reports it and offers a manual re-probe. Unknown/legacy is stated explicitly.
      const hostCaps = host && host.capabilities && typeof host.capabilities === 'object' ? host.capabilities : null
      const hostFlag = (value) => value === true ? T.hostAvailable : value === false ? T.hostUnavailable : T.hostUnknown
      const hostStatus = !host ? T.hostPending : host.legacy ? T.hostLegacy : T.hostReady
      const hostSection = h('div', { key: 'host', style: { marginBottom: 8 } }, [
        h('strong', { key: 'title', style: { display: 'block', marginBottom: 3 } }, T.hostGroup),
        h('div', { key: 'status', role: 'status', style: captionStyle() }, T.hostStatus + ': ' + hostStatus),
        host && !host.legacy ? h('div', { key: 'details', style: captionStyle() }, T.hostVersion + ': ' + ((host.host && host.host.version) || T.hostUnknown) + ' · ' + T.hostWire + ' v' + ((host.wire && host.wire.version) || 0) + ' · ' + T.hostContent + ' v' + ((host.contract && host.contract.contentExtension) || 0)) : null,
        hostCaps ? h('div', { key: 'caps', style: captionStyle() }, T.hostCapLlm + ' ' + hostFlag(hostCaps.llm) + ' · ' + T.hostCapSchedule + ' ' + hostFlag(hostCaps.schedule) + ' · ' + T.hostCapBrief + ' ' + hostFlag(hostCaps.brief)) : null,
        host && host.versionMismatch ? h('div', { key: 'mismatch', style: { ...captionStyle(), color: '#a63d35' } }, T.hostMismatch) : null,
        host && Array.isArray(host.degraded) && host.degraded.length > 0 ? h('div', { key: 'degraded', style: captionStyle() }, T.hostDegraded + ': ' + host.degraded.join(', ')) : null,
        hostCaps && hostCaps.llm === false ? h('div', { key: 'no-llm', style: captionStyle() }, T.hostNoLlm) : null,
        hostCaps && hostCaps.schedule === false ? h('div', { key: 'no-schedule', style: captionStyle() }, T.hostNoSchedule) : null,
        h('button', { key: 'probe', type: 'button', onClick: onProbeHost, style: { ...buttonBase, marginTop: 5, padding: '3px 8px', fontSize: 11 } }, T.probeHost),
        h('div', { key: 'probe-hint', style: captionStyle() }, T.probeHint),
      ])
      const advanced = h('div', { key: 'advanced', style: { marginTop: 8, paddingTop: 7, borderTop: '1px dashed var(--dsh-famling-panel-border, rgba(255,255,255,.22))' } }, [
        h('button', {
          key: 'toggle', type: 'button', 'aria-expanded': Boolean(advancedOpen), onClick: onToggleAdvanced,
          style: { ...buttonBase, padding: '3px 8px', fontSize: 11 },
        }, (advancedOpen ? '▾ ' : '▸ ') + T.advancedGroup),
        advancedOpen ? h('div', { key: 'body', style: { marginTop: 6 } }, [
          hostSection,
          componentScale,
          h('div', { key: 'version', style: { ...captionStyle() } }, T.version),
          h('div', { key: 'debug', style: { ...captionStyle(), marginTop: 3 } }, T.debug + ': ' + character + ' / ' + roleId + ' / ' + dialogueMode + ' / ' + themeId + ' / ' + backgroundId + ' / ' + fontChoice.family + ' ' + fontChoice.size + 'px'),
          h('div', { key: 'keys', style: { ...captionStyle(), marginTop: 3, overflowWrap: 'anywhere' } }, T.storageKeys + ': ' + storageKeys.join(', ')),
        ]) : null,
      ])
      return h('div', {
        role: 'dialog', 'aria-label': T.settingsTitle,
        style: panelDialogStyle,
      }, [
        h('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 } }, [
          h('strong', { key: 't', style: { flex: 1 } }, T.settingsTitle),
          h('button', { key: 'x', type: 'button', onClick: onClose, 'aria-label': T.close, style: { ...buttonBase, padding: '2px 6px' } }, '×'),
        ]),
        h('p', { key: 'hint', style: { margin: '0 0 6px', ...captionStyle() } }, T.settingsHint),
        h('p', { key: 'use', role: 'note', style: { margin: '0 0 6px', padding: '7px 8px', border: '2px solid #a63d35', borderRadius: 6, fontSize: 11, lineHeight: 1.45 } }, useRestrictions || T.useRestrictions),
        common, independent, lowDisturb, data, voice, memory, appearance, roleGroup, advanced,
        h('p', { key: 'ai', style: { margin: '8px 0 0', ...captionStyle() } }, aiNotice || ''),
      ])
    }

    /**
     * Chat / reminder input panel. Moved out of client.js in 0.10.6 so the
     * first-screen entry stays inside its 96 KiB budget: it is only needed after
     * the user opens the menu, while the state and bridge calls stay in client.js
     * and arrive as props.
     */
    function createInputPanel(props) {
      const { strings: S, charName, input, onInput, inputRef, settings, listening, taskMode, taskAt, onTaskAt, taskText, onTaskText, onToggleTask, onSend, onCreateTask, onStartVoice, onClose, host, lang, buttonBase, style } = props
      // Host capabilities (0.10.7): a missing llm/schedule disables the matching
      // control and states the degradation; unknown/legacy keeps the old behavior.
      const T = STRINGS[lang] || STRINGS.zh
      const hostCaps = host && host.capabilities && typeof host.capabilities === 'object' ? host.capabilities : null
      const chatAvailable = !hostCaps || hostCaps.llm !== false
      const scheduleAvailable = !hostCaps || hostCaps.schedule !== false
      const fillPet = (text) => String(text == null ? '' : text).replaceAll('{pet}', charName || '')
      const fieldStyle = { background: 'var(--dsw-alias-bg-l1, rgba(255,255,255,.06))', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 6, padding: 6, font: 'inherit' }
      return h('div', { role: 'dialog', 'aria-label': fillPet(S.inputTitle), style }, [
        h('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
          h('strong', { key: 't', style: { flex: 1 } }, fillPet(S.inputTitle)),
          h('button', { key: 'x', type: 'button', onClick: onClose, 'aria-label': S.close, style: { ...buttonBase, padding: '2px 6px' } }, '×'),
        ]),
        h('div', { key: 'row', style: { display: 'flex', gap: 6, alignItems: 'stretch' } }, [
          h('textarea', {
            key: 'text', ref: inputRef, value: input, rows: 3, placeholder: fillPet(S.placeholder),
            onChange: (event) => onInput(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSend() } },
            style: { flex: 1, resize: 'vertical', minHeight: 64, background: 'var(--dsw-alias-bg-l1, rgba(255,255,255,.06))', color: 'inherit', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))', borderRadius: 7, padding: 8, font: 'inherit' },
          }),
          h('div', { key: 'side', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, [
            h('button', { key: 'mic', type: 'button', title: S.mic, 'aria-label': S.mic, onClick: onStartVoice, style: { ...buttonBase, padding: '8px 7px' } }, listening ? '…' : '🎙'),
            h('button', { key: 'send', type: 'button', onClick: onSend, disabled: settings.chat === false || !chatAvailable, style: { ...buttonBase, padding: '8px 7px', opacity: settings.chat === false || !chatAvailable ? 0.5 : 1 } }, S.send),
          ]),
        ]),
        h('p', { key: 'ai-note', style: { margin: '0 0 6px', fontSize: 11, lineHeight: 1.5, color: 'var(--dsw-alias-label-caption, #9aa0a6)' } }, S.aiNotice),
        settings.chat === false ? h('p', { key: 'chat-off', style: { margin: 0, fontSize: 11, color: '#a63d35' } }, S.chatOff) : null,
        !chatAvailable ? h('p', { key: 'no-llm', style: { margin: '4px 0 0', fontSize: 11, color: '#a63d35' } }, T.noModelDetail) : null,
        h('div', { key: 'task', style: { marginTop: 8, borderTop: '1px dashed var(--dsw-alias-border-l2, rgba(255,255,255,.22))', paddingTop: 7 } }, scheduleAvailable ? [
          h('button', { key: 'toggle', type: 'button', onClick: onToggleTask, style: { ...buttonBase, padding: '4px 7px' } }, S.task),
          taskMode ? h('div', { key: 'form', style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 5 } }, [
            h('input', { key: 'at', type: 'datetime-local', value: taskAt, onChange: (event) => onTaskAt(event.target.value), 'aria-label': S.taskAt, style: fieldStyle }),
            h('textarea', { key: 'text', value: taskText, rows: 2, placeholder: S.task, onChange: (event) => onTaskText(event.target.value), style: { ...fieldStyle, resize: 'vertical' } }),
            h('button', { key: 'create', type: 'button', onClick: onCreateTask, style: { ...buttonBase, padding: '5px 7px' } }, S.createTask),
          ]) : null,
        ] : [h('p', { key: 'no-schedule', style: { margin: 0, fontSize: 11, color: '#a63d35' } }, T.noScheduleDetail)]),
      ])
    }

    /**
     * TTS / ASR consent dialog: the independent-confirmation gate. Moved to the
     * lazy chunk in 0.10.6; every trigger path already has the chunk resident.
     */
    function createConsentDialog(props) {
      const { lang, kind, onAllow, onCancel, panelStyle, viewport, zoom, buttonBase } = props
      const T = STRINGS[lang] || STRINGS.zh
      const consentZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
      const width = Math.max(140, Math.min(300, Math.floor(((viewport && viewport.width) || 1024) - 24) / consentZoom))
      const maxHeight = Math.max(120, Math.floor(((viewport && viewport.height) || 768) - 24) / consentZoom)
      return h('div', {
        role: 'dialog', 'aria-modal': true, 'aria-label': kind === 'tts' ? T.sound : T.mic,
        style: {
          position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%) scale(' + consentZoom + ')', transformOrigin: 'center', zIndex: 1400,
          width, maxWidth: width, maxHeight, overflowY: 'auto', padding: 14,
          background: 'var(--dsh-famling-panel-bg, var(--dsw-alias-bg-elevated, #1f2329))',
          color: 'var(--dsh-famling-panel-text, var(--dsw-alias-label-primary, #e8e8e8))',
          border: '1px dashed var(--dsh-famling-panel-border, var(--dsw-alias-border-l2, rgba(255,255,255,.35)))',
          borderRadius: 'var(--dsw-radius-md, 10px)',
          boxShadow: '0 12px 36px rgba(0,0,0,.4)', fontSize: 12, lineHeight: 1.55,
        },
      }, [
        h('strong', { key: 't', style: { display: 'block', marginBottom: 8 } }, kind === 'tts' ? T.sound : T.mic),
        h('p', { key: 'text', style: { margin: '0 0 10px' } }, kind === 'tts' ? T.consentTts : T.consentAsr),
        h('div', { key: 'actions', style: { display: 'flex', gap: 6, justifyContent: 'flex-end' } }, [
          h('button', { key: 'cancel', type: 'button', onClick: onCancel, style: { ...buttonBase, padding: '5px 8px' } }, T.cancel),
          h('button', { key: 'allow', type: 'button', onClick: onAllow, style: { ...buttonBase, padding: '5px 8px' } }, T.allow),
        ]),
      ])
    }

    /** "More -> usage & version" notice; also lazy so the entry carries no legal copy. */
    function createNoticePanel(props) {
      const { lang, onClose, buttonBase, style } = props
      const T = STRINGS[lang] || STRINGS.zh
      return h('div', { role: 'dialog', 'aria-label': T.notice, style }, [
        h('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } }, [
          h('strong', { key: 't', style: { flex: 1 } }, T.notice),
          h('button', { key: 'x', type: 'button', onClick: onClose, 'aria-label': T.close, style: { ...buttonBase, padding: '2px 6px' } }, '×'),
        ]),
        h('p', { key: 'version', style: { margin: '0 0 7px', fontSize: 11, color: 'var(--dsw-alias-label-caption, #9aa0a6)' } }, T.version),
        h('p', { key: 'use', role: 'note', style: { margin: 0, padding: '8px', border: '2px solid #a63d35', borderRadius: 6, fontSize: 11, lineHeight: 1.5 } }, T.useRestrictions),
      ])
    }

    /**
     * One-time, dismissible first-run safety card (MB-021). It carries the AI /
     * sending-destination disclosure and the crisis resources, is never modal
     * over the pet, and only writes a single local ack flag (owned by client.js).
     */
    function createFirstRunNotice(props) {
      const { lang, aiNotice, onAck, panelStyle, panelBox, buttonBase } = props
      const T = STRINGS[lang] || STRINGS.zh
      const note = { margin: '0 0 7px', fontSize: 12, lineHeight: 1.5 }
      const noticeBox = panelBox || { zoom: 1, width: 300, maxHeight: 640 }
      return h('div', { role: 'dialog', 'aria-label': T.firstRunTitle, style: { ...panelStyle, width: noticeBox.width, maxWidth: noticeBox.width, maxHeight: noticeBox.maxHeight, border: '2px solid #a63d35', overflowY: 'auto', transform: 'scale(' + noticeBox.zoom + ')', transformOrigin: 'left bottom' } }, [
        h('strong', { key: 'title', style: { display: 'block', marginBottom: 7 } }, T.firstRunTitle),
        h('p', { key: 'ai', style: note }, aiNotice || ''),
        h('p', { key: 'where', style: note }, T.where),
        h('p', { key: 'crisis', style: { ...note, margin: '0 0 9px' } }, T.crisisLine),
        h('button', { key: 'ack', type: 'button', onClick: onAck, style: { ...buttonBase, padding: '5px 9px' } }, T.firstRunAck),
      ])
    }

    return { createContentCenter, createSettingsPanel, createFirstRunNotice, createInputPanel, createConsentDialog, createNoticePanel }
  },
})
