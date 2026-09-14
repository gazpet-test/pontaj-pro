// ════════════════════════════════════════════════════════════════
// OfertareClarificariAC.jsx — solicitările de clarificare primite de la AUTORITATEA CONTRACTANTĂ
// (PR 2 Laza, 14.09.2026). Direcția inversă față de ofertare_clarificari (întrebările noastre).
//
// Trei reguli, toate din cazul Râșnița (SCN1176786, 11 puncte, termen 1 zi):
// 1. Unitatea e PUNCTUL, nu anexa. Fiecare întrebare a comisiei primește răspuns + „unde în oferta
//    depusă e informația" — cauza comună la Laza: exista, dar nu era localizabilă.
// 2. Proveniența anexelor NU se declară, se demonstrează: sha256 (retrimis = identic cu manifestul
//    depus), document_date vs data depunerii (pre/post). Post-depunere fără justificare = block.
// 3. Verdictul vine dintr-un singur loc: evalueazaPoartaClarificare (funcție pură, testată). Aici
//    nu se scrie nicio condiție de blocaj. Sub 12 h de termen, poarta oferă „trimite CU REZERVE".
// Nu se modifică documentele depuse; răspunsul se construiește în jurul lor.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { sha256Hex } from './ofertarePachet.js'
import { evalueazaPoartaClarificare } from './ofertarePoarta.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF',
  orange:'#F0883E', yellow:'#E3B341', red:'#F85149' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'8px 12px', color:G.text, fontSize:13, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btn: { padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, cursor:'pointer', fontSize:12 },
  btnP: { padding:'8px 16px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
}
const PROV = {
  retrimis:      { t:'retrimis (hash identic cu manifestul depus)', c:G.green },
  pre_depunere:  { t:'dinainte de depunere', c:G.green },
  post_depunere: { t:'DUPĂ depunere', c:G.red },
  fara_data:     { t:'fără dată', c:G.orange },
}
const fmtDT = d => d ? new Date(d).toLocaleString('ro-RO') : '—'
const localISO = d => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16) }

