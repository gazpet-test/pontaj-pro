// fanLot.js — logica PURĂ a ecranului FAN pe un lot de plicuire (src/redari/ui/FanAwbPrevizualizare.jsx): pașii și când sunt activi,
// etichetele stărilor, borderoul CSV (fără date personale) și marcajul de TEST. Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3, §6.
// Cât timp TRANSPORT_REAL_ACTIV = false (redariFanHandler.mjs), TOȚI pașii sunt dezactivați vizibil, cu motivul „transport oprit”.
import { TRANSPORT_REAL_ACTIV } from '../../supabase/functions/_shared/redariFanHandler.mjs'
import { manifestTiparire, cheieTiraj, tirajDin, destinatarMascat, COD_TIRAJ_SCHIMBAT, MESAJ_TIRAJ_SCHIMBAT } from '../../supabase/functions/_shared/redariFan.mjs'
import { planPachetPlicuire, continutPaginaControl } from './plicuri.js'
export { TRANSPORT_REAL_ACTIV }

export const MESAJ_TRANSPORT_OPRIT = 'transport oprit'
export const PASI_FAN = Object.freeze([
  { cheie: 'propune', titlu: '1. Propune', ajutor: 'admin / editor: salvează datele verificate ale fiecărui plic (hash), fără cost' },
  { cheie: 'aproba', titlu: '2. Aprobă', ajutor: 'doar owner-ul: lotul (test / real), plafonul pilot, numărul de AWB-uri' },
  { cheie: 'genereaza', titlu: '3. Generează AWB', ajutor: 'doar owner-ul: AWB-uri plătite, în solicitări de cel mult 100' },
  { cheie: 'etichete', titlu: '4. Etichete A6', ajutor: 'un PDF pe lot, în ordinea numărului de plic, pentru imprimanta termică' },
  { cheie: 'curier', titlu: '5. Comandă curier', ajutor: 'în selfAWB (manual): o comandă pe zi, interval de cel puțin 2 ore' },
  { cheie: 'urmarire', titlu: '6. Urmărire', ajutor: 'ridicarea (C0) și livrarea; ridicarea o confirmă omul' },
  { cheie: 'confirmari', titlu: '7. Confirmări / retururi', ajutor: 'confirmările FAN și retururile propuse; AR-ul și returul le înregistrează omul' },
])

const numar = (randuri, stari) => (randuri || []).filter(r => stari.includes(r.stare)).length

/** Pașii cu starea lor: { ...pas, activ, motiv }. transportActiv = flag-ul din cod; evidentaInstalata = tabelul red_fan_awb citibil. */
export function stariPasi({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, poateScrie = false, fanLot = null, randuri = [], gataDePropus = 0 } = {}) {
  const cuAwb = numar(randuri, ['generat', 'ridicat'])
  const conditii = {
    propune: [[poateScrie, 'doar admin / editor'], [gataDePropus > 0, 'niciun plic cu toate datele cerute de FAN']],
    aproba: [[esteOwner, 'doar owner-ul'], [!!fanLot, 'alege întâi: lot de TEST sau lot real'], [numar(randuri, ['propus']) > 0, 'niciun plic propus']],
    genereaza: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['aprobat']) > 0, 'niciun plic aprobat']],
    etichete: [[esteOwner, 'doar owner-ul'], [cuAwb > 0, 'niciun AWB generat']],
    curier: [[cuAwb > 0, 'niciun AWB generat']],
    urmarire: [[esteOwner, 'doar owner-ul'], [cuAwb > 0, 'niciun AWB generat']],
    confirmari: [[esteOwner, 'doar owner-ul'], [cuAwb > 0, 'niciun AWB generat']],
  }
  return PASI_FAN.map(p => {
    if (!transportActiv) return { ...p, activ: false, motiv: MESAJ_TRANSPORT_OPRIT }
    if (!evidentaInstalata) return { ...p, activ: false, motiv: 'evidența FAN nu e instalată (migrarea neaplicată)' }
    const pica = conditii[p.cheie].find(([c]) => !c)
    return { ...p, activ: !pica, motiv: pica ? pica[1] : '' }
  })
}

