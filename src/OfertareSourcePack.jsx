// ════════════════════════════════════════════════════════════════
// OfertareSourcePack.jsx — P0c (23.09.2026): Source Pack-urile produse de agentul CLI de pe Terra
// (citite de worker în ofertare_source_pack) se văd, se REVIZUIESC și se importă AICI, cu mâna.
// Reguli fixe (P0a/P0b/P0c review semantics, Copilot):
//   - Fiecare candidat primește o DECIZIE UMANĂ explicită per (pack_id, sursa_ref), append-only, auditată:
//     IMPORT | DUPLICATE | REJECT | SUPERSEDED | DEFER (fn_ofertare_source_pack_decide). Decizia NU e starea
//     cerinței din registru și NU se traduce în `nu_se_aplica`.
//   - Importul (fn_ofertare_source_pack_import) acceptă DOAR ref-uri cu decizia curentă IMPORT; e un click explicit.
//   - Similaritatea e AVERTISMENT, nu verdict: omul vede candidatul și cerința existentă față în față și marchează
//     el DUPLICATE. Pragurile nu decid nimic.
//   - Selecția implicită („bifează fără avertisment") exclude: similaritate, incertitudine ≠ sigur, document atins de
//     erată / înlocuit, rânduri deja decise.
//   - PACK_REVIEWED ≠ PACK_IMPORTED ≠ TENDER_REQUIREMENTS_COMPLETE — se afișează separat, nicăieri „complet".
//   - Conținutul pack-ului e text scris de model din documentele autorității: se arată ca date, nu se execută.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF',
}
const S = {
  input: { boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'6px 10px', color:G.text, fontSize:12, outline:'none' },
  btnP: { padding:'7px 14px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12.5, fontWeight:700 },
  btnS: { padding:'5px 10px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:11.5 },
}
const pill = (color, extra = {}) => ({ fontSize:10.5, fontWeight:800, color, background:color + '18', border:`1px solid ${color}55`, borderRadius:10, padding:'2px 8px', whiteSpace:'nowrap', ...extra })
const mini = (color) => ({ ...S.btnS, padding:'2px 7px', fontSize:10.5, color, borderColor: color + '66' })

const STARE_PACK = {
  primit:           { label:'primit — nimic importat', color:G.blue },
  importat_partial: { label:'importat parțial',    color:G.orange },
  importat:         { label:'importat integral (≠ registru complet)', color:G.green },
  respins:          { label:'respins de worker',    color:G.red },
}
// Deciziile umane — vocabular fix (Copilot): NOT_APPLICABLE ≠ DUPLICATE ≠ REJECT ≠ SUPERSEDED ≠ DEFER
const DECIZII = {
  IMPORT:     { label:'IMPORT',     color:G.green,  motiv:false, hint:'intră în registru la următorul „Importă”' },
  DUPLICATE:  { label:'DUPLICATE',  color:G.yellow, motiv:true,  hint:'aceeași cerință există deja — se leagă de rândul existent' },
  REJECT:     { label:'REJECT',     color:G.red,    motiv:true,  hint:'nu e o cerință (zgomot, parafrază greșită, text non-obligație)' },
  SUPERSEDED: { label:'SUPERSEDED', color:G.purple, motiv:true,  hint:'documentul/valoarea a fost înlocuit(ă) prin erată sau versiune nouă' },
  DEFER:      { label:'DEFER',      color:G.orange, motiv:true,  hint:'HOLD — nu se decide acum; rămâne nerevizuit până se verifică' },
}
const TIP = { eliminatorie:['ELIMINATORIE', G.red], propunere:['propunere', G.blue], forma:['formă', G.muted], contractuala:['contractuală', G.purple] }
const INCERT = { sigur:['sigur', G.green], probabil:['probabil', G.yellow], neclar:['neclar', G.orange] }
const MAPARE = { nume_exact:'📎 fișier găsit exact', seap_cod:'📎 fișier după cod SEAP', id_pack:'📎 fișier după id', nume_normalizat:'📎 fișier după nume normalizat' }
const fmtData = (s) => s ? new Date(s).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'
const scurt = (n, max = 52) => (n || '').length > max ? '…' + n.slice(-max) : (n || '')
const numeScurt = (n) => (n || '').split('/').pop()

// Badge-ul de locator: spune EXACT cât s-a dovedit, nu mai mult.
function Locator({ r }) {
  const v = r.locator_verificat
  const decl = r.pagina_declarata
  if (v === 'pagina') return <span style={pill(G.green)} title="Excerptul e găsit literal pe pagina asta (segment ⟦PAGINA n⟧)">📍 pagina {r.pagina}</span>
  if (v === 'interval') return (
    <span style={pill(G.teal)} title="Excerptul e găsit într-un segment ⟦PAGINA a-b⟧: se afirmă DOAR intervalul, nu o pagină exactă">
      📍 paginile {r.pagina_interval_start}–{r.pagina_interval_end}{decl ? ` · model a zis p.${decl}` : ''}
    </span>)
  if (v === 'document') return (
    <span style={pill(G.yellow)} title="Excerptul e găsit literal în document, dar fără o pagină demonstrabilă din marcaje (sau pagina a fost corectată din marcaj)">
      📄 în document{r.pagina ? ` · p.${r.pagina} (din marcaj)` : ''}{decl && decl !== r.pagina ? ` · model a zis p.${decl}` : ''}
    </span>)
  return <span style={pill(G.red)} title="Fără verdict de validator — nu ar trebui să existe în pack">⚠ neverificat</span>
}
// locatorul unui rând EXISTENT din registru (ofertare_cerinte)
const locExistent = (e) => {
  if (!e) return '—'
  if (e.locator_verificat === 'interval' && e.pagina_interval_start) return `paginile ${e.pagina_interval_start}–${e.pagina_interval_end}`
  if (e.sursa_pagina) return `pagina ${e.sursa_pagina}`
  return e.locator_verificat === 'document' ? 'în document, fără pagină demonstrabilă' : 'pagină necunoscută'
}

export default function SourcePackSection({ licitatie, profile, onImported }) {
  const [packs, setPacks] = useState(null)
  const [packId, setPackId] = useState(null)
  const [rows, setRows] = useState(null)          // preview (cu decizia curentă)
  const [revizie, setRevizie] = useState(null)    // v_ofertare_source_pack_revizie
  const [existente, setExistente] = useState({})  // id → rând existent din registru (pentru comparație)
  const [nereusite, setNereusite] = useState([])
  const [istoric, setIstoric] = useState([])
  const [decizii, setDecizii] = useState([])      // audit complet (append-only)
  const [profiles, setProfiles] = useState({})
  const [sel, setSel] = useState([])              // refs bifate (pentru decizii în bloc)
  const [filtru, setFiltru] = useState('nedecise')   // nedecise | avertisment | import | toate
  const [compara, setCompara] = useState({})      // ref → true (panou side-by-side deschis)
  const [busy, setBusy] = useState(null)
  const [warn, setWarn] = useState(null)
  const [rezultat, setRezultat] = useState(null)  // ultimul import
  const [arat, setArat] = useState({ nereusite:false, erate:true, documente:false, istoric:false, decizii:false })
  const [deschis, setDeschis] = useState(true)

  const pack = useMemo(() => (packs || []).find(p => p.id === packId) || null, [packs, packId])
  // 24.09.2026 (Răzvan): poate decide/importa = owner SAU responsabilul licitației SAU admin pe modulul Ofertare —
  // aceeași poartă ca fn_ofertare_source_pack_poate_decide din RPC-uri (UI-ul doar arată/ascunde; RPC-ul verifică oricum).
  const [adminOfertare, setAdminOfertare] = useState(false)
  useEffect(() => {
    if (!profile?.id) return
    supabase.from('user_module_access').select('access_level').eq('profile_id', profile.id).eq('module', 'ofertare').eq('access_level', 'admin').limit(1)
      .then(({ data }) => setAdminOfertare(!!(data && data.length)))
  }, [profile?.id])
  const poateDecide = !!(profile?.is_owner || adminOfertare || (licitatie?.responsabil_id && licitatie.responsabil_id === profile?.id))

  const loadPacks = async () => {
    const { data, error } = await supabase.from('ofertare_source_pack')
      .select('id, stamp, fisier, pack_hash, sursa, model, cost_usd, ture, durata_s, nr_cerinte, nr_nereusite, nr_erate, stare, ultim_import_la, nota, creat_la, validare, pack')
      .eq('licitatie_id', licitatie.id).order('creat_la', { ascending:false }).limit(50)
    if (error) { setWarn('Nu s-au încărcat pack-urile: ' + error.message); setPacks([]); return }
    setPacks(data || [])
    if (data?.length && !data.find(p => p.id === packId)) setPackId(data[0].id)
  }
  const loadPack = async (id, { pastreazaSel = false } = {}) => {
    if (!id) { setRows(null); setNereusite([]); setIstoric([]); setDecizii([]); setRevizie(null); return }
    if (!pastreazaSel) { setRows(null); setSel([]); setRezultat(null) }
    const [pv, ne, im, dz, rv] = await Promise.all([
      supabase.rpc('fn_ofertare_source_pack_preview', { p_pack_id: id }),
      supabase.from('v_ofertare_source_pack_nereusite').select('*').eq('pack_id', id).limit(500),
      supabase.from('ofertare_source_pack_importuri').select('*').eq('pack_id', id).order('creat_la', { ascending:false }).limit(100),
      supabase.from('ofertare_source_pack_decizii').select('*').eq('pack_id', id).order('id', { ascending:false }).limit(2000),
      supabase.from('v_ofertare_source_pack_revizie').select('*').eq('pack_id', id).maybeSingle(),
    ])
    if (pv.error) setWarn('Preview eșuat: ' + pv.error.message)
    const r = pv.data || []
    setRows(r); setNereusite(ne.data || []); setIstoric(im.data || []); setDecizii(dz.data || []); setRevizie(rv.data || null)
    // rândurile existente cu care seamănă candidații (pentru comparația side-by-side) + cele legate de decizii DUPLICATE
    const ids = [...new Set([...r.map(x => x.seamana_cu_id), ...r.map(x => x.decizie_cerinta_id)].filter(Boolean))]
    if (ids.length) {
      const { data: ex } = await supabase.from('ofertare_cerinte')
        .select('id, nr_ordine, text_cerinta, sursa_pasaj, sursa_pagina, sursa_sectiune, stare, stare_motiv, confirmata_de, locator_verificat, pagina_interval_start, pagina_interval_end, sursa_pack_id, sursa_ref, doc:ofertare_documente_atribuire!ofertare_cerinte_sursa_document_id_fkey(nume_original)')
        .in('id', ids)
      const m = {}; (ex || []).forEach(e => { m[e.id] = e }); setExistente(m)
    } else setExistente({})
  }
  useEffect(() => { loadPacks() }, [licitatie.id])
  useEffect(() => { loadPack(packId) }, [packId])
  useEffect(() => { supabase.from('profiles').select('id, name').then(({ data }) => { const m = {}; (data || []).forEach(p => { m[p.id] = p.name }); setProfiles(m) }) }, [])

  // fișiere atinse de erate (documentul din care erata citează valoarea VECHE = document înlocuit / conflict)
  const erate = pack?.pack?.erate || []
  const fisiereErata = useMemo(() => new Set(erate.map(e => e?.locator?.nume_fisier).filter(Boolean)), [erate])
  // avertismentele unui candidat — toate sunt motive să NU intre în selecția implicită
  const avertismente = (r) => {
    const a = []
    if (r.seamana_cu_id != null) a.push({ k:'sim', t:`seamănă cu #${existente[r.seamana_cu_id]?.nr_ordine ?? r.seamana_cu_id} (${Math.round((r.seamana_cu_similarity || 0) * 100)}%)` })
    if (r.incertitudine && r.incertitudine !== 'sigur') a.push({ k:'inc', t:`incertitudine: ${r.incertitudine}` })
    if (fisiereErata.has(r.nume_fisier)) a.push({ k:'erata', t:'document atins de erată / posibil înlocuit' })
    if (!r.importabil) a.push({ k:'nemapat', t:'fișier nemapat în licitație' })
    return a
  }

  const stats = useMemo(() => {
    const r = rows || []
    return {
      total: r.length,
      importate: r.filter(x => x.deja_importat).length,
      nemapate: r.filter(x => !x.importabil).length,
      avertisment: r.filter(x => avertismente(x).length && !x.deja_importat).length,
      nedecise: r.filter(x => !x.decizie && !x.deja_importat).length,
      importDeFacut: r.filter(x => x.decizie === 'IMPORT' && !x.deja_importat && x.importabil).length,
      pagina: r.filter(x => x.locator_verificat === 'pagina').length,
      interval: r.filter(x => x.locator_verificat === 'interval').length,
      document: r.filter(x => x.locator_verificat === 'document').length,
    }
  }, [rows, existente, fisiereErata])
  const vizibile = useMemo(() => (rows || []).filter(r =>
    filtru === 'toate' ? true
    : filtru === 'avertisment' ? avertismente(r).length > 0
    : filtru === 'import' ? r.decizie === 'IMPORT'
    : (!r.decizie && !r.deja_importat)), [rows, filtru, existente, fisiereErata])
  const bifabil = (r) => !r.deja_importat
  const toggle = (ref, on) => setSel(v => on ? [...new Set([...v, ref])] : v.filter(x => x !== ref))
  // selecția implicită: DOAR candidați curați — fără avertisment, sigur, fără erată, nedecis.
  // Bifarea e DOAR stare de UI (setSel): nu scrie nicio decizie și nu importă nimic — deciziile intră doar prin decide()/decideBifate()
  // (click explicit + confirm → RPC), importul doar prin importa() pe rândurile cu decizia curentă IMPORT.
  const bifeazaFaraAvertisment = () => setSel(vizibile.filter(r => bifabil(r) && !r.decizie && r.incertitudine === 'sigur' && avertismente(r).length === 0).map(r => r.ref))
  const bifeazaToate = () => setSel(vizibile.filter(bifabil).map(r => r.ref))

  const docStats = useMemo(() => {
    const d = pack?.pack?.documente || []
    const n = (k) => d.filter(x => x.citit === k).length
    return { total: d.length, integral: n('integral'), partial: n('partial'), deloc: n('deloc') }
  }, [pack])

  // ── decizia umană (append-only prin RPC). Motivul e obligatoriu pentru tot ce nu e IMPORT; DUPLICATE cere rândul existent.
  const decide = async (r, decizie, { bloc = false } = {}) => {
    const d = DECIZII[decizie]; if (!d || !pack) return null
    let motiv = null, cerintaId = null
    if (decizie === 'DUPLICATE') {
      const sugestie = r.seamana_cu_id ? String(r.seamana_cu_id) : ''
      const v = window.prompt(`${r.ref}: DUPLICATE — id-ul cerinței EXISTENTE din registru cu care e identică (uită-te la comparația față în față):`, sugestie)
      if (!v) return null
      cerintaId = Number(v); if (!Number.isInteger(cerintaId)) { setWarn('DUPLICATE: id invalid'); return null }
    }
    if (d.motiv) {
      motiv = window.prompt(`${r.ref}: ${decizie} — motivul (rămâne scris în audit):`, decizie === 'DUPLICATE' && r.seamana_cu_id ? `identică cu #${existente[r.seamana_cu_id]?.nr_ordine ?? r.seamana_cu_id}` : '')
      if (!motiv || !motiv.trim()) return null
    }
    const { data, error } = await supabase.rpc('fn_ofertare_source_pack_decide', { p_pack_id: pack.id, p_ref: r.ref, p_decizie: decizie, p_motiv: motiv, p_cerinta_id: cerintaId })
    if (error) { setWarn(`${r.ref}: decizia a fost refuzată — ${error.message}`); return null }
    if (!bloc) await loadPack(pack.id, { pastreazaSel:true })
    return data
  }
  const decideBifate = async (decizie) => {
    const alese = (rows || []).filter(r => sel.includes(r.ref) && !r.deja_importat)
    if (!alese.length) return
    if (!window.confirm(`Decizia ${decizie} pentru ${alese.length} candidați bifați?${decizie !== 'IMPORT' ? ' (motivul se cere o singură dată și se scrie pe fiecare)' : ''}`)) return
    let motiv = null
    if (DECIZII[decizie].motiv) { motiv = window.prompt(`Motivul pentru toate cele ${alese.length}:`, ''); if (!motiv || !motiv.trim()) return }
    if (decizie === 'DUPLICATE') { setWarn('DUPLICATE se dă rând cu rând (cere cerința existentă exactă).'); return }
    setBusy(`Se scriu ${alese.length} decizii ${decizie}…`)
    for (const r of alese) {
      const { error } = await supabase.rpc('fn_ofertare_source_pack_decide', { p_pack_id: pack.id, p_ref: r.ref, p_decizie: decizie, p_motiv: motiv, p_cerinta_id: null })
      if (error) { setWarn(`${r.ref}: ${error.message}`); break }
    }
    setBusy(null); setSel([]); await loadPack(pack.id)
  }

  // ── importul: singurul drum spre registru. Intră DOAR ref-urile cu decizia curentă IMPORT (RPC-ul verifică din nou).
  const importa = async () => {
    const refs = (rows || []).filter(r => r.decizie === 'IMPORT' && !r.deja_importat && r.importabil).map(r => r.ref)
    if (!refs.length || !pack) return
    if (!window.confirm(`Imporți în registru cele ${refs.length} cerințe cu decizia IMPORT din pack-ul ${pack.stamp}?\n\nRândurile intră ca „de analizat", cu proveniența blocată (pagină/interval/excerpt din pack). Importul rămâne în istoric. Pack-ul NU devine „complet" prin asta.`)) return
    setBusy('Se importă prin fn_ofertare_source_pack_import…'); setWarn(null)
    const { data, error } = await supabase.rpc('fn_ofertare_source_pack_import', { p_pack_id: pack.id, p_refs: refs })
    setBusy(null)
    if (error) { setWarn('Import refuzat: ' + error.message); return }
    setRezultat(data)
    await loadPacks(); await loadPack(pack.id); onImported?.()
  }

  if (packs === null) return <div style={{ fontSize:12, color:G.muted, marginTop:14 }}>Se încarcă Source Pack-urile…</div>
  if (!packs.length) return (
    <div style={{ marginTop:14, padding:'10px 14px', borderRadius:10, border:`1px dashed ${G.border}`, fontSize:12, color:G.dim }}>
      📦 Niciun Source Pack pentru licitația asta. Pack-urile se produc pe Terra (agentul CLI + validatorul fără AI) și ajung aici prin worker; nimic nu se importă în registru fără decizie umană + click.
    </div>)

  const st = STARE_PACK[pack?.stare] || STARE_PACK.primit
  const val = pack?.validare || {}
  const rv = revizie || {}
  return (
    <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800, cursor:'pointer' }} onClick={() => setDeschis(v => !v)}>{deschis ? '▾' : '▸'} 📦 Source Packs ({packs.length})</div>
        <select style={{ ...S.input, width:'auto' }} value={packId || ''} onChange={e => setPackId(Number(e.target.value))}>
          {packs.map(p => <option key={p.id} value={p.id}>#{p.id} · {p.stamp} · {p.nr_cerinte ?? '?'} cerințe · {STARE_PACK[p.stare]?.label || p.stare}</option>)}
        </select>
        {pack && <span style={pill(st.color)}>{st.label}</span>}
        {/* revizie ≠ import: două fapte separate */}
        {revizie && (
          <span style={pill(rv.rezolvat ? G.teal : rv.revizuit ? G.orange : G.dim)} title="revizuit = toate au o decizie (DEFER inclus — pack-ul NU e închis). rezolvat = toate au decizie finală și DEFER = 0. Niciunul nu înseamnă importat și nu înseamnă registru complet.">
            {rv.rezolvat ? '✓ rezolvat (fără DEFER)' : rv.revizuit ? `revizuit, ${rv.decise_defer} în așteptare (DEFER) — neînchis` : 'nerevizuit'} · decise {rv.decise}/{rv.nr_cerinte} · importate {rv.importate}
          </span>)}
        <span style={{ marginLeft:'auto', fontSize:11, color:G.dim }} title="Un pack revizuit sau importat nu înseamnă registru complet: documentele necitite și nereușitele rămân de acoperit.">
          revizuit ≠ rezolvat ≠ importat ≠ registru complet
        </span>
      </div>
      {warn && <div style={{ marginTop:8, fontSize:12, color:G.red }}>{warn} <button style={mini(G.dim)} onClick={() => setWarn(null)}>ok</button></div>}
      {!deschis || !pack ? null : (<>
        <div style={{ marginTop:8, fontSize:11.5, color:G.muted, display:'flex', gap:14, flexWrap:'wrap' }}>
          <span>🤖 {pack.model || '?'} · {pack.ture ?? '?'} ture · {pack.durata_s ?? '?'} s · {pack.cost_usd != null ? `${Number(pack.cost_usd).toFixed(2)} $` : 'cost ?'}</span>
          <span title={pack.fisier}>🗂 {pack.fisier} · sha256 {String(pack.pack_hash || '').slice(0, 12)}…</span>
          <span>🧪 {val.validator || 'validator ?'} · pagina {val.cerinte_ok_pagina ?? 0} · interval {val.cerinte_ok_interval ?? 0} · document {val.cerinte_ok_document ?? 0} · respinse {val.cerinte_respinse ?? 0}</span>
          <span>📅 {fmtData(pack.creat_la)}{pack.ultim_import_la ? ` · ultim import ${fmtData(pack.ultim_import_la)}` : ''}</span>
          {revizie && <span>🧑‍⚖️ IMPORT {rv.decise_import} · DUPLICATE {rv.decise_duplicate} · REJECT {rv.decise_reject} · SUPERSEDED {rv.decise_superseded} · DEFER {rv.decise_defer}</span>}
          {pack.nota && <span style={{ color:G.red }}>{pack.nota}</span>}
        </div>

        {/* documente citite */}
        <div style={{ marginTop:8, fontSize:11.5 }}>
          <span style={{ cursor:'pointer', color:G.muted }} onClick={() => setArat(a => ({ ...a, documente: !a.documente }))}>
            {arat.documente ? '▾' : '▸'} 📚 documente în pack: {docStats.total} · <b style={{ color:G.green }}>{docStats.integral} integral</b> · <b style={{ color:G.yellow }}>{docStats.partial} parțial</b> · <b style={{ color:G.red }}>{docStats.deloc} deloc</b>
          </span>
          {arat.documente && (
            <div style={{ marginTop:4, maxHeight:180, overflowY:'auto', display:'flex', flexDirection:'column', gap:2 }}>
              {(pack.pack?.documente || []).map((d, i) => (
                <div key={i} style={{ fontSize:11, color:G.dim, display:'flex', gap:8 }}>
                  <span style={pill(d.citit === 'integral' ? G.green : d.citit === 'partial' ? G.yellow : G.red, { minWidth:52, textAlign:'center' })}>{d.citit || '?'}</span>
                  <span style={{ color:G.muted }}>{d.titlu || '—'}</span>
                  <span title={d.nume_fisier}>{scurt(d.nume_fisier, 44)}</span>
                  <span>{d.pagini != null ? `${d.pagini} p.` : ''}{d.sha256 ? ' · sha ✓' : ''}{fisiereErata.has(d.nume_fisier) ? ' · ⚠ erată' : ''}</span>
                </div>))}
            </div>)}
        </div>

        {/* erate — documentele lor sunt „conflict de supersession": candidații de acolo nu intră în selecția implicită */}
        {erate.length > 0 && (
          <div style={{ marginTop:8, padding:'8px 10px', borderRadius:8, border:`1px solid ${G.orange}55`, background:G.orange + '0d', fontSize:11.5 }}>
            <span style={{ cursor:'pointer', fontWeight:700, color:G.orange }} onClick={() => setArat(a => ({ ...a, erate: !a.erate }))}>{arat.erate ? '▾' : '▸'} ⚠ {erate.length} erată/erate semnalate — candidații din documentele atinse sunt marcați și excluși din selecția implicită</span>
            {arat.erate && erate.map((e, i) => (
              <div key={i} style={{ marginTop:6, color:G.text }}>
                <div><span style={pill(G.orange)}>{e.fel || 'erată'}</span> <span style={{ color:G.muted }}>de la:</span> {e.de_la}</div>
                <div><span style={{ color:G.muted }}>la:</span> {e.la}</div>
                <div style={{ color:G.dim, fontSize:11 }}>📑 {scurt(e.locator?.nume_fisier)} · {e.locator?.verificat ? <Locator r={{ locator_verificat:e.locator.verificat, pagina:e.locator.pagina_validata ?? e.locator.pagina, pagina_declarata:e.locator.pagina_declarata, pagina_interval_start:e.locator.pagina_interval?.[0], pagina_interval_end:e.locator.pagina_interval?.[1] }} /> : <span style={pill(G.red)}>excerpt neverificat</span>}</div>
              </div>))}
          </div>)}

        {/* nereușite */}
        <div style={{ marginTop:8, fontSize:11.5 }}>
          <span style={{ cursor:'pointer', color: nereusite.length ? G.red : G.muted, fontWeight: nereusite.length ? 700 : 400 }} onClick={() => setArat(a => ({ ...a, nereusite: !a.nereusite }))}>
            {arat.nereusite ? '▾' : '▸'} ⛔ {nereusite.length} nereușite (documente/pasaje necitite sau respinse de validator)
          </span>
          {arat.nereusite && nereusite.length > 0 && (
            <div style={{ marginTop:4, maxHeight:220, overflowY:'auto', display:'flex', flexDirection:'column', gap:3 }}>
              {nereusite.map((n, i) => (
                <div key={i} style={{ fontSize:11, color:G.muted, padding:'4px 8px', borderRadius:6, background:G.surface }}>
                  <span style={pill(G.red)}>{n.motiv}</span> <span title={n.nume_fisier}>{scurt(n.nume_fisier, 60)}</span>
                  {n.nr_pagini > 0 && <span style={{ color:G.dim }}> · pagini {JSON.stringify(n.pagini)}</span>}
                  {n.document_id ? <span style={{ color:G.dim }}> · {MAPARE[n.sursa_mapare] || n.sursa_mapare}</span> : <span style={{ color:G.orange }}> · fișier nemapat în licitație</span>}
                  {n.text_respins && <div style={{ color:G.dim, marginTop:2 }}>„{n.text_respins}"</div>}
                </div>))}
            </div>)}
        </div>

        {/* preview + revizie umană */}
        <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <div style={{ fontSize:12.5, fontWeight:800 }}>
            🔎 Revizie: {stats.total} candidați · <span style={{ color:G.dim }}>{stats.nedecise} nedeciși</span> · <span style={{ color:G.green }}>{stats.importDeFacut} cu IMPORT de făcut</span> · <span style={{ color:G.green }}>{stats.importate} importați</span>
            {stats.nemapate ? <span style={{ color:G.orange }}> · {stats.nemapate} fără document mapat</span> : null}
            {stats.avertisment ? <span style={{ color:G.yellow }}> · ⚠ {stats.avertisment} cu avertisment</span> : null}
          </div>
          <span style={{ fontSize:11, color:G.dim }}>locator: {stats.pagina} pagină · {stats.interval} interval · {stats.document} document</span>
          <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
            <select style={{ ...S.input, width:'auto' }} value={filtru} onChange={e => setFiltru(e.target.value)}>
              <option value="nedecise">nedeciși</option>
              <option value="avertisment">cu avertisment</option>
              <option value="import">cu decizia IMPORT</option>
              <option value="toate">toți</option>
            </select>
            <button style={S.btnS} onClick={bifeazaFaraAvertisment} title="Bifează DOAR candidații curați: fără similaritate, incertitudine = sigur, document neatins de erată, fișier mapat, încă nedeciși">bifează fără avertisment</button>
            <button style={S.btnS} onClick={bifeazaToate}>bifează vizibilii</button>
            <button style={S.btnS} onClick={() => setSel([])}>debifează</button>
          </div>
        </div>
        {poateDecide && sel.length > 0 && (
          <div style={{ marginTop:6, display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', fontSize:11.5, color:G.muted }}>
            decizie pentru {sel.length} bifați:
            {['IMPORT','REJECT','SUPERSEDED','DEFER'].map(k => <button key={k} style={mini(DECIZII[k].color)} title={DECIZII[k].hint} onClick={() => decideBifate(k)}>{k}</button>)}
            <span style={{ color:G.dim }}>(DUPLICATE se dă rând cu rând, cu cerința existentă)</span>
          </div>)}

        {rows === null ? <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>Se calculează preview-ul…</div> : (
          <div style={{ marginTop:8, maxHeight:520, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {!vizibile.length && <div style={{ fontSize:12, color:G.dim }}>Nimic de arătat cu filtrul ăsta.</div>}
            {vizibile.map(r => {
              const [tl, tc] = TIP[r.tip] || TIP.propunere
              const inc = INCERT[r.incertitudine]
              const ales = sel.includes(r.ref)
              const av = avertismente(r)
              const dz = r.decizie ? DECIZII[r.decizie] : null
              const ex = existente[r.seamana_cu_id] || existente[r.decizie_cerinta_id]
              const deschisCmp = !!compara[r.ref]
              return (
                <div key={r.ref} style={{ padding:'7px 10px', borderRadius:7, background:G.surface, borderLeft:`3px solid ${r.deja_importat ? G.green : dz ? dz.color : av.length ? G.yellow : ales ? G.ofertare : tc}`, opacity: r.deja_importat ? 0.7 : 1 }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                    <input type="checkbox" style={{ accentColor:G.ofertare, marginTop:3 }} disabled={!bifabil(r)} checked={ales} onChange={e => toggle(r.ref, e.target.checked)} />
                    <span style={{ fontSize:11, fontWeight:800, color:G.dim, minWidth:58, fontVariantNumeric:'tabular-nums' }}>{r.ref}</span>
                    <span style={pill(tc)}>{tl}</span>
                    {r.sectiune && <span style={{ fontSize:11, color:G.muted, fontWeight:700 }}>{r.sectiune}</span>}
                    {r.lot && <span style={{ fontSize:11, color:G.muted }}>lot {r.lot}</span>}
                    <span style={{ flex:1, fontSize:12.5, minWidth:220 }}>{r.text_grounded}</span>
                    <span style={{ display:'flex', gap:5, alignItems:'center', flexWrap:'wrap', marginLeft:'auto' }}>
                      {r.deja_importat && <span style={pill(G.green)}>✓ importat</span>}
                      {dz && <span style={pill(dz.color)} title={`${r.decizie} · ${profiles[r.decizie_actor] || r.decizie_actor || '?'} · ${fmtData(r.decizie_la)}${r.decizie_motiv ? ` · ${r.decizie_motiv}` : ''}${r.decizie_cerinta_id ? ` · → #${existente[r.decizie_cerinta_id]?.nr_ordine ?? r.decizie_cerinta_id}` : ''}`}>🧑‍⚖️ {r.decizie}{r.decizie_cerinta_id ? ` → #${existente[r.decizie_cerinta_id]?.nr_ordine ?? r.decizie_cerinta_id}` : ''}</span>}
                      {!r.importabil && <span style={pill(G.orange)} title="Fișierul din pack nu s-a potrivit cu niciun document al licitației — nu se poate importa">⛔ document nemapat</span>}
                      {inc && <span style={pill(inc[1])} title="Cât de sigur e modelul că e o cerință reală (auto-declarat)">{inc[0]}</span>}
                      {r.cand_se_prezinta && <span style={{ fontSize:11, color:G.dim }}>{r.cand_se_prezinta}</span>}
                    </span>
                  </div>
                  <div style={{ fontSize:11, color:G.dim, marginTop:4, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                    <span title={r.nume_fisier}>📑 {scurt(r.nume_fisier)}</span>
                    <Locator r={r} />
                    {r.sursa_mapare && <span title="Cum s-a legat fișierul din pack de documentul din licitație">{MAPARE[r.sursa_mapare] || r.sursa_mapare}</span>}
                    {av.map(a => <span key={a.k} style={pill(a.k === 'erata' ? G.orange : G.yellow)} title="Avertisment — nu e verdict. Decizia o dai tu.">⚠ {a.t}</span>)}
                    {(r.seamana_cu_id != null || r.decizie_cerinta_id) && (
                      <button style={mini(G.ofertare)} onClick={() => setCompara(c => ({ ...c, [r.ref]: !c[r.ref] }))}>{deschisCmp ? 'ascunde comparația' : '⇄ compară cu existenta'}</button>)}
                  </div>
                  {r.excerpt_verificat && !deschisCmp && <div style={{ fontSize:11, color:G.muted, marginTop:3, fontStyle:'italic' }} title="Excerptul găsit literal în textul documentului">„{r.excerpt_verificat}"</div>}
                  {r.document_probant && <div style={{ fontSize:11, color:G.dim, marginTop:2 }}>📄 dovadă: {r.document_probant}</div>}

                  {/* comparația față în față: candidatul din pack VS cerința existentă din registru */}
                  {deschisCmp && (
                    <div style={{ marginTop:6, display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, fontSize:11.5 }}>
                      <div style={{ padding:'8px 10px', borderRadius:7, border:`1px solid ${G.teal}55`, background:G.teal + '0a' }}>
                        <div style={{ fontWeight:800, color:G.teal, marginBottom:4 }}>CANDIDAT {r.ref} (pack)</div>
                        <div style={{ color:G.text }}>{r.text_grounded}</div>
                        <div style={{ color:G.muted, marginTop:4, fontStyle:'italic' }}>excerpt: „{r.excerpt_verificat || '—'}"</div>
                        <div style={{ color:G.dim, marginTop:4 }}>📑 {numeScurt(r.nume_fisier)} · <Locator r={r} />{r.sectiune ? ` · ${r.sectiune}` : ''}</div>
                      </div>
                      <div style={{ padding:'8px 10px', borderRadius:7, border:`1px solid ${G.yellow}55`, background:G.yellow + '0a' }}>
                        {ex ? (<>
                          <div style={{ fontWeight:800, color:G.yellow, marginBottom:4 }}>EXISTENTĂ #{ex.nr_ordine} (id {ex.id}) · stare {ex.stare || 'de_analizat'}{ex.confirmata_de ? ' · confirmată' : ''}{ex.sursa_pack_id ? ` · din pack #${ex.sursa_pack_id}` : ''}</div>
                          <div style={{ color:G.text }}>{ex.text_cerinta}</div>
                          <div style={{ color:G.muted, marginTop:4, fontStyle:'italic' }}>pasaj sursă: „{ex.sursa_pasaj || '— (fără pasaj înregistrat)'}"</div>
                          <div style={{ color:G.dim, marginTop:4 }}>📑 {numeScurt(ex.doc?.nume_original) || 'document necunoscut'} · {locExistent(ex)}{ex.sursa_sectiune ? ` · ${ex.sursa_sectiune}` : ''}{ex.stare_motiv ? ` · motiv: ${ex.stare_motiv}` : ''}</div>
                          <div style={{ marginTop:4 }}><span title="Sari la rândul din acoperire" style={{ cursor:'pointer', color:G.ofertare }} onClick={() => { const el = document.getElementById(`acop-${ex.id}`); if (el) el.scrollIntoView({ behavior:'smooth', block:'center' }) }}>↗ vezi în registru</span></div>
                        </>) : <div style={{ color:G.dim }}>Rândul existent nu s-a putut încărca.</div>}
                      </div>
                    </div>)}

                  {/* decizia umană pe rând */}
                  {poateDecide && !r.deja_importat && (
                    <div style={{ marginTop:6, display:'flex', gap:5, alignItems:'center', flexWrap:'wrap', fontSize:11, color:G.dim }}>
                      decizie:
                      {Object.entries(DECIZII).map(([k, d]) => (
                        <button key={k} style={{ ...mini(d.color), opacity: r.decizie === k ? 1 : 0.75, fontWeight: r.decizie === k ? 800 : 500 }} title={d.hint} onClick={() => decide(r, k)}>{r.decizie === k ? '● ' : ''}{k}</button>))}
                      {r.decizie && <span style={{ color:G.dim }}>(o decizie nouă se adaugă peste cea veche; istoricul rămâne)</span>}
                    </div>)}
                </div>)
            })}
          </div>)}

        <div style={{ marginTop:10, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          {poateDecide ? (
            <button style={{ ...S.btnP, opacity: stats.importDeFacut && !busy ? 1 : 0.5 }} disabled={!stats.importDeFacut || !!busy} onClick={importa}
              title="Intră DOAR candidații cu decizia curentă IMPORT și neimportați încă. Bifele nu importă nimic.">
              ⬇ Importă {stats.importDeFacut} cu decizia IMPORT
            </button>
          ) : <span style={{ fontSize:11.5, color:G.dim }}>Deciziile și importul le dă ownerul, responsabilul licitației sau un admin Ofertare.</span>}
          {busy && <span style={{ fontSize:12, color:G.ofertare }}>{busy}</span>}
          {rezultat && (
            <span style={{ fontSize:11.5, color:G.muted }}>
              ultimul import #{rezultat.import_id}: <b style={{ color:G.green }}>{(rezultat.inserate || []).length} inserate</b>
              {(rezultat.sarite || []).length ? ` · ${rezultat.sarite.length} sărite (deja importate)` : ''}
              {(rezultat.nemapate || []).length ? ` · ${rezultat.nemapate.length} nemapate` : ''}
              {(rezultat.fara_decizie || []).length ? ` · ${rezultat.fara_decizie.length} fără decizie IMPORT (refuzate)` : ''}
              {(rezultat.refuzate || []).length ? ` · ${rezultat.refuzate.length} ref inexistent` : ''}
              {' · '}stare pack: {STARE_PACK[rezultat.stare]?.label || rezultat.stare}
            </span>)}
        </div>

        {/* audit decizii — append-only */}
        <div style={{ marginTop:8, fontSize:11.5 }}>
          <span style={{ cursor:'pointer', color:G.muted }} onClick={() => setArat(a => ({ ...a, decizii: !a.decizii }))}>{arat.decizii ? '▾' : '▸'} 🧑‍⚖️ audit decizii ({decizii.length}, append-only)</span>
          {arat.decizii && (
            <div style={{ marginTop:3, maxHeight:200, overflowY:'auto' }}>
              {decizii.map(d => (
                <div key={d.id} style={{ fontSize:11, color:G.dim, marginTop:2 }}>
                  #{d.id} · {fmtData(d.creat_la)} · {profiles[d.actor] || d.actor} · <b style={{ color:DECIZII[d.decizie]?.color }}>{d.sursa_ref} → {d.decizie}</b>{d.cerinta_existenta_id ? ` (→ cerința #${existente[d.cerinta_existenta_id]?.nr_ordine ?? d.cerinta_existenta_id})` : ''}{d.motiv ? ` · ${d.motiv}` : ''}
                </div>))}
            </div>)}
        </div>
        {/* istoric importuri — append-only */}
        <div style={{ marginTop:6, fontSize:11.5 }}>
          <span style={{ cursor:'pointer', color:G.muted }} onClick={() => setArat(a => ({ ...a, istoric: !a.istoric }))}>{arat.istoric ? '▾' : '▸'} 🕓 istoric importuri ({istoric.length})</span>
          {arat.istoric && istoric.map(h => (
            <div key={h.id} style={{ fontSize:11, color:G.dim, marginTop:3 }}>
              #{h.id} · {fmtData(h.creat_la)} · {profiles[h.actor] || h.actor} · cerute {(h.refs_cerute || []).length} → inserate {(h.inserate || []).length}
              {(h.sarite || []).length ? ` · sărite ${h.sarite.length}` : ''}{(h.nemapate || []).length ? ` · nemapate ${h.nemapate.length}` : ''}{(h.refuzate || []).length ? ` · refuzate/fără decizie ${h.refuzate.length}` : ''}
            </div>))}
        </div>
      </>)}
    </div>
  )
}
