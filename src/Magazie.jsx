// ════════════════════════════════════════════════════════════════════════════
// MODULUL MAGAZIE — v1.0 (13.06.2026)
// Tab MATERIALE (viewer stoc cantitativ, alimentat automat din Achiziții) +
// Tab ECHIPAMENTE (Faza 1): tipuri cu cantitate (merge și EIP în loturi),
// predare/retur pe angajat (reasignabil, istoric). Granița A: ce are regim
// service/QR/ITP stă în logistica_active (flotă), nu aici.
// Următor (etapă viitoare): legătură HR-Inventar + notificare Natalia la
// angajare fără EIP asignat; PV Inventar PDF; consum materiale pe proiect.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import ReceptieBucatiModal from './ReceptieBucatiModal.jsx'
import jsPDF from 'jspdf'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', magazie:'#FF7B72', cyan:'#2FB6C9',
}
const S = {
  page: { fontFamily:"'Syne','Barlow',sans-serif", background:G.bg, minHeight:'100vh', color:G.text },
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'9px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnS: { background:'#161B22', color:'#E6EDF3', border:'1px solid #30363D', borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer' },
  btnP: { background:G.green, color:'#06210F', border:'none', borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:800, cursor:'pointer' },
}
const fmtNr = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ro-RO', { maximumFractionDigits: 2 })
const fmtDataOra = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') + ' ' + x.toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit' }) }
const fmtData = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') }
const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const CAT_META = {
  eip:        { label:'EIP',        emoji:'🦺', color:G.orange },
  scula:      { label:'Sculă',      emoji:'🔧', color:G.blue   },
  echipament: { label:'Echipament', emoji:'⚙️', color:G.purple },
  it:         { label:'IT',         emoji:'💻', color:G.green  },
  altele:     { label:'Altele',     emoji:'📦', color:G.muted  },
}