/** Marcajul lotului (TEST / real): owner, înainte de PRIMA aprobare din istoricul lotului (Jakarinos #1118 r1 P2: red_fan_loturi.prima_aprobare_la,
 *  pusă de BD la prima aprobare și imuabilă — o re-propunere care readuce rândurile la „propus” nu redeschide marcajul). Separat de „Aprobă”. */
export function stareMarcaj({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, randuri = [], fanLot = null } = {}) {
  if (!transportActiv) return { activ: false, motiv: MESAJ_TRANSPORT_OPRIT }
  if (!evidentaInstalata) return { activ: false, motiv: 'evidența FAN nu e instalată (migrarea neaplicată)' }
  if (!esteOwner) return { activ: false, motiv: 'doar owner-ul' }
  if (fanLot?.prima_aprobare_la) return { activ: false, motiv: 'lotul a fost aprobat o dată: marcajul TEST / real nu se mai schimbă' }
  if (numar(randuri, ['aprobat', 'in_curs', 'generat', 'necunoscut', 'ridicat']) > 0) return { activ: false, motiv: 'lotul are deja plicuri aprobate: marcajul nu se mai schimbă' }
  return { activ: true, motiv: '' }
}

// Operațiile din procedură care nu sunt pași ai fluxului (Jakarinos #1118 r1 P2: toate în ecran, dezactivate cât transportul e oprit).
export const OPERATII_FAN = Object.freeze([
  { cheie: 'reconciliere', titlu: 'Reconciliază', ajutor: 'doar owner-ul: borderoul zilei pentru rândurile „necunoscut” / „în curs”; propunerile le confirmă omul' },
  { cheie: 'plafon', titlu: 'Plafonul lotului pilot', ajutor: 'doar owner-ul: câte plicuri aprobate pe lot (1…2000)' },
  { cheie: 'anulare', titlu: 'Anulare AWB', ajutor: 'doar owner-ul: AWB generat, neridicat (ștergere la FAN sau marcare după verificarea în selfAWB)' },
  { cheie: 'evenimente', titlu: 'Lista de evenimente FAN', ajutor: 'doar owner-ul: compară codurile FAN cu cele folosite aici' },
  { cheie: 'tiraj', titlu: 'Tiraj nou', ajutor: 'doar owner-ul: după distrugerea foilor tirajului început, înlocuiește tirajul cu manifestul de acum (se retipărește TOT lotul)' },
])
/** Operațiile cu starea lor: { ...operatie, activ, motiv } (aceleași reguli ca stariPasi: transportul oprit le dezactivează pe toate). */
export function stariOperatii({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, randuri = [] } = {}) {
  const conditii = {
    reconciliere: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['necunoscut', 'in_curs']) > 0, 'niciun rând „necunoscut” sau „în curs”']],
    plafon: [[esteOwner, 'doar owner-ul']],
    anulare: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['generat']) > 0, 'niciun AWB generat neridicat']],
    evenimente: [[esteOwner, 'doar owner-ul']],
    tiraj: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['generat', 'ridicat']) > 0, 'niciun AWB generat']],
  }
  const oprit = !transportActiv ? MESAJ_TRANSPORT_OPRIT : !evidentaInstalata ? 'evidența FAN nu e instalată (migrarea neaplicată)' : null
  return OPERATII_FAN.map(p => {
    if (oprit) return { ...p, activ: false, motiv: oprit }
    const pica = conditii[p.cheie].find(([c]) => !c)
    return { ...p, activ: !pica, motiv: pica ? pica[1] : '' }
  })
}

/** Numele fișierului de etichete al unei părți (toate părțile au nume distincte, în ordinea pozițiilor). Runda 3: cu identificatorul tirajului. */
const cuTiraj = tiraj => (tiraj?.id ? `_tiraj-${tiraj.id}` : '')
export const numeEtichete = ({ lot, fanLot, parte, parti, format, tiraj = null }) => `${prefixLot(fanLot)}${lot?.nr_lot || ''}${cuTiraj(tiraj)}_etichete_${format}${parti > 1 ? `_partea${String(parte).padStart(2, '0')}din${String(parti).padStart(2, '0')}` : ''}.pdf`
/** Pagina de control descărcată separat (cu prima parte a etichetelor) și cea din arhivă (prima, „0000_”): același conținut, același tiraj. */
export const numeControl = ({ lot, fanLot, tiraj = null, inArhiva = false }) => inArhiva ? `${prefixLot(fanLot)}0000${cuTiraj(tiraj)}_pagina_de_control.docx`
  : `${prefixLot(fanLot)}${lot?.nr_lot || ''}${cuTiraj(tiraj)}_pagina_de_control.docx`
