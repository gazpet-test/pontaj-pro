// ═══════════════════════════════════════════════════════════════════════════
// MaterialeProiectPanel.jsx — extrasul de materiale (Formular C6) per proiect
// + bifă „deja comandat" (comenzi date înainte de ERP) + legătura cu comenzile
// furnizor din ERP (comenzi_furnizor.proiect_id). Faza 5 — panoul B.
// Montat în ProiectEditModal (Executie.jsx), sub activități.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from './lib/supabase.js'
import { parseExtrasMateriale } from './devizParser.js'

const G = {
  bg: '#0D1117', surface: '#161B22', surface2: '#1C2230', border: '#21262D', border2: '#30363D',
  text: '#E6EDF3', muted: '#8B949E', dim: '#6E7681', blue: '#58A6FF', green: '#3FB950', red: '#F85149', yellow: '#D29922', cyan: '#56D4DD',
}
const fmtLei = (v) => v == null ? '—' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' lei'

export default function MaterialeProiectPanel({ proiectId, showToast }) {
  const [mats, setMats] = useState([])
  const [comenzi, setComenzi] = useState([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [q, setQ] = useState('')
  const [doarNecomandate, setDoarNecomandate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [m, c] = await Promise.all([
      supabase.from('proiect_articole').select('*')
        .eq('proiect_id', proiectId).eq('sursa', 'extras_materiale').order('nr'),
      supabase.from('comenzi_furnizor').select('id, numar_comanda, status, data_emitere')
        .eq('proiect_id', proiectId).order('data_emitere', { ascending: false }),
    ])
    setMats(m.data || [])
    setComenzi(c.data || [])
    setLoading(false)
  }, [proiectId])
  useEffect(() => { load() }, [load])

  const onImport = async (file) => {
    if (!file) return
    setImporting(true)
    try {
      const arts = await parseExtrasMateriale(file)
      if (!arts.length) { showToast?.('Nu am găsit materiale (verifică foaia „materiale" din C6).', 'error'); return }
      const val = arts.reduce((s, a) => s + (a.valoare || 0), 0)
      if (!window.confirm(`${arts.length} materiale (${fmtLei(val)}).\n\nÎnlocuiesc extrasul de materiale? (bifele „deja comandat" se pierd)`)) return
      await supabase.from('proiect_articole').delete().eq('proiect_id', proiectId).eq('sursa', 'extras_materiale')
      const rows = arts.map(a => ({ ...a, proiect_id: proiectId, sursa: 'extras_materiale', act_nr: null }))
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('proiect_articole').insert(rows.slice(i, i + 200))
        if (error) throw error
      }
      showToast?.(`✓ ${rows.length} materiale importate`, 'success')
      await load()
    } catch (e) { showToast?.('Eroare import: ' + (e?.message || e), 'error') } finally { setImporting(false) }
  }

  const toggleComandat = async (m) => {
    const v = !m.deja_comandat
    setMats(list => list.map(x => x.id === m.id ? { ...x, deja_comandat: v } : x))
    const { error } = await supabase.from('proiect_articole').update({ deja_comandat: v }).eq('id', m.id)
    if (error) { showToast?.('Eroare: ' + error.message, 'error'); await load() }
  }

  const vizibile = useMemo(() => {
    const qq = q.trim().toLowerCase()
    return mats.filter(m =>
      (!qq || (m.denumire || '').toLowerCase().includes(qq) || (m.cod || '').includes(qq) || (m.furnizor || '').toLowerCase().includes(qq))
      && (!doarNecomandate || !m.deja_comandat))
  }, [mats, q, doarNecomandate])

  const sum = useMemo(() => ({
    val: mats.reduce((s, m) => s + (m.valoare || 0), 0),
    bifate: mats.filter(m => m.deja_comandat).length,
    valRamas: mats.filter(m => !m.deja_comandat).reduce((s, m) => s + (m.valoare || 0), 0),
  }), [mats])

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 12.5, color: G.muted, flex: 1, minWidth: 220 }}>
          {loading ? 'Se încarcă…' : mats.length
            ? <>Extras: <strong style={{ color: G.text }}>{mats.length}</strong> materiale · <strong style={{ color: G.cyan }}>{fmtLei(sum.val)}</strong> · bifate „deja comandat": <strong style={{ color: G.green }}>{sum.bifate}</strong> · rămas de acoperit: <strong style={{ color: G.yellow }}>{fmtLei(sum.valRamas)}</strong></>
            : 'Niciun material — importă extrasul C6 (foaia „materiale").'}
        </div>
        <label style={{ background: importing ? G.surface2 : G.cyan + '20', color: importing ? G.dim : G.cyan, border: `1px solid ${G.cyan}44`, borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: importing ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}>
          {importing ? '⏳…' : '📦 Import extras C6'}
          <input type="file" accept=".xls,.xlsx" disabled={importing} style={{ display: 'none' }} onChange={e => { onImport(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      </div>

      {comenzi.length > 0 && (
        <div style={{ fontSize: 11.5, color: G.muted, background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 8, padding: '7px 11px', marginBottom: 8 }}>
          🛒 Comenzi furnizor pe proiect (ERP): {comenzi.map(c => `${c.numar_comanda || '#' + c.id} (${c.status || '—'})`).join(' · ')}
          <span style={{ color: G.dim }}> — vezi modulul Achiziții pentru detalii</span>
        </div>
      )}

      {mats.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="caută material / cod / furnizor…"
            style={{ background: G.bg, border: `1px solid ${G.border2}`, color: G.text, borderRadius: 6, padding: '5px 9px', fontSize: 12, outline: 'none', flex: 1, maxWidth: 300 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: G.muted, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={doarNecomandate} onChange={e => setDoarNecomandate(e.target.checked)} />
            doar necomandate
          </label>
        </div>
      )}

      {vizibile.length > 0 && (
        <div style={{ background: G.bg, border: `1px solid ${G.border2}`, borderRadius: 8, maxHeight: 340, overflowY: 'auto' }}>
          {vizibile.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 11px', borderBottom: `1px solid ${G.border}`, fontSize: 12, opacity: m.deja_comandat ? .55 : 1 }}>
              <input type="checkbox" checked={!!m.deja_comandat} onChange={() => toggleComandat(m)}
                title="Deja comandat (înainte de ERP sau în afara sistemului)" style={{ cursor: 'pointer', flexShrink: 0, position: 'relative', top: 2 }} />
              <span style={{ color: G.dim, fontFamily: 'monospace', flexShrink: 0, width: 62 }}>{m.cod || '—'}</span>
              <span style={{ color: G.text, flex: 1, minWidth: 0, textDecoration: m.deja_comandat ? 'line-through' : 'none' }}>{m.denumire}</span>
              {m.furnizor && <span style={{ color: G.dim, fontSize: 11, flexShrink: 0 }}>{m.furnizor}</span>}
              <span style={{ color: G.blue, whiteSpace: 'nowrap', flexShrink: 0 }}>{Number(m.cantitate).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} {m.um}</span>
              <span style={{ color: G.muted, whiteSpace: 'nowrap', flexShrink: 0, minWidth: 74, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtLei(m.valoare)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10.5, color: G.dim, marginTop: 6 }}>
        Bifa „deja comandat" = comandă dată înainte de ERP / în afara sistemului. Comenzile noi se dau din Achiziții (comanda ia automat proiectul) — lista de aici e necesarul din ofertă (C6).
      </div>
    </div>
  )
}
