// ════════════════════════════════════════════════════════════════
// OfertareBiblioteca.jsx — Ofertare › „⚖️ Bibliotecă juridică” (pasul A, Răzvan 05.10.2026; claude_docs
// tema_biblioteca_juridica_A, docs/juridic/MAPARE_CNSC_IN_ERP.md §5). READ-ONLY peste cnsc_decizii, norme_cerinte
// (+ norme_surse) și clarificari_tipare — RLS existent (SELECT pentru authenticated, scrierea doar owner). Fără tabel nou,
// fără RPC, fără AI. Copierea citării respectă §4 (formatCitare): fără decizie verificată + pagină + link nu se exportă.
// impact_intern (strategie internă) se cere de la server DOAR pentru owner.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import {
  formatCitare, referintaScurta, stareJudiciara, eAtacata, ETICHETA_CJ, fmtData, filtreazaDecizii, ordoneazaDecizii,
  filtreazaCerinte, filtreazaTipare, indexDecizii, deciziiPentruTipar, tiparePentruDecizie, valoriDistincte,
} from './ofertareBiblioteca.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7',
}
const S = {
  input: { boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 10px', color:G.text, fontSize:12.5, outline:'none' },
  btn: { padding:'5px 10px', borderRadius:6, border:`1px solid ${G.border}`, background:'transparent', color:G.text, fontSize:11.5, fontWeight:700, cursor:'pointer' },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10, padding:'12px 14px' },
  lbl: { fontSize:10.5, color:G.muted, fontWeight:700, textTransform:'uppercase', letterSpacing:'.3px', margin:'10px 0 3px' },
  clamp2: { display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' },
}
const PAS = 100

const COL_DECIZII = 'id, source_id, nr_decizie, buletin_oficial, data, an, domeniu, tema, regula, temei_legal, link_sursa, autoritate, obiect, problema, solutie, cum_ne_ajuta, tip_procedura, lege_aplicabila, sub_prag, comparabilitate, citate_cheie, control_judiciar, avertisment_instanta, verificat'
const COL_CERINTE = 'requirement_id, source_id, editie, locator, cerinta, conditii_aplicabilitate, temei_tip, obligatoriu_de_ce, evidenta_ceruta, verificare, prag, domeniu, faza, tema, incredere, verificat_pe_sursa, necesita_standard_licentiat, note'
const COL_SURSE = 'source_id, tip, cod, titlu, emitent, editie, status, url_oficial'
const COL_TIPARE = 'pattern_id, tip_problema, titlu, trigger, documente_de_verificat, normative_refs, precedente_cnsc, intrebare_propusa, confidence, requires_human_legal_review, note'

// PostgREST dă cel mult 1000 de rânduri pe cerere: citim pe pagini, în ordinea cheii, până la capăt
async function toateRandurile(tabel, coloane, cheie) {
  const out = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from(tabel).select(coloane).order(cheie).range(de, de + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}
// Link-urile vin din BD (conținut importat): doar http(s), niciodată javascript: & co.
const linkSigur = u => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null)
const lista = v => (Array.isArray(v) ? v.filter(x => x != null && x !== '') : [])

const Badge = ({ c = G.muted, children, title }) => (
  <span title={title} style={{ fontSize:10.5, fontWeight:700, color:c, border:`1px solid ${c}55`, background:c + '14', borderRadius:5, padding:'1px 6px', whiteSpace:'nowrap' }}>{children}</span>
)
const Camp = ({ eticheta, children, nota }) => (children == null || children === '' ? null : (
  <div>
    <div style={S.lbl}>{eticheta}{nota && <span style={{ marginLeft:6, textTransform:'none', fontWeight:600 }}>{nota}</span>}</div>
    <div style={{ fontSize:12.5, color:G.text, lineHeight:1.55, whiteSpace:'pre-wrap' }}>{children}</div>
  </div>
))
const Sel = ({ v, set, optiuni, toate = 'toate', eticheta }) => (
  <select value={v} onChange={e => set(e.target.value)} style={{ ...S.input, maxWidth:190 }} title={eticheta}>
    <option value="toate">{eticheta}: {toate}</option>
    {optiuni.map(o => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
  </select>
)

export default function OfertareBiblioteca() {
  const [date, setDate] = useState(null)       // { decizii, cerinte, surse, tipare, owner }
  const [eroare, setEroare] = useState(null)

  useEffect(() => {
    let viu = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const { data: p } = user ? await supabase.from('profiles').select('is_owner').eq('id', user.id).maybeSingle() : { data: null }
        const owner = p?.is_owner === true
        const [decizii, cerinte, surse, tipare] = await Promise.all([
          toateRandurile('cnsc_decizii', COL_DECIZII, 'id'),
          toateRandurile('norme_cerinte', COL_CERINTE, 'requirement_id'),
          toateRandurile('norme_surse', COL_SURSE, 'source_id'),
          toateRandurile('clarificari_tipare', owner ? `${COL_TIPARE}, impact_intern` : COL_TIPARE, 'pattern_id'),
        ])
        if (viu) setDate({ decizii: ordoneazaDecizii(decizii), cerinte, surse, tipare, owner })
      } catch (e) { if (viu) setEroare(e?.message || String(e)) }
    })()
    return () => { viu = false }
  }, [])

  if (eroare) return <div style={{ ...S.card, color:G.red, fontSize:13 }}>⚠️ Nu am putut încărca biblioteca juridică: {eroare}</div>
  if (!date) return <div style={{ fontSize:13, color:G.muted }}>⏳ Se încarcă biblioteca juridică…</div>
  return <BibliotecaVedere date={date} />
}

