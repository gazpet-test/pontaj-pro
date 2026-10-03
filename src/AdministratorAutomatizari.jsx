// Administrator › ⚙️ Automatizări (03.10.2026, cerere Răzvan). Numai citire, owner-only (RLS pe public.automatizari).
// Lista o ține la zi Claude după fiecare automatizare nouă (CLAUDE.md pct. 7). Fără valori de secrete — doar nume.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'

const G = { bg: '#F1F5F9', surface: '#FFFFFF', border: '#E2E8EF', text: '#263642', muted: '#617282', blue: '#24778B', green: '#38765A', red: '#B74D55', yellow: '#946B20' }
const S = {
  panel: { background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10, padding: 16 },
  button: { background: G.surface, color: G.text, border: `1px solid ${G.border}`, borderRadius: 7, padding: '9px 12px', minHeight: 40, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 },
  small: { color: G.muted, fontSize: 12, lineHeight: 1.6 },
  row: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
}
export const TIPURI_AUTOMATIZARE = {
  rutina_claude: ['🤖', 'Rutine Claude'],
  cron_bd: ['⏱️', 'Cron-uri BD'],
  edge_function: ['⚡', 'Edge functions'],
  trigger_bd: ['🔔', 'Triggere BD'],
  script_pc: ['🖥️', 'Scripturi PC / NAS'],
  webhook: ['🪝', 'Webhook-uri'],
  extern: ['🌐', 'Externe'],
}
export const STARI_AUTOMATIZARE = { activ: ['Activă', G.green], oprit: ['Oprită', G.muted], de_verificat: ['De verificat', G.yellow], retras: ['Retrasă', G.red] }
const FISA = [
  ['citeste_extern', '(a) Conținut extern citit'],
  ['ce_scrie', '(b) Ce poate scrie / face'],
  ['identitate', '(c) Cu ce identitate rulează'],
  ['cine_porneste', '(d) Cine o poate porni'],
  ['confirmare_umana', '(e) Ce cere confirmare umană'],
]
const fmtZi = v => v ? new Date(`${v}T00:00:00`).toLocaleDateString('ro-RO') : null

// Fișă incompletă = lipsește un punct a–e sau e marcat explicit „de verificat”.
export function fisaIncompleta(r) {
  return FISA.some(([k]) => !r?.[k] || /de verificat|necompletat/i.test(r[k]))
}

export function filtreazaAutomatizari(rows, { tip = 'all', stare = 'all', cauta = '' } = {}) {
  const q = cauta.trim().toLowerCase()
  return (rows || []).filter(r => (tip === 'all' || r.tip === tip) && (stare === 'all' || r.stare === stare)
    && (!q || [r.nume, r.ce_face, r.referinta, r.unde, r.responsabil, r.cod].some(v => (v || '').toLowerCase().includes(q))))
}

function Badge({ children, color = G.muted }) {
  return <span style={{ color, background: color + '18', borderRadius: 5, padding: '3px 7px', fontSize: 12, fontWeight: 600 }}>{children}</span>
}

function RandAutomatizare({ r }) {
  const [deschis, setDeschis] = useState(false)
  const [icon, tipLabel] = TIPURI_AUTOMATIZARE[r.tip] || ['•', r.tip]
  const [stareLabel, stareColor] = STARI_AUTOMATIZARE[r.stare] || [r.stare, G.muted]
  const incompleta = fisaIncompleta(r)
  return <article style={{ padding: '14px 16px', borderBottom: `1px solid ${G.border}` }}>
    <div style={{ ...S.row, justifyContent: 'space-between' }}>
      <div style={S.row}><Badge color={G.blue}>{icon} {tipLabel}</Badge><Badge color={stareColor}>{stareLabel}</Badge>{incompleta && <Badge color={G.yellow}>Fișă incompletă</Badge>}</div>
      <span style={S.small}>{r.program || 'program nespecificat'}</span>
    </div>
    <h3 style={{ fontSize: 15, margin: '8px 0 4px' }}>{r.nume}</h3>
    <div style={S.small}>{r.unde}{r.responsabil ? ` · responsabil: ${r.responsabil}` : ''}</div>
    <p style={{ fontSize: 13, lineHeight: 1.6, margin: '6px 0' }}>{r.ce_face}</p>
    <button type="button" style={{ ...S.button, color: G.blue, border: 'none', background: 'transparent', padding: '8px 0' }} aria-expanded={deschis} onClick={() => setDeschis(v => !v)}>{deschis ? 'Închide fișa' : 'Fișa de securitate și detalii'}</button>
    {deschis && <div style={{ marginTop: 8, padding: 12, borderRadius: 7, background: G.bg, fontSize: 13, lineHeight: 1.7 }}>
      {FISA.map(([k, label]) => <p key={k} style={{ margin: '0 0 6px' }}><strong>{label}:</strong> {r[k] || <span style={{ color: G.yellow }}>necompletat</span>}</p>)}
      {r.secrete_nume && <p style={{ margin: '0 0 6px' }}><strong>Secrete (doar nume):</strong> {r.secrete_nume}</p>}
      {r.referinta && <p style={{ ...S.small, margin: '6px 0 0' }}>Referință tehnică: <code>{r.referinta}</code></p>}
      {(r.decis_de || r.decis_la) && <p style={{ ...S.small, margin: 0 }}>Decis: {[r.decis_de, fmtZi(r.decis_la)].filter(Boolean).join(', ')}</p>}
      {r.registru_sectiune && <p style={{ ...S.small, margin: 0 }}>Registru: {r.registru_sectiune}</p>}
      {r.observatii && <p style={{ ...S.small, margin: 0 }}>Observații: {r.observatii}</p>}
      <p style={{ ...S.small, margin: 0 }}>Cod: {r.cod}{r.verificat_la ? ` · verificată la ${fmtZi(r.verificat_la)}` : ''}</p>
    </div>}
  </article>
}

