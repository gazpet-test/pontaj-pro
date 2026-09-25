// ════════════════════════════════════════════════════════════════
// OfertareClauzeFormulare.jsx — E2 „📜 Clauze contractuale" + E3 „🗂 Formulare de depus" (v1, 25.09.2026).
// Propunerile vin din edge fn ofertare-clauze-formulare (poarta pe cheltuială: owner / responsabil),
// câte UN document per apel. Citatul e faptul (validat literal în text_extras); evaluarea Gazpet e separată.
// Structuri simple — se extind după feedback-ul Oanei și al lui Silviu.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import { poatePorniProcesarea, MOTIV_POARTA } from './OfertareTriere.jsx'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF',
  orange:'#F0883E', yellow:'#E3B341', red:'#F85149', purple:'#BC8CFF' }
const S = {
  btn: { padding:'6px 11px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12 },
  btnP: { padding:'7px 13px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:700 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10, padding:14, marginTop:16 },
  inp: { background:G.bg, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, padding:'4px 7px', fontSize:12 },
}
const FN_URL = 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/ofertare-clauze-formulare'

async function ruleazaExtragere(licitatieId, documentId, ce) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(FN_URL, { method:'POST', headers:{ Authorization:`Bearer ${session?.access_token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ licitatie_id: licitatieId, document_id: documentId, ce }) })
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
  if (!j.ok) throw new Error(j.error || 'eroare necunoscută')
  return j
}

// Bara comună: documentele sursă (cu / fără text) + butonul poartă
function BaraExtragere({ licitatie, profile, tip, ce, eticheta, onGata, showToast }) {
  const [docs, setDocs] = useState([])
  const [busy, setBusy] = useState(null)
  useEffect(() => {
    supabase.from('ofertare_documente_atribuire').select('id, nume_original, text_extras').eq('licitatie_id', licitatie.id).eq('tip', tip).order('id')
      .then(({ data }) => setDocs((data || []).map(d => ({ id:d.id, nume:d.nume_original, areText: (d.text_extras || '').length >= 200 }))))
  }, [licitatie.id, tip])
  const poate = poatePorniProcesarea(profile, licitatie)
  const cuText = docs.filter(d => d.areText)
  const porneste = async () => {
    const msgs = []
    for (const d of cuText) {
      setBusy(d.nume)
      try {
        const j = await ruleazaExtragere(licitatie.id, d.id, ce)
        msgs.push(`${d.nume}: +${j.inserate}${j.aruncate?.length ? ` · ${j.aruncate.length} aruncate (citat negăsit)` : ''}`)
      } catch (e) { msgs.push(`${d.nume}: ❌ ${e.message}`) }
    }
    setBusy(null); onGata?.()
    const t = msgs.join('\n')
    if (showToast) showToast(t); else window.alert(t)
  }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:11.5, color:G.dim, marginTop:6 }}>
      <span>Surse ({tip}): {docs.length ? docs.map(d => <span key={d.id} style={{ color: d.areText ? G.muted : G.orange, marginRight:8 }} title={d.areText ? 'text extras' : 'fără text extras încă'}>{d.areText ? '📄' : '⏳'} {d.nume}</span>) : 'niciun document de acest tip'}</span>
      {poate && cuText.length > 0 && <button style={{ ...S.btnP, marginLeft:'auto', opacity: busy ? .6 : 1 }} disabled={!!busy} onClick={porneste}>{busy ? `⏳ ${busy}…` : `🤖 ${eticheta} (Sonnet, ~0,1–0,4 USD/doc)`}</button>}
      {!poate && <span style={{ marginLeft:'auto' }} title={MOTIV_POARTA}>🔒 extragerea o pornește ownerul / responsabilul</span>}
    </div>
  )
}

// ── E2 ───────────────────────────────────────────────────────────
const CAT = [
  ['garantie_buna_executie', '🛡 Garanție de bună execuție'], ['penalitati', '⏱ Penalități'], ['plata', '💶 Plată'],
  ['ajustare_pret', '📈 Ajustare preț'], ['durata_ordin_incepere', '📅 Durată / ordin de începere'], ['garantie_lucrari', '🔧 Garanția lucrărilor'],
  ['receptii', '✅ Recepții'], ['subcontractare', '🤝 Subcontractare'], ['risc', '⚠️ Riscuri transferate'], ['altele', '• Altele'],
]
const IMPACT = { pret:['preț', G.orange], cashflow:['cashflow', G.yellow], go_nogo:['GO/NO-GO', G.red] }

export function ClauzeContractSection({ licitatie, profile, showToast }) {
  const [rows, setRows] = useState(null)
  const [eu, setEu] = useState(null)
  const load = useCallback(() => {
    supabase.from('ofertare_clauze_contract').select('*').eq('licitatie_id', licitatie.id).order('id').then(({ data }) => setRows(data || []))
  }, [licitatie.id])
  useEffect(() => { load(); supabase.auth.getUser().then(({ data }) => setEu(data?.user?.id || null)) }, [load])
  const bifeaza = async (c) => {
    const patch = c.verificat_de ? { verificat_de:null, verificat_la:null } : { verificat_de:eu, verificat_la:new Date().toISOString() }
    const { error } = await supabase.from('ofertare_clauze_contract').update(patch).eq('id', c.id)
    if (error) window.alert(error.message); else load()
  }
  const sterge = async (c) => {
    if (!window.confirm('Ștergi clauza propusă?')) return
    const { error } = await supabase.from('ofertare_clauze_contract').delete().eq('id', c.id)
    if (error) window.alert(error.message); else load()
  }
  const nVer = (rows || []).filter(r => r.verificat_de).length
  return (
    <div style={S.card}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13.5, fontWeight:800 }}>📜 Clauze contractuale</div>
        {rows && <span style={{ fontSize:11.5, color:G.muted }}>{rows.length} clauze · {nVer} verificate de om</span>}
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginTop:3 }}>Citatul e copiat literal din modelul de contract (verificat automat); evaluarea Gazpet e opinie, separată de fapt. Bifa ✓ = un om a citit clauza.</div>
      <BaraExtragere licitatie={licitatie} profile={profile} tip="model_contract" ce="clauze" eticheta="Extrage clauzele" onGata={load} showToast={showToast} />
      {rows === null ? <div style={{ color:G.muted, fontSize:12, marginTop:10 }}>Se încarcă…</div>
        : rows.length === 0 ? <div style={{ color:G.dim, fontSize:12, marginTop:10 }}>Nicio clauză extrasă încă.</div>
        : CAT.filter(([k]) => rows.some(r => r.categorie === k)).map(([k, lbl]) => (
          <div key={k} style={{ marginTop:12 }}>
            <div style={{ fontSize:12.5, fontWeight:800, color:G.ofertare, marginBottom:5 }}>{lbl}</div>
            {rows.filter(r => r.categorie === k).map(c => {
              const vs = Object.entries(c.valoare_structurata || {}).filter(([, v]) => v != null && v !== '')
              return (
                <div key={c.id} style={{ padding:'8px 10px', marginBottom:6, borderRadius:7, background:G.surface, borderLeft:`3px solid ${c.verificat_de ? G.green : G.border}` }}>
                  <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                    <div style={{ flex:1, fontSize:12.5, fontStyle:'italic', color:G.text, whiteSpace:'pre-wrap' }}>„{c.citat}"</div>
                    <button style={{ ...S.btn, padding:'3px 8px', color: c.verificat_de ? G.green : G.muted }} onClick={() => bifeaza(c)} title={c.verificat_de ? `verificată ${new Date(c.verificat_la).toLocaleString('ro-RO')} — click pentru a retrage` : 'Marchează verificată de om'}>{c.verificat_de ? '✓ verificat' : '☐ verifică'}</button>
                    <button style={{ ...S.btn, padding:'3px 7px', color:G.dim }} onClick={() => sterge(c)} title="Șterge">✕</button>
                  </div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:5, fontSize:11.5 }}>
                    {c.locator && <span style={{ color:G.blue }}>📍 {c.locator}</span>}
                    {c.impact && <span style={{ color:IMPACT[c.impact]?.[1], fontWeight:700 }}>impact: {IMPACT[c.impact]?.[0]}</span>}
                    {vs.map(([kk, v]) => <span key={kk} style={{ padding:'1px 7px', borderRadius:10, background:G.bg, border:`1px solid ${G.border2}`, color:G.muted }}>{kk}: <b style={{ color:G.text }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</b></span>)}
                  </div>
                  {c.evaluare_gazpet && <div style={{ marginTop:4, fontSize:11.5, color:G.yellow }}>💬 Evaluare Gazpet: {c.evaluare_gazpet}</div>}
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}

// ── E3 ───────────────────────────────────────────────────────────
const ST_PREG = { de_pregatit:['de pregătit', G.red], ciorna:['ciornă', G.orange], verificat:['verificat', G.yellow], semnat:['semnat', G.green] }
const ST_DEP = { nu:['nedepus', G.dim], in_pachet:['în pachet', G.blue], incarcat_seap:['încărcat SEAP', G.purple], confirmat:['confirmat', G.green] }
export const formularBlocant = (f) => f.aplicabil && (f.stare_pregatire !== 'semnat' || f.stare_depunere === 'nu')

function Chips({ opt, val, onSet }) {
  return (
    <span style={{ display:'inline-flex', gap:3, flexWrap:'wrap' }}>
      {Object.entries(opt).map(([k, [l, c]]) => (
        <button key={k} onClick={() => onSet(k)} style={{ padding:'2px 8px', borderRadius:10, fontSize:11, cursor:'pointer',
          border:`1px solid ${val === k ? c : G.border2}`, background: val === k ? c + '22' : 'transparent', color: val === k ? c : G.dim, fontWeight: val === k ? 800 : 500 }}>{l}</button>
      ))}
    </span>
  )
}

function CampText({ val, onSave, ph, w = 150 }) {
  const [v, setV] = useState(val || '')
  useEffect(() => setV(val || ''), [val])
  return <input style={{ ...S.inp, width:w }} value={v} placeholder={ph} onChange={e => setV(e.target.value)} onBlur={() => { if ((val || '') !== v) onSave(v || null) }} />
}

export default function FormulareRegistruSection({ licitatie, profile, showToast }) {
  const [rows, setRows] = useState(null)
  const load = useCallback(() => {
    supabase.from('ofertare_formulare_registru').select('*').eq('licitatie_id', licitatie.id).order('id').then(({ data }) => setRows(data || []))
  }, [licitatie.id])
  useEffect(() => { load() }, [load])
  const upd = async (id, patch) => {
    const { error } = await supabase.from('ofertare_formulare_registru').update(patch).eq('id', id)
    if (error) window.alert(error.message); else load()
  }
  const adauga = async () => {
    const den = window.prompt('Denumirea formularului:')
    if (!den) return
    const { error } = await supabase.from('ofertare_formulare_registru').insert({ licitatie_id: licitatie.id, denumire: den, sursa:'manual' })
    if (error) window.alert(error.message); else load()
  }
  const sterge = async (f) => {
    if (!window.confirm(`Ștergi „${f.denumire}" din registru?`)) return
    const { error } = await supabase.from('ofertare_formulare_registru').delete().eq('id', f.id)
    if (error) window.alert(error.message); else load()
  }
  const blocante = (rows || []).filter(formularBlocant)
  return (
    <div style={{ ...S.card, marginTop:0 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        <div style={{ fontSize:13.5, fontWeight:800 }}>🗂 Formulare de depus</div>
        {rows && <span style={{ fontSize:11.5, color: blocante.length ? G.red : G.green, fontWeight:700 }}>{rows.length} în registru · {blocante.length ? `${blocante.length} blocante (aplicabile, nesemnate sau în afara pachetului)` : 'nimic blocant'}</span>}
        <button style={{ ...S.btn, marginLeft:'auto' }} onClick={adauga}>＋ Adaugă manual</button>
      </div>
      <div style={{ fontSize:11.5, color:G.dim, marginTop:3 }}>Formularele aplicabile care nu sunt „semnat" sau sunt „nedepus" blochează verdele la Verificarea finală. Semnătura e legată de versiunea fișierului (hash).</div>
      <BaraExtragere licitatie={licitatie} profile={profile} tip="formular" ce="formulare" eticheta="Propune formularele" onGata={load} showToast={showToast} />
      {rows === null ? <div style={{ color:G.muted, fontSize:12, marginTop:10 }}>Se încarcă…</div>
        : rows.length === 0 ? <div style={{ color:G.dim, fontSize:12, marginTop:10 }}>Registru gol.</div>
        : <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
          {rows.map(f => (
            <div key={f.id} style={{ padding:'8px 10px', borderRadius:7, background:G.surface, borderLeft:`3px solid ${!f.aplicabil ? G.border : formularBlocant(f) ? G.red : G.green}`, opacity: f.aplicabil ? 1 : .6 }}>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <b style={{ fontSize:12.5 }}>{f.cod ? `${f.cod} — ` : ''}{f.denumire}</b>
                <label style={{ fontSize:11.5, color:G.muted, display:'inline-flex', alignItems:'center', gap:4 }}>
                  <input type="checkbox" checked={f.aplicabil} onChange={e => upd(f.id, { aplicabil: e.target.checked })} /> aplicabil
                </label>
                {!f.aplicabil || f.motiv_aplicabil ? <CampText val={f.motiv_aplicabil} ph="motiv (ne)aplicabil" w={200} onSave={v => upd(f.id, { motiv_aplicabil:v })} /> : null}
                <button style={{ ...S.btn, padding:'2px 7px', color:G.dim, marginLeft:'auto' }} onClick={() => sterge(f)}>✕</button>
              </div>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:6, alignItems:'center', fontSize:11.5, color:G.muted }}>
                <span>Pregătire: <Chips opt={ST_PREG} val={f.stare_pregatire} onSet={k => upd(f.id, { stare_pregatire:k })} /></span>
                <span>Depunere: <Chips opt={ST_DEP} val={f.stare_depunere} onSet={k => upd(f.id, { stare_depunere:k })} /></span>
              </div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:6 }}>
                <CampText val={f.cine_completeaza} ph="cine completează" onSave={v => upd(f.id, { cine_completeaza:v })} />
                <CampText val={f.cine_semneaza} ph="cine semnează" onSave={v => upd(f.id, { cine_semneaza:v })} />
                <CampText val={f.documente_suport} ph="documente suport" w={200} onSave={v => upd(f.id, { documente_suport:v })} />
                <CampText val={f.fisier_path} ph="fișier (cale)" w={170} onSave={v => upd(f.id, { fisier_path:v })} />
                <CampText val={f.fisier_hash} ph="hash fișier semnat" w={130} onSave={v => upd(f.id, { fisier_hash:v })} />
                <CampText val={f.observatii} ph="observații" w={200} onSave={v => upd(f.id, { observatii:v })} />
              </div>
              {f.citat && <div style={{ marginTop:4, fontSize:11, color:G.dim, fontStyle:'italic' }}>sursa: „{f.citat}"</div>}
            </div>
          ))}
        </div>}
    </div>
  )
}
