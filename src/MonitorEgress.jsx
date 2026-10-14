// Monitor egress Storage — widget pe home, DOAR owner (docs/MONITOR_EGRESS.md).
// Sursa: RPC egress_statistici (poartă is_owner în BD). Bare principale = contoarele OFICIALE Supabase (Egress necache +
// Cached egress, din supabase_usage_oficial, migrarea 20261030a); jurnalul propriu = rând secundar (limită inferioară).
// Deblocare circuit breaker: egress_deblocheaza.
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
const COTA_PLAN = 250 * GB  // plan Pro: 250 GB pe fiecare contor (fallback dacă BD nu trimite cota)
const procent = (b, cota) => cota ? Math.round(100 * (b || 0) / cota) : 0
const culoarePct = p => p >= 80 ? G.red : p >= 50 ? G.yellow : G.green

// O bară de consum (x / cotă) cu marcajele de alertă 50/80%
function Bara({ eticheta, bytes, cota, alerte, nota }) {
  const p = procent(bytes, cota), col = bytes == null ? G.muted : culoarePct(p)
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...S.row, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13 }}>{eticheta}</span>
        <span style={{ color: col, fontWeight: 700, fontSize: 13 }}>{bytes == null ? '—' : `${fmt(bytes)} / ${fmt(cota)} (${p}%)`}</span>
      </div>
      <div style={{ height: 6, background: '#21262D', borderRadius: 3, marginTop: 4, position: 'relative' }}>
        <div style={{ width: `${Math.min(100, p)}%`, height: '100%', background: col, borderRadius: 3 }} />
        {(alerte || []).map(a => <div key={a} title={`alertă ${a}%`} style={{ position: 'absolute', left: `${a}%`, top: -2, width: 1, height: 10, background: G.muted }} />)}
      </div>
      {nota && <div style={{ ...S.small, marginTop: 3 }}>{nota}</div>}
    </div>
  )
}

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

  const c = d.ciclu || {}, pct = procent(c.bytes, c.cota)
  const of = d.oficial || null  // ultima citire oficială din ciclul curent (null = colectorul n-a scris încă / migrarea 20261030a neaplicată)
  const cotaEgress = c.cota || COTA_PLAN, cotaCached = d.cota_cached || COTA_PLAN
  const pctMax = of ? Math.max(procent(of.egress_bytes, cotaEgress), procent(of.cached_egress_bytes, cotaCached)) : pct
  const zile = d.pe_zi || [], max = Math.max(1, ...zile.map(z => z.bytes))
  const blocate = d.blocate || []
  const citit = of?.citit_la ? new Date(of.citit_la) : null
  const vechimeOre = citit ? (Date.now() - citit.getTime()) / 3600000 : 0

  return (
    <div style={S.card}>
      <div style={{ ...S.row, justifyContent: 'space-between' }}>
        <div style={S.row}>
          <b>📡 Monitor egress</b>
          <span style={{ color: culoarePct(pctMax), fontWeight: 700 }}>{of ? `max ${pctMax}% din cotă` : 'fără citire oficială încă'}</span>
          <span style={S.small}>ciclu din {of?.ciclu_start ? new Date(of.ciclu_start).toLocaleDateString('ro-RO') : c.start ? new Date(c.start).toLocaleDateString('ro-RO') : '—'}</span>
          {blocate.length > 0 && <span style={{ color: G.red, fontWeight: 700 }}>⛔ {blocate.length} obiect(e) blocate</span>}
        </div>
        <button style={S.btn} onClick={() => setDeschis(v => !v)}>{deschis ? 'Ascunde' : 'Detalii'}</button>
      </div>

      {of ? <>
        <Bara eticheta="Egress (oficial)" bytes={of.egress_bytes} cota={cotaEgress} alerte={c.alerte_procent} />
        <Bara eticheta="Cached egress (oficial)" bytes={of.cached_egress_bytes} cota={cotaCached} alerte={c.alerte_procent} />
        <div style={{ ...S.small, marginTop: 6, color: vechimeOre > 26 ? G.yellow : G.muted }}>
          Citit {citit ? citit.toLocaleString('ro-RO') : '—'} · sursa {of.sursa}{vechimeOre > 26 ? ` · ⚠️ citire veche (${Math.round(vechimeOre)} h) — colectorul e oprit?` : ''}
        </div>
      </> : <div style={{ ...S.small, marginTop: 10 }}>Egress / Cached egress (oficial): fără citire oficială încă. Cifrele facturate se văd în Dashboard Supabase → Usage.</div>}

      <div style={{ ...S.row, justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTop: `1px solid ${G.border}` }}>
        <span style={S.small}>Jurnal propriu (descărcări fișiere)</span>
        <span style={{ ...S.small, color: G.text }}>{fmt(c.bytes)} în ciclu</span>
      </div>
      <div style={{ ...S.small, marginTop: 2 }}>Doar descărcările din Storage instrumentate în cod — limită inferioară, nu cifra facturată.</div>
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