// Vederea propriu-zisă, pe date deja încărcate (separată ca să poată fi randată în teste fără rețea)
export function BibliotecaVedere({ date, tabInitial = 'decizii', selInitial = {} }) {
  const [tab, setTab] = useState(tabInitial)
  const [sel, setSel] = useState({ decizii: null, cerinte: null, tipare: null, ...selInitial })
  const [vizibile, setVizibile] = useState(PAS)
  const [copiat, setCopiat] = useState(null)   // { cheie, ok, msg }
  const [fd, setFd] = useState({ q: '', domeniu: 'toate', tema: 'toate', lege: 'toate', an: 'toate', verificat: 'toate', cj: 'toate', subPrag: 'toate' })
  const [fc, setFc] = useState({ q: '', doarVerificate: true, domeniu: 'toate', faza: 'toate', tema: 'toate' })
  const [ft, setFt] = useState({ q: '', tip: 'toate', review: 'toate', confidence: 'toate' })
  const idx = useMemo(() => indexDecizii(date?.decizii), [date])
  const cerintePeId = useMemo(() => new Map((date?.cerinte || []).map(c => [c.requirement_id, c])), [date])
  const surseMap = useMemo(() => new Map((date?.surse || []).map(s => [s.source_id, s])), [date])
  const tiparePeId = useMemo(() => new Map((date?.tipare || []).map(t => [t.pattern_id, t])), [date])
  const optD = useMemo(() => ({
    domeniu: valoriDistincte(date?.decizii, d => d.domeniu), tema: valoriDistincte(date?.decizii, d => d.tema),
    an: valoriDistincte(date?.decizii, d => d.an).reverse(),
  }), [date])
  const optC = useMemo(() => ({
    domeniu: valoriDistincte(date?.cerinte, c => c.domeniu), faza: valoriDistincte(date?.cerinte, c => c.faza), tema: valoriDistincte(date?.cerinte, c => c.tema),
  }), [date])
  const optT = useMemo(() => ({ tip: valoriDistincte(date?.tipare, t => t.tip_problema), confidence: valoriDistincte(date?.tipare, t => t.confidence) }), [date])

  const decizii = useMemo(() => filtreazaDecizii(date?.decizii, fd), [date, fd])
  const cerinte = useMemo(() => filtreazaCerinte(date?.cerinte, fc), [date, fc])
  const tipare = useMemo(() => filtreazaTipare(date?.tipare, ft), [date, ft])
  useEffect(() => { setVizibile(PAS) }, [tab, fd, fc, ft])

  const copiaza = async (text, cheie) => {
    try { await navigator.clipboard.writeText(text); setCopiat({ cheie, ok: true }) }
    catch (e) { setCopiat({ cheie, ok: false, msg: e?.message || 'clipboard indisponibil' }) }
    setTimeout(() => setCopiat(c => (c?.cheie === cheie ? null : c)), 2500)
  }
  const deschide = (t, id) => { setTab(t); setSel(s => ({ ...s, [t]: id })) }

  const randuri = tab === 'decizii' ? decizii : tab === 'cerinte' ? cerinte : tipare
  const total = tab === 'decizii' ? date.decizii.length : tab === 'cerinte' ? date.cerinte.length : date.tipare.length

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:6 }}>
        <span style={{ fontSize:20 }}>⚖️</span>
        <b style={{ fontSize:16 }}>Bibliotecă juridică</b>
        <span style={{ fontSize:11.5, color:G.dim }}>doar citire · practică CNSC = interpretare, nu normă · citarea se copiază doar cu pagină și link</span>
      </div>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
        {[['decizii', `📜 Decizii CNSC (${date.decizii.length})`], ['cerinte', `📐 Cerințe normative (${date.cerinte.length})`], ['tipare', `❓ Tipare de clarificări (${date.tipare.length})`]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.btn, fontSize:12.5, padding:'7px 14px', border:'none',
            background: tab === k ? G.ofertare + '22' : 'transparent', color: tab === k ? G.ofertare : G.muted }}>{l}</button>
        ))}
      </div>

      {/* Filtre */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:12 }}>
        {tab === 'decizii' && <>
          <input placeholder="Caută în regulă, problemă, soluție, „cum ne ajută”, nr./BO…" value={fd.q} onChange={e => setFd({ ...fd, q: e.target.value })} style={{ ...S.input, width:300 }} />
          <Sel eticheta="Domeniu" v={fd.domeniu} set={v => setFd({ ...fd, domeniu: v })} optiuni={optD.domeniu} />
          <Sel eticheta="Temă" v={fd.tema} set={v => setFd({ ...fd, tema: v })} optiuni={optD.tema} />
          <Sel eticheta="Lege" v={fd.lege} set={v => setFd({ ...fd, lege: v })} optiuni={[['L98', 'L98/2016'], ['L99', 'L99/2016']]} />
          <Sel eticheta="An" v={fd.an} set={v => setFd({ ...fd, an: v })} optiuni={optD.an} />
          <Sel eticheta="Verificată" v={fd.verificat} set={v => setFd({ ...fd, verificat: v })} optiuni={[['da', 'da'], ['nu', 'nu']]} />
          <Sel eticheta="Control judiciar" v={fd.cj} set={v => setFd({ ...fd, cj: v })} optiuni={Object.entries(ETICHETA_CJ)} />
          <Sel eticheta="Sub prag" v={fd.subPrag} set={v => setFd({ ...fd, subPrag: v })} optiuni={[['da', 'da'], ['nu', 'nu'], ['necunoscut', 'necunoscut']]} />
          <button style={S.btn} onClick={() => setFd({ q: '', domeniu: 'toate', tema: 'toate', lege: 'toate', an: 'toate', verificat: 'toate', cj: 'toate', subPrag: 'toate' })}>✕ Resetează</button>
        </>}
        {tab === 'cerinte' && <>
          <input placeholder="Caută în cerință, locator, cod…" value={fc.q} onChange={e => setFc({ ...fc, q: e.target.value })} style={{ ...S.input, width:300 }} />
          <label style={{ fontSize:12, color:G.muted, display:'flex', alignItems:'center', gap:5, cursor:'pointer' }}>
            <input type="checkbox" checked={fc.doarVerificate} onChange={e => setFc({ ...fc, doarVerificate: e.target.checked })} /> doar verificate pe sursă
          </label>
          <Sel eticheta="Domeniu" v={fc.domeniu} set={v => setFc({ ...fc, domeniu: v })} optiuni={optC.domeniu} />
          <Sel eticheta="Fază" v={fc.faza} set={v => setFc({ ...fc, faza: v })} optiuni={optC.faza} />
          <Sel eticheta="Temă" v={fc.tema} set={v => setFc({ ...fc, tema: v })} optiuni={optC.tema} />
        </>}
        {tab === 'tipare' && <>
          <input placeholder="Caută în titlu, întrebarea propusă, semnal…" value={ft.q} onChange={e => setFt({ ...ft, q: e.target.value })} style={{ ...S.input, width:300 }} />
          <Sel eticheta="Tip problemă" v={ft.tip} set={v => setFt({ ...ft, tip: v })} optiuni={optT.tip} />
          <Sel eticheta="Review juridic" v={ft.review} set={v => setFt({ ...ft, review: v })} optiuni={[['da', '⚖️ cerut'], ['nu', 'nu']]} />
          <Sel eticheta="Încredere" v={ft.confidence} set={v => setFt({ ...ft, confidence: v })} optiuni={optT.confidence} />
        </>}
        <span style={{ fontSize:11.5, color:G.dim, marginLeft:'auto' }}>{randuri.length} din {total}</span>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(380px, 1fr))', gap:14, alignItems:'start' }}>
        {/* Lista */}
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {randuri.length === 0 && <div style={{ ...S.card, fontSize:12.5, color:G.muted }}>Nimic nu se potrivește filtrelor.</div>}
          {randuri.slice(0, vizibile).map(r => (
            tab === 'decizii' ? <RandDecizie key={r.id} d={r} activ={sel.decizii === r.id} onClick={() => deschide('decizii', r.id)} />
            : tab === 'cerinte' ? <RandCerinta key={r.requirement_id} c={r} sursa={surseMap.get(r.source_id)} activ={sel.cerinte === r.requirement_id} onClick={() => deschide('cerinte', r.requirement_id)} />
            : <RandTipar key={r.pattern_id} t={r} activ={sel.tipare === r.pattern_id} onClick={() => deschide('tipare', r.pattern_id)} />
          ))}
          {randuri.length > vizibile && <button style={{ ...S.btn, alignSelf:'center' }} onClick={() => setVizibile(v => v + PAS)}>Arată încă {Math.min(PAS, randuri.length - vizibile)}</button>}
        </div>
        {/* Fișa */}
        <div style={{ position:'sticky', top:130 }}>
          {tab === 'decizii' && (sel.decizii && idx.get(sel.decizii)
            ? <FisaDecizie d={idx.get(sel.decizii)} tipare={tiparePentruDecizie(idx.get(sel.decizii), date.tipare)} copiaza={copiaza} copiat={copiat} deschide={deschide} />
            : <Gol text="Alege o decizie din listă." />)}
          {tab === 'cerinte' && (sel.cerinte && cerintePeId.get(sel.cerinte)
            ? <FisaCerinta c={cerintePeId.get(sel.cerinte)} sursa={surseMap.get(cerintePeId.get(sel.cerinte).source_id)} />
            : <Gol text="Alege o cerință din listă." />)}
          {tab === 'tipare' && (sel.tipare && tiparePeId.get(sel.tipare)
            ? <FisaTipar t={tiparePeId.get(sel.tipare)} idx={idx} cerintePeId={cerintePeId} owner={date.owner} copiaza={copiaza} copiat={copiat} deschide={deschide} />
            : <Gol text="Alege un tipar din listă." />)}
        </div>
      </div>
    </div>
  )
}

