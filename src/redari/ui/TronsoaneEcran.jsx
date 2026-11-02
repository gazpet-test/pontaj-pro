import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { citestePaginat, S, msgEroare } from './comune.jsx'
import ModalPv from './ModalPv.jsx'

export default function TronsoaneEcran({proiect,nivel,show}) {
  const [date,setDate]=useState(null), [mesaj,setMesaj]=useState(''), [reload,setReload]=useState(0)
  const [pv,setPv]=useState(null), [lucru,setLucru]=useState(false)
  const generatie=useRef(0), ocupat=useRef(false)
  const citeste=async curent=>{
    const opt={cheie:'id',esteCurent:curent}
    const [randuri,uats]=await Promise.all([
      citestePaginat(()=>supabase.from('red_v_tronson').select('*').eq('proiect_id',proiect.id),{cheie:'parcela_id',esteCurent:curent}),
      citestePaginat(()=>supabase.from('red_uat').select('id,nume').eq('proiect_id',proiect.id),opt),
    ])
    const pvs=[]
    for(let i=0;i<uats.length;i+=100) pvs.push(...await citestePaginat(()=>supabase.from('red_procese_verbale').select('id,nr_pv,tronson,stare')
      .eq('tip','C').in('uat_id',uats.slice(i,i+100).map(u=>u.id)).neq('stare','anulat').is('sters_la',null),opt))
    return {randuri,uats,pvs}
  }
  useEffect(()=>{
    const token=++generatie.current, curent=()=>token===generatie.current
    setDate(null);setMesaj('');setLucru(true);ocupat.current=true
    citeste(curent).then(d=>{if(curent())setDate(d)}).catch(e=>{if(curent())setMesaj(msgEroare(e))})
      .finally(()=>{if(curent()){setLucru(false);ocupat.current=false}})
    return ()=>{generatie.current++}
  },[proiect.id,reload])
  const deschide=async tronson=>{
    if(ocupat.current) return
    const existant=date.pvs.find(p=>p.tronson===tronson)
    if(existant){setPv(existant);return}
    if(nivel!=='admin') return
    ocupat.current=true;setLucru(true);setMesaj('')
    const token=++generatie.current, curent=()=>token===generatie.current
    try {
      const {data,error}=await supabase.rpc('fn_red_pv_c_creeaza',{p_proiect_id:proiect.id,p_tronson:tronson})
      if(!curent())return
      // Reconcile even on timeout; no automatic retry or number reservation.
      const proaspat=await citeste(curent)
      if(!curent())return
      setDate(proaspat)
      const confirmat=proaspat.pvs.find(p=>p.tronson===tronson)
      if(!confirmat)throw new Error('Creare neconfirmata; reincarca. '+(error?msgEroare(error):''))
      setPv(!error && data?.id===confirmat.id?data:confirmat)
    } catch(e){if(curent())setMesaj(msgEroare(e))}
    finally{if(curent()){ocupat.current=false;setLucru(false)}}
  }
  const tronsoane=[...new Set(date?.randuri.map(r=>r.tronson)??[])].sort((a,b)=>a-b)
  return <div style={S.card}>
    {mesaj && <p role="alert">{mesaj}</p>}
    <button style={S.btnS} disabled={lucru} onClick={()=>setReload(n=>n+1)}>Reincarca</button>
    {lucru && <p>Se incarca...</p>}
    {date && !tronsoane.length && <p>Nicio parcela activa.</p>}
    {date && <table><thead><tr>{['Tronson','UAT-uri','Parcele','PV A semnat','PV B','Fara PV','Obiectii deschise','PV C'].map(k=><th key={k} style={S.th}>{k}</th>)}</tr></thead>
      <tbody>{tronsoane.map(t=>{
        const rs=date.randuri.filter(r=>r.tronson===t), ids=new Set(rs.map(r=>r.uat_id))
        const fara=rs.filter(r=>r.tip_pv==null).length, existent=date.pvs.find(p=>p.tronson===t)
        return <tr key={t}><td style={S.td}>{t}</td><td style={S.td}>{date.uats.filter(u=>ids.has(u.id)).map(u=>u.nume).sort().join(', ')}</td>
          {[rs.length,rs.filter(r=>r.tip_pv==='A').length,rs.filter(r=>r.tip_pv==='B').length,fara,rs.filter(r=>r.obiectii_deschise===true).length].map((v,i)=><td key={i} style={S.td}>{v}</td>)}
          <td style={S.td}>{existent?<button style={S.btnS} disabled={lucru} onClick={()=>deschide(t)}>{existent.nr_pv} - {existent.stare}</button>
            :nivel==='admin' && <button style={S.btnP} disabled={lucru||fara!==0} onClick={()=>deschide(t)}>Creeaza PV C</button>}</td></tr>
      })}</tbody></table>}
    {pv && <ModalPv key={pv.id} pvId={pv.id} tronson={pv.tronson} proiectId={proiect.id} tip="C" nivel={nivel} show={show}
      onClose={()=>{setPv(null);setReload(n=>n+1)}} onGata={()=>setReload(n=>n+1)}/>}
  </div>
}