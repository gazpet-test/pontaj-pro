// Fara dependente sau retea: node --test scripts/test_lumini_node.mjs (Node 24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soare, oraLocala, planSimulare, evalueaza, confirma, decide, parametriValizi } from '../supabase/functions/tuya/lumini_logica.ts';
import { autorizeazaLumini, citesteSwitch, eroareTuya, executaLumini } from '../supabase/functions/tuya/lumini_edge.ts';
import { dispozitiveImplicite, textStareLumina } from '../src/luminiUi.js';
import { poateSelectaLumina } from '../src/luminiUi.js';
import { readFileSync } from 'node:fs';

const settings={lat:44.94,lon:26.03,roluri:{1:'interior',2:'mixt',3:'exterior'}};
const p={id:1,tip:'solar',dispozitive:[3],activ:true,aprobat_de:'owner',aprobat_la:'2026-01-01',parametri:{}};
const now=oraLocala('2026-10-24','21:00');
test('paritate matrice rol/tip: SQL, UI si motor',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261113a_iot_programe_lumini.sql',import.meta.url),'utf8');
  const banned=[...sql.matchAll(/v_tip='([^']+)' AND l\.rol='([^']+)'/g)].map(m=>[m[1],m[2]]);
  assert.deepEqual(banned,[['simulare_prezenta','exterior'],['solar','interior']]);
  for(const tip of ['solar','orar','simulare_prezenta'])for(const rol of ['exterior','interior','mixt']){
    const allowed=!banned.some(([t,r])=>t===tip && r===rol);
    assert.equal(poateSelectaLumina({activ:true,rol},tip),allowed);
    const program={...p,tip,dispozitive:[1],parametri:tip==='orar'?{pornire:'18:00',oprire:'23:30',zile:[6]}:{}};
    const time=tip==='simulare_prezenta'?soare('2026-10-24').apus+60000:now;
    assert.equal(decide(program,time,{1:false},{roluri:{1:rol}}).length>0,allowed);
  }
});
test('NOAA: anotimpuri, Ploiesti, DST primavara/toamna',()=>{
  const summer=soare('2026-06-21'),winter=soare('2026-12-21');
  assert.ok(summer.apus-summer.rasarit>15*3600000);assert.ok(winter.apus-winter.rasarit<10*3600000);
  assert.ok(summer.rasarit>oraLocala('2026-06-21','05:00') && summer.rasarit<oraLocala('2026-06-21','06:00'));
  assert.ok(summer.apus>oraLocala('2026-06-21','20:30') && summer.apus<oraLocala('2026-06-21','21:30'));
  for(const [a,b,delta] of [['2026-03-28','2026-03-29',1],['2026-10-24','2026-10-25',-1]]){
    const x=soare(a).apus,y=soare(b).apus;
    assert.ok(Math.abs(y-x-86400000)<4*60000);
    const m=t=>{const [h,m]=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Bucharest',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t)).split(':').map(Number);return h*60+m};
    assert.ok(Math.abs(m(y)-m(x)-delta*60)<5);
  }
});
test('simulare: determinism, maxim doua, durata si pauze',()=>{
  const start=soare('2026-10-24').apus,end=oraLocala('2026-10-24','23:30');
  const plan=planSimulare('a',[1,2,4,5,6],start,end);
  assert.deepEqual(plan,planSimulare('a',[1,2,4,5,6],start,end));assert.notDeepEqual(plan,planSimulare('b',[1,2,4,5,6],start,end));
  for(const x of plan)assert.ok(x.end-x.start>=20*60000 && x.end-x.start<=90*60000);
  for(let t=start;t<end;t+=60000)assert.ok(plan.filter(x=>x.start<=t && x.end>t).length<=2);
  const groups=[...new Set(plan.map(x=>x.start))].map(t=>plan.find(x=>x.start===t));
  for(let i=1;i<groups.length;i++)assert.ok(groups[i].start-groups[i-1].end>=5*60000 && groups[i].start-groups[i-1].end<=30*60000);
});
test('simulare: weekend/vacanta/explicit, exclude exterior, sfarsit stinge',()=>{
  const sim={...p,tip:'simulare_prezenta',dispozitive:[1,2,3]},off={1:false,2:false,3:false};
  const monday=soare('2026-10-26').apus+60000;
  assert.deepEqual(decide(sim,monday,off,settings),[]);
  assert.ok(decide({...sim,parametri:{explicit:true}},monday,off,settings).length);
  assert.ok(decide(sim,monday,off,{...settings,vacanta_de:'2026-10-26',vacanta_pana:'2026-10-27'}).length);
  const r=evalueaza(sim,soare('2026-10-24').apus+60000,off,settings),on={...off};
  assert.ok(r.comenzi.length);assert.ok(r.comenzi.every(c=>c.dispozitiv_id!==3));
  for(const c of r.comenzi){on[c.dispozitiv_id]=true;confirma(r.runtime,c.dispozitiv_id,true)}
  assert.equal(evalueaza(sim,oraLocala('2026-10-24','23:30'),on,settings,r.runtime).comenzi.length,r.comenzi.length);
});
test('simularea nu aprinde o a treia lumina peste cele aprinse manual',()=>{
  const sim={...p,tip:'simulare_prezenta',dispozitive:[1,2,4,5]},s={...settings,roluri:{1:'interior',2:'mixt',4:'interior',5:'interior'}};
  const commands=decide(sim,soare('2026-10-24').apus+60000,{1:true,2:true,4:false,5:false},s);
  assert.deepEqual(commands,[]);
});
test('idempotenta, manual, cleanup, offline, pending si reaprobare',()=>{
  const first=evalueaza(p,now,{3:false},settings);assert.deepEqual(first.comenzi,[{dispozitiv_id:3,stare:true}]);confirma(first.runtime,3,true);
  assert.deepEqual(evalueaza(p,now,{3:true},settings,first.runtime).comenzi,[]);
  const manual=evalueaza(p,now,{3:false},settings,first.runtime);assert.deepEqual(manual.comenzi,[]);assert.equal(manual.runtime.lumini[3].manual,true);
  assert.equal(evalueaza(p,oraLocala('2026-10-25','21:00'),{3:false},settings,manual.runtime).comenzi.length,1);
  const inactive={...p,activ:false};assert.equal(evalueaza(inactive,now,{3:true},settings,first.runtime).comenzi[0].stare,false);
  assert.deepEqual(evalueaza(inactive,now,{3:true},settings,{}).comenzi,[]);
  const offline=evalueaza(inactive,now,{3:null},settings,first.runtime);assert.equal(offline.runtime.lumini[3].aprins,true);
  assert.equal(evalueaza(inactive,now,{3:true},settings,offline.runtime).comenzi.length,1);
  const pending=evalueaza(p,now,{3:true},settings,{fereastra:first.runtime.fereastra,lumini:{3:{aprins:false,manual:false,pending:true,pending_expira:now+600000,pending_fereastra:first.runtime.fereastra}}});
  assert.equal(pending.runtime.lumini[3].aprins,true);assert.equal(pending.runtime.lumini[3].manual,false);
  assert.equal(evalueaza({...p,aprobat_la:'nou'},now,{3:true},settings,first.runtime).comenzi[0].stare,false);
});
test('UI foloseste roluri, citire veche nu apare live',()=>{
  const lights=Object.entries(settings.roluri).map(([id,rol])=>({dispozitiv_id:+id,rol,activ:true}));
  assert.deepEqual(dispozitiveImplicite(lights,'solar'),[3]);assert.deepEqual(dispozitiveImplicite(lights,'simulare_prezenta'),[1,2]);
  assert.match(textStareLumina({pornit:true},'2020-01-01',now),/necunoscuta/);
});
function gateDb({user='u',owner=false,level='viewer',module='cladire',fail=false}={}){
  return {auth:{getUser:async()=>({data:{user:user?{id:user}:null}})},from(table){const q={select(){return q},eq(){return q},in(){return q},maybeSingle:async()=>({data:table==='profiles'?{is_owner:owner}:{access_level:level},error:fail?'error':null}),then(resolve){return Promise.resolve({data:table==='profiles'?{is_owner:owner}:[{module}],error:fail?'error':null}).then(resolve)}};return q}};
}
const req=new Request('https://local.invalid',{headers:{Authorization:'Bearer fake'}});
test('poarta reala: anon/viewer refuzati; editor/owner permisi; tick doar cron',async()=>{
  assert.equal((await autorizeazaLumini(req,gateDb({user:null}),'comanda',false)).ok,false);
  assert.equal((await autorizeazaLumini(req,gateDb(),'comanda',false)).ok,false);
  assert.equal((await autorizeazaLumini(req,gateDb({level:'editor'}),'comanda',false)).ok,true);
  assert.equal((await autorizeazaLumini(req,gateDb({level:'editor'}),'test_comanda_noop',false)).ok,false);
  assert.equal((await autorizeazaLumini(req,gateDb({owner:true}),'test_comanda_noop',false)).ok,true);
  assert.equal((await autorizeazaLumini(req,gateDb({owner:true,fail:true}),'comanda',false)).ok,false);
  assert.equal((await autorizeazaLumini(req,gateDb({owner:true}),'programe_tick',false)).ok,false);
  assert.equal((await autorizeazaLumini(req,gateDb(),'programe_tick',true)).ok,true);
  assert.equal((await autorizeazaLumini(new Request('https://local.invalid'),gateDb({owner:true}),'comanda',true)).ok,false);
});
test('cod switch real si mesaj permisiune',()=>{
  assert.equal(citesteSwitch([{code:'switch',value:true}]).code,'switch');assert.throws(()=>citesteSwitch([{code:'switch_1',value:1}]));
  assert.equal(eroareTuya(new Error('1106 permission deny')),'cheia nu are drept de comanda');
});

function deviceDb({reserve=true,journal=true}={}){
  const logs=[],rpcCalls=[];
  const db={logs,rpcCalls,rpc:async(name,args)=>{rpcCalls.push(args);return {data:{ok:args.p_actiune==='reserve'?reserve:true,runtime:{programe:{}}}}},from(table){
    let data=table==='iot_lumini'?[{dispozitiv_id:3,rol:'exterior',activ:true,iot_dispozitive:{id:3,sursa:'tuya',extern_id:'fake',activ:true}}]:table==='iot_lumini_setari'?settings:[];
    const q={select(){return q},order(){return q},eq(){return q},single(){return q},update(){return q},insert(row){logs.push(row);data=null;return q},then(resolve){return Promise.resolve({data,error:table==='iot_lumini_jurnal' && !journal?'fail':null}).then(resolve)}};return q;
  }};return db;
}
test('comanda: starea recitita, noop pe switch, esec jurnalizat, plafon fara POST',async()=>{
  let state=false;const calls=[];
  const call=async(method,path,payload)=>{calls.push({method,path,payload});if(method==='POST'){state=payload.commands[0].value;return true}return [{code:'switch',value:state}]};
  const db=deviceDb();const result=await executaLumini(db,call,{actiune:'comanda',dispozitiv_id:3,stare:true},'u');
  assert.equal(result.ok,true);assert.equal(result.stare,true);assert.equal(db.logs[0].ok,true);
  await executaLumini(db,call,{actiune:'test_comanda_noop',dispozitiv_id:3},'u');assert.equal(calls.filter(c=>c.method==='POST')[1].payload.commands[0].value,true);
  const bad=deviceDb();const rejected=await executaLumini(bad,async(method)=>{if(method==='POST')throw new Error('1106 permission deny');return [{code:'switch',value:false}]},{actiune:'comanda',dispozitiv_id:3,stare:true},'u');
  assert.equal(rejected.error,'cheia nu are drept de comanda');assert.equal(bad.logs[0].ok,false);
  const limited=deviceDb({reserve:false});let posts=0;await executaLumini(limited,async(method)=>{if(method==='POST')posts++;return [{code:'switch',value:false}]},{actiune:'comanda',dispozitiv_id:3,stare:true},'u');assert.equal(posts,0);
});
test('noop reciteste valoarea chiar daca ea se schimba intre cele doua GET-uri',async()=>{
  let reads=0,posted=null;
  const db=deviceDb();
  await executaLumini(db,async(method,path,payload)=>{
    if(method==='POST'){posted=payload.commands[0].value;return true}
    return [{code:'switch_1',value:++reads>1}];
  },{actiune:'test_comanda_noop',dispozitiv_id:3},'u');
  assert.equal(posted,true);assert.equal(db.logs[0].comanda,true);
});

// Mock durabil: snapshot-uri JSON, lease si stari comune intre cereri.
function persistentDb({schedules=[p],lights=[{id:3,rol:'exterior'}],runtime={}}={}) {
  const clone=x=>JSON.parse(JSON.stringify(x));
  const state={runtime:clone(runtime),lease:null,until:0,clock:null,reservations:[],tickN:0,offN:0,deny:false,logs:[],alerts:[],saves:[],failSave:false,failJournal:false};
  const rows=lights.map(l=>({dispozitiv_id:l.id,rol:l.rol,activ:true,iot_dispozitive:{id:l.id,sursa:'tuya',extern_id:String(l.id),activ:true,ultima_citire:{pornit:l.last??false}}}));
  const db={state,rows,schedules,auth:{getUser:async()=>({data:{user:{id:'u'}}})},async rpc(name,a){
    if(name==='iot_secret_get') return {data:a.p_name==='IOT_CRON_SECRET'?'cron-test':'tuya-test'};
    if(name==='iot_alerta'){state.alerts.push(a);return {data:true}};
    const fail=error=>({data:{ok:false,error}});
    const clock=state.clock ?? Date.now();
    if(a.p_actiune==='acquire'){
      if(state.lease && state.until>clock)return fail('Comanda/tick deja in curs');
      state.lease=a.p_token;state.until=clock+240000;state.tickN=0;state.offN=0;
      return {data:{ok:true,runtime:{programe:clone(state.runtime)}}};
    }
    if(state.lease!==a.p_token || state.until<=clock)return fail('Lease expirata');
    if(a.p_actiune==='reserve') {
      if(state.deny)return fail('Plafon comenzi atins');
      state.reservations=state.reservations.filter(t=>t>clock-3600000);
      if(a.p_date?.stare===false) {
        if(state.offN>=12)return fail('Plafon stingeri pe tick atins');
        state.offN++;
      } else {
        if(state.tickN>=12 || state.reservations.length>=40)return fail('Plafon comenzi atins');
        state.tickN++;state.reservations.push(clock);
      }
    }
    if(a.p_actiune==='refund_on' && state.tickN>0){state.reservations.pop();state.tickN--;}
    if(a.p_actiune==='save'){
      if(state.failSave)return fail('Runtime indisponibil');
      state.runtime=clone(a.p_date);state.saves.push(clone(a.p_date));
    }
    if(a.p_actiune==='release')state.lease=null;
    return {data:{ok:true}};
  },from(table){
    let data=table==='iot_lumini'?rows:table==='iot_lumini_setari'?settings:table==='iot_program_lumini'?schedules:table==='profiles'?{is_owner:false}:table==='user_module_access'?[{module:'cladire',access_level:'editor'}]:{config:{}};
    let update=null,id=null,isJournal=false;
    const q={select(){return q},eq(k,v){if(k==='id')id=v;return q},in(){return q},order(){return q},single(){return q},maybeSingle(){if(table==='user_module_access')data={access_level:'editor'};return q},update(v){update=v;return q},insert(row){isJournal=true;if(!state.failJournal)state.logs.push(clone(row));return q},then(resolve){
      if(update && table==='iot_dispozitive')Object.assign(rows.find(l=>l.dispozitiv_id===id).iot_dispozitive,update);
      return Promise.resolve({data:clone(data),error:isJournal && state.failJournal?'jurnal cazut':null}).then(resolve);
    }};return q;
  }};return db;
}
function hardware(initial={3:false}){
  const states={...initial},posts=[],offline=new Set();let effect=null;
  return {states,posts,offline,setEffect(fn){effect=fn},async call(method,path,payload){
    const id=Number(path.match(/devices\/(\d+)/)?.[1]);
    if(method==='GET'){if(offline.has(id))throw new Error('offline');return [{code:'switch_1',value:states[id]}]}
    posts.push({id,value:payload.commands[0].value});
    if(effect)return effect(id,payload.commands[0].value,states);
    states[id]=payload.commands[0].value;return true;
  }};
}
async function at(time,fn){
  const Original=globalThis.Date,stamp=typeof time==='number'?time:+new Original(time);
  globalThis.Date=class extends Original {constructor(...args){super(...(args.length?args:[stamp]))}static now(){return stamp}};
  try{return await fn()}finally{globalThis.Date=Original}
}
const tick=(db,hw)=>executaLumini(db,hw.call,{actiune:'programe_tick'},null);
const manual=(db,hw,value)=>executaLumini(db,hw.call,{actiune:'comanda',dispozitiv_id:3,stare:value},'u');

test('P1-2: OFF refuzat de plafon pastreaza proprietatea; rasaritul stinge',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();await tick(db,hw);
  assert.equal(db.state.runtime[1].lumini[3].aprins,true);
  db.state.deny=true;assert.equal((await manual(db,hw,false)).ok,false);
  assert.equal(db.state.runtime[1].lumini[3].manual,false);
  db.state.deny=false;await at(oraLocala('2026-10-25','12:00'),()=>tick(db,hw));
  assert.equal(hw.states[3],false);assert.equal(hw.posts.length,2);
}));

