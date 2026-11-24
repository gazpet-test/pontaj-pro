// Achiziții — retur la furnizor (TKT-2026-0347), PR2 interfața: funcțiile pure ale ecranelor (fără React, fără Supabase).
// Contractul cu baza de date = RPC-urile din migrarea 20270110a (PR1): fn_cf_receptie_adauga, fn_cf_intra_stoc, fn_cf_retur_inregistreaza,
// fn_cf_retur_anuleaza, fn_cf_retur_inchide_fara_inlocuire, fn_cf_reconciliaza_linie, fn_stoc_sterge_pozitie. Toate regulile se impun în BD;
// aici doar se pregătesc cererile, se afișează limitele și se traduc refuzurile.

// ─── Cantități exacte, în miimi întregi ──────────────────────────────────────────────────────────────────────────────────────────────
// RPC-urile refuză mai mult de 3 zecimale (stocuri.cantitate e numeric(15,3)); 12,5 − 10,25 în virgulă mobilă poate da 2,2500000000000004,
// deci diferențele se calculează pe întregi (miimi) și se trimit înapoi ca număr cu cel mult 3 zecimale.
const PLAFON_MII = 1e15 // 1e12 unități (plafonul din fn_cf_cantitate_valida_intern) × 1000

// valoare din BD (număr JSON) sau din <input type="number"> (text cu punct) → miimi întregi; null = gol / invalid / peste 3 zecimale
export function laMii(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    const r = Math.round(v * 1000)
    if (Math.abs(v * 1000 - r) > Math.abs(r) * 4 * Number.EPSILON + 1e-9) return null
    return Math.abs(r) < PLAFON_MII ? (r === 0 ? 0 : r) : null
  }
  if (typeof v !== 'string') return null
  const t = v.trim()
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t)
  if (!m) return null
  const frac = m[3] || ''
  if (/[^0]/.test(frac.slice(3))) return null
  const r = Number(m[2]) * 1000 + Number((frac.slice(0, 3) + '000').slice(0, 3))
  if (!Number.isSafeInteger(r) || r >= PLAFON_MII) return null
  return m[1] === '-' && r !== 0 ? -r : r
}
export const dinMii = (n) => (n === null || n === undefined ? null : n / 1000)
export const fmtMii = (n) => (n === null || n === undefined ? '—'
  : (n / 1000).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 3 }))

// ─── Dovada de recepție și cantitatea efectivă ───────────────────────────────────────────────────────────────────────────────────────
// L19: oglinda lui fn_cf_dovada_receptie_intern (20270110a) — aceleași condiții, același refuz pe necunoscut (fail-closed: o valoare
// lipsă contează ca dovadă). Paritatea e testată pe tabelul de cazuri din achizitiiRetur.test.js.
export const STARI_RECEPTIONATE = ['receptionata', 'in_stoc']
export function dovadaReceptie(linie, comanda, { areJurnal = false } = {}) {
  if (!linie || !comanda) return true
  if (linie.cantitate_primita !== null && linie.cantitate_primita !== undefined) return true
  if (linie.cantitate_intrata_stoc === null || linie.cantitate_intrata_stoc === undefined) return true
  if (Number(linie.cantitate_intrata_stoc) > 0) return true
  if (comanda.receptie_mp_la || comanda.receptie_achizitii_la) return true
  if (comanda.status === null || comanda.status === undefined) return true
  if (STARI_RECEPTIONATE.includes(comanda.status)) return true
  return !!areJurnal
}
// cantitatea primită EFECTIV (sensul de azi, spec §3.0): NULL = „recepție fără repere” = comandată, dar doar dacă există dovada recepției
export function primitaEfectivaMii(linie, comanda) {
  if (linie.cantitate_primita !== null && linie.cantitate_primita !== undefined) return laMii(Number(linie.cantitate_primita))
  return dovadaReceptie(linie, comanda) ? laMii(Number(linie.cantitate) || 0) : 0
}
export const intrataMii = (linie) => laMii(Number(linie.cantitate_intrata_stoc) || 0)
// linia moștenită (mișcări vechi legate doar de comandă) — returul / predarea / corectura negativă așteaptă reconcilierea (spec §3.3b)
export const deReconciliat = (linie) => linie?.intrare_reconciliata === false

