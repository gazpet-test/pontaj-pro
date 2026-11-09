import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  normalizeazaPropunere, EroarePolita, CAMPURI_PROPUNERE, dataExpirarePropusa, situatiePolita, grupeazaPeDestinatar, mailPolite,
  cheieIdempotenta, stareDupaTrimitere, dataValida, sumaValida, promptPolita, formDinPropunere, mesajEroare, linkDestinatar, aplicaPropunere,
} from './polite.js'

describe('aplicaPropunere (r2, Jakarinos r1 P2-4)', () => {
  it('PDF A propune suma 100, PDF B o respinge: suma lui A nu ramane langa B', () => {
    const initial = { nr_polita: '', valoare_lei: '', asigurator: '' }
    const a = formDinPropunere({ campuri: { nr_polita: 'A-1', suma: 100 }, dezacorduri: [] }, 'polita', { valoare: 'valoare_lei' })
    let form = aplicaPropunere({ ...initial, asigurator: 'scris de mana' }, initial, [], a.valori)
    expect(form).toEqual({ nr_polita: 'A-1', valoare_lei: '100', asigurator: 'scris de mana' })
    const b = formDinPropunere({ campuri: { nr_polita: 'B-2' }, dezacorduri: [{ camp: 'suma', motiv: 'format_invalid' }] }, 'polita', { valoare: 'valoare_lei' })
    form = aplicaPropunere(form, initial, a.propuse, b.valori)
    expect(form).toEqual({ nr_polita: 'B-2', valoare_lei: '', asigurator: 'scris de mana' })
    expect(b.nesigure).toEqual(['valoare_lei'])
    // schimbarea PDF-ului fara citire noua (propunere null): campurile lui A revin la initial
    expect(aplicaPropunere(form, initial, b.propuse, null)).toEqual({ nr_polita: '', valoare_lei: '', asigurator: 'scris de mana' })
  })
})

const radacina = path.resolve(__dirname, '..')
const citeste = f => fs.readFileSync(path.join(radacina, f), 'utf8').replace(/\r/g, '')
const MIG = citeste('supabase/migrations/20261205a_polite_alerte.sql')
const REV = citeste('supabase/revenire/20261205a_polite_alerte_ROLLBACK.sql')

const c = (valoare, citat = 'text', pagina = 1) => ({ valoare, citat, pagina })

