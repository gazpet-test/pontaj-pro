import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'
import { dispozitiveImplicite, poateSelectaLumina, textStareLumina, textUrmatoare, formatMomentLumini, programPentruSalvare, avertismentAcoperire, confirmareSetariLumini } from './luminiUi.js'

const G={card:'#1C2128',surface:'#161B22',border:'#30363D',text:'#E6EDF3',muted:'#8B949E',red:'#F85149',green:'#3FB950'}
const S={card:{background:G.card,border:`1px solid ${G.border}`,borderRadius:10,padding:16,color:G.text},btn:{background:G.surface,color:G.text,border:`1px solid ${G.border}`,borderRadius:6,padding:'7px 10px',cursor:'pointer'},row:{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',margin:'10px 0'},input:{background:G.surface,color:G.text,border:`1px solid ${G.border}`,borderRadius:5,padding:6}}
const nou=()=>({nume:'',tip:'solar',dispozitive:[],parametri:{offset_pornire:0,offset_oprire:0,pornire:'18:00',oprire:'23:30',sfarsit:'23:30',zile:[0,1,2,3,4,5,6],explicit:false}})

export default function CladireLumini() {
  const [lumini,setLumini]=useState([]),[programe,setPrograme]=useState([]),[jurnal,setJurnal]=useState([]),[setari,setSetari]=useState(null)
  const [owner,setOwner]=useState(false),[scrie,setScrie]=useState(false),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState(null),[acum,setAcum]=useState(Date.now())
  const load=async()=>{
    const r=await Promise.all([
      supabase.from('iot_lumini').select('dispozitiv_id,rol,activ,iot_dispozitive!inner(nume,ultima_citire,citit_la)').order('dispozitiv_id'),
      supabase.from('iot_program_lumini').select('*').order('id'),
      supabase.from('iot_lumini_jurnal').select('*').order('id',{ascending:false}).limit(20),
      supabase.from('iot_lumini_setari').select('lat,lon,tz,vacanta_de,vacanta_pana,simulare_pana_la,pauza_ore,runtime').eq('id',true).single(),
      supabase.rpc('iot_lumini_drept',{p_owner:true}),supabase.rpc('iot_lumini_drept',{p_owner:false}),
    ])
    const error=r.find(x=>x.error)?.error
    setOwner(!r[4].error && r[4].data===true);setScrie(!r[5].error && r[5].data===true)
    if(error) {setErr(error.message);return}
    setLumini(r[0].data || []);setPrograme(r[1].data || []);setJurnal(r[2].data || []);setSetari(r[3].data);setAcum(Date.now())
  }
  useEffect(()=>{load().catch(e=>setErr(e.message));const timer=setInterval(()=>load().catch(e=>setErr(e.message)),60000);return()=>clearInterval(timer)},[])
  const run=async(fn)=>{if(busy)return;setBusy(true);setErr('');try{await fn();await load()}catch(e){setErr(e.message)}finally{setBusy(false)}}
  const save=async(actiune,date)=>{
    const {data,error}=await supabase.rpc('iot_lumini_salveaza',{p_actiune:actiune,p_date:date})
    if(error || !data?.ok)throw new Error(error?.message || 'Salvare refuzata')
  }
  const command=(l,test=false)=>{
    const stare=l.iot_dispozitive.ultima_citire?.pornit
    if(!window.confirm(test ? `Trimit aceeasi stare catre ${l.iot_dispozitive.nume} pentru testarea dreptului de comanda?` : `${stare===true?'Opreste':'Porneste'} ${l.iot_dispozitive.nume}? Pauza automatizare: ${setari?.pauza_ore ?? 3} ore. La expirare programul reia controlul si poate stinge lumina in afara ferestrei, inclusiv dupa un POST esuat.`))return
    run(async()=>{
      const {data,error}=await supabase.functions.invoke('tuya',{body:{actiune:test?'test_comanda_noop':'comanda',dispozitiv_id:l.dispozitiv_id,stare:stare!==true}})
      if(error){const payload=await error.context?.json?.().catch(()=>null);throw new Error(payload?.error || error.message)}
      if(!data?.ok)throw new Error(data?.error || 'Comanda refuzata')
    })
  }
  const patch=(key,value)=>setForm(f=>({...f,[key]:value}))
  const param=(key,value)=>setForm(f=>({...f,parametri:{...f.parametri,[key]:value}}))
  return <section style={S.card}>
    <div style={S.row}><b>Lumini sediu</b><button style={S.btn} disabled={busy} onClick={()=>run(load)}>Actualizeaza</button><small style={{color:G.muted}}>Starea este ultima citire; comenzile recitesc dispozitivul.</small></div>
    {err && <div role="alert" style={{color:G.red}}>{err}</div>}
    {!lumini.length && <p style={{color:G.muted}}>Nu sunt lumini configurate sau migrarea nu este disponibila.</p>}
    {lumini.map(l=><div key={l.dispozitiv_id} style={{...S.row,borderBottom:`1px solid ${G.border}`,paddingBottom:8}}>
      <span style={{flex:1}}>{l.iot_dispozitive.nume}<small style={{display:'block',color:G.muted}}>{textStareLumina(l.iot_dispozitive.ultima_citire,l.iot_dispozitive.citit_la,acum)} - {formatMomentLumini(l.iot_dispozitive.citit_la)} - rol {l.rol}</small><small style={{display:'block',color:G.muted}}>{setari?.runtime?.motor?.pauze?.[l.dispozitiv_id]>acum ? `Pauza manuala pana la ${formatMomentLumini(setari.runtime.motor.pauze[l.dispozitiv_id])}` : 'Automatizare disponibila pentru programele active'}</small></span>
      {owner && <select aria-label={`Rol ${l.iot_dispozitive.nume}`} style={S.input} value={l.rol} disabled={busy} onChange={e=>{const rol=e.target.value;if(window.confirm(`Schimbarea rolului dezactiveaza programele afectate. ${avertismentAcoperire} Continui?`))run(()=>save('rol',{dispozitiv_id:l.dispozitiv_id,rol}))}}>{['exterior','interior','mixt'].map(r=><option key={r}>{r}</option>)}</select>}
      {scrie && <button style={S.btn} disabled={busy || !l.activ} onClick={()=>command(l)}>{l.iot_dispozitive.ultima_citire?.pornit===true?'Opreste':'Porneste'}</button>}
      {owner && <button style={S.btn} disabled={busy || !l.activ} onClick={()=>command(l,true)}>Testeaza dreptul de comanda</button>}
    </div>)}
    <p style={{color:G.muted}}>In afara ferestrei, programele active sting luminile acoperite. Dupa pauza manuala pot stinge si o lumina aprinsa manual. Luminile fara program activ nu sunt comandate.</p><b>Programe</b>
    {programe.map(p=><div key={p.id} style={S.row}>
      <span style={{flex:1}}>{p.nume} ({p.tip}) - {p.activ?'activ':'inactiv'}<small style={{display:'block',color:G.muted}}>{textUrmatoare(p,acum,setari || {},lumini)}</small></span>
      {scrie && <button style={S.btn} disabled={busy} onClick={()=>setForm({...p,parametri:{...nou().parametri,...p.parametri}})}>Modifica</button>}
      {owner && <label><input type="checkbox" checked={p.activ} disabled={busy} onChange={()=>{if(window.confirm(p.activ?'Dezactivezi programul? Luminile ies din acoperire si nu mai sunt atinse, inclusiv cele ramase aprinse.':'Aprobi si activezi acest program?'))run(()=>save('aprobare',{id:p.id,activ:!p.activ}))}} />{p.activ?'Activ':'Aproba si activeaza'}</label>}
    </div>)}
    {scrie && <button style={S.btn} disabled={busy} onClick={()=>setForm({...nou(),dispozitive:dispozitiveImplicite(lumini,'solar')})}>Program nou</button>}
    {form && scrie && <form style={{marginTop:12}} onSubmit={e=>{e.preventDefault();run(async()=>{await save('program',programPentruSalvare(form));setForm(null)})}}>
      <div style={S.row}><label>Nume <input style={S.input} required maxLength={120} value={form.nume} onChange={e=>patch('nume',e.target.value)}/></label>
        <label>Tip <select style={S.input} value={form.tip} onChange={e=>setForm(f=>({...f,tip:e.target.value,dispozitive:dispozitiveImplicite(lumini,e.target.value)}))}>{['solar','orar','simulare_prezenta'].map(t=><option key={t}>{t}</option>)}</select></label></div>
      <div style={S.row}>{lumini.filter(l=>poateSelectaLumina(l,form.tip)).map(l=><label key={l.dispozitiv_id}><input type="checkbox" checked={form.dispozitive.includes(l.dispozitiv_id)} onChange={e=>patch('dispozitive',e.target.checked?[...form.dispozitive,l.dispozitiv_id]:form.dispozitive.filter(id=>id!==l.dispozitiv_id))}/>{l.iot_dispozitive.nume} ({l.rol})</label>)}</div>
      {form.tip==='solar' && <div style={S.row}>{['offset_pornire','offset_oprire'].map(k=><label key={k}>{k==='offset_pornire'?'Offset apus':'Offset rasarit'} (minute) <input style={S.input} type="number" min={-180} max={180} value={form.parametri[k]} onChange={e=>param(k,Number(e.target.value))}/></label>)}<small>Implicit doar exterior; puteti selecta si mixt. Ora vara/iarna se ajusteaza automat.</small></div>}
      {form.tip==='orar' && <><div style={S.row}>{['pornire','oprire'].map(k=><label key={k}>{k} <input style={S.input} type="time" required value={form.parametri[k]} onChange={e=>param(k,e.target.value)}/></label>)}</div><div style={S.row}>{['Dum','Lun','Mar','Mie','Joi','Vin','Sam'].map((d,i)=><label key={d}><input type="checkbox" checked={form.parametri.zile.includes(i)} onChange={e=>param('zile',e.target.checked?[...form.parametri.zile,i]:form.parametri.zile.filter(n=>n!==i))}/>{d}</label>)}</div></>}
      {form.tip==='simulare_prezenta' && <div style={S.row}><label>Sfarsit <input style={S.input} type="time" required value={form.parametri.sfarsit} onChange={e=>param('sfarsit',e.target.value)}/></label><label><input type="checkbox" checked={form.parametri.explicit} onChange={e=>param('explicit',e.target.checked)}/>Inclusiv zile lucratoare (necesita aprobarea ownerului)</label><small>Interior + mixt; in weekend, vacanta sau cu activare explicita. Vacanta se configureaza mai jos.</small></div>}
      <p style={{color:G.muted}}>Salvarea dezactiveaza programul si cere o noua aprobare de la owner. {avertismentAcoperire}</p>
      <button style={S.btn} disabled={busy || !form.dispozitive.length}>Salveaza inactiv</button> <button type="button" style={S.btn} onClick={()=>setForm(null)}>Renunta</button>
    </form>}
    {owner && setari && <SetariLumini initial={setari} busy={busy} onSave={s=>run(()=>save('setari',s))}/>}
    <details style={{marginTop:15}}><summary>Ultimele 20 comenzi</summary>{jurnal.map(j=><div key={j.id} style={{fontSize:12,marginTop:6,color:j.ok?G.muted:G.red}}>{formatMomentLumini(j.creat_la)} - {lumini.find(l=>l.dispozitiv_id===j.dispozitiv_id)?.iot_dispozitive.nume || j.dispozitiv_id}: {j.comanda?'Porneste':'Opreste'} ({j.sursa}) - {j.ok?'OK':j.eroare || 'Esec'}</div>)}</details>
  </section>
}
function SetariLumini({initial,busy,onSave}) {
  const [draft,setDraft]=useState(null),s=draft || initial
  return <details style={{marginTop:15}}><summary>Coordonate si vacanta (owner)</summary><form onSubmit={e=>{e.preventDefault();if(window.confirm(confirmareSetariLumini(initial,s)))onSave(s)}}><div style={S.row}>
    {['lat','lon'].map(k=><label key={k}>{k} <input style={S.input} type="number" step="0.0001" min={k==='lat'?-65:-180} max={k==='lat'?65:180} required value={s[k]} onChange={e=>setDraft({...s,[k]:Number(e.target.value)})}/></label>)}
    {['vacanta_de','vacanta_pana'].map(k=><label key={k}>{k==='vacanta_de'?'Vacanta de la':'Vacanta pana la'} <input style={S.input} type="date" value={s[k] || ''} onChange={e=>setDraft({...s,[k]:e.target.value})}/></label>)}
    <label>Pauza manuala (ore) <input style={S.input} type="number" min="0.01" max="12" step="0.01" required value={s.pauza_ore ?? 3} onChange={e=>setDraft({...s,pauza_ore:Number(e.target.value)})}/></label>
    <label>Sfarsit implicit <input style={S.input} type="time" required value={s.simulare_pana_la?.slice(0,5)} onChange={e=>setDraft({...s,simulare_pana_la:e.target.value})}/></label>
    <button style={S.btn} disabled={busy}>Salveaza setarile</button>
  </div></form></details>
}
