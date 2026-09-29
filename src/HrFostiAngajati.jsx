// ═══════════════════════════════════════════════════════════════════════════
// FOȘTI ANGAJAȚI — acord de colaborare externă (R3, 29.09.2026)
// ───────────────────────────────────────────────────────────────────────────
// Cei cu contract încheiat pot fi trecuți ca posibili colaboratori externi, dar
// trebuie să știm SIGUR dacă acceptă: stare tri-valentă necunoscut / acceptă /
// refuză, implicit „necunoscut”, NICIODATĂ dedusă automat. O setează doar un om
// (owner sau HR cu can_modify_employees), cu dovadă (notă sau document); cine și
// când vin din sesiune (triggerul din BD), nu din client.
//
// Scrierile trec EXCLUSIV prin RPC-urile cu poartă de rol:
//   fn_colaborare_externa_seteaza · fn_fost_angajat_leaga_extern
// Marcajul „Fost angajat Gazpet” apare și în Personal extern (hr_personal_extern.fost_angajat_gazpet).
// O colaborare poate fi ACTIVĂ doar cu acordul „accepta” (triggerul BD refuză altfel).
// Spec: docs/CONTURI_CICLU_VIATA.md (C, D.1).
// ═══════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import {
  COLAB_STARI, esteFostAngajat, valideazaColab, etichetaColab, formatDataRo, mesajStareCont,
  externExistentDinEroare, ziRomania, NOTA_MIN,
} from './conturiCicluViata.js'

