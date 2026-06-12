// ════════════════════════════════════════════════════════════════
// Ofertare.jsx — Modulul OFERTARE (v0.5 — documente calitate materiale)
// LIVE: 19.05.2026 placeholder (Etapa 15 Faza 1)
// v0.5: 12.06.2026 — Secțiunea reală „Documente calitate materiale":
//   certificatele/declarațiile de conformitate de pe comenzile furnizor
//   (Achiziții) migrează automat aici, grupate pe proiect — bază pentru
//   propunerile tehnice și dosarele de ofertă viitoare.
// Owner principal: TBD (structură ofertare în formalizare)
// Next (Faza 3): CRUD proiecte ofertare + import materiale Excel + legare șantier la câștig
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', card2:'#1C2128', border:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E', yellow:'#E3B341',
}

export default function OfertarePage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        // Doar documentele de CALITATE (focus materiale) — query-uri separate + merge manual
        const [rDocs, rCmd, rFz, rProj] = await Promise.all([
          supabase.from('comenzi_furnizor_documente').select('*').eq('tip', 'calitate').order('uploadat_la', { ascending: false }),
          supabase.from('comenzi_furnizor').select('id, numar_comanda, furnizor_id, proiect_id'),
          supabase.from('logistica_furnizori').select('id, nume'),
          supabase.from('executie_proiecte').select('id, nume, cod_intern'),
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

  const filtered = useMemo(() => {
    if (!search) return rows
    const s = search.toLowerCase()
    return rows.filter(r => (r.fisier_nume || '').toLowerCase().includes(s)
      || (r._furnizor || '').toLowerCase().includes(s)
      || (r._cmd || '').toLowerCase().includes(s)
      || (r._proiect || '').toLowerCase().includes(s))
  }, [rows, search])

  const grupe = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      const k = r._proiect
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(r)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered])

  return (
    <div style={{ background: G.bg, minHeight: 'calc(100vh - 60px)', color: G.text }}>
      {/* Navbar modul */}
      <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}`, padding: '0 28px', position: 'sticky', top: 60, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52 }}>
          <div style={{ width: 30, height: 30, background: `linear-gradient(135deg,${G.ofertare},#1F6FEB)`, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>📋</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Ofertare</div>
          <div style={{ marginLeft: 8, fontSize: 12, color: G.muted }}>Documente calitate materiale · per proiect</div>
        </div>
      </div>

      <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>
        {/* Header secțiune */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>🏅 Documente calitate materiale</div>
            <div style={{ fontSize: 12, color: G.muted, marginTop: 2 }}>
              Certificatele de pe comenzile furnizor (Achiziții) · {rows.length} {rows.length === 1 ? 'document' : 'documente'} · {grupe.length} proiecte
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Caută document / furnizor / proiect..."
            style={{ padding: '9px 13px', background: G.surface, border: `1px solid ${G.border}`, borderRadius: 8, color: G.text, fontSize: 13, outline: 'none', minWidth: 260 }} />
        </div>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: G.muted }}>Se încarcă...</div>}

        {!loading && !grupe.length && (
          <div style={{ padding: 50, textAlign: 'center', background: G.surface, borderRadius: 12, border: `1px dashed ${G.border}` }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🏅</div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{search ? 'Niciun document pe căutarea curentă.' : 'Niciun document de calitate încă.'}</div>
            <div style={{ fontSize: 12, color: G.muted }}>Certificatele se încarcă pe comenzi în modulul Achiziții (secțiunea 📎) și migrează automat aici.</div>
          </div>
        )}

        {!loading && grupe.map(([proiect, docs]) => (
          <div key={proiect} style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: `1px solid ${G.border}`, background: G.card2 }}>
              <span style={{ fontSize: 16 }}>📂</span>
              <span style={{ fontSize: 14, fontWeight: 800, flex: 1 }}>{proiect}</span>
              <span style={{ background: G.ofertare + '22', color: G.ofertare, border: `1px solid ${G.ofertare}55`, borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 800 }}>
                {docs.length} {docs.length === 1 ? 'document' : 'documente'}
              </span>
            </div>
            {docs.map(d => (
              <div key={d.id} style={{ display: 'grid', gridTemplateColumns: '1fr 150px 150px 110px 80px', gap: 10, alignItems: 'center', padding: '9px 16px', borderBottom: `1px solid ${G.border}`, fontSize: 12.5 }}>
                <button onClick={() => openDoc(d.fisier_path)} title={d.fisier_nume}
                  style={{ background: 'none', border: 'none', color: G.green, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  🏅 {d.fisier_nume || d.fisier_path.split('/').pop()}
                </button>
                <a href={`/achizitii?id=${d._comandaId}`} style={{ color: G.muted, fontSize: 11.5, fontFamily: 'monospace', textDecoration: 'none' }} title="Deschide comanda în Achiziții">🛒 {d._cmd}</a>
                <span style={{ color: G.muted, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🏭 {d._furnizor}</span>
                <span style={{ color: G.dim, fontSize: 11 }}>{d.uploadat_la ? new Date(d.uploadat_la).toLocaleDateString('ro-RO') : '—'}</span>
                <button onClick={() => openDoc(d.fisier_path)} style={{ padding: '4px 10px', background: G.green + '22', border: `1px solid ${G.green}44`, borderRadius: 6, color: G.green, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>👁 Vezi</button>
              </div>
            ))}
          </div>
        ))}

        {/* Roadmap Faza 3 */}
        <div style={{ marginTop: 20, padding: '14px 18px', background: G.card2, borderRadius: 10, border: `1px solid ${G.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: G.ofertare, marginBottom: 8 }}>🔮 În dezvoltare (Faza 3 — owner: TBD)</div>
          <div style={{ fontSize: 11.5, color: G.muted, lineHeight: 1.7 }}>
            CRUD proiecte ofertare (denumire, beneficiar, dată licitație, valoare) · Status flow: în_ofertare → depus → câștigat/pierdut ·
            Upload caiet de sarcini + proiect tehnic · Listă materiale ofertate (manual sau import Excel) · Flag „material mare" pentru cereri ofertă ·
            Proiect câștigat → legare automată șantier · AI Phase 2: generator cerere ofertă (Claude + KB normative)
          </div>
        </div>
      </div>
    </div>
  )
}
