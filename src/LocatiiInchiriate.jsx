// ═══════════════════════════════════════════════════════════════════════════
// LOCAȚII ÎNCHIRIATE — chirie + utilități
// ═══════════════════════════════════════════════════════════════════════════
// Apartamentele de cazare (muncitori străini) și punctele de lucru închiriate
// (Piatra Neamț). Scopul: centralizarea costurilor pe fiecare locație.
//   locatii_inchiriate = locația + datele contractului de închiriere
//   locatii_furnizori  = furnizorii ei (codul de client identifică facturile)
//   locatii_cheltuieli = chiria lunară + facturile de utilități
// Se montează ca tab în Administrativ, deci accesul e cel al modulului.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  orange:'#F0883E', purple:'#A371F7', blue:'#58A6FF',
  green:'#3FB950', yellow:'#D29922', red:'#F85149',
}
const S = {
  page: { padding:'4px 0 24px', color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input:{ background:G.bg, border:`1px solid ${G.border}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { padding:'9px 16px', background:G.orange, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 13px', background:'transparent', color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
  label:{ fontSize:11, color:G.muted, fontWeight:700, marginBottom:5, display:'block', textTransform:'uppercase', letterSpacing:.4 },
}

// Tipurile reale de cheltuieli pe un apartament închiriat:
//   contract chirie · curent · internet · fișă întreținere bloc (curățenie scară,
//   căldură comună) — mereu; plus gaz + apă rece dacă are centrală proprie,
//   altfel apa caldă/rece vine pe factura administratorului de bloc.
const TIPURI = {
  chirie:      { label:'Chirie',            icon:'🔑', color:G.orange },
  energie:     { label:'Curent',            icon:'⚡', color:G.yellow },
  gaz:         { label:'Gaze',              icon:'🔥', color:'#E8734A' },
  apa:         { label:'Apă rece',          icon:'💧', color:G.blue   },
  asociatie:   { label:'Administrator bloc',icon:'🚿', color:G.green  },
  intretinere: { label:'Întreținere bloc',  icon:'🧹', color:G.purple },
  internet:    { label:'Internet/TV',       icon:'📶', color:'#4FC3F7' },
  salubritate: { label:'Salubritate',       icon:'🗑',  color:G.muted  },
  altele:      { label:'Altele',            icon:'📄', color:G.muted  },
}
const TIP_ORD = ['chirie','energie','gaz','apa','asociatie','intretinere','internet','salubritate','altele']

// Ce facturi se așteaptă lunar pentru o locație, în funcție de centrală.
const tipuriAsteptate = (l) => l?.are_centrala
  ? ['chirie','energie','gaz','apa','intretinere','internet']
  : ['chirie','energie','asociatie','intretinere','internet']
const TIP_LOCATIE = { apartament:'🏠 Apartament', birou:'🏢 Birou', depozit:'📦 Depozit', teren:'🌍 Teren', altele:'📍 Altele' }

const fmtLei  = (n) => (Number(n) || 0).toLocaleString('ro-RO', { minimumFractionDigits:2, maximumFractionDigits:2 })
const fmtData = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO',{day:'2-digit',month:'short',year:'numeric'}) : '—'
const fmtLuna = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO',{month:'long',year:'numeric'}) : '—'
const azi     = () => new Date().toISOString().slice(0,10)
const lunaCurenta = () => azi().slice(0,7) + '-01'

// Zilele până la scadență; negativ = restanță.
function zileScadenta(data) {
  if (!data) return null
  return Math.ceil((new Date(String(data).slice(0,10)+'T00:00:00').getTime() - new Date(azi()+'T00:00:00').getTime()) / 864e5)
}

function Mesaj({ mesaj, onClose }) {
  if (!mesaj) return null
  const c = mesaj.tip === 'error' ? G.red : mesaj.tip === 'warn' ? G.yellow : G.green
  return (
    <div style={{...S.card, padding:'10px 14px', marginBottom:14, borderColor:c+'55', background:c+'11',
                 display:'flex', justifyContent:'space-between', alignItems:'center', gap:12}}>
      <span style={{fontSize:13, color:c, fontWeight:600}}>{mesaj.text}</span>
      <button onClick={onClose} style={{...S.btnS, padding:'3px 9px', fontSize:12, color:G.muted}}>✕</button>
    </div>
  )
}

function KPI({ icon, label, value, color, sub }) {
  return (
    <div style={{...S.card, padding:'14px 18px', borderColor: color ? color+'33' : G.border}}>
      <div style={{fontSize:11, color:color||G.muted, fontWeight:700, marginBottom:6, textTransform:'uppercase', letterSpacing:.4, display:'flex', gap:6, alignItems:'center'}}>
        <span>{icon}</span><span>{label}</span>
      </div>
      <div style={{fontSize:24, fontWeight:800, color:G.text, lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:10, color:G.dim, marginTop:6}}>{sub}</div>}
    </div>
  )
}

// ─── Modal locație (adaugă / editează) ──────────────────────────────────────
function FormLocatie({ locatie, sites, onSalvat, onClose, setMesaj }) {
  const [f, setF] = useState(() => ({
    nume: locatie?.nume || '', adresa: locatie?.adresa || '', oras: locatie?.oras || '',
    tip: locatie?.tip || 'apartament', scop: locatie?.scop || '',
    site_id: locatie?.site_id ?? '', proprietar: locatie?.proprietar || '',
    proprietar_contact: locatie?.proprietar_contact || '',
    chirie_lunara: locatie?.chirie_lunara ?? '', moneda: locatie?.moneda || 'RON',
    zi_scadenta_chirie: locatie?.zi_scadenta_chirie ?? '',
    contract_de: locatie?.contract_de || '', contract_pana: locatie?.contract_pana || '',
    garantie: locatie?.garantie ?? '', nr_persoane: locatie?.nr_persoane ?? '',
    observatii: locatie?.observatii || '', activ: locatie?.activ ?? true,
    are_centrala: locatie?.are_centrala ?? true,
  }))
  const [lucrez, setLucrez] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  const salveaza = async () => {
    if (!f.nume.trim()) { setMesaj({ tip:'warn', text:'Locația are nevoie de un nume.' }); return }
    setLucrez(true)
    try {
      const patch = {
        ...f,
        nume: f.nume.trim(),
        site_id: f.site_id === '' ? null : Number(f.site_id),
        chirie_lunara: f.chirie_lunara === '' ? null : Number(f.chirie_lunara),
        zi_scadenta_chirie: f.zi_scadenta_chirie === '' ? null : Number(f.zi_scadenta_chirie),
        garantie: f.garantie === '' ? null : Number(f.garantie),
        nr_persoane: f.nr_persoane === '' ? null : Number(f.nr_persoane),
        contract_de: f.contract_de || null, contract_pana: f.contract_pana || null,
      }
      const { error } = locatie
        ? await supabase.from('locatii_inchiriate').update(patch).eq('id', locatie.id)
        : await supabase.from('locatii_inchiriate').insert(patch)
      if (error) throw error
      setMesaj({ tip:'success', text: locatie ? 'Locație actualizată.' : 'Locație adăugată.' })
      onSalvat(); onClose()
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
    finally { setLucrez(false) }
  }

  const camp = (k, eticheta, props = {}) => (
    <div>
      <label style={S.label}>{eticheta}</label>
      <input style={S.input} value={f[k]} onChange={e => set(k, e.target.value)} {...props} />
    </div>
  )

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000A', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, width:'min(720px, 96vw)', maxHeight:'92vh', overflow:'auto', padding:22}}>
        <div style={{fontSize:17, fontWeight:800, marginBottom:16}}>
          {locatie ? '✏️ Editează locația' : '➕ Locație închiriată nouă'}
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          {camp('nume', 'Nume *', { placeholder:'ex: Apartament Brumărelelor' })}
          <div>
            <label style={S.label}>Tip</label>
            <select style={S.input} value={f.tip} onChange={e => set('tip', e.target.value)}>
              {Object.entries(TIP_LOCATIE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <div style={{marginBottom:12}}>{camp('adresa', 'Adresă completă', { placeholder:'stradă, nr, bloc, scară, etaj, apartament' })}</div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          {camp('oras', 'Oraș')}
          {camp('scop', 'Scop', { placeholder:'ex: Cazare muncitori străini' })}
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          {camp('proprietar', 'Proprietar')}
          {camp('proprietar_contact', 'Contact proprietar', { placeholder:'telefon / email' })}
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 100px 1fr 1fr', gap:12, marginBottom:12}}>
          {camp('chirie_lunara', 'Chirie lunară', { type:'number', step:'0.01', placeholder:'0.00' })}
          <div>
            <label style={S.label}>Monedă</label>
            <select style={S.input} value={f.moneda} onChange={e => set('moneda', e.target.value)}>
              <option value="RON">RON</option><option value="EUR">EUR</option>
            </select>
          </div>
          {camp('zi_scadenta_chirie', 'Zi scadență', { type:'number', min:1, max:31, placeholder:'ex: 5' })}
          {camp('garantie', 'Garanție', { type:'number', step:'0.01' })}
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12}}>
          {camp('contract_de', 'Contract de la', { type:'date' })}
          {camp('contract_pana', 'Contract până la', { type:'date' })}
          {camp('nr_persoane', 'Nr. persoane cazate', { type:'number', min:0 })}
        </div>

        <div style={{marginBottom:12}}>
          <label style={S.label}>Legătură cu șantier/sediu (opțional)</label>
          <select style={S.input} value={f.site_id} onChange={e => set('site_id', e.target.value)}>
            <option value="">— fără legătură —</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div style={{marginBottom:16}}>{camp('observatii', 'Observații')}</div>

        <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:10, cursor:'pointer'}}>
          <input type="checkbox" checked={f.are_centrala} onChange={e => set('are_centrala', e.target.checked)} />
          <span>Are centrală proprie
            <span style={{color:G.dim, fontSize:11, marginLeft:6}}>
              (bifat: facturi separate de gaze + apă rece · nebifat: apa caldă/rece vine de la administratorul blocului)
            </span>
          </span>
        </label>

        <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, marginBottom:18, cursor:'pointer'}}>
          <input type="checkbox" checked={f.activ} onChange={e => set('activ', e.target.checked)} />
          <span>Locație activă (contract în derulare)</span>
        </label>

        <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS}>Renunță</button>
          <button onClick={salveaza} disabled={lucrez} style={{...S.btnP, opacity:lucrez ? .6 : 1}}>
            {lucrez ? 'Salvez…' : 'Salvează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Modal cheltuială (chirie sau factură de utilitate) ─────────────────────
function FormCheltuiala({ locatie, furnizori, onSalvat, onClose, setMesaj }) {
  const [f, setF] = useState({
    tip:'energie', furnizor:'', cod_client:'', numar_factura:'',
    luna: lunaCurenta(), data_emitere: azi(), data_scadenta:'',
    valoare:'', moneda:'RON', status:'neplatita', observatii:'',
  })
  const [lucrez, setLucrez] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))

  // Alegerea unui furnizor cunoscut completează singură furnizorul + codul de client.
  const alegeFurnizor = (id) => {
    const fz = furnizori.find(x => String(x.id) === String(id))
    if (fz) setF(p => ({ ...p, tip: fz.tip, furnizor: fz.furnizor, cod_client: fz.cod_client || '' }))
  }

  const salveaza = async () => {
    if (!f.valoare || Number(f.valoare) <= 0) { setMesaj({ tip:'warn', text:'Pune o valoare mai mare ca zero.' }); return }
    setLucrez(true)
    try {
      const { error } = await supabase.from('locatii_cheltuieli').insert({
        locatie_id: locatie.id, tip: f.tip,
        furnizor: f.furnizor.trim() || null, cod_client: f.cod_client.trim() || null,
        numar_factura: f.numar_factura.trim() || null,
        luna: f.luna, data_emitere: f.data_emitere || null, data_scadenta: f.data_scadenta || null,
        valoare: Number(f.valoare), moneda: f.moneda, status: f.status,
        data_platii: f.status === 'platita' ? azi() : null,
        observatii: f.observatii.trim() || null,
      })
      if (error) throw error
      setMesaj({ tip:'success', text:`Adăugat: ${TIPURI[f.tip].label} — ${fmtLei(f.valoare)} ${f.moneda}` })
      onSalvat(); onClose()
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
    finally { setLucrez(false) }
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'#000A', zIndex:900, display:'flex', alignItems:'center', justifyContent:'center', padding:20}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, width:'min(620px, 96vw)', maxHeight:'92vh', overflow:'auto', padding:22}}>
        <div style={{fontSize:17, fontWeight:800, marginBottom:4}}>➕ Cheltuială nouă</div>
        <div style={{fontSize:12, color:G.muted, marginBottom:16}}>{locatie.nume}</div>

        {furnizori.length > 0 && (
          <div style={{marginBottom:12}}>
            <label style={S.label}>Furnizor cunoscut (completează automat)</label>
            <select style={S.input} defaultValue="" onChange={e => alegeFurnizor(e.target.value)}>
              <option value="">— alege pentru completare rapidă —</option>
              {furnizori.map(fz => (
                <option key={fz.id} value={fz.id}>{TIPURI[fz.tip]?.icon} {fz.furnizor}{fz.cod_client ? ` · ${fz.cod_client}` : ''}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Tip *</label>
            <select style={S.input} value={f.tip} onChange={e => set('tip', e.target.value)}>
              {TIP_ORD.map(t => <option key={t} value={t}>{TIPURI[t].icon} {TIPURI[t].label}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>Furnizor</label>
            <input style={S.input} value={f.furnizor} onChange={e => set('furnizor', e.target.value)} placeholder="ex: Electrica Furnizare" />
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Cod client</label>
            <input style={S.input} value={f.cod_client} onChange={e => set('cod_client', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Număr factură</label>
            <input style={S.input} value={f.numar_factura} onChange={e => set('numar_factura', e.target.value)} />
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Luna facturii *</label>
            <input style={S.input} type="month" value={String(f.luna).slice(0,7)}
                   onChange={e => set('luna', e.target.value + '-01')} />
          </div>
          <div>
            <label style={S.label}>Data emiterii</label>
            <input style={S.input} type="date" value={f.data_emitere} onChange={e => set('data_emitere', e.target.value)} />
          </div>
          <div>
            <label style={S.label}>Data scadenței</label>
            <input style={S.input} type="date" value={f.data_scadenta} onChange={e => set('data_scadenta', e.target.value)} />
          </div>
        </div>

        <div style={{display:'grid', gridTemplateColumns:'1fr 100px 1fr', gap:12, marginBottom:12}}>
          <div>
            <label style={S.label}>Valoare *</label>
            <input style={S.input} type="number" step="0.01" value={f.valoare}
                   onChange={e => set('valoare', e.target.value)} placeholder="0.00" autoFocus />
          </div>
          <div>
            <label style={S.label}>Monedă</label>
            <select style={S.input} value={f.moneda} onChange={e => set('moneda', e.target.value)}>
              <option value="RON">RON</option><option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label style={S.label}>Status</label>
            <select style={S.input} value={f.status} onChange={e => set('status', e.target.value)}>
              <option value="neplatita">Neplătită</option><option value="platita">Plătită</option>
            </select>
          </div>
        </div>

        <div style={{marginBottom:18}}>
          <label style={S.label}>Observații</label>
          <input style={S.input} value={f.observatii} onChange={e => set('observatii', e.target.value)} />
        </div>

        <div style={{display:'flex', gap:10, justifyContent:'flex-end'}}>
          <button onClick={onClose} style={S.btnS}>Renunță</button>
          <button onClick={salveaza} disabled={lucrez} style={{...S.btnP, opacity:lucrez ? .6 : 1}}>
            {lucrez ? 'Salvez…' : 'Adaugă'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export default function LocatiiInchiriate({ profile }) {
  const [locatii, setLocatii]     = useState([])
  const [cheltuieli, setChelt]    = useState([])
  const [furnizori, setFurnizori] = useState([])
  const [sites, setSites]         = useState([])
  const [load, setLoad]           = useState(true)
  const [mesaj, setMesaj]         = useState(null)
  const [selId, setSelId]         = useState(null)
  const [formLoc, setFormLoc]     = useState(null)   // { locatie } sau { } pentru nou
  const [formChelt, setFormChelt] = useState(false)
  const [filtruLuna, setFiltruLuna] = useState('toate')

  const incarca = useCallback(async () => {
    setLoad(true)
    try {
      const [l, c, f, s] = await Promise.all([
        supabase.from('locatii_inchiriate').select('*').order('activ', { ascending:false }).order('nume'),
        supabase.from('locatii_cheltuieli').select('*').order('luna', { ascending:false }).order('tip'),
        supabase.from('locatii_furnizori').select('*'),
        supabase.from('sites').select('id, name').eq('active', true).order('name'),
      ])
      setLocatii(l.data || []); setChelt(c.data || [])
      setFurnizori(f.data || []); setSites(s.data || [])
    } catch (e) {
      setMesaj({ tip:'error', text:'Nu am putut încărca datele: ' + (e.message || e) })
    } finally { setLoad(false) }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { incarca() }, [incarca])

  const selectata = useMemo(() => locatii.find(l => l.id === selId) || null, [locatii, selId])

  const cheltLocatie = useMemo(() => {
    if (!selId) return []
    let arr = cheltuieli.filter(c => c.locatie_id === selId)
    if (filtruLuna !== 'toate') arr = arr.filter(c => String(c.luna).slice(0,7) === filtruLuna)
    return arr
  }, [cheltuieli, selId, filtruLuna])

  const luniDisponibile = useMemo(() => {
    const set = new Set(cheltuieli.filter(c => c.locatie_id === selId).map(c => String(c.luna).slice(0,7)))
    return [...set].sort().reverse()
  }, [cheltuieli, selId])

  // Ce facturi ar trebui să existe luna asta și care lipsesc încă.
  const asteptateLunaAsta = useMemo(() => {
    if (!selectata) return []
    const lunaAcum = lunaCurenta().slice(0,7)
    const prezente = new Set(cheltuieli
      .filter(c => c.locatie_id === selectata.id && String(c.luna).slice(0,7) === lunaAcum)
      .map(c => c.tip))
    return tipuriAsteptate(selectata).map(t => ({ tip:t, ok: prezente.has(t) }))
  }, [cheltuieli, selectata])

  // KPI-uri globale
  const kpi = useMemo(() => {
    const active = locatii.filter(l => l.activ)
    const chirieLunara = active.reduce((s, l) => s + (l.moneda === 'RON' ? Number(l.chirie_lunara || 0) : 0), 0)
    const chirieEur    = active.reduce((s, l) => s + (l.moneda === 'EUR' ? Number(l.chirie_lunara || 0) : 0), 0)
    const lunaAcum = lunaCurenta().slice(0,7)
    const utilLuna = cheltuieli
      .filter(c => c.tip !== 'chirie' && String(c.luna).slice(0,7) === lunaAcum)
      .reduce((s, c) => s + Number(c.valoare || 0), 0)
    const neplatite = cheltuieli.filter(c => c.status === 'neplatita')
    const restante  = neplatite.filter(c => (zileScadenta(c.data_scadenta) ?? 99) < 0)
    return { nrActive: active.length, chirieLunara, chirieEur, utilLuna, neplatite, restante }
  }, [locatii, cheltuieli])

  // Totalul pe locație, pentru cardurile din listă
  const totalPeLocatie = useMemo(() => {
    const lunaAcum = lunaCurenta().slice(0,7)
    const m = {}
    for (const c of cheltuieli) {
      m[c.locatie_id] ||= { total:0, lunaAsta:0, neplatite:0 }
      m[c.locatie_id].total += Number(c.valoare || 0)
      if (String(c.luna).slice(0,7) === lunaAcum) m[c.locatie_id].lunaAsta += Number(c.valoare || 0)
      if (c.status === 'neplatita') m[c.locatie_id].neplatite++
    }
    return m
  }, [cheltuieli])

  const marcheazaPlatita = async (c) => {
    try {
      const nou = c.status === 'platita' ? 'neplatita' : 'platita'
      const { error } = await supabase.from('locatii_cheltuieli')
        .update({ status: nou, data_platii: nou === 'platita' ? azi() : null }).eq('id', c.id)
      if (error) throw error
      setChelt(p => p.map(x => x.id === c.id ? { ...x, status:nou, data_platii: nou === 'platita' ? azi() : null } : x))
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
  }

  const stergeChelt = async (c) => {
    if (!confirm(`Ștergi ${TIPURI[c.tip]?.label} de ${fmtLei(c.valoare)} ${c.moneda}?`)) return
    try {
      const { error } = await supabase.from('locatii_cheltuieli').delete().eq('id', c.id)
      if (error) throw error
      setChelt(p => p.filter(x => x.id !== c.id))
      setMesaj({ tip:'success', text:'Cheltuială ștearsă.' })
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
  }

  // Generează linia de chirie pe luna curentă, din contractul locației.
  const generalChirie = async (l) => {
    const lunaAcum = lunaCurenta()
    if (!l.chirie_lunara) { setMesaj({ tip:'warn', text:'Locația nu are chirie lunară completată.' }); return }
    const exista = cheltuieli.some(c => c.locatie_id === l.id && c.tip === 'chirie' && String(c.luna).slice(0,7) === lunaAcum.slice(0,7))
    if (exista) { setMesaj({ tip:'warn', text:'Chiria pe luna asta e deja înregistrată.' }); return }
    try {
      const scad = l.zi_scadenta_chirie
        ? `${lunaAcum.slice(0,8)}${String(l.zi_scadenta_chirie).padStart(2,'0')}` : null
      const { error } = await supabase.from('locatii_cheltuieli').insert({
        locatie_id: l.id, tip:'chirie', furnizor: l.proprietar || null,
        luna: lunaAcum, data_emitere: azi(), data_scadenta: scad,
        valoare: l.chirie_lunara, moneda: l.moneda, status:'neplatita',
        observatii:'Generat din contract',
      })
      if (error) throw error
      setMesaj({ tip:'success', text:`Chirie ${fmtLuna(lunaAcum)}: ${fmtLei(l.chirie_lunara)} ${l.moneda}` })
      incarca()
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
  }

  if (load) return <div style={{...S.page, color:G.muted, fontSize:14, padding:'40px 0', textAlign:'center'}}>Se încarcă…</div>

  return (
    <div style={S.page}>
      <Mesaj mesaj={mesaj} onClose={() => setMesaj(null)} />

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:12, marginBottom:18}}>
        <KPI icon="🏠" label="Locații active" value={kpi.nrActive} color={G.blue} />
        <KPI icon="🔑" label="Chirie lunară" color={G.orange}
             value={`${fmtLei(kpi.chirieLunara)} lei`}
             sub={kpi.chirieEur > 0 ? `+ ${fmtLei(kpi.chirieEur)} EUR` : 'total contracte active'} />
        <KPI icon="⚡" label="Utilități luna asta" value={`${fmtLei(kpi.utilLuna)} lei`} color={G.yellow} />
        <KPI icon="⏳" label="Facturi neplătite" value={kpi.neplatite.length}
             color={kpi.restante.length ? G.red : G.green}
             sub={kpi.restante.length ? `${kpi.restante.length} cu scadența depășită` : 'nimic restant'} />
      </div>

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
        <div style={{fontSize:15, fontWeight:800}}>Locații</div>
        <button onClick={() => setFormLoc({})} style={S.btnP}>➕ Locație nouă</button>
      </div>

      {locatii.length === 0 ? (
        <div style={{...S.card, padding:'30px 20px', textAlign:'center', color:G.muted, fontSize:13}}>
          Nicio locație închiriată încă. Adaugă prima cu butonul de mai sus.
        </div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))', gap:12, marginBottom:20}}>
          {locatii.map(l => {
            const t = totalPeLocatie[l.id] || { total:0, lunaAsta:0, neplatite:0 }
            const sel = l.id === selId
            return (
              <div key={l.id} onClick={() => setSelId(sel ? null : l.id)}
                   style={{...S.card, padding:'14px 16px', cursor:'pointer',
                           borderColor: sel ? G.orange+'88' : G.border,
                           background: sel ? G.orange+'0C' : G.surface,
                           opacity: l.activ ? 1 : .55}}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:6}}>
                  <div style={{fontSize:14, fontWeight:800, minWidth:0}}>{l.nume}</div>
                  {!l.activ && <span style={{fontSize:9, fontWeight:800, color:G.dim, border:`1px solid ${G.border}`, borderRadius:4, padding:'2px 5px'}}>INACTIV</span>}
                  {t.neplatite > 0 && <span style={{fontSize:9, fontWeight:800, color:G.red, background:G.red+'22', borderRadius:4, padding:'2px 6px', whiteSpace:'nowrap'}}>{t.neplatite} neplătite</span>}
                </div>
                <div style={{fontSize:11, color:G.muted, marginBottom:10, lineHeight:1.45}}>
                  {TIP_LOCATIE[l.tip] || l.tip}{l.oras ? ` · ${l.oras}` : ''}
                  {l.adresa && <div style={{color:G.dim, marginTop:2}}>{l.adresa}</div>}
                  {l.scop && <div style={{color:G.dim, marginTop:2, fontStyle:'italic'}}>{l.scop}</div>}
                </div>
                <div style={{display:'flex', gap:16, fontSize:11, color:G.muted, borderTop:`1px solid ${G.border2}`, paddingTop:9}}>
                  <div>
                    <div style={{color:G.dim, fontSize:9, textTransform:'uppercase', letterSpacing:.4}}>Chirie</div>
                    <div style={{color:G.orange, fontWeight:800, fontSize:13}}>
                      {l.chirie_lunara ? `${fmtLei(l.chirie_lunara)} ${l.moneda}` : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{color:G.dim, fontSize:9, textTransform:'uppercase', letterSpacing:.4}}>Luna asta</div>
                    <div style={{color:G.text, fontWeight:800, fontSize:13}}>{fmtLei(t.lunaAsta)} lei</div>
                  </div>
                  <div>
                    <div style={{color:G.dim, fontSize:9, textTransform:'uppercase', letterSpacing:.4}}>Total</div>
                    <div style={{color:G.text, fontWeight:800, fontSize:13}}>{fmtLei(t.total)} lei</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectata && (
        <div style={{...S.card, overflow:'hidden'}}>
          <div style={{padding:'14px 18px', background:G.bg, borderBottom:`1px solid ${G.border}`,
                       display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap'}}>
            <div>
              <div style={{fontSize:15, fontWeight:800}}>{selectata.nume}</div>
              <div style={{fontSize:11, color:G.muted, marginTop:3}}>
                {selectata.proprietar ? `Proprietar: ${selectata.proprietar}` : 'Proprietar necompletat'}
                {selectata.proprietar_contact ? ` · ${selectata.proprietar_contact}` : ''}
                {selectata.contract_pana ? ` · contract până la ${fmtData(selectata.contract_pana)}` : ''}
              </div>
            </div>
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <button onClick={() => generalChirie(selectata)} style={{...S.btnS, color:G.orange, borderColor:G.orange+'55'}}>🔑 Chiria pe luna asta</button>
              <button onClick={() => setFormLoc({ locatie: selectata })} style={S.btnS}>✏️ Editează</button>
              <button onClick={() => setFormChelt(true)} style={S.btnP}>➕ Cheltuială</button>
            </div>
          </div>

          <div style={{padding:'10px 18px', borderBottom:`1px solid ${G.border2}`, display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <span style={{fontSize:11, color:G.muted, fontWeight:700}}>Luna:</span>
            <button onClick={() => setFiltruLuna('toate')}
                    style={{...S.btnS, padding:'4px 10px', fontSize:11,
                            borderColor: filtruLuna === 'toate' ? G.orange : G.border,
                            color: filtruLuna === 'toate' ? G.orange : G.text}}>Toate</button>
            {luniDisponibile.map(m => (
              <button key={m} onClick={() => setFiltruLuna(m)}
                      style={{...S.btnS, padding:'4px 10px', fontSize:11,
                              borderColor: filtruLuna === m ? G.orange : G.border,
                              color: filtruLuna === m ? G.orange : G.text}}>{fmtLuna(m + '-01')}</button>
            ))}
            <span style={{marginLeft:'auto', fontSize:12, color:G.muted}}>
              Total afișat: <b style={{color:G.text}}>{fmtLei(cheltLocatie.reduce((s, c) => s + Number(c.valoare || 0), 0))} lei</b>
            </span>
          </div>

          <div style={{padding:'10px 18px', borderBottom:`1px solid ${G.border2}`, display:'flex',
                       gap:8, alignItems:'center', flexWrap:'wrap', background:G.bg+'55'}}>
            <span style={{fontSize:11, color:G.muted, fontWeight:700}}>
              De primit în {fmtLuna(lunaCurenta())}:
            </span>
            {asteptateLunaAsta.map(({ tip, ok }) => (
              <span key={tip} title={ok ? 'înregistrată' : 'încă nu a intrat'}
                    style={{fontSize:11, fontWeight:700, borderRadius:6, padding:'3px 8px',
                            border:`1px solid ${(ok ? G.green : G.dim) + '55'}`,
                            color: ok ? G.green : G.dim, background:(ok ? G.green : G.dim) + '11'}}>
                {ok ? '✓' : '○'} {TIPURI[tip].icon} {TIPURI[tip].label}
              </span>
            ))}
            {asteptateLunaAsta.every(x => x.ok) && (
              <span style={{fontSize:11, color:G.green, fontWeight:700, marginLeft:4}}>— luna e completă 🎉</span>
            )}
          </div>

          {cheltLocatie.length === 0 ? (
            <div style={{padding:'26px 18px', textAlign:'center', color:G.muted, fontSize:13}}>
              Nicio cheltuială înregistrată {filtruLuna !== 'toate' ? 'în luna asta' : 'pentru locație'}.
            </div>
          ) : cheltLocatie.map(c => {
            const zile = zileScadenta(c.data_scadenta)
            const restant = c.status === 'neplatita' && zile !== null && zile < 0
            const T = TIPURI[c.tip] || TIPURI.altele
            return (
              <div key={c.id} style={{display:'grid', gridTemplateColumns:'150px 1fr 120px 130px 90px 70px', gap:12,
                                      alignItems:'center', padding:'10px 18px', borderBottom:`1px solid ${G.border2}`}}>
                <div style={{fontSize:12, fontWeight:700, color:T.color, display:'flex', gap:6, alignItems:'center'}}>
                  <span>{T.icon}</span><span>{T.label}</span>
                </div>
                <div style={{fontSize:12, color:G.muted, minWidth:0}}>
                  <div style={{color:G.text, fontWeight:600}}>{c.furnizor || '—'}</div>
                  <div style={{fontSize:10, color:G.dim}}>
                    {fmtLuna(c.luna)}{c.numar_factura ? ` · nr. ${c.numar_factura}` : ''}
                  </div>
                </div>
                <div style={{fontSize:14, fontWeight:800, color:G.text, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                  {fmtLei(c.valoare)} <span style={{fontSize:10, color:G.muted}}>{c.moneda}</span>
                </div>
                <div style={{fontSize:11, color: restant ? G.red : G.muted}}>
                  {c.data_scadenta ? (
                    <>
                      <div>scad. {fmtData(c.data_scadenta)}</div>
                      {c.status === 'neplatita' && zile !== null && (
                        <div style={{fontSize:10, fontWeight:700, color: restant ? G.red : zile <= 5 ? G.yellow : G.dim}}>
                          {restant ? `restant ${-zile} zile` : `${zile} zile`}
                        </div>
                      )}
                    </>
                  ) : '—'}
                </div>
                <button onClick={() => marcheazaPlatita(c)}
                        title={c.status === 'platita' ? 'Marchează ca neplătită' : 'Marchează ca plătită'}
                        style={{...S.btnS, padding:'4px 8px', fontSize:10, fontWeight:800,
                                color: c.status === 'platita' ? G.green : G.yellow,
                                borderColor: (c.status === 'platita' ? G.green : G.yellow) + '55'}}>
                  {c.status === 'platita' ? '✓ PLĂTITĂ' : 'NEPLĂTITĂ'}
                </button>
                <button onClick={() => stergeChelt(c)} title="Șterge"
                        style={{...S.btnS, padding:'4px 8px', fontSize:11, color:G.red, borderColor:G.red+'44'}}>✕</button>
              </div>
            )
          })}
        </div>
      )}

      {!selectata && locatii.length > 0 && (
        <div style={{fontSize:12, color:G.dim, textAlign:'center', padding:'10px 0'}}>
          Click pe o locație pentru chirie, facturi și adăugare de cheltuieli.
        </div>
      )}

      {formLoc && (
        <FormLocatie locatie={formLoc.locatie} sites={sites} setMesaj={setMesaj}
                     onSalvat={incarca} onClose={() => setFormLoc(null)} />
      )}
      {formChelt && selectata && (
        <FormCheltuiala locatie={selectata} setMesaj={setMesaj}
                        furnizori={furnizori.filter(f => f.locatie_id === selectata.id)}
                        onSalvat={incarca} onClose={() => setFormChelt(false)} />
      )}
    </div>
  )
}
