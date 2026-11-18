// fanLot.js — logica PURĂ a ecranului FAN pe un lot de plicuire (src/redari/ui/FanAwbPrevizualizare.jsx): pașii și când sunt activi,
// etichetele stărilor, borderoul CSV (fără date personale) și marcajul de TEST. Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3, §6.
// Cât timp TRANSPORT_REAL_ACTIV = false (redariFanHandler.mjs), TOȚI pașii sunt dezactivați vizibil, cu motivul „transport oprit”.
// Activarea pentru Testul 1 (DOAR_PROIECTE_TEST = true): pașii și operațiile sunt active DOAR pe un proiect „TEST-…” cu lotul marcat TEST —
// ACEEAȘI gardă (transportPermis) ca în funcția edge (L19); butonul de marcaj cere doar proiectul de TEST (lotul nu e încă marcat).
import { TRANSPORT_REAL_ACTIV, DOAR_PROIECTE_TEST, transportPermis, esteProiectTest, MESAJ_TRANSPORT_OPRIT, MESAJ_DOAR_PROIECT_TEST, MESAJ_DOAR_LOT_TEST } from '../../supabase/functions/_shared/redariFanHandler.mjs'
import { manifestTiparire, cheieTiraj, tirajDin, tirajNeschimbat, refuzTiraj, destinatarMascat, COD_TIRAJ_SCHIMBAT, COD_TIRAJ_OPRIT, MESAJ_TIRAJ_SCHIMBAT, MESAJ_TIRAJ_OPRIT,
  ASTEPTARE_DUPA_OPRIRE_S, fapteContrazise, ALEGERI_SOLUTIONARE, COD_URMARIRE_SCHIMBATA, sumaFan, EVENIMENTE_FAN, categorieEveniment, cereOpod,
  COST_OPOD_ESTIMAT_LEI } from '../../supabase/functions/_shared/redariFan.mjs'
import { planPachetPlicuire, continutPaginaControl } from './plicuri.js'
export { TRANSPORT_REAL_ACTIV, DOAR_PROIECTE_TEST, transportPermis, esteProiectTest, MESAJ_TRANSPORT_OPRIT, MESAJ_DOAR_PROIECT_TEST, MESAJ_DOAR_LOT_TEST }

/** Motivul pentru care transportul NU e permis pe acest lot în ecran (null = permis): flag-ul, proiectul de TEST, marcajul lotului. */
const motivTransport = ({ transportActiv, proiectCod, fanLot, cereMarcaj = true }) => {
  const p = transportPermis({ proiectCod, fanLot, cereMarcaj, transportActiv })
  return p.ok ? null : p.motiv
}
export const PASI_FAN = Object.freeze([
  { cheie: 'propune', titlu: '1. Propune', ajutor: 'admin / editor: salvează datele verificate ale fiecărui plic (hash), fără cost' },
  { cheie: 'aproba', titlu: '2. Aprobă', ajutor: 'doar owner-ul: lotul (test / real), plafonul pilot, numărul de AWB-uri' },
  { cheie: 'genereaza', titlu: '3. Generează AWB', ajutor: 'doar owner-ul: AWB-uri plătite, în solicitări de cel mult 100' },
  // 18.11.2026: formatul A6 e CERUT curierului (parametrul din documentație), dar prima probă a venit A4 → titlul nu mai afirmă A6
  { cheie: 'etichete', titlu: '4. Etichete', ajutor: 'un PDF pe lot, în ordinea numărului de plic; formatul paginii se verifică pe PDF (A6 cerut curierului; la prima probă a venit A4)' },
  { cheie: 'curier', titlu: '5. Comandă curier', ajutor: 'în selfAWB (manual): o comandă pe zi, interval de cel puțin 2 ore' },
  { cheie: 'urmarire', titlu: '6. Urmărire', ajutor: 'ridicarea (C0) și livrarea; ridicarea o confirmă omul' },
  { cheie: 'confirmari', titlu: '7. Confirmări / retururi', ajutor: 'confirmările FAN și retururile propuse; AR-ul și returul le înregistrează omul' },
])

const numar = (randuri, stari) => (randuri || []).filter(r => stari.includes(r.stare)).length

/**
 * Ce e DE PROPUS pe lot (18.11.2026, după primul AWB real: „1. Propune” rămânea activ după ce toate plicurile aveau AWB): din plicurile
 * pregătite (pregatestePlicuriFan: { ok, plic, hash }) intră DOAR cele fără rând FAN viu (un rând „eroare” / „anulat” nu e viu — plicul se poate
 * propune din nou) sau cu rândul viu „propus” / „aprobat” pe ALT hash (datele s-au schimbat: re-propunere). Un plic „propus” / „aprobat” cu
 * același hash NU se mai propune (RPC-ul ar readuce un rând aprobat la „propus”); un plic cu AWB (in_curs / generat / necunoscut / ridicat) nu se
 * propune niciodată (RPC-ul refuză oricum: P0001, fără rând dublu). Întoarce { dePropus: [pregătite], motiv } — motiv = de ce nu e nimic de propus.
 * O SINGURĂ definiție (L19): ecranul (butonul + lista trimisă) și simulatorul procedurii o folosesc identic.
 */
