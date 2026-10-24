import { normalizeazaSudura, formatSudura, tronsonNr } from './izoNormalizare.js'
import { uuid } from './izoCoada.js'

export function ziBucuresti(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export const toateOperatiile = s => [...(s?.arhiva || []), ...(s?.ops || [])].sort((a, b) => a.cerere.seq - b.cerere.seq)
export const reusita = o => !o.abandonata && !o.de_verificat && !['conflict', 'blocata'].includes(o.rezultat?.stare)
  && (o.rezultat ? o.rezultat.cod === 'acceptat' : o.stare !== 'confirmata')

export function sesiuneLocala(s, tronson) {
  const log = toateOperatiile(s).filter(o => o.cerere.payload.tronson_id === tronson && reusita(o))
  const open = log.filter(o => o.cerere.tip_op === 'sesiune_deschide').at(-1)
  const server = s?.snapshots?.[tronson]?.sesiuni?.find(x => x.stare === 'deschisa')
  if (!open && !server) return null
  if (server && (!open || server.uid !== open.cerere.payload.uid)) {
    const submit = log.find(o => o.cerere.tip_op === 'sesiune_trimite' && o.cerere.payload.preverificare_uid === server.uid)
    return { ...server, trimisa: Boolean(submit), confirmata: submit?.stare === 'confirmata' && submit.rezultat?.cod === 'acceptat' }
  }
  const snap = s?.snapshots?.[tronson]
  if (!server && Array.isArray(snap?.sesiuni) && open?.stare === 'confirmata' && (!open.confirmata_la || snap.salvat_la >= open.confirmata_la)) {
    // Un instantaneu ulterior ACK-ului dovedește că sesiunea nu mai e deschisă
    // (trimitere sau închidere MP); istoricul local nu o redeschide.
    return { uid: open.cerere.payload.uid, id: open.rezultat?.sesiune_id, zi: open.cerere.payload.zi, trimisa: true, confirmata: true }
  }
  const submit = log.find(o => o.cerere.tip_op === 'sesiune_trimite' && o.cerere.payload.preverificare_uid === open.cerere.payload.uid)
  return { uid: open.cerere.payload.uid, id: open.rezultat?.sesiune_id, zi: open.cerere.payload.zi, trimisa: Boolean(submit), confirmata: submit?.stare === 'confirmata' && submit.rezultat?.cod === 'acceptat' }
}

export function randuriSesiune(s, sesiune, snapshot) {
  if ((snapshot?.declaratii || []).some(d => d.preverificare_id === sesiune.id && (['conflict', 'blocata', 'revizie_ceruta'].includes(d.stare) || d.rezervare_pierduta))) throw Error('Instantaneul conține declarații de reverificat')
  const map = new Map((snapshot?.declaratii || []).filter(d => d.preverificare_id === sesiune.id && d.stare === 'ciorna').map(d => [d.uid, { uid: d.uid, versiune: d.versiune }]))
  const latest = new Map()
  for (const o of toateOperatiile(s)) {
    const p = o.cerere.payload
    if (p.preverificare_uid !== sesiune.uid || o.abandonata) continue
    if (p.uid) latest.set(p.uid, o)
    else if (!reusita(o)) throw Error('Există operații de verificat în sesiune')
  }
  for (const o of latest.values()) {
    const p = o.cerere.payload
    const d = snapshot?.declaratii?.find(d => d.uid === p.uid)
    if (d && o.stare === 'confirmata' && d.versiune > (o.rezultat?.versiune || p.versiune_baza)) continue
    if (!reusita(o) || o.de_verificat || o.rezultat?.cod === 'blocat_de_conflict') throw Error('Există operații de verificat în sesiune')
    if (o.cerere.tip_op === 'decl_salveaza') map.set(p.uid, { uid: p.uid, versiune: o.rezultat?.versiune || p.versiune_baza + 1 })
    if (o.cerere.tip_op === 'decl_sterge') map.delete(p.uid)
  }
  return [...map.values()]
}

export function mesajConflict(o) {
  const r = o.rezultat || o
  if (r.cod === 'alt_dispozitiv') return 'Frontul este preluat pe altă tabletă. MP-ul trebuie să îl elibereze; apoi apasă Pregătește și reîncearcă.'
  if (r.cod === 'blocat_de_conflict' || r.stare === 'blocata') return 'Dependența este în conflict sau revizie. Repară mai întâi declarația părinte, actualizează, apoi reîncearcă.'
  if (r.rezervare_pierduta || r.motiv === 'rezervare_pierduta') return 'Rezervarea s-a pierdut. Actualizează și alege altă bucată sau încearcă o versiune nouă dacă piesa este disponibilă.'
  if (r.conflict_cod === 'r1d') return 'Serie, șarjă și lungime identice cu altă piesă. Remăsoară și corectează lungimile.'
  if (r.conflict_cod === 'corectie_in_arbore') return 'Corecția afectează o piesă deja tăiată. MP-ul trebuie să verifice arborele.'
  return 'Operația nu este confirmată ca reușită. Actualizează declarația; corectează pe versiunea curentă sau renunță doar la operația locală refuzată.'
}

export const poateCorecta = d => ['ciorna', 'conflict', 'blocata', 'revizie_ceruta'].includes(d.stare)

export function declaratieNecunoscuta(baza, serie, mm, confirmata, id = uuid) {
  const n = Number(mm)
  if (!serie.trim() || !Number.isInteger(n) || n <= 0 || n > 30000 || !confirmata) throw Error('Completează seria citită și confirmă separat lungimea măsurată (1–30000 mm)')
  return { tip_op: 'decl_salveaza', payload: { ...baza, uid: id(), versiune_baza: 0, tip: 'montaj', serie_bruta: serie.trim(), lungime_masurata_mm: n, lungime_montata_mm: n, confirmare: { mod: 'masurat', masurata_mm: n }, amonte: { tip: 'inceput_lant' }, capat_amonte: 'A' } }
}

// Se păstrează identitatea declarației și a copiilor; numai serverul rezolvă seria.
export function corecteazaDeclaratie(d, { mm, puncte, bucata, confirmata, capat1, capat2 }, snapshot) {
  if (!poateCorecta(d) || !confirmata) throw Error('Este necesară revizia MP sau confirmarea separată a măsurătorii')
  const p = structuredClone(d.payload)
  p.uid = d.uid; p.versiune_baza = d.versiune
  delete p.gps
  if (d.tip === 'cuplare' && (capat1 || capat2)) {
    for (const [key, ref] of [['capat1', capat1], ['capat2', capat2]]) {
      if (!ref) continue
      if (!/^[A-Z]$/.test(ref.capat) || !snapshot.frunze?.some(b => b.id === Number(ref.bucata_id) && b.tronson_id === d.tronson_id && ['montata', 'pe_tronson'].includes(b.stare))) throw Error('Capăt de cuplare indisponibil')
      p[key] = { bucata_id: Number(ref.bucata_id), capat: ref.capat }
    }
    if (p.capat1.bucata_id && p.capat1.bucata_id === p.capat2.bucata_id) throw Error('Alege două piese diferite')
    if (!p.capat1.decl_uid && !p.capat2.decl_uid) { delete p.depinde_de_uid; delete p.depinde_de_versiune }
  }
  if (bucata) {
    if (d.identificare === 'nerezolvata') throw Error('Doar MP-ul poate lămuri seria')
    const b = snapshot.frunze?.find(b => String(b.id) === String(bucata) && b.disponibila)
    if (!b || d.tip === 'cuplare') throw Error('Bucată indisponibilă')
    p[d.tip === 'taiere' ? 'sursa' : 'bucata'] = { bucata_id: b.id }
    delete p.depinde_de_uid; delete p.depinde_de_versiune
  }
  if (d.tip !== 'cuplare') {
    const n = Number(mm)
    if (!Number.isInteger(n) || n <= 0 || n > (snapshot.praguri?.lungime_max_mm || 30000)) throw Error('Lungime invalidă în mm')
    p.confirmare = { mod: 'marcaj_diferit', masurata_mm: n }
    p.lungime_masurata_mm = n
    if (d.tip === 'montaj') p.lungime_montata_mm = n
    else {
      const points = String(puncte).split(',').map(x => Number(x.trim()))
      if (points.length !== p.copii.length - 1 || points.some((x, i) => !Number.isInteger(x) || x <= (points[i - 1] || 0) || x >= n)) throw Error('Puncte de tăiere invalide; păstrează numărul copiilor')
      p.baza_mm = n; p.puncte_mm = points
      p.copii = p.copii.map((c, i) => ({ ...c, lungime_mm: (points[i] ?? n) - (points[i - 1] || 0) }))
    }
  }
  return { tip_op: 'decl_salveaza', payload: p }
}

export function codSudura(raw, tronson, snapshot) {
  const r = normalizeazaSudura(raw, { tronson, mod: 'strict', conventie: snapshot?.praguri?.conventie_sufixe || [] })
  if (r.stare !== 'ok' || r.altTronson) throw Error('Cod sudură neconfirmat sau pe alt tronson')
  return { nr: r.nr, sufix: r.sufix }
}

export function propunereSudura(s, snapshot, tronson) {
  let nr = snapshot?.numar_urmator
  if (!Number.isInteger(nr) || nr < 1) return ''
  const descend = snapshot.config?.sens_numerotare === 'descrescator'
  for (const o of toateOperatiile(s)) {
    const p = o.cerere.payload
    if (p.tronson_id !== snapshot.tronson_id || !p.sudura || !reusita(o)) continue
    nr = descend ? Math.min(nr, p.sudura.nr - 1) : Math.max(nr, p.sudura.nr + 1)
  }
  return nr < 1 ? '' : formatSudura({ tronson: tronsonNr(tronson), nr })
}

// Regula R1d include surorile și frunzele declarate ale aceleiași rădăcini.
export function verificaIdentitate(snapshot, sursa, lungimi, localCopii = []) {
  const cm = n => Math.round(n / 10)
  if (new Set(lungimi.map(cm)).size !== lungimi.length) throw Error('Copii identici la centimetru: remăsoară')
  const frunze = [...(snapshot?.frunze || []), ...localCopii]
  for (const n of lungimi) {
    if (frunze.some(b => b.id !== sursa.id && b.serie_canon === sursa.serie_canon && b.sarja === sursa.sarja && cm(b.lungime_mm) === cm(n))) throw Error('Serie + șarjă + lungime identice: remăsoară')
    for (const child of snapshot?.bucati_declarate || []) {
      const root = snapshot.frunze?.find(b => b.id === child.radacina_id)
      if (child.stare !== 'anulata' && root?.serie_canon === sursa.serie_canon && root?.sarja === sursa.sarja && cm(child.lungime_mm) === cm(n)) throw Error('Copil declarat identic: remăsoară')
    }
  }
}

export function capeteLocale(s, snapshot, sesiune) {
  const map = new Map((snapshot?.lanturi || []).map(b => [`b:${b.id}`, { key: `b:${b.id}`, ref: { bucata_id: b.id }, label: `${b.serie} · ${b.lungime_mm} mm`, piesa: b }]))
  const decls = (snapshot?.declaratii || []).filter(d => d.tip === 'montaj' && !['blocata', 'conflict', 'respinsa', 'stearsa'].includes(d.stare))
    .map(d => d.payload)
  for (const o of toateOperatiile(s)) if (o.cerere.payload.preverificare_uid === sesiune?.uid && o.cerere.payload.tip === 'montaj' && reusita(o) && !o.de_verificat) decls.push(o.cerere.payload)
  for (const p of decls) {
    const ref = p.bucata
    if (!ref) continue
    const key = ref.bucata_id ? `b:${ref.bucata_id}` : `d:${ref.decl_uid}`
    const piece = snapshot?.frunze?.find(b => b.id === ref.bucata_id)
    map.set(key, { key, ref, piesa: piece, label: `${piece?.serie || 'Copil declarat'} · ${p.lungime_montata_mm} mm`,
      dependenta: ref.decl_uid ? { depinde_de_uid: p.depinde_de_uid, depinde_de_versiune: p.depinde_de_versiune } : {} })
  }
  const disparute = new Set((snapshot?.tombstone || []).map(b => b.id))
  for (const o of toateOperatiile(s)) if (o.cerere.payload.tip === 'taiere' && reusita(o)) disparute.add(o.cerere.payload.sursa?.bucata_id)
  return [...map.values()].filter(e => !disparute.has(e.ref.bucata_id))
}

export function copiiLocali(s, snapshot) {
  const copii = []
  const latest = new Map()
  for (const o of toateOperatiile(s)) if (o.cerere.payload.tronson_id === snapshot?.tronson_id && reusita(o)) latest.set(o.cerere.payload.uid, o.cerere.payload)
  for (const p of latest.values()) {
    const root = snapshot?.frunze?.find(b => b.id === p.sursa?.bucata_id)
    if (p.tip === 'taiere' && root) for (const child of p.copii || []) copii.push({ ...root, id: child.uid, uid: child.uid, lungime_mm: child.lungime_mm })
  }
  return copii
}

export function construiesteDeclaratii({ baza, tip, piesa, confirmata, cm, taiereMm, ramane = 'stanga', sudura, amonte, capat, dependenta = {}, snapshot, localCopii = [], id = uuid }) {
  const declaratie = p => ({ tip_op: 'decl_salveaza', payload: { ...baza, uid: id(), versiune_baza: 0, ...p } })
  if (tip === 'cuplare') {
    if (!amonte || !piesa || (amonte.bucata_id && amonte.bucata_id === piesa.bucata_id) || (amonte.decl_uid && amonte.decl_uid === piesa.decl_uid)) throw Error('Alege capete de pe două bucăți diferite')
    if (!sudura) throw Error('Lipsește codul sudurii')
    return [declaratie({ tip, capat1: amonte, capat2: piesa, sudura, ...dependenta })]
  }
  if (!piesa || !confirmata || !Number.isInteger(Number(cm)) || Number(cm) !== Math.round(piesa.lungime_mm / 10) % 100) throw Error('Confirmă separat ultimele două cifre de centimetri')
  const confirmare = { mod: 'marcaj', cm: Number(cm) }
  if (amonte && !sudura) throw Error('Lipsește codul sudurii')
  const montaj = (ref, lungime, dep = dependenta) => declaratie({ tip: 'montaj', bucata: ref, lungime_montata_mm: lungime, confirmare, capat_amonte: capat, amonte: amonte || { tip: 'inceput_lant' }, ...(amonte ? { sudura } : {}), ...dep })
  if (tip === 'montaj') return [montaj({ bucata_id: piesa.id }, piesa.lungime_mm)]
  const n = Number(taiereMm)
  if (!Number.isInteger(n) || n <= 0 || n >= piesa.lungime_mm) throw Error('Lungimea tăiată trebuie să fie între 0 și lungimea țevii, în mm')
  verificaIdentitate(snapshot, piesa, [n, piesa.lungime_mm - n], localCopii)
  if (tip === 'taiere_libera') {
    const ocupate = (snapshot.suduri || []).filter(w => w.stare === 'aprobata').flatMap(w => w.capete || []).filter(c => c.bucata_id === piesa.id && c.activ)
    if (ocupate.length !== 1) throw Error('Tăierea pe tabletă cere exact un capăt sudat aprobat')
    return [declaratie({ tip: 'taiere', sursa: { bucata_id: piesa.id }, baza_mm: piesa.lungime_mm, puncte_mm: [n], confirmare,
      copii: [{ uid: id(), lungime_mm: n, destinatie: ramane === 'stanga' ? 'ramane_montat' : 'depozit' },
        { uid: id(), lungime_mm: piesa.lungime_mm - n, destinatie: ramane === 'dreapta' ? 'ramane_montat' : 'depozit', calculata: true }] })]
  }
  if (dependenta.depinde_de_uid) throw Error('Legarea între copii de tăieri diferite necesită întâi aprobarea MP')
  const taiere = declaratie({ tip: 'taiere', sursa: { bucata_id: piesa.id }, baza_mm: piesa.lungime_mm, puncte_mm: [n], confirmare,
    copii: [{ uid: id(), lungime_mm: n, destinatie: 'montaj' }, { uid: id(), lungime_mm: piesa.lungime_mm - n, destinatie: 'depozit', calculata: true }] })
  const m = montaj({ decl_uid: taiere.payload.copii[0].uid }, n, { depinde_de_uid: taiere.payload.uid, depinde_de_versiune: 1 })
  m.payload.confirmare = { mod: 'taiata' }
  return [taiere, m]
}