// ════════════════════════════════════════════════════════════════
// TAB MATERIALE — viewer stoc (logica din v0.5, neatinsă)
// ════════════════════════════════════════════════════════════════
function MaterialeTab() {
  const [loading, setLoading] = useState(true)
  const [stocuri, setStocuri] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [search, setSearch] = useState('')
  const [profile, setProfile] = useState(null)
  const [ajustModal, setAjustModal] = useState(null)   // poziția de stoc (rând)
  const [istoricFor, setIstoricFor] = useState(null)    // poziția de stoc pt istoric
  const [pragFor, setPragFor] = useState(null)          // poziția de stoc pt setare prag minim
  const [costFor, setCostFor] = useState(null)          // poziția de stoc pt setare cost mediu manual
  const [adaugaPoz, setAdaugaPoz] = useState(false)     // modal adăugare poziție nouă
  const [catalog, setCatalog] = useState([])            // materiale din catalog (autocomplete)
  const [furnMap, setFurnMap] = useState({})            // {locatie_tip|locatie_id|material: {ultim, nr, lista}}

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let prof = null
      if (user) {
        const { data } = await supabase.from('profiles')
          .select('id, role, is_owner, can_manage_stoc').eq('id', user.id).maybeSingle()
        prof = data || null
      }
      const [rStoc, rProj, rCat, rFurn] = await Promise.all([
        supabase.from('stocuri').select('*').order('material_denumire'),
        supabase.from('executie_proiecte').select('id, nume, cod_intern'),
        supabase.from('materiale').select('id, cod, denumire, um, activ').eq('activ', true).order('denumire'),
        supabase.from('v_stoc_furnizori').select('*'),
      ])
      setProfile(prof)
      setStocuri(rStoc.data || [])
      setProiecte(rProj.data || [])
      setCatalog(rCat.data || [])
      const fm = {}
      for (const r of (rFurn.data || [])) {
        fm[`${r.locatie_tip}|${r.locatie_id}|${r.material_denumire}`] = { ultim: r.furnizor_ultim, nr: r.nr_furnizori, lista: r.furnizori_lista }
      }
      setFurnMap(fm)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // Gate ajustare: owner SAU can_manage_stoc (flag setat din Admin)
  const canManage = !!(profile?.is_owner || profile?.can_manage_stoc)

  // Ștergere poziție de stoc (canManage) — pentru teste / poziții greșite.
  // stocuri_miscari nu are FK spre stocuri (legătură pe triplet locatie_tip +
  // locatie_id + material_denumire) → curățăm și istoricul, altfel rămâne orfan.
  const deleteStoc = useCallback(async (s) => {
    if (!window.confirm(`Ștergi definitiv poziția „${s.material_denumire}" (${fmtNr(s.cantitate)} ${s.um || ''})?\n\nSe șterge și istoricul de mișcări al poziției. Acțiunea e IREVERSIBILĂ.`)) return
    try {
      let qM = supabase.from('stocuri_miscari').delete()
        .eq('locatie_tip', s.locatie_tip).eq('material_denumire', s.material_denumire)
      qM = s.locatie_id == null ? qM.is('locatie_id', null) : qM.eq('locatie_id', s.locatie_id)
      const { error: eM } = await qM
      if (eM) throw eM
      const { error } = await supabase.from('stocuri').delete().eq('id', s.id)
      if (error) throw error
      await loadAll()
    } catch (e) { console.error(e); alert('Eroare la ștergere: ' + (e.message || e)) }
  }, [loadAll])

  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])

  const grupe = useMemo(() => {
    // Căutare pe denumire material + furnizori (ultim + lista completă din v_stoc_furnizori)
    const filtered = search
      ? stocuri.filter(s => {
          const f = furnMap[`${s.locatie_tip}|${s.locatie_id}|${s.material_denumire}`]
          const hay = normalize([s.material_denumire, f?.ultim, f?.lista].filter(Boolean).join(' '))
          return hay.includes(normalize(search))
        })
      : stocuri
    const map = new Map()
    for (const s of filtered) {
      const key = s.locatie_tip === 'sediu' ? 'sediu' : `proiect_${s.locatie_id}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(s)
    }
    const out = []
    if (map.has('sediu')) out.push({ key:'sediu', titlu:'🏢 Stoc Sediu (Ploiești)', items: map.get('sediu') })
    const proiKeys = [...map.keys()].filter(k => k !== 'sediu')
      .sort((a, b) => map.get(b).length - map.get(a).length)
    for (const k of proiKeys) {
      const pid = Number(k.replace('proiect_', ''))
      const p = proiecteMap[pid]
      out.push({ key:k, titlu:`🏗️ ${p ? `${p.cod_intern ? `[${p.cod_intern}] ` : ''}${p.nume}` : `Proiect #${pid}`}`, items: map.get(k) })
    }
    return out
  }, [stocuri, search, proiecteMap, furnMap])

  const totalPozitii = stocuri.length
  const totalLocatii = new Set(stocuri.map(s => s.locatie_tip === 'sediu' ? 'sediu' : `p${s.locatie_id}`)).size
  const ultimaMiscar = stocuri.reduce((acc, s) => (!acc || new Date(s.updated_at) > new Date(acc)) ? s.updated_at : acc, null)
  const valoareTotala = stocuri.reduce((acc, s) => acc + (s.cost_mediu != null ? Number(s.cantitate) * Number(s.cost_mediu) : 0), 0)
  const fmtLei = (n) => fmtNr(Math.round(n)) + ' lei'

  return (
    <>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        {[
          ['📋', 'Poziții în stoc', totalPozitii, G.magazie],
          ['📍', 'Locații cu stoc', totalLocatii, G.blue],
          ['💰', 'Valoare stoc', valoareTotala > 0 ? fmtLei(valoareTotala) : '—', G.green],
          ['🕐', 'Ultima mișcare', ultimaMiscar ? fmtDataOra(ultimaMiscar) : '—', G.dim],
        ].map(([e, l, v, c], i) => (
          <div key={i} style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:150 }}>
            <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>{e} {l}</div>
            <div style={{ fontSize: typeof v === 'number' ? 24 : 15, fontWeight:800, color:c }}>{v}</div>
          </div>
        ))}
        <div style={{ display:'flex', flexDirection:'column', gap:8, justifyContent:'center' }}>
          {canManage && <button onClick={() => setAdaugaPoz(true)} style={{ ...S.btnP, background:G.magazie, color:'#3a0d0a', fontSize:13, whiteSpace:'nowrap' }}>➕ Adaugă poziție</button>}
          <button onClick={loadAll} style={{ ...S.btnS, fontSize:14 }}>🔄 Reîncarcă</button>
        </div>
      </div>

      <div style={{ marginBottom:14 }}>
        <input style={{ ...S.input, maxWidth:380 }} placeholder="🔍 Caută material sau furnizor în toate locațiile..." value={search} onChange={e => setSearch(e.target.value)} />
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
        const valGrup = gr.items.reduce((acc, s) => acc + (s.cost_mediu != null ? Number(s.cantitate) * Number(s.cost_mediu) : 0), 0)
        const partial = gr.items.some(s => s.cost_mediu == null) && valGrup > 0
        return (
        <div key={gr.key} style={{ ...S.card, overflow:'hidden', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:`1px solid ${G.border}`, background:G.bg }}>
            <div style={{ fontSize:15, fontWeight:800, flex:1 }}>{gr.titlu}</div>
            {valGrup > 0 && <span style={{ color:G.green, fontSize:13, fontWeight:800 }}>{fmtLei(valGrup)}{partial && <span style={{ color:G.dim, fontWeight:600 }}> *</span>}</span>}
            <span style={{ background:G.magazie + '22', color:G.magazie, border:`1px solid ${G.magazie}55`, borderRadius:14, padding:'3px 12px', fontSize:12, fontWeight:800 }}>{gr.items.length} {gr.items.length === 1 ? 'poziție' : 'poziții'}</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 70px 120px 130px 110px 230px', gap:10, padding:'8px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Material</div><div>UM</div><div style={{ textAlign:'right' }}>Cantitate</div><div style={{ textAlign:'right' }}>Valoare</div><div>Actualizat</div><div></div>
          </div>
          {gr.items.map(s => {
            const val = s.cost_mediu != null ? Number(s.cantitate) * Number(s.cost_mediu) : null
            return (
            <div key={s.id} style={{ display:'grid', gridTemplateColumns:'1fr 70px 120px 130px 110px 230px', gap:10, alignItems:'center', padding:'10px 16px', fontSize:13.5, borderBottom:`1px solid ${G.border}` }}>
              <div style={{ fontWeight:600 }}>{s.material_denumire}{s.observatii && <div style={{ fontSize:11, color:G.muted }}>{s.observatii}</div>}{(() => {
                const fz = furnMap[`${s.locatie_tip}|${s.locatie_id}|${s.material_denumire}`]
                if (!fz || !fz.ultim) return null
                return <div style={{ fontSize:11, color:G.dim }} title={fz.lista || fz.ultim}>🏭 {fz.ultim}{fz.nr > 1 && <span style={{ color:G.muted }}> +{fz.nr - 1}</span>}</div>
              })()}</div>
              <div style={{ color:G.muted }}>{s.um || '—'}</div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontWeight:800, fontSize:15, color: Number(s.cantitate) > 0 ? G.green : G.red }}>{fmtNr(s.cantitate)}</div>
                {s.prag_minim != null && Number(s.cantitate) < Number(s.prag_minim) && (
                  <div style={{ fontSize:10, fontWeight:800, color:G.red }}>⚠ sub prag ({fmtNr(s.prag_minim)})</div>
                )}
                {s.prag_minim != null && Number(s.cantitate) >= Number(s.prag_minim) && (
                  <div style={{ fontSize:10, color:G.dim }}>prag {fmtNr(s.prag_minim)}</div>
                )}
              </div>
              <div style={{ textAlign:'right' }}>
                {val != null ? (
                  <>
                    <div style={{ fontWeight:700, fontSize:13.5, color:G.green }}>{fmtLei(val)}</div>
                    <div style={{ fontSize:10, color:G.dim }}>{fmtNr(s.cost_mediu)}/{s.um || 'buc'}</div>
                  </>
                ) : <span style={{ fontSize:11, color:G.dim }}>fără cost</span>}
              </div>
              <div style={{ fontSize:12, color:G.dim }}>{fmtDataOra(s.updated_at)}</div>
              <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                <button onClick={() => setIstoricFor(s)} title="Istoric mișcări"
                  style={{ ...S.btnS, padding:'5px 9px', fontSize:12 }}>📜</button>
                {canManage && (
                  <button onClick={() => setCostFor(s)} title="Cost mediu"
                    style={{ ...S.btnS, padding:'5px 9px', fontSize:12, color:G.green, borderColor:G.green + '66' }}>💰</button>
                )}
                {canManage && (
                  <button onClick={() => setPragFor(s)} title="Setează prag minim"
                    style={{ ...S.btnS, padding:'5px 9px', fontSize:12, color:G.yellow, borderColor:G.yellow + '66' }}>🎯</button>
                )}
                {canManage && (
                  <button onClick={() => setAjustModal(s)} title="Ajustează stoc (+/-)"
                    style={{ ...S.btnS, padding:'5px 9px', fontSize:12, color:G.magazie, borderColor:G.magazie + '66' }}>±</button>
                )}
                {profile?.is_owner && (
                  <button onClick={() => deleteStoc(s)} title="Șterge poziția (ireversibil, doar owner)"
                    style={{ ...S.btnS, padding:'5px 9px', fontSize:12, color:G.red, borderColor:G.red + '55' }}>🗑</button>
                )}
              </div>
            </div>
          )})}
        </div>
      )})}

      <div style={{ padding:14, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:12, color:G.muted, lineHeight:1.7, marginTop:6 }}>
        <b style={{ color:G.text }}>💰 Valoare stoc:</b> cost mediu ponderat (WAC) — se recalculează automat la fiecare recepție cu preț din Achiziții.
        Pentru stocul deja existent fără preț, folosește 💰 ca să setezi costul; de acolo intrările viitoare îl ajustează singure.
        Poziții fără cost nu intră în total (marcate cu <b>*</b> la nivel de locație).
      </div>

      {adaugaPoz && (
        <AdaugaPozitieModal proiecteMap={proiecteMap} catalog={catalog}
          onClose={() => setAdaugaPoz(false)} onDone={() => { setAdaugaPoz(false); loadAll() }} />
      )}
      {ajustModal && (
        <AjustareModal
          poz={ajustModal}
          onClose={() => setAjustModal(null)}
          onDone={() => { setAjustModal(null); loadAll() }}
        />
      )}
      {istoricFor && (
        <IstoricDrawer poz={istoricFor} onClose={() => setIstoricFor(null)} />
      )}
      {pragFor && (
        <PragModal poz={pragFor} onClose={() => setPragFor(null)} onDone={() => { setPragFor(null); loadAll() }} />
      )}
      {costFor && (
        <CostModal poz={costFor} onClose={() => setCostFor(null)} onDone={() => { setCostFor(null); loadAll() }} />
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL: Ajustare stoc +/- (motiv obligatoriu) → fn_stoc_ajustare
// ════════════════════════════════════════════════════════════════
function AjustareModal({ poz, onClose, onDone }) {
  const [sens, setSens] = useState('plus')          // 'plus' | 'minus'
  const [cant, setCant] = useState('')
  const [motiv, setMotiv] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const stocCurent = Number(poz.cantitate || 0)
  const delta = sens === 'plus' ? Math.abs(Number(cant) || 0) : -Math.abs(Number(cant) || 0)
  const stocNou = stocCurent + delta
  const subZero = stocNou < 0
  const valid = Number(cant) > 0 && motiv.trim().length > 0

  const aplica = async () => {
    if (!valid) { setErr('Completează cantitatea (>0) și motivul.'); return }
    if (subZero && !window.confirm(`Atenție: stocul devine NEGATIV (${fmtNr(stocNou)} ${poz.um || ''}). Continui?`)) return
    setBusy(true); setErr('')
    try {
      const { data, error } = await supabase.rpc('fn_stoc_ajustare', {
        p_locatie_tip: poz.locatie_tip,
        p_locatie_id: poz.locatie_id ?? null,
        p_material: poz.material_denumire,
        p_um: poz.um || null,
        p_delta: delta,
        p_motiv: motiv.trim(),
      })
      if (error) throw error
      onDone(data)
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(460px,100%)', padding:22 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:4 }}>± Ajustează stoc</div>
        <div style={{ fontSize:13, color:G.muted, marginBottom:16 }}>{poz.material_denumire}</div>

        <div style={{ display:'flex', gap:8, marginBottom:14 }}>
          {[['plus', '➕ Adaugă', G.green], ['minus', '➖ Scade', G.red]].map(([v, t, c]) => (
            <button key={v} onClick={() => setSens(v)} style={{
              flex:1, padding:'10px', borderRadius:8, fontWeight:700, fontSize:14, cursor:'pointer',
              background: sens === v ? c + '22' : G.bg, color: sens === v ? c : G.muted,
              border:`1px solid ${sens === v ? c : G.border2}`,
            }}>{t}</button>
          ))}
        </div>

        <div style={{ display:'flex', gap:10, marginBottom:14 }}>
          <div style={{ flex:1 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Cantitate ({poz.um || 'buc'})</label>
            <input type="number" min="0" step="any" autoFocus style={S.input} value={cant} onChange={e => setCant(e.target.value)} placeholder="0" />
          </div>
          <div style={{ width:140 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Stoc nou</label>
            <div style={{ ...S.input, display:'flex', alignItems:'center', fontWeight:800, color: subZero ? G.red : stocNou > stocCurent ? G.green : G.text }}>{fmtNr(stocNou)}</div>
          </div>
        </div>

        <div style={{ marginBottom:8 }}>
          <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Motiv <span style={{ color:G.red }}>*</span></label>
          <textarea style={{ ...S.input, minHeight:60, resize:'vertical' }} value={motiv} onChange={e => setMotiv(e.target.value)} placeholder="ex: inventar fizic, deteriorare, corecție eroare recepție…" />
        </div>

        {subZero && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12, color:G.red, marginBottom:8 }}>⚠️ Stocul rezultat e negativ — vei fi întrebat de confirmare.</div>}
        {err && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginBottom:8 }}>{err}</div>}

        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:8 }}>
          <button onClick={onClose} disabled={busy} style={S.btnS}>Anulează</button>
          <button onClick={aplica} disabled={busy || !valid} style={{ ...S.btnP, background:G.magazie, color:'#3a0d0a', opacity: (busy || !valid) ? .6 : 1 }}>{busy ? '...' : 'Aplică ajustarea'}</button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// MODAL: Prag minim per poziție de stoc (alertă când scade sub)
// ════════════════════════════════════════════════════════════════
function PragModal({ poz, onClose, onDone }) {
  const [prag, setPrag] = useState(poz.prag_minim != null ? String(poz.prag_minim) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const salveaza = async (clear) => {
    setBusy(true); setErr('')
    try {
      const val = clear ? null : (prag.trim() === '' ? null : Math.abs(Number(prag)))
      if (!clear && val != null && (isNaN(val) || val < 0)) { setErr('Prag invalid.'); setBusy(false); return }
      const { error } = await supabase.from('stocuri').update({ prag_minim: val }).eq('id', poz.id)
      if (error) throw error
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  const subPrag = prag.trim() !== '' && Number(poz.cantitate) < Number(prag)

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ ...S.card, width:'min(440px,100%)', padding:22 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:4 }}>🎯 Prag minim</div>
        <div style={{ fontSize:13, color:G.muted, marginBottom:16 }}>{poz.material_denumire} · stoc curent <b style={{ color:G.text }}>{fmtNr(poz.cantitate)} {poz.um || ''}</b></div>

        <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Prag minim ({poz.um || 'buc'}) — gol = fără alertă</label>
        <input type="number" min="0" step="any" autoFocus style={S.input} value={prag} onChange={e => setPrag(e.target.value)} placeholder="ex: 50" />

        {subPrag && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginTop:10 }}>⚠️ Cu acest prag, poziția e deja sub minim.</div>}
        {err && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginTop:10 }}>{err}</div>}

        <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginTop:16 }}>
          <button onClick={() => salveaza(true)} disabled={busy || poz.prag_minim == null} style={{ ...S.btnS, color:G.red, opacity:(busy || poz.prag_minim == null) ? .5 : 1 }}>Șterge prag</button>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} disabled={busy} style={S.btnS}>Anulează</button>
            <button onClick={() => salveaza(false)} disabled={busy} style={{ ...S.btnP, background:G.yellow, color:'#3a2e05', opacity: busy ? .6 : 1 }}>{busy ? '...' : 'Salvează prag'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// DRAWER: Istoric mișcări per material (stocuri_miscari)
// ════════════════════════════════════════════════════════════════
const MISCARE_META = {
  intrare_achizitie: { label:'Intrare achiziție', emoji:'📥', color:'#3FB950' },
  ajustare_plus:     { label:'Ajustare +',        emoji:'➕', color:'#3FB950' },
  ajustare_minus:    { label:'Ajustare −',        emoji:'➖', color:'#F85149' },
  transfer_out:      { label:'Transfer ieșire',   emoji:'📤', color:'#F0883E' },
  transfer_in:       { label:'Transfer intrare',  emoji:'📥', color:'#58A6FF' },
  consum_proiect:    { label:'Consum proiect',    emoji:'🔧', color:'#F85149' },
  corectie_initiala: { label:'Sold deschidere',   emoji:'🏁', color:'#8B949E' },
}
function IstoricDrawer({ poz, onClose }) {
  const [loading, setLoading] = useState(true)
  const [miscari, setMiscari] = useState([])
  const [profiles, setProfiles] = useState({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        let q = supabase.from('stocuri_miscari').select('*')
          .eq('locatie_tip', poz.locatie_tip)
          .eq('material_denumire', poz.material_denumire)
          .order('created_at', { ascending: false })
        q = poz.locatie_id == null ? q.is('locatie_id', null) : q.eq('locatie_id', poz.locatie_id)
        const { data } = await q
        const rows = data || []
        const uids = [...new Set(rows.map(r => r.created_by).filter(Boolean))]
        let pmap = {}
        if (uids.length) {
          const { data: ps } = await supabase.from('profiles').select('id, name').in('id', uids)
          ;(ps || []).forEach(p => { pmap[p.id] = p.name })
        }
        if (!cancelled) { setMiscari(rows); setProfiles(pmap) }
      } catch (e) { console.error(e) } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [poz])

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', justifyContent:'flex-end' }} onClick={onClose}>
      <div style={{ width:'min(520px,100%)', height:'100%', background:G.surface, borderLeft:`1px solid ${G.border}`, padding:22, overflowY:'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:6 }}>
          <div>
            <div style={{ fontSize:17, fontWeight:800 }}>📜 Istoric mișcări</div>
            <div style={{ fontSize:13, color:G.muted, marginTop:2 }}>{poz.material_denumire}</div>
          </div>
          <button onClick={onClose} style={{ ...S.btnS, padding:'6px 10px', fontSize:18, lineHeight:1 }}>✕</button>
        </div>
        <div style={{ fontSize:13, color:G.muted, marginBottom:16 }}>Stoc curent: <b style={{ color: Number(poz.cantitate) > 0 ? G.green : G.red }}>{fmtNr(poz.cantitate)} {poz.um || ''}</b></div>

        {loading && <div style={{ padding:30, textAlign:'center', color:G.muted }}>Se încarcă...</div>}
        {!loading && !miscari.length && <div style={{ padding:30, textAlign:'center', color:G.muted }}>Nicio mișcare înregistrată.</div>}

        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {miscari.map(m => {
            const meta = MISCARE_META[m.tip] || { label:m.tip, emoji:'•', color:G.muted }
            const poz = Number(m.delta) >= 0
            return (
              <div key={m.id} style={{ ...S.card, background:G.bg, padding:'10px 14px', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ fontSize:20 }}>{meta.emoji}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:meta.color }}>{meta.label}</div>
                  {m.motiv && <div style={{ fontSize:12, color:G.muted }}>{m.motiv}</div>}
                  <div style={{ fontSize:11, color:G.dim, marginTop:2 }}>{fmtDataOra(m.created_at)}{m.created_by && profiles[m.created_by] ? ` · ${profiles[m.created_by]}` : ''}</div>
                </div>
                <div style={{ fontWeight:800, fontSize:15, color: poz ? G.green : G.red, whiteSpace:'nowrap' }}>{poz ? '+' : ''}{fmtNr(m.delta)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB ECHIPAMENTE — Faza 1: tipuri + predare/retur pe angajat
// ════════════════════════════════════════════════════════════════
function EchipamenteTab() {
  const [loading, setLoading] = useState(true)
  const [echipamente, setEchipamente] = useState([])
  const [asignari, setAsignari] = useState([])
  const [employees, setEmployees] = useState([])
  const [uid, setUid] = useState(null)
  const [search, setSearch] = useState('')
  const [filtruCat, setFiltruCat] = useState('toate')
  const [expandId, setExpandId] = useState(null)
  const [editModal, setEditModal] = useState(null)   // obiect echipament sau {} pt nou
  const [predaModal, setPredaModal] = useState(null)  // echipamentul către care predăm
  const [busy, setBusy] = useState(false)
  const [furnMap, setFurnMap] = useState({})          // {echipament_id: furnizor}

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [rEch, rAsig, rEmp, rUser, rFurn] = await Promise.all([
        supabase.from('v_magazie_echipamente').select('*').order('denumire'),
        supabase.from('v_magazie_inventar_activ').select('*').is('data_retur', null),
        supabase.from('employees').select('id, name, functie').order('name'),
        supabase.auth.getUser(),
        supabase.from('v_echipament_furnizor').select('*'),
      ])
      setEchipamente(rEch.data || [])
      setAsignari(rAsig.data || [])
      setEmployees(rEmp.data || [])
      setUid(rUser.data?.user?.id || null)
      const fm = {}
      for (const r of (rFurn.data || [])) fm[r.echipament_id] = r.furnizor
      setFurnMap(fm)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const asignariPerEchip = useMemo(() => {
    const m = new Map()
    for (const a of asignari) {
      if (!m.has(a.echipament_id)) m.set(a.echipament_id, [])
      m.get(a.echipament_id).push(a)
    }
    return m
  }, [asignari])

  const filtered = useMemo(() => {
    let list = echipamente
    if (filtruCat !== 'toate') list = list.filter(e => e.categorie === filtruCat)
    if (search) list = list.filter(e => normalize(e.denumire).includes(normalize(search)) || normalize(e.serie).includes(normalize(search)))
    return list
  }, [echipamente, filtruCat, search])

  const kpi = useMemo(() => ({
    tipuri: echipamente.length,
    bucati: echipamente.reduce((s, e) => s + Number(e.cantitate_total || 0), 0),
    asignate: echipamente.reduce((s, e) => s + Number(e.cantitate_asignata || 0), 0),
    disponibile: echipamente.reduce((s, e) => s + Number(e.cantitate_disponibila || 0), 0),
    eip: echipamente.filter(e => e.este_eip).length,
  }), [echipamente])

  const saveEchip = async (form) => {
    setBusy(true)
    try {
      const payload = {
        denumire: form.denumire.trim(),
        categorie: form.categorie,
        este_eip: form.categorie === 'eip' ? true : !!form.este_eip,
        um: form.um.trim() || 'buc',
        serie: form.serie?.trim() || null,
        cantitate_total: Number(form.cantitate_total) || 0,
        stare: form.stare,
        observatii: form.observatii?.trim() || null,
      }
      if (form.id) {
        const { error } = await supabase.from('magazie_echipamente').update(payload).eq('id', form.id)
        if (error) throw error
      } else {
        payload.created_by = uid
        const { error } = await supabase.from('magazie_echipamente').insert(payload)
        if (error) throw error
      }
      setEditModal(null)
      await loadAll()
    } catch (e) { alert('Eroare salvare: ' + e.message) } finally { setBusy(false) }
  }

  const stergeEchip = async (e) => {
    if (!window.confirm(`Ștergi „${e.denumire}" din evidență? (asignările active se șterg odată cu el)`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('magazie_echipamente').update({ activ: false }).eq('id', e.id)
      if (error) throw error
      await loadAll()
    } catch (err) { alert('Eroare: ' + err.message) } finally { setBusy(false) }
  }

  const predaCatre = async (echip, employeeId, cantitate, observatii) => {
    setBusy(true)
    try {
      const { error } = await supabase.from('magazie_inventar_angajat').insert({
        echipament_id: echip.id, employee_id: Number(employeeId),
        cantitate: Number(cantitate) || 1, predat_de: uid, observatii: observatii?.trim() || null,
      })
      if (error) throw error
      setPredaModal(null)
      await loadAll()
    } catch (e) { alert('Eroare predare: ' + e.message) } finally { setBusy(false) }
  }

  const returneaza = async (asig) => {
    if (!window.confirm(`Confirmi returul „${asig.echipament_denumire}" de la ${asig.employee_name}?`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('magazie_inventar_angajat')
        .update({ data_retur: new Date().toISOString().slice(0, 10) }).eq('id', asig.id)
      if (error) throw error
      await loadAll()
    } catch (e) { alert('Eroare retur: ' + e.message) } finally { setBusy(false) }
  }

  return (
    <>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        {[
          ['📦', 'Tipuri', kpi.tipuri, G.magazie],
          ['🔢', 'Bucăți total', kpi.bucati, G.blue],
          ['✅', 'Disponibile', kpi.disponibile, G.green],
          ['👤', 'Asignate', kpi.asignate, G.purple],
          ['🦺', 'Tipuri EIP', kpi.eip, G.orange],
        ].map(([e, l, v, c], i) => (
          <div key={i} style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:130 }}>
            <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>{e} {l}</div>
            <div style={{ fontSize:24, fontWeight:800, color:c }}>{fmtNr(v)}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
        <input style={{ ...S.input, maxWidth:300 }} placeholder="🔍 Caută echipament / serie..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...S.input, maxWidth:170 }} value={filtruCat} onChange={e => setFiltruCat(e.target.value)}>
          <option value="toate">Toate categoriile</option>
          {Object.entries(CAT_META).map(([k, m]) => <option key={k} value={k}>{m.emoji} {m.label}</option>)}
        </select>
        <div style={{ flex:1 }} />
        <button onClick={loadAll} style={{ ...S.btnS }}>🔄</button>
        <button onClick={() => setEditModal({ denumire:'', categorie:'echipament', este_eip:false, um:'buc', serie:'', cantitate_total:1, stare:'functional', observatii:'' })} style={{ ...S.btnP }}>+ Echipament</button>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă echipamentele...</div>}

      {!loading && !filtered.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🧰</div>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>{search || filtruCat !== 'toate' ? 'Niciun echipament pe filtrele curente.' : 'Niciun echipament în evidență încă.'}</div>
          {!search && filtruCat === 'toate' && <div style={{ fontSize:13, color:G.muted }}>Adaugă cu „+ Echipament" sau intră automat din Achiziții (linii de tip echipament).</div>}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ ...S.card, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 130px 80px 80px 80px 150px', gap:10, padding:'10px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Echipament</div><div>Categorie</div><div style={{ textAlign:'center' }}>Total</div><div style={{ textAlign:'center' }}>Disp.</div><div style={{ textAlign:'center' }}>Asig.</div><div style={{ textAlign:'right' }}>Acțiuni</div>
          </div>
          {filtered.map(e => {
            const cat = CAT_META[e.categorie] || CAT_META.altele
            const asigList = asignariPerEchip.get(e.id) || []
            const expanded = expandId === e.id
            return (
              <div key={e.id} style={{ borderBottom:`1px solid ${G.border}` }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 130px 80px 80px 80px 150px', gap:10, alignItems:'center', padding:'10px 16px', fontSize:13.5 }}>
                  <div>
                    <div style={{ fontWeight:600, display:'flex', alignItems:'center', gap:8 }}>
                      {e.denumire}
                      {e.este_eip && <span style={{ background:G.orange + '22', color:G.orange, borderRadius:6, padding:'1px 7px', fontSize:10, fontWeight:800 }}>EIP</span>}
                      {e.stare !== 'functional' && <span style={{ background:G.red + '22', color:G.red, borderRadius:6, padding:'1px 7px', fontSize:10, fontWeight:800 }}>{e.stare}</span>}
                    </div>
                    {e.serie && <div style={{ fontSize:11, color:G.dim }}>serie/inv: {e.serie}</div>}
                    {furnMap[e.id] && <div style={{ fontSize:11, color:G.dim }}>🏭 {furnMap[e.id]}</div>}
                  </div>
                  <div><span style={{ background:cat.color + '22', color:cat.color, borderRadius:6, padding:'2px 9px', fontSize:11, fontWeight:700 }}>{cat.emoji} {cat.label}</span></div>
                  <div style={{ textAlign:'center', fontWeight:700 }}>{fmtNr(e.cantitate_total)} <span style={{ fontSize:10, color:G.dim }}>{e.um}</span></div>
                  <div style={{ textAlign:'center', fontWeight:800, color: Number(e.cantitate_disponibila) > 0 ? G.green : G.dim }}>{fmtNr(e.cantitate_disponibila)}</div>
                  <div style={{ textAlign:'center', fontWeight:700, color: Number(e.cantitate_asignata) > 0 ? G.purple : G.dim }}>{fmtNr(e.cantitate_asignata)}</div>
                  <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                    <button onClick={() => setPredaModal(e)} disabled={Number(e.cantitate_disponibila) <= 0} title="Predă către angajat"
                      style={{ ...S.btnS, padding:'5px 10px', fontSize:12, opacity: Number(e.cantitate_disponibila) <= 0 ? .4 : 1, color:G.green, borderColor:G.green + '66' }}>👤 Predă</button>
                    <button onClick={() => setExpandId(expanded ? null : e.id)} style={{ ...S.btnS, padding:'5px 10px', fontSize:12 }}>{expanded ? '▲' : `▾ ${asigList.length}`}</button>
                    <button onClick={() => setEditModal({ ...e, este_eip: !!e.este_eip })} style={{ ...S.btnS, padding:'5px 10px', fontSize:12 }}>✏️</button>
                    <button onClick={() => stergeEchip(e)} style={{ ...S.btnS, padding:'5px 10px', fontSize:12, color:G.red, borderColor:G.red + '44' }}>🗑</button>
                  </div>
                </div>
                {expanded && (
                  <div style={{ background:G.bg, padding:'8px 16px 14px 16px' }}>
                    <div style={{ fontSize:11, color:G.dim, fontWeight:700, margin:'4px 0 8px' }}>CINE ARE ACUM ({asigList.length})</div>
                    {!asigList.length && <div style={{ fontSize:12.5, color:G.muted, fontStyle:'italic' }}>Nicio bucată asignată — toate sunt în magazie.</div>}
                    {asigList.map(a => (
                      <div key={a.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'7px 10px', background:G.surface, border:`1px solid ${G.border}`, borderRadius:8, marginBottom:6, fontSize:12.5 }}>
                        <span style={{ fontWeight:600, flex:1 }}>👤 {a.employee_name}{a.employee_functie && <span style={{ color:G.dim, fontWeight:400 }}> · {a.employee_functie}</span>}</span>
                        <span style={{ color:G.purple, fontWeight:700 }}>{fmtNr(a.cantitate)} {e.um}</span>
                        <span style={{ color:G.dim, fontSize:11 }}>din {fmtData(a.data_predare)}</span>
                        <button onClick={() => returneaza(a)} disabled={busy} style={{ ...S.btnS, padding:'4px 10px', fontSize:11, color:G.yellow, borderColor:G.yellow + '55' }}>↩ Retur</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ padding:14, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:12, color:G.muted, lineHeight:1.7, marginTop:14 }}>
        <b style={{ color:G.text }}>🔮 Etapă viitoare:</b> intrare automată din Achiziții (linii de tip echipament), PV Inventar PDF la predare,
        legătură HR-Inventar (oglindă per angajat) + notificare Natalia la angajare fără EIP asignat. Granița cu flota: ce are regim service/QR/ITP stă în Logistică, nu aici.
      </div>

      {editModal && <EchipModal initial={editModal} busy={busy} onSave={saveEchip} onClose={() => setEditModal(null)} />}
      {predaModal && <PredaModal echip={predaModal} employees={employees} busy={busy} onPreda={predaCatre} onClose={() => setPredaModal(null)} />}
    </>
  )
}

// ── Modal adăugare/editare echipament ──
function EchipModal({ initial, busy, onSave, onClose }) {
  const [f, setF] = useState(initial)
  const valid = f.denumire.trim().length > 0 && Number(f.cantitate_total) >= 0
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }} onClick={onClose}>
      <div style={{ ...S.card, padding:22, maxWidth:480, width:'100%' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:16 }}>{f.id ? '✏️ Editează echipament' : '➕ Echipament nou'}</div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div><label style={{ fontSize:12, color:G.muted }}>Denumire *</label><input style={S.input} value={f.denumire} onChange={e => setF({ ...f, denumire:e.target.value })} placeholder="ex: Cască protecție galbenă" /></div>
          <div style={{ display:'flex', gap:10 }}>
            <div style={{ flex:1 }}><label style={{ fontSize:12, color:G.muted }}>Categorie</label>
              <select style={S.input} value={f.categorie} onChange={e => setF({ ...f, categorie:e.target.value, este_eip: e.target.value === 'eip' ? true : f.este_eip })}>
                {Object.entries(CAT_META).map(([k, m]) => <option key={k} value={k}>{m.emoji} {m.label}</option>)}
              </select>
            </div>
            <div style={{ width:120 }}><label style={{ fontSize:12, color:G.muted }}>UM</label><input style={S.input} value={f.um} onChange={e => setF({ ...f, um:e.target.value })} placeholder="buc" /></div>
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={f.categorie === 'eip' || f.este_eip} disabled={f.categorie === 'eip'} onChange={e => setF({ ...f, este_eip:e.target.checked })} />
            🦺 Echipament de protecția muncii (EIP) <span style={{ fontSize:11, color:G.dim }}>— pentru notificarea HR la angajare</span>
          </label>
          <div style={{ display:'flex', gap:10 }}>
            <div style={{ flex:1 }}><label style={{ fontSize:12, color:G.muted }}>Cantitate total</label><input type="number" min="0" style={S.input} value={f.cantitate_total} onChange={e => setF({ ...f, cantitate_total:e.target.value })} /></div>
            <div style={{ flex:1 }}><label style={{ fontSize:12, color:G.muted }}>Serie / nr. inventar</label><input style={S.input} value={f.serie || ''} onChange={e => setF({ ...f, serie:e.target.value })} placeholder="opțional" /></div>
          </div>
          <div><label style={{ fontSize:12, color:G.muted }}>Stare</label>
            <select style={S.input} value={f.stare} onChange={e => setF({ ...f, stare:e.target.value })}>
              <option value="functional">✅ Funcțional</option><option value="defect">⚠️ Defect</option><option value="casat">❌ Casat</option>
            </select>
          </div>
          <div><label style={{ fontSize:12, color:G.muted }}>Observații</label><input style={S.input} value={f.observatii || ''} onChange={e => setF({ ...f, observatii:e.target.value })} /></div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18 }}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={() => onSave(f)} disabled={!valid || busy} style={{ ...S.btnP, opacity: (!valid || busy) ? .5 : 1 }}>{busy ? 'Se salvează...' : '✓ Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Modal predare către angajat ──
function PredaModal({ echip, employees, busy, onPreda, onClose }) {
  const [empSearch, setEmpSearch] = useState('')
  const [empId, setEmpId] = useState('')
  const [cant, setCant] = useState(1)
  const [obs, setObs] = useState('')
  const filtered = useMemo(() => {
    if (!empSearch) return employees.slice(0, 50)
    return employees.filter(e => normalize(e.name).includes(normalize(empSearch))).slice(0, 50)
  }, [employees, empSearch])
  const maxim = Number(echip.cantitate_disponibila)
  const valid = empId && Number(cant) > 0 && Number(cant) <= maxim
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }} onClick={onClose}>
      <div style={{ ...S.card, padding:22, maxWidth:460, width:'100%' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:4 }}>👤 Predă către angajat</div>
        <div style={{ fontSize:13, color:G.muted, marginBottom:16 }}>{echip.denumire} · disponibil: <b style={{ color:G.green }}>{fmtNr(maxim)} {echip.um}</b></div>
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          <div>
            <label style={{ fontSize:12, color:G.muted }}>Caută angajat</label>
            <input style={S.input} value={empSearch} onChange={e => { setEmpSearch(e.target.value); setEmpId('') }} placeholder="Nume angajat..." />
            <div style={{ maxHeight:170, overflowY:'auto', marginTop:6, border:`1px solid ${G.border}`, borderRadius:8 }}>
              {filtered.map(e => (
                <div key={e.id} onClick={() => { setEmpId(e.id); setEmpSearch(e.name) }}
                  style={{ padding:'8px 12px', cursor:'pointer', fontSize:13, background: empId === e.id ? G.green + '22' : 'transparent', borderBottom:`1px solid ${G.border}` }}>
                  {empId === e.id ? '✓ ' : ''}{e.name}{e.functie && <span style={{ color:G.dim }}> · {e.functie}</span>}
                </div>
              ))}
              {!filtered.length && <div style={{ padding:12, fontSize:12, color:G.muted }}>Niciun angajat găsit.</div>}
            </div>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <div style={{ width:140 }}><label style={{ fontSize:12, color:G.muted }}>Cantitate</label><input type="number" min="1" max={maxim} step="1" style={S.input} value={cant} onChange={e => setCant(e.target.value)} /></div>
            <div style={{ flex:1 }}><label style={{ fontSize:12, color:G.muted }}>Observații</label><input style={S.input} value={obs} onChange={e => setObs(e.target.value)} placeholder="opțional" /></div>
          </div>
          {Number(cant) > maxim && <div style={{ fontSize:11.5, color:G.red }}>Cantitatea depășește disponibilul ({fmtNr(maxim)}).</div>}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18 }}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={() => onPreda(echip, empId, cant, obs)} disabled={!valid || busy} style={{ ...S.btnP, opacity: (!valid || busy) ? .5 : 1 }}>{busy ? 'Se predă...' : '✓ Predă'}</button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB STOC TRASABIL — bucăți individuale (serie + sarjă) din recepție
// magazie_bucati: țevi/tuburi/curbe/fitinguri cu trasabilitate pe bucată.
// Stări: sosit → receptionat → rezervata → montata → consumata → retur
// ════════════════════════════════════════════════════════════════
const STARE_META = {
  sosit:       { label:'Sosit (din packing list)', emoji:'📦', color:G.yellow },
  receptionat: { label:'Recepționat (PV)',          emoji:'✅', color:G.green  },
  rezervata:   { label:'Rezervată',                 emoji:'🔒', color:G.blue   },
  montata:     { label:'Montată',                   emoji:'🏗️', color:G.purple },
  consumata:   { label:'Consumată',                 emoji:'🔥', color:G.dim    },
  retur:       { label:'Retur (rest în stoc)',      emoji:'↩️', color:G.cyan   },
}
const PROV_META_T = {
  gazpet:     { label:'Gazpet', color:G.green },
  beneficiar: { label:'Beneficiar', color:G.blue },
}

function StocTrasabilTab() {
  const [loading, setLoading] = useState(true)
  const [bucati, setBucati] = useState([])
  const [tipuri, setTipuri] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [profile, setProfile] = useState(null)
  const [search, setSearch] = useState('')
  const [fStare, setFStare] = useState('')      // '' = toate
  const [fProiect, setFProiect] = useState('')
  const [fTip, setFTip] = useState('')
  const [receptie, setReceptie] = useState(false)  // deschide modal recepție

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let prof = null
      if (user) {
        const { data } = await supabase.from('profiles')
          .select('id, role, is_owner, can_process_achizitii, can_manage_stoc').eq('id', user.id).maybeSingle()
        prof = data || null
      }
      const [rBuc, rTip, rProj] = await Promise.all([
        supabase.from('magazie_bucati').select('*').order('created_at', { ascending: false }),
        supabase.from('magazie_tipuri_material').select('id, nume, categorie, um_implicit').order('id'),
        supabase.from('executie_proiecte').select('id, nume, cod_intern'),
      ])
      setProfile(prof)
      setBucati(rBuc.data || [])
      setTipuri(rTip.data || [])
      setProiecte(rProj.data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const canReceptie = !!(profile?.is_owner || profile?.can_process_achizitii || profile?.role === 'admin_logistica' || profile?.can_manage_stoc)

  const tipuriMap = useMemo(() => Object.fromEntries(tipuri.map(t => [t.id, t])), [tipuri])
  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])

  const filtered = useMemo(() => {
    const q = normalize(search)
    return bucati.filter(b => {
      if (fStare && b.stare !== fStare) return false
      if (fProiect && String(b.proiect_id) !== String(fProiect)) return false
      if (fTip && String(b.tip_material_id) !== String(fTip)) return false
      if (q) {
        const hay = normalize([b.serie, b.sarja, b.dimensiune, b.furnizor, b.producator, b.nr_document].filter(Boolean).join(' '))
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [bucati, search, fStare, fProiect, fTip])

  // KPI pe stări
  const kpi = useMemo(() => {
    const k = { total: bucati.length, sosit: 0, receptionat: 0, montata: 0, retur: 0 }
    for (const b of bucati) if (k[b.stare] != null) k[b.stare]++
    return k
  }, [bucati])

  // grupare pe proiect
  const grupe = useMemo(() => {
    const map = new Map()
    for (const b of filtered) {
      const key = b.proiect_id ? `p_${b.proiect_id}` : 'fara'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(b)
    }
    return [...map.entries()].map(([key, items]) => {
      const pid = key === 'fara' ? null : Number(key.replace('p_', ''))
      const p = pid ? proiecteMap[pid] : null
      return { key, titlu: p ? `🏗️ ${p.cod_intern ? `[${p.cod_intern}] ` : ''}${p.nume}` : '📍 Fără proiect', items }
    }).sort((a, b) => b.items.length - a.items.length)
  }, [filtered, proiecteMap])

  const proiecteCuBucati = useMemo(() => {
    const ids = new Set(bucati.map(b => b.proiect_id).filter(Boolean))
    return proiecte.filter(p => ids.has(p.id))
  }, [bucati, proiecte])

  return (
    <>
      {/* KPI */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
        {[
          ['🔍', 'Bucăți total', kpi.total, G.magazie],
          ['📦', 'Sosit (de recepționat)', kpi.sosit, G.yellow],
          ['✅', 'Recepționat', kpi.receptionat, G.green],
          ['🏗️', 'Montată', kpi.montata, G.purple],
        ].map(([e, l, v, c], i) => (
          <div key={i} style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:150 }}>
            <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>{e} {l}</div>
            <div style={{ fontSize:24, fontWeight:800, color:c }}>{v}</div>
          </div>
        ))}
        <div style={{ display:'flex', flexDirection:'column', gap:8, justifyContent:'center' }}>
          {canReceptie && (
            <button onClick={() => setReceptie(true)} style={{ ...S.btnP, background:G.cyan, color:'#04181C' }}>📥 Recepție bucăți</button>
          )}
          <button onClick={loadAll} style={{ ...S.btnS, fontSize:13 }}>🔄 Reîncarcă</button>
        </div>
      </div>

      {/* Filtre */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
        <input style={{ ...S.input, maxWidth:300 }} placeholder="🔍 Serie / sarjă / dimensiune / furnizor..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...S.input, maxWidth:220 }} value={fStare} onChange={e => setFStare(e.target.value)}>
          <option value="">Toate stările</option>
          {Object.entries(STARE_META).map(([k, m]) => <option key={k} value={k}>{m.emoji} {m.label}</option>)}
        </select>
        <select style={{ ...S.input, maxWidth:200 }} value={fTip} onChange={e => setFTip(e.target.value)}>
          <option value="">Toate tipurile</option>
          {tipuri.map(t => <option key={t.id} value={t.id}>{t.nume}</option>)}
        </select>
        <select style={{ ...S.input, maxWidth:240 }} value={fProiect} onChange={e => setFProiect(e.target.value)}>
          <option value="">Toate proiectele</option>
          {proiecteCuBucati.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? p.cod_intern + ' · ' : ''}{p.nume}</option>)}
        </select>
        {(search || fStare || fTip || fProiect) && (
          <button onClick={() => { setSearch(''); setFStare(''); setFTip(''); setFProiect('') }} style={{ ...S.btnS, fontSize:13 }}>✕ Resetează</button>
        )}
        <span style={{ fontSize:12.5, color:G.muted, marginLeft:'auto' }}>{filtered.length} din {bucati.length} bucăți</span>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă bucățile...</div>}

      {!loading && !filtered.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🔍</div>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>{bucati.length ? 'Nicio bucată pe filtrele curente.' : 'Niciun material trasabil recepționat încă.'}</div>
          {!bucati.length && canReceptie && <div style={{ fontSize:13, color:G.muted }}>Apasă <b style={{ color:G.cyan }}>📥 Recepție bucăți</b> ca să încarci un packing list (OCR) sau să introduci manual țevi/curbe/fitinguri pe serie + sarjă.</div>}
        </div>
      )}

      {!loading && grupe.map(gr => (
        <div key={gr.key} style={{ ...S.card, overflow:'hidden', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:`1px solid ${G.border}`, background:G.bg }}>
            <div style={{ fontSize:15, fontWeight:800, flex:1 }}>{gr.titlu}</div>
            <span style={{ background:G.magazie + '22', color:G.magazie, border:`1px solid ${G.magazie}55`, borderRadius:14, padding:'3px 12px', fontSize:12, fontWeight:800 }}>{gr.items.length} buc</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1.1fr 1fr 0.9fr 0.7fr 1.1fr 1fr', gap:8, padding:'8px 16px', fontSize:10.5, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}`, textTransform:'uppercase', letterSpacing:0.3 }}>
            <div>Tip / Serie</div><div>Sarjă · Dim.</div><div>Lung. / Cant.</div><div>Proveniență</div><div>Izolație</div><div>Stare</div><div>Furnizor</div>
          </div>
          {gr.items.map(b => {
            const tip = tipuriMap[b.tip_material_id]
            const st = STARE_META[b.stare] || { label: b.stare, emoji:'•', color:G.muted }
            const pr = PROV_META_T[b.provenienta] || { label: b.provenienta, color:G.muted }
            return (
              <div key={b.id} style={{ display:'grid', gridTemplateColumns:'1.3fr 1.1fr 1fr 0.9fr 0.7fr 1.1fr 1fr', gap:8, alignItems:'center', padding:'9px 16px', fontSize:12.5, borderBottom:`1px solid ${G.border}` }}>
                <div>
                  <div style={{ fontWeight:700 }}>{tip?.nume || '—'}</div>
                  <div style={{ fontSize:11.5, color:G.cyan, fontFamily:'monospace' }}>{b.serie || '— fără serie —'}</div>
                </div>
                <div>
                  <div style={{ color:G.muted }}>{b.sarja ? `heat ${b.sarja}` : '—'}</div>
                  <div style={{ fontSize:11.5, color:G.dim }}>{b.dimensiune || '—'}</div>
                </div>
                <div>
                  <div style={{ fontWeight:600 }}>{b.lungime_m != null ? fmtNr(b.lungime_m) + ' m' : '—'}</div>
                  <div style={{ fontSize:11.5, color:G.dim }}>{fmtNr(b.cantitate)} {b.um || ''}{b.unghi_curba != null ? ` · ${fmtNr(b.unghi_curba)}°` : ''}</div>
                </div>
                <div><span style={{ color:pr.color, fontWeight:700, fontSize:11.5 }}>{pr.label}</span></div>
                <div style={{ fontSize:11.5, color:G.muted }}>{b.izolatie || '—'}</div>
                <div><span style={{ background:st.color+'1A', color:st.color, border:`1px solid ${st.color}55`, borderRadius:12, padding:'3px 9px', fontSize:11, fontWeight:700, whiteSpace:'nowrap' }}>{st.emoji} {st.label.split(' ')[0]}</span></div>
                <div style={{ fontSize:11.5, color:G.muted }}>{b.furnizor || '—'}{b.fara_packing_list && <span title="fără packing list" style={{ color:G.yellow }}> ⚠</span>}</div>
              </div>
            )
          })}
        </div>
      ))}

      {receptie && (
        <ReceptieBucatiModal
          open={receptie}
          onClose={() => setReceptie(false)}
          onSuccess={() => loadAll()}
        />
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// TRANSFERURI — Faza 6.2a: transfer sediu↔proiect (denumire liberă) + PV
// Backend gata: rpc fn_transfer_executa (validează stoc, scrie mișcările)
// ════════════════════════════════════════════════════════════════
const TRANSFER_STATUS = {
  livrat:    { label:'Livrat',    color:'#3FB950' },
  in_tranzit:{ label:'În tranzit', color:'#D29922' },
  anulat:    { label:'Anulat',    color:'#F85149' },
}
// "sediu" | "proiect:ID" → [tip, id]
const parseLoc = (v) => v === 'sediu' ? ['sediu', null] : ['proiect', Number(String(v).split(':')[1])]
const locLabel = (tip, id, pMap) => {
  if (tip === 'sediu') return '🏢 Sediu Ploiești'
  const p = pMap[id]
  return `🏗️ ${p ? `${p.cod_intern ? `[${p.cod_intern}] ` : ''}${p.nume}` : `Proiect #${id}`}`
}
const locLabelPlain = (tip, id, pMap) => {
  if (tip === 'sediu') return 'Sediu Ploiești'
  const p = pMap[id]
  return p ? `${p.cod_intern ? `[${p.cod_intern}] ` : ''}${p.nume}` : `Proiect #${id}`
}

// PV PDF transfer intern (jsPDF direct — robust, fără html2canvas)
function genereazaPVTransfer(t, linii, sursaText, destText) {
  const doc = new jsPDF({ unit:'mm', format:'a4' })
  const W = 210, M = 18
  let y = 20
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('GAZPET INSTAL SRL', M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('Ploiești, jud. Prahova', M, y + 5)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('PROCES-VERBAL DE TRANSFER INTERN', W / 2, y + 18, { align:'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(`Nr. transfer: ${t.id}`, M, y + 28)
  doc.text(`Data: ${fmtData(t.data_plecare || t.created_at)}`, W - M, y + 28, { align:'right' })

  y += 38
  doc.setFont('helvetica', 'bold'); doc.text('De la:', M, y)
  doc.setFont('helvetica', 'normal'); doc.text(sursaText, M + 16, y)
  doc.setFont('helvetica', 'bold'); doc.text('Către:', M, y + 7)
  doc.setFont('helvetica', 'normal'); doc.text(destText, M + 16, y + 7)
  if (t.observatii) { doc.setFont('helvetica', 'italic'); doc.text(`Observații: ${t.observatii}`, M, y + 14); doc.setFont('helvetica', 'normal') }

  // tabel
  y += 22
  const cols = [M, M + 12, W - M - 60, W - M - 32]   // Nr | Material | UM | Cantitate
  doc.setFillColor(230, 230, 230); doc.rect(M, y - 5, W - 2 * M, 8, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Nr.', cols[0] + 1, y); doc.text('Material', cols[1], y)
  doc.text('UM', cols[2], y); doc.text('Cantitate', cols[3], y)
  doc.setFont('helvetica', 'normal'); y += 7
  ;(linii || []).forEach((l, i) => {
    if (y > 260) { doc.addPage(); y = 20 }
    doc.text(String(i + 1), cols[0] + 1, y)
    const den = doc.splitTextToSize(l.material_denumire || '', cols[2] - cols[1] - 4)
    doc.text(den, cols[1], y)
    doc.text(l.um || '—', cols[2], y)
    doc.text(fmtNr(l.cantitate), cols[3], y)
    y += Math.max(6, den.length * 5)
    doc.setDrawColor(220, 220, 220); doc.line(M, y - 3, W - M, y - 3)
  })

  // semnături
  y = Math.max(y + 16, 245)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Predat (gestionar)', M + 10, y)
  doc.text('Primit (responsabil)', W - M - 50, y)
  doc.setDrawColor(120, 120, 120)
  doc.line(M, y + 14, M + 60, y + 14)
  doc.line(W - M - 60, y + 14, W - M, y + 14)
  doc.setFontSize(7); doc.setTextColor(120)
  doc.text(`Generat din Gazpet ERP · ${fmtDataOra(new Date())}`, W / 2, 290, { align:'center' })

  doc.save(`PV_Transfer_${t.id}_${fmtData(t.data_plecare || t.created_at).replace(/\./g, '-')}.pdf`)
}

// ── Modal: Transfer nou ────────────────────────────────────────
function TransferNouModal({ stocuri, proiecteMap, onClose, onDone }) {
  const [deLa, setDeLa] = useState('')
  const [la, setLa] = useState('')
  const [cantMap, setCantMap] = useState({})   // material_denumire → string
  const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // opțiuni locații: sediu + toate proiectele cu stoc SAU toate proiectele
  const locOptions = useMemo(() => {
    const opts = [{ v:'sediu', label:'🏢 Sediu Ploiești' }]
    const pids = [...new Set(Object.keys(proiecteMap).map(Number))]
    pids.forEach(id => opts.push({ v:`proiect:${id}`, label: locLabel('proiect', id, proiecteMap) }))
    return opts
  }, [proiecteMap])

  const stocSursa = useMemo(() => {
    if (!deLa) return []
    const [tip, id] = parseLoc(deLa)
    return stocuri
      .filter(s => s.locatie_tip === tip && (s.locatie_id ?? null) === (id ?? null) && Number(s.cantitate) > 0)
      .sort((a, b) => a.material_denumire.localeCompare(b.material_denumire))
  }, [deLa, stocuri])

  const liniiSel = useMemo(() => stocSursa
    .map(s => ({ s, q: Math.abs(Number(cantMap[s.material_denumire]) || 0) }))
    .filter(x => x.q > 0), [stocSursa, cantMap])

  const overflow = liniiSel.some(x => x.q > Number(x.s.cantitate))
  const sameLoc = deLa && la && deLa === la
  const valid = deLa && la && !sameLoc && liniiSel.length > 0 && !overflow

  const transfera = async () => {
    if (!valid) { setErr(sameLoc ? 'Sursa și destinația trebuie să fie diferite.' : overflow ? 'O cantitate depășește disponibilul.' : 'Alege sursă, destinație și cel puțin un material.'); return }
    setBusy(true); setErr('')
    try {
      const [dTip, dId] = parseLoc(deLa)
      const [lTip, lId] = parseLoc(la)
      const p_linii = liniiSel.map(x => ({ material_denumire: x.s.material_denumire, um: x.s.um || null, cantitate: x.q }))
      const { error } = await supabase.rpc('fn_transfer_executa', {
        p_de_la_tip: dTip, p_de_la_id: dId, p_la_tip: lTip, p_la_id: lId,
        p_obs: obs.trim() || null, p_linii,
      })
      if (error) throw error
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ ...S.card, width:'min(620px,100%)', maxHeight:'92vh', overflowY:'auto', padding:22 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:10 }}>🔁 Transfer intern nou</div>

        <div style={{ padding:'9px 12px', background:G.yellow + '14', border:`1px solid ${G.yellow}44`, borderRadius:8, fontSize:12, color:G.yellow, marginBottom:14, lineHeight:1.5 }}>
          ⚠️ Pentru marfă care pleacă cu <b>camion / aviz</b>, folosește <b>Comanda de transport din Logistică</b> — aceea creează transferul automat. Aici faci transfer direct pe stoc (fără aviz), ca să nu se miște stocul de două ori.
        </div>

        <div style={{ display:'flex', gap:12, marginBottom:14, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:220 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>De la (sursă) <span style={{ color:G.red }}>*</span></label>
            <select style={S.input} value={deLa} onChange={e => { setDeLa(e.target.value); setCantMap({}) }}>
              <option value="">— alege sursa —</option>
              {locOptions.map(o => <option key={o.v} value={o.v} disabled={o.v === la}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ alignSelf:'flex-end', paddingBottom:9, fontSize:18, color:G.muted }}>→</div>
          <div style={{ flex:1, minWidth:220 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Către (destinație) <span style={{ color:G.red }}>*</span></label>
            <select style={S.input} value={la} onChange={e => setLa(e.target.value)}>
              <option value="">— alege destinația —</option>
              {locOptions.map(o => <option key={o.v} value={o.v} disabled={o.v === deLa}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {!deLa && <div style={{ padding:'14px 16px', background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:13, color:G.muted }}>Alege o sursă ca să vezi materialele disponibile pentru transfer.</div>}

        {deLa && !stocSursa.length && (
          <div style={{ padding:'14px 16px', background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:13, color:G.muted }}>📭 Nu există stoc disponibil la această locație.</div>
        )}

        {deLa && stocSursa.length > 0 && (
          <div style={{ ...S.card, background:G.bg, overflow:'hidden', marginBottom:14 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 110px 130px', gap:10, padding:'8px 14px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
              <div>Material</div><div>UM</div><div style={{ textAlign:'right' }}>Disponibil</div><div style={{ textAlign:'right' }}>Transferă</div>
            </div>
            {stocSursa.map(s => {
              const q = Number(cantMap[s.material_denumire]) || 0
              const over = q > Number(s.cantitate)
              return (
                <div key={s.id} style={{ display:'grid', gridTemplateColumns:'1fr 80px 110px 130px', gap:10, alignItems:'center', padding:'8px 14px', fontSize:13, borderBottom:`1px solid ${G.border}` }}>
                  <div style={{ fontWeight:600 }}>{s.material_denumire}</div>
                  <div style={{ color:G.muted }}>{s.um || '—'}</div>
                  <div style={{ textAlign:'right', fontWeight:700, color:G.green }}>{fmtNr(s.cantitate)}</div>
                  <div style={{ textAlign:'right' }}>
                    <input type="number" min="0" step="any" style={{ ...S.input, padding:'6px 8px', textAlign:'right', width:110, borderColor: over ? G.red : G.border2 }}
                      value={cantMap[s.material_denumire] ?? ''} placeholder="0"
                      onChange={e => setCantMap(m => ({ ...m, [s.material_denumire]: e.target.value }))} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ marginBottom:10 }}>
          <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Observații</label>
          <textarea style={{ ...S.input, minHeight:48, resize:'vertical' }} value={obs} onChange={e => setObs(e.target.value)} placeholder="opțional — motiv, nr. comandă transport, etc." />
        </div>

        {overflow && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginBottom:8 }}>⚠️ O cantitate depășește disponibilul la sursă.</div>}
        {err && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginBottom:8 }}>{err}</div>}

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:8 }}>
          <div style={{ fontSize:12.5, color:G.muted }}>{liniiSel.length} {liniiSel.length === 1 ? 'material selectat' : 'materiale selectate'}</div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} disabled={busy} style={S.btnS}>Anulează</button>
            <button onClick={transfera} disabled={busy || !valid} style={{ ...S.btnP, background:G.magazie, color:'#3a0d0a', opacity:(busy || !valid) ? .6 : 1 }}>{busy ? '...' : '🔁 Execută transferul'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Drawer: detalii transfer + liniile + PV ────────────────────
function TransferDetaliiDrawer({ transfer, linii, sursaText, destText, onClose }) {
  const st = TRANSFER_STATUS[transfer.status] || { label: transfer.status, color:G.muted }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', justifyContent:'flex-end' }}>
      <div style={{ width:'min(520px,100%)', height:'100%', background:G.surface, borderLeft:`1px solid ${G.border}`, padding:22, overflowY:'auto' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:17, fontWeight:800 }}>🔁 Transfer #{transfer.id}</div>
            <div style={{ fontSize:13, color:G.muted, marginTop:2 }}>{fmtData(transfer.data_plecare || transfer.created_at)}</div>
          </div>
          <button onClick={onClose} style={{ ...S.btnS, padding:'6px 10px', fontSize:18, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ ...S.card, background:G.bg, padding:'12px 14px', marginBottom:14, fontSize:13.5 }}>
          <div style={{ marginBottom:6 }}><span style={{ color:G.muted }}>De la: </span><b>{sursaText}</b></div>
          <div style={{ marginBottom:6 }}><span style={{ color:G.muted }}>Către: </span><b>{destText}</b></div>
          <div><span style={{ color:G.muted }}>Status: </span><span style={{ color:st.color, fontWeight:700 }}>{st.label}</span></div>
          {transfer.observatii && <div style={{ marginTop:6, color:G.muted, fontSize:12.5 }}>{transfer.observatii}</div>}
        </div>

        <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>Materiale ({(linii || []).length})</div>
        <div style={{ ...S.card, overflow:'hidden', marginBottom:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 70px 110px', gap:10, padding:'8px 14px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Material</div><div>UM</div><div style={{ textAlign:'right' }}>Cantitate</div>
          </div>
          {(linii || []).map(l => (
            <div key={l.id} style={{ display:'grid', gridTemplateColumns:'1fr 70px 110px', gap:10, padding:'8px 14px', fontSize:13, borderBottom:`1px solid ${G.border}` }}>
              <div style={{ fontWeight:600 }}>{l.material_denumire}</div>
              <div style={{ color:G.muted }}>{l.um || '—'}</div>
              <div style={{ textAlign:'right', fontWeight:700 }}>{fmtNr(l.cantitate)}</div>
            </div>
          ))}
        </div>

        <button onClick={() => genereazaPVTransfer(transfer, linii, sursaText, destText)} style={{ ...S.btnP, width:'100%' }}>📄 Descarcă PV transfer (PDF)</button>
      </div>
    </div>
  )
}

// ── Tab Transferuri ────────────────────────────────────────────
function TransferuriTab() {
  const [loading, setLoading] = useState(true)
  const [transferuri, setTransferuri] = useState([])
  const [liniiMap, setLiniiMap] = useState({})
  const [proiecte, setProiecte] = useState([])
  const [stocuri, setStocuri] = useState([])
  const [profile, setProfile] = useState(null)
  const [openNou, setOpenNou] = useState(false)
  const [detaliiFor, setDetaliiFor] = useState(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let prof = null
      if (user) {
        const { data } = await supabase.from('profiles').select('id, role, is_owner, can_manage_stoc').eq('id', user.id).maybeSingle()
        prof = data || null
      }
      const [rT, rL, rP, rS] = await Promise.all([
        supabase.from('transferuri_interne').select('*').order('created_at', { ascending: false }),
        supabase.from('transferuri_linii').select('*'),
        supabase.from('executie_proiecte').select('id, nume, cod_intern'),
        supabase.from('stocuri').select('*'),
      ])
      const lm = {}
      ;(rL.data || []).forEach(l => { (lm[l.transfer_id] = lm[l.transfer_id] || []).push(l) })
      setProfile(prof)
      setTransferuri(rT.data || [])
      setLiniiMap(lm)
      setProiecte(rP.data || [])
      setStocuri(rS.data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const canManage = !!(profile?.is_owner || profile?.can_manage_stoc)
  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])

  return (
    <>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
        <div style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:160 }}>
          <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>🔁 Transferuri</div>
          <div style={{ fontSize:24, fontWeight:800, color:G.magazie }}>{transferuri.length}</div>
        </div>
        <div style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:160 }}>
          <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>🕐 Ultimul transfer</div>
          <div style={{ fontSize:15, fontWeight:800, color:G.green }}>{transferuri[0] ? fmtData(transferuri[0].data_plecare || transferuri[0].created_at) : '—'}</div>
        </div>
        <button onClick={loadAll} style={{ ...S.btnS, alignSelf:'center' }}>🔄 Reîncarcă</button>
        {canManage && <button onClick={() => setOpenNou(true)} style={{ ...S.btnP, background:G.magazie, color:'#3a0d0a', alignSelf:'center' }}>🔁 Transfer nou</button>}
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă transferurile...</div>}

      {!loading && !transferuri.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🔁</div>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>Niciun transfer înregistrat.</div>
          <div style={{ fontSize:13, color:G.muted }}>Mută materiale între sediu și proiecte. Stocul se actualizează automat la ambele capete + poți descărca PV-ul.</div>
        </div>
      )}

      {!loading && transferuri.length > 0 && (
        <div style={{ ...S.card, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'90px 1fr 1fr 80px 140px', gap:10, padding:'9px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Data</div><div>De la</div><div>Către</div><div style={{ textAlign:'center' }}>Materiale</div><div></div>
          </div>
          {transferuri.map(t => {
            const linii = liniiMap[t.id] || []
            const sursaText = locLabelPlain(t.de_la_locatie_tip, t.de_la_locatie_id, proiecteMap)
            const destText = locLabelPlain(t.la_locatie_tip, t.la_locatie_id, proiecteMap)
            const st = TRANSFER_STATUS[t.status] || { label:t.status, color:G.muted }
            return (
              <div key={t.id} style={{ display:'grid', gridTemplateColumns:'90px 1fr 1fr 80px 140px', gap:10, alignItems:'center', padding:'10px 16px', fontSize:13, borderBottom:`1px solid ${G.border}` }}>
                <div style={{ fontSize:12, color:G.dim }}>{fmtData(t.data_plecare || t.created_at)}</div>
                <div style={{ fontWeight:600 }}>{locLabel(t.de_la_locatie_tip, t.de_la_locatie_id, proiecteMap)}</div>
                <div style={{ fontWeight:600 }}>{locLabel(t.la_locatie_tip, t.la_locatie_id, proiecteMap)}</div>
                <div style={{ textAlign:'center' }}>
                  <span style={{ background:G.magazie + '22', color:G.magazie, borderRadius:12, padding:'2px 10px', fontSize:12, fontWeight:800 }}>{linii.length}</span>
                </div>
                <div style={{ display:'flex', gap:6, justifyContent:'flex-end', alignItems:'center' }}>
                  <span style={{ color:st.color, fontSize:11, fontWeight:700 }}>{st.label}</span>
                  <button onClick={() => setDetaliiFor({ t, linii, sursaText, destText })} title="Detalii" style={{ ...S.btnS, padding:'5px 10px', fontSize:12 }}>📜</button>
                  <button onClick={() => genereazaPVTransfer(t, linii, sursaText, destText)} title="Descarcă PV" style={{ ...S.btnS, padding:'5px 10px', fontSize:12, color:G.blue, borderColor:G.blue + '66' }}>📄</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ padding:14, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:12, color:G.muted, lineHeight:1.7, marginTop:14 }}>
        <b style={{ color:G.text }}>📦 Faza 6.2a — Transfer sediu↔proiect:</b> mută materiale între locații pe denumire liberă; stocul scade la sursă și crește la destinație automat (mișcări <i>transfer ieșire/intrare</i> în registru). PV de transfer descărcabil. Următor: catalog materiale + transport legat de comandă (6.2b).
      </div>

      {openNou && (
        <TransferNouModal
          stocuri={stocuri}
          proiecteMap={proiecteMap}
          onClose={() => setOpenNou(false)}
          onDone={() => { setOpenNou(false); loadAll() }}
        />
      )}
      {detaliiFor && (
        <TransferDetaliiDrawer
          transfer={detaliiFor.t}
          linii={detaliiFor.linii}
          sursaText={detaliiFor.sursaText}
          destText={detaliiFor.destText}
          onClose={() => setDetaliiFor(null)}
        />
      )}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// CONSUM PE PROIECT — Faza 6.3: scoate din stoc + PV (bon consum)
// Backend: rpc fn_consum_executa (validează disponibil, mișcare consum_proiect)
// ════════════════════════════════════════════════════════════════
function genereazaPVConsum(c, linii, locText) {
  const doc = new jsPDF({ unit:'mm', format:'a4' })
  const W = 210, M = 18
  let y = 20
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text('GAZPET INSTAL SRL', M, y)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('Ploiești, jud. Prahova', M, y + 5)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('BON DE CONSUM', W / 2, y + 18, { align:'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(`Nr. bon: ${c.id}`, M, y + 28)
  doc.text(`Data: ${fmtData(c.data_consum || c.created_at)}`, W - M, y + 28, { align:'right' })

  y += 38
  doc.setFont('helvetica', 'bold'); doc.text('Locație consum:', M, y)
  doc.setFont('helvetica', 'normal'); doc.text(locText, M + 36, y)
  if (c.predat_de) { doc.setFont('helvetica', 'bold'); doc.text('Predat de:', M, y + 7); doc.setFont('helvetica', 'normal'); doc.text(c.predat_de, M + 24, y + 7) }
  if (c.primit_de) { doc.setFont('helvetica', 'bold'); doc.text('Primit de:', M + 95, y + 7); doc.setFont('helvetica', 'normal'); doc.text(c.primit_de, M + 119, y + 7) }
  if (c.observatii) { doc.setFont('helvetica', 'italic'); doc.text(`Observații: ${c.observatii}`, M, y + 14); doc.setFont('helvetica', 'normal') }

  y += 22
  const cols = [M, M + 12, W - M - 60, W - M - 32]
  doc.setFillColor(230, 230, 230); doc.rect(M, y - 5, W - 2 * M, 8, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('Nr.', cols[0] + 1, y); doc.text('Material', cols[1], y)
  doc.text('UM', cols[2], y); doc.text('Cantitate', cols[3], y)
  doc.setFont('helvetica', 'normal'); y += 7
  ;(linii || []).forEach((l, i) => {
    if (y > 260) { doc.addPage(); y = 20 }
    doc.text(String(i + 1), cols[0] + 1, y)
    const den = doc.splitTextToSize(l.material_denumire || '', cols[2] - cols[1] - 4)
    doc.text(den, cols[1], y)
    doc.text(l.um || '—', cols[2], y)
    doc.text(fmtNr(l.cantitate), cols[3], y)
    y += Math.max(6, den.length * 5)
    doc.setDrawColor(220, 220, 220); doc.line(M, y - 3, W - M, y - 3)
  })

  y = Math.max(y + 16, 245)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Predat (gestionar)', M + 10, y)
  doc.text('Primit (executant)', W - M - 50, y)
  doc.setDrawColor(120, 120, 120)
  doc.line(M, y + 14, M + 60, y + 14)
  doc.line(W - M - 60, y + 14, W - M, y + 14)
  doc.setFontSize(7); doc.setTextColor(120)
  doc.text(`Generat din Gazpet ERP · ${fmtDataOra(new Date())}`, W / 2, 290, { align:'center' })
  doc.save(`BonConsum_${c.id}_${fmtData(c.data_consum || c.created_at).replace(/\./g, '-')}.pdf`)
}

// ── Modal: Consum nou ──────────────────────────────────────────
function ConsumNouModal({ stocuri, proiecteMap, onClose, onDone }) {
  const [loc, setLoc] = useState('')
  const [cantMap, setCantMap] = useState({})
  const [predat, setPredat] = useState('')
  const [primit, setPrimit] = useState('')
  const [obs, setObs] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const locOptions = useMemo(() => {
    const opts = [{ v:'sediu', label:'🏢 Sediu Ploiești' }]
    ;[...new Set(Object.keys(proiecteMap).map(Number))].forEach(id => opts.push({ v:`proiect:${id}`, label: locLabel('proiect', id, proiecteMap) }))
    return opts
  }, [proiecteMap])

  const stocLoc = useMemo(() => {
    if (!loc) return []
    const [tip, id] = parseLoc(loc)
    return stocuri
      .filter(s => s.locatie_tip === tip && (s.locatie_id ?? null) === (id ?? null) && Number(s.cantitate) > 0)
      .sort((a, b) => a.material_denumire.localeCompare(b.material_denumire))
  }, [loc, stocuri])

  const liniiSel = useMemo(() => stocLoc
    .map(s => ({ s, q: Math.abs(Number(cantMap[s.material_denumire]) || 0) }))
    .filter(x => x.q > 0), [stocLoc, cantMap])

  const overflow = liniiSel.some(x => x.q > Number(x.s.cantitate))
  const valid = loc && liniiSel.length > 0 && !overflow

  const consuma = async () => {
    if (!valid) { setErr(overflow ? 'O cantitate depășește disponibilul.' : 'Alege locația și cel puțin un material.'); return }
    setBusy(true); setErr('')
    try {
      const [tip, id] = parseLoc(loc)
      const p_linii = liniiSel.map(x => ({ material_denumire: x.s.material_denumire, um: x.s.um || null, cantitate: x.q }))
      const { error } = await supabase.rpc('fn_consum_executa', {
        p_locatie_tip: tip, p_locatie_id: id, p_predat: predat.trim() || null, p_primit: primit.trim() || null, p_obs: obs.trim() || null, p_linii,
      })
      if (error) throw error
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ ...S.card, width:'min(620px,100%)', maxHeight:'92vh', overflowY:'auto', padding:22 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:14 }}>🔧 Consum nou pe proiect</div>

        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Locație (din ce magazie se consumă) <span style={{ color:G.red }}>*</span></label>
          <select style={S.input} value={loc} onChange={e => { setLoc(e.target.value); setCantMap({}) }}>
            <option value="">— alege locația —</option>
            {locOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>

        {!loc && <div style={{ padding:'14px 16px', background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:13, color:G.muted }}>Alege o locație ca să vezi materialele disponibile.</div>}
        {loc && !stocLoc.length && <div style={{ padding:'14px 16px', background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:13, color:G.muted }}>📭 Nu există stoc disponibil aici.</div>}

        {loc && stocLoc.length > 0 && (
          <div style={{ ...S.card, background:G.bg, overflow:'hidden', marginBottom:14 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 80px 110px 130px', gap:10, padding:'8px 14px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
              <div>Material</div><div>UM</div><div style={{ textAlign:'right' }}>Disponibil</div><div style={{ textAlign:'right' }}>Consumă</div>
            </div>
            {stocLoc.map(s => {
              const q = Number(cantMap[s.material_denumire]) || 0
              const over = q > Number(s.cantitate)
              return (
                <div key={s.id} style={{ display:'grid', gridTemplateColumns:'1fr 80px 110px 130px', gap:10, alignItems:'center', padding:'8px 14px', fontSize:13, borderBottom:`1px solid ${G.border}` }}>
                  <div style={{ fontWeight:600 }}>{s.material_denumire}</div>
                  <div style={{ color:G.muted }}>{s.um || '—'}</div>
                  <div style={{ textAlign:'right', fontWeight:700, color:G.green }}>{fmtNr(s.cantitate)}</div>
                  <div style={{ textAlign:'right' }}>
                    <input type="number" min="0" step="any" style={{ ...S.input, padding:'6px 8px', textAlign:'right', width:110, borderColor: over ? G.red : G.border2 }}
                      value={cantMap[s.material_denumire] ?? ''} placeholder="0"
                      onChange={e => setCantMap(m => ({ ...m, [s.material_denumire]: e.target.value }))} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ display:'flex', gap:10, marginBottom:10, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Predat de (gestionar)</label>
            <input style={S.input} value={predat} onChange={e => setPredat(e.target.value)} placeholder="opțional" />
          </div>
          <div style={{ flex:1, minWidth:200 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Primit de (executant)</label>
            <input style={S.input} value={primit} onChange={e => setPrimit(e.target.value)} placeholder="opțional" />
          </div>
        </div>
        <div style={{ marginBottom:10 }}>
          <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Observații</label>
          <textarea style={{ ...S.input, minHeight:44, resize:'vertical' }} value={obs} onChange={e => setObs(e.target.value)} placeholder="opțional — lucrare, tronson, etc." />
        </div>

        {overflow && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginBottom:8 }}>⚠️ O cantitate depășește disponibilul.</div>}
        {err && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginBottom:8 }}>{err}</div>}

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:8 }}>
          <div style={{ fontSize:12.5, color:G.muted }}>{liniiSel.length} {liniiSel.length === 1 ? 'material' : 'materiale'}</div>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} disabled={busy} style={S.btnS}>Anulează</button>
            <button onClick={consuma} disabled={busy || !valid} style={{ ...S.btnP, background:G.red, color:'#fff', opacity:(busy || !valid) ? .6 : 1 }}>{busy ? '...' : '🔧 Înregistrează consumul'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Drawer: detalii consum + PV ────────────────────────────────
function ConsumDetaliiDrawer({ consum, linii, locText, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1000, display:'flex', justifyContent:'flex-end' }}>
      <div style={{ width:'min(520px,100%)', height:'100%', background:G.surface, borderLeft:`1px solid ${G.border}`, padding:22, overflowY:'auto' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:17, fontWeight:800 }}>🔧 Consum #{consum.id}</div>
            <div style={{ fontSize:13, color:G.muted, marginTop:2 }}>{fmtData(consum.data_consum || consum.created_at)}</div>
          </div>
          <button onClick={onClose} style={{ ...S.btnS, padding:'6px 10px', fontSize:18, lineHeight:1 }}>✕</button>
        </div>

        <div style={{ ...S.card, background:G.bg, padding:'12px 14px', marginBottom:14, fontSize:13.5 }}>
          <div style={{ marginBottom:6 }}><span style={{ color:G.muted }}>Locație: </span><b>{locText}</b></div>
          {consum.predat_de && <div style={{ marginBottom:6 }}><span style={{ color:G.muted }}>Predat: </span><b>{consum.predat_de}</b></div>}
          {consum.primit_de && <div style={{ marginBottom:6 }}><span style={{ color:G.muted }}>Primit: </span><b>{consum.primit_de}</b></div>}
          {consum.observatii && <div style={{ marginTop:6, color:G.muted, fontSize:12.5 }}>{consum.observatii}</div>}
        </div>

        <div style={{ fontSize:13, fontWeight:700, marginBottom:8 }}>Materiale ({(linii || []).length})</div>
        <div style={{ ...S.card, overflow:'hidden', marginBottom:16 }}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 70px 110px', gap:10, padding:'8px 14px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Material</div><div>UM</div><div style={{ textAlign:'right' }}>Cantitate</div>
          </div>
          {(linii || []).map(l => (
            <div key={l.id} style={{ display:'grid', gridTemplateColumns:'1fr 70px 110px', gap:10, padding:'8px 14px', fontSize:13, borderBottom:`1px solid ${G.border}` }}>
              <div style={{ fontWeight:600 }}>{l.material_denumire}</div>
              <div style={{ color:G.muted }}>{l.um || '—'}</div>
              <div style={{ textAlign:'right', fontWeight:700, color:G.red }}>−{fmtNr(l.cantitate)}</div>
            </div>
          ))}
        </div>

        <button onClick={() => genereazaPVConsum(consum, linii, locText)} style={{ ...S.btnP, width:'100%' }}>📄 Descarcă bon de consum (PDF)</button>
      </div>
    </div>
  )
}

// ── Tab Consum ─────────────────────────────────────────────────
function ConsumuriTab() {
  const [loading, setLoading] = useState(true)
  const [consumuri, setConsumuri] = useState([])
  const [liniiMap, setLiniiMap] = useState({})
  const [proiecte, setProiecte] = useState([])
  const [stocuri, setStocuri] = useState([])
  const [profile, setProfile] = useState(null)
  const [openNou, setOpenNou] = useState(false)
  const [detaliiFor, setDetaliiFor] = useState(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let prof = null
      if (user) {
        const { data } = await supabase.from('profiles').select('id, role, is_owner, can_manage_stoc').eq('id', user.id).maybeSingle()
        prof = data || null
      }
      const [rC, rL, rP, rS] = await Promise.all([
        supabase.from('consumuri_proiect').select('*').order('created_at', { ascending: false }),
        supabase.from('consumuri_proiect_linii').select('*'),
        supabase.from('executie_proiecte').select('id, nume, cod_intern'),
        supabase.from('stocuri').select('*'),
      ])
      const lm = {}
      ;(rL.data || []).forEach(l => { (lm[l.consum_id] = lm[l.consum_id] || []).push(l) })
      setProfile(prof); setConsumuri(rC.data || []); setLiniiMap(lm); setProiecte(rP.data || []); setStocuri(rS.data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const canManage = !!(profile?.is_owner || profile?.can_manage_stoc)
  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])

  return (
    <>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
        <div style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:160 }}>
          <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>🔧 Bonuri consum</div>
          <div style={{ fontSize:24, fontWeight:800, color:G.red }}>{consumuri.length}</div>
        </div>
        <div style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:160 }}>
          <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>🕐 Ultimul consum</div>
          <div style={{ fontSize:15, fontWeight:800, color:G.green }}>{consumuri[0] ? fmtData(consumuri[0].data_consum || consumuri[0].created_at) : '—'}</div>
        </div>
        <button onClick={loadAll} style={{ ...S.btnS, alignSelf:'center' }}>🔄 Reîncarcă</button>
        {canManage && <button onClick={() => setOpenNou(true)} style={{ ...S.btnP, background:G.red, color:'#fff', alignSelf:'center' }}>🔧 Consum nou</button>}
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă consumurile...</div>}

      {!loading && !consumuri.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:10 }}>🔧</div>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>Niciun consum înregistrat.</div>
          <div style={{ fontSize:13, color:G.muted }}>Înregistrează materialele consumate pe un proiect — stocul scade automat și obții bon de consum.</div>
        </div>
      )}

      {!loading && consumuri.length > 0 && (
        <div style={{ ...S.card, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'90px 1fr 1fr 80px 120px', gap:10, padding:'9px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Data</div><div>Locație</div><div>Predat / Primit</div><div style={{ textAlign:'center' }}>Materiale</div><div></div>
          </div>
          {consumuri.map(c => {
            const linii = liniiMap[c.id] || []
            const locText = locLabelPlain(c.locatie_tip, c.locatie_id, proiecteMap)
            return (
              <div key={c.id} style={{ display:'grid', gridTemplateColumns:'90px 1fr 1fr 80px 120px', gap:10, alignItems:'center', padding:'10px 16px', fontSize:13, borderBottom:`1px solid ${G.border}` }}>
                <div style={{ fontSize:12, color:G.dim }}>{fmtData(c.data_consum || c.created_at)}</div>
                <div style={{ fontWeight:600 }}>{locLabel(c.locatie_tip, c.locatie_id, proiecteMap)}</div>
                <div style={{ fontSize:12, color:G.muted }}>{[c.predat_de, c.primit_de].filter(Boolean).join(' → ') || '—'}</div>
                <div style={{ textAlign:'center' }}>
                  <span style={{ background:G.red + '22', color:G.red, borderRadius:12, padding:'2px 10px', fontSize:12, fontWeight:800 }}>{linii.length}</span>
                </div>
                <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                  <button onClick={() => setDetaliiFor({ c, linii, locText })} title="Detalii" style={{ ...S.btnS, padding:'5px 10px', fontSize:12 }}>📜</button>
                  <button onClick={() => genereazaPVConsum(c, linii, locText)} title="Bon consum PDF" style={{ ...S.btnS, padding:'5px 10px', fontSize:12, color:G.blue, borderColor:G.blue + '66' }}>📄</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {openNou && <ConsumNouModal stocuri={stocuri} proiecteMap={proiecteMap} onClose={() => setOpenNou(false)} onDone={() => { setOpenNou(false); loadAll() }} />}
      {detaliiFor && <ConsumDetaliiDrawer consum={detaliiFor.c} linii={detaliiFor.linii} locText={detaliiFor.locText} onClose={() => setDetaliiFor(null)} />}
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// TAB MAGAZII — Faza 6.3: overview gestiuni (status + poziții + sub prag)
// ════════════════════════════════════════════════════════════════
function MagaziiTab() {
  const [loading, setLoading] = useState(true)
  const [magazii, setMagazii] = useState([])
  const [stocuri, setStocuri] = useState([])
  const [profile, setProfile] = useState(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let prof = null
      if (user) {
        const { data } = await supabase.from('profiles').select('id, is_owner, can_manage_stoc').eq('id', user.id).maybeSingle()
        prof = data || null
      }
      const [rM, rS] = await Promise.all([
        supabase.from('magazii').select('*').order('tip').order('denumire'),
        supabase.from('stocuri').select('*'),
      ])
      setProfile(prof); setMagazii(rM.data || []); setStocuri(rS.data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const canManage = !!(profile?.is_owner || profile?.can_manage_stoc)

  // stoc per locație
  const statPerMag = useCallback((m) => {
    const tip = m.tip === 'sediu' ? 'sediu' : 'proiect'
    const id = m.tip === 'sediu' ? null : m.executie_proiect_id
    const items = stocuri.filter(s => s.locatie_tip === tip && (s.locatie_id ?? null) === (id ?? null))
    const pozitii = items.length
    const subPrag = items.filter(s => s.prag_minim != null && Number(s.cantitate) < Number(s.prag_minim)).length
    const valoare = items.reduce((acc, s) => acc + (s.cost_mediu != null ? Number(s.cantitate) * Number(s.cost_mediu) : 0), 0)
    return { pozitii, subPrag, valoare }
  }, [stocuri])

  const toggleStatus = async (m) => {
    const nou = m.status === 'activa' ? 'inchisa' : 'activa'
    if (!window.confirm(`${nou === 'inchisa' ? 'Închizi' : 'Redeschizi'} magazia „${m.denumire}"? (stocul rămâne neatins)`)) return
    try {
      const { error } = await supabase.from('magazii').update({ status: nou, data_inchidere: nou === 'inchisa' ? new Date().toISOString().slice(0,10) : null }).eq('id', m.id)
      if (error) throw error
      loadAll()
    } catch (e) { alert(e.message || String(e)) }
  }

  const active = magazii.filter(m => m.status === 'activa')
  const inchise = magazii.filter(m => m.status === 'inchisa')
  const totalSubPrag = magazii.reduce((acc, m) => acc + statPerMag(m).subPrag, 0)

  // Rând full-width per magazie (decizie Razvan 03.07: listă verticală, nu grid).
  // Click pe rând → expand inline cu inventarul magaziei (stocurile-s deja în
  // state, filtrare locală — zero fetch nou, pattern „refolosește array-ul părinte").
  const [expandedId, setExpandedId] = useState(null)
  const Card = ({ m }) => {
    const st = statPerMag(m)
    const inchisa = m.status === 'inchisa'
    const expanded = expandedId === m.id
    const tip = m.tip === 'sediu' ? 'sediu' : 'proiect'
    const locId = m.tip === 'sediu' ? null : m.executie_proiect_id
    const items = expanded
      ? stocuri.filter(s => s.locatie_tip === tip && (s.locatie_id ?? null) === (locId ?? null))
          .slice().sort((a, b) => (a.material_denumire || '').localeCompare(b.material_denumire || ''))
      : []
    return (
      <div style={{ ...S.card, opacity: inchisa ? .6 : 1, overflow:'hidden' }}>
        <div onClick={() => setExpandedId(expanded ? null : m.id)}
          style={{ display:'flex', alignItems:'center', gap:14, padding:'13px 16px', cursor:'pointer', flexWrap:'wrap' }}
          onMouseEnter={e => e.currentTarget.style.background = G.bg}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
          <span style={{ fontSize:18 }}>{m.tip === 'sediu' ? '🏢' : '🏗️'}</span>
          <div style={{ flex:1, minWidth:220 }}>
            <div style={{ fontSize:14.5, fontWeight:800 }}>{m.denumire}</div>
            <div style={{ fontSize:11.5, color:G.dim, marginTop:2 }}>
              {inchisa ? `Închisă ${fmtData(m.data_inchidere)}` : `Activă din ${fmtData(m.data_deschidere)}`}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10.5, color:G.muted }}>Poziții stoc</div>
              <div style={{ fontSize:16, fontWeight:800, color: st.pozitii ? G.text : G.dim }}>{st.pozitii}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:10.5, color:G.muted }}>Sub prag</div>
              <div style={{ fontSize:16, fontWeight:800, color: st.subPrag ? G.red : G.dim }}>{st.subPrag}</div>
            </div>
            <div style={{ textAlign:'right', minWidth:90 }}>
              <div style={{ fontSize:10.5, color:G.muted }}>💰 Valoare</div>
              <div style={{ fontSize:14, fontWeight:800, color: st.valoare > 0 ? G.green : G.dim }}>{st.valoare > 0 ? fmtNr(Math.round(st.valoare)) + ' lei' : '—'}</div>
            </div>
            <span style={{ fontSize:10.5, fontWeight:800, padding:'3px 9px', borderRadius:12, whiteSpace:'nowrap',
              background:(inchisa ? G.muted : G.green) + '22', color: inchisa ? G.muted : G.green }}>
              {inchisa ? 'închisă' : 'activă'}
            </span>
            {canManage && (
              <button onClick={(e) => { e.stopPropagation(); toggleStatus(m) }}
                style={{ ...S.btnS, fontSize:12, padding:'6px 12px', color: inchisa ? G.green : G.muted, whiteSpace:'nowrap' }}>
                {inchisa ? '↺ Redeschide' : '⏸ Închide magazia'}
              </button>
            )}
            <span style={{ fontSize:12, color:G.dim, transform: expanded ? 'rotate(180deg)' : 'none', transition:'transform .15s' }}>▼</span>
          </div>
        </div>
        {expanded && (
          <div style={{ borderTop:`1px solid ${G.border}`, background:G.bg }}>
            {items.length === 0 ? (
              <div style={{ padding:'16px', fontSize:12.5, color:G.muted, textAlign:'center' }}>📭 Magazia e goală — niciun material în stoc.</div>
            ) : (
              <>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 60px 110px 120px', gap:10, padding:'8px 16px', fontSize:10.5, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
                  <div>Material</div><div>UM</div><div style={{ textAlign:'right' }}>Cantitate</div><div style={{ textAlign:'right' }}>Valoare</div>
                </div>
                {items.map(s => {
                  const val = s.cost_mediu != null ? Number(s.cantitate) * Number(s.cost_mediu) : null
                  return (
                    <div key={s.id} style={{ display:'grid', gridTemplateColumns:'1fr 60px 110px 120px', gap:10, alignItems:'center', padding:'8px 16px', fontSize:13, borderBottom:`1px solid ${G.border}` }}>
                      <div style={{ fontWeight:600 }}>{s.material_denumire}
                        {s.prag_minim != null && Number(s.cantitate) < Number(s.prag_minim) &&
                          <span style={{ fontSize:10, fontWeight:800, color:G.red, marginLeft:8 }}>⚠ sub prag</span>}
                      </div>
                      <div style={{ color:G.muted }}>{s.um || '—'}</div>
                      <div style={{ textAlign:'right', fontWeight:800, color: Number(s.cantitate) > 0 ? G.green : G.red }}>{fmtNr(s.cantitate)}</div>
                      <div style={{ textAlign:'right', fontSize:12.5, color: val != null ? G.green : G.dim }}>{val != null ? fmtNr(Math.round(val)) + ' lei' : 'fără cost'}</div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
        {[['🏬', 'Magazii active', active.length, G.magazie], ['📦', 'Sub prag minim', totalSubPrag, totalSubPrag ? G.red : G.green], ['🗄️', 'Închise', inchise.length, G.muted]].map(([e, l, v, c], i) => (
          <div key={i} style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:150 }}>
            <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>{e} {l}</div>
            <div style={{ fontSize:24, fontWeight:800, color:c }}>{v}</div>
          </div>
        ))}
        <button onClick={loadAll} style={{ ...S.btnS, alignSelf:'center' }}>🔄 Reîncarcă</button>
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă magaziile...</div>}

      {!loading && (
        <>
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
            {active.map(m => <Card key={m.id} m={m} />)}
          </div>
          {inchise.length > 0 && (
            <>
              <div style={{ fontSize:12.5, color:G.muted, fontWeight:700, margin:'4px 0 10px' }}>🗄️ Magazii închise</div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {inchise.map(m => <Card key={m.id} m={m} />)}
              </div>
            </>
          )}
        </>
      )}

      <div style={{ padding:14, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:12, color:G.muted, lineHeight:1.7, marginTop:14 }}>
        <b style={{ color:G.text }}>🏬 Magazii pe șantiere:</b> fiecare proiect activ are automat o magazie (se deschide singură când se înregistrează un proiect/contract nou). Stocul, transferurile și consumul se leagă de ea. Pragurile minime se setează per material în tab-ul Materiale.
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════════
// CATALOG MATERIALE — Faza 6.2b: listă de referință + autocomplete
// ════════════════════════════════════════════════════════════════
function MaterialAutocomplete({ value, onChange, onPick, catalog, placeholder, autoFocus }) {
  const [open, setOpen] = useState(false)
  const sug = useMemo(() => {
    const q = normalize(value)
    if (!q) return catalog.slice(0, 8)
    return catalog.filter(m => normalize(m.denumire).includes(q) || normalize(m.cod || '').includes(q)).slice(0, 8)
  }, [value, catalog])
  return (
    <div style={{ position:'relative' }}>
      <input style={S.input} value={value} placeholder={placeholder} autoFocus={autoFocus}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 160)} />
      {open && sug.length > 0 && (
        <div style={{ position:'absolute', top:'100%', left:0, right:0, zIndex:50, background:G.surface, border:`1px solid ${G.border2}`, borderRadius:8, marginTop:2, maxHeight:220, overflowY:'auto', boxShadow:'0 8px 24px rgba(0,0,0,.4)' }}>
          {sug.map(m => (
            <div key={m.id} onMouseDown={() => { onPick(m); setOpen(false) }}
              style={{ padding:'8px 12px', fontSize:13, cursor:'pointer', borderBottom:`1px solid ${G.border}` }}>
              <span style={{ fontWeight:600 }}>{m.denumire}</span>
              {m.cod && <span style={{ color:G.dim, marginLeft:6, fontSize:11 }}>{m.cod}</span>}
              {m.um && <span style={{ color:G.muted, marginLeft:6, fontSize:11 }}>({m.um})</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogModal({ item, onClose, onDone }) {
  const edit = !!item?.id
  const [cod, setCod] = useState(item?.cod || '')
  const [denumire, setDenumire] = useState(item?.denumire || '')
  const [um, setUm] = useState(item?.um || 'buc')
  const [activ, setActiv] = useState(item?.activ ?? true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const salveaza = async () => {
    if (!denumire.trim()) { setErr('Denumirea e obligatorie.'); return }
    setBusy(true); setErr('')
    try {
      const payload = { cod: cod.trim() || null, denumire: denumire.trim(), um: um.trim() || null, activ }
      const { error } = edit
        ? await supabase.from('materiale').update(payload).eq('id', item.id)
        : await supabase.from('materiale').insert(payload)
      if (error) throw error
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ ...S.card, width:'min(480px,100%)', padding:22 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:16 }}>{edit ? '✏️ Editează material' : '➕ Material nou în catalog'}</div>
        <div style={{ display:'flex', gap:10, marginBottom:12 }}>
          <div style={{ width:130 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Cod</label>
            <input style={S.input} value={cod} onChange={e => setCod(e.target.value)} placeholder="opțional" />
          </div>
          <div style={{ width:90 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>UM</label>
            <input style={S.input} value={um} onChange={e => setUm(e.target.value)} placeholder="buc" />
          </div>
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Denumire <span style={{ color:G.red }}>*</span></label>
          <input style={S.input} autoFocus value={denumire} onChange={e => setDenumire(e.target.value)} placeholder="ex: Electrozi bazici E7018 3.25mm" />
        </div>
        <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer', marginBottom:8 }}>
          <input type="checkbox" checked={activ} onChange={e => setActiv(e.target.checked)} /> Activ (apare în autocomplete)
        </label>
        {err && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginBottom:8 }}>{err}</div>}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:8 }}>
          <button onClick={onClose} disabled={busy} style={S.btnS}>Anulează</button>
          <button onClick={salveaza} disabled={busy} style={{ ...S.btnP, background:G.magazie, color:'#3a0d0a', opacity: busy ? .6 : 1 }}>{busy ? '...' : 'Salvează'}</button>
        </div>
      </div>
    </div>
  )
}

function CatalogTab() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [profile, setProfile] = useState(null)
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)   // {} nou | {id...} editează

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      let prof = null
      if (user) { const { data } = await supabase.from('profiles').select('id, is_owner, can_manage_stoc').eq('id', user.id).maybeSingle(); prof = data || null }
      const { data } = await supabase.from('materiale').select('*').order('denumire')
      setProfile(prof); setItems(data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  const canManage = !!(profile?.is_owner || profile?.can_manage_stoc)
  const filtered = useMemo(() => search ? items.filter(m => normalize(m.denumire).includes(normalize(search)) || normalize(m.cod || '').includes(normalize(search))) : items, [items, search])

  return (
    <>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
        <div style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:160 }}>
          <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>📒 Materiale în catalog</div>
          <div style={{ fontSize:24, fontWeight:800, color:G.magazie }}>{items.filter(m => m.activ).length}<span style={{ fontSize:13, color:G.dim, fontWeight:600 }}> active</span></div>
        </div>
        <input style={{ ...S.input, maxWidth:320, alignSelf:'center' }} placeholder="🔍 Caută în catalog..." value={search} onChange={e => setSearch(e.target.value)} />
        <button onClick={loadAll} style={{ ...S.btnS, alignSelf:'center' }}>🔄</button>
        {canManage && <button onClick={() => setModal({})} style={{ ...S.btnP, background:G.magazie, color:'#3a0d0a', alignSelf:'center' }}>➕ Material nou</button>}
      </div>

      {loading && <div style={{ padding:40, textAlign:'center', color:G.muted }}>Se încarcă catalogul...</div>}
      {!loading && !filtered.length && (
        <div style={{ ...S.card, padding:40, textAlign:'center' }}>
          <div style={{ fontSize:40, marginBottom:10 }}>📒</div>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>{search ? 'Niciun material găsit.' : 'Catalogul e gol.'}</div>
          <div style={{ fontSize:13, color:G.muted }}>Adaugă materialele standard folosite des — vor apărea ca sugestii (autocomplete) la adăugarea de stoc.</div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ ...S.card, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'130px 1fr 80px 80px 90px', gap:10, padding:'9px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Cod</div><div>Denumire</div><div>UM</div><div style={{ textAlign:'center' }}>Stare</div><div></div>
          </div>
          {filtered.map(m => (
            <div key={m.id} style={{ display:'grid', gridTemplateColumns:'130px 1fr 80px 80px 90px', gap:10, alignItems:'center', padding:'9px 16px', fontSize:13, borderBottom:`1px solid ${G.border}`, opacity: m.activ ? 1 : .5 }}>
              <div style={{ color:G.dim, fontSize:12 }}>{m.cod || '—'}</div>
              <div style={{ fontWeight:600 }}>{m.denumire}</div>
              <div style={{ color:G.muted }}>{m.um || '—'}</div>
              <div style={{ textAlign:'center' }}><span style={{ fontSize:11, fontWeight:700, color: m.activ ? G.green : G.muted }}>{m.activ ? 'activ' : 'inactiv'}</span></div>
              <div style={{ textAlign:'right' }}>
                {canManage && <button onClick={() => setModal(m)} style={{ ...S.btnS, padding:'5px 10px', fontSize:12 }}>✏️</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && <CatalogModal item={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); loadAll() }} />}
    </>
  )
}

// ── Modal: adaugă poziție de stoc (material din catalog + cant + preț) ──
function AdaugaPozitieModal({ proiecteMap, catalog, onClose, onDone }) {
  const [loc, setLoc] = useState('')
  const [den, setDen] = useState('')
  const [um, setUm] = useState('')
  const [cant, setCant] = useState('')
  const [pret, setPret] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const locOptions = useMemo(() => {
    const opts = [{ v:'sediu', label:'🏢 Sediu Ploiești' }]
    ;[...new Set(Object.keys(proiecteMap).map(Number))].forEach(id => opts.push({ v:`proiect:${id}`, label: locLabel('proiect', id, proiecteMap) }))
    return opts
  }, [proiecteMap])

  const valid = loc && den.trim() && Number(cant) > 0
  const adauga = async () => {
    if (!valid) { setErr('Completează locație, material și cantitate (>0).'); return }
    setBusy(true); setErr('')
    try {
      const [tip, id] = parseLoc(loc)
      const { error } = await supabase.from('stocuri_miscari').insert({
        locatie_tip: tip, locatie_id: id, material_denumire: den.trim(), um: um.trim() || null,
        delta: Math.abs(Number(cant)), tip: 'corectie_initiala', motiv: 'Adăugare manuală stoc',
        pret_unitar: pret.trim() !== '' ? Math.abs(Number(pret)) : null,
      })
      if (error) throw error
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ ...S.card, width:'min(520px,100%)', padding:22 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:16 }}>➕ Adaugă poziție de stoc</div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Locație <span style={{ color:G.red }}>*</span></label>
          <select style={S.input} value={loc} onChange={e => setLoc(e.target.value)}>
            <option value="">— alege locația —</option>
            {locOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Material <span style={{ color:G.red }}>*</span> <span style={{ color:G.dim }}>(scrie sau alege din catalog)</span></label>
          <MaterialAutocomplete value={den} catalog={catalog} placeholder="ex: Electrozi bazici E7018..."
            onChange={setDen} onPick={(m) => { setDen(m.denumire); if (m.um) setUm(m.um) }} />
        </div>
        <div style={{ display:'flex', gap:10, marginBottom:12 }}>
          <div style={{ width:90 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>UM</label>
            <input style={S.input} value={um} onChange={e => setUm(e.target.value)} placeholder="buc" />
          </div>
          <div style={{ flex:1 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Cantitate <span style={{ color:G.red }}>*</span></label>
            <input type="number" min="0" step="any" style={S.input} value={cant} onChange={e => setCant(e.target.value)} placeholder="0" />
          </div>
          <div style={{ flex:1 }}>
            <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Preț unitar</label>
            <input type="number" min="0" step="any" style={S.input} value={pret} onChange={e => setPret(e.target.value)} placeholder="opțional" />
          </div>
        </div>
        <div style={{ fontSize:11.5, color:G.dim, marginBottom:8 }}>Prețul unitar (dacă-l completezi) devine cost mediu inițial al poziției.</div>
        {err && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginBottom:8 }}>{err}</div>}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:8 }}>
          <button onClick={onClose} disabled={busy} style={S.btnS}>Anulează</button>
          <button onClick={adauga} disabled={busy || !valid} style={{ ...S.btnP, background:G.magazie, color:'#3a0d0a', opacity:(busy || !valid) ? .6 : 1 }}>{busy ? '...' : 'Adaugă în stoc'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Modal: cost mediu manual per poziție ───────────────────────
function CostModal({ poz, onClose, onDone }) {
  const [cost, setCost] = useState(poz.cost_mediu != null ? String(poz.cost_mediu) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const salveaza = async (clear) => {
    setBusy(true); setErr('')
    try {
      const val = clear ? null : (cost.trim() === '' ? null : Math.abs(Number(cost)))
      if (!clear && val != null && (isNaN(val) || val < 0)) { setErr('Cost invalid.'); setBusy(false); return }
      const { error } = await supabase.from('stocuri').update({ cost_mediu: val }).eq('id', poz.id)
      if (error) throw error
      onDone()
    } catch (e) { setErr(e.message || String(e)); setBusy(false) }
  }
  const val = cost.trim() !== '' ? Number(cost) * Number(poz.cantitate) : null

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ ...S.card, width:'min(440px,100%)', padding:22 }}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:4 }}>💰 Cost mediu</div>
        <div style={{ fontSize:13, color:G.muted, marginBottom:16 }}>{poz.material_denumire} · {fmtNr(poz.cantitate)} {poz.um || ''}</div>
        <label style={{ fontSize:12, color:G.muted, marginBottom:4, display:'block' }}>Cost mediu unitar ({poz.um || 'buc'})</label>
        <input type="number" min="0" step="any" autoFocus style={S.input} value={cost} onChange={e => setCost(e.target.value)} placeholder="ex: 12.50" />
        {val != null && <div style={{ marginTop:10, fontSize:13, color:G.muted }}>Valoare poziție: <b style={{ color:G.green }}>{fmtNr(val)} lei</b></div>}
        <div style={{ fontSize:11.5, color:G.dim, marginTop:8 }}>După setare, intrările viitoare cu preț recalculează automat media ponderată (WAC).</div>
        {err && <div style={{ padding:'8px 12px', background:G.red + '18', border:`1px solid ${G.red}55`, borderRadius:8, fontSize:12.5, color:G.red, marginTop:8 }}>{err}</div>}
        <div style={{ display:'flex', justifyContent:'space-between', gap:10, marginTop:16 }}>
          <button onClick={() => salveaza(true)} disabled={busy || poz.cost_mediu == null} style={{ ...S.btnS, color:G.red, opacity:(busy || poz.cost_mediu == null) ? .5 : 1 }}>Șterge cost</button>
          <div style={{ display:'flex', gap:10 }}>
            <button onClick={onClose} disabled={busy} style={S.btnS}>Anulează</button>
            <button onClick={() => salveaza(false)} disabled={busy} style={{ ...S.btnP, background:G.green, color:'#06210F', opacity: busy ? .6 : 1 }}>{busy ? '...' : 'Salvează cost'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
// SHELL cu tab-uri
// ════════════════════════════════════════════════════════════════
export default function MagaziePage() {
  const [tab, setTab] = useState('materiale')
  return (
    <div style={{ ...S.page, padding:'24px 0' }}>
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:18, flexWrap:'wrap' }}>
        <div style={{ width:44, height:44, borderRadius:12, background:G.magazie + '22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>📦</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:22, fontWeight:800 }}>Magazie</div>
          <div style={{ fontSize:12.5, color:G.muted }}>Materiale (stoc cantitativ) + Echipamente (predare pe angajat)</div>
        </div>
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:18 }}>
        {[['materiale', '📋 Materiale'], ['magazii', '🏬 Magazii'], ['transferuri', '🔁 Transferuri'], ['consum', '🔧 Consum'], ['catalog', '📒 Catalog'], ['echipamente', '🧰 Echipamente'], ['stoc_trasabil', '🔍 Stoc trasabil']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding:'9px 18px', fontSize:14, fontWeight:700, cursor:'pointer', borderRadius:8,
            background: tab === k ? G.magazie + '22' : 'transparent',
            color: tab === k ? G.magazie : G.muted,
            border:`1px solid ${tab === k ? G.magazie + '66' : G.border2}`,
          }}>{l}</button>
        ))}
      </div>

      {tab === 'materiale' && <MaterialeTab />}
      {tab === 'magazii' && <MagaziiTab />}
      {tab === 'transferuri' && <TransferuriTab />}
      {tab === 'consum' && <ConsumuriTab />}
      {tab === 'catalog' && <CatalogTab />}
      {tab === 'echipamente' && <EchipamenteTab />}
      {tab === 'stoc_trasabil' && <StocTrasabilTab />}
    </div>
  )
}
