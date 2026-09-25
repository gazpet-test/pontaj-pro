// 📚 Nomenclatoare Ofertare — editare din UI a tabelelor de referință (audit UI Ofertare, pct. 7).
// Coloanele se citesc din date (select '*'), fiindcă schema acestor tabele e mai veche decât folderul
// de migrări. ORICE scriere verifică `error` ȘI numărul de rânduri întoarse: la RLS care refuză un
// UPDATE, Supabase NU dă eroare, ci 0 rânduri — fără verificarea asta ar ieși „mesaj verde" fals.
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149',
}
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:5, padding:'4px 7px', color:G.text, fontSize:12, outline:'none' },
  btnP: { padding:'6px 13px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:6, cursor:'pointer', fontSize:12, fontWeight:700 },
  btnS: { padding:'6px 13px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, cursor:'pointer', fontSize:12 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
  th: { textAlign:'left', padding:'6px 8px', fontSize:10.5, color:G.muted, fontWeight:700, textTransform:'uppercase', borderBottom:`1px solid ${G.border}`, whiteSpace:'nowrap' },
  td: { padding:'4px 8px', fontSize:12, borderBottom:`1px solid ${G.border2}`, verticalAlign:'top' },
}

// cfg: pk = cheia primară; order = ordonare; ro = doar citire (fără politică de scriere în BD);
// doar = singurele coloane editabile (restul read-only); pkManual = cheia se scrie la adăugare (text)
const TABELE = {
  probe_diametre:     { label:'⌀ Probe — diametre', pk:'id', order:'ordine' },
  probe_configuratii: { label:'⚙️ Probe — configurații', pk:'id', order:'id' },
  isc_rte_domenii:    { label:'🎓 Domenii RTE (ISC)', pk:'cod', order:'cod', pkManual:true },
  logistica_categorii:{ label:'🚜 Categorii utilaje → F23', pk:'id', order:'tip', doar:['in_f23'], fixe:['id','tip','subcategorie','in_f23'] },
}
const SISTEM = ['created_at', 'updated_at', 'created_by', 'updated_by']

// conversie valoare din input → tipul coloanei (după valoarea existentă)
const conv = (v, model) => {
  if (v === '' || v === undefined) return null
  if (typeof model === 'number') { const n = Number(String(v).replace(',', '.')); return isNaN(n) ? v : n }
  if (Array.isArray(model)) return String(v).split(',').map(x => x.trim()).filter(Boolean)
  if (model && typeof model === 'object') { try { return JSON.parse(v) } catch { return v } }
  return v
}
const afis = v => v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)

export default function OfertareNomenclatoare({ showToast }) {
  const [tab, setTab] = useState('probe_diametre')
  return (
    <div>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:12 }}>
        {Object.entries(TABELE).map(([k, c]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...S.btnS, fontWeight:700,
            ...(tab === k ? { background:G.ofertare + '22', color:G.ofertare, border:`1px solid ${G.ofertare}88` } : {}) }}>{c.label}</button>
        ))}
        <button onClick={() => setTab('profil_firma')} style={{ ...S.btnS, fontWeight:700,
          ...(tab === 'profil_firma' ? { background:G.ofertare + '22', color:G.ofertare, border:`1px solid ${G.ofertare}88` } : {}) }}>🏢 Profil firmă</button>
      </div>
      {tab === 'profil_firma' ? <ProfilFirma showToast={showToast} />
        : <TabelNomenclator key={tab} tabel={tab} cfg={TABELE[tab]} showToast={showToast} />}
    </div>
  )
}

