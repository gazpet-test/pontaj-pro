import * as XLSX from 'xlsx-js-style'
import { potrivesteRol, calitatiRol } from './rol.js'
import { STARI_INCHISE } from './stare.js'
import { STARI, etichetaStare, ultimulRaspuns } from './stare.js'
import { ETICHETA_CALITATE, formatDataRo, aziBucuresti } from './docx.js'
import { etichetaOptiune, etichetaRetur } from './ui/comune.jsx'
import { mentiuneAr, scurteazaMentiuneAr } from './arMentiune.js'

// ASCII in source; Unicode escapes preserve the exact Model_6 headings.
export const COLOANE_REGISTRU = [
  ['A','PARCELA','ID parcel\u0103'], ['B','PARCELA','UAT'], ['C','PARCELA','Tronson'],
  ['D','PARCELA','Sat'], ['E','PARCELA','Tarla'], ['F','PARCELA','Nr. cadastral / parcel\u0103'],
  ['G','PARCELA','Poz. HG'], ['H','PARCELA','Suprafa\u021b\u0103 temporar\u0103 (mp)'], ['I','PARCELA','Categoria de folosin\u021b\u0103'],
  ['J','PERSOANA','Nume de\u021bin\u0103tor'], ['K','PERSOANA','Calitate'], ['L','PERSOANA','Cot\u0103'],
  ['M','PERSOANA','Adres\u0103 cunoscut\u0103?'], ['N','PERSOANA','Sursa datelor (baza TGZ din data)'], ['O','PERSOANA','Telefon (dac\u0103 exist\u0103)'],
  ['P','CONVOCARE','Nr. scrisoare'], ['Q','CONVOCARE','Data expediere'], ['R','CONVOCARE','Nr. recomandat\u0103 (AWB)'],
  ['S','CONVOCARE','Data confirmare primire'], ['T','CONVOCARE','Retur (motiv)'], ['U','CONVOCARE','Afi\u0219at la prim\u0103rie (nr. PV afi\u0219are)'],
  ['V','R\u0102SPUNS','Canal r\u0103spuns'], ['W','R\u0102SPUNS','Data r\u0103spuns'], ['X','R\u0102SPUNS','Op\u021biune r\u0103spuns'], ['Y','R\u0102SPUNS','Obiec\u021bii (text)'],
  ['Z','SESIUNE','Ziua programat\u0103'], ['AA','SESIUNE','Prezent?'], ['AB','SESIUNE','Constatare pe teren cerut\u0103? (data)'],
  ['AC','PV','Tip PV'], ['AD','PV','Nr. PV'], ['AE','PV','Data PV'], ['AF','PV','Obiec\u021bii de readucere?'],
  ['AG','PV','Termen remediere'], ['AH','PV','Remediat la'], ['AI','PV','Trimis spre semnare prin po\u0219t\u0103 (data)'], ['AJ','PV','PV semnat primit (data)'],
  ['AK','STARE','STARE (calculat\u0103)'], ['AL','STARE','Responsabil Gazpet'], ['AM','STARE','Observa\u021bii'],
].map(([col, grup, antet]) => ({ col, grup, antet }))

const CANALE = { online: 'Online', telefon: 'Telefon', scris: 'Scris', sesiune: 'La sesiune', email: 'E-mail', sms: 'SMS' }
const daNu = v => v === true ? 'DA' : v === false ? 'NU' : ''
const text = v => v ?? ''
const compara = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ro', { numeric: true })
const moment = v => { const n = v ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : -Infinity }
const recent = (randuri, camp) => randuri.slice().sort((a, b) => moment(b[camp]) - moment(a[camp]) || moment(b.created_at) - moment(a.created_at) || compara(b.id, a.id))[0] || {}
// Calendar dates stay literal; instants are displayed on the Bucharest day.
const dataRo = v => {
  if (!v || /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDataRo(v)
  const dt = new Date(v)
  if (!Number.isFinite(dt.getTime())) throw new Error('Data invalida in export.')
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(dt).map(x => [x.type,x.value]))
  return formatDataRo(`${p.year}-${p.month}-${p.day}`)
}

