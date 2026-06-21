// ════════════════════════════════════════════════════════════════════════════
// ReceptieBucatiModal — recepție materiale conductă PE BUCATĂ (21.06.2026)
// ─────────────────────────────────────────────────────────────────────────────
// Reutilizabil din Magazie (tab „Stoc trasabil") ȘI din Achiziții (pe comandă).
// Flux: alege proiect + proveniență (beneficiar/gazpet) → OCR packing list (Haiku
// Vision, edge `ocr-packing-list`) SAU adăugare manuală SAU „Fără packing list" →
// listă bucăți editabilă → INSERT în magazie_bucati cu stare 'sosit'.
// Confirmarea fizică (PV recepție MP, 'sosit'→'receptionat') e pas SEPARAT.
//
// Props:
//   open                – bool, randează doar când true
//   onClose()           – închide
//   onSuccess(n)        – după salvare (n = nr bucăți inserate); declanșează reload în părinte
//   proiectId           – number|null, preselectat (din Achiziții); dacă null → selector
//   comandaFurnizorId   – number|null, leagă bucățile de comandă (din Achiziții)
//   defaultProvenienta  – 'gazpet'|'beneficiar' (default 'gazpet')
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', magazie:'#FF7B72', cyan:'#2FB6C9',
}
const S = {
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'8px 10px', fontFamily:'inherit', fontSize:13.5, outline:'none', width:'100%', boxSizing:'border-box' },
  btnS: { background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:8, padding:'9px 16px', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer' },
  btnP: { background:G.green, color:'#06210F', border:'none', borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:800, cursor:'pointer' },
  label: { fontSize:11.5, fontWeight:700, color:G.muted, marginBottom:4, display:'block', textTransform:'uppercase', letterSpacing:0.3 },
}

const BUCKET_PACKING = 'packing-lists'
const SCRAP_DEFAULT_M = 2  // info; pragul real de scrap se aplică la retur/consum

// Mapare string (din edge `ocr-packing-list`) → magazie_tipuri_material.id (seed fix)
const OCR_TIP_TO_ID = {
  teava: 1, tub_protectie: 2, curba: 3, teu: 4, weldolet: 5, flansa: 6,
  flansa_oarba: 7, capac_bombat: 8, prezoane: 9, piulite: 10, robinet: 11,
  fitinguri: 12, imbinare_electroizolanta: 13, godevil: 14, altele: null,
}

const PROV_META = {
  gazpet:     { label:'Achiziționate de Gazpet', sub:'cost real în lucrare', color:G.green },
  beneficiar: { label:'Puse la dispoziție de beneficiar', sub:'doar evidență, fără cost', color:G.blue },
}
const IZOLATIE_OPT = [['neizolata','Neizolată'],['PEHD','PEHD'],['GRP','GRP']]
const SURSA_OPT = [['packing_list','Packing list'],['aviz','Aviz însoțire'],['mtc','MTC / Certificat'],['manual','Manual']]

const todayISO = () => new Date().toISOString().slice(0, 10)
const uniq8 = () => Math.random().toString(36).slice(2, 10)
const toNum = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null }

// linie editabilă goală
const linieGoala = (tip_material_id = null) => ({
  _k: uniq8(),
  tip_material_id,
  serie: '', sarja: '', dimensiune: '', grad_otel: '',
  lungime_m: '', greutate_kg: '', unghi_curba: '',
  cantitate: 1, observatii: '',
})

