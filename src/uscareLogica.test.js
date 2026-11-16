// Logica raportului de uscare (src/uscareLogica.js): paritatea listelor cu migrarea 20261225a, calculele, ora României (inclusiv trecerea
// la ora de iarnă), formularul, îmbinarea la conflict, meteo, poziția. Valorile așteptate sunt scrise de mână (L25), nu calculate cu codul testat.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CAMPURI, OBLIGATORII, TRANZITII, CATEGORII, POZE_CERUTE, RPC_USCARE, stareDupa, actiuniPermise, ORA_AMBIGUA, alegereDinIso, momenteLocale,
  oraLocalaDinIso, isoDinOraLocala, ziBucuresti, durataOre, vitezaMedie, diferentaBurete, verificare24h, fmtMoment,
  lipsaDinRand, pozeLipsa, incarcariDeschise, cantaririPentru, formularNou, formularDinRand, payloadDinFormular, areModificari, imbinare, aleg,
  propunereMeteo, invalidareMeteo, pozitieDinGps, pozitieDinTraseu, numeFisierRaport, prefixRegistru,
} from './uscareLogica.js'

const SQL = readFileSync(fileURLToPath(new URL('../supabase/migrations/20261225a_executie_uscare.sql', import.meta.url)), 'utf8').replace(/\r/g, '')
const bloc = nume => SQL.slice(SQL.indexOf(`-- ${nume}-START`), SQL.indexOf(`-- ${nume}-END`))