export function randRegistru({ parcela = {}, uat = {}, detinator = {}, contact = {}, convocari = [], raspunsuri = [], pvs = [], stare, responsabil } = {}) {
  const conv = recent(convocari.filter(c => c.detinator_id === detinator.id && c.stare === 'activ' && c.sters_la == null), 'data_expediere')
  const rasp = raspunsuri.filter(r => r.detinator_id === detinator.id)
  const r = ultimulRaspuns(rasp) || {}
  const active = pvs.filter(p => p.sters_la == null && p.stare !== 'anulat' && p.parcela_id === parcela.id)
  const a = active.filter(p => p.tip === 'A' && p.detinator_id === detinator.id)
  const pv = recent(a.length ? a : active.filter(p => p.tip === 'B'), 'data_pv')
  return {
    A: text(parcela.id_parcela), B: text(uat.nume), C: text(parcela.tronson), D: text(parcela.sat), E: text(parcela.tarla),
    F: text(parcela.nr_cadastral), G: text(parcela.poz_hg), H: text(parcela.suprafata_temporara_mp), I: text(parcela.categoria_folosinta),
    J: text(detinator.nume), K: ETICHETA_CALITATE[detinator.calitate] ?? text(detinator.calitate), L: text(detinator.cota),
    M: daNu(contact.adresa_cunoscuta), N: [detinator.sursa_date, detinator.versiune_lista_tgz].filter(Boolean).join(' '), O: text(contact.telefon),
    P: text(conv.nr_document), Q: formatDataRo(conv.data_expediere), R: text(conv.nr_tracking), S: formatDataRo(conv.data_confirmare_primire) + mentiuneAr(conv),
    T: conv.retur ? etichetaRetur(conv.retur) : '', U: text(uat.afisare_pv_nr), V: CANALE[r.canal] ?? text(r.canal), W: dataRo(r.data),
    X: r.optiune ? etichetaOptiune(r.optiune) : '', Y: text(r.obiectii_text), Z: formatDataRo(r.zi_sesiune_aleasa),
    AA: rasp.some(x => x.canal === 'sesiune') ? 'DA' : '', AB: r.optiune === 'constatare_teren' ? dataRo(r.data) : '',
    AC: text(pv.tip), AD: text(pv.nr_pv), AE: formatDataRo(pv.data_pv), AF: daNu(pv.obiectii_redare), AG: formatDataRo(pv.termen_remediere),
    AH: formatDataRo(pv.remediat_la), AI: formatDataRo(pv.trimis_spre_semnare_data), AJ: formatDataRo(pv.semnat_primit_data),
    AK: etichetaStare(stare), AL: typeof responsabil === 'string' ? responsabil : text(responsabil?.name), AM: text(parcela.observatii),
  }
}

// Free text cannot safely be classified as an address by regex. Suppress it for TGZ.
// Other string cells containing obvious contact syntax fail closed as a whole cell.
const LIBERE_TGZ = new Set(['N', 'Y', 'AM'])
// Euristica de contact DOAR pe coloanele text introduse de oameni; datele (Q, S, W...), AWB-ul (R), numerele
// de document si codurile raman (altfel datele si AWB-ul ar fi golite - gasit de chat la verificarea feliei 6).
const EURISTIC_TGZ = new Set(['D', 'E', 'I', 'J', 'K', 'L', 'AL'])
const randTgz = r => Object.fromEntries(COLOANE_REGISTRU.filter(c => c.col !== 'O').map(({ col }) => {
  const v = col === 'S' ? scurteazaMentiuneAr(r[col] ?? '') : (r[col] ?? '')   // juridic#021: către TGZ fără textul liber de pe AR
  return [col, LIBERE_TGZ.has(col) || (EURISTIC_TGZ.has(col) && typeof v === 'string' && /(?:\+?\d[\d ().-]{7,}\d|@|\b(?:strada|bulevard|adresa|aleea|calea|soseaua)\b|\b(?:str|bd|bdul|sos|al)\.)/i.test(v)) ? '' : v]
}))
export function randuriRegistru(date, { pentruTgz = false, rol = 'toti' } = {}) {
  calitatiRol(rol)
  return date.filter(d => potrivesteRol(d.detinator, rol)).map(randRegistru).sort((a, b) => compara(a.B, b.B) || compara(a.C, b.C) || compara(a.A, b.A) || compara(a.J, b.J))
    .map(r => pentruTgz ? randTgz(r) : r)
}

