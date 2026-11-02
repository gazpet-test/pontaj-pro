import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { citestePaginat, G, S, msgEroare } from './comune.jsx'
import ModalPv from './ModalPv.jsx'

export default function TronsoaneEcran({proiect,nivel,show}) {
  const [date,setDate]=useState(null), [mesaj,setMesaj]=useState(''), [reload,setReload]=useState(0)
  const [pv,setPv]=useState(null), [lucru,setLucru]=useState(false)
  const [atribuire,setAtribuire]=useState({uat:'',de:'',pana:'',tronson:'1'})
  const generatie=useRef(0), ocupat=useRef(false)
  const citeste=async curent=>{
    const opt={cheie:'id',esteCurent:curent}
    const [randuri,uats,neatribuite]=await Promise.all([
      citestePaginat(()=>supabase.from('red_v_tronson').select('*').eq('proiect_id',proiect.id),{cheie:'parcela_id',esteCurent:curent}),
      citestePaginat(()=>supabase.from('red_uat').select('id,nume').eq('proiect_id',proiect.id),opt),
      citestePaginat(()=>supabase.from('red_v_parcele').select('id').eq('proiect_id',proiect.id).is('tronson',null).is('sters_la',null),opt),
    ])
    const pvs=[]
    for(let i=0;i<uats.length;i+=100) pvs.push(...await citestePaginat(()=>supabase.from('red_procese_verbale').select('id,nr_pv,tronson,stare')
      .eq('tip','C').in('uat_id',uats.slice(i,i+100).map(u=>u.id)).neq('stare','anulat').is('sters_la',null),opt))
    return {randuri,uats,pvs,neatribuite:neatribuite.length}
  }
  useEffect(()=>{
    const token=++generatie.current, curent=()=>token===generatie.current
    setDate(null);setLucru(true);ocupat.current=true
    citeste(curent).then(d=>{if(curent())setDate(d)}).catch(e=>{if(curent())setMesaj(msgEroare(e))})
      .finally(()=>{if(curent()){setLucru(false);ocupat.current=false}})
    return ()=>{generatie.current++}
  },[proiect.id,reload])
  // Copilot f8b r1 P2-01: modalul PV C se inchide doar la schimbarea proiectului sau prin onClose, nu la reload (onGata)
  useEffect(()=>{setPv(null);setMesaj('');setAtribuire({uat:'',de:'',pana:'',tronson:'1'})},[proiect.id])
  const atribuie=async e=>{
    e.preventDefault()
    if(ocupat.current || nivel!=='admin')return
    const de=Number(atribuire.de), pana=Number(atribuire.pana), tronson=Number(atribuire.tronson)
    if(!/^\d+$/.test(atribuire.de)||!/^\d+$/.test(atribuire.pana)||!Number.isSafeInteger(de)||!Number.isSafeInteger(pana)||de<1||pana<de||pana>2147483647||!Number.isInteger(tronson)||tronson<1||tronson>11){setMesaj('22023: Interval HG sau tronson invalid');return}
    const uat=date?.uats.find(u=>u.id===atribuire.uat)
    if(!window.confirm(`Atribui tronsonul T${tronson} parcelelor cu pozitia HG ${de}-${pana}${uat?' din UAT '+uat.nume:''}?`))return
    ocupat.current=true;setLucru(true);setMesaj('')
    const token=++generatie.current, proiectId=proiect.id, curent=()=>token===generatie.current
    let final
    try{
      const {data:k,error}=await supabase.rpc('fn_red_seteaza_tronson',{p_proiect_id:proiectId,p_uat_id:atribuire.uat||null,p_hg_de_la:de,p_hg_pana_la:pana,p_tronson:tronson})
      if(!curent())return
      if(error)throw error
      if(!Number.isInteger(k)||k<0)throw new Error('Raspuns invalid: numarul parcelelor este necunoscut')
      final=`${k} parcele actualizate`
      try{const d=await citeste(curent);if(curent())setDate(d)}catch(e){final+='; reincarcare esuata: '+msgEroare(e)}
    }catch(e){final=(e.code?e.code+': ':'')+msgEroare(e)}
    finally{if(curent()){setMesaj(final);ocupat.current=false;setLucru(false)}}
  }
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
  const tronsoane=[...new Set(date?.randuri.filter(r=>r.tronson!=null).map(r=>r.tronson)??[])].sort((a,b)=>a-b)
  return <div style={S.card}>
    {mesaj && <p role="alert">{mesaj}</p>}
    {date && <p>Parcele fara tronson: {date.neatribuite} (neatribuit)</p>}
    {nivel==='admin' && date && <form onSubmit={atribuie}>
      <p>Atribuie tronson pe interval de pozitie HG</p>
      <label>UAT (optional) <select style={S.select} disabled={lucru} value={atribuire.uat} onChange={e=>setAtribuire(a=>({...a,uat:e.target.value}))}>
        <option value="">Toate UAT-urile</option>{date.uats.map(u=><option key={u.id} value={u.id}>{u.nume}</option>)}
      </select></label>
      {['de','pana'].map(k=><label key={k}>HG {k==='de'?'de la':'pana la'} <input style={{...S.input,width:110}} type="number" min="1" max="2147483647" step="1" required disabled={lucru} value={atribuire[k]} onChange={e=>setAtribuire(a=>({...a,[k]:e.target.value}))}/></label>)}
      <label>Tronson <select style={S.select} disabled={lucru} value={atribuire.tronson} onChange={e=>setAtribuire(a=>({...a,tronson:e.target.value}))}>
        {Array.from({length:11},(_,i)=><option key={i+1} value={i+1}>T{i+1}</option>)}
      </select></label> <button style={S.btnP} disabled={lucru}>Atribuie</button>
    </form>}
    <button style={S.btnS} disabled={lucru} onClick={()=>{setMesaj('');setReload(n=>n+1)}}>↻ Reîncarcă</button>
    {lucru && <p style={{ fontSize:12.5, color:G.muted }}>Se încarcă...</p>}
    {date && !tronsoane.length && <p style={{ fontSize:12.5, color:G.muted }}>Niciun tronson atribuit.</p>}
    {date && <table><thead><tr>{['Tronson','UAT-uri','Parcele','PV A semnat','PV B','Fără PV','Obiecții deschise','PV C'].map(k=><th key={k} style={S.th}>{k}</th>)}</tr></thead>
      <tbody>{tronsoane.map(t=>{
        const rs=date.randuri.filter(r=>r.tronson===t), ids=new Set(rs.map(r=>r.uat_id))
        const fara=rs.filter(r=>r.tip_pv==null).length, existent=date.pvs.find(p=>p.tronson===t)
        return <tr key={t}><td style={S.td}>{t}</td><td style={S.td}>{date.uats.filter(u=>ids.has(u.id)).map(u=>u.nume).sort().join(', ')}</td>
          {[rs.length,rs.filter(r=>r.tip_pv==='A').length,rs.filter(r=>r.tip_pv==='B').length,fara,rs.filter(r=>r.obiectii_deschise===true).length].map((v,i)=><td key={i} style={S.td}>{v}</td>)}
          <td style={S.td}>{existent?<button style={S.btnS} disabled={lucru} onClick={()=>deschide(t)}>{existent.nr_pv} - {existent.stare}</button>
            :nivel==='admin' && <button style={S.btnP} disabled={lucru||fara!==0||date.neatribuite>0} title={date.neatribuite>0?'Atribuie întâi tronsonul celor '+date.neatribuite+' parcele neatribuite':undefined} onClick={()=>deschide(t)}>＋ Creează PV C</button>}</td></tr>
      })}</tbody></table>}
    {pv && <ModalPv key={pv.id} pvId={pv.id} tronson={pv.tronson} proiectId={proiect.id} tip="C" nivel={nivel} show={show}
      onClose={()=>{setPv(null);setReload(n=>n+1)}} onGata={()=>setReload(n=>n+1)}/>}
  </div>
}
