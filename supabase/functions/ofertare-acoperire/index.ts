// #51 14.09.2026: autorizat() — owner/responsabil sau service_role; anon respins.
// ofertare-acoperire v23 (17.09.2026) — E3: confruntarea cerințe ↔ capabilități.
// v20 (17.09.2026, Domnești): a ȘASEA sursă de catalog — DOCUMENTELE DE STUDII ale persoanelor
//     (hr_documente_personale, categoria 'studii': diplome de licență, școală profesională, liceu,
//     certificate de calificare), id-uri cu prefix D, regula R17, si a SAPTEA — dovezile de vechime
//     de la angajatori anteriori (CV, extras REGES, adeverinte de incetare), id-uri V, regula R18.
//     Până acum motorul nu citea deloc
//     tabelul ăsta: 524 de documente ale 114 persoane, toate cu scan, erau invizibile. Efectul era
//     o respectare CORECTĂ a lui R1 („doar ce e în catalog") peste un catalog incomplet — cerința
//     eliminatorie #4058 de la Domnești („șef de șantier, inginer cu diplomă de licență Facultatea
//     de Instalații") ieșea „gol — lipsă diplomă", deși PANTEA CONSTANTIN are exact diploma aia
//     (UTCB, Facultatea de Instalații, nr. 0024671/03.05.2017) încărcată în platformă.
// v19 (#77, Silviu 15.09): R16 — cerințele de PROIECTARE (proiectant pe specialități, PT de execuție elaborat de
//     ofertant, verificator de proiecte atestat) se acoperă cu un PARTENER proiectant / contract de subcontractare
//     proiectare pe specialitatea cerută (acoperit_partener), nu cu persoane distincte per specialitate; fără
//     partener → „gol” cu motiv „lipsă contract proiectant pe <specialitate>”. Domnești: ieșeau „gol” degeaba.
// v18 (#74, Silviu 15.09): R9 extins — clarificare propusă și când o cerință de EXPERIENȚĂ a persoanei e ambiguă
//     (experiență CA RTE pe proiect similar vs. experiență generală de N ani; „proiect similar" nedefinit),
//     ca întrebarea să plece la începutul analizei, nu după ce trece termenul de clarificări.
// v17 (#72, Silviu 15.09): R15 — cerințele care se prezintă DOAR de ofertantul de pe locul I / se declară în DUAE
//     (cand_se_prezinta) nu cer documentul valabil la depunere: certificatul de 30 zile (ONRC, fiscal) acoperă, se
//     reemite atunci. La Conpet („depunere") rămâne ca înainte. Gardă în cod: valabil_la_depunere=null pe ele.
// v16 (#73, Silviu 15.09): a CINCEA sursă de catalog — RECOMANDĂRILE persoanelor (hr_recomandari, id-uri R):
//     experiența managerului / șefului de șantier / RTE se dovedește cu ele; R14 în prompt, mod='recomandare'.
// v15 (#75, Silviu 15.09): R13 — CQ/CTC nu se mai atestă la ISC (prevedere abrogată; numire prin
//     decizie internă) → se acoperă cu Manager SMC / auditor calitate din HR sau decizie de numire (F);
//     cerințele cu alternativă („X / Y", „X sau Y") sunt acoperite de ORICARE variantă.
// v14: R12 restrâns + gardă în cod (regula_propunere doar pe text de echipă/roluri/cumul/înlocuire).
// v13 (#65): nomenclatorul ISC RTE (isc_rte_domenii) intră în prompt; domeniile din HR se
//     normalizează la coduri (8.4 (D) SI 8.5 → 8.4D, 8.5; cifre romane = schema veche MLPAT,
//     neechivalată); motorul scrie `domeniu_rte` pe acoperire; cerințele-REGULĂ de echipă
//     (cumul funcții) → status 'regula_propunere' (se verifică la propunere, nu dispar).
//     Domnești: RTE pe alimentare cu apă = 9.1 (edilitare), pe care îl AVEM — ieșea „gol".
// v9 (TKT-0203, Oana): domeniul ISC al RTE se ia din natura lucrărilor CERUTE, nu din
//     lucrarea de experiență similară prezentată; cerința de RTE „la general" propune
//     automat o clarificare către autoritate (status 'de_trimis', idempotent pe `sursa`).
// v8: experienta similara ca a patra sursa de catalog (id-uri E), pe COTA PROPRIE.
// v7: scriere atomica prin fn_ofertare_acoperire_rescrie + index unic partial.
// v6: R-ACOP-1 + 12 constatari de revizuire + 3 runde de a doua parere (Codex).
// v5: catalogul include și DOCUMENTELE FIRMEI (documente_firma — ANRE EDSB/EDIB,
// ISO, certificate) cu id-uri prefixate F → acoperit cu mod='firma' + doc_firma_id.
// v4: partenerii cu observatii („acopera”). v3: ids[] felii. v2: CORS x-client-info.
// Versiune FIXATĂ intenționat (22.09.2026): cu `@2` flotant, bundlerul Supabase a cerut
// varianta denonext a lui 2.117.0, pe care esm.sh nu o are publicată (auth-js dă 404), și
// deployul a picat cu „Module not found". 2.116.0 are build denonext complet.

// v24 (22.09.2026): logica mutată în core.ts (propuneAcoperiri) ca să ruleze și pe workerul NAS; aici rămân auth + HTTP.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { propuneAcoperiri } from './core.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

async function autorizat(req: Request, supabase: any, licId: number, coadaTabel: string | null): Promise<string | null> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return 'lipsește Authorization'
  // rolul se ia din payload-ul JWT: env-ul funcției poate avea alt format de cheie decât JWT-ul
  // legacy pe care îl trimit workerii din Vault (verificat 14.09: comparația de string pica).
  const rol = (() => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch (_) { return null } })()
  if (jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || rol === 'service_role') return null
  if (jwt === Deno.env.get('SUPABASE_ANON_KEY') || rol === 'anon') {
    if (!coadaTabel) return 'apel neautorizat (cheie anon)'
    const { data: c } = await supabase.from(coadaTabel).select('activ').eq('licitatie_id', licId).maybeSingle()
    return c?.activ ? null : 'apel neautorizat (cheie anon, coada nu e activă)'
  }
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: u } = await anon.auth.getUser()
  const uid = u?.user?.id
  if (!uid) return 'sesiune invalidă'
  const [{ data: prof }, { data: lic }] = await Promise.all([
    supabase.from('profiles').select('is_owner').eq('id', uid).maybeSingle(),
    supabase.from('ofertare_licitatii').select('responsabil_id').eq('id', licId).maybeSingle(),
  ])
  if (prof?.is_owner || (lic?.responsabil_id && lic.responsabil_id === uid)) return null
  return 'Citirea integrală o pornește doar ownerul sau responsabilul licitației (costă).'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })
  let body: any
  try { body = await req.json() } catch (_) { return fail('body JSON invalid') }
  const licId = Number(body?.licitatie_id)
  if (!licId) return fail('licitatie_id obligatoriu')
  { const na = await autorizat(req, supabase, licId, null); if (na) return fail(na) }
  const r = await propuneAcoperiri(supabase, body)
  return new Response(JSON.stringify(r), { status: 200, headers: CORS })
})