export function starePropunere({ pregatite = [], randuri = [] } = {}) {
  const vii = new Map((randuri || []).filter(r => r && !['eroare', 'anulat'].includes(r.stare)).map(r => [r.plic_id, r]))
  const ok = (pregatite || []).filter(p => p?.ok && p.plic?.id)
  const dePropus = ok.filter(p => { const f = vii.get(p.plic.id); return !f || (['propus', 'aprobat'].includes(f.stare) && f.hash_date !== p.hash) })
  const motiv = !ok.length ? 'niciun plic cu toate datele cerute de FAN'
    : !dePropus.length ? 'nimic de propus: fiecare plic are deja rând FAN cu datele de acum (propus, aprobat sau cu AWB)' : ''
  return { dePropus, motiv }
}

/** Pașii cu starea lor: { ...pas, activ, motiv }. transportActiv = flag-ul din cod; evidentaInstalata = tabelul red_fan_awb citibil;
 *  proiectCod = red_proiecte.cod al lotului (garda „doar TEST”: fără el, cu DOAR_PROIECTE_TEST, nimic nu e activ).
 *  gataDePropus = numărul plicurilor DE PROPUS (starePropunere.dePropus.length), motivPropunere = motivul când e 0 (starePropunere.motiv). */
export function stariPasi({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, poateScrie = false, fanLot = null, randuri = [], gataDePropus = 0, motivPropunere = '', proiectCod = null } = {}) {
  const cuAwb = numar(randuri, ['generat', 'ridicat'])
  const conditii = {
    propune: [[poateScrie, 'doar admin / editor'], [gataDePropus > 0, motivPropunere || 'niciun plic cu toate datele cerute de FAN']],
    aproba: [[esteOwner, 'doar owner-ul'], [!!fanLot, 'alege întâi: lot de TEST sau lot real'], [numar(randuri, ['propus']) > 0, 'niciun plic propus']],
    genereaza: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['aprobat']) > 0, 'niciun plic aprobat']],
    etichete: [[esteOwner, 'doar owner-ul'], [cuAwb > 0, 'niciun AWB generat']],
    curier: [[cuAwb > 0, 'niciun AWB generat']],
    urmarire: [[esteOwner, 'doar owner-ul'], [cuAwb > 0, 'niciun AWB generat']],
    confirmari: [[esteOwner, 'doar owner-ul'], [cuAwb > 0, 'niciun AWB generat']],
  }
  const oprit = motivTransport({ transportActiv, proiectCod, fanLot })
  return PASI_FAN.map(p => {
    if (oprit) return { ...p, motiv: oprit, activ: false }
    if (!evidentaInstalata) return { ...p, activ: false, motiv: 'evidența FAN nu e instalată (migrarea neaplicată)' }
    const pica = conditii[p.cheie].find(([c]) => !c)
    return { ...p, activ: !pica, motiv: pica ? pica[1] : '' }
  })
}

/** Marcajul lotului (TEST / real): owner, înainte de PRIMA aprobare din istoricul lotului (Jakarinos #1118 r1 P2: red_fan_loturi.prima_aprobare_la,
 *  pusă de BD la prima aprobare și imuabilă — o re-propunere care readuce rândurile la „propus” nu redeschide marcajul). Separat de „Aprobă”. */
export function stareMarcaj({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, randuri = [], fanLot = null, proiectCod = null } = {}) {
  // marcajul se pune ÎNAINTE ca lotul să fie TEST → garda cere aici doar proiectul de TEST (cereMarcaj = false)
  const oprit = motivTransport({ transportActiv, proiectCod, fanLot, cereMarcaj: false })
  if (oprit) return { activ: false, motiv: oprit }
  if (!evidentaInstalata) return { activ: false, motiv: 'evidența FAN nu e instalată (migrarea neaplicată)' }
  if (!esteOwner) return { activ: false, motiv: 'doar owner-ul' }
  if (fanLot?.prima_aprobare_la) return { activ: false, motiv: 'lotul a fost aprobat o dată: marcajul TEST / real nu se mai schimbă' }
  if (numar(randuri, ['aprobat', 'in_curs', 'generat', 'necunoscut', 'ridicat']) > 0) return { activ: false, motiv: 'lotul are deja plicuri aprobate: marcajul nu se mai schimbă' }
  return { activ: true, motiv: '' }
}
/** „2b. Marchează real” (18.11.2026, Testul 1): cât garda „doar TEST” e pornită (DOAR_PROIECTE_TEST), un lot REAL nu poate face nimic (garda îl
 *  refuză pe orice pas), deci marcajul „real” nu are rost și poate încurca procedura (FAN_TEST1_PASI.md §3 pasul 4: singurul activ e „2a”).
 *  Aceleași condiții ca stareMarcaj, plus refuzul cât garda e pornită; cu DOAR_PROIECTE_TEST = false (Testul 2) = exact stareMarcaj (L20). */