export default function AdministratorAutomatizari({ profile }) {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [mesaj, setMesaj] = useState('')
  const [tip, setTip] = useState('all')
  const [stare, setStare] = useState('all')
  const [cauta, setCauta] = useState('')

  const load = useCallback(async () => {
    setBusy(true); setMesaj('')
    const { data, error } = await supabase.from('automatizari').select('*').order('tip').order('nume')
    if (error) {
      setRows([])
      setMesaj(/automatizari/.test(error.message || '') && /(does not exist|schema cache|not find)/i.test(error.message || '')
        ? 'Registrul automatizărilor nu e încă instalat în baza de date (migrarea 20261010a).'
        : 'Lista nu a putut fi încărcată: ' + (error.message || 'eroare'))
    } else {
      setRows(data || [])
      if (!data?.length) setMesaj('Nicio automatizare vizibilă. Lista e vizibilă doar ownerilor.')
    }
    setBusy(false)
  }, [])
  useEffect(() => { load() }, [load])

  const filtrate = useMemo(() => filtreazaAutomatizari(rows, { tip, stare, cauta }), [rows, tip, stare, cauta])
  const peTip = useMemo(() => Object.fromEntries(Object.keys(TIPURI_AUTOMATIZARE).map(k => [k, rows.filter(r => r.tip === k).length])), [rows])
  const active = rows.filter(r => r.stare === 'activ').length
  const incomplete = rows.filter(fisaIncompleta).length

  if (profile?.is_owner !== true) return <div role="alert" style={{ ...S.panel, color: G.yellow }}>Registrul automatizărilor e vizibil doar ownerilor.</div>

  return <section aria-label="Automatizări">
    <div className="admin-metrics" style={{ marginBottom: 14 }}>
      {[['Automatizări active', active], ['Total în registru', rows.length], ['Fișe incomplete', incomplete]].map(([label, value]) =>
        <div key={label} className="admin-metric" style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10 }}><div style={{ fontSize: 26, fontWeight: 700 }}>{busy ? '—' : value}</div><div className="admin-metric-label" style={S.small}>{label}</div></div>)}
    </div>
    {mesaj && <div role="status" style={{ ...S.panel, color: G.yellow, marginBottom: 14 }}>{mesaj}</div>}
    <div style={{ ...S.row, marginBottom: 12 }}>
      {[['all', 'Toate', rows.length], ...Object.entries(TIPURI_AUTOMATIZARE).map(([k, [ic, l]]) => [k, `${ic} ${l}`, peTip[k]])].filter(([k, , n]) => k === 'all' || n > 0).map(([k, l, n]) =>
        <button key={k} type="button" aria-pressed={tip === k} onClick={() => setTip(k)} style={{ ...S.button, color: tip === k ? G.blue : G.muted, borderColor: tip === k ? G.blue : G.border }}>{l} · {n}</button>)}
    </div>
    <div className="admin-toolbar">
      <div style={S.row}>
        <select aria-label="Filtrează după stare" value={stare} onChange={e => setStare(e.target.value)} style={S.button}><option value="all">Toate stările</option>{Object.entries(STARI_AUTOMATIZARE).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="search" aria-label="Caută" placeholder="Caută (nume, referință, ce face…)" value={cauta} onChange={e => setCauta(e.target.value)} style={{ ...S.button, minWidth: 'min(100%, 260px)', cursor: 'text' }} />
      </div>
      <button type="button" style={S.button} disabled={busy} onClick={load}>{busy ? 'Se încarcă…' : '↻ Reîmprospătează'}</button>
    </div>
    <div style={{ ...S.small, marginBottom: 10 }} aria-live="polite">{filtrate.length} în selecție / {rows.length} în registru</div>
    <div style={{ ...S.panel, padding: 0 }}>
      {filtrate.map(r => <RandAutomatizare key={r.id} r={r} />)}
      {!filtrate.length && !busy && <p style={{ padding: 24, ...S.small }}>Nicio automatizare în selecția curentă.</p>}
    </div>
    <p style={{ ...S.small, marginTop: 14 }}>Lista o ține la zi Claude după fiecare automatizare nouă (regula CLAUDE.md pct. 7). Detaliile complete rămân și în registrul din memoria proiectului. Valorile secretelor nu apar niciodată aici — doar numele lor.</p>
  </section>
}
