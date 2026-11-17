window.__ModuleLoader__.load({
  id: 'dsh-famling',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React
    const FRAMES = {"idle": "iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAYAAADG4PRLAAAPUElEQVR42u1da4xU5Rl+zjB7kRkXyzDL3rIzK7hFQrA1qaQqizQW0gB/TFlLrVka/8HG2iatiKZNG6mmPxohQNpUG4i1FmzpD7BVY1pBIbUmNl5WdLjsHFiWYYehdj2D7DDM9MfyfrznO985M7Mgc87MeZPJzrnPnuc87+17v/doqCEJzYwXK9k/ey6pef1/1moJrOAlA7FYLzKZVMnjP/28UBOAal4GLnjJQDjcgkikDZlMCpFIm2lfFZDyvvT92MioJ8HUvAoaB4O+lwKOAyYDbRjjYjk/LewZAINeYV7wklH2vhwsGVQZaFqOxXpNYIZmxoteAFHzAvM461RAOTGLq0wOIgdXxU5dTyA/Lex6depqAGfMmFXs6ZlkRqFgZZEKNAA4ceKoZV2xWDCxzO5BkIWAdCuImpuZd0t3BwAgnVYDZQcgB4hsm6YFJs8dCtuy0c42upmJrgWQwLNjnmGMQ9MCKBYLJhvmBKyuJ0zL5MHa2Ugu5KW6DUTNbcAFLxkgtZlOp5QhALGKYj67m14KlBMnjooHQPZsVaGJG0EMuI11BJ6dPcpmDYRC0y1OjWzXygnmu7vnCtVKD4XKuSG56YaA67SVq37Rnb3mGxaNtomPYYwjHG5Bd/dczJrVZbrZspdp52HKAGcyKXR3zxUPA48Fnc7lA2gjhxJq1hQKZhWqYpfqhtsxkQDnalLTAoKNqjCEx6OhmfFipXnXmgaQOy0qOXt2pGy1KIuKVZxJ9L27e66wh3ahSiaTQizWW1FSoeYzMaXAmwwBglDFg+WCV278SMc0NDRC1xPCSyXvlXu6PoBXIeUkre28Uq46ZYnFeqHrCVy8mMP81WNi/fw7gI9earUA74Z0W8DtYI2MJBGNXrlpgYD1Uy4TZdXJlw1j3BQnfvRSq+l7LNZrypu6RY1WjYE8z8mdFZkZjY1X9xM/3L0VC/oHlaqTYspYrBfd3zpqAkzTAgJETQvYxoZ17cTwoL1QqPz4dDplCfZVzouT2p2/egyhO94ybZu/egzFYkGo0VAo7NpQwhUqNJ1OifBAVmutrV0VAcfB+3D3VvGXq8dMJoU9e/dhz959tucg8F775wHs2btPGehTSOHbwBJOSrnHRCJtKBbztqrUMMbFQ7L8G/cAAJ5Z9zGeWfexZX95PXmgdg5QXdlAynmGwy0W1Uk3OJs1TIxzAo7fUE0Lmthn+xtCYdy3aqUpTOCy7CXYhg7cAZJLMeqGgQ0NjY5JaBq/4+DJ6lXlVBjGuC14Mgu5SgyHW8THLt5zE/NcrUK5A6IadZe3k/0MBIAHlveVpW45GLFYr8XpKaXa7VJ611uuexBKRn9GcwGzZnVZksXk2sujDSpVR8NJhjGOB5b34bGH+gFAhA1OIp9fdU1aZ1fJlsmk8OnnhaoOL1XFBt50QwCRSIflySYwNS3g6Czw2I4YSeCp9pWFH1uKRap9OBPJE60WiFVh4JyuDmVimRimYoIMBmdZKYdFJQv6B03XkRko50Cd6k6rycKq2EC53E/lBToxqRLworG46SM7NLIDxH+XDKjKW65LG8hHtumm2T39FEyrpCP9vu11RqMLleuXLe2zqGJ5QJeXV+h6wtErparuulKhkzawDWfPjiCbPW+6QRy4D3dvFUDwGx8KTcdf971iCyI/hirKAOAfr//Nci6VQ0Qg8tobJ6k7AMkGFot5ZLPnbfcl5u3fsQ1b35t75cn/YDOClwyxnYNI4K3+4atWxnywGQP33o4XXj1gcYZIenomY0+uTnk9qVPpYTVArIoXemxkFHO6OsRIO1dbcjxG4Hz02iMYGjqMR7bPQ+ctP8CpI5vRkX5fABaNxfGjn/4KAxsW4rbp45ZjSH79i69jYMOT2L9jm62KVjFUFfxTRkY1OaZmAcyeS2qhmfFiJpNCLpd3ZB6Xb64vAphnWb9/xzYsWbseL26/AkhaTzoeAwBL1q7H6OVrUV4UmKzgfmB5n6jPGR5OYHQ0iY6OuGNyoa7iQBXTOBOJAXbOC/cwgTfF8mMP9aNcHhADN+3cJa5LTgvFlNFYHLMXrcTFi7mysjN1E0ZkzyW1/LSwycFwBkktaT2JJWvXoyP9Ph5e9yCeem6347kGb7syaLtmxWKsWbHYpL51PYEzb++zMFkVAul6whXptKrlQrPnkhoByd12kscH7gcAvHe+BWtWLMapI5uvHPvvu3FwY7spVEjrScTb2oUjc3BjO04d2Wz6PLzuQWzZ/ryjRtiy/Xm8+PKbtsDJjKs2A11R1GRXfHvfqpXYs3cforE4Dm4EgMsMW/0wnnpuNwY2LDR5oGtWLMZTTz+BgQ1PAgAObmwXLE7ryctOzpPimAX9g8LD5KMYKgBVk2DkREDdASgH9TyAJ/W2bGkfHh+4H0vWrjcdK4PH7WB0+ji2vPymOGb0PIDoQtMxBBJ/aKKxOLZsf15cu5xMkmq5puNAVUwox1RcjW7auWtKuc5SdnX2opWWWbnydXiMaJefjcV6qzrpRasmeDcEcib3XAbw1Fgana3RsvKdKofDTlY9usUy55CYT9e0y9TIHnQ43FLVZHZVVSiBZ6eC6EYu6B90BHH2opXi+5m395UEc2xsxDQWyQFxAk81tFSX44F2np18c06NpW1vKhcObjlMzGbPY9Ysazx68uRxBJpuVF6TD+rSMeWEQTUbRvBUFKkvJ49uQf+giAmdYsNSqpaPPsgVbATe9h8PmtincrLcMu26qgzkQzXEvoaGRpH5kFlAqpKXT5RjFxd9/yfKpLm8Tr5eKDRdqTHc1PSg6l4oYG3eQ8NM5YidzeOx3DN/3ms6nzzrSCXcaVGVEPoASiBSPKgqFbS70aTG+PwKyuDw4F5V5MTH++RQQZ4nXyzm8b8LAVcB55pMDI1OiOZzqmY708ImkGT7E5oZL545PYzO1qglCKf8KIUH3PEgdU3rPv28gBnNBdMD5LcZmSIjy1VVVOUtx4wL+geFF8ttnJf6oHkSwEpBJvAA4Ms3z5nscxaajsSwbjnuzq/d5ZkWWp4II6YCHDFuTleHCbzO1igikTaEwy0WB+i/b+xCb0/MNMd9RnPBVc0Kah5ASnyTs8OD/rsX3SXWke3iIcGC/kFLaxJNC2JOVwfmdHXAyyAGvALejOaCcCr4dOehocNihlM2a0DXEzg1lhY2sTDxmQVc7mn6NvA6so+nvigMoPRXb08MmhZEJNKGQ+8cNDku1LxADhfkGM+LNtEzXSoowJcBOHx0BPt3bBPzAjOZFIaGDlsyKAR4Q0OjZZsbOzDVjAol9ul6ApoWNAXbBMbmv/ydpceuxIvLlvaZ1G043IKmpuYptynxAbwK9vG/JE1NzeK7YYzDMMZx67dTeGT7PCxb2icaKLi1nqUubKDcjoSPzQUCwG9//ywAmIp3aW77fatWms5lVyrvVfvnCRtIqTayYdxmDQ8nhKoUT6QWANa9gRXL7rUwtBZUpme9UJ4Llef18XWq2U4ygHIZo5cZ6Aknhhc+cftFmRdZ7MCTR9BrgYmecGIoBcYBsYvrZAeFg0eFxKpg3qvZmIAX2Ec3WgZK1xMWoPhgrVPnCQ6eiuG+E3MN2ccb68hA8UIjOztH3STIKbqp8+ZiqYboPgOvcQzIJ5LIdTRUW6OaSetk5+RqOC+qUdcyUNXNQm69XElCek5XB44BRRW4kUgbIqh+26yaY6Cs5rLZ80J1UkxIjKTpXlx18kavmUxKjCE6sdRrLHT1q3eIgRMTF3DxYg6xWK/pvUi8j6ddp6VSIYZcwFTtSuuaYSCvUqOuvfSeh1AobALPDjDevI6+y73W5HdP+Cr0Gjsvo6NJZLPnHdtvqdhnpyKdXg7pRTXqOgC582KyTaGw43sfiHGlug5GIm2W7oSchW58vY5nAORPPsV+VGZPcZ7calLVSckJRF1POFZk0wPhFRa68u1lcqBOdTDy/EE7x6QUC4mpqrn5fPKKF5wZ18WBJ08ex2+eeEwsUxsQ3lm3lJTaJxJpw8TEBQE0n537pXsmS/Nnt/f4YcRUGHjm9LBpXWdrtCzQKhUCT67eBoDCxGdojy/0BANdZQOz55La7PYeUdNJJYGVeK3l7qd6KDpbo+hsjXoGPNep0NDMePHjF58WN1MlExMXLOsaG4MYHU06nruxMYhcLi/aZpFK5tfhU9XmrdlQ9G3gFD1QAKZJKqWEeq4RSKX2kWNBAo7AoxnAXniXvKtUKLGvXOBUDJPX2QHJRZ4gmtaTpt/iA/gFCgepsTEolu1emsULnWThD81U5+HXLYDZc0lt3poNlhuanxYuGdfJ7JNBLSWrHt1iaZQXufM7nnBkXBdGAEDm0J+Q1pOYt2aDKCvkKS7ZkeEg5XJ5AagMXi6Xt5QaUlBPdjAai3sGPNcBqHJoygFQBpKDJzs4KgB5XOi1GbyuHJEv9wZy1WmnKvk+Tvav2i2zagrASsBTqU95WQWu/FodwFx2wRsoTPUBq1sVqlKpM5oLYgpZJSrU9M9qQaX6lLM4fB69XJdD29wComfCCO5lyqqQs4zvl8vlxXIul1em21TrYrFeMf2ay+92PGvpQ+Or0ArEqQpNVpcyC5uami3HfnL8mMi33nrrV5RgUqnFoXcO4u5Fd+HICXfNo/AMAykFxm+yXbzHWafKvlDzHhoyCjTdiE+OH8Nbb71iAflfv/8lDr1zEENDh10HnqdsINkjYkWxmDfFfHa2kJa5/ePeJndSaCgr3tmJpqZmfHL8mGlc0O/UdJUg8kq1s2dHLCGEU1Kb2027cEFuvsfL8f1A/hqxUFWYW6mU8iLpWn4q7QsA8ZbuDny376vK7X888B8MDyccPcWf/+HlmuqVFoAvPoDXS7LnktqRE6NIpk477ldquw+gCySZOm0BilRrvK3dFsRrYUN9AK9Sdr7+LuJt7eJdSSpxAtEHsMpqtFyGOgHsA+hyqQfwPA9gPTkrNQlgpSxLpk674m0rPoCXA3KV5KeFxXwK34lxuSMjA0RZlvy0sO/EeF2F+k6Mx0WlPne+/m5N5UFr2gv1GehiCc2MF3/2vRWWbEvwkuE4NbrUdh/A6wSeimnJ1GmEwy0IXjIwcO/tSrZ+ERNFqy2erAuVAdq0c5ep8wQxk8DdtHNXTYLnOQCpCcILrx4wrZfBIbVKf+UC3loSzWvgyS/tyGRSyGYNFIsFE5i8hRZ1nvBq+XzN2EAVeJFIGy4Gplu28+Y9lD6rhdcMeJqBdttoBlO522uJgf8HflUTJLhVsAIAAAAASUVORK5CYII=", "pat": "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", "paper": "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", "fold": "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"}
    const SIZE = 72
    const actionStyle = {
      border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))',
      background: 'var(--dsw-alias-button-elevated-fill, rgba(255,255,255,.08))',
      color: 'inherit', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontSize: 12,
    }
    const FALLBACK = {
      zh: {
        pet: '汀岚', title: 'Famling · 汀岚', close: '关闭',
        note: '非官方桌宠 · 本地小互动 · 未连接模型',
        hello: '我在。今天想在 DSH 里做什么？',
        pat: '摸摸', paper: '给纸片', fold: '折一下',
        patLine: '被摸到了。今天的纸片声音很轻。',
        paperLine: '收到一张纸片，夹进折页里了。',
        foldLine: '折了一下。这个角会记得。',
        standalone: '打开独立 famling（GitHub）',
      },
      en: {
        pet: 'Tinglan', title: 'Famling · Tinglan', close: 'Close',
        note: 'Unofficial pet · local mini interactions · no model connection',
        hello: 'I am here. What shall we do in DSH today?',
        pat: 'Pat', paper: 'Paper', fold: 'Fold',
        patLine: 'Pat received. The paper sounds soft today.',
        paperLine: 'A sheet of paper, tucked into the fold.',
        foldLine: 'A little fold. This corner will remember.',
        standalone: 'Open standalone famling (GitHub)',
      },
    }
    function labels() {
      let lang = 'zh'
      try { if (typeof navigator !== 'undefined' && !/^zh/i.test(navigator.language)) lang = 'en' } catch {}
      return FALLBACK[lang] || FALLBACK.zh
    }
    function FamlingFooter() {
      const [open, setOpen] = useState(false)
      const [line, setLine] = useState('')
      const [pose, setPose] = useState('idle')
      const [hop, setHop] = useState(false)
      const closeRef = useRef(null)
      const rootRef = useRef(null)
      const timerRef = useRef(null)
      const L = labels()
      useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
      useEffect(() => {
        if (!open) return
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
        const onPointer = (event) => {
          if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('pointerdown', onPointer)
        closeRef.current?.focus()
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onPointer)
        }
      }, [open])
      function act(kind, message) {
        setLine(L[message])
        setPose(kind)
        setHop(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => { setHop(false); setPose('idle') }, 700)
      }
      const avatar = h('img', {
        key: 'avatar', src: FRAMES[pose] || FRAMES.idle, width: SIZE, height: SIZE,
        alt: L.pet, draggable: false,
        style: {
          imageRendering: 'pixelated', display: 'block', flex: 'none',
          transform: hop ? 'translateY(-6px) scale(1.08)' : 'none',
          transition: 'transform .18s ease-out',
          filter: hop ? 'drop-shadow(0 4px 8px rgba(0,0,0,.28))' : 'none',
        },
      })
      const panel = open ? h('div', {
        role: 'dialog', 'aria-label': L.title,
        style: {
          position: 'fixed', left: 12, bottom: 104, zIndex: 1200,
          width: 304, maxWidth: 'calc(100vw - 24px)',
          background: 'var(--dsw-alias-bg-elevated, #1f2329)',
          color: 'var(--dsw-alias-label-primary, #e8e8e8)',
          border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.16))',
          borderRadius: 'var(--dsw-radius-md, 10px)',
          boxShadow: '0 10px 30px rgba(0,0,0,.32)',
          padding: 12, fontSize: 13, lineHeight: 1.55,
        },
      }, [
        h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 } }, [
          h('div', { key: 'pet', style: { width: SIZE, height: SIZE, flex: 'none', borderRadius: 10, background: 'var(--dsw-alias-bg-l1, rgba(255,255,255,.08))', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } }, avatar),
          h('div', { key: 't', style: { flex: 1, minWidth: 0 } }, [
            h('div', { key: 'n', style: { fontWeight: 600, fontSize: 14 } }, L.title),
            h('div', { key: 's', style: { fontSize: 11, color: 'var(--dsw-alias-label-caption, #9aa0a6)' } }, L.note),
          ]),
          h('button', { key: 'x', ref: closeRef, type: 'button', onClick: () => setOpen(false), 'aria-label': L.close, style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 } }, '×'),
        ]),
        h('p', { key: 'msg', 'aria-live': 'polite', style: { margin: '4px 0 10px', minHeight: 22 } }, line || L.hello),
        h('div', { key: 'actions', style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, [
          h('button', { key: 'p', type: 'button', onClick: () => act('pat', 'patLine'), style: actionStyle }, L.pat),
          h('button', { key: 'pa', type: 'button', onClick: () => act('paper', 'paperLine'), style: actionStyle }, L.paper),
          h('button', { key: 'f', type: 'button', onClick: () => act('fold', 'foldLine'), style: actionStyle }, L.fold),
        ]),
        h('a', { key: 'link', href: 'https://github.com/PerryLink/famling', target: '_blank', rel: 'noreferrer noopener', style: { display: 'inline-block', marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-business-primary, #7aa2ff)' } }, L.standalone),
      ]) : null
      return h('div', { ref: rootRef, style: { position: 'relative' } }, [
        h('button', {
          key: 'btn', type: 'button', 'aria-expanded': open, 'aria-label': L.title,
          title: L.title, onClick: () => setOpen((v) => !v),
          style: {
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: SIZE + 8,
            border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer',
            padding: '4px 6px', borderRadius: 'var(--dsw-radius-sm, 6px)', font: 'inherit',
            justifyContent: 'flex-start', textAlign: 'left',
          },
        }, [
          avatar,
          h('div', { key: 'meta', style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } }, [
            h('span', { key: 'n', style: { fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, L.pet),
            h('span', { key: 'dot', 'aria-hidden': true, style: { width: 6, height: 6, borderRadius: 99, background: 'var(--dsw-alias-state-success, #62d6a0)', flex: 'none' } }),
          ]),
        ]),
        panel,
      ])
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        return ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'dsh-famling', order: 40,
        }, FamlingFooter))
      },
    }
  },
})