// ─── Recepția incrementală („Recepție pe repere” trimite doar diferența) ─────────────────────────────────────────────────────────────
// valoareNoua = textul din formular. Gol = nicio schimbare (nu mai există „înapoi la necompletat”: cantitatea se corectează în jos).
// Întoarce { schimbare:false } | { eroare } | { schimbare:true, delta, primitaCitita } — primitaCitita = valoarea BRUTĂ citită (CAS în RPC).
export function diferentaReceptie(linie, valoareNoua, comanda) {
  if (valoareNoua === null || valoareNoua === undefined || String(valoareNoua).trim() === '') return { schimbare: false }
  const nou = laMii(String(valoareNoua))
  if (nou === null || nou < 0) return { eroare: `„${linie.denumire}”: cantitate invalidă (număr ≥ 0, cel mult 3 zecimale)` }
  const vechi = primitaEfectivaMii(linie, comanda)
  if (vechi === null) return { eroare: `„${linie.denumire}”: cantitatea primită din BD nu se poate citi exact — reîncărcați pagina` }
  // „0” scris explicit pe un reper fără nicio recepție (primit NULL, fără dovadă): fn_cf_receptie_adauga refuză cantitatea 0
  // (CF_CANTITATE_INVALIDA), deci nu există „recepție de zero” în BD. Tratat ca „nicio schimbare”, reperul ar rămâne NULL și la recepția
  // comenzii ar conta drept primit integral (PV 2 = comandată) → refuz explicit, cu calea corectă (reperul se modifică / se șterge).
  if (nou === 0 && (linie.cantitate_primita === null || linie.cantitate_primita === undefined) && !dovadaReceptie(linie, comanda)) {
    return { eroare: `„${linie.denumire}”: reperul nu are nicio recepție, iar „0” nu se poate înregistra ca recepție. Lăsați câmpul gol dacă marfa nu a sosit încă; dacă furnizorul nu mai livrează reperul, folosiți „✏️ Modifică repere” (cantitate sau ștergere) înainte de recepție.` }
  }
  const delta = nou - vechi
  if (delta === 0) return { schimbare: false }
  if (delta < 0) {
    if (deReconciliat(linie)) return { eroare: `„${linie.denumire}”: recepție veche nereconciliată — cereți reconcilierea înainte de a scădea cantitatea` }
    const intrat = intrataMii(linie)
    if (intrat !== null && nou < intrat) {
      return { eroare: `„${linie.denumire}”: primit nu poate coborî sub ${fmtMii(intrat)} (intrat în stoc); pentru marfa intrată folosiți „↩️ Retur”` }
    }
  }
  return { schimbare: true, delta: dinMii(delta), primitaCitita: linie.cantitate_primita ?? null }
}

// ─── Retururi: rezumat pe linie, „de înlocuit”, redeschiderea recepției ──────────────────────────────────────────────────────────────
const anulateDin = (retururi) => new Set((retururi || []).filter(r => r.tip === 'anulare').map(r => r.retur_id))
const esteAnulat = (r, anulate) => r.inchis_fel === 'anulat' || anulate.has(r.id)
// cât mai e de înlocuit dintr-un retur (spec §3.3.3): doar retururile deschise care așteaptă înlocuire; partea renunțată nu reapare
export function deInlocuitMii(retur) {
  if (!retur || retur.tip !== 'retur' || !retur.asteapta_inlocuire || retur.inchis_fel) return 0
  const rest = (laMii(Number(retur.cantitate)) || 0) - (laMii(Number(retur.cantitate_inlocuita)) || 0) - (laMii(Number(retur.cantitate_renuntata)) || 0)
  return rest > 0 ? rest : 0
}
export const deInlocuit = (retur) => dinMii(deInlocuitMii(retur))
export function rezumatLinie(linieId, retururi) {
  const anulate = anulateDin(retururi)
  const ale = (retururi || []).filter(r => r.tip === 'retur' && String(r.linie_id) === String(linieId))
  let returnat = 0, deInl = 0
  const deschise = []
  for (const r of ale) {
    if (esteAnulat(r, anulate)) continue
    returnat += laMii(Number(r.cantitate)) || 0
    const d = deInlocuitMii(r)
    deInl += d
    if (!r.inchis_fel) deschise.push(r)
  }
  return { returnatMii: returnat, deInlocuitMii: deInl, deschise, areRetururi: ale.length > 0 }
}
// spec §3.4: „Recepție pe repere” și „Predare în stoc” se redeschid în receptionata / in_stoc cât timp linia are „de înlocuit” > 0
// sau marfă primită, dar neintrată în stoc
export function poateRedeschideReceptia(linie, retururi, comanda) {
  if (rezumatLinie(linie.id, retururi).deInlocuitMii > 0) return true
  const p = primitaEfectivaMii(linie, comanda)
  const i = intrataMii(linie)
  return p !== null && i !== null && p > i
}
export const receptieRedeschisa = (comanda, retururi) =>
  STARI_RECEPTIONATE.includes(comanda.status) && (comanda.linii || []).some(l => poateRedeschideReceptia(l, retururi, comanda))

