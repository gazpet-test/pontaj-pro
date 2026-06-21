// ════════════════════════════════════════════════════════════════════════════
// ConsumuriBonuriTab — bonuri de consum materiale (21.06.2026)
// ─────────────────────────────────────────────────────────────────────────────
// Reutilizabil cu prop `mode`:
//   mode='executie'  → MP/owner: creează bon MANUAL pe proiect (SL + proveniență +
//                      linii din stoc trasabil sau manual), listă/arhivă, anulare, PDF.
//   mode='financiar' → contabilitate: vede toate bonurile, valorizează (cost doar pe
//                      'gazpet'), buton Preluare (generat→preluat), alertă nepreluate.
//
// BD LIVE: executie_bonuri_consum (+ _linii). Stări: generat → preluat / anulat.
// Tratament contabil: gazpet = cost real în lucrare; beneficiar = doar evidență.
// Generarea AUTO din montaj/SL = fază viitoare (montaj izometrie încă neconstruit).
//
// Props:
//   proiectId – number|null (obligatoriu pe mode='executie'; ignorat pe 'financiar')
//   mode      – 'executie' | 'financiar'
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', cyan:'#2FB6C9', consum:'#F0883E',
}
const S = {
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 10px', fontFamily:'inherit', fontSize:13.5, outline:'none', width:'100%', boxSizing:'border-box' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:8, padding:'9px 16px', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer' },
  btnP: { background:G.green, color:'#06210F', border:'none', borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:800, cursor:'pointer' },
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  label: { fontSize:11.5, fontWeight:700, color:G.muted, marginBottom:4, display:'block', textTransform:'uppercase', letterSpacing:0.3 },
}

const STARE_META = {
  generat: { label:'Generat', emoji:'🟡', color:G.yellow },
  preluat: { label:'Preluat', emoji:'✅', color:G.green },
  anulat:  { label:'Anulat',  emoji:'⛔', color:G.dim },
}
const PROV_META = {
  gazpet:     { label:'Gazpet', sub:'cost în lucrare', color:G.green },
  beneficiar: { label:'Beneficiar', sub:'doar evidență', color:G.blue },
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const uniq8 = () => Math.random().toString(36).slice(2, 10)
const toNum = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null }
const fmtNr = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 2 })
const fmtData = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') }
const fmtLei = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei'

const linieGoala = (over = {}) => ({
  _k: uniq8(), magazie_bucata_id: null, tip_material_id: null,
  denumire: '', serie: '', sarja: '', dimensiune: '',
  cantitate: 1, um: 'buc', lungime_m: '', cost_unitar: '', ...over,
})

