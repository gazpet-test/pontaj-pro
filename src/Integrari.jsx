// ════════════════════════════════════════════════════════════════
// Integrari.jsx — Setări → Integrări: ViCare (Viessmann, OAuth oficial) și, ulterior, Salus iT600.
// /integrari/vicare e și redirect URI-ul OAuth: dacă vine ?code=..., îl schimbăm pe token prin edge fn `vicare`.
// Tokenurile nu ating browserul: edge fn le pune în Vault. Aici doar stare + buton + ce citește centrala.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681', green:'#3FB950', red:'#F85149', yellow:'#E3B341', blue:'#58A6FF', orange:'#F0883E' }
const S = {
  btnP: { padding:'9px 16px', background:'#E4261E', color:'#fff', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 13px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:7, cursor:'pointer', fontSize:12.5 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10, padding:16 },
}
const fmtDT = (d) => d ? new Date(d).toLocaleString('ro-RO', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'

export default function Integrari() {
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const [profile, setProfile] = useState(null)
  const [integ, setInteg] = useState(null)
  const [disp, setDisp] = useState([])
  const [sites, setSites] = useState([])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const [{ data: p }, { data: i }, { data: d }, { data: s }] = await Promise.all([
      user ? supabase.from('profiles').select('id, is_owner').eq('id', user.id).maybeSingle() : { data: null },
      supabase.from('iot_integrari').select('*').eq('cheie', 'vicare').maybeSingle(),
      supabase.from('iot_dispozitive').select('*').eq('sursa', 'vicare').order('id'),
      supabase.from('sites').select('id, name').eq('active', true).order('name'),
    ])
    setProfile(p); setInteg(i); setDisp(d || []); setSites(s || [])
  }
  useEffect(() => { load() }, [])

  // Întoarcerea de la Viessmann cu ?code=
  useEffect(() => {
    const code = sp.get('code'); if (!code) return
    setSp({}, { replace: true })
    ;(async () => {
      setBusy('Schimb codul pe token și citesc centrala...')
      const { data, error } = await supabase.functions.invoke('vicare', { body: { actiune: 'callback', code } })
      setBusy(null)
      if (error || data?.error) setMsg({ ok: false, t: 'Conectarea a eșuat: ' + (error?.message || data?.error) })
      else setMsg({ ok: true, t: `ViCare conectat. ${data.dispozitive?.length || 0} dispozitiv(e) citite.` })
      await load()
    })()
  }, [sp])

  const conecteaza = async () => {
    setBusy('Pregătesc autorizarea...')
    const { data, error } = await supabase.functions.invoke('vicare', { body: { actiune: 'auth_url' } })
    setBusy(null)
    if (error || data?.error) { setMsg({ ok: false, t: error?.message || data?.error }); return }
    window.location.href = data.url
  }
  const sync = async () => {
    setBusy('Citesc centrala...')
    const { data, error } = await supabase.functions.invoke('vicare', { body: { actiune: 'sync' } })
    setBusy(null)
    setMsg(error || data?.error ? { ok: false, t: error?.message || data?.error } : { ok: true, t: 'Citire reușită.' })
    await load()
  }
  const deconecteaza = async () => {
    if (!window.confirm('Deconectezi ViCare? Citirile se opresc până reconectezi.')) return
    await supabase.functions.invoke('vicare', { body: { actiune: 'deconecteaza' } }); await load()
  }
  const setSite = async (id, site_id) => { await supabase.from('iot_dispozitive').update({ site_id: site_id || null }).eq('id', id); await load() }

  const st = integ?.stare || 'neconectat'
  const stC = st === 'conectat' ? G.green : st === 'eroare' ? G.red : G.dim
  const isOwner = !!profile?.is_owner
  const V = ({ k, v, um }) => v == null ? null : <div style={{ display:'flex', justifyContent:'space-between', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${G.border}22` }}><span style={{ color:G.muted }}>{k}</span><b>{typeof v === 'number' ? v.toLocaleString('ro-RO', { maximumFractionDigits: 1 }) : String(v)}{um ? ' ' + um : ''}</b></div>

  return (
    <div style={{ background:G.bg, minHeight:'100vh', color:G.text, padding:'20px 24px', fontFamily:'system-ui, sans-serif' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
        <Link to="/" style={{ color:G.muted, textDecoration:'none', fontSize:13 }}>← înapoi</Link>
        <div style={{ fontSize:19, fontWeight:800 }}>🔌 Integrări</div>
        {busy && <span style={{ marginLeft:'auto', fontSize:12.5, color:G.blue, fontWeight:700 }}>{busy}</span>}
      </div>
      {msg && <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:12, background:(msg.ok ? G.green : G.red) + '22', color: msg.ok ? G.green : G.red, fontSize:13, fontWeight:600 }}>{msg.t}</div>}

      <div style={{ ...S.card, maxWidth:900 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ fontSize:16, fontWeight:800, color:'#E4261E' }}>VIESSMANN</div>
          <div style={{ fontWeight:700 }}>ViCare — centrala de la sediu</div>
          <span style={{ padding:'2px 9px', borderRadius:12, background:stC + '22', color:stC, fontWeight:700, fontSize:11.5 }}>{st === 'conectat' ? '● conectat' : st === 'eroare' ? '● eroare' : '○ neconectat'}</span>
          <span style={{ fontSize:12, color:G.dim }}>{integ?.conectat_la ? `conectat ${fmtDT(integ.conectat_la)}` : ''}</span>
          <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
            {isOwner && st !== 'conectat' && <button style={S.btnP} disabled={!!busy} onClick={conecteaza}>Conectează ViCare</button>}
            {st === 'conectat' && <button style={S.btnS} disabled={!!busy} onClick={sync}>🔄 Citește acum</button>}
            {isOwner && st === 'conectat' && <button style={{ ...S.btnS, color:G.red }} onClick={deconecteaza}>Deconectează</button>}
            {isOwner && st === 'eroare' && <button style={S.btnP} disabled={!!busy} onClick={conecteaza}>Reconectează</button>}
          </div>
        </div>
        {integ?.eroare && <div style={{ color:G.red, fontSize:12.5, marginTop:8 }}>Eroare: {integ.eroare}</div>}
        <div style={{ fontSize:12, color:G.dim, marginTop:8 }}>Te loghezi o dată la Viessmann cu contul ViCare. Tokenul stă în Vault, nu în browser. Citire automată la 10 minute (cron iot_sync_10min). Doar owner-ul poate conecta sau deconecta.</div>

        {disp.length > 0 && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:12, marginTop:14 }}>
            {disp.map(d => { const v = d.ultima_citire || {}; const err = Array.isArray(v.erori) ? v.erori : []
              return (
                <div key={d.id} style={{ background:G.surface, border:`1px solid ${err.length ? G.red + '88' : G.border}`, borderRadius:9, padding:12 }}>
                  <div style={{ fontWeight:700, marginBottom:4 }}>🔥 {d.nume}</div>
                  <div style={{ fontSize:11.5, color:G.dim, marginBottom:8 }}>citit {fmtDT(d.citit_la)} · {d.meta?.model || ''}</div>
                  <label style={{ fontSize:11.5, color:G.muted, display:'block', marginBottom:8 }}>Locația
                    <select value={d.site_id || ''} onChange={e => setSite(d.id, Number(e.target.value))} style={{ marginLeft:6, background:G.bg, color:G.text, border:`1px solid ${G.border}`, borderRadius:6, padding:'3px 6px', fontSize:12 }}>
                      <option value="">— alege —</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select></label>
                  {err.length > 0 && <div style={{ color:G.red, fontSize:12.5, fontWeight:700, marginBottom:6 }}>⚠ Erori: {err.map(e => e.cod).join(', ')}</div>}
                  <V k="Arzător" v={v.arzator_activ == null ? null : (v.arzator_activ ? 'pornit' : 'oprit')} />
                  <V k="Modulație" v={v.modulatie_pct} um="%" />
                  <V k="Temperatură cazan" v={v.temp_cazan} um="°C" />
                  <V k="Tur" v={v.temp_tur ?? v.temp_tur_circuit0} um="°C" />
                  <V k="Retur" v={v.temp_retur} um="°C" />
                  <V k="Apă caldă (ACM)" v={v.temp_acm} um="°C" />
                  <V k="Temperatură cameră" v={v.temp_camera} um="°C" />
                  <V k="Exterior (senzor centrală)" v={v.temp_exterior} um="°C" />
                  <V k="Presiune" v={v.presiune_bar} um="bar" />
                  <V k="Regim" v={v.regim} />
                  <V k="Gaz încălzire azi" v={v.gaz_incalzire?.azi} um={v.gaz_incalzire?.um || 'm³'} />
                  <V k="Gaz apă caldă azi" v={v.gaz_acm?.azi} um={v.gaz_acm?.um || 'm³'} />
                  <V k="Ore funcționare arzător" v={v.arzator_stat?.ore} um="h" />
                  <V k="Porniri arzător" v={v.arzator_stat?.porniri} />
                </div>
              ) })}
          </div>
        )}
      </div>

      <div style={{ ...S.card, maxWidth:900, marginTop:12, opacity:.7 }}>
        <div style={{ fontWeight:700 }}>SALUS iT600 — termostate sediu</div>
        <div style={{ fontSize:12.5, color:G.muted, marginTop:4 }}>Urmează: citire prin cloud-ul SALUS Sense (neoficial). Are nevoie de user + parolă SALUS în Vault.</div>
      </div>
    </div>
  )
}