test('P2-5: OFF inainte de primul tick creeaza override durabil pana la fereastra urmatoare',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();await manual(db,hw,false);
  assert.equal(db.state.runtime[1].lumini[3].manual,true);
  await tick(db,hw);assert.equal(hw.states[3],false);assert.equal(hw.posts.length,1);
  await at(oraLocala('2026-10-25','21:00'),()=>tick(db,hw));assert.equal(hw.states[3],true);
}));

test('P2-6: refuz cert elimina pending; aprinderea fizica ramane externa',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();
  hw.setEffect(()=>{throw Object.assign(new Error('1106 permission deny'),{refuzCert:true})});
  await tick(db,hw);assert.equal(db.state.runtime[1].lumini[3].pending,undefined);
  assert.equal(db.state.logs[0].ok,false);
  hw.setEffect(null);hw.states[3]=true;await tick(db,hw);
  await at(oraLocala('2026-10-25','12:00'),()=>tick(db,hw));
  assert.equal(hw.states[3],true);assert.equal(hw.posts.length,1);
}));

test('P2-6: refuzul GET dupa POST acceptat pastreaza pending; nu dovedeste refuzul comenzii',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();let posted=false;
  await tick(db,{call:async(...args)=>{
    if(args[0]==='GET' && posted)throw Object.assign(new Error('1106 status indisponibil'),{refuzCert:true});
    const value=await hw.call(...args);if(args[0]==='POST')posted=true;return value;
  }});
  assert.equal(db.state.runtime[1].lumini[3].pending,true);assert.equal(hw.states[3],true);
  await tick(db,hw);assert.equal(db.state.runtime[1].lumini[3].aprins,true);
}));

