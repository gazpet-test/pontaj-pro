// ofertare-genereaza-capitol v2.3 (24.09.2026) — scrie UN capitol din propunerea tehnică.
// v2.3 (noaptea Claude ↔ Copilot, după pilotul P0c Mânăstirea): INTERDICȚIA 5 — cerințele NECONFIRMATE (confirmata_de
//     NULL, adică fără E2 de om) nu devin bază de redactare pe tăcute. Vezi lista interdicțiilor mai jos.
// v2 (Domnești, Răzvan): PACHETUL DE FAPTE. v1 primea doar cerințele și lăsa 37 de [DE COMPLETAT]
//     pe un capitol de personal, deși echipa, autorizațiile, experiența, partenerii, graficul și
//     garanția stăteau în ERP, legate pe licitație. Acum funcția le adună singură (pachetFapte) și
//     le pune în prompt înaintea cerințelor: modelul scrie cu numele și numerele reale și marchează
//     [DE COMPLETAT] doar ce chiar nu e în ERP. Tot v2: numerele de formular vin DOAR din cerințe
//     (a inventat un „Formular 25" care nu exista în setul autorității). Documentele firmei doar cu
//     utilizabil=true: rândul-santinelă „INSEMEX de firmă — NU EXISTĂ" nu are ce căuta în prompt.
//
// De ce e ultimul lucru construit din modul, nu primul: un generator fără poartă e o mașină de
// produs text plauzibil pentru un document depus la SEAP. Poarta există acum (rândul
// `capitole_nescrise_de_om` din v_ofertare_pt_stare BLOCHEAZĂ depunerea până când un om
// deschide capitolul, îl citește și îl salvează), deci generatorul poate exista.
//
// INTERDICȚII ÎN COD (0–5; a 4-a e la scriere, mai jos), nu doar în prompt. Regulile din prompt sunt rugăminți către model;
// astea sunt bariere:
//   0. (v2.2, 18.09.2026) Apelantul trebuie să fie owner, responsabilul licitației sau service_role.
//      `verify_jwt` singur nu e poartă: cheia anon e un JWT valid și publică în browser.
//   1. Capitol BLOCAT → refuz. Lacătul înseamnă lacăt.
//   2. Capitol cu sursa='om' și text scris → refuz, dacă nu vine explicit `peste_om: true`
//      din UI (unde omul confirmă). Altfel un click greșit șterge munca cuiva; textul vechi
//      ajunge în istoric, dar tot e o zi pierdută.
//   3. Scrie ÎNTOTDEAUNA sursa='ai'. Generatorul nu poate să-și dea singur aviz de om.
//      Versiunea o incrementează triggerul trg_pt_capitol_versioneaza, nu functia asta.
//   5. (v2.3, 24.09.2026) Cerințe ATRIBUITE dar NECONFIRMATE de om (confirmata_de NULL) → refuz controlat, ZERO cost,
//      cu lista lor (id, nr, text scurt), dacă apelul nu vine explicit cu `cu_neconfirmate: true` din UI (unde omul
//      vede lista și confirmă — același tipar ca `peste_om`). Atribuirea unei cerințe unui capitol e organizare
//      („aici răspundem la asta"), NU aprobarea conținutului ei; 60% din registru e neconfirmat, deci un refuz fără
//      cale înainte ar împinge spre „confirmă tot" — fix anti-tiparul. Când omul confirmă: fiecare cerință neconfirmată
//      e marcată în prompt, iar după scriere rămâne o OBSERVAȚIE DESCHISĂ pe capitol (ofertare_pt_observatii) cu id-urile
//      lor — urmă persistentă, vizibilă în UI și reintrodusă în promptul generării următoare; capitolul rămâne sursa='ai',
//      deci poarta de depunere îl ține blocat până îl citește și îl salvează un om. Nimic nu se elimină în tăcere.
//      Limită cunoscută: dacă o cerință se confirmă/modifică ÎN TIMPUL generării, nu se detectează (nu există verificare
//      de versiune pe cerință aici; INTERDICȚIA 4 acoperă doar capitolul).
//
// Regula de fond a promptului: NU inventează fapte despre firmă. Unde lipsește un fapt (cifre,
// nume, utilaje, termene), scrie [DE COMPLETAT: ce anume] — un gol vizibil, nu o propoziție
// plauzibilă. Diferența asta e tot ce separă un ajutor de o declarație falsă către autoritate.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
// 17.09 seara: Opus cu pachetul de fapte depășea limita de ~150 s a unui apel edge (EarlyDrop la
// 2m53s). Sonnet 5 scrie același capitol în jumătate din timp; generarea în fundal (fără limită)
// rămâne de făcut — vezi task.
const MODEL = 'claude-sonnet-5'
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

