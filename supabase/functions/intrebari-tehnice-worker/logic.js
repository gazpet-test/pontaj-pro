// intrebari-tehnice-worker — logica pură (fără Deno / rețea), testată în vitest (logic.test.js). Folosită de index.ts.
//
// 1. autorizat(): poarta funcției. DOAR antetul x-intrebari-secret (64 hex) verificat de fn_verifica_secret deschide orice acțiune,
//    inclusiv „nume”. Un JWT de cont obișnuit sau cheia anon (antetul Authorization) NU contează: funcția rulează cu
//    verify_jwt = false și nu se uită la ele. Orice altceva decât `true` exact de la verificare (eroare, excepție, 't', 1) = refuz.
// 2. SURSE_NUME: de unde ia acțiunea „nume” numele pentru mascare (r2, review P1-1 — lista era doar angajați + beneficiari).
//    Fiecare sursă: tabelul, tipul cheii (keyset pe id: 'int' sau 'uuid'), coloanele de PERSOANE / FIRME / CUI și de unde e
//    verificat numele coloanelor ('migrare' = DDL din supabase/migrations; 'cod' = select-uri din src / fixture copiat din
//    producție — de confirmat ÎNAINTE de deploy cu interogarea din docs/intrebari/MASCARE_SI_VERDICT.md: coloana există ȘI
//    rolul cu care citește funcția (service_role) are drept de SELECT pe ea).
//    Doar coloane de NUME / CUI: niciodată telefon, e-mail, CNP, IBAN, adresă. Ce NU intră și de ce: în același document.
//    r3 (decizia owner-ului: localitățile rămân vizibile): `localitati` (opțional) = coloanele cu denumiri de localități din
//    tabelele DEJA citite — doar red_uat (numele UAT-ului și satele programate); fără tabele noi. Workerul le folosește ca să NU
//    ascundă un cuvânt care e și localitate, scris singur.
// 3. numeDinPlatforma(): citește toate sursele (keyset până la pagina goală, L23); ORICE eroare / tabel lipsă / coloană lipsă /
//    peste plafon → null (edge-ul răspunde 500, workerul nu preia nimic — fail closed, niciodată o listă tăiată în tăcere).
// 4. coadaDePreluat() / raspunsCoada(): acțiunea „coada” (14.11.2026) — doar citire, un boolean; detaliile la secțiunea 4.