export const numeArhiva = ({ lot, fanLot, tiraj = null }) => `${prefixLot(fanLot)}${lot?.nr_lot || ''}${cuTiraj(tiraj)}_documente_in_ordinea_plicurilor.zip`

/**
 * Pagina de control a unui lot FAN — O SINGURĂ definiție pentru cele două descărcări (runda 3, Jakarinos #1118 r2 P1): prima parte a
 * etichetelor (ecranul FAN) și arhiva documentelor (Loturi). Intrări: manifestul (manifestTiparire), plicurile lotului și convocările pe plic
 * (aceleași citiri ale ecranului Plicuri), tirajul verificat în BD. Întoarce { plan, continut } — plan = planPachetPlicuire (fișierele arhivei,
 * lipsurile), continut = continutPaginaControl (rândurile: poziție, plic, AWB, destinatar mascat, NUMĂRUL DOCUMENTELOR).
 */
export function controlLotFan({ lot, fanLot, manifest, plicuri, convocariPePlic, tiraj }) {
  const plan = planPachetPlicuire(plicuri, convocariPePlic, { prefix: prefixLot(fanLot), manifest, tiraj: tiraj?.id || null })
  const awbPe = new Map(manifest.tiparite.map(t => [t.pozitie, t.awb]))
  const continut = continutPaginaControl({ lot, test: fanLot?.test === true, ramase: manifest.ramase, tiraj,
    randuri: plan.plicuri.map(p => ({ pozitie: p.pozitie, nr_plic: p.nr_plic, awb: awbPe.get(p.pozitie) || '', destinatar: destinatarMascat(p.destinatar_nume), documente: p.documente })) })
  return { plan, continut }
}

/**
 * Arhiva documentelor unui lot FAN (ecranul Plicuri): manifestul din evidența RECITITĂ, planul (orice lipsă = refuz, ÎNAINTE de tiraj), apoi
 * tirajul verificat în BD cu cheia ACESTUI manifest (fn_red_fan_tiraj: primul apel îl începe; altă cheie decât a tirajului început = refuz RD020,
 * nimic descărcat). rpc(nume, args) → { data, error } (JWT-ul omului). Întoarce { manifest, tiraj, plan, continut } sau aruncă { code, message }.
 */
export async function pregatestePachetFan({ rpc, lot, fanLot, randuriFan, plicuri, convocariPePlic, subtle = globalThis.crypto?.subtle }) {
  const manifest = manifestTiparire({ randuri: randuriFan, plicuri })
  if (!manifest.tiparite.length) throw { code: '23514', message: `Lot FAN fără niciun plic cu AWB tipăribil; rămase: ${manifest.ramase.map(r => r.nr_plic).join(', ') || '-'}.` }
  const verificare = planPachetPlicuire(plicuri, convocariPePlic, { prefix: prefixLot(fanLot), manifest })
  if (verificare.lipsuri.length) throw { code: '23514', message: `Pachetul nu se face, lipsesc ${verificare.lipsuri.length} documente: ${verificare.lipsuri.slice(0, 8).join('; ')}${verificare.lipsuri.length > 8 ? ' …' : ''}` }
  const cheie = await cheieTiraj(manifest, subtle)
  const { data, error } = await rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: cheie, p_inlocuieste: null })
  if (error?.code === COD_TIRAJ_SCHIMBAT) throw { code: COD_TIRAJ_SCHIMBAT, message: MESAJ_TIRAJ_SCHIMBAT }
  if (error) throw error
  const tiraj = tirajDin(data, cheie)
  if (!tiraj) throw new Error('Tirajul nu s-a putut verifica (răspuns neconfirmat); nimic descărcat.')
  return { manifest, tiraj, ...controlLotFan({ lot, fanLot, manifest, plicuri, convocariPePlic, tiraj }) }
}

