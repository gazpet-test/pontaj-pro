import { readFileSync } from 'node:fs'
import { deepStrictEqual } from 'node:assert/strict'
// Directorul de probă nu are package.json; citim exact sursa ESM fără a modifica proiectul.
const sursa = readFileSync(new URL('../../src/lib/arhivaNume.js', import.meta.url), 'utf8')
const { parseNumeLicitatie, parseNumeLucrareExecutata } = await import(`data:text/javascript;base64,${Buffer.from(sursa).toString('base64')}`)

const randuri = readFileSync(new URL('./nume-reale.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).filter(l => l.trim() && !l.trimStart().startsWith('#'))
  .map((linie, i) => {
    const tab = linie.indexOf('\t')
    if (tab < 1 || !linie.slice(tab + 1)) throw new Error(`Linie de date invalidă: ${i + 1}`)
    const categorie = linie.slice(0, tab), nume = linie.slice(tab + 1)
    const executata = categorie === 'EXPERIENTA'
    return { categorie, nume, executata, rezultat: executata
      ? parseNumeLucrareExecutata(nume) : parseNumeLicitatie(nume, categorie) }
  })
const celula = v => JSON.stringify(v).replace(/\|/g, '\\|')
console.log('| # | Categorie | Nume original | Rezultat complet |')
console.log('|---|---|---|---|')
randuri.forEach((r, i) => console.log(`| ${i + 1} | ${r.categorie} | ${r.nume} | ${celula(r.rezultat)} |`))
console.log('\nNUMĂRĂTORI')
for (const [eticheta, lot] of [['Total', randuri], ['Licitații / administrative', randuri.filter(r => !r.executata)], ['Executate / administrative', randuri.filter(r => r.executata)]]) {
  const n = fn => lot.filter(({ rezultat: r }) => fn(r)).length
  console.log(`${eticheta}: ${lot.length}; cu numar=${n(r => r.numar !== null)}; cu termen=${n(r => r.termen != null)}; cu neinterpretat=${n(r => r.neinterpretat.length > 0)}; cu data_pv=${n(r => r.data_pv != null)}`)
}
for (const valoare of [true, false, null]) console.log(`este_licitatie=${valoare}: ${randuri.filter(r => !r.executata && r.rezultat.este_licitatie === valoare).length}`)

// Numele întreg împiedică alegerea accidentală a primei înregistrări cu numărul 146.
const asteptari = [
  ['147.Punere in sig.cond.Dn700 SECUIENI_C.F.I. Lider termen depunere19.08.2025', { numar: 147, partener: 'CFI', rol: null, termen: '2025-08-19', denumire: 'Punere in sig.cond.Dn700 SECUIENI', neinterpretat: ['C.F.I. Lider'] }],
  ['148.Cond.Dn600 Mihai Bravu SILISTEA_Petroconst Lider termen depunere 09.05.2025', { partener: 'Petroconst', rol: null, neinterpretat: ['Petroconst Lider'] }],
  ['173.CFI Lider_cond.DN700 Isaccea-Sendreni  termen depunere 22.06.2026', { partener: 'CFI', rol: null, neinterpretat: ['CFI Lider'], denumire: 'cond.DN700 Isaccea-Sendreni' }],
  ['49.SORCHIV Lider_Pr.si exec.Distrib.gaze com SMARDAN Galati termen depunere 01.04.2026', { partener: 'SORCHIV', rol: null, neinterpretat: ['SORCHIV Lider'] }],
  ['2 HABAU_CJ PRAHOVA Asociat Gazpet depunere 14.02.2024', { numar: 2, partener: 'HABAU', rol: 'asociat', termen: '2024-02-14', neinterpretat: [] }],
  ['1 SORCHIV_CONTESTI Tert subcontractant Gazpet depunere 10.10.2023', { partener: 'SORCHIV', rol: null, neinterpretat: ['Tert subcontractant Gazpet'] }],
  ['25.ADI Ialomita_Gazpet subcontractant ptr. Habau termen depunere 17.02.2025', { rol: 'subcontractant', partener: 'Habau', denumire: 'ADI Ialomita', neinterpretat: [] }],
  ['39.NU_SCN1172058 Distributie gaze VIISOARA jud. Bacau termen depunere 16.02.2026', { participat: false, id_seap: 'SCN1172058', termen: '2026-02-16', neinterpretat: [] }],
  ['175.NU Preg.cond.Dn400 in cond.godevilabila jud. Covasna termen depunere 09.03.2026', { participat: false, termen: '2026-03-09' }],
  ['30.NU.Modernizare si extindere retea distributie g.n. satul Harsa, comuna Plopu, jud. Prahova depunere 3.12.2025', { participat: false, termen: '2025-12-03' }],
  ['129.Punerea in sig. DN400 Campina-Nedelea si DN 500 Posada-BOBOLIA, PH depunerea 26.01.2024', { termen: '2024-01-26', neinterpretat: [] }],
  ['167.Cond de tgn HUEDIN Lugașu (incl alim cu EE PC si FO) term dep 26.01.2026', { termen: '2026-01-26', neinterpretat: [] }],
  ['58.Distrib gn in com MANASTIREA, JUD CALARASI termen dep 24.09.2026', { termen: '2026-09-24' }],
  ['168.Segarcea - 26.01.2026', { termen: '2026-01-26', denumire: 'Segarcea' }],
  ['180.Cond.tgn TUZLA_PODISOR termen 30.06.2026', { termen: '2026-06-30' }],
  ['14. ANULATA Reparatii cond. Secuieni si Roman 2 loturi 04.04.2022 ANULATA', { stare: 'anulata', termen: '2022-04-04', neinterpretat: [] }],
  ['37.NU Distributie gaze GLODEANU SARAT jud. Buzau termen depunere 02.02.2026 suspendata', { participat: false, stare: 'suspendata', termen: '2026-02-02' }],
  ['26. Scaiosi jud. Valcea 04.12.2018 RELUATA', { stare: 'reluata', termen: '2018-12-04' }],
  ['146. Lot 1 Gazpet_Lot 2 Comesad ISALNITA depunere 11.03.2025', { numar: 146, partener: null, denumire: 'ISALNITA', neinterpretat: ['Lot 1 Gazpet_Lot 2 Comesad'] }],
  ['146. Lot 1 Gazpet_Lot 2 Comesad TURCENI ISALNITA termen depunere 11.03.2025', { numar: 146, partener: null, denumire: 'TURCENI ISALNITA', neinterpretat: ['Lot 1 Gazpet_Lot 2 Comesad'] }],
  ['152. LOT 2 Prunisor-Jupa', { numar: 152, este_licitatie: true, termen: null, denumire: 'LOT 2 Prunisor-Jupa' }],
  ['actualizare Contracte conf.OUG 97', { este_licitatie: false, numar: null, neinterpretat: ['actualizare Contracte conf.OUG 97'] }],
  ['FORAJE', { este_licitatie: false, neinterpretat: ['FORAJE'] }],
  ['PV receptii Conpet', { este_licitatie: false, neinterpretat: ['PV receptii Conpet'] }],
  ['romgaz-balda si sanmartin', { este_licitatie: null, neinterpretat: ['romgaz-balda si sanmartin'] }],
  ['Racordare SRM Craiova_Podari termen depunere 27.06.2025', { este_licitatie: true, numar: null, termen: '2025-06-27' }],
  ['128.Punere în sig trav.aeriană râu Arieș cu DN500 LUNCANI – Câmpia Turzii, Cluj depunere 12.02.2024', { termen: '2024-02-12', denumire: 'Punere în sig trav.aeriană râu Arieș cu DN500 LUNCANI – Câmpia Turzii, Cluj' }],
  ['51.NU Infiintare sistem de distributie a gazelor nat, com.SUTESTI, jud Valcea termen depunere 14.04.2026 (1)', { participat: false, neinterpretat: ['(1)'] }],
  ['45.Conpet Comisani 4603 F,C,PVRTL din 22.01.2026', { numar: 45, beneficiar: 'Conpet', lucrare: 'Comisani', nr_contract: '4603', piese: ['F', 'C', 'PVRTL'], data_pv: '2026-01-22', tip_pv: 'PVRTL', neinterpretat: [] }],
  ['21.TOTIA 4988 F, C, R, DC PV din 07.09.2021', { nr_contract: '4988', piese: ['F', 'C', 'DC', 'PV'], neinterpretat: ['R'], data_pv: '2021-09-07' }],
  ['13.miraslau 920 F, C, PV din14.10.2020', { nr_contract: '920', data_pv: '2020-10-14', lucrare: 'miraslau' }],
  ['9.1.gara vest conpet 1313 F, C, PV din 19.10.2020', { numar: 9, nr_contract: '1313', beneficiar: 'conpet', neinterpretat: ['1.'] }],
  ['36. Filipesti Platou Cioc 2699 F, C, PVRTL din 18.07 si 28.08.2024', { nr_contract: '2699', data_pv: null, neinterpretat: ['din 18.07 si 28.08.2024'] }],
  ['46.Conpet Cricov 2752, F,C,PVRTL 22_24.09.2025', { nr_contract: '2752', data_pv: null, neinterpretat: ['22_24.09.2025'] }],
  ['47.Bentu 22303167.46 F,C,PVRP 23_14.10.2025', { nr_contract: null, lucrare: 'Bentu', piese: ['F', 'C', 'PVRP'], tip_pv: 'PVRP', data_pv: null, neinterpretat: ['23_14.10.2025', '22303167.46'] }],
  ['14.valea danului 1499 F, C, PVR partiala din 18.12.2020', { nr_contract: '1499', tip_pv: 'PVRP', piese: ['F', 'C', 'PVRP'], data_pv: '2020-12-18' }],
  ['DOCUMENTE CONSTATOARE SEAP', { numar: null, neinterpretat: ['DOCUMENTE CONSTATOARE SEAP'] }],
]
let esecuri = 0
console.log('\nAȘTEPTĂRI EXPLICITE')
for (const [nume, asteptat] of asteptari) {
  try {
    const potriviri = randuri.filter(r => r.nume === nume)
    deepStrictEqual(potriviri.length, 1, 'Numele trebuie să existe exact o dată în fișier')
    const rezultat = potriviri[0].rezultat
    deepStrictEqual(Object.fromEntries(Object.keys(asteptat).map(k => [k, rezultat[k]])), asteptat)
    console.log(`PASS | ${nume} | ${JSON.stringify(asteptat)}`)
  } catch (e) {
    esecuri++
    console.log(`FAIL | ${nume}\n${e.message}`)
  }
}
const suplimentare = [
  ['Dată imposibilă', '1. Lucrare depunere 31.02.2024', { termen: null, neinterpretat: ['depunere 31.02.2024'] }],
  ['Două termene', '1. Lucrare depunere 01.02.2024 termen 02.02.2024', { termen: null, neinterpretat: ['depunere 01.02.2024', 'termen 02.02.2024'] }],
  ['Stări contradictorii', '1. Lucrare ANULATA RELUATA', { stare: null, neinterpretat: ['ANULATA', 'RELUATA'] }],
  ['Rol propriu lider', '1. Gazpet Lider Lucrare', { rol: 'lider' }],
  ['Diacritice în metadate', '1. Terț susținător Gazpet Lucrare ANULATĂ', { rol: 'tert_sustinator', stare: 'anulata' }],
  ['Format nou de dată', '1. Lucrare depunere 15/03/2024', { termen: null, neinterpretat: ['depunere 15/03/2024'] }],
  ['Parteneri multipli', '1. HABAU SORCHIV Lucrare', { partener: null, neinterpretat: ['HABAU', 'SORCHIV'] }],
  ['Intrare nulă', null, { numar: null, este_licitatie: null }],
]
for (const [eticheta, nume, asteptat] of suplimentare) {
  try {
    const rezultat = parseNumeLicitatie(nume, '1.TRANSGAZ')
    deepStrictEqual(Object.fromEntries(Object.keys(asteptat).map(k => [k, rezultat[k]])), asteptat)
    console.log(`PASS | ${eticheta} | ${JSON.stringify(asteptat)}`)
  } catch (e) { esecuri++; console.log(`FAIL | ${eticheta}\n${e.message}`) }
}
const total = asteptari.length + suplimentare.length
console.log(`\nREZULTAT: ${total - esecuri} PASS, ${esecuri} FAIL din ${total} așteptări; ${randuri.length} nume procesate.`)
if (esecuri) process.exit(1)