const PROMPT = `Ești redactorul propunerilor tehnice al Gazpet Instal SRL (Ploiești, execuție conducte și rețele de distribuție gaze naturale). Scrii UN SINGUR CAPITOL din propunerea tehnică depusă la o licitație publică din România (SEAP).

CE E DOCUMENTUL ĂSTA: o piesă dintr-o ofertă depusă la o autoritate contractantă. Se citește de o comisie de evaluare care caută motive de descalificare. Nu e un eseu, nu e marketing.

REGULA CARE BATE TOATE CELELALTE — NU INVENTEZI FAPTE DESPRE FIRMĂ.
Nu ai voie să scrii nicio cifră, niciun nume de persoană, niciun utilaj, nicio durată, niciun număr de certificat, nicio experiență anterioară care nu ți-a fost dată explicit în datele de mai jos.
Unde textul CERE un fapt pe care nu-l ai, scrii exact: [DE COMPLETAT: <ce anume lipsește>]
Exemple corecte: "Lucrările se execută cu [DE COMPLETAT: nr. echipe și componența lor]." · "Durata de execuție propusă este de [DE COMPLETAT: durata în luni, din graficul de execuție]."
Un gol marcat se vede și se completează. O propoziție plauzibilă dar inventată trece nevăzută până la evaluare, și atunci e declarație falsă. Mai bine zece marcaje decât o cifră inventată.

CUM SCRII:
- Română corectă, la persoana I plural ("vom executa", "asigurăm"), ton tehnic-administrativ, fără superlative comerciale.
- Răspunzi PUNCT CU PUNCT la cerințele atribuite capitolului. Comisia bifează cerințe, nu apreciază stilul. Dacă o cerință cere "se va prezenta X", capitolul trebuie să conțină X sau trimiterea explicită la anexa unde e.
- Structurezi pe subpuncte numerotate când capitolul acoperă mai multe cerințe.
- Fără introduceri de genul "În cele ce urmează vom prezenta". Intri direct în subiect.
- Lungime pe măsura cerințelor: un capitol cu două cerințe nu are nevoie de opt pagini.
- Text simplu, paragrafe separate prin linie goală. Fără markdown, fără ##, fără **bold**.

CE NU FACI:
- Nu scrii "nu este cazul" decât dacă ești sigur din cerințe — unele autorități îl interzic explicit și descalifică pentru el.
- Nu promiți nimic peste ce cer cerințele (fiecare promisiune în plus devine obligație contractuală).
- Nu copiezi cerința ca răspuns la ea însăși.
- NICIUN ELEMENT DE PREȚ AL OFERTEI în propunerea tehnică: nicio valoare în lei a lucrării, niciun total pe activități, niciun tarif — nici măcar „încadrat în valoarea estimată". Prețul stă exclusiv în propunerea financiară; o cifră de preț în PT e motiv de respingere a ofertei. (Valorile contractelor anterioare, la experiența similară, sunt permise.)

PACHETUL DE FAPTE (v2): primești, înaintea cerințelor, FAPTELE din ERP legate de licitația asta — echipa nominalizată cu autorizațiile ei, experiența similară, partenerii cu contracte, documentele firmei, graficul, garanția, participanții, răspunsurile autorității la clarificări. Astea SUNT faptele pe care ai voie să le scrii: nume, numere de autorizație, date, valori, exact cum apar acolo. Nu le rotunji, nu le „îmbunătățești". Ce NU e în pachet rămâne [DE COMPLETAT]. Când o cerință e închisă printr-un răspuns la clarificare (ex. „proiectarea nu se cere", „subcontractantul nu e obligatoriu"), spui asta cu trimitere la numărul răspunsului, nu inventezi documente.
FORMULARE: numerele de formulare (Formular 9, F14, Anexa 3) le scrii DOAR dacă apar în textul cerințelor sau în pachet. Nu presupui existența unui formular „standard" — la Domnești nu există Formular 25, deși pare firesc.
„NU E CAZUL" se poate scrie DOAR când pachetul o confirmă (ex. participanți: „ofertant unic, fără asociați/subcontractanți/terți susținători").

Răspunzi EXCLUSIV cu textul capitolului. Fără preambul, fără explicații despre ce ai făcut, fără ghilimele în jur.`

