// ═══════════════════════════════════════════════════════════════════════════
// UnitatiProiectPanel.jsx — axa de raportare a proiectului: tronsoane / obiecte
// / zone. Cantitățile din raportul zilnic (raport_lucrari.unitate_id) se pot
// lega de una din ele, ca să știm nu doar CÂT s-a lucrat, ci și UNDE.
// Faza 5 pas 4. Montat în ProiectEditModal (Executie.jsx), sub activități.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681', blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', purple: '#BC8CFF',
}
const inp = { background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 6, padding: '5px 8px', fontFamily: 'inherit', fontSize: 12.5, outline: 'none' }

const TIPURI = [
  { key: 'tronson', label: 'Tronson', icon: '📏' },
  { key: 'obiect', label: 'Obiect', icon: '🏗' },
  { key: 'zona', label: 'Zonă', icon: '📍' },
  { key: 'altele', label: 'Altele', icon: '•' },
]
const tipInfo = (t) => TIPURI.find(x => x.key === t) || TIPURI[3]

export default function UnitatiProiectPanel({ proiectId, showToast }) {
  const [unitati, setUnitati] = useState([])
  const [folosite, setFolosite] = useState({})   // {unitate_id: nr. raportări}
  const [loading, setLoading] = useState(true)
  const [noua, setNoua] = useState({ tip: 'tronson', cod: '', nume: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const [u, rl] = await Promise.all([
      supabase.from('proiect_unitati').select('*').eq('proiect_id', proiectId).order('ordine').order('id'),
      supabase.from('raport_lucrari').select('unitate_id').eq('proiect_id', proiectId),
    ])
    setUnitati(u.data || [])
    const f = {}
    for (const r of (rl.data || [])) if (r.unitate_id) f[r.unitate_id] = (f[r.unitate_id] || 0) + 1
    setFolosite(f)
    setLoading(false)
  }, [proiectId])
  useEffect(() => { load() }, [load])

  const adauga = async (row) => {
    if (!row.nume.trim()) return
    const { error } = await supabase.from('proiect_unitati').insert({
      proiect_id: proiectId, tip: row.tip, cod: row.cod.trim() || null,
      nume: row.nume.trim(), ordine: unitati.length + 1, activ: true,
    })
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    await load()
  }
  const salveaza = async (id, patch) => {
    const { error } = await supabase.from('proiect_unitati').update(patch).eq('id', id)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    setUnitati(list => list.map(u => u.id === id ? { ...u, ...patch } : u))
  }
  const sterge = async (u) => {
    if (folosite[u.id]) {
      showToast?.(`„${u.nume}" are ${folosite[u.id]} raportări — dezactiveaz-o în loc s-o ștergi`, 'error')
      return
    }
    if (!window.confirm(`Ștergi „${u.nume}"?`)) return
    const { error } = await supabase.from('proiect_unitati').delete().eq('id', u.id)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); return }
    setUnitati(list => list.filter(x => x.id !== u.id))
  }

  const active = useMemo(() => unitati.filter(u => u.activ !== false).length, [unitati])

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 12, color: G.muted, marginBottom: 8 }}>
        {loading ? 'Se încarcă…' : unitati.length
          ? <>{unitati.length} unități ({active} active) — apar ca „unde s-a lucrat" în raportul zilnic</>
          : 'Nicio unitate — adaugă tronsoanele/obiectele proiectului ca să știi UNDE s-a lucrat, nu doar cât.'}
      </div>

      {unitati.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 0.7fr 1.8fr auto auto auto', gap: 6, alignItems: 'center', marginBottom: 4, fontSize: 10.5, color: G.dim, textTransform: 'uppercase', letterSpacing: .4, padding: '0 2px' }}>
          <span>Tip</span><span>Cod</span><span>Denumire</span><span>Raportări</span><span>Activ</span><span></span>
        </div>
      )}
      {unitati.map(u => (
        <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '0.8fr 0.7fr 1.8fr auto auto auto', gap: 6, alignItems: 'center', marginBottom: 5, opacity: u.activ === false ? .5 : 1 }}>
          <select value={u.tip} onChange={e => salveaza(u.id, { tip: e.target.value })} style={{ ...inp, appearance: 'none' }}>
            {TIPURI.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
          </select>
          <input defaultValue={u.cod || ''} placeholder="ex. T2" onBlur={e => e.target.value.trim() !== (u.cod || '') && salveaza(u.id, { cod: e.target.value.trim() || null })} style={{ ...inp, fontFamily: 'monospace' }} />
          <input defaultValue={u.nume} onBlur={e => e.target.value.trim() && e.target.value.trim() !== u.nume && salveaza(u.id, { nume: e.target.value.trim() })} style={inp} />
          <span style={{ fontSize: 11.5, color: folosite[u.id] ? G.green : G.dim, textAlign: 'right', minWidth: 62, whiteSpace: 'nowrap' }}>
            {folosite[u.id] ? `${folosite[u.id]}×` : '—'}
          </span>
          <button onClick={() => salveaza(u.id, { activ: u.activ === false })} title={u.activ === false ? 'Reactivează' : 'Dezactivează (nu mai apare în raport)'}
            style={{ background: 'transparent', border: `1px solid ${G.border2}`, borderRadius: 6, color: u.activ === false ? G.dim : G.green, fontSize: 12, cursor: 'pointer', padding: '3px 8px' }}>
            {u.activ === false ? '○' : '✓'}
          </button>
          <button onClick={() => sterge(u)} title="Șterge" style={{ background: 'transparent', border: 'none', color: G.red, fontSize: 14, cursor: 'pointer' }}>🗑</button>
        </div>
      ))}

      {/* rând adăugare */}
      <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 0.7fr 1.8fr auto', gap: 6, alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: `1px dashed ${G.border2}` }}>
        <select value={noua.tip} onChange={e => setNoua(n => ({ ...n, tip: e.target.value }))} style={{ ...inp, appearance: 'none' }}>
          {TIPURI.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
        </select>
        <input value={noua.cod} onChange={e => setNoua(n => ({ ...n, cod: e.target.value }))} placeholder="cod" style={{ ...inp, fontFamily: 'monospace' }} />
        <input value={noua.nume} onChange={e => setNoua(n => ({ ...n, nume: e.target.value }))} placeholder="ex. Tronson 2 — km 4+500 … 6+200" style={inp}
          onKeyDown={e => { if (e.key === 'Enter' && noua.nume.trim()) { adauga(noua); setNoua({ tip: noua.tip, cod: '', nume: '' }) } }} />
        <button onClick={() => { adauga(noua); setNoua({ tip: noua.tip, cod: '', nume: '' }) }} disabled={!noua.nume.trim()}
          style={{ background: noua.nume.trim() ? G.green + '22' : G.surface2, color: noua.nume.trim() ? G.green : G.dim, border: `1px solid ${G.border2}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: noua.nume.trim() ? 'pointer' : 'default' }}>＋</button>
      </div>
      <div style={{ fontSize: 10.5, color: G.dim, marginTop: 6 }}>
        Unitățile <strong style={{ color: G.muted }}>active</strong> apar în raportul zilnic din /m, la „unde s-a lucrat". Lasă lista goală dacă proiectul nu se împarte pe tronsoane — raportarea merge și fără.
      </div>
    </div>
  )
}
