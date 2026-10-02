// ════════════════════════════════════════════════════════════════
// GarantiiBileteOrdin.jsx — panoul „🧾 BO” din Financiar → 🏛 Registru garanții: biletele la ordin date de Gazpet ca
//   GARANȚIE la o poliță de asigurare (rândul cu forma = polita_asigurare). Decizia lui Răzvan 02.10.2026 „1B” (#1544),
//   cererea Marilenei Tudorache. BO-ul nu e plata primei: e garanția cerută de asigurător și se urmărește până la
//   restituire. Logica pură (zile, validare, normalizare) e în garantiiBileteOrdin.js (testată cu vitest).
//   Tabela: garantii_bilete_ordin (migrarea 20261003a; scrierea prin RLS cu fn_poate_scrie_garantii — aceeași poartă ca
//   restul registrului; în UI, aceeași condiție canEdit ca butoanele de editare). Scanul e opțional: bucketul
//   documente-firma (doar PDF, max 50 MB; politica de INSERT a bucketului cere drepturi pe Administrativ › Documente —
//   dacă upload-ul e refuzat, biletul se salvează fără scan).
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import { fmtSuma, fmtData } from './garantiiCerereOferta.js'
import { STARI_BO, MONEDE_BO, BUCKET_SCAN_BO, aziISO, etichetaScadenta, eDepasit, formularDinBO, formularGol, laSchimbareStare,
  valideazaBO, normalizeazaBO, caleScanBO, verificaScan, mesajEroareSalvare } from './garantiiBileteOrdin.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341', red:'#F85149' }
