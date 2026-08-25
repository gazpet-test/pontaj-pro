// ═══════════════════════════════════════════════════════════════════════════
// POPOVER ANCORAT DE UN BUTON DIN BARA DE SUS
// ═══════════════════════════════════════════════════════════════════════════
// De ce există: bara de sus (.topbar) are `overflow-x:auto`, ca să poată fi
// derulată cu degetul pe telefon (PR #99). Regula CSS spune că dacă o axă nu e
// `visible`, cealaltă devine automat `auto` — deci bara TAIE și pe verticală.
// Meniurile deschise sub butoane („De aprobat", „Ale mele") erau poziționate
// `absolute; top:100%+8px`, adică exact sub marginea barei: se randau, dar
// ieșeau din zona vizibilă și păreau că nu se deschid deloc.
//
// Soluția: randăm meniul prin portal în <body>, cu poziție `fixed` calculată
// din rect-ul butonului. Iese complet din zona tăiată și rămâne aliniat sub
// buton la scroll/resize.
// ═══════════════════════════════════════════════════════════════════════════

import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function PopoverBara({ anchorRef, onClose, width = 260, children }) {
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    const calc = () => {
      const r = anchorRef?.current?.getBoundingClientRect()
      if (!r) return
      // Aliniat la dreapta butonului, dar niciodată în afara ecranului (telefon).
      const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
      setPos({ top: r.bottom + 8, left })
    }
    calc()
    window.addEventListener('resize', calc)
    // capture=true: prinde și scroll-ul barei, nu doar al paginii
    window.addEventListener('scroll', calc, true)
    return () => {
      window.removeEventListener('resize', calc)
      window.removeEventListener('scroll', calc, true)
    }
  }, [anchorRef, width])

  if (!pos) return null

  return createPortal(
    <>
      {/* Click în afară = închide */}
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:1199 }} />
      <div style={{
        position:'fixed', top:pos.top, left:pos.left, width,
        zIndex:1200, maxHeight:'calc(100vh - 80px)', overflowY:'auto',
      }}>
        {children}
      </div>
    </>,
    document.body,
  )
}