describe('normalizeazaPropunere', () => {
  it('pastreaza doar campurile cu dovada si formatul corect', () => {
    const r = normalizeazaPropunere({ este_polita: true, este_act_aditional: false, campuri: {
      tip: c('car'), asigurator: c('  GROUPAMA  '), nr_polita: c('F2669469'), suma: c(1250000.5), moneda: c('ron'),
      data_emitere: c('2025-04-01'), executie_de_la: c('2025-04-01'), executie_pana_la: c('2026-12-17'), contract_nr: c('30'), contract_data: c('2025-03-28'),
      necunoscut: c('x'),
    } })
    expect(r.este_act).toBe(false)
    expect(r.campuri).toMatchObject({ tip: 'CAR', asigurator: 'GROUPAMA', nr_polita: 'F2669469', suma: 1250000.5, moneda: 'RON', executie_pana_la: '2026-12-17', este_act_aditional: false })
    expect(r.campuri.necunoscut).toBeUndefined()
    expect(r.campuri.dovezi.nr_polita).toEqual({ pagina: 1, citat: 'text' })
    expect(r.dezacorduri).toEqual([])
  })
  it('golește campurile fara citat, cu format gresit sau peste limita (nu taie)', () => {
    const r = normalizeazaPropunere({ este_polita: true, campuri: {
      nr_polita: { valoare: 'X1' }, data_emitere: c('2026-02-30'), suma: c('1.000,50'), asigurator: c('A'.repeat(201)),
      tip: c('bună execuție'), moneda: c('USD'), nr_act: c(0), suma2: c(1), garantie_pana_la: c('2028-01-01'),
    } })
    expect(r.campuri).toEqual({ garantie_pana_la: '2028-01-01', este_act_aditional: false, dovezi: { garantie_pana_la: { pagina: 1, citat: 'text' } } })
    expect(r.dezacorduri.map(d => `${d.camp}:${d.motiv}`).sort()).toEqual(
      ['asigurator:prea_lung', 'data_emitere:format_invalid', 'moneda:format_invalid', 'nr_act:format_invalid', 'nr_polita:fara_dovada', 'suma:format_invalid', 'tip:format_invalid'])
  })
  it('perioada inversata = ambele capete nesigure', () => {
    const r = normalizeazaPropunere({ este_polita: true, campuri: { garantie_de_la: c('2027-01-01'), garantie_pana_la: c('2026-01-01'), asigurator: c('A') } })
    expect(r.campuri.garantie_de_la).toBeUndefined()
    expect(r.dezacorduri).toEqual([{ camp: 'garantie', motiv: 'perioada_inversata' }])
  })
  it('pagina in afara celor citite sau citat prea lung = fara dovada', () => {
    const r = normalizeazaPropunere({ este_polita: true, campuri: { nr_polita: c('A', 'x', 3), asigurator: c('B', 'y'.repeat(301)), data_emitere: c('2025-01-01') } })
    expect(r.dezacorduri.map(d => d.motiv)).toEqual(['fara_dovada', 'fara_dovada'])
  })
  it('refuza raspunsurile care nu sunt polita sau nu sunt obiecte', () => {
    expect(() => normalizeazaPropunere({ este_polita: false })).toThrow(EroarePolita)
    expect(() => normalizeazaPropunere([])).toThrow('raspuns_invalid')
    expect(() => normalizeazaPropunere(null)).toThrow('raspuns_invalid')
    expect(() => normalizeazaPropunere({ campuri: {} })).toThrow('nu_e_polita')
    // r2 (Jakarinos r1 P2-10): fara niciun camp util = citire goala; indicator de act invalid / campuri lipsa = raspuns invalid
    expect(() => normalizeazaPropunere({ este_polita: true, campuri: {} })).toThrow('citire_goala')
    expect(() => normalizeazaPropunere({ este_polita: true, campuri: { tip: c('CAR'), moneda: c('RON') } })).toThrow('citire_goala')
    expect(() => normalizeazaPropunere({ este_polita: true, este_act_aditional: 'da', campuri: { nr_polita: c('A') } })).toThrow('raspuns_invalid')
    expect(() => normalizeazaPropunere({ este_polita: true })).toThrow('raspuns_invalid')
  })
  it('act aditional: numarul actului si polita de baza', () => {
    const r = normalizeazaPropunere({ este_polita: true, este_act_aditional: true, campuri: { nr_act: c('5'), polita_baza_nr: c('H35416'), valabila_pana_la: c('2027-06-30') } })
    expect(r.este_act).toBe(true)
    expect(r.campuri).toMatchObject({ nr_act: 5, polita_baza_nr: 'H35416', valabila_pana_la: '2027-06-30', este_act_aditional: true })
  })
})

