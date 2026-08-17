// ═══════════════════════════════════════════════════════════════════════════
// CONSUMABILE PENTRU SERVICII SEDIU/BIROU
// ═══════════════════════════════════════════════════════════════════════════
// Cerere săptămânală cumulată, pe puncte de livrare (sedii + șantiere).
// Se comandă o dată pe săptămână, cumulat — de aici toată structura:
//   necesar_runde  = o rundă pe săptămână (deschisă → blocată → comandată)
//   necesar_linii  = ce cere fiecare, în runda curentă
//   v_necesar_cumulat = ce se comandă efectiv, grupat pe locație + articol
//
// Acces: DESCHIS oricui e autentificat (ruta /consumabile, ca la Tichete).
// Modulul Administrativ are doar 6 utilizatori din 21 — dacă stătea doar acolo,
// două treimi din oameni nu l-ar fi văzut niciodată.
//
// Aprobarea e construită, dar oprită din necesar_setari.aprobare_activa.
// Se pornește dintr-un rând în tabel, fără migrare.
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
  page: { padding:'24px 28px', minHeight:'calc(100vh - 60px)', background:G.bg, color:G.text, fontFamily:'-apple-system,BlinkMacSystemFont,Inter,sans-serif' },
  card: { background:G.surface, borderRadius:12, border:`1px solid ${G.border}` },
  input:{ background:G.bg, border:`1px solid ${G.border}`, color:G.text, borderRadius:8, padding:'8px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { padding:'9px 16px', background:G.orange, color:'#fff', border:'none', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'7px 13px', background:'transparent', color:G.text, border:`1px solid ${G.border}`, borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600 },
}

const CATEGORII = {
  papetarie: { label:'Papetărie',   icon:'📎', color:G.blue   },
  protocol:  { label:'Protocol',    icon:'☕', color:G.orange },
  curatenie: { label:'Curățenie',   icon:'🧴', color:G.green  },
  it:        { label:'Consumabile IT', icon:'🖨', color:G.purple },
  diverse:   { label:'Diverse',     icon:'📦', color:G.muted  },
}
const CAT_ORD = ['papetarie','protocol','curatenie','it','diverse']

const UM_OPTIUNI = ['buc','top','set','cutie','pachet','bax','rola','kg','l','pereche','m']

const fmtData = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO',{day:'2-digit',month:'short',year:'numeric'}) : '—'
const fmtLuna = (d) => d ? new Date(String(d).slice(0,10)+'T00:00:00').toLocaleDateString('ro-RO',{month:'long',year:'numeric'}) : '—'
const fmtCant = (n) => Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(2)

// Ora României, nu ora serverului — altfel deadline-ul de joi 16:00 se mută.
const acumRO = () => new Date(new Date().toLocaleString('en-US', { timeZone:'Europe/Bucharest' }))

function oreRamase(deadline) {
  if (!deadline) return null
  const diff = new Date(deadline).getTime() - Date.now()
  if (diff <= 0) return 'expirat'
  const ore = Math.floor(diff / 3600000)
  if (ore < 24) return `${ore} ${ore === 1 ? 'oră' : 'ore'}`
  const zile = Math.floor(ore / 24)
  return `${zile} ${zile === 1 ? 'zi' : 'zile'}`
}

// ─── Bannere de feedback, fără dependență de showToast global ───────────────
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
      <div style={{fontSize:26, fontWeight:800, color:G.text, lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:10, color:G.dim, marginTop:6}}>{sub}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VEDEREA 1 — CEREREA MEA (o vede toată lumea)
// ═══════════════════════════════════════════════════════════════════════════

