// ═══════════════════════════════════════════════════════════════════════════
// PERSONAL EXTERN PENTRU LICITAȚII
// ───────────────────────────────────────────────────────────────────────────
// Colaboratorii pe care îi invocăm în propunerile tehnice (RTE externi,
// experți atestați) nu sunt angajați, dar autorizațiile lor trebuie ținute
// în ERP ca să poată fi scoase la ofertă.
//
// De ce tabelă proprie și NU un rând în `employees`: 46 de locuri din cod
// citesc tabela aia și doar 19 filtrează pe `active` — un extern ar fi apărut
// în pontaj, achiziții, magazie, listele de asignare tichete, și l-ar fi
// alertat patrula HR pentru aviz medical lipsă.
//
// Autorizațiile stau tot în `hr_autorizatii`, pe coloana `extern_id`
// (CHECK: exact unul dintre employee_id / extern_id e completat). Așa nu se
// dublează scanurile, expirările și exporturile pentru oferte.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import { compressFileBeforeUpload } from './utils/compressFile'
import DomeniiPicker from './HrDomeniiPicker.jsx'
// 29.09.2026 R3: foști angajați Gazpet trecuți ca externi (marcaj + acord de colaborare)
import { BadgeFostAngajat, PastilaAcord } from './HrFostiAngajati.jsx'
import {
  etichetaColab, formatDataRo, poateActivaColaborarea, MESAJ_ACTIVARE_FARA_ACORD, esteFostAngajat,
  fostAngajatPotrivit, MESAJ_OMONIM_FOST_ANGAJAT, esteEroareOmonim, esteEroareReangajat,
} from './conturiCicluViata.js'