// ─── Fereastra de retur: limitele părții din stoc (spec §3.0) ────────────────────────────────────────────────────────────────────────
// returnabil maxim = primita efectivă; din stoc între max(0, q − (primita − intrata)) și min(q, intrata), implicit maximul.
// cantitate = în unități (număr sau textul din formular); limitele întoarse sunt în MIIMI (…Mii).
export function limiteDinStoc(linie, cantitate, comanda) {
  const q = typeof cantitate === 'number' ? laMii(cantitate) : laMii(cantitate === null || cantitate === undefined ? null : String(cantitate))
  const p = primitaEfectivaMii(linie, comanda)
  const i = intrataMii(linie)
  if (p === null || i === null) return { eroare: 'Cantitățile reperului nu se pot citi exact — reîncărcați pagina.' }
  if (q === null || q <= 0) return { eroare: 'Cantitatea returnată trebuie să fie pozitivă, cu cel mult 3 zecimale.', maxReturMii: p }
  if (q > p) return { eroare: `Se pot returna cel mult ${fmtMii(p)}.`, maxReturMii: p }
  const minMii = Math.max(0, q - (p - i))
  const maxMii = Math.min(q, i)
  return { cantitateMii: q, minMii, maxMii, implicitMii: maxMii, maxReturMii: p }
}

// ─── Traducerea refuzurilor CF_* (cod stabil la începutul mesajului, SQLSTATE P0001; dreptul = 42501) ────────────────────────────────
const MESAJ_SCHIMBAT = 'Datele s-au schimbat între timp — reîncărcați pagina.'
const MESAJE_CF = {
  CF_CLIENT_VECHI: MESAJ_SCHIMBAT,
  CF_VALOARE_SCHIMBATA: MESAJ_SCHIMBAT,
  CF_CHEIE_ALTI_PARAMETRI: MESAJ_SCHIMBAT,
  CF_CHEIE_ALT_AUTOR: MESAJ_SCHIMBAT,
  CF_NERECONCILIATA: 'Recepție veche nereconciliată — cereți reconcilierea.',
  CF_DREPT: 'Nu aveți drept pentru această operație.',
  CF_COMANDA_INVALIDA: 'Comanda nu permite recepție sau retur (anulată, respinsă sau de servicii).',
  CF_FARA_RECEPTIE: 'Faceți întâi recepția reperului.',
  CF_MATERIAL_RECEPTIONAT: 'Materialul a fost recepționat — corectați prin retur sau ajustare de stoc.',
  CF_ISTORIC_PROTEJAT: 'Poziție cu istoric de achiziție / retur — nu se șterge; corectați prin ajustare.',
  CF_OCUPAT: 'Poziția de stoc e folosită de o operație în curs — reîncercați peste câteva secunde.',
  CF_STOC_AMBIGUU: 'Poziția de stoc apare de mai multe ori — de corectat întâi în Magazie.',
  CF_LOCATIE_INVALIDA: 'Locație invalidă: returul / intrarea se face doar în sediu sau în proiectul comenzii.',
  CF_DENUMIRE_NECANONICA: 'Transportul direct cere denumirea reperului fără spații la capete — corectați reperul.',
  CF_MOTIV: 'Motivul trebuie să aibă cel puțin 5 caractere.',
  CF_PV_INVALID: 'PV-ul returului nu aparține acestei comenzi.',
  CF_DEJA_ANULAT: 'Returul a fost deja anulat.',
  CF_RETUR_INCHIS: 'Returul nu mai așteaptă înlocuire.',
  CF_DEJA_RECONCILIATA: 'Linia este deja reconciliată.',
  CF_RETUR_INEXISTENT: 'Returul nu mai există — reîncărcați pagina.',
  CF_LINIE_INEXISTENTA: 'Reperul nu mai există — reîncărcați pagina.',
  CF_POZITIE_INEXISTENTA: 'Poziția de stoc nu mai există — reîncărcați pagina.',
  CF_MUTARE_REFUZATA: 'Reperul are recepții, retururi sau intrări în stoc — nu se mută în altă comandă.',
  CF_CHEIE_LIPSA: 'Cererea nu are cheie de operație — reîncărcați pagina.',
  CF_INVARIANT: 'Verificarea internă a cantităților a eșuat — nimic nu s-a salvat; anunțați administratorul.',
  CF_DEJA_APLICATA: 'Migrarea e deja aplicată.',
}
// codurile cu cifre în mesajul serverului: eticheta noastră + detaliul (ex. „în stoc sunt doar 5”)
const MESAJE_CF_CU_DETALIU = {
  CF_STOC_INSUFICIENT: 'Stoc insuficient',
  CF_PESTE_PRIMIT: 'Cantitate peste primit',
  CF_SUB_INTRAT: 'Cantitatea primită nu poate coborî sub cea intrată în stoc',
  CF_DIN_STOC_INVALID: 'Partea din stoc e în afara limitelor',
  CF_CANTITATE_INVALIDA: 'Cantitate invalidă',
  CF_RETUR_INLOCUIT: 'Returul are deja înlocuire recepționată și nu se mai anulează',
}
export const MESAJ_NECUNOSCUT = 'Rezultat necunoscut (conexiunea s-a întrerupt). Apăsați din nou: se retrimite exact aceeași cerere, fără dublare.'
export function codCF(error) {
  const m = /^(CF_[A-Z_]+):/.exec(String(error?.message || ''))
  return m ? m[1] : null
}
export function mesajEroareCF(error) {
  if (!error) return ''
  const cod = codCF(error)
  if (cod && MESAJE_CF[cod]) return MESAJE_CF[cod]
  if (cod && MESAJE_CF_CU_DETALIU[cod]) {
    const detaliu = String(error.message).slice(cod.length + 1).trim()
    return `${MESAJE_CF_CU_DETALIU[cod]}: ${detaliu}`
  }
  if (error.code === '42501') return MESAJE_CF.CF_DREPT
  if (error.code === '23503') return 'Reperul are recepții sau retururi legate — nu se poate șterge.'
  return String(error.message || error)
}