test('P1-3: ON cu raspuns pierdut este numarat intre programe si intre apeluri',async()=>at(now,async()=>{
  const a={...p,tip:'orar',dispozitive:[1],parametri:{pornire:'18:00',oprire:'23:30',zile:[6]}};
  const seedId=Array.from({length:100},(_,i)=>i+2).find(id=>planSimulare(`2026-10-24:${id}`,[2,4],soare('2026-10-24').apus,oraLocala('2026-10-24','23:30')).filter(x=>now>=x.start && now<x.end).length===2);
  assert.ok(seedId,'fixture cu doua aprinderi simultane in programul B');
  const b={...p,id:seedId,tip:'simulare_prezenta',dispozitive:[2,4],parametri:{}};
  const db=persistentDb({schedules:[a,b],lights:[{id:1,rol:'interior'},{id:2,rol:'mixt'},{id:4,rol:'interior'}]}),hw=hardware({1:false,2:false,4:false});
  hw.setEffect((id,value,states)=>{states[id]=value;if(id===1){hw.offline.add(1);throw new Error('raspuns pierdut')}return true});
  await tick(db,hw);await tick(db,hw);
  assert.equal(db.state.runtime[1].lumini[1].pending,true);
  assert.ok(Object.values(hw.states).filter(Boolean).length<=2);
  assert.ok(hw.posts.some(x=>x.id!==1));
}));

