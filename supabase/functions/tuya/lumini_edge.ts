import { poartaModul } from '../_shared/poartaModul.ts';
import { evalueaza, confirma } from './lumini_logica.ts';

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
  const tick = body.actiune === 'programe_tick', token = crypto.randomUUID();
  // Doua tick-uri pentru incertitudine; auditul complet ramane in jurnal.
  const TTL = 10*60000;
  const compacteaza = () => {
    const entries = Object.entries(programs._intentii || {}) as any[];
    const terminale = entries.filter(([,i])=>!['in_curs','incert'].includes(i.stare)).slice(-50);
    const keep=new Set(terminale.map(([id])=>id));
    if(entries.length) programs._intentii=Object.fromEntries(entries.filter(([id,i])=>keep.has(id) || ['in_curs','incert'].includes(i.stare)));
  };
  const rpc = async (actiune: string, date: any = {}) => {
    if(actiune==='save') compacteaza();
    const r = await db.rpc('iot_lumini_runtime',{p_actiune:actiune,p_token:token,p_date:date});
    if (r.error || !r.data?.ok) return { ok:false,error:r.error?.message || r.data?.error || 'Runtime indisponibil' };
    return r.data;
  };
  const lease = await rpc('acquire');
  if (!lease.ok) return { ok:false,error:lease.error };
  const deadline = Date.now()+75000;
  let programs: any = lease.runtime?.programe || {};
  const errors: string[] = [], results: any[] = [];
  try {
    const [lights, settings, schedules] = await Promise.all([
      db.from('iot_lumini').select('dispozitiv_id,rol,activ,iot_dispozitive!inner(id,sursa,extern_id,activ,ultima_citire)').order('dispozitiv_id'),
      db.from('iot_lumini_setari').select('*').eq('id',true).single(),
      db.from('iot_program_lumini').select('*').order('id'),
    ]);
    if (lights.error || settings.error || schedules.error) return { ok:false,error:'Configuratie lumini indisponibila' };
    const list = (lights.data || []).filter((l: any)=>l.iot_dispozitive.sursa==='tuya');
    const map = Object.fromEntries(list.map((l:any)=>[l.dispozitiv_id,l]));
    const stari: any = {}, codes: any = {};
    const settingsValue = {...settings.data,roluri:Object.fromEntries(list.filter((l:any)=>l.activ && l.iot_dispozitive.activ).map((l:any)=>[l.dispozitiv_id,l.rol]))};
    const posibilAprinse = () => list.filter((l:any)=>['interior','mixt'].includes(l.rol) && (
      stari[l.dispozitiv_id]===true || (typeof stari[l.dispozitiv_id]!=='boolean' && l.iot_dispozitive.ultima_citire?.pornit===true) ||
      Object.entries(programs).some(([key,r]:any)=>key!=='_intentii' && (r.lumini?.[l.dispozitiv_id]?.pending===true || (typeof stari[l.dispozitiv_id]!=='boolean' && r.lumini?.[l.dispozitiv_id]?.ultima===true))) ||
      Object.values(programs._intentii || {}).some((i:any)=>i.dispozitiv_id===l.dispozitiv_id && i.valoare===true && ['in_curs','incert'].includes(i.stare))
    )).map((l:any)=>l.dispozitiv_id);
    const suspenda = (intent:any) => {
      if(intent.sursa!=='manual') return;
      if(Date.now()>=intent.expira_la) return;
      for(const w of intent.ferestre) {
        const p=schedules.data.find((p:any)=>p.id===w.program_id && p.activ && p.aprobat_de && p.aprobat_la);
        if(!p || !w.fereastra || evalueaza(p,new Date(),stari,settingsValue).runtime.fereastra!==w.fereastra) continue;
        const existing=programs[w.program_id];
        if(existing?.fereastra && existing.fereastra!==w.generatie) continue;
        const state=programs[w.program_id] ||= {fereastra:w.fereastra,lumini:{}};
        state.override ||= {};
        state.override[intent.dispozitiv_id]=w.fereastra;
        state.lumini ||= {};
        state.lumini[intent.dispozitiv_id] = {...(state.lumini[intent.dispozitiv_id] || {aprins:false}),manual:true};
        delete state.lumini[intent.dispozitiv_id].pending;
      }
    };
    const read = async (id:number) => {
      const d = map[id]?.iot_dispozitive;
      if (!d) throw new Error('Dispozitivul nu este in lista de lumini Tuya');
      const s = citesteSwitch(await call('GET',`/v1.0/iot-03/devices/${encodeURIComponent(d.extern_id)}/status`));
      codes[id]=s.code; stari[id]=s.value;
      const latest={...(d.ultima_citire || {}),pornit:s.value,stare_bruta:{...(d.ultima_citire?.stare_bruta || {}),[s.code]:s.value}};
      const saved = await db.from('iot_dispozitive').update({ultima_citire:latest,citit_la:new Date().toISOString()}).eq('id',id).eq('sursa','tuya');
      if (saved.error) throw new Error('Stare citita, dar salvarea a esuat');
      d.ultima_citire=latest;
      return s.value;
    };
    const journal = async (id:number, value:boolean, sursa:string, programId:any, ok:boolean, error:string|null) => {
      const r = await db.from('iot_lumini_jurnal').insert({dispozitiv_id:id,comanda:value,sursa,program_id:programId,utilizator:userId,ok,eroare:error});
      if (r.error) {
        errors.push('Jurnal indisponibil; comenzile sunt oprite');
        await db.rpc('iot_alerta',{p_type:'error',p_title:'Lumini sediu: jurnal indisponibil',p_message:'Comenzile sunt oprite. Verificati starea fizica si runtime-ul.',p_link:'/cladire'});
        return false;
      }
      return true;
    };
    const send = async (id:number, value:boolean, sursa:string, programId:any) => {
      let err: string|null = null;
      let intent: any = null;
      let acceptedPost = false, postStarted = false;
      if (Date.now()>deadline) return {ok:false,error:'Buget timp depasit'};
      try {
        if (!map[id]?.activ || !map[id]?.iot_dispozitive.activ) throw new Error('Lumina inactiva');
        // Citire imediat inainte de comanda; detecteaza interventia manuala intre tick-uri.
        const previous = stari[id];
        await read(id);
        if (sursa==='test') value=stari[id];
        if (sursa==='program' && previous !== stari[id]) throw new Error('Stare schimbata manual inainte de comanda');
        if(value && sursa==='program' && schedules.data.find((p:any)=>p.id===programId)?.tip==='simulare_prezenta' && !posibilAprinse().includes(id) && posibilAprinse().length>=2) throw new Error('Limita de doua lumini posibil aprinse');
        const reserved = await rpc('reserve',{stare:value});
        if (!reserved.ok) { await journal(id,value,sursa,programId,false,reserved.error); return reserved; }
        if (sursa==='program') {
          const runtime=programs[programId];
          runtime.lumini[id] ||= {aprins:false,manual:false};
          runtime.lumini[id].pending=value;
          runtime.lumini[id].pending_expira=Date.now()+TTL;
          runtime.lumini[id].pending_fereastra=runtime.fereastra;
          const checkpoint=await rpc('save',programs);
          if(!checkpoint.ok) { delete runtime.lumini[id].pending; throw new Error('Runtime nesalvat; comanda refuzata'); }
        } else {
          const ferestre=(schedules.data || []).filter((p:any)=>p.activ && p.aprobat_de && p.aprobat_la && p.dispozitive.includes(id)).map((p:any)=>({program_id:p.id,fereastra:evalueaza(p,new Date(),stari,settingsValue).runtime.fereastra,generatie:programs[p.id]?.fereastra || null}));
          intent={dispozitiv_id:id,valoare:value,utilizator:userId,timp:new Date().toISOString(),expira_la:Date.now()+TTL,sursa,stare:'in_curs',ferestre};
          programs._intentii ||= {};
          programs._intentii[token]=intent;
          const checkpoint=await rpc('save',programs);
          if(!checkpoint.ok) { delete programs._intentii[token]; intent=null; throw new Error('Runtime nesalvat; comanda refuzata'); }
        }
        postStarted = true;
        const accepted = await call('POST',`/v1.0/iot-03/devices/${encodeURIComponent(map[id].iot_dispozitive.extern_id)}/commands`,{commands:[{code:codes[id],value}]});
        if (accepted !== true) throw Object.assign(new Error('Tuya nu a confirmat acceptarea comenzii'),{refuzCert:true});
        acceptedPost = true;
        const actual = await read(id);
        if (actual!==value) throw new Error('Starea recitita nu confirma comanda');
        if(intent) {
          for(const old of Object.values(programs._intentii) as any[]) if(old!==intent && old.dispozitiv_id===id && ['in_curs','incert'].includes(old.stare)) old.stare='inlocuit';
          intent.stare='reusit'; suspenda(intent);
        }
      } catch (e) {
        err=eroareTuya(e);
        const refuz = postStarted && !acceptedPost && (e as any)?.refuzCert;
        if (refuz) {
          if(value) await rpc('refund_on');
          if(sursa==='program') {
            delete programs[programId]?.lumini?.[id]?.pending;
            if(value) {
              programs[programId].refuzuri ||= {};
              programs[programId].refuzuri[id]=Date.now()+30*60000;
            }
          }
        }
        if(intent?.stare==='in_curs') intent.stare=refuz?'refuzat':'incert';
      }
      // Rezultatul si override-ul se salveaza inaintea jurnalului; intentia ramane la cadere.
      const checkpoint=await rpc('save',programs);
      if(!checkpoint.ok) err=checkpoint.error;
      const logged = await journal(id,value,sursa,programId,!err,err);
      return {ok:!err && logged,error:err || (!logged ? 'Jurnal indisponibil' : null),stare:stari[id]};
    };
    if (!tick) {
      const id = body.dispozitiv_id;
      if (!Number.isInteger(id) || !map[id]) return {ok:false,error:'Dispozitivul nu este in lista de lumini'};
      const test = body.actiune==='test_comanda_noop';
      if (!test && typeof body.stare!=='boolean') return {ok:false,error:'stare trebuie sa fie boolean'};
      let value = test ? false : body.stare;
      try { const current=await read(id); if(test) value=current; }
      catch(e) { const error=eroareTuya(e); await journal(id,value,test?'test':'manual',null,false,error); return {ok:false,error}; }
      const result = await send(id,value,test?'test':'manual',null);
      return result;
    }
    for (const l of list) {
      try { await read(l.dispozitiv_id); } catch(e) { stari[l.dispozitiv_id]=null; errors.push(eroareTuya(e)); }
    }
    for(const intent of Object.values(programs._intentii || {}) as any[]) if(['in_curs','incert'].includes(intent.stare)) {
      if(!Number.isFinite(intent.expira_la) || Date.now()>=intent.expira_la) {
        intent.stare='necunoscut';
        await journal(intent.dispozitiv_id,intent.valoare,intent.sursa,null,false,'Intentie expirata; rezultat necunoscut');
      } else if(stari[intent.dispozitiv_id]===intent.valoare) {
        suspenda(intent); intent.stare='reconciliat';
      }
    }
    // Eliberam pending-urile inaintea calculului capacitatii, inclusiv pentru inactive.
    for(const [key,runtime] of Object.entries(programs) as any[]) if(key!=='_intentii') {
      const p=schedules.data.find((p:any)=>String(p.id)===key);
      for(const [id,v] of Object.entries(runtime.lumini || {}) as any[]) if(typeof v.pending==='boolean' &&
        (!p?.activ || !p?.aprobat_de || !p?.aprobat_la || !Number.isFinite(v.pending_expira) || Date.now()>=v.pending_expira || v.pending_fereastra!==runtime.fereastra)) {
        await journal(Number(id),v.pending,'program',p?.id || null,false,'Pending expirat sau program dezactivat; rezultat necunoscut');
        delete v.pending; delete v.pending_expira; delete v.pending_fereastra;
      }
    }
    // Doua treceri: toate stingerile au prioritate, indiferent de id sau plafonul ON.
    for(const desired of [false,true]) for (const p of schedules.data || []) {
      if (Date.now()>deadline || errors.some(e=>/Jurnal|Lease|Runtime/.test(e))) break;
      const evaluated=evalueaza(p,new Date(),stari,{...settingsValue,posibilAprinse:posibilAprinse()},programs[p.id]);
      if(evaluated.eroare && !desired) {
        errors.push(`Program ${p.id}: ${evaluated.eroare}`);
        await db.rpc('iot_alerta',{p_type:'error',p_title:'Lumini sediu: parametri program invalizi',p_message:`Program ${p.id}: ${evaluated.eroare}`,p_link:'/cladire'});
      }
      programs[p.id]=evaluated.runtime;
      for(const cmd of evaluated.comenzi.filter((c:any)=>c.stare===desired)) {
        if(desired && programs[p.id].refuzuri?.[cmd.dispozitiv_id]>Date.now()) continue;
        const result=await send(cmd.dispozitiv_id,cmd.stare,'program',p.id);
        results.push({...cmd,...result});
        if(result.ok) { confirma(programs[p.id],cmd.dispozitiv_id,cmd.stare); delete programs[p.id].lumini[cmd.dispozitiv_id].pending; }
        else { errors.push(result.error || 'Comanda esuata'); if(desired || errors.some(e=>/Jurnal|Lease|Runtime/.test(e))) break; }
        const saved=await rpc('save',programs);
        if(!saved.ok) { errors.push(saved.error); break; }
      }
    }
    if(errors.length) await db.rpc('iot_alerta',{p_type:'error',p_title:'Lumini sediu: eroare program',p_message:errors.join(' | ').slice(0,1000),p_link:'/cladire'});
    return {ok:errors.length===0,comenzi:results,erori:errors};
  } catch(e) {
    // Erori business: return + jurnal, fara rethrow spre catch-ul integrarii.
    await db.rpc('iot_alerta',{p_type:'error',p_title:'Lumini sediu: eroare program',p_message:eroareTuya(e),p_link:'/cladire'});
    return {ok:false,error:eroareTuya(e)};
  } finally {
    const saved=await rpc('save',programs);
    if(!saved.ok) await db.rpc('iot_alerta',{p_type:'error',p_title:'Lumini sediu: runtime nesalvat',p_message:'Automatizarea necesita verificare manuala.',p_link:'/cladire'});
    await rpc('release');
  }
}
