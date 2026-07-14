// ConcediuMobilPage — pagină PUBLICĂ (fără cont) pentru cereri de concediu de odihnă.
// Ruta /co?t=TOKEN (token personal din hr_concediu_tokens, distribuit de HR pe WhatsApp).
// Datele + depunerea merg prin edge-ul concediu-mobil (API JSON) — edge-urile Supabase
// nu pot servi HTML pe domeniul supabase.co (gateway-ul forțează text/plain, anti-phishing).
import React, { useEffect, useState, useCallback } from 'react'

const G = {
  bg:'#0D1117', surface:'#161B22', card2:'#21262D', text:'#E6EDF3',
  muted:'#8B949E', border:'#30363D', border2:'#21262D',
  green:'#2EA043', yellow:'#D29922', red:'#F85149', pink:'#F778BA',
}
const EDGE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/concediu-mobil`
const ST = {
  depusa:      ['În așteptare MP', G.yellow],
  aprobata_mp: ['La HR',           G.yellow],
  aprobata:    ['Aprobată',        G.green],
  respinsa:    ['Respinsă',        G.red],
  anulata:     ['Anulată',         G.red],
}
const fmtD = s => s ? new Date(s + 'T12:00').toLocaleDateString('ro-RO') : ''
const card = { background:G.surface, border:`1px solid ${G.border}`, borderRadius:14, padding:18, marginBottom:14 }
const inp = { width:'100%', padding:12, background:G.card2, border:`1px solid ${G.border}`, borderRadius:9, color:G.text, fontSize:16, boxSizing:'border-box' }
const lbl = { display:'block', fontSize:11, fontWeight:700, color:G.muted, textTransform:'uppercase', margin:'12px 0 5px' }
const Pill = ({ color, children }) => (
  <span style={{ display:'inline-block', padding:'3px 10px', borderRadius:6, fontSize:12, fontWeight:700, background:color+'22', color }}>{children}</span>
)

export default function ConcediuMobilPage() {
  const token = new URLSearchParams(window.location.search).get('t') || ''
  const [ctx, setCtx] = useState(null)
  const [err, setErr] = useState(null)
  const [d1, setD1] = useState(''); const [d2, setD2] = useState('')
  const [zile, setZile] = useState(null)
  const [mp, setMp] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)   // { ok, text }

  const load = useCallback(async () => {
    if (!/^[a-f0-9]{32}$/.test(token)) { setErr('Link incomplet sau invalid — cere-l din nou de la HR.'); return }
    try {
      const r = await fetch(`${EDGE}?t=${token}&api=info`)
      if (!r.ok) { setErr('Link invalid sau dezactivat — contactează HR.'); return }
      setCtx(await r.json())
    } catch { setErr('Nu mă pot conecta — verifică internetul și reîncearcă.') }
  }, [token])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    setZile(null)
    if (!d1 || !d2 || d2 < d1) return
    let dead = false
    fetch(`${EDGE}?t=${token}&api=zile&start=${d1}&end=${d2}`)
      .then(r => r.json()).then(j => { if (!dead) setZile(j.zile) }).catch(() => {})
    return () => { dead = true }
  }, [d1, d2, token])

  const submit = async () => {
    setBusy(true); setMsg(null)
    try {
      const body = { token, data_start: d1, data_sfarsit: d2 }
      if (!ctx.aprobatorFix) body.aprobator_profile_id = mp
      const r = await fetch(EDGE, { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (r.ok) {
        setMsg({ ok:true, text:'✅ Cerere depusă! Vei fi anunțat la aprobare.' })
        setD1(''); setD2(''); setZile(null); load()
      } else setMsg({ ok:false, text: j.error || 'Eroare' })
    } catch { setMsg({ ok:false, text:'Eroare de rețea — reîncearcă.' }) }
    finally { setBusy(false) }
  }

  const sold = ctx?.sold?.sold ?? null
  const canGo = zile >= 1 && ctx && (ctx.aprobatorFix || mp) && !busy

  return (
    <div style={{ minHeight:'100vh', background:G.bg, color:G.text, fontFamily:'system-ui, -apple-system, sans-serif', padding:16 }}>
      <div style={card}>
        <div style={{ fontSize:19, fontWeight:800, marginBottom:4 }}>🌴 Cerere concediu de odihnă</div>
        <div style={{ color:G.muted, fontSize:13 }}>
          {err ? <Pill color={G.red}>{err}</Pill>
            : ctx ? `${ctx.employee.name} · ${(ctx.employee.functie || '').trim()}` : 'Se încarcă...'}
        </div>
      </div>

      {ctx && (
        <div style={card}>
          <div style={{ color:G.muted, fontSize:13 }}>
            Sold CO {new Date().getFullYear()}: <b style={{ color: sold !== null && sold < 0 ? G.red : G.green }}>{sold ?? '—'}</b> din {ctx.sold?.drept_zile ?? 21} zile
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <div style={{ flex:1 }}><label style={lbl}>De la</label><input type="date" value={d1} onChange={e=>setD1(e.target.value)} style={inp}/></div>
            <div style={{ flex:1 }}><label style={lbl}>Până la</label><input type="date" value={d2} onChange={e=>setD2(e.target.value)} style={inp}/></div>
          </div>
          {zile !== null && (
            <div style={{ background:G.green+'11', border:`1px solid ${G.green}44`, borderRadius:9, padding:'10px 12px', marginTop:12, fontSize:14 }}>
              📅 <b>{zile} zile lucrătoare</b> (fără weekend și sărbători)
              {sold !== null && zile > sold && <span style={{ color:G.yellow }}> · ⚠️ depășește soldul</span>}
            </div>
          )}
          {ctx.aprobatorFix
            ? <><label style={lbl}>Se aprobă de către</label><input disabled value={ctx.aprobatorFix.nume} style={{ ...inp, opacity:.7 }}/></>
            : <><label style={lbl}>Alege MP-ul</label>
                <select value={mp} onChange={e=>setMp(e.target.value)} style={inp}>
                  <option value="">— alege —</option>
                  {ctx.mpList.map(m => <option key={m.id} value={m.id}>{m.nume}</option>)}
                </select></>}
          <div style={{ color:G.muted, fontSize:12, marginTop:10 }}>Cererea ajunge direct la HR — vei fi anunțat la aprobare.</div>
          <button onClick={submit} disabled={!canGo}
                  style={{ width:'100%', padding:14, background:G.pink, color:G.bg, border:0, borderRadius:10, fontWeight:800, fontSize:16, marginTop:16, opacity: canGo ? 1 : .5 }}>
            {busy ? '⏳ Se trimite...' : '📨 Depune cererea'}
          </button>
          {msg && <div style={{ marginTop:10 }}><Pill color={msg.ok ? G.green : G.red}>{msg.text}</Pill></div>}
        </div>
      )}

      {ctx && ctx.cereri.length > 0 && (
        <div style={card}>
          <b style={{ fontSize:14 }}>Cererile mele</b>
          {ctx.cereri.map(c => {
            const s = ST[c.status] || ST.depusa
            return (
              <div key={c.id} style={{ borderTop:`1px solid ${G.border2}`, padding:'9px 0', fontSize:13, display:'flex', justifyContent:'space-between', gap:8, marginTop:6 }}>
                <span>{fmtD(c.data_start)} → {fmtD(c.data_sfarsit)} · {c.nr_zile_lucratoare}z</span>
                <Pill color={s[1]}>{s[0]}</Pill>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