const Gol = ({ text }) => <div style={{ ...S.card, fontSize:12.5, color:G.dim, textAlign:'center', padding:28 }}>{text}</div>
const stilRand = activ => ({ ...S.card, padding:'9px 12px', textAlign:'left', cursor:'pointer', color:G.text, width:'100%',
  border:`1px solid ${activ ? G.ofertare : G.border}`, background: activ ? G.ofertare + '12' : G.card })

function AvertismentCJ({ cj, scurt }) {
  if (!eAtacata(cj)) return null
  return (
    <div style={{ fontSize: scurt ? 11 : 12, color:G.red, marginTop:4 }}>
      ⚠️ {ETICHETA_CJ[stareJudiciara(cj)].replace(' ⚠️', '')} în instanță{cj.instanta ? ` — ${cj.instanta}` : ''}{cj.nr_hotarare ? `, ${cj.nr_hotarare}` : ''}
    </div>
  )
}

function RandDecizie({ d, activ, onClick }) {
  const atacata = eAtacata(d.control_judiciar)
  return (
    <button onClick={onClick} style={{ ...stilRand(activ), color: atacata ? G.dim : G.text }}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginBottom:3 }}>
        <b style={{ fontSize:12.5 }}>{referintaScurta(d)}</b>
        {d.lege_aplicabila && <Badge c={G.blue}>{d.lege_aplicabila}</Badge>}
        {d.domeniu && <Badge>{d.domeniu}</Badge>}
        {d.verificat !== true && <Badge c={G.yellow} title="neverificată pe sursă — citarea nu se exportă">neverificată</Badge>}
        {atacata && <Badge c={G.red}>⚠️ {ETICHETA_CJ[stareJudiciara(d.control_judiciar)].replace(' ⚠️', '')}</Badge>}
      </div>
      <div style={{ fontSize:12, color: atacata ? G.dim : G.muted, ...S.clamp2 }}>{d.regula || d.problema || d.obiect}</div>
      <AvertismentCJ cj={d.control_judiciar} scurt />
    </button>
  )
}

