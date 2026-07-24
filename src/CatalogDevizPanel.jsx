// ═══════════════════════════════════════════════════════════════════════════
// CatalogDevizPanel.jsx — catalogul de contract (proiect_articole) per proiect
// + import deviz (F3 antemăsurătoare) din .docx/.xls prin devizParser.
// Montat în ProiectEditModal (Executie.jsx). Faza 5 — pasul „import + catalog".
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { parseDeviz } from './devizParser.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681', blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922',
}
const fmtLei = (v) => v == null ? '—' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' lei'

export default function CatalogDevizPanel({ proiectId, showToast }) {
  const [articole, setArticole] = useState([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [openOb, setOpenOb] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('proiect_articole').select('*')
      .eq('proiect_id', proiectId).order('obiect_cod').order('deviz_cod').order('nr')
    setArticole(data || [])
    setLoading(false)
  }, [proiectId])
  useEffect(() => { load() }, [load])

  const onFile = async (file) => {
    if (!file) return
    setImporting(true)
    try {
      const arts = await parseDeviz(file)
      if (!arts.length) { showToast?.('Nu am găsit articole în fișier (verifică formatul F3).', 'error'); return }
      const val = arts.reduce((s, a) => s + (a.valoare || 0), 0)
      if (!window.confirm(`Am găsit ${arts.length} articole (${fmtLei(val)}).\n\nÎnlocuiesc catalogul existent al proiectului cu acestea?`)) return
      await supabase.from('proiect_articole').delete().eq('proiect_id', proiectId)
      const rows = arts.map(a => ({
        proiect_id: proiectId, obiect_cod: a.obiect_cod, obiect_nume: a.obiect_nume,
        deviz_cod: a.deviz_cod, deviz_nume: a.deviz_nume, nr: a.nr, cod: a.cod,
        denumire: a.denumire, um: a.um, cantitate: a.cantitate, valoare: a.valoare,
      }))
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('proiect_articole').insert(rows.slice(i, i + 200))
        if (error) throw error
      }
      showToast?.(`✓ ${rows.length} articole importate în catalog`, 'success')
      await load()
    } catch (e) {
      showToast?.('Eroare import deviz: ' + (e?.message || e), 'error')
    } finally { setImporting(false) }
  }

  const grupe = useMemo(() => {
    const m = new Map()
    for (const a of articole) {
      const k = a.obiect_nume || a.obiect_cod || '—'
      if (!m.has(k)) m.set(k, { nume: k, cod: a.obiect_cod, n: 0, val: 0, items: [] })
      const g = m.get(k); g.n++; g.val += (a.valoare || 0); g.items.push(a)
    }
    return [...m.values()]
  }, [articole])

  const totalVal = useMemo(() => articole.reduce((s, a) => s + (a.valoare || 0), 0), [articole])

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: G.muted }}>
          {loading ? 'Se încarcă…' : articole.length
            ? <>Catalog: <strong style={{ color: G.text }}>{articole.length}</strong> articole · <strong style={{ color: G.green }}>{fmtLei(totalVal)}</strong></>
            : 'Niciun articol încă — importă devizul (F3).'}
        </div>
        <label style={{
          background: importing ? G.surface2 : G.blue + '20', color: importing ? G.dim : G.blue,
          border: `1px solid ${G.blue}44`, borderRadius: 8, padding: '7px 13px', fontSize: 13, fontWeight: 700,
          cursor: importing ? 'wait' : 'pointer',
        }}>
          {importing ? '⏳ Se importă…' : '📥 Importă deviz (F3 .docx/.xls)'}
          <input type="file" accept=".docx,.xls,.xlsx" disabled={importing} style={{ display: 'none' }}
            onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>

      {grupe.map((g, i) => (
        <div key={i} style={{ background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}>
          <div onClick={() => setOpenOb(openOb === g.nume ? null : g.nume)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 12px', cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: G.text }}>{openOb === g.nume ? '▾' : '▸'} {g.nume}</span>
            <span style={{ fontSize: 12, color: G.muted, whiteSpace: 'nowrap' }}>{g.n} art · {fmtLei(g.val)}</span>
          </div>
          {openOb === g.nume && (
            <div style={{ borderTop: `1px solid ${G.border2}`, maxHeight: 320, overflowY: 'auto' }}>
              {g.items.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 8, padding: '5px 12px', borderBottom: `1px solid ${G.border}`, fontSize: 12 }}>
                  <span style={{ color: G.dim, fontFamily: 'monospace', flexShrink: 0, width: 74 }}>{a.cod}</span>
                  <span style={{ color: G.text, flex: 1, minWidth: 0 }}>{a.denumire}</span>
                  <span style={{ color: G.blue, whiteSpace: 'nowrap', flexShrink: 0 }}>{a.cantitate} {a.um}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
