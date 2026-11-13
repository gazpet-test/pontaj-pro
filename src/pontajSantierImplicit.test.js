// Șantierul implicit în pontaj = cel din ziua precedentă lucrată (TKT-2026-0360). Valorile așteptate sunt scrise de mână din cerere (L25);
// citirea e probată pe un server FALS care aplică filtrele ca PostgREST și taie la max-rows = 1000 (ca Supabase), indiferent de .limit().
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { esteZiLucrataCuSantier, ultimulSantierDinRanduri, santierImplicit, incarcaUltimulSantier } from './pontajSantierImplicit.js'

// ── serverul fals: in / lt / not is null / or(check_in.not.is.null,norma.is.null) / order / limit, plafon de server 1000 ──
function serverFals(randuri, { maxRows = 1000, strica = null } = {}) {
  const cereri = []
  const sb = {
    from(tabel) {
      const q = { tabel, filtre: [], ord: [], lim: null }
      const b = {
        select() { return b },
        in(c, v) { q.filtre.push(r => v.includes(r[c])); q.in = v; return b },
        lt(c, v) { q.filtre.push(r => r[c] < v); return b },
        not(c, op, v) { if (op !== 'is' || v !== null) throw new Error('filtru neașteptat'); q.filtre.push(r => r[c] != null); return b },
        or(expr) { if (expr !== 'check_in.not.is.null,norma.is.null') throw new Error('or neașteptat: ' + expr); q.filtre.push(r => r.check_in != null || r.norma == null); return b },
        order(c, { ascending }) { q.ord.push([c, ascending]); return b },
        limit(n) { q.lim = n; return b },
        then(res, rej) {
          cereri.push(q)
          if (strica === 'eroare') return Promise.resolve({ data: null, error: { message: 'timeout' } }).then(res, rej)
          let rows = randuri.filter(r => q.filtre.every(f => f(r)))
          rows.sort((a, b2) => { for (const [c, asc] of q.ord) { if (a[c] !== b2[c]) return (a[c] < b2[c] ? -1 : 1) * (asc ? 1 : -1) } return 0 })
          rows = rows.slice(0, Math.min(q.lim ?? Infinity, maxRows))
          if (strica === 'ignora_filtrul') rows = randuri.slice(0, 3)
          return Promise.resolve({ data: rows, error: null }).then(res, rej)
        },
      }
      return b
    },
  }
  return { sb, cereri }
}
let nextId = 1
const r = (employee_id, date, site_id, extra = {}) => ({ id: nextId++, employee_id, date, site_id, check_in: `${date}T05:00:00Z`, norma: null, ...extra })
const absenta = (employee_id, date, site_id, norma) => r(employee_id, date, site_id, { check_in: null, norma })

describe('regula de alegere (afișare și salvare)', () => {
  it('ordinea: rândul zilei > ultima zi lucrată > fișa > nimic', () => {
    const emp = { id: 1, site_id: 10 }
    expect(santierImplicit({ rec: { site_id: 30 }, ultim: { site_id: 20, date: '2026-11-12' }, emp })).toEqual({ site_id: 30, sursa: 'zi', data: null })
    expect(santierImplicit({ rec: null, ultim: { site_id: 20, date: '2026-11-12' }, emp })).toEqual({ site_id: 20, sursa: 'precedent', data: '2026-11-12' })
    expect(santierImplicit({ rec: null, ultim: undefined, emp })).toEqual({ site_id: 10, sursa: 'fisa', data: null })
    expect(santierImplicit({ rec: null, ultim: undefined, emp: { id: 2, site_id: null } })).toEqual({ site_id: null, sursa: null, data: null })
  })
  it('rândul zilei fără șantier (ex. absență scrisă fără șantier) nu ascunde ziua precedentă', () => {
    expect(santierImplicit({ rec: { site_id: null, norma: 'CO' }, ultim: { site_id: 20, date: '2026-11-10' }, emp: { site_id: 10 } }).site_id).toBe(20)
  })
  it('alegerea manuală (rândul zilei) are prioritate chiar dacă diferă de ziua precedentă și de fișă', () => {
    expect(santierImplicit({ rec: { site_id: 99 }, ultim: { site_id: 20, date: '2026-11-12' }, emp: { site_id: 10 } }).site_id).toBe(99)
  })
  it('zi lucrată = șantier + (oră de intrare sau fără normă); absențele (CO / CM / LL) fără oră nu contează', () => {
    expect(esteZiLucrataCuSantier({ site_id: 5, check_in: 'x', norma: null })).toBe(true)
    expect(esteZiLucrataCuSantier({ site_id: 5, check_in: null, norma: null })).toBe(true)     // alocare manuală pe zi, fără ore încă
    expect(esteZiLucrataCuSantier({ site_id: 5, check_in: null, norma: 'CO' })).toBe(false)
    expect(esteZiLucrataCuSantier({ site_id: 5, check_in: null, norma: 'LL' })).toBe(false)
    expect(esteZiLucrataCuSantier({ site_id: null, check_in: 'x', norma: null })).toBe(false)
  })
})