function RandCerinta({ c, sursa, activ, onClick }) {
  return (
    <button onClick={onClick} style={stilRand(activ)}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginBottom:3 }}>
        <b style={{ fontSize:12 }}>{c.requirement_id}</b>
        <span style={{ fontSize:11.5, color:G.muted }}>{[sursa?.cod || c.source_id, c.locator].filter(Boolean).join(' · ')}</span>
        {c.domeniu && <Badge>{c.domeniu}</Badge>}
        {c.verificat_pe_sursa !== true && <Badge c={G.yellow}>neverificată pe sursă</Badge>}
      </div>
      <div style={{ fontSize:12, color:G.muted, ...S.clamp2 }}>{c.cerinta}</div>
    </button>
  )
}

function RandTipar({ t, activ, onClick }) {
  return (
    <button onClick={onClick} style={stilRand(activ)}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', marginBottom:3 }}>
        <b style={{ fontSize:12 }}>{t.pattern_id}</b>
        {t.tip_problema && <Badge>{t.tip_problema}</Badge>}
        {t.confidence && <Badge c={G.blue}>{t.confidence}</Badge>}
        {t.requires_human_legal_review && <Badge c={G.purple} title="cere review juridic uman înainte de folosire">⚖️ review</Badge>}
      </div>
      <div style={{ fontSize:12, color:G.muted, ...S.clamp2 }}>{t.titlu}</div>
    </button>
  )
}