export default function ConsumuriBonuriTab({ proiectId = null, mode = 'executie' }) {
  const isExec = mode === 'executie'
  const [loading, setLoading] = useState(true)
  const [bonuri, setBonuri] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [sluri, setSluri] = useState([])
  const [bucati, setBucati] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [profile, setProfile] = useState(null)
  const [profilesMap, setProfilesMap] = useState({})

  const [modal, setModal] = useState(null)   // bon de creat/editat (null = închis)
  const [valorizare, setValorizare] = useState(null) // bon în curs de preluare (financiar)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [fStare, setFStare] = useState('')
  const [fProiect, setFProiect] = useState('')

  const flash = useCallback((kind, msg) => { setToast({ kind, msg }); setTimeout(() => setToast(null), 4200) }, [])
  const tipuriMap = useMemo(() => Object.fromEntries(tipuri.map(t => [t.id, t])), [tipuri])
  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let prof = null
      if (user) {
        const { data } = await supabase.from('profiles')
          .select('id, role, is_owner, can_process_achizitii, receive_bonuri_consum').eq('id', user.id).maybeSingle()
        prof = data || null
      }
      let qBon = supabase.from('executie_bonuri_consum')
        .select('*, linii:executie_bonuri_consum_linii(*)')
        .order('generat_la', { ascending: false })
      if (isExec && proiectId) qBon = qBon.eq('proiect_id', proiectId)

      const [rBon, rProj, rSL, rBuc, rTip, rProf] = await Promise.all([
        qBon,
        supabase.from('executie_proiecte').select('id, nume, cod_intern, site_id').order('id'),
        supabase.from('executie_situatii_plata').select('id, proiect_id, nr_situatie, luna, an, status').order('an', { ascending: false }).order('luna', { ascending: false }),
        supabase.from('magazie_bucati').select('id, proiect_id, tip_material_id, serie, sarja, dimensiune, lungime_m, cantitate, um, stare, provenienta').in('stare', ['receptionat','sosit']).order('id', { ascending: false }),
        supabase.from('magazie_tipuri_material').select('id, nume, um_implicit').order('id'),
        supabase.from('profiles').select('id, name, email'),
      ])
      setProfile(prof)
      setBonuri(rBon.data || [])
      setProiecte(rProj.data || [])
      setSluri(rSL.data || [])
      setBucati(rBuc.data || [])
      setTipuri(rTip.data || [])
      setProfilesMap(Object.fromEntries((rProf.data || []).map(p => [p.id, p.name || p.email || '—'])))
    } catch (e) { console.error(e); flash('err', 'Eroare la încărcare.') } finally { setLoading(false) }
  }, [isExec, proiectId, flash])
  useEffect(() => { loadAll() }, [loadAll])

  const canCreate = !!(profile?.is_owner || profile?.can_process_achizitii)
  const canPrelua = !!(profile?.is_owner || profile?.receive_bonuri_consum)

  // ── filtre listă ──
  const bonuriFiltrate = useMemo(() => {
    return bonuri.filter(b => {
      if (fStare && b.stare !== fStare) return false
      if (!isExec && fProiect && String(b.proiect_id) !== String(fProiect)) return false
      return true
    })
  }, [bonuri, fStare, fProiect, isExec])

  const kpi = useMemo(() => {
    const k = { total: bonuri.length, generat: 0, preluat: 0, anulat: 0 }
    for (const b of bonuri) if (k[b.stare] != null) k[b.stare]++
    return k
  }, [bonuri])

  const valoareBon = (b) => (b.linii || []).reduce((s, l) => s + (Number(l.valoare) || 0), 0)
  const totalBuc = (b) => (b.linii || []).length

  // ── creare/editare ──
  const deschideNou = () => {
    if (!isExec) return
    setModal({
      isNew: true, id: null,
      proiect_id: proiectId ? String(proiectId) : '',
      situatie_plata_id: '', provenienta: 'gazpet', data_bon: todayISO(), observatii: '',
      linii: [],
    })
  }
  const deschideEdit = (b) => {
    setModal({
      isNew: false, id: b.id,
      proiect_id: String(b.proiect_id),
      situatie_plata_id: b.situatie_plata_id ? String(b.situatie_plata_id) : '',
      provenienta: b.provenienta, data_bon: b.data_bon || todayISO(), observatii: b.observatii || '',
      linii: (b.linii || []).map(l => ({
        _k: uniq8(), id: l.id, magazie_bucata_id: l.magazie_bucata_id, tip_material_id: l.tip_material_id,
        denumire: l.denumire || '', serie: l.serie || '', sarja: l.sarja || '', dimensiune: l.dimensiune || '',
        cantitate: l.cantitate ?? 1, um: l.um || 'buc', lungime_m: l.lungime_m ?? '', cost_unitar: l.cost_unitar ?? '',
      })),
    })
  }

  // numerotare BC-{an}-{proiect}-{secv}
  const genNumarBon = async (proiect_id, data_bon) => {
    const an = new Date(data_bon || todayISO()).getFullYear()
    const { count } = await supabase.from('executie_bonuri_consum')
      .select('id', { count: 'exact', head: true })
      .eq('proiect_id', proiect_id)
      .gte('data_bon', `${an}-01-01`).lte('data_bon', `${an}-12-31`)
    const secv = String((count || 0) + 1).padStart(4, '0')
    return `BC-${an}-${proiect_id}-${secv}`
  }

  const salveazaBon = async (m) => {
    if (!m.proiect_id) { flash('err', 'Alege proiectul.'); return }
    if (!m.linii.length) { flash('err', 'Adaugă cel puțin o linie.'); return }
    for (const l of m.linii) {
      if (!l.denumire?.trim() && !l.tip_material_id) { flash('err', 'Fiecare linie are nevoie de denumire sau tip material.'); return }
      const c = toNum(l.cantitate); if (c == null || c <= 0) { flash('err', 'Cantitatea trebuie > 0 pe fiecare linie.'); return }
    }
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const pid = Number(m.proiect_id)
      let bonId = m.id
      if (m.isNew) {
        const numar = await genNumarBon(pid, m.data_bon)
        const { data, error } = await supabase.from('executie_bonuri_consum').insert({
          numar_bon: numar, proiect_id: pid,
          situatie_plata_id: m.situatie_plata_id ? Number(m.situatie_plata_id) : null,
          provenienta: m.provenienta, data_bon: m.data_bon, sursa: 'manual', stare: 'generat',
          generat_de: user?.id || null, observatii: m.observatii?.trim() || null,
        }).select('id').single()
        if (error) throw error
        bonId = data.id
      } else {
        const { error } = await supabase.from('executie_bonuri_consum').update({
          situatie_plata_id: m.situatie_plata_id ? Number(m.situatie_plata_id) : null,
          provenienta: m.provenienta, data_bon: m.data_bon,
          observatii: m.observatii?.trim() || null, updated_at: new Date().toISOString(),
        }).eq('id', bonId)
        if (error) throw error
        await supabase.from('executie_bonuri_consum_linii').delete().eq('bon_id', bonId)
      }
      const rows = m.linii.map(l => {
        const tip = l.tip_material_id ? tipuriMap[l.tip_material_id] : null
        const cant = toNum(l.cantitate) ?? 1
        const cost = m.provenienta === 'gazpet' ? toNum(l.cost_unitar) : null
        return {
          bon_id: bonId, magazie_bucata_id: l.magazie_bucata_id || null, tip_material_id: l.tip_material_id || null,
          denumire: l.denumire?.trim() || tip?.nume || null,
          serie: l.serie?.trim() || null, sarja: l.sarja?.trim() || null, dimensiune: l.dimensiune?.trim() || null,
          cantitate: cant, um: l.um || tip?.um_implicit || 'buc',
          lungime_m: toNum(l.lungime_m), cost_unitar: cost, valoare: cost != null ? cost * cant : null,
          observatii: null,
        }
      })
      const { error: eL } = await supabase.from('executie_bonuri_consum_linii').insert(rows)
      if (eL) throw eL
      flash('ok', `Bon ${m.isNew ? 'creat' : 'actualizat'} (${rows.length} linii).`)
      setModal(null); await loadAll()
    } catch (e) { console.error(e); flash('err', 'Salvare eșuată: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  const anuleaza = async (b) => {
    if (!window.confirm(`Anulezi bonul ${b.numar_bon}? (rămâne în arhivă ca „anulat")`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('executie_bonuri_consum')
        .update({ stare: 'anulat', updated_at: new Date().toISOString() }).eq('id', b.id)
      if (error) throw error
      flash('ok', `Bon ${b.numar_bon} anulat.`); await loadAll()
    } catch (e) { console.error(e); flash('err', 'Eroare: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  // ── preluare (financiar) ──
  const confirmaPreluare = async (v) => {
    setBusy(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      // salvează valorizarea (cost_unitar) pe linii dacă e gazpet
      if (v.provenienta === 'gazpet') {
        for (const l of v.linii) {
          const cost = toNum(l.cost_unitar)
          const cant = Number(l.cantitate) || 0
          await supabase.from('executie_bonuri_consum_linii')
            .update({ cost_unitar: cost, valoare: cost != null ? cost * cant : null }).eq('id', l.id)
        }
      }
      const { error } = await supabase.from('executie_bonuri_consum')
        .update({ stare: 'preluat', preluat_de: user?.id || null, preluat_la: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', v.id)
      if (error) throw error
      flash('ok', `Bon ${v.numar_bon} preluat în Financiar.`)
      setValorizare(null); await loadAll()
    } catch (e) { console.error(e); flash('err', 'Eroare la preluare: ' + (e?.message || e)) } finally { setBusy(false) }
  }

  // ── PDF ──
  const genereazaPDF = async (b) => {
    const proj = proiecteMap[b.proiect_id]
    const prov = PROV_META[b.provenienta]
    const rowsHtml = (b.linii || []).map((l, i) => `
      <tr>
        <td style="border:1px solid #ccc;padding:5px;text-align:center">${i + 1}</td>
        <td style="border:1px solid #ccc;padding:5px">${l.denumire || (tipuriMap[l.tip_material_id]?.nume || '—')}</td>
        <td style="border:1px solid #ccc;padding:5px;font-family:monospace;font-size:10px">${l.serie || '—'}</td>
        <td style="border:1px solid #ccc;padding:5px">${l.sarja || '—'}</td>
        <td style="border:1px solid #ccc;padding:5px">${l.dimensiune || '—'}</td>
        <td style="border:1px solid #ccc;padding:5px;text-align:right">${fmtNr(l.cantitate)} ${l.um || ''}</td>
        <td style="border:1px solid #ccc;padding:5px;text-align:right">${l.cost_unitar != null ? fmtNr(l.cost_unitar) : '—'}</td>
        <td style="border:1px solid #ccc;padding:5px;text-align:right">${l.valoare != null ? fmtNr(l.valoare) : '—'}</td>
      </tr>`).join('')
    const total = valoareBon(b)
    const html = `
      <div style="width:760px;padding:28px;font-family:Arial,sans-serif;color:#111;background:#fff">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #F0883E;padding-bottom:10px;margin-bottom:14px">
          <div><div style="font-size:20px;font-weight:800">GAZPET INSTAL SRL</div><div style="font-size:11px;color:#555">Bon de consum materiale</div></div>
          <div style="text-align:right"><div style="font-size:17px;font-weight:800">${b.numar_bon || '—'}</div><div style="font-size:11px;color:#555">${fmtData(b.data_bon)}</div></div>
        </div>
        <table style="width:100%;font-size:12px;margin-bottom:12px"><tr>
          <td style="padding:2px 0"><b>Proiect:</b> ${proj ? (proj.cod_intern ? proj.cod_intern + ' · ' : '') + proj.nume : '#' + b.proiect_id}</td>
          <td style="padding:2px 0;text-align:right"><b>Proveniență:</b> ${prov?.label || b.provenienta} (${prov?.sub || ''})</td>
        </tr></table>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#f3f3f3">
            <th style="border:1px solid #ccc;padding:5px">Nr</th><th style="border:1px solid #ccc;padding:5px;text-align:left">Denumire</th>
            <th style="border:1px solid #ccc;padding:5px">Serie</th><th style="border:1px solid #ccc;padding:5px">Sarjă</th>
            <th style="border:1px solid #ccc;padding:5px">Dim.</th><th style="border:1px solid #ccc;padding:5px">Cant.</th>
            <th style="border:1px solid #ccc;padding:5px">Cost u.</th><th style="border:1px solid #ccc;padding:5px">Valoare</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${b.provenienta === 'gazpet' ? `<div style="text-align:right;font-size:13px;font-weight:800;margin-top:8px">TOTAL: ${fmtLei(total)}</div>` : ''}
        ${b.observatii ? `<div style="font-size:11px;color:#555;margin-top:8px"><b>Observații:</b> ${b.observatii}</div>` : ''}
        <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px">
          <div style="text-align:center"><div style="border-top:1px solid #111;padding-top:4px;width:200px">Întocmit (generat)</div><div style="font-size:10px;color:#555">${profilesMap[b.generat_de] || ''}</div></div>
          <div style="text-align:center"><div style="border-top:1px solid #111;padding-top:4px;width:200px">Preluat (financiar)</div><div style="font-size:10px;color:#555">${b.preluat_de ? (profilesMap[b.preluat_de] || '') : ''}</div></div>
        </div>
      </div>`
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-9999px;top:0;'
    host.innerHTML = html
    document.body.appendChild(host)
    try {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#fff' })
      const pdf = new jsPDF('p', 'mm', 'a4')
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, (canvas.height * 210) / canvas.width, undefined, 'FAST')
      pdf.save(`${b.numar_bon || 'bon'}.pdf`)
    } catch (e) { console.error(e); flash('err', 'PDF eșuat.') } finally { document.body.removeChild(host) }
  }

  // ════════════════════════════════════════════════════════════════
  if (loading) return <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă bonurile…</div>

  const slProiect = (pid) => sluri.filter(s => String(s.proiect_id) === String(pid))
  const bucatiProiect = (pid) => bucati.filter(b => String(b.proiect_id) === String(pid))

  return (
    <div style={{ fontFamily:"'Syne','Barlow',sans-serif" }}>
      {/* KPI + acțiune */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
        {[
          ['📋', 'Bonuri total', kpi.total, G.consum],
          ['🟡', 'Generate', kpi.generat, G.yellow],
          ['✅', 'Preluate', kpi.preluat, G.green],
        ].map(([e, l, v, c], i) => (
          <div key={i} style={{ ...S.card, padding:'12px 16px', minWidth:140 }}>
            <div style={{ fontSize:12, color:G.muted, marginBottom:3 }}>{e} {l}</div>
            <div style={{ fontSize:22, fontWeight:800, color:c }}>{v}</div>
          </div>
        ))}
        <div style={{ flex:1 }} />
        {isExec && canCreate && <button onClick={deschideNou} style={{ ...S.btnP, background:G.consum, color:'#2A1303' }}>＋ Bon de consum nou</button>}
        <button onClick={loadAll} style={S.btnS}>🔄</button>
      </div>

      {/* Alertă financiar */}
      {!isExec && kpi.generat > 0 && (
        <div style={{ marginBottom:14, padding:'10px 14px', borderRadius:9, background:G.yellow+'1A', border:`1px solid ${G.yellow}66`, color:G.yellow, fontSize:13, fontWeight:700 }}>
          ⚡ {kpi.generat} {kpi.generat === 1 ? 'bon de consum generat' : 'bonuri de consum generate'} — de preluat în Financiar.
        </div>
      )}

      {/* Filtre */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
        <select style={{ ...S.input, maxWidth:200 }} value={fStare} onChange={e => setFStare(e.target.value)}>
          <option value="">Toate stările</option>
          {Object.entries(STARE_META).map(([k, m]) => <option key={k} value={k}>{m.emoji} {m.label}</option>)}
        </select>
        {!isExec && (
          <select style={{ ...S.input, maxWidth:260 }} value={fProiect} onChange={e => setFProiect(e.target.value)}>
            <option value="">Toate proiectele</option>
            {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? p.cod_intern + ' · ' : ''}{p.nume}</option>)}
          </select>
        )}
        <span style={{ fontSize:12.5, color:G.muted, marginLeft:'auto' }}>{bonuriFiltrate.length} bonuri</span>
      </div>

      {/* Listă bonuri */}
      {!bonuriFiltrate.length ? (
        <div style={{ ...S.card, padding:36, textAlign:'center' }}>
          <div style={{ fontSize:38, marginBottom:8 }}>🧾</div>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>Niciun bon de consum {fStare ? 'pe filtrul curent' : 'încă'}.</div>
          {isExec && canCreate && !fStare && <div style={{ fontSize:13, color:G.muted }}>Apasă <b style={{ color:G.consum }}>＋ Bon de consum nou</b> ca să înregistrezi materialele consumate pe lucrare.</div>}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {bonuriFiltrate.map(b => {
            const st = STARE_META[b.stare] || { label:b.stare, emoji:'•', color:G.muted }
            const pr = PROV_META[b.provenienta] || { label:b.provenienta, color:G.muted }
            const proj = proiecteMap[b.proiect_id]
            const sl = b.situatie_plata_id ? sluri.find(s => s.id === b.situatie_plata_id) : null
            return (
              <div key={b.id} style={{ ...S.card, padding:'12px 16px', opacity: b.stare === 'anulat' ? 0.6 : 1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  <div style={{ fontSize:15, fontWeight:800, fontFamily:'monospace' }}>{b.numar_bon || `#${b.id}`}</div>
                  <span style={{ background:st.color+'1A', color:st.color, border:`1px solid ${st.color}55`, borderRadius:12, padding:'3px 10px', fontSize:11.5, fontWeight:700 }}>{st.emoji} {st.label}</span>
                  <span style={{ color:pr.color, fontSize:12, fontWeight:700 }}>● {pr.label}</span>
                  {!isExec && proj && <span style={{ fontSize:12, color:G.muted }}>{proj.cod_intern ? `[${proj.cod_intern}] ` : ''}{proj.nume}</span>}
                  <div style={{ flex:1 }} />
                  <span style={{ fontSize:12, color:G.dim }}>{fmtData(b.data_bon)}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:14, marginTop:6, fontSize:12.5, color:G.muted, flexWrap:'wrap' }}>
                  <span>📦 {totalBuc(b)} {totalBuc(b) === 1 ? 'poziție' : 'poziții'}</span>
                  {sl && <span>💰 SL {sl.nr_situatie || `${sl.luna}/${sl.an}`}</span>}
                  {b.provenienta === 'gazpet' && <span style={{ color:G.green, fontWeight:700 }}>{fmtLei(valoareBon(b))}</span>}
                  {b.generat_de && <span>· întocmit {profilesMap[b.generat_de] || ''}</span>}
                  {b.preluat_de && <span>· preluat {profilesMap[b.preluat_de] || ''}</span>}
                </div>
                <div style={{ display:'flex', gap:8, marginTop:10, justifyContent:'flex-end', flexWrap:'wrap' }}>
                  <button onClick={() => genereazaPDF(b)} style={{ ...S.btnS, padding:'6px 12px', fontSize:13 }}>📄 PDF</button>
                  {isExec && canCreate && b.stare === 'generat' && (<>
                    <button onClick={() => deschideEdit(b)} style={{ ...S.btnS, padding:'6px 12px', fontSize:13 }}>✏️ Editează</button>
                    <button onClick={() => anuleaza(b)} style={{ ...S.btnS, padding:'6px 12px', fontSize:13, color:G.red, borderColor:G.red+'66' }}>⛔ Anulează</button>
                  </>)}
                  {!isExec && canPrelua && b.stare === 'generat' && (
                    <button onClick={() => setValorizare({ ...b, linii: (b.linii || []).map(l => ({ ...l, cost_unitar: l.cost_unitar ?? '' })) })}
                      style={{ ...S.btnP, padding:'7px 14px', fontSize:13, background:G.green }}>✓ Preluare în Financiar</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* MODAL creare/editare (executie) */}
      {modal && (
        <BonFormModal
          modal={modal} setModal={setModal} busy={busy}
          proiecte={proiecte} sluri={slProiect(modal.proiect_id)} tipuri={tipuri}
          bucati={bucatiProiect(modal.proiect_id)} tipuriMap={tipuriMap}
          fixedProiect={!!proiectId}
          onSave={() => salveazaBon(modal)} onClose={() => setModal(null)}
          linieGoala={linieGoala}
        />
      )}

      {/* MODAL preluare/valorizare (financiar) */}
      {valorizare && (
        <PreluareModal
          bon={valorizare} setBon={setValorizare} busy={busy} tipuriMap={tipuriMap}
          onConfirm={() => confirmaPreluare(valorizare)} onClose={() => setValorizare(null)}
        />
      )}

      {toast && (
        <div style={{ position:'fixed', bottom:20, right:20, zIndex:1200, padding:'12px 18px', borderRadius:10, fontSize:13.5, fontWeight:700,
          background: toast.kind === 'ok' ? G.green : G.red, color:'#fff', boxShadow:'0 8px 30px rgba(0,0,0,.5)' }}>{toast.msg}</div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL creare/editare bon (Execuție)
// ════════════════════════════════════════════════════════════════
function BonFormModal({ modal, setModal, busy, proiecte, sluri, tipuri, bucati, tipuriMap, fixedProiect, onSave, onClose, linieGoala }) {
  const m = modal
  const setM = (k, v) => setModal(p => ({ ...p, [k]: v }))
  const upd = (k, field, val) => setModal(p => ({ ...p, linii: p.linii.map(l => l._k === k ? { ...l, [field]: val } : l) }))
  const del = (k) => setModal(p => ({ ...p, linii: p.linii.filter(l => l._k !== k) }))
  const addManual = () => setModal(p => ({ ...p, linii: [...p.linii, linieGoala()] }))
  const [pickBucata, setPickBucata] = useState(false)

  const addDinStoc = (b) => {
    const tip = tipuriMap[b.tip_material_id]
    setModal(p => ({ ...p, linii: [...p.linii, linieGoala({
      magazie_bucata_id: b.id, tip_material_id: b.tip_material_id,
      denumire: tip?.nume || '', serie: b.serie || '', sarja: b.sarja || '', dimensiune: b.dimensiune || '',
      cantitate: b.cantitate ?? 1, um: b.um || tip?.um_implicit || 'buc', lungime_m: b.lungime_m ?? '',
    })] }))
    setPickBucata(false)
  }
  const isGazpet = m.provenienta === 'gazpet'

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(1,4,9,0.78)', zIndex:1100, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 14px', overflowY:'auto', fontFamily:"'Syne','Barlow',sans-serif" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:G.bg, border:`1px solid ${G.border2}`, borderRadius:16, width:'100%', maxWidth:980, color:G.text }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'16px 20px', borderBottom:`1px solid ${G.border}` }}>
          <div style={{ width:38, height:38, borderRadius:10, background:G.consum+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:19 }}>🧾</div>
          <div style={{ flex:1, fontSize:17, fontWeight:800 }}>{m.isNew ? 'Bon de consum nou' : 'Editează bonul'}</div>
          <button onClick={onClose} style={{ ...S.btnS, padding:'7px 12px' }}>✕</button>
        </div>

        <div style={{ padding:20 }}>
          {/* Proveniență */}
          <div style={{ marginBottom:14 }}>
            <span style={S.label}>Proveniență</span>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              {Object.entries(PROV_META).map(([k, mt]) => {
                const active = m.provenienta === k
                return (
                  <button key={k} onClick={() => setM('provenienta', k)} style={{ flex:'1 1 220px', textAlign:'left', cursor:'pointer', borderRadius:10, padding:'9px 13px',
                    background: active ? mt.color+'1A' : G.surface, border:`1.5px solid ${active ? mt.color : G.border2}`, color: active ? mt.color : G.text }}>
                    <div style={{ fontSize:13.5, fontWeight:800 }}>{active ? '●' : '○'} {mt.label}</div>
                    <div style={{ fontSize:11.5, color:G.muted }}>{mt.sub}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Header */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px,1fr))', gap:12, marginBottom:14 }}>
            <div>
              <span style={S.label}>Proiect *</span>
              <select style={S.input} value={m.proiect_id} disabled={fixedProiect} onChange={e => setModal(p => ({ ...p, proiect_id: e.target.value, situatie_plata_id: '' }))}>
                <option value="">— alege —</option>
                {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? p.cod_intern + ' · ' : ''}{p.nume}</option>)}
              </select>
            </div>
            <div>
              <span style={S.label}>Situație de lucrări (SL)</span>
              <select style={S.input} value={m.situatie_plata_id} onChange={e => setM('situatie_plata_id', e.target.value)}>
                <option value="">— fără SL —</option>
                {sluri.map(s => <option key={s.id} value={s.id}>{s.nr_situatie || `SL ${s.luna}/${s.an}`}{s.status ? ` · ${s.status}` : ''}</option>)}
              </select>
            </div>
            <div>
              <span style={S.label}>Data bon</span>
              <input type="date" style={S.input} value={m.data_bon} onChange={e => setM('data_bon', e.target.value)} />
            </div>
            <div>
              <span style={S.label}>Observații</span>
              <input style={S.input} value={m.observatii} onChange={e => setM('observatii', e.target.value)} placeholder="opțional" />
            </div>
          </div>

          {/* Acțiuni linii */}
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:10 }}>
            <button onClick={() => setPickBucata(v => !v)} disabled={!m.proiect_id} style={{ ...S.btnS, color:G.cyan, borderColor:G.cyan+'66', opacity: m.proiect_id ? 1 : 0.5 }}>📦 Adaugă din stoc trasabil</button>
            <button onClick={addManual} style={S.btnS}>＋ Linie manuală</button>
            <div style={{ flex:1 }} />
            <span style={{ fontSize:12, color:G.muted }}>{m.linii.length} linii</span>
          </div>

          {/* Selector bucăți din stoc */}
          {pickBucata && (
            <div style={{ ...S.card, background:G.surface, maxHeight:200, overflowY:'auto', marginBottom:12 }}>
              {bucati.length === 0 ? (
                <div style={{ padding:16, textAlign:'center', color:G.muted, fontSize:13 }}>Nicio bucată disponibilă în stoc pe acest proiect (recepționează întâi în Magazie).</div>
              ) : bucati.map(b => {
                const tip = tipuriMap[b.tip_material_id]
                return (
                  <div key={b.id} onClick={() => addDinStoc(b)} style={{ display:'flex', gap:10, alignItems:'center', padding:'8px 12px', borderBottom:`1px solid ${G.border}`, cursor:'pointer', fontSize:13 }}>
                    <span style={{ fontWeight:700 }}>{tip?.nume || '—'}</span>
                    <span style={{ color:G.cyan, fontFamily:'monospace', fontSize:12 }}>{b.serie || '—'}</span>
                    <span style={{ color:G.muted }}>{b.dimensiune || ''}</span>
                    <span style={{ color:G.muted }}>{b.lungime_m != null ? fmtNr(b.lungime_m) + ' m' : ''}</span>
                    <div style={{ flex:1 }} />
                    <span style={{ color:G.green }}>＋ adaugă</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Tabel linii */}
          {m.linii.length > 0 && (
            <div style={{ border:`1px solid ${G.border}`, borderRadius:10, overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:`1.4fr 1.1fr 0.9fr 1fr 0.7fr 0.6fr ${isGazpet ? '0.8fr ' : ''}32px`, gap:6, padding:'8px 10px', background:G.surface, fontSize:10.5, fontWeight:800, color:G.muted, textTransform:'uppercase' }}>
                <div>Denumire</div><div>Serie</div><div>Sarjă</div><div>Dimensiune</div><div>Cant.</div><div>UM</div>{isGazpet && <div>Cost u.</div>}<div></div>
              </div>
              <div style={{ maxHeight:260, overflowY:'auto' }}>
                {m.linii.map(l => (
                  <div key={l._k} style={{ display:'grid', gridTemplateColumns:`1.4fr 1.1fr 0.9fr 1fr 0.7fr 0.6fr ${isGazpet ? '0.8fr ' : ''}32px`, gap:6, padding:'6px 10px', borderTop:`1px solid ${G.border}`, alignItems:'center' }}>
                    <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.denumire} onChange={e => upd(l._k, 'denumire', e.target.value)} placeholder="denumire" />
                    <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.serie} onChange={e => upd(l._k, 'serie', e.target.value)} placeholder="serie" />
                    <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.sarja} onChange={e => upd(l._k, 'sarja', e.target.value)} placeholder="heat" />
                    <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.dimensiune} onChange={e => upd(l._k, 'dimensiune', e.target.value)} placeholder="508x8" />
                    <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.cantitate} onChange={e => upd(l._k, 'cantitate', e.target.value)} />
                    <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.um} onChange={e => upd(l._k, 'um', e.target.value)} />
                    {isGazpet && <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.cost_unitar} onChange={e => upd(l._k, 'cost_unitar', e.target.value)} placeholder="lei" />}
                    <button onClick={() => del(l._k)} style={{ background:'transparent', border:'none', color:G.red, cursor:'pointer', fontSize:15 }}>🗑</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ display:'flex', gap:10, marginTop:18, justifyContent:'flex-end' }}>
            <button onClick={onClose} style={S.btnS}>Anulează</button>
            <button onClick={onSave} disabled={busy || !m.linii.length} style={{ ...S.btnP, background:G.consum, color:'#2A1303', opacity: (busy || !m.linii.length) ? 0.55 : 1 }}>
              {busy ? 'Se salvează…' : (m.isNew ? '✓ Generează bon' : '✓ Salvează')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL preluare + valorizare (Financiar)
// ════════════════════════════════════════════════════════════════
function PreluareModal({ bon, setBon, busy, tipuriMap, onConfirm, onClose }) {
  const isGazpet = bon.provenienta === 'gazpet'
  const upd = (id, val) => setBon(p => ({ ...p, linii: p.linii.map(l => l.id === id ? { ...l, cost_unitar: val } : l) }))
  const total = (bon.linii || []).reduce((s, l) => {
    const c = parseFloat(String(l.cost_unitar).replace(',', '.'))
    return s + (isFinite(c) ? c * (Number(l.cantitate) || 0) : 0)
  }, 0)

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(1,4,9,0.78)', zIndex:1100, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 14px', overflowY:'auto', fontFamily:"'Syne','Barlow',sans-serif" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:G.bg, border:`1px solid ${G.border2}`, borderRadius:16, width:'100%', maxWidth:880, color:G.text }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'16px 20px', borderBottom:`1px solid ${G.border}` }}>
          <div style={{ width:38, height:38, borderRadius:10, background:G.green+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:19 }}>✅</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:17, fontWeight:800 }}>Preluare bon {bon.numar_bon}</div>
            <div style={{ fontSize:12, color:G.muted }}>{isGazpet ? 'Valorizează costurile (Gazpet) și preia.' : 'Materiale beneficiar — doar evidență, fără cost.'}</div>
          </div>
          <button onClick={onClose} style={{ ...S.btnS, padding:'7px 12px' }}>✕</button>
        </div>

        <div style={{ padding:20 }}>
          <div style={{ border:`1px solid ${G.border}`, borderRadius:10, overflow:'hidden', marginBottom:14 }}>
            <div style={{ display:'grid', gridTemplateColumns:`1.6fr 1.2fr 1fr 0.8fr ${isGazpet ? '0.9fr 1fr' : ''}`, gap:6, padding:'8px 10px', background:G.surface, fontSize:10.5, fontWeight:800, color:G.muted, textTransform:'uppercase' }}>
              <div>Denumire</div><div>Serie</div><div>Dim.</div><div>Cant.</div>{isGazpet && <><div>Cost u. (lei)</div><div>Valoare</div></>}
            </div>
            {(bon.linii || []).map(l => {
              const c = parseFloat(String(l.cost_unitar).replace(',', '.'))
              const val = isFinite(c) ? c * (Number(l.cantitate) || 0) : null
              return (
                <div key={l.id} style={{ display:'grid', gridTemplateColumns:`1.6fr 1.2fr 1fr 0.8fr ${isGazpet ? '0.9fr 1fr' : ''}`, gap:6, padding:'7px 10px', borderTop:`1px solid ${G.border}`, alignItems:'center', fontSize:12.5 }}>
                  <div style={{ fontWeight:600 }}>{l.denumire || (tipuriMap[l.tip_material_id]?.nume || '—')}</div>
                  <div style={{ color:G.cyan, fontFamily:'monospace', fontSize:11.5 }}>{l.serie || '—'}</div>
                  <div style={{ color:G.muted }}>{l.dimensiune || '—'}</div>
                  <div>{fmtNr(l.cantitate)} {l.um}</div>
                  {isGazpet && <input style={{ ...S.input, padding:'5px 8px', fontSize:12.5 }} value={l.cost_unitar} onChange={e => upd(l.id, e.target.value)} placeholder="0.00" />}
                  {isGazpet && <div style={{ textAlign:'right', fontWeight:700, color: val != null ? G.green : G.dim }}>{val != null ? fmtLei(val) : '—'}</div>}
                </div>
              )
            })}
          </div>
          {isGazpet && <div style={{ textAlign:'right', fontSize:15, fontWeight:800, color:G.green, marginBottom:14 }}>TOTAL: {fmtLei(total)}</div>}

          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={onClose} style={S.btnS}>Anulează</button>
            <button onClick={onConfirm} disabled={busy} style={{ ...S.btnP, opacity: busy ? 0.55 : 1 }}>{busy ? 'Se preia…' : '✓ Confirmă preluarea'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
