// ═══════════════════════════════════════════════════════════════════════════
// ActivitatiProiectPanel.jsx — activitățile operaționale de raport per proiect
// (vocabularul MP-ului) + pattern de coduri deviz → cantitate de contract.
// Faza 5 pas 2. Montat în ProiectEditModal sub catalogul de deviz.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681', blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922',
}
const inp = { background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 6, padding: '5px 8px', fontFamily: 'inherit', fontSize: 12.5, outline: 'none' }

// Sugestie standard pentru proiecte de conducte (punct de plecare — se editează)
const STANDARD = [
  { nume: 'Săpat șanț', um: 'm', coduri_deviz: 'TSA,TSC' },
  { nume: 'Astupat / umplutură șanț', um: 'mc', coduri_deviz: 'TSD' },
  { nume: 'Lansat conductă', um: 'm', coduri_deviz: 'GA04,GA05' },
  { nume: 'Sudură / tăiere țeavă', um: 'buc', coduri_deviz: 'RPIC72,GD08' },
  { nume: 'Montaj coturi / reducții', um: 'buc', coduri_deviz: 'TFA' },
  { nume: 'Subtraversare / foraj', um: 'm', coduri_deviz: 'GA09' },
  { nume: 'Probă de presiune', um: 'buc', coduri_deviz: 'GC0,GC03,GC05' },
  { nume: 'Izolare / sablare', um: 'mp', coduri_deviz: 'IZA,IZJ' },
  { nume: 'Sprijiniri mal', um: 'mp', coduri_deviz: 'TSF' },
]