test('P2-5: override in noua fereastra functioneaza si cu runtime din ziua precedenta',async()=>at(now,async()=>{
  const db=persistentDb({runtime:{1:{fereastra:'veche',lumini:{3:{aprins:true,ultima:true,manual:false}}}}}),hw=hardware({3:true});
  await manual(db,hw,false);await tick(db,hw);
  assert.equal(hw.states[3],false);assert.equal(hw.posts.length,1);
}));

test('P2-8: doua executii concurente sunt serializate de lease; expirare inaintea intentiei opreste POST',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();let unblock,entered;
  const enteredPromise=new Promise(resolve=>{entered=resolve}),blocked=new Promise(resolve=>{unblock=resolve});
  const first=tick(db,{call:async(...args)=>{entered();await blocked;return hw.call(...args)}});
  await enteredPromise;
  assert.equal((await tick(db,hw)).ok,false);assert.equal(hw.posts.length,0);
  unblock();await first;assert.equal(hw.posts.length,1);
  const expired=persistentDb(),other=hardware();expired.state.clock=0;let reads=0;
  await manual(expired,{call:async(...args)=>{if(args[0]==='GET' && ++reads===2)expired.state.clock=240001;return other.call(...args)}},true);
  assert.equal(other.posts.length,0);
}));

test('P2-4: UI elimina parametrii ascunsi ai celorlalte tipuri la salvare',async()=>{
  const {programPentruSalvare}=await import('../src/luminiUi.js');
  const form={parametri:{offset_pornire:0,offset_oprire:0,pornire:'18:00',oprire:'23:30',zile:[0],sfarsit:'23:30',explicit:false}};
  for(const tip of ['solar','orar','simulare_prezenta'])assert.equal(parametriValizi(programPentruSalvare({...form,tip})),true);
});

