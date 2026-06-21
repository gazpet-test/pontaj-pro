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
      const [rStoc, rProj] = await Promise.all([
        supabase.from('stocuri').select('*').order('material_denumire'),
        supabase.from('executie_proiecte').select('id, nume, cod_intern'),
      ])
      setProfile(prof)
      setStocuri(rStoc.data || [])
      setProiecte(rProj.data || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [])
  useEffect(() => { loadAll() }, [loadAll])

  // Gate ajustare: owner SAU can_manage_stoc (flag setat din Admin)
  const canManage = !!(profile?.is_owner || profile?.can_manage_stoc)

  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])

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
    if (map.has('sediu')) out.push({ key:'sediu', titlu:'🏢 Stoc Sediu (Ploiești)', items: map.get('sediu') })
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
    <>
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
        <button onClick={loadAll} style={{ ...S.btnS, fontSize:14, alignSelf:'center' }}>🔄 Reîncarcă</button>
      </div>

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

      {!loading && grupe.map(gr => (
        <div key={gr.key} style={{ ...S.card, overflow:'hidden', marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:`1px solid ${G.border}`, background:G.bg }}>
            <div style={{ fontSize:15, fontWeight:800, flex:1 }}>{gr.titlu}</div>
            <span style={{ background:G.magazie + '22', color:G.magazie, border:`1px solid ${G.magazie}55`, borderRadius:14, padding:'3px 12px', fontSize:12, fontWeight:800 }}>{gr.items.length} {gr.items.length === 1 ? 'poziție' : 'poziții'}</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 90px 140px 150px 150px', gap:10, padding:'8px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Material</div><div>UM</div><div style={{ textAlign:'right' }}>Cantitate</div><div>Actualizat</div><div></div>
          </div>
          {gr.items.map(s => (
            <div key={s.id} style={{ display:'grid', gridTemplateColumns:'1fr 90px 140px 150px 150px', gap:10, alignItems:'center', padding:'10px 16px', fontSize:13.5, borderBottom:`1px solid ${G.border}` }}>
              <div style={{ fontWeight:600 }}>{s.material_denumire}{s.observatii && <div style={{ fontSize:11, color:G.muted }}>{s.observatii}</div>}</div>
              <div style={{ color:G.muted }}>{s.um || '—'}</div>
              <div style={{ textAlign:'right', fontWeight:800, fontSize:15, color: Number(s.cantitate) > 0 ? G.green : G.red }}>{fmtNr(s.cantitate)}</div>
              <div style={{ fontSize:12, color:G.dim }}>{fmtDataOra(s.updated_at)}</div>
              <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                <button onClick={() => setIstoricFor(s)} title="Istoric mișcări"
                  style={{ ...S.btnS, padding:'5px 10px', fontSize:12 }}>📜</button>
                {canManage && (
                  <button onClick={() => setAjustModal(s)} title="Ajustează stoc (+/-)"
                    style={{ ...S.btnS, padding:'5px 10px', fontSize:12, color:G.magazie, borderColor:G.magazie + '66' }}>± Ajustează</button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div style={{ padding:14, background:G.bg, border:`1px dashed ${G.border2}`, borderRadius:10, fontSize:12, color:G.muted, lineHeight:1.7, marginTop:6 }}>
        <b style={{ color:G.text }}>📋 Faza 6.1 activă:</b> ajustări manuale +/- cu motiv obligatoriu + registru de mișcări (audit complet per material).
        Intrările vin automat din Achiziții (recepție → PV predare). Următor: transfer sediu↔proiect, consum pe proiect cu PV, praguri minime + valori stoc.
      </div>

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

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [rEch, rAsig, rEmp, rUser] = await Promise.all([
        supabase.from('v_magazie_echipamente').select('*').order('denumire'),
        supabase.from('v_magazie_inventar_activ').select('*').is('data_retur', null),
        supabase.from('employees').select('id, name, functie').order('name'),
        supabase.auth.getUser(),
      ])
      setEchipamente(rEch.data || [])
      setAsignari(rAsig.data || [])
      setEmployees(rEmp.data || [])
      setUid(rUser.data?.user?.id || null)
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
        {[['materiale', '📋 Materiale'], ['echipamente', '🧰 Echipamente'], ['stoc_trasabil', '🔍 Stoc trasabil']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding:'9px 18px', fontSize:14, fontWeight:700, cursor:'pointer', borderRadius:8,
            background: tab === k ? G.magazie + '22' : 'transparent',
            color: tab === k ? G.magazie : G.muted,
            border:`1px solid ${tab === k ? G.magazie + '66' : G.border2}`,
          }}>{l}</button>
        ))}
      </div>

      {tab === 'materiale' && <MaterialeTab />}
      {tab === 'echipamente' && <EchipamenteTab />}
      {tab === 'stoc_trasabil' && <StocTrasabilTab />}
    </div>
  )
}
