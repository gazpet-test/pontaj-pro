// ofertare-fisier-semnat — URL-uri semnate pentru documentele de atribuire, plus exportul pasajelor.
//
// De ce exista: Vault-ul nu are un token cu drepturi de service (cel numit asa continea un `anon` —
// verificat 10.09.2026, redenumit intre timp SUPABASE_ANON_JWT). Edge Functions au cheia in mediul
// lor, deci semnarea se face aici, iar cheia nu iese nicaieri.
//
// mod 'pasaje': scrie in storage un JSON cu {id, sursa_pasaj} pentru cerintele unui document si
// intoarce link. Asa pasajele ajung direct in unealta care le foloseste, fara sa treaca prin
// conversatie — la 421 de cerinte, copierea prin chat e si scumpa, si o sursa de greseli de transcriere.
//
// Nu primeste cai libere: doar id-uri din ofertare_documente_atribuire.
// Auth: x-fisier-secret, verificat prin RPC public.fn_verifica_fisier_secret (schema `vault` NU e
// expusa prin PostgREST, deci nu poate fi citita direct de aici — v1 pica exact pe asta).
//
// ADUSA IN REPO la 12.09.2026, VERBATIM — nicio modificare. E singura dintre functiile de
// ofertare neversionate care nu avea secretul scris literal in sursa: foloseste Vault prin RPC,
// asa cum trebuie. E si cea mai noua (creata 10.09), deci practica se schimbase deja; problema
// e in functiile vechi.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-fisier-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: ok, error: eS } = await db.rpc('fn_verifica_fisier_secret', {
      p_secret: req.headers.get('x-fisier-secret') || '',
    })
    if (eS) return json({ error: 'verificare secret: ' + eS.message }, 500)
    if (ok !== true) return json({ error: 'neautorizat' }, 401)

    let body: any = {}
    try { body = await req.json() } catch { /* gol */ }
    const ids: number[] = Array.isArray(body.doc_ids)
      ? body.doc_ids.map(Number).filter(Number.isInteger).slice(0, 40)
      : (Number.isInteger(Number(body.doc_id)) ? [Number(body.doc_id)] : [])
    if (!ids.length) return json({ error: 'doc_id sau doc_ids lipsa' }, 400)
    const minute = Math.min(Math.max(Number(body.minute) || 30, 1), 120)

    // ── mod 'pasaje': cerintele documentelor, ca fisier JSON in storage ──
    if (body.mod === 'pasaje') {
      const { data: cer, error: eC } = await db.from('ofertare_cerinte')
        .select('id, sursa_document_id, sursa_pasaj, sursa_pagina')
        .in('sursa_document_id', ids).is('inlocuita_de', null).not('sursa_pasaj', 'is', null)
        .order('id').limit(20000)
      if (eC) return json({ error: eC.message }, 500)
      const cale = `_temp/pasaje_${ids.join('-').slice(0, 60)}_${Date.now()}.json`
      const { error: eU } = await db.storage.from('ofertare').upload(
        cale, new Blob([JSON.stringify(cer || [])], { type: 'application/json' }), { upsert: true })
      if (eU) return json({ error: 'incarcare: ' + eU.message }, 500)
      const { data: s, error: eSig } = await db.storage.from('ofertare').createSignedUrl(cale, minute * 60)
      if (eSig) return json({ error: eSig.message }, 500)
      return json({ ok: true, cerinte: (cer || []).length, cale, url: s?.signedUrl })
    }

    // ── implicit: URL semnat pentru fiecare document ──
    const { data: docs, error: eD } = await db.from('ofertare_documente_atribuire')
      .select('id, nume_original, fisier_path').in('id', ids)
    if (eD) return json({ error: eD.message }, 500)

    const fisiere: any[] = []
    for (const d of (docs || [])) {
      if (!d.fisier_path || String(d.fisier_path).includes('/neincarcat/')) {
        fisiere.push({ doc_id: d.id, eroare: 'fara fisier urcat' }); continue
      }
      const { data: s, error } = await db.storage.from('ofertare')
        .createSignedUrl(d.fisier_path, minute * 60)
      fisiere.push(error
        ? { doc_id: d.id, eroare: error.message }
        : { doc_id: d.id, nume: d.nume_original, url: s?.signedUrl })
    }
    return json({ ok: true, expira_in_minute: minute, fisiere })
  } catch (e) {
    // erorile de business se intorc, nu se arunca (throw in Edge = worker omorat intermitent)
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
