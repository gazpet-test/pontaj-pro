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
  it('nimic adus / anunțat sau intrare lipsă → „Nimic nou”; intrarea de eroare → eroarea', () => {
    for (const r of [principala(), null, undefined]) expect(rezumatVeghe(r).text).toBe('Nimic nou în SEAP acum.')
    // review r5: o intrare de eroare NU mai e „Nimic nou” — se spune eroarea
    expect(rezumatVeghe({ licitatie: 'L1', eroare: 'SEAP HTTP 403' }).text).toMatch(/eroare: SEAP HTTP 403/)
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

describe('rezumatVeghe: „Nimic nou” doar când chiar nu e nimic (review PR-1 r5)', () => {
  it('document nou neadus, termen mutat, versiune decisă și neadusă, eroare → nu „Nimic nou”', () => {
    expect(rezumatVeghe({ termen: null, noi: 1, aduse: 0, ramase: 1 }).text).toMatch(/1 document\(e\) noi de urcat manual/)
    expect(rezumatVeghe({ termen: { nou: '2026-11-01T10:00:00Z' } }).text).toMatch(/termenul de depunere s-a schimbat/)
    expect(rezumatVeghe({ termen: null, coduri: { versiuni: ['Caiet (C-00036).pdf'] }, versiuni_anuntate: 0 }).text).toMatch(/1 versiune\(i\) nouă\(i\) încă neadusă/)
    expect(rezumatVeghe({ termen: null, coduri: { versiuni: ['V'] }, versiuni_anuntate: 1 }).text).not.toMatch(/neadus/)
    expect(rezumatVeghe({ licitatie: 'L1', eroare: 'SEAP HTTP 403' }).text).toMatch(/eroare: SEAP HTTP 403/)
    expect(rezumatVeghe({ termen: null, noi: 0, aduse: 0, ramase: 0 }).text).toBe('Nimic nou în SEAP acum.')
  })
  it('Copilot r1: neaduse din inventarul de DUPĂ import (coduri.versiuni_neaduse); identitate neverificată (veghe sau import) → nu „Nimic nou”', () => {
    // versiunea decisă, republicată identic (cod mutat): neaduse = [] → nimic de raportat
    expect(rezumatVeghe({ termen: null, coduri: { versiuni: ['V'], versiuni_neaduse: [] }, versiuni_anuntate: 0 }).text).toBe('Nimic nou în SEAP acum.')
    expect(rezumatVeghe({ termen: null, coduri: { versiuni: ['V'], versiuni_neaduse: ['V'] }, versiuni_anuntate: 0 }).text).toMatch(/1 versiune\(i\) nouă\(i\) încă neadusă/)
    expect(rezumatVeghe({ termen: null, coduri: { identitate_neverificata: ['Anexa.pdf (C/1)'] } }).text).toMatch(/1 document\(e\) cu identitatea neverificată/)
    const r = rezumatVeghe({ termen: null, coduri: { import_erori: ['Anexa.pdf (C/5): identitatea nu s-a putut verifica — conținutul unui candidat nu s-a putut citi', 'alta eroare'] } })
    expect([r.neverificate, r.text]).toEqual([1, '📂 Din SEAP: ⚠ 1 document(e) cu identitatea neverificată (vezi raportul)'])
  })
  it('Jakarinos r9: la „Verifică acum” importul tăcut nu pornește — documentele de rezolvat pe cod NU dau „Nimic nou”; după import, nu se mai numără', () => {
    const r = rezumatVeghe({ termen: null, coduri: { de_rezolvat: 2, import: 'nepornit: verificare din UI (importul il face „Adu din SEAP” sau rularea programata)' } })
    expect([r.deRezolvat, r.text]).toEqual([2, '📂 Din SEAP: 2 document(e) de rezolvat pe codul SEAP — le face „Adu din SEAP” sau verificarea programată'])
    expect(rezumatVeghe({ termen: null, coduri: { de_rezolvat: 2, import: '1 runde' } }).text).toBe('Nimic nou în SEAP acum.')
  })
})
