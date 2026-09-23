// ════════════════════════════════════════════════════════════════
// OfertareSourcePack.jsx — P0c (23.09.2026): Source Pack-urile produse de agentul CLI de pe Terra
// (citite de worker în ofertare_source_pack) se văd, se verifică și se importă AICI, cu mâna.
// Reguli fixe (P0a/P0b, Copilot):
//   - NIMIC nu intră în registrul de cerințe automat: importul e un click explicit, prin
//     fn_ofertare_source_pack_import (DEFINER: owner sau responsabilul licitației), pe ref-urile bifate.
//   - Locatorul e cel DOVEDIT de validatorul fără AI: pagina (exactă) | interval (⟦PAGINA a-b⟧) |
//     document (găsit literal, fără pagină demonstrabilă). „pagina declarată" de model e afișată separat.
//   - PACK_IMPORTED ≠ TENDER_REQUIREMENTS_COMPLETE: un pack importat integral NU înseamnă registru
//     complet — documentele necitite și nereușitele rămân de acoperit. Aici nu apare cuvântul „complet".
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

const STARE_PACK = {
  primit:           { label:'primit — neimportat', color:G.blue },
  importat_partial: { label:'importat parțial',    color:G.orange },
  importat:         { label:'importat integral (≠ registru complet)', color:G.green },
  respins:          { label:'respins de worker',    color:G.red },
}
const TIP = { eliminatorie:['ELIMINATORIE', G.red], propunere:['propunere', G.blue], forma:['formă', G.muted], contractuala:['contractuală', G.purple] }
const INCERT = { sigur:['sigur', G.green], probabil:['probabil', G.yellow], neclar:['neclar', G.orange] }
const MAPARE = { nume_exact:'📎 fișier găsit exact', seap_cod:'📎 fișier după cod SEAP', id_pack:'📎 fișier după id', nume_normalizat:'📎 fișier după nume normalizat' }
const fmtData = (s) => s ? new Date(s).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'
const scurt = (n, max = 52) => (n || '').length > max ? '…' + n.slice(-max) : (n || '')

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

