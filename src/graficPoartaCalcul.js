// ════════════════════════════════════════════════════════════════
// graficPoartaCalcul.js — checklist-ul „🚧 Poarta grafic", ca funcție PURĂ (fără React, fără Supabase).
//
// R5 runda 4 (verificator R3, 26.09.2026): la generare, poarta se RECALCULEAZĂ ÎNTREAGĂ pe cantitățile recitite din BD
// înainte de îngheț. Până acum se actualiza doar rândul „cant", iar rândul „front" (referința, proveniența fronturilor)
// rămânea calculat pe starea de la încărcare și intra așa în grafic_versiuni.poarta. Mutat din GraficPoarta.jsx NESCHIMBAT,
// cu excepția rândurilor „cant" / „front", care vin din ofertareCantitatiAprobare.js (regula „aprobat = validat").
// Testat în graficPoartaCalcul.test.js (componenta importă clientul Supabase, deci nu se poate testa direct).
// ════════════════════════════════════════════════════════════════
import { controlCantitatiGrafic, controlFronturiGrafic } from './ofertareCantitatiAprobare.js'

// Branșamente/km când numărul nu e în documentație: media Finta (sat compact de câmpie, 590 branș. / 17,4 km rețea PE).
// Hoghilag (20/km) e sat de munte, răsfirat — nu e reprezentativ (Răzvan 04.09.2026).
export const BRANS_PE_KM = 34
export const totalFronturi = (p) => (p?.fronturi || []).reduce((s, f) => s + (Number(f.lungime_m) || 0), 0)

// durata maximă din cerințe („36 de luni", „maximum 36 luni")
export function durataMaxDinCerinte(cerinte) {
  let m = null
  ;(cerinte || []).forEach(c => { const x = (c.text_cerinta || '').match(/(\d{1,3})\s*(?:de\s*)?luni/i); if (x && /durat|execu|depăș|maxim/i.test(c.text_cerinta)) { const v = Number(x[1]); if (!m || v < m) m = v } })
  return m
}

// ── Checklist-ul porții: fiecare rând = {k, titlu, stare: ok|warn|block, detalii} ──
export function calculeazaPoartaGrafic({ p, cantitati, norme, cerinte, durataMax }) {
  if (!p) return []
  const out = []
  // R5 (Copilot 25.09.2026): „cant" = BLOCK cât timp un rând de rețea nu e validat de om (vezi ofertareCantitatiAprobare.js).
  const cc = controlCantitatiGrafic(cantitati, p.cantitati_asumate)
  // R5 condiția 2 (26.09.2026): `lista` = rândurile necesare nevalidate / invalidate — afișate integral sub rând și înghețate cu poarta
  out.push({ k: 'cant', titlu: 'Cantități rețea în platformă — validate de om', stare: cc.stare, detalii: cc.detalii, ...(cc.lista?.length ? { lista: cc.lista } : {}) })
  // R5 runda 4: referința = totalul declarat doar dacă e validat; fronturile salvate trebuie să vină din rânduri validate.
  const cf = controlFronturiGrafic(p, cantitati)
  out.push({ k: 'front', titlu: 'Fronturi de lucru (localități / tronsoane)', stare: cf.stare, detalii: cf.detalii, ...(cf.incomplet ? { incomplet: true } : {}) })
  const nv = (norme || []).filter(n => n.tip_lucrare === p.tip_lucrare)
  const val = nv.filter(n => n.incredere === 'validat')
  out.push({ k: 'norme', titlu: 'Norme de productivitate validate', stare: !val.length ? 'block' : val.length < nv.length ? 'warn' : 'ok',
    detalii: `${val.length} validate din ${nv.length} pentru ${p.tip_lucrare}${val.length ? ' (' + val.map(n => `${n.cod} ${n.productie_zi} ${n.um}/zi`).join(', ') + ')' : ''}` })
  out.push({ k: 'echipe', titlu: 'Echipe alocate', stare: Number(p.echipe) >= 1 ? 'ok' : 'block', detalii: `${p.echipe || 0} echipe de rețea simultane · mediu ${p.mediu}` })
  const dl = Number(p.durata_luni)
  out.push({ k: 'durata', titlu: 'Data de start + durata ofertată', stare: !p.data_start || !dl ? 'block' : (durataMax && dl > durataMax) ? 'block' : 'ok',
    detalii: `${p.data_start || 'fără dată'} · ${dl || '—'} luni${durataMax ? ` (maxim din cerințe: ${durataMax} luni)` : ' (nu am găsit durata maximă în cerințe)'}${durataMax && dl > durataMax ? ' — DEPĂȘEȘTE' : ''}` })
  out.push({ k: 'cerinte', titlu: 'Cerințe de grafic extrase din registru', stare: (cerinte || []).length ? 'ok' : 'block', detalii: `${(cerinte || []).length} cerințe (durată, jaloane, format, resurse)` })
  out.push({ k: 'brans', titlu: 'Branșamente', stare: p.include_bransamente === null ? 'block' : (p.include_bransamente && !Number(p.nr_bransamente)) ? 'warn' : 'ok',
    detalii: p.include_bransamente === null ? 'nedecis: contractul include branșamente?' : p.include_bransamente ? (Number(p.nr_bransamente) ? `da, ${p.nr_bransamente} buc` : `da, număr necunoscut → estimat ${BRANS_PE_KM}/km, media Finta (~${Math.round(totalFronturi(p) / 1000 * BRANS_PE_KM)} buc); completează când vine clarificarea`) : 'nu (doar rețeaua)' })
  out.push({ k: 'ferestre', titlu: 'Constrângeri operator (cuplări, avize, spargeri)', stare: (p.ferestre_operator || '').trim() ? 'ok' : 'warn', detalii: (p.ferestre_operator || '').trim() || 'necompletate — merg în notele graficului' })
  return out
}