describe('paritate cu migrarea (L19)', () => {
  it('cheile propunerii sunt exact cele acceptate de fn_polite_propunere_completeaza', () => {
    const m = MIG.match(/c_chei CONSTANT text\[\] := ARRAY\[([^\]]+)\]/)
    expect(m).toBeTruthy()
    const sql = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]).sort()
    const js = [...CAMPURI_PROPUNERE.filter(k => k !== 'nr_act' || true), 'este_act_aditional', 'dovezi'].sort()
    expect(js).toEqual(sql)
  })
  it('tipurile si monedele din UI sunt cele din CHECK-urile migrarii', () => {
    expect(MIG).toContain("CHECK (tip = ANY (ARRAY['GBE'::text, 'CAR'::text, 'GPL'::text, 'avans'::text, 'altul'::text]))")
    expect(MIG).toContain("CHECK (moneda = ANY (ARRAY['RON'::text, 'EUR'::text]))")
  })
  it('amprenta din revenire e copiata identic din migrare', () => {
    const bloc = s => { const a = s.indexOf("  SELECT md5(concat_ws(E'\\n',"); const b = s.indexOf('INTO v_amprenta;', a); return a >= 0 && b > a ? s.slice(a, b) : null }
    expect(bloc(MIG)).toBeTruthy()
    expect(bloc(REV)).toBe(bloc(MIG))
  })
  it('revenirea scoate fiecare functie, tabela si trigger creat de migrare', () => {
    const functii = [...MIG.matchAll(/^CREATE FUNCTION public\.([a-z_]+)\(([^)]*)\)/gm)].map(x => x[1])
    expect(functii.length).toBe(22)
    for (const f of functii) expect(REV).toMatch(new RegExp(`DROP FUNCTION public\\.${f}\\(`))
    for (const t of [...MIG.matchAll(/^CREATE TABLE public\.([a-z_]+)/gm)].map(x => x[1])) expect(REV).toContain(`DROP TABLE public.${t};`)
    const triggere = [...MIG.matchAll(/^CREATE TRIGGER ([a-z_]+) .* ON (public\.[a-z_]+)/gm)].map(x => `DROP TRIGGER ${x[1]} ON ${x[2]};`)
    expect(triggere.length).toBe(4)
    for (const t of triggere) expect(REV).toContain(t)
  })
  it('functiile expuse lui authenticated nu contin constructii interzise de poarta 0e', () => {
    const corp = nume => { const a = MIG.indexOf(`CREATE FUNCTION public.${nume}(`); const b = MIG.indexOf('$fn$;', a); return MIG.slice(a, b).toLowerCase() }
    for (const f of ['fn_poate_scrie_polite', 'fn_polite_e_owner', 'fn_polite_scadente', 'fn_polite_alerte_proba', 'fn_polite_alerte_porneste', 'fn_polita_salveaza', 'fn_polita_propunere_respinge']) {
      expect(corp(f)).not.toMatch(/set_config|request\s*\.\s*jwt|\bexecute\b|session[_\s]+authorization|\brole\b|\bu&/)
    }
  })
})

describe('texte si date', () => {
  it('dataValida / sumaValida', () => {
    expect(dataValida('2024-02-29')).toBe('2024-02-29')
    expect(dataValida('2025-02-29')).toBeNull()
    expect(dataValida('29.02.2024')).toBeNull()
    expect(sumaValida('1500.25')).toBe(1500.25)
    expect(sumaValida(1500.255)).toBeNull()
    expect(sumaValida('1,500')).toBeNull()
    expect(sumaValida(-1)).toBeNull()
  })
  it('dataExpirarePropusa: data scrisa, altfel cea mai tarzie perioada', () => {
    expect(dataExpirarePropusa({ valabila_pana_la: '2027-01-01', garantie_pana_la: '2029-01-01' })).toBe('2027-01-01')
    expect(dataExpirarePropusa({ executie_pana_la: '2026-12-17', garantie_pana_la: '2028-12-17' })).toBe('2028-12-17')
    expect(dataExpirarePropusa({})).toBeNull()
  })
  it('situatiePolita pe praguri', () => {
    expect(situatiePolita('60', 45)).toBe('expiră în 45 zile')
    expect(situatiePolita('15', 1)).toBe('expiră mâine')
    expect(situatiePolita('0', 0)).toBe('expiră azi')
    expect(situatiePolita('0', -3)).toBe('a expirat acum 3 zile')
    expect(situatiePolita('r2', -15)).toBe('expirată de 15 zile, fără prelungire încărcată')
  })
  it('promptul trateaza documentul ca date', () => {
    expect(promptPolita()).toMatch(/DATE de transcris/)
  })
  it('formDinPropunere pune doar ce s-a citit si propune expirarea', () => {
    const f = formDinPropunere({ campuri: { tip: 'CAR', executie_pana_la: '2026-12-17', garantie_pana_la: '2028-12-17' }, dezacorduri: [{ camp: 'suma', motiv: 'format_invalid' }] }, 'polita')
    expect(f.valori).toEqual({ tip: 'CAR', data_expirare: '2028-12-17', executie_pana_la: '2026-12-17', garantie_pana_la: '2028-12-17' })
    expect(f.nesigure).toEqual(['valoare'])
    const g = formDinPropunere({ campuri: { suma: 10 }, dezacorduri: [{ camp: 'executie', motiv: 'perioada_inversata' }] }, 'polita', { valoare: 'valoare_lei' })
    expect(g.valori).toEqual({ valoare_lei: 10 })
    expect(g.propuse).toEqual(['valoare_lei'])
    expect(g.nesigure).toEqual(['executie_de_la', 'executie_pana_la'])
    const a = formDinPropunere({ campuri: { nr_act: 5, suma: 1500, valabila_pana_la: '2027-06-30' }, dezacorduri: [] }, 'act')
    expect(a.valori).toEqual({ nr_act: 5, valoare_noua_lei: 1500, data_expirare_noua: '2027-06-30' })
  })
  it('mesajEroare traduce codurile', () => {
    expect(mesajEroare({ message: 'propunere_deja_decisa' })).toMatch(/deja confirmat/)
    expect(mesajEroare({ message: 'data_invalida:data_emitere' })).toMatch(/data_emitere/)
  })
})

