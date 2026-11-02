import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { descarcaBlob } from '../docx.js'
import { LUCRARI, STARI_TEREN, propuneLucrari, verificaDatePvA, genereazaPvA, salveazaPv } from '../pv.js'
import { Modal, Camp, S, msgEroare } from './comune.jsx'

const COMISIE = ['verificare_data','verificare_de_gazpet','verificare_de_tgz']
const CAMPURI = ['data_pv','locul','constatare_mod','identitate_verificata','lucrari','stare_teren','plan_situatie',
  'foto_nr','obiectii_redare','obiectii_text','termen_remediere','reverificare_la','alte_observatii']
// Gemini f4b r1 P2: jsonb reordonează cheile -> comparăm forma canonică (chei sortate), nu JSON.stringify brut
const canonic = v => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((o,k)=>(o[k]=canonic(v[k]),o),{}) : v
const egal = (a,b) => JSON.stringify(canonic(a ?? null)) === JSON.stringify(canonic(b ?? null))
const cas = (q, vechi, chei) => chei.reduce((r,k) => vechi[k] == null ? r.is(k,null) : r.eq(k,typeof vechi[k] === 'object' ? JSON.stringify(canonic(vechi[k])) : vechi[k]),q)
const forma = s => s ? { ...s.pv, lucrari: s.pv?.lucrari ?? propuneLucrari(s.parcela.articol_deviz), stare_teren: s.pv?.stare_teren ?? {} } : {}
const conflict = () => new Error('Modificat de altcineva, reincarca.')
export default function ModalPv({ parcelaId, detinatorId, proiectId, nivel, show, onClose, onGata }) {
  const [sursa,setSursa] = useState(null), [form,setForm] = useState({}), [comisie,setComisie] = useState({})
  const [lucru,setLucru] = useState(false), [mesaj,setMesaj] = useState('')
  const generatie = useRef(0), ocupat = useRef(false)
  const poateScrie = nivel === 'admin' || nivel === 'editor'
  const citeste = async () => {
    const unul = async (t,id) => {
      const {data,error} = await supabase.from(t).select('*').eq('id',id).single()
      if (error) throw error
      if (!data) throw new Error('Date indisponibile; reincarca.')
      return data
    }
    // View excludes valoare_lei: authenticated cannot SELECT that column.
    const [parcela,detinator,proiect] = await Promise.all([
      unul('red_v_parcele',parcelaId),unul('red_detinatori',detinatorId),unul('red_proiecte',proiectId),
    ])
    if (parcela.proiect_id !== proiectId || detinator.parcela_id !== parcelaId || parcela.sters_la || detinator.sters_la) throw new Error('Parcela/detinator inactiv sau incompatibil.')
    const [uat, rasp] = await Promise.all([unul('red_uat',parcela.uat_id),
      supabase.from('red_procese_verbale').select('*').eq('tip','A').eq('detinator_id',detinatorId).neq('stare','anulat').is('sters_la',null).maybeSingle()])
    if (rasp.error) throw rasp.error
    return {parcela,detinator,proiect,uat,pv:rasp.data}
  }
  const aplica = s => { setSursa(s); setForm(forma(s)); setComisie(Object.fromEntries(COMISIE.map(k=>[k,s.parcela[k] ?? null]))) }
  useEffect(() => {
    const token = ++generatie.current
    ocupat.current = true; setLucru(true); setSursa(null); setMesaj('')
    citeste().then(s => { if (generatie.current === token) aplica(s) })
      .catch(e => { if (generatie.current === token) setMesaj(msgEroare(e)) })
      .finally(() => { if (generatie.current === token) { ocupat.current=false; setLucru(false) } })
    return () => { generatie.current++ }
  }, [parcelaId,detinatorId,proiectId])
  const ruleaza = async f => {
    if (ocupat.current) return
    ocupat.current=true; setLucru(true); setMesaj('')
    const token=++generatie.current, curent=()=>generatie.current===token
    try { await f(curent) }
    catch(e) { if(curent()) { setMesaj(msgEroare(e)); show('PV: '+msgEroare(e),'error') } }
    finally { if(curent()) {ocupat.current=false;setLucru(false)} }
  }
  const reload = () => ruleaza(async curent => { const s=await citeste(); if(curent()) aplica(s) })
  const creeaza = () => ruleaza(async curent => {
    if (!poateScrie) return
    const {data,error}=await supabase.rpc('fn_red_pv_creeaza',{p_tip:'A',p_parcela_id:parcelaId,p_detinator_id:detinatorId,p_tronson:null})
    if (!curent()) return
    // Reconcile ambiguous errors; never repeat creation automatically.
    const s=await citeste()
    if (!curent()) return
    aplica(s); onGata?.()
    if(error && !s.pv) throw new Error('Creare neconfirmata; reincarca inainte de reluare. '+msgEroare(error))
    if (!s.pv || (!error && !data?.id)) throw new Error('Creare fara rand confirmat; reincarca.')
    show(error ? 'PV-ul existent a fost deschis.' : 'PV A creat.','success')
  })
  const schimbate = sursa?.pv ? CAMPURI.filter(k=>!egal(form[k],sursa.pv[k])) : []
  const comSchimbate = sursa ? COMISIE.filter(k=>!egal(comisie[k],sursa.parcela[k])) : []
  const salveaza = (peParcela=false) => ruleaza(async curent => {
    if(!poateScrie || !sursa?.pv) return
    const chei=peParcela ? comSchimbate : schimbate
    if(!chei.length) return
    const vechi=peParcela ? sursa.parcela : sursa.pv, nou=peParcela ? comisie : form
    const patch=Object.fromEntries(chei.map(k=>[k,nou[k] ?? null]))
    let q=supabase.from(peParcela?'red_parcele':'red_procese_verbale').update(patch).eq('id',vechi.id).eq('created_at',vechi.created_at).is('sters_la',null)
    if(!peParcela) q=q.eq('stare',vechi.stare)
    const {data,error}=await cas(q,vechi,chei).select(peParcela?'id':'*')
    if(!curent()) return
    if(error) throw error
    if(data?.length!==1) throw conflict()
    // Preserve unsaved edits in the other, independently saved form.
    if(peParcela) setSursa(s=>s && ({...s,parcela:{...s.parcela,...patch}}))
    else {setSursa(s=>s && ({...s,pv:data[0]}));setForm(forma({...sursa,pv:data[0]}))}
    show(peParcela?'Verificarea parcelei salvata.':'PV salvat.','success');onGata?.()
  })
  const genereaza = () => ruleaza(async curent => {
    if(!poateScrie || schimbate.length || comSchimbate.length) return
    const s=await citeste()
    if(!curent()) return
    if(!s.pv || s.pv.id!==sursa.pv.id) throw conflict()
    if(!egal(s,sursa) && !window.confirm('Datele s-au schimbat. Generez cu datele actuale din baza?')) return
    const lipsuri=verificaDatePvA(s)
    if(lipsuri.length) throw new Error('Lipsesc: '+lipsuri.join('; '))
    const r=await fetch('/redari/sabloane/pv_a.docx')
    if(!r.ok) throw new Error('Sablonul PV A nu poate fi citit.')
    const templateArrayBuffer=await r.arrayBuffer()
    if(!curent()) return
    const {blob}=await genereazaPvA({...s,templateArrayBuffer})
    if(!curent()) return
    const {path}=await salveazaPv(supabase,{blob,proiectCod:s.proiect.cod,uat3:s.uat.uat3,nrPv:s.pv.nr_pv,esteCurent:curent})
    if(!curent()) return
    const dupa=await citeste()
    if(!curent()) return
    if(!egal(s,dupa)) throw new Error('Fisier salvat ('+path+'), dar datele s-au schimbat. Reincarca si regenereaza.')
    const {data,error}=await cas(supabase.from('red_procese_verbale').update({fisier_generat_path:path})
      .eq('id',s.pv.id).eq('created_at',s.pv.created_at).eq('stare',s.pv.stare).is('sters_la',null),s.pv,
      [...CAMPURI,'fisier_generat_path']).select('*')
    if(!curent()) return
    if(error || data?.length!==1) throw new Error('Fisier salvat ('+path+'), legare neconfirmata. Reincarca. '+(error?msgEroare(error):'Conflict concurent.'))
    let verificat = false
    try { verificat = egal({...s,pv:data[0]},await citeste()) } catch { verificat = false }
    if(!curent()) return
    aplica({...s,pv:data[0]});descarcaBlob(blob,s.pv.nr_pv+'.docx')
    show(verificat ? 'PV A salvat si descarcat.' : 'PV salvat, surse schimbate sau neverificate. Reincarca si regenereaza.',verificat?'success':'error');onGata?.()
  })
  const descarca = () => ruleaza(async curent => {
    const s=await citeste()
    if(!curent()) return
    if(!s.pv?.fisier_generat_path) throw new Error('PV fara fisier generat.')
    const {data,error}=await supabase.storage.from('redari').download(s.pv.fisier_generat_path)
    if(!curent()) return
    if(error) throw error
    descarcaBlob(data,s.pv.nr_pv+'.docx')
  })
  const schimba=(k,v)=>{if(!ocupat.current)setForm(f=>({...f,[k]:v}))}
  const text=(k,tip='text')=><Camp key={k} eticheta={k}><input style={S.input} type={tip} value={form[k]??''}
    step={tip==='number'?1:undefined}
    onChange={e=>{ if(tip==='number'){ const v=e.target.value; if(v===''){schimba(k,null);return} const n=Number(v); if(Number.isInteger(n)&&n>=0) schimba(k,n); return } schimba(k,e.target.value||null) }} min={tip==='number'?0:undefined}/></Camp>
  return <Modal titlu={sursa?.pv?.nr_pv || 'PV A'} latime={760} onClose={()=>{if(!ocupat.current)onClose()}}>
    {mesaj && <p role="alert">{mesaj}</p>}
    <button style={S.btnS} disabled={lucru} onClick={reload}>Reincarca</button>
    {sursa && !sursa.pv && poateScrie && <button style={S.btnP} disabled={lucru} onClick={creeaza}>Creeaza PV A</button>}
    {sursa?.pv && <>
      <p>{sursa.detinator.nume} - {sursa.pv.stare}</p>
      <fieldset disabled={lucru || !poateScrie}>
        {text('data_pv','date')}{text('locul')}
        <Camp eticheta="Constatare"><select style={S.input} value={form.constatare_mod??''} onChange={e=>schimba('constatare_mod',e.target.value||null)}>
          <option value="">Alege</option><option value="sediu">Sediu</option><option value="teren">Teren</option></select></Camp>
        {['identitate_verificata','plan_situatie','obiectii_redare'].map(k=><Camp key={k} eticheta={k}>
          <select style={S.input} value={form[k]==null?'':String(form[k])} onChange={e=>schimba(k,e.target.value===''?null:e.target.value==='true')}>
            {k!=='obiectii_redare'&&<option value="">Necunoscut</option>}<option value="true">Da</option><option value="false">Nu</option>
          </select></Camp>)}
        {sursa.pv.lucrari===null && <p>propunere din deviz - confirma prin Salvare PV</p>}
        {[['lucrari',LUCRARI],['stare_teren',STARI_TEREN]].map(([grup,chei])=><fieldset key={grup}><legend>{grup}</legend>
          {chei.map((k,i)=>i===chei.length-1 ? <Camp key={k} eticheta={k}><input style={S.input} value={form[grup]?.[k]??''} onChange={e=>schimba(grup,{...form[grup],[k]:e.target.value})}/></Camp>
            : <label key={k} style={{display:'block'}}><input type="checkbox" checked={form[grup]?.[k]===true} onChange={e=>schimba(grup,{...form[grup],[k]:e.target.checked})}/>{k}</label>)}
        </fieldset>)}
        {text('foto_nr','number')}{text('termen_remediere','date')}{text('reverificare_la','date')}
        {['obiectii_text','alte_observatii'].map(k=><Camp key={k} eticheta={k}><textarea style={S.input} value={form[k]??''} onChange={e=>schimba(k,e.target.value||null)}/></Camp>)}
      </fieldset>
      {poateScrie && <button style={S.btnP} disabled={lucru||!schimbate.length} onClick={()=>salveaza()}>Salveaza PV</button>}
      <fieldset disabled={lucru||!poateScrie}><legend>Verificare parcela (salvare separata)</legend>
        {COMISIE.map(k=><Camp key={k} eticheta={k}><input style={S.input} type={k==='verificare_data'?'date':'text'} value={comisie[k]??''}
          onChange={e=>{if(!ocupat.current)setComisie(f=>({...f,[k]:e.target.value||null}))}}/></Camp>)}
      </fieldset>
      {poateScrie && <button style={S.btnS} disabled={lucru||!comSchimbate.length} onClick={()=>salveaza(true)}>Salveaza verificarea parcelei</button>}
      <p>Salveaza toate modificarile inainte de generare.</p>
      {poateScrie && <button style={S.btnP} disabled={lucru||!!schimbate.length||!!comSchimbate.length} onClick={genereaza}>{sursa.pv.fisier_generat_path?'Regenereaza':'Genereaza DOCX'}</button>}
      <button style={S.btnS} disabled={lucru||!sursa.pv.fisier_generat_path} onClick={descarca}>Descarca</button>
    </>}
  </Modal>
}
