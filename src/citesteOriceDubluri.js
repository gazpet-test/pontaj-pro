// ===========================================================================
// CITEȘTE ORICE — dublura din dosarul HR (varianta A, Răzvan 21.10.2026, TKT-2026-0343)
// ===========================================================================
// Funcții pure (fără supabase / React), testate în citesteOriceDubluri.test.js.
//   • clasificaDublura   — același fișier (nume + mărime egală) vs. același nume, alt conținut;
//                          copia ACTIVĂ are prioritate; doar copii inactive → doar închidere (r1/r2)
//   • blocheazaInserare  — garda din confirmHR (ultima apărare), cu excepția confirmată de om
//   • texteAltContinut   — ce spun panoul / confirmarea la „același nume" (mărime cunoscută sau nu)
//   • campuriDeCompletat — doar câmpurile GOALE din dosar, doar cu valori AI valide
//   • analizaDublura     — tot ce afișează panoul pentru un rând din coadă
//   Review extern (Copilot + Jakarinos, 21.10):
//   • gardaDocDosar / potrivesteGarda — identitatea documentului din dosar pe care lucrează
//                          UPDATE-ul de completare / verificarea dinainte de închidere (F1, F6)
//   • grupeDupaAngajat   — căutarea proactivă pe angajat, nu produs cartezian (F4)
//   • rezultatCautareDosar — răspuns trunchiat = eroare de căutare, nu „liber" (F3, F4)
//   • gardaFinalaHR      — garda finală din confirmHR: căutare exactă + căutare completă pe nume (F3)
//   Verificare r4 (21.10):
//   • stareInchidere     — 0 rânduri la închidere: decide citirea DIRECTĂ a rândului, nu coada modulului (F5)
//   • mesajInchidere     — ce afișează panoul după închidere (închis / neînchis / necunoscut)
//   Fix-uri după simplificare (21.10):
//   • motivFaraExpirare  — „fără expirare" în dosar / tip fără expirare: data expirării nu se propune (HR-1)
//   • stagingSters       — fișierul din staging s-a șters sigur? (altfel o nouă confirmare l-ar salva din nou — NH-1)
//   • textConfirmareRespingere / mesajRespingere — ✕ Respinge neutru + rezultatul verificat (RB2 / NH-2)
//   Review final (Jakarinos P1/P2, Copilot P2/P3, 21.10):
//   • tagProvenienta / areTagProvenienta / observatiiInserareHR — documentul inserat din rândul #N poartă
//                          „[Citește orice #N]" în observații → la reîncercare e 'acelasi', oricare i-ar fi mărimea (J1)
//   • respingereServer / citireNecesara — o eroare de transport la UPDATE nu e „deschis": se citește rândul (J2)
//   • rezultatCautareDosar — trunchiat după count când există; limita doar fără count (C1)
//   • dosarInVerificare  — reverificarea golește cheia: fără rezultat vechi la A→B→A (C2)
// „Gol" = NULL (exact ce verifică UPDATE-ul cu .is(camp, null)); un text gol ''
// nu se consideră gol, ca garda din UPDATE să nu dea fals „s-a schimbat între timp".
// ===========================================================================

// câmp în hr_documente_personale ← cheie în payload_ai.date_document
export const CAMPURI_DOSAR = [
  { camp:'numar_document', sursa:'numar', eticheta:'nr. document', tip:'text' },
  { camp:'emitent', sursa:'emitent', eticheta:'emitent', tip:'text' },
  { camp:'data_emitere', sursa:'data_emitere', eticheta:'data emiterii', tip:'data' },
  { camp:'data_expirare', sursa:'data_expirare', eticheta:'data expirării', tip:'data' },
]

export const TEXT_AI_MAX = 200

// 'YYYY-MM-DD', dată reală din calendar (fără 2026-02-30), an 1900..2100 → altfel null
export function dataAIValida(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const an = +m[1], luna = +m[2], zi = +m[3]
  if (an < 1900 || an > 2100 || luna < 1 || luna > 12 || zi < 1) return null
  const zileInLuna = new Date(Date.UTC(an, luna, 0)).getUTCDate()
  return zi <= zileInLuna ? s : null
}

// text curățat, ne-gol, max 200 caractere → altfel null (numărul poate veni și ca number)
export function textAIValid(v) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v)
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s && s.length <= TEXT_AI_MAX ? s : null
}