test('P1-3: pending ON chiar cu citire false si offline cu ultima stare true ocupa locuri',async()=>at(now,async()=>{
  for(const scenario of ['pending','offline']){
    const sim={...p,tip:'simulare_prezenta',dispozitive:[2,4],parametri:{}};
    const lights=[{id:1,rol:'interior',last:scenario==='offline'},{id:5,rol:'mixt',last:true},{id:2,rol:'interior'},{id:4,rol:'interior'}];
    const holder={...p,id:99,dispozitive:[1],tip:'orar',parametri:{pornire:'18:00',oprire:'23:30',zile:[6]}};
    const key=evalueaza(holder,now,{1:false},settings).runtime.fereastra;
    const runtime=scenario==='pending'?{99:{fereastra:key,lumini:{1:{pending:true,aprins:false,pending_expira:now+600000,pending_fereastra:key}}}}:{};
    const db=persistentDb({schedules:scenario==='pending'?[holder,sim]:[sim],lights,runtime}),hw=hardware({1:false,5:true,2:false,4:false});
    if(scenario==='offline')hw.offline.add(1);
    await tick(db,hw);assert.equal(hw.posts.length,0,scenario);
  }
}));

test('P2-4: parametri corupti activi/inactivi nu opresc cleanup sau alt program',async()=>at(now,async()=>{
  for(const active of [true,false]){
    const bad={...p,id:2,tip:'orar',activ:active,dispozitive:[1],parametri:{pornire:'18:00',oprire:'23:00',zile:[6],sfarsit:'invalid'}};
    const db=persistentDb({schedules:[bad,p],lights:[{id:1,rol:'interior'},{id:3,rol:'exterior'}],runtime:{2:{fereastra:'veche',lumini:{1:{aprins:true,ultima:true,manual:false}}}}}),hw=hardware({1:true,3:false});
    await tick(db,hw);assert.equal(hw.states[1],false);assert.equal(hw.states[3],true);
    if(active)assert.ok(db.state.alerts.some(a=>a.p_title==='Lumini sediu: parametri program invalizi'));
  }
}));