// ─── Rezultatul unui apel: ok / refuz cert / necunoscut (L05) ────────────────────────────────────────────────────────────────────────
// Doar un răspuns 4xx e refuz cert (tranzacția s-a anulat, nimic scris). Rețea căzută (status 0), timeout, 5xx = NECUNOSCUT: cererea
// se poate să se fi comis → se retrimite IDENTIC (aceeași cheie, aceiași parametri); serverul întoarce rezultatul comis, fără efect dublu.
export function clasificaRezultat({ error, status } = {}) {
  if (!error) return 'ok'
  const s = Number(status)
  if (Number.isFinite(s) && s >= 400 && s < 500) return 'refuz'
  return 'necunoscut'
}

// ─── Cheia de operație (L04): una pe fereastră / intenție, refolosită la reîncercare ─────────────────────────────────────────────────
export const uuidNou = () => globalThis.crypto.randomUUID()
export function cheieFereastra(gen = uuidNou) {
  let cheie = null
  return { get: () => (cheie || (cheie = gen())), reinnoieste: () => { cheie = null } }
}

// ─── Registrul local al cererilor neconfirmate (L05) ─────────────────────────────────────────────────────────────────────────────────
// O intrare pe operație (nu o listă comună), scrisă și verificată ÎNAINTE de primul RPC (dacă nu se poate scrie, nu se trimite nimic).
// Iese doar la rezultat dovedit (toți pașii ok sau un refuz cert). Un plan rămas după rezultat necunoscut se RETRIMITE identic.
const PREFIX_REGISTRU = 'gazpet.achizitii.cf_plan.'
export function registruPlanuri(storage) {
  return {
    citeste(id) {
      let txt
      try { txt = storage.getItem(PREFIX_REGISTRU + id) } catch { return { corupt: true } }
      if (txt === null || txt === undefined) return null
      try {
        const p = JSON.parse(txt)
        if (!p || p.v !== 1 || !Array.isArray(p.pasi) || !p.pasi.length) return { corupt: true }
        return p
      } catch { return { corupt: true } }
    },
    scrie(id, plan) {
      try {
        const txt = JSON.stringify(plan)
        storage.setItem(PREFIX_REGISTRU + id, txt)
        return storage.getItem(PREFIX_REGISTRU + id) === txt
      } catch { return false }
    },
    sterge(id) { try { storage.removeItem(PREFIX_REGISTRU + id) } catch { /* rămâne; se retrimite identic, fără efect dublu */ } },
  }
}
export const planNou = (pasi, info = {}) => ({ v: 1, creat_la: new Date().toISOString(), ...info, pasi })

