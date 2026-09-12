// ofertare-raspuns-set — raspunsul autoritatii contractante intra in registrul de cerinte.
//
// Inlocuieste fluxul vechi (ofertare-clarificare-aplica), care cerea obligatoriu un rand in
// ofertare_clarificari: pentru un raspuns consolidat — care raspunde la intrebarile mai multor
// ofertanti si modifica cerinte fara sa existe vreo intrebare de-a noastra — trebuia fabricat un rand
// fals. Pe 12.09 s-a probat ca modelul OBSERVA marcajul de test si isi schimba raspunsul in functie
// de el. De aici: document-first.
//
// Actiuni (body.actiune):
//   creeaza_set  {licitatie_id, document_ids[], titlu?, lot?, data_raspuns?}
//   aplica       {set_id, op_ids[], dupa_depunere?, motiv?, idempotency_key?}
//
// Analiza cu AI vine separat, dupa ce calea de scriere e probata cu payload facut de mana.
//
// Auth: DOAR JWT de utilizator + drept efectiv pe modulul Ofertare (is_owner sau user_module_access).
// Fara ramura pe x-radar-secret: un endpoint care scrie in registrul de cerinte, aparat de un header
// partajat intre 14 functii, e exact greseala care s-ar face la prima eroare de cron.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS })

// Un document intra in set doar daca are text de citit. Cazurile reale din baza: documentul 34
// ('ignorat', originalul spart in partile 56-61) si zecile de .docx/.p7s neprocesate.
const MIN_CARACTERE = 200

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const SUPA_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt || jwt === SERVICE) return json({ error: 'unauthorized' }, 401)
  const anon = createClient(SUPA_URL, Deno.env.get('SUPABASE_ANON_KEY')!)
  const { data: u } = await anon.auth.getUser(jwt)
  if (!u?.user) return json({ error: 'unauthorized' }, 401)

  const db = createClient(SUPA_URL, SERVICE)

  // Dreptul se verifica INAINTE de orice citire de date sau apel platit.
  const { data: prof } = await db.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle()
  let permis = !!prof?.is_owner
  if (!permis) {
    const { count } = await db.from('user_module_access')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', u.user.id).eq('module', 'ofertare')
    permis = (count || 0) > 0
  }
  if (!permis) return json({ error: 'forbidden — nu ai acces pe modulul Ofertare' }, 403)

  let body: any = {}
  try { body = await req.json() } catch { /* gol */ }
  const actiune = String(body?.actiune || '')

  // ---------------------------------------------------------------- creeaza_set
  if (actiune === 'creeaza_set') {
    const licId = Number(body?.licitatie_id)
    const ids = Array.isArray(body?.document_ids) ? body.document_ids.map(Number).filter(Boolean) : []
    if (!licId) return json({ error: 'licitatie_id lipsa' }, 400)
    if (!ids.length) return json({ error: 'niciun document selectat' }, 400)

    const { data: lic, error: eLic } = await db.from('ofertare_licitatii')
      .select('id, obiect, loturi').eq('id', licId).maybeSingle()
    if (eLic) return json({ error: 'citire licitatie: ' + eLic.message })
    if (!lic) return json({ error: 'licitatia nu exista' }, 404)

    const { data: docs, error: eDoc } = await db.from('ofertare_documente_atribuire')
      .select('id, licitatie_id, nume_original, tip, status_procesare, text_extras').in('id', ids)
    if (eDoc) return json({ error: 'citire documente: ' + eDoc.message })

    const bune: any[] = [], excluse: any[] = []
    for (const id of ids) {
      const d = (docs || []).find((x: any) => x.id === id)
      if (!d) { excluse.push({ id, motiv: 'documentul nu exista' }); continue }
      // Apartenenta la licitatie se verifica aici, nu se presupune: altfel textul unui document din
      // alta licitatie ar ajunge in promptul acesteia.
      if (d.licitatie_id !== licId) { excluse.push({ id, nume: d.nume_original, motiv: 'document din alta licitatie' }); continue }
      if (!['procesat', 'partial'].includes(d.status_procesare)) {
        excluse.push({ id, nume: d.nume_original, motiv: `neprocesat (${d.status_procesare})` }); continue
      }
      if ((d.text_extras || '').length < MIN_CARACTERE) {
        excluse.push({ id, nume: d.nume_original, motiv: `text prea scurt (${(d.text_extras || '').length} caractere)` }); continue
      }
      bune.push(d)
    }
    if (!bune.length) return json({ error: 'niciun document utilizabil', excluse })

    // Titlul se deriva din documente daca omul nu l-a scris — nu-l obligam sa inventeze un nume
    // inainte sa poata analiza ceva.
    const titlu = String(body?.titlu || '').trim()
      || `Raspuns din ${bune.length} document${bune.length > 1 ? 'e' : ''} — ${(bune[0].nume_original || '').split('/').pop()?.slice(0, 60)}`

    const { data: set, error: eSet } = await db.from('ofertare_raspuns_set').insert({
      licitatie_id: licId,
      titlu,
      lot: body?.lot ? String(body.lot) : null,
      data_raspuns: body?.data_raspuns || null,
      creat_de: u.user.id,
    }).select('id, titlu, lot, stare').single()
    if (eSet || !set) return json({ error: 'creare set: ' + (eSet?.message || 'necunoscut') })

    const { error: eLeg } = await db.from('ofertare_raspuns_set_doc')
      .insert(bune.map((d, i) => ({ set_id: set.id, document_id: d.id, ordine: i })))
    if (eLeg) {
      await db.from('ofertare_raspuns_set').delete().eq('id', set.id)
      return json({ error: 'legare documente (setul a fost sters): ' + eLeg.message })
    }

    return json({
      ok: true, set,
      documente: bune.map(d => ({ id: d.id, nume: d.nume_original, caractere: (d.text_extras || '').length })),
      caractere_total: bune.reduce((s, d) => s + (d.text_extras || '').length, 0),
      excluse,
    })
  }

  // ---------------------------------------------------------------- aplica
  if (actiune === 'aplica') {
    const setId = Number(body?.set_id)
    const opIds = Array.isArray(body?.op_ids) ? body.op_ids.map(String).filter(Boolean) : []
    if (!setId) return json({ error: 'set_id lipsa' }, 400)
    if (!opIds.length) return json({ error: 'nicio operatie bifata' }, 400)

    // Aplicarea NU cheama AI: executa exact operatiile generate de server si bifate de om.
    const { data, error } = await db.rpc('fn_ofertare_raspuns_set_aplica', {
      p_set_id: setId,
      p_op_ids: opIds,
      p_actor: u.user.id,
      p_dupa_depunere: body?.dupa_depunere === true,
      p_motiv: body?.motiv ? String(body.motiv) : null,
      p_idempotency_key: body?.idempotency_key ? String(body.idempotency_key) : null,
    })
    // Erorile de business ies ca {error}, nu ca throw: un throw in try cu update in catch a omorat
    // deja worker-ul intermitent in alte functii.
    if (error) return json({ error: 'aplicare (tranzactie anulata, nu s-a schimbat nimic): ' + error.message })
    return json({ ok: true, ...data })
  }

  return json({ error: `actiune necunoscuta: ${actiune || '(lipsa)'}` }, 400)
})