test('P2-7/8: manual si noop au intentie durabila la POST; caderea dupa POST pastreaza urma',async()=>at(now,async()=>{
  for(const action of ['comanda','test_comanda_noop']){
    const db=persistentDb(),hw=hardware();
    hw.setEffect((id,value,states)=>{
      const intent=Object.values(db.state.runtime._intentii)[0];
      assert.equal(intent.stare,'in_curs');assert.equal(intent.utilizator,'u');assert.equal(intent.dispozitiv_id,3);assert.equal(intent.valoare,value);assert.ok(intent.timp);
      states[id]=value;db.state.failSave=true;db.state.failJournal=true;throw new Error('worker intrerupt dupa POST');
    });
    await executaLumini(db,hw.call,{actiune:action,dispozitiv_id:3,stare:true},'u');
    assert.equal(Object.values(db.state.runtime._intentii)[0].stare,'in_curs');assert.equal(db.state.logs.length,0);
    db.state.failSave=false;db.state.failJournal=false;hw.setEffect(null);
    await tick(db,hw);
    assert.equal(Object.values(db.state.runtime._intentii)[0].stare,'reconciliat');
    assert.equal(hw.posts.length,action==='comanda'?1:2);
  }
}));

test('P2-8: lease concurent si expirat nu permit POST; tokenul vechi nu elibereaza succesorul',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();db.state.clock=0;
  await db.rpc('iot_lumini_runtime',{p_actiune:'acquire',p_token:'old'});
  assert.equal((await tick(db,hw)).ok,false);assert.equal(hw.posts.length,0);
  db.state.clock=240001;
  await db.rpc('iot_lumini_runtime',{p_actiune:'acquire',p_token:'new'});
  assert.equal((await db.rpc('iot_lumini_runtime',{p_actiune:'release',p_token:'old'})).data.ok,false);
  assert.equal(db.state.lease,'new');
  db.state.clock=480002;
  assert.equal((await db.rpc('iot_lumini_runtime',{p_actiune:'reserve',p_token:'new'})).data.ok,false);
  assert.equal((await tick(db,hw)).ok,true);
}));

test('P2-8: orar DST: prima ora repetata, salt inainte la ora inexistenta, ziua urmatoare normala',()=>{
  assert.equal(new Date(oraLocala('2026-10-25','03:30')).toISOString(),'2026-10-25T00:30:00.000Z');
  assert.equal(new Date(oraLocala('2027-03-28','03:30')).toISOString(),'2027-03-28T01:30:00.000Z');
  assert.equal(new Date(oraLocala('2027-03-29','03:30')).toISOString(),'2027-03-29T00:30:00.000Z');
  const schedule={...p,tip:'orar',parametri:{pornire:'03:30',oprire:'05:00',zile:[0,1]}};
  for(const [stamp,expected] of [['2026-10-25T00:29:00Z',0],['2026-10-25T00:30:00Z',1],['2026-10-25T01:30:00Z',1],['2026-10-25T03:00:00Z',0],['2027-03-28T01:29:00Z',0],['2027-03-28T01:30:00Z',1],['2027-03-29T00:30:00Z',1]])assert.equal(decide(schedule,stamp,{3:false},settings).length,expected,stamp);
  const collapsed={...schedule,parametri:{pornire:'03:30',oprire:'04:00',zile:[0]}};
  assert.deepEqual(decide(collapsed,'2027-03-28T12:00:00Z',{3:false},settings),[],'DST nu transforma o fereastra de 30 minute intr-una de aproape 24 ore');
});

test('paritate parametri: aceleasi cazuri JSON sunt evaluate de JS si de RPC in harness PG17',()=>{
  const cases=JSON.parse(readFileSync(new URL('../test-fixtures/lumini_parametri.json',import.meta.url),'utf8'));
  for(const c of cases)assert.equal(parametriValizi(c),c.valid,JSON.stringify(c));
});