export const ETICHETE_STARE_FAN = Object.freeze({
  propus: 'propus', aprobat: 'aprobat', in_curs: 'în curs (trimis la FAN)', generat: 'AWB generat', eroare: 'respins de FAN',
  necunoscut: 'necunoscut: de reconciliat', anulat: 'anulat', ridicat: 'ridicat de curier',
})
export const ETICHETE_URMARIRE = Object.freeze({
  neurmarit: '-', fara_evenimente: 'fără evenimente', in_tranzit: 'în tranzit', ridicat: 'ridicat (C0): de confirmat', livrat: 'livrat (S2)',
  retur: 'RETUR', de_verificat: 'de verificat de om',
})
export const ETICHETE_CONFIRMARE = Object.freeze({
  nesolicitata: '-', lipsa: 'nicio confirmare încă', primita_de_verificat: 'confirmare primită: de verificat de om', forma_necunoscuta: 'răspuns de formă necunoscută: de verificat',
})

/** Prefixul fișierelor unui lot de TEST (etichete, borderou, pachet de documente): un lot de test nu se confundă cu unul real. */
export const prefixLot = fanLot => (fanLot?.test === true ? 'TEST_' : '')
export const titluLot = (lot, fanLot) => `${fanLot?.test === true ? 'LOT DE TEST · ' : fanLot?.test === false ? 'Lot real · ' : ''}${lot?.nr_lot || ''}`

/** Borderoul FAN al lotului (CSV): numărul plicului, AWB-ul și stările — FĂRĂ nume / adrese / telefoane. Lotul de test: marcat pe primul rând. */
export function csvBorderouFan({ lot, fanLot, randuri }) {
  const celula = v => { const s = String(v ?? ''); return `"${(/^[\s]*[=+@-]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` }
  const cap = fanLot?.test === true ? [['LOT DE TEST: AWB-urile nu sunt expedieri ale convocărilor și nu intră în registru / PV / export']] : []
  const linii = [...cap, [`Lot ${lot?.nr_lot || ''}`], ['Nr. plic', 'AWB', 'Stare', 'Urmărire', 'Ultimul eveniment', 'Retur propus', 'Confirmare'],
    ...[...(randuri || [])].sort((a, b) => (a.nr_plic < b.nr_plic ? -1 : a.nr_plic > b.nr_plic ? 1 : 0)).map(r => [r.nr_plic, r.awb || '', ETICHETE_STARE_FAN[r.stare] || r.stare,
      ETICHETE_URMARIRE[r.urmarire_stare] || r.urmarire_stare || '', r.ultim_eveniment || '', r.retur_propus || '', ETICHETE_CONFIRMARE[r.confirmare_stare] || r.confirmare_stare || ''])]
  return String.fromCharCode(0xFEFF) + linii.map(l => l.map(celula).join(';')).join('\r\n')
}

/** Mesajul pentru un răspuns al funcției edge (cod) — „transport oprit” e separat de erori (L18 / L20). */
export function mesajEdgeFan(rez) {
  const cod = rez?.data?.cod || rez?.error?.context?.cod || null
  if (cod === 'transport_real_oprit') return 'Transport oprit: funcția FAN nu face niciun apel până la activare.'
  if (cod === 'non_owner') return 'Doar owner-ul poate porni pașii FAN.'
  if (cod === 'manifest_schimbat') return 'Evidența s-a schimbat de la afișare: reîncarcă și verifică din nou pagina de control. Nimic tipărit.'
  if (cod === 'tiraj_schimbat') return `${MESAJ_TIRAJ_SCHIMBAT} Nimic tipărit.`
  if (cod === 'tiraj_neconfirmat') return 'Tirajul nu s-a putut verifica: nimic tipărit. Reîncarcă evidența și reîncearcă.'
  if (cod === 'stergere_neconfirmata') return `Ștergere neconfirmată: AWB-ul rămâne „generat”. ${rez?.data?.motiv || ''}`.trim()
  if (rez?.error) return 'Rezultat neconfirmat: reîncarcă evidența înainte de orice reluare (nu reapăsa orbește).'
  return cod === 'ok' ? 'Operație încheiată.' : `Răspuns: ${cod || 'necunoscut'}`
}