const S = {
  input:{ width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'7px 10px', color:G.text, fontSize:12.5, outline:'none', colorScheme:'dark' },
  lbl:{ display:'block', fontSize:10.5, color:G.muted, marginBottom:3, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnS:{ padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:12, fontWeight:600 },
}

export default function BiletePanel({ garantie, canEdit = false, showToast, onClose, onChanged }) {
  const [lista, setLista] = useState(null)   // null = se încarcă
  const [err, setErr] = useState(null)
  const [f, setF] = useState(null)           // formularul (null = închis)
  const [fisier, setFisier] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const azi = aziISO()

  // lista BO-urilor poliței, cele mai noi primele (order obligatoriu — anti-bug #1535)
  const incarca = useCallback(async () => {
    const { data, error } = await supabase.from('garantii_bilete_ordin').select('*').eq('garantie_id', garantie.id)
      .order('data_emitere', { ascending: false }).order('id', { ascending: false })
    if (error) { setErr(mesajEroareSalvare(error)); setLista([]) } else { setErr(null); setLista(data || []) }
  }, [garantie.id])
  useEffect(() => { incarca() }, [incarca])

  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const deschideFormular = (initial) => { setF(initial); setFisier(null); setMsg(null) }
  const deschideScan = async (path) => {
    const { data, error } = await supabase.storage.from(BUCKET_SCAN_BO).createSignedUrl(path, 600)
    if (error || !data?.signedUrl) return showToast?.('Nu am putut deschide scanul: ' + (error?.message || 'link lipsă'), 'err')
    window.open(data.signedUrl, '_blank')
  }

  const salveaza = async () => {
    const erori = valideazaBO(f)
    if (erori.length) return setMsg('De corectat: ' + erori.join('; ') + '.')
    setBusy(true); setMsg(null)
    try {
      let document_path = f.document_path || null
      if (fisier) {
        const e = verificaScan(fisier)
        if (e) throw new Error(e)
        const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
        const cale = caleScanBO(garantie.id, uuid, fisier.name)
        const { error: eu } = await supabase.storage.from(BUCKET_SCAN_BO).upload(cale, fisier, { upsert: false, contentType: 'application/pdf' })
        if (eu) throw new Error(`scanul nu s-a urcat (${eu.message}) — biletul NU s-a salvat. Scoate fișierul ca să-l salvezi fără scan, sau cere drepturi pe Administrativ › Documente.`)
        document_path = cale
      }
      const rand = { ...normalizeazaBO({ ...f, document_path }, garantie.id), updated_at: new Date().toISOString() }
      const { error } = f.id
        ? await supabase.from('garantii_bilete_ordin').update(rand).eq('id', f.id)
        : await supabase.from('garantii_bilete_ordin').insert(rand)
      if (error) throw new Error(mesajEroareSalvare(error))
      showToast?.(f.id ? '✓ Bilet actualizat' : '✓ Bilet la ordin înregistrat', 'ok')
      setF(null); setFisier(null)
      await incarca(); onChanged?.()
    } catch (e) { setMsg(e.message) }
    setBusy(false)
  }

  // câmp de formular — funcție simplă (NU componentă): o componentă definită în corp s-ar recrea la fiecare randare și inputul ar pierde focusul
  const inp = ({ l, k, type = 'text', ph, w }) => (
    <div key={k} style={{ gridColumn: w ? `span ${w}` : undefined }}>
      <label style={S.lbl}>{l}</label>
      <input type={type} value={f[k] ?? ''} placeholder={ph} onChange={e => set(k, e.target.value)} style={S.input} />
    </div>
  )
  const emise = (lista || []).filter(b => b.stare === 'emis')
  const totalEmise = emise.reduce((s, b) => s + Number(b.suma || 0), 0)

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'#000A', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:G.card, border:`1px solid ${G.border}`, borderRadius:12, maxWidth:900, width:'100%', maxHeight:'92vh', overflow:'auto', padding:20 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4, flexWrap:'wrap' }}>
          <div style={{ fontSize:15, fontWeight:700 }}>🧾 Bilete la ordin — garanție la poliță</div>
          <button onClick={onClose} style={{ marginLeft:'auto', ...S.btnS }}>Închide</button>
        </div>
        <div style={{ fontSize:12.5, color:G.muted, marginBottom:12 }}>
          Polița {garantie.numar_document ? <b style={{ color:G.text }}>{garantie.numar_document}</b> : 'fără număr încă'}{garantie.emitent ? ` · ${garantie.emitent}` : ''}
          {' · '}{garantie.lucrare || garantie.beneficiar}{garantie.data_expirare ? ` · expiră ${fmtData(garantie.data_expirare)}` : ''}
          <div style={{ fontSize:11.5, color:G.dim, marginTop:3 }}>BO-ul e garanția cerută de asigurător la poliță, nu plata primei — se urmărește până la restituire.</div>
        </div>

        {err && <div style={{ color:G.red, fontSize:12.5, marginBottom:10 }}>Eroare: {err}</div>}
        {lista == null && !err && <div style={{ color:G.muted, fontSize:12.5 }}>Se încarcă…</div>}

        {lista && (
          <div style={{ background:G.bg, border:`1px solid ${G.border2}`, borderRadius:10, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12.5 }}>
              <thead>
                <tr style={{ background:G.surface, color:G.muted, fontSize:11, textTransform:'uppercase', letterSpacing:'.3px' }}>
                  {['Serie / nr.', 'Sumă', 'Emis la', 'Scadență', 'Stare', 'Scan', ''].map(h => <th key={h} style={{ textAlign:'left', padding:'8px 10px', fontWeight:600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {lista.map(b => {
                  const st = STARI_BO[b.stare] || { eticheta: b.stare, culoare: 'dim' }
                  const c = G[st.culoare] || G.dim
                  const et = etichetaScadenta(b, azi)
                  return (
                    <tr key={b.id} style={{ borderTop:`1px solid ${G.border2}` }}>
                      <td style={{ padding:'8px 10px', fontWeight:600 }}>
                        {[b.serie, b.numar].filter(Boolean).join(' ')}
                        {b.observatii && <div title={b.observatii} style={{ fontSize:11, color:G.muted, marginTop:2, maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.observatii}</div>}
                      </td>
                      <td style={{ padding:'8px 10px', whiteSpace:'nowrap', fontWeight:700 }}>{fmtSuma(b.suma, b.moneda)}</td>
                      <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{fmtData(b.data_emitere) || '—'}</td>
                      <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>
                        {fmtData(b.data_scadenta) || '—'}
                        {et && <div style={{ fontSize:11, color: eDepasit(b, azi) ? G.red : G.orange, fontWeight:700 }}>{et}</div>}
                      </td>
                      <td style={{ padding:'8px 10px' }}>
                        <span title={st.descriere} style={{ padding:'3px 9px', borderRadius:20, fontSize:11, fontWeight:700, background:c + '22', color:c }}>{st.eticheta}</span>
                        {b.stare === 'restituit' && b.restituit_la && <div style={{ fontSize:10.5, color:G.muted, marginTop:3 }}>la {fmtData(b.restituit_la)}</div>}
                      </td>
                      <td style={{ padding:'8px 10px' }}>
                        {b.document_path ? <button onClick={() => deschideScan(b.document_path)} style={{ ...S.btnS, fontSize:11, padding:'4px 9px' }}>📎 Scan</button> : <span style={{ color:G.dim }}>—</span>}
                      </td>
                      <td style={{ padding:'8px 10px', textAlign:'right', whiteSpace:'nowrap' }}>
                        {canEdit && b.stare === 'emis' && (
                          <button onClick={() => deschideFormular(laSchimbareStare(formularDinBO(b, azi), 'restituit', azi))}
                            style={{ ...S.btnS, marginRight:5, color:G.green, border:`1px solid ${G.green}55` }}
                            title="Marchează biletul ca restituit (data implicită: azi) — confirmi cu Salvează">↩ Restituit</button>
                        )}
                        {canEdit && <button onClick={() => deschideFormular(formularDinBO(b, azi))} style={S.btnS} title="Editează">✏️</button>}
                      </td>
                    </tr>
                  )
                })}
                {lista.length === 0 && (
                  <tr><td colSpan={7} style={{ padding:'18px 10px', textAlign:'center', color:G.dim }}>Niciun bilet la ordin înregistrat pe polița asta.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {lista && lista.length > 0 && (
          <div style={{ fontSize:12, color:G.muted, marginTop:8 }}>
            {emise.length} emis(e), nerestituit(e){emise.length ? ` · ${fmtSuma(totalEmise, emise[0]?.moneda || 'RON')}` : ''} · {lista.length} în total
          </div>
        )}

        {canEdit && !f && (
          <div style={{ marginTop:12 }}>
            <button onClick={() => deschideFormular(formularGol(azi))} style={{ ...S.btnS, background:G.blue + '18', color:G.blue, border:`1px solid ${G.blue}55` }}>➕ Bilet la ordin nou</button>
          </div>
        )}

        {f && (
          <div style={{ background:G.surface, border:`1px solid ${G.border2}`, borderRadius:10, padding:14, marginTop:12 }}>
            <div style={{ fontSize:13, fontWeight:700, marginBottom:10 }}>{f.id ? '✏️ Editează biletul' : '➕ Bilet la ordin nou'}</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:10 }}>
              {inp({ l:'Serie', k:'serie', ph:'opțional' })}
              {inp({ l:'Număr *', k:'numar' })}
              {inp({ l:'Sumă *', k:'suma', type:'number' })}
              <div>
                <label style={S.lbl}>Moneda</label>
                <select value={f.moneda || 'RON'} onChange={e => set('moneda', e.target.value)} style={S.input}>{MONEDE_BO.map(m => <option key={m}>{m}</option>)}</select>
              </div>
              {inp({ l:'Emis la *', k:'data_emitere', type:'date' })}
              {inp({ l:'Scadența / data restituirii', k:'data_scadenta', type:'date' })}
              <div>
                <label style={S.lbl}>Stare</label>
                <select value={f.stare} onChange={e => setF(x => laSchimbareStare(x, e.target.value, azi))} style={S.input}>
                  {Object.entries(STARI_BO).map(([k, v]) => <option key={k} value={k}>{v.eticheta} — {v.descriere}</option>)}
                </select>
              </div>
              {f.stare === 'restituit' && inp({ l:'Restituit la *', k:'restituit_la', type:'date' })}
              {inp({ l:'Observații', k:'observatii', w:2 })}
              <div style={{ gridColumn:'span 2' }}>
                <label style={S.lbl}>Scan (PDF, max 50 MB){f.document_path ? ' — există unul; alegi altul doar dacă vrei să-l înlocuiești' : ' — opțional'}</label>
                <input key={f.id || 'nou'} type="file" accept="application/pdf" onChange={e => setFisier(e.target.files?.[0] || null)} style={{ ...S.input, padding:'5px 8px' }} />
              </div>
            </div>
            {msg && <div style={{ marginTop:10, fontSize:12.5, color:G.red }}>{msg}</div>}
            <div style={{ display:'flex', gap:8, marginTop:12, alignItems:'center', flexWrap:'wrap' }}>
              <button onClick={salveaza} disabled={busy} style={{ ...S.btnS, background:G.blue, color:'#0D1117', border:'none', fontWeight:700 }}>{busy ? 'Se salvează…' : '💾 Salvează'}</button>
              <button onClick={() => deschideFormular(null)} disabled={busy} style={S.btnS}>Renunță</button>
              <div style={{ fontSize:11.5, color:G.dim }}>Scanul se urcă în documente-firma; dacă e refuzat (drepturi), salvezi biletul fără scan.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
