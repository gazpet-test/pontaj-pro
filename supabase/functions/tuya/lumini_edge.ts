import { poartaModul } from '../_shared/poartaModul.ts';
import { evalueaza } from './lumini_logica.ts';
import { planCitire } from './lumini_adaptiv.ts';

const BUGET_ON_MS = 75000, BUGET_DUR_TICK_MS = 140000, CONCURENTA_OFF = 3;
// 140s lasa 10s pana la limita minima Edge de 150s si este sub lease-ul de 240s.
// Rezervam 2 x timeout Tuya (POST + recitire) inainte de admiterea unui OFF.
const REZERVA_OFF_MS = 20000;

export async function autorizeazaLumini(req: Request, db: any, actiune: string, cron: boolean) {
  if (actiune === 'programe_tick') return cron ? { ok:true, userId:null } : { ok:false, status:403, error:'Tick permis doar cu x-iot-secret' };
  // Secretul cron nu autorizeaza comenzi manuale, nici teste.
  const gate = await poartaModul(req,db,['cladire']);
  if (!gate.ok) return gate;
  if(actiune==='consum') return gate;
  const [profile, access] = await Promise.all([
    db.from('profiles').select('is_owner').eq('id',gate.userId).maybeSingle(),
    db.from('user_module_access').select('access_level').eq('profile_id',gate.userId).eq('module','cladire').maybeSingle(),
  ]);
  if (profile.error || access.error) return { ok:false,status:403,error:'Drept indisponibil' };
  const owner = profile.data?.is_owner === true;
  if (!owner && (actiune === 'test_comanda_noop' || !['editor','admin'].includes(access.data?.access_level))) return { ok:false,status:403,error:'Fara drept de comanda' };
  return { ok:true, userId:gate.userId, owner };
}

export const eroareTuya = (error: any) => /\b1106\b|permission\s*(deny|denied)|no permission/i.test(String(error?.message || error)) ? 'cheia nu are drept de comanda' : String(error?.message || error).slice(0,500);
export function citesteSwitch(status: any[]) {
  const item = (status || []).find(x => x.code === 'switch_1' && typeof x.value === 'boolean') || (status || []).find(x=>x.code==='switch' && typeof x.value==='boolean');
  if (!item) throw new Error('Cod switch boolean necunoscut; comanda refuzata');
  return item;
}