// rulează pașii în ordine; se oprește la primul refuz cert sau rezultat necunoscut
export async function ruleazaPlan(rpcFn, plan) {
  const rezultate = []
  for (let k = 0; k < plan.pasi.length; k++) {
    const pas = plan.pasi[k]
    let r
    try { r = await rpcFn(pas.rpc, pas.args) } catch (e) { r = { error: e, status: 0 } }
    const clasa = clasificaRezultat(r || {})
    if (clasa !== 'ok') return { stare: clasa, pas: k, eticheta: pas.eticheta, error: r.error, rezultate }
    rezultate.push(r.data)
  }
  return { stare: 'ok', rezultate }
}

// planul operației `id`: dacă există unul neconfirmat îl retrimite EXACT; altfel îl construiește, îl scrie în registru, apoi îl trimite.
// construieste() → { pasi, ... } | { eroare } | null (nimic de făcut). pastreazaLaOk: planul rămâne până confirmă apelantul (pașii de după RPC).
export async function executaPlan({ registru, rpcFn, id, construieste, pastreazaLaOk = false }) {
  let plan = registru.citeste(id)
  const reluat = !!plan
  if (plan?.corupt) {
    registru.sterge(id)
    return { stare: 'refuz', mesaj: 'Cererea salvată local e deteriorată și a fost scoasă — reîncărcați pagina și verificați ce s-a înregistrat.' }
  }
  if (!plan) {
    const c = construieste()
    if (!c) return { stare: 'gol' }
    if (c.eroare) return { stare: 'refuz', faza: 'validare', mesaj: c.eroare }
    plan = planNou(c.pasi, c.info || {})
    if (!plan.pasi.length) return { stare: 'gol' }
    if (!registru.scrie(id, plan)) {
      return { stare: 'refuz', mesaj: 'Browserul nu permite salvarea locală a cererii (necesară pentru reîncercare sigură) — nu s-a trimis nimic.' }
    }
  }
  const rez = await ruleazaPlan(rpcFn, plan)
  if (rez.stare === 'refuz' || (rez.stare === 'ok' && !pastreazaLaOk)) registru.sterge(id)
  const mesaj = rez.stare === 'ok' ? ''
    : rez.stare === 'necunoscut' ? MESAJ_NECUNOSCUT
    : (rez.eticheta ? `${rez.eticheta}: ` : '') + mesajEroareCF(rez.error) + (rez.pas > 0 ? ` (pașii anteriori, ${rez.pas}, s-au înregistrat)` : '')
  return { ...rez, reluat, plan, mesaj }
}

// ─── Planurile fluxurilor din cardul comenzii ────────────────────────────────────────────────────────────────────────────────────────
const sortate = (linii) => (linii || []).slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0) || (a.id || 0) - (b.id || 0))

// „Recepție pe repere”: un pas fn_cf_receptie_adauga pe fiecare linie schimbată
export function planReceptie(comanda, valori, gen = uuidNou) {
  const pasi = [], erori = []
  for (const l of sortate(comanda.linii)) {
    if (!Object.prototype.hasOwnProperty.call(valori || {}, l.id)) continue
    const d = diferentaReceptie(l, valori[l.id], comanda)
    if (d.eroare) { erori.push(d.eroare); continue }
    if (!d.schimbare) continue
    pasi.push({ rpc: 'fn_cf_receptie_adauga', eticheta: l.denumire,
      args: { p_cheie: gen(), p_linie_id: l.id, p_cantitate: d.delta, p_primita_citita: d.primitaCitita } })
  }
  if (erori.length) return { eroare: erori.join('\n') }
  return pasi.length ? { pasi } : null
}

