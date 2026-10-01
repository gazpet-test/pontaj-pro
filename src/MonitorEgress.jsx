// Monitor egress Storage — widget pe home, DOAR owner (docs/MONITOR_EGRESS.md).
// Sursa: jurnalul propriu (RPC egress_statistici, poartă is_owner în BD). Deblocare circuit breaker: egress_deblocheaza.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'

const G = { bg: '#161B22', border: '#30363D', text: '#E6EDF3', muted: '#8B949E', blue: '#58A6FF', green: '#3FB950', yellow: '#D29922', red: '#F85149' }
const S = {
  card: { background: G.bg, border: `1px solid ${G.border}`, borderRadius: 10, padding: 16, margin: '0 16px 16px', color: G.text },
  small: { fontSize: 12, color: G.muted },
  btn: { background: 'transparent', border: `1px solid ${G.border}`, color: G.text, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
}
const GB = 1073741824
const fmt = b => b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round((b || 0) / 1048576)} MB`
const scurt = o => { const p = String(o || '').split('/'); return p.length > 2 ? `${p[0]}/…/${p[p.length - 1]}` : o }

export default function MonitorEgress({ profile }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [deschis, setDeschis] = useState(false)

  const incarca = useCallback(async () => {
    const { data, error } = await supabase.rpc('egress_statistici', { p_zile: 30 })
    if (error) setErr(error.message); else { setErr(null); setD(data) }
  }, [])
  useEffect(() => { if (profile?.is_owner === true) incarca() }, [profile?.is_owner, incarca])
  if (profile?.is_owner !== true) return null

  const deblocheaza = async (b) => {
    if (!window.confirm(`Deblochezi descărcările automate pentru:\n${b.bucket}/${b.obiect}?\n\nVerifică întâi că bucla care l-a descărcat e oprită.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('egress_deblocheaza', { p_bucket: b.bucket, p_obiect: b.obiect })
    setBusy(false)
    if (error) setErr(error.message); else incarca()
  }

  if (err && !d) return <div style={S.card}><b>📡 Monitor egress</b> <span style={{ ...S.small, color: G.yellow }}>— indisponibil ({err}). Migrarea 20260930e nu e aplicată?</span></div>
  if (!d) return null

  const c = d.ciclu || {}, pct = c.cota ? Math.round(100 * c.bytes / c.cota) : 0
  const culoare = pct >= 80 ? G.red : pct >= 50 ? G.yellow : G.green
  const zile = d.pe_zi || [], max = Math.max(1, ...zile.map(z => z.bytes))
  const blocate = d.blocate || []

  return (
    <div style={S.card}>
      <div style={{ ...S.row, justifyContent: 'space-between' }}>
        <div style={S.row}>
          <b>📡 Monitor egress Storage</b>
          <span style={{ color: culoare, fontWeight: 700 }}>{fmt(c.bytes)} / {fmt(c.cota)} ({pct}%)</span>
          <span style={S.small}>ciclu din {c.start ? new Date(c.start).toLocaleDateString('ro-RO') : '—'} · jurnal propriu</span>
          {blocate.length > 0 && <span style={{ color: G.red, fontWeight: 700 }}>⛔ {blocate.length} obiect(e) blocate</span>}
        </div>
        <button style={S.btn} onClick={() => setDeschis(v => !v)}>{deschis ? 'Ascunde' : 'Detalii'}</button>
      </div>
      <div style={{ height: 6, background: '#21262D', borderRadius: 3, marginTop: 10, position: 'relative' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: culoare, borderRadius: 3 }} />
        {(c.alerte_procent || []).map(p => <div key={p} title={`alertă ${p}%`} style={{ position: 'absolute', left: `${p}%`, top: -2, width: 1, height: 10, background: G.muted }} />)}
      </div>
      {err && <div style={{ ...S.small, color: G.red, marginTop: 6 }}>{err}</div>}

      {blocate.map(b => (
        <div key={b.bucket + b.obiect} style={{ ...S.row, marginTop: 10, padding: 8, border: `1px solid ${G.red}55`, borderRadius: 6 }}>
          <span style={{ flex: 1, minWidth: 200, wordBreak: 'break-all' }}>⛔ {b.bucket}/{b.obiect}<br /><span style={S.small}>{b.motiv} · {new Date(b.blocat_la).toLocaleString('ro-RO')}</span></span>
          <button style={{ ...S.btn, borderColor: G.red }} disabled={busy} onClick={() => deblocheaza(b)}>Deblochează</button>
        </div>
      ))}

      {deschis && <>
        <div style={{ ...S.small, marginTop: 14 }}>Trafic pe zi (UTC), ultimele 30 de zile — max {fmt(max)}</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, marginTop: 6 }}>
          {zile.map(z => <div key={z.zi} title={`${z.zi}: ${fmt(z.bytes)} · ${z.n} descărcări`}
            style={{ flex: 1, minWidth: 2, height: `${Math.max(z.bytes ? 3 : 1, 100 * z.bytes / max)}%`, background: z.bytes > (d.config?.prag_zilnic_bytes || Infinity) ? G.red : G.blue, borderRadius: 2, opacity: z.bytes ? 1 : .3 }} />)}
        </div>
        <div style={{ ...S.small, marginTop: 14, marginBottom: 4 }}>Top obiecte (30 zile)</div>
        {(d.top_obiecte || []).length === 0 && <div style={S.small}>Nicio descărcare înregistrată.</div>}
        {(d.top_obiecte || []).map(t => (
          <div key={t.bucket + t.obiect} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: `1px solid ${G.border}` }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${t.bucket}/${t.obiect}`}>{t.blocat ? '⛔ ' : ''}{scurt(t.obiect)}{t.doc_id ? ` · doc ${t.doc_id}` : ''}</span>
            <span style={{ color: G.muted }}>{t.n}×</span>
            <span style={{ width: 70, textAlign: 'right' }}>{fmt(t.bytes)}</span>
          </div>
        ))}
        <div style={{ ...S.small, marginTop: 8 }}>Praguri: {d.config?.prag_obiect_ora} descărcări/oră pe obiect → blocare{d.config?.blocare_activa ? '' : ' (dezactivată)'} · {fmt(d.config?.prag_zilnic_bytes)}/zi → alertă. Jurnalul acoperă doar descărcările instrumentate (vezi docs/MONITOR_EGRESS.md).</div>
      </>}
    </div>
  )
}
