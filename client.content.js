/* dsh-famling panels (package-local lazy chunk): content center + settings
 *
 * Loaded by client.js through the DSH module table's require.async only when
 * the content center or the unified settings popup is opened. It is pure UI
 * over the catalog/props passed in by client.js: no network requests, no file
 * access, no eval/new Function, no innerHTML and no pack/asset loading. The
 * content center has four tabs (roles / customize / packs / market); a role IS
 * the theme bundle. The settings popup centralizes every adjustable item and
 * folds the advanced/debug group.
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

    const STRINGS = {
      zh: {
        title: '内容中心', close: '关闭',
        settingsTitle: '设置', settingsHint: '常用设置在前；高级与调试折叠在下面。',
        commonGroup: '常用', appearanceGroup: '外观', roleGroup: '角色与内容', memoryGroup: 'Advisers',
        memory: '读取 Advisers 摘要',
        motion: '帧动画', bubble: '说话气泡', showMenuButton: '显示菜单按钮',
        menuButtonHint: '默认关闭：右键角色或按 Shift+F10 / ContextMenu 打开菜单；开启后角色旁出现「⋯」。',
        advancedGroup: '高级 / 调试', version: 'dsh-famling 0.10.2 · 研究原型', debug: '当前状态', storageKeys: '本地存储键',
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
        packsNoNetwork: '内容包只做纯数据校验（content-extension.mjs v3），不执行脚本、不联网。',
        marketStatus: '远程市场接口已预留，服务器未配置。',
        marketNoNetwork: '不会发起任何网络请求，也不会展示伪造商品；市场加载器需由未来 Host 显式启用。',
        catalogUrl: '目录地址 / catalog URL', configKey: '配置键 / config', notConfigured: '未配置',
        marketReserved: '字段已预留：catalogUrl / configKey；当前仅展示占位信息，不拉取目录。',
      },
      en: {
        title: 'Content Center', close: 'Close',
        settingsTitle: 'Settings', settingsHint: 'Common settings first; advanced/debug fold below.',
        commonGroup: 'Common', appearanceGroup: 'Appearance', roleGroup: 'Role & content', memoryGroup: 'Advisers',
        memory: 'Read Advisers summary',
        motion: 'Frame animation', bubble: 'Speech bubble', showMenuButton: 'Show menu button',
        menuButtonHint: 'Off by default: right-click the pet or press Shift+F10 / ContextMenu; when on, a "⋯" appears next to the pet.',
        advancedGroup: 'Advanced / debug', version: 'dsh-famling 0.10.2 · research prototype', debug: 'State', storageKeys: 'Local keys',
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
        packsNoNetwork: 'Content packs are validated as pure data only (content-extension.mjs v3): no script execution, no network.',
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
        onToggleSound, onApplyRole, onRestoreRole, onClose, panelStyle, buttonBase, catalog,
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

      return h('div', { role: 'dialog', 'aria-label': T.title, style: { ...panelStyle, width: 360, maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(76vh, 640px)', overflowY: 'auto' } }, [
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
        dialogueMode, themeId, backgroundId, fontChoice, brief, briefError, advancedOpen,
        aiNotice, useRestrictions, onToggleAdvanced, updateSetting,
        setDialogueMode, setThemeId, setBackgroundId, setFontChoice,
        onToggleSound, onToggleMenuButton, onLoadBrief, onHideBrief, onOpenContent, onRestoreRole,
        onClose, panelStyle, buttonBase, catalog,
      } = props
      const T = STRINGS[lang] || STRINGS.zh
      const { DIALOGUE_MODE_IDS, THEME_IDS, BACKGROUND_IDS, FONT_IDS, FONT_SIZES, FONT_LINE_HEIGHTS, ROLE_BUNDLES } = catalog
      const role = ROLE_BUNDLES[roleId] || ROLE_BUNDLES.human
      const roleName = (T.characters || {})[role.character] || role.character
      const counts = (brief && brief.counts) || { today: 0, commitments: 0 }
      const storageKeys = ['dsh-famling/menu', 'dsh-famling/role', 'dsh-famling/character', 'dsh-famling/settings', 'dsh-famling/dialogue', 'dsh-famling/theme', 'dsh-famling/background', 'dsh-famling/font', 'dsh-famling/consent/v1']
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
      const common = section(T, T.commonGroup, 'common', [
        toggle('motion', T.motion, null, settings.motion, () => updateSetting('motion')),
        toggle('bubble', T.bubble, null, settings.bubble, () => updateSetting('bubble')),
        toggle('menu-button', T.showMenuButton, T.menuButtonHint, menuButton, onToggleMenuButton),
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
      const advanced = h('div', { key: 'advanced', style: { marginTop: 8, paddingTop: 7, borderTop: '1px dashed var(--dsh-famling-panel-border, rgba(255,255,255,.22))' } }, [
        h('button', {
          key: 'toggle', type: 'button', 'aria-expanded': Boolean(advancedOpen), onClick: onToggleAdvanced,
          style: { ...buttonBase, padding: '3px 8px', fontSize: 11 },
        }, (advancedOpen ? '▾ ' : '▸ ') + T.advancedGroup),
        advancedOpen ? h('div', { key: 'body', style: { marginTop: 6 } }, [
          h('div', { key: 'version', style: { ...captionStyle() } }, T.version),
          h('div', { key: 'debug', style: { ...captionStyle(), marginTop: 3 } }, T.debug + ': ' + character + ' / ' + roleId + ' / ' + dialogueMode + ' / ' + themeId + ' / ' + backgroundId + ' / ' + fontChoice.family + ' ' + fontChoice.size + 'px'),
          h('div', { key: 'keys', style: { ...captionStyle(), marginTop: 3, overflowWrap: 'anywhere' } }, T.storageKeys + ': ' + storageKeys.join(', ')),
        ]) : null,
      ])
      return h('div', {
        role: 'dialog', 'aria-label': T.settingsTitle,
        style: { ...panelStyle, width: 310, maxWidth: 'calc(100vw - 24px)', maxHeight: 'min(80vh, 680px)', overflowY: 'auto' },
      }, [
        h('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 } }, [
          h('strong', { key: 't', style: { flex: 1 } }, T.settingsTitle),
          h('button', { key: 'x', type: 'button', onClick: onClose, 'aria-label': T.close, style: { ...buttonBase, padding: '2px 6px' } }, '×'),
        ]),
        h('p', { key: 'hint', style: { margin: '0 0 6px', ...captionStyle() } }, T.settingsHint),
        h('p', { key: 'use', role: 'note', style: { margin: '0 0 6px', padding: '7px 8px', border: '2px solid #a63d35', borderRadius: 6, fontSize: 11, lineHeight: 1.45 } }, useRestrictions || ''),
        common, voice, memory, appearance, roleGroup, advanced,
        h('p', { key: 'ai', style: { margin: '8px 0 0', ...captionStyle() } }, aiNotice || ''),
      ])
    }

    return { createContentCenter, createSettingsPanel }
  },
})