// Formularul „Recepție pe repere” (L01 / L24): valorile omului și diferențele trimise se raportează la ACELAȘI instantaneu — cel de la
// deschiderea formularului — nu la comanda reîncărcată între timp. Altfel: deschis la 100, scris 110 (intenția +10), un retur concurent
// coboară primit la 80 → salvarea ar trimite +30 cu CAS 80 și ar șterge efectul returului. Cu instantaneul, CAS-ul pleacă cu 100 și
// serverul refuză (CF_VALOARE_SCHIMBATA); după refuz formularul se închide (rezultatSalvareReceptie) și se redeschide pe valorile noi.
const CAMPURI_LINIE_RECEPTIE = ['denumire', 'cantitate', 'cantitate_primita', 'cantitate_intrata_stoc', 'intrare_reconciliata']
const CAMPURI_COMANDA_RECEPTIE = ['status', 'este_servicii', 'receptie_mp_la', 'receptie_achizitii_la']
export function instantaneuReceptie(comanda) {
  return { ...comanda, linii: (comanda?.linii || []).map(l => ({ ...l })) }
}
// valorile afișate la deschidere = primit EFECTIV (o recepție fără repere = comandată); gol = reper fără nicio recepție
export function valoriInitialeReceptie(baza) {
  const init = {}
  for (const l of baza?.linii || []) {
    const ef = primitaEfectivaMii(l, baza)
    init[l.id] = l.cantitate_primita != null || ef > 0 ? String((ef ?? 0) / 1000) : ''
  }
  return init
}
// true dacă datele comenzii din care s-a deschis formularul nu mai sunt cele de acum (alt tab, alt utilizator, un retur, o predare)
export function instantaneuDepasit(baza, comanda) {
  if (!baza || !comanda) return false
  const v = (x) => (x === undefined ? null : x)
  if (CAMPURI_COMANDA_RECEPTIE.some(k => String(v(baza[k])) !== String(v(comanda[k])))) return true
  const a = baza.linii || [], b = comanda.linii || []
  if (a.length !== b.length) return true
  const dupaId = new Map(b.map(l => [String(l.id), l]))
  return a.some(l => {
    const n = dupaId.get(String(l.id))
    return !n || CAMPURI_LINIE_RECEPTIE.some(k => String(v(l[k])) !== String(v(n[k])))
  })
}
// ce face formularul după executaPlan: validare locală / necunoscut = rămâne deschis (la necunoscut se retrimite planul salvat, identic);
// refuz de la server sau plan corupt = se ÎNCHIDE și se reîncarcă (o a doua salvare nu are voie să trimită diferențe din valorile vechi)
export function rezultatSalvareReceptie(rez, numarComanda) {
  if (rez.stare === 'gol') return { inchide: true, reincarca: false, mesaj: 'Nicio cantitate schimbată.', tip: 'warn' }
  if (rez.stare === 'ok') {
    return { inchide: true, reincarca: true, tip: 'success',
      mesaj: `📦 Recepție pe repere actualizată pentru ${numarComanda}${rez.reluat ? ' (cererea anterioară, confirmată acum — verificați valorile)' : ''}.` }
  }
  if (rez.stare === 'necunoscut') return { inchide: false, reincarca: false, mesaj: rez.mesaj, tip: 'warn' }
  if (rez.faza === 'validare') return { inchide: false, reincarca: false, mesaj: rez.mesaj, tip: 'error' }
  return { inchide: true, reincarca: true, tip: 'error',
    mesaj: `${rez.mesaj}\nFormularul s-a închis: redeschideți „📦 Recepție pe repere” — valorile s-au reîncărcat din baza de date.` }
}

// predarea în stoc: partial = doar liniile cu „Recepție pe repere” completată (ca azi); altfel (PV 2) toate, cu NULL = comandată
export function planPredare(comanda, { partial = false } = {}, gen = uuidNou) {
  const pasi = [], blocate = []
  for (const l of sortate(comanda.linii)) {
    if (!l.denumire) continue
    if (partial && (l.cantitate_primita === null || l.cantitate_primita === undefined)) continue
    const p = primitaEfectivaMii(l, comanda), i = intrataMii(l)
    if (p === null || i === null) { blocate.push(`${l.denumire} (cantități ilizibile)`); continue }
    const rest = p - i
    if (rest <= 0) continue
    if (deReconciliat(l)) { blocate.push(`${l.denumire} (de reconciliat)`); continue }
    pasi.push({ rpc: 'fn_cf_intra_stoc', eticheta: l.denumire,
      args: { p_cheie: gen(), p_linie_id: l.id, p_cantitate: dinMii(rest), p_transfer_proiect: false } })
  }
  if (blocate.length) return { eroare: `Repere care nu pot intra în stoc acum: ${blocate.join(', ')}. Cereți reconcilierea (owner) înainte de predare.`, blocate }
  return pasi.length ? { pasi } : null
}