describe('Administrator -> Alerte: sursa Polite CAR / GBE', () => {
  it('prioritatea din pragul calculat in BD; fara data = date lipsa; peste 60 de zile = nimic', async () => {
    const { alertePolite, SURSE_ADMIN, SELECT_ADMIN } = await import('./adminAlerte.js')
    const r = alertePolite([
      { cheie: 'contract:1', tip: 'CAR', nr_polita: 'F1', prag: '15', zile: 10, data_expirare: '2026-11-20', proiect_id: 5, numar_contract: '30/2025' },
      { cheie: 'contract:2', tip: 'GBE', nr_polita: 'H1', prag: '0', zile: -2, data_expirare: '2026-11-08' },
      { cheie: 'registru:3', tip: 'GBE', nr_polita: null, prag: null, zile: null, data_expirare: null },
      { cheie: 'contract:4', tip: 'GPL', nr_polita: 'G1', prag: null, zile: 80, data_expirare: '2027-01-29' },
      { cheie: 'contract:5', tip: 'CAR', nr_polita: 'F5', prag: '60', zile: 5, data_expirare: '2026-11-15' },
    ])
    expect(r.map(a => [a.id, a.priority])).toEqual([['polite:contract:1', 'attention'], ['polite:contract:2', 'critical'], ['polite:registru:3', 'missing'], ['polite:contract:5', 'week']])
    expect(r[0].title).toBe('Poliță CAR F1 · expiră în 10 zile')
    expect(r[0].path).toBe('/executie?proiect=5')
    expect(r[1].title).toBe('Poliță GBE H1 · a expirat acum 2 zile')
    expect(SURSE_ADMIN.find(s => s.id === 'polite')).toMatchObject({ module: 'financiar' })
    expect(SELECT_ADMIN.v_polite_scadente.split(',')).toContain('prag')
    // coloanele cerute exista in iesirea fn_polite_scadente
    const iesire = MIG.match(/RETURNS TABLE\(cheie text, sursa text[^)]*\)/)[0]
    for (const col of SELECT_ADMIN.v_polite_scadente.split(',')) expect(iesire).toMatch(new RegExp(`\\b${col} `))
  })
})