export const MESAJ_MARCAJ_REAL_OPRIT = 'cât transportul e permis doar pe loturi de TEST (Testul 1), un lot nu se marchează real'
export function stareMarcajReal({ doarTest = DOAR_PROIECTE_TEST, ...rest } = {}) {
  const m = stareMarcaj(rest)
  if (!m.activ) return m
  return doarTest ? { activ: false, motiv: MESAJ_MARCAJ_REAL_OPRIT } : m
}

// ── oPOD pe lot (18.11.2026, după primul AWB real: 27,16 lei în loc de 13,16 — opțiunea B pleca mereu) ──
// Alegerea „confirmare de primire în original (oPOD)” e a owner-ului, pe lot (red_fan_loturi.opod, implicit false, migrarea 20261227a), prin RPC
// (fn_red_fan_lot_opod), DOAR după marcajul TEST / real și DOAR înainte de PRIMA aprobare (apoi imuabilă, ca marcajul: trigger în BD). Intră în
// corpul fiecărui plic (options) și în hash-ul aprobat → ce pleacă la generare e EXACT ce s-a văzut la aprobare.
export const TEXT_OPOD = `Confirmare de primire în original (oPOD, +${COST_OPOD_ESTIMAT_LEI} lei / plic)`
export const MESAJ_OPOD_NEINSTALAT = 'alegerea oPOD nu e instalată în evidența FAN (migrarea 20261227a neaplicată)'
export function stareOpod({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, randuri = [], fanLot = null, proiectCod = null } = {}) {
  // ca la marcaj (cereMarcaj = false): garda cere proiectul de TEST; lipsa marcajului e spusă mai jos, cu motivul ei
  const motivOprit = motivTransport({ transportActiv, proiectCod, fanLot, cereMarcaj: false })
  if (motivOprit) return { activ: false, motiv: motivOprit }
  if (!evidentaInstalata) return { activ: false, motiv: 'evidența FAN nu e instalată (migrarea neaplicată)' }
  if (!esteOwner) return { activ: false, motiv: 'doar owner-ul alege oPOD' }
  if (!fanLot) return { activ: false, motiv: 'alege întâi: lot de TEST sau lot real' }
  if (typeof fanLot.opod !== 'boolean') return { activ: false, motiv: MESAJ_OPOD_NEINSTALAT }
  if (fanLot.prima_aprobare_la) return { activ: false, motiv: 'lotul a fost aprobat o dată: alegerea oPOD nu se mai schimbă' }
  if (numar(randuri, ['aprobat', 'in_curs', 'generat', 'necunoscut', 'ridicat']) > 0) return { activ: false, motiv: 'lotul are deja plicuri aprobate: alegerea oPOD nu se mai schimbă' }
  return { activ: true, motiv: '' }
}
/** oPOD-ul lotului, DOAR din valoarea citită (true); lipsă / necunoscut = fără oPOD în corp (același criteriu ca configPlicFan, L19). */
export const opodLot = fanLot => fanLot?.opod === true
export const costOpodEstimat = n => (Number.isInteger(n) && n > 0 ? n * COST_OPOD_ESTIMAT_LEI : 0)
// Rândurile TRIMISE curierului (claim făcut; au sau au avut un AWB): oPOD-ul lor e cel al lotului la aprobare, nu corpul reconstruit acum.
export const STARI_TRIMISE_FAN = Object.freeze(['in_curs', 'generat', 'necunoscut', 'ridicat'])
export const TEXT_OPOD_RAND = 'oPOD'
export const TEXT_OPOD_LEGACY = 'oPOD (expediat înainte de alegerea pe lot: opțiunea B pleca mereu)'
/**
 * Ce se arată pe rândul unui plic despre oPOD (Jakarinos #1135 r1 P2: AWB-ul deja taxat cu oPOD trebuie identificat ca atare):
 *  - rând TRIMIS (STARI_TRIMISE_FAN): alegerea lotului e înghețată de prima aprobare și a fost exact cea din hash-ul trimis (funcția edge
 *    exclude orice rând al cărui hash nu e cel recalculat cu alegerea lotului) → `opod === true` = „oPOD”, `false` = nimic; `opod` null /
 *    lipsă (coloana neinstalată) pe un rând trimis = rând generat de codul de dinaintea migrării, care trimitea MEREU B → TEXT_OPOD_LEGACY
 *    (aceeași deducere ca backfill-ul migrării 20261227a: orice lot aprobat înainte de ea primește opod = true);
 *  - rând netrimis (sau fără rând): corpul reconstruit acum (cereOpod), adică ce s-ar propune / aproba.
 * Întoarce '' când nu e nimic de spus.
 */