const STARI_PROCES = [...STARI].sort((a, b) => b.ordine - a.ordine)
export function foaieCentralizator(randuriCentralizator, uats) {
  const lista = [...uats].sort((a, b) => compara(a.nume, b.nume))
  const matrice = new Map(lista.map(u => [u.id, new Map(STARI.map(s => [s.cod, 0]))]))
  for (const r of randuriCentralizator) {
    const n = Number(r.numar), m = matrice.get(r.uat_id)
    if (!m || !m.has(r.stare) || r.numar == null || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error('Centralizator invalid sau UAT necunoscut.')
    m.set(r.stare, m.get(r.stare) + n)
  }
  const totaluri = lista.map(u => [...matrice.get(u.id).values()].reduce((a, b) => a + b, 0))
  const inchise = lista.map(u => STARI_INCHISE.reduce((n, s) => n + matrice.get(u.id).get(s), 0))
  const suma = a => a.reduce((x, y) => x + y, 0)
  const procent = (n, total) => total ? Math.round(n * 1000 / total) / 10 : 0
  return [
    ['Stare', ...lista.map(u => u.nume), 'TOTAL'],
    ...STARI_PROCES.map(s => { const valori = lista.map(u => matrice.get(u.id).get(s.cod)); return [etichetaStare(s.cod), ...valori, suma(valori)] }),
    ['TOTAL parcele', ...totaluri, suma(totaluri)],
    // Q5: procentul este pe parcele distincte, ca red_v_centralizator_uat.
    ['% parcele inchise (PV A sau B)', ...inchise.map((n, i) => procent(n, totaluri[i])), procent(suma(inchise), suma(totaluri))],
  ]
}

function culoareModel(cod) {
  if (['PV_A_SEMNAT', 'PV_A_ACOPERIT_PARCELA'].includes(cod)) return 'C6EFCE'
  if (['PV_B_CONSTATARE', 'CONVOCAT_FARA_RASPUNS'].includes(cod)) return 'FFEB9C'
  if (['OBIECTII_DE_TRATAT', 'CONVOCARE_RETURNATA'].includes(cod)) return 'FFC7CE'
  if (['NEIDENTIFICAT_AFISARE', 'FARA_ADRESA_AFISARE'].includes(cod)) return 'D9D9D9'
  return 'FFFFFF'
}

export function construiesteWorkbook({ registru, centralizator = [], pentruTgz = false }) {
  const wb = XLSX.utils.book_new()
  if (registru != null) {
    if (pentruTgz) registru = registru.map(randTgz)
    const coloane = COLOANE_REGISTRU.filter(c => !pentruTgz || c.col !== 'O')
    const ws = XLSX.utils.aoa_to_sheet([coloane.map(c => c.grup), coloane.map(c => c.antet), ...registru.map(r => coloane.map(c => r[c.col] ?? ''))])
    ws['!merges'] = []
    let inceput = 0
    coloane.forEach((c, i) => {
      if (i === coloane.length - 1 || coloane[i + 1].grup !== c.grup) {
        if (i > inceput) ws['!merges'].push({ s: { r: 0, c: inceput }, e: { r: 0, c: i } })
        inceput = i + 1
      }
    })
    ws['!cols'] = coloane.map(c => ({ wch: ['Y','AM'].includes(c.col) ? 40 : Math.min(32, Math.max(14, c.antet.length)) }))
    ws['!autofilter'] = { ref: `A2:${XLSX.utils.encode_col(coloane.length - 1)}${registru.length + 2}` }
    registru.forEach((r, i) => {
      const cell = ws[XLSX.utils.encode_cell({ r: i + 2, c: coloane.findIndex(c => c.col === 'AK') })]
      const cod = STARI.find(s => s.eticheta === r.AK)?.cod
      cell.s = { fill: { patternType: 'solid', fgColor: { rgb: culoareModel(cod) } } }
    })
    XLSX.utils.book_append_sheet(wb, ws, 'Registru')
  }
  const central = XLSX.utils.aoa_to_sheet(centralizator)
  if (centralizator.length) for (let c = 1; c < centralizator.at(-1).length; c++) {
    const cell = central[XLSX.utils.encode_cell({ r: centralizator.length - 1, c })]
    if (cell) cell.z = '0.0"%"'
  }
  XLSX.utils.book_append_sheet(wb, central, 'Centralizator')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Registru: un rand = parcela + persoana. Centralizator: fiecare parcela se numara o singura data.'],
    ['Export de consultare. STARE este calculata in ERP, nu prin formule Excel.'],
    ['Nu se sterg randuri si nu se suprascriu date vechi; corectiile se inregistreaza in ERP, cu istoric.'],
    [registru == null ? 'Centralizator agregat, fara date personale.' : pentruTgz ? 'Exportul TGZ nu contine telefoane, emailuri sau adrese. Textele libere N/Y/AM sunt omise.' : 'Datele personale raman in fisier si ERP cu acces restrans. Exportul catre Transgaz se face fara telefoane.'],
    ['Descarcare locala; nimic nu se trimite automat.'],
    ...STARI_PROCES.map(s => [etichetaStare(s.cod)]),
  ]), 'Legenda')
  return wb
}

export function numeFisier({ proiectCod, tip, azi = aziBucuresti() }) {
  if (typeof proiectCod !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(proiectCod)) throw new Error('Cod proiect invalid pentru numele fisierului.')
  if (!['intern', 'TGZ', 'centralizator'].includes(tip)) throw new Error('Tip export invalid.')
  if (typeof azi !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(azi) || !Number.isFinite(Date.parse(`${azi}T12:00:00Z`)) || new Date(`${azi}T12:00:00Z`).toISOString().slice(0, 10) !== azi) throw new Error('Data export invalida.')
  return tip === 'centralizator' ? `Centralizator_${proiectCod}_${azi}.xlsx` : `Registru_${proiectCod}_${tip}_${azi}.xlsx`
}
