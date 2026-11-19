// upa-plafon-alerta — fondul de handicap / unități protejate (L448/2006: achizițiile de la unități protejate autorizate se deduc din
// contribuția lunară; plafonul nu se reportează, ce nu se cheltuie se plătește la bugetul de stat).
// v10 (20261229a, decizia owner-ului 19.11.2026): rulează ZILNIC (cronul propus 0 6 * * *); decizia e în BD (fn_upa_alerta_rezerva):
//   * în fiecare zi: dacă luna anterioară nu e închisă -> o închide în upa_luna_inchisa (o dată) și, cu alerta pornită și necheltuit > 0,
//     trimite „Fond handicap <luna>: necheltuit Z lei - se plătește la bugetul de stat”;
//   * de la ziua upa_alerta_zi până la sfârșitul lunii, cât cheltuit < plafonul lunii: „Fond handicap <luna>: cheltuit X din Y lei, rămân
//     Z lei, mai sunt N zile” — cel mult un mail pe zi (cheia zilnic:<zi>, UNIQUE în BD);
//   * notificările în aplicație (owner + administrativ / administrativ.upa) le pune BD-ul, odată cu rezervarea.
// Destinatarii mailului: logistica_setari.upa_alerta_emails, validați în BD (doar @gazpet.ro, cel mult 10; o adresă invalidă = niciun mail).
// Poarta: cronSauOwner (x-intern-secret din Vault sau owner-ul logat); verify_jwt NU ajunge (cheia anon e un JWT valid). ?dry=1 = ce s-ar face
//   azi, fără nicio scriere. Erorile de business se scriu în BD (upa_alerta_jurnal + notificare owner) și se întorc, nu se aruncă.
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