export function textOpodRand({ fanLot = null, rand = null, shipment = null } = {}) {
  if (rand && STARI_TRIMISE_FAN.includes(rand.stare)) {
    if (fanLot?.opod === true) return TEXT_OPOD_RAND
    if (fanLot?.opod === false) return ''
    return TEXT_OPOD_LEGACY
  }
  return cereOpod(shipment) ? TEXT_OPOD_RAND : ''
}
/** Textul dialogului de aprobare: ce se aprobă (număr), dacă oPOD e cerut și costul estimat suplimentar — DIN CORPURILE propuse (cereOpod pe
 *  shipment), nu din rândul lotului: se arată exact ce intră în hash-urile aprobate. Corpuri amestecate (unele cu B, altele fără) = nu se aprobă. */
export function textAprobare({ n, shipments = [], titlu = '' }) {
  const cu = shipments.filter(cereOpod).length
  if (cu && cu !== shipments.length) return { ok: false, text: `Plicurile propuse nu au aceeași alegere oPOD (${cu} cu, ${shipments.length - cu} fără): propune din nou tot lotul.` }
  const opod = cu > 0 && cu === shipments.length
  return { ok: true, opod, text: `Aprobi ${n} AWB-uri FAN pentru ${titlu}? Fiecare AWB generat costă (tariful vine de la FAN). `
    + (opod ? `oPOD CERUT (confirmare de primire în original): cost estimat suplimentar ${formatLei(costOpodEstimat(n))} (${n} × ${COST_OPOD_ESTIMAT_LEI} lei), peste transport.`
      : 'FĂRĂ oPOD: confirmarea de primire e cea electronică, de pe terminalul curierului (fără cost suplimentar).') }
}

// ── ultimul eveniment de urmărire, cu ora României (18.11.2026: ecranul arăta doar „ridicat (C0)”, fără când) ──
const VERB_EVENIMENT = Object.freeze({ ridicat: 'ridicat de curier', livrat: 'livrat', avizat: 'avizat (destinatarul anunțat)', adresa: 'adresă greșită / incompletă',
  mutat: 'destinatar mutat', refuz: 'refuzat de destinatar', retur: 'retur', confirmare_refuzata: 'confirmare refuzată', neutru: 'contact cu destinatarul',
  tranzit: 'în tranzit', inregistrat: 'AWB înregistrat la curier', de_verificat: 'de verificat de om' })
/** Un moment (timestamptz ISO din PostgREST sau text „AAAA-LL-ZZ HH:MM:SS”) → „ZZ.LL.AAAA HH:MM” în Europe/Bucharest (L17); '' dacă nu e dată. */
export const oraBucuresti = v => ora(v)
/** „ridicat de curier (C0) 18.11.2026 17:21” — DOAR afișare: categoria din codul FAN (EVENIMENTE_FAN), momentul în ora României. '' fără eveniment. */
export function textUltimEveniment(r) {
  const cod = typeof r?.ultim_eveniment === 'string' && r.ultim_eveniment.trim() ? r.ultim_eveniment.trim() : ''
  if (!cod) return ''
  const verb = VERB_EVENIMENT[categorieEveniment(cod)] || 'eveniment'
  const cand = r.ultim_eveniment_la ? ora(r.ultim_eveniment_la) : ''
  return `${verb} (${cod})${cand ? ' ' + cand : ' (fără oră)'}`
}

