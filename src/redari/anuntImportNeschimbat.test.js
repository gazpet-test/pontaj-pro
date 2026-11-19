// Redări — anunțul de afișare: valorile NESCHIMBATE de la importul TGZ se publică așa cum sunt (decizia Răzvan 19.11.2026, varianta A).
// Regula (identificatoriPublici.js): la tarla / nr_cadastral / poz_hg, o valoare IDENTICĂ cu cea de la INSERT-ul de import (rândul din
// red_jurnal) nu mai trece prin validatorul de formă; orice altă valoare trece prin validatorul strict, neschimbat.
// Valorile sunt SINTETICE, pe FORMELE identificatorilor reali refuzați pe LOT1 (fond forestier, UA, coduri de lucrări, topo cu fracție,
// liste); niciun identificator real, nicio persoană reală. Așteptările (forma publicată, motivele, cheile) sunt scrise în tabel, nu
// calculate din codul testat.
import { describe, it, expect, vi, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import JSZip from 'jszip'
// valoriImport.js → ui/comune.jsx importă clientul Supabase; testul folosește un client fals
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { genereazaAnuntAfisare, randuriAnuntAfisare, COL_PARCELA_ANUNT, CAMPURI_PARCELA_ANUNT } from './docx.js'
import * as idp from './identificatoriPublici.js'
import { cheieSursa } from './importTgz.js'

const { canonizeazaIdentificator, MOTIV, LUNGIME_MAX_IDENTIFICATOR } = idp
const UAT3 = 'FIC'
const SABLON = resolve(process.cwd(), 'public/redari/sabloane/anunt_afisare.docx')
const PROIECT = {
  cod: 'TEST-FICTIV', denumire: 'Conductă FICTIVĂ de test, Lot 0', contract_nr: 'TEST-30', contract_data: '2025-01-22',
  imputernicire_nr: 'IMP-TEST', imputernicire_data: '2026-11-01', contact_nume: 'Contact FICTIV', contact_telefon: '0700 000 000',
  contact_email: 'test@example.invalid', reprezentant_tgz_nume: 'Delegat FICTIV', reprezentant_tgz_functie: 'ofițer de legătură',
  reprezentant_tgz_telefon: '0700 000 001', reprezentant_gazpet_nume: 'Semnatar FICTIV', reprezentant_gazpet_functie: 'coordonator',
  text_gdpr: 'Text GDPR fictiv.', informare_publicata: true,
}
const UAT = { id: 'uat-fictiv', nume: 'Comuna FICTIVĂ', uat3: UAT3, judet: 'Județ FICTIV', versiune: 1,
  sesiune_zi1: '2026-12-10', program_zi1: '09:00 – 16:00', sate_zi1: 'Satul A, Satul B' }

// id-uri sintetice (forma uuid, minuscule ca în PostgREST)
const uid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
// cheia de import scrisă INDEPENDENT de importTgz.cheieSursa: majuscule, fără diacritice, unite cu „|”. E exactă doar pe valori fără
// punctuație repetată și fără spațiu înaintea punctuației — garda de mai jos verifică asta pe tabel, iar paritatea cu cheieSursa (producătorul
// cheii, la import) e un test separat.
const cheieTest = (u, p, c, t) => [u, p, c, t].map(x => String(x ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()).join('|')
const BAZA = { tarla: 'T1', nr_cadastral: '101', poz_hg: '7' }
// rândul INSERT din red_jurnal, așa cum îl scrie trg_red_jurnal la importul parcelei (date_noi = to_jsonb(NEW))
const insertImport = (i, valori = {}, extra = {}) => {
  const v = { ...BAZA, ...valori }
  return { id: 1000 + i, tabela: 'red_parcele', actiune: 'insert', inregistrare_id: uid(i),
    date_noi: { id: uid(i), id_parcela: `T1-FIC-${String(i).padStart(4, '0')}`, ...v, cheie_sursa: cheieTest(UAT3, v.poz_hg, v.nr_cadastral, v.tarla), sat: 'Satul A', tronson: 1 }, ...extra }
}
const parcela = (i, valori = {}) => ({ id: uid(i), id_parcela: `T1-FIC-${String(i).padStart(4, '0')}`, sat: 'Satul A', tronson: 1, sters_la: null, ...BAZA, ...valori })

// FORMELE reale de pe LOT1 (valori sintetice): [câmp, valoare la import = în BD, forma publicată așteptată, motivul strict de azi]
const FORME = [
  ['tarla', '97#UP II Valea Fictivă', '97#UP II VALEA FICTIVĂ', MOTIV.FORMA],          // fond forestier în tarla
  ['tarla', '#UP IV Valea Fictivă', '#UP IV VALEA FICTIVĂ', MOTIV.FORMA],
  ['tarla', 'HCN#', 'HCN#', MOTIV.FORMA],                                               // cod de lucrare în tarla
  ['tarla', '67/13 67/3#', '67/13 67/3#', MOTIV.FORMA],                                 // două topo-uri în tarla
  ['nr_cadastral', '#HCN 901#', '#HCN 901#', MOTIV.FORMA],                              // coduri de lucrări
  ['nr_cadastral', '#HR_4001#', '#HR_4001#', MOTIV.FORMA],
  ['nr_cadastral', '#HPR_4002#', '#HPR_4002#', MOTIV.FORMA],
  ['nr_cadastral', '#PD_1901#', '#PD_1901#', MOTIV.FORMA],
  ['nr_cadastral', '#PDT_1902#', '#PDT_1902#', MOTIV.FORMA],
  ['nr_cadastral', '#1/2#', '#1/2#', MOTIV.COTA],                                       // topo cu fracție
  ['nr_cadastral', '#1/3#', '#1/3#', MOTIV.COTA],
  ['nr_cadastral', '#1/1#', '#1/1#', MOTIV.COTA],
  ['nr_cadastral', '#2(1/2)#', '#2(1/2)#', MOTIV.COTA],
  ['nr_cadastral', '50111#2/4#', '50111#2/4#', MOTIV.COTA],
  ['nr_cadastral', '#51222#14/23', '#51222#14/23', MOTIV.COTA],
  ['nr_cadastral', '51333#1077/1,1077/1/1', '51333#1077/1,1077/1/1', MOTIV.TELEFON_CNP], // listă (ferestre lipite de 13 cifre)
  ['nr_cadastral', '51004#43(UP II, UA 146), 43/1(', '51004#43(UP II, UA 146), 43/1(', MOTIV.FORMA],
  ['poz_hg', '12/1', '12/1', MOTIV.FORMA],                                              // poziție HG cu „/”
]
// forme reale pe care validatorul strict le acceptă DEJA (UA în nr. cadastral, topo „226/2#”): neschimbate, pe ambele căi
const FORME_ACCEPTATE_DEJA = [
  ['nr_cadastral', '#4321#UA 81G', '#4321#UA 81G'], ['nr_cadastral', '##UA 63VV', '##UA 63VV'],
  ['nr_cadastral', '50123#3456#UA 64C', '50123#3456#UA 64C'], ['tarla', '226/2#', '226/2#'],
]
// date personale scrise MANUAL (fictive): [câmp, valoare, motivul strict]
const MANUALE = [
  ['nr_cadastral', '0711111111', MOTIV.TELEFON_CNP], ['nr_cadastral', '1800101000000', MOTIV.TELEFON_CNP],
  ['tarla', 'POPESCU ION', MOTIV.FORMA], ['poz_hg', '1/2', MOTIV.COTA], ['tarla', '0711#111111#', MOTIV.TELEFON_CNP],
]
const valoriImport = randuri => idp.valoriImportDinJurnal(randuri, UAT3)
const laImport = (camp, valoare) => ({ ...BAZA, [camp]: valoare })

describe('tabelul formelor: identice cu importul → publicate; scrise manual (fără import) → refuzate ca azi', () => {
  it('garda tabelului: valorile n-au punctuație repetată / spațiu înaintea punctuației (cheieTest e exactă), iar cheieTest = cheieSursa (producătorul cheii la import)', () => {
    for (const [camp, v] of [...FORME, ...FORME_ACCEPTATE_DEJA]) {
      expect(v).not.toMatch(/([.,;:!?'"\-/()])\1|\s[.,;:!?]|\s\s|\|/)
      const x = laImport(camp, v)
      expect(cheieTest(UAT3, x.poz_hg, x.nr_cadastral, x.tarla)).toBe(cheieSursa(UAT3, x.poz_hg, x.nr_cadastral, x.tarla))
    }
  })
  it.each(FORME)('%s „%s”: strict = refuz; identic cu importul = publicat ca „%s”', (camp, v, publicat, motivStrict) => {
    expect(canonizeazaIdentificator(camp, v)).toEqual({ ok: false, motiv: motivStrict })
    expect(canonizeazaIdentificator(camp, v, { import: laImport(camp, v) })).toEqual({ ok: true, valoare: publicat, din_import: true })
  })
  it.each(FORME_ACCEPTATE_DEJA)('%s „%s”: acceptat strict și identic cu importul (aceeași formă publicată)', (camp, v, publicat) => {
    expect(canonizeazaIdentificator(camp, v)).toEqual({ ok: true, valoare: publicat })
    expect(canonizeazaIdentificator(camp, v, { import: laImport(camp, v) })).toEqual({ ok: true, valoare: publicat, din_import: true })
  })
  it('aceeași valoare pe o parcelă FĂRĂ import dovedit (fără rând de jurnal / INSERT fără cheie / cheie care nu corespunde) → refuz strict', () => {
    FORME.forEach(([camp, v, , motiv], k) => {
      const i = k + 1
      const p = parcela(i, { [camp]: v })
      const fara = [
        new Map(),                                                                                    // niciun INSERT în jurnal
        valoriImport([insertImport(i, { [camp]: v }, { date_noi: { ...insertImport(i, { [camp]: v }).date_noi, cheie_sursa: null } })]),   // INSERT fără cheie
        valoriImport([insertImport(i, { [camp]: v }, { date_noi: { ...insertImport(i, { [camp]: v }).date_noi, cheie_sursa: 'FIC|7|101|T1' } })]), // cheie a altor valori
      ]
      for (const m of fara) expect(randuriAnuntAfisare([p], UAT, m).probleme).toEqual([{ id_parcela: p.id_parcela, camp, motiv }])
    })
  })
})

describe('modificări față de import → validarea strictă (neschimbată)', () => {
  it('telefon / CNP / nume / cotă scrise manual pe o parcelă importată (importul avea altă valoare) → refuz, cu motivul strict', () => {
    MANUALE.forEach(([camp, v, motiv], k) => {
      const i = 100 + k
      const m = valoriImport([insertImport(i)])
      expect(m.has(uid(i))).toBe(true)
      expect(randuriAnuntAfisare([parcela(i, { [camp]: v })], UAT, m).probleme).toEqual([{ id_parcela: parcela(i).id_parcela, camp, motiv }])
    })
  })
  it('valoarea de import + o modificare minimă (o cifră, o literă mică / mare, un spațiu, diacritica) → strict (refuz pe formele reale)', () => {
    const cazuri = [
      ['nr_cadastral', '#HR_4001#', '#HR_4002#'], ['nr_cadastral', '#1/2#', '#1/3#'], ['nr_cadastral', '51333#1077/1,1077/1/1', '51333#1077/1,1077/1/2'],
      ['tarla', '97#UP II Valea Fictivă', '97#UP II VALEA FICTIVĂ'], ['tarla', '97#UP II Valea Fictivă', '97#UP II Valea Fictiva'],
      ['tarla', '97#UP II Valea Fictivă', '97# UP II Valea Fictivă'], ['poz_hg', '12/1', '12/2'],
    ]
    cazuri.forEach(([camp, import_, curent], k) => {
      const i = 200 + k
      const m = valoriImport([insertImport(i, { [camp]: import_ })])
      const r = randuriAnuntAfisare([parcela(i, { [camp]: curent })], UAT, m)
      expect(r.probleme).toHaveLength(1)
      expect(r.probleme[0]).toMatchObject({ id_parcela: parcela(i).id_parcela, camp })
      expect(r.randuri).toEqual([])
    })
    // și o valoare modificată care ARE forma strictă trece pe calea strictă (nu e marcată „din import”)
    const m = valoriImport([insertImport(300, { nr_cadastral: '#HR_4001#' })])
    expect(canonizeazaIdentificator('nr_cadastral', '#4001#', { import: m.get(uid(300)) })).toEqual({ ok: true, valoare: '#4001#' })
  })
  it('valoarea de import mutată pe ALT câmp (tarla de la import scrisă în nr_cadastral) → strict', () => {
    const m = valoriImport([insertImport(310, { tarla: '#HCN 901#' })])
    expect(randuriAnuntAfisare([parcela(310, { tarla: '#HCN 901#', nr_cadastral: '#HCN 901#' })], UAT, m).probleme)
      .toEqual([{ id_parcela: parcela(310).id_parcela, camp: 'nr_cadastral', motiv: MOTIV.FORMA }])
  })
  it('sat și tronson NU folosesc importul: un sat nedeclarat / un tronson invalid rămân refuzate chiar dacă importul le avea', () => {
    const r = insertImport(320); r.date_noi = { ...r.date_noi, sat: 'Satul Z', tronson: 99 }
    const m = valoriImport([r])
    expect(randuriAnuntAfisare([parcela(320, { sat: 'Satul Z', tronson: 99 })], UAT, m).probleme.map(x => x.camp)).toEqual(['sat', 'tronson'])
    expect(idp.CAMPURI_DIN_IMPORT).toEqual(['tarla', 'nr_cadastral', 'poz_hg'])
  })
  it('plafonul de lungime și caracterele de control rămân și pe calea „de la import”', () => {
    const lung = '#HCN ' + '1'.repeat(LUNGIME_MAX_IDENTIFICATOR) + '#'
    expect(canonizeazaIdentificator('nr_cadastral', lung, { import: laImport('nr_cadastral', lung) })).toEqual({ ok: false, motiv: MOTIV.LUNGIME })
    for (const cod of [0x07, 0x00, 0x1b, 0x7f, 0x200b, 0x202e, 0xfeff]) {
      const v = '#HCN 9' + String.fromCharCode(cod) + '01#'
      const r = canonizeazaIdentificator('nr_cadastral', v, { import: laImport('nr_cadastral', v) })
      expect(r.ok, `U+${cod.toString(16)}`).toBe(false)
    }
  })
})

describe('valoriImportDinJurnal: doar INSERT-uri de import DOVEDITE', () => {
  it('INSERT de import cu cheia corespunzătoare → valorile brute (exact șirurile); uuid-ul cu majuscule se normalizează', () => {
    const r = insertImport(1, { tarla: '97#UP II Valea Fictivă' })
    r.inregistrare_id = r.inregistrare_id.toUpperCase(); r.date_noi = { ...r.date_noi, id: r.date_noi.id.toUpperCase() }
    const m = valoriImport([r])
    expect([...m.keys()]).toEqual([uid(1)])
    expect(m.get(uid(1))).toEqual({ tarla: '97#UP II Valea Fictivă', nr_cadastral: '101', poz_hg: '7' })
    expect(Object.isFrozen(m.get(uid(1)))).toBe(true)
  })
  it('refuzate: alt tabel / altă acțiune / date_noi lipsă sau al altui id / cheie lipsă, goală, a altui UAT, a altor valori / „|” în valoare / tipuri străine / două INSERT-uri pe același id / uat3 invalid', () => {
    const b = insertImport(1)
    const cu = (date) => ({ ...b, date_noi: { ...b.date_noi, ...date } })
    const cazuri = [
      { ...b, tabela: 'red_detinatori' }, { ...b, actiune: 'update' }, { ...b, date_noi: null }, { ...b, date_noi: [] },
      cu({ id: uid(2) }), cu({ cheie_sursa: null }), cu({ cheie_sursa: '' }), cu({ cheie_sursa: 'ALT|7|101|T1' }), cu({ cheie_sursa: 'FIC|7|101|T2' }),
      cu({ tarla: 'A|B', cheie_sursa: 'FIC|7|101|A|B' }), cu({ nr_cadastral: 101, cheie_sursa: 'FIC|7|101|T1' }), cu({ poz_hg: { x: 1 } }),
    ]
    for (const c of cazuri) expect(valoriImport([c]).size, JSON.stringify(c)).toBe(0)
    expect(valoriImport([b, insertImport(1)]).size).toBe(0)                       // două INSERT-uri pe același id = nedovedit
    expect(valoriImport([b, insertImport(1), insertImport(1)]).size).toBe(0)
    for (const u of [null, undefined, '', 'fic', 'FICT', 7]) expect(idp.valoriImportDinJurnal([b], u).size).toBe(0)
    expect(idp.valoriImportDinJurnal([b], 'ABC').size).toBe(0)                     // cheia e a UAT-ului FIC, nu a lui ABC
    expect(valoriImport(null).size).toBe(0)
    expect(valoriImport([null, {}, { inregistrare_id: 5 }]).size).toBe(0)
  })
  it('câmpurile goale la import (null) se compară corect: cheia cu segment gol, parcela cu valoarea goală → nimic publicat, fără refuz', () => {
    const r = insertImport(5, { tarla: null, nr_cadastral: '#HCN 901#' })
    expect(r.date_noi.cheie_sursa).toBe('FIC|7|#HCN 901#|')
    const m = valoriImport([r])
    expect(m.get(uid(5))).toEqual({ tarla: null, nr_cadastral: '#HCN 901#', poz_hg: '7' })
    const { probleme, randuri } = randuriAnuntAfisare([parcela(5, { tarla: null, nr_cadastral: '#HCN 901#' })], UAT, m)
    expect(probleme).toEqual([])
    expect(randuri[0]).toMatchObject({ tarla: '', nr_cadastral: '#HCN 901#', poz_hg: '7' })
  })
})

describe('generatorul anunțului: valorile de import ajung în document; fără ele, generarea rămâne blocată', () => {
  const parcele = FORME.map(([camp, v], k) => parcela(k + 1, { [camp]: v }))
  const jurnal = FORME.map(([camp, v], k) => insertImport(k + 1, { [camp]: v }))
  const xmlDoc = async blob => (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml').async('string')
  it('selectul anunțului cere și `id` (legătura cu jurnalul), dar în document intră doar lista albă', () => {
    expect(COL_PARCELA_ANUNT.split(',').map(s => s.trim())).toEqual(['id', 'id_parcela', ...CAMPURI_PARCELA_ANUNT, 'sters_la'])
  })
  it('cu valorile de import (Map construit direct, contractul generatorului): toate formele reale se publică, exact forma așteptată', async () => {
    const m = new Map(FORME.map(([camp, v], k) => [uid(k + 1), Object.freeze(laImport(camp, v))]))
    const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, valoriImport: m, templateArrayBuffer: readFileSync(SABLON) })
    expect(r.randuri).toBe(FORME.length)
    const xml = await xmlDoc(r.blob)
    for (const [, , publicat] of FORME) expect(xml, publicat).toContain(`>${publicat}<`)
  })
  it('cu valorile citite din jurnal (valoriImportDinJurnal): la fel', async () => {
    const r = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, valoriImport: valoriImport(jurnal), templateArrayBuffer: readFileSync(SABLON) })
    expect(r.randuri).toBe(FORME.length)
  })
  it('fără valori de import (sau cu un obiect care nu e Map) → blocat, cu toate parcelele listate (ca azi)', async () => {
    for (const fara of [undefined, null, {}, [[uid(1), laImport('tarla', FORME[0][1])]]]) {
      const err = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele, valoriImport: fara, templateArrayBuffer: readFileSync(SABLON) }).catch(e => e)
      expect(err).toBeInstanceOf(Error)
      expect(err.probleme.map(p => p.id_parcela)).toEqual(parcele.map(p => p.id_parcela))
    }
  })
  it('o singură parcelă editată manual (telefon) între cele importate → blocat, DOAR ea listată, fără valoare în mesaj', async () => {
    const editate = parcele.map((p, k) => k === 3 ? { ...p, nr_cadastral: '0711111111' } : p)
    const err = await genereazaAnuntAfisare({ proiect: PROIECT, uat: UAT, parcele: editate, valoriImport: valoriImport(jurnal), templateArrayBuffer: readFileSync(SABLON) }).catch(e => e)
    expect(err.probleme).toEqual([{ id_parcela: parcele[3].id_parcela, camp: 'nr_cadastral', motiv: MOTIV.TELEFON_CNP }])
    expect(err.message).not.toContain('0711')
  })
})