// Incarcam index.ts real; inlocuim exclusiv importul npm si gazda Deno.
// Handlerul, rutarea, autorizarea si adaptorul Tuya sunt codul livrat.
test('P1-1: rutarea reala index.ts refuza array/obiect/numar/null si secretul cron pentru manual/test',async()=>{
  const {stripTypeScriptTypes}=await import('node:module');
  const db=persistentDb(),hw=hardware();let handler,fetches=0;
  const originalDeno=globalThis.Deno,originalFactory=globalThis.__luminiCreateClient,originalFetch=globalThis.fetch;
  globalThis.__luminiCreateClient=()=>db;
  globalThis.Deno={env:{get:()=> 'fake-local-only'},serve(fn){handler=fn}};
  globalThis.fetch=async(url,options)=>{
    fetches++;
    const path=new URL(url).pathname;
    const result=path==='/v1.0/token'?{access_token:'fake'}:await hw.call(options.method,path,options.body?JSON.parse(options.body):undefined);
    return new Response(JSON.stringify({success:true,result}));
  };
  try{
    let source=readFileSync(new URL('../supabase/functions/tuya/index.ts',import.meta.url),'utf8');
    source=source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';",'const createClient = globalThis.__luminiCreateClient;').replace("'./lumini_edge.ts'",JSON.stringify(new URL('../supabase/functions/tuya/lumini_edge.ts',import.meta.url).href));
    await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
    for(const action of [['programe_tick'],{toString:'programe_tick'},7,null]){
      const response=await handler(new Request('https://local.invalid',{method:'POST',headers:{'x-iot-secret':'cron-test'},body:JSON.stringify({actiune:action,dispozitiv_id:3,stare:true})}));
      assert.equal(response.status,400);assert.equal(hw.posts.length,0);assert.equal(fetches,0);
    }
    for(const action of ['comanda','test_comanda_noop']){
      const response=await handler(new Request('https://local.invalid',{method:'POST',headers:{'x-iot-secret':'cron-test'},body:JSON.stringify({actiune:action,dispozitiv_id:3,stare:true})}));
      assert.equal(response.status,401);assert.equal(fetches,0);
    }
    const response=await handler(new Request('https://local.invalid',{method:'POST',headers:{Authorization:'Bearer fake'},body:JSON.stringify({actiune:'comanda',dispozitiv_id:3,stare:true})}));
    assert.equal(response.status,200);assert.equal(hw.posts.length,1);
    // Raspunsul explicit success=false din adaptorul REAL devine refuz cert.
    globalThis.fetch=async(url,options)=>{
      const path=new URL(url).pathname;
      if(options.method==='POST')return new Response(JSON.stringify({success:false,code:1106,msg:'permission deny'}));
      return new Response(JSON.stringify({success:true,result:path==='/v1.0/token'?{access_token:'fake'}:[{code:'switch_1',value:true}]}));
    };
    const rejected=await handler(new Request('https://local.invalid',{method:'POST',headers:{Authorization:'Bearer fake'},body:JSON.stringify({actiune:'comanda',dispozitiv_id:3,stare:false})}));
    assert.equal(rejected.status,409);assert.equal(Object.values(db.state.runtime._intentii).at(-1).stare,'refuzat');
  }finally{globalThis.Deno=originalDeno;globalThis.__luminiCreateClient=originalFactory;globalThis.fetch=originalFetch}
});


test('r2 P1-A: W1 manual incert expira; ON automat W2, reconciliere si OFF final',async()=>{
  const db=persistentDb(),hw=hardware();
  await at(now,async()=>{
    hw.setEffect(()=>{throw new Error('raspuns pierdut fara efect fizic')});
    await manual(db,hw,true);
    assert.equal(Object.values(db.state.runtime._intentii)[0].stare,'incert');
  });
  hw.setEffect(null);
  await at(oraLocala('2026-10-25','21:00'),()=>tick(db,hw));
  assert.equal(hw.states[3],true);
  await at(oraLocala('2026-10-25','21:05'),()=>tick(db,hw));
  assert.equal(Object.values(db.state.runtime._intentii)[0].stare,'necunoscut');
  assert.equal(db.state.runtime[1].lumini[3].manual,false);
  await at(oraLocala('2026-10-26','12:00'),()=>tick(db,hw));
  assert.equal(hw.states[3],false);
  assert.ok(db.state.logs.some(l=>/Intentie expirata/.test(l.eroare)));
});

test('r2 P1-A: intentie neexpirata nu suspenda alta generatie aprobata',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();
  hw.setEffect(()=>{throw new Error('incert')});await manual(db,hw,true);hw.setEffect(null);
  db.schedules[0]={...p,aprobat_la:'2026-10-24T18:01:00Z'};
  await tick(db,hw);assert.equal(hw.states[3],true);
  await at(now+300000,()=>tick(db,hw));
  assert.equal(db.state.runtime[1].lumini[3].manual,false);
  await at(oraLocala('2026-10-25','12:00'),()=>tick(db,hw));
  assert.equal(hw.states[3],false);
}));

test('r2 P1-B/G: patru ON refuzate, OFF prioritar la plafon plin, patru ore de tick-uri',async()=>{
  for(const saturated of [false,true]) {
  const start=oraLocala('2026-10-24','18:00');
  const programs=[1,2,3,4].map(id=>({...p,id,tip:'orar',dispozitive:[id],parametri:{pornire:'18:00',oprire:'23:30',zile:[6]}}));
  const fifth={...p,id:5,tip:'orar',dispozitive:[5],parametri:{pornire:'17:00',oprire:'18:05',zile:[6]}};
  const owned=evalueaza(fifth,start,{5:false},{roluri:{5:'mixt'}}).runtime;confirma(owned,5,true);
  const db=persistentDb({schedules:[...programs,fifth],lights:[1,2,3,4,5].map(id=>({id,rol:'mixt'})),runtime:{5:owned}}),hw=hardware({1:false,2:false,3:false,4:false,5:true});
  const attempts=[];
  hw.setEffect((id,value,states)=>{
    attempts.push({id,value,time:Date.now()});
    if(value && id<5)throw Object.assign(new Error('1106 permission deny'),{refuzCert:true});
    states[id]=value;return true;
  });
  // Plafonul este plin din alte aprinderi, nu poate bloca OFF la 18:05.
  db.state.reservations=saturated?Array(40).fill(start):[];
  for(let t=start;t<=start+4*3600000;t+=300000) {
    await at(t,()=>tick(db,hw));
    if(t===start+300000) {
      assert.equal(hw.states[5],false,'OFF in aceeasi ora, desi ON nu mai are loc');
      assert.deepEqual(attempts.find(x=>x.time===t),{id:5,value:false,time:t},'OFF inaintea oricarui ON din tick');
    }
    assert.ok(db.state.reservations.length<=40);
  }
  assert.ok(attempts.some(x=>x.value),'rezervarile vechi expira si ON reincearca');
  for(const id of [1,2,3,4]) {
    const times=attempts.filter(x=>x.id===id).map(x=>x.time);
    assert.ok(times.length>=6);
    for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=1800000,'backoff minim 30 minute');
  }
  assert.equal(db.state.reservations.length,0,'refuzurile certe nu consuma cota altora');
  }
});

