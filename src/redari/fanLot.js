// fanLot.js — logica PURĂ a ecranului FAN pe un lot de plicuire (src/redari/ui/FanAwbPrevizualizare.jsx): pașii și când sunt activi,
// etichetele stărilor, borderoul CSV (fără date personale) și marcajul de TEST. Proiectare: docs/redari/FANCOURIER_INTEGRARE.md §3, §6.
// Cât timp TRANSPORT_REAL_ACTIV = false (redariFanHandler.mjs), TOȚI pașii sunt dezactivați vizibil, cu motivul „transport oprit”.
// Activarea pentru Testul 1 (DOAR_PROIECTE_TEST = true): pașii și operațiile sunt active DOAR pe un proiect „TEST-…” cu lotul marcat TEST —
// ACEEAȘI gardă (transportPermis) ca în funcția edge (L19); butonul de marcaj cere doar proiectul de TEST (lotul nu e încă marcat).
import { TRANSPORT_REAL_ACTIV, DOAR_PROIECTE_TEST, transportPermis, esteProiectTest, MESAJ_TRANSPORT_OPRIT, MESAJ_DOAR_PROIECT_TEST, MESAJ_DOAR_LOT_TEST } from '../../supabase/functions/_shared/redariFanHandler.mjs'
import { manifestTiparire, cheieTiraj, tirajDin, tirajNeschimbat, refuzTiraj, destinatarMascat, COD_TIRAJ_SCHIMBAT, COD_TIRAJ_OPRIT, MESAJ_TIRAJ_SCHIMBAT, MESAJ_TIRAJ_OPRIT,
  ASTEPTARE_DUPA_OPRIRE_S, fapteContrazise, ALEGERI_SOLUTIONARE, COD_URMARIRE_SCHIMBATA, sumaFan, EVENIMENTE_FAN, categorieEveniment, cereOpod,
  COST_OPOD_ESTIMAT_LEI, MOTIVE_ANULARE, CODURI_FAN, hashCerereFan } from '../../supabase/functions/_shared/redariFan.mjs'
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
  { cheie: 'urmarire', titlu: '6. Urmărire', ajutor: 'ridicarea (C0), livrarea și returul raportate de curier se înregistrează automat (pe loturile de TEST rândul trece singur în „ridicat”); contradicțiile se rezolvă după regulă și rămân în lista de audit' },
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

/** Poarta „operator numit sau owner” (F1, spec §7.1 / §7.3): aceeași ca în funcția edge (fn_red_fan_e_operator: owner-ul e inclus în BD; aici
 *  esteOperator vine din acel RPC, iar esteOwner din profil — L19: o singură definiție a cine e operator, în BD). */
export const MESAJ_DOAR_OPERATOR = 'doar operatorii numiți de owner sau owner-ul'
const operatorSauOwner = ({ esteOwner, esteOperator }) => esteOwner === true || esteOperator === true

// Runda 3 pe #1135 (Jakarinos r2 P2): cât coloana `opod` lipsește (migrarea 20261227a neaplicată, codul publicat înainte), ecranul NU propune, NU
// aprobă și NU generează — doar citirea și acțiunile care nu creează rezultate noi (marcaj, urmărire, confirmări, etichete, reconciliere, ștergere).
// Altfel o aprobare cu hash-uri „fără B” ar preceda deducerea istorică a migrării („aprobat înainte = oPOD”), iar lotul ar rămâne înghețat pe true.
// F1: aceeași regulă pe butonul unic „Trimite la curier” (stareTrimitere): el propune + aprobă + generează.
export const MESAJ_OPOD_NEINSTALAT_PASI = 'alegerea oPOD nu e instalată în evidența FAN (migrarea 20261227a neaplicată): până la aplicarea ei nu se propune, nu se aprobă și nu se generează nimic nou'
/** Pașii cu starea lor: { ...pas, activ, motiv }. transportActiv = flag-ul din cod; evidentaInstalata = tabelul red_fan_awb citibil;
 *  proiectCod = red_proiecte.cod al lotului (garda „doar TEST”: fără el, cu DOAR_PROIECTE_TEST, nimic nu e activ).
 *  gataDePropus = numărul plicurilor DE PROPUS (starePropunere.dePropus.length), motivPropunere = motivul când e 0 (starePropunere.motiv).
 *  opodInstalat = coloana red_fan_loturi.opod există (citesteLotFan.opodInstalat === true); orice altceva (lipsă, necunoscut) oprește propunerea,
 *  aprobarea și generarea cu MESAJ_OPOD_NEINSTALAT_PASI — fără valoare implicită „instalată” (L18: necunoscut ≠ instalat).
 *  F1: esteOperator (fn_red_fan_e_operator) deschide pașii pe care funcția edge îi permite operatorului (etichete, urmărire, confirmări); aprobarea și
 *  generarea detaliată rămân ale owner-ului. */