export default function ClarificariAC({ licId, showToast }) {
  const [stari, setStari] = useState(null)      // v_ofertare_solicitari_ac_stare
  const [puncte, setPuncte] = useState([])
  const [anexe, setAnexe] = useState([])
  const [sel, setSel] = useState(null)          // solicitare_id deschisă
  const [busy, setBusy] = useState(false)
  const [acum, setAcum] = useState(() => new Date())

  useEffect(() => { const t = setInterval(() => setAcum(new Date()), 60_000); return () => clearInterval(t) }, [])

  const load = async () => {
    if (!licId) return
    const rS = await supabase.from('v_ofertare_solicitari_ac_stare').select('*').eq('licitatie_id', licId).order('nr')
    if (rS.error) { showToast?.('Solicitările AC nu s-au putut citi: ' + rS.error.message, 'err'); return }
    const lista = rS.data || []
    setStari(lista)
    const ids = lista.map(s => s.solicitare_id)
    if (!ids.length) { setPuncte([]); setAnexe([]); return }
    const rP = await supabase.from('ofertare_solicitari_ac_puncte').select('*').in('solicitare_id', ids).order('nr').limit(1000)
    if (rP.error) { showToast?.(rP.error.message, 'err'); return }
    setPuncte(rP.data || [])
    const pids = (rP.data || []).map(p => p.id)
    if (!pids.length) { setAnexe([]); return }
    const rA = await supabase.from('ofertare_solicitari_ac_anexe').select('*').in('punct_id', pids).order('id').limit(2000)
    if (rA.error) { showToast?.(rA.error.message, 'err'); return }
    setAnexe(rA.data || [])
  }
  useEffect(() => { setSel(null); load() }, [licId])   // eslint-disable-line react-hooks/exhaustive-deps

  const adaugaSolicitare = async () => {
    const nr = (stari?.length ? Math.max(...stari.map(s => s.nr)) : 0) + 1
    const termen = window.prompt('Termenul de răspuns (zz.ll.aaaa hh:mm) — cel din adresa comisiei:', '')
    let termen_raspuns = null
    if (termen) {
      const m = termen.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})$/)
      if (!m) { showToast?.('Format: 12.09.2026 16:00', 'err'); return }
      termen_raspuns = new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]).toISOString()
    }
    setBusy(true)
    const { data, error } = await supabase.from('ofertare_solicitari_ac').insert({ licitatie_id: licId, nr, termen_raspuns }).select('id').single()
    setBusy(false)
    if (error) { showToast?.('Nu s-a creat: ' + error.message, 'err'); return }
    setSel(data.id); await load()
  }

  const trimite = async (st, ev, cuRezerve) => {
    const rez = cuRezerve ? ev.rezerve.join(' · ') : (ev.rezerve.length ? ev.rezerve.join(' · ') : null)
    if (!window.confirm(cuRezerve
      ? `Trimiți CU REZERVE? Rămâne scris:\n${rez}`
      : `Marchezi solicitarea #${st.nr} ca trimisă?${rez ? `\nCu rezerve: ${rez}` : ''}`)) return
    setBusy(true)
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('ofertare_solicitari_ac')
      .update({ stare: cuRezerve ? 'trimisa_cu_rezerve' : 'trimisa', trimisa_la: new Date().toISOString(), trimisa_de: u?.user?.id || null, rezerve: rez })
      .eq('id', st.solicitare_id)
    setBusy(false)
    if (error) { showToast?.('Nu s-a marcat: ' + error.message, 'err'); return }
    showToast?.(cuRezerve ? 'Trimisă CU REZERVE — rămân scrise.' : 'Trimisă.', cuRezerve ? 'err' : 'ok')
    await load()
  }

  if (stari === null) return <div style={{ color:G.muted, fontSize:13, padding:12 }}>Se încarcă solicitările…</div>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        {stari.map(s => {
          const ev = evalueazaPoartaClarificare(s, acum)
          const c = s.stare !== 'deschisa' ? G.blue : ev.stare === 'block' ? G.red : ev.stare === 'warn' ? G.orange : G.green
          return (
            <button key={s.solicitare_id} onClick={() => setSel(sel === s.solicitare_id ? null : s.solicitare_id)}
              style={{ ...S.btn, borderColor: sel === s.solicitare_id ? G.ofertare : G.border2, color:c }}>
              #{s.nr} · {s.puncte} puncte · {s.stare === 'deschisa' ? (ev.ore_ramase == null ? 'fără termen' : ev.ore_ramase < 0 ? 'termen depășit' : `${Math.round(ev.ore_ramase)} h`) : s.stare.replace(/_/g, ' ')}
            </button>
          )
        })}
        <button onClick={adaugaSolicitare} disabled={busy} style={S.btn}>+ Solicitare primită de la AC</button>
        {!stari.length && <span style={{ fontSize:12, color:G.dim }}>nicio solicitare de clarificare primită pe licitația asta</span>}
      </div>

      {stari.filter(s => s.solicitare_id === sel).map(s => (
        <Solicitare key={s.solicitare_id} st={s} acum={acum} busy={busy} setBusy={setBusy} showToast={showToast} reload={load}
          puncte={puncte.filter(p => p.solicitare_id === s.solicitare_id)} anexe={anexe} onTrimite={trimite} />
      ))}
    </div>
  )
}

