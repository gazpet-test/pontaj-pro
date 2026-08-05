// ════════════════════════════════════════════════════════════════
// CTC.jsx — Modulul CTC - CĂRȚI TEHNICE (v0.5 — arhivă documente)
// LIVE: 19.05.2026 placeholder (Etapa 15 Faza 1)
// v0.5: 12.06.2026 — Arhivă reală per proiect: documentele de calitate
//   + facturile încărcate pe comenzile furnizor (Achiziții) migrează
//   automat aici, grupate pe proiect. Sursa: comenzi_furnizor_documente.
// Owner principal: Apostol Andrut (cont de creat la Faza 5)
// Next (Faza 5 completă): marcare arhivat, search full-text, export Excel
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card2:'#1C2128', border:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ctc:'#BC8CFF', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', red:'#F85149', yellow:'#E3B341',
}

const TIP_DOC = {
  calitate:   { label: 'Calitate',    emoji: '🏅', color: G.green },
  declaratie: { label: 'Declarație',  emoji: '📜', color: G.blue },
  aviz:       { label: 'Aviz',        emoji: '🚚', color: G.orange },
  factura:    { label: 'Factură',     emoji: '🧾', color: G.yellow },
  altele:     { label: 'Alt doc.',    emoji: '📄', color: G.muted },
}

