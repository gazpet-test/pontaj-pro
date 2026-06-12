// ════════════════════════════════════════════════════════════════════════════
// MODULUL MAGAZIE — v0.5 VIEWER STOC (12.06.2026)
// Vizualizare stoc materiale: Sediu + per proiect/șantier, alimentat AUTOMAT
// din modulul Achiziții (la PV predare-primire, cantitățile intră în `stocuri`).
// Decizie Razvan 12.06: „momentan ne focusăm să vedem că materialele ajung în
// stoc, după care detaliem modulul" → gestiunea completă (+/- manual, scădere
// către proiect cu PV, transferuri, praguri minime + notificări, valori) = Faza 6.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', magazie:'#FF7B72',
}
const S = {
  page: { fontFamily:"'Syne','Barlow',sans-serif", background:G.bg, minHeight:'100vh', color:G.text },
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'9px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnS: { background:'#161B22', color:'#E6EDF3', border:'1px solid #30363D', borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer' },
}
const fmtNr = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 2 })
const fmtDataOra = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') + ' ' + x.toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit' }) }
const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export default function MagaziePage() {
  const [loading, setLoading] = useState(true)
  const [stocuri, setStocuri] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [search, setSearch] = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [rStoc, rProj] = await Promise.all([
        supabase.from('stocuri').select('*').order('material_denumire'),
        supabase.from('executie_proiecte').select('id, nume, cod_intern'),
      ])
      setStocuri(rStoc.data || [])
      setProiecte(rProj.data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])

  // Grupare pe locație: Sediu primul, apoi proiectele (sortate după nr. poziții)
  const grupe = useMemo(() => {
    const filtered = search
      ? stocuri.filter(s => normalize(s.material_denumire).includes(normalize(search)))
      : stocuri
    const map = new Map()
    for (const s of filtered) {
      const key = s.locatie_tip === 'sediu' ? 'sediu' : `proiect_${s.locatie_id}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    const out = []
    if (map.has('sediu')) out.push({ key:'sediu', titlu:'🏢 Stoc Sediu (Ploiești)', emoji:'🏢', items: map.get('sediu') })
    const proiKeys = [...map.keys()].filter(k => k !== 'sediu')
      .sort((a, b) => map.get(b).length - map.get(a).length)
    for (const k of proiKeys) {
      const pid = Number(k.replace('proiect_', ''))
      const p = proiecteMap[pid]
      out.push({ key:k, titlu:`🏗️ ${p ? `${p.cod_intern ? `[${p.cod_intern}] ` : ''}${p.nume}` : `Proiect #${pid}`}`, items: map.get(k) })
    }
    return out
  }, [stocuri, search, proiecteMap])

  const totalPozitii = stocuri.length
  const totalLocatii = new Set(stocuri.map(s => s.locatie_tip === 'sediu' ? 'sediu' : `p${s.locatie_id}`)).size
  const ultimaMiscar = stocuri.reduce((acc, s) => (!acc || new Date(s.updated_at) > new Date(acc)) ? s.updated_at : acc, null)

  return (
    <div style={{ ...S.page, padding:'24px 0' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:18, flexWrap:'wrap' }}>
        <div style={{ width:44, height:44, borderRadius:12, background:G.magazie + '22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>📦</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:22, fontWeight:800 }}>Magazie — Stoc Materiale</div>
          <div style={{ fontSize:12.5, color:G.muted }}>Sediu + șantiere · alimentat automat din Achiziții (PV predare-primire)</div>
        </div>
        <button onClick={loadAll} style={{ ...S.btnS, fontSize:14 }}>🔄 Reîncarcă</button>
      </div>

      {/* KPI */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        {[
          ['📋', 'Poziții în stoc', totalPozitii, G.magazie],
          ['📍', 'Locații cu stoc', totalLocatii, G.blue],
          ['🕐', 'Ultima mișcare', ultimaMiscar ? fmtDataOra(ultimaMiscar) : '—', G.green],
        ].map(([e, l, v, c], i) => (
          <div key={i} style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:160 }}>
            <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>{e} {l}</div>
            <div style={{ fontSize: typeof v === 'number' ? 24 : 15, fontWeight:800, color:c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom:14 }}>
        <input style={{ ...S.input, maxWidth:380 }} placeholder="🔍 Caută material în toate locațiile..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă stocurile...</div>}

      {!loading && !grupe.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:10 }}>📭</div>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>{search ? 'Niciun material găsit pe căutarea curentă.' : 'Stocul e gol deocamdată.'}</div>
          {!search && <div style={{ fontSize:13, color:G.muted }}>Materialele intră automat aici când o comandă furnizor ajunge la „PV predare-primire magazie" în modulul Achiziții.</div>}
        </div>
      )}

      {!loading && grupe.map(gr => {
        return (
          <div key={gr.key} style={{ ...S.card, overflow:'hidden', marginBottom:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:`1px solid ${G.border}`, background:G.bg }}>
              <div style={{ fontSize:15, fontWeight:800, flex:1 }}>{gr.titlu}</div>
              <span style={{ background:G.magazie + '22', color:G.magazie, border:`1px solid ${G.magazie}55`, borderRadius:14, padding:'3px 12px', fontSize:12, fontWeight:800 }}>{gr.items.length} {gr.items.length === 1 ? 'poziție' : 'poziții'}</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 140px 170px', gap:10, padding:'8px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
              <div>Material</div><div>UM</div><div style={{ textAlign:'right' }}>Cantitate</div><div>Actualizat</div>
            </div>
            {gr.items.map(s => (
              <div key={s.id} style={{ display:'grid', gridTemplateColumns:'1fr 90px 140px 170px', gap:10, alignItems:'center', padding:'10px 16px', fontSize:13.5, borderBottom:`1px solid ${G.border}` }}>
                <div style={{ fontWeight:600 }}>{s.material_denumire}{s.observatii && <div style={{ fontSize:11, color:G.muted }}>{s.observatii}</div>}</div>
                <div style={{ color:G.muted }}>{s.um || '—'}</div>
                <div style={{ textAlign:'right', fontWeight:800, fontSize:15, color: Number(s.cantitate) > 0 ? G.green : G.red }}>{fmtNr(s.cantitate)}</div>
                <div style={{ fontSize:12, color:G.dim }}>{fmtDataOra(s.updated_at)}</div>
              </div>
            ))}
          </div>
        )
      })}

      {/* Notă Faza 6 */}
      <div style={{ padding:14, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:12, color:G.muted, lineHeight:1.7, marginTop:6 }}>
        <b style={{ color:G.text }}>📋 În Faza 6 (gestiune completă):</b> ajustări manuale +/- cu motiv, scădere stoc către proiect cu PV auto-generat,
        transferuri sediu ↔ șantier cu istoric, praguri minime cu notificări, valori pe stoc, audit log complet pe fiecare mișcare.
        Momentan modulul e viewer — intrările vin automat din Achiziții.
      </div>
    </div>
  )
}