export default function ReceptieBucatiModal({
  open, onClose, onSuccess,
  proiectId = null, comandaFurnizorId = null, defaultProvenienta = 'gazpet',
}) {
  const [proiecte, setProiecte] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const [pid, setPid] = useState(proiectId ? String(proiectId) : '')
  const [head, setHead] = useState({
    provenienta: defaultProvenienta, izolatie: 'neizolata', sursa_receptie: 'packing_list',
    furnizor: '', producator: '', nr_document: '', standard: '',
    data_receptie: todayISO(), locatie_tip: 'sediu', fara_packing_list: false,
  })
  const [linii, setLinii] = useState([])
  const [mtcPath, setMtcPath] = useState(null)
  const [ocrInfo, setOcrInfo] = useState(null)   // {count, confidence}
  const [ocrBusy, setOcrBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)       // {kind, msg}
  const fileRef = useRef(null)

  const tipuriMap = useMemo(() => Object.fromEntries(tipuri.map(t => [t.id, t])), [tipuri])
  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])

  const flash = useCallback((kind, msg) => { setToast({ kind, msg }); setTimeout(() => setToast(null), 4200) }, [])
  const setH = (k, v) => setHead(h => ({ ...h, [k]: v }))

  useEffect(() => {
    if (!open) return
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        let prof = null
        if (user) {
          const { data } = await supabase.from('profiles')
            .select('id, role, is_owner, can_process_achizitii').eq('id', user.id).maybeSingle()
          prof = data || null
        }
        const [rProj, rTip] = await Promise.all([
          supabase.from('executie_proiecte').select('id, nume, cod_intern, site_id').order('id'),
          supabase.from('magazie_tipuri_material').select('id, nume, categorie, um_implicit, are_serie, are_lungime, activ').eq('activ', true).order('id'),
        ])
        if (!alive) return
        setProfile(prof)
        setProiecte(rProj.data || [])
        setTipuri(rTip.data || [])
      } catch (e) { console.error(e); if (alive) flash('err', 'Eroare la încărcarea datelor.') }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [open, flash])

  // reset la deschidere/închidere
  useEffect(() => {
    if (!open) return
    setPid(proiectId ? String(proiectId) : '')
    setHead({
      provenienta: defaultProvenienta, izolatie: 'neizolata', sursa_receptie: 'packing_list',
      furnizor: '', producator: '', nr_document: '', standard: '',
      data_receptie: todayISO(), locatie_tip: 'sediu', fara_packing_list: false,
    })
    setLinii([]); setMtcPath(null); setOcrInfo(null)
  }, [open, proiectId, defaultProvenienta])

  // ── OCR packing list ──────────────────────────────────────────────
  const handleFilePick = () => fileRef.current?.click()

  const handleOcr = async (file) => {
    if (!file) return
    if (!pid) { flash('err', 'Alege întâi proiectul.'); return }
    const sizeMb = file.size / 1024 / 1024
    if (sizeMb > 15) { flash('err', `Fișier prea mare (${sizeMb.toFixed(1)}MB, max 15MB).`); return }
    setOcrBusy(true)
    try {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
      const path = `${pid}/${todayISO()}_${uniq8()}.${ext}`
      const { error: eUp } = await supabase.storage.from(BUCKET_PACKING)
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: true })
      if (eUp) throw eUp
      setMtcPath(path)

      const { data, error } = await supabase.functions.invoke('ocr-packing-list', {
        body: { path, bucket: BUCKET_PACKING, comanda_id: comandaFurnizorId || null },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)

      const h = data?.header || {}
      setHead(prev => ({
        ...prev,
        furnizor: prev.furnizor || h.furnizor || '',
        producator: prev.producator || h.producator || '',
        nr_document: prev.nr_document || h.nr_document || '',
        standard: prev.standard || h.standard || '',
        data_receptie: h.data || prev.data_receptie,
      }))
      const noi = (data?.linii || []).map(l => ({
        _k: uniq8(),
        tip_material_id: OCR_TIP_TO_ID[l.tip_material] ?? null,
        serie: l.serie || '', sarja: l.sarja || '', dimensiune: l.dimensiune || '',
        grad_otel: l.grad_otel || '', lungime_m: l.lungime_m ?? '', greutate_kg: l.greutate_kg ?? '',
        unghi_curba: l.unghi_curba ?? '', cantitate: l.cantitate ?? 1, observatii: '',
      }))
      setLinii(prev => [...prev, ...noi])
      setOcrInfo({ count: noi.length, confidence: data?.confidence ?? null })
      flash('ok', `OCR: ${noi.length} bucăți extrase (încredere ${data?.confidence ?? '—'}%). Verifică și corectează înainte de salvare.`)
    } catch (e) {
      console.error(e)
      flash('err', 'OCR eșuat: ' + (e?.message || 'eroare necunoscută') + '. Poți adăuga manual.')
    } finally {
      setOcrBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleFaraPackingList = () => {
    setH('fara_packing_list', true)
    setH('sursa_receptie', 'manual')
    setMtcPath(null); setOcrInfo(null)
    if (linii.length === 0) setLinii([linieGoala()])
    flash('ok', 'Mod „Fără packing list": introdu manual bucățile. Le poți completa ulterior când vine documentul.')
  }

  const addLinie = () => setLinii(prev => [...prev, linieGoala()])
  const updLinie = (k, field, val) => setLinii(prev => prev.map(l => l._k === k ? { ...l, [field]: val } : l))
  const delLinie = (k) => setLinii(prev => prev.filter(l => l._k !== k))

  // ── Salvare ───────────────────────────────────────────────────────
  const validare = () => {
    if (!pid) return 'Alege proiectul.'
    if (linii.length === 0) return 'Nu există nicio bucată de recepționat.'
    for (const l of linii) {
      if (!l.tip_material_id) return 'Fiecare rând trebuie să aibă un tip de material ales.'
      const c = toNum(l.cantitate)
      if (c == null || c <= 0) return 'Cantitatea trebuie să fie > 0 pe fiecare rând.'
    }
    return null
  }

  const handleSave = async () => {
    const err = validare()
    if (err) { flash('err', err); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const proj = proiecteMap[Number(pid)]
      const locatie_site_id = head.locatie_tip === 'proiect' ? (proj?.site_id ?? null) : null

      const rows = linii.map(l => {
        const tip = tipuriMap[l.tip_material_id]
        const lung = tip?.are_lungime ? toNum(l.lungime_m) : null
        return {
          proiect_id: Number(pid),
          comanda_furnizor_id: comandaFurnizorId || null,
          tip_material_id: l.tip_material_id,
          serie: tip?.are_serie ? (l.serie?.trim() || null) : (l.serie?.trim() || null),
          sarja: l.sarja?.trim() || null,
          dimensiune: l.dimensiune?.trim() || null,
          grad_otel: l.grad_otel?.trim() || null,
          standard: head.standard?.trim() || null,
          lungime_m: lung,
          lungime_originala_m: lung,
          greutate_kg: toNum(l.greutate_kg),
          unghi_curba: toNum(l.unghi_curba),
          cantitate: toNum(l.cantitate) ?? 1,
          um: tip?.um_implicit || 'buc',
          provenienta: head.provenienta,
          izolatie: head.izolatie || 'neizolata',
          furnizor: head.furnizor?.trim() || null,
          producator: head.producator?.trim() || null,
          sursa_receptie: head.fara_packing_list ? 'manual' : head.sursa_receptie,
          fara_packing_list: !!head.fara_packing_list,
          nr_document: head.nr_document?.trim() || null,
          data_receptie: head.data_receptie || null,
          mtc_path: mtcPath || null,
          stare: 'sosit',
          locatie_tip: head.locatie_tip,
          locatie_site_id,
          observatii: l.observatii?.trim() || null,
          created_by: user?.id || null,
        }
      })

      const { error } = await supabase.from('magazie_bucati').insert(rows)
      if (error) throw error

      // Dacă recepția vine dintr-o comandă furnizor și am un packing list uploadat,
      // îl atașăm și pe comandă (câmp comenzi_furnizor.packing_list_path).
      if (comandaFurnizorId && mtcPath) {
        try {
          await supabase.from('comenzi_furnizor')
            .update({ packing_list_path: mtcPath, updated_at: new Date().toISOString() })
            .eq('id', comandaFurnizorId)
        } catch (e2) { console.error('packing_list_path update:', e2) /* nu blochează recepția */ }
      }

      flash('ok', `${rows.length} bucăți recepționate (stare „sosit"). Urmează PV recepție cantitativă/calitativă (MP).`)
      onSuccess?.(rows.length)
      setTimeout(() => onClose?.(), 900)
    } catch (e) {
      console.error(e)
      flash('err', 'Salvare eșuată: ' + (e?.message || 'eroare necunoscută'))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const totalBuc = linii.reduce((s, l) => s + (toNum(l.cantitate) || 0), 0)
  const provColor = PROV_META[head.provenienta]?.color || G.muted

  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, background:'rgba(1,4,9,0.78)', zIndex:1000,
      display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 14px', overflowY:'auto',
      fontFamily:"'Syne','Barlow',sans-serif",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background:G.bg, border:`1px solid ${G.border2}`, borderRadius:16, width:'100%', maxWidth:1080,
        color:G.text, boxShadow:'0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'16px 20px', borderBottom:`1px solid ${G.border}` }}>
          <div style={{ width:40, height:40, borderRadius:11, background:G.magazie+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:21 }}>🔍</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:18, fontWeight:800 }}>Recepție materiale pe bucată</div>
            <div style={{ fontSize:12, color:G.muted }}>
              packing list → stoc trasabil (serie + sarjă) · stare inițială „sosit"
              {comandaFurnizorId ? ` · legat de comanda #${comandaFurnizorId}` : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ ...S.btnS, padding:'7px 12px' }}>✕</button>
        </div>

        {loading ? (
          <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă…</div>
        ) : (
          <div style={{ padding:20 }}>
            {/* Proveniență */}
            <div style={{ marginBottom:16 }}>
              <span style={S.label}>Proveniență materiale</span>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                {Object.entries(PROV_META).map(([k, m]) => {
                  const active = head.provenienta === k
                  return (
                    <button key={k} onClick={() => setH('provenienta', k)} style={{
                      flex:'1 1 240px', textAlign:'left', cursor:'pointer', borderRadius:10, padding:'10px 14px',
                      background: active ? m.color+'1A' : G.surface,
                      border:`1.5px solid ${active ? m.color : G.border2}`,
                      color: active ? m.color : G.text,
                    }}>
                      <div style={{ fontSize:13.5, fontWeight:800 }}>{active ? '●' : '○'} {m.label}</div>
                      <div style={{ fontSize:11.5, color:G.muted, marginTop:2 }}>{m.sub}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Header recepție */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:12, marginBottom:16 }}>
              <div>
                <span style={S.label}>Proiect *</span>
                <select style={S.input} value={pid} disabled={!!proiectId} onChange={e => setPid(e.target.value)}>
                  <option value="">— alege proiect —</option>
                  {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? p.cod_intern + ' · ' : ''}{p.nume}</option>)}
                </select>
              </div>
              <div>
                <span style={S.label}>Locație stoc</span>
                <select style={S.input} value={head.locatie_tip} onChange={e => setH('locatie_tip', e.target.value)}>
                  <option value="sediu">🏢 Sediu (Ploiești)</option>
                  <option value="proiect">📍 Pe proiect/șantier</option>
                </select>
              </div>
              <div>
                <span style={S.label}>Furnizor</span>
                <input style={S.input} value={head.furnizor} onChange={e => setH('furnizor', e.target.value)} placeholder="Sintax / IZOCOND / Hatboru…" />
              </div>
              <div>
                <span style={S.label}>Producător (din MTC)</span>
                <input style={S.input} value={head.producator} onChange={e => setH('producator', e.target.value)} placeholder="Cangzhou / Hatboru…" />
              </div>
              <div>
                <span style={S.label}>Nr. document</span>
                <input style={S.input} value={head.nr_document} onChange={e => setH('nr_document', e.target.value)} placeholder="nr packing list / aviz" />
              </div>
              <div>
                <span style={S.label}>Data recepție</span>
                <input type="date" style={S.input} value={head.data_receptie} onChange={e => setH('data_receptie', e.target.value)} />
              </div>
              <div>
                <span style={S.label}>Izolație</span>
                <select style={S.input} value={head.izolatie} onChange={e => setH('izolatie', e.target.value)}>
                  {IZOLATIE_OPT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <span style={S.label}>Tip document sursă</span>
                <select style={S.input} value={head.sursa_receptie} disabled={head.fara_packing_list} onChange={e => setH('sursa_receptie', e.target.value)}>
                  {SURSA_OPT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <span style={S.label}>Standard / grad oțel comun</span>
                <input style={S.input} value={head.standard} onChange={e => setH('standard', e.target.value)} placeholder="EN ISO 3183 L360…" />
              </div>
            </div>

            {/* Acțiuni sursă bucăți */}
            <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:14,
              padding:'12px 14px', background:G.surface, border:`1px solid ${G.border}`, borderRadius:10 }}>
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" style={{ display:'none' }}
                onChange={e => handleOcr(e.target.files?.[0])} />
              <button onClick={handleFilePick} disabled={ocrBusy || !pid} style={{
                ...S.btnP, background: ocrBusy ? G.dim : G.cyan, color:'#04181C',
                opacity: (!pid) ? 0.55 : 1, cursor: (ocrBusy || !pid) ? 'not-allowed' : 'pointer',
              }}>{ocrBusy ? '⏳ Citesc documentul…' : '📷 OCR packing list (Haiku)'}</button>
              <button onClick={addLinie} style={S.btnS}>＋ Adaugă bucată manual</button>
              <button onClick={handleFaraPackingList} style={{ ...S.btnS, color:G.yellow, borderColor:G.yellow+'66' }}>📋 Fără packing list</button>
              <div style={{ flex:1 }} />
              {ocrInfo && <span style={{ fontSize:12, color:G.muted }}>OCR: {ocrInfo.count} linii · încredere {ocrInfo.confidence ?? '—'}%</span>}
              {head.fara_packing_list && <span style={{ fontSize:12, color:G.yellow, fontWeight:700 }}>⚠ fără document (completabil ulterior)</span>}
            </div>

            {/* Listă bucăți */}
            {linii.length === 0 ? (
              <div style={{ padding:'28px 16px', textAlign:'center', color:G.muted, border:`1px dashed ${G.border2}`, borderRadius:10 }}>
                Nicio bucată încă. Folosește <b style={{ color:G.cyan }}>OCR</b>, <b>Adaugă manual</b> sau <b style={{ color:G.yellow }}>Fără packing list</b>.
              </div>
            ) : (
              <div style={{ border:`1px solid ${G.border}`, borderRadius:10, overflow:'hidden' }}>
                <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1.2fr 1fr 1fr 0.8fr 0.7fr 0.7fr 0.6fr 32px',
                  gap:6, padding:'8px 10px', background:G.surface, fontSize:10.5, fontWeight:800, color:G.muted, textTransform:'uppercase', letterSpacing:0.3 }}>
                  <div>Tip material *</div><div>Serie</div><div>Sarjă/Heat</div><div>Dimensiune</div>
                  <div>Lung. (m)</div><div>Unghi °</div><div>Grad oțel</div><div>Cant. *</div><div></div>
                </div>
                <div style={{ maxHeight:320, overflowY:'auto' }}>
                  {linii.map(l => {
                    const tip = tipuriMap[l.tip_material_id]
                    const showLung = tip?.are_lungime
                    const showUnghi = tip?.categorie === 'fiting' && (tip?.nume || '').toLowerCase().includes('curb')
                    return (
                      <div key={l._k} style={{ display:'grid', gridTemplateColumns:'1.6fr 1.2fr 1fr 1fr 0.8fr 0.7fr 0.7fr 0.6fr 32px',
                        gap:6, padding:'6px 10px', borderTop:`1px solid ${G.border}`, alignItems:'center' }}>
                        <select style={{ ...S.input, padding:'6px 8px', fontSize:12.5, borderColor: l.tip_material_id ? G.border2 : G.red }}
                          value={l.tip_material_id || ''} onChange={e => updLinie(l._k, 'tip_material_id', e.target.value ? Number(e.target.value) : null)}>
                          <option value="">— tip —</option>
                          {tipuri.map(t => <option key={t.id} value={t.id}>{t.nume}</option>)}
                        </select>
                        <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.serie} onChange={e => updLinie(l._k, 'serie', e.target.value)} placeholder="serie" />
                        <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.sarja} onChange={e => updLinie(l._k, 'sarja', e.target.value)} placeholder="heat" />
                        <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.dimensiune} onChange={e => updLinie(l._k, 'dimensiune', e.target.value)} placeholder="508x8.0" />
                        <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5, opacity: showLung ? 1 : 0.4 }} value={l.lungime_m} disabled={!showLung} onChange={e => updLinie(l._k, 'lungime_m', e.target.value)} placeholder={showLung ? 'm' : '—'} />
                        <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5, opacity: showUnghi ? 1 : 0.4 }} value={l.unghi_curba} disabled={!showUnghi} onChange={e => updLinie(l._k, 'unghi_curba', e.target.value)} placeholder={showUnghi ? '45' : '—'} />
                        <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.grad_otel} onChange={e => updLinie(l._k, 'grad_otel', e.target.value)} placeholder="L360" />
                        <input style={{ ...S.input, padding:'6px 8px', fontSize:12.5 }} value={l.cantitate} onChange={e => updLinie(l._k, 'cantitate', e.target.value)} />
                        <button onClick={() => delLinie(l._k)} title="Șterge rând" style={{ background:'transparent', border:'none', color:G.red, cursor:'pointer', fontSize:16 }}>🗑</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ display:'flex', alignItems:'center', gap:12, marginTop:18, flexWrap:'wrap' }}>
              <div style={{ fontSize:13, color:G.muted }}>
                <b style={{ color:provColor }}>{linii.length}</b> rânduri · <b style={{ color:G.text }}>{totalBuc}</b> bucăți total
              </div>
              <div style={{ flex:1 }} />
              <button onClick={onClose} style={S.btnS}>Anulează</button>
              <button onClick={handleSave} disabled={saving || linii.length === 0} style={{
                ...S.btnP, background: head.provenienta === 'beneficiar' ? G.blue : G.green,
                color: head.provenienta === 'beneficiar' ? '#04121F' : '#06210F',
                opacity: (saving || linii.length === 0) ? 0.55 : 1,
                cursor: (saving || linii.length === 0) ? 'not-allowed' : 'pointer',
              }}>{saving ? 'Se salvează…' : `✓ Recepționează ${linii.length} rânduri`}</button>
            </div>

            {toast && (
              <div style={{
                marginTop:14, padding:'10px 14px', borderRadius:9, fontSize:13, fontWeight:600,
                background: toast.kind === 'ok' ? G.green+'1A' : G.red+'1A',
                border:`1px solid ${toast.kind === 'ok' ? G.green : G.red}`,
                color: toast.kind === 'ok' ? G.green : G.red,
              }}>{toast.msg}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