export async function executaLumini(db: any, call: any, body: any, userId: string | null, control: any = {}) {
  if (!['comanda','test_comanda_noop','programe_tick'].includes(body.actiune) || (body.actiune!=='programe_tick' && !userId)) return {ok:false,error:'Actiune sau utilizator invalid'};
  const tick=body.actiune==='programe_tick', token=crypto.randomUUID(), start=Date.now();
  const deadlineOn=start+BUGET_ON_MS, deadlineOff=start+BUGET_DUR_TICK_MS-REZERVA_OFF_MS;
  // Ultimii 40s din admiterea OFF raman pentru comenzi; o citire dureaza max 10s.
  const deadlineCitiri=deadlineOff-40000;
  const rpc=async(actiune:string,date:any={})=>{
    const r=await db.rpc('iot_lumini_runtime',{p_actiune:actiune,p_token:token,p_date:date});
    return r.error || !r.data?.ok ? {ok:false,error:r.error?.message || r.data?.error || 'Runtime indisponibil'} : r.data;
  };
  const lease=await rpc('acquire');
  if(!lease.ok) return lease;
  // Pauze, backoff-uri, citiri si cursor OFF. Nicio memorie despre efectele POST.
  const runtime:any=lease.runtime?.motor || {};
  runtime.pauze ||= {}; runtime.backoff ||= {}; runtime.citiri_esuate ||= {};
  const errors:string[]=[], results:any[]=[], amanate:any[]=[], amanateOff:any[]=[];
  const amanateAnterior=runtime.amanate || [];
  let stop=false;
  const readIds=new Set<number>(),failedReadIds=new Set<number>(),deferredReadIds=new Set<number>();
  const refuzLocal=(e:any)=>e?.cotaTuya || e?.bugetLocal;
  const alert=async(title:string,message:string)=>db.rpc('iot_alerta',{p_type:'error',p_title:`Lumini sediu: ${title}`,p_message:message.slice(0,1000),p_link:'/cladire'});
  const save=async()=>{
    const r=await rpc('save',runtime);
    if(!r.ok) {stop=true;errors.push(r.error);}
    return r;
  };
  const journal=async(id:number,value:boolean,sursa:string,programId:any,ok:boolean,error:string|null)=>{
    const r=await db.from('iot_lumini_jurnal').insert({dispozitiv_id:id,comanda:value,sursa,program_id:programId,utilizator:userId,ok,eroare:error});
    if(r.error) {stop=true;errors.push('Jurnal indisponibil');await alert('jurnal indisponibil','Comenzile sunt oprite. Verificati starea fizica.');return false;}
    return true;
  };
  try {
    const [lights,settings,schedules]=await Promise.all([
      db.from('iot_lumini').select('dispozitiv_id,rol,activ,iot_dispozitive!inner(id,sursa,extern_id,activ,ultima_citire)').order('dispozitiv_id'),
      db.from('iot_lumini_setari').select('*').eq('id',true).single(),
      db.from('iot_program_lumini').select('*').order('id'),
    ]);
    if(lights.error || settings.error || schedules.error) return {ok:false,error:'Configuratie lumini indisponibila'};
    const list=(lights.data || []).filter((l:any)=>l.activ && l.iot_dispozitive.activ && l.iot_dispozitive.sursa==='tuya');
    const map=Object.fromEntries(list.map((l:any)=>[l.dispozitiv_id,l]));
    const stari:any={},codes:any={};
    const setari={...settings.data,roluri:Object.fromEntries(list.map((l:any)=>[l.dispozitiv_id,l.rol]))};
    const pauzeAnterioare={...runtime.pauze};
    // Curatarea este doar dupa timp/configuratie, niciodata dupa o presupunere despre POST.
    for(const [id,until] of Object.entries(runtime.pauze)) if(Number(until)<=Date.now() || !map[id]) delete runtime.pauze[id];
    const keys=new Set((schedules.data || []).filter((p:any)=>p.activ && p.aprobat_de && p.aprobat_la).flatMap((p:any)=>p.dispozitive.map((id:number)=>`${p.id}:${id}`)));
    for(const [key,until] of Object.entries(runtime.backoff)) if(Number(until)<=Date.now() || !keys.has(key)) delete runtime.backoff[key];
    for(const id of Object.keys(runtime.citiri_esuate)) if(id!=='_adaptiv' && !map[id]) delete runtime.citiri_esuate[id];
    if(tick && !(schedules.data || []).some((p:any)=>p.activ && p.aprobat_de && p.aprobat_la) && !Object.values(runtime.pauze).some(until=>Number(until)>Date.now())) {
      runtime.amanate=[];
      // finally salveaza cleanup-ul o singura data, inclusiv pe aceasta iesire.
      return {ok:true,rezultat:'nimic de facut',comenzi:[],amanate:[],amanate_off:[],erori:[]};
    }
    const buget=control.buget ? await control.buget() : {procent:0};
    const plan=planCitire(schedules.data || [],setari,{...runtime,pauze:pauzeAnterioare},Date.now(),buget.procent>=.9?30*60000:15*60000);
    if(tick && !plan.citeste) {
      for(const p of plan.erori) await alert('parametri program invalizi',`Program ${p.id}: ${p.eroare}`);
      return {ok:plan.erori.length===0,rezultat:'citire adaptiva amanata',comenzi:[],amanate:runtime.amanate || [],amanate_off:[],erori:plan.erori.map((p:any)=>`Program ${p.id}: ${p.eroare}`)};
    }
    if(tick) runtime.citiri_esuate._adaptiv={...(runtime.citiri_esuate._adaptiv || {}),reverifica:false};
    // Dorinta OFF nu depinde de cache: un intrerupator poate schimba starea intre tick-uri.
    const scopCitire=(id:number)=>plan.dorite[id]===false ? 'off' :
      plan.aproape?'tranzitie':plan.dorite[id]===true?'program':'periodic';
    const read=async(id:number,permis?:()=>boolean)=>{
      const d=map[id].iot_dispozitive;
      readIds.add(id);
      try {
        const s=citesteSwitch(await call('GET',`/v1.0/iot-03/devices/${encodeURIComponent(d.extern_id)}/status`,undefined,permis,scopCitire(id)));
        codes[id]=s.code;stari[id]=s.value;
        const latest={...(d.ultima_citire || {}),pornit:s.value,stare_bruta:{...(d.ultima_citire?.stare_bruta || {}),[s.code]:s.value}};
        const r=await db.from('iot_dispozitive').update({ultima_citire:latest,citit_la:new Date().toISOString()}).eq('id',id).eq('sursa','tuya');
        if(r.error) throw new Error('Salvare stare citita esuata');
        d.ultima_citire=latest;
        return s.value;
      } catch(e) {
        if((e as any)?.cotaTuya) stop=true;
        if(refuzLocal(e)) {
          deferredReadIds.add(id);
          // Cache-ul ramane intact; in acest tick nu comandam pe baza lui.
          stari[id]=null;
          throw e;
        }
        stari[id]=null;failedReadIds.add(id);
        // UI nu trebuie sa prezinte drept reala o citire esuata recent.
        await db.from('iot_dispozitive').update({ultima_citire:{...(d.ultima_citire || {}),pornit:null}}).eq('id',id).eq('sursa','tuya');
        throw e;
      }
    };
    const onDecise=new Set<number>();
    const posibilAprinse=()=>list.filter((l:any)=>['interior','mixt'].includes(l.rol) && (stari[l.dispozitiv_id]!==false || onDecise.has(l.dispozitiv_id))).length;
    const bugetDepasit=(value:boolean)=>Date.now()>=(value?deadlineOn:deadlineOff);
    const refuzBuget=async(id:number,value:boolean,sursa:string,programId:any)=>{
      if(value || !tick) return {ok:false,error:'Buget timp depasit'};
      const entry={dispozitiv_id:id,program_id:programId,motiv:'plafon_dur_off'};
      amanateOff.push(entry);amanate.push(entry);
      // Dedup pe episodul de amanare, persistat in cheia runtime deja acceptata de RPC.
      if(!amanateAnterior.some((a:any)=>a.dispozitiv_id===id && a.program_id===programId && a.motiv===entry.motiv)) {
        await journal(id,false,sursa,programId,false,'OFF amanat: plafon dur tick (140s, inclusiv rezerva POST + recitire)');
      }
      await alert(`OFF amanat program ${programId} lumina ${id}`,`Lumina ${id}: OFF amanat la plafonul dur; se reincearca prin convergenta si rotire.`);
      return {ok:false,error:'OFF amanat: plafon dur tick',amanat_off:true};
    };
    const send=async(id:number,value:boolean,sursa:string,programId:any)=>{
      if(stop) return {ok:false,error:'Executie oprita'};
      if(tick && stari[id]!==value) runtime.citiri_esuate._adaptiv.reverifica=true;
      if(bugetDepasit(value)) return await refuzBuget(id,value,sursa,programId);
      // OFF idempotent inclusiv manual; testul noop ramane o proba explicita de drept.
      if(sursa!=='test' && stari[id]===value) {
        const logged=await journal(id,value,sursa,programId,true,'Starea este deja cea ceruta; fara POST');
        return {ok:logged,stare:stari[id]};
      }
      if(tick) runtime.citiri_esuate._adaptiv.reverifica=true;
      const reserved=await rpc('reserve',{stare:value});
      if(!reserved.ok) {
        await journal(id,value,sursa,programId,false,reserved.error);
        await alert('plafon comenzi atins',reserved.error);
        return reserved;
      }
      if(stop) return {ok:false,error:'Executie oprita'};
      if(bugetDepasit(value)) return await refuzBuget(id,value,sursa,programId);
      // Audit append-only inainte de efect: la caderea workerului ramane urma incercarii.
      if(!await journal(id,value,sursa,programId,false,'POST urmeaza; rezultatul se jurnalizeaza separat')) return {ok:false,error:'Jurnal indisponibil'};
      // Revalidam lease-ul dupa operatiile DB, inaintea efectului fizic.
      if(!(await save()).ok || stop) return {ok:false,error:'Runtime nesalvat sau executie oprita'};
      if(bugetDepasit(value)) return await refuzBuget(id,value,sursa,programId);
      let error:string|null=null,posted=false;
      try {
        const accepted=await call('POST',`/v1.0/iot-03/devices/${encodeURIComponent(map[id].iot_dispozitive.extern_id)}/commands`,{commands:[{code:codes[id],value}]},()=>!stop && !bugetDepasit(value),value?(plan.aproape?'tranzitie':'program'):'off');
        if(accepted!==true) throw Object.assign(new Error('Comanda refuzata de Tuya'),{refuzCert:true});
        posted=true;
      } catch(e) {
        if((e as any)?.cotaTuya) stop=true;
        if((e as any)?.bugetExpirat) return await refuzBuget(id,value,sursa,programId);
        error=eroareTuya(e);
        if(value && sursa==='program' && (e as any)?.refuzCert) {
          runtime.backoff[`${programId}:${id}`]=Date.now()+30*60000;
          await save();
        }
        // Chiar un POST fara raspuns poate fi executat. Ocupa loc conservator in acest tick.
        stari[id]=null;
        await db.from('iot_dispozitive').update({ultima_citire:{...(map[id].iot_dispozitive.ultima_citire || {}),pornit:null}}).eq('id',id).eq('sursa','tuya');
      }
      if(posted) {
        try {await read(id);if(stari[id]!==value) error='Starea reala nu coincide cu cea ceruta';}
        catch(e) {error=eroareTuya(e);}
      }
      const logged=await journal(id,value,sursa,programId,!error,error);
      return {ok:!error && logged,error:error || (!logged?'Jurnal indisponibil':null),stare:stari[id]};
    };
    if(!tick) {
      const id=body.dispozitiv_id, test=body.actiune==='test_comanda_noop';
      if(!Number.isInteger(id) || !map[id]) return {ok:false,error:'Dispozitivul nu este in lista de lumini active'};
      if(!test && typeof body.stare!=='boolean') return {ok:false,error:'stare trebuie sa fie boolean'};
      try {if(control.verificaComanda) await control.verificaComanda();}
      catch(e) {return {ok:false,error:eroareTuya(e)};}
      if(!test) {
        const hours=Number(settings.data.pauza_ore ?? 3);
        if(!Number.isFinite(hours) || hours<=0 || hours>12) return {ok:false,error:'Pauza invalida'};
        runtime.pauze[id]=Date.now()+hours*3600000;
        if(!(await save()).ok) return {ok:false,error:'Pauza nesalvata; comanda refuzata'};
      }
      let value=test?false:body.stare;
      try {const current=await read(id);if(test)value=current;}
      catch(e) {const error=eroareTuya(e);if(!refuzLocal(e))await journal(id,value,test?'test':'manual',null,false,error);return {ok:false,error};}
      return await send(id,value,test?'test':'manual',null);
    }
    // Ultimul tick inlocuieste lista, inclusiv cand nu mai exista amanari.
    runtime.amanate=amanate;
    // Rotim pe lista stabila de lumini, nu pe comenzile ramase dupa convergenta.
    const offset=Number.isInteger(runtime.off_offset)?runtime.off_offset % Math.max(list.length,1):0;
    const offOrder=[...list.slice(offset),...list.slice(0,offset)].map((l:any)=>l.dispozitiv_id);
    runtime.off_offset=(offset+1)%Math.max(list.length,1);
    // Citim doar acoperirea aprobata si pauzele active; restul ocupa conservator capacitate.
    const acoperite=list.filter((l:any)=>plan.ids.includes(l.dispozitiv_id) &&
      (buget.procent<.9 || (plan.dorite[l.dispozitiv_id]!==undefined &&
        (buget.procent<1 || (plan.dorite[l.dispozitiv_id]===false && !(runtime.pauze[l.dispozitiv_id]>Date.now()))))));
    if(!acoperite.length) return {ok:true,rezultat:'Tuya in mod economie: citire periodica oprita',comenzi:[],amanate:[],amanate_off:[],erori:[]};
    const cursor=Number(runtime.citiri_esuate._adaptiv.read_offset || 0)%acoperite.length;
    const citiri=[...acoperite.slice(cursor),...acoperite.slice(0,cursor)];
    let admise=0;
    for(let i=0;i<citiri.length;i+=3) {
      if(stop || Date.now()+10000>deadlineCitiri) break;
      const lot=citiri.slice(i,i+3);admise+=lot.length;
      await Promise.all(lot.map(async(l:any)=>{
      const id=l.dispozitiv_id;
      try {await read(id,()=>!stop && Date.now()+10000<=deadlineCitiri);}
      catch(e) {
        const error=eroareTuya(e);errors.push(`Citire ${id}: ${error}`);
        if(!refuzLocal(e))await journal(id,false,'program',null,false,`Citire esuata; nicio comanda: ${error}`);
      }
      }));
    }
    runtime.citiri_esuate._adaptiv.read_offset=(cursor+admise)%acoperite.length;
    // Ancoram in inceputul tick-ului: latenta citirilor nu mai adauga inca un tick de 5 min.
    if(!failedReadIds.size && !deferredReadIds.size && admise===acoperite.length) runtime.citiri_esuate._adaptiv={...runtime.citiri_esuate._adaptiv,ultima_completa:start,semnatura:plan.semnatura};
    if(failedReadIds.size || deferredReadIds.size || admise<acoperite.length) runtime.citiri_esuate._adaptiv.reverifica=true;
    if(!(await save()).ok) return {ok:false,error:'Runtime nesalvat'};
    const jobs:any[]=[], covered=new Set<number>(), momentEvaluare=new Date();
    let simulareActiva=false;
    for(const p of schedules.data || []) {
      const r=evalueaza(p,momentEvaluare,stari,setari);
      if(r.eroare) {errors.push(`Program ${p.id}: ${r.eroare}`);await alert('parametri program invalizi',`Program ${p.id}: ${r.eroare}`);continue;}
      if(p.tip==='simulare_prezenta' && r.fereastra_activa) simulareActiva=true;
      for(const id of Object.keys(r.dorite).map(Number)) {
        // Configuratia invalida cu suprapuneri este refuzata si in motor.
        if(covered.has(id)) {stop=true;await alert('parametri program invalizi','Programe active suprapuse');}
        covered.add(id);
      }
      jobs.push(...r.comenzi.map(c=>({...c,program:p})));
    }
    const executa=async(cmd:any)=>{
      const id=cmd.dispozitiv_id,p=cmd.program,value=cmd.stare;
      if(deferredReadIds.has(id)) return;
      if(stop) return;
      if(runtime.pauze[id]>Date.now() || (value && runtime.backoff[`${p.id}:${id}`]>Date.now())) return;
      if(value && simulareActiva && ['interior','mixt'].includes(map[id].rol)) {
        if(stari[id]===false && !onDecise.has(id) && posibilAprinse()>=2) {
          amanate.push({dispozitiv_id:id,program_id:p.id,motiv:'plafon_comun_2'});
          // Titlu stabil per pereche; iot_alerta deduplica pe 12 ore.
          const notified=await alert(`amanat program ${p.id} lumina ${id}`,`Program ${p.id}, lumina ${id}: amanat: plafon comun (2).`);
          if(notified.error) errors.push('Notificare amanare indisponibila');
          return;
        }
        // Chiar un ON acceptat dar recitit OFF poate avea efect intarziat.
        onDecise.add(id);
      }
      const result=await send(id,value,'program',p.id);
      results.push({dispozitiv_id:id,stare:value,...result});
      if(!result.ok) errors.push(result.error || 'Comanda esuata');
    };
    // OFF in grupe de maximum 3, in acelasi lease. ON asteapta toate recitirile OFF.
    const offJobs=jobs.filter(c=>!c.stare).sort((a,b)=>offOrder.indexOf(a.dispozitiv_id)-offOrder.indexOf(b.dispozitiv_id));
    for(let i=0;i<offJobs.length;i+=CONCURENTA_OFF) {
      await Promise.all(offJobs.slice(i,i+CONCURENTA_OFF).map(executa));
    }
    for(const cmd of jobs.filter(c=>c.stare)) await executa(cmd);
    return {ok:!stop && errors.length===0,comenzi:results,amanate,amanate_off:amanateOff,erori:errors};
  } catch(e) {
    await alert('eroare program',eroareTuya(e));
    return {ok:false,error:eroareTuya(e)};
  } finally {
    if(tick) for(const id of readIds) {
      if(deferredReadIds.has(id) && !failedReadIds.has(id)) continue;
      if(failedReadIds.has(id)) {
        runtime.citiri_esuate[id]=(runtime.citiri_esuate[id] || 0)+1;
        if(runtime.citiri_esuate[id]>=3) await alert('citiri repetate esuate',`Lumina ${id}: ${runtime.citiri_esuate[id]} tick-uri consecutive cu citiri esuate.`);
      } else delete runtime.citiri_esuate[id];
    }
    const saved=await save();
    if(!saved.ok) await alert('runtime nesalvat','Automatizarea necesita verificare manuala.');
    await rpc('release');
  }
}
