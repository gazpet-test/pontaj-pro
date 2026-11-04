// Randare server-side (react-dom/server) a modalului de fișiere din Corespondență: ce vede viewer-ul / editorul, marcajul „aprobat”, rolurile permise.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => ({}), storage: { from: () => ({}) } } }))

import CorespondentaEcran, { ModalFisiere, BtnAproba } from './CorespondentaEcran.jsx'

const SHA = 'cd'.repeat(32)
const fis = [
  { id: 'f1', corespondenta_id: 'r1', rol: 'de_trimis', path: 'P/corespondenta/A1/20261104-090000-cdcdcdcd-scrisoare.pdf', nume_original: 'Scrisoare.pdf', marime: 2048, sha256: SHA, created_at: '2026-11-04T09:00:00+00:00' },
  { id: 'f2', corespondenta_id: 'r1', rol: 'dovada_trimitere', path: 'P/corespondenta/A1/20261104-100000-eeeeeeee-dovada.pdf', nume_original: 'Dovada.pdf', marime: 100, sha256: 'e'.repeat(64), created_at: '2026-11-04T10:00:00+00:00' },
]
const fara = () => {}

describe('Corespondență — modalul de fișiere', () => {
  it('viewer: lista + Descarcă, fără formular de urcare', () => {
    const html = renderToString(<ModalFisiere rand={{ id: 'r1', cod: 'A1', stare: 'draft', subiect: 's', destinatar: 'd' }} fisiere={fis} poateScrie={false} lucru={false} onClose={fara} onUrca={fara} onDescarca={fara} />)
    expect(html).toContain('Scrisoare.pdf'); expect(html).toContain('cdcdcdcd'); expect(html).toContain('⬇ Descarcă')
    expect(html).not.toContain('⬆ Urcă')
  })
  it('editor pe rând aprobat: formular, avertisment că aprobarea cade, marcaj ✓ aprobat pe fișierul exact', () => {
    const html = renderToString(<ModalFisiere rand={{ id: 'r1', cod: 'A1', stare: 'aprobat', aprobat_la: '2026-11-04T11:00:00Z', aprobat_fisier_id: 'f1', subiect: 's', destinatar: 'd' }}
      fisiere={fis} poateScrie lucru={false} onClose={fara} onUrca={fara} onDescarca={fara} />)
    expect(html).toContain('⬆ Urcă'); expect(html).toContain('✓ aprobat'); expect(html).toContain('anulează aprobarea')
    expect(html).toContain('value="de_trimis"')
  })
  it('rând trimis: „de trimis” nu mai apare printre roluri', () => {
    const html = renderToString(<ModalFisiere rand={{ id: 'r1', cod: 'A1', stare: 'trimis', subiect: 's', destinatar: 'd' }} fisiere={[]} poateScrie lucru={false} onClose={fara} onUrca={fara} onDescarca={fara} />)
    expect(html).not.toContain('value="de_trimis"'); expect(html).toContain('value="dovada_trimitere"'); expect(html).toContain('Niciun fișier urcat')
  })
  it('„Aprob” dezactivat fără fișier de trimis, cu tooltip', () => {
    expect(renderToString(<BtnAproba fa={null} lucru={false} onClick={fara} />)).toMatch(/disabled=""[^>]*title="urcă întâi fișierul de trimis"|title="urcă întâi fișierul de trimis"[^>]*disabled=""/)
    const ok = renderToString(<BtnAproba fa={fis[0]} lucru={false} onClick={fara} />)
    expect(ok).not.toContain('disabled'); expect(ok).toContain('Scrisoare.pdf (cdcdcdcd)')
  })
  it('ecranul se randează (încărcare)', () => {
    const html = renderToString(<CorespondentaEcran proiect={{ id: 'p1', cod: 'P' }} nivel="viewer" profile={{}} show={fara} />)
    expect(html).toContain('Se încarcă')
  })
})
