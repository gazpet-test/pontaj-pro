// ════════════════════════════════════════════════════════════════
// HrRecrutare.jsx — Tab HR „Recrutare" (R3, 01.09.2026)
// Poziții deschise · candidați (pipeline) · istoric interacțiuni + oferte
// Date: hr_recrutare_pozitii / _candidati / _interactiuni (RLS personal_data)
// CV-uri: bucket privat recrutare-cv · aplicări publice: edge fn recrutare-aplica
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo } from 'react'
import { supabase } from './lib/supabase.js'

const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', pink:'#EC6CB9',
}
const S = {
  input: { width:'100%', padding:'8px 12px', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, color:G.text, fontSize:13, outline:'none', boxSizing:'border-box' },
  btnP:  { padding:'9px 16px', background:G.green, color:'#fff', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS:  { padding:'9px 16px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:600 },
  card:  { background:G.surface, border:`1px solid ${G.border}`, borderRadius:10, padding:16 },
  lbl:   { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.3px' },
}

const STATUS = {
  nou:            { label:'Nou',             color:G.blue,   icon:'🆕' },
  evaluat:        { label:'Evaluat',         color:G.purple, icon:'🧐' },
  contactat:      { label:'Contactat',       color:G.yellow, icon:'📞' },
  interviu:       { label:'Interviu',        color:G.orange, icon:'🗣' },
  oferta_trimisa: { label:'Ofertă trimisă',  color:G.pink,   icon:'✉️' },
  angajat:        { label:'Angajat',         color:G.green,  icon:'✅' },
  respins:        { label:'Respins',         color:G.red,    icon:'⛔' },
  retras:         { label:'Retras',          color:G.dim,    icon:'↩️' },
}
const VERDICTE = { potrivire_directa:'Potrivire directă', potential_mid:'Potențial mid', transferabil:'Transferabil', respins:'Respins' }
const TIP_INTER = { mail_trimis:'✉️ Mail trimis', mail_primit:'📨 Mail primit', telefon:'📞 Telefon', interviu:'🗣 Interviu', oferta:'💼 Ofertă', raspuns_candidat:'💬 Răspuns candidat', nota:'📝 Notă' }

const FORM_URL = 'https://dxczwkbciseqniprspcu.supabase.co/functions/v1/recrutare-aplica'
const fmtD = d => d ? new Date(d).toLocaleDateString('ro-RO') : '—'

// apel edge fn olx-api cu JWT-ul userului curent
async function olxApi(payload) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch('https://dxczwkbciseqniprspcu.supabase.co/functions/v1/olx-api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(payload),
  })
  return r.json()
}

export default function HrRecrutare({ profile, showToast }) {
  const [pozitii, setPozitii] = useState([])
  const [candidati, setCandidati] = useState([])
  const [loading, setLoading] = useState(true)
  const [fStatus, setFStatus] = useState('all')
  const [fPozitie, setFPozitie] = useState('all')
  const [cauta, setCauta] = useState('')
  const [openId, setOpenId] = useState(null)
  const [editCand, setEditCand] = useState(null)
  const [editPoz, setEditPoz] = useState(null)
  const [olx, setOlx] = useState(null)          // status conexiune OLX
  const [olxPoz, setOlxPoz] = useState(null)    // poziția pentru care publicăm pe OLX

  useEffect(() => { olxApi({ actiune: 'status' }).then(setOlx).catch(() => setOlx({ eroare: true })) }, [])

  const conecteazaOlx = async () => {
    const d = await olxApi({ actiune: 'connect-url' })
    if (d.url) window.open(d.url, '_blank')
    else showToast?.(d.eroare || 'Setează OLX_CLIENT_ID/SECRET în Supabase secrets', 'error')
  }

  const loadAll = async () => {
    const [pRes, cRes] = await Promise.all([
      supabase.from('hr_recrutare_pozitii').select('*').is('deleted_at', null).order('status').order('id', { ascending: false }),
      supabase.from('hr_recrutare_candidati').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
    ])
    setPozitii(pRes.data || [])
    setCandidati(cRes.data || [])
    setLoading(false)
  }
  useEffect(() => { loadAll() }, [])

  const pozMap = useMemo(() => Object.fromEntries(pozitii.map(p => [p.id, p])), [pozitii])
  const filtrati = useMemo(() => {
    let l = candidati
    if (fStatus !== 'all') l = l.filter(c => c.status === fStatus)
    if (fPozitie !== 'all') l = l.filter(c => String(c.pozitie_id) === String(fPozitie))
    if (cauta.trim()) {
      const s = cauta.toLowerCase()
      l = l.filter(c => (c.nume || '').toLowerCase().includes(s) || (c.email || '').toLowerCase().includes(s) || (c.telefon || '').includes(s))
    }
    return l
  }, [candidati, fStatus, fPozitie, cauta])

  const statCount = st => candidati.filter(c => c.status === st).length

  const deschideCV = async c => {
    const { data, error } = await supabase.storage.from('recrutare-cv').createSignedUrl(c.fisier_path, 300)
    if (error || !data?.signedUrl) showToast?.('Nu pot deschide CV-ul: ' + (error?.message || ''), 'error')
    else window.open(data.signedUrl, '_blank')
  }

  const schimbaStatus = async (c, status) => {
    const { error } = await supabase.from('hr_recrutare_candidati').update({ status }).eq('id', c.id)
    if (error) showToast?.('Eroare: ' + error.message, 'error')
    else { showToast?.(`✓ ${c.nume} → ${STATUS[status].label}`); loadAll() }
  }

  if (loading) return <div style={{ padding:40, textAlign:'center', color:G.muted }}>⏳ Se încarcă recrutarea...</div>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Poziții deschise */}
      <div style={S.card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
          <div style={{ fontSize:15, fontWeight:800, color:G.pink }}>🧲 Poziții</div>
          <button style={{ ...S.btnS, padding:'6px 12px', marginLeft:'auto' }}
            onClick={() => { navigator.clipboard?.writeText(FORM_URL); showToast?.('✓ Link formular public copiat — pune-l în anunțul OLX/eJobs') }}>
            🔗 Copiază link formular aplicare
          </button>
          {/* Led stare OLX: verde = conectat (butonul nu mai face nimic), roșu = deconectat, gri = se verifică */}
          <span title={olx == null ? 'Se verifică conexiunea OLX...' : olx?.conectat ? `OLX conectat${olx?.cont?.email ? ' — ' + olx.cont.email : ''}` : 'OLX deconectat — apasă „Conectează OLX"'}
            style={{ width:12, height:12, borderRadius:'50%', flexShrink:0, background: olx == null ? G.dim : olx?.conectat ? G.green : G.red, boxShadow: olx?.conectat ? `0 0 6px ${G.green}` : olx ? `0 0 6px ${G.red}` : 'none' }} />
          <button disabled={!!olx?.conectat}
            style={{ ...S.btnS, padding:'6px 12px', color: olx?.conectat ? G.green : G.red, borderColor: olx?.conectat ? G.green + '66' : G.red + '66', opacity: olx?.conectat ? .85 : 1, cursor: olx?.conectat ? 'default' : 'pointer' }}
            title={olx?.conectat ? `Cont OLX conectat${olx?.cont?.email ? ': ' + olx.cont.email : ''} — nu e nevoie să apeși` : 'Conectează contul OLX Business pentru publicare din ERP'}
            onClick={() => { if (!olx?.conectat) conecteazaOlx() }}>
            {olx?.conectat ? 'OLX conectat' : '🔌 Conectează OLX'}
          </button>
          <button style={{ ...S.btnP, padding:'6px 12px' }} onClick={() => setEditPoz({})}>+ Poziție</button>
        </div>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          {pozitii.map(p => (
            <div key={p.id} style={{
              padding:'10px 14px', borderRadius:8, minWidth:220,
              background:G.bg, border:`1px solid ${p.status === 'deschisa' ? G.green + '55' : G.border2}` }}>
              <div onClick={() => setEditPoz(p)} style={{ cursor:'pointer' }}>
                <div style={{ fontSize:13, fontWeight:700, color:G.text }}>{p.denumire}</div>
                <div style={{ fontSize:11, color:G.muted, marginTop:3 }}>
                  {p.status === 'deschisa' ? '🟢 deschisă' : p.status === 'suspendata' ? '⏸ suspendată' : '🔒 închisă'}
                  {' · '}{candidati.filter(c => c.pozitie_id === p.id).length} candidați
                  {p.salariu_min ? ` · ${Number(p.salariu_min).toLocaleString('ro-RO')} lei ${p.tip_salariu}` : ''}
                </div>
              </div>
              <div style={{ display:'flex', gap:6, marginTop:7 }}>
                {p.olx_url
                  ? <a href={p.olx_url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:G.green, fontWeight:700, textDecoration:'none' }}>🟢 pe OLX ({p.olx_status || 'activ'}) ↗</a>
                  : p.status === 'deschisa' && <button style={{ ...S.btnS, padding:'4px 9px', fontSize:11 }}
                      onClick={() => olx?.conectat ? setOlxPoz(p) : showToast?.('Conectează întâi contul OLX (butonul de sus)', 'error')}>
                      📣 Publică pe OLX
                    </button>}
              </div>
            </div>
          ))}
          {!pozitii.length && <div style={{ color:G.muted, fontSize:13 }}>Nicio poziție. Adaugă prima cu „+ Poziție".</div>}
        </div>
      </div>

      {/* Pipeline pe statusuri */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <button onClick={() => setFStatus('all')} style={{ ...S.btnS, padding:'7px 13px', background: fStatus === 'all' ? G.pink + '33' : G.surface, color: fStatus === 'all' ? G.pink : G.muted }}>
          Toți ({candidati.length})
        </button>
        {Object.entries(STATUS).map(([k, v]) => (
          <button key={k} onClick={() => setFStatus(k)} style={{
            ...S.btnS, padding:'7px 13px',
            background: fStatus === k ? v.color + '33' : G.surface,
            color: fStatus === k ? v.color : G.muted }}>
            {v.icon} {v.label} ({statCount(k)})
          </button>
        ))}
      </div>

      {/* Filtre + adăugare */}
      <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <input placeholder="🔍 Caută nume / email / telefon..." value={cauta} onChange={e => setCauta(e.target.value)}
          style={{ ...S.input, maxWidth:260 }} />
        <select value={fPozitie} onChange={e => setFPozitie(e.target.value)} style={{ ...S.input, width:'auto', minWidth:200 }}>
          <option value="all">📂 Toate pozițiile</option>
          {pozitii.map(p => <option key={p.id} value={p.id}>{p.denumire}</option>)}
        </select>
        <button style={{ ...S.btnP, marginLeft:'auto' }} onClick={() => setEditCand({})}>+ Candidat manual</button>
      </div>

      {/* Lista candidați */}
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {filtrati.map(c => {
          const st = STATUS[c.status] || STATUS.nou
          const open = openId === c.id
          return (
            <div key={c.id} style={{ ...S.card, padding:0, overflow:'hidden' }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', cursor:'pointer' }}
                onClick={() => setOpenId(open ? null : c.id)}>
                <span style={{ fontSize:18 }}>{st.icon}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:G.text }}>{c.nume}
                    {c.verdict && <span style={{ marginLeft:8, fontSize:10, color:G.purple }}>· {VERDICTE[c.verdict] || c.verdict}{c.scor ? ` · ${c.scor}/10` : ''}</span>}
                  </div>
                  <div style={{ fontSize:11, color:G.muted, marginTop:2 }}>
                    {pozMap[c.pozitie_id]?.denumire || 'fără poziție'} · {c.sursa || '—'}
                    {c.telefon ? ` · 📞 ${c.telefon}` : ''}{c.oras ? ` · ${c.oras}` : ''}
                    {c.data_aplicare ? ` · aplicat ${fmtD(c.data_aplicare)}` : ''}
                  </div>
                </div>
                <span style={{ padding:'3px 10px', borderRadius:12, background:st.color + '22', color:st.color, fontSize:11, fontWeight:700, whiteSpace:'nowrap' }}>{st.label}</span>
                <div style={{ display:'flex', gap:4 }} onClick={e => e.stopPropagation()}>
                  {c.fisier_path && <button style={{ ...S.btnS, padding:'7px 11px' }} title="Deschide CV" onClick={() => deschideCV(c)}>📄</button>}
                  <button style={{ ...S.btnS, padding:'7px 11px' }} title="Editează" onClick={() => setEditCand(c)}>✏️</button>
                </div>
              </div>
              {open && (
                <DetaliuCandidat candidat={c} profile={profile} showToast={showToast}
                  onStatus={s => schimbaStatus(c, s)} onReload={loadAll} />
              )}
            </div>
          )
        })}
        {!filtrati.length && <div style={{ ...S.card, textAlign:'center', color:G.muted, fontSize:13, padding:30 }}>Niciun candidat pe filtrele alese.</div>}
      </div>

      {editCand && (
        <CandidatModal item={editCand} pozitii={pozitii} showToast={showToast}
          onClose={() => setEditCand(null)}
          onSaved={() => { setEditCand(null); loadAll() }} />
      )}
      {editPoz && (
        <PozitieModal item={editPoz} showToast={showToast}
          onClose={() => setEditPoz(null)}
          onSaved={() => { setEditPoz(null); loadAll() }} />
      )}
      {olxPoz && (
        <OlxPublicaModal pozitie={olxPoz} showToast={showToast}
          onClose={() => setOlxPoz(null)}
          onPublicat={() => { setOlxPoz(null); loadAll() }} />
      )}
    </div>
  )
}