// Operațiile din procedură care nu sunt pași ai fluxului (Jakarinos #1118 r1 P2: toate în ecran, dezactivate cât transportul e oprit).
export const OPERATII_FAN = Object.freeze([
  { cheie: 'reconciliere', titlu: 'Reconciliază', ajutor: 'doar owner-ul: borderoul zilei pentru rândurile „necunoscut” / „în curs”; propunerile le confirmă omul' },
  { cheie: 'plafon', titlu: 'Plafonul lotului pilot', ajutor: 'doar owner-ul: câte plicuri aprobate pe lot (1…2000)' },
  { cheie: 'anulare', titlu: 'Anulare AWB', ajutor: 'doar owner-ul: AWB generat, neridicat (ștergere la FAN sau marcare după verificarea în selfAWB)' },
  { cheie: 'evenimente', titlu: 'Lista de evenimente FAN', ajutor: 'doar owner-ul: compară codurile FAN cu cele folosite aici' },
  { cheie: 'tiraj', titlu: 'Tiraj nou', ajutor: 'doar owner-ul, în ordine: oprește descărcările tirajului început → așteaptă 30 s → distruge foile și fișierele lui → înlocuiește tirajul cu manifestul de acum (se retipărește TOT lotul)' },
  { cheie: 'solutionare', titlu: 'Soluționează o contradicție', ajutor: 'owner-ul sau un admin Redări: după verificarea în selfAWB, alegi pentru fiecare fapt contrazis valoarea care rămâne (cea cunoscută sau cea nouă), cu motiv; istoricul rămâne în jurnal' },
])
/** Operațiile cu starea lor: { ...operatie, activ, motiv } (aceleași reguli ca stariPasi: transportul oprit le dezactivează pe toate). */
export function stariOperatii({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, esteAdmin = false, randuri = [], fanLot = null, proiectCod = null } = {}) {
  const conditii = {
    // runda 5: soluționarea contradicțiilor urmăririi — owner SAU admin Redări (aceeași poartă ca fn_red_fan_urmarire_solutioneaza)
    solutionare: [[esteOwner || esteAdmin, 'doar owner-ul sau un admin Redări'], [(randuri || []).some(r => fapteContrazise(r).length > 0), 'nicio contradicție de soluționat']],
    reconciliere: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['necunoscut', 'in_curs']) > 0, 'niciun rând „necunoscut” sau „în curs”']],
    plafon: [[esteOwner, 'doar owner-ul']],
    anulare: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['generat']) > 0, 'niciun AWB generat neridicat']],
    evenimente: [[esteOwner, 'doar owner-ul']],
    tiraj: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['generat', 'ridicat']) > 0, 'niciun AWB generat']],
  }
  const oprit = motivTransport({ transportActiv, proiectCod, fanLot }) || (!evidentaInstalata ? 'evidența FAN nu e instalată (migrarea neaplicată)' : null)
  return OPERATII_FAN.map(p => {
    if (oprit) return { ...p, activ: false, motiv: oprit }
    const pica = conditii[p.cheie].find(([c]) => !c)
    return { ...p, activ: !pica, motiv: pica ? pica[1] : '' }
  })
}

/** Numele fișierului de etichete al unei părți (toate părțile au nume distincte, în ordinea pozițiilor). Runda 3: cu identificatorul tirajului.
 *  18.11.2026: FĂRĂ formatul în nume — „_A6” afirma un format pe care PDF-ul primit nu l-a avut (A4); formatul se verifică pe fișier. */
const cuTiraj = tiraj => (tiraj?.id ? `_tiraj-${tiraj.id}` : '')
export const numeEtichete = ({ lot, fanLot, parte, parti, tiraj = null }) => `${prefixLot(fanLot)}${lot?.nr_lot || ''}${cuTiraj(tiraj)}_etichete${parti > 1 ? `_partea${String(parte).padStart(2, '0')}din${String(parti).padStart(2, '0')}` : ''}.pdf`
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
  aruncaRefuzTiraj(error)
  if (error) throw error
  const tiraj = tirajDin(data, cheie)
  if (!tiraj) throw new Error('Tirajul nu s-a putut verifica (răspuns neconfirmat); nimic descărcat.')
  return { manifest, tiraj, ...controlLotFan({ lot, fanLot, manifest, plicuri, convocariPePlic, tiraj }) }
}
const aruncaRefuzTiraj = error => {
  if (refuzTiraj(error) === 'tiraj_schimbat') throw { code: COD_TIRAJ_SCHIMBAT, message: MESAJ_TIRAJ_SCHIMBAT }
  if (refuzTiraj(error) === 'tiraj_oprit') throw { code: COD_TIRAJ_OPRIT, message: MESAJ_TIRAJ_OPRIT }
}

/**
 * REVERIFICAREA FINALĂ a unei descărcări din ecran (runda 4, Jakarinos #1118 r3 P1): după ce arhiva / pagina de control e gata și ÎNAINTE de
 * salvare, tirajul trebuie să fie încă ACELAȘI (aceeași cheie, același nr.) și neoprit. Refuz (RD020 / RD021) sau răspuns neconfirmat = aruncă,
 * nimic salvat. Aceeași regulă ca reverificarea din funcția edge după PDF-ul FAN (tirajNeschimbat, L19).
 */
export async function confirmaTirajFinal({ rpc, lot, tiraj }) {
  const { data, error } = await rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: tiraj.cheie, p_inlocuieste: null })
  aruncaRefuzTiraj(error)
  if (error) throw error
  if (!tirajNeschimbat(data, tiraj)) throw new Error('Tirajul nu s-a putut reverifica (răspuns neconfirmat); nimic descărcat.')
  return true
}