// recepție + transport direct la șantier: liniile fără nicio recepție (NULL fără dovadă) primesc întâi recepția integrală, apoi intrarea la
// sediu + transferul pe proiect, atomic pe linie (fn_cf_intra_stoc cu p_transfer_proiect)
export function planTransportDirect(comanda, gen = uuidNou) {
  const pasi = [], blocate = []
  for (const l of sortate(comanda.linii)) {
    if (!l.denumire) continue
    const nul = l.cantitate_primita === null || l.cantitate_primita === undefined
    const faraDovada = nul && !dovadaReceptie(l, comanda)
    const p = faraDovada ? laMii(Number(l.cantitate) || 0) : primitaEfectivaMii(l, comanda)
    const i = intrataMii(l)
    if (p === null || i === null) { blocate.push(`${l.denumire} (cantități ilizibile)`); continue }
    if (p - i <= 0) continue
    if (deReconciliat(l)) { blocate.push(`${l.denumire} (de reconciliat)`); continue }
    if (l.denumire !== l.denumire.trim()) { blocate.push(`${l.denumire} (spații la capetele denumirii)`); continue }
    if (faraDovada) {
      pasi.push({ rpc: 'fn_cf_receptie_adauga', eticheta: l.denumire,
        args: { p_cheie: gen(), p_linie_id: l.id, p_cantitate: dinMii(p), p_primita_citita: null } })
    }
    pasi.push({ rpc: 'fn_cf_intra_stoc', eticheta: l.denumire,
      args: { p_cheie: gen(), p_linie_id: l.id, p_cantitate: dinMii(p - i), p_transfer_proiect: true } })
  }
  if (blocate.length) return { eroare: `Repere care nu pot intra în stoc acum: ${blocate.join(', ')}.`, blocate }
  return pasi.length ? { pasi } : null
}

// ─── Cheile planurilor în registrul local + accesul la cererile neconfirmate (L05) ───────────────────────────────────────────────────
export const ID_PLAN = {
  receptie: (comandaId) => `receptie:${comandaId}`,
  retur: (linieId) => `retur:${linieId}`,
  reconciliere: (linieId) => `reconciliere:${linieId}`,
  anulare: (returId) => `anulare:${returId}`,
  inchidere: (returId) => `inchidere:${returId}`,
  predare: (comandaId, partial) => `${partial ? 'predare_partiala' : 'predare_pv2'}:${comandaId}`,
  transport: (comandaId) => `transport:${comandaId}`,
}
// O cerere neconfirmată rămâne accesibilă indiferent dacă operația ar mai fi permisă ACUM: un retur integral comis cu răspunsul pierdut
// lasă primit efectiv 0, deci butonul „↩️ Retur” ar dispărea și planul n-ar mai putea fi retrimis / confirmat. Cât există planul în
// registru, butonul apare; la retrimitere serverul întoarce rezultatul comis (sau refuză), iar planul iese din registru.
export const STARI_RETUR = ['emisa', 'in_tranzit', 'ajunsa', ...STARI_RECEPTIONATE]
export function poateDeschideRetur({ poateScrie, comanda, linie, retururiOk, areCerere }) {
  if (!poateScrie || !comanda || !linie) return false
  if (areCerere) return true
  return !comanda.este_servicii && STARI_RETUR.includes(comanda.status) && !!retururiOk && !deReconciliat(linie) && (primitaEfectivaMii(linie, comanda) || 0) > 0
}

// ─── Ferestrele cu o singură operație (retur, anulare, închidere, reconciliere): cheia ferestrei, validări ca în RPC ───────────────────
const motivValid = (m) => typeof m === 'string' && m.trim().length >= 5
// locațiile permise de RPC: sediul sau proiectul comenzii (CF_LOCATIE_INVALIDA altfel)
export function locatiiRetur(comanda) {
  const l = [{ cheie: 'sediu', locatie_tip: 'sediu', locatie_id: null, eticheta: 'Magazia centrală (sediu)' }]
  if (comanda?.proiect_id) l.push({ cheie: 'proiect', locatie_tip: 'proiect', locatie_id: comanda.proiect_id, eticheta: 'Stocul proiectului' })
  return l
}
export const locatieImplicita = (comanda) => (comanda?.livrare_tip === 'sediu' || !comanda?.proiect_id ? 'sediu' : 'proiect')