export const SURSE_NUME = [
  // ── registre de persoane și terți ──
  { tabel: 'employees', cheie: 'int', persoane: ['name'], firme: [], cui: [], verificat: 'cod' },
  { tabel: 'beneficiari', cheie: 'int', persoane: ['contact_nume'], firme: ['nume'], cui: ['cif'], verificat: 'cod' },
  { tabel: 'logistica_furnizori', cheie: 'int', persoane: ['persoana_contact'], firme: ['nume'], cui: ['cui'], verificat: 'cod' },
  { tabel: 'logistica_subcontractori', cheie: 'int', persoane: ['contact_nume'], firme: ['nume_scurt', 'denumire_legala'], cui: ['cui'], verificat: 'cod' },
  { tabel: 'contracte_terti', cheie: 'int', persoane: ['contact_factura_nume', 'contact_mng_nume', 'contact_resp_exec_nume'], firme: ['partener_text'], cui: [], verificat: 'cod' },
  { tabel: 'hr_personal_extern', cheie: 'int', persoane: ['nume'], firme: ['firma'], cui: ['cui_firma'], verificat: 'cod' },
  { tabel: 'hr_recrutare_candidati', cheie: 'int', persoane: ['nume'], firme: [], cui: [], verificat: 'cod' },
  { tabel: 'ofertare_parteneri', cheie: 'int', persoane: [], firme: ['nume'], cui: ['cui'], verificat: 'cod' },
  { tabel: 'ofertare_brokeri', cheie: 'int', persoane: [], firme: ['nume'], cui: [], verificat: 'cod' },
  { tabel: 'logistica_service_parteneri', cheie: 'int', persoane: [], firme: ['nume'], cui: [], verificat: 'cod' },
  { tabel: 'sedinte_invitati', cheie: 'int', persoane: ['nume'], firme: ['firma'], cui: [], verificat: 'cod' },
  { tabel: 'red_detinatori', cheie: 'uuid', persoane: ['nume'], firme: [], cui: [], verificat: 'migrare' },
  { tabel: 'red_proiecte', cheie: 'uuid', persoane: ['reprezentant_tgz_nume', 'reprezentant_gazpet_nume', 'contact_nume'], firme: [], cui: [], verificat: 'migrare' },
  { tabel: 'red_uat', cheie: 'uuid', persoane: ['reprezentant_uat_nume'], firme: [], cui: [], verificat: 'migrare',
    localitati: ['nume', 'sate_zi1', 'sate_zi2', 'sate_zi3'] },
  // ── nume scrise liber în tabelele de lucru (furnizori / șoferi / delegați care pot lipsi din registre) ──
  { tabel: 'ofertare_oferte_furnizori', cheie: 'int', persoane: [], firme: ['furnizor'], cui: [], verificat: 'cod' },
  { tabel: 'ofertare_preturi_materiale', cheie: 'int', persoane: [], firme: ['furnizor'], cui: [], verificat: 'cod' },
  { tabel: 'contracte_subcontract_facturi', cheie: 'int', persoane: [], firme: ['furnizor_text'], cui: [], verificat: 'cod' },
  { tabel: 'executie_tura_subcontractori', cheie: 'int', persoane: [], firme: ['firma_text'], cui: [], verificat: 'cod' },
  { tabel: 'facturi_emise', cheie: 'int', persoane: ['contact_nume', 'delegat_nume'], firme: ['beneficiar_nume'], cui: ['beneficiar_cif'], verificat: 'cod' },
  { tabel: 'logistica_transporturi', cheie: 'int', persoane: ['sofer_extern_nume'], firme: [], cui: [], verificat: 'cod' },
  { tabel: 'eip_intrari', cheie: 'int', persoane: [], firme: ['furnizor_nume'], cui: ['furnizor_cui'], verificat: 'migrare' },
  // 14.11.2026 — `izo_documente_intrare` (furnizor, furnizor_cif) a fost SCOS: tabelele modulului de izometrii sunt închise
  // intenționat pentru service_role (fără niciun drept), deci funcția nu le poate citi, iar o sursă necitibilă oprește lista
  // întreagă (acțiunea „nume” răspundea 500 la pornire). Nu se dă drept nou pentru o funcție de mascare. Denumirile și CUI-ul
  // aflate doar acolo pierd acoperirea prin listă: tiparele le pot masca în formele recunoscute (formă juridică după nume, „RO” /
  // „CUI” în fața codului); fără ele pot rămâne vizibile. Vezi „Ce NU intră și de ce” din documentul de mai sus.
]

export const NUME_MAX_TABEL = 100000      // rânduri pe tabel; peste → null (fără tăiere tăcută)
export const NUME_MAX_LISTA = 200000      // valori distincte pe listă (persoane / firme / cui) — aceeași limită în mascare.py
const PAGINA = 1000                       // plafonul max-rows al PostgREST
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Poarta: true DOAR dacă antetul e 64 hex ȘI verificaSecret(antet) întoarce exact `true`. Orice eroare = refuz. */
export async function autorizat(antet, verificaSecret) {
  if (typeof antet !== 'string' || !/^[0-9a-f]{64}$/.test(antet)) return false
  try { return (await verificaSecret(antet)) === true } catch (_) { return false }
}

/** Coloanele citite dintr-o sursă (id + numele / CUI-urile), fără duplicate. */
export function coloane(s) {
  return ['id', ...new Set([...s.persoane, ...s.firme, ...s.cui, ...(s.localitati || [])])].join(', ')
}

