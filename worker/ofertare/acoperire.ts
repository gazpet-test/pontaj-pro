// worker/ofertare/acoperire.ts — „Propune acoperiri” pe NAS (22.09.2026, decizie Răzvan: varianta A).
// Consumă ofertare_acoperire_coada (un rând per licitație, creat din UI de owner/responsabil). Rulează
// EXACT logica din supabase/functions/ofertare-acoperire/core.ts (același cod ca edge function-ul), dar
// fără limita de 150 s a gateway-ului: batch-ul „eliminatorie” de 51 cerințe la Jilava cădea acolo.
// Orchestrarea (felii de 55, reluări la 27, note finale) e portată din OfertareLicitatii.jsx → propune().
import { propuneAcoperiri } from '../../supabase/functions/ofertare-acoperire/core.ts'
import type { Garda } from './poarta_coada.ts'

const FELIE = 55, FELIE_RELUARE = 27, MAX_INCERCARI = 3
// 20261124a (r2 Jakarinos P1-03): poarta pe cheltuială se întreabă înaintea FIECĂRUI apel plătit (felie, reîncercare, jumătate);
// refuz / cerere înlocuită / eroare → rularea se oprește fără notă finală (garda a închis deja cererea, sau e o cerere nouă).
// r4 (review r3): garda e OBLIGATORIE, iar scrierile pe coadă (tick + închiderea) trec prin garda.scrie (CAS pe cerere).
type Poarta = Garda
const OPRIT_POARTA = 'oprit de poarta pe cheltuială'
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[acoperire]', ...a)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function felie(supabase: any, licId: number, batch: string, ids: number[], poarta: Poarta): Promise<any> {
  for (let inc = 1; inc <= MAX_INCERCARI; inc++) {
    if (!(await poarta())) return { error: OPRIT_POARTA, oprit_poarta: true }
    const r = await propuneAcoperiri(supabase, { licitatie_id: licId, batch, ids })
    if (!r?.error) return r
    // răspuns tăiat la max_tokens: e determinist pe aceeași felie (Jilava 22.09: de 3 ori la rând pe 55) —
    // nu se repetă, se sparge felia în două și se rulează jumătățile (până la 10 cerințe)
    if (/tăiat|taiat|trunchiat/i.test(r.error)) {
      if (ids.length <= 10) return r
      const j = Math.ceil(ids.length / 2)
      log(`#${licId} ${batch}: felie de ${ids.length} tăiată la max_tokens → o sparg în ${j} + ${ids.length - j}`)
      const a = await felie(supabase, licId, batch, ids.slice(0, j), poarta)
      if (a?.oprit_poarta) return a
      const b = await felie(supabase, licId, batch, ids.slice(j), poarta)
      if (b?.oprit_poarta) return b
      if (a?.error && b?.error) return { error: `${a.error} | ${b.error}` }
      const suma = (k: string) => (a?.[k] || 0) + (b?.[k] || 0)
      const lista = (k: string) => [...(a?.[k] || []), ...(b?.[k] || [])]
      return {
        ok: true, batch, felie: ids.length, propuneri: suma('propuneri'), goluri: suma('goluri'),
        tokens_in: suma('tokens_in'), tokens_out: suma('tokens_out'), trunchiat: !!(a?.trunchiat || b?.trunchiat),
        fara_raspuns: suma('fara_raspuns') + (a?.error ? j : 0) + (b?.error ? ids.length - j : 0),
        cerinte_fara_raspuns: [...lista('cerinte_fara_raspuns'), ...(a?.error ? ids.slice(0, j) : []), ...(b?.error ? ids.slice(j) : [])],
        conflicte_verificate: lista('conflicte_verificate'), conflicte_raspuns: lista('conflicte_raspuns'),
        duplicate_ramase: suma('duplicate_ramase'), eroare_partiala: a?.error || b?.error || undefined,
      }
    }
    // erorile de catalog / autorizare nu se repară prin reîncercare; cele de rețea/AI da
    if (/catalog|obligatorii|negasita|Blocat pe loturi/.test(r.error) || inc === MAX_INCERCARI) return r   // loturi: refuz stabil
    log(`#${licId} ${batch}: încercarea ${inc} a picat (${r.error.slice(0, 120)}) — pauză ${20 * inc} s`)
    await sleep(20_000 * inc)
  }
  return { error: 'reîncercări epuizate' }
}