export default function SourcePackSection({ licitatie, profile, onImported }) {
  const [packs, setPacks] = useState(null)
  const [packId, setPackId] = useState(null)
  const [rows, setRows] = useState(null)          // preview
  const [nereusite, setNereusite] = useState([])
  const [istoric, setIstoric] = useState([])
  const [profiles, setProfiles] = useState({})
  const [sel, setSel] = useState([])              // refs bifate
  const [filtru, setFiltru] = useState('neimportate')   // neimportate | avertisment | toate
  const [busy, setBusy] = useState(null)
  const [warn, setWarn] = useState(null)
  const [rezultat, setRezultat] = useState(null)  // ultimul import
  const [arat, setArat] = useState({ nereusite:false, erate:true, documente:false, istoric:false })
  const [deschis, setDeschis] = useState(true)

  const pack = useMemo(() => (packs || []).find(p => p.id === packId) || null, [packs, packId])
  const poateImporta = !!(profile?.is_owner || (licitatie?.responsabil_id && licitatie.responsabil_id === profile?.id))

  const loadPacks = async () => {
    const { data, error } = await supabase.from('ofertare_source_pack')
      .select('id, stamp, fisier, pack_hash, sursa, model, cost_usd, ture, durata_s, nr_cerinte, nr_nereusite, nr_erate, stare, ultim_import_la, nota, creat_la, validare, pack')
      .eq('licitatie_id', licitatie.id).order('creat_la', { ascending:false }).limit(50)
    if (error) { setWarn('Nu s-au încărcat pack-urile: ' + error.message); setPacks([]); return }
    setPacks(data || [])
    if (data?.length && !data.find(p => p.id === packId)) setPackId(data[0].id)
  }
  const loadPack = async (id) => {
    if (!id) { setRows(null); setNereusite([]); setIstoric([]); return }
    setRows(null); setSel([]); setRezultat(null)
    const [pv, ne, im] = await Promise.all([
      supabase.rpc('fn_ofertare_source_pack_preview', { p_pack_id: id }),
      supabase.from('v_ofertare_source_pack_nereusite').select('*').eq('pack_id', id).limit(500),
      supabase.from('ofertare_source_pack_importuri').select('*').eq('pack_id', id).order('creat_la', { ascending:false }).limit(100),
    ])
    if (pv.error) setWarn('Preview eșuat: ' + pv.error.message)
    setRows(pv.data || []); setNereusite(ne.data || []); setIstoric(im.data || [])
  }
  useEffect(() => { loadPacks() }, [licitatie.id])
  useEffect(() => { loadPack(packId) }, [packId])
  useEffect(() => { supabase.from('profiles').select('id, name').then(({ data }) => { const m = {}; (data || []).forEach(p => { m[p.id] = p.name }); setProfiles(m) }) }, [])

  const stats = useMemo(() => {
    const r = rows || []
    return {
      total: r.length,
      importate: r.filter(x => x.deja_importat).length,
      nemapate: r.filter(x => !x.importabil).length,
      avertisment: r.filter(x => x.seamana_cu_id != null && !x.deja_importat).length,
      pagina: r.filter(x => x.locator_verificat === 'pagina').length,
      interval: r.filter(x => x.locator_verificat === 'interval').length,
      document: r.filter(x => x.locator_verificat === 'document').length,
    }
  }, [rows])
  const vizibile = useMemo(() => (rows || []).filter(r =>
    filtru === 'toate' ? true : filtru === 'avertisment' ? (r.seamana_cu_id != null) : (!r.deja_importat)), [rows, filtru])
  const bifabil = (r) => r.importabil && !r.deja_importat
  const toggle = (ref, on) => setSel(v => on ? [...new Set([...v, ref])] : v.filter(x => x !== ref))
  const bifeazaFaraAvertisment = () => setSel(vizibile.filter(r => bifabil(r) && r.seamana_cu_id == null).map(r => r.ref))
  const bifeazaToate = () => setSel(vizibile.filter(bifabil).map(r => r.ref))

  const docStats = useMemo(() => {
    const d = pack?.pack?.documente || []
    const n = (k) => d.filter(x => x.citit === k).length
    return { total: d.length, integral: n('integral'), partial: n('partial'), deloc: n('deloc') }
  }, [pack])
  const erate = pack?.pack?.erate || []

  // Importul: singurul drum spre registru. RPC-ul verifică din nou identitatea pack ↔ licitație,
  // rolul, și sare peste ref-urile deja importate (idempotent). Aici doar întrebăm omul.
  const importa = async () => {
    if (!sel.length || !pack) return
    const cuAvert = sel.filter(ref => rows.find(r => r.ref === ref)?.seamana_cu_id != null).length
    if (!window.confirm(`Imporți ${sel.length} cerințe din pack-ul ${pack.stamp} în registrul licitației?${cuAvert ? `\n\n⚠ ${cuAvert} dintre ele seamănă cu cerințe deja existente în registru — le-ai verificat?` : ''}\n\nRândurile intră ca „de analizat", cu proveniența blocată (pagină/interval/excerpt din pack). Importul rămâne în istoric.`)) return
    setBusy('Se importă prin fn_ofertare_source_pack_import…'); setWarn(null)
    const { data, error } = await supabase.rpc('fn_ofertare_source_pack_import', { p_pack_id: pack.id, p_refs: sel })
    setBusy(null)
    if (error) { setWarn('Import refuzat: ' + error.message); return }
    setRezultat(data)
    await loadPacks(); await loadPack(pack.id); onImported?.()
  }

  if (packs === null) return <div style={{ fontSize:12, color:G.muted, marginTop:14 }}>Se încarcă Source Pack-urile…</div>
  if (!packs.length) return (
    <div style={{ marginTop:14, padding:'10px 14px', borderRadius:10, border:`1px dashed ${G.border}`, fontSize:12, color:G.dim }}>
      📦 Niciun Source Pack pentru licitația asta. Pack-urile se produc pe Terra (agentul CLI + validatorul fără AI) și ajung aici prin worker; nimic nu se importă în registru fără click.
    </div>)

  const st = STARE_PACK[pack?.stare] || STARE_PACK.primit
  const val = pack?.validare || {}
  return (
    <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px solid ${G.border}`, background:G.bg }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13, fontWeight:800, cursor:'pointer' }} onClick={() => setDeschis(v => !v)}>{deschis ? '▾' : '▸'} 📦 Source Packs ({packs.length})</div>
        <select style={{ ...S.input, width:'auto' }} value={packId || ''} onChange={e => setPackId(Number(e.target.value))}>
          {packs.map(p => <option key={p.id} value={p.id}>#{p.id} · {p.stamp} · {p.nr_cerinte ?? '?'} cerințe · {STARE_PACK[p.stare]?.label || p.stare}</option>)}
        </select>
        {pack && <span style={pill(st.color)}>{st.label}</span>}
        <span style={{ marginLeft:'auto', fontSize:11, color:G.dim }} title="Un pack importat nu înseamnă registru complet: documentele necitite și nereușitele rămân de acoperit.">
          pack importat ≠ registru complet
        </span>
      </div>
      {warn && <div style={{ marginTop:8, fontSize:12, color:G.red }}>{warn}</div>}
      {!deschis || !pack ? null : (<>
        {/* fișa pack-ului: cine l-a produs, cât a costat, ce a validat */}
        <div style={{ marginTop:8, fontSize:11.5, color:G.muted, display:'flex', gap:14, flexWrap:'wrap' }}>
          <span>🤖 {pack.model || '?'} · {pack.ture ?? '?'} ture · {pack.durata_s ?? '?'} s · {pack.cost_usd != null ? `${Number(pack.cost_usd).toFixed(2)} $` : 'cost ?'}</span>
          <span title={pack.fisier}>🗂 {pack.fisier} · sha256 {String(pack.pack_hash || '').slice(0, 12)}…</span>
          <span>🧪 {val.validator || 'validator ?'} · pagina {val.cerinte_ok_pagina ?? 0} · interval {val.cerinte_ok_interval ?? 0} · document {val.cerinte_ok_document ?? 0} · respinse {val.cerinte_respinse ?? 0}</span>
          <span>📅 {fmtData(pack.creat_la)}{pack.ultim_import_la ? ` · ultim import ${fmtData(pack.ultim_import_la)}` : ''}</span>
          {pack.nota && <span style={{ color:G.red }}>{pack.nota}</span>}
        </div>

        {/* documente citite — cât din documentație a văzut de fapt modelul */}
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
                  <span>{d.pagini != null ? `${d.pagini} p.` : ''}{d.sha256 ? ' · sha ✓' : ''}</span>
                </div>))}
            </div>)}
        </div>

        {/* erate — schimbări între documente, semnalate de model și verificate literal */}
        {erate.length > 0 && (
          <div style={{ marginTop:8, padding:'8px 10px', borderRadius:8, border:`1px solid ${G.orange}55`, background:G.orange + '0d', fontSize:11.5 }}>
            <span style={{ cursor:'pointer', fontWeight:700, color:G.orange }} onClick={() => setArat(a => ({ ...a, erate: !a.erate }))}>{arat.erate ? '▾' : '▸'} ⚠ {erate.length} erată/erate semnalate</span>
            {arat.erate && erate.map((e, i) => (
              <div key={i} style={{ marginTop:6, color:G.text }}>
                <div><span style={pill(G.orange)}>{e.fel || 'erată'}</span> <span style={{ color:G.muted }}>de la:</span> {e.de_la}</div>
                <div><span style={{ color:G.muted }}>la:</span> {e.la}</div>
                <div style={{ color:G.dim, fontSize:11 }}>📑 {scurt(e.locator?.nume_fisier)} · {e.locator?.verificat ? <Locator r={{ locator_verificat:e.locator.verificat, pagina:e.locator.pagina_validata ?? e.locator.pagina, pagina_declarata:e.locator.pagina_declarata, pagina_interval_start:e.locator.pagina_interval?.[0], pagina_interval_end:e.locator.pagina_interval?.[1] }} /> : <span style={pill(G.red)}>excerpt neverificat</span>}</div>
              </div>))}
          </div>)}

        {/* nereușite — ce n-a putut citi/dovedi; rămân de acoperit de om */}
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

        {/* preview + selecție umană */}
        <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <div style={{ fontSize:12.5, fontWeight:800 }}>
            🔎 Preview: {stats.total} cerințe · <span style={{ color:G.green }}>{stats.importate} importate</span> · {stats.total - stats.importate - stats.nemapate} de decis
            {stats.nemapate ? <span style={{ color:G.orange }}> · {stats.nemapate} fără document mapat</span> : null}
            {stats.avertisment ? <span style={{ color:G.yellow }}> · ⚠ {stats.avertisment} seamănă cu rânduri existente</span> : null}
          </div>
          <span style={{ fontSize:11, color:G.dim }}>locator: {stats.pagina} pagină · {stats.interval} interval · {stats.document} document</span>
          <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
            <select style={{ ...S.input, width:'auto' }} value={filtru} onChange={e => setFiltru(e.target.value)}>
              <option value="neimportate">neimportate</option>
              <option value="avertisment">doar cu avertisment</option>
              <option value="toate">toate</option>
            </select>
            <button style={S.btnS} onClick={bifeazaFaraAvertisment} title="Bifează rândurile importabile care NU seamănă cu nimic din registru">bifează fără avertisment</button>
            <button style={S.btnS} onClick={bifeazaToate}>bifează toate</button>
            <button style={S.btnS} onClick={() => setSel([])}>debifează</button>
          </div>
        </div>

        {rows === null ? <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>Se calculează preview-ul…</div> : (
          <div style={{ marginTop:8, maxHeight:420, overflowY:'auto', display:'flex', flexDirection:'column', gap:4 }}>
            {!vizibile.length && <div style={{ fontSize:12, color:G.dim }}>Nimic de arătat cu filtrul ăsta.</div>}
            {vizibile.map(r => {
              const [tl, tc] = TIP[r.tip] || TIP.propunere
              const inc = INCERT[r.incertitudine]
              const ales = sel.includes(r.ref)
              return (
                <div key={r.ref} style={{ padding:'7px 10px', borderRadius:7, background:G.surface, borderLeft:`3px solid ${r.deja_importat ? G.green : !r.importabil ? G.orange : ales ? G.ofertare : tc}`, opacity: r.deja_importat ? 0.7 : 1 }}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                    <input type="checkbox" style={{ accentColor:G.ofertare, marginTop:3 }} disabled={!bifabil(r)} checked={ales} onChange={e => toggle(r.ref, e.target.checked)} />
                    <span style={{ fontSize:11, fontWeight:800, color:G.dim, minWidth:58, fontVariantNumeric:'tabular-nums' }}>{r.ref}</span>
                    <span style={pill(tc)}>{tl}</span>
                    {r.sectiune && <span style={{ fontSize:11, color:G.muted, fontWeight:700 }}>{r.sectiune}</span>}
                    {r.lot && <span style={{ fontSize:11, color:G.muted }}>lot {r.lot}</span>}
                    <span style={{ flex:1, fontSize:12.5, minWidth:220 }}>{r.text_grounded}</span>
                    <span style={{ display:'flex', gap:5, alignItems:'center', flexWrap:'wrap', marginLeft:'auto' }}>
                      {r.deja_importat && <span style={pill(G.green)}>✓ importat</span>}
                      {!r.importabil && <span style={pill(G.orange)} title="Fișierul din pack nu s-a potrivit cu niciun document al licitației — nu se poate importa">⛔ document nemapat</span>}
                      {inc && <span style={pill(inc[1])} title="Cât de sigur e modelul că e o cerință reală (auto-declarat)">{inc[0]}</span>}
                      {r.cand_se_prezinta && <span style={{ fontSize:11, color:G.dim }}>{r.cand_se_prezinta}</span>}
                    </span>
                  </div>
                  <div style={{ fontSize:11, color:G.dim, marginTop:4, display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                    <span title={r.nume_fisier}>📑 {scurt(r.nume_fisier)}</span>
                    <Locator r={r} />
                    {r.sursa_mapare && <span title="Cum s-a legat fișierul din pack de documentul din licitație">{MAPARE[r.sursa_mapare] || r.sursa_mapare}</span>}
                    {r.seamana_cu_id != null && (
                      <span style={pill(G.yellow)} title="Există deja în registru o cerință cu text asemănător — verifică înainte de import, altfel dublezi"
                        onClick={() => { const el = document.getElementById(`acop-${r.seamana_cu_id}`); if (el) el.scrollIntoView({ behavior:'smooth', block:'center' }) }}>
                        ⚠ seamănă cu o cerință existentă (id {r.seamana_cu_id}, {Math.round((r.seamana_cu_similarity || 0) * 100)}%)
                      </span>)}
                  </div>
                  {r.excerpt_verificat && <div style={{ fontSize:11, color:G.muted, marginTop:3, fontStyle:'italic' }} title="Excerptul găsit literal în textul documentului">„{r.excerpt_verificat}"</div>}
                  {r.document_probant && <div style={{ fontSize:11, color:G.dim, marginTop:2 }}>📄 dovadă: {r.document_probant}</div>}
                </div>)
            })}
          </div>)}

        <div style={{ marginTop:10, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          {poateImporta ? (
            <button style={{ ...S.btnP, opacity: sel.length && !busy ? 1 : 0.5 }} disabled={!sel.length || !!busy} onClick={importa}>
              ⬇ Importă {sel.length} selectate în registru
            </button>
          ) : <span style={{ fontSize:11.5, color:G.dim }}>Importul îl face ownerul sau responsabilul licitației.</span>}
          {busy && <span style={{ fontSize:12, color:G.ofertare }}>{busy}</span>}
          {rezultat && (
            <span style={{ fontSize:11.5, color:G.muted }}>
              ultimul import #{rezultat.import_id}: <b style={{ color:G.green }}>{(rezultat.inserate || []).length} inserate</b>
              {(rezultat.sarite || []).length ? ` · ${rezultat.sarite.length} sărite (deja importate)` : ''}
              {(rezultat.nemapate || []).length ? ` · ${rezultat.nemapate.length} nemapate` : ''}
              {(rezultat.refuzate || []).length ? ` · ${rezultat.refuzate.length} refuzate (ref inexistent)` : ''}
              {' · '}stare pack: {STARE_PACK[rezultat.stare]?.label || rezultat.stare}
            </span>)}
        </div>

        {/* istoric importuri — append-only în BD */}
        <div style={{ marginTop:8, fontSize:11.5 }}>
          <span style={{ cursor:'pointer', color:G.muted }} onClick={() => setArat(a => ({ ...a, istoric: !a.istoric }))}>{arat.istoric ? '▾' : '▸'} 🕓 istoric importuri ({istoric.length})</span>
          {arat.istoric && istoric.map(h => (
            <div key={h.id} style={{ fontSize:11, color:G.dim, marginTop:3 }}>
              #{h.id} · {fmtData(h.creat_la)} · {profiles[h.actor] || h.actor} · cerute {(h.refs_cerute || []).length} → inserate {(h.inserate || []).length}
              {(h.sarite || []).length ? ` · sărite ${h.sarite.length}` : ''}{(h.nemapate || []).length ? ` · nemapate ${h.nemapate.length}` : ''}{(h.refuzate || []).length ? ` · refuzate ${h.refuzate.length}` : ''}
            </div>))}
        </div>
      </>)}
    </div>
  )
}