function VedereCerere({ runda, articole, locatii, liniileMele, profile, onSchimbare, setMesaj }) {
  const [siteId, setSiteId]   = useState(null)
  const [cauta, setCauta]     = useState('')
  const [catDeschisa, setCatDeschisa] = useState('protocol')
  const [cant, setCant]       = useState({})     // { articol_id: cantitate }
  const [salvez, setSalvez]   = useState(null)
  const [liber, setLiber]     = useState({ denumire:'', cantitate:'', um:'buc', categorie:'diverse' })

  // Locația implicită: prima pe care o am disponibilă. Dacă lucrez la sediu,
  // aia e; dacă sunt responsabil pe un șantier, ăla e.
  useEffect(() => {
    if (siteId == null && locatii.length) setSiteId(locatii[0].id)
  }, [locatii, siteId])

  const rundaDeschisa = runda?.status === 'deschisa'

  const articoleFiltrate = useMemo(() => {
    const q = cauta.trim().toLowerCase()
    if (!q) return articole
    return articole.filter(a => a.denumire.toLowerCase().includes(q))
  }, [articole, cauta])

  const peCategorii = useMemo(() => {
    const m = {}
    for (const a of articoleFiltrate) (m[a.categorie] ||= []).push(a)
    return m
  }, [articoleFiltrate])

  const adauga = async (articol) => {
    const c = Number(cant[articol.id])
    if (!c || c <= 0) { setMesaj({ tip:'warn', text:'Pune o cantitate mai mare ca zero.' }); return }
    if (!siteId)      { setMesaj({ tip:'warn', text:'Alege întâi unde se livrează.' }); return }
    setSalvez(articol.id)
    try {
      const { error } = await supabase.from('necesar_linii').insert({
        runda_id: runda.id, site_id: siteId, articol_id: articol.id,
        cantitate: c, um: articol.um, cerut_de: profile.id,
      })
      if (error) throw error
      setCant(p => ({ ...p, [articol.id]: '' }))
      setMesaj({ tip:'success', text:`✓ ${articol.denumire} — ${fmtCant(c)} ${articol.um}` })
      onSchimbare()
    } catch (e) {
      setMesaj({ tip:'error', text:'Nu s-a putut adăuga: ' + (e.message || e) })
    } finally { setSalvez(null) }
  }

  const adaugaLiber = async () => {
    const d = liber.denumire.trim()
    const c = Number(liber.cantitate)
    if (d.length < 2) { setMesaj({ tip:'warn', text:'Scrie ce ai nevoie.' }); return }
    if (!c || c <= 0) { setMesaj({ tip:'warn', text:'Pune o cantitate.' }); return }
    if (!siteId)      { setMesaj({ tip:'warn', text:'Alege întâi unde se livrează.' }); return }
    setSalvez('liber')
    try {
      const { error } = await supabase.from('necesar_linii').insert({
        runda_id: runda.id, site_id: siteId, denumire_libera: d,
        categorie: liber.categorie, cantitate: c, um: liber.um, cerut_de: profile.id,
      })
      if (error) throw error
      setLiber({ denumire:'', cantitate:'', um:'buc', categorie:'diverse' })
      setMesaj({ tip:'success', text:`✓ ${d} — adăugat` })
      onSchimbare()
    } catch (e) {
      setMesaj({ tip:'error', text:'Nu s-a putut adăuga: ' + (e.message || e) })
    } finally { setSalvez(null) }
  }

  const sterge = async (linie) => {
    try {
      const { error } = await supabase.from('necesar_linii').delete().eq('id', linie.id)
      if (error) throw error
      setMesaj({ tip:'success', text:'Șters.' })
      onSchimbare()
    } catch (e) {
      setMesaj({ tip:'error', text:'Nu s-a putut șterge: ' + (e.message || e) })
    }
  }

  if (!runda) {
    return (
      <div style={{...S.card, padding:44, textAlign:'center'}}>
        <div style={{fontSize:40, marginBottom:12}}>📭</div>
        <div style={{fontSize:16, fontWeight:700, marginBottom:6}}>Nu e nicio rundă deschisă</div>
        <div style={{fontSize:13, color:G.muted}}>Runda se deschide luni. Dacă e urgent, spune-i Cristianei.</div>
      </div>
    )
  }

  return (
    <div>
      {/* Bara de context: unde livrăm + cât mai e */}
      <div style={{...S.card, padding:'14px 18px', marginBottom:16, display:'flex', gap:18, alignItems:'center', flexWrap:'wrap'}}>
        <div style={{flex:'1 1 240px', minWidth:200}}>
          <div style={{fontSize:11, color:G.muted, fontWeight:700, marginBottom:5, textTransform:'uppercase', letterSpacing:.4}}>Unde se livrează</div>
          <select value={siteId ?? ''} onChange={e => setSiteId(Number(e.target.value))} style={{...S.input, cursor:'pointer'}}>
            {locatii.map(l => (
              <option key={l.id} value={l.id}>
                {l.tip_locatie === 'sediu' ? '🏢 ' : l.tip_locatie === 'parc_auto' ? '🚛 ' : '🏗 '}{l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={{fontSize:11, color:G.muted, fontWeight:700, marginBottom:5, textTransform:'uppercase', letterSpacing:.4}}>Săptămâna</div>
          <div style={{fontSize:14, fontWeight:700}}>{fmtData(runda.saptamana)}</div>
        </div>
        <div>
          <div style={{fontSize:11, color:G.muted, fontWeight:700, marginBottom:5, textTransform:'uppercase', letterSpacing:.4}}>Se închide în</div>
          <div style={{fontSize:14, fontWeight:800, color: oreRamase(runda.deadline_la) === 'expirat' ? G.red : G.green}}>
            {oreRamase(runda.deadline_la) || '—'}
          </div>
        </div>
      </div>

      {!rundaDeschisa && (
        <div style={{...S.card, padding:'12px 16px', marginBottom:16, borderColor:G.yellow+'55', background:G.yellow+'11', fontSize:13, color:G.yellow}}>
          Runda e închisă — nu mai poți adăuga. Ce ai cerut rămâne mai jos.
        </div>
      )}

      <div style={{display:'grid', gridTemplateColumns:'minmax(0,1.6fr) minmax(0,1fr)', gap:16, alignItems:'start'}}>

        {/* ─── Catalogul ─────────────────────────────────────────────── */}
        <div>
          <input value={cauta} onChange={e => setCauta(e.target.value)} placeholder="🔎 Caută articol — cafea, hârtie, detergent…"
                 style={{...S.input, marginBottom:12}} />

          {CAT_ORD.filter(c => (peCategorii[c] || []).length).map(cat => {
            const cfg = CATEGORII[cat]
            const deschis = cauta.trim() ? true : catDeschisa === cat
            const lista = peCategorii[cat] || []
            return (
              <div key={cat} style={{...S.card, marginBottom:10, overflow:'hidden'}}>
                <button onClick={() => setCatDeschisa(deschis && !cauta.trim() ? null : cat)}
                  style={{width:'100%', padding:'12px 16px', background:'transparent', border:'none', cursor:'pointer',
                          display:'flex', alignItems:'center', gap:10, color:G.text, fontFamily:'inherit'}}>
                  <span style={{fontSize:17}}>{cfg.icon}</span>
                  <span style={{fontWeight:700, fontSize:14, color:cfg.color}}>{cfg.label}</span>
                  <span style={{fontSize:11, color:G.dim}}>{lista.length}</span>
                  <span style={{marginLeft:'auto', color:G.dim, fontSize:12}}>{deschis ? '▲' : '▼'}</span>
                </button>

                {deschis && (
                  <div style={{borderTop:`1px solid ${G.border2}`}}>
                    {lista.map(a => (
                      <div key={a.id} style={{display:'grid', gridTemplateColumns:'1fr 92px 92px', gap:10, alignItems:'center',
                                              padding:'9px 16px', borderBottom:`1px solid ${G.border2}`}}>
                        <div style={{fontSize:13, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{a.denumire}</div>
                        <input type="number" min="0" step="0.5" inputMode="decimal"
                               value={cant[a.id] ?? ''} onChange={e => setCant(p => ({ ...p, [a.id]: e.target.value }))}
                               placeholder={a.um} disabled={!rundaDeschisa}
                               style={{...S.input, padding:'6px 9px', fontSize:13, textAlign:'right'}} />
                        <button onClick={() => adauga(a)} disabled={!rundaDeschisa || salvez === a.id}
                          style={{...S.btnS, padding:'6px 10px', fontSize:12, color:G.orange, borderColor:G.orange+'55',
                                  opacity: rundaDeschisa ? 1 : .4, cursor: rundaDeschisa ? 'pointer' : 'not-allowed'}}>
                          {salvez === a.id ? '…' : '+ Adaug'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Text liber — supapa. Fără ea, oamenii renunță când nu găsesc. */}
          <div style={{...S.card, padding:16, borderColor:G.purple+'44'}}>
            <div style={{fontSize:13, fontWeight:700, color:G.purple, marginBottom:4}}>Nu găsești ce-ți trebuie?</div>
            <div style={{fontSize:11, color:G.muted, marginBottom:12}}>
              Scrie aici. Dacă se cere des, Cristiana îl trece în catalog.
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 80px 90px 110px', gap:8}}>
              <input value={liber.denumire} onChange={e => setLiber(p => ({...p, denumire:e.target.value}))}
                     placeholder="Ce ai nevoie" disabled={!rundaDeschisa} style={{...S.input, fontSize:13}} />
              <input type="number" min="0" step="0.5" inputMode="decimal" value={liber.cantitate}
                     onChange={e => setLiber(p => ({...p, cantitate:e.target.value}))} placeholder="Cât"
                     disabled={!rundaDeschisa} style={{...S.input, fontSize:13, textAlign:'right'}} />
              <select value={liber.um} onChange={e => setLiber(p => ({...p, um:e.target.value}))}
                      disabled={!rundaDeschisa} style={{...S.input, fontSize:13, cursor:'pointer'}}>
                {UM_OPTIUNI.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <select value={liber.categorie} onChange={e => setLiber(p => ({...p, categorie:e.target.value}))}
                      disabled={!rundaDeschisa} style={{...S.input, fontSize:13, cursor:'pointer'}}>
                {CAT_ORD.map(c => <option key={c} value={c}>{CATEGORII[c].label}</option>)}
              </select>
            </div>
            <button onClick={adaugaLiber} disabled={!rundaDeschisa || salvez === 'liber'}
              style={{...S.btnP, marginTop:10, background:G.purple, opacity: rundaDeschisa ? 1 : .4}}>
              {salvez === 'liber' ? 'Se adaugă…' : '+ Adaugă în cerere'}
            </button>
          </div>
        </div>

        {/* ─── Ce am cerut eu ────────────────────────────────────────── */}
        <div style={{...S.card, padding:16, position:'sticky', top:16}}>
          <div style={{fontSize:14, fontWeight:800, marginBottom:3}}>Ce ai cerut tu</div>
          <div style={{fontSize:11, color:G.muted, marginBottom:14}}>
            săptămâna asta · {liniileMele.length} {liniileMele.length === 1 ? 'poziție' : 'poziții'}
          </div>

          {liniileMele.length === 0 ? (
            <div style={{padding:'26px 0', textAlign:'center', color:G.dim, fontSize:12.5, lineHeight:1.6}}>
              Încă n-ai cerut nimic.<br/>Dacă nu ai nevoie de nimic, e în regulă — ignoră.
            </div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:7}}>
              {liniileMele.map(l => {
                const cat = CATEGORII[l.articol?.categorie || l.categorie || 'diverse'] || CATEGORII.diverse
                return (
                  <div key={l.id} style={{display:'flex', alignItems:'center', gap:9, padding:'8px 10px',
                                          background:G.bg, borderRadius:8, border:`1px solid ${G.border2}`}}>
                    <span style={{fontSize:14}}>{cat.icon}</span>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontSize:12.5, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                        {l.articol?.denumire || l.denumire_libera}
                        {!l.articol_id && <span style={{marginLeft:6, fontSize:9, fontWeight:800, color:G.purple}}>LIBER</span>}
                      </div>
                      <div style={{fontSize:10.5, color:G.muted, marginTop:1}}>
                        {fmtCant(l.cantitate)} {l.um} · {l.site?.name || '—'}
                      </div>
                    </div>
                    {rundaDeschisa && (
                      <button onClick={() => sterge(l)} title="Șterge"
                        style={{...S.btnS, padding:'3px 8px', fontSize:11, color:G.red, borderColor:G.red+'44'}}>✕</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VEDEREA 2 — CUMULAT & COMANDĂ (doar cine gestionează)
// ═══════════════════════════════════════════════════════════════════════════

function VedereCumulat({ runda, cumulat, onSchimbare, profile, setMesaj, aprobareActiva }) {
  const [lucrez, setLucrez] = useState(false)

  const peLocatii = useMemo(() => {
    const m = {}
    for (const r of cumulat) {
      (m[r.locatie] ||= { tip:r.tip_locatie, site_id:r.site_id, categorii:{} })
      ;(m[r.locatie].categorii[r.categorie] ||= []).push(r)
    }
    return m
  }, [cumulat])

  const totalPozitii = cumulat.length
  const totalUrgente = cumulat.filter(r => r.are_urgent).length
  const totalLibere  = cumulat.filter(r => r.din_text_liber).length

  const taieGrup = async (rand) => {
    if (!confirm(`Scoți „${rand.articol}" de la ${rand.locatie}? (${rand.nr_cereri} ${rand.nr_cereri===1?'cerere':'cereri'})`)) return
    setLucrez(true)
    try {
      const { error } = await supabase.from('necesar_linii')
        .update({ status_linie:'taiata', motiv_taiere:'Scos la centralizare', updated_at:new Date().toISOString() })
        .in('id', rand.linii_ids)
      if (error) throw error
      setMesaj({ tip:'success', text:`Scos: ${rand.articol}` })
      onSchimbare()
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
    finally { setLucrez(false) }
  }

  const schimbaStatus = async (nou) => {
    const etichete = { blocata:'blochezi runda (nu se mai poate adăuga)', comandata:'marchezi runda ca trimisă la achiziții', primita:'marchezi marfa ca primită' }
    if (!confirm(`Sigur ${etichete[nou]}?`)) return
    setLucrez(true)
    try {
      const patch = { status:nou }
      if (nou === 'blocata')   { patch.blocata_la = new Date().toISOString();   patch.blocata_de = profile.id }
      if (nou === 'comandata') { patch.comandata_la = new Date().toISOString(); patch.comandata_de = profile.id }
      const { error } = await supabase.from('necesar_runde').update(patch).eq('id', runda.id)
      if (error) throw error
      // Liniile urmează runda, ca să nu rămână „ceruta" pe o rundă comandată.
      if (nou === 'comandata' || nou === 'primita') {
        await supabase.from('necesar_linii')
          .update({ status_linie: nou === 'primita' ? 'primita' : 'comandata' })
          .eq('runda_id', runda.id).neq('status_linie','taiata')
      }
      if (nou === 'primita') {
        // Notificare „marfa a sosit" către cei care au cerut — dedup pe server (necesar_notif_log).
        try {
          const { data: notif } = await supabase.functions.invoke('necesar-notificari', {
            body: { actiune: 'sosire', runda_id: runda.id },
          })
          setMesaj({ tip:'success', text:`Marfa marcată ca primită · notificări trimise: ${notif?.trimise ?? 0}` })
        } catch {
          setMesaj({ tip:'warn', text:'Marfa marcată ca primită, dar notificarea pe email nu a plecat.' })
        }
      } else {
        setMesaj({ tip:'success', text:'Runda a trecut în: ' + nou })
      }
      onSchimbare()
    } catch (e) { setMesaj({ tip:'error', text:'Eroare: ' + (e.message || e) }) }
    finally { setLucrez(false) }
  }

  const textPentruCopiere = () => {
    const linii = [`CONSUMABILE SEDIU/BIROU — săptămâna ${fmtData(runda.saptamana)}`, '']
    for (const [loc, date] of Object.entries(peLocatii)) {
      linii.push(`── ${loc} ──`)
      for (const cat of CAT_ORD) {
        const items = date.categorii[cat]
        if (!items?.length) continue
        linii.push(`  ${CATEGORII[cat].label}:`)
        for (const r of items) linii.push(`    • ${r.articol} — ${fmtCant(r.cantitate_totala)} ${r.um}${r.are_urgent ? '  [URGENT]' : ''}`)
      }
      linii.push('')
    }
    return linii.join('\n')
  }

  if (!runda) return <div style={{...S.card, padding:40, textAlign:'center', color:G.muted}}>Nicio rundă selectată.</div>

  return (
    <div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:12, marginBottom:16}}>
        <KPI icon="📦" label="Poziții de comandat" value={totalPozitii} color={G.orange} />
        <KPI icon="🏢" label="Puncte de livrare" value={Object.keys(peLocatii).length} color={G.blue} />
        <KPI icon="🚨" label="Marcate urgent" value={totalUrgente} color={totalUrgente ? G.red : G.muted} />
        <KPI icon="✍️" label="Din text liber" value={totalLibere} color={G.purple} sub={totalLibere ? 'candidate pentru catalog' : null} />
      </div>

      <div style={{...S.card, padding:'12px 16px', marginBottom:16, display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
        <div style={{flex:1, minWidth:190}}>
          <div style={{fontSize:13, fontWeight:700}}>Săptămâna {fmtData(runda.saptamana)}</div>
          <div style={{fontSize:11, color:G.muted, marginTop:2}}>
            stare: <strong style={{color:G.orange}}>{runda.status}</strong>
            {aprobareActiva ? ' · aprobare ACTIVĂ' : ' · aprobare oprită'}
          </div>
        </div>
        <button onClick={() => { navigator.clipboard?.writeText(textPentruCopiere()); setMesaj({ tip:'success', text:'Copiat — poți da paste pe WhatsApp sau în mail.' }) }}
          style={{...S.btnS, color:G.blue, borderColor:G.blue+'55'}}>📋 Copiază lista</button>
        {runda.status === 'deschisa'  && <button disabled={lucrez} onClick={() => schimbaStatus('blocata')}   style={{...S.btnS, color:G.yellow, borderColor:G.yellow+'55'}}>🔒 Blochează runda</button>}
        {runda.status === 'blocata'   && <button disabled={lucrez} onClick={() => schimbaStatus('comandata')} style={{...S.btnP}}>📤 Am trimis comanda</button>}
        {runda.status === 'comandata' && <button disabled={lucrez} onClick={() => schimbaStatus('primita')}   style={{...S.btnP, background:G.green}}>✓ Marfa a sosit</button>}
      </div>

      {totalPozitii === 0 ? (
        <div style={{...S.card, padding:40, textAlign:'center', color:G.muted, fontSize:13}}>
          Nimeni n-a cerut nimic încă în runda asta.
        </div>
      ) : Object.entries(peLocatii).map(([loc, date]) => (
        <div key={loc} style={{...S.card, marginBottom:14, overflow:'hidden'}}>
          <div style={{padding:'12px 18px', background:G.bg, borderBottom:`1px solid ${G.border}`, display:'flex', alignItems:'center', gap:9}}>
            <span style={{fontSize:16}}>{date.tip === 'sediu' ? '🏢' : date.tip === 'parc_auto' ? '🚛' : '🏗'}</span>
            <span style={{fontWeight:800, fontSize:14}}>{loc}</span>
            <span style={{fontSize:11, color:G.dim}}>
              {Object.values(date.categorii).flat().length} poziții
            </span>
          </div>
          {CAT_ORD.filter(c => date.categorii[c]?.length).map(cat => (
            <div key={cat}>
              <div style={{padding:'7px 18px', fontSize:11, fontWeight:800, color:CATEGORII[cat].color,
                           background:G.bg+'88', textTransform:'uppercase', letterSpacing:.5}}>
                {CATEGORII[cat].icon} {CATEGORII[cat].label}
              </div>
              {date.categorii[cat].map(r => (
                <div key={`${r.articol}-${r.um}`} style={{display:'grid', gridTemplateColumns:'1fr 120px 1.1fr 44px', gap:12,
                          alignItems:'center', padding:'10px 18px', borderBottom:`1px solid ${G.border2}`}}>
                  <div style={{fontSize:13, fontWeight:600, minWidth:0}}>
                    {r.articol}
                    {r.din_text_liber && <span style={{marginLeft:7, fontSize:9, fontWeight:800, color:G.purple}}>LIBER</span>}
                    {r.are_urgent && <span style={{marginLeft:7, fontSize:9, fontWeight:800, color:G.red}}>URGENT</span>}
                  </div>
                  <div style={{fontSize:15, fontWeight:800, color:G.orange, textAlign:'right', fontVariantNumeric:'tabular-nums'}}>
                    {fmtCant(r.cantitate_totala)} <span style={{fontSize:11, color:G.muted, fontWeight:600}}>{r.um}</span>
                  </div>
                  <div style={{fontSize:11, color:G.muted, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}
                       title={(r.cerut_de || []).join(', ')}>
                    {(r.cerut_de || []).join(', ')}
                  </div>
                  <button onClick={() => taieGrup(r)} disabled={lucrez || runda.status === 'comandata' || runda.status === 'primita'}
                    title="Scoate din comandă"
                    style={{...S.btnS, padding:'4px 8px', fontSize:11, color:G.red, borderColor:G.red+'44',
                            opacity:(runda.status === 'comandata' || runda.status === 'primita') ? .3 : 1}}>✕</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// VEDEREA 3 — ARHIVĂ + SUMAR LUNAR PE PRODUS
// ═══════════════════════════════════════════════════════════════════════════

function VedereArhiva({ runde, sumar, locatii }) {
  const [lunaSel, setLunaSel] = useState('toate')
  const [locSel, setLocSel]   = useState('toate')

  const luni = useMemo(() => [...new Set(sumar.map(s => s.luna))].sort().reverse(), [sumar])

  const sumarFiltrat = useMemo(() => {
    let r = sumar
    if (lunaSel !== 'toate') r = r.filter(s => s.luna === lunaSel)
    if (locSel !== 'toate')  r = r.filter(s => String(s.site_id) === locSel)
    // Cumulez peste locații când e filtru „toate", altfel ies duplicate pe articol
    const m = {}
    for (const s of r) {
      const k = `${s.categorie}|${s.articol}|${s.um}`
      if (!m[k]) m[k] = { ...s, cantitate:0, valoare_estimata:0, locatii:new Set() }
      m[k].cantitate += Number(s.cantitate || 0)
      m[k].valoare_estimata += Number(s.valoare_estimata || 0)
      m[k].locatii.add(s.locatie)
    }
    return Object.values(m).sort((a,b) => b.cantitate - a.cantitate)
  }, [sumar, lunaSel, locSel])

  const runzeInchise = runde.filter(r => r.status !== 'deschisa')

  return (
    <div>
      <div style={{display:'grid', gridTemplateColumns:'200px 240px', gap:10, marginBottom:16}}>
        <select value={lunaSel} onChange={e => setLunaSel(e.target.value)} style={{...S.input, cursor:'pointer'}}>
          <option value="toate">Toate lunile</option>
          {luni.map(l => <option key={l} value={l}>{fmtLuna(l)}</option>)}
        </select>
        <select value={locSel} onChange={e => setLocSel(e.target.value)} style={{...S.input, cursor:'pointer'}}>
          <option value="toate">Toate locațiile</option>
          {locatii.map(l => <option key={l.id} value={String(l.id)}>{l.name}</option>)}
        </select>
      </div>

      <div style={{...S.card, marginBottom:18, overflow:'hidden'}}>
        <div style={{padding:'12px 18px', borderBottom:`1px solid ${G.border}`, fontWeight:800, fontSize:14}}>
          Sumar pe produs {lunaSel !== 'toate' && `· ${fmtLuna(lunaSel)}`}
        </div>
        {sumarFiltrat.length === 0 ? (
          <div style={{padding:34, textAlign:'center', color:G.muted, fontSize:13}}>Nimic de arătat încă — apare după prima rundă.</div>
        ) : (
          <>
            <div style={{display:'grid', gridTemplateColumns:'1fr 110px 100px 1fr', gap:12, padding:'9px 18px',
                         background:G.bg, fontSize:10.5, fontWeight:800, color:G.muted, textTransform:'uppercase', letterSpacing:.5}}>
              <div>Articol</div><div style={{textAlign:'right'}}>Cantitate</div><div style={{textAlign:'right'}}>Val. est.</div><div>Locații</div>
            </div>
            {sumarFiltrat.map(s => (
              <div key={`${s.categorie}-${s.articol}-${s.um}`} style={{display:'grid', gridTemplateColumns:'1fr 110px 100px 1fr', gap:12,
                        alignItems:'center', padding:'9px 18px', borderBottom:`1px solid ${G.border2}`, fontSize:13}}>
                <div style={{minWidth:0}}>
                  <span style={{marginRight:7}}>{(CATEGORII[s.categorie] || CATEGORII.diverse).icon}</span>{s.articol}
                </div>
                <div style={{textAlign:'right', fontWeight:800, color:G.orange, fontVariantNumeric:'tabular-nums'}}>
                  {fmtCant(s.cantitate)} <span style={{fontSize:11, color:G.muted, fontWeight:600}}>{s.um}</span>
                </div>
                <div style={{textAlign:'right', fontSize:12, color: s.valoare_estimata ? G.text : G.dim, fontVariantNumeric:'tabular-nums'}}>
                  {s.valoare_estimata ? Number(s.valoare_estimata).toFixed(0) + ' lei' : '—'}
                </div>
                <div style={{fontSize:11, color:G.muted, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {[...s.locatii].join(', ')}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={{...S.card, overflow:'hidden'}}>
        <div style={{padding:'12px 18px', borderBottom:`1px solid ${G.border}`, fontWeight:800, fontSize:14}}>
          Runde închise <span style={{fontSize:11, color:G.dim, fontWeight:600}}>({runzeInchise.length})</span>
        </div>
        {runzeInchise.length === 0 ? (
          <div style={{padding:30, textAlign:'center', color:G.muted, fontSize:13}}>Încă niciuna.</div>
        ) : runzeInchise.map(r => (
          <div key={r.id} style={{display:'flex', alignItems:'center', gap:14, padding:'11px 18px', borderBottom:`1px solid ${G.border2}`, fontSize:13}}>
            <div style={{fontWeight:700, minWidth:130}}>{fmtData(r.saptamana)}</div>
            <div style={{padding:'2px 9px', borderRadius:10, fontSize:10.5, fontWeight:800,
                         background:(r.status === 'primita' ? G.green : G.orange)+'22',
                         color: r.status === 'primita' ? G.green : G.orange}}>{r.status}</div>
            <div style={{fontSize:11, color:G.muted, marginLeft:'auto'}}>
              {r.comandata_la ? 'comandată ' + fmtData(r.comandata_la) : r.blocata_la ? 'blocată ' + fmtData(r.blocata_la) : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTA PRINCIPALĂ
// ═══════════════════════════════════════════════════════════════════════════

export default function Consumabile({ profile, embedded = false }) {
  const [tab, setTab]           = useState('cerere')
  const [load, setLoad]         = useState(true)
  const [mesaj, setMesaj]       = useState(null)
  const [runde, setRunde]       = useState([])
  const [rundaId, setRundaId]   = useState(null)
  const [articole, setArticole] = useState([])
  const [sites, setSites]       = useState([])
  const [respons, setRespons]   = useState([])
  const [liniileMele, setLMele] = useState([])
  const [cumulat, setCumulat]   = useState([])
  const [sumar, setSumar]       = useState([])
  const [setari, setSetari]     = useState({})

  // Gestionează = owner sau cine are acces la administrativ/achiziții.
  const canManage = useMemo(() => {
    if (profile?.is_owner) return true
    const ma = profile?.module_access || []
    return ma.some(m => m === 'administrativ' || m.startsWith('administrativ.') || m === 'achizitii')
  }, [profile])

  const aprobareActiva = setari.aprobare_activa === 'true'

  const incarca = useCallback(async () => {
    setLoad(true)
    const [rRunde, rArt, rSites, rResp, rSetari] = await Promise.all([
      supabase.from('necesar_runde').select('*').order('saptamana', { ascending:false }).limit(60),
      supabase.from('necesar_articole').select('*').eq('activ', true).order('categorie').order('ordine').order('denumire'),
      supabase.from('sites').select('id,name,tip_locatie,active').eq('active', true).order('tip_locatie').order('name'),
      supabase.from('necesar_responsabili').select('*').eq('activ', true),
      supabase.from('necesar_setari').select('cheie,valoare'),
    ])
    const listaRunde = rRunde.data || []
    setRunde(listaRunde)
    setArticole(rArt.data || [])
    setSites(rSites.data || [])
    setRespons(rResp.data || [])
    setSetari(Object.fromEntries((rSetari.data || []).map(s => [s.cheie, s.valoare])))

    const deschisa = listaRunde.find(r => r.status === 'deschisa') || listaRunde[0]
    setRundaId(prev => prev ?? deschisa?.id ?? null)
    setLoad(false)
  }, [])

  useEffect(() => { incarca() }, [incarca])

  const runda = useMemo(() => runde.find(r => r.id === rundaId) || null, [runde, rundaId])

  // Liniile mele + cumulatul depind de runda selectată — refetch la schimbare.
  const incarcaRunda = useCallback(async () => {
    if (!rundaId || !profile?.id) { setLMele([]); setCumulat([]); return }
    const [rMele, rCum] = await Promise.all([
      supabase.from('necesar_linii')
        .select('*, articol:necesar_articole(denumire,categorie), site:sites(name)')
        .eq('runda_id', rundaId).eq('cerut_de', profile.id)
        .neq('status_linie','taiata').order('cerut_la', { ascending:false }),
      supabase.from('v_necesar_cumulat').select('*').eq('runda_id', rundaId),
    ])
    setLMele(rMele.data || [])
    setCumulat(rCum.data || [])
  }, [rundaId, profile?.id])

  useEffect(() => { incarcaRunda() }, [incarcaRunda])

  // Sumarul lunar se încarcă doar când intri pe arhivă — e cel mai greu query.
  useEffect(() => {
    if (tab !== 'arhiva' || sumar.length) return
    supabase.from('v_necesar_sumar_lunar').select('*').order('luna', { ascending:false })
      .then(({ data }) => setSumar(data || []))
  }, [tab, sumar.length])

  // Unde am voie să cer: sediile sunt deschise tuturor; pe șantier cer doar
  // dacă sunt trecut ca responsabil (managerul de proiect sau magazionerul).
  const locatiiPermise = useMemo(() => {
    const idsResp = new Set(respons.filter(r => r.profile_id === profile?.id).map(r => r.site_id))
    return sites.filter(s => {
      if (s.tip_locatie === 'sediu' || s.tip_locatie === 'parc_auto' || s.tip_locatie === 'depozit') return true
      return canManage || idsResp.has(s.id)
    })
  }, [sites, respons, profile?.id, canManage])

  const dupaSchimbare = useCallback(() => { incarcaRunda() }, [incarcaRunda])

  const tabs = [
    { key:'cerere', icon:'🛒', label:'Cererea mea' },
    ...(canManage ? [{ key:'cumulat', icon:'📊', label:'Cumulat & comandă' }] : []),
    { key:'arhiva', icon:'🗄', label:'Arhivă & sumar' },
  ]

  const continut = (
    <>
      <Mesaj mesaj={mesaj} onClose={() => setMesaj(null)} />

      <div style={{display:'flex', gap:6, marginBottom:18, padding:6, background:G.surface, borderRadius:12, border:`1px solid ${G.border}`, flexWrap:'wrap', alignItems:'center'}}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding:'10px 16px', borderRadius:8, border:'none', cursor:'pointer', fontFamily:'inherit',
            background: tab === t.key ? G.orange+'33' : 'transparent',
            color: tab === t.key ? G.orange : G.muted, fontWeight:700, fontSize:13,
            display:'flex', alignItems:'center', gap:8,
          }}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
        {tab !== 'cerere' && runde.length > 1 && (
          <select value={rundaId ?? ''} onChange={e => setRundaId(Number(e.target.value))}
                  style={{...S.input, width:'auto', marginLeft:'auto', cursor:'pointer', fontSize:12.5, padding:'7px 10px'}}>
            {runde.map(r => (
              <option key={r.id} value={r.id}>
                {fmtData(r.saptamana)} · {r.status}
              </option>
            ))}
          </select>
        )}
      </div>

      {load ? (
        <div style={{...S.card, padding:60, textAlign:'center', color:G.muted, fontSize:14}}>Se încarcă…</div>
      ) : (
        <>
          {tab === 'cerere'  && <VedereCerere runda={runde.find(r => r.status === 'deschisa') || null}
                                              articole={articole} locatii={locatiiPermise} liniileMele={liniileMele}
                                              profile={profile} onSchimbare={dupaSchimbare} setMesaj={setMesaj} />}
          {tab === 'cumulat' && canManage && <VedereCumulat runda={runda} cumulat={cumulat} onSchimbare={dupaSchimbare}
                                              profile={profile} setMesaj={setMesaj} aprobareActiva={aprobareActiva} />}
          {tab === 'arhiva'  && <VedereArhiva runde={runde} sumar={sumar} locatii={sites} />}
        </>
      )}
    </>
  )

  if (embedded) return <div>{continut}</div>

  return (
    <div style={S.page}>
      <div style={{marginBottom:18}}>
        <div style={{fontSize:22, fontWeight:800, display:'flex', alignItems:'center', gap:10}}>
          <span style={{fontSize:28}}>🛒</span>
          <span style={{background:`linear-gradient(135deg, ${G.orange} 0%, ${G.purple} 100%)`, WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent'}}>
            Consumabile pentru servicii sediu/birou
          </span>
        </div>
        <div style={{fontSize:12, color:G.muted, marginTop:4}}>
          Papetărie · Protocol · Curățenie · Consumabile IT — se comandă cumulat, o dată pe săptămână
        </div>
      </div>
      {continut}
    </div>
  )
}