// Documentul din dosar a venit din importul de pe Drive (api/hr-drive-import.js)
export function esteDinDrive(doc) {
  if (!doc) return false
  return String(doc.fisier_path || '').includes('/drive/') || !!doc.drive_file_id || doc.uploadat_de == null
}

export const marime = v => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const cheieDosar = (angajatId, fisierNume) => `${Number(angajatId)}|${fisierNume}`

// Perechile (angajat, nume fișier) de verificat în dosar, fără repetiții.
// alegeAngajat = entitateAleasa din panou (respectă corecția manuală + pragul de încredere).
export function perechiDeVerificat(rows, alegeAngajat) {
  const out = [], vazut = new Set()
  for (const r of rows || []) {
    const emp = r ? alegeAngajat(r) : null
    if (!emp || !r.fisier_nume) continue
    const k = cheieDosar(emp, r.fisier_nume)
    if (vazut.has(k)) continue
    vazut.add(k); out.push({ emp:Number(emp), nume:r.fisier_nume, k })
  }
  return out
}

export function bucati(arr, n) {
  const out = []
  for (let i = 0; i < (arr || []).length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Activ = convenția din TabDocumentePersonale: doar activ === false e istoric / arhivat.
export const esteActiv = d => !!d && d.activ !== false

// J1 (review final): eticheta de proveniență pe care confirmHR o pune la finalul observațiilor documentului
// inserat din rândul #N al cozii. Determinista (doar id-ul rândului) și închisă cu „]": „[Citește orice #12]"
// nu apare în „[Citește orice #123]" / „#112]", deci rândurile nu se confundă între ele.
export const tagProvenienta = inboxId => `[Citește orice #${String(inboxId).trim()}]`
export function areTagProvenienta(observatii, inboxId) {
  if (observatii == null || inboxId == null || String(inboxId).trim() === '') return false
  return String(observatii).includes(tagProvenienta(inboxId))
}
// observațiile documentului inserat de confirmHR: titlul AI (dacă e) + eticheta pe ultima linie
export const observatiiInserareHR = row => observatiiNoi(row?.payload_ai?.titlu_scurt || null, tagProvenienta(row?.id))

// docs = rânduri hr_documente_personale (pot fi și ale altor angajați / alte nume — se filtrează aici)
//   tip 'acelasi'         → există potrivire ACTIVĂ: fisier_size_bytes egal (ne-null) SAU eticheta de
//                           proveniență a ACESTUI rând în observații (J1 — salvat deja din el, oricare i-ar fi mărimea);
//                           doc = cea salvată din rând dacă e activă, altfel cea mai veche activă (id minim)
//                           — inactivele nu câștigă (review r1)
//   tip 'acelasi_inactiv' → același fișier (sau cel salvat din rând) există, dar DOAR ca document inactiv (istoric);
//                           doar închidere: nu se completează nimic și nu se inserează altă copie (r2)
//   tip 'alt_continut'    → același nume, dar nicio mărime egală (sau mărimi necunoscute) și fără eticheta rândului
//                           marimiNecunoscute = rândul SAU măcar o copie din dosar n-are mărime (r2):
//                           atunci nu pot spune „alt fișier" — copia fără mărime poate fi chiar el
//   tip null              → nimic cu acest nume la acest angajat
// nrIdentice = toate copiile potrivite (identice ca mărime sau etichetate; active + inactive); nrInactive = câte sunt inactive.
// dinRand = documentul ales poartă eticheta rândului (J1): închiderea rândului a picat după inserare → doar închidere.
// Regula (F2, rafinare deliberată a regulii „cea mai veche copie identică"): cea mai veche copie identică ACTIVĂ; dacă nu e niciuna activă, cea mai veche identică — o copie inactivă e istoric, nu ținta completării.
// Căutările din dosar sunt pe nume, deci și documentul etichetat se caută aici cu același nume ca rândul.
export function clasificaDublura(row, docs, angajatId) {
  const gol = { tip:null, doc:null, nrIdentice:0, nrInactive:0, nrTotal:0, marimiNecunoscute:false, dinRand:false }
  if (!row || !row.fisier_nume || angajatId == null) return gol
  const lista = (docs || []).filter(d => d && d.deleted_at == null
    && Number(d.employee_id) === Number(angajatId) && d.fisier_nume === row.fisier_nume)
  if (!lista.length) return gol
  const sz = marime(row.fisier_size_bytes)
  const marcate = new Set(lista.filter(d => areTagProvenienta(d.observatii, row.id)).map(d => d.id))
  const potrivite = lista.filter(d => marcate.has(d.id) || (sz != null && marime(d.fisier_size_bytes) === sz)).sort((a, b) => a.id - b.id)
  if (potrivite.length) {
    const active = potrivite.filter(esteActiv)
    const alege = l => l.find(d => marcate.has(d.id)) || l[0]
    const doc = alege(active.length ? active : potrivite)
    const baza = { doc, nrIdentice:potrivite.length, nrInactive:potrivite.length - active.length, nrTotal:lista.length,
      marimiNecunoscute:false, dinRand:marcate.has(doc.id) }
    return { tip: active.length ? 'acelasi' : 'acelasi_inactiv', ...baza }
  }
  return { tip:'alt_continut', doc:null, nrIdentice:0, nrInactive:0, nrTotal:lista.length,
    marimiNecunoscute: sz == null || lista.some(d => marime(d.fisier_size_bytes) == null), dinRand:false }
}

// Garda din confirmHR (ultima apărare, pe ce e în dosar LA MOMENTUL inserării):
// null → se poate insera; altfel tipul dublurii care blochează.
//   'acelasi' / 'acelasi_inactiv' → blochează mereu (același fișier e deja în dosar, activ sau
//                                   istoric — varianta A: se închide, nu se mai inserează o copie; r2)
//   'alt_continut'    → trece doar cu opts.faraGardaNume (omul a confirmat „Adaugă ca document nou").
//                       opts.marimiComparate = omul a confirmat „alt fișier (altă mărime)"; dacă între
//                       timp a apărut o copie fără mărime (poate fi chiar fișierul) → blochează (r2).
// Dacă starea s-a schimbat între afișare și click, excepția nu se mai potrivește → blochează.
export function blocheazaInserare(cls, opts = {}) {
  if (!cls || !cls.tip) return null
  if (cls.tip === 'alt_continut' && opts.faraGardaNume && !(opts.marimiComparate && cls.marimiNecunoscute)) return null
  return cls.tip
}

// Textele pentru „același nume, alt conținut" (review r2): „alt fișier (altă mărime)" DOAR când
// mărimile s-au putut compara; altfel spun că nu pot verifica — poate fi chiar același fișier.
// Fără informație (dub lipsă / câmp lipsă) → varianta prudentă (necunoscut).
export function texteAltContinut(dub, nume) {
  const necunoscut = !dub || dub.marimiNecunoscute !== false
  const nr = dub && dub.nrTotal > 1 ? ` — ${dub.nrTotal} documente cu acest nume` : ''
  if (necunoscut) return {
    necunoscut,
    panou: `⚠️ există «${nume}» la acest angajat, dar nu pot verifica dacă e același fișier (mărime necunoscută)${nr} — deschide-l cu 👁 Vezi și compară-l cu cel din dosar înainte să-l adaugi.`,
    confirmare: `Există deja „${nume}" la acest angajat și NU pot verifica dacă e același fișier (mărime necunoscută) — poate fi chiar același.\n\nL-ai deschis cu 👁 Vezi și l-ai comparat cu cel din dosar? Îl adaug totuși ca document NOU?`,
    garda: `Există deja „${nume}" la acest angajat și nu pot verifica dacă e același fișier (mărime necunoscută) — compară-l cu 👁 Vezi; dacă e un document nou, folosește «Adaugă ca document nou».`,
  }
  return {
    necunoscut,
    panou: `⚠️ există «${nume}» la acest angajat, dar e alt fișier (altă mărime)${nr}.`,
    confirmare: `Există deja „${nume}" la acest angajat, dar e alt fișier (altă mărime).\n\nÎl adaug ca document NOU în dosar?`,
    garda: `Există deja „${nume}" la acest angajat, dar e alt fișier (altă mărime) — dacă e un document nou, folosește «Adaugă ca document nou».`,
  }
}

// HR-1: de ce NU se propune data expirării — 'dosar' (documentul e marcat „fără expirare", alegerea
// omului din TabDocumentePersonale / confirmHR) | 'tip' (tipul din dosar n-are expirare) | null
export function motivFaraExpirare(doc, tipDosar) {
  if (doc && doc.fara_expirare === true) return 'dosar'
  if (tipDosar && tipDosar.are_expirare === false) return 'tip'
  return null
}

// Câmpurile care s-ar completa: GOALE (NULL) în dosar ȘI prezente + valide în date_document.
// Data expirării nu intră la un document marcat „fără expirare" sau cu opts.faraExpirare (tip fără expirare) — HR-1.
export function campuriDeCompletat(doc, dateDocument, { faraExpirare = false } = {}) {
  if (!doc || !dateDocument || typeof dateDocument !== 'object') return []
  const out = []
  for (const c of CAMPURI_DOSAR) {
    if (doc[c.camp] != null) continue
    if (c.camp === 'data_expirare' && (faraExpirare || doc.fara_expirare === true)) continue
    const val = c.tip === 'data' ? dataAIValida(dateDocument[c.sursa]) : textAIValid(dateDocument[c.sursa])
    if (val != null) out.push({ camp:c.camp, val, eticheta:c.eticheta })
  }
  return out
}

// Obiectul pentru UPDATE: doar câmpurile completate (+ fara_expirare=false dacă intră data expirării)
// + observațiile vechi păstrate, cu o linie nouă la final.
export function updateCompletare(campuri, observatiiVechi, linie) {
  const upd = {}
  for (const c of campuri || []) upd[c.camp] = c.val
  if (upd.data_expirare) upd.fara_expirare = false
  upd.observatii = observatiiNoi(observatiiVechi, linie)
  return upd
}

export function fmtZi(d) {
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

export function liniaObservatii(inboxId, data, campuri) {
  return `Completat din «Citește orice» (inbox #${inboxId}, ${fmtZi(data)}): ${(campuri || []).map(c => c.eticheta).join(', ')}`
}

export function observatiiNoi(existente, linie) {
  const e = existente == null ? '' : String(existente)
  return e.trim() ? e + '\n' + linie : linie
}

// Tot ce afișează panoul pentru un rând HR din coadă, dat fiind ce s-a găsit în dosar.
//   tipAI = row._editTip ?? row.tip_document (codul ales pe card)
// La 'acelasi' / 'acelasi_inactiv' adaugă: dinDrive, tipDosar ({id,cod,denumire} | null), tipDiferit, campuri.
// Tip diferit (sau necunoscut de o parte) → NU se completează nimic.
// Rând în status 'eroare' (AI n-a citit nimic) → doar închidere, fără completare.
// Document inactiv (istoric) → doar închidere: nu se completează nimic în el (r1/r2).
// expirareOmisa (HR-1) = { motiv:'dosar' | 'tip', val } când AI a citit o dată de expirare validă, dar ea
// nu se completează (dosar „fără expirare" / tip fără expirare) — panoul spune de ce; altfel null.
// Document salvat deja din acest rând (dinRand, J1) → doar închidere, legat de el: nu se completează nimic.
export function analizaDublura({ row, docs, angajatId, tipuriFK, tipAI }) {
  const c = clasificaDublura(row, docs, angajatId)
  if (c.tip !== 'acelasi' && c.tip !== 'acelasi_inactiv') return c
  const tipDosar = (tipuriFK || []).find(t => Number(t.id) === Number(c.doc.tip_id)) || null
  const dinDrive = esteDinDrive(c.doc)
  if (row.status === 'eroare' || c.tip === 'acelasi_inactiv' || c.dinRand) return { ...c, dinDrive, tipDosar, tipDiferit:false, campuri:[], expirareOmisa:null }
  const tipDiferit = !tipAI || !tipDosar || tipDosar.cod !== tipAI
  const dd = row.payload_ai?.date_document
  const motiv = motivFaraExpirare(c.doc, tipDosar)
  const campuri = tipDiferit ? [] : campuriDeCompletat(c.doc, dd, { faraExpirare:!!motiv })
  const valExp = dd && typeof dd === 'object' ? dataAIValida(dd.data_expirare) : null
  const expirareOmisa = !tipDiferit && motiv && c.doc.data_expirare == null && valExp ? { motiv, val:valExp } : null
  return { ...c, dinDrive, tipDosar, tipDiferit, campuri, expirareOmisa }
}

// ─── Comun tuturor modulelor (review r1, 21.10) ──────────────────────────────
// UPDATE fără eroare dar fără rând întors: nu știm încă dacă s-a închis — se verifică prin citirea directă a rândului (r4)
export function inchidereFaraRezultat(res) {
  const { data, error } = res || {}
  return !!res && !error && Array.isArray(data) && data.length === 0
}

// ─── Review extern (Copilot + Jakarinos, 21.10) ──────────────────────────────
// F1 + F6: filtrele care leagă UPDATE-ul de completare (campuri = lista de completat) sau
// verificarea dinainte de „doar închidere" (campuri = null) de EXACT documentul văzut de om:
// id + nesters + aceeași stare activ/istoric + același angajat + același nume + aceeași mărime;
// la completare și același tip, câmpurile încă goale, aceleași observații și — dacă intră data
// expirării — fara_expirare tot false / NULL (HR-1: data expirării se propune doar atunci; un document
// marcat „fără expirare" — dinainte SAU între timp — nu se calcă: garda pică, fără eq true).
// Listă de [op, coloană, valoare], op 'eq' | 'is' (valoare null → 'is'); componenta face q[op](col, val).
export function gardaDocDosar({ doc, angajatId, row, campuri = null }) {
  const f = (col, v) => v == null ? ['is', col, null] : ['eq', col, v]
  const g = [
    ['eq', 'id', doc.id],
    ['is', 'deleted_at', null],
    ['is', 'activ', doc.activ ?? null],
    ['eq', 'employee_id', Number(angajatId)],
    f('fisier_nume', row && row.fisier_nume),
    f('fisier_size_bytes', marime(doc.fisier_size_bytes)),
  ]
  if (campuri) {
    g.push(f('tip_id', doc.tip_id))
    for (const c of campuri) g.push(['is', c.camp, null])
    if (campuri.some(c => c.camp === 'data_expirare')) g.push(doc.fara_expirare === false ? ['eq', 'fara_expirare', false] : ['is', 'fara_expirare', null])
    g.push(f('observatii', doc.observatii))
  }
  return g
}

// Rândul citit din dosar respectă garda? (verificare și pe client, după filtrele din cerere)
const COL_NUMERICE = new Set(['id', 'employee_id', 'tip_id', 'fisier_size_bytes'])
export function potrivesteGarda(d, garda) {
  if (!d) return false
  return (garda || []).every(([, col, val]) => {
    const v = d[col]
    if (val == null) return v == null
    if (COL_NUMERICE.has(col)) return marime(v) != null && marime(v) === marime(val)
    return v === val
  })
}

// F4: căutarea proactivă pe angajat (nu produs cartezian angajați × nume tăiat la o limită):
// un grup = UN angajat + cel mult n nume de fișier ale lui.
export function grupeDupaAngajat(perechi, n) {
  const pe = new Map()
  for (const p of perechi || []) {
    if (!p) continue
    if (!pe.has(p.emp)) pe.set(p.emp, [])
    pe.get(p.emp).push(p)
  }
  const out = []
  for (const [emp, lista] of pe) for (const b of bucati(lista, n)) out.push({ emp, perechi:b, nume:b.map(p => p.nume) })
  return out
}

// F3 / F4: răspunsul unei căutări în dosar ({ data, error, count }) → { docs } | { err:'eroare' | 'trunchiat' }.
//   count prezent → decide DOAR el: count > rânduri primite = 'trunchiat'; exact la limită (ex. 500 din 500)
//                   = complet, fără avertisment fals (C1)
//   count lipsă   → limita = limita de rânduri cerută: un răspuns care o atinge poate fi tăiat → 'trunchiat';
//                   altfel, dacă s-a cerut count:'exact' (cuNumar) → 'eroare'
// Trunchiat = nu știu dacă copia identică e printre rândurile lipsă → eroare de căutare, nu „liber".
export function rezultatCautareDosar(res, { limita = null, cuNumar = false } = {}) {
  const { data, error, count } = res || {}
  if (!res || error || !Array.isArray(data)) return { err:'eroare' }
  if (typeof count === 'number' && Number.isFinite(count)) return count > data.length ? { err:'trunchiat' } : { docs:data }
  if (limita != null && data.length >= limita) return { err:'trunchiat' }
  if (cuNumar) return { err:'eroare' }
  return { docs:data }
}

export function mesajEroareCautare(err, nume) {
  return err === 'trunchiat'
    ? `Sunt prea multe documente „${nume}" la acest angajat ca să le verific pe toate — nu adaug nimic; verifică dosarul manual.`
    : 'Nu am putut verifica dosarul angajatului — încearcă din nou.'
}

// F3: garda finală din confirmHR (ultima apărare, fail-closed).
//   exact = rezultatCautareDosar pe angajat + nume + mărime (limit 1, copia activă întâi);
//           null când mărimea rândului e necunoscută
//   nume  = rezultatCautareDosar pe angajat + nume, complet (count) — poate lipsi dacă exact a blocat deja
//   (ambele cu coloana observatii: documentul etichetat cu acest rând = 'acelasi' oricare i-ar fi mărimea — J1)
// → { err } (căutare picată / incompletă: NU se inserează) | { bloc, cls } (bloc null = se poate insera)
export function gardaFinalaHR({ row, angajatId, exact, nume, opts = {} }) {
  if (exact) {
    if (exact.err) return { err:exact.err }
    if (exact.docs.length) {
      const cls = clasificaDublura(row, exact.docs, angajatId)
      return { bloc: cls.tip === 'acelasi_inactiv' ? 'acelasi_inactiv' : 'acelasi', cls }
    }
  }
  if (!nume || nume.err) return { err:(nume && nume.err) || 'eroare' }
  const cls = clasificaDublura(row, nume.docs, angajatId)
  return { bloc:blocheazaInserare(cls, opts), cls }
}

// Mesajul din confirmHR când garda finală blochează inserarea (bloc ≠ null)
export function mesajBlocareHR(bloc, cls, nume) {
  if (bloc === 'acelasi') return cls && cls.dinRand && cls.doc
    ? `Documentul a fost deja salvat în dosar din acest rând (#${cls.doc.id}) — nu-l mai adaug; folosește «Închide (e deja în dosar)».`
    : 'E deja în dosar — folosește «Închide» sau «Completează și închide».'
  if (bloc === 'acelasi_inactiv') return 'E deja în dosar (ca document INACTIV, istoric) — folosește «Închide (e deja în dosar)».'
  return texteAltContinut(cls, nume).garda
}

// C2: la începutul unei reverificări cheile ei trec în „se verifică" (scoase din dosar) — un rezultat vechi
// (alt angajat ales între timp: A→B→A) nu se mai afișează până nu vine răspunsul nou. Fără chei de scos → același obiect.
export function dosarInVerificare(dosar, chei) {
  const d = dosar || {}
  const k = (chei || []).filter(x => x in d)
  if (!k.length) return d
  const n = { ...d }
  for (const x of k) delete n[x]
  return n
}

// J2: UPDATE refuzat SIGUR de server = răspuns HTTP 4xx (PostgREST: RLS, constrângere, cerere invalidă) →
// nu s-a aplicat. O eroare FĂRĂ răspuns HTTP (postgrest-js: status 0 — „Failed to fetch", rețea, timeout)
// sau un 5xx (ex. gateway) nu spune nimic despre rezultat: UPDATE-ul poate fi intrat, doar răspunsul s-a pierdut.
export function respingereServer(res) {
  const st = res && res.status
  return !!(res && res.error) && typeof st === 'number' && st >= 400 && st < 500
}

// După UPDATE: rezultatul trebuie aflat prin citirea DIRECTĂ a rândului? (tot ce nu e rând întors / refuz sigur)
export function citireNecesara(res) {
  const { data, error } = res || {}
  if (res && !error && Array.isArray(data) && data.length) return false
  return !respingereServer(res)
}

// F5 (r4) + J2: starea rândului din ai_documente_inbox după UPDATE-ul care îl închide.
//   statusTinta = statusul pus de UPDATE: 'confirmat' (finalizeInbox) | 'respins' (✕ Respinge — NH-2)
//   res    = răspunsul UPDATE-ului (.select('id'))
//   citire = citirea DIRECTĂ a rândului ({ data:{ id, status } | null, error } — select … .eq('id') .maybeSingle()),
//            făcută când citireNecesara(res): 0 rânduri fără eroare, eroare de transport / 5xx (J2), răspuns ciudat.
//            NU coada modulului: un rând mutat între timp în alt modul lipsește din coada asta, dar e tot
//            deschis (verificare r4, F5 rezidual).
// → 'inchis'     UPDATE-ul a întors rândul, sau rândul se vede cu statusTinta (și după un răspuns pierdut)
//   'deschis'    UPDATE-ul a fost refuzat sigur (4xx), sau rândul se vede și NU are statusTinta
//   'necunoscut' rezultat nesigur și rândul nu se vede (mutat / fără drept pe el) sau citirea a picat / lipsește
export function stareInchidere(res, citire, statusTinta = 'confirmat') {
  const { data, error } = res || {}
  if (res && !error && Array.isArray(data) && data.length) return 'inchis'
  if (respingereServer(res)) return 'deschis'
  const { data:r, error:e } = citire || {}
  if (!citire || e || !r) return 'necunoscut'
  return r.status === statusTinta ? 'inchis' : 'deschis'
}

// NH-1: răspunsul lui storage.remove([cale]) → fișierul din staging s-a șters SIGUR? storage-js nu aruncă:
// întoarce { error } (rețea / server) sau data = [] (nimic șters — fără drept de ștergere, cale lipsă).
export function stagingSters(res) {
  const { data, error } = res || {}
  return !!res && !error && Array.isArray(data) && data.length > 0
}

// Documentul țintă e deja salvat când se afișează mesajele astea. Rândul rămas deschis se scoate cu butonul
// roșu al cardului — «✕ Respinge» sau, pe cardurile „eroare", «✕ Scoate din coadă» (HR-2 / RB1).
// Un nou „✓ Confirmă" NU e oprit oricând: doar dacă fișierul din staging s-a șters (mutaFisier nu-l mai
// găsește); altfel l-ar salva a doua oară — mesajul o spune explicit (MESAJ_STAGING_RAMAS, NH-1).
const SCOATE_RAND = 'scoate-l cu «✕ Respinge» / «✕ Scoate din coadă» (rândul apare ca respins, documentul rămâne salvat)'
export const MESAJ_RAND_NEINCHIS = `Documentul e salvat, dar rândul din coadă nu s-a putut închide — nu-l confirma din nou; ${SCOATE_RAND}.`
export const MESAJ_RAND_NEVERIFICAT = `Documentul e salvat, dar nu pot verifica rândul din coadă (nu-l mai văd — mutat în alt modul / fără drept pe el — sau verificarea a picat). Dacă rândul e încă în listă, nu-l confirma din nou; ${SCOATE_RAND}.`
export const MESAJ_STAGING_RAMAS = ' ATENȚIE: fișierul din coadă nu s-a putut șterge — încă un «✓ Confirmă» l-ar salva a doua oară.'

// Mesajul de după închidere → { tip:'ok' | 'warn' | 'err', msg }; stagingRamas = !stagingSters(...) (NH-1)
export function mesajInchidere(stare, msgOk, { stagingRamas = false } = {}) {
  if (stare === 'inchis') return { tip:'ok', msg:msgOk }
  const extra = stagingRamas ? MESAJ_STAGING_RAMAS : ''
  if (stare === 'necunoscut') return { tip:'warn', msg:MESAJ_RAND_NEVERIFICAT + extra }
  return { tip:'err', msg:MESAJ_RAND_NEINCHIS + extra }
}

// RB2 / NH-2: ✕ Respinge e și ieșirea după o închidere eșuată (documentul deja salvat, fișierul din staging
// de regulă șters) → textul nu mai afirmă ca sigur „nu intră în sistem / fișierul rămâne pentru audit".
export function textConfirmareRespingere(nume) {
  return `Scoți „${nume}" din coadă (rândul apare ca respins)?\n\nDacă documentul a fost deja salvat (ți-am spus la confirmare), rămâne salvat. Altfel nu intră în sistem, iar fișierul rămâne pentru audit.`
}

// NH-2: rezultatul lui ✕ Respinge, verificat ca la închidere (stareInchidere cu 'respins'), nu „Respins." orbește
export function mesajRespingere(stare, eroare) {
  if (stare === 'inchis') return { tip:'ok', msg:'Respins.' }
  if (stare === 'necunoscut') return { tip:'warn', msg:'Nu pot verifica dacă rândul a ieșit din coadă (nu-l mai văd sau verificarea a picat) — uită-te în listă.' }
  const m = eroare && (eroare.message || String(eroare))
  return { tip:'err', msg:`Rândul NU a ieșit din coadă${m ? ': ' + m : ''} — încearcă din nou.` }
}
