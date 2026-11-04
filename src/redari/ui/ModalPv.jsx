import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { descarcaBlob, aziBucuresti } from '../docx.js'
import { COL_PLIC_AR_TGZ, atasezaMentiuniAr } from '../arMentiune.js'
import { LUCRARI, STARI_TEREN, MOTIVE_PV_B, detinatoriFaraPvA, valoriImplicitePv, salveazaImpliciteLaCreare, verificaDatePvA, genereazaPvA, verificaDatePvB, genereazaPvB, salveazaPv, verificaContinutScan, verificaDatePvC, genereazaPvC } from '../pv.js'
import { ultimulRaspuns } from '../stare.js'
import { Modal, Camp, S, msgEroare, citestePaginat, COL_RASPUNS } from './comune.jsx'

const COMISIE = ['verificare_data','verificare_de_gazpet','verificare_de_tgz']
// foto_nr rămâne în BD și în CAMPURI (CAS / comparații), dar nu se mai afișează: Final_v2 a scos fotografiile din PV A și PV B (SABLOANE §2.2–2.3)
const CAMPURI = ['data_pv','locul','constatare_mod','identitate_verificata','lucrari','stare_teren','plan_situatie',
  'foto_nr','obiectii_redare','obiectii_text','termen_remediere','reverificare_la','alte_observatii','motiv_pv_b','remediat_la']
// D5 (b): etichete în română clară, după textele din șabloanele Final_v2
const ETICHETE = {
  data_pv:'Data procesului-verbal', locul:'Locul încheierii', constatare_mod:'Constatarea s-a făcut',
  identitate_verificata:'Identitatea deținătorului verificată', plan_situatie:'Plan de situație anexat',
  obiectii_redare:'Obiecții privind readucerea terenului', obiectii_text:'Textul obiecțiilor',
  termen_remediere:'Termen de remediere convenit', reverificare_la:'Reverificare la',
  alte_observatii:'Alte observații (despăgubiri, servitute etc.)', remediat_la:'Remediat la data',
  motiv_pv_b:'Situația (motivul PV B)', lucrari:'Lucrări de readucere executate', stare_teren:'Starea terenului la data constatării',
  verificare_data:'Data verificării pe teren', verificare_de_gazpet:'Verificat de (Gazpet)', verificare_de_tgz:'Verificat de (Transgaz)',
}
const ETICHETE_LUCRARI = { sol_fertil:'Împrăștierea stratului de sol fertil', nivelare:'Nivelare', arat:'Arat', discuit:'Discuit / grăpat',
  insamantare:'Însămânțare', gard:'Refacere gard', drum:'Refacere drum de acces', altele:'Altele (descriere)' }
const ETICHETE_STARE = { nivelat:'Nivelat', strat_vegetal:'Strat vegetal refăcut', insamantat:'Însămânțat', gard_drum:'Gard / drum refăcut', alta:'Alta (descriere)' }
const ETICHETE_MOTIV = { declaratie:'A declarat că nu participă și nu are obiecții', neprezentat:'Nu s-a prezentat după convocare și afișare',
  neidentificat:'Deținător neidentificat / fără adresă cunoscută', refuz:'A refuzat semnarea fără obiecții' }