function Solicitare({ st, acum, puncte, anexe, busy, setBusy, showToast, reload, onTrimite }) {
  const ev = useMemo(() => evalueazaPoartaClarificare(st, acum), [st, acum])
  const [intrebare, setIntrebare] = useState('')
  const inchisa = st.stare !== 'deschisa'
  const cul = s => s === 'block' ? G.red : s === 'warn' ? G.orange : G.green
  const ico = s => s === 'block' ? '⛔' : s === 'warn' ? '⚠️' : '✓'
  const provPe = useMemo(() => new Map((st.anexe || []).map(a => [a.id, a])), [st.anexe])

  const setTermen = async (v) => {
    const { error } = await supabase.from('ofertare_solicitari_ac').update({ termen_raspuns: v ? new Date(v).toISOString() : null }).eq('id', st.solicitare_id)
    if (error) showToast?.(error.message, 'err'); else reload()
  }
  const adaugaPunct = async () => {
    const t = intrebare.trim(); if (!t) return
    setBusy(true)
    const nr = (puncte.length ? Math.max(...puncte.map(p => p.nr)) : 0) + 1
    const { error } = await supabase.from('ofertare_solicitari_ac_puncte').insert({ solicitare_id: st.solicitare_id, nr, intrebare: t })
    setBusy(false)
    if (error) { showToast?.(error.message, 'err'); return }
    setIntrebare(''); reload()
  }
  const salveazaPunct = async (p, patch) => {
    const { error } = await supabase.from('ofertare_solicitari_ac_puncte').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (error) showToast?.(error.message, 'err'); else reload()
  }
  const stergePunct = async (p) => {
    if (!window.confirm(`Ștergi punctul ${p.nr}? Se șterg și anexele lui.`)) return
    const { error } = await supabase.from('ofertare_solicitari_ac_puncte').delete().eq('id', p.id)
    if (error) showToast?.(error.message, 'err'); else reload()
  }
  // Anexa: bytes-ii urcați sunt EXACT cei hash-uiți. Data documentului o pune omul — nu se ghicește
  // din fișier, fiindcă data din metadate e data salvării, nu a actului.
  const urcaAnexa = async (p, file) => {
    if (!file) return
    const dataDoc = window.prompt(`Data DOCUMENTULUI „${file.name}" (aaaa-ll-zz) — data de pe act, nu a fișierului. Gol = fără dată (rămâne de demonstrat):`, '')
    if (dataDoc && !/^\d{4}-\d{2}-\d{2}$/.test(dataDoc)) { showToast?.('Format: 2026-07-09', 'err'); return }
    setBusy(true)
    try {
      const sha256 = await sha256Hex(file)
      const path = `clarificari-ac/${st.licitatie_id}/${st.solicitare_id}/${p.nr}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`
      const up = await supabase.storage.from('ofertare').upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (up.error) throw new Error('upload: ' + up.error.message)
      const { error } = await supabase.from('ofertare_solicitari_ac_anexe').insert({
        punct_id: p.id, nume: file.name, fisier_path: path, sha256, size_bytes: file.size, document_date: dataDoc || null })
      if (error) throw new Error(error.message)
    } catch (e) { showToast?.('Anexa nu s-a urcat: ' + (e?.message || e), 'err') }
    setBusy(false); reload()
  }
  const justifica = async (a) => {
    const j = window.prompt(`„${a.nume}" e datată după depunere. De ce e admisibilă (ex. dovedește o stare de fapt dinainte de depunere)? Gol = șterge justificarea.`, a.justificare_post_depunere || '')
    if (j === null) return
    const { error } = await supabase.from('ofertare_solicitari_ac_anexe').update({ justificare_post_depunere: j.trim() || null }).eq('id', a.id)
    if (error) showToast?.(error.message, 'err'); else reload()
  }
  const stergeAnexa = async (a) => {
    if (!window.confirm(`Ștergi anexa „${a.nume}"?`)) return
    const { error } = await supabase.from('ofertare_solicitari_ac_anexe').delete().eq('id', a.id)
    if (error) showToast?.(error.message, 'err'); else reload()
  }

  return (
    <div style={{ ...S.card, padding:14, display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', fontSize:12, color:G.muted }}>
        <b style={{ color:G.text, fontSize:13 }}>Solicitarea #{st.nr}</b>
        <span>primită {fmtDT(st.primita_la)}</span>
        <label>termen: <input type="datetime-local" disabled={inchisa} defaultValue={st.termen_raspuns ? localISO(st.termen_raspuns) : ''}
          onBlur={e => { const v = e.target.value; if ((v || null) !== (st.termen_raspuns ? localISO(st.termen_raspuns) : null)) setTermen(v) }}
          style={{ ...S.input, width:'auto', padding:'4px 8px', fontSize:12 }} /></label>
        <span>oferta depusă {fmtDT(st.depus_la)} <span style={{ color:G.dim }}>({st.depus_sursa === 'pachet' ? 'pachet depus' : 'termenul licitației'})</span></span>
        {inchisa && <span style={{ color:G.blue }}>{st.stare.replace(/_/g, ' ')} {fmtDT(st.trimisa_la)}{st.rezerve ? ` · rezerve: ${st.rezerve}` : ''}</span>}
      </div>

      {/* poarta — rândurile vin din funcția pură, aici doar se desenează */}
      <div style={{ ...S.card, overflow:'hidden', background:G.surface }}>
        {ev.randuri.map((r, i) => (
          <div key={r.k} style={{ display:'flex', gap:10, padding:'8px 12px', borderTop: i ? `1px solid ${G.border2}` : 'none' }}>
            <span style={{ color:cul(r.stare), width:18 }}>{ico(r.stare)}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:600, color:G.text }}>{r.titlu}</div>
              <div style={{ fontSize:12, color:G.muted }}>{r.detalii}</div>
            </div>
          </div>
        ))}
      </div>

      {!inchisa && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button onClick={() => onTrimite(st, ev, false)} disabled={busy || ev.stare === 'block'}
            title={ev.stare === 'block' ? 'Are rânduri roșii' : 'Marchează răspunsul ca trimis (cu rezervele galbene scrise)'}
            style={{ ...S.btnP, opacity: (busy || ev.stare === 'block') ? .45 : 1 }}>📨 Marchează trimisă</button>
          {ev.poate_cu_rezerve && (
            <button onClick={() => onTrimite(st, ev, true)} disabled={busy}
              title="Sub 12 h de termen: rândurile roșii devin rezerve scrise, dar nu opresc trimiterea"
              style={{ ...S.btnP, background:G.orange }}>⚠️ Trimite CU REZERVE ({Math.round(ev.ore_ramase)} h rămase)</button>
          )}
        </div>
      )}

      <div>
        <div style={S.lbl}>Punctele comisiei — un rând per întrebare</div>
        {puncte.map(p => {
          const an = anexe.filter(a => a.punct_id === p.id)
          return (
            <div key={p.id} style={{ ...S.card, padding:10, marginBottom:8, display:'flex', flexDirection:'column', gap:6 }}>
              <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                <b style={{ color:G.ofertare, minWidth:24 }}>{p.nr}.</b>
                <div style={{ flex:1, fontSize:13, color:G.text, whiteSpace:'pre-wrap' }}>{p.intrebare}</div>
                {!inchisa && <button onClick={() => stergePunct(p)} style={{ ...S.btn, color:G.red }}>✕</button>}
              </div>
              <textarea disabled={inchisa} defaultValue={p.raspuns || ''} placeholder="Răspunsul nostru…" rows={3}
                onBlur={e => { if (e.target.value !== (p.raspuns || '')) salveazaPunct(p, { raspuns: e.target.value, stare: e.target.value.trim() ? 'raspuns' : 'de_raspuns' }) }}
                style={{ ...S.input, fontFamily:'inherit' }} />
              <input disabled={inchisa} defaultValue={p.locator_oferta || ''} placeholder="Unde în oferta DEPUSĂ e informația (ex. Propunere tehnică, cap. 4, p. 312)"
                onBlur={e => { if (e.target.value !== (p.locator_oferta || '')) salveazaPunct(p, { locator_oferta: e.target.value }) }}
                style={S.input} />
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', fontSize:12 }}>
                {an.map(a => {
                  const pv = provPe.get(a.id)?.provenienta || 'fara_data'
                  const pj = PROV[pv]
                  return (
                    <span key={a.id} style={{ border:`1px solid ${pj.c}55`, borderRadius:6, padding:'3px 8px', color:G.text }}>
                      📎 {a.nume} <span style={{ color:pj.c }}>· {pj.t}{a.document_date ? ` · ${a.document_date}` : ''}</span>
                      {pv === 'post_depunere' && (
                        <button onClick={() => justifica(a)} disabled={inchisa} style={{ ...S.btn, marginLeft:6, padding:'2px 6px', color: a.justificare_post_depunere ? G.green : G.orange }}
                          title={a.justificare_post_depunere || 'Fără justificare — block'}>{a.justificare_post_depunere ? 'justificată' : 'justifică'}</button>
                      )}
                      {!inchisa && <button onClick={() => stergeAnexa(a)} style={{ ...S.btn, marginLeft:4, padding:'2px 6px', color:G.red }}>✕</button>}
                    </span>
                  )
                })}
                {!inchisa && (
                  <label style={{ ...S.btn, cursor:'pointer' }}>+ anexă
                    <input type="file" hidden onChange={e => { urcaAnexa(p, e.target.files?.[0]); e.target.value = '' }} />
                  </label>
                )}
              </div>
            </div>
          )
        })}
        {!inchisa && (
          <div style={{ display:'flex', gap:8 }}>
            <input value={intrebare} onChange={e => setIntrebare(e.target.value)} placeholder="Întrebarea comisiei, textual…" style={S.input}
              onKeyDown={e => { if (e.key === 'Enter') adaugaPunct() }} />
            <button onClick={adaugaPunct} disabled={busy || !intrebare.trim()} style={S.btn}>+ punct</button>
          </div>
        )}
      </div>
    </div>
  )
}