describe('paritatea cu migrarea 20261225a (L19)', () => {
  it('CAMPURI = cheile din blocul CAMPURI (aceeași ordine)', () => {
    expect([...bloc('CAMPURI').matchAll(/\('([a-z_]+)'\)/g)].map(m => m[1])).toEqual(CAMPURI)
    expect(CAMPURI).toHaveLength(40)
  })
  it('lista de tipuri a RPC-ului acoperă exact CAMPURI', () => {
    const i = SQL.indexOf('FOR c IN SELECT * FROM (VALUES'), j = SQL.indexOf(') s(k, tip, mn, mx, z) LOOP', i)
    expect([...SQL.slice(i, j).matchAll(/\('([a-z_]+)', '[a-z_]+'/g)].map(m => m[1])).toEqual(CAMPURI)
  })
  it('OBLIGATORII = blocul din fn_executie_uscare_lipsa; punctul de rouă NU e acolo', () => {
    expect([...bloc('OBLIGATORII').matchAll(/\(\d+, '([a-z_]+)'/g)].map(m => m[1])).toEqual(OBLIGATORII)
    expect(OBLIGATORII).not.toContain('punct_roua_c')
    expect(OBLIGATORII).not.toContain('punct_roua_loc')
  })
  it('POZE_CERUTE = blocul din fn_executie_uscare_poze_lipsa', () => {
    expect([...bloc('POZE-CERUTE').matchAll(/\(\d+, '([a-z_]+)'/g)].map(m => m[1])).toEqual(POZE_CERUTE)
  })
  it('TRANZITII = blocul din fn_executie_uscare_tranzitie', () => {
    expect([...bloc('TRANZITII').matchAll(/\('([a-z]+)', '([a-z]+)', '([a-z]+)'\)/g)].map(m => [m[1], m[2], m[3]])).toEqual(TRANZITII)
  })
  it('CATEGORII = CHECK-ul pozelor = CHECK-ul rezervărilor = lista RPC-ului', () => {
    const lista = s => [...s.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    expect(lista(bloc('CATEGORII').split('IN (')[1])).toEqual(CATEGORII)
    expect(lista(bloc('CATEGORII-INCARCARI').split('IN (')[1])).toEqual(CATEGORII)
    const rpc = SQL.slice(SQL.indexOf('IF p_categorie NOT IN ('), SQL.indexOf(') THEN', SQL.indexOf('IF p_categorie NOT IN (')))
    expect(lista(rpc)).toEqual(CATEGORII)
    expect(CATEGORII).toContain('piston_final')
  })
  it('RPC-urile din registrul local există în migrare cu EXECUTE pentru authenticated', () => {
    for (const f of RPC_USCARE) expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO authenticated;`))
    expect(prefixRegistru('u', 7)).toBe('gazpet.uscare.incert.v2:u:7:')
  })
})

describe('stările', () => {
  it('tranzițiile permise', () => {
    expect(stareDupa('deschisa', 'inchide')).toBe('inchisa')
    expect(stareDupa('inchisa', 'redeschide')).toBe('deschisa')
    expect(stareDupa('deschisa', 'anuleaza')).toBe('anulata')
    expect(stareDupa('inchisa', 'anuleaza')).toBe(null)
    expect(stareDupa('anulata', 'redeschide')).toBe(null)
    expect(actiuniPermise('deschisa')).toEqual(['inchide', 'anuleaza'])
    expect(actiuniPermise('anulata')).toEqual([])
  })
})

describe('ora României (L17)', () => {
  it('iarna UTC+2, vara UTC+3', () => {
    expect(oraLocalaDinIso('2026-12-08T06:30:00Z')).toBe('2026-12-08T08:30')
    expect(oraLocalaDinIso('2026-07-01T05:30:00.000Z')).toBe('2026-07-01T08:30')
    expect(isoDinOraLocala('2026-12-08T08:30')).toBe('2026-12-08T06:30:00.000Z')
    expect(isoDinOraLocala('2026-07-01T08:30')).toBe('2026-07-01T05:30:00.000Z')
  })
  it('peste miezul nopții și trecerea la ora de vară (29.03.2026: 03:30 nu există)', () => {
    expect(isoDinOraLocala('2026-12-08T00:30')).toBe('2026-12-07T22:30:00.000Z')
    expect(isoDinOraLocala('2026-03-29T03:30')).toBeNaN()
    expect(isoDinOraLocala('2026-03-29T04:30')).toBe('2026-03-29T01:30:00.000Z')
    expect(isoDinOraLocala('2026-03-29T02:30')).toBe('2026-03-29T00:30:00.000Z')
  })
  it('trecerea la ora de iarnă (25.10.2026): 03:30 apare de două ori — alegere explicită', () => {
    expect(oraLocalaDinIso('2026-10-25T00:30:00Z')).toBe('2026-10-25T03:30')
    expect(oraLocalaDinIso('2026-10-25T01:30:00Z')).toBe('2026-10-25T03:30')
    expect(momenteLocale('2026-10-25T03:30')).toHaveLength(2)
    expect(isoDinOraLocala('2026-10-25T03:30')).toBe(ORA_AMBIGUA)
    expect(isoDinOraLocala('2026-10-25T03:30', 'vara')).toBe('2026-10-25T00:30:00.000Z')
    expect(isoDinOraLocala('2026-10-25T03:30', 'iarna')).toBe('2026-10-25T01:30:00.000Z')
    expect(isoDinOraLocala('2026-10-25T04:30')).toBe('2026-10-25T02:30:00.000Z')
    expect(alegereDinIso('2026-10-25T00:30:00Z')).toBe('vara')
    expect(alegereDinIso('2026-10-25T01:30:00Z')).toBe('iarna')
    expect(alegereDinIso('2026-12-08T06:30:00Z')).toBe('')
    expect(fmtMoment('2026-10-25T01:30:00Z')).toBe('25.10.2026 03:30 (ora de iarnă)')
  })
  it('formularul păstrează instantul ORIGINAL: durata de 1 h peste schimbarea orei rămâne 1 h', () => {
    const r = { ...RAND, ora_inceput: '2026-10-25T00:30:00+00:00', ora_final: '2026-10-25T01:30:00+00:00', data_operatie: '2026-10-25' }
    const f = formularDinRand(r)
    expect([f.ora_inceput, f.ora_final]).toEqual(['2026-10-25T03:30', '2026-10-25T03:30'])
    const { date, erori } = payloadDinFormular(f)
    expect(erori).toEqual([])
    expect([date.ora_inceput, date.ora_final]).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'])
    expect(durataOre(date.ora_inceput, date.ora_final)).toBe(1)
    expect(areModificari(f, r)).toBe(false)
  })
  it('o oră ambiguă SCRISĂ de om fără alegere = eroare; cu alegere = instantul ales', () => {
    const f = { ...formularDinRand(RAND), ora_inceput: '2026-10-25T03:30', ora_final: '2026-10-25T05:00' }
    expect(payloadDinFormular(f).erori).toEqual(['ora de început: ora 03:30 apare de două ori (trecerea la ora de iarnă): alege prima sau a doua'])
    expect(payloadDinFormular({ ...f, dst: { ora_inceput: 'iarna' } }).date.ora_inceput).toBe('2026-10-25T01:30:00.000Z')
  })
  it('gol / greșit', () => {
    expect(isoDinOraLocala('')).toBe(null)
    expect(isoDinOraLocala('08.12.2026 08:30')).toBeNaN()
    expect(oraLocalaDinIso('nu')).toBe('')
    expect(ziBucuresti(Date.parse('2026-12-07T22:30:00Z'))).toBe('2026-12-08')
  })
})

describe('calculele', () => {
  it('durata, viteza, diferența de greutate (doar în aplicație)', () => {
    expect(durataOre('2026-12-08T06:30:00Z', '2026-12-08T09:15:00Z')).toBe(2.75)
    expect(durataOre('2026-12-08T06:30:00Z', '2026-12-08T06:30:00Z')).toBe(null)
    expect(vitezaMedie(700, 35)).toBe(0.33)       // 700 / 2100
    expect(vitezaMedie(1200, 10)).toBe(2)         // 1200 / 600
    expect(vitezaMedie(700, 0)).toBe(null)
    expect(diferentaBurete({ intrare_kg: 2.1, iesire_kg: 2.45 })).toBe(0.35)
    expect(diferentaBurete({ intrare_kg: 2.1, iesire_kg: null })).toBe(null)
  })
  it('notificarea cu 24 h înainte, pe momentul exact', () => {
    expect(verificare24h('2026-12-07T09:05:00Z', null, '2026-12-08T06:30:00Z')).toEqual({ stare: 'sub_24h', ore: 21.4, inceput: 'planificat' })
    expect(verificare24h('2026-12-07T06:30:00Z', null, '2026-12-08T06:30:00Z')).toEqual({ stare: 'ok', ore: 24, inceput: 'planificat' })
    expect(verificare24h('2026-12-07T06:30:00Z', '2026-12-08T05:00:00Z', '2026-12-08T06:30:00Z')).toEqual({ stare: 'sub_24h', ore: 22.5, inceput: 'real' })
    expect(verificare24h(null, null, '2026-12-08T06:30:00Z')).toEqual({ stare: 'necunoscut', ore: null, inceput: 'planificat' })
  })
})

const RAND = {
  id: 5, proiect_id: 1, proba_id: 10, tronson: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900, lungime_m: 700, inceput_planificat: '2026-12-08T06:30:00+00:00',
  notificare_la: '2026-12-07T09:05:00+00:00', notificare_ref: null, data_operatie: '2026-12-08', ora_inceput: '2026-12-08T06:40:00+00:00',
  ora_final: '2026-12-08T09:10:00+00:00', poz_lat: 44.941234, poz_lng: 22.500001, poz_sursa: 'gps', poz_precizie_m: 4.5, poz_la: '2026-12-08T06:35:00+00:00',
  poz_km_m: null, poz_traseu_versiune: null, temperatura_c: 7.5, temperatura_sursa: 'meteo',
  meteo: { tip: 'santier', furnizor: 'xweather', site_id: 100, santier: 'S', lat: 44.94, lng: 22.5, ora_ceruta: '2026-12-08T06:40:00Z', ora_observatiei: '2026-12-08T06:00:00+02:00', preluat_la: '2026-12-08T06:10:00Z', temperatura_c: 7.5, vreme: 'Senin' },
  vreme: 'Senin', constructor: 'Constructor SRL', utilaje: [{ denumire: 'Compresor', buc: 1 }], pig_metalic_buc: 1, piston_pu_buc: 0, bureti_buc: 3,
  cantariri: [{ nr: 1, intrare_kg: 2.1, iesire_kg: 2.45, motiv: null }, { nr: 2, intrare_kg: 2.05, iesire_kg: 2.2, motiv: null }, { nr: 3, intrare_kg: null, iesire_kg: null, motiv: 'pierdut' }],
  punct_roua_c: null, punct_roua_loc: null, presiune_bar: 1.5, timp_deplasare_min: 35, piston_final_rezultat: 'uscat', poze_justificare: null,
  observatii: null, concluzie: 'conform',
  semn_constructor_nume: null, semn_constructor_functie: null, semn_beneficiar_nume: null, semn_beneficiar_functie: null, stare: 'deschisa', revizie: 0, versiune: 3,
}
const P = (...l) => l.map((x, i) => { const [categorie, b] = x.split(':'); return { id: i + 1, categorie, burete_nr: b ? Number(b) : null, cale: `c${i}` } })
const TOATE = P('manometru', 'temperatura', 'pistoane', 'cantar_intrare:1', 'cantar_iesire:1', 'cantar_intrare:2', 'cantar_iesire:2', 'piston_final')

describe('ce lipsește pentru închidere: criteriul ultimului piston, bureții declarați, pozele', () => {
  it('rândul complet, fără punct de rouă: nimic', () => { expect(lipsaDinRand(RAND, TOATE, 0)).toEqual([]) })
  it('CONFORM cere ultimul piston uscat ȘI fotografia lui', () => {
    expect(lipsaDinRand({ ...RAND, piston_final_rezultat: 'umed' }, TOATE)).toEqual(['dovada_conform'])
    expect(lipsaDinRand(RAND, TOATE.filter(p => p.categorie !== 'piston_final'))).toEqual(['dovada_conform'])
    expect(lipsaDinRand({ ...RAND, piston_final_rezultat: null }, TOATE)).toEqual(['piston_final_rezultat', 'dovada_conform'])
  })
  it('NECONFORM: rezultatul negativ se consemnează, fără fotografia pistonului', () => {
    expect(lipsaDinRand({ ...RAND, concluzie: 'neconform', piston_final_rezultat: 'umed' }, TOATE.filter(p => p.categorie !== 'piston_final'))).toEqual([])
  })
  it('câte o cântărire pe FIECARE burete declarat; „nu se aplică” cu motiv e o valoare', () => {
    expect(lipsaDinRand({ ...RAND, cantariri: RAND.cantariri.slice(0, 2) }, TOATE)).toEqual(['cantariri'])
    expect(lipsaDinRand({ ...RAND, cantariri: [{ nr: 1, intrare_kg: 2.1, iesire_kg: null, motiv: null }, ...RAND.cantariri.slice(1)] }, TOATE)).toEqual(['cantariri'])
    expect(lipsaDinRand({ ...RAND, bureti_buc: 0, cantariri: [] }, P('manometru', 'temperatura', 'pistoane', 'piston_final'))).toEqual([])
    expect(lipsaDinRand({ ...RAND, bureti_buc: null }, TOATE)).toEqual(['pistoane', 'cantariri'])
  })
  it('pozele cerute: pe fiecare burete cântărit; lipsa cere justificare consemnată', () => {
    expect(pozeLipsa(RAND, P('piston_final', 'cantar_intrare:2'))).toEqual(['manometru', 'temperatura', 'pistoane', 'cantar_intrare:1', 'cantar_iesire:1', 'cantar_iesire:2'])
    expect(pozeLipsa(RAND, TOATE)).toEqual([])
    expect(lipsaDinRand(RAND, P('piston_final'))).toEqual(['poze_justificare'])
    expect(lipsaDinRand({ ...RAND, poze_justificare: 'ceață' }, P('piston_final'))).toEqual([])
  })
  it('încărcările nelămurite blochează; rezervările înregistrate sau renunțate nu', () => {
    expect(lipsaDinRand(RAND, TOATE, 1)).toEqual(['incarcari_nelamurite'])
    const inc = [{ cale: 'c0' }, { cale: 'x', renuntat_la: '2026-12-08T07:00:00Z' }, { cale: 'y' }]
    expect(incarcariDeschise(inc, TOATE).map(i => i.cale)).toEqual(['y'])
  })
  it('rândurile de cântărire urmăresc numărul de bureți (păstrează ce era scris)', () => {
    const e = [{ nr: 1, intrare_kg: '2', iesire_kg: '', motiv: '' }]
    expect(cantaririPentru(3, e)).toEqual([e[0], { nr: 2, intrare_kg: '', iesire_kg: '', motiv: '' }, { nr: 3, intrare_kg: '', iesire_kg: '', motiv: '' }])
    expect(cantaririPentru(0, e)).toEqual([])
  })
})

describe('formularul', () => {
  it('nou, din tronsonul de probă, cu constructorul propus', () => {
    const f = formularNou({ proba: { id: 10, cod: 'P2', denumire: 'Tr. 2', km_de_la_m: 3200, km_pana_la_m: 3900 }, constructor: 'C' })
    expect([f.proba_id, f.tronson, f.km_de_la, f.km_pana_la, f.lungime_m, f.constructor]).toEqual(['10', 'P2 — Tr. 2', '3+200', '3+900', '700', 'C'])
    expect(f.cantariri).toEqual([])
  })
  it('rând -> formular -> payload: aceleași valori, exact cheile contractului; instantaneul meteo neschimbat', () => {
    const { date, erori } = payloadDinFormular(formularDinRand(RAND))
    expect(erori).toEqual([])
    expect(Object.keys(date)).toEqual(CAMPURI)
    expect(date).toMatchObject({
      ora_inceput: '2026-12-08T06:40:00.000Z', poz_lat: 44.941234, poz_lng: 22.500001, poz_sursa: 'gps', poz_precizie_m: 4.5, poz_la: '2026-12-08T06:35:00.000Z',
      poz_km_m: null, temperatura_c: 7.5, temperatura_sursa: 'meteo', meteo: RAND.meteo, bureti_buc: 3, piston_final_rezultat: 'uscat',
      cantariri: [{ nr: 1, intrare_kg: 2.1, iesire_kg: 2.45, motiv: null }, { nr: 2, intrare_kg: 2.05, iesire_kg: 2.2, motiv: null }, { nr: 3, intrare_kg: null, iesire_kg: null, motiv: 'pierdut' }],
    })
    expect(areModificari(formularDinRand(RAND), RAND)).toBe(false)
    expect(areModificari({ ...formularDinRand(RAND), presiune_bar: '1,6' }, RAND)).toBe(true)
  })
  it('cererea meteo trimite doar șantierul; serverul face instantaneul', () => {
    const f = { ...formularDinRand(RAND), meteo_cerere: { site_id: 100, site: 'S', ora_observatiei: 'x' } }
    expect(payloadDinFormular(f).date.meteo).toEqual({ cerere: 'santier', site_id: 100 })
  })
  it('numerele RO / EN și refuzul zecimalelor în plus (nu rotunjire)', () => {
    const { date, erori } = payloadDinFormular({ ...formularDinRand(RAND), temperatura_c: '7,45', presiune_bar: '1.5', lungime_m: '1.250,5' })
    expect([date.presiune_bar, date.lungime_m, date.temperatura_c]).toEqual([1.5, 1250.5, null])
    expect(erori).toEqual(['temperatura (°C): număr între -50 și 60, cel mult 1 zecimală'])
  })
  it('cântăriri: „nu se aplică” fără kg; mai multe rânduri decât bureți = eroare', () => {
    const base = formularDinRand(RAND)
    expect(payloadDinFormular({ ...base, cantariri: [{ nr: 1, intrare_kg: '2', iesire_kg: '', motiv: 'x' }] }).erori).toContain('buretele 1: „nu se aplică” nu are cântăriri (șterge kg sau motivul)')
    expect(payloadDinFormular({ ...base, bureti_buc: '1' }).erori).toContain('cântăririle: sunt mai multe rânduri decât bureții declarați')
    expect(payloadDinFormular({ ...base, bureti_buc: '21' }).erori).toContain('bureții (buc): număr între 0 și 20, întreg')
  })
  it('poziția: toată sau deloc, cu momentul și sursa', () => {
    const base = formularDinRand(RAND)
    expect(payloadDinFormular({ ...base, poz_lng: '' }).erori).toContain('poziția: completează și latitudinea, și longitudinea')
    const man = payloadDinFormular({ ...base, poz_sursa: 'manual', poz_precizie_m: '', poz_lat: '44,9', poz_lng: '22,5' }).date
    expect([man.poz_sursa, man.poz_precizie_m, man.poz_lat]).toEqual(['manual', null, 44.9])
    const gol = payloadDinFormular({ ...base, poz_lat: '', poz_lng: '' }).date
    expect([gol.poz_lat, gol.poz_sursa, gol.poz_la, gol.poz_precizie_m]).toEqual([null, null, null, null])
  })
  it('numele fișierului', () => {
    expect(numeFisierRaport({ tronson: 'Tr. 2 – Lot A', data_operatie: '2026-12-08', revizie: 0 })).toBe('Raport_uscare_Tr_2_Lot_A_2026-12-08.pdf')
    expect(numeFisierRaport({ tronson: 'Țară', data_operatie: null, revizie: 2 })).toBe('Raport_uscare_Tara_fara_data_rev2.pdf')
  })
})

describe('conflictul de versiune: îmbinare pe câmpuri, alegere explicită', () => {
  it('A schimbă presiunea, B schimbă observațiile: fără conflict, ambele rămân (B nu șterge munca lui A)', () => {
    const server = { ...RAND, presiune_bar: 2, versiune: 4 }
    const formB = { ...formularDinRand(RAND), observatii: 'scris de B' }
    const { form, conflicte } = imbinare(RAND, formB, server)
    expect(conflicte).toEqual([])
    expect([form.presiune_bar, form.observatii]).toEqual(['2', 'scris de B'])
    expect(payloadDinFormular(form).date.presiune_bar).toBe(2)
  })
  it('ambii schimbă presiunea diferit: conflict; alegerea omului decide', () => {
    const server = { ...RAND, presiune_bar: 2, versiune: 4 }
    const formB = { ...formularDinRand(RAND), presiune_bar: '1,8' }
    const { form, conflicte } = imbinare(RAND, formB, server)
    expect(conflicte).toEqual([{ camp: 'presiune_bar', al_meu: '1,8', al_colegului: '2' }])
    expect(aleg(form, conflicte[0], 'al_colegului', server).presiune_bar).toBe('2')
    expect(aleg(form, conflicte[0], 'al_meu', server).presiune_bar).toBe('1,8')
  })
  it('aceeași valoare scrisă de amândoi nu e conflict', () => {
    const server = { ...RAND, concluzie: 'neconform', versiune: 4 }
    expect(imbinare(RAND, { ...formularDinRand(RAND), concluzie: 'neconform' }, server).conflicte).toEqual([])
  })
})

describe('meteo: ora observației furnizorului, pentru ora începerii', () => {
  const rand = { curent: { temp: 7.46, vreme: 'Senin', la: '2026-12-08T08:00:00+02:00' }, actualizat_la: '2026-12-08T06:20:00Z' }
  it('propunerea păstrează ora observației (nu ora preluării)', () => {
    expect(propunereMeteo(rand, '2026-12-08T07:00:00Z')).toEqual({ ok: true, temperatura_c: '7,5', vreme: 'Senin', ora_observatiei: '2026-12-08T08:00:00+02:00', preluat_la: '2026-12-08T06:20:00Z' })
  })
  it('nicio propunere fără ora începerii sau la peste 3 h de observație (operațiune trecută)', () => {
    expect(propunereMeteo(rand, null).ok).toBe(false)
    expect(propunereMeteo(rand, '2026-12-08T02:59:00Z').ok).toBe(false)      // observația 06:00Z, începutul cu 3 h 1 min înainte
    expect(propunereMeteo(rand, '2026-12-08T03:00:00Z').ok).toBe(true)
    expect(propunereMeteo({ curent: { temp: 5 }, actualizat_la: 'x' }, '2026-12-08T06:00:00Z').ok).toBe(false)   // fără ora observației
  })
  it('schimbarea orei începerii invalidează temperatura „din meteo”', () => {
    const f = { ...formularDinRand(RAND), temperatura_sursa: 'meteo', ora_inceput: '2026-12-08T08:40' }
    expect(invalidareMeteo(f, { ora_inceput: '2026-12-08T09:40' })).toEqual({ temperatura_c: '', temperatura_sursa: '', meteo_cerere: null })
    expect(invalidareMeteo(f, { ora_inceput: '2026-12-08T08:40' })).toEqual({})
    expect(invalidareMeteo({ ...f, temperatura_sursa: 'manual' }, { ora_inceput: '2026-12-08T09:40' })).toEqual({})
  })
})

describe('poziția operațiunii', () => {
  it('GPS: o citire, cu precizia și momentul', () => {
    expect(pozitieDinGps({ coords: { latitude: 44.94123449, longitude: 22.5000004, accuracy: 4.53 }, timestamp: Date.parse('2026-12-08T06:35:00Z') })).toEqual({
      poz_lat: '44,941234', poz_lng: '22,5', poz_sursa: 'gps', poz_precizie_m: '4,6', poz_la: '2026-12-08T06:35:00.000Z', poz_km_m: '', poz_traseu_versiune: '',
    })
    expect(pozitieDinGps({ coords: { latitude: 1 } })).toBe(null)
  })
  it('din traseu: km-ul calibrat pe borne, inversat pe ax (nu distanța geometrică)', () => {
    const ax = [[22, 45], [22, 45.01]]
    const v = 'a'.repeat(64)
    // bornele: km 1+000 la începutul axului, km 2+000 la capăt => km 1+500 e la jumătatea axului
    const p = pozitieDinTraseu({ ax, ancore: [{ dist: 0, km_m: 1000 }, { dist: 1111.95, km_m: 2000 }], versiune: v }, 1500, { acum: Date.parse('2026-12-08T06:00:00Z') })
    expect(p).toEqual({ poz_lat: '45,005', poz_lng: '22', poz_sursa: 'traseu', poz_precizie_m: '', poz_km_m: '1500', poz_traseu_versiune: v, poz_la: '2026-12-08T06:00:00.000Z', stare: 'interpolat' })
    expect(pozitieDinTraseu({ ax, ancore: [{ dist: 0, km_m: 1000 }, { dist: 1111.95, km_m: 2000 }], versiune: v }, 9000)).toBe(null)
    expect(pozitieDinTraseu({ ax, ancore: [{ dist: 0, km_m: 1000 }], versiune: v }, 1500)).toBe(null)
    expect(pozitieDinTraseu({ ax, ancore: [{ dist: 0, km_m: 1000 }, { dist: 1111.95, km_m: 2000 }], versiune: 'x' }, 1500)).toBe(null)
  })
})