// client Supabase fals pentru red_jurnal: aplică filtrele, ordonează pe id și taie la `maxRows` (ca plafonul max-rows de pe server)
function clientFals(randuri, { maxRows = 1000, eroareLaLot = null } = {}) {
  const cereri = []
  const client = {
    from(tabel) {
      const st = { tabel, filtre: [], inCol: null, inVal: null, gt: null, limit: null, order: null }
      const b = {
        select(c) { st.select = c; return b }, eq(c, v) { st.filtre.push([c, v]); return b }, in(c, v) { st.inCol = c; st.inVal = v; return b },
        order(c) { st.order = c; return b }, limit(n) { st.limit = n; return b }, gt(c, v) { st.gt = [c, v]; return b },
        then(ok, ko) {
          cereri.push({ ...st })
          const nrLot = new Set(cereri.map(x => x.inVal.join(','))).size
          if (eroareLaLot !== null && nrLot === eroareLaLot) return Promise.resolve({ data: null, error: { message: 'eroare fictivă' } }).then(ok, ko)
          let d = randuri.filter(r => st.filtre.every(([c, v]) => r[c] === v) && st.inVal.includes(r[st.inCol]))
          if (st.gt) d = d.filter(r => r[st.gt[0]] > st.gt[1])
          d = d.sort((a, b2) => a.id - b2.id).slice(0, Math.min(st.limit ?? Infinity, maxRows))
          return Promise.resolve({ data: d, error: null }).then(ok, ko)
        },
      }
      return b
    },
  }
  return { client, cereri }
}