// ── PACHETUL DE FAPTE (v2) — ce știe ERP-ul despre licitația asta, adunat pentru prompt. ──
// Doar citire; fiecare sursă e opțională (o eroare pe una nu oprește generarea, dar se notează).
const scurt = (v: unknown, n = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
async function pachetFapte(supabase: any, licId: number, capIdCurent: number): Promise<string> {
  const parti: string[] = []
  const note: string[] = []
  const [acop, graf, gar, part, decl, clar, caps, docF, afirm] = await Promise.all([
    supabase.from('ofertare_acoperire')
      .select('id, status, mod, domeniu_rte, referinta_text, cerinta:ofertare_cerinte!inner(id, licitatie_id, tip, text_cerinta), autorizatie:hr_autorizatii(id, numar_autorizatie, emitent, data_emitere, data_expirare, fara_expirare, domenii, subcategorie, tip:hr_autorizatii_tipuri(cod, denumire), emp:employees(name, functie), ext:hr_personal_extern(nume, functie, firma)), recomandare:hr_recomandari(id, rol, beneficiar, obiect_lucrare, perioada_start, perioada_end, nr_document, data_document, emp:employees(name), ext:hr_personal_extern(nume)), studii:hr_documente_personale(id, numar_document, emitent, data_emitere, observatii, tip:hr_documente_personale_tipuri(denumire), emp:employees(name)), partener:ofertare_parteneri(id, nume, cui, tip_relatie, observatii), doc_firma:documente_firma(id, tip, denumire, numar_document, autoritate_emitenta, data_valabilitate, fara_expirare), experienta:ofertare_experienta(id, denumire, beneficiar, valoare_lei, valoare_executata_lei, asociere, data_pv, tip_pv, observatii)')
      .eq('cerinta.licitatie_id', licId).in('status', ['acoperit', 'acoperit_partener', 'in_lucru']).order('id').limit(400),
    supabase.from('grafic_activitati').select('ordine, denumire, durata_zile, jalon, resurse').eq('licitatie_id', licId).order('ordine').limit(200),
    supabase.from('ofertare_pt_garantie').select('*').eq('licitatie_id', licId).maybeSingle(),
    supabase.from('ofertare_pt_participanti').select('rol, nume, cota_procent, activitati, scop_declarat, partener:ofertare_parteneri(nume)').eq('licitatie_id', licId).limit(50),
    supabase.from('ofertare_pt_declaratii').select('forma, stare, citat').eq('licitatie_id', licId).limit(20),
    supabase.from('ofertare_clarificari').select('nr, intrebare, raspuns, raspuns_la').eq('licitatie_id', licId).eq('status', 'raspunsa').order('nr').limit(20),
    supabase.from('ofertare_pt_capitole').select('id, nr, titlu, continut').eq('licitatie_id', licId).order('nr').limit(40),
    supabase.from('documente_firma').select('id, tip, denumire, numar_document, autoritate_emitenta, data_valabilitate, fara_expirare').eq('activ', true).eq('utilizabil', true).in('categorie', ['iso', 'autorizatie']).order('id').limit(80),
    supabase.from('ofertare_pt_afirmatii').select('*').eq('licitatie_id', licId).limit(100),
  ])
  for (const [nume, r] of [['acoperiri', acop], ['grafic', graf], ['garanție', gar], ['participanți', part], ['declarații', decl], ['clarificări', clar], ['capitole', caps], ['documente firmă', docF], ['afirmații', afirm]] as [string, any][]) {
    if (r?.error) note.push(`${nume}: ${r.error.message}`)
  }

  // ECHIPA + EXPERIENȚĂ + PARTENERI + DOCUMENTE FIRMĂ — din acoperirile legate pe cerințe.
  const persoane: string[] = [], exper: string[] = [], parten: string[] = [], docs: string[] = []
  const vazut = new Set<string>()
  for (const a of (acop?.data || [])) {
    const c = a.cerinta || {}
    const cer = `[cerința #${c.id}] ${scurt(c.text_cerinta, 110)}`
    const stare = a.status === 'in_lucru' ? ' (ÎN LUCRU — dovada nu e completă: ' + scurt(a.referinta_text, 160) + ')' : ''
    if (a.autorizatie) {
      const t = a.autorizatie
      const cine = t.emp?.name || t.ext?.nume || '?'
      const ext = t.ext ? ` — extern${t.ext.firma ? ', ' + t.ext.firma : ''}, prin declarație de disponibilitate` : ' — angajat Gazpet'
      const doc = [t.tip?.denumire, t.numar_autorizatie ? 'nr. ' + t.numar_autorizatie : null, t.emitent, t.subcategorie, (t.domenii && t.domenii.length) ? 'domenii ' + t.domenii.join(', ') : null,
        t.data_emitere ? 'emis ' + t.data_emitere : null, t.fara_expirare ? 'fără expirare' : (t.data_expirare ? 'valabil până la ' + t.data_expirare : null)].filter(Boolean).join(', ')
      persoane.push(`- ${cer} → ${cine}${ext}${t.emp?.functie || t.ext?.functie ? ' (' + scurt(t.emp?.functie || t.ext?.functie, 80) + ')' : ''}: ${doc}${a.domeniu_rte ? ' · domeniu RTE cerut ' + a.domeniu_rte : ''}${stare}`)
    }
    if (a.recomandare) {
      const r = a.recomandare
      persoane.push(`- ${cer} → ${r.emp?.name || r.ext?.nume || '?'}: recomandare ca ${r.rol || '?'} de la ${r.beneficiar || '?'}${r.nr_document ? ' nr. ' + r.nr_document : ''}${r.data_document ? '/' + r.data_document : ''}, lucrarea „${scurt(r.obiect_lucrare, 140)}"${r.perioada_start ? ', ' + r.perioada_start + ' → ' + (r.perioada_end || '') : ''}${stare}`)
    }
    if (a.studii) {
      const d = a.studii
      persoane.push(`- ${cer} → ${d.emp?.name || '?'}: ${d.tip?.denumire || 'document de studii'} ${d.numar_document ? 'nr. ' + d.numar_document : ''} ${d.emitent || ''} ${d.data_emitere ? '(' + String(d.data_emitere).slice(0, 4) + ')' : ''} ${scurt(d.observatii, 100)}${stare}`)
    }
    if (a.experienta) {
      const e = a.experienta; const k = 'E' + e.id
      if (!vazut.has(k)) { vazut.add(k); exper.push(`- ${e.denumire} — beneficiar ${e.beneficiar || '?'}; ${e.asociere ? 'în asociere, cota Gazpet ' + (e.valoare_executata_lei ?? '?') + ' lei fără TVA (total ' + e.valoare_lei + ')' : 'valoare ' + (e.valoare_executata_lei ?? e.valoare_lei) + ' lei fără TVA'}; ${e.tip_pv || 'PV'} ${e.data_pv || ''}; ${scurt(a.referinta_text, 220)}`) }
    }
    if (a.partener) {
      const p = a.partener; const k = 'P' + p.id
      if (!vazut.has(k)) { vazut.add(k); parten.push(`- ${p.nume}${p.cui ? ' (CUI ' + p.cui + ')' : ''}, ${p.tip_relatie || ''}: ${scurt(p.observatii, 300)}`) }
      parten.push(`  · ${cer}: ${scurt(a.referinta_text, 220)}${stare}`)
    }
    if (a.doc_firma) {
      const d = a.doc_firma; const k = 'F' + d.id
      if (!vazut.has(k)) { vazut.add(k); docs.push(`- ${d.denumire}${d.numar_document ? ' nr. ' + d.numar_document : ''}${d.autoritate_emitenta ? ', ' + d.autoritate_emitenta : ''}, ${d.fara_expirare ? 'fără expirare' : 'valabil până la ' + (d.data_valabilitate || '?')}`) }
    }
  }
  // Certificările firmei (ISO, autorizații) — chiar dacă nu sunt legate pe o cerință a capitolului.
  for (const d of (docF?.data || [])) {
    const k = 'F' + d.id; if (vazut.has(k)) continue; vazut.add(k)
    docs.push(`- ${d.denumire}${d.numar_document ? ' nr. ' + d.numar_document : ''}${d.autoritate_emitenta ? ', ' + d.autoritate_emitenta : ''}, ${d.fara_expirare ? 'fără expirare' : 'valabil până la ' + (d.data_valabilitate || '?')}`)
  }
  if (persoane.length) parti.push(`ECHIPA NOMINALIZATĂ ȘI DOVEZILE EI (din acoperirile legate în ERP; o persoană = un singur rol):\n${persoane.join('\n')}`)
  if (exper.length) parti.push(`EXPERIENȚA SIMILARĂ INVOCATĂ:\n${exper.join('\n')}`)
  if (parten.length) parti.push(`PARTENERI / PRESTATORI CU CARE SE ACOPERĂ CERINȚE:\n${parten.join('\n')}`)
  if (docs.length) parti.push(`DOCUMENTELE FIRMEI (certificări, autorizații):\n${docs.slice(0, 40).join('\n')}`)

  const g = graf?.data || []
  if (g.length) {
    // FĂRĂ valori: prețul stă doar în propunerea financiară. La Domnești cap. 2 a scris „2.711.507,16 lei"
    // (suma pe activități) — element de preț în PT = motiv de respingere. Graficul dă doar durate/resurse.
    parti.push(`GRAFICUL DE EXECUȚIE (${g.length} activități):\n` +
      g.map((r: any) => `- ${r.ordine}. ${r.denumire} — ${r.jalon ? 'jalon' : r.durata_zile + ' zile'}${r.resurse ? '; resurse: ' + scurt(r.resurse, 80) : ''}`).join('\n'))
  } else parti.push('GRAFICUL DE EXECUȚIE: nu există încă activități în ERP — duratele și eșalonarea rămân [DE COMPLETAT].')

  if (gar?.data) parti.push(`GARANȚIA LUCRĂRILOR (confirmată în ERP): ${scurt(JSON.stringify(gar.data), 400)}`)
  else parti.push('GARANȚIA LUCRĂRILOR: neconfirmată în ERP — dacă cerințele cer un număr de luni, îl iei din textul cerinței, altfel [DE COMPLETAT].')

  const pt = part?.data || []
  if (pt.length) parti.push(`PARTICIPANȚI DECLARAȚI (asociați / subcontractanți / terți):\n${pt.map((p: any) => `- ${p.rol}: ${p.partener?.nume || p.nume || '?'}${p.cota_procent ? ', ' + p.cota_procent + '%' : ''}${p.activitati ? ' — ' + scurt(p.activitati, 120) : ''}`).join('\n')}`)
  const dc = decl?.data || []
  if (dc.length) parti.push(`DECLARAȚII DE PARTICIPARE: ${dc.map((d: any) => `${d.forma}: ${d.stare}${d.citat ? ' („' + scurt(d.citat, 100) + '")' : ''}`).join('; ')}`)
  if (!pt.length && !dc.length) parti.push('PARTICIPANȚI: niciun asociat, subcontractant sau terț susținător declarat în ERP → oferta se tratează ca OFERTANT UNIC; nu inventa subcontractanți.')

  const cl = (clar?.data || []).filter((c: any) => String(c.raspuns || '').trim())
  if (cl.length) parti.push(`RĂSPUNSURILE AUTORITĂȚII LA CLARIFICĂRI (prevalează asupra cerințelor inițiale):\n${cl.map((c: any) => `- Clarificarea nr. ${c.nr}${c.raspuns_la ? ' (răspuns ' + c.raspuns_la + ')' : ''}: Î: ${scurt(c.intrebare, 200)} · R: ${scurt(c.raspuns, 1200)}`).join('\n')}`)

  const alte = (caps?.data || []).filter((k: any) => k.id !== capIdCurent)
  if (alte.length) parti.push(`CELELALTE CAPITOLE ALE PROPUNERII (trimiți la ele în loc să repeți; „scris" = are deja text):\n${alte.map((k: any) => `- cap. ${k.nr} ${k.titlu}${String(k.continut || '').trim() ? ' [scris]' : ''}`).join('\n')}`)

  const af = afirm?.data || []
  if (af.length) parti.push(`AFIRMAȚII DEJA ÎNCĂRCATE ÎN PROPUNERE (ține-le consecvente): ${scurt(JSON.stringify(af.map((x: any) => ({ tip: x.tip, text: x.text || x.afirmatie || x.valoare }))), 1500)}`)

  if (note.length) parti.push(`(surse necitite din ERP: ${note.join('; ')} — nu inventa ce lipsește de acolo)`)
  return parti.join('\n\n')
}

// POARTA DE ROL (18.09.2026) — a patra interdicție, și singura care privește CINE apelează.
// Până acum funcția avea doar verify_jwt=true, ceea ce NU e o poartă: cheia anon e un JWT valid și
// e publică în bundle-ul din browser, deci oricine o citea din Network putea porni generări plătite
// pe orice capitol al oricărei licitații (aceeași gaură reparată în PR #318 la celelalte funcții).
// Reguli, ca în ofertare-acoperire:
//   - service_role: liber (rutine interne de pe server);
//   - JWT de utilizator: doar ownerul sau responsabilul licitației — ei răspund de ce se depune;
//   - cheia anon: RESPINSĂ. Generarea se pornește din UI de un om logat; nu există worker de coadă
//     pentru capitole (când se face #110, generarea în fundal, poarta pentru el se adaugă AICI,
//     pe tiparul cu coadă activă din ofertare-cerinte, nu prin relaxarea regulii).
// v2.3: întoarce și uid-ul apelantului (null pentru service_role) — urma INTERDICȚIEI 5 trebuie să spună CINE a confirmat.
let actorUid: string | null = null
async function autorizat(req: Request, supabase: any, licId: number): Promise<string | null> {
  actorUid = null
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return 'lipsește Authorization'
  // rolul se ia din payload-ul JWT: env-ul funcției poate avea alt format de cheie decât JWT-ul
  // legacy pe care îl trimit workerii (verificat 14.09: comparația de string pica).
  const rol = (() => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch (_) { return null } })()
  if (jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || rol === 'service_role') return null
  if (jwt === Deno.env.get('SUPABASE_ANON_KEY') || rol === 'anon') return 'apel neautorizat (cheie anon)'
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: u } = await anon.auth.getUser()
  const uid = u?.user?.id
  if (!uid) return 'sesiune invalidă'
  actorUid = uid
  const [{ data: prof }, { data: lic }] = await Promise.all([
    supabase.from('profiles').select('is_owner').eq('id', uid).maybeSingle(),
    supabase.from('ofertare_licitatii').select('responsabil_id').eq('id', licId).maybeSingle(),
  ])
  if (prof?.is_owner || (lic?.responsabil_id && lic.responsabil_id === uid)) return null
  return 'Capitolele le scrie doar ownerul sau responsabilul licitației (costă).'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // Erorile de BUSINESS se intorc, nu se arunca: `throw` in try + update in catch a omorat
  // intermitent workerul in alte functii ale casei.
  const fail = (msg: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ error: msg, ...extra }), { status: 200, headers: CORS })

  try {
    const { capitol_id, instructiune, peste_om, cu_neconfirmate } = await req.json()
    const capId = Number(capitol_id)
    if (!capId) return fail('capitol_id obligatoriu')

    const { data: cap, error: eCap } = await supabase.from('ofertare_pt_capitole')
      .select('id, licitatie_id, nr, sectiune, eticheta, titlu, obligatoriu, continut, sursa, blocat, versiune')
      .eq('id', capId).single()
    if (eCap || !cap) return fail('capitolul nu a fost gasit: ' + (eCap?.message || capId))

    // INTERDICȚIA 0 — cine apelează. Înaintea oricărei citiri grele și a oricărui apel plătit;
    // citirea capitolului de mai sus e o singură interogare și e nevoie de ea ca să știm licitația.
    // Refuzul iese ca 200 cu `error`, ca la ofertare-acoperire / ofertare-cerinte: pe status non-2xx
    // `supabase.functions.invoke` aruncă FunctionsHttpError cu mesaj generic, iar omul din UI ar
    // vedea „a eșuat" în loc de motivul real.
    { const na = await autorizat(req, supabase, cap.licitatie_id); if (na) return fail(na) }

    // INTERDICȚIA 1 — lacătul
    if (cap.blocat) return fail('Capitolul e blocat. Deblochează-l întâi, dacă chiar vrei să-l rescrii.')
    // INTERDICȚIA 2 — munca unui om nu se rescrie din greșeală
    const areTextDeOm = String(cap.sursa || 'om') === 'om' && String(cap.continut || '').trim() !== ''
    if (areTextDeOm && !peste_om) {
      return fail('Capitolul are text scris de om. Confirmă explicit rescrierea (textul vechi rămâne în istoric).',
        { cere_confirmare: true, versiune: cap.versiune })
    }

    const { data: lic } = await supabase.from('ofertare_licitatii')
      .select('id, nr_anunt, autoritate, obiect, termen_depunere, valoare_estimata').eq('id', cap.licitatie_id).single()

    // Cerintele ATRIBUITE capitolului. Daca n-are niciuna, nu generam: ar iesi text generic,
    // adica exact ce nu-i trebuie nimanui intr-o propunere tehnica.
    const { data: leg, error: eLeg } = await supabase.from('ofertare_pt_legaturi')
      .select('cerinta_id').eq('capitol_id', capId).eq('fel', 'capitol')
    if (eLeg) return fail('legaturile nu s-au putut citi: ' + eLeg.message)
    const ids = (leg || []).map((l: any) => l.cerinta_id)
    if (!ids.length) return fail('Capitolul n-are nicio cerință atribuită. Atribuie-i cerințele întâi — altfel iese text generic.')

    const { data: cerinte, error: eCer } = await supabase.from('ofertare_cerinte')
      .select('id, nr_ordine, text_cerinta, tip, sursa_sectiune, document_probant, confirmata_de')
      .in('id', ids).is('inlocuita_de', null).order('id')
    if (eCer) return fail('cerintele nu s-au putut citi: ' + eCer.message)
    if (!cerinte?.length) return fail('Cerintele atribuite nu mai exista (inlocuite?). Reatribuie capitolul.')

    // INTERDICȚIA 5 — cerințe neconfirmate de om. Refuzul vine ÎNAINTE de orice apel plătit și de pachetul de fapte.
    const neconfirmate = cerinte.filter((c: any) => !c.confirmata_de)
    if (neconfirmate.length && cu_neconfirmate !== true) {
      return fail(
        `${neconfirmate.length} din ${cerinte.length} cerințe atribuite NU sunt confirmate de om (E2). Confirmă-le în registru sau confirmă explicit generarea cu ele marcate „NECONFIRMATĂ".`,
        { cere_confirmare_neconfirmate: true, neconfirmate: neconfirmate.map((c: any) => ({ id: c.id, nr: c.nr_ordine, text: String(c.text_cerinta || '').slice(0, 160) })) })
    }

    // Observatiile deschise pe capitol: daca un om a cerut deja o modificare, generatorul
    // trebuie s-o stie, altfel prima lui iesire o ignora si omul o cere a doua oara.
    const { data: obs } = await supabase.from('ofertare_pt_observatii')
      .select('text').eq('capitol_id', capId).eq('stare', 'deschisa').limit(20)

    const pachet = await pachetFapte(supabase, cap.licitatie_id, capId)

    // v2.1 (17.09 seara, Domnești cap. 2 — 92 cerințe): un singur apel lovea plafonul de 12.000
    // tokeni de ieșire (stop_reason=max_tokens) și funcția refuza corect textul tăiat — dar de două
    // ori, la 0,24 $ bucata. Un plafon mai mare nu încape în limita de ~150 s a apelului edge. Așa că
    // un capitol mare se scrie pe PĂRȚI, în paralel (Promise.all): fiecare parte primește tot
    // pachetul de fapte și doar felia ei de cerințe, numerotate în continuare, iar textele se lipesc.
    // Timpul total ≈ o singură parte.
    const PE_PARTE = 20   // cap. 5 (o parte) a scos 10.124 tokeni; 30 cerințe/parte ar atinge iar plafonul
    const nParti = Math.max(1, Math.ceil(cerinte.length / PE_PARTE))
    const marime = Math.ceil(cerinte.length / nParti)
    const parti: any[][] = []
    for (let i = 0; i < cerinte.length; i += marime) parti.push(cerinte.slice(i, i + marime))

    const antet = [
      `LICITAȚIA: ${lic?.obiect || '(fără obiect)'}`,
      lic?.autoritate ? `AUTORITATEA CONTRACTANTĂ: ${lic.autoritate}` : '',
      lic?.nr_anunt ? `ANUNȚ: ${lic.nr_anunt}` : '',
      lic?.termen_depunere ? `TERMEN DE DEPUNERE: ${lic.termen_depunere}` : '',
      lic?.valoare_estimata ? `VALOARE ESTIMATĂ: ${lic.valoare_estimata} lei fără TVA` : '',
      '',
      `CAPITOLUL DE SCRIS: ${[cap.sectiune, cap.eticheta].filter(Boolean).join(' · ')} ${cap.titlu}`,
      cap.obligatoriu ? '(capitol OBLIGATORIU)' : '(capitol opțional)',
      '',
      `═══ PACHETUL DE FAPTE DIN ERP (singurele fapte pe care ai voie să le scrii) ═══`,
      pachet || '(ERP-ul n-are nimic legat pe licitația asta — tot ce e fapt rămâne [DE COMPLETAT])',
      '',
    ]
    const contextParte = (k: number) => {
      const felie = parti[k]
      const dela = parti.slice(0, k).reduce((a, p) => a + p.length, 0)
      const instrParte = nParti > 1 ? [
        '',
        `ATENȚIE — CAPITOLUL SE SCRIE ÎN ${nParti} PĂRȚI, generate separat și lipite în ordine. Aceasta este PARTEA ${k + 1} din ${nParti}.`,
        `Scrii DOAR subpunctele care răspund cerințelor ${dela + 1}–${dela + felie.length} de mai jos (numerotarea continuă din capitol: începe subpunctele de la ${dela + 1}).`,
        k === 0 ? 'Fiind prima parte, poți deschide cu 1–2 fraze de cadru, fără introduceri goale.' : 'NU scrii introducere, nu reiei ce s-a spus în părțile anterioare, intri direct în primul subpunct.',
        k === nParti - 1 ? 'Fiind ultima parte, poți închide cu o frază de angajament general.' : 'NU scrii concluzie sau frază de încheiere — capitolul continuă.',
      ] : []
      return [
        ...antet,
        `CERINȚELE ATRIBUITE ${nParti > 1 ? `ACESTEI PĂRȚI (${felie.length} din ${cerinte.length})` : `CAPITOLULUI (${cerinte.length})`} — la fiecare trebuie să se poată bifa un răspuns în text:`,
        ...felie.map((c: any, i: number) =>
          `${dela + i + 1}. [${c.tip}${c.sursa_sectiune ? ' · ' + c.sursa_sectiune : ''}]${c.confirmata_de ? '' : ' [NECONFIRMATĂ – nevalidată de om; răspunde fără afirmații ferme despre ce cere autoritatea]'} ${c.text_cerinta}` +
          (c.document_probant ? `\n   (document probant cerut: ${c.document_probant})` : '')),
        ...instrParte,
        (obs || []).length ? `\nMODIFICĂRI CERUTE DE COLEGI, de respectat:\n${(obs || []).map((o: any) => `- ${o.text}`).join('\n')}` : '',
        instructiune ? `\nINSTRUCȚIUNE SUPLIMENTARĂ DE LA REDACTOR:\n${String(instructiune).slice(0, 2000)}` : '',
      ].filter(Boolean).join('\n')
    }

    const apel = async (k: number) => {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, max_tokens: 12000,
          thinking: { type: 'adaptive' },
          // Promptul e partea stabila (identica la fiecare capitol) -> intra in cache.
          system: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: [{ type: 'text', text: contextParte(k) }] }],
        }),
      })
      const data = await resp.json()
      return { ok: resp.ok, status: resp.status, data }
    }
    const rezultate = await Promise.all(parti.map((_, k) => apel(k)))

    // Costul se scrie o singura data, insumat pe parti.
    try {
      let tin = 0, tout = 0, cost = 0
      for (const r of rezultate) {
        const u = r.data?.usage || {}
        const cacheW = u.cache_creation_input_tokens || 0, cacheR = u.cache_read_input_tokens || 0
        tin += (u.input_tokens || 0) + cacheW + cacheR
        tout += u.output_tokens || 0
        cost += (u.input_tokens || 0) * PRICE_IN + cacheW * PRICE_IN * 1.25 + cacheR * PRICE_IN * 0.1 + (u.output_tokens || 0) * PRICE_OUT
      }
      await supabase.from('ai_usage_log').insert({
        function_name: 'ofertare-genereaza-capitol', model: MODEL,
        tokens_in: tin, tokens_out: tout, cost_usd: cost,
        ref_table: 'ofertare_pt_capitole', ref_id: capId,
      })
    } catch (_) {}

    const stricat = rezultate.find(r => !r.ok)
    if (stricat) return fail('Claude: ' + (stricat.data?.error?.message || stricat.status))

    const bucati: string[] = []
    for (const r of rezultate) {
      const t = (r.data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('').trim()
      if (!t) return fail('Modelul n-a intors text.', { stop_reason: r.data.stop_reason || null })
      // Text taiat la jumatate nu se scrie: ar naste o versiune si ar arata ca un capitol scris.
      if (r.data.stop_reason === 'max_tokens') {
        return fail('Raspunsul s-a taiat la limita de tokeni — nu s-a scris nimic. Imparte capitolul sau redu cerintele atribuite.',
          { trunchiat: true, parti: nParti })
      }
      bucati.push(t)
    }
    const text = bucati.join('\n\n')
    const data = rezultate[0].data

    // INTERDICȚIA 3 — sursa='ai' mereu. De aici incolo poarta tine capitolul blocat pana cand
    // un om il deschide, il citeste si il salveaza (UI-ul pune atunci sursa='om').
    // INTERDICȚIA 4 (18.09.2026, gasita de o recenzie independenta) — scrierea e conditionata de
    // VERSIUNEA citita la inceput. Verificarile de mai sus (lacat, text de om) se fac inainte de
    // apelurile la model, care dureaza minute: daca intre timp un om a editat capitolul, scrierea
    // dupa `id` ii stergea munca fara sa se vada. Acum, daca versiunea s-a schimbat, nu scriem.
    const { data: scris, error: eUpd } = await supabase.from('ofertare_pt_capitole')
      .update({ continut: text, sursa: 'ai' }).eq('id', capId).eq('versiune', cap.versiune || 1)
      .select('id')
    if (eUpd || !scris?.length) {
      // urma nu descrie nicio versiune scrisă → o închidem, ca să nu rămână o observație despre un text inexistent
      if (obsId) await supabase.from('ofertare_pt_observatii').update({ stare: 'rezolvata', raspuns: 'generarea nu s-a salvat (conflict de versiune / eroare la scriere)' }).eq('id', obsId)
    }
    if (eUpd) return fail('textul nu s-a salvat: ' + eUpd.message)
    if (!scris?.length) return fail(
      'Capitolul a fost modificat de altcineva cat timp se genera — textul generat NU s-a scris, ca sa nu se piarda munca lui. Reincarca si porneste din nou daca mai e nevoie.',
      { conflict: true, versiune_asteptata: cap.versiune || 1 })

    // INTERDICȚIA 5, urma persistentă — ÎNAINTE de scrierea textului: observație DESCHISĂ pe capitol cu actorul care a
    // confirmat, id-urile cerințelor neconfirmate și amprenta (MD5) textelor trimise modelului. Dacă urma nu se poate scrie,
    // textul NU se salvează (refuz) — flagul cu_neconfirmate nu înlocuiește urma. Costul modelului e deja plătit; e prețul
    // corect față de un capitol „generat complet" fără urmă.
    let obsId: number | null = null
    if (neconfirmate.length) {
      const amprente = await Promise.all(neconfirmate.map(async (c: any) => {
        // SHA-256 COMPLET (Copilot 24.09: identificarea exactă a intrării folosite; Web Crypto n-are MD5).
        const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(c.text_cerinta || '')))
        return `#${c.id}:sha256:${Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')}`
      }))
      const { data: obsRow, error: eObs } = await supabase.from('ofertare_pt_observatii').insert({
        licitatie_id: cap.licitatie_id, capitol_id: capId, cerut_de: actorUid, stare: 'deschisa',
        text: `⚠️ Generare v${(cap.versiune || 1) + 1} cu ${neconfirmate.length} cerințe NECONFIRMATE de om (fără E2), confirmată explicit de ${actorUid || 'service_role'}: ${amprente.join(', ')} (id:sha256 al textului trimis modelului). ` +
              'Răspunsurile la ele nu sunt bază verificată: confirmă cerințele în registru (sau exceptează-le) și regenerează / corectează textul înainte de depunere.',
      }).select('id').single()
      if (eObs || !obsRow?.id) return fail('Urma pentru cerințele neconfirmate nu s-a putut scrie (' + (eObs?.message || '?') + ') — textul generat NU s-a salvat.', { fara_urma: true })
      obsId = obsRow.id
    }

    const goluri = (text.match(/\[DE COMPLETAT:/g) || []).length
    return new Response(JSON.stringify({
      ok: true, capitol_id: capId, caractere: text.length, cerinte: cerinte.length,
      goluri_de_completat: goluri,
      neconfirmate: neconfirmate.length, urma_observatie_id: obsId,
      versiune_noua: (cap.versiune || 1) + 1,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cache_citit: data.usage?.cache_read_input_tokens || 0,
      pachet_caractere: pachet.length, parti: nParti,
    }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
})