const G = {
  bg:'#0D1117', surface:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', red:'#F85149',
  hr:'#EC6CB9',
}
const S = {
  card:  { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none' },
  btnP:  { padding:'9px 16px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS:  { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}
const BUCKET = 'autorizatii'

const fmtData = (d) => d ? new Date(d).toLocaleDateString('ro-RO') : '—'
const zileRamase = (d) => d ? Math.round((new Date(d) - new Date()) / 864e5) : null

function Lbl({ children }) {
  return <div style={{fontSize:11, color:G.muted, marginBottom:4, fontWeight:600}}>{children}</div>
}

function Modal({ titlu, onClose, children, latime = 560 }) {
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, width:'100%', maxWidth:latime, padding:20}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
          <div style={{fontSize:16, fontWeight:800, color:G.text}}>{titlu}</div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:20, cursor:'pointer', lineHeight:1}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// poateLega = owner / can_modify_employees (dezlegarea de fișa unui fost angajat; BD-ul verifică rolul oricum).
// esteOwner: doar owner-ul poate activa un extern omonim cu un fost angajat (altă persoană) — BD idem.
export default function HrPersonalExtern({ tipuri = [], showToast, canEdit = true, poateLega = false, esteOwner = false }) {
  const [persoane, setPersoane] = useState([])
  const [autorizatii, setAutorizatii] = useState([])
  const [load, setLoad] = useState(true)
  const [cauta, setCauta] = useState('')
  const [deschis, setDeschis] = useState(null)      // id persoană expandată
  const [editPers, setEditPers] = useState(null)    // {} = adăugare, obiect = editare
  const [addAut, setAddAut] = useState(null)        // persoana pentru care adaug autorizație
  const [acorduri, setAcorduri] = useState(new Map()) // employee_id → fișa fostului angajat (acordul de colaborare)
  const [fosti, setFosti] = useState([])              // foștii angajați: detectarea externilor nelegați omonimi
  const nav = useNavigate()

  const incarca = useCallback(async () => {
    setLoad(true)
    const [{ data: p, error: pe }, { data: a }, { data: fa }] = await Promise.all([
      supabase.from('hr_personal_extern').select('*').order('nume'),
      supabase.from('hr_autorizatii')
        .select('id, extern_id, tip_id, numar_autorizatie, emitent, data_emitere, data_expirare, fara_expirare, domenii, fisier_path, fisier_nume, observatii')
        .not('extern_id', 'is', null).is('deleted_at', null),
      supabase.from('employees').select('id,name,email,termination_date,active').not('termination_date', 'is', null).neq('active', true),
    ])
    if (pe) showToast?.('Nu pot încărca personalul extern: ' + pe.message, 'error')
    // Acordul foștilor angajați se citește separat, după id (fără embed: între cele două tabele
    // există mai multe relații, iar un embed nou ar cere !hr_personal_extern_fost_angajat_fk).
    const idsLegate = [...new Set((p || []).map(x => x.fost_angajat_employee_id).filter(v => v != null))]
    let acc = new Map()
    if (idsLegate.length) {
      const { data: emp } = await supabase.from('employees')
        .select('id,name,active,termination_date,colaborare_externa_status,colaborare_externa_confirmat_la').in('id', idsLegate)
      acc = new Map((emp || []).map(e => [e.id, e]))
    }
    setAcorduri(acc)
    setFosti(fa || [])
    setPersoane(p || [])
    setAutorizatii(a || [])
    setLoad(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { incarca() }, [incarca])

  const autPentru = (id) => autorizatii.filter(a => a.extern_id === id)

  const filtrate = persoane.filter(p => {
    if (!cauta.trim()) return true
    const s = cauta.toLowerCase()
    return [p.nume, p.functie, p.firma].filter(Boolean).some(x => x.toLowerCase().includes(s))
  })

  // Dezlegarea de fișă (legare greșită / omonim): colaborarea devine inactivă (triggerul BD o forțează).
  const dezleaga = async (p) => {
    if (!window.confirm(`Dezlegi „${p.nume}” de fișa fostului angajat?\n\n• marcajul „Fost angajat Gazpet” dispare\n• colaborarea devine INACTIVĂ; reactivarea verifică dacă numele e al unui fost angajat\n\nFolosește doar dacă legarea a fost greșită (altă persoană).`)) return
    const { error } = await supabase.from('hr_personal_extern').update({ fost_angajat_employee_id: null, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (error) { showToast?.('Nu am putut dezlega: ' + error.message, 'error'); return }
    showToast?.(`„${p.nume}” nu mai e legat de fișa fostului angajat (colaborare inactivă)`, 'success')
    incarca()
  }

  const deschidePdf = async (path) => {
    if (!path) return
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60)
    if (error || !data?.signedUrl) { showToast?.('Nu pot deschide scanul', 'error'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <div>
      {/* Antet + căutare */}
      <div style={{display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap'}}>
        <input value={cauta} onChange={e => setCauta(e.target.value)}
          placeholder="Caută după nume, funcție sau firmă…"
          style={{...S.input, maxWidth:340}}/>
        <div style={{fontSize:12, color:G.muted}}>
          {persoane.length} {persoane.length === 1 ? 'persoană' : 'persoane'} · {autorizatii.length} autorizații
        </div>
        <div style={{flex:1}}/>
        {canEdit && (
          <button onClick={() => setEditPers({})} style={S.btnP}>➕ Persoană externă</button>
        )}
      </div>

      <div style={{fontSize:12, color:G.dim, marginBottom:14, lineHeight:1.6}}>
        Colaboratorii invocați în propunerile tehnice. Nu sunt angajați — nu apar în pontaj,
        în salarii sau în alertele de aviz medical. Aici se ține doar ce trebuie dovedit la licitație.
      </div>

      {load && <div style={{padding:40, textAlign:'center', color:G.muted}}>Se încarcă…</div>}

      {!load && filtrate.length === 0 && (
        <div style={{...S.card, padding:32, textAlign:'center', color:G.muted}}>
          {persoane.length === 0
            ? 'Încă nu e nimeni aici. Adaugă primul colaborator extern.'
            : 'Nimic nu se potrivește cu căutarea.'}
        </div>
      )}

      {!load && filtrate.map(p => {
        const auts = autPentru(p.id)
        const expandat = deschis === p.id
        const fost = p.fost_angajat_gazpet ? acorduri.get(p.fost_angajat_employee_id) : null
        // legat, dar fișa e din nou activă / fără încetare → „Reangajat”, nu „Fost angajat” (review 29.09)
        const reangajat = p.fost_angajat_gazpet && fost && !esteFostAngajat(fost)
        // nelegat, dar numele / emailul e al unui fost angajat → avertisment (BD refuză activarea nouă)
        const omonim = !p.fost_angajat_gazpet ? fostAngajatPotrivit(p, fosti) : null
        return (
          <div key={p.id} style={{...S.card, marginBottom:10, overflow:'hidden', opacity: p.activ ? 1 : .55}}>
            <div onClick={() => setDeschis(expandat ? null : p.id)}
              style={{padding:'14px 16px', display:'flex', alignItems:'center', gap:12, cursor:'pointer'}}>
              <div style={{width:38, height:38, borderRadius:10, background:G.hr+'22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, flexShrink:0}}>🤝</div>
              <div style={{flex:1, minWidth:0}}>
                <div style={{fontSize:14, fontWeight:800, color:G.text}}>
                  {p.nume}
                  {!p.activ && <span style={{marginLeft:8, fontSize:10, color:G.muted, fontWeight:600}}>(inactiv)</span>}
                  {p.fost_angajat_gazpet && !reangajat && (
                    <span style={{display:'inline-flex', gap:6, marginLeft:8, verticalAlign:'middle', flexWrap:'wrap'}}>
                      <BadgeFostAngajat />
                      <PastilaAcord status={fost?.colaborare_externa_status} />
                    </span>
                  )}
                  {reangajat && (
                    <span style={{marginLeft:8, padding:'2px 7px', background:G.blue+'22', color:G.blue, borderRadius:4, fontSize:10, fontWeight:600, verticalAlign:'middle'}}>
                      ↩ Reangajat Gazpet (fișa activă)
                    </span>
                  )}
                  {omonim && (
                    <span title={MESAJ_OMONIM_FOST_ANGAJAT} style={{marginLeft:8, padding:'2px 7px', background:G.yellow+'22', color:G.yellow, borderRadius:4, fontSize:10, fontWeight:600, verticalAlign:'middle'}}>
                      ⚠️ Omonim cu fostul angajat #{omonim.id} — nelegat
                    </span>
                  )}
                </div>
                <div style={{fontSize:12, color:G.muted}}>
                  {[p.functie, p.firma].filter(Boolean).join(' · ') || 'fără funcție/firmă'}
                </div>
              </div>
              <span style={{padding:'3px 9px', background: auts.length ? G.green+'22' : G.yellow+'22',
                color: auts.length ? G.green : G.yellow, borderRadius:10, fontSize:11, fontWeight:800}}>
                {auts.length} {auts.length === 1 ? 'autorizație' : 'autorizații'}
              </span>
              <span style={{fontSize:11, color:G.dim}}>{expandat ? '▲' : '▼'}</span>
            </div>

            {expandat && (
              <div style={{borderTop:`1px solid ${G.border}`, padding:'12px 16px', background:G.bg}}>
                {p.fost_angajat_gazpet && (
                  <div style={{fontSize:12, color:G.muted, marginBottom:10, lineHeight:1.7, padding:'8px 10px', border:`1px solid ${G.hr}44`, borderRadius:8}}>
                    <div>Fost angajat Gazpet{fost?.termination_date ? ` · contract încheiat la ${formatDataRo(fost.termination_date)}` : ''}</div>
                    <div>Acord colaborare: <strong style={{color: etichetaColab(fost?.colaborare_externa_status).culoare}}>{etichetaColab(fost?.colaborare_externa_status).label}</strong>
                      {fost?.colaborare_externa_confirmat_la && ` · confirmat la ${formatDataRo(fost.colaborare_externa_confirmat_la)}`}</div>
                    {reangajat && <div style={{color:G.blue}}>Fișa e din nou activă (reangajat): colaborarea externă nu se poate activa; acordul se reconfirmă la o nouă plecare.</div>}
                    <div style={{display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginTop:2}}>
                      <button onClick={() => nav('/hr?tab=fosti')} style={{background:'transparent', border:'none', color:G.blue, cursor:'pointer', fontSize:12, padding:0}}>
                        HR → Foști angajați ↗
                      </button>
                      {poateLega && (
                        <button onClick={() => dezleaga(p)} style={{background:'transparent', border:'none', color:G.red, cursor:'pointer', fontSize:12, padding:0}}>
                          ✂️ Dezleagă de fișă
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {omonim && (
                  <div style={{fontSize:12, color:G.yellow, marginBottom:10, lineHeight:1.6, padding:'8px 10px', border:`1px solid ${G.yellow}44`, borderRadius:8}}>
                    Numele {omonim.email && p.email && String(omonim.email).trim().toLowerCase() === String(p.email).trim().toLowerCase() ? 'și emailul ' : ''}se potrivesc cu fostul angajat {omonim.name} (#{omonim.id}, contract încheiat la {formatDataRo(omonim.termination_date)}).
                    Dacă e aceeași persoană, leag-o din HR → Foști angajați („Trece ca extern”) ca acordul ei să fie confirmat și să apară marcajul.
                  </div>
                )}
                {(p.telefon || p.email || p.cui_firma || p.observatii) && (
                  <div style={{fontSize:12, color:G.muted, marginBottom:10, lineHeight:1.7}}>
                    {p.cui_firma && <div>CUI firmă: <strong style={{color:G.text}}>{p.cui_firma}</strong></div>}
                    {p.telefon && <div>Telefon: <strong style={{color:G.text}}>{p.telefon}</strong></div>}
                    {p.email && <div>Email: <strong style={{color:G.text}}>{p.email}</strong></div>}
                    {p.observatii && <div style={{marginTop:4, fontStyle:'italic'}}>{p.observatii}</div>}
                  </div>
                )}

                {auts.length === 0 && (
                  <div style={{fontSize:12, color:G.dim, padding:'8px 0'}}>Nicio autorizație înregistrată.</div>
                )}

                {auts.map(a => {
                  const tip = tipuri.find(t => t.id === a.tip_id)
                  const zile = a.fara_expirare ? null : zileRamase(a.data_expirare)
                  const culoare = zile === null ? G.muted : zile < 0 ? G.red : zile <= 30 ? G.yellow : G.green
                  return (
                    <div key={a.id} style={{display:'flex', alignItems:'flex-start', gap:10, padding:'10px 0', borderTop:`1px solid ${G.border}`}}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:13, fontWeight:700, color:G.text}}>
                          {tip?.denumire || 'Tip necunoscut'}
                        </div>
                        <div style={{fontSize:12, color:G.muted, marginTop:2}}>
                          {a.numar_autorizatie || <span style={{color:G.yellow}}>fără număr</span>}
                          {a.emitent && ` · ${a.emitent}`}
                        </div>
                        {a.domenii?.length > 0 && (
                          <div style={{fontSize:11, color:G.dim, marginTop:3}}>🏷 {a.domenii.join(', ')}</div>
                        )}
                        <div style={{fontSize:11, color:culoare, marginTop:3, fontWeight:600}}>
                          {a.fara_expirare
                            ? 'fără expirare'
                            : `valabilă până la ${fmtData(a.data_expirare)}${zile !== null ? (zile < 0 ? ` — expirată de ${Math.abs(zile)} zile` : ` — ${zile} zile`) : ''}`}
                        </div>
                      </div>
                      {a.fisier_path
                        ? <button onClick={() => deschidePdf(a.fisier_path)} style={{...S.btnS, padding:'6px 10px', fontSize:11}}>📄 Scan</button>
                        : <span style={{fontSize:11, color:G.yellow, padding:'6px 0'}}>fără scan</span>}
                    </div>
                  )
                })}

                {canEdit && (
                  <div style={{display:'flex', gap:8, marginTop:12}}>
                    <button onClick={() => setAddAut(p)} style={{...S.btnS, borderColor:G.hr+'66', color:G.hr}}>➕ Autorizație</button>
                    <button onClick={() => setEditPers(p)} style={S.btnS}>✏️ Editează datele</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {editPers && (
        <ModalPersoana persoana={editPers} statusAcord={acorduri.get(editPers.fost_angajat_employee_id)?.colaborare_externa_status}
          fostInca={editPers.fost_angajat_employee_id == null || esteFostAngajat(acorduri.get(editPers.fost_angajat_employee_id))}
          fosti={fosti} esteOwner={esteOwner}
          onClose={() => setEditPers(null)}
          onSaved={() => { setEditPers(null); incarca() }} showToast={showToast} />
      )}
      {addAut && (
        <ModalAutorizatieExtern persoana={addAut} tipuri={tipuri} onClose={() => setAddAut(null)}
          onSaved={() => { setAddAut(null); incarca() }} showToast={showToast} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
function ModalPersoana({ persoana, statusAcord, fostInca = true, fosti = [], esteOwner = false, onClose, onSaved, showToast }) {
  // Un fost angajat legat poate avea colaborarea ACTIVĂ doar dacă e ÎNCĂ fost angajat și a acceptat (BD: 23514).
  const activareBlocata = !poateActivaColaborarea(persoana, statusAcord, fostInca)
  const nou = !persoana?.id
  const [nume, setNume] = useState(persoana.nume || '')
  const [functie, setFunctie] = useState(persoana.functie || '')
  const [firma, setFirma] = useState(persoana.firma || '')
  const [cui, setCui] = useState(persoana.cui_firma || '')
  const [telefon, setTelefon] = useState(persoana.telefon || '')
  const [email, setEmail] = useState(persoana.email || '')
  const [observatii, setObservatii] = useState(persoana.observatii || '')
  const [activ, setActiv] = useState(persoana.activ !== false)
  const [saving, setSaving] = useState(false)
  // Extern NELEGAT cu numele / emailul unui fost angajat: acordul și marcajul s-ar ocoli (review 29.09).
  // Ca în BD: se verifică doar la adăugare sau când se schimbă numele / emailul / activarea (rândurile vechi rămân editabile).
  const omonim = fostAngajatPotrivit({ nume, email, fost_angajat_employee_id: persoana.fost_angajat_employee_id }, fosti)
  const deVerificat = activ && (nou || nume.trim() !== (persoana.nume || '').trim()
    || (email.trim() || null) !== ((persoana.email || '').trim() || null) || persoana.activ === false)

  const salveaza = async () => {
    if (!nume.trim()) { showToast?.('Numele e obligatoriu', 'warn'); return }
    if (omonim && deVerificat) {
      if (!esteOwner) { showToast?.(MESAJ_OMONIM_FOST_ANGAJAT, 'warn'); return }
      if (!window.confirm(`„${nume.trim()}” se potrivește cu fostul angajat ${omonim.name} (#${omonim.id}).\n\nConfirmi că e ALTĂ persoană și activezi colaborarea fără acordul din Foști angajați?`)) return
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      nume: nume.trim(), functie: functie.trim() || null, firma: firma.trim() || null,
      cui_firma: cui.trim() || null, telefon: telefon.trim() || null,
      email: email.trim() || null, observatii: observatii.trim() || null, activ,
    }
    const q = nou
      ? supabase.from('hr_personal_extern').insert({ ...payload, created_by: user?.id || null })
      : supabase.from('hr_personal_extern').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', persoana.id)
    const { error } = await q
    setSaving(false)
    if (error) {
      showToast?.(error.code === '23505' ? 'Există deja o persoană cu numele ăsta'
        : esteEroareOmonim(error) ? MESAJ_OMONIM_FOST_ANGAJAT
        : esteEroareReangajat(error) ? 'Fișa legată e din nou activă (reangajat): colaborarea externă nu se poate activa.'
        : error.code === '23514' ? MESAJ_ACTIVARE_FARA_ACORD
        : 'Eroare: ' + error.message, 'error')
      return
    }
    showToast?.(nou ? 'Persoană adăugată' : 'Date salvate', 'success')
    onSaved()
  }

  return (
    <Modal titlu={nou ? '➕ Persoană externă' : '✏️ ' + persoana.nume} onClose={onClose}>
      <div style={{marginBottom:10}}>
        <Lbl>Nume complet *</Lbl>
        <input value={nume} onChange={e => setNume(e.target.value)} placeholder="STUPARU BOGDAN MANUEL" style={S.input}/>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
        <div><Lbl>Funcție / calitate</Lbl>
          <input value={functie} onChange={e => setFunctie(e.target.value)} placeholder="RTE montaj" style={S.input}/></div>
        <div><Lbl>Firma</Lbl>
          <input value={firma} onChange={e => setFirma(e.target.value)} style={S.input}/></div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:10}}>
        <div><Lbl>CUI firmă</Lbl>
          <input value={cui} onChange={e => setCui(e.target.value)} style={S.input}/></div>
        <div><Lbl>Telefon</Lbl>
          <input value={telefon} onChange={e => setTelefon(e.target.value)} style={S.input}/></div>
        <div><Lbl>Email</Lbl>
          <input value={email} onChange={e => setEmail(e.target.value)} style={S.input}/></div>
      </div>
      <div style={{marginBottom:10}}>
        <Lbl>Observații</Lbl>
        <textarea value={observatii} onChange={e => setObservatii(e.target.value)} rows={2}
          placeholder="ex. colaborator extern, declarație de disponibilitate la dosar"
          style={{...S.input, resize:'vertical'}}/>
      </div>
      <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, color: activareBlocata && !activ ? G.muted : G.text, marginBottom: activareBlocata ? 4 : 16, cursor: activareBlocata && !activ ? 'not-allowed' : 'pointer'}}>
        <input type="checkbox" checked={activ} disabled={activareBlocata && !activ} onChange={e => setActiv(e.target.checked)} style={{accentColor:G.hr}}/>
        Colaborare activă
      </label>
      {activareBlocata && (
        <div style={{fontSize:11, color:G.yellow, marginBottom:16}}>{fostInca ? MESAJ_ACTIVARE_FARA_ACORD : 'Fișa legată e din nou activă (reangajat): colaborarea externă nu se poate activa.'}</div>
      )}
      {omonim && deVerificat && (
        <div style={{fontSize:11, color:esteOwner ? G.yellow : G.red, marginTop:-8, marginBottom:16, lineHeight:1.5}}>
          ⚠️ Se potrivește cu fostul angajat {omonim.name} (#{omonim.id}). {MESAJ_OMONIM_FOST_ANGAJAT}
        </div>
      )}
      <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
        <button onClick={onClose} style={S.btnS}>Renunță</button>
        <button onClick={salveaza} disabled={saving} style={{...S.btnP, opacity: saving ? .6 : 1}}>
          {saving ? 'Se salvează…' : 'Salvează'}
        </button>
      </div>
    </Modal>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
function ModalAutorizatieExtern({ persoana, tipuri, onClose, onSaved, showToast }) {
  const [tipId, setTipId] = useState('')
  const [numar, setNumar] = useState('')
  const [emitent, setEmitent] = useState('')
  const [dataEmitere, setDataEmitere] = useState('')
  const [dataExpirare, setDataExpirare] = useState('')
  const [faraExpirare, setFaraExpirare] = useState(false)
  const [domenii, setDomenii] = useState([])
  const [observatii, setObservatii] = useState('')
  const [fisier, setFisier] = useState(null)
  const [saving, setSaving] = useState(false)

  const tipSelectat = tipuri.find(t => t.id === Number(tipId))

  useEffect(() => {
    if (tipSelectat?.emitent_default && !emitent) setEmitent(tipSelectat.emitent_default)
  }, [tipSelectat]) // eslint-disable-line react-hooks/exhaustive-deps

  const salveaza = async () => {
    if (!tipId) { showToast?.('Alege tipul autorizației', 'warn'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()

    const { data: creat, error } = await supabase.from('hr_autorizatii').insert({
      extern_id: persoana.id,
      employee_id: null,           // CHECK: exact unul dintre cele două
      tip_id: Number(tipId),
      uploadat_de: user?.id || null,
      numar_autorizatie: numar.trim() || null,
      emitent: emitent.trim() || null,
      data_emitere: dataEmitere || null,
      data_expirare: faraExpirare ? null : (dataExpirare || null),
      fara_expirare: faraExpirare,
      domenii: domenii.length > 0 ? domenii : null,
      observatii: observatii.trim() || null,
    }).select('id').single()

    if (error) { setSaving(false); showToast?.('Eroare: ' + error.message, 'error'); return }

    if (fisier && creat?.id) {
      try {
        const comprimat = await compressFileBeforeUpload(fisier)
        const ext = comprimat.name.split('.').pop()
        // prefix distinct, ca să nu se amestece cu folderele angajaților (care sunt id-uri numerice)
        const path = `extern-${persoana.id}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, comprimat, { upsert: false })
        if (upErr) throw upErr
        await supabase.from('hr_autorizatii').update({
          fisier_path: path, fisier_nume: fisier.name,
          fisier_size_bytes: fisier.size, fisier_mime: fisier.type,
        }).eq('id', creat.id)
      } catch (e) {
        showToast?.('Autorizația s-a salvat, dar scanul nu s-a încărcat: ' + (e.message || e), 'warn')
        setSaving(false); onSaved(); return
      }
    }

    setSaving(false)
    showToast?.('Autorizație adăugată', 'success')
    onSaved()
  }

  return (
    <Modal titlu={`➕ Autorizație — ${persoana.nume}`} onClose={onClose} latime={620}>
      <div style={{marginBottom:10}}>
        <Lbl>Tipul autorizației *</Lbl>
        <select value={tipId} onChange={e => setTipId(e.target.value)} style={S.input}>
          <option value="">— alege —</option>
          {tipuri.filter(t => t.activ !== false).map(t => (
            <option key={t.id} value={t.id}>{t.denumire}</option>
          ))}
        </select>
      </div>

      {tipSelectat?.necesita_domenii && (
        <DomeniiPicker domenii={domenii} setDomenii={setDomenii} />
      )}

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
        <div><Lbl>Număr autorizație</Lbl>
          <input value={numar} onChange={e => setNumar(e.target.value)} placeholder="seria B nr. 0819" style={S.input}/></div>
        <div><Lbl>Emitent</Lbl>
          <input value={emitent} onChange={e => setEmitent(e.target.value)} style={S.input}/></div>
      </div>

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10}}>
        <div><Lbl>Data emiterii</Lbl>
          <input type="date" value={dataEmitere} onChange={e => setDataEmitere(e.target.value)} style={S.input}/></div>
        <div><Lbl>Valabilă până la</Lbl>
          <input type="date" value={dataExpirare} onChange={e => setDataExpirare(e.target.value)}
            disabled={faraExpirare} style={{...S.input, opacity: faraExpirare ? .5 : 1}}/></div>
      </div>

      <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, color:G.text, marginBottom:10, cursor:'pointer'}}>
        <input type="checkbox" checked={faraExpirare} onChange={e => setFaraExpirare(e.target.checked)} style={{accentColor:G.hr}}/>
        Fără dată de expirare
      </label>

      <div style={{marginBottom:10}}>
        <Lbl>Observații</Lbl>
        <textarea value={observatii} onChange={e => setObservatii(e.target.value)} rows={2} style={{...S.input, resize:'vertical'}}/>
      </div>

      <div style={{marginBottom:16}}>
        <Lbl>Scan (PDF sau poză)</Lbl>
        <input type="file" accept="application/pdf,image/*" onChange={e => setFisier(e.target.files?.[0] || null)}
          style={{...S.input, padding:'7px 10px'}}/>
        {fisier && <div style={{fontSize:11, color:G.green, marginTop:4}}>📎 {fisier.name}</div>}
      </div>

      <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
        <button onClick={onClose} style={S.btnS}>Renunță</button>
        <button onClick={salveaza} disabled={saving} style={{...S.btnP, opacity: saving ? .6 : 1}}>
          {saving ? 'Se salvează…' : 'Salvează'}
        </button>
      </div>
    </Modal>
  )
}