export async function proceseazaAcoperire(supabase: any, licId: number, esteOprire: () => boolean, stare: (s: string) => void, poarta: Poarta) {
  const { data: c } = await supabase.from('ofertare_acoperire_coada').select('*').eq('licitatie_id', licId).maybeSingle()
  if (!c?.activ) return
  const t0 = Date.now()
  const jurnal: any[] = []
  const conflicte: any[] = [], raspunsuriPierdute: any[] = [], erori: string[] = []
  let neacoperite = 0, neconfirmate = 0, duplicate = 0, propuneri = 0, goluri = 0, cost = 0, felii = 0
  const tick = async (extra: Record<string, unknown> = {}) =>
    poarta.scrie({ ultimul_tick: new Date().toISOString(), jurnal, stare: { propuneri, goluri, felii, cost_usd: Number(cost.toFixed(4)), ...extra } })

  // r4 (review r4 Jakarinos P2-01): o scriere de progres care nu reușește (cerere înlocuită / oprită sau eroare) oprește rularea —
  // nu se mai plătește felia următoare; nota finală nu se scrie (CAS)
  const opritScriere = () => { log('#' + licId + ': scrierea progresului pe coadă n-a reușit (cerere înlocuită / oprită sau eroare) — mă opresc') }
  let qc = supabase.from('ofertare_cerinte').select('id, tip').eq('licitatie_id', licId).is('inlocuita_de', null).order('id')
  // cerinte_ids: reluare doar pe o listă (ex. felia rămasă fără răspuns), nu pe tot registrul
  if (Array.isArray(c.cerinte_ids) && c.cerinte_ids.length) qc = qc.in('id', c.cerinte_ids)
  const { data: cerinte } = await qc
  const batchuri = (c.batchuri as string[] | null)?.length ? (c.batchuri as string[]) : ['eliminatorie', 'propunere']
  for (const batch of batchuri) {
    if (esteOprire()) break
    const ids = (cerinte || []).filter((x: any) => x.tip === batch).map((x: any) => x.id)
    if (!ids.length) continue
    const deReluat: number[] = []
    for (let i = 0; i < ids.length; i += FELIE) {
      if (esteOprire()) break
      const f = ids.slice(i, i + FELIE)
      stare(`${batch} ${Math.min(i + FELIE, ids.length)}/${ids.length}`)
      const tf = Date.now()
      const r = await felie(supabase, licId, batch, f, poarta)
      if (r?.oprit_poarta) { log(`#${licId}: ${OPRIT_POARTA} — mă opresc`); return }
      felii++
      const ms = Date.now() - tf
      if (r?.error) {
        erori.push(`${batch} (felia ${i / FELIE + 1}): ${r.error}`)
        jurnal.push({ la: new Date().toISOString(), batch, felie: f.length, eroare: r.error.slice(0, 300), ms })
        log(`#${licId} ${batch} felia ${i / FELIE + 1}: EROARE ${r.error.slice(0, 200)}`)
        if (await tick() !== 'ok') return opritScriere(); continue
      }
      propuneri += r.propuneri || 0; goluri += r.goluri || 0
      cost += ((r.tokens_in || 0) * 5 + (r.tokens_out || 0) * 25) / 1e6
      const listaOk = r.cerinte_fara_raspuns?.length && !r.lista_fara_raspuns_taiata
      if (r.trunchiat || r.fara_raspuns > 0 || r.felie_goala) deReluat.push(...(listaOk ? r.cerinte_fara_raspuns : f))
      if (r.conflicte_verificate?.length) conflicte.push(...r.conflicte_verificate)
      if (r.duplicate_ramase > 0) duplicate += r.duplicate_ramase
      if (r.conflicte_raspuns?.length) raspunsuriPierdute.push(...r.conflicte_raspuns)
      if (r.eroare_partiala) erori.push(`${batch} (jumătate de felie): ${r.eroare_partiala}`)
      jurnal.push({ la: new Date().toISOString(), batch, felie: f.length, propuneri: r.propuneri, goluri: r.goluri, fara_raspuns: r.fara_raspuns, trunchiat: !!r.trunchiat, eroare_partiala: r.eroare_partiala, ms })
      log(`#${licId} ${batch} felia ${i / FELIE + 1}: ${r.propuneri ?? 0} propuneri, ${r.goluri ?? 0} goluri, ${r.fara_raspuns ?? 0} fără răspuns${r.trunchiat ? ' (TĂIAT)' : ''} · ${ms} ms`)
      if (await tick() !== 'ok') return opritScriere()
    }
    for (let i = 0; i < deReluat.length; i += FELIE_RELUARE) {
      if (esteOprire()) break
      const f = deReluat.slice(i, i + FELIE_RELUARE)
      stare(`reluare ${batch} ${Math.min(i + FELIE_RELUARE, deReluat.length)}/${deReluat.length}`)
      const tf = Date.now()
      const r = await felie(supabase, licId, batch, f, poarta)
      if (r?.oprit_poarta) { log(`#${licId}: ${OPRIT_POARTA} — mă opresc`); return }
      felii++
      if (r?.error) { erori.push(`${batch} (reluare): ${r.error}`); neconfirmate += deReluat.length - i; jurnal.push({ la: new Date().toISOString(), batch, reluare: f.length, eroare: r.error.slice(0, 300) }); if (await tick() !== 'ok') return opritScriere(); break }
      propuneri += r.propuneri || 0; goluri += r.goluri || 0
      cost += ((r.tokens_in || 0) * 5 + (r.tokens_out || 0) * 25) / 1e6
      if (r.conflicte_verificate?.length) conflicte.push(...r.conflicte_verificate)
      if (r.fara_raspuns > 0) neacoperite += r.fara_raspuns
      if (r.duplicate_ramase > 0) duplicate += r.duplicate_ramase
      if (r.conflicte_raspuns?.length) raspunsuriPierdute.push(...r.conflicte_raspuns)
      jurnal.push({ la: new Date().toISOString(), batch, reluare: f.length, propuneri: r.propuneri, fara_raspuns: r.fara_raspuns, ms: Date.now() - tf })
      log(`#${licId} ${batch} reluare ${i / FELIE_RELUARE + 1}: ${r.propuneri ?? 0} propuneri, ${r.fara_raspuns ?? 0} fără răspuns`)
      if (await tick() !== 'ok') return opritScriere()
    }
  }
  if (esteOprire()) { await tick({ oprit: 'worker oprit — reia propunerea' }); return }
  // aceleași note ca în UI (OfertareLicitatii.jsx → propune), ca omul să citească același limbaj
  const note: string[] = []
  if (erori.length) note.push(`❌ ${erori.join(' · ')}`)
  if (neconfirmate > 0) note.push(`❓ ${neconfirmate} cerințe au rămas cu rezultat neconfirmat (reluarea a căzut) — reia propunerea.`)
  if (raspunsuriPierdute.length) note.push(`🔀 ${raspunsuriPierdute.length} cerințe au două răspunsuri/tichete diferite de la colegi — le-am lăsat NEATINSE, propunerea AI nu s-a scris la ele.`)
  if (duplicate > 0) note.push(`⚠️ ${duplicate} rânduri vechi n-au putut fi șterse — pot exista acoperiri duplicate. Verifică înainte să te bazezi pe tabel.`)
  if (neacoperite > 0) note.push(`⚠️ ${neacoperite} cerințe n-au fost reevaluate nici la reluare — păstrează verdictul din rularea anterioară.`)
  if (conflicte.length) note.push(`🔒 ${conflicte.length} cerințe au dovadă verificată de om: propunerea AI-ului NU le-a suprascris.`)
  const durata = Math.round((Date.now() - t0) / 1000)
  const nota = `${propuneri} propuneri (${goluri} goluri) în ${felii} felii, ${durata} s, ${cost.toFixed(2)} USD (worker NAS)${note.length ? ' · ' + note.join(' ') : ''}`
  // r4 (Jakarinos r3 P2-01): închiderea doar pe ACEEAȘI cerere (CAS) — rezultatul unei rulări vechi nu închide cererea nouă
  const rInch = await poarta.scrie({ activ: false, terminat_la: new Date().toISOString(), nota, jurnal, ultimul_tick: new Date().toISOString(), stare: { propuneri, goluri, felii, cost_usd: Number(cost.toFixed(4)), erori: erori.length } })
  if (rInch !== 'ok') { log('#' + licId + ': rezultatul NU s-a scris pe coadă (' + (rInch === 'inlocuita' ? 'cererea a fost înlocuită / oprită între timp' : 'eroare de scriere') + ')'); return }
  if (c.cerut_de) {
    const { data: li } = await supabase.from('ofertare_licitatii').select('nr_anunt').eq('id', licId).maybeSingle()
    await supabase.from('notifications').insert({ profile_id: c.cerut_de, type: erori.length ? 'warning' : 'info', modul: 'Ofertare', title: `Ofertare: propunerea de acoperiri s-a terminat la ${li?.nr_anunt ?? '#' + licId}`, message: nota.slice(0, 900), link_to: '/ofertare' })
  }
  log(`#${licId}: GATA — ${nota.slice(0, 200)}`)
}
