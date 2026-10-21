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
//   • randInchisSigur    — fișierul din staging se șterge DOAR când rândul e sigur închis (F5)
//   Verificare r4 (21.10):
//   • stareInchidere     — 0 rânduri la închidere: decide citirea DIRECTĂ a rândului, nu coada modulului (F5)
//   • mesajInchidere     — ce afișează panoul după închidere (închis / neînchis / necunoscut)
//   • cuNeinchis / parseNeinchise — rândurile cu ținta SALVATĂ dar neînchise: reîncercarea doar
//                          închide, fără a doua inserare (R1 — Execuție / Logistică / UPA / HR)
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
// Regula (F2, rafinare deliberată a regulii „cea mai veche copie identică"): cea mai veche copie identică ACTIVĂ; dacă nu e niciuna activă, cea mai veche identică — o copie inactivă e istoric, nu ținta completării.
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
  return 'Documentul e salvat, dar rândul din coadă nu s-a putut închide' + det + ' — folosește «↻ Reîncearcă închiderea» (nu se mai salvează încă o dată).'
}

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
// expirării — aceeași valoare fara_expirare (o alegere „fără expirare" pusă între timp nu se calcă).
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
    if (campuri.some(c => c.camp === 'data_expirare')) g.push(f('fara_expirare', doc.fara_expirare))
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
//   limita  = limita de rânduri cerută: un răspuns care o atinge poate fi tăiat → 'trunchiat'
//   cuNumar = s-a cerut count:'exact' → count lipsă = 'eroare', count > rânduri primite = 'trunchiat'
// Trunchiat = nu știu dacă copia identică e printre rândurile lipsă → eroare de căutare, nu „liber".
export function rezultatCautareDosar(res, { limita = null, cuNumar = false } = {}) {
  const { data, error, count } = res || {}
  if (!res || error || !Array.isArray(data)) return { err:'eroare' }
  if (limita != null && data.length >= limita) return { err:'trunchiat' }
  if (cuNumar && !(typeof count === 'number' && Number.isFinite(count))) return { err:'eroare' }
  if (typeof count === 'number' && count > data.length) return { err:'trunchiat' }
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

// F5 (r4): starea rândului din ai_documente_inbox după UPDATE-ul care îl închide.
//   res    = răspunsul UPDATE-ului (.select('id'))
//   citire = citirea DIRECTĂ a rândului ({ data:{ id, status } | null, error } — select … .eq('id') .maybeSingle()),
//            făcută doar la 0 rânduri fără eroare. NU coada modulului: un rând mutat între timp în alt modul
//            lipsește din coada asta, dar e tot deschis (verificare r4, F5 rezidual).
// → 'inchis'     UPDATE-ul a întors rândul, sau rândul se vede cu status 'confirmat'
//   'deschis'    UPDATE-ul a dat eroare, sau rândul se vede și NU e confirmat
//   'necunoscut' 0 rânduri și rândul nu se vede (mutat / fără drept pe el) sau citirea a picat
// Doar 'inchis' șterge fișierul din staging; un fișier orfan e varianta sigură.
export function stareInchidere(res, citire) {
  const { data, error } = res || {}
  if (!res || error) return 'deschis'
  if (Array.isArray(data) && data.length) return 'inchis'
  if (!inchidereFaraRezultat(res)) return 'necunoscut'
  const { data:r, error:e } = citire || {}
  if (!citire || e || !r) return 'necunoscut'
  return r.status === 'confirmat' ? 'inchis' : 'deschis'
}

// F5: rândul e SIGUR închis? Abia atunci se șterge fișierul din staging — altfel reîncercarea și 👁 Vezi
// n-ar mai avea fișier. Eroare / necunoscut → nu.
export const randInchisSigur = (res, citire) => stareInchidere(res, citire) === 'inchis'

export const MESAJ_RAND_NEVERIFICAT = 'Documentul e salvat, dar nu pot verifica rândul din coadă (nu-l mai văd — mutat în alt modul / fără drept pe el — sau verificarea a picat). Nu știu dacă s-a închis, așa că fișierul din coadă rămâne; dacă rândul e încă în listă, folosește «↻ Reîncearcă închiderea».'

// Mesajul de după închidere → { tip:'ok' | 'warn' | 'err', msg }. err = mesajul din eroareInchidereRand.
export function mesajInchidere(stare, err, msgOk) {
  if (stare === 'inchis') return { tip:'ok', msg:msgOk }
  if (stare === 'necunoscut') return { tip:'warn', msg:MESAJ_RAND_NEVERIFICAT }
  return { tip:'err', msg:err || eroareInchidereRand(null) }
}

// R1 (r4): rândurile cu ținta deja SALVATĂ (document Execuție / Logistică / UPA / HR, certificat Financiar)
// dar neînchise în coadă: { [row.id]: { msgOk, args:[modulTinta, tip, entTip, entId, refId] } }.
// Cât timp rândul are marcaj, „Confirmă" doar reîncearcă închiderea cu aceleași argumente — fără
// mutaFisier + INSERT (altfel a doua copie a documentului / factura scăzută de două ori din plafonul UPA).
export const pendValid = v => !!v && typeof v === 'object' && typeof v.msgOk === 'string'
  && Array.isArray(v.args) && v.args.length === 5 && v.args[4] != null

// marcajul pus (val) sau scos (val null) → obiect NOU; același obiect dacă nu se schimbă nimic
export function cuNeinchis(map, id, val) {
  const m = map || {}
  if (val) return pendValid(val) ? { ...m, [id]:val } : m
  if (!Object.prototype.hasOwnProperty.call(m, String(id))) return m
  const out = { ...m }
  delete out[String(id)]
  return out
}

// textul din sessionStorage → marcajele valide (orice altceva se ignoră)
export function parseNeinchise(text) {
  let v
  try { v = JSON.parse(text || '{}') } catch (_) { return {} }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out = {}
  for (const [k, p] of Object.entries(v)) if (pendValid(p)) out[k] = p
  return out
}