function FisaDecizie({ d, tipare, copiaza, copiat, deschide }) {
  const cj = d.control_judiciar && typeof d.control_judiciar === 'object' ? d.control_judiciar : null
  const atacata = eAtacata(cj)
  const link = linkSigur(d.link_sursa)
  const comp = d.comparabilitate && typeof d.comparabilitate === 'object' ? d.comparabilitate : null
  return (
    <div style={{ ...S.card, maxHeight:'calc(100vh - 160px)', overflowY:'auto' }}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <b style={{ fontSize:14, color: atacata ? G.dim : G.text }}>Decizia CNSC {referintaScurta(d)}</b>
        {d.verificat === true ? <Badge c={G.green}>verificată pe sursă</Badge> : <Badge c={G.yellow}>neverificată — nu se exportă</Badge>}
      </div>
      <div style={{ fontSize:11.5, color:G.muted, marginTop:3 }}>
        {[d.autoritate, fmtData(d.data) || (d.an ? `anul ${d.an}` : null), d.lege_aplicabila, d.domeniu, d.tip_procedura,
          d.sub_prag === true ? 'sub prag' : d.sub_prag === false ? 'peste prag' : null].filter(Boolean).join(' · ')}
      </div>
      {lista(d.tema).length > 0 && <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:6 }}>{lista(d.tema).map(t => <Badge key={t}>{t}</Badge>)}</div>}

      {cj && (
        <div style={{ marginTop:10, padding:'8px 10px', borderRadius:8, border:`1px solid ${atacata ? G.red : G.border}`, background: atacata ? G.red + '10' : 'transparent' }}>
          <div style={{ fontSize:12, fontWeight:700, color: atacata ? G.red : G.muted }}>Control judiciar: {ETICHETA_CJ[stareJudiciara(cj)]}</div>
          <div style={{ fontSize:12, color:G.text, marginTop:3, lineHeight:1.5 }}>
            {[cj.instanta, cj.nr_hotarare, fmtData(cj.data)].filter(Boolean).join(' · ')}
            {cj.nota && <div style={{ color:G.muted, marginTop:3, whiteSpace:'pre-wrap' }}>{cj.nota}</div>}
            {cj.link && <div style={{ color:G.dim, marginTop:3 }}>{linkSigur(cj.link) ? <a href={linkSigur(cj.link)} target="_blank" rel="noopener noreferrer" style={{ color:G.blue }}>{cj.link}</a> : cj.link}</div>}
          </div>
        </div>
      )}
      {d.avertisment_instanta && <div style={{ marginTop:8, fontSize:12, color:G.red }}>⚠️ {d.avertisment_instanta}</div>}

      <Camp eticheta="Obiect">{d.obiect}</Camp>
      <Camp eticheta="Problema">{d.problema}</Camp>
      <Camp eticheta="Soluția CNSC">{d.solutie}</Camp>
      <Camp eticheta="Regula" nota={<Badge c={G.orange}>interpretare AI — nu citat</Badge>}>{d.regula}</Camp>
      <Camp eticheta="Cum ne ajută" nota={<Badge c={G.orange}>notă internă</Badge>}>{d.cum_ne_ajuta}</Camp>
      {lista(d.temei_legal).length > 0 && <Camp eticheta="Temei legal">{lista(d.temei_legal).join('\n')}</Camp>}
      {comp && <Camp eticheta="Comparabilitate">{[comp.de_ce_comparabila && `De ce e comparabilă: ${comp.de_ce_comparabila}`,
        comp.mai_putin_comparabila && `Mai puțin comparabilă: ${comp.mai_putin_comparabila}`, comp.text, comp.nota].filter(Boolean).join('\n')}</Camp>}

      <div style={S.lbl}>Citate cheie ({lista(d.citate_cheie).length})</div>
      {lista(d.citate_cheie).length === 0 && <div style={{ fontSize:12, color:G.dim }}>Fără citate în corpus.</div>}
      {lista(d.citate_cheie).map((c, i) => {
        const f = formatCitare(d, c), cheie = `${d.id}#${i}`
        return (
          <div key={cheie} style={{ borderLeft:`3px solid ${G.border}`, paddingLeft:10, margin:'6px 0' }}>
            <div style={{ fontSize:12.5, color:G.text, fontStyle:'italic', whiteSpace:'pre-wrap' }}>„{c?.text}”</div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:4, flexWrap:'wrap' }}>
              <span style={{ fontSize:11, color:G.dim }}>{c?.loc || 'fără loc'}</span>
              <button style={{ ...S.btn, opacity: f.ok ? 1 : .45, cursor: f.ok ? 'pointer' : 'not-allowed' }} disabled={!f.ok}
                title={f.ok ? f.citare : f.motiv} onClick={() => f.ok && copiaza(f.text, cheie)}>📋 Copiază citarea</button>
              {!f.ok && <span style={{ fontSize:11, color:G.yellow }}>{f.motiv}</span>}
              {copiat?.cheie === cheie && <span style={{ fontSize:11, color: copiat.ok ? G.green : G.red }}>{copiat.ok ? '✓ copiat' : `⚠️ ${copiat.msg}`}</span>}
            </div>
          </div>
        )
      })}

      {link && <div style={{ marginTop:10, fontSize:12 }}>Sursa: <a href={link} target="_blank" rel="noopener noreferrer" style={{ color:G.blue }}>{link}</a></div>}
      {tipare.length > 0 && <>
        <div style={S.lbl}>Tipare de clarificări care o citează</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {tipare.map(t => <button key={t.pattern_id} style={S.btn} title={t.titlu} onClick={() => deschide('tipare', t.pattern_id)}>{t.pattern_id}</button>)}
        </div>
      </>}
    </div>
  )
}

