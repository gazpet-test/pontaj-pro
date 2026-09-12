// ofertare-participari-import — task #36: atribuirile SEAP unde o entitate apare
// câștigător, direct din api-pub cu winnerId (ID entitate SEAP, NU CUI — descoperit 02.09:
// filtrul winnerFiscalNumber e ignorat; ID-ul se ia din ComboPub/searchEntities).
// Body: {} = Gazpet-Instal; {entity_id, entitate} = una anume; {batch:true} = toată lista
// (Gazpet + grup + competitori — liderii din PV-urile de deschidere date de Razvan 02.09).
// Auth: x-radar-secret.  Upsert idempotent (entitate, nr_seap).
//
// ADUSĂ ÎN REPO la 12.09.2026. SINGURA modificare față de sursa deployată: secretul nu mai
// e scris literal în cod.
//
// ⚠️ AL PATRULEA loc cu ACELAȘI `x-radar-secret` literal (după radar-scan, alerte-mail și
// pattern-ul din rfq-inbox). Găsit abia acum, aducând funcția în repo — ceea ce e exact
// argumentul pentru versionare: căutarea după secret nu poate găsi ce nu e în repo.
// Aici expunerea însemna: pornirea unui import SEAP nelimitat și scrieri în
// ofertare_participari, pe `verify_jwt: false`. Verificarea trece acum prin Vault.
// SECRETUL RĂMÂNE DE ROTIT (task #51) — scoaterea literalului nu e revocare.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SEAP = 'https://e-licitatie.ro/api-pub'
const ENTITATI: Record<string, number> = {
  gazpet_instal: 114759, gazpet_invest: 100096339,
  'competitor:inspet': 6096, 'competitor:moldocor': 7518, 'competitor:cis_gaz': 53920,
  'competitor:habau': 54428, 'competitor:armax_gaz': 55290, 'competitor:instgaz': 155948,
  'competitor:condmag': 3533, 'competitor:timgaz': 133070, 'competitor:amarad': 49428,
  'competitor:miral_instal': 12656,
  'competitor:comesad': 8635, 'competitor:petroconst': 1062,
  'competitor:totalgaz': 6322, 'competitor:irigc': 13389,
  'competitor:ruxo': 143644, 'competitor:cfi': 141749, 'competitor:erdesign': 100088860,
  'competitor:prodrep_star': 100054215, 'competitor:talpac': 5201,
  'competitor:invest_general_construct': 55013, 'competitor:menada': 86268,
  'competitor:utilitar_fluid': 131214, 'competitor:rominsta': 51599, 'competitor:rapid_complex': 23244,
}
const HDR: Record<string, string> = {
  'Content-Type': 'application/json',
  'Referer': 'https://e-licitatie.ro/pub/notices/contract-awards/list/1/0',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

async function importa(sb: any, entitate: string, entityId: number) {
  const rap = { entitate, total_seap: 0, importate: 0, actualizate: 0, erori: [] as string[] }
  const toate: any[] = []
  for (let pg = 0; pg < 10; pg++) {
    const res = await fetch(`${SEAP}/NoticeCommon/GetCANoticeList/`, {
      method: 'POST', headers: HDR,
      body: JSON.stringify({ pageSize: 100, pageIndex: pg, sysNoticeTypeIds: [], sortProperties: [], winnerId: entityId }),
    })
    if (!res.ok) { rap.erori.push(`pg${pg}: HTTP ${res.status}`); break }
    const d = await res.json()
    const items = d?.items || []
    toate.push(...items)
    rap.total_seap = d?.total || toate.length
    if (toate.length >= (d?.total || 0) || !items.length) break
  }
  for (const it of toate) {
    if (!it?.noticeNo) continue
    const rand = {
      entitate, entity_id_seap: entityId,
      nr_seap: it.noticeNo, ca_notice_id: it.caNoticeId ?? null,
      titlu: it.contractTitle ?? null,
      autoritate: it.contractingAuthorityNameAndFN ?? null,
      cpv: it.cpvCodeAndName ?? null,
      tip_procedura: it.sysProcedureType?.text ?? null,
      valoare_ron: it.ronContractValue ?? null,
      data_atribuire: it.noticeStateDate ? String(it.noticeStateDate).slice(0, 10) : null,
      link: it.caNoticeId ? `https://e-licitatie.ro/pub/notices/ca-notices/view/${it.caNoticeId}` : null,
      raw: it,
    }
    const { data: ex } = await sb.from('ofertare_participari').select('id').eq('entitate', entitate).eq('nr_seap', it.noticeNo).maybeSingle()
    if (ex) {
      const { error } = await sb.from('ofertare_participari').update(rand).eq('id', ex.id)
      if (error) rap.erori.push(`${it.noticeNo}: ${error.message}`); else rap.actualizate++
    } else {
      const { error } = await sb.from('ofertare_participari').insert(rand)
      if (error) rap.erori.push(`${it.noticeNo}: ${error.message}`); else rap.importate++
    }
  }
  return rap
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Secretul NU stă în sursă: repo-ul e public. Verificare prin RPC contra Vault, care
  // acceptă și valoarea precedentă cât ține fereastra de rotire.
  const s = req.headers.get('x-radar-secret')
  if (!s) return json({ error: 'unauthorized' }, 401)
  const { data: okSecret, error: eSecret } = await sb.rpc('fn_verifica_radar_secret', { p_secret: s })
  if (eSecret || okSecret !== true) return json({ error: 'unauthorized' }, 401)

  let body: any = {}
  try { body = await req.json() } catch { /* gol */ }
  try {
    if (body?.batch) {
      const rapoarte = []
      for (const [ent, id] of Object.entries(ENTITATI)) rapoarte.push(await importa(sb, ent, id))
      return json({ ok: true, rapoarte })
    }
    const entityId = Number(body?.entity_id) || 114759
    const entitate = String(body?.entitate || 'gazpet_instal')
    return json({ ok: true, ...(await importa(sb, entitate, entityId)) })
  } catch (e) { return json({ ok: false, error: String((e as Error).message || e) }, 500) }
})
