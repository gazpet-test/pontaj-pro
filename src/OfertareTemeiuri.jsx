// ════════════════════════════════════════════════════════════════
// OfertareTemeiuri.jsx — „⚖️ Temei” pe o întrebare de clarificare sau pe un punct al ei (pasul B, MAPARE_CNSC_IN_ERP.md).
// Chip-urile cu temeiurile atașate + modalul cu 3 file: Tipar (precedentele tiparului, treapta 1 deterministă),
// Decizii CNSC (căutare în corpus), Cerințe normative. Textul întrebării NU se modifică niciodată automat.
// Citatul se copiază înghețat din citate_cheie (trigger-ul din BD îl verifică). Export în adresă doar cu bifa „include în adresă”.
// Tabelul ofertare_clarificari_temeiuri vine din migrarea 20261014a — până e aplicată, componenta spune asta și nu crapă.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import { propuneriDinTipar, formatCitare, etichetaDecizie, rezultatCJ, esteExclusa, avertismente } from './ofertareTemeiuri.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#A371F7' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'6px 9px', color:G.text, fontSize:12, outline:'none' },
  btnP: { padding:'6px 12px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:700 },
  btnS: { padding:'5px 10px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:11.5 },
}
const CUL_CJ = { mentinuta: G.green, neverificat: G.dim, necunoscut: G.yellow, modificata: G.red, desfiintata: G.red }
const TXT_CJ = { mentinuta: 'menținută în instanță', neverificat: 'neverificată în instanță', necunoscut: 'control judiciar necunoscut', modificata: 'MODIFICATĂ în instanță', desfiintata: 'DESFIINȚATĂ în instanță' }
const SEL_DECIZIE = 'id, nr_decizie, buletin_oficial, data, an, domeniu, tema, regula, lege_aplicabila, link_sursa, verificat, control_judiciar, avertisment_instanta, citate_cheie'
const TABEL_LIPSA = e => /ofertare_clarificari_temeiuri/.test(e?.message || '') && /does not exist|schema cache|not find/i.test(e?.message || '')

const Badge = ({ children, col = G.muted, title }) => <span title={title} style={{ fontSize:10.5, fontWeight:700, color:col, border:`1px solid ${col}55`, borderRadius:5, padding:'1px 6px', whiteSpace:'nowrap' }}>{children}</span>

// Fișa scurtă a unei decizii în listă + citatele ei, cu „adaugă” per citat sau doar referința.
function DecizieRand({ d, licitatie, avert = [], motivExclus = null, onAdauga, busy }) {
  const cj = rezultatCJ(d)
  const [desf, setDesf] = useState(false)
  return (
    <div style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${G.border2}`, background:G.bg, opacity: motivExclus ? .6 : 1 }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <b style={{ fontSize:12.5 }}>{etichetaDecizie(d)}</b>
        <Badge col={G.muted}>{d.domeniu}</Badge><Badge col={G.muted}>{d.lege_aplicabila}</Badge>{d.an ? <Badge col={G.dim}>{d.an}</Badge> : null}
        <Badge col={CUL_CJ[cj]} title={d.control_judiciar?.nota || ''}>{cj === 'mentinuta' || cj === 'modificata' || cj === 'desfiintata' ? '⚖️ ' : ''}{TXT_CJ[cj]}</Badge>
        {motivExclus && <Badge col={G.red} title={d.control_judiciar?.nr_hotarare ? `${d.control_judiciar.instanta || ''} ${d.control_judiciar.nr_hotarare}` : ''}>⚠️ {motivExclus} — nu se propune</Badge>}
        <a href={d.link_sursa} target="_blank" rel="noreferrer" style={{ fontSize:11, color:G.blue, marginLeft:'auto' }}>sursa ↗</a>
      </div>
      {d.regula && <div style={{ fontSize:12, color:G.muted, marginTop:4 }}><span style={{ fontSize:10, color:G.dim }}>🤖 regula (interpretare AI — nu citat): </span>{d.regula}</div>}
      {avert.length > 0 && <div style={{ fontSize:11, color:G.yellow, marginTop:3 }}>⚠️ {avert.join(' · ')}</div>}
      {d.avertisment_instanta && <div style={{ fontSize:11, color:G.red, marginTop:3 }}>⚠️ {d.avertisment_instanta}</div>}
      {!motivExclus && (
        <div style={{ marginTop:6 }}>
          <button style={S.btnS} onClick={() => setDesf(x => !x)}>{desf ? '▾' : '▸'} citate ({(d.citate_cheie || []).length})</button>
          <button style={{ ...S.btnS, marginLeft:6, color:G.ofertare, borderColor:G.ofertare + '66' }} disabled={busy} onClick={() => onAdauga(d, null)}>+ doar referința</button>
          {desf && (d.citate_cheie || []).map((c, i) => {
            const f = formatCitare(d, c)
            return (
              <div key={i} style={{ marginTop:6, padding:'6px 8px', borderLeft:`2px solid ${f ? G.green : G.dim}`, background:G.surface, borderRadius:6, fontSize:12 }}>
                <div style={{ color:G.text }}>„{c.text}”</div>
                <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:4, flexWrap:'wrap' }}>
                  <span style={{ fontSize:11, color:G.dim }}>{c.loc || 'fără pagină'}</span>
                  <button style={{ ...S.btnS, color:G.green, borderColor:G.green + '66', opacity: f ? 1 : .5 }} disabled={busy || !f} title={f ? f.referinta : 'fără pagină sau link — nu se poate cita'} onClick={() => onAdauga(d, i)}>+ cu acest citat</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Modalul „⚖️ Temei”
function ModalTemei({ tinta, licitatie, patternId, existente, onInchide, onSchimbat, showToast, profile }) {
  const [tab, setTab] = useState(patternId ? 'tipar' : 'decizii')
  const [busy, setBusy] = useState(false)
  const [tipar, setTipar] = useState(null)
  const [tipareGasite, setTipareGasite] = useState([])   // B6: fila Tipar are și căutare când ținta n-are încă un tipar
  const [decMap, setDecMap] = useState(new Map())
  const [q, setQ] = useState('')
  const [filtre, setFiltre] = useState({ domeniu: '', lege: '', neverificate: false })
  const [rezDec, setRezDec] = useState([])
  const [rezCer, setRezCer] = useState([])
  const [cautat, setCautat] = useState(false)
  const anunta = (t, tip = 'ok') => showToast ? showToast(t, tip) : console.log(tip, t)

  useEffect(() => {   // tiparul + precedentele lui (treapta 1)
    if (!patternId) return
    let viu = true
    ;(async () => {
      const { data: t } = await supabase.from('clarificari_tipare').select('pattern_id, titlu, tip_problema, trigger, precedente_cnsc, normative_refs, intrebare_propusa, confidence, requires_human_legal_review').eq('pattern_id', patternId).maybeSingle()
      if (!viu || !t) return
      setTipar(t)
      const ids = (t.precedente_cnsc || []).map(p => String(p).replace(/^SRC-/, ''))
      if (ids.length) {
        const { data: ds } = await supabase.from('cnsc_decizii').select(SEL_DECIZIE).in('id', ids)
        if (viu) setDecMap(new Map((ds || []).map(d => [d.id, d])))
      }
    })()
    return () => { viu = false }
  }, [patternId])

  // Valoarea pentru un filtru PostgREST `or(col.ilike.*)`: între ghilimele (virgulele și parantezele devin literale),
  // cu % _ * escapate ca să nu fie wildcard-uri — B11 Jakarinos (nr. „3657/C1/4067,4182” se caută exact).
  const ilikeVal = t => `"%${t.replace(/["\\]/g, '').replace(/[%_*]/g, m => '\\' + m)}%"`
  const cauta = async () => {
    setBusy(true); setCautat(true)
    const t = q.trim()
    let sel = supabase.from('cnsc_decizii').select(SEL_DECIZIE).order('an', { ascending: false }).limit(40)
    if (!filtre.neverificate) sel = sel.eq('verificat', true)
    if (filtre.domeniu) sel = sel.eq('domeniu', filtre.domeniu)
    if (filtre.lege) sel = sel.eq('lege_aplicabila', filtre.lege)
    if (t) sel = sel.or(['regula', 'problema', 'solutie', 'nr_decizie'].map(c => `${c}.ilike.${ilikeVal(t)}`).join(','))
    const { data: ds, error } = await sel
    if (error) anunta('Căutarea în decizii a eșuat: ' + error.message, 'err')
    setRezDec(ds || [])
    let selC = supabase.from('norme_cerinte').select('requirement_id, cerinta, locator, source_id, temei_tip, domeniu, verificat_pe_sursa').eq('verificat_pe_sursa', true).limit(40)
    if (t) selC = selC.or(['cerinta', 'locator'].map(c => `${c}.ilike.${ilikeVal(t)}`).join(','))
    const { data: cs } = await selC
    setRezCer(cs || [])
    let selT = supabase.from('clarificari_tipare').select('pattern_id, titlu, tip_problema, confidence, requires_human_legal_review, precedente_cnsc').order('pattern_id').limit(40)
    if (t) selT = selT.or(['titlu', 'pattern_id', 'tip_problema'].map(c => `${c}.ilike.${ilikeVal(t)}`).join(','))
    const { data: ts } = await selT
    setTipareGasite(ts || [])
    setBusy(false)
  }

  const adauga = async (campuri, sursa = 'manual') => {
    setBusy(true)
    // propunerile (propus_*) intră NEconfirmate — omul le confirmă cu ✓ pe chip (Copilot r1)
    const rand = { ...tinta, ...campuri, sursa, confirmat: sursa === 'manual', include_in_adresa: false }
    const { error } = await supabase.from('ofertare_clarificari_temeiuri').insert(rand)
    setBusy(false)
    if (error) {
      if (/duplicate|unic/i.test(error.message)) return anunta('Temeiul e deja atașat.', 'warn')
      return anunta('Nu s-a putut atașa: ' + error.message, 'err')
    }
    anunta('⚖️ Temei atașat'); onSchimbat()
  }
  // B1: o decizie propusă din tipar poartă proveniența (pattern_id_origine) — backend-ul cere owner la „include” dacă tiparul cere review
  const adaugaDecizie = (d, citatIdx) => {
    const dinTipar = !!(patternId && tipar?.precedente_cnsc?.some(p => String(p).replace(/^SRC-/, '') === d.id))
    return adauga({ cnsc_decizie_id: d.id, citat_idx: citatIdx, citat_text: citatIdx == null ? null : d.citate_cheie?.[citatIdx]?.text ?? null, pattern_id_origine: dinTipar ? patternId : null }, dinTipar ? 'propus_tipar' : 'manual')
  }
  const areDeja = (campuri) => existente.some(e => (campuri.cnsc_decizie_id ? e.cnsc_decizie_id === campuri.cnsc_decizie_id && (e.citat_idx ?? null) === (campuri.citat_idx ?? null) : campuri.requirement_id ? e.requirement_id === campuri.requirement_id : e.pattern_id === campuri.pattern_id))

  const prop = tipar ? propuneriDinTipar(tipar, decMap, licitatie) : null
  const Tab = ({ k, children }) => <button style={{ ...S.btnS, fontWeight: tab === k ? 800 : 400, color: tab === k ? G.ofertare : G.text, borderColor: tab === k ? G.ofertare + '88' : G.border2 }} onClick={() => setTab(k)}>{children}</button>

  return (
    <div style={{ position:'fixed', inset:0, background:'#0008', zIndex:60, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 12px', overflowY:'auto' }} onClick={onInchide}>
      <div style={{ width:'min(920px, 100%)', background:G.card, border:`1px solid ${G.border}`, borderRadius:12, padding:16 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
          <div style={{ fontSize:14, fontWeight:800 }}>⚖️ Temei pentru {tinta.punct_id ? `punctul #${tinta.punct_id}` : `întrebarea #${tinta.clarificare_id}`}</div>
          <span style={{ fontSize:11, color:G.dim }}>textul întrebării nu se modifică · citatele se copiază exact din corpus · nimic nu intră în adresă fără bifa „include”</span>
          <button style={{ ...S.btnS, marginLeft:'auto' }} onClick={onInchide}>✕</button>
        </div>
        <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
          <Tab k="tipar">📐 Tipar{prop ? ` (${prop.propuse.length} propuse)` : ''}</Tab>
          <Tab k="decizii">⚖️ Decizii CNSC</Tab>
          <Tab k="cerinte">📜 Cerințe normative</Tab>
        </div>

        {tab === 'tipar' && !patternId && (
          <div>
            <div style={{ fontSize:12, color:G.muted, marginBottom:6 }}>Ținta nu are încă un tipar. Caută tiparul potrivit și atașează-l — după aceea apar precedentele lui ca propuneri.</div>
            <div style={{ display:'flex', gap:6, marginBottom:8 }}>
              <input style={{ ...S.input, flex:1 }} placeholder="caută în titlu / cod (ex. PAT-GAZ-14, proiectare)…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && cauta()} />
              <button style={S.btnP} disabled={busy} onClick={cauta}>{busy ? '…' : 'Caută'}</button>
            </div>
            <div style={{ display:'grid', gap:6 }}>
              {cautat && tipareGasite.length === 0 && <div style={{ fontSize:12, color:G.dim }}>Niciun tipar găsit.</div>}
              {tipareGasite.map(t => (
                <div key={t.pattern_id} style={{ padding:'7px 10px', borderRadius:8, border:`1px solid ${G.border2}`, background:G.bg, fontSize:12, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <b>{t.pattern_id}</b><span style={{ flex:'1 1 240px' }}>{t.titlu}</span><Badge col={G.muted}>încredere {t.confidence}</Badge>{t.requires_human_legal_review && <Badge col={G.purple}>⚖️ review</Badge>}<Badge col={G.dim}>{(t.precedente_cnsc || []).length} precedente</Badge>
                  <button style={{ ...S.btnS, color:G.ofertare, borderColor:G.ofertare + '66' }} disabled={busy} onClick={() => adauga({ pattern_id: t.pattern_id }, 'manual')}>+ atașează tiparul</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'tipar' && patternId && (
          !tipar ? <div style={{ color:G.dim, fontSize:12 }}>se încarcă tiparul…</div> : (
            <div>
              <div style={{ fontSize:12.5, marginBottom:6 }}><b>{tipar.pattern_id}</b> — {tipar.titlu} <Badge col={G.muted}>încredere {tipar.confidence}</Badge> {tipar.requires_human_legal_review && <Badge col={G.purple}>⚖️ cere review juridic</Badge>}</div>
              {tipar.requires_human_legal_review && <div style={{ fontSize:11.5, color:G.purple, marginBottom:6 }}>Tiparul cere review juridic: temeiurile lui pot fi atașate, dar bifa „include în adresă” o poate pune doar un owner.</div>}
              {!areDeja({ pattern_id: tipar.pattern_id }) && <button style={{ ...S.btnS, marginBottom:8, color:G.ofertare, borderColor:G.ofertare + '66' }} disabled={busy} onClick={() => adauga({ pattern_id: tipar.pattern_id }, 'propus_tipar')}>+ atașează tiparul ca temei</button>}
              <div style={{ fontSize:11.5, color:G.muted, marginBottom:6 }}>Precedente propuse (ordine: domeniul licitației → legea → control judiciar → an). Cele modificate/desființate/neverificate apar jos, gri, și nu se propun.</div>
              <div style={{ display:'grid', gap:8 }}>
                {prop.propuse.map(p => <DecizieRand key={p.decizie.id} d={p.decizie} licitatie={licitatie} avert={p.avertismente} onAdauga={adaugaDecizie} busy={busy} />)}
                {prop.propuse.length === 0 && <div style={{ fontSize:12, color:G.dim }}>Tiparul nu are precedente propozabile{prop.lipsa.length ? ` (${prop.lipsa.length} id-uri lipsesc din corpus: ${prop.lipsa.join(', ')})` : ''}.</div>}
                {prop.excluse.map(e => <DecizieRand key={e.decizie.id} d={e.decizie} licitatie={licitatie} motivExclus={e.motiv} onAdauga={() => {}} busy />)}
              </div>
            </div>
          )
        )}

        {tab !== 'tipar' && (
          <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap', alignItems:'center' }}>
            <input style={{ ...S.input, flex:'1 1 240px' }} placeholder={tab === 'decizii' ? 'caută în regulă / problemă / soluție / nr. decizie…' : 'caută în cerință / locator…'} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && cauta()} />
            {tab === 'decizii' && <>
              <select style={{ ...S.input, width:150 }} value={filtre.domeniu} onChange={e => setFiltre(f => ({ ...f, domeniu: e.target.value }))}>
                <option value="">toate domeniile</option><option value="gaze">gaze</option><option value="distributie">distribuție</option><option value="apa_canal">apă-canal</option><option value="lucrari_general">lucrări general</option>
              </select>
              <select style={{ ...S.input, width:90 }} value={filtre.lege} onChange={e => setFiltre(f => ({ ...f, lege: e.target.value }))}><option value="">L98+L99</option><option value="L98">L98</option><option value="L99">L99</option></select>
              <label style={{ fontSize:11, color:G.muted, display:'flex', gap:4, alignItems:'center' }}><input type="checkbox" checked={filtre.neverificate} onChange={e => setFiltre(f => ({ ...f, neverificate: e.target.checked }))} /> arată și neverificate</label>
            </>}
            <button style={S.btnP} disabled={busy} onClick={cauta}>{busy ? '…' : 'Caută'}</button>
          </div>
        )}
        {tab === 'decizii' && (
          <div style={{ display:'grid', gap:8 }}>
            {!cautat && <div style={{ fontSize:12, color:G.dim }}>Caută în cele ~216 decizii din corpus. Implicit doar cele verificate pe sursă.</div>}
            {cautat && rezDec.length === 0 && <div style={{ fontSize:12, color:G.dim }}>Nimic găsit.</div>}
            {rezDec.map(d => esteExclusa(d)
              ? <DecizieRand key={d.id} d={d} licitatie={licitatie} motivExclus={d.verificat !== true ? 'neverificată pe sursă' : TXT_CJ[rezultatCJ(d)]} onAdauga={() => {}} busy />
              : <DecizieRand key={d.id} d={d} licitatie={licitatie} avert={avertismente(d, licitatie)} onAdauga={adaugaDecizie} busy={busy} />)}
          </div>
        )}
        {tab === 'cerinte' && (
          <div style={{ display:'grid', gap:6 }}>
            {!cautat && <div style={{ fontSize:12, color:G.dim }}>Caută în cerințele normative verificate pe sursă (locator = articolul / punctul exact).</div>}
            {cautat && rezCer.length === 0 && <div style={{ fontSize:12, color:G.dim }}>Nimic găsit.</div>}
            {rezCer.map(c => (
              <div key={c.requirement_id} style={{ padding:'7px 10px', borderRadius:8, border:`1px solid ${G.border2}`, background:G.bg, fontSize:12 }}>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}><b>{c.requirement_id}</b><Badge col={G.muted}>{c.locator}</Badge><Badge col={G.dim}>{c.source_id}</Badge>{c.temei_tip && <Badge col={G.dim}>{c.temei_tip}</Badge>}
                  <button style={{ ...S.btnS, marginLeft:'auto', color:G.ofertare, borderColor:G.ofertare + '66', opacity: areDeja({ requirement_id: c.requirement_id }) ? .5 : 1 }} disabled={busy || areDeja({ requirement_id: c.requirement_id })} onClick={() => adauga({ requirement_id: c.requirement_id })}>+ atașează</button></div>
                <div style={{ color:G.text, marginTop:3 }}>{c.cerinta}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Chip-urile + butonul. tinta = { clarificare_id } sau { punct_id }. licitatie = rândul din ofertare_licitatii (segment, regim_achizitie).
export default function TemeiuriClarificare({ tinta, licitatie = null, showToast = null, profile = null, compact = false }) {
  const [rows, setRows] = useState(null)
  const [eroare, setEroare] = useState(null)
  const [deschis, setDeschis] = useState(false)
  const [busy, setBusy] = useState(false)
  const versiune = useRef(0)     // un răspuns întârziat al țintei vechi nu suprascrie ținta nouă (aceeași instanță, ținte succesive)
  const anunta = (t, tip = 'ok') => showToast ? showToast(t, tip) : console.log(tip, t)
  const cheie = tinta.punct_id ? 'punct_id' : 'clarificare_id'
  const load = async () => {
    const v = ++versiune.current
    const { data, error } = await supabase.from('ofertare_clarificari_temeiuri')
      .select('id, cnsc_decizie_id, requirement_id, pattern_id, pattern_id_origine, citat_idx, citat_text, citat_loc, sursa, confirmat, include_in_adresa, decizie:cnsc_decizii(id, nr_decizie, buletin_oficial, data, link_sursa, control_judiciar, verificat), cerinta:norme_cerinte(requirement_id, locator, cerinta), tipar:clarificari_tipare!ofertare_clarificari_temeiuri_pattern_id_fkey(pattern_id, titlu, requires_human_legal_review), origine:clarificari_tipare!ofertare_clarificari_temeiuri_pattern_id_origine_fkey(pattern_id, requires_human_legal_review)')
      .eq(cheie, tinta[cheie]).order('id')
    if (v !== versiune.current) return
    if (error) { setEroare(TABEL_LIPSA(error) ? 'tabelul temeiurilor nu e încă aplicat (migrarea 20261014a)' : error.message); setRows([]); return }
    setEroare(null); setRows(data || [])
  }
  useEffect(() => { load() }, [tinta.clarificare_id, tinta.punct_id])   // eslint-disable-line react-hooks/exhaustive-deps

  // Dacă ORICE temei al țintei e un tipar care cere review juridic, includerea în adresă (a oricărui temei al țintei,
  // inclusiv deciziile propuse din tipar) o poate face doar un owner — review Jakarinos r1.
  const reviewNecesar = (rows || []).some(x => x.tipar?.requires_human_legal_review || x.origine?.requires_human_legal_review)
  const patch = async (r, p) => {
    if (p.include_in_adresa && (reviewNecesar || r.tipar?.requires_human_legal_review || r.origine?.requires_human_legal_review) && !profile?.is_owner) return anunta('Tiparul cere review juridic — doar un owner poate include temeiuri în adresă.', 'warn')
    setBusy(true)
    const { error } = await supabase.from('ofertare_clarificari_temeiuri').update(p).eq('id', r.id)
    setBusy(false)
    if (error) return anunta('Nu s-a salvat: ' + error.message, 'err')
    load()
  }
  const sterge = async r => {
    setBusy(true)
    const { error } = await supabase.from('ofertare_clarificari_temeiuri').delete().eq('id', r.id)
    setBusy(false)
    if (error) return anunta('Nu s-a șters: ' + error.message, 'err')
    load()
  }
  const patternId = rows?.find(r => r.pattern_id)?.pattern_id || null

  if (eroare) return <div style={{ fontSize:11, color:G.dim, marginTop:4 }} title={eroare}>⚖️ temeiuri indisponibile — {eroare}</div>
  return (
    <div style={{ marginTop: compact ? 3 : 6, display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
      <button style={{ ...S.btnS, padding: compact ? '2px 8px' : '4px 10px', fontSize: compact ? 11 : 11.5, color:G.purple, borderColor:G.purple + '66' }} onClick={() => setDeschis(true)} title="Atașează decizii CNSC, cerințe normative sau tiparul — textul întrebării nu se modifică">⚖️ Temei{rows?.length ? ` (${rows.length})` : ''}</button>
      {(rows || []).map(r => {
        const d = r.decizie
        const cj = d ? rezultatCJ(d) : null
        const eticheta = d ? `CNSC ${etichetaDecizie(d)}${r.citat_loc ? ` · ${r.citat_loc}` : ''}` : r.cerinta ? `${r.cerinta.requirement_id} · ${r.cerinta.locator || ''}` : r.tipar ? `tipar ${r.tipar.pattern_id}` : '?'
        const rosu = d && (cj === 'modificata' || cj === 'desfiintata' || d.verificat !== true)
        return (
          <span key={r.id} style={{ display:'inline-flex', gap:5, alignItems:'center', fontSize:11, border:`1px solid ${rosu ? G.red : r.confirmat ? G.border : G.yellow}66`, borderRadius:6, padding:'2px 7px', background:G.surface, color:G.text }}
            title={[r.citat_text ? `„${r.citat_text}”` : null, r.cerinta?.cerinta, r.tipar?.titlu, r.sursa !== 'manual' ? `sursa: ${r.sursa}` : null, rosu ? '⚠️ ' + TXT_CJ[cj] : null].filter(Boolean).join('\n')}>
            {rosu && '⚠️ '}{eticheta}
            {!r.confirmat && <button style={{ ...S.btnS, padding:'0 5px', fontSize:10.5, color:G.green }} disabled={busy} onClick={() => patch(r, { confirmat: true })} title="propunere — confirmă">✓</button>}
            <label style={{ display:'inline-flex', gap:3, alignItems:'center', color: r.include_in_adresa ? G.green : G.dim, cursor:'pointer' }} title="include în adresa către AC (secțiunea „Practica CNSC invocată”)">
              <input type="checkbox" checked={!!r.include_in_adresa} disabled={busy || !r.confirmat || !d} onChange={e => patch(r, { include_in_adresa: e.target.checked })} />adresă
            </label>
            <button style={{ background:'none', border:'none', color:G.dim, cursor:'pointer', padding:0, fontSize:12 }} disabled={busy} onClick={() => sterge(r)} title="scoate temeiul">✕</button>
          </span>
        )
      })}
      {deschis && <ModalTemei tinta={tinta} licitatie={licitatie} patternId={patternId} existente={rows || []} onInchide={() => setDeschis(false)} onSchimbat={load} showToast={showToast} profile={profile} />}
    </div>
  )
}