function FisaCerinta({ c, sursa }) {
  const url = linkSigur(sursa?.url_oficial)
  return (
    <div style={{ ...S.card, maxHeight:'calc(100vh - 160px)', overflowY:'auto' }}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <b style={{ fontSize:14 }}>{c.requirement_id}</b>
        {c.verificat_pe_sursa === true ? <Badge c={G.green}>verificată pe sursă</Badge> : <Badge c={G.yellow}>neverificată pe sursă</Badge>}
        {c.necesita_standard_licentiat && <Badge c={G.orange} title="textul integral e într-un standard licențiat">standard licențiat</Badge>}
      </div>
      <div style={{ fontSize:11.5, color:G.muted, marginTop:3 }}>{[c.domeniu, c.faza, c.tema, c.incredere && `încredere ${c.incredere}`].filter(Boolean).join(' · ')}</div>
      <Camp eticheta="Cerința">{c.cerinta}</Camp>
      <Camp eticheta="Locator">{c.locator}</Camp>
      <div>
        <div style={S.lbl}>Sursa</div>
        <div style={{ fontSize:12.5, lineHeight:1.5 }}>
          {sursa ? <>
            <b>{sursa.cod}</b>{sursa.titlu && sursa.titlu !== sursa.cod ? ` — ${sursa.titlu}` : ''}{c.editie ? ` (ediția ${c.editie})` : ''}
            {sursa.status && sursa.status !== 'in_vigoare' && <span style={{ color:G.yellow }}> · ⚠️ {sursa.status}</span>}
            {url && <div><a href={url} target="_blank" rel="noopener noreferrer" style={{ color:G.blue }}>{url}</a></div>}
          </> : <span style={{ color:G.dim }}>{c.source_id}</span>}
        </div>
      </div>
      <Camp eticheta="Temei">{c.temei_tip}</Camp>
      <Camp eticheta="De ce e obligatorie">{c.obligatoriu_de_ce}</Camp>
      <Camp eticheta="Condiții de aplicabilitate">{c.conditii_aplicabilitate}</Camp>
      {lista(c.evidenta_ceruta).length > 0 && <Camp eticheta="Evidența cerută">{lista(c.evidenta_ceruta).map(x => `• ${x}`).join('\n')}</Camp>}
      <Camp eticheta="Verificare">{c.verificare}</Camp>
      {c.prag != null && <Camp eticheta="Prag">{typeof c.prag === 'object' ? JSON.stringify(c.prag, null, 2) : String(c.prag)}</Camp>}
      <Camp eticheta="Note">{c.note}</Camp>
    </div>
  )
}

