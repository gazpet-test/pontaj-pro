// Randare server-side (react-dom/server) a modalului de fișiere din Corespondență: ce vede viewer-ul / editorul, marcajul „aprobat”, rolurile permise.
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('../../lib/supabase.js', () => ({ supabase: { from: () => ({}), storage: { from: () => ({}) } } }))

import CorespondentaEcran, { ModalFisiere, BtnAproba } from './CorespondentaEcran.jsx'

const SHA = 'cd'.repeat(32)
const fis = [
  { id: 'f1', corespondenta_id: 'r1', rol: 'de_trimis', path: 'P/corespondenta/A1/20261104-090000-cdcdcdcd-scrisoare.pdf', nume_original: 'Scrisoare.pdf', marime: 2048, sha256: SHA, storage_etag: '"etag-f1"', created_at: '2026-11-04T09:00:00+00:00' },
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
  it('editor: fișierele urcate dar neînregistrate apar cu „Înregistrează” (viewer nu le vede); SHA-256 marcat „declarat”', () => {
    const rand = { id: 'r1', cod: 'A1', stare: 'draft', subiect: 's', destinatar: 'd' }
    const orfane = { randId: 'r1', lista: [{ path: 'P/corespondenta/A1/x-orfan.pdf', nume: 'x-orfan.pdf', marime: 10 }], eroare: '' }
    const ed = renderToString(<ModalFisiere rand={rand} fisiere={fis} poateScrie lucru={false} orfane={orfane} onClose={fara} onUrca={fara} onInregistreaza={fara} onDescarca={fara} />)
    expect(ed).toContain('Fișiere urcate dar neînregistrate'); expect(ed).toContain('x-orfan.pdf'); expect(ed).toContain('Înregistrează')
    expect(ed).toContain('SHA-256 declarat')
    const vw = renderToString(<ModalFisiere rand={rand} fisiere={fis} poateScrie={false} lucru={false} orfane={orfane} onClose={fara} onUrca={fara} onInregistreaza={fara} onDescarca={fara} />)
    expect(vw).not.toContain('neînregistrate')
    const gol = renderToString(<ModalFisiere rand={rand} fisiere={fis} poateScrie lucru={false} orfane={{ randId: 'r1', lista: [], eroare: '' }} onClose={fara} onUrca={fara} onInregistreaza={fara} onDescarca={fara} />)
    expect(gol).not.toContain('neînregistrate')
  })
  it('r2 J-P2-2: urcare neconfirmată -> panou cu calea păstrată și „Reia pe aceeași cale”; eTag-ul serverului e afișat', () => {
    const rand = { id: 'r1', cod: 'A1', stare: 'draft', subiect: 's', destinatar: 'd' }
    const html = renderToString(<ModalFisiere rand={rand} fisiere={fis} poateScrie lucru={false} incercare={{ randId: 'r1', path: 'P/corespondenta/A1/20261104-090000-cdcdcdcd-0123abcd-x.pdf', stare: 'neconfirmat' }}
      onClose={fara} onUrca={fara} onReia={fara} onInregistreaza={fara} onDescarca={fara} />)
    expect(html).toContain('Urcare neconfirmată'); expect(html).toContain('Reia pe aceeași cale'); expect(html).toContain('0123abcd-x.pdf')
    expect(html).toContain('eTag (server)'); expect(html).toContain('&quot;etag-f1&quot;')
    const inc = renderToString(<ModalFisiere rand={rand} fisiere={[]} poateScrie lucru={false} orfane={{ randId: 'r1', lista: [], eroare: '', incompleta: true }}
      onClose={fara} onUrca={fara} onInregistreaza={fara} onDescarca={fara} />)
    expect(inc).toContain('Listă posibil incompletă')
  })
  it('r4: „Renunță la încercare” doar cât obiectul nu e confirmat în Storage; altfel doar „Înregistrează cu payload-ul inițial”; câmpurile blocate cât lucrează', () => {
    const rand = { id: 'r1', cod: 'A1', stare: 'draft', subiect: 's', destinatar: 'd' }
    const inc = { randId: 'r1', path: 'P/corespondenta/A1/x.pdf', stare: 'neconfirmat', rol: 'de_trimis', observatii: null }
    const h1 = renderToString(<ModalFisiere rand={rand} fisiere={[]} poateScrie lucru={false} incercare={inc} onClose={fara} onUrca={fara} onReia={fara} onRenunta={fara} onInregistreaza={fara} onDescarca={fara} />)
    expect(h1).toContain('Renunță la încercare'); expect(h1).toContain('Reia pe aceeași cale')
    const h2 = renderToString(<ModalFisiere rand={rand} fisiere={[]} poateScrie lucru={false} incercare={{ ...inc, obiectExista: true }} onClose={fara} onUrca={fara} onReia={fara} onRenunta={fara} onInregistreaza={fara} onDescarca={fara} />)
    expect(h2).not.toContain('Renunță la încercare'); expect(h2).toContain('Înregistrează cu payload-ul inițial')
    const h3 = renderToString(<ModalFisiere rand={rand} fisiere={[]} poateScrie lucru incercare={null} onClose={fara} onUrca={fara} onInregistreaza={fara} onDescarca={fara} />)
    expect(h3.match(/<select[^>]*disabled=""/g)?.length).toBe(1); expect(h3).toMatch(/type="file"[^>]*disabled=""/); expect(h3).toMatch(/maxLength="1000" disabled=""|disabled=""[^>]*maxLength="1000"/)
  })
  it('„Aprob” dezactivat fără fișier de trimis, cu tooltip', () => {
    expect(renderToString(<BtnAproba fa={null} lucru={false} onClick={fara} />)).toMatch(/disabled=""[^>]*title="urcă întâi fișierul de trimis"|title="urcă întâi fișierul de trimis"[^>]*disabled=""/)
    const ok = renderToString(<BtnAproba fa={fis[0]} lucru={false} onClick={fara} />)
    expect(ok).not.toContain('disabled'); expect(ok).toContain('Scrisoare.pdf (eTag &quot;etag-f1&quot;)')
  })
  it('ecranul se randează (încărcare)', () => {
    const html = renderToString(<CorespondentaEcran proiect={{ id: 'p1', cod: 'P' }} nivel="viewer" profile={{}} show={fara} />)
    expect(html).toContain('Se încarcă')
  })
})
