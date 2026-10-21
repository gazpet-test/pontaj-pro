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

const marime = v => {
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

// docs = rânduri hr_documente_personale (pot fi și ale altor angajați / alte nume — se filtrează aici)
//   tip 'acelasi'         → există potrivire ACTIVĂ cu fisier_size_bytes egal (ne-null);
//                           doc = cea mai veche activă (id minim) — inactivele nu câștigă (review r1)
//   tip 'acelasi_inactiv' → același fișier există, dar DOAR ca document inactiv (istoric);
//                           doar închidere: nu se completează nimic și nu se inserează altă copie (r2)
//   tip 'alt_continut'    → același nume, dar nicio mărime egală (sau mărimi necunoscute)
//                           marimiNecunoscute = rândul SAU măcar o copie din dosar n-are mărime (r2):
//                           atunci nu pot spune „alt fișier" — copia fără mărime poate fi chiar el
//   tip null              → nimic cu acest nume la acest angajat
// nrIdentice = toate copiile identice (active + inactive); nrInactive = câte dintre ele sunt inactive.
export function clasificaDublura(row, docs, angajatId) {
  const gol = { tip:null, doc:null, nrIdentice:0, nrInactive:0, nrTotal:0, marimiNecunoscute:false }
  if (!row || !row.fisier_nume || angajatId == null) return gol
  const lista = (docs || []).filter(d => d && d.deleted_at == null
    && Number(d.employee_id) === Number(angajatId) && d.fisier_nume === row.fisier_nume)
  if (!lista.length) return gol
  const sz = marime(row.fisier_size_bytes)
  const identice = sz == null ? [] : lista.filter(d => marime(d.fisier_size_bytes) === sz).sort((a, b) => a.id - b.id)
  if (identice.length) {
    const active = identice.filter(esteActiv)
    const baza = { nrIdentice:identice.length, nrInactive:identice.length - active.length, nrTotal:lista.length, marimiNecunoscute:false }
    return active.length ? { tip:'acelasi', doc:active[0], ...baza } : { tip:'acelasi_inactiv', doc:identice[0], ...baza }
  }
  return { tip:'alt_continut', doc:null, nrIdentice:0, nrInactive:0, nrTotal:lista.length,
    marimiNecunoscute: sz == null || lista.some(d => marime(d.fisier_size_bytes) == null) }
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

// Câmpurile care s-ar completa: GOALE (NULL) în dosar ȘI prezente + valide în date_document
export function campuriDeCompletat(doc, dateDocument) {
  if (!doc || !dateDocument || typeof dateDocument !== 'object') return []
  const out = []
  for (const c of CAMPURI_DOSAR) {
    if (doc[c.camp] != null) continue
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
export function analizaDublura({ row, docs, angajatId, tipuriFK, tipAI }) {
  const c = clasificaDublura(row, docs, angajatId)
  if (c.tip !== 'acelasi' && c.tip !== 'acelasi_inactiv') return c
  const tipDosar = (tipuriFK || []).find(t => Number(t.id) === Number(c.doc.tip_id)) || null
  const dinDrive = esteDinDrive(c.doc)
  if (row.status === 'eroare' || c.tip === 'acelasi_inactiv') return { ...c, dinDrive, tipDosar, tipDiferit:false, campuri:[] }
  const tipDiferit = !tipAI || !tipDosar || tipDosar.cod !== tipAI
  const campuri = tipDiferit ? [] : campuriDeCompletat(c.doc, row.payload_ai?.date_document)
  return { ...c, dinDrive, tipDosar, tipDiferit, campuri }
}

// ─── Comun tuturor modulelor (review r1, 21.10) ──────────────────────────────
// Rezultatul UPDATE-ului care închide rândul din ai_documente_inbox → null (închis) sau
// mesajul de afișat. Documentul țintă e deja salvat în acest punct, deci apelantul
// afișează mesajul și reîmprospătează ORICUM (coada + ecranul părinte).
export function eroareInchidereRand(res) {
  const { data, error } = res || {}
  if (!error && Array.isArray(data) && data.length) return null
  const det = error ? ': ' + (error.message || String(error)) : ' (fără drept de modificare?)'
  return 'Documentul e salvat, dar rândul din coadă nu s-a putut închide' + det + ' — reîncarcă lista și verifică.'
}

// UPDATE fără eroare dar fără rând întors: nu știm încă dacă s-a închis (RLS pe SELECT) — se verifică prin reîncărcarea cozii
export function inchidereFaraRezultat(res) {
  const { data, error } = res || {}
  return !!res && !error && Array.isArray(data) && data.length === 0
}