// stocLocatieMii: stocul citit în fereastră (null = necunoscut → hotărăște serverul, sub lock); dinStoc '' = implicit (maximul)
export function planRetur({ linie, comanda, cantitate, dinStoc, locatie, motiv, pvPath, asteaptaInlocuire, cheie, stocLocatieMii = null }) {
  if (deReconciliat(linie)) return { eroare: MESAJE_CF.CF_NERECONCILIATA }
  const lim = limiteDinStoc(linie, cantitate, comanda)
  if (lim.eroare) return { eroare: lim.eroare }
  let din = lim.implicitMii
  if (dinStoc !== '' && dinStoc !== null && dinStoc !== undefined) {
    din = laMii(String(dinStoc))
    if (din === null || din < lim.minMii || din > lim.maxMii) return { eroare: `Partea din stoc trebuie să fie între ${fmtMii(lim.minMii)} și ${fmtMii(lim.maxMii)}.` }
  }
  const loc = locatiiRetur(comanda).find(x => x.cheie === locatie)
  if (!loc) return { eroare: MESAJE_CF.CF_LOCATIE_INVALIDA }
  if (din > 0 && stocLocatieMii !== null && din > stocLocatieMii) return { eroare: `Stoc insuficient: în locația aleasă sunt doar ${fmtMii(stocLocatieMii)}.` }
  if (!motivValid(motiv)) return { eroare: MESAJE_CF.CF_MOTIV }
  return { pasi: [{ rpc: 'fn_cf_retur_inregistreaza', eticheta: linie.denumire, args: {
    p_cheie: cheie, p_linie_id: linie.id, p_cantitate: dinMii(lim.cantitateMii), p_din_stoc: dinMii(din),
    p_locatie_tip: loc.locatie_tip, p_locatie_id: loc.locatie_id, p_motiv: motiv.trim(), p_pv_path: pvPath || null,
    p_asteapta_inlocuire: !!asteaptaInlocuire } }] }
}
export function planAnulareRetur({ retur, motiv, cheie }) {
  if (!retur || retur.tip !== 'retur' || retur.inchis_fel === 'anulat') return { eroare: MESAJE_CF.CF_DEJA_ANULAT }
  if ((laMii(Number(retur.cantitate_inlocuita)) || 0) > 0) return { eroare: `${MESAJE_CF_CU_DETALIU.CF_RETUR_INLOCUIT}.` }
  if (!motivValid(motiv)) return { eroare: MESAJE_CF.CF_MOTIV }
  return { pasi: [{ rpc: 'fn_cf_retur_anuleaza', eticheta: retur.denumire, args: { p_cheie: cheie, p_retur_id: retur.id, p_motiv: motiv.trim() } }] }
}
export function planInchidereRetur({ retur, motiv, cheie }) {
  if (!retur || retur.tip !== 'retur' || !retur.asteapta_inlocuire || retur.inchis_fel) return { eroare: MESAJE_CF.CF_RETUR_INCHIS }
  if (!motivValid(motiv)) return { eroare: MESAJE_CF.CF_MOTIV }
  return { pasi: [{ rpc: 'fn_cf_retur_inchide_fara_inlocuire', eticheta: retur.denumire, args: { p_cheie: cheie, p_retur_id: retur.id, p_motiv: motiv.trim() } }] }
}
export function planReconciliere({ linie, comanda, intrataStoc, motiv, cheie }) {
  if (!deReconciliat(linie)) return { eroare: MESAJE_CF.CF_DEJA_RECONCILIATA }
  const v = laMii(intrataStoc === null || intrataStoc === undefined ? null : String(intrataStoc))
  const p = primitaEfectivaMii(linie, comanda)
  if (v === null || p === null || v < 0 || v > p) return { eroare: `Intrat în stoc trebuie să fie între 0 și ${fmtMii(p)} (primit).` }
  if (!motivValid(motiv)) return { eroare: MESAJE_CF.CF_MOTIV }
  return { pasi: [{ rpc: 'fn_cf_reconciliaza_linie', eticheta: linie.denumire, args: { p_cheie: cheie, p_linie_id: linie.id, p_intrata_stoc: dinMii(v), p_motiv: motiv.trim() } }] }
}

// ─── Magazie: etichetele mișcărilor (Task 8) ─────────────────────────────────────────────────────────────────────────────────────────
export const MISCARE_META_RETUR = {
  retur_furnizor:         { label: 'Retur la furnizor',  emoji: '↩️', color: '#F85149' },
  retur_furnizor_anulare: { label: 'Anulare retur',      emoji: '↪️', color: '#3FB950' },
}
export const ETICHETE_INCHIDERE = { acoperit: '✅ înlocuit', renuntat: '🚫 închis fără înlocuire', anulat: '⛔ anulat' }