describe('citesteValoriImport (citirea din ecranul UAT): loturi de id-uri, keyset până la pagina goală, eroarea nu e „fără import”', () => {
  it('250 de parcele, plafon de server 30 de rânduri: toate găsite; filtrele tabela / actiune; loturi ≤ 100 de id-uri; select explicit', async () => {
    const { citesteValoriImport, COL_JURNAL_INSERT_PARCELA } = await import('./valoriImport.js')
    const parcele = Array.from({ length: 250 }, (_, k) => parcela(k + 1, { nr_cadastral: '#HR_' + (4000 + k) + '#' }))
    const jurnal = parcele.map((p, k) => insertImport(k + 1, { nr_cadastral: p.nr_cadastral }))
    // zgomot: UPDATE-uri și INSERT-uri pe alte tabele, cu aceleași id-uri — nu trebuie să conteze
    jurnal.push({ ...insertImport(1), id: 99999, actiune: 'update' }, { ...insertImport(2), id: 99998, tabela: 'red_detinatori' })
    const { client, cereri } = clientFals(jurnal, { maxRows: 30 })
    const m = await citesteValoriImport(client, parcele, UAT3)
    expect(m.size).toBe(250)
    expect(COL_JURNAL_INSERT_PARCELA).toBe('id, tabela, actiune, inregistrare_id, date_noi')
    for (const c of cereri) {
      expect(c.tabel).toBe('red_jurnal'); expect(c.select).toBe(COL_JURNAL_INSERT_PARCELA)
      expect(c.filtre).toEqual([['tabela', 'red_parcele'], ['actiune', 'insert']])
      expect(c.inCol).toBe('inregistrare_id'); expect(c.inVal.length).toBeLessThanOrEqual(100); expect(c.order).toBe('id')
    }
    expect(new Set(cereri.map(c => c.inVal.join(','))).size).toBe(3)
    const { randuri, probleme } = randuriAnuntAfisare(parcele, UAT, m)
    expect(probleme).toEqual([]); expect(randuri).toHaveLength(250)
  })
  it('eroare la citirea jurnalului (al doilea lot) → aruncă (generarea se oprește), nu întoarce un Map parțial', async () => {
    const { citesteValoriImport } = await import('./valoriImport.js')
    const parcele = Array.from({ length: 150 }, (_, k) => parcela(k + 1))
    const { client } = clientFals(parcele.map((_, k) => insertImport(k + 1)), { eroareLaLot: 2 })
    await expect(citesteValoriImport(client, parcele, UAT3)).rejects.toBeTruthy()
  })
  it('fără parcele → nicio cerere, Map gol; parcele fără id ignorate', async () => {
    const { citesteValoriImport } = await import('./valoriImport.js')
    const { client, cereri } = clientFals([])
    expect((await citesteValoriImport(client, [{ id_parcela: 'X' }, null], UAT3)).size).toBe(0)
    expect(cereri).toHaveLength(0)
  })
  it('ecranul UAT citește valorile de import pentru UAT-ul PROASPĂT și le dă generatorului', () => {
    const src = readFileSync('src/redari/ui/UatEcran.jsx', 'utf8')
    expect(src).toContain('citesteValoriImport(supabase, parcele, uatProaspat.uat3, { esteCurent: curent })')
    expect(src).toContain('genereazaAnuntAfisare({ proiect: proiectProaspat, uat: uatProaspat, parcele, valoriImport, templateArrayBuffer })')
  })
})