function TabelNomenclator({ tabel, cfg, showToast }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)   // { pk, vals }
  const [nou, setNou] = useState(null)     // vals rând nou
  const [busy, setBusy] = useState(false)
  const toast = (m, t) => showToast ? showToast(m, t) : (t === 'err' && alert(m))

  const load = async () => {
    let q = supabase.from(tabel).select('*').order(cfg.order)
    if (tabel === 'logistica_categorii') q = q.order('subcategorie')
    const { data, error } = await q
    if (error) { setErr(error.message); setRows([]); return }
    setErr(''); setRows(data || [])
  }
  useEffect(() => { load() }, [])

  const cols = cfg.fixe || (rows?.length ? Object.keys(rows[0]).filter(c => !SISTEM.includes(c)) : [])
  const model = rows?.[0] || {}
  const areActiv = 'activ' in model
  const editabil = c => !cfg.ro && c !== cfg.pk && (!cfg.doar || cfg.doar.includes(c))
  const sortIdx = r => (areActiv && r.activ === false ? 1 : 0)

  // scriere cu verificare error + rânduri afectate (RLS refuză silențios)
  const scrie = async (promise, okMsg) => {
    setBusy(true)
    const { data, error } = await promise
    setBusy(false)
    if (error) { toast('Nu s-a salvat: ' + error.message, 'err'); return false }
    if (!data?.length) { toast('Nu s-a salvat: BD nu a modificat niciun rând (lipsă drept de scriere / RLS).', 'err'); return false }
    toast(okMsg, 'ok'); await load(); return true
  }

  const salveaza = async () => {
    const payload = {}
    for (const c of cols) {
      if (!editabil(c) || edit.vals[c] === edit.init[c]) continue
      const m = edit.row[c] ?? model[c]
      payload[c] = typeof m === 'boolean' ? !!edit.vals[c] : conv(edit.vals[c], m)
    }
    if (!Object.keys(payload).length) { setEdit(null); return }
    if ('updated_at' in model) payload.updated_at = new Date().toISOString()
    if (await scrie(supabase.from(tabel).update(payload).eq(cfg.pk, edit.row[cfg.pk]).select(cfg.pk), 'Salvat')) setEdit(null)
  }
  const adauga = async () => {
    const payload = {}
    for (const c of cols) {
      if (c === cfg.pk && !cfg.pkManual) continue
      if (nou[c] === undefined || nou[c] === '') continue
      payload[c] = typeof model[c] === 'boolean' ? !!nou[c] : conv(nou[c], model[c])
    }
    if (!Object.keys(payload).length) return toast('Completează cel puțin un câmp', 'err')
    if (await scrie(supabase.from(tabel).insert(payload).select(cfg.pk), 'Rând adăugat')) setNou(null)
  }
  const toggle = async (r, c) => {
    const upd = { [c]: !r[c] }
    if ('updated_at' in model) upd.updated_at = new Date().toISOString()
    await scrie(supabase.from(tabel).update(upd).eq(cfg.pk, r[cfg.pk]).select(cfg.pk),
      c === 'activ' ? (r[c] ? 'Dezactivat' : 'Reactivat') : 'Salvat')
  }
  const sterge = async r => {
    if (!confirm(`Ștergi definitiv rândul ${r[cfg.pk]} din ${tabel}?`)) return
    await scrie(supabase.from(tabel).delete().eq(cfg.pk, r[cfg.pk]).select(cfg.pk), 'Șters')
  }

  const celula = (c, v, set) => typeof model[c] === 'boolean'
    ? <input type="checkbox" checked={!!v} onChange={e => set(e.target.checked)} />
    : <input value={v ?? ''} onChange={e => set(e.target.value)} style={{ ...S.input, minWidth: typeof model[c] === 'number' ? 70 : 120 }} />

  if (rows === null) return <div style={{ padding:30, color:G.muted, textAlign:'center' }}>Se încarcă...</div>
  const lista = [...rows].sort((a, b) => sortIdx(a) - sortIdx(b))

  return (
    <div style={{ ...S.card, padding:12 }}>
      {err && <div style={{ color:G.red, fontSize:12, marginBottom:8 }}>Eroare la citire: {err}</div>}
      {cfg.ro && <div style={{ color:G.yellow, fontSize:12, marginBottom:8 }}>🔒 {cfg.nota}</div>}
      {cfg.doar && <div style={{ color:G.muted, fontSize:12, marginBottom:8 }}>Bifa „in_f23" decide ce categorii de utilaje intră în Formularul 23. Restul se editează în Logistică.</div>}
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8, fontSize:12, color:G.muted }}>
        <span>{rows.length} rânduri{areActiv ? ` · ${rows.filter(r => r.activ === false).length} inactive` : ''}</span>
        {!cfg.ro && !cfg.doar && !nou && <button style={S.btnP} onClick={() => setNou({})}>+ Adaugă</button>}
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr>{cols.map(c => <th key={c} style={S.th}>{c}</th>)}{!cfg.ro && !cfg.doar && <th style={S.th}></th>}</tr></thead>
          <tbody>
            {nou && (
              <tr style={{ background:G.ofertare + '11' }}>
                {cols.map(c => <td key={c} style={S.td}>{(c === cfg.pk && !cfg.pkManual) ? <span style={{ color:G.dim }}>auto</span> : celula(c, nou[c], v => setNou(n => ({ ...n, [c]: v })))}</td>)}
                <td style={{ ...S.td, whiteSpace:'nowrap' }}>
                  <button disabled={busy} style={{ ...S.btnP, padding:'4px 9px' }} onClick={adauga}>💾</button>{' '}
                  <button style={{ ...S.btnS, padding:'4px 9px' }} onClick={() => setNou(null)}>✕</button>
                </td>
              </tr>
            )}
            {lista.map(r => {
              const inEdit = edit && edit.row[cfg.pk] === r[cfg.pk]
              return (
                <tr key={r[cfg.pk]} style={{ opacity: areActiv && r.activ === false ? 0.5 : 1 }}>
                  {cols.map(c => (
                    <td key={c} style={S.td}>
                      {cfg.doar && cfg.doar.includes(c)
                        ? <input type="checkbox" checked={!!r[c]} disabled={busy} onChange={() => toggle(r, c)} />
                        : inEdit && editabil(c) ? celula(c, edit.vals[c], v => setEdit(e => ({ ...e, vals: { ...e.vals, [c]: v } })))
                        : typeof r[c] === 'boolean' ? (r[c] ? '✓' : '—') : afis(r[c])}
                    </td>
                  ))}
                  {!cfg.ro && !cfg.doar && (
                    <td style={{ ...S.td, whiteSpace:'nowrap' }}>
                      {inEdit ? <>
                        <button disabled={busy} style={{ ...S.btnP, padding:'4px 9px' }} onClick={salveaza}>💾</button>{' '}
                        <button style={{ ...S.btnS, padding:'4px 9px' }} onClick={() => setEdit(null)}>✕</button>
                      </> : <>
                        <button style={{ ...S.btnS, padding:'4px 9px' }} title="Editează"
                          onClick={() => { const v = Object.fromEntries(cols.map(c => [c, typeof r[c] === 'boolean' ? r[c] : afis(r[c])])); setEdit({ row: r, vals: v, init: v }) }}>✏️</button>{' '}
                        {areActiv
                          ? <button disabled={busy} style={{ ...S.btnS, padding:'4px 9px' }} onClick={() => toggle(r, 'activ')}>{r.activ === false ? '↩ Reactivează' : '⏸ Dezactivează'}</button>
                          : <button disabled={busy} style={{ ...S.btnS, padding:'4px 9px', color:G.red }} onClick={() => sterge(r)}>🗑</button>}
                      </>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 🏢 Profil firmă — rândul unic firma_profil (id=1), folosit la auto-completarea formularelor de licitație
// (edge ofertare-clauze-formulare). Scriere doar owner (RLS pe profiles.is_owner); ceilalți văd read-only.
const CAMPURI_FIRMA = [
  ['denumire','Denumire'], ['forma_juridica','Formă juridică'], ['cui','CUI / CIF'], ['nr_reg_com','Nr. Reg. Com.'],
  ['euid','EUID'], ['caen_principal','CAEN principal'], ['caen_secundare','CAEN secundare (separate prin virgulă)', 'arr'],
  ['sediu_social','Sediu social', 'lung'], ['adresa_corespondenta','Adresă corespondență', 'lung'],
  ['telefon','Telefon'], ['fax','Fax'], ['email','Email'], ['website','Website'],
  ['reprezentant_legal','Reprezentant legal'], ['functie_reprezentant','Funcție reprezentant'], ['persoana_contact','Persoană de contact'],
  ['capital_social','Capital social (lei)', 'num'], ['data_infiintare','Data înființării', 'date'],
  ['certificari','Certificări (ISO, ANRE etc.)', 'text'], ['observatii','Observații', 'text'],
]
const LISTE_FIRMA = {
  conturi: { label:'Conturi bancare', cols:[['banca','Banca'], ['iban','IBAN'], ['tip','Tip (trezorerie/bancar)']] },
  cifra_afaceri: { label:'Cifra de afaceri', cols:[['an','An','num'], ['valoare','Valoare','num'], ['moneda','Monedă']] },
  nr_angajati_mediu: { label:'Nr. mediu angajați', cols:[['an','An','num'], ['numar','Număr','num']] },
}

function ProfilFirma({ showToast }) {
  const [row, setRow] = useState(null), [vals, setVals] = useState(null)
  const [owner, setOwner] = useState(false), [activi, setActivi] = useState(null), [busy, setBusy] = useState(false)
  const incarca = async () => {
    const { data, error } = await supabase.from('firma_profil').select('*').eq('id', 1).maybeSingle()
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    const r = data || { id:1, conturi:[], cifra_afaceri:[], nr_angajati_mediu:[] }
    setRow(r); setVals({ ...r, caen_secundare: (r.caen_secundare || []).join(', ') })
  }
  useEffect(() => {
    incarca()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) { const { data } = await supabase.from('profiles').select('is_owner').eq('id', user.id).maybeSingle(); setOwner(!!data?.is_owner) }
      const { count } = await supabase.from('employees').select('id', { count:'exact', head:true }).eq('active', true)
      setActivi(count ?? null)
    })()
  }, [])
  if (!vals) return <div style={{ color:G.muted, fontSize:12 }}>Se încarcă…</div>
  const set = (k, v) => setVals(x => ({ ...x, [k]: v }))
  const salveaza = async () => {
    setBusy(true)
    const p = { ...vals }
    delete p.updated_at; delete p.updated_by
    p.caen_secundare = String(vals.caen_secundare || '').split(',').map(x => x.trim()).filter(Boolean)
    for (const [k,, t] of CAMPURI_FIRMA) {
      if (k === 'caen_secundare') continue
      if (p[k] === '') p[k] = null
      if (t === 'num' && p[k] != null) { const n = Number(String(p[k]).replace(',', '.')); p[k] = isNaN(n) ? null : n }
    }
    for (const k of Object.keys(LISTE_FIRMA)) p[k] = (p[k] || []).filter(o => Object.values(o).some(v => v !== '' && v != null))
    const { data, error } = await supabase.from('firma_profil').upsert(p).select('id')
    setBusy(false)
    if (error || !data?.length) { showToast?.('Nu s-a salvat' + (error ? ': ' + error.message : ' (fără drept de scriere)'), 'error'); return }
    showToast?.('Profil firmă salvat', 'success'); incarca()
  }
  const inp = (k, t) => t === 'text'
    ? <textarea disabled={!owner} rows={3} value={vals[k] ?? ''} onChange={e => set(k, e.target.value)} style={{ ...S.input, resize:'vertical' }} />
    : <input disabled={!owner} type={t === 'date' ? 'date' : 'text'} value={vals[k] ?? ''} onChange={e => set(k, e.target.value)} style={S.input} />
  return (
    <div style={{ ...S.card, padding:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, gap:8, flexWrap:'wrap' }}>
        <div style={{ fontSize:12, color:G.muted }}>Date folosite la completarea automată a formularelor de licitație. Câmpurile goale rămân „[DE COMPLETAT]” în formulare.
          {!owner && <span style={{ color:G.yellow }}> Doar citire — editează doar owner-ul.</span>}</div>
        {owner && <button disabled={busy} onClick={salveaza} style={S.btnP}>{busy ? 'Se salvează…' : '💾 Salvează'}</button>}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:10 }}>
        {CAMPURI_FIRMA.map(([k, l, t]) => (
          <label key={k} style={{ fontSize:11, color:G.muted, gridColumn: t === 'lung' || t === 'text' ? '1 / -1' : undefined }}>{l}{inp(k, t)}</label>
        ))}
      </div>
      {Object.entries(LISTE_FIRMA).map(([k, cfg]) => (
        <div key={k} style={{ marginTop:14 }}>
          <div style={{ fontSize:12, fontWeight:700, color:G.text, marginBottom:6 }}>{cfg.label}
            {k === 'nr_angajati_mediu' && activi != null && <span style={{ fontWeight:400, color:G.dim }}> — indiciu: {activi} angajați activi acum în Pontaj (nu se salvează automat)</span>}</div>
          {(vals[k] || []).map((o, i) => (
            <div key={i} style={{ display:'flex', gap:6, marginBottom:4 }}>
              {cfg.cols.map(([c, cl, ct]) => (
                <input key={c} disabled={!owner} placeholder={cl} value={o[c] ?? ''} style={S.input}
                  onChange={e => { const v = ct === 'num' && e.target.value !== '' && !isNaN(Number(e.target.value.replace(',', '.'))) ? Number(e.target.value.replace(',', '.')) : e.target.value
                    set(k, vals[k].map((x, j) => j === i ? { ...x, [c]: v } : x)) }} />
              ))}
              {owner && <button onClick={() => set(k, vals[k].filter((_, j) => j !== i))} style={{ ...S.btnS, color:G.red }}>✕</button>}
            </div>
          ))}
          {owner && <button onClick={() => set(k, [...(vals[k] || []), {}])} style={S.btnS}>+ Adaugă</button>}
          {!owner && !(vals[k] || []).length && <div style={{ fontSize:11, color:G.dim }}>—</div>}
        </div>
      ))}
      {row?.updated_at && <div style={{ marginTop:12, fontSize:10.5, color:G.dim }}>Actualizat: {new Date(row.updated_at).toLocaleString('ro-RO')}</div>}
    </div>
  )
}