// ── Detaliu: istoric interacțiuni + acțiuni rapide ─────────────
function DetaliuCandidat({ candidat, profile, showToast, onStatus, onReload }) {
  const [inter, setInter] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [fi, setFi] = useState({ tip:'nota', canal:'telefon', subiect:'', continut:'', salariu_net:'', rezultat:'' })

  const loadInter = () => supabase.from('hr_recrutare_interactiuni').select('*')
    .eq('candidat_id', candidat.id).order('data', { ascending: false })
    .then(({ data }) => setInter(data || []))
  useEffect(() => { loadInter() }, [candidat.id])

  const salveazaInter = async () => {
    const conditii = fi.tip === 'oferta' && fi.salariu_net
      ? { salariu_net: Number(fi.salariu_net), moneda:'RON' } : {}
    const { error } = await supabase.from('hr_recrutare_interactiuni').insert({
      candidat_id: candidat.id, tip: fi.tip, canal: fi.canal,
      autor: profile?.id || null, autor_nume: profile?.name || null,
      subiect: fi.subiect || null, continut: fi.continut || null,
      conditii_oferite: conditii, rezultat: fi.rezultat || null,
    })
    if (error) showToast?.('Eroare: ' + error.message, 'error')
    else { setShowAdd(false); setFi({ tip:'nota', canal:'telefon', subiect:'', continut:'', salariu_net:'', rezultat:'' }); loadInter(); showToast?.('✓ Interacțiune salvată') }
  }

  return (
    <div style={{ borderTop:`1px solid ${G.border}`, padding:'12px 14px', background:G.bg }}>
      {candidat.evaluare && <div style={{ fontSize:12, color:G.muted, marginBottom:10, whiteSpace:'pre-wrap' }}>🧐 {candidat.evaluare}</div>}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
        {Object.entries(STATUS).filter(([k]) => k !== candidat.status).map(([k, v]) => (
          <button key={k} onClick={() => onStatus(k)} style={{ ...S.btnS, padding:'5px 10px', fontSize:11, color:v.color }}>{v.icon} {v.label}</button>
        ))}
        <button onClick={() => setShowAdd(!showAdd)} style={{ ...S.btnP, padding:'5px 12px', fontSize:11, marginLeft:'auto' }}>+ Interacțiune</button>
      </div>
      {showAdd && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12, padding:12, background:G.surface, borderRadius:8, border:`1px solid ${G.border2}` }}>
          <select style={S.input} value={fi.tip} onChange={e => setFi({ ...fi, tip: e.target.value })}>
            {Object.entries(TIP_INTER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select style={S.input} value={fi.canal} onChange={e => setFi({ ...fi, canal: e.target.value })}>
            {['telefon','email','whatsapp','fata_in_fata','online'].map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
          <input style={S.input} placeholder="Subiect" value={fi.subiect} onChange={e => setFi({ ...fi, subiect: e.target.value })} />
          {fi.tip === 'oferta'
            ? <input style={S.input} placeholder="Salariu net oferit (lei)" value={fi.salariu_net} onChange={e => setFi({ ...fi, salariu_net: e.target.value })} />
            : <input style={S.input} placeholder="Rezultat (opțional)" value={fi.rezultat} onChange={e => setFi({ ...fi, rezultat: e.target.value })} />}
          <textarea style={{ ...S.input, gridColumn:'1 / -1', minHeight:56, resize:'vertical' }} placeholder="Conținut / detalii"
            value={fi.continut} onChange={e => setFi({ ...fi, continut: e.target.value })} />
          <div style={{ gridColumn:'1 / -1', display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button style={S.btnS} onClick={() => setShowAdd(false)}>Renunță</button>
            <button style={S.btnP} onClick={salveazaInter}>Salvează</button>
          </div>
        </div>
      )}
      {inter === null ? <div style={{ color:G.muted, fontSize:12 }}>⏳ istoric...</div> : (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {inter.map(i => (
            <div key={i.id} style={{ fontSize:12, color:G.text, padding:'7px 10px', background:G.surface, borderRadius:7, border:`1px solid ${G.border}` }}>
              <span style={{ color:G.muted }}>{new Date(i.data).toLocaleString('ro-RO')} · </span>
              <b>{TIP_INTER[i.tip] || i.tip}</b>
              {i.autor_nume ? <span style={{ color:G.muted }}> · {i.autor_nume}</span> : ''}
              {i.subiect ? ` — ${i.subiect}` : ''}
              {i.conditii_oferite && Object.keys(i.conditii_oferite).length > 0 && (
                <div style={{ color:G.pink, marginTop:3, fontSize:11 }}>
                  💼 {i.conditii_oferite.salariu_net ? `${Number(i.conditii_oferite.salariu_net).toLocaleString('ro-RO')} lei net` : ''}
                  {i.conditii_oferite.renegociere_luni ? ` · renegociere ${i.conditii_oferite.renegociere_luni} luni` : ''}
                  {i.conditii_oferite.diurna_lei_zi ? ` · diurnă ${i.conditii_oferite.diurna_lei_zi} lei/zi` : ''}
                  {i.conditii_oferite.cazare ? ' · cazare' : ''}{i.conditii_oferite.masa_seara ? ' · masă seara' : ''}
                  {i.conditii_oferite.masina_serviciu ? ' · mașină' : ''}{i.conditii_oferite.laptop ? ' · laptop' : ''}
                </div>
              )}
              {i.continut && <div style={{ color:G.muted, marginTop:3, whiteSpace:'pre-wrap' }}>{i.continut}</div>}
              {i.rezultat && <div style={{ color:G.yellow, marginTop:3 }}>→ {i.rezultat}</div>}
            </div>
          ))}
          {!inter.length && <div style={{ color:G.dim, fontSize:12 }}>Fără interacțiuni încă.</div>}
        </div>
      )}
    </div>
  )
}

// ── Modal candidat (adăugare manuală / editare) ────────────────
function CandidatModal({ item, pozitii, showToast, onClose, onSaved }) {
  const isNew = !item.id
  const [f, setF] = useState({
    nume: item.nume || '', email: item.email || '', telefon: item.telefon || '', oras: item.oras || '',
    pozitie_id: item.pozitie_id || (pozitii[0]?.id ?? ''), sursa: item.sursa || 'ejobs',
    functie_curenta: item.functie_curenta || '', angajator_curent: item.angajator_curent || '',
    ani_experienta: item.ani_experienta ?? '', verdict: item.verdict || '', scor: item.scor ?? '',
    evaluare: item.evaluare || '', status: item.status || 'nou',
  })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))

  const salveaza = async () => {
    if (!f.nume.trim()) { showToast?.('Numele e obligatoriu', 'error'); return }
    const payload = {
      nume: f.nume.trim(), email: f.email || null, telefon: f.telefon || null, oras: f.oras || null,
      pozitie_id: f.pozitie_id ? Number(f.pozitie_id) : null, sursa: f.sursa || null,
      functie_curenta: f.functie_curenta || null, angajator_curent: f.angajator_curent || null,
      ani_experienta: f.ani_experienta === '' ? null : Number(f.ani_experienta),
      verdict: f.verdict || null, scor: f.scor === '' ? null : Number(f.scor),
      evaluare: f.evaluare || null, status: f.status,
      ...(isNew ? { data_aplicare: new Date().toISOString().slice(0, 10), consimtamant_pastrare: true,
        data_retentie_pana: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) } : {}),
    }
    const q = isNew
      ? supabase.from('hr_recrutare_candidati').insert(payload)
      : supabase.from('hr_recrutare_candidati').update(payload).eq('id', item.id)
    const { error } = await q
    if (error) showToast?.('Eroare: ' + error.message, 'error')
    else { showToast?.('✓ Candidat salvat'); onSaved() }
  }

  return (
    <Modal titlu={isNew ? '➕ Candidat nou' : `✏️ ${item.nume}`} onClose={onClose}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <Fld l="Nume *"><input style={S.input} value={f.nume} onChange={e => set('nume', e.target.value)} /></Fld>
        <Fld l="Poziția">
          <select style={S.input} value={f.pozitie_id} onChange={e => set('pozitie_id', e.target.value)}>
            {pozitii.map(p => <option key={p.id} value={p.id}>{p.denumire}</option>)}
          </select>
        </Fld>
        <Fld l="Telefon"><input style={S.input} value={f.telefon} onChange={e => set('telefon', e.target.value)} /></Fld>
        <Fld l="Email"><input style={S.input} value={f.email} onChange={e => set('email', e.target.value)} /></Fld>
        <Fld l="Oraș"><input style={S.input} value={f.oras} onChange={e => set('oras', e.target.value)} /></Fld>
        <Fld l="Sursă">
          <select style={S.input} value={f.sursa} onChange={e => set('sursa', e.target.value)}>
            {['ejobs','olx','formular_olx','recomandare','direct','alta'].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Fld>
        <Fld l="Funcția curentă"><input style={S.input} value={f.functie_curenta} onChange={e => set('functie_curenta', e.target.value)} /></Fld>
        <Fld l="Angajator curent"><input style={S.input} value={f.angajator_curent} onChange={e => set('angajator_curent', e.target.value)} /></Fld>
        <Fld l="Ani experiență"><input style={S.input} value={f.ani_experienta} onChange={e => set('ani_experienta', e.target.value)} /></Fld>
        <Fld l="Scor (1-10)"><input style={S.input} value={f.scor} onChange={e => set('scor', e.target.value)} /></Fld>
        <Fld l="Verdict">
          <select style={S.input} value={f.verdict} onChange={e => set('verdict', e.target.value)}>
            <option value="">—</option>
            {Object.entries(VERDICTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Fld>
        <Fld l="Status">
          <select style={S.input} value={f.status} onChange={e => set('status', e.target.value)}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </Fld>
      </div>
      <Fld l="Evaluare / notițe"><textarea style={{ ...S.input, minHeight:70, resize:'vertical' }} value={f.evaluare} onChange={e => set('evaluare', e.target.value)} /></Fld>
      <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:14 }}>
        <button style={S.btnS} onClick={onClose}>Renunță</button>
        <button style={S.btnP} onClick={salveaza}>Salvează</button>
      </div>
    </Modal>
  )
}