/** Toate rândurile unui tabel, keyset pe id până la pagina goală. `pagina(tabel, coloane, dupa)` → {data, error}.
 *  null = eroare / id lipsă, invalid sau neordonat / peste NUME_MAX_TABEL. */
export async function toateRandurile(pagina, s) {
  const out = []
  let dupa = null
  for (;;) {
    const { data, error } = await pagina(s.tabel, coloane(s), dupa)
    if (error || !Array.isArray(data)) return null
    if (!data.length) return out
    for (const r of data) out.push(r)
    if (out.length > NUME_MAX_TABEL) return null
    const u = data[data.length - 1]?.id
    if (s.cheie === 'int') {
      const n = Number(u)
      if (!Number.isSafeInteger(n) || (dupa !== null && !(n > dupa))) return null
      dupa = n
    } else {
      if (typeof u !== 'string' || !UUID.test(u) || (dupa !== null && !(u > dupa))) return null
      dupa = u
    }
  }
}

function adauga(set, randuri, camp) {
  for (const r of randuri) {
    const v = r?.[camp]
    if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) set.add(String(v).trim().slice(0, 300))
  }
}

/** {persoane, firme, cui, localitati} din toate SURSE_NUME, sau null (vezi mai sus). Angajații lipsă = null (citire eșuată). */
export async function numeDinPlatforma(pagina, surse = SURSE_NUME) {
  const persoane = new Set(), firme = new Set(), cui = new Set(), localitati = new Set()
  for (const s of surse) {
    const r = await toateRandurile(pagina, s)
    if (!r) return null
    if (s.tabel === 'employees' && !r.length) return null
    for (const c of s.persoane) adauga(persoane, r, c)
    for (const c of s.firme) adauga(firme, r, c)
    for (const c of s.cui) adauga(cui, r, c)
    for (const c of s.localitati || []) adauga(localitati, r, c)
  }
  if ([persoane, firme, cui, localitati].some(x => x.size > NUME_MAX_LISTA)) return null
  return { persoane: [...persoane], firme: [...firme], cui: [...cui], localitati: [...localitati] }
}

// ─── 4. Acțiunea „coada” (14.11.2026, fără migrare): DOAR CITIRE — are `preia` ceva de făcut ACUM? ───
// Workerul o întreabă la fiecare rulare, înaintea listei de nume: coada goală → nu mai încarcă numele (21 de tabele) degeaba.
// Răspunsul e doar un boolean, niciun conținut de întrebare. Nu preia, nu scrie, nu ia lock-uri.
// Aceleași condiții ca fn_intrebari_preia (ultima versiune: migrarea 20261131e), în aceeași ordine:
//   1. o întrebare „in_lucru” preluată de peste 30 de minute → `preia` are de lucru (o închide cu eroare + notificarea autorului),
//      chiar peste plafon — altfel o preluare întreruptă ar rămâne deschisă cât timp coada e goală;
//   2. plafonul zilnic: ≥ 40 de preluări azi (ziua Europe/Bucharest), fără cele 'amanat' → `preia` nu dă nimic;
//   3. o întrebare 'noua' (inclusiv una amânată: amânarea o readuce imediat în 'noua', schema n-are termen de amânare).
// Direcția greșelii e mereu „are ceva” (worker → fluxul de azi), niciodată „goală” când `preia` ar prelua: pragul de expirare
// vine cu o marjă de 60 s pentru ceasul edge-ului față de al BD, iar plafonul se numără „toate − amânate”, în această ordine,
// deci o scriere concurentă între cele două citiri doar micșorează numărul. Ce e diferit de `preia`: nu sare rândurile blocate
// (SKIP LOCKED) — o întrebare tocmai preluată de altă rulare poate da „are ceva” o dată, ceea ce costă doar o listă de nume.
// Testul `coada: aceleași constante ca fn_intrebari_preia` (logic.test.js) pică dacă migrarea schimbă pragul / plafonul / stările.
export const COADA_EXPIRARE_MIN = 30      // ca `preluat_la < now() - interval '30 minutes'`
export const COADA_MARJA_SEC = 60         // ceasul edge-ului poate fi în urma BD: spunem „are ceva” cu un minut mai devreme
export const COADA_PLAFON_ZI = 40         // ca `>= 40` din fn_intrebari_preia
const ZI_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit',
                                                  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function partiBucuresti(t) {
  const p = {}
  for (const x of ZI_FMT.formatToParts(t)) p[x.type] = x.value
  return p
}