test('r2 P1-B: OFF global precede ON cu id mai mic',async()=>at(now,async()=>{
  const off={...p,id:9,activ:false,dispozitive:[9]};
  const db=persistentDb({schedules:[p,off],lights:[{id:3,rol:'exterior'},{id:9,rol:'exterior'}],runtime:{9:{fereastra:'veche',lumini:{9:{aprins:true,ultima:true,manual:false}}}}});
  const hw=hardware({3:false,9:true});await tick(db,hw);
  assert.deepEqual(hw.posts,[{id:9,value:false},{id:3,value:true}]);
}));

test('r2 P2-C/G: doua pending inactive se elibereaza imediat sau la expirare',async()=>{
  for(const deactivate of [true,false]) {
    const sim={...p,id:3,tip:'simulare_prezenta',dispozitive:[3,4],parametri:{explicit:true}};
    const holders=[1,2].map(id=>({...p,id,activ:!deactivate,tip:'orar',dispozitive:[id],parametri:{pornire:'18:00',oprire:'23:30',zile:[6]}}));
    const runtime={};
    for(const holder of holders) {
      const key=evalueaza({...holder,activ:true},now,{[holder.id]:false},{roluri:{[holder.id]:'interior'}}).runtime.fereastra;
      runtime[holder.id]={fereastra:key,lumini:{[holder.id]:{aprins:false,pending:true,pending_expira:now+600000,pending_fereastra:key}}};
    }
    const db=persistentDb({schedules:[...holders,sim],lights:[1,2,3,4].map(id=>({id,rol:'interior'})),runtime}),hw=hardware({1:false,2:false,3:false,4:false});
    if(deactivate) await at(now,async()=>{
      for(const id of [1,2]) {
        const result=await executaLumini(db,hw.call,{actiune:'comanda',dispozitiv_id:id,stare:false},'u');
        assert.equal(result.ok,true);
        assert.equal(db.state.runtime[id].lumini[id].pending,true,'OFF manual nu suspenda programele inactive; tick-ul elibereaza pending');
      }
    });
    // Programele active refuzate nu trebuie sa umple capacitatea din nou dupa expirare.
    hw.setEffect((id,value,states)=>{if(id<=2 && value)throw Object.assign(new Error('1106'),{refuzCert:true});states[id]=value;return true});
    for(let minutes=0;minutes<=15;minutes+=5) {
      await at(now+minutes*60000,()=>tick(db,hw));
      if(!deactivate && minutes<10)assert.equal(hw.posts.filter(x=>x.id>=3).length,0);
      if(deactivate || minutes>=10)assert.ok(hw.posts.some(x=>x.id>=3 && x.value));
    }
    assert.equal(db.state.runtime[1].lumini[1]?.pending,undefined);
    assert.equal(db.state.runtime[2].lumini[2]?.pending,undefined);
    assert.ok(db.state.logs.filter(x=>/Pending expirat/.test(x.eroare)).length>=2);
  }
});

test('r2 P2-D: 200 comenzi, maxim 50 terminale si toate nerezolvatele',async()=>at(now,async()=>{
  const unresolved={dispozitiv_id:3,valoare:false,sursa:'test',stare:'incert',timp:new Date().toISOString(),expira_la:now+600000,ferestre:[]};
  const db=persistentDb({schedules:[],runtime:{_intentii:{pastrata:{...unresolved,dispozitiv_id:99}}}}),hw=hardware();
  for(let i=0;i<200;i++) {
    const result=await executaLumini(db,hw.call,{actiune:'test_comanda_noop',dispozitiv_id:3},'u');
    assert.equal(result.ok,true);
  }
  const intents=Object.values(db.state.runtime._intentii);
  assert.equal(intents.filter(i=>!['in_curs','incert'].includes(i.stare)).length,50);
  assert.equal(db.state.runtime._intentii.pastrata.stare,'incert');
  assert.equal(intents.length,51);assert.equal(db.state.logs.length,200);
  assert.ok(JSON.stringify(db.state.runtime).length<20000);
}));