describe('ultima zi lucrată, din rânduri', () => {
  it('cazurile din cerere: concediu între timp, prima zi a lunii, fără pontaj anterior, ziua aleasă și cele de după ignorate', () => {
    const rows = [
      r(1, '2026-10-28', 20), r(1, '2026-10-29', 20), absenta(1, '2026-10-30', 10, 'CO'), absenta(1, '2026-10-31', 10, 'CO'),
      r(2, '2026-10-31', 30), r(2, '2026-11-01', 31), r(2, '2026-11-03', 32),
    ]
    const m = ultimulSantierDinRanduri(rows, '2026-11-01')
    // 1: concediul (scris cu șantierul din fișă, 10) nu contează; ultima zi LUCRATĂ e 29.10, pe 20 — prima zi a lunii ia din luna trecută
    expect(m.get(1)).toEqual({ site_id: 20, date: '2026-10-29' })
    // 2: ziua aleasă (01.11) și cele de după nu contează
    expect(m.get(2)).toEqual({ site_id: 30, date: '2026-10-31' })
    expect(m.has(3)).toBe(false)
  })
  it('două rânduri în aceeași zi (în BD nu se poate, UNIQUE): câștigă ultimul scris (id mai mare)', () => {
    const a = r(7, '2026-11-12', 40), b = r(7, '2026-11-12', 41)
    expect(ultimulSantierDinRanduri([b, a], '2026-11-13').get(7).site_id).toBe(41)
  })
})

