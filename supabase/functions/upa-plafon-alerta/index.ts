// upa-plafon-alerta — fondul de handicap / unități protejate (L448/2006: achizițiile de la unități protejate autorizate se deduc din
// contribuția lunară).
// v11 (20270101a, răspunsul expertului contabil 20.11.2026): contribuția e CALCULATĂ în BD (NMA din pontaj, salariul minim pe perioade,
//   contribuția integrală, deducerea = cel mult jumătate din ea, excedentul se reportează). Rândurile rezervate au `calcul` (fn_upa_calcul_la):
//   alerta zilei = PREVIZIUNE „mai sunt X lei de cumpărat”; alerta exactă (felul 'calcul', după ce owner-ul a închis luna din ecran) = „de
//   plată la bugetul de stat Y lei până pe <termen>” (25 a lunii următoare; 21.12 pentru noiembrie). Un rând cu `calcul` invalid NU se trimite
//   (eroare calcul_invalid). Fără `calcul` (BD-ul încă pe 20261229a) mailul are forma v10 de mai jos — v11 se publică ÎNAINTEA migrării.
// v10 (20261229a, decizia owner-ului 19.11.2026): rulează ZILNIC (cronul propus 0 6 * * *); decizia e în BD (fn_upa_alerta_rezerva):
//   * în fiecare zi: dacă luna anterioară nu e închisă -> o închide în upa_luna_inchisa (o dată) și, cu alerta pornită și necheltuit > 0,
//     trimite „Fond handicap <luna>: necheltuit Z lei - se plătește la bugetul de stat”;
//   * de la ziua upa_alerta_zi până la sfârșitul lunii, cât cheltuit < plafonul lunii: „Fond handicap <luna>: cheltuit X din Y lei, rămân
//     Z lei, mai sunt N zile” — cel mult un mail pe zi (cheia zilnic:<zi>, UNIQUE în BD);
//   * notificările în aplicație (owner + administrativ / administrativ.upa) le pune BD-ul, odată cu rezervarea.
// Destinatarii mailului: logistica_setari.upa_alerta_emails, aleși în BD (doar adrese interne @gazpet.ro, cel mult 10); celelalte sunt
//   ignorate (nu primesc nimic) și numărate în jurnal / răspuns; edge-ul reverifică domeniul înainte de trimitere (DOMENIU_INTERN).
// Poarta: cronSauOwner (x-intern-secret din Vault sau owner-ul logat); verify_jwt NU ajunge (cheia anon e un JWT valid). ?dry=1 = ce s-ar face
//   azi, fără nicio scriere. Erorile de business se scriu în BD (upa_alerta_jurnal + notificare owner) și se întorc, nu se aruncă.
// Configurarea defectă (ziua pragului invalidă, plafon neînregistrat) = ok:false, error:'configurare_invalida' + erori_config, la FIECARE rulare.
// Răspunsul (păstrat de pg_net) are doar contoare: fără adrese, fără textul erorii furnizorului. Secrete (doar nume): RESEND_API_KEY,
//   SUPABASE_SERVICE_ROLE_KEY, INTERN_EDGE_SECRET (Vault, prin poartaIntern). Logica: _shared/upaAlerta.mjs.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { cronSauOwner } from '../_shared/poartaCron.ts'
import { ruleazaAlertaUpa } from '../_shared/upaAlerta.mjs'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const apelant = await cronSauOwner(req, sb)
  if (!apelant) return json({ ok: false, error: 'neautorizat' }, 401)
  // proba (?dry=1) doar pentru owner-ul logat: răspunsul ei conține destinatarii
  const dry = apelant === 'owner' && new URL(req.url).searchParams.get('dry') === '1'
  try {
    const r = await ruleazaAlertaUpa({ sb, resendKey: Deno.env.get('RESEND_API_KEY') || '', dry })
    return json(r.body, r.status)
  } catch (_) {
    console.error('upa-plafon-alerta: eroare neasteptata')
    return json({ ok: false, error: 'eroare_interna' }, 500)
  }
})