export default function CTCPage() {
  const [rows, setRows] = useState([])        // documente îmbogățite
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtruTip, setFiltruTip] = useState('toate')  // toate | calitate | factura

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        // Query-uri separate + merge manual (fără FK implicit joins)
        const [rDocs, rCmd, rFz, rProj] = await Promise.all([
          supabase.from('comenzi_furnizor_documente').select('*').order('uploadat_la', { ascending: false }),
          supabase.from('comenzi_furnizor').select('id, numar_comanda, furnizor_id, proiect_id, status'),
          supabase.from('logistica_furnizori').select('id, nume'),
          supabase.from('executie_proiecte').select('id, nume, cod_intern, activ'),
        ])
        const cmdMap = Object.fromEntries((rCmd.data || []).map(c => [c.id, c]))
        const fzMap  = Object.fromEntries((rFz.data || []).map(f => [f.id, f.nume]))
        const pjMap  = Object.fromEntries((rProj.data || []).map(p => [p.id, p]))
        setRows((rDocs.data || []).map(d => {
          const cmd = cmdMap[d.comanda_id]
          const pj = cmd?.proiect_id ? pjMap[cmd.proiect_id] : null
          return {
            ...d,
            _cmd: cmd?.numar_comanda || `#${d.comanda_id}`,
            _comandaId: d.comanda_id,
            _furnizor: (cmd?.furnizor_id && fzMap[cmd.furnizor_id]) || '—',
            _proiectId: cmd?.proiect_id || null,
            _proiect: pj ? (pj.cod_intern || pj.nume) : 'Fără proiect',
          }
        }))
      } finally { setLoading(false) }
    })()
  }, [])

  const openDoc = async (path) => {
    const { data } = await supabase.storage.from('comenzi-furnizor').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const downloadDoc = async (path, nume) => {
    const { data } = await supabase.storage.from('comenzi-furnizor').createSignedUrl(path, 120, { download: nume || true })
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const filtered = useMemo(() => {
    let list = rows
    if (filtruTip !== 'toate') list = list.filter(r => r.tip === filtruTip)
    if (search) {
      const s = search.toLowerCase()
      list = list.filter(r => (r.fisier_nume || '').toLowerCase().includes(s)
        || (r._furnizor || '').toLowerCase().includes(s)
        || (r._cmd || '').toLowerCase().includes(s)
        || (r._proiect || '').toLowerCase().includes(s))
    }
    return list
  }, [rows, filtruTip, search])

  // Grupare pe proiect (proiectele cu cele mai multe documente primele)
  const grupe = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      const k = r._proiect
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered])

  const kpi = useMemo(() => ({
    total: rows.length,
    calitate: rows.filter(r => r.tip === 'calitate').length,
    facturi: rows.filter(r => r.tip === 'factura').length,
    proiecteAcoperite: new Set(rows.filter(r => r._proiectId).map(r => r._proiectId)).size,
  }), [rows])

  const Chip = ({ k, label, emoji, count, color }) => (
    <button onClick={() => setFiltruTip(k)} style={{
      padding: '7px 16px', borderRadius: 18, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: filtruTip === k ? color + '22' : 'transparent',
      color: filtruTip === k ? color : G.muted,
      border: `2px solid ${filtruTip === k ? color : G.border}`,
    }}>
      <span style={{ fontSize: 15 }}>{emoji}</span>{label}
      <span style={{ background: filtruTip === k ? color + '33' : G.border, borderRadius: 10, padding: '1px 8px', fontSize: 11 }}>{count}</span>
    </button>
  )

  return (
    <div style={{ background: G.bg, minHeight: 'calc(100vh - 60px)', color: G.text }}>
      {/* Navbar modul */}
      <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}`, padding: '0 28px', position: 'sticky', top: 60, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52 }}>
          <div style={{ width: 30, height: 30, background: `linear-gradient(135deg,${G.ctc},#8957E5)`, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>📑</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>CTC — Cărți Tehnice</div>
          <div style={{ marginLeft: 8, fontSize: 12, color: G.muted }}>Arhivă documente recepție · per proiect</div>
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>
        {/* KPI */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 20 }}>
          {[
            ['📄', 'Documente total', kpi.total, G.ctc],
            ['🏅', 'Documente calitate', kpi.calitate, G.green],
            ['🧾', 'Facturi furnizori', kpi.facturi, G.yellow],
            ['📂', 'Proiecte acoperite', kpi.proiecteAcoperite, G.blue],
          ].map(([em, lbl, val, col]) => (
            <div key={lbl} style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, color: G.muted, fontWeight: 700, marginBottom: 6 }}>{em} {lbl.toUpperCase()}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: col }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Filtre */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <Chip k="toate" label="Toate" emoji="📄" count={rows.length} color={G.ctc} />
          {Object.entries(TIP_DOC).map(([k, t]) => (
            <Chip key={k} k={k} label={t.label} emoji={t.emoji} count={rows.filter(r => r.tip === k).length} color={t.color} />
          ))}
          <div style={{ flex: 1 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Caută document / furnizor / comandă / proiect..."
            style={{ padding: '9px 13px', background: G.surface, border: `1px solid ${G.border}`, borderRadius: 8, color: G.text, fontSize: 13, outline: 'none', minWidth: 280 }} />
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: G.muted }}>Se încarcă...</div>}

        {!loading && !grupe.length && (
          <div style={{ padding: 50, textAlign: 'center', background: G.surface, borderRadius: 12, border: `1px dashed ${G.border}` }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📑</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{search || filtruTip !== 'toate' ? 'Niciun document pe filtrele curente.' : 'Niciun document încă.'}</div>
            <div style={{ fontSize: 12, color: G.muted }}>Documentele se încarcă pe comenzi în modulul Achiziții (secțiunea 📎) și migrează automat aici, grupate pe proiect.</div>
          </div>
        )}

        {/* Grupare pe proiect */}
        {!loading && grupe.map(([proiect, docs]) => (
          <div key={proiect} style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: `1px solid ${G.border}`, background: G.card2 }}>
              <span style={{ fontSize: 16 }}>📂</span>
              <span style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{proiect}</span>
              <span style={{ background: G.ctc + '22', color: G.ctc, border: `1px solid ${G.ctc}55`, borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 800 }}>
                {docs.length} {docs.length === 1 ? 'document' : 'documente'}
              </span>
            </div>
            {docs.map(d => {
              const t = TIP_DOC[d.tip] || TIP_DOC.calitate
              return (
                <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 150px 150px 110px 140px', gap: 10, alignItems: 'center', padding: '9px 16px', borderBottom: `1px solid ${G.border}`, fontSize: 12.5 }}>
                  <span style={{ color: t.color, fontSize: 11, fontWeight: 800 }}>{t.emoji} {t.label}</span>
                  <button onClick={() => openDoc(d.fisier_path)} title={d.fisier_nume}
                    style={{ background: 'none', border: 'none', color: t.color, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.fisier_nume || d.fisier_path.split('/').pop()}
                  </button>
                  <a href={`/achizitii?id=${d._comandaId}`} style={{ color: G.muted, fontSize: 11.5, fontFamily: 'monospace', textDecoration: 'none' }} title="Deschide comanda în Achiziții">🛒 {d._cmd}</a>
                  <span style={{ color: G.muted, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏭 {d._furnizor}</span>
                  <span style={{ color: G.dim, fontSize: 11 }}>{d.uploadat_la ? new Date(d.uploadat_la).toLocaleDateString('ro-RO') : '—'}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openDoc(d.fisier_path)} style={{ padding: '4px 10px', background: t.color + '22', border: `1px solid ${t.color}44`, borderRadius: 6, color: t.color, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>👁 Vezi</button>
                    <button onClick={() => downloadDoc(d.fisier_path, d.fisier_nume)} title="Descarcă" style={{ padding: '4px 10px', background: G.blue + '22', border: `1px solid ${G.blue}44`, borderRadius: 6, color: G.blue, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>⬇</button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}

        {/* Roadmap Faza 5 */}
        <div style={{ marginTop: 20, padding: '14px 18px', background: G.card2, borderRadius: 10, border: `1px solid ${G.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: G.ctc, marginBottom: 8 }}>🔮 În dezvoltare (Faza 5 — owner: Apostol Andrut)</div>
          <div style={{ fontSize: 11.5, color: G.muted, lineHeight: 1.7 }}>
            Marcare „arhivat" cu observații per document · Search full-text (nr. factură, conținut) · Dashboard KPI documente noi/restante ·
            Export Excel per perioadă · Vizualizare PDF inline · PV-uri CTC și neconformități per șantier
          </div>
        </div>
      </div>
    </div>
  )
}
