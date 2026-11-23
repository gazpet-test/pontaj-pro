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

// ─── 4. Acțiunea „coada” (14.11.2026, fără migrare; r3 15.11.2026): DOAR CITIRE — e vreo întrebare în „noua” sau „in_lucru”? ───
// Workerul o întreabă la fiecare rulare, înaintea listei de nume: coada goală → nu mai încarcă numele (21 de tabele) degeaba.
// Răspunsul e doar un boolean, niciun conținut de întrebare. Nu preia, nu scrie, nu ia lock-uri.
// Condiția (r3, decizia coordonatorului după review-ul PR #1104): „are ceva” = există cel puțin o întrebare în starea 'noua' SAU
// în starea 'in_lucru', indiferent de vechime. Sunt exact stările pe care fn_intrebari_preia (ultima versiune: migrarea 20261131e)
// le citește: 'noua' (inclusiv una amânată sau reluată — amânarea și reluarea o readuc în 'noua') și 'in_lucru' (pe cea expirată o
// închide). „coada” NU are niciun ceas, nicio marjă și niciun prag: dacă o întrebare „în lucru” a expirat decide DOAR `preia`,
// în bază, cu ceasul bazei. Costul acceptat: cât o întrebare e „în lucru” (cel mult 30 de minute), rularea încarcă numele și
// `preia` nu face nimic — fluxul de dinainte de „coada”; workerul are lock, deci în timpul procesării nu pornește altă rulare.
// FĂRĂ plafonul zilnic și fără nicio dată calendaristică: cu plafonul atins și întrebări în așteptare „coada” spune „are ceva”,
// workerul încarcă numele și `preia` refuză — tot fluxul de dinainte de „coada”.
// O SINGURĂ citire: un singur SELECT count(*) cu OR pe cele două stări (PostgREST HEAD + `or=`), deci un singur instantaneu al bazei.
// GARANȚIA (și numai ea): nicio întrebare care există în starea 'noua' sau 'in_lucru' în momentul citirii nu e sărită; o întrebare
// pusă sau revenită în coadă după citire e luată la rularea următoare.
// Ce e diferit de `preia`: nu sare rândurile blocate (SKIP LOCKED), nu ține cont de plafon și nici de vechimea preluării — toate
// dau doar „are ceva” în plus, niciodată „goală” în plus.
// Testul `coada: aceleași stări ca fn_intrebari_preia` (logic.test.js) pică dacă migrarea schimbă stările citite de `preia`.
export const COADA_STARI = Object.freeze(['noua', 'in_lucru'])
const OP_COADA = new Set(['eq'])

/** Condiția „coada”, ca date: tabel + `oricare` = listă de condiții [op, coloană, valoare] legate prin OR. Fără niciun timp. */
export function interogareCoada() {
  return { tabel: 'intrebari_tehnice', oricare: COADA_STARI.map(s => ['eq', 'stare', s]) }
}

/** Filtrul PostgREST `or=(...)` pentru `oricare` (fără parantezele exterioare, cum le cere supabase-js `.or()`): fiecare condiție
 *  → `col.op."val"`, legate prin virgulă (OR). Valorile se pun mereu între ghilimele. Lista albă: op = eq, coloana [a-z_]+,
 *  valoarea [a-z_]+; altfel null (L13: fără continuare tăcută). */
export function filtruOrPostgrest(oricare) {
  if (!Array.isArray(oricare) || !oricare.length) return null
  const cond = c => (Array.isArray(c) && c.length === 3 && OP_COADA.has(c[0]) && /^[a-z_]+$/.test(c[1]) &&
                     typeof c[2] === 'string' && /^[a-z_]+$/.test(c[2]) ? `${c[1]}.${c[0]}."${c[2]}"` : null)
  const p = oricare.map(cond)
  return p.includes(null) ? null : p.join(',')
}

/** true = există cel puțin o întrebare în 'noua' / 'in_lucru' (vezi sus); false = niciuna în momentul citirii; null = nu se știe
 *  (eroare de citire, număr invalid, excepție) — edge-ul răspunde atunci 500, iar workerul merge pe fluxul de azi (L18).
 *  `numara({ tabel, oricare, or })` → { count, error } — O SINGURĂ chemare (index.ts folosește `or`, proba PGlite `oricare`). */
export async function coadaDePreluat(numara) {
  const q = interogareCoada()
  const or = filtruOrPostgrest(q.oricare)
  if (!or) return null
  try {
    const { count, error } = await numara({ tabel: q.tabel, oricare: q.oricare, or })
    if (error || !Number.isSafeInteger(count) || count < 0) return null
    return count > 0
  } catch (_) { return null }
}

/** Răspunsul acțiunii „coada”: 200 { de_preluat: boolean } sau 500 — fără alt conținut. */
export async function raspunsCoada(numara) {
  const r = await coadaDePreluat(numara)
  return typeof r === 'boolean' ? { status: 200, corp: { de_preluat: r } } : { status: 500, corp: { error: 'Eroare internă' } }
}