function FisaTipar({ t, idx, cerintePeId, owner, copiaza, copiat, deschide }) {
  const tr = t.trigger && typeof t.trigger === 'object' ? t.trigger : null
  const precedente = deciziiPentruTipar(t, idx)
  const cheie = `${t.pattern_id}#q`
  return (
    <div style={{ ...S.card, maxHeight:'calc(100vh - 160px)', overflowY:'auto' }}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <b style={{ fontSize:14 }}>{t.pattern_id}</b>
        {t.tip_problema && <Badge>{t.tip_problema}</Badge>}
        {t.confidence && <Badge c={G.blue}>încredere {t.confidence}</Badge>}
        {t.requires_human_legal_review && <Badge c={G.purple}>⚖️ cere review juridic uman</Badge>}
      </div>
      <div style={{ fontSize:13.5, fontWeight:700, marginTop:6 }}>{t.titlu}</div>
      {tr && <>
        <Camp eticheta="Semnal (când apare)">{tr.semnal}</Camp>
        {lista(tr.unde_cauti).length > 0 && <Camp eticheta="Unde cauți">{lista(tr.unde_cauti).join(' · ')}{tr.tip_detectie ? `  (${tr.tip_detectie})` : ''}</Camp>}
      </>}
      {lista(t.documente_de_verificat).length > 0 && <Camp eticheta="Documente de verificat">{lista(t.documente_de_verificat).map(x => `• ${x}`).join('\n')}</Camp>}
      <div>
        <div style={S.lbl}>Întrebarea propusă <span style={{ textTransform:'none', fontWeight:600 }}><Badge c={G.orange}>ciornă — se adaptează; nu intră automat în clarificări</Badge></span></div>
        <div style={{ fontSize:12.5, lineHeight:1.55, whiteSpace:'pre-wrap', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:8, padding:'8px 10px' }}>{t.intrebare_propusa}</div>
        {t.intrebare_propusa && <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:6 }}>
          <button style={S.btn} onClick={() => copiaza(t.intrebare_propusa, cheie)}>📋 Copiază întrebarea</button>
          {copiat?.cheie === cheie && <span style={{ fontSize:11, color: copiat.ok ? G.green : G.red }}>{copiat.ok ? '✓ copiat' : `⚠️ ${copiat.msg}`}</span>}
        </div>}
      </div>
      <div style={S.lbl}>Precedente CNSC ({precedente.length})</div>
      {precedente.length === 0 && <div style={{ fontSize:12, color:G.dim }}>Fără precedente legate.</div>}
      {precedente.map(({ ref, decizie }) => decizie ? (
        <button key={ref} onClick={() => deschide('decizii', decizie.id)} style={{ ...stilRand(false), padding:'6px 10px', marginBottom:4, color: eAtacata(decizie.control_judiciar) ? G.dim : G.text }}>
          <div style={{ fontSize:12, display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            <b>{referintaScurta(decizie)}</b>{decizie.verificat !== true && <Badge c={G.yellow}>neverificată</Badge>}
          </div>
          <div style={{ fontSize:11.5, color:G.muted, ...S.clamp2 }}>{decizie.regula || decizie.problema}</div>
          <AvertismentCJ cj={decizie.control_judiciar} scurt />
        </button>
      ) : <div key={ref} style={{ fontSize:11.5, color:G.dim, margin:'2px 0' }}>{ref} — lipsește din corpus</div>)}
      {lista(t.normative_refs).length > 0 && <>
        <div style={S.lbl}>Cerințe normative</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {lista(t.normative_refs).map(r => cerintePeId.get(r)
            ? <button key={r} style={S.btn} title={cerintePeId.get(r).cerinta} onClick={() => deschide('cerinte', r)}>{r}</button>
            : <span key={r} style={{ fontSize:11.5, color:G.dim }}>{r}</span>)}
        </div>
      </>}
      {owner && t.impact_intern && <Camp eticheta="Impact intern (doar owner)">{typeof t.impact_intern === 'object' ? JSON.stringify(t.impact_intern, null, 2) : String(t.impact_intern)}</Camp>}
      <Camp eticheta="Note">{t.note}</Camp>
    </div>
  )
}