/**
 * Starea opririi tirajului pentru ecran (owner): { oprit, opritLa, gataDeInlocuit, secundeRamase }. gataDeInlocuit = oprit de cel puțin
 * ASTEPTARE_DUPA_OPRIRE_S secunde (BD-ul verifică la fel, cu ora lui: ecranul doar afișează). acumMs = Date.now() (injectabil în teste).
 */
export function stareOprireTiraj(fanLot, acumMs = Date.now()) {
  const la = fanLot?.tiraj_oprit_la ? Date.parse(fanLot.tiraj_oprit_la) : NaN
  if (!fanLot?.tiraj_cheie || !Number.isFinite(la)) return { oprit: false, opritLa: null, gataDeInlocuit: false, secundeRamase: null }
  const ramase = Math.max(0, Math.ceil(ASTEPTARE_DUPA_OPRIRE_S - (acumMs - la) / 1000))
  return { oprit: true, opritLa: fanLot.tiraj_oprit_la, gataDeInlocuit: ramase === 0, secundeRamase: ramase }
}

/**
 * Faptele urmăririi unui rând FAN, pentru ecran (runda 4, Jakarinos #1118 r3 P2): ridicarea, livrarea, returul (+ motivul) cunoscute și
 * CONTRADICȚIILE (valoarea cunoscută ȘI cea nouă, ambele vizibile). Text gol = niciun fapt. Datele: ziua / ora României (L17).
 */