export default function ActivitatiProiectPanel({ proiectId, showToast }) {
  const [acts, setActs] = useState([])
  const [articole, setArticole] = useState([])
  const [realizat, setRealizat] = useState({})   // {activitate_id: suma cantităților din rapoartele zilnice}
  const [loading, setLoading] = useState(true)
  const [noua, setNoua] = useState({ nume: '', um: '', coduri_deviz: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const [a, art, rl] = await Promise.all([
      supabase.from('proiect_activitati').select('*').eq('proiect_id', proiectId).order('ordine').order('id'),
      supabase.from('proiect_articole').select('cod, um, cantitate, sursa').eq('proiect_id', proiectId).neq('sursa', 'extras_materiale'),
      supabase.from('raport_lucrari').select('activitate_id, cantitate').eq('proiect_id', proiectId),
    ])
    setActs(a.data || [])
    setArticole(art.data || [])
    const r = {}
    for (const x of (rl.data || [])) if (x.activitate_id) r[x.activitate_id] = (r[x.activitate_id] || 0) + (Number(x.cantitate) || 0)
    setRealizat(r)
    setLoading(false)
  }, [proiectId])
  useEffect(() => { load() }, [load])

  // cantitatea de contract pt o activitate = suma articolelor al căror cod începe cu unul din prefixe
  const contractPt = useCallback((coduri) => {
    const prefixe = (coduri || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    if (!prefixe.length) return null
    const sel = articole.filter(x => prefixe.some(p => (x.cod || '').toUpperCase().startsWith(p)))
    if (!sel.length) return { q: 0, n: 0 }
    return { q: sel.reduce((s, x) => s + (Number(x.cantitate) || 0), 0), n: sel.length }
  }, [articole])

  const adauga = async (row) => {
    if (!row.nume.trim()) return
    const { error } = await supabase.from('proiect_activitati').insert({
      proiect_id: proiectId, nume: row.nume.trim(), um: row.um.trim() || null,
      coduri_deviz: row.coduri_deviz.trim() || null, ordine: acts.length + 1,
    })
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    await load()
  }
  const salveaza = async (id, patch) => {
    await supabase.from('proiect_activitati').update(patch).eq('id', id)
    setActs(list => list.map(a => a.id === id ? { ...a, ...patch } : a))
  }
  const sterge = async (id) => {
    await supabase.from('proiect_activitati').delete().eq('id', id)
    setActs(list => list.filter(a => a.id !== id))
  }
  const sugereaza = async () => {
    if (acts.length && !window.confirm('Adaug lista standard (conducte) peste cele existente?')) return
    const rows = STANDARD.map((s, i) => ({ proiect_id: proiectId, nume: s.nume, um: s.um, coduri_deviz: s.coduri_deviz, ordine: acts.length + i + 1 }))
    const { error } = await supabase.from('proiect_activitati').insert(rows)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    showToast?.(`✓ ${rows.length} activități adăugate`, 'success')
    await load()
  }

  const totalContract = useMemo(() => acts.map(a => contractPt(a.coduri_deviz)), [acts, contractPt])

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: G.muted }}>{loading ? 'Se încarcă…' : `${acts.length} activități operaționale`}</div>
        <button onClick={sugereaza} style={{ background: G.yellow + '20', color: G.yellow, border: `1px solid ${G.yellow}44`, borderRadius: 7, padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          🪄 Sugerează listă standard (conducte)
        </button>
      </div>

      {acts.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.5fr 1fr auto 1.1fr auto', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 10.5, color: G.dim, textTransform: 'uppercase', letterSpacing: .4, padding: '0 2px' }}>
          <span>Activitate</span><span>UM</span><span>Coduri deviz</span><span>Contract</span><span>Progres (din rapoarte)</span><span></span>
        </div>
      )}
      {acts.map((a, i) => {
        const c = totalContract[i]
        const r = realizat[a.id] || 0
        const pct = c && c.q > 0 ? Math.min(100, r / c.q * 100) : null
        return (
          <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.5fr 1fr auto 1.1fr auto', gap: 6, alignItems: 'center', marginBottom: 5 }}>
            <input defaultValue={a.nume} onBlur={e => e.target.value.trim() !== a.nume && salveaza(a.id, { nume: e.target.value.trim() })} style={inp} />
            <input defaultValue={a.um || ''} onBlur={e => e.target.value.trim() !== (a.um || '') && salveaza(a.id, { um: e.target.value.trim() || null })} style={inp} />
            <input defaultValue={a.coduri_deviz || ''} placeholder="ex. GA04,GA05" onBlur={e => e.target.value.trim() !== (a.coduri_deviz || '') && salveaza(a.id, { coduri_deviz: e.target.value.trim() || null })} style={{ ...inp, fontFamily: 'monospace' }} />
            <span style={{ fontSize: 11.5, color: c ? G.green : G.dim, whiteSpace: 'nowrap', textAlign: 'right', minWidth: 90 }}>
              {c ? `${c.q.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} ${a.um || ''} (${c.n})` : '— maparea'}
            </span>
            <div title={pct != null ? `${r.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} / ${c.q.toLocaleString('ro-RO', { maximumFractionDigits: 1 })} ${a.um || ''}` : (r ? `${r} ${a.um || ''} raportat (fără cantitate de contract)` : 'nimic raportat încă')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <div style={{ flex: 1, height: 8, background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 5, overflow: 'hidden' }}>
                {pct != null && <div style={{ width: pct + '%', height: '100%', background: pct >= 100 ? G.green : G.blue, transition: 'width .3s' }} />}
              </div>
              <span style={{ fontSize: 11, color: r ? (pct >= 100 ? G.green : G.blue) : G.dim, whiteSpace: 'nowrap', minWidth: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {pct != null ? `${pct.toFixed(0)}%` : (r ? r.toLocaleString('ro-RO', { maximumFractionDigits: 1 }) : '—')}
              </span>
            </div>
            <button onClick={() => sterge(a.id)} title="Șterge" style={{ background: 'transparent', border: 'none', color: G.red, fontSize: 14, cursor: 'pointer' }}>🗑</button>
          </div>
        )
      })}

      {/* rând adăugare */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.6fr 1.1fr auto', gap: 6, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${G.border2}` }}>
        <input value={noua.nume} onChange={e => setNoua(n => ({ ...n, nume: e.target.value }))} placeholder="activitate nouă…" style={inp} />
        <input value={noua.um} onChange={e => setNoua(n => ({ ...n, um: e.target.value }))} placeholder="UM" style={inp} />
        <input value={noua.coduri_deviz} onChange={e => setNoua(n => ({ ...n, coduri_deviz: e.target.value }))} placeholder="coduri (opțional)" style={{ ...inp, fontFamily: 'monospace' }} />
        <button onClick={() => { adauga(noua); setNoua({ nume: '', um: '', coduri_deviz: '' }) }} disabled={!noua.nume.trim()} style={{ background: noua.nume.trim() ? G.green + '22' : G.surface2, color: noua.nume.trim() ? G.green : G.dim, border: `1px solid ${G.border2}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: noua.nume.trim() ? 'pointer' : 'default' }}>＋</button>
      </div>
      <div style={{ fontSize: 10.5, color: G.dim, marginTop: 6 }}>
        „Coduri deviz" = prefixele articolelor din catalog (ex. <code>GA04,GA05</code>) → „Contract" arată cantitatea totală de contract pentru progres. Lasă gol dacă activitatea n-are corespondent în deviz.
      </div>
    </div>
  )
}