describe('citirea din BD: exactă și paginată', () => {
  it('cazurile din cerere, pe serverul fals', async () => {
    const rows = [
      r(1, '2026-10-29', 20), absenta(1, '2026-10-30', 10, 'CO'), absenta(1, '2026-11-02', 10, 'CM'),
      r(2, '2026-11-12', 30), r(2, '2026-11-13', 31),
      r(3, '2026-11-12', null), // fără șantier: nu contează
    ]
    const { sb } = serverFals(rows)
    const m = await incarcaUltimulSantier(sb, [1, 2, 3, 4], '2026-11-13')
    expect(m.get(1)).toEqual({ site_id: 20, date: '2026-10-29' })
    expect(m.get(2)).toEqual({ site_id: 30, date: '2026-11-12' })
    expect(m.has(3)).toBe(false)
    expect(m.has(4)).toBe(false)
  })
  it('peste plafonul de 1000: un angajat cu istoric lung și altul cu ultima zi foarte veche — fără trunchiere tăcută', async () => {
    const rows = []
    // angajatul 1: 1.500 de zile lucrate recent pe 50 (umple singur prima pagină)
    for (let i = 0; i < 1500; i++) rows.push(r(1, new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10), 50))
    // angajatul 2: ultima zi lucrată acum 5 ani (în afara oricărei ferestre), apoi doar concediu
    rows.push(r(2, '2021-03-15', 60))
    for (let i = 0; i < 1200; i++) rows.push(absenta(2, new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10), 10, 'CM'))
    const { sb, cereri } = serverFals(rows)
    const m = await incarcaUltimulSantier(sb, [1, 2], '2026-11-13')
    expect(m.get(1)).toEqual({ site_id: 50, date: '2026-02-08' })
    expect(m.get(2)).toEqual({ site_id: 60, date: '2021-03-15' })
    // a doua cerere doar pentru cel nerezolvat
    expect(cereri.length).toBe(2)
    expect(cereri[1].in).toEqual([2])
  })
  it('limita cerută peste plafonul serverului nu face să se piardă angajați (oprire la pagina goală, nu la „pagină scurtă”)', async () => {
    const rows = []
    // angajatul 1: 1.200 de zile recente (serverul dă doar 1.000 din 5.000 cerute = „pagină scurtă”); angajatul 2: o zi veche
    for (let i = 0; i < 1200; i++) rows.push(r(1, new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString().slice(0, 10), 80))
    rows.push(r(2, '2022-06-01', 81))
    const { sb, cereri } = serverFals(rows, { maxRows: 1000 })
    const m = await incarcaUltimulSantier(sb, [1, 2], '2026-11-13', { pas: 5000 })
    expect(m.get(1)).toEqual({ site_id: 80, date: '2026-04-14' })
    expect(m.get(2)).toEqual({ site_id: 81, date: '2022-06-01' })
    expect(cereri[0].lim).toBe(5000)
  })
  it('id-urile pe bucăți (URL scurt): fiecare cerere are cel mult `bucata` id-uri', async () => {
    const rows = Array.from({ length: 230 }, (_, i) => r(i + 1, '2026-11-12', 70))
    const { sb, cereri } = serverFals(rows)
    const m = await incarcaUltimulSantier(sb, rows.map(x => x.employee_id), '2026-11-13')
    expect(m.size).toBe(230)
    expect(Math.max(...cereri.map(q => q.in.length))).toBeLessThanOrEqual(100)
  })
  it('eroarea serverului NU e „fără pontaj anterior” (L18): aruncă', async () => {
    const { sb } = serverFals([], { strica: 'eroare' })
    await expect(incarcaUltimulSantier(sb, [1], '2026-11-13')).rejects.toThrow(/timeout/)
  })
  it('un răspuns care ignoră filtrul = eroare, nu buclă și nu valori greșite', async () => {
    const { sb } = serverFals([r(9, '2026-11-20', 1), r(9, '2026-11-21', 1), r(9, '2026-11-22', 1)], { strica: 'ignora_filtrul' })
    await expect(incarcaUltimulSantier(sb, [1], '2026-11-13')).rejects.toThrow(/în afara filtrului|altă ordine|fără angajații/)
  })
  it('zi invalidă = eroare', async () => {
    const { sb } = serverFals([])
    await expect(incarcaUltimulSantier(sb, [1], '13.11.2026')).rejects.toThrow(/invalidă/)
  })
})

// legătura cu ecranul: aceeași regulă la afișare, la select, la filtrul pe șantier și la salvare
describe('PontajPage folosește regula', () => {
  const APP = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8').replace(/\r/g, '')
  it('salvarea ia șantierul din regula unică, nu din fișă', () => {
    expect(APP).toContain('const recSiteId = santierPentru(emp).site_id')
    expect(APP).not.toContain('const recSiteId = recs[emp.id]?.site_id ?? emp.site_id ?? null')
  })
  it('rândul afișează și propune șantierul din regulă; filtrul pe șantier folosește același șantier', () => {
    expect(APP).toContain('santierImpl={santierPentru(emp)}')
    expect(APP).toContain("value={santierImpl.site_id??''}")
    expect(APP).toContain('String(santierPentru(e).site_id)===String(siteF)')
  })
  it('citirea: la schimbarea zilei / listei, cu token de generație (L24); eroarea se arată, salvarea așteaptă citirea', () => {
    expect(APP).toContain('incarcaUltimulSantier(supabase, emps.map(e=>e.id), d)')
    expect(APP).toContain('if(g!==genUltimRef.current) return')
    expect(APP).toContain('Nu am putut citi ultimul șantier pontat')
    expect(APP).toContain("if(!recs[emp.id]&&ultimStare==='incarc')")
  })
})