const G = {
  bg:'#0D1117', surface:'#161B22', text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', blue:'#1F6FEB', green:'#2EA043', yellow:'#D29922', red:'#F85149',
  hr:'#EC6CB9',
}
const S = {
  card:  { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input: { width:'100%', background:G.bg, border:`1px solid ${G.border}`, borderRadius:8, padding:'9px 12px', color:G.text, fontSize:13, outline:'none', boxSizing:'border-box' },
  btnP:  { padding:'9px 16px', background:G.hr, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS:  { padding:'8px 14px', background:G.surface, color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13 },
}

const SELECT_FOSTI = 'id,name,functie,position,department,hire_date,termination_date,active,colaborare_externa_status,colaborare_externa_confirmat_de,colaborare_externa_confirmat_la,colaborare_externa_nota,colaborare_externa_document'

// Pastila „Fost angajat Gazpet” — aceeași în HR (Arhivă, fișă), aici și în Personal extern.
export function BadgeFostAngajat({ style }) {
  return (
    <span style={{padding:'2px 7px', background:G.hr+'22', color:G.hr, borderRadius:4, fontSize:10, fontWeight:600, whiteSpace:'nowrap', ...style}}>
      🗂️ Fost angajat Gazpet
    </span>
  )
}

// Pastila stării acordului (galben / verde / roșu).
export function PastilaAcord({ status, style }) {
  const e = etichetaColab(status)
  return (
    <span style={{padding:'2px 7px', background:e.fundal, color:e.culoare, borderRadius:4, fontSize:10, fontWeight:700, whiteSpace:'nowrap', ...style}}>
      {e.icon} Colaborare externă: {e.label}
    </span>
  )
}

export default function HrFostiAngajati({ profile, showToast }) {
  const nav = useNavigate()
  // Doar owner și HR cu can_modify_employees setează acordul (aceeași regulă ca în BD) — nu `isAdmin`.
  const poateColab = profile?.is_owner === true || profile?.can_modify_employees === true
  const poateIstoric = poateColab || profile?.can_access_personal_data === true

  const [fosti, setFosti] = useState([])
  const [externi, setExterni] = useState([])
  const [stareConturi, setStareConturi] = useState(new Map())
  const [nume, setNume] = useState(new Map())
  const [load, setLoad] = useState(true)
  const [cauta, setCauta] = useState('')
  const [filtru, setFiltru] = useState('toate')
  const [formular, setFormular] = useState(null)    // { emp, status }
  const [istoric, setIstoric] = useState(null)      // { emp, rows, load }
  const [busyId, setBusyId] = useState(null)

  const incarca = useCallback(async () => {
    setLoad(true)
    const [emp, ext, stare, prof] = await Promise.all([
      supabase.from('employees').select(SELECT_FOSTI).not('termination_date', 'is', null).neq('active', true).order('termination_date', { ascending: false }),
      supabase.from('hr_personal_extern').select('id,fost_angajat_employee_id,activ').not('fost_angajat_employee_id', 'is', null),
      supabase.rpc('fn_cont_stare_angajati'),
      supabase.from('profiles').select('id,name'),
    ])
    if (emp.error) showToast?.('Nu pot încărca foștii angajați: ' + emp.error.message, 'error')
    const azi = ziRomania()
    setFosti((emp.data || []).filter(e => esteFostAngajat(e, azi)))
    setExterni(ext.data || [])
    // 0 rânduri sau eroare → indicatorul de cont nu se afișează (fără drept sau fără conturi legate)
    setStareConturi(new Map((stare.error ? [] : stare.data || []).map(r => [r.employee_id, r])))
    setNume(new Map((prof.data || []).map(p => [p.id, p.name])))
    setLoad(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { incarca() }, [incarca])

  const externPentru = useMemo(() => new Map(externi.map(x => [x.fost_angajat_employee_id, x])), [externi])

  const filtrate = fosti.filter(e => {
    if (filtru !== 'toate' && (e.colaborare_externa_status || 'necunoscut') !== filtru) return false
    if (!cauta.trim()) return true
    return (e.name || '').toLowerCase().includes(cauta.trim().toLowerCase())
  })
  const numar = s => fosti.filter(e => (e.colaborare_externa_status || 'necunoscut') === s).length

  const deschideIstoric = async (emp) => {
    setIstoric({ emp, rows: [], load: true })
    const { data, error } = await supabase.from('hr_colaborare_externa_jurnal')
      .select('id,status_vechi,status_nou,nota,document,facut_de,facut_la').eq('employee_id', emp.id).order('facut_la', { ascending: false })
    if (error) { showToast?.('Nu pot citi istoricul: ' + error.message, 'error'); setIstoric(null); return }
    setIstoric({ emp, rows: data || [], load: false })
  }

  const treceCaExtern = async (emp, externId = null) => {
    setBusyId(emp.id)
    const { data, error } = await supabase.rpc('fn_fost_angajat_leaga_extern', { p_employee_id: emp.id, p_extern_id: externId })
    setBusyId(null)
    if (error) {
      const existent = externExistentDinEroare(error)
      if (existent && !externId) {
        if (window.confirm(`${error.hint}\n\nLeg externul existent #${existent} de fișa lui ${emp.name}?`)) return treceCaExtern(emp, existent)
        return
      }
      showToast?.('Nu am putut trece ca extern: ' + error.message, 'error')
      return
    }
    showToast?.(`${emp.name} apare acum în Personal extern (#${data}) cu marcajul „Fost angajat Gazpet”`, 'success')
    incarca()
  }

  return (
    <div>
      <div style={{display:'flex', gap:10, alignItems:'center', marginBottom:12, flexWrap:'wrap'}}>
        <input value={cauta} onChange={e => setCauta(e.target.value)} placeholder="Caută după nume…" style={{...S.input, maxWidth:300}}/>
        {['toate', ...COLAB_STARI].map(s => {
          const activ = filtru === s
          const e = s === 'toate' ? { label: 'Toate', culoare: G.hr } : etichetaColab(s)
          return (
            <button key={s} onClick={() => setFiltru(s)} style={{...S.btnS, padding:'6px 12px', fontSize:12,
              background: activ ? e.culoare + '22' : G.surface, color: activ ? e.culoare : G.muted, borderColor: activ ? e.culoare + '88' : G.border}}>
              {e.label} ({s === 'toate' ? fosti.length : numar(s)})
            </button>
          )
        })}
      </div>

      <div style={{fontSize:12, color:G.dim, marginBottom:14, lineHeight:1.6}}>
        Angajați cu contract încheiat. Un fost angajat poate deveni colaborator extern doar dacă știm sigur că acceptă:
        acordul îl setează un om din HR, cu dovadă, și nu se deduce niciodată automat. Colaborarea din Personal extern
        poate fi activă doar cu acordul „Acceptă”.
        {!poateColab && <span style={{color:G.yellow}}> Poți vedea situația; acordul îl setează owner-ul sau HR (drept de modificare angajați).</span>}
      </div>

      {load && <div style={{padding:40, textAlign:'center', color:G.muted}}>Se încarcă…</div>}
      {!load && filtrate.length === 0 && (
        <div style={{...S.card, padding:32, textAlign:'center', color:G.muted}}>
          {fosti.length === 0 ? 'Niciun angajat cu contract încheiat.' : 'Nimic nu se potrivește cu filtrul.'}
        </div>
      )}

      {!load && filtrate.map(emp => {
        const status = emp.colaborare_externa_status || 'necunoscut'
        const cont = mesajStareCont(stareConturi.get(emp.id))
        const rowCont = stareConturi.get(emp.id)
        const ext = externPentru.get(emp.id)
        return (
          <div key={emp.id} style={{...S.card, marginBottom:10, padding:'14px 16px'}}>
            <div style={{display:'flex', gap:12, alignItems:'flex-start', flexWrap:'wrap'}}>
              <div style={{flex:'1 1 260px', minWidth:0}}>
                <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                  <span style={{fontSize:14, fontWeight:800, color:G.text}}>{emp.name}</span>
                  <BadgeFostAngajat />
                  <span style={{fontSize:11, color:G.red, fontWeight:600}}>🔒 Contract încheiat {formatDataRo(emp.termination_date)}</span>
                </div>
                <div style={{fontSize:12, color:G.muted, marginTop:3}}>
                  {[emp.functie || emp.position, emp.department, emp.hire_date ? `angajat din ${formatDataRo(emp.hire_date)}` : null].filter(Boolean).join(' · ') || '—'}
                </div>
                {cont && (
                  <div style={{fontSize:12, marginTop:6, color: cont.ton === 'activ' ? G.yellow : G.muted, fontWeight:600}}>
                    {cont.text}
                    {cont.ton === 'activ' && profile?.is_owner === true && rowCont?.profile_id && (
                      <button onClick={() => nav(`/admin?tab=managers&cont=${rowCont.profile_id}`)}
                        style={{marginLeft:8, background:'transparent', border:'none', color:G.blue, cursor:'pointer', fontSize:12, padding:0}}>
                        vezi contul ↗
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div style={{flex:'1 1 320px', minWidth:0}}>
                <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                  {COLAB_STARI.map(s => {
                    const e = etichetaColab(s)
                    const selectat = status === s
                    return (
                      <button key={s} disabled={!poateColab || selectat}
                        onClick={() => setFormular({ emp, status: s })}
                        title={!poateColab ? 'Doar owner sau HR cu drept de modificare angajați' : undefined}
                        style={{padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:700,
                          cursor: !poateColab || selectat ? 'default' : 'pointer',
                          background: selectat ? e.fundal : G.bg, color: selectat ? e.culoare : G.muted,
                          border:`1px solid ${selectat ? e.culoare + '99' : G.border}`, opacity: !poateColab && !selectat ? .55 : 1}}>
                        {e.icon} {e.label}
                      </button>
                    )
                  })}
                </div>
                {status !== 'necunoscut' && (
                  <div style={{fontSize:11, color:G.muted, marginTop:6, lineHeight:1.5}}>
                    Confirmat de <strong style={{color:G.text}}>{nume.get(emp.colaborare_externa_confirmat_de) || 'utilizator necunoscut'}</strong> la {formatDataRo(emp.colaborare_externa_confirmat_la, { cuOra: true })}
                  </div>
                )}
                {emp.colaborare_externa_nota && (
                  <div style={{fontSize:12, color:G.text, marginTop:4, fontStyle:'italic'}}>„{emp.colaborare_externa_nota}”</div>
                )}
                {emp.colaborare_externa_document && (
                  <div style={{fontSize:11, color:G.muted, marginTop:2}}>📄 Document: {emp.colaborare_externa_document}</div>
                )}
                <div style={{display:'flex', gap:8, marginTop:8, flexWrap:'wrap', alignItems:'center'}}>
                  {ext ? (
                    <span style={{fontSize:11, fontWeight:700, color: ext.activ ? G.green : G.muted}}>
                      🤝 Extern #{ext.id} · colaborare {ext.activ ? 'activă' : 'inactivă'}
                    </span>
                  ) : poateColab && (
                    <button onClick={() => treceCaExtern(emp)} disabled={busyId === emp.id}
                      style={{...S.btnS, padding:'5px 10px', fontSize:11, borderColor:G.hr+'66', color:G.hr, opacity: busyId === emp.id ? .6 : 1}}>
                      {busyId === emp.id ? 'Se trece…' : '🤝 Trece ca extern'}
                    </button>
                  )}
                  {poateIstoric && (
                    <button onClick={() => deschideIstoric(emp)} style={{...S.btnS, padding:'5px 10px', fontSize:11}}>🕘 Istoric</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {formular && (
        <ModalAcord emp={formular.emp} status={formular.status} onClose={() => setFormular(null)}
          onSaved={() => { setFormular(null); incarca() }} showToast={showToast} />
      )}
      {istoric && <ModalIstoric istoric={istoric} nume={nume} onClose={() => setIstoric(null)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
function Modal({ titlu, onClose, children, latime = 520 }) {
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,.6)', zIndex:1300, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'40px 16px', overflowY:'auto'}}>
      <div onClick={e => e.stopPropagation()} style={{...S.card, width:'100%', maxWidth:latime, padding:20}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:10}}>
          <div style={{fontSize:16, fontWeight:800, color:G.text}}>{titlu}</div>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:G.muted, fontSize:20, cursor:'pointer', lineHeight:1}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalAcord({ emp, status, onClose, onSaved, showToast }) {
  const e = etichetaColab(status)
  const [nota, setNota] = useState('')
  const [docRef, setDocRef] = useState('')
  const [saving, setSaving] = useState(false)
  const v = valideazaColab(status, nota, docRef)

  const salveaza = async () => {
    if (!v.ok) { showToast?.(v.eroare, 'warn'); return }
    setSaving(true)
    const { error } = await supabase.rpc('fn_colaborare_externa_seteaza', {
      p_employee_id: emp.id, p_status: status, p_nota: nota.trim() || null, p_document: docRef.trim() || null,
    })
    setSaving(false)
    if (error) { showToast?.('Nu am putut salva acordul: ' + error.message, 'error'); return }
    showToast?.(`Acord colaborare externă: ${e.label} — ${emp.name}`, 'success')
    onSaved()
  }

  return (
    <Modal titlu={`${e.icon} ${e.label} · ${emp.name}`} onClose={onClose}>
      {status === 'necunoscut' ? (
        <div style={{fontSize:12, color:G.muted, marginBottom:12, lineHeight:1.6}}>
          Revii la „Necunoscut”: cine/când și documentul se șterg de pe fișă (rămân în istoric), iar dacă era trecut
          ca extern, colaborarea devine inactivă. Poți lăsa un motiv.
        </div>
      ) : (
        <div style={{fontSize:12, color:G.muted, marginBottom:12, lineHeight:1.6}}>
          Dovada e obligatorie: o notă (minim {NOTA_MIN} caractere) sau referința documentului semnat.
          Cine și când se completează automat din contul tău.
        </div>
      )}
      <div style={{fontSize:11, color:G.muted, marginBottom:4, fontWeight:600}}>Notă {status === 'necunoscut' ? '(opțional)' : '*'}</div>
      <textarea value={nota} onChange={ev => setNota(ev.target.value)} rows={3}
        placeholder={status === 'accepta' ? 'ex. A semnat acordul de colaborare pe 29.09, la sediu' : status === 'refuza' ? 'ex. A refuzat telefonic pe 29.09, confirmat pe email' : 'ex. acordul verbal nu a fost confirmat'}
        style={{...S.input, resize:'vertical', marginBottom:10}}/>
      {status !== 'necunoscut' && (
        <>
          <div style={{fontSize:11, color:G.muted, marginBottom:4, fontWeight:600}}>Document (opțional) — cale / referință</div>
          <input value={docRef} onChange={ev => setDocRef(ev.target.value)} placeholder="ex. Documente personale → Acord colaborare 29.09.pdf" style={{...S.input, marginBottom:10}}/>
        </>
      )}
      <div style={{fontSize:11, color:G.yellow, marginBottom:14, lineHeight:1.5}}>
        ⚠️ Nota e vizibilă tuturor utilizatorilor logați: fără date sensibile. Documentul semnat se pune în Documente personale.
      </div>
      {!v.ok && (nota || docRef) && <div style={{fontSize:11, color:G.red, marginBottom:10}}>{v.eroare}</div>}
      <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
        <button onClick={onClose} style={S.btnS}>Renunță</button>
        <button onClick={salveaza} disabled={saving || !v.ok} style={{...S.btnP, background:e.culoare, opacity: saving || !v.ok ? .5 : 1}}>
          {saving ? 'Se salvează…' : `Salvează: ${e.label}`}
        </button>
      </div>
    </Modal>
  )
}

function ModalIstoric({ istoric, nume, onClose }) {
  return (
    <Modal titlu={`🕘 Istoric acord · ${istoric.emp.name}`} onClose={onClose} latime={600}>
      {istoric.load && <div style={{color:G.muted, padding:20, textAlign:'center'}}>Se încarcă…</div>}
      {!istoric.load && istoric.rows.length === 0 && <div style={{color:G.muted, fontSize:13}}>Nicio modificare înregistrată. Acordul a rămas „Necunoscut”.</div>}
      {!istoric.load && istoric.rows.map(r => (
        <div key={r.id} style={{borderTop:`1px solid ${G.border}`, padding:'10px 0', fontSize:12, color:G.text}}>
          <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
            <PastilaAcord status={r.status_vechi} /> <span style={{color:G.muted}}>→</span> <PastilaAcord status={r.status_nou} />
          </div>
          <div style={{color:G.muted, marginTop:4}}>{nume.get(r.facut_de) || 'utilizator necunoscut'} · {formatDataRo(r.facut_la, { cuOra: true })}</div>
          {r.nota && <div style={{marginTop:3, fontStyle:'italic'}}>„{r.nota}”</div>}
          {r.document && <div style={{marginTop:2, color:G.muted}}>📄 {r.document}</div>}
        </div>
      ))}
    </Modal>
  )
}