// ── Modal poziție ──────────────────────────────────────────────
function PozitieModal({ item, showToast, onClose, onSaved }) {
  const isNew = !item.id
  const [f, setF] = useState({
    denumire: item.denumire || '', departament: item.departament || '', descriere: item.descriere || '',
    salariu_min: item.salariu_min ?? '', salariu_max: item.salariu_max ?? '',
    tip_salariu: item.tip_salariu || 'net', numar_posturi: item.numar_posturi ?? 1,
    status: item.status || 'deschisa', observatii: item.observatii || '',
  })
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))
  const salveaza = async () => {
    if (!f.denumire.trim()) { showToast?.('Denumirea e obligatorie', 'error'); return }
    const payload = {
      denumire: f.denumire.trim(), departament: f.departament || null, descriere: f.descriere || null,
      salariu_min: f.salariu_min === '' ? null : Number(f.salariu_min),
      salariu_max: f.salariu_max === '' ? null : Number(f.salariu_max),
      tip_salariu: f.tip_salariu, numar_posturi: Number(f.numar_posturi) || 1,
      status: f.status, observatii: f.observatii || null,
    }
    const q = isNew
      ? supabase.from('hr_recrutare_pozitii').insert(payload)
      : supabase.from('hr_recrutare_pozitii').update(payload).eq('id', item.id)
    const { error } = await q
    if (error) showToast?.('Eroare: ' + error.message, 'error')
    else { showToast?.('✓ Poziție salvată'); onSaved() }
  }
  return (
    <Modal titlu={isNew ? '➕ Poziție nouă' : `✏️ ${item.denumire}`} onClose={onClose}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <Fld l="Denumire *"><input style={S.input} value={f.denumire} onChange={e => set('denumire', e.target.value)} /></Fld>
        <Fld l="Departament"><input style={S.input} value={f.departament} onChange={e => set('departament', e.target.value)} /></Fld>
        <Fld l="Salariu min"><input style={S.input} value={f.salariu_min} onChange={e => set('salariu_min', e.target.value)} /></Fld>
        <Fld l="Salariu max"><input style={S.input} value={f.salariu_max} onChange={e => set('salariu_max', e.target.value)} /></Fld>
        <Fld l="Tip salariu">
          <select style={S.input} value={f.tip_salariu} onChange={e => set('tip_salariu', e.target.value)}>
            <option value="net">net</option><option value="brut">brut</option>
          </select>
        </Fld>
        <Fld l="Nr. posturi"><input style={S.input} value={f.numar_posturi} onChange={e => set('numar_posturi', e.target.value)} /></Fld>
        <Fld l="Status">
          <select style={S.input} value={f.status} onChange={e => set('status', e.target.value)}>
            <option value="deschisa">deschisă</option><option value="suspendata">suspendată</option><option value="inchisa">închisă</option>
          </select>
        </Fld>
      </div>
      <Fld l="Descriere (apare în formularul public)"><textarea style={{ ...S.input, minHeight:70, resize:'vertical' }} value={f.descriere} onChange={e => set('descriere', e.target.value)} /></Fld>
      <Fld l="Observații interne"><textarea style={{ ...S.input, minHeight:46, resize:'vertical' }} value={f.observatii} onChange={e => set('observatii', e.target.value)} /></Fld>
      <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:14 }}>
        <button style={S.btnS} onClick={onClose}>Renunță</button>
        <button style={S.btnP} onClick={salveaza}>Salvează</button>
      </div>
    </Modal>
  )
}

