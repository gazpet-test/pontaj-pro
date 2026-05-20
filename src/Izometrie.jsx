// ===========================================================================
// MODUL IZOMETRIE — Pachete lansare țeavă · Tronsoane · Cumulat final
// ===========================================================================
// 20.05.2026 — FAZA 1 LIVE:
//   • Listare proiecte execuție (selectabile via dropdown header)
//   • Sidebar cu 11 tronsoane T1-T11 + KPI mini (pachete + lungime)
//   • Main: listă pachete pe tronson + creare pachet nou manual
//   • Modal detalii pachet cu listare țevi read-only
//   • Placeholder pentru bulk import Excel + editor inline (Faza 2)
// Stack: 8 tabele BD în public.executie_* + RLS permissive + 13 triggere
// ===========================================================================

import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase.js'

// Theme — paletă G consistentă cu Logistica/HR/Admin
const G = {
  bg:'#0D1117', surface:'#161B22', card:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', orange:'#F0883E', red:'#F85149',
  purple:'#A371F7', // accent modul Izometrie
  purpleDim:'#1F1530', greenDim:'#0F2A1E', redDim:'#3F1A1F', yellowDim:'#332100',
}

const S = {
  page: { padding:'24px 28px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.card, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP: { padding:'9px 16px', background:G.purple, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  btnS: { padding:'9px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500 },
  badge: { display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600 },
}

// ===========================================================================
// HELPERS
// ===========================================================================

const fmtKm = (m) => {
  if (m == null) return '—'
  const km = Math.floor(m / 1000)
  const rest = m % 1000
  return `${km}+${String(rest).padStart(3,'0')}`
}

const fmtLungime = (m) => m == null ? '—' : `${Number(m).toFixed(2)} m`

const fmtDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
}

// Toast minimal (consistent cu Logistica/HR)
function useToast() {
  const [toast, setToast] = useState(null)
  const show = (msg, kind='info') => {
    setToast({ msg, kind })
    setTimeout(() => setToast(null), 3500)
  }
  return { toast, show }
}

function Toast({ toast }) {
  if (!toast) return null
  const colors = { info: G.blue, success: G.green, error: G.red, warn: G.yellow }
  const c = colors[toast.kind] || G.blue
  return (
    <div style={{
      position:'fixed', bottom:24, right:24, padding:'12px 18px',
      background:G.card, border:`1px solid ${c}`, borderRadius:10,
      color:G.text, fontSize:13, fontWeight:500, zIndex:9999,
      boxShadow:`0 8px 24px ${c}33`,
    }}>
      {toast.msg}
    </div>
  )
}

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================

