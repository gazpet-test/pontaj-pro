import { poartaModul } from '../_shared/poartaModul.ts';
import { evalueaza } from './lumini_logica.ts';

export async function autorizeazaLumini(req: Request, db: any, actiune: string, cron: boolean) {
  if (actiune === 'programe_tick') return cron ? { ok:true, userId:null } : { ok:false, status:403, error:'Tick permis doar cu x-iot-secret' };
  // Secretul cron nu autorizeaza comenzi manuale, nici teste.
  const gate = await poartaModul(req,db,['cladire']);
  if (!gate.ok) return gate;
  const [profile, access] = await Promise.all([
    db.from('profiles').select('is_owner').eq('id',gate.userId).maybeSingle(),
    db.from('user_module_access').select('access_level').eq('profile_id',gate.userId).eq('module','cladire').maybeSingle(),
  ]);
  if (profile.error || access.error) return { ok:false,status:403,error:'Drept indisponibil' };
  const owner = profile.data?.is_owner === true;
  if (!owner && (actiune === 'test_comanda_noop' || !['editor','admin'].includes(access.data?.access_level))) return { ok:false,status:403,error:'Fara drept de comanda' };
  return { ok:true, userId:gate.userId };
}

export const eroareTuya = (error: any) => /\b1106\b|permission\s*(deny|denied)|no permission/i.test(String(error?.message || error)) ? 'cheia nu are drept de comanda' : String(error?.message || error).slice(0,500);
export function citesteSwitch(status: any[]) {
  const item = (status || []).find(x => x.code === 'switch_1' && typeof x.value === 'boolean') || (status || []).find(x=>x.code==='switch' && typeof x.value==='boolean');
  if (!item) throw new Error('Cod switch boolean necunoscut; comanda refuzata');
  return item;
}

