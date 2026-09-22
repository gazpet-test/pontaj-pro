// worker/ofertare/clarificari.ts — „Propune clarificări” pe NAS (22.09.2026). Consumă ofertare_clarificari_coada,
// un apel Sonnet pe licitație (core.ts, același cod ca edge function-ul), scrie propunerile în ofertare_clarificari
// (de_trimis, origine platforma) și notifică cine a cerut. Poarta pe cost e în UI (owner/responsabil).
import { propuneClarificari } from '../../supabase/functions/ofertare-clarificari-propune/core.ts'

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[clarificari]', ...a)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function proceseazaClarificari(supabase: any, licId: number, stare: (s: string) => void) {
  const { data: c } = await supabase.from('ofertare_clarificari_coada').select('*').eq('licitatie_id', licId).maybeSingle()
  if (!c?.activ) return
  const t0 = Date.now()
  let r: any = null
  for (let inc = 1; inc <= 3; inc++) {
    stare(`apel ${inc}`)
    r = await propuneClarificari(supabase, { licitatie_id: licId, model: c.model || undefined })
    if (!r?.error || /obligatoriu|negasita|registrul/.test(r.error)) break
    log(`#${licId}: încercarea ${inc} a picat (${String(r.error).slice(0, 150)}) — pauză ${20 * inc} s`)
    await sleep(20_000 * inc)
  }
  const durata = Math.round((Date.now() - t0) / 1000)
  const nota = r?.error ? `❌ ${r.error}` : r?.skip ? `⏭ ${r.skip}` :
    `${r.scrise} clarificări propuse (${(r.clarificari || []).filter((x: any) => x.prioritate === 'eliminatorie').length} eliminatorii), ${r.propuse} generate, ${(r.sarite || []).length} sărite ca duplicat · ${durata} s · ${r.cost_usd} USD (worker NAS)`
  await supabase.from('ofertare_clarificari_coada').update({ activ: false, terminat_la: new Date().toISOString(), ultimul_tick: new Date().toISOString(), nota, rezultat: r }).eq('licitatie_id', licId)
  if (c.cerut_de) {
    const { data: li } = await supabase.from('ofertare_licitatii').select('nr_anunt').eq('id', licId).maybeSingle()
    await supabase.from('notifications').insert({ profile_id: c.cerut_de, type: r?.error ? 'warning' : 'info', modul: 'Ofertare', title: `Ofertare: propunerea de clarificări s-a terminat la ${li?.nr_anunt ?? '#' + licId}`, message: nota.slice(0, 900), link_to: '/ofertare' })
  }
  log(`#${licId}: GATA — ${nota.slice(0, 200)}`)
}