// ─── Mutanți: modulul de validare copiat în .tmp cu o singură schimbare ───
const TMP = join(process.cwd(), '.tmp'); mkdirSync(TMP, { recursive: true })
const foldere = []
afterAll(() => { for (const f of foldere) rmSync(f, { recursive: true, force: true }) })
const RX_IMPORT_LOCAL = /from\s+'\.\/([\w.-]+\.js)'/g
async function incarcaIdp(mutatie = null) {
  const dir = mkdtempSync(join(TMP, 'anunt_import_')); foldere.push(dir)
  const surse = new Map(); const coada = ['identificatoriPublici.js']
  while (coada.length) {
    const n = coada.shift(); if (surse.has(n)) continue
    let t = readFileSync(resolve('src/redari', n), 'utf8').replace(/\r\n/g, '\n')
    if (mutatie && mutatie.fisier === n) {
      if (t.split(mutatie.din).length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${n}: ${mutatie.din}`)
      t = t.replace(mutatie.din, mutatie.in)
    }
    surse.set(n, t)
    for (const m of t.matchAll(RX_IMPORT_LOCAL)) coada.push(m[1])
  }
  for (const [n, t] of surse) writeFileSync(join(dir, n), t)
  return import(pathToFileURL(join(dir, 'identificatoriPublici.js')).href + `?v=${Date.now()}${Math.random()}`)
}
const F = 'identificatoriPublici.js'
const MUTANTI = {
  faraComparatie: { fisier: F, din: "      if (identicaCuImportul(camp, valoare, ctx.import)) return { ok: true, valoare: regula.compus && cadastruGol(sir) ? '' : sir, din_import: true }\n", in: '' },
  mereuAdevarat: { fisier: F, din: "  return typeof valoareImport === 'string' && valoare === valoareImport\n", in: '  return true\n' },
  faraCheie: { fisier: F, din: '  if (d.cheie_sursa !== cheieSursa(uat3, valori.poz_hg, valori.nr_cadastral, valori.tarla)) return null\n', in: '' },
  faraDublu: { fisier: F, din: '    peParcela.set(id, peParcela.has(id) ? null : valoriInsertImport(r, id, uat3))\n', in: '    peParcela.set(id, valoriInsertImport(r, id, uat3))\n' },
  faraControl: { fisier: F, din: "  if (typeof valoare !== 'string' || RE_CONTROL.test(valoare) || valoare.includes('|')) return false\n", in: "  if (typeof valoare !== 'string' || valoare.includes('|')) return false\n" },
}
describe('MUTANȚI: fiecare verificare scoasă e prinsă', () => {
  const formeAcceptate = mod => FORME.filter(([camp, v], k) => {
    const m = mod.valoriImportDinJurnal([insertImport(k + 1, { [camp]: v })], UAT3)
    return mod.canonizeazaParcelePublicate([parcela(k + 1, { [camp]: v })], CAMPURI_PARCELA_ANUNT, UAT, m).probleme.length === 0
  }).length
  const telefonManualTrece = mod => {
    const m = mod.valoriImportDinJurnal([insertImport(1)], UAT3)
    return mod.canonizeazaParcelePublicate([parcela(1, { nr_cadastral: '0711111111' })], CAMPURI_PARCELA_ANUNT, UAT, m).probleme.length === 0
  }
  it('intact: toate formele reale publicate, telefonul manual refuzat', async () => {
    const mod = await incarcaIdp()
    expect(formeAcceptate(mod)).toBe(FORME.length)
    expect(telefonManualTrece(mod)).toBe(false)
  })
  it('fără comparația cu importul → formele reale refuzate (toate)', async () => {
    expect(formeAcceptate(await incarcaIdp(MUTANTI.faraComparatie))).toBe(0)
  })
  it('comparația mereu adevărată → telefonul scris manual pe o parcelă importată trece', async () => {
    expect(telefonManualTrece(await incarcaIdp(MUTANTI.mereuAdevarat))).toBe(true)
  })
  it('fără verificarea cheii → un INSERT „fabricat” (cheie a altor valori) e luat drept import', async () => {
    const b = insertImport(1, { nr_cadastral: '#HCN 901#' }); b.date_noi = { ...b.date_noi, cheie_sursa: 'FIC|7|101|T1' }
    expect(idp.valoriImportDinJurnal([b], UAT3).size).toBe(0)
    expect((await incarcaIdp(MUTANTI.faraCheie)).valoriImportDinJurnal([b], UAT3).size).toBe(1)
  })
  it('fără garda „un singur INSERT” → două INSERT-uri pe același id sunt acceptate', async () => {
    expect((await incarcaIdp(MUTANTI.faraDublu)).valoriImportDinJurnal([insertImport(1), insertImport(1)], UAT3).size).toBe(1)
  })
  it('fără garda caracterelor de control → o valoare identică cu un caracter invizibil se publică', async () => {
    const v = '#HCN 9' + String.fromCharCode(0x200b) + '01#'
    const mod = await incarcaIdp(MUTANTI.faraControl)
    expect(mod.canonizeazaIdentificator('nr_cadastral', v, { import: laImport('nr_cadastral', v) }).ok).toBe(true)
    expect(canonizeazaIdentificator('nr_cadastral', v, { import: laImport('nr_cadastral', v) }).ok).toBe(false)
  })
})