export async function executaLumini(db: any, call: any, body: any, userId: string | null) {
  if (!['comanda','test_comanda_noop','programe_tick'].includes(body.actiune) || (body.actiune!=='programe_tick' && !userId)) return {ok:false,error:'Actiune sau utilizator invalid'};
  const tick=body.actiune==='programe_tick', token=crypto.randomUUID(), deadline=Date.now()+75000;
  const rpc=async(actiune:string,date:any={})=>{
    const r=await db.rpc('iot_lumini_runtime',{p_actiune:actiune,p_token:token,p_date:date});
    return r.error || !r.data?.ok ? {ok:false,error:r.error?.message || r.data?.error || 'Runtime indisponibil'} : r.data;
  };
  const lease=await rpc('acquire');
  if(!lease.ok) return lease;
  // Pauze, backoff-uri, citiri si cursor OFF. Nicio memorie despre efectele POST.
  const runtime:any=lease.runtime?.motor || {};
  runtime.pauze ||= {}; runtime.backoff ||= {}; runtime.citiri_esuate ||= {};
  const errors:string[]=[], results:any[]=[], amanate:any[]=[];
  let stop=false;
  const readIds=new Set<number>(),failedReadIds=new Set<number>();
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
    // Curatarea este doar dupa timp/configuratie, niciodata dupa o presupunere despre POST.
    for(const [id,until] of Object.entries(runtime.pauze)) if(Number(until)<=Date.now() || !map[id]) delete runtime.pauze[id];
    const keys=new Set((schedules.data || []).filter((p:any)=>p.activ && p.aprobat_de && p.aprobat_la).flatMap((p:any)=>p.dispozitive.map((id:number)=>`${p.id}:${id}`)));
    for(const [key,until] of Object.entries(runtime.backoff)) if(Number(until)<=Date.now() || !keys.has(key)) delete runtime.backoff[key];
    for(const id of Object.keys(runtime.citiri_esuate)) if(!map[id]) delete runtime.citiri_esuate[id];
    const read=async(id:number)=>{
      const d=map[id].iot_dispozitive;
      readIds.add(id);
      try {
        const s=citesteSwitch(await call('GET',`/v1.0/iot-03/devices/${encodeURIComponent(d.extern_id)}/status`));
        codes[id]=s.code;stari[id]=s.value;
        const latest={...(d.ultima_citire || {}),pornit:s.value,stare_bruta:{...(d.ultima_citire?.stare_bruta || {}),[s.code]:s.value}};
        const r=await db.from('iot_dispozitive').update({ultima_citire:latest,citit_la:new Date().toISOString()}).eq('id',id).eq('sursa','tuya');
        if(r.error) throw new Error('Salvare stare citita esuata');
        d.ultima_citire=latest;
        return s.value;
      } catch(e) {
        stari[id]=null;failedReadIds.add(id);
        // UI nu trebuie sa prezinte drept reala o citire esuata recent.
        await db.from('iot_dispozitive').update({ultima_citire:{...(d.ultima_citire || {}),pornit:null}}).eq('id',id).eq('sursa','tuya');
        throw e;
      }
    };
    const onDecise=new Set<number>();
    const posibilAprinse=()=>list.filter((l:any)=>['interior','mixt'].includes(l.rol) && (stari[l.dispozitiv_id]!==false || onDecise.has(l.dispozitiv_id))).length;
    const send=async(id:number,value:boolean,sursa:string,programId:any)=>{
      if(stop || Date.now()>deadline) return {ok:false,error:'Executie oprita sau buget timp depasit'};
      // OFF idempotent inclusiv manual; testul noop ramane o proba explicita de drept.
      if(sursa!=='test' && stari[id]===value) {
        const logged=await journal(id,value,sursa,programId,true,'Starea este deja cea ceruta; fara POST');
        return {ok:logged,stare:stari[id]};
      }
      const reserved=await rpc('reserve',{stare:value});
      if(!reserved.ok) {
        await journal(id,value,sursa,programId,false,reserved.error);
        await alert('plafon comenzi atins',reserved.error);
        return reserved;
      }
      // Audit append-only inainte de efect: la caderea workerului ramane urma incercarii.
      if(!await journal(id,value,sursa,programId,false,'POST urmeaza; rezultatul se jurnalizeaza separat')) return {ok:false,error:'Jurnal indisponibil'};
      // Revalidam lease-ul dupa operatiile DB, inaintea efectului fizic.
      if(!(await save()).ok || Date.now()>deadline) return {ok:false,error:'Runtime nesalvat sau buget timp depasit'};
      let error:string|null=null,posted=false;
      try {
        const accepted=await call('POST',`/v1.0/iot-03/devices/${encodeURIComponent(map[id].iot_dispozitive.extern_id)}/commands`,{commands:[{code:codes[id],value}]});
        if(accepted!==true) throw Object.assign(new Error('Comanda refuzata de Tuya'),{refuzCert:true});
        posted=true;
      } catch(e) {
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
      if(!test) {
        const hours=Number(settings.data.pauza_ore ?? 3);
        if(!Number.isFinite(hours) || hours<=0 || hours>12) return {ok:false,error:'Pauza invalida'};
        runtime.pauze[id]=Date.now()+hours*3600000;
        if(!(await save()).ok) return {ok:false,error:'Pauza nesalvata; comanda refuzata'};
      }
      let value=test?false:body.stare;
      try {const current=await read(id);if(test)value=current;}
      catch(e) {const error=eroareTuya(e);await journal(id,value,test?'test':'manual',null,false,error);return {ok:false,error};}
      return await send(id,value,test?'test':'manual',null);
    }
    // Ultimul tick inlocuieste lista, inclusiv cand nu mai exista amanari.
    runtime.amanate=amanate;
    // Rotim pe lista stabila de lumini, nu pe comenzile ramase dupa convergenta.
    const offset=Number.isInteger(runtime.off_offset)?runtime.off_offset % Math.max(list.length,1):0;
    const offOrder=[...list.slice(offset),...list.slice(0,offset)].map((l:any)=>l.dispozitiv_id);
    runtime.off_offset=(offset+1)%Math.max(list.length,1);
    // Citim toate luminile active, inclusiv cele fara program (capacitate conservatoare).
    await Promise.all(list.map(async(l:any)=>{
      const id=l.dispozitiv_id;
      try {await read(id);}
      catch(e) {
        const error=eroareTuya(e);errors.push(`Citire ${id}: ${error}`);
        await journal(id,false,'program',null,false,`Citire esuata; nicio comanda: ${error}`);
      }
    }));
    if(!(await save()).ok) return {ok:false,error:'Runtime nesalvat'};
    const jobs:any[]=[], covered=new Set<number>();
    for(const p of schedules.data || []) {
      const r=evalueaza(p,new Date(),stari,setari);
      if(r.eroare) {errors.push(`Program ${p.id}: ${r.eroare}`);await alert('parametri program invalizi',`Program ${p.id}: ${r.eroare}`);continue;}
      for(const id of Object.keys(r.dorite).map(Number)) {
        // Configuratia invalida cu suprapuneri este refuzata si in motor.
        if(covered.has(id)) {stop=true;await alert('parametri program invalizi','Programe active suprapuse');}
        covered.add(id);
      }
      jobs.push(...r.comenzi.map(c=>({...c,program:p})));
    }
    const simulareActiva=(schedules.data || []).some((p:any)=>p.activ && p.aprobat_de && p.aprobat_la && p.tip==='simulare_prezenta');
    // OFF peste toate programele, apoi ON. Nu eliberam capacitate pana la citirea OFF.
    for(const value of [false,true]) for(const cmd of jobs.filter(c=>c.stare===value).sort((a,b)=>value?0:offOrder.indexOf(a.dispozitiv_id)-offOrder.indexOf(b.dispozitiv_id))) {
      const id=cmd.dispozitiv_id,p=cmd.program;
      if(stop) break;
      if(runtime.pauze[id]>Date.now() || (value && runtime.backoff[`${p.id}:${id}`]>Date.now())) continue;
      if(value && simulareActiva && ['interior','mixt'].includes(map[id].rol)) {
        if(stari[id]===false && !onDecise.has(id) && posibilAprinse()>=2) {
          amanate.push({dispozitiv_id:id,program_id:p.id,motiv:'plafon_comun_2'});
          // Titlu stabil per pereche; iot_alerta deduplica pe 12 ore.
          const notified=await alert(`amanat program ${p.id} lumina ${id}`,`Program ${p.id}, lumina ${id}: amanat: plafon comun (2).`);
          if(notified.error) errors.push('Notificare amanare indisponibila');
          continue;
        }
        // Chiar un ON acceptat dar recitit OFF poate avea efect intarziat.
        onDecise.add(id);
      }
      const result=await send(id,value,'program',p.id);
      results.push({dispozitiv_id:id,stare:value,...result});
      if(!result.ok) errors.push(result.error || 'Comanda esuata');
    }
    return {ok:!stop && errors.length===0,comenzi:results,amanate,erori:errors};
  } catch(e) {
    await alert('eroare program',eroareTuya(e));
    return {ok:false,error:eroareTuya(e)};
  } finally {
    if(tick) for(const id of readIds) {
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