describe('mailul zilnic', () => {
  const rand = (id, email, prag, zile, extra = {}) => ({ id, cheie: `k${id}`, prag, departamente: ['financiar'], destinatar_email: email, stare: 'rezervat',
    rand: { cheie: `contract:${id}`, tip: 'CAR', nr_polita: `P-${id}`, asigurator: 'ASIG <b>X</b>', numar_contract: '30/2025', proiect_nume: 'Lot 1', data_expirare: '2026-11-25', zile, ...extra } })
  it('grupeaza pe destinatar; randurile fara adresa ajung doar la Financiar', () => {
    const g = grupeazaPeDestinatar([
      rand(1, 'a@gazpet.ro', '15', 15), rand(2, 'a@gazpet.ro', '0', -2),
      { ...rand(3, 's@gazpet.ro', '15', 15), departamente: ['executie'] },
      { id: 4, stare: 'fara_adresa', destinatar_email: null, departamente: ['ofertare'], rand: { cheie: 'contract:1', tip: 'CAR', nr_polita: 'P-1' } },
    ])
    expect(g.map(x => [x.email, x.randuri.length, x.faraAdresa.length])).toEqual([['a@gazpet.ro', 2, 1], ['s@gazpet.ro', 1, 0]])
  })
  it('scapa HTML-ul, subiect pe un rand, fara referiri la AI, cu subsolul platformei', () => {
    const { subiect, html } = mailPolite({ randuri: [rand(1, 'a@gazpet.ro', '15', 15), rand(2, 'a@gazpet.ro', '0', -2, { proiect_nume: 'Lot 1' })] })
    expect(subiect).toBe('Polițe de asigurare: 1 expiră curând, 1 expirată — Lot 1')
    expect(subiect).not.toMatch(/[\r\n]/)
    expect(html).toContain('ASIG &lt;b&gt;X&lt;/b&gt;')
    expect(html).not.toContain('<b>X</b>')
    expect(html).toContain('Mesaj generat din platforma Gazpet ERP')
    expect(`${subiect} ${html}`).not.toMatch(/\bAI\b|Claude|Rocky|inteligen|automat generat|generat automat/i)
  })
  it('linkul din mail urmeaza departamentul destinatarului', () => {
    expect(linkDestinatar([{ departamente: ['executie'], rand: { proiect_id: 5 } }]).cale).toBe('/executie?proiect=5')
    expect(linkDestinatar([{ departamente: ['executie'], rand: { proiect_id: 5 } }, { departamente: ['executie'], rand: { proiect_id: 6 } }]).cale).toBe('/executie')
    expect(linkDestinatar([{ departamente: ['executie', 'financiar'], rand: {} }]).cale).toBe('/financiar?tab=garantii')
    expect(linkDestinatar([{ departamente: ['ofertare'], rand: {} }]).cale).toBe('/administrativ')
    expect(linkDestinatar([{ departamente: ['executie'], rand: { proiect_id: '5;x' } }]).cale).toBe('/executie')
  })
  it('cheia de idempotenta: determinista, independenta de ordine', async () => {
    const a = await cheieIdempotenta('2026-11-10', [3, 1, 2]), b = await cheieIdempotenta('2026-11-10', [1, 2, 3])
    expect(a).toBe(b)
    expect(a).toMatch(/^polite-[0-9a-f]{48}$/)
    expect(await cheieIdempotenta('2026-11-11', [1, 2, 3])).not.toBe(a)
  })
  it('starea dupa trimitere (L05)', () => {
    expect(stareDupaTrimitere({ ok: true, status: 200 })).toEqual({ stare: 'trimis', eroare: null })
    expect(stareDupaTrimitere({ ok: false, status: 503 }).stare).toBe('necunoscut')
    expect(stareDupaTrimitere({ eroareRetea: true }).stare).toBe('necunoscut')
    expect(stareDupaTrimitere({ ok: false, status: 422 })).toEqual({ stare: 'eroare', eroare: 'resend_4xx' })
    expect(stareDupaTrimitere({ ok: false, status: 409 }).stare).toBe('necunoscut')
  })
})

describe('esecDeterminist (r4, Jakarinos r3 P2-4)', () => {
  it('doar eroarea cu cod de la server e esec sigur; reteaua / timeout-ul sunt necunoscute', async () => {
    const { esecDeterminist } = await import('./polite.js')
    expect(esecDeterminist({ code: '23514', message: 'check' })).toBe(true)
    expect(esecDeterminist({ code: 'PGRST116' })).toBe(true)
    expect(esecDeterminist({ code: 'P0001' })).toBe(true)
    expect(esecDeterminist({ message: 'TypeError: Failed to fetch' })).toBe(false)
    expect(esecDeterminist({ code: '', message: 'timeout' })).toBe(false)
    expect(esecDeterminist(null)).toBe(false)
  })
})