/** Începutul zilei curente Europe/Bucharest (miezul nopții local) ca Date, sau null. Exact și în zilele schimbării orei:
 *  miezul nopții are offset +2 (iarna) sau +3 (vara); se alege cel care dă ora locală 00:00 în aceeași zi (L17, fără offset fix). */
export function inceputZiBucuresti(acum) {
  if (!(acum instanceof Date) || !Number.isFinite(acum.getTime())) return null
  const p = partiBucuresti(acum)
  const zi = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))
  for (const ore of [3, 2]) {
    const t = new Date(zi - ore * 3600e3), q = partiBucuresti(t)
    if (q.year === p.year && q.month === p.month && q.day === p.day && q.hour === '00' && q.minute === '00') return t
  }
  return null
}

/** Cele patru numărători, ca date (tabel + filtre [op, coloană, valoare], op ∈ eq / lt / gte); index.ts le execută cu
 *  `select('id', { count: 'exact', head: true })`. null dacă `acum` e invalid. */
export function interogariCoada(acum) {
  const zi = inceputZiBucuresti(acum)
  if (!zi) return null
  const prag = new Date(acum.getTime() - COADA_EXPIRARE_MIN * 60e3 + COADA_MARJA_SEC * 1e3).toISOString()
  return {
    expirate: { tabel: 'intrebari_tehnice', filtre: [['eq', 'stare', 'in_lucru'], ['lt', 'preluat_la', prag]] },
    preluariAzi: { tabel: 'intrebari_preluari', filtre: [['gte', 'preluat_la', zi.toISOString()]] },
    amanateAzi: { tabel: 'intrebari_preluari', filtre: [['gte', 'preluat_la', zi.toISOString()], ['eq', 'rezultat', 'amanat']] },
    noua: { tabel: 'intrebari_tehnice', filtre: [['eq', 'stare', 'noua']] },
  }
}

/** true = `preia` are ceva de făcut acum; false = nimic; null = nu se știe (eroare de citire, număr invalid, `acum` invalid) —
 *  edge-ul răspunde atunci 500, iar workerul merge pe fluxul de azi (L18: eroarea nu e „coadă goală”).
 *  `numara(tabel, filtre)` → { count, error }. */
export async function coadaDePreluat(numara, acum) {
  const q = interogariCoada(acum)
  if (!q) return null
  const n = async x => {
    try {
      const { count, error } = await numara(x.tabel, x.filtre)
      return !error && Number.isSafeInteger(count) && count >= 0 ? count : null
    } catch (_) { return null }
  }
  const expirate = await n(q.expirate)
  if (expirate === null) return null
  if (expirate > 0) return true
  const toate = await n(q.preluariAzi)               // ÎNTÂI toate, APOI amânatele (vezi sus: o scriere între ele doar micșorează)
  if (toate === null) return null
  const amanate = await n(q.amanateAzi)
  if (amanate === null) return null
  if (toate - amanate >= COADA_PLAFON_ZI) return false
  const noua = await n(q.noua)
  if (noua === null) return null
  return noua > 0
}

/** Răspunsul acțiunii „coada”: 200 { de_preluat: boolean } sau 500 — fără alt conținut. */
export async function raspunsCoada(numara, acum) {
  const r = await coadaDePreluat(numara, acum)
  return typeof r === 'boolean' ? { status: 200, corp: { de_preluat: r } } : { status: 500, corp: { error: 'Eroare internă' } }
}
