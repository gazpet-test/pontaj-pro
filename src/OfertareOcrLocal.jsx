// ════════════════════════════════════════════════════════════════
// OfertareOcrLocal.jsx — 🖨️ „Pornește OCR local” pe licitație (pilotul OCR local, decizia Răzvan 14.10.2026, PR după #700)
//
// Citirea paginilor necitite (scanate) pe serverul AI: LightOn + MinerU local, arbitraj Claude doar pe dezacorduri (PLĂTIT, sub plafon).
// Doar UI, fără schemă nouă. Contract:
//   drept:   fn_ofertare_source_pack_poate_decide(p_licitatie_id) — owner / responsabilul licitației / admin Ofertare (butonul doar lor);
//            poarta REALĂ e în fn_ofertare_ocr_cerere (reverificată după blocarea licitației) — UI-ul doar ascunde și explică.
//   citire:  ofertare_documente_atribuire (pagini_necitite) + fn_ofertare_eligibilitate(p_licitatie_id) (poarta pe loturi);
//            ofertare_ocr_rulari (RLS: accesul Ofertare) — starea, plafonul, costul.
//   scriere: fn_ofertare_ocr_cerere(p_licitatie_id, p_document_ids, p_plafon_usd) — o rulare „cerută” (plafon ≤ 15 USD, 2 zecimale,
//            o singură rulare activă pe licitație); fn_ofertare_ocr_anuleaza(p_rulare_id).
// Nimic nu pornește singur: serverul AI preia rularea doar când omul rulează `python -m ocr_local erp preia`, în fereastra GPU
// (22:00–06:00), după „da pornire” al lui Răzvan. Promovarea textului în ofertă e separată (audit + „da promovare”).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7',
}
const S = {
  input: { boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'6px 9px', color:G.text, fontSize:12.5, outline:'none' },
  btn: { padding:'6px 11px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12 },
  btnP: { padding:'8px 14px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10, padding:14, marginTop:16 },
  badge: c => ({ fontSize:10.5, fontWeight:700, color:c, border:`1px solid ${c}55`, borderRadius:6, padding:'1px 6px', whiteSpace:'nowrap' }),
}
export const FEREASTRA_GPU = '22:00–06:00'
export const PLAFON_MAX = 15
export const MAX_DOCUMENTE = 50   // limita din fn_ofertare_ocr_cerere (cardinality ≤ 50)
// Bugetul rămas al unei rulări, exact ca în BD: plafon − (decontat + rezervat + abandonat). Abandonatul nu e cost decontat,
// dar consumă plafonul (review PR #702 Jakarinos P2).
export const bugetRamas = r => Math.max(0, (Number(r?.plafon_usd) || 0) - (Number(r?.cost_usd) || 0) - (Number(r?.cost_rezervat) || 0) - (Number(r?.cost_abandonat) || 0))
export const STARE_RULARE = {
  ceruta:     ['⏳ cerută — așteaptă serverul AI', G.yellow],
  preluata:   ['🖥️ preluată — citire locală', G.blue],
  citita:     ['🔎 citită — arbitraj pe dezacorduri', G.purple],
  arbitrata:  ['🧮 arbitrată — reconciliere', G.purple],
  finalizata: ['✅ finalizată — de auditat', G.green],
  oprita:     ['⛔ oprită', G.red],
  anulata:    ['✖ anulată', G.dim],
  esuata:     ['⚠️ eșuată', G.red],
}
const ACTIVE = ['ceruta', 'preluata', 'citita', 'arbitrata']
const fmtData = d => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'
const usd = x => (Number(x) || 0).toFixed(2)

// Plafonul, exact regula din fn_ofertare_ocr_cerere: > 0, ≤ 15, cel mult 2 zecimale. null = valid; altfel mesajul.
export function eroarePlafon(txt) {
  const s = String(txt ?? '').trim().replace(',', '.')
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return 'Plafon: un număr cu cel mult 2 zecimale (ex. 15 sau 7.50)'
  const v = Number(s)
  if (!(v > 0) || v > PLAFON_MAX) return `Plafon: peste 0 și cel mult ${PLAFON_MAX} USD`
  return null
}
// Documentele care pot intra: au pagini necitite (1..9999) și sunt eligibile la poarta pe loturi.
export function documenteCandidate(docs, elig) {
  const e = new Map((elig || []).map(r => [r.document_id, r]))
  return (docs || []).map(d => {
    const pag = (d.pagini_necitite || []).filter(p => p >= 1 && p <= 9999)
    const el = e.get(d.id)
    return { ...d, nrPagini: new Set(pag).size, eligibil: el?.eligibil === true, motiv: el?.motiv || (el ? null : 'eligibilitate necunoscută') }
  }).filter(d => d.nrPagini > 0)
}
// Selecția după o (re)încărcare. Implicit (toate eligibile, cel mult limita) DOAR la prima încărcare; apoi strict intersecția
// selecției cu documentele încă eligibile — inclusiv rezultatul gol (review PR #702 r2 Jakarinos P2: o reîncărcare nu are voie să
// bifeze singură documente pe care omul nu le-a ales pentru o procesare plătită).
export function selectieDupaIncarcare(sel, cand, initiala) {
  const elg = (cand || []).filter(x => x.eligibil).map(x => x.id)
  if (initiala) return Object.fromEntries(elg.slice(0, MAX_DOCUMENTE).map(id => [id, true]))
  const e = new Set(elg)
  return Object.fromEntries(Object.entries(sel || {}).filter(([k, v]) => v && e.has(Number(k))).map(([k]) => [k, true]))
}
// Egress din Supabase Storage: fiecare PDF se descarcă O SINGURĂ DATĂ pe serverul AI (cache local) — estimarea = suma mărimilor.
export const fmtMB = b => (Number(b) / 1e6).toLocaleString('ro-RO', { maximumFractionDigits: 1 }) + ' MB'
// Mărime lipsă / invalidă = NECUNOSCUTĂ, nu zero (review PR #702 r4): estimarea spune explicit ce nu știe.
const marimeValida = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0
export const egressEstimat = docs => (docs || []).reduce((a, d) => marimeValida(d.size_bytes) ? { ...a, octeti: a.octeti + Number(d.size_bytes) } : { ...a, necunoscute: a.necunoscute + 1 }, { octeti: 0, necunoscute: 0 })
export const textEgress = e => !e.necunoscute ? `~${fmtMB(e.octeti)}`
  : e.octeti > 0 ? `≥ ${fmtMB(e.octeti)} + ${e.necunoscute} document(e) cu mărime necunoscută` : 'estimare indisponibilă (mărime necunoscută)'
export const textConfirmare = (plafon, nrDoc, nrPag, est = { octeti: 0, necunoscute: 0 }) =>
  `Pornești o procesare PLĂTITĂ: arbitraj Claude pe dezacordurile dintre cele două citiri locale, plafon ${plafon} USD.\n\n` +
  `${nrDoc} document(e), ${nrPag} pagini necitite. Descărcare din Storage (egress): ${textEgress(est)} — o singură copie completă pe rulare, pe serverul AI; reluările după succes nu descarcă din nou. Erorile de transfer pot consuma egress suplimentar, limitat de protecțiile clientului (max 2 încercări pe document, plafon pe rulare). ` +
  `Citirea pe serverul AI se face în fereastra GPU ${FEREASTRA_GPU}; ` +
  `nimic nu intră în ofertă fără audit.\n\nContinui?`

export default function OcrLocalSection({ licitatieId, profile, showToast, reloadKey = 0 }) {
  const [drept, setDrept] = useState(null)           // { licId, permis } | { licId, eroare }
  const [dreptTry, setDreptTry] = useState(0)
  const [docs, setDocs] = useState(null)
  const [sel, setSel] = useState({})                 // document_id → true
  const [plafon, setPlafon] = useState(String(PLAFON_MAX))
  const [rulari, setRulari] = useState([])
  const [busy, setBusy] = useState(false)
  const [eroare, setEroare] = useState(null)
  const gen = useRef(0)                              // doar ultima încărcare își aplică rezultatul (review PR #702 Copilot P2)
  const selInit = useRef(false)                      // selecția implicită s-a pus o dată (prima încărcare reușită)
  const toast = (m, t) => (showToast ? showToast(m, t) : null)

  // Dreptul de decizie: încărcare / refuz / EROARE TEHNICĂ afișate distinct (review PR #702 P2); fail-closed: doar true deschide.
  useEffect(() => {
    let activ = true; setDrept(null)
    if (licitatieId && profile?.id) supabase.rpc('fn_ofertare_source_pack_poate_decide', { p_licitatie_id: licitatieId })
      .then(({ data, error }) => { if (activ) setDrept(error ? { licId: licitatieId, eroare: error.message || 'eroare' } : { licId: licitatieId, permis: data === true }) })
      .catch(e => { if (activ) setDrept({ licId: licitatieId, eroare: e?.message || 'eroare de rețea' }) })
    return () => { activ = false }
  }, [licitatieId, profile?.id, dreptTry])
  const poateDecide = drept?.licId === licitatieId && drept?.permis === true

  const incarca = useCallback(async () => {
    if (!licitatieId) return
    const g = ++gen.current
    setEroare(null)
    const [d, r] = await Promise.all([
      supabase.from('ofertare_documente_atribuire').select('id, nume_original, pagini, pagini_necitite, lot_stare, size_bytes')
        .eq('licitatie_id', licitatieId).not('pagini_necitite', 'is', null).order('id'),
      supabase.from('ofertare_ocr_rulari').select('id, stare, plafon_usd, cost_usd, cost_rezervat, cost_abandonat, pornit_la, preluata_la, terminata_la, oprit_motiv, documente')
        .eq('licitatie_id', licitatieId).order('id', { ascending: false }).limit(5),
    ])
    if (g !== gen.current) return
    if (d.error || r.error) { setEroare((d.error || r.error).message); setDocs([]); return }
    // eligibilitatea, paginat (licitațiile mari au sute de documente); o eroare = documentele rămân neeligibile (fail-closed)
    const elig = []; let errElig = null
    for (let a = 0; ; a += 1000) {
      const { data, error } = await supabase.rpc('fn_ofertare_eligibilitate', { p_licitatie_id: licitatieId }).order('document_id').range(a, a + 999)
      if (error) { errElig = error.message; break }
      elig.push(...(data || [])); if (!data || data.length < 1000) break
    }
    if (g !== gen.current) return
    const cand = documenteCandidate(d.data, errElig ? [] : elig)
    setDocs(cand); setRulari(r.data || []); if (errElig) setEroare('Eligibilitate: ' + errElig)
    // bifele: implicit doar la prima încărcare; apoi doar ce a ales omul și e încă eligibil (și gol)
    const initiala = !selInit.current && !errElig; if (initiala) selInit.current = true
    setSel(s => selectieDupaIncarcare(s, cand, initiala))
  }, [licitatieId])
  useEffect(() => { incarca() }, [incarca, reloadKey])
  // stare schimbată din alt tab (cerere / anulare / serverul AI): reîncărcare la revenirea în fereastră (review PR #702 Jakarinos P2)
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible') incarca() }
    document.addEventListener('visibilitychange', f); window.addEventListener('focus', f)
    return () => { document.removeEventListener('visibilitychange', f); window.removeEventListener('focus', f) }
  }, [incarca])

  const activa = rulari.find(x => ACTIVE.includes(x.stare))
  const alese = (docs || []).filter(d => d.eligibil && sel[d.id])
  const nrPag = alese.reduce((a, d) => a + d.nrPagini, 0)
  const egress = egressEstimat(alese)
  const errPlafon = eroarePlafon(plafon)
  const prea = alese.length > MAX_DOCUMENTE

  const porneste = async () => {
    if (busy || !poateDecide || activa || !alese.length || errPlafon || prea) return
    const p = Number(String(plafon).trim().replace(',', '.'))
    if (!window.confirm(textConfirmare(p.toFixed(2), alese.length, nrPag, egress))) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_ofertare_ocr_cerere', { p_licitatie_id: licitatieId, p_document_ids: alese.map(d => d.id), p_plafon_usd: p })
    setBusy(false)
    if (error) { toast('OCR local: ' + error.message, 'err'); await incarca(); setEroare(error.message); return }  // starea se reîncarcă (alt tab, server)
    toast(`OCR local cerut: rularea #${data?.rulare_id} (plafon ${p.toFixed(2)} USD)`, 'ok'); incarca()
  }
  const anuleaza = async (r) => {
    if (busy || !window.confirm(`Anulezi rularea OCR #${r.id}? Ce s-a cheltuit rămâne în evidență.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('fn_ofertare_ocr_anuleaza', { p_rulare_id: r.id })
    setBusy(false)
    if (error) { toast('Anulare: ' + error.message, 'err'); await incarca(); setEroare(error.message); return }
    toast(`Rularea #${r.id} anulată`, 'ok'); incarca()
  }

  return (
    <div style={S.card}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:14, fontWeight:700, color:G.text }}>🖨️ OCR local — paginile necitite</div>
        <span style={S.badge(G.ofertare)}>pilot</span>
        <span style={{ fontSize:11.5, color:G.muted }}>LightOn + MinerU pe serverul AI · Claude doar pe dezacorduri · fereastra GPU {FEREASTRA_GPU}</span>
        <button style={{ ...S.btn, marginLeft:'auto' }} disabled={busy} onClick={() => { setDreptTry(k => k + 1); incarca() }} title="Reîncarcă starea (alt tab, serverul AI)">↻ Reîmprospătează</button>
      </div>
      {drept?.licId === licitatieId && drept?.eroare && <div style={{ marginTop:8, fontSize:12, color:G.red }}>⚠️ Dreptul de pornire nu s-a putut verifica: {drept.eroare} — butonul rămâne ascuns; „↻ Reîmprospătează” reîncearcă.</div>}
      {eroare && <div style={{ marginTop:8, fontSize:12, color:G.red }}>⚠️ {eroare}</div>}

      {rulari.length > 0 && (
        <div style={{ marginTop:10, display:'grid', gap:6 }}>
          {rulari.map(r => {
            const [et, c] = STARE_RULARE[r.stare] || [r.stare, G.muted]
            const pag = (r.documente || []).reduce((a, x) => a + (x.pagini?.length || 0), 0)
            return (
              <div key={r.id} style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', fontSize:12, color:G.text, background:G.surface, border:`1px solid ${G.border2}`, borderRadius:8, padding:'7px 10px' }}>
                <b>#{r.id}</b><span style={S.badge(c)}>{et}</span>
                <span style={{ color:G.muted }}>{(r.documente || []).length} doc · {pag} pag</span>
                <span style={{ color:G.muted }}>cost {usd(r.cost_usd)} / plafon {usd(r.plafon_usd)} USD{Number(r.cost_rezervat) > 0 ? ` · rezervat ${usd(r.cost_rezervat)}` : ''}{Number(r.cost_abandonat) > 0 ? ` · abandonat ${usd(r.cost_abandonat)}` : ''} · rămas {usd(bugetRamas(r))}</span>
                <span style={{ color:G.dim }}>cerută {fmtData(r.pornit_la)}{r.terminata_la ? ` · încheiată ${fmtData(r.terminata_la)}` : ''}</span>
                {r.oprit_motiv && <span style={{ color:G.orange }}>— {r.oprit_motiv}</span>}
                {poateDecide && ACTIVE.includes(r.stare) && <button style={{ ...S.btn, marginLeft:'auto', color:G.red, borderColor:G.red + '66' }} disabled={busy} onClick={() => anuleaza(r)}>Anulează</button>}
              </div>
            )
          })}
        </div>
      )}

      {docs === null ? <div style={{ marginTop:10, fontSize:12, color:G.muted }}>Se încarcă…</div>
        : docs.length === 0 ? <div style={{ marginTop:10, fontSize:12, color:G.muted }}>Niciun document cu pagini necitite.</div>
        : (
        <div style={{ marginTop:10 }}>
          <div style={{ display:'grid', gap:4 }}>
            {docs.map(d => (
              <label key={d.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color: d.eligibil ? G.text : G.dim, cursor: d.eligibil && poateDecide ? 'pointer' : 'default' }}>
                <input type="checkbox" disabled={!d.eligibil || !poateDecide || !!activa} checked={!!(poateDecide && d.eligibil && sel[d.id])}
                  onChange={e => setSel(s => ({ ...s, [d.id]: e.target.checked }))} />
                <span>#{d.id} {d.nume_original}</span>
                <span style={{ color:G.muted }}>— {d.nrPagini} pagini necitite{d.pagini ? ` din ${d.pagini}` : ''}</span>
                {!d.eligibil && <span style={S.badge(G.orange)}>neeligibil: {d.motiv || 'loturi'}</span>}
              </label>
            ))}
          </div>

          {!poateDecide ? (
            drept?.licId !== licitatieId ? <div style={{ marginTop:10, fontSize:11.5, color:G.muted }}>Se verifică dreptul de pornire…</div>
            : drept?.eroare ? null  // eroarea tehnică e afișată sus, cu reîncercare
            : <div style={{ marginTop:10, fontSize:11.5, color:G.muted }}>Pornirea o poate face doar owner-ul, responsabilul licitației sau un admin Ofertare.</div>
          ) : activa ? (
            <div style={{ marginTop:10, fontSize:11.5, color:G.muted }}>Există deja o rulare activă (#{activa.id}) — o nouă cerere după ce se încheie sau după anulare.</div>
          ) : (
            <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <label style={{ fontSize:12, color:G.muted }}>Plafon (USD)
                <input style={{ ...S.input, width:80, marginLeft:6 }} value={plafon} onChange={e => setPlafon(e.target.value)} inputMode="decimal" />
              </label>
              <button style={{ ...S.btnP, opacity: (busy || !alese.length || errPlafon || prea) ? 0.5 : 1 }} disabled={busy || !alese.length || !!errPlafon || prea} onClick={porneste}>
                {busy ? 'Se trimite…' : `🖨️ Pornește OCR local (${alese.length} doc · ${nrPag} pag · ${textEgress(egress)})`}
              </button>
              {errPlafon && <span style={{ fontSize:11.5, color:G.orange }}>{errPlafon}</span>}
              {prea && <span style={{ fontSize:11.5, color:G.orange }}>Cel mult {MAX_DOCUMENTE} documente într-o rulare (ai bifat {alese.length}) — debifează sau împarte în mai multe rulări.</span>}
              <span style={{ fontSize:11, color:G.dim, flexBasis:'100%' }}>
                Procesare plătită doar pe dezacorduri (arbitraj Claude), oprită automat la plafon. Serverul AI o preia în fereastra GPU {FEREASTRA_GPU}; textul nu intră în ofertă fără audit.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