const zi = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : '')
const ora = v => { const ms = Date.parse(v); if (!Number.isFinite(ms)) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}` }
export function textFapteUrmarire(r, eticheteRetur = {}) {
  if (!r) return ''
  const motiv = m => eticheteRetur[m] || m
  const f = [], c = []
  if (r.ridicat_propus) f.push(`ridicat ${zi(r.ridicat_propus)}`)
  if (r.livrat_la) f.push(`livrat ${ora(r.livrat_la)}`)
  if (r.retur_cunoscut) f.push(`retur${r.retur_propus ? ` (${motiv(r.retur_propus)})` : ''}`)
  if (r.ridicat_contrazis) c.push(`ridicare ${zi(r.ridicat_propus)} (cunoscută) ≠ ${zi(r.ridicat_contrazis)} (FAN, mai nou)`)
  if (r.livrat_contrazis) c.push(`livrare ${ora(r.livrat_la)} (cunoscută) ≠ ${ora(r.livrat_contrazis)} (FAN, mai nou)`)
  if (r.retur_contrazis) c.push(`motiv de retur ${motiv(r.retur_propus)} (cunoscut) ≠ ${motiv(r.retur_contrazis)} (FAN, mai nou)`)
  if (r.livrat_la && r.retur_cunoscut) c.push('livrat ȘI retur')
  return [f.length ? `fapte: ${f.join(', ')}` : '', c.length ? `CONTRADICȚIE de verificat de om: ${c.join('; ')}` : ''].filter(Boolean).join(' · ')
}

export { fapteContrazise, ALEGERI_SOLUTIONARE }
/** Opțiunile din formularul de soluționare: pe fiecare fapt contrazis, AMBELE valori (cunoscută și nouă), cu textul afișat (ziua / ora României). */
export function optiuniSolutionare(r, eticheteRetur = {}) {
  const motiv = m => (m ? eticheteRetur[m] || m : 'fără motiv')
  return fapteContrazise(r).map(f => {
    if (f.cheie === 'ridicat') return { cheie: f.cheie, titlu: 'Ridicarea (C0)', optiuni: [{ valoare: 'cunoscut', text: `${zi(f.cunoscut)} (cunoscută)` }, { valoare: 'nou', text: `${zi(f.nou)} (FAN, mai nou)` }] }
    if (f.cheie === 'livrat') return { cheie: f.cheie, titlu: 'Livrarea', optiuni: [{ valoare: 'cunoscut', text: `${ora(f.cunoscut)} (cunoscută)` }, { valoare: 'nou', text: `${ora(f.nou)} (FAN, mai nou)` }] }
    if (f.cheie === 'retur') return { cheie: f.cheie, titlu: 'Motivul returului', optiuni: [{ valoare: 'cunoscut', text: `${motiv(f.cunoscut)} (cunoscut)` }, { valoare: 'nou', text: `${motiv(f.nou)} (FAN, mai nou)` }] }
    return { cheie: f.cheie, titlu: 'Livrat ȘI retur', optiuni: [{ valoare: 'livrat', text: `livrat ${ora(f.cunoscut)} (returul se scoate)` }, { valoare: 'retur', text: `retur (${motiv(f.nou)}) (livrarea se scoate)` }] }
  })
}
export const MESAJ_URMARIRE_SCHIMBATA = 'Între timp urmărirea s-a schimbat (a sosit un răspuns FAN nou sau altcineva a soluționat): nimic scris. Reîncarcă și verifică din nou.'
/**
 * Soluționarea unei contradicții (runda 5, Jakarinos #1118 r4 P2): verifică local că alegerile acoperă EXACT faptele contrazise ale rândului
 * citit (fapteContrazise, aceeași listă ca BD-ul), fiecare cu o valoare permisă, și că motivul are 1..500 de caractere — altfel nimic trimis;
 * apoi fn_red_fan_urmarire_solutioneaza cu VERSIUNEA citită (CAS). RD023 (răspuns FAN nou între timp) → MESAJ_URMARIRE_SCHIMBATA; orice altă
 * eroare se propagă (L18); rezultatul se acceptă doar cu versiunea + 1 și o stare (altfel „neconfirmat”).
 */
export async function solutioneazaUrmarire({ rpc, rand, alegeri, motiv }) {
  const cer = fapteContrazise(rand).map(f => f.cheie)
  const chei = Object.keys(alegeri || {})
  const m = typeof motiv === 'string' ? motiv.trim() : ''
  if (!cer.length) throw new Error('Rândul nu are nicio contradicție de soluționat.')
  if (!Number.isInteger(rand?.versiune_urmarire) || rand.versiune_urmarire < 0) throw new Error('Versiunea urmăririi lipsește: reîncarcă evidența.')
  if (chei.length !== cer.length || !cer.every(k => chei.includes(k)) || !cer.every(k => ALEGERI_SOLUTIONARE[k].includes(alegeri[k]))) {
    throw new Error(`Alege valoarea care rămâne pentru fiecare fapt contrazis (${cer.join(', ')}).`)
  }
  if (!m || m.length > 500) throw new Error('Motivul soluționării e obligatoriu (cel mult 500 de caractere).')
  const { data, error } = await rpc('fn_red_fan_urmarire_solutioneaza', { p_id: rand.id, p_versiune: rand.versiune_urmarire, p_alegeri: alegeri, p_motiv: m })
  if (error) { if (error.code === COD_URMARIRE_SCHIMBATA) { const e = new Error(MESAJ_URMARIRE_SCHIMBATA); e.code = error.code; throw e } throw error }
  if (!data || data.versiune !== rand.versiune_urmarire + 1 || typeof data.stare !== 'string') throw new Error('rezultat neconfirmat')
  return data
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
/** Eticheta urmăririi unui rând, după stare ȘI ultimul eveniment: „în tranzit” cu ultimul eveniment S98 („Registered AWB”) = AWB înregistrat la
 *  curier, plicul încă neridicat — nu e în drum (18.11.2026, clasificarea listei reale de evenimente). Restul: ETICHETE_URMARIRE. */
export function etichetaUrmarire(r) {
  if (!r?.urmarire_stare) return ''
  if (r.urmarire_stare === 'in_tranzit' && EVENIMENTE_FAN.inregistrat.includes(r.ultim_eveniment)) return 'AWB înregistrat la curier (plic neridicat încă)'
  return ETICHETE_URMARIRE[r.urmarire_stare] || r.urmarire_stare
}

// ── tariful (18.11.2026, după primul AWB real: tariful exista în rând, dar nu se vedea în ecran) ──
// red_fan_awb.tarif vine prin PostgREST ca text numeric („27.1600”); parserul e cel al funcției edge (sumaFan, L19). Gol = NECUNOSCUT, nu 0
// (L18): procedura (FAN_TEST1_PASI.md §7 pasul 5) cere oprire la tarif gol, de aceea ecranul îl evidențiază. Tariful FAN e fără TVA (răspunsul
// are `tariff` și `vat` separate); TVA-ul se afișează lângă, când există.
export const MESAJ_TARIF_NECUNOSCUT = 'tarif necunoscut'
const LEI = new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const formatLei = n => `${LEI.format(n)} lei`
/** Textul tarifului unui rând: „27,16 lei” sau MESAJ_TARIF_NECUNOSCUT (null / gol / formă necunoscută). */
export const textTarif = v => { const n = sumaFan(v); return n == null ? MESAJ_TARIF_NECUNOSCUT : formatLei(n) }
/** Totalul tarifelor pe lot, DOAR pe rândurile cu AWB plătit (generat / ridicat): { awb, cuTarif, necunoscute, total } — total = null dacă
 *  niciun rând nu are tarif; cu rânduri „necunoscute” totalul e INCOMPLET (necunoscut ≠ 0, L18) și textul o spune. */
export function totalTarifLot(randuri) {
  const platite = (randuri || []).filter(r => r && ['generat', 'ridicat'].includes(r.stare))
  let total = 0, cuTarif = 0
  for (const r of platite) { const n = sumaFan(r.tarif); if (n != null) { total += n; cuTarif++ } }
  return { awb: platite.length, cuTarif, necunoscute: platite.length - cuTarif, total: cuTarif ? Math.round(total * 100) / 100 : null }
}
export function textTotalTarif(randuri) {
  const t = totalTarifLot(randuri)
  if (!t.awb) return 'niciun AWB generat'
  if (!t.cuTarif) return `necunoscut: ${t.awb === 1 ? 'AWB-ul generat nu are tarif' : `niciunul din cele ${t.awb} AWB-uri nu are tarif`} (procedura cere oprire)`
  const baza = `${formatLei(t.total)} pentru ${t.cuTarif} ${t.cuTarif === 1 ? 'AWB' : 'AWB-uri'}`
  return t.necunoscute ? `${baza} · INCOMPLET: ${t.necunoscute} ${t.necunoscute === 1 ? 'AWB' : 'AWB-uri'} cu tarif necunoscut (procedura cere oprire)` : baza
}

/** Prefixul fișierelor unui lot de TEST (etichete, borderou, pachet de documente): un lot de test nu se confundă cu unul real. */
export const prefixLot = fanLot => (fanLot?.test === true ? 'TEST_' : '')
export const titluLot = (lot, fanLot) => `${fanLot?.test === true ? 'LOT DE TEST · ' : fanLot?.test === false ? 'Lot real · ' : ''}${lot?.nr_lot || ''}`

/** Borderoul FAN al lotului (CSV): numărul plicului, AWB-ul și stările — FĂRĂ nume / adrese / telefoane. Lotul de test: marcat pe primul rând. */
export function csvBorderouFan({ lot, fanLot, randuri }) {
  const celula = v => { const s = String(v ?? ''); return `"${(/^[\s]*[=+@-]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` }
  const cap = fanLot?.test === true ? [['LOT DE TEST: AWB-urile nu sunt expedieri ale convocărilor și nu intră în registru / PV / export']] : []
  // 18.11.2026: tariful (lei, fără TVA; gol = „tarif necunoscut”) intră în borderou — compararea cu factura curierului (doc §11)
  const linii = [...cap, [`Lot ${lot?.nr_lot || ''}`], ['Nr. plic', 'AWB', 'Tarif (lei, fără TVA)', 'Stare', 'Urmărire', 'Ultimul eveniment', 'Retur propus', 'Confirmare'],
    ...[...(randuri || [])].sort((a, b) => (a.nr_plic < b.nr_plic ? -1 : a.nr_plic > b.nr_plic ? 1 : 0)).map(r => [r.nr_plic, r.awb || '', r.awb ? textTarif(r.tarif) : '', ETICHETE_STARE_FAN[r.stare] || r.stare,
      etichetaUrmarire(r), r.ultim_eveniment || '', r.retur_propus || '', ETICHETE_CONFIRMARE[r.confirmare_stare] || r.confirmare_stare || ''])]
  return String.fromCharCode(0xFEFF) + linii.map(l => l.map(celula).join(';')).join('\r\n')
}