export default function IzometriePage() {
  const [proiecte, setProiecte] = useState([])
  const [proiectId, setProiectId] = useState(null)
  const [tronsoane, setTronsoane] = useState([])
  const [tronsonId, setTronsonId] = useState(null)
  const [pachete, setPachete] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNoPachet, setShowNoPachet] = useState(false)
  const [detailPachet, setDetailPachet] = useState(null)
  const { toast, show } = useToast()

  // Stats per tronson
  const [statsTronsoane, setStatsTronsoane] = useState({}) // { tronson_id: { nr_pachete, total_m } }

  useEffect(() => { loadProiecte() }, [])
  useEffect(() => { if (proiectId) loadTronsoane() }, [proiectId])
  useEffect(() => { if (tronsonId) loadPachete() }, [tronsonId])
  useEffect(() => { if (proiectId) loadStatsTronsoane() }, [proiectId, pachete.length])

  async function loadProiecte() {
    setLoading(true)
    const { data, error } = await supabase
      .from('executie_proiecte').select('*')
      .eq('activ', true).order('created_at')
    if (error) { show('Eroare load proiecte: ' + error.message, 'error'); setLoading(false); return }
    setProiecte(data || [])
    if (data?.length && !proiectId) setProiectId(data[0].id)
    setLoading(false)
  }

  async function loadTronsoane() {
    const { data, error } = await supabase
      .from('executie_tronsoane').select('*')
      .eq('proiect_id', proiectId).order('cod')
    if (error) { show('Eroare load tronsoane: ' + error.message, 'error'); return }
    setTronsoane(data || [])
    if (data?.length && !tronsonId) setTronsonId(data[0].id)
  }

  async function loadPachete() {
    const { data, error } = await supabase
      .from('executie_pachete_lansare').select('*')
      .eq('tronson_id', tronsonId)
      .order('numar_document', { ascending: false })
    if (error) { show('Eroare load pachete: ' + error.message, 'error'); return }
    setPachete(data || [])
  }

  async function loadStatsTronsoane() {
    if (!proiectId) return
    const { data, error } = await supabase
      .from('executie_pachete_lansare')
      .select('tronson_id, total_lungime_m')
      .eq('proiect_id', proiectId)
    if (error) return
    const stats = {}
    for (const p of (data || [])) {
      if (!stats[p.tronson_id]) stats[p.tronson_id] = { nr_pachete: 0, total_m: 0 }
      stats[p.tronson_id].nr_pachete += 1
      stats[p.tronson_id].total_m += Number(p.total_lungime_m || 0)
    }
    setStatsTronsoane(stats)
  }

  const proiectSelectat = useMemo(() => proiecte.find(p => p.id === proiectId), [proiecte, proiectId])
  const tronsonSelectat = useMemo(() => tronsoane.find(t => t.id === tronsonId), [tronsoane, tronsonId])

  if (loading) {
    return (
      <div style={S.page}>
        <div style={{ color: G.muted, fontSize: 14 }}>Se încarcă...</div>
      </div>
    )
  }

  if (!proiecte.length) {
    return (
      <div style={S.page}>
        <div style={{...S.card, padding:'40px', textAlign:'center'}}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📐</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Niciun proiect de execuție</div>
          <div style={{ color: G.muted, fontSize: 14 }}>
            Creează primul proiect din BD (Supabase Dashboard) și revino aici.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={S.page}>
      <Toast toast={toast} />

      {/* ─────────── HEADER ─────────── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 20, flexWrap:'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing:'-.3px', marginBottom: 4 }}>
            📐 Izometrie · Pachete Lansare Țeavă
          </div>
          <div style={{ color: G.muted, fontSize: 13 }}>
            {proiectSelectat?.nume || 'Selectează proiect'}
          </div>
        </div>
        <select
          value={proiectId || ''}
          onChange={e => { setProiectId(Number(e.target.value)); setTronsonId(null) }}
          style={{ ...S.input, width: 280, fontWeight: 600, cursor:'pointer' }}
        >
          {proiecte.map(p => (
            <option key={p.id} value={p.id}>{p.cod_intern} — {p.beneficiar}</option>
          ))}
        </select>
      </div>

      {/* ─────────── LAYOUT 2 COLOANE ─────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'280px 1fr', gap: 16, alignItems:'start' }}>
        
        {/* SIDEBAR TRONSOANE */}
        <div style={{...S.card, padding: 14}}>
          <div style={{ fontSize: 12, fontWeight: 700, color: G.muted, textTransform:'uppercase', letterSpacing:'.5px', marginBottom: 12 }}>
            Tronsoane ({tronsoane.length})
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap: 6 }}>
            {tronsoane.map(t => {
              const stats = statsTronsoane[t.id] || { nr_pachete: 0, total_m: 0 }
              const isActive = tronsonId === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTronsonId(t.id)}
                  style={{
                    background: isActive ? G.purpleDim : G.surface,
                    border: `1px solid ${isActive ? G.purple : G.border2}`,
                    borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                    textAlign:'left', color: G.text, transition:'all .15s ease',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = G.border }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = G.border2 }}
                >
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: isActive ? G.purple : G.text }}>
                      {t.cod}
                    </span>
                    <span style={{
                      ...S.badge,
                      background: stats.nr_pachete > 0 ? G.purple+'22' : G.border2,
                      color: stats.nr_pachete > 0 ? G.purple : G.muted,
                    }}>
                      {stats.nr_pachete} pachete
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: G.muted, marginTop: 4 }}>
                    {t.km_start_m != null && t.km_end_m != null ? (
                      <>{fmtKm(t.km_start_m)} → {fmtKm(t.km_end_m)}</>
                    ) : t.km_start_m != null ? (
                      <>de la {fmtKm(t.km_start_m)}</>
                    ) : (
                      <span style={{ fontStyle:'italic' }}>km TBD</span>
                    )}
                    {stats.total_m > 0 && <> · {stats.total_m.toFixed(0)}m lansați</>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* MAIN — PACHETE */}
        <div style={{ display:'flex', flexDirection:'column', gap: 12 }}>
          {tronsonSelectat && (
            <>
              {/* Header tronson + acțiuni */}
              <div style={{...S.card, padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap: 12}}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                    Tronson <span style={{ color: G.purple }}>{tronsonSelectat.cod}</span>
                  </div>
                  <div style={{ fontSize: 12, color: G.muted }}>
                    {pachete.length} pachete lansare ·{' '}
                    {pachete.reduce((s,p) => s + Number(p.total_lungime_m || 0), 0).toFixed(2)} m total lansat ·{' '}
                    {pachete.reduce((s,p) => s + (p.nr_pending_sant || 0), 0)} suduri pending șanț
                  </div>
                  {tronsonSelectat.observatii && (
                    <div style={{ fontSize: 11, color: G.muted, marginTop: 6, fontStyle:'italic' }}>
                      ℹ {tronsonSelectat.observatii}
                    </div>
                  )}
                </div>
                <div style={{ display:'flex', gap: 8 }}>
                  <button style={S.btnP} onClick={() => setShowNoPachet(true)}>+ Pachet nou</button>
                  <button
                    style={{ ...S.btnS, opacity: 0.5, cursor:'not-allowed' }}
                    title="Disponibil în Faza 2"
                    disabled
                  >
                    📥 Import Excel
                  </button>
                </div>
              </div>

              {/* Listă pachete */}
              {pachete.length === 0 ? (
                <div style={{...S.card, padding:'40px', textAlign:'center'}}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                    Niciun pachet pe tronson {tronsonSelectat.cod}
                  </div>
                  <div style={{ color: G.muted, fontSize: 13, marginBottom: 16 }}>
                    Creează primul pachet manual sau importă dintr-un Excel.
                  </div>
                  <button style={S.btnP} onClick={() => setShowNoPachet(true)}>
                    + Pachet nou pe {tronsonSelectat.cod}
                  </button>
                </div>
              ) : (
                <div style={{...S.card, overflow:'hidden'}}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: G.surface, borderBottom: `1px solid ${G.border}` }}>
                        <th style={thStyle}>Cod document</th>
                        <th style={thStyle}>Rev.</th>
                        <th style={thStyle}>km start</th>
                        <th style={thStyle}>Lansare</th>
                        <th style={{...thStyle, textAlign:'right'}}>Țevi</th>
                        <th style={{...thStyle, textAlign:'right'}}>Lungime</th>
                        <th style={{...thStyle, textAlign:'right'}}>Pending șanț</th>
                        <th style={thStyle}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pachete.map(p => (
                        <tr
                          key={p.id}
                          onClick={() => setDetailPachet(p)}
                          style={{ borderBottom: `1px solid ${G.border2}`, cursor:'pointer', transition:'background .15s' }}
                          onMouseEnter={e => e.currentTarget.style.background = G.surface}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <td style={tdStyle}>
                            <span style={{ fontFamily:'monospace', fontSize: 12, color: G.purple, fontWeight: 600 }}>
                              {p.cod_document_full}
                            </span>
                          </td>
                          <td style={tdStyle}>
                            {p.revizie > 0 ? (
                              <span style={{...S.badge, background: G.yellow+'22', color: G.yellow}}>rev.{p.revizie}</span>
                            ) : (
                              <span style={{ color: G.muted, fontSize: 11 }}>—</span>
                            )}
                          </td>
                          <td style={tdStyle}>{fmtKm(p.km_start_m)}</td>
                          <td style={tdStyle}>{fmtDate(p.data_lansare)}</td>
                          <td style={{...tdStyle, textAlign:'right', fontWeight: 600}}>{p.nr_tevi}</td>
                          <td style={{...tdStyle, textAlign:'right'}}>{fmtLungime(p.total_lungime_m)}</td>
                          <td style={{...tdStyle, textAlign:'right'}}>
                            {p.nr_pending_sant > 0 ? (
                              <span style={{...S.badge, background: G.orange+'22', color: G.orange}}>
                                {p.nr_pending_sant}
                              </span>
                            ) : (
                              <span style={{ color: G.muted, fontSize: 11 }}>0</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            {p.respins_la ? (
                              <span style={{...S.badge, background: G.red+'22', color: G.red}}>Respins</span>
                            ) : (
                              <span style={{...S.badge, background: G.green+'22', color: G.green}}>Activ</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {!tronsonSelectat && (
            <div style={{...S.card, padding:'40px', textAlign:'center'}}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>👈</div>
              <div style={{ color: G.muted, fontSize: 14 }}>Selectează un tronson din stânga</div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL: Pachet nou */}
      {showNoPachet && tronsonSelectat && (
        <NoPachetModal
          tronson={tronsonSelectat}
          proiectId={proiectId}
          onClose={() => setShowNoPachet(false)}
          onSuccess={(pachet) => {
            setShowNoPachet(false)
            show(`Pachet ${pachet.cod_document_full} creat ✓`, 'success')
            loadPachete()
          }}
          onError={(msg) => show(msg, 'error')}
        />
      )}

      {/* MODAL: Detalii pachet (read-only) */}
      {detailPachet && (
        <PachetDetailModal
          pachet={detailPachet}
          onClose={() => setDetailPachet(null)}
        />
      )}
    </div>
  )
}

// ===========================================================================
// STILURI TABEL
// ===========================================================================

const thStyle = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.5px',
  color: G.muted,
}

const tdStyle = {
  padding: '11px 14px',
  fontSize: 13,
  color: G.text,
}

// ===========================================================================
// MODAL: Creare pachet nou
// ===========================================================================

function NoPachetModal({ tronson, proiectId, onClose, onSuccess, onError }) {
  const [form, setForm] = useState({
    revizie: 0,
    km_start_m: tronson.km_start_m || '',
    data_lansare: new Date().toISOString().slice(0, 10),
    observatii: '',
    parent_pachet_id: '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const payload = {
      proiect_id: proiectId,
      tronson_id: tronson.id,
      revizie: Number(form.revizie) || 0,
      km_start_m: form.km_start_m === '' ? null : Number(form.km_start_m),
      data_lansare: form.data_lansare || null,
      observatii: form.observatii || null,
      parent_pachet_id: form.parent_pachet_id || null,
    }
    const { data, error } = await supabase
      .from('executie_pachete_lansare')
      .insert(payload)
      .select()
      .single()
    setSaving(false)
    if (error) {
      onError('Eroare creare pachet: ' + error.message)
      return
    }
    onSuccess(data)
  }

  return (
    <ModalShell onClose={onClose}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
        + Pachet nou pe <span style={{ color: G.purple }}>{tronson.cod}</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Revizie">
          <input
            type="number" min={0} value={form.revizie}
            onChange={e => setForm({...form, revizie: e.target.value})}
            style={S.input}
          />
        </Field>
        <Field label="Km start (m) — ex: 936 = 0+936">
          <input
            type="number" value={form.km_start_m}
            onChange={e => setForm({...form, km_start_m: e.target.value})}
            placeholder="ex: 936"
            style={S.input}
          />
        </Field>
        <Field label="Data lansare">
          <input
            type="date" value={form.data_lansare}
            onChange={e => setForm({...form, data_lansare: e.target.value})}
            style={S.input}
          />
        </Field>
        <Field label="Cod document (auto)">
          <input
            disabled
            value="generat automat după save"
            style={{ ...S.input, opacity: 0.5, cursor:'not-allowed', fontStyle:'italic' }}
          />
        </Field>
      </div>
      <Field label="Observații">
        <textarea
          value={form.observatii}
          onChange={e => setForm({...form, observatii: e.target.value})}
          rows={3}
          placeholder="ex: completare segment km 0+936 — 1+177 + 2 curbe CIC..."
          style={{...S.input, resize:'vertical', fontFamily:'inherit'}}
        />
      </Field>
      <div style={{ display:'flex', gap: 8, justifyContent:'flex-end', marginTop: 20 }}>
        <button style={S.btnS} onClick={onClose} disabled={saving}>Anulează</button>
        <button style={S.btnP} onClick={save} disabled={saving}>
          {saving ? 'Salvez...' : 'Crează pachet'}
        </button>
      </div>
      <div style={{ marginTop: 16, padding: '10px 12px', background: G.purpleDim, borderRadius: 8, fontSize: 12, color: G.muted }}>
        ℹ După creare, vei putea adăuga țevile prin editorul inline (Faza 2). Acum se creează doar pachetul cu cod auto-generat.
      </div>
    </ModalShell>
  )
}

// ===========================================================================
// MODAL: Detalii pachet (read-only — listă țevi)
// ===========================================================================

function PachetDetailModal({ pachet, onClose }) {
  const [tevi, setTevi] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadTevi() }, [pachet.id])

  async function loadTevi() {
    setLoading(true)
    const { data, error } = await supabase
      .from('executie_tevi').select('*')
      .eq('pachet_id', pachet.id)
      .order('poz_in_pachet')
    setLoading(false)
    if (error) { console.error(error); return }
    setTevi(data || [])
  }

  const colorTipRand = (tip) => ({
    teava: G.blue, curba: G.orange, legare: G.green, separator: G.muted
  }[tip] || G.muted)

  return (
    <ModalShell onClose={onClose} maxWidth={1000}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, fontFamily:'monospace', color: G.purple }}>
            {pachet.cod_document_full}
          </div>
          <div style={{ fontSize: 12, color: G.muted }}>
            Lansare: {fmtDate(pachet.data_lansare)} · km start: {fmtKm(pachet.km_start_m)} ·{' '}
            {pachet.nr_tevi} elemente · {fmtLungime(pachet.total_lungime_m)} ·{' '}
            {pachet.nr_pending_sant} pending șanț
          </div>
          {pachet.observatii && (
            <div style={{ fontSize: 12, color: G.muted, marginTop: 8, fontStyle:'italic' }}>
              {pachet.observatii}
            </div>
          )}
        </div>
        <button style={S.btnS} onClick={onClose}>✕ Închide</button>
      </div>

      {loading ? (
        <div style={{ padding: 30, textAlign:'center', color: G.muted, fontSize: 13 }}>Se încarcă țevile...</div>
      ) : tevi.length === 0 ? (
        <div style={{ padding: 30, textAlign:'center' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
          <div style={{ color: G.muted, fontSize: 13, marginBottom: 16 }}>
            Niciun rând în acest pachet
          </div>
          <div style={{ padding: '10px 12px', background: G.purpleDim, borderRadius: 8, fontSize: 12, color: G.muted, display:'inline-block' }}>
            ℹ Editor inline țevi disponibil în Faza 2
          </div>
        </div>
      ) : (
        <div style={{ overflow:'auto', maxHeight: 'calc(80vh - 200px)' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize: 12 }}>
            <thead style={{ position:'sticky', top: 0, background: G.surface }}>
              <tr style={{ borderBottom: `1px solid ${G.border}` }}>
                <th style={thStyle}>POZ</th>
                <th style={thStyle}>Tip</th>
                <th style={thStyle}>Serie</th>
                <th style={thStyle}>TIP</th>
                <th style={thStyle}>Dimensiune</th>
                <th style={thStyle}>Șarja</th>
                <th style={{...thStyle, textAlign:'right'}}>Cant.</th>
                <th style={thStyle}>km</th>
                <th style={thStyle}>Sudură</th>
                <th style={thStyle}>PM</th>
                <th style={thStyle}>PA-UT</th>
              </tr>
            </thead>
            <tbody>
              {tevi.map(t => {
                const isPending = t.sudura_sant_pending
                const isSantInsert = !!t.pachet_sudura_sant_id
                return (
                  <tr key={t.id} style={{
                    borderBottom: `1px solid ${G.border2}`,
                    background: isSantInsert ? G.purpleDim+'44' : isPending ? G.yellowDim+'44' : 'transparent',
                  }}>
                    <td style={{...tdStyle, color: G.muted, fontFamily:'monospace'}}>{t.poz_in_pachet}</td>
                    <td style={tdStyle}>
                      <span style={{
                        ...S.badge,
                        background: colorTipRand(t.tip_rand)+'22',
                        color: colorTipRand(t.tip_rand),
                      }}>
                        {t.tip_rand}
                      </span>
                    </td>
                    <td style={{...tdStyle, fontFamily:'monospace', fontWeight: 600}}>
                      {t.serie_unica || <span style={{ color: G.muted }}>—</span>}
                    </td>
                    <td style={tdStyle}>{t.tip || '—'}</td>
                    <td style={tdStyle}>
                      {t.dimensiune || '—'}
                      {t.unghi_curba && <span style={{ color: G.orange, marginLeft: 4 }}>· {t.unghi_curba}</span>}
                    </td>
                    <td style={{...tdStyle, color: G.muted}}>{t.sarja || '—'}</td>
                    <td style={{...tdStyle, textAlign:'right', fontFamily:'monospace'}}>{fmtLungime(t.lungime_m)}</td>
                    <td style={{...tdStyle, fontFamily:'monospace', color: G.muted}}>{fmtKm(t.poz_km_m)}</td>
                    <td style={tdStyle}>
                      {t.sudura_cod ? (
                        <span style={{ fontFamily:'monospace', color: G.green, fontWeight: 600 }}>
                          {t.sudura_cod}{t.sudura_refacuta && <span style={{ color: G.orange }}> R</span>}
                        </span>
                      ) : isPending ? (
                        <span style={{...S.badge, background: G.yellow+'22', color: G.yellow}}>pending</span>
                      ) : (
                        <span style={{ color: G.muted }}>—</span>
                      )}
                    </td>
                    <td style={{...tdStyle, color: G.muted, fontSize: 11}}>{t.pm_cod || '—'}</td>
                    <td style={{...tdStyle, color: G.muted, fontSize: 11}}>{t.pa_ut_cod || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </ModalShell>
  )
}

// ===========================================================================
// UTILITARE UI
// ===========================================================================

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display:'block', fontSize: 11, color: G.muted, fontWeight: 600, textTransform:'uppercase', letterSpacing:'.3px', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function ModalShell({ onClose, children, maxWidth = 720 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset: 0, background:'rgba(0,0,0,.65)',
        display:'flex', alignItems:'center', justifyContent:'center',
        padding: 20, zIndex: 9000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: G.card, borderRadius: 12, border: `1px solid ${G.border}`,
          padding: 24, maxWidth, width:'100%', maxHeight:'90vh', overflow:'auto',
          boxShadow:'0 20px 60px rgba(0,0,0,.6)',
        }}
      >
        {children}
      </div>
    </div>
  )
}