export function stariPasi({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, esteOperator = false, poateScrie = false, fanLot = null, randuri = [], gataDePropus = 0, motivPropunere = '', proiectCod = null, opodInstalat = null } = {}) {
  const cuAwb = numar(randuri, ['generat', 'ridicat'])
  const op = operatorSauOwner({ esteOwner, esteOperator })
  const cuOpod = [opodInstalat === true, MESAJ_OPOD_NEINSTALAT_PASI]
  const conditii = {
    propune: [[poateScrie, 'doar admin / editor'], cuOpod, [gataDePropus > 0, motivPropunere || 'niciun plic cu toate datele cerute de FAN']],
    aproba: [[esteOwner, 'doar owner-ul'], cuOpod, [!!fanLot, 'alege întâi: lot de TEST sau lot real'], [numar(randuri, ['propus']) > 0, 'niciun plic propus']],
    genereaza: [[esteOwner, 'doar owner-ul'], cuOpod, [numar(randuri, ['aprobat']) > 0, 'niciun plic aprobat']],
    etichete: [[op, MESAJ_DOAR_OPERATOR], [cuAwb > 0, 'niciun AWB generat']],
    curier: [[cuAwb > 0, 'niciun AWB generat']],
    urmarire: [[op, MESAJ_DOAR_OPERATOR], [cuAwb > 0, 'niciun AWB generat']],
    confirmari: [[op, MESAJ_DOAR_OPERATOR], [cuAwb > 0, 'niciun AWB generat']],
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
export function stariOperatii({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, esteOwner = false, esteOperator = false, esteAdmin = false, randuri = [], fanLot = null, proiectCod = null } = {}) {
  const op = operatorSauOwner({ esteOwner, esteOperator })
  const conditii = {
    // runda 5: soluționarea contradicțiilor urmăririi — owner SAU admin Redări (aceeași poartă ca fn_red_fan_urmarire_solutioneaza)
    solutionare: [[esteOwner || esteAdmin, 'doar owner-ul sau un admin Redări'], [(randuri || []).some(r => fapteContrazise(r).length > 0), 'nicio contradicție de soluționat']],
    // F1: reconcilierea (propunerile + „Confirmă: găsit”) și anularea (ștergerea la curier, în doi pași) sunt și ale operatorului; absența și
    // „marchează anulat” rămân owner (clasa C) și se verifică separat în ecran
    reconciliere: [[op, MESAJ_DOAR_OPERATOR], [numar(randuri, ['necunoscut', 'in_curs']) > 0, 'niciun rând „necunoscut” sau „în curs”']],
    plafon: [[esteOwner, 'doar owner-ul']],
    anulare: [[op, MESAJ_DOAR_OPERATOR], [numar(randuri, ['generat']) > 0, 'niciun AWB generat neridicat']],
    evenimente: [[op, MESAJ_DOAR_OPERATOR]],
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

// ── contradicțiile FAN, lista de AUDIT (runda 2 #1155, decizia owner-ului 21.11.2026): rezolvate automat după regula fan-contradictii-v1
// (REGULI_CONTRADICTII din redariFan.mjs = CHECK-ul din BD), păstrate în red_fan_contradictii; nu blochează rândul, se consultă la nevoie ──
export const COL_CONTRADICTII = 'id,fan_awb_id,awb,sursa,tip,valori,ales,regula,rulare_id,actor,observari,prima_la,ultima_la'
export const ETICHETE_CONTRADICTIE = Object.freeze({
  ridicare_zile: 'zile de ridicare (C0) diferite', livrare_ore: 'ore de livrare (S2) diferite', livrare_retur: 'livrare și retur',
  retur_motiv: 'motive de retur diferite', ridicare_data_imposibila: 'dată de ridicare imposibilă',
})
export const ETICHETE_REGULA = Object.freeze({
  prima_ridicare: 'rămâne prima zi de ridicare', ultima_livrare: 'rămâne ultima oră de livrare',
  final_ulterior: 'câștigă evenimentul final ulterior (la egalitate sau retur fără oră: retur)',
  ultimul_semnal: 'rămâne motivul cel mai nou (la aceeași oră: refuz, apoi adresă, mutat, avizat)',
  data_imposibila: 'ziua aceasta nu s-a înregistrat (înainte de generarea AWB-ului sau în viitor)',
})
/** Tabelul contradicțiilor lipsește (migrarea 20270102a neaplicată): PostgREST 42P01 / PGRST205 ≠ eroare de citire (L18). */
export const lipsaTabelContradictii = e => e?.code === '42P01' || e?.code === 'PGRST205'
/** Textul unei contradicții pentru ecran (fără date personale: AWB, coduri, date / ore ale curierului). */
export function textContradictie(c) {
  if (!c) return ''
  const valori = Array.isArray(c.valori) ? c.valori.map(String).join(' / ') : '?'
  const sursa = c.sursa === 'acelasi_raspuns' ? 'în același răspuns FAN' : 'față de faptul deja înregistrat'
  return `${ETICHETE_CONTRADICTIE[c.tip] || c.tip}: ${valori} → ales ${c.ales} (${ETICHETE_REGULA[c.regula] || c.regula}); ${sursa}`
    + `${Number.isInteger(c.observari) && c.observari > 1 ? `; văzută de ${c.observari} ori` : ''}`
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
  // F1 (spec §8.8): stările noi
  de_aprobat: 'așteaptă aprobarea proprietarului', retras: 'retras din trimitere',
})
export const ETICHETE_URMARIRE = Object.freeze({
  neurmarit: '-', fara_evenimente: 'fără evenimente', in_tranzit: 'în tranzit', ridicat: 'ridicat (C0)', livrat: 'livrat (S2)',
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
  // F1 (spec §8.5): poarta operatorului, refuzurile comenzii / tirajului din BD, anularea în doi pași
  if (cod === 'non_operator') return MESAJ_NON_OPERATOR
  if (cod === 'autorizare_neconfirmata') return 'Verificarea dreptului nu s-a putut face (răspuns neconfirmat): nimic trimis. Reîncearcă.'
  if (cod === 'comanda_refuzata') return mesajRefuzComanda(rez?.data?.cod_bd, rez?.data?.mesaj)
  if (cod === 'lot_neincheiat') return MESAJ_LOT_NEINCHEIAT
  if (cod === 'anulare_in_curs') return 'Anularea AWB-ului e deja în curs; așteaptă răspunsul curierului („Verifică la curier” dacă durează).'
  if (cod === 'stergere_refuzata') return 'Nu s-a anulat: curierul spune că AWB-ul a fost deja preluat; cererea de anulare a fost închisă (ridicarea vine la urmărire).'
  if (cod === 'doar_awb_generat_neridicat') return 'Se anulează doar un AWB generat și neridicat.'
  if (cod === 'nu_e_gasit_in_borderou') return 'AWB-ul nu e în borderoul curierului la reverificare: nimic confirmat. Verifică în contul curierului.'
  if (cod === 'transport_neconfigurat' || cod === 'autentificare_fan_neconfirmata') return MESAJ_LEGATURA_CURIER
  if (cod === 'manifest_schimbat') return 'Evidența s-a schimbat de la afișare: reîncarcă și verifică din nou pagina de control. Nimic tipărit.'
  if (cod === 'tiraj_schimbat') return `${MESAJ_TIRAJ_SCHIMBAT} Nimic tipărit.`
  if (cod === 'tiraj_oprit') return MESAJ_TIRAJ_OPRIT
  if (cod === 'tiraj_neconfirmat') return 'Tirajul nu s-a putut verifica: nimic tipărit. Reîncarcă evidența și reîncearcă.'
  if (cod === 'stergere_neconfirmata') return `Ștergere neconfirmată: AWB-ul rămâne „generat”. ${rez?.data?.motiv || ''}`.trim()
  if (rez?.error) return 'Rezultat neconfirmat: reîncarcă evidența înainte de orice reluare (nu reapăsa orbește).'
  return cod === 'ok' ? 'Operație încheiată.' : `Răspuns: ${cod || 'necunoscut'}`
}

// ═══ F1 — butonul unic „Trimite la curier” (spec docs/redari/FAN_FLUX_OPERATOR_SPEC.md §1, §7.2, §8.3, §8.5, §13 F1) ═══
export { MOTIVE_ANULARE, CODURI_FAN, hashCerereFan }
export const MESAJ_NON_OPERATOR = 'Doar operatorii numiți de proprietar pot trimite la curier.'
export const MESAJ_LOT_NEINCHEIAT = 'AWB-urile se tipăresc după ce se termină trimiterea lotului.'
export const MESAJ_LEGATURA_CURIER = 'Legătura cu curierul nu e configurată sau nu răspunde; nimic trimis. Anunță proprietarul.'
export const MESAJ_NECONFIRMAT = 'Răspunsul curierului nu s-a confirmat pentru %N plicuri. NU retrimite. Apasă „Verifică la curier” după 10 minute.'
export const MESAJ_DOAR_TEST_BD = 'Transportul e permis doar pe proiecte de TEST (Testul 1): nimic trimis.'
/** Arenda unei trimiteri (minute): cât timp o altă apăsare pe același lot e refuzată (RD030) — aceeași valoare ca în BD (fn_red_fan_comanda). */
export const ARENDA_INTENTIE_MIN = 10
export const ETICHETE_MOTIV_ANULARE = Object.freeze({
  netiparit_3_zile: 'AWB netipărit de 3 zile lucrătoare', neridicat_3_zile: 'tipărit, dar neridicat de 3 zile lucrătoare',
  plic_retras: 'plicul a fost retras', date_gresite: 'date greșite pe AWB', alt_motiv: 'alt motiv (cu notă)',
})
export const ETICHETE_MOTIV_RETRAGERE = Object.freeze({ plic_mutat: 'plicul nu mai e în lot', plic_anulat: 'plicul e anulat', lot_tiparit: 'lotul e tipărit', operator: 'retras de operator', owner: 'retras de owner' })
const oraRo = v => { const ms = Date.parse(v); if (!Number.isFinite(ms)) return ''
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return `${p.hour}:${p.minute}` }
const plicuriN = n => `${n} ${n === 1 ? 'plic' : 'plicuri'}`

/** Ziua de azi în ora României (yyyy-mm-dd), aceeași ca `zi_ro` din BD (L17). */
export const ziRo = (ms = Date.now()) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}` }
/**
 * Lista ecranului (§1): fiecare plic pregătit (pregatestePlicuriFan: { ok, plic, hash, probleme }) cu rândul FAN viu și dacă poate intra într-o trimitere:
 * gata (toate datele) ȘI fără rând cu AWB / în curs / de aprobat (un rând propus / aprobat sau niciun rând intră; eroare / anulat / retras nu sunt vii).
 * { ...pregatit, rand, trimisibil, motiv } — motivul e textul semnului galben („lipsește …” sau starea rândului).
 */
export function plicuriTrimisibile(pregatite, randuri) {
  const viu = new Map((randuri || []).filter(r => r && !['eroare', 'anulat', 'retras'].includes(r.stare)).map(r => [r.plic_id, r]))
  return (pregatite || []).filter(p => p?.plic?.id).map(p => {
    const f = viu.get(p.plic.id) || null, blocat = !!f && !['propus', 'aprobat'].includes(f.stare)
    return { ...p, rand: f, trimisibil: !!p.ok && !blocat, motiv: !p.ok ? (p.probleme || []).join('; ') || 'lipsesc date cerute de curier' : blocat ? ETICHETE_STARE_FAN[f.stare] || f.stare : '' }
  })
}
/** Runda 2 pe #1136: ce spune confirmarea „Trimite la curier” despre oPOD — alegerea lotului citită (aceeași din care funcția edge construiește corpul). */
export function textOpodTrimitere(fanLot, n) {
  return opodLot(fanLot) ? `Lotul cere oPOD (confirmare de primire în original): în plus față de transport, estimat ${formatLei(costOpodEstimat(n))} pentru ${n} plicuri.`
    : 'Fără oPOD: confirmarea de primire e cea electronică, de pe terminalul curierului.'
}
/** Textul plafonului zilei (§1): „azi mai poți trimite N …”; plafon = rândul din v_red_fan_plafon_azi; null = eroare de citire → mesaj, nu „0” (L18). */
export function textPlafonAzi(plafon) {
  if (!plafon || !Number.isInteger(plafon.limita_zi) || !Number.isInteger(plafon.incap)) return 'Plafonul zilei nu s-a putut citi: nu se știe cât mai încape azi fără aprobarea proprietarului.'
  if (plafon.limita_zi === 0) return `Plafonul zilei e 0: orice trimitere așteaptă aprobarea proprietarului (azi ${plafon.aprobate ?? 0} aprobate).`
  return `Azi mai poți trimite ${plicuriN(plafon.incap)} fără aprobarea proprietarului (plafon ${plafon.limita_zi}/zi; ${plafon.aprobate ?? 0} aprobate azi).`
}

/**
 * Starea butonului „Trimite la curier” (§1, §7.1): { activ, motiv, avertisment }. esteOperator = răspunsul lui fn_red_fan_e_operator (true / false /
 * null = neconfirmat → inactiv, L18); plafon = v_red_fan_plafon_azi (null = necitit: butonul rămâne activ, dar avertismentul spune că nu se știe
 * cât încape); intentieVie = intenția in_curs a lotului cu arenda în viitor (altă apăsare → RD030: nu mai trimitem). Avertismentul Q2 (decis A):
 * mai multe plicuri decât încap → TOATĂ trimiterea așteaptă aprobarea.
 */
export function stareTrimitere({ transportActiv = TRANSPORT_REAL_ACTIV, evidentaInstalata = false, opodInstalat = null, esteOperator = null, fanLot = null, proiectCod = null, selectate = 0, plafon = null, intentieVie = null, acumMs = Date.now() } = {}) {
  // marcajul îl pune comanda (automat), deci doar proiectul se verifică aici (cereMarcaj: false); BD-ul refuză lotul REAL (RD032)
  const oprit = motivTransport({ transportActiv, fanLot, proiectCod, cereMarcaj: false })
  if (oprit) return { activ: false, motiv: oprit, avertisment: '' }
  if (!evidentaInstalata) return { activ: false, motiv: 'evidența FAN nu e instalată (migrarea neaplicată)', avertisment: '' }
  // runda 2 pe #1136: butonul propune + aprobă + generează → aceeași regulă ca pașii detaliați (#1135 r3): fără coloana opod confirmată, nimic nou
  if (opodInstalat !== true) return { activ: false, motiv: MESAJ_OPOD_NEINSTALAT_PASI, avertisment: '' }
  if (esteOperator === null) return { activ: false, motiv: 'dreptul de operator nu s-a putut verifica (reîncarcă)', avertisment: '' }
  if (esteOperator !== true) return { activ: false, motiv: MESAJ_DOAR_OPERATOR, avertisment: '' }
  if (fanLot?.tiraj_cheie) return { activ: false, motiv: 'lotul e tipărit: plicurile noi merg într-un lot nou de plicuire', avertisment: '' }
  if (intentieVie && Date.parse(intentieVie.lucru_pana_la) > acumMs) return { activ: false, motiv: `o trimitere e în curs pe acest lot (alt tab sau încă rulează); așteaptă până la ${oraRo(intentieVie.lucru_pana_la)}`, avertisment: '' }
  if (!Number.isInteger(selectate) || selectate < 1) return { activ: false, motiv: 'alege cel puțin un plic gata', avertisment: '' }
  let avertisment = ''
  if (!plafon || !Number.isInteger(plafon.incap)) avertisment = 'Plafonul zilei nu s-a putut citi: dacă plicurile nu încap azi, TOATĂ trimiterea va aștepta aprobarea proprietarului.'
  else if (selectate > plafon.incap) avertisment = `Ai ales ${plicuriN(selectate)}, dar azi mai încap doar ${plafon.incap} fără aprobare: TOATĂ trimiterea va aștepta aprobarea proprietarului. Poți debifa ${selectate - plafon.incap} și trimite azi doar cât încape.`
  return { activ: true, motiv: '', avertisment }
}

// ── registrul local al intențiilor (§8.3, lecția „L05 în UI”): o intrare pe cheie, scrisă și VERIFICATĂ înainte de apel; iese doar la rezultat dovedit ──
export const PREFIX_REGISTRU_FAN = 'redari_fan_intentie:'
/** storage = localStorage (sau un obiect cu getItem / setItem / removeItem / key / length în teste). Fiecare metodă întoarce ce a reușit; nimic nu aruncă. */
export function registruIntentii(storage = globalThis.localStorage) {
  const k = cheie => PREFIX_REGISTRU_FAN + cheie
  const citeste = cheie => { try { const v = storage?.getItem(k(cheie)); if (!v) return null; const o = JSON.parse(v); return o && typeof o === 'object' ? { cheie, ...o } : null } catch { return null } }
  return {
    citeste,
    /** scrie + recitește: true doar dacă intrarea e în registru cu exact aceste date (storage plin / blocat = false → NU se trimite) */
    scrie(cheie, { lot_id, plic_ids, hash_cerere, inceput_la, apasat_la, terminat_la }) {
      if (!cheie || !lot_id || !Array.isArray(plic_ids) || !plic_ids.length || !hash_cerere) return false
      const acum = new Date().toISOString()
      const date = { lot_id, plic_ids: [...plic_ids], hash_cerere, inceput_la: inceput_la || acum, apasat_la: apasat_la || inceput_la || acum, ...(terminat_la ? { terminat_la } : {}) }
      try { storage.setItem(k(cheie), JSON.stringify(date)) } catch { return false }
      const r = citeste(cheie)
      return !!r && r.lot_id === lot_id && r.hash_cerere === hash_cerere && JSON.stringify(r.plic_ids) === JSON.stringify(date.plic_ids) && r.apasat_la === date.apasat_la
        && (r.terminat_la || null) === (date.terminat_la || null)
    },
    /** Runda 2 pe #1136: momentul ULTIMEI apăsări cu această cheie (prima trimitere sau „Reia”), scris și verificat ÎNAINTEA apelului (eșec = nu se
     *  trimite). Absența cheii din BD dovedește ceva doar după ARENDA_INTENTIE_MIN de la el (deciziaIntentiei): nicio cerere nu mai poate fi în zbor. */
    apasa(cheie, la = new Date().toISOString()) {
      const r = citeste(cheie)
      if (!r) return false
      return this.scrie(cheie, { lot_id: r.lot_id, plic_ids: r.plic_ids, hash_cerere: r.hash_cerere, inceput_la: r.inceput_la, apasat_la: la, terminat_la: r.terminat_la })
    },
    /** Runda 3 pe #1136 (Jakarinos r2 P1): momentul în care s-a ÎNCHEIAT ultimul apel cu cheia din acest browser (răspuns sau eroare), pe versiunea
     *  CURENTĂ a intrării (nu o recreează dacă a ieșit). O listă a cărei citire a pornit înaintea lui nu dovedește absența (apelul putea scrie după ea). */
    termina(cheie, la = new Date().toISOString()) {
      const r = citeste(cheie)
      if (!r) return false
      return this.scrie(cheie, { lot_id: r.lot_id, plic_ids: r.plic_ids, hash_cerere: r.hash_cerere, inceput_la: r.inceput_la, apasat_la: r.apasat_la, terminat_la: la })
    },
    sterge(cheie) { try { storage.removeItem(k(cheie)) } catch { /* nimic */ } return citeste(cheie) === null },
    toate() {
      const out = []
      try { for (let i = 0; i < (storage?.length ?? 0); i++) { const n = storage.key(i); if (n && n.startsWith(PREFIX_REGISTRU_FAN)) { const r = citeste(n.slice(PREFIX_REGISTRU_FAN.length)); if (r) out.push(r) } } } catch { /* nimic */ }
      return out.sort((a, b) => String(a.inceput_la).localeCompare(String(b.inceput_la)))
    },
    peLot(lotId) { return this.toate().filter(r => r.lot_id === lotId) },
  }
}
/** O trimitere din ACEST browser, pe același lot, pornită de mai puțin de ARENDA_INTENTIE_MIN minute (încă în registru) → a doua apăsare cu cheie nouă e refuzată local. */
export function intentieLocalaBlocanta(intrari, lotId, acumMs = Date.now()) {
  return (intrari || []).find(r => r.lot_id === lotId && Number.isFinite(Date.parse(r.inceput_la)) && acumMs - Date.parse(r.inceput_la) < ARENDA_INTENTIE_MIN * 60000) || null
}
/**
 * Rezultatul DOVEDIT (intrarea iese din registru) — §8.3: `ok` cu `incheiata: true` (și cea încheiată de RPC); refuz determinist al BD care NU a scris
 * cheia (`RD034` închisă, `RD036` / `RD037` / `22023` / `P0001` / `P0002` / `23505` refuzate în faza V, nimic scris); cerere invalidă (400); garda „doar TEST”
 * ÎNAINTEA comenzii (fără `mod` în răspuns). NU dovedesc nimic: `ok` cu `incheiata: false`, `RD030` (altcineva lucrează pe cheie), `RD033`, 403 (dreptul
 * e verificat înaintea cheii), 503 / timeout / lipsa răspunsului — intrarea rămâne și se lămurește din BD (v_red_fan_intentii) la redeschidere.
 */
export function rezultatDovedit(corp) {
  const cod = corp?.cod
  if (cod === 'ok') return corp.incheiata === true
  if (cod === 'comanda_refuzata') return ['RD034', 'RD036', 'RD037', 'RD038', '22023', 'P0001', 'P0002', '23505'].includes(corp.cod_bd)
  if (cod === 'cerere_invalida') return true
  if (cod === 'transport_real_doar_test') return corp.mod === undefined
  return false
}
/**
 * Ce face ecranul cu o intenție din registru față de starea ei din BD (v_red_fan_intentii). dinBd: undefined = necitit; null = cheia NU apare în
 * citire; altfel rândul. cititLaMs = momentul în care a PORNIT citirea (Jakarinos #1136 r1 P1: o listă citită înaintea unei apăsări nu dovedește
 * nimic despre cheia ei). 'sterge' DOAR la o stare terminală (încheiată / închisă — stări care nu se mai schimbă) sau la absența văzută de o
 * citire pornită după ARENDA_INTENTIE_MIN de la ultima apăsare (apasat_la; nicio cerere cu cheia nu mai poate fi în zbor); 'reia' (absentă încă,
 * sau in_curs cu arenda expirată: retrimiterea cu ACEEAȘI cheie e idempotentă), 'verifica' (rânduri nelămurite), 'asteapta' (arenda în viitor),
 * 'necitit'.
 */
export function deciziaIntentiei(intrare, dinBd, acumMs = Date.now(), cititLaMs = null) {
  if (dinBd === undefined) return 'necitit'
  if (dinBd === null) {
    const apasat = Date.parse(intrare?.apasat_la || intrare?.inceput_la)
    // runda 3 (Jakarinos #1136 r2 P1): și după sfârșitul ultimului apel cu cheia (terminat_la), dacă e cunoscut — un apel ținut peste arendă poate scrie
    const terminat = intrare?.terminat_la ? Date.parse(intrare.terminat_la) : -Infinity
    return Number.isFinite(cititLaMs) && Number.isFinite(apasat) && cititLaMs >= apasat + ARENDA_INTENTIE_MIN * 60000 && cititLaMs >= terminat ? 'sterge' : 'reia'   // terminat_la stricat (NaN) = nimic dovedit
  }
  if (dinBd.stare === 'incheiata' || dinBd.stare === 'neincheiata') return 'sterge'
  if (Number(dinBd.necunoscute) > 0) return 'verifica'
  return Date.parse(dinBd.lucru_pana_la) > acumMs ? 'asteapta' : 'reia'
}
/**
 * După un apel `trimite` (Jakarinos #1136 r1 P1): intrarea iese din registru DOAR pe dovada din BD, citită pe cheia EXACTĂ, cu citirea pornită DUPĂ
 * răspuns (cititLaMs). dinBd = rândul / null (cheia absentă) / undefined (citirea a picat). Stare terminală în BD = 'sterge'; cheie absentă = 'sterge'
 * doar dacă răspunsul funcției edge e un rezultat dovedit (rezultatDovedit: refuz determinist înaintea oricărei scrieri / nimic de trimis) — un 503,
 * un timeout sau lipsa răspunsului NU dovedesc absența (cererea poate fi încă în zbor): 'pastreaza', iar regula arendei o lămurește mai târziu.
 */
export function decizieDupaApel({ intrare, corp, dinBd, cititLaMs, acumMs = Date.now() }) {
  if (dinBd === undefined) return 'pastreaza'
  if (dinBd === null) return rezultatDovedit(corp) || deciziaIntentiei(intrare, null, acumMs, cititLaMs) === 'sterge' ? 'sterge' : 'pastreaza'
  return deciziaIntentiei(intrare, dinBd, acumMs, cititLaMs) === 'sterge' ? 'sterge' : 'pastreaza'
}
/** Runda 3 pe #1136 (Jakarinos r2 P1): cheile cu un apel `trimite` în curs DIN ACEST BROWSER (puse înaintea scrierii în registru, scoase după
 *  decizia de după răspuns). La nivel de modul, nu de componentă: o remontare a ecranului (lot schimbat și înapoi) nu le uită. */
export const APELURI_FAN_IN_CURS = new Set()
/**
 * Curățarea registrului din efectul de lămurire (lista `intentii`). Decizia se ia pe versiunea CURENTĂ a intrării, recitită din registru chiar acum
 * (după un „Reia” sau o apăsare în alt tab, apasat_la e nou; copia memorată de ecran e veche), și niciodată pe o cheie cu apel în curs (inCurs).
 * dinBd = rândul cheii din listă / null (absentă) / undefined (lista necitită). true = intrarea a ieșit.
 */
export function stergeDacaLamurita(reg, cheie, dinBd, acumMs, cititLaMs, inCurs) {
  if (inCurs?.has(cheie)) return false
  const curenta = reg.citeste(cheie)
  if (!curenta || deciziaIntentiei(curenta, dinBd, acumMs, cititLaMs) !== 'sterge') return false
  return reg.sterge(cheie)
}

// ── mesajul unic (§8.5): o singură definiție; motivul în BD rămâne codul ──
const TEXT_RESPINS = Object.freeze({ phone: 'telefonul lipsește sau e greșit', adresa: 'adresa nu e recunoscută de curier (județ / localitate / stradă)', name: 'curierul a respins expedierea; detalii în contul curierului', necunoscut: 'curierul a respins expedierea; detalii în contul curierului' })
export const textRespins = x => `${x?.nr_plic || 'PL-?'} — ${TEXT_RESPINS[x?.motiv_cod] || TEXT_RESPINS.necunoscut}`
const TEXT_EXCLUS = Object.freeze({
  lot_tiparit: 'lotul e deja tipărit; plicul nu mai intră în el (mută-l într-un lot nou de plicuire)', in_asteptare_aprobare: 'așteaptă decizia proprietarului',
  date_schimbate: 'datele s-au schimbat după aprobare; nu a intrat în reluare („Trimite” din nou)', date_incomplete: 'lipsesc date cerute de curier (fișa deținătorului)',
  plic_necitibil: 'plicul nu s-a putut citi', plic_anulat: 'plicul e anulat', plic_mutat: 'plicul nu mai e în lot', plic_expediat: 'plicul are deja expediere',
  deja_awb: 'are deja AWB',
})
export const textExclus = x => `${x?.nr_plic || x?.plic_id || 'PL-?'} — ${TEXT_EXCLUS[x?.motiv_cod] || `exclus (${x?.motiv_cod || '?'})`}${Array.isArray(x?.detalii) && x.detalii.length ? `: ${x.detalii.join('; ')}` : ''}`
export const textRetras = x => `${x?.nr_plic || 'PL-?'} — scos din trimitere: ${ETICHETE_MOTIV_RETRAGERE[x?.motiv_cod] || x?.motiv_cod || '?'}`
/** Refuzul comenzii / tirajului din BD (cod SQLSTATE) → mesajul operatorului (§8.5). mesajBd = textul BD (doar ora din RD030 / numărul din RD033 se refolosesc). */
export function mesajRefuzComanda(codBd, mesajBd = '') {
  const ora = String(mesajBd || '').match(/\b(\d{2}:\d{2})\b/)?.[1]
  const n = String(mesajBd || '').match(/(\d+) plicuri/)?.[1]
  switch (codBd) {
    case 'RD030': return `Trimiterea e în curs (alt tab sau încă rulează); așteaptă${ora ? ` până la ${ora}` : ' câteva minute'}.`
    case 'RD031': return MESAJ_LOT_NEINCHEIAT
    case 'RD032': return MESAJ_DOAR_TEST_BD
    case 'RD033': return `${n ? `${n} plicuri au` : 'Plicurile au'} rezultatul neconfirmat; întâi „Verifică la curier”.`
    case 'RD034': return 'Trimiterea anterioară a fost închisă; apasă din nou „Trimite la curier”.'
    case 'RD035': return 'Anularea AWB-ului e deja în curs; așteaptă răspunsul curierului.'
    case 'RD036': return 'Lotul e deja tipărit; plicurile noi merg într-un lot nou de plicuire.'
    case 'RD037': return 'Lotul are deja plicuri în așteptarea aprobării proprietarului; așteaptă decizia, retrage cererea sau alege mai puține plicuri.'
    case 'RD038': return 'Alegerea oPOD a lotului (confirmarea de primire în original) s-a schimbat între timp: nimic trimis. Reîncarcă și apasă din nou.'
    case '22023': return 'Cererea nu se potrivește cu trimiterea anterioară (altă cheie / alt operator): reîncarcă și apasă din nou „Trimite la curier”.'
    case 'P0001': return `Refuzat de regulile evidenței: ${mesajBd || 'verifică plafonul lotului și datele'}. Nimic trimis.`
    default: return `Comanda a fost refuzată (${codBd || '?'}): nimic trimis. ${mesajBd || ''}`.trim()
  }
}
/**
 * Mesajul UNIC după „Trimite la curier” (§8.5), din răspunsul funcției edge (corp = body-ul; `cod` + câmpurile din `trimite`). Numerele vin din
 * rândurile recitite de funcția edge (nu din memo); listele (respinse / excluse / retrase) se înșiră sub mesaj. Un răspuns lipsă = neconfirmat.
 */
export function mesajTrimitere(corp) {
  if (!corp || typeof corp !== 'object') return 'Rezultat neconfirmat: reîncarcă evidența; dacă trimiterea apare neîncheiată, „Reia trimiterea”.'
  if (corp.cod !== 'ok') {
    if (corp.cod === 'comanda_refuzata') return mesajRefuzComanda(corp.cod_bd, corp.mesaj)
    if (corp.cod === 'transport_real_doar_test') return MESAJ_DOAR_TEST_BD
    if (corp.cod === 'non_operator') return MESAJ_NON_OPERATOR
    if (corp.cod === 'cerere_invalida') return 'Cererea e invalidă (plicuri sau cheie): reîncarcă ecranul și alege din nou plicurile.'
    if (corp.cod === 'transport_neconfigurat' || corp.cod === 'autentificare_fan_neconfirmata') return MESAJ_LEGATURA_CURIER
    if (corp.cod === 'transport_real_oprit') return 'Transport oprit: funcția FAN nu face niciun apel până la activare.'
    // runda 2 pe #1136: niciun plic valid acum, dar cheia are deja o trimitere neîncheiată în evidență (încercarea anterioară)
    if (corp.cod === 'intentie_neincheiata') return Number(corp.necunoscute) > 0
      ? `Plicurile alese nu mai sunt valide, iar trimiterea anterioară are ${plicuriN(Number(corp.necunoscute))} cu rezultatul neconfirmat: NU retrimite; „Verifică la curier” după 10 minute.`
      : 'Plicurile alese nu mai sunt valide, iar trimiterea anterioară cu aceeași apăsare e încă neîncheiată în evidență: reîncarcă; „Reia trimiterea” o încheie.'
    return `Rezultat neconfirmat (${corp.cod}): reîncarcă evidența; dacă trimiterea apare neîncheiată, „Reia trimiterea”. Nu reapăsa orbește.`
  }
  const linii = []
  const generate = Number(corp.generate) || 0, deAprobat = Number(corp.de_aprobat) || 0, necunoscute = Number(corp.necunoscute) || 0, ramase = Number(corp.ramase) || 0
  const respinse = Array.isArray(corp.respinse) ? corp.respinse : [], excluse = Array.isArray(corp.excluse) ? corp.excluse : [], retrase = Array.isArray(corp.retrase) ? corp.retrase : []
  if (corp.replay) linii.push(`Rezultat deja înregistrat${corp.incheiata_la ? ` la ${oraRo(corp.incheiata_la)}` : ''} (aceeași apăsare): nimic retrimis.`)
  else if (corp.mod === 'reluare') linii.push(`Trimiterea întreruptă a fost reluată.`)
  if (!corp.incheiata) {
    linii.push(MESAJ_NECONFIRMAT.replace('%N', String(necunoscute || ramase || '?')))
  } else if (deAprobat > 0 && generate === 0) {
    const inc = corp.azi && Number.isInteger(corp.azi.incapeau) ? ` (azi mai încăpeau ${corp.azi.incapeau})` : ''
    linii.push(`Toate cele ${plicuriN(deAprobat)} așteaptă aprobarea proprietarului${inc}. După aprobare, apasă din nou „Trimite la curier”.`)
  } else if (generate > 0) {
    const tarif = sumaFan(corp.tarif_total)
    linii.push(`${generate} ${generate === 1 ? 'AWB generat' : 'AWB-uri generate'}${respinse.length ? `, ${respinse.length} ${respinse.length === 1 ? 'respins' : 'respinse'}` : ''}.${tarif != null ? ` Tarif: ${formatLei(tarif)} fără TVA.` : ' Tarif: necunoscut.'}`)
    // foile: „descărcate” DOAR cu PDF-urile în răspuns și fără eroare la etichete (tirajul poate fi început și când PDF-ul a picat după el — L18)
    if (corp.etichete_eroare === 'lot_neincheiat') linii.push(MESAJ_LOT_NEINCHEIAT)
    else if (corp.etichete_eroare) linii.push('AWB-urile există; foile AWB nu s-au putut descărca acum: „Descarcă AWB-urile” mai târziu.')
    else if (corp.tiraj?.id && Array.isArray(corp.pdf_parti) && corp.pdf_parti.length) linii.push(`Foile AWB au fost descărcate (tirajul ${corp.tiraj.id}${Number(corp.parti) > 1 ? `, ${corp.parti} fișiere` : ''}): pune fiecare AWB în buzunarul plicului, după pagina de control.`)
  } else if (corp.nimic_de_trimis || corp.mod === 'nimic') {
    linii.push('Nimic de trimis: plicurile alese au deja AWB sau sunt excluse (motivele mai jos).')
  } else if (respinse.length) {
    linii.push(`Niciun AWB generat: ${respinse.length} ${respinse.length === 1 ? 'plic respins' : 'plicuri respinse'} de curier.`)
  } else linii.push('Trimiterea s-a încheiat fără AWB-uri noi.')
  if (corp.oprit === '429') linii.push(`Curierul a cerut o pauză; restul (${plicuriN(ramase)}) se trimite mai târziu: apasă din nou „Trimite la curier” peste câteva minute.`)
  else if (corp.oprit === 'limita_solicitari') linii.push(`S-au trimis ${generate}; mai sunt ${ramase}: apasă din nou „Trimite la curier”.`)
  else if (corp.oprit === 'rezervare_refuzata') linii.push('Datele unui plic s-au schimbat între timp; nimic trimis pentru acea bucată. Apasă din nou „Trimite la curier”.')
  else if (corp.oprit === 'scriere_neconfirmata') linii.push('Răspunsul curierului nu s-a putut înscrie: NU retrimite; „Verifică la curier” după 10 minute.')
  for (const r of respinse) linii.push(textRespins(r))
  for (const x of excluse) linii.push(textExclus(x))
  for (const x of retrase) linii.push(textRetras(x))
  if (respinse.length) linii.push('Plicurile respinse: corectează datele în fișa deținătorului, mută-le într-un lot nou de plicuire și trimite lotul nou.')
  return linii.join('\n')
}