/** Mesajul pentru un răspuns al funcției edge (cod) — „transport oprit” e separat de erori (L18 / L20). */
export function mesajEdgeFan(rez) {
  const cod = rez?.data?.cod || rez?.error?.context?.cod || null
  if (cod === 'transport_real_oprit') return 'Transport oprit: funcția FAN nu face niciun apel până la activare.'
  if (cod === 'transport_real_doar_test') return `Transport permis doar pe proiecte de TEST cu lotul marcat TEST (Testul 1): funcția FAN nu a făcut niciun apel. ${rez?.data?.motiv || ''}`.trim()
  if (cod === 'non_owner') return 'Doar owner-ul poate porni pașii FAN.'
  if (cod === 'lot_nemarcat') return 'Lotul nu e marcat (TEST / real) în evidența FAN: nimic trimis.'
  if (cod === 'manifest_schimbat') return 'Evidența s-a schimbat de la afișare: reîncarcă și verifică din nou pagina de control. Nimic tipărit.'
  if (cod === 'tiraj_schimbat') return `${MESAJ_TIRAJ_SCHIMBAT} Nimic tipărit.`
  if (cod === 'tiraj_oprit') return MESAJ_TIRAJ_OPRIT
  if (cod === 'tiraj_neconfirmat') return 'Tirajul nu s-a putut verifica: nimic tipărit. Reîncarcă evidența și reîncearcă.'
  if (cod === 'stergere_neconfirmata') return `Ștergere neconfirmată: AWB-ul rămâne „generat”. ${rez?.data?.motiv || ''}`.trim()
  if (rez?.error) return 'Rezultat neconfirmat: reîncarcă evidența înainte de orice reluare (nu reapăsa orbește).'
  return cod === 'ok' ? 'Operație încheiată.' : `Răspuns: ${cod || 'necunoscut'}`
}