const ETICHETE_STARE_PV = { generat:'generat', trimis_spre_semnare:'trimis spre semnare', semnat:'semnat', anulat:'anulat' }
const implicite = s => s?.pv ? valoriImplicitePv({ tip: s.pv.tip, pv: s.pv, uat: s.uat, parcela: s.parcela, raspuns: s.raspuns }) : {}
// Gemini f4b r1 P2: jsonb reordonează cheile -> comparăm forma canonică (chei sortate), nu JSON.stringify brut
const canonic = v => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((o,k)=>(o[k]=canonic(v[k]),o),{}) : v
const egal = (a,b) => JSON.stringify(canonic(a ?? null)) === JSON.stringify(canonic(b ?? null))
const cas = (q, vechi, chei) => chei.reduce((r,k) => vechi[k] == null ? r.is(k,null) : r.eq(k,typeof vechi[k] === 'object' ? JSON.stringify(canonic(vechi[k])) : vechi[k]),q)
// L3: câmpurile goale primesc valorile implicite (propuneri nesalvate, editabile); PV final / PV C rămân cum sunt în BD
const forma = s => !s ? {} : (s.pv?.tip === 'C' || ['semnat','anulat'].includes(s.pv?.stare)) ? {...s.pv} : { ...s.pv, stare_teren: s.pv?.stare_teren ?? {}, ...implicite(s) }
const conflict = () => new Error('Modificat de altcineva, reîncarcă.')
export default function ModalPv({ pvId, tronson, parcelaId, detinatorId, proiectId, tip = 'A', nivel, show, onClose, onGata, dinSesiune = false }) {
  const [sursa,setSursa] = useState(null), [form,setForm] = useState({}), [comisie,setComisie] = useState({})
  const [lucru,setLucru] = useState(false), [mesaj,setMesaj] = useState('')
  const [dataStare,setDataStare] = useState(aziBucuresti), [motivAnulare,setMotivAnulare] = useState('')
  const [scan,setScan] = useState(null), [fizic,setFizic] = useState(false), [sesiune,setSesiune] = useState(dinSesiune)
  const [auto,setAuto] = useState([])   // câmpurile completate automat la creare (salvate), afișate ca notă de verificat
  const generatie = useRef(0), ocupat = useRef(false)
  const poateScrie = nivel === 'admin' || (tip !== 'C' && nivel === 'editor')
  const final = ['semnat','anulat'].includes(sursa?.pv?.stare)
  const citeste = async (curent = () => true) => {
    const unul = async (t,id) => {
      const {data,error} = await supabase.from(t).select('*').eq('id',id).single()
      if (error) throw error
      if (!data) throw new Error('Date indisponibile; reincarca.')
      return data
    }
    if (tip === 'C') {
      const opt={cheie:'id',esteCurent:curent}
      const [proiect,pv,randuriTronson,uats,parcele]=await Promise.all([
        unul('red_proiecte',proiectId),unul('red_procese_verbale',pvId),
        citestePaginat(()=>supabase.from('red_v_tronson').select('*').eq('proiect_id',proiectId).eq('tronson',tronson),{cheie:'parcela_id',esteCurent:curent}),
        citestePaginat(()=>supabase.from('red_uat').select('*').eq('proiect_id',proiectId),opt),
        citestePaginat(()=>supabase.from('red_v_parcele').select('id,tronson,km_de_la,km_pana_la,sters_la').eq('proiect_id',proiectId).eq('tronson',tronson).is('sters_la',null),opt),
      ])
      const uat=uats.find(u=>u.id===pv.uat_id)
      if(!uat || pv.tip!=='C' || pv.tronson!==tronson || pv.sters_la) throw new Error('PV C incompatibil cu proiectul/tronsonul.')
      const pvs=[]
      // Small IN batches, keyset until empty; no personal fields enter the aggregate.
      for(let i=0;i<randuriTronson.length;i+=100) pvs.push(...await citestePaginat(()=>supabase.from('red_procese_verbale')
        .select('id,parcela_id,tip,stare,sters_la,semnat_la_sesiune').in('parcela_id',randuriTronson.slice(i,i+100).map(r=>r.parcela_id))
        .eq('tip','A').eq('stare','semnat').is('sters_la',null),opt))
      return {proiect,pv,uat,uats,parcele,randuriTronson,pvs,parcela:{}}
    }
    // View excludes valoare_lei: authenticated cannot SELECT that column.
    const [parcela,detinator,proiect] = await Promise.all([
      unul('red_v_parcele',parcelaId),tip === 'A' ? unul('red_detinatori',detinatorId) : Promise.resolve(null),unul('red_proiecte',proiectId),
    ])
    if (parcela.proiect_id !== proiectId || parcela.sters_la || (tip === 'A' && (detinator.parcela_id !== parcelaId || detinator.sters_la))) throw new Error('Parcela/detinator inactiv sau incompatibil.')
    const opt = {cheie:'id',esteCurent:curent}
    // L3: răspunsul deținătorului (ultimul) precompletează PV A — ziua aleasă, modul (constatare pe teren), obiecțiile
    const [uat, rasp, raspDet] = await Promise.all([unul('red_uat',parcela.uat_id),
      supabase.from('red_procese_verbale').select('*').eq('tip',tip).eq(tip === 'A'?'detinator_id':'parcela_id',tip === 'A'?detinatorId:parcelaId).neq('stare','anulat').is('sters_la',null).maybeSingle(),
      tip === 'A' ? citestePaginat(() => supabase.from('red_raspunsuri').select(COL_RASPUNS).eq('detinator_id',detinatorId),opt) : Promise.resolve([])])
    if (rasp.error) throw rasp.error
    if (tip === 'A') return {parcela,detinator,proiect,uat,pv:rasp.data,raspuns:ultimulRaspuns(raspDet)}
    const detinatori = await citestePaginat(() => supabase.from('red_detinatori').select('*').eq('parcela_id',parcelaId).is('sters_la',null),opt)
    const convocari = [], raspunsuri = []
    for (const d of detinatori) {
      const [cont,conv,ras] = await Promise.all([
        supabase.from('red_detinatori_contact').select('adresa_cunoscuta').eq('detinator_id',d.id).maybeSingle(),
        citestePaginat(() => supabase.from('red_convocari').select('*').eq('detinator_id',d.id).eq('stare','activ').is('sters_la',null),opt),
        citestePaginat(() => supabase.from('red_raspunsuri').select(COL_RASPUNS).eq('detinator_id',d.id),opt),
      ])
      if (cont.error) throw cont.error
      d.adresa_cunoscuta = cont.data?.adresa_cunoscuta ?? false
      convocari.push(...conv); raspunsuri.push(...ras)
    }
    // juridic#021 + juridic#026: mențiunea „primit de altă persoană” de pe plic, în PV B (ajunge la TGZ: doar calitatea, fără textul liber)
    const plicIds = [...new Set(convocari.map(c => c.plic_id).filter(Boolean))]
    const plicuriAr = plicIds.length ? await citestePaginat(() => supabase.from('red_plicuri').select(COL_PLIC_AR_TGZ).in('id', plicIds), opt) : []
    convocari.splice(0, convocari.length, ...atasezaMentiuniAr(convocari, plicuriAr))
    const semnate = await citestePaginat(() => supabase.from('red_procese_verbale').select('id,parcela_id,detinator_id,tip,stare,sters_la,nr_pv,data_pv,semnat_primit_data').eq('parcela_id',parcelaId).eq('tip','A').eq('stare','semnat').is('sters_la',null),opt)
    return {parcela,detinator,proiect,uat,pv:rasp.data,detinatori,convocari,raspunsuri,pvs:semnate,areASemnat:semnate.length > 0,
      totiAuASemnat:detinatori.length > 0 && !detinatoriFaraPvA({detinatori,pvs:semnate,parcela}).length}
  }
  const aplica = s => { setSursa(s); setForm(forma(s)); setComisie(Object.fromEntries(COMISIE.map(k=>[k,s.parcela[k] ?? null]))) }
  useEffect(() => {
    const token = ++generatie.current
    ocupat.current = true; setLucru(true); setSursa(null); setMesaj(''); setScan(null); setMotivAnulare(''); setDataStare(aziBucuresti()); setFizic(false); setSesiune(dinSesiune); setAuto([])
    citeste(() => generatie.current === token).then(s => { if (generatie.current === token) aplica(s) })
      .catch(e => { if (generatie.current === token) setMesaj(msgEroare(e)) })
      .finally(() => { if (generatie.current === token) { ocupat.current=false; setLucru(false) } })
    return () => { generatie.current++ }
  }, [parcelaId,detinatorId,proiectId,tip,pvId,tronson,dinSesiune])
  const ruleaza = async f => {
    if (ocupat.current) return
    ocupat.current=true; setLucru(true); setMesaj('')
    const token=++generatie.current, curent=()=>generatie.current===token
    try { await f(curent) }
    catch(e) { if(curent()) { setMesaj(msgEroare(e)); show('PV: '+msgEroare(e),'error') } }
    finally { if(curent()) {ocupat.current=false;setLucru(false)} }
  }
  const reload = () => ruleaza(async curent => { const s=await citeste(curent); if(curent()) aplica(s) })
  const creeaza = () => ruleaza(async curent => {
    if (!poateScrie) return
    const proaspat=await citeste(curent)
    if (!curent()) return
    // PV B covers only active owners without a signed PV A.
    if (tip==='B' && proaspat.totiAuASemnat) throw new Error('Toti detinatorii au PV A semnat; PV B nu se creeaza.')
    const {data,error}=await supabase.rpc('fn_red_pv_creeaza',{p_tip:tip,p_parcela_id:parcelaId,p_detinator_id:tip==='A'?detinatorId:null,p_tronson:null})
    if (!curent()) return
    // Reconcile ambiguous errors; never repeat creation automatically.
    const s=await citeste(curent)
    if (!curent()) return
    if(error && !s.pv) { aplica(s); onGata?.(); throw new Error('Creare neconfirmată; reîncarcă înainte de reluare. '+msgEroare(error)) }
    if (!s.pv || (!error && !data?.id)) { aplica(s); onGata?.(); throw new Error('Creare fără rând confirmat; reîncarcă.') }
    // L3: PV nou -> valorile implicite se salvează imediat (CAS pe valorile citite), ca „Generează” să nu fie blocat de propuneri nesalvate.
    // Un PV existent deschis (error de unicitate) NU se completează automat: propunerile rămân în formular, nesalvate.
    // Jakarinos #990 P1-2: sursele (UAT / parcelă / răspuns) se recitesc înainte și după UPDATE (salveazaImpliciteLaCreare)
    let finalS = s, nota = ''
    if (!error) {
      try {
        let ultim = s
        const r = await salveazaImpliciteLaCreare({ tip, sursa: s,
          recitesteSurse: async () => { const t = await citeste(curent); if (!curent()) throw new Error('abandonat'); ultim = t; return t },
          confirma: async p => window.confirm('Datele UAT-ului / răspunsul deținătorului s-au schimbat de la deschidere. Salvez valorile implicite recalculate (' + Object.keys(p).map(k => ETICHETE[k] ?? k).join(', ') + ')?'),
          scrie: async (pv, patch) => {
            const q = await cas(supabase.from('red_procese_verbale').update(patch).eq('id',pv.id).eq('created_at',pv.created_at)
              .eq('stare',pv.stare).is('sters_la',null),pv,Object.keys(patch)).select('*')
            if (q.error || q.data?.length !== 1) throw new Error('nesalvat')
            return q.data[0]
          } })
        if (!curent()) return
        if (r.stare === 'salvat') {
          finalS = {...ultim,pv:r.pv}; setAuto(Object.keys(r.patch))
          if (r.schimbatDupa) nota = ' Sursele s-au schimbat chiar după completarea automată; reîncarcă și verifică valorile.'
        } else if (r.stare === 'renuntat') { finalS = ultim; nota = ' Valorile implicite nu s-au salvat; sunt propuse în formular.' }
      } catch {
        if (!curent()) return
        nota = ' Valorile implicite nu s-au salvat; verifică formularul și apasă „Salvează PV”.'
      }
    }
    aplica(finalS); onGata?.()
    show((error ? 'PV-ul existent a fost deschis.' : 'PV '+tip+' creat.') + nota, nota ? 'error' : 'success')
  })
  const schimbate = sursa?.pv ? CAMPURI.filter(k=>!egal(form[k],sursa.pv[k])) : []
  const comSchimbate = sursa ? COMISIE.filter(k=>!egal(comisie[k],sursa.parcela[k])) : []
  const salveaza = (peParcela=false) => ruleaza(async curent => {
    if(!poateScrie || !sursa?.pv || (final && (peParcela || schimbate.some(k=>k!=='remediat_la')))) return
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
    if(!poateScrie || final || schimbate.length || comSchimbate.length) return
    const s=await citeste(curent)
    if(!curent()) return
    if(!s.pv || s.pv.id!==sursa.pv.id) throw conflict()
    if(!egal(s,sursa) && !window.confirm('Datele s-au schimbat. Generez cu datele actuale din baza?')) return
    if (tip==='B' && s.totiAuASemnat) throw new Error('Toti detinatorii au PV A semnat; PV B nu se genereaza.')
    if (['semnat','anulat'].includes(s.pv.stare)) throw conflict()
    const lipsuri=(tip==='C'?verificaDatePvC:tip==='B'?verificaDatePvB:verificaDatePvA)(s)
    if(lipsuri.length) throw new Error('Lipsesc: '+lipsuri.join('; '))
    const r=await fetch('/redari/sabloane/pv_'+tip.toLowerCase()+'.docx')
    if(!r.ok) throw new Error('Sablonul PV '+tip+' nu poate fi citit.')
    const templateArrayBuffer=await r.arrayBuffer()
    if(!curent()) return
    const {blob}=await (tip==='C'?genereazaPvC:tip==='B'?genereazaPvB:genereazaPvA)({...s,templateArrayBuffer})
    if(!curent()) return
    const {path}=await salveazaPv(supabase,{blob,proiectCod:s.proiect.cod,uat3:s.uat.uat3,nrPv:s.pv.nr_pv,esteCurent:curent})
    if(!curent()) return
    const dupa=await citeste(curent)
    if(!curent()) return
    if(!egal(s,dupa)) throw new Error('Fisier salvat ('+path+'), dar datele s-au schimbat. Reincarca si regenereaza.')
    const {data,error}=await cas(supabase.from('red_procese_verbale').update({fisier_generat_path:path})
      .eq('id',s.pv.id).eq('created_at',s.pv.created_at).eq('stare',s.pv.stare).is('sters_la',null),s.pv,
      [...CAMPURI,'fisier_generat_path']).select('*')
    if(!curent()) return
    if(error || data?.length!==1) throw new Error('Fisier salvat ('+path+'), legare neconfirmata. Reincarca. '+(error?msgEroare(error):'Conflict concurent.'))
    let verificat = false
    try { verificat = egal({...s,pv:data[0]},await citeste(curent)) } catch { verificat = false }
    if(!curent()) return
    aplica({...s,pv:data[0]});descarcaBlob(blob,s.pv.nr_pv+'.docx')
    show(verificat ? 'PV '+tip+' salvat si descarcat.' : 'PV salvat, surse schimbate sau neverificate. Reincarca si regenereaza.',verificat?'success':'error');onGata?.()
  })
  // Gemini f4c r1 P2: si scanul semnat se descarca din modal (inclusiv viewer)
  const descarca = (semnat=false) => ruleaza(async curent => {
    const s=await citeste(curent)
    if(!curent()) return
    const cale=semnat?s.pv?.fisier_semnat_path:s.pv?.fisier_generat_path
    if(!cale) throw new Error(semnat?'PV fara scan semnat.':'PV fara fisier generat.')
    const {data,error}=await supabase.storage.from('redari').download(cale)
    if(!curent()) return
    if(error) throw error
    descarcaBlob(data,cale.split('/').pop())
  })
  const tranzitie = stare => ruleaza(async curent => {
    if (!poateScrie || final || schimbate.length || comSchimbate.length) return
    const s=await citeste(curent)
    if (!curent()) return
    if (!s.pv || !egal(s.pv,sursa.pv)) throw conflict()
    const patch={stare}
    let path
    if (stare==='anulat') {
      if (!motivAnulare.trim()) throw new Error('Motivul anularii este obligatoriu.')
      if (!window.confirm('Anulezi definitiv acest PV?')) return
      patch.motiv_anulare=motivAnulare.trim()
    } else {
      if (!dataStare) throw new Error('Data este obligatorie.')
      if (stare==='trimis_spre_semnare') patch.trimis_spre_semnare_data=dataStare
      else {
        if (!scan) throw new Error('Alege scanul semnat.')
        await verificaContinutScan(scan)
        if (!curent()) return
        const r=await salveazaPv(supabase,{blob:scan,semnat:true,proiectCod:s.proiect.cod,uat3:s.uat.uat3,nrPv:s.pv.nr_pv,esteCurent:curent})
        path=r.path
        if (!curent()) return
        // Copilot f4c r1 P2-02: dupa upload recitim sursele; daca s-au schimbat, nu legam scanul (il raportam separat)
        const dupa=await citeste(curent)
        if (!curent()) return
        if (!dupa.pv || !egal(dupa,s)) throw new Error('Scan pastrat la '+path+', dar datele PV-ului s-au schimbat in timpul incarcarii; semnarea NU s-a facut. Reincarca si reia.')
        Object.assign(patch,{semnat_primit_data:dataStare,fisier_semnat_path:path,semnat_fizic:fizic,semnat_la_sesiune:sesiune})
      }
    }
    const {data,error}=await cas(supabase.from('red_procese_verbale').update(patch).eq('id',s.pv.id)
      .eq('created_at',s.pv.created_at).eq('stare',s.pv.stare).is('sters_la',null),s.pv,
      [...CAMPURI,'fisier_generat_path','fisier_semnat_path']).select('*')
    if (!curent()) return
    if (error || data?.length!==1) throw new Error((path?'Scan pastrat la '+path+'. Legare neconfirmata; reincarca. ':'')+(error?msgEroare(error):'Conflict concurent; reincarca.'))
    aplica({...s,pv:data[0]});setScan(null);show('PV: '+stare+'.','success');onGata?.()
  })
  const schimba=(k,v)=>{if(!ocupat.current)setForm(f=>({...f,[k]:v}))}
  const text=(k,tip='text')=><Camp key={k} eticheta={ETICHETE[k] ?? k}><input style={S.input} type={tip} value={form[k]??''}
    step={tip==='number'?1:undefined}
    onChange={e=>{ if(tip==='number'){ const v=e.target.value; if(v===''){schimba(k,null);return} const n=Number(v); if(Number.isInteger(n)&&n>=0) schimba(k,n); return } schimba(k,e.target.value||null) }} min={tip==='number'?0:undefined}/></Camp>
  // D9: formularul cu modificări nesalvate nu se închide din greșeală (click pe fundal / ✕) fără confirmare
  const nesalvate = schimbate.length > 0 || comSchimbate.length > 0
  const inchide = () => {
    if (ocupat.current) return
    if (nesalvate && poateScrie && !window.confirm('Ai modificări nesalvate în PV. Închizi formularul și le pierzi?')) return
    onClose()
  }
  const propuse = sursa?.pv && poateScrie && !final ? Object.keys(implicite(sursa)).filter(k => schimbate.includes(k)) : []
  const eticheteLista = chei => chei.map(k => ETICHETE[k] ?? k).join(', ')
  // B: Final_v2 a scos planul de situație din PV B (rămâne în BD); A: plan DA/NU rămâne
  const booleene = tip==='A' ? ['identitate_verificata','plan_situatie','obiectii_redare'] : ['obiectii_redare']
  return <Modal titlu={sursa?.pv?.nr_pv || 'PV '+tip} latime={760} onClose={inchide}>
    {mesaj && <p role="alert">{mesaj}</p>}
    <button style={S.btnS} disabled={lucru} onClick={reload}>Reîncarcă</button>
    {tip==='B' && sursa?.areASemnat && <p>Există PV A semnat pe parcelă; PV B privește doar coproprietarii fără PV A.</p>}
    {tip==='B' && sursa?.totiAuASemnat && <p>Toți deținătorii au PV A semnat; crearea și generarea PV B sunt dezactivate.</p>}
    {sursa && !sursa.pv && poateScrie && <button style={S.btnP} disabled={lucru||(tip==='B'&&sursa.totiAuASemnat)} onClick={creeaza}>Creează PV {tip}</button>}
    {sursa?.pv && <>
      <p>{sursa.detinator?.nume || (tip==='C'?'PV C (tronson)':'PV B (parcelă)')} - {ETICHETE_STARE_PV[sursa.pv.stare] ?? sursa.pv.stare}</p>
      {auto.length > 0 && !final && <p>Completat automat la creare: {eticheteLista(auto)}. Verifică înainte de generare; totul se poate modifica.</p>}
      {propuse.length > 0 && <p>Propuneri automate (nesalvate): {eticheteLista(propuse)}. Verifică și apasă „Salvează PV”.</p>}
      <fieldset disabled={lucru || !poateScrie || final}>
        {text('data_pv','date')}{tip!=='C' && text('locul')}
        {tip==='B' && <Camp eticheta={ETICHETE.motiv_pv_b + ' (obligatoriu)'}><select style={S.input} value={form.motiv_pv_b??''} onChange={e=>schimba('motiv_pv_b',e.target.value||null)}><option value="">Alege</option>{MOTIVE_PV_B.map(k=><option key={k} value={k}>{ETICHETE_MOTIV[k] ?? k}</option>)}</select></Camp>}
        {tip==='A' && <Camp eticheta={ETICHETE.constatare_mod}><select style={S.input} value={form.constatare_mod??''} onChange={e=>schimba('constatare_mod',e.target.value||null)}>
          <option value="">Alege</option><option value="sediu">La sediul Primăriei</option><option value="teren">Pe teren, în prezența deținătorului</option></select></Camp>}
        {tip!=='C' && <>{booleene.map(k=><Camp key={k} eticheta={ETICHETE[k]}>
          <select style={S.input} value={form[k]==null?'':String(form[k])} onChange={e=>schimba(k,e.target.value===''?null:e.target.value==='true')}>
            {k!=='obiectii_redare'&&<option value="">Necunoscut</option>}<option value="true">Da</option><option value="false">Nu</option>
          </select></Camp>)}
        {[['lucrari',LUCRARI,ETICHETE_LUCRARI],['stare_teren',STARI_TEREN,ETICHETE_STARE]].map(([grup,chei,et])=><fieldset key={grup}><legend>{ETICHETE[grup]}</legend>
          {chei.map((k,i)=>i===chei.length-1 ? <Camp key={k} eticheta={et[k]}><input style={S.input} value={form[grup]?.[k]??''} onChange={e=>schimba(grup,{...form[grup],[k]:e.target.value})}/></Camp>
            : <label key={k} style={{display:'block'}}><input type="checkbox" checked={form[grup]?.[k]===true} onChange={e=>schimba(grup,{...form[grup],[k]:e.target.checked})}/>{et[k]}</label>)}
        </fieldset>)}
        {text('termen_remediere','date')}{text('reverificare_la','date')}
        </>}{(tip==='C'?[]:['obiectii_text','alte_observatii']).map(k=><Camp key={k} eticheta={ETICHETE[k]}><textarea style={S.input} value={form[k]??''} onChange={e=>schimba(k,e.target.value||null)}/></Camp>)}
      </fieldset>
      {tip!=='C' && <fieldset disabled={lucru||!poateScrie}>{text('remediat_la','date')}</fieldset>}
      {poateScrie && <button style={S.btnP} disabled={lucru||!schimbate.length} onClick={()=>salveaza()}>Salvează PV</button>}
      {tip!=='C' && <><fieldset disabled={lucru||!poateScrie||final}><legend>Verificarea parcelei pe teren (obligatorie la PV B; se salvează separat)</legend>
        {COMISIE.map(k=><Camp key={k} eticheta={ETICHETE[k]}><input style={S.input} type={k==='verificare_data'?'date':'text'} value={comisie[k]??''}
          onChange={e=>{if(!ocupat.current)setComisie(f=>({...f,[k]:e.target.value||null}))}}/></Camp>)}
      </fieldset>
      {poateScrie && <button style={S.btnS} disabled={lucru||final||!comSchimbate.length} onClick={()=>salveaza(true)}>Salvează verificarea parcelei</button>}</>}
      {poateScrie && !final && nesalvate && <p>Salvează modificările ({eticheteLista([...schimbate,...comSchimbate])}) înainte de generare.</p>}
      {poateScrie && <button style={S.btnP} disabled={lucru||final||!!schimbate.length||!!comSchimbate.length||(tip==='B'&&sursa.totiAuASemnat)} onClick={genereaza}>{sursa.pv.fisier_generat_path?'Regenerează':'Generează DOCX'}</button>}
      <button style={S.btnS} disabled={lucru||!sursa.pv.fisier_generat_path} onClick={()=>descarca()}>Descarcă</button>
      {sursa.pv.fisier_semnat_path && <button style={S.btnS} disabled={lucru} onClick={()=>descarca(true)}>Descarcă scanul semnat</button>}
      {poateScrie && !final && <fieldset disabled={lucru||!!schimbate.length||!!comSchimbate.length}><legend>Starea PV-ului</legend>
        <Camp eticheta="Data trimiterii / primirii"><input style={S.input} type="date" value={dataStare} onChange={e=>setDataStare(e.target.value)}/></Camp>
        {sursa.pv.stare==='generat' && <button style={S.btnS} onClick={()=>tranzitie('trimis_spre_semnare')}>Marchează trimis spre semnare</button>}
        <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={e=>setScan(e.target.files?.[0]??null)}/>
        <label><input type="checkbox" checked={fizic} onChange={e=>setFizic(e.target.checked)}/>Semnat fizic</label>
        <label><input type="checkbox" checked={sesiune} onChange={e=>setSesiune(e.target.checked)}/>Semnat la sesiune</label>
        <button style={S.btnP} onClick={()=>tranzitie('semnat')}>Încarcă PV semnat</button>
        <Camp eticheta="Motivul anulării"><input style={S.input} value={motivAnulare} onChange={e=>setMotivAnulare(e.target.value)}/></Camp>
        <button style={S.btnS} onClick={()=>tranzitie('anulat')}>Anulează</button>
      </fieldset>}
    </>}
  </Modal>
}