// ── Modal publicare anunț pe OLX ───────────────────────────────
function OlxPublicaModal({ pozitie, showToast, onClose, onPublicat }) {
  const [f, setF] = useState({
    titlu: `Angajăm ${pozitie.denumire} — Gazpet Instal Ploiești`,
    descriere: `${pozitie.descriere || pozitie.denumire}\n\nGazpet Instal S.R.L. — constructor autorizat de conducte de gaze naturale (Transgaz, Romgaz, Conpet), Ploiești, Prahova. Echipă de 127+ angajați, proiecte în toată țara.\n\nAplică direct cu CV-ul în formularul nostru online. Datele tale sunt prelucrate conform GDPR (retenție 12 luni).`,
    category_id: '', city_id: '', contact_name: 'Gazpet Instal', contact_phone: '0244435005',
  })
  const [categorii, setCategorii] = useState([])
  const [orase, setOrase] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }))

  useEffect(() => {
    olxApi({ actiune: 'categorii', q: pozitie.denumire }).then(d => {
      const list = d?.data || []
      setCategorii(list)
      if (list[0]?.id) set('category_id', String(list[0].id))
    })
    olxApi({ actiune: 'orase', q: 'Ploiesti' }).then(d => {
      const list = d?.data || []
      setOrase(list)
      if (list[0]?.id) set('city_id', String(list[0].id))
    })
  }, [])

  const publica = async () => {
    if (!f.category_id || !f.city_id) { showToast?.('Alege categoria și orașul', 'error'); return }
    if (f.titlu.length < 16) { showToast?.('Titlul trebuie să aibă minim 16 caractere', 'error'); return }
    if (f.descriere.length < 80) { showToast?.('Descrierea trebuie să aibă minim 80 caractere', 'error'); return }
    setBusy(true)
    const d = await olxApi({ actiune: 'publica', pozitie_id: pozitie.id, titlu: f.titlu, descriere: f.descriere,
      category_id: f.category_id, city_id: f.city_id, contact_name: f.contact_name, contact_phone: f.contact_phone })
    setBusy(false)
    if (d.ok) { showToast?.(`✓ Anunț publicat pe OLX (status: ${d.advert?.status})`); onPublicat() }
    else showToast?.((d.eroare || 'Eroare OLX') + (d.detalii?.error?.validation ? ' — ' + d.detalii.error.validation.map(v => v.detail).join('; ') : ''), 'error')
  }

  return (
    <Modal titlu={`📣 Publică pe OLX — ${pozitie.denumire}`} onClose={onClose}>
      <div style={{ fontSize:11, color:G.muted, marginBottom:10 }}>
        Consumă un anunț din pachetul Ultra (3 × 30 zile). Regulile OLX: titlu 16-150 caractere, descriere minim 80, fără telefoane/emailuri în text.
      </div>
      <Fld l="Titlu anunț"><input style={S.input} value={f.titlu} onChange={e => set('titlu', e.target.value)} /></Fld>
      <Fld l="Descriere"><textarea style={{ ...S.input, minHeight:130, resize:'vertical' }} value={f.descriere} onChange={e => set('descriere', e.target.value)} /></Fld>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:8 }}>
        <Fld l="Categorie OLX">
          <select style={S.input} value={f.category_id} onChange={e => set('category_id', e.target.value)}>
            <option value="">— alege —</option>
            {categorii.map(c => <option key={c.id} value={c.id}>{c.names?.path || c.name || c.id}</option>)}
          </select>
        </Fld>
        <Fld l="Oraș">
          <select style={S.input} value={f.city_id} onChange={e => set('city_id', e.target.value)}>
            <option value="">— alege —</option>
            {orase.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Fld>
        <Fld l="Nume contact"><input style={S.input} value={f.contact_name} onChange={e => set('contact_name', e.target.value)} /></Fld>
        <Fld l="Telefon contact"><input style={S.input} value={f.contact_phone} onChange={e => set('contact_phone', e.target.value)} /></Fld>
      </div>
      <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:14 }}>
        <button style={S.btnS} onClick={onClose} disabled={busy}>Renunță</button>
        <button style={S.btnP} onClick={publica} disabled={busy}>{busy ? '⏳ Public...' : '📣 Publică anunțul'}</button>
      </div>
    </Modal>
  )
}

const Fld = ({ l, children }) => <div><label style={S.lbl}>{l}</label>{children}</div>
function Modal({ titlu, children, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'#000a', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 12px' }} onClick={onClose}>
      <div style={{ background:G.surface, border:`1px solid ${G.border2}`, borderRadius:12, padding:20, width:'100%', maxWidth:640 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:16, fontWeight:800, color:G.pink, marginBottom:14 }}>{titlu}</div>
        {children}
      </div>
    </div>
  )
}
