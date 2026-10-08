// „🔄 Verifică SEAP acum” (E7, review PR-1 r5): intrarea principală a licitației din raportul veghei + „Nimic nou” doar când
// nu s-a adus și nu s-a anunțat nimic. Forma raportului: supabase/functions/ofertare-seap-veghe/index.ts (raport.push).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { intrareVeghe, rezumatVeghe } from './ofertareVeghe.js'

const principala = (x = {}) => ({ licitatie: 'L1', termen: null, noi: 0, raspunsuri: 0, raspunsuri_aduse: 0, aduse: 0, ramase: 0, marcate: 0, versiuni_anuntate: 0, coduri: {}, ...x })

describe('intrareVeghe: intrarea PRINCIPALĂ (cu `termen`), nu prima a licitației', () => {
  it('sare intrările de eroare dinaintea celei principale (notificare_esuata, marcare_esuata, inventar dupa import)', () => {
    const data = { raport: [
      { licitatie: 'L0', termen: null, aduse: 9 },
      { licitatie: 'L1', notificare_esuata: 'x' }, { licitatie: 'L1', marcare_esuata: 'y' },
      principala({ aduse: 2 }),
    ] }
    expect(intrareVeghe(data, 'L1')).toBe(data.raport[3])
  })
  it('doar o intrare de eroare (SEAP HTTP / inventar) → ea; licitație negăsită → principala din raport; fără raport → răspunsul însuși', () => {
    const err = { licitatie: 'L1', eroare: 'SEAP HTTP 403' }
    expect(intrareVeghe({ raport: [err] }, 'L1')).toBe(err)
    const alta = principala({ licitatie: 'L9' })
    expect(intrareVeghe({ raport: [{ licitatie: 'L9', notificare_esuata: 'x' }, alta] }, 'L1')).toBe(alta)
    expect(intrareVeghe({ raport: [] }, 'L1')).toBe(null)
    expect(intrareVeghe({ info: 'x' }, 'L1')).toEqual({ info: 'x' })
  })
})

describe('rezumatVeghe: „Nimic nou” doar când nu s-a adus și nu s-a anunțat nimic', () => {
  it('documente aduse (număr, nu listă) + răspunsuri + versiuni anunțate se adună', () => {
    expect(rezumatVeghe(principala({ aduse: 2 })).total).toBe(2)
    expect(rezumatVeghe(principala({ aduse: 1, raspunsuri_aduse: 2, versiuni_anuntate: 1 }))).toMatchObject({ aduse: 1, raspunsuri: 2, versiuni: 1, total: 4 })
    expect(rezumatVeghe(principala({ aduse: 2 })).text).toMatch(/^📂 Din SEAP: 2 document\(e\) noi aduse$/)
  })
  it('doar o versiune anunțată (importul a adus-o; `aduse` numără doar documentele noi) → NU „Nimic nou”', () => {
    const r = rezumatVeghe(principala({ versiuni_anuntate: 1 }))
    expect(r.total).toBe(1)
    expect(r.text).toMatch(/versiune/)
    expect(r.text).not.toMatch(/Nimic nou/)
  })
  it('nimic adus / anunțat, intrare de eroare sau lipsă → „Nimic nou”', () => {
    for (const r of [principala(), { licitatie: 'L1', eroare: 'SEAP HTTP 403' }, null, undefined]) expect(rezumatVeghe(r).text).toBe('Nimic nou în SEAP acum.')
  })
  it('UI: „Verifică SEAP acum” folosește intrarea principală și rezumatul (nu `.length` pe numere); veghea raportează versiuni_anuntate', () => {
    const ui = readFileSync(new URL('./OfertareLicitatii.jsx', import.meta.url), 'utf8')
    const bloc = ui.slice(ui.indexOf('const verificaAcum = async'), ui.indexOf('const badgeTip ='))
    expect(bloc).toMatch(/const r = intrareVeghe\(data, l\.nr_anunt\)/)
    expect(bloc).toMatch(/anunta\(rezumatVeghe\(r\)\.text\)/)
    expect(bloc).not.toMatch(/adusi\?\.length|raspunsuri_aduse\?\.length/)
    const veghe = readFileSync(new URL('../supabase/functions/ofertare-seap-veghe/index.ts', import.meta.url), 'utf8')
    expect(veghe).toMatch(/raport\.push\(\{ licitatie: lic\.nr_anunt, termen, noi: noi\.length,[^\n]*aduse: auIntrat\.length,[^\n]*versiuni_anuntate: versiuniAnuntate,/)
  })
})
