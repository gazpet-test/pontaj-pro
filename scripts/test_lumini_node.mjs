// Fara dependente sau retea: node --test scripts/test_lumini_node.mjs (Node 24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soare, oraLocala, planSimulare, evalueaza, decide, parametriValizi } from '../supabase/functions/tuya/lumini_logica.ts';
import { autorizeazaLumini, citesteSwitch, eroareTuya, executaLumini } from '../supabase/functions/tuya/lumini_edge.ts';
import { dispozitiveImplicite, textStareLumina } from '../src/luminiUi.js';
import { poateSelectaLumina, setariSchimbaProgramarea, textAmanareLumini } from '../src/luminiUi.js';
import { readFileSync } from 'node:fs';

const settings={lat:44.94,lon:26.03,roluri:{1:'interior',2:'mixt',3:'exterior'}};
const p={id:1,tip:'solar',dispozitive:[3],activ:true,aprobat_de:'owner',aprobat_la:'2026-01-01',parametri:{}};
const now=oraLocala('2026-10-24','21:00');

test('r6: URL cron simplu HTTPS, fara markdown sau paranteze patrate',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261113a_iot_programe_lumini.sql',import.meta.url),'utf8');
  const urls=[...sql.matchAll(/net\.http_post\(url:='([^']+)'/g)].map(m=>m[1]);
  assert.equal(urls.length,1);
  assert.match(urls[0],/^https:\/\/[^\s[\]()]+\/functions\/v1\/tuya$/);
  assert.doesNotMatch(urls[0],/[\[\]()]/);
});
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

// Mock durabil: snapshot-uri JSON, lease si stari comune intre cereri.
function persistentDb({schedules=[p],lights=[{id:3,rol:'exterior'}],runtime={}}={}) {
  const clone=x=>JSON.parse(JSON.stringify(x));
  const state={runtime:clone(runtime),lease:null,until:0,clock:null,reservations:[],tickN:0,offN:0,deny:false,logs:[],alerts:[],saves:[],failSave:false,failJournal:false};
  const rows=lights.map(l=>({dispozitiv_id:l.id,rol:l.rol,activ:true,iot_dispozitive:{id:l.id,sursa:'tuya',extern_id:String(l.id),activ:true,ultima_citire:{pornit:l.last??false}}}));
  const db={settings:{...settings,pauza_ore:3},state,rows,schedules,auth:{getUser:async()=>({data:{user:{id:'u'}}})},async rpc(name,a){
    if(name==='iot_secret_get') return {data:a.p_name==='IOT_CRON_SECRET'?'cron-test':'tuya-test'};
    if(name==='iot_alerta'){if(!state.alerts.some(x=>x.p_type===a.p_type && x.p_title===a.p_title && x.created_at>Date.now()-12*3600000))state.alerts.push({...a,created_at:Date.now()});return {data:true}};
    const fail=error=>({data:{ok:false,error}});
    const clock=state.clock ?? Date.now();
    if(a.p_actiune==='acquire'){
      if(state.lease && state.until>clock)return fail('Comanda/tick deja in curs');
      state.lease=a.p_token;state.until=clock+240000;state.tickN=0;state.offN=0;
      return {data:{ok:true,runtime:{motor:clone(state.runtime)}}};
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
    let data=table==='iot_lumini'?rows:table==='iot_lumini_setari'?db.settings:table==='iot_program_lumini'?schedules:table==='profiles'?{is_owner:false}:table==='user_module_access'?[{module:'cladire',access_level:'editor'}]:{config:{}};
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
  const Original=globalThis.Date;let stamp=typeof time==='number'?time:+new Original(time);
  globalThis.Date=class extends Original {constructor(...args){super(...(args.length?args:[stamp]))}static now(){return stamp}};
  try{return await fn(ms=>{stamp+=ms})}finally{globalThis.Date=Original}
}
const tick=(db,hw)=>executaLumini(db,hw.call,{actiune:'programe_tick'},null);
const manual=(db,hw,value)=>executaLumini(db,hw.call,{actiune:'comanda',dispozitiv_id:3,stare:value},'u');

test('r5 P2: ON fara program ocupa plafonul; amanare vizibila si notificare deduplicata',async()=>{
  for(const tip of ['orar','solar']) {
    const sim={...p,id:10,tip:'simulare_prezenta',dispozitive:[4],parametri:{}};
    const target={...p,id:20,tip,dispozitive:[3],parametri:tip==='orar'?{pornire:'16:00',oprire:'23:30',zile:[6]}:{}};
    const db=persistentDb({schedules:[sim,target],lights:[{id:1,rol:'interior'},{id:2,rol:'mixt'},{id:3,rol:'mixt'},{id:4,rol:'interior'}]});
    const hw=hardware({1:true,2:true,3:false,4:false});
    const expected={dispozitiv_id:3,program_id:20,motiv:'plafon_comun_2'};
    for(let i=0;i<3;i++)await at(soare('2026-10-24').apus+60000+i*300000,async()=>{
      const result=await tick(db,hw);
      assert.ok(result.amanate.some(a=>JSON.stringify(a)===JSON.stringify(expected)));
      assert.equal(result.comenzi.some(c=>c.dispozitiv_id===3),false);
      const setari={runtime:{motor:db.state.runtime}};
      assert.equal(textAmanareLumini(setari,3),'amanat: plafon comun');
      assert.equal(textAmanareLumini(setari,null,20),'amanat: plafon comun');
      assert.equal(textAmanareLumini(setari,1),'');
    });
    assert.equal(hw.posts.some(c=>c.id===3),false);
    assert.equal(db.state.alerts.filter(a=>a.p_title==='Lumini sediu: amanat program 20 lumina 3').length,1);
    hw.states[1]=false;hw.states[2]=false;
    db.schedules[0].activ=false;
    await at(hour('21:00'),()=>tick(db,hw));
    assert.equal(hw.states[3],true);assert.deepEqual(db.state.runtime.amanate,[]);
    assert.equal(textAmanareLumini({runtime:{motor:db.state.runtime}},3),'');
  }
});

test('r5 P3c: plafon ocupat permite OFF si ON exterior in acelasi tick',async()=>{
  const sim={...p,id:10,tip:'simulare_prezenta',dispozitive:[4],parametri:{}};
  const db=persistentDb({schedules:[sim,{...p,id:20,dispozitive:[3]},{...p,id:30,dispozitive:[5],tip:'orar',parametri:{pornire:'12:00',oprire:'16:00',zile:[6]}}],lights:[1,2,3,4,5].map(id=>({id,rol:id===3?'exterior':'interior'}))});
  const hw=hardware({1:true,2:true,3:false,4:false,5:true});
  await at(hour('21:00'),()=>tick(db,hw));
  assert.deepEqual(hw.posts,[{id:5,value:false},{id:3,value:true}]);
});

test('r5 P3b: lista activa schimbata, apoi stabila; rotirea OFF ajunge la fiecare lumina',async()=>{
  const ids=[1,2,3,4,5,6];
  const db=persistentDb({lights:ids.map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:ids}]});
  const hw=hardware(Object.fromEntries(ids.map(id=>[id,true])));
  // Un singur POST incape pe tick; starea ramane ON pentru a verifica echitatea.
  hw.setEffect(()=>true);
  const run=async n=>at(hour('12:00')+n*300000,async advance=>{
    await executaLumini(db,async(...args)=>{const r=await hw.call(...args);if(args[0]==='POST')advance(76000);return r},{actiune:'programe_tick'},null);
  });
  await run(0);db.rows[0].activ=false;db.rows[4].activ=false;
  await run(1);db.rows[0].activ=true;db.rows[4].activ=true;db.rows[2].activ=false;
  const start=hw.posts.length;
  for(let n=2;n<7;n++)await run(n);
  assert.deepEqual([...new Set(hw.posts.slice(start).map(c=>c.id))].sort(),[1,2,4,5,6]);
});

test('r5 P3d: fixture-uri setari comune cu RPC SQL',()=>{
  const cases=JSON.parse(readFileSync(new URL('../test-fixtures/lumini_setari.json',import.meta.url),'utf8'));
  for(const c of cases)assert.equal(setariSchimbaProgramarea(c.initial,c.salvat),c.schimba,c.nume);
});

test('r4 P1: timpul avanseaza in tick; OFF lent nu exclude permanent ultimele lumini',async()=>{
  const ids=[1,2,3,4,5,6];
  const db=persistentDb({lights:ids.map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:ids}]});
  const hw=hardware(Object.fromEntries(ids.map(id=>[id,true])));
  const durations=[];
  for(let n=0;n<3;n++) await at(oraLocala('2026-10-24','12:00')+n*300000,async advance=>{
    const start=Date.now();let initialReads=0;
    const call=async(method,path,payload)=>{
      const id=Number(path.match(/devices\/(\d+)/)?.[1]);
      if(method==='GET' && initialReads<6) {
        // Token 9s + citirea initiala paralela 9s, o singura durata comuna.
        if(initialReads++===0)advance(18000);
      } else if(id<=4)advance(9000);
      return hw.call(method,path,payload);
    };
    hw.setEffect((id,value,states)=>{if(id>4)states[id]=value;return true});
    await executaLumini(db,call,{actiune:'programe_tick'},null);
    durations.push(Date.now()-start);
    if(n===0) {
      assert.deepEqual(hw.posts.map(x=>x.id),[1,2,3,4]);
      assert.equal(hw.states[5],true);assert.equal(hw.states[6],true);
    }
  });
  assert.ok(durations[0]>75000,'mock-ul trebuie sa epuizeze efectiv bugetul');
  assert.deepEqual([...new Set(hw.posts.filter(x=>!x.value).map(x=>x.id))].sort(),ids);
  assert.equal(hw.states[5],false);assert.equal(hw.states[6],false);
  assert.equal(db.state.runtime.off_offset,3);
});

test('r4 P2-2: plafon comun pentru orar/simulare in ambele ordini, inclusiv ON nerecitit',async()=>{
  const time=soare('2026-10-24').apus+60000;
  for(const simFirst of [true,false])for(const delayed of [false,true]) {
    const sim={...p,id:simFirst?1:2,tip:'simulare_prezenta',dispozitive:[2],parametri:{}};
    const orar={...p,id:simFirst?2:1,tip:'orar',dispozitive:[3],parametri:{pornire:'16:00',oprire:'23:30',zile:[6]}};
    const db=persistentDb({lights:[1,2,3].map(id=>({id,rol:'interior'})),schedules:[sim,orar].sort((a,b)=>a.id-b.id)});
    const hw=hardware({1:false,2:false,3:false});hw.offline.add(1);
    if(delayed)hw.setEffect(()=>true);
    await at(time,()=>tick(db,hw));
    assert.equal(hw.posts.filter(x=>x.value).length,1);
    assert.equal(hw.posts[0].id,simFirst?2:3);
    assert.ok(Object.values(hw.states).filter(Boolean).length+1<=2);
  }
});

test('r4 P2-1: handler real, sase citiri folosesc o singura promisiune token, inclusiv esec',async()=>{
  const {stripTypeScriptTypes}=await import('node:module');
  const db=persistentDb({lights:[1,2,3,4,5,6].map(id=>({id,rol:'exterior'})),schedules:[]});
  let handler,tokens=0,statusReads=0,rejectToken=false;
  const originalDeno=globalThis.Deno,originalFactory=globalThis.__luminiCreateClient,originalFetch=globalThis.fetch;
  globalThis.__luminiCreateClient=()=>db;
  globalThis.Deno={env:{get:()=> 'fake-local-only'},serve(fn){handler=fn}};
  globalThis.fetch=async url=>{
    if(new URL(url).pathname==='/v1.0/token') {
      tokens++;await Promise.resolve();
      return new Response(JSON.stringify(rejectToken?{success:false,code:1106}:{success:true,result:{access_token:'fake'}}));
    }
    statusReads++;return new Response(JSON.stringify({success:true,result:[{code:'switch_1',value:false}]}));
  };
  try {
    let source=readFileSync(new URL('../supabase/functions/tuya/index.ts',import.meta.url),'utf8');
    source=source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';",'const createClient = globalThis.__luminiCreateClient;').replace("'./lumini_edge.ts'",JSON.stringify(new URL('../supabase/functions/tuya/lumini_edge.ts',import.meta.url).href));
    await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+'\n// r4 token test').toString('base64'));
    const request=()=>new Request('https://local.invalid',{method:'POST',headers:{'x-iot-secret':'cron-test'},body:JSON.stringify({actiune:'programe_tick'})});
    assert.equal((await handler(request())).status,200);
    assert.equal(tokens,1);assert.equal(statusReads,6);
    tokens=0;statusReads=0;rejectToken=true;
    assert.equal((await handler(request())).status,409);
    assert.equal(tokens,1);assert.equal(statusReads,0);
    assert.equal(db.state.logs.filter(x=>x.eroare?.includes('Citire esuata')).length,6);
    rejectToken=false;
    assert.equal((await handler(request())).status,200);
    assert.equal(tokens,2);assert.equal(statusReads,6);
  } finally {globalThis.Deno=originalDeno;globalThis.__luminiCreateClient=originalFactory;globalThis.fetch=originalFetch}
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
    assert.equal(rejected.status,409);assert.equal(db.state.logs.at(-1).ok,false);assert.ok(db.state.runtime.pauze[3]>Date.now());
  }finally{globalThis.Deno=originalDeno;globalThis.__luminiCreateClient=originalFactory;globalThis.fetch=originalFetch}
});


// Tick-uri reale simulate la 5 minute; hardware-ul si runtime-ul raman intre cereri.
const everyDay={...p,tip:'orar',parametri:{pornire:'18:00',oprire:'20:00',zile:[0,1,2,3,4,5,6]}};
const hour=(time)=>oraLocala('2026-10-24',time);
async function ticks(db,hw,start,end){for(let t=start;t<=end;t+=300000)await at(t,()=>tick(db,hw));}

test('r3 P1-1: ON executat, 3 citiri lipsa, apoi OFF fara proprietate',async()=>{
  for(const failAtEnd of [false,true]) {
    const db=persistentDb({schedules:[everyDay]}),hw=hardware();let first=true;
    hw.setEffect((id,value,states)=>{states[id]=value;if(first){first=false;hw.offline.add(id);}return true});
    await at(hour('18:00'),()=>tick(db,hw));
    assert.equal(hw.states[3],true);
    await ticks(db,hw,hour('18:05'),hour('18:10'));
    assert.equal(hw.posts.length,1);
    assert.equal(db.state.runtime.citiri_esuate[3],3);
    assert.ok(db.state.alerts.some(a=>a.p_title==='Lumini sediu: citiri repetate esuate'));
    hw.offline.clear();await ticks(db,hw,hour('18:15'),hour('19:55'));
    assert.equal(db.state.runtime.citiri_esuate[3],undefined);
    if(failAtEnd)hw.offline.add(3);
    await at(hour('20:00'),()=>tick(db,hw));
    assert.equal(hw.states[3],failAtEnd);
    hw.offline.clear();await at(hour('20:05'),()=>tick(db,hw));
    assert.equal(hw.states[3],false);assert.deepEqual(hw.posts,[{id:3,value:true},{id:3,value:false}]);
    assert.deepEqual(Object.keys(db.state.runtime).sort(),['amanate','backoff','citiri_esuate','off_offset','pauze']);
  }
});

test('r3 P1-1: program dezactivat sau sters scoate lumina din acoperire',async()=>{
  for(const deleted of [false,true]) {
    const db=persistentDb({schedules:[structuredClone(everyDay)]}),hw=hardware();
    await at(hour('18:00'),()=>tick(db,hw));
    if(deleted)db.schedules.splice(0);else db.schedules[0].activ=false;
    await ticks(db,hw,hour('18:05'),hour('21:00'));
    assert.equal(hw.states[3],true);assert.equal(hw.posts.length,1);
  }
});

test('r3 P1-2/r2 P1-A: manual incert, expirare pauza, ON automat in aceeasi fereastra si OFF',async()=>{
  for(const hours of [0.25,3]) {
    const db=persistentDb({schedules:[everyDay]}),hw=hardware();db.settings.pauza_ore=hours;
    hw.setEffect(()=>{throw new Error('raspuns pierdut fara efect')});
    await at(hour('18:00'),()=>manual(db,hw,true));
    assert.equal(db.state.runtime.pauze[3],hour('18:00')+hours*3600000);
    hw.setEffect(null);await ticks(db,hw,hour('18:05'),hour('19:55'));
    if(hours<1)assert.equal(hw.states[3],true);else {
      assert.equal(hw.states[3],false);
      hw.states[3]=true; // interventie fizica in pauza lunga
    }
    await at(hour('20:00'),()=>tick(db,hw));
    assert.equal(hw.states[3],hours>2,'pauza lunga protejeaza pana la termen');
    await ticks(db,hw,hour('20:05'),hour('21:05'));
    assert.equal(hw.states[3],false);
  }
});

test('r2 P1-A: pauza W1 nu se transfera ferestrei W2',async()=>{
  const db=persistentDb({schedules:[everyDay]}),hw=hardware();db.settings.pauza_ore=0.25;
  hw.setEffect(()=>{throw new Error('incert')});await at(hour('19:55'),()=>manual(db,hw,true));hw.setEffect(null);
  const tomorrow=t=>oraLocala('2026-10-25',t);
  await ticks(db,hw,tomorrow('18:00'),tomorrow('20:05'));
  assert.equal(hw.states[3],false);assert.deepEqual(hw.posts.slice(-2),[{id:3,value:true},{id:3,value:false}]);
});

test('r1 P1-2/P2-5: pauza manuala persista si la plafon/refuz, inainte de primul tick',async()=>{
  const db=persistentDb({schedules:[everyDay]}),hw=hardware();db.settings.pauza_ore=0.25;
  await at(hour('18:00'),()=>manual(db,hw,false)); // deja OFF: zero POST
  assert.equal(hw.posts.length,0);await at(hour('18:05'),()=>tick(db,hw));assert.equal(hw.posts.length,0);
  await at(hour('18:15'),()=>tick(db,hw));assert.equal(hw.states[3],true);
  db.state.deny=true;
  await at(hour('18:20'),()=>manual(db,hw,false));assert.equal(hw.states[3],true);
  assert.equal(db.state.runtime.pauze[3],hour('18:35'));
  db.state.deny=false;await ticks(db,hw,hour('18:25'),hour('20:00'));assert.equal(hw.states[3],false);
});

test('r2 P2-D/r3: 200 OFF manuale deja stinse => zero POST si runtime marginit',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();
  for(let i=0;i<200;i++)assert.equal((await manual(db,hw,false)).ok,true);
  assert.equal(hw.posts.length,0);assert.equal(db.state.logs.length,200);
  assert.equal(Object.keys(db.state.runtime.pauze).length,1);assert.ok(JSON.stringify(db.state.runtime).length<200);
}));

test('r2 P1-B: patru ON refuzate cu backoff fix; OFF prioritar chiar la 40 ON/ora',async()=>{
  for(const full of [false,true]) {
    const start=hour('18:00');
    const schedules=[1,2,3,4].map(id=>({...everyDay,id,dispozitive:[id]}));
    schedules.push({...everyDay,id:9,dispozitive:[9],parametri:{...everyDay.parametri,oprire:'18:05'}});
    const db=persistentDb({schedules,lights:[1,2,3,4,9].map(id=>({id,rol:'mixt'}))}),hw=hardware({1:false,2:false,3:false,4:false,9:true});
    db.state.reservations=full?Array(40).fill(start):[];
    const attempts=[];
    hw.setEffect((id,value,states)=>{attempts.push({id,value,t:Date.now()});if(value)throw Object.assign(new Error('1106 permission deny'),{refuzCert:true});states[id]=value;return true});
    for(let t=start;t<=start+4*3600000;t+=300000) {
      await at(t,()=>tick(db,hw));
      if(t===start+300000) {
        assert.equal(hw.states[9],false);
        assert.equal(attempts.find(x=>x.t===t).value,false);
      }
      assert.ok(db.state.reservations.length<=40);
    }
    for(const id of [1,2,3,4]) {
      const times=attempts.filter(x=>x.id===id).map(x=>x.t);assert.ok(times.length>=2);
      for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]>=1800000);
    }
  }
});

test('r1 P1-3: ON fara raspuns ocupa loc in tick; citirile necunoscute ocupa loc indiferent de ultima stare',async()=>{
  const start=soare('2026-10-24').apus+60000;
  const sim={...p,tip:'simulare_prezenta',dispozitive:[2,4],parametri:{}};
  for(const unknown of [1,2]) {
    const db=persistentDb({schedules:[sim],lights:[1,2,4,5].map(id=>({id,rol:'interior',last:false}))}),hw=hardware({1:false,2:false,4:false,5:false});
    hw.offline.add(1);if(unknown===2)hw.offline.add(5);
    await at(start,()=>tick(db,hw));
    assert.ok(hw.posts.filter(x=>x.value).length<=2-unknown);
  }
  const seedId=Array.from({length:100},(_,i)=>i+2).find(id=>planSimulare(`2026-10-24:${id}`,[2,4],soare('2026-10-24').apus,hour('23:30')).filter(x=>start>=x.start && start<x.end).length===2);
  const db=persistentDb({schedules:[{...everyDay,dispozitive:[1]},{...sim,id:seedId}],lights:[1,2,4].map(id=>({id,rol:'interior'}))}),hw=hardware({1:false,2:false,4:false});
  hw.setEffect((id,value,states)=>{states[id]=value;if(id===1) {hw.offline.add(1);throw new Error('raspuns pierdut')}return true});
  await at(hour('18:00'),()=>tick(db,hw));
  assert.ok(Object.values(hw.states).filter(Boolean).length<=2);
});

test('r2 P2-C: programele inactive nu pastreaza capacitate fictiva; lumina reala aprinsa conteaza',async()=>{
  const start=soare('2026-10-24').apus+60000;
  const sim={...p,tip:'simulare_prezenta',dispozitive:[2,4],parametri:{}};
  const db=persistentDb({schedules:[{...everyDay,id:2,activ:false,dispozitive:[1,5]},sim],lights:[1,2,4,5].map(id=>({id,rol:'interior'}))}),hw=hardware({1:false,2:false,4:false,5:false});
  await at(start,()=>tick(db,hw));assert.ok(hw.posts.some(x=>x.value));
  hw.posts.length=0;hw.states[1]=true;hw.states[5]=true;hw.states[2]=false;hw.states[4]=false;
  await at(start+300000,()=>tick(db,hw));assert.equal(hw.posts.filter(x=>x.value).length,0);
});

test('r1 P2-4: configuratie invalida izolata; programul valid converge',async()=>at(now,async()=>{
  for(const activ of [false,true]) {
    const bad={...everyDay,id:2,activ,dispozitive:[1],parametri:{...everyDay.parametri,sfarsit:'invalid'}};
    const db=persistentDb({schedules:[bad,p],lights:[{id:1,rol:'interior'},{id:3,rol:'exterior'}]}),hw=hardware({1:true,3:false});
    await tick(db,hw);assert.equal(hw.states[3],true);assert.equal(hw.states[1],true);
    if(activ)assert.ok(db.state.alerts.some(a=>a.p_title==='Lumini sediu: parametri program invalizi'));
  }
}));

test('r1 P2-6: refuz cert creeaza doar backoff ON; aprinderea fizica va fi stinsa la final',async()=>{
  const db=persistentDb({schedules:[everyDay]}),hw=hardware();
  hw.setEffect(()=>{throw Object.assign(new Error('1106'),{refuzCert:true})});
  await at(hour('18:00'),()=>tick(db,hw));assert.equal(db.state.runtime.backoff['1:3'],hour('18:30'));
  hw.setEffect(null);hw.states[3]=true;
  await ticks(db,hw,hour('18:05'),hour('20:00'));assert.equal(hw.states[3],false);
});

test('r1 P2-7/8: audit pre-POST si pauza durabila; caderea dupa POST nu lasa proprietate',async()=>{
  for(const action of ['comanda','test_comanda_noop'])await at(hour('18:00'),async()=>{
    const db=persistentDb({schedules:[everyDay]}),hw=hardware();db.settings.pauza_ore=0.25;
    hw.setEffect((id,value,states)=>{
      assert.ok(db.state.logs.some(l=>/POST urmeaza/.test(l.eroare)));
      if(action==='comanda')assert.equal(db.state.runtime.pauze[id],hour('18:15'));
      states[id]=value;db.state.failJournal=true;throw new Error('worker intrerupt');
    });
    await executaLumini(db,hw.call,{actiune:action,dispozitiv_id:3,stare:true},'u');
    db.state.failJournal=false;hw.setEffect(null);hw.states[3]=true;
    await at(hour('20:00'),()=>tick(db,hw));assert.equal(hw.states[3],false);
  });
});

test('r1 P2-8: concurenta/expirare lease nu permit POST si tokenul vechi nu elibereaza succesorul',async()=>at(now,async()=>{
  const db=persistentDb(),hw=hardware();let entered,unblock;
  const ready=new Promise(r=>entered=r),blocked=new Promise(r=>unblock=r);
  const first=tick(db,{call:async(...args)=>{entered();await blocked;return hw.call(...args)}});
  await ready;assert.equal((await tick(db,hw)).ok,false);assert.equal(hw.posts.length,0);unblock();await first;
  assert.equal(hw.posts.length,1);
  const expired=persistentDb(),other=hardware();expired.state.clock=0;
  await manual(expired,{call:async(...args)=>{const value=await other.call(...args);expired.state.clock=240001;return value}},true);
  assert.equal(other.posts.length,0);
  expired.state.clock=480002;
  await expired.rpc('iot_lumini_runtime',{p_actiune:'acquire',p_token:'new'});
  assert.equal((await expired.rpc('iot_lumini_runtime',{p_actiune:'release',p_token:'old'})).data.ok,false);
  assert.equal(expired.state.lease,'new');
}));

test('pauza nesalvata sau jurnal indisponibil refuza POST; testul noop foloseste starea reala',async()=>at(now,async()=>{
  for(const mode of ['failSave','failJournal']) {
    const db=persistentDb(),hw=hardware();db.state[mode]=true;await manual(db,hw,true);assert.equal(hw.posts.length,0);
  }
  const db=persistentDb(),hw=hardware({3:true});
  assert.equal((await executaLumini(db,hw.call,{actiune:'test_comanda_noop',dispozitiv_id:3},'u')).ok,true);
  assert.deepEqual(hw.posts,[{id:3,value:true}]);assert.deepEqual(db.state.runtime.pauze,{});
}));

test('DST: 25.10.2026, 28.03.2027 si 29.03.2027; intervale locale corecte',()=>{
  assert.equal(new Date(oraLocala('2026-10-25','03:30')).toISOString(),'2026-10-25T00:30:00.000Z');
  assert.equal(new Date(oraLocala('2027-03-28','03:30')).toISOString(),'2027-03-28T01:30:00.000Z');
  assert.equal(new Date(oraLocala('2027-03-29','03:30')).toISOString(),'2027-03-29T00:30:00.000Z');
  const schedule={...everyDay,parametri:{pornire:'03:30',oprire:'05:00',zile:[0,1]}};
  for(const [stamp,expected] of [['2026-10-25T00:29:00Z',false],['2026-10-25T00:30:00Z',true],['2026-10-25T01:30:00Z',true],['2026-10-25T03:00:00Z',false],['2027-03-28T01:29:00Z',false],['2027-03-28T01:30:00Z',true],['2027-03-29T00:30:00Z',true]]) {
    assert.equal(evalueaza(schedule,stamp,{3:false},settings).dorite[3],expected,stamp);
  }
  const collapsed={...schedule,parametri:{pornire:'03:30',oprire:'04:00',zile:[0]}};
  assert.deepEqual(decide(collapsed,'2027-03-28T12:00:00Z',{3:false},settings),[]);
});

test('simulare weekend/vacanta/explicit si paritate parametri JS/RPC',()=>{
  const sim={...p,tip:'simulare_prezenta',dispozitive:[1,2,3]},off={1:false,2:false,3:false};
  const monday=soare('2026-10-26').apus+60000;
  assert.deepEqual(decide(sim,monday,off,settings),[]);
  assert.ok(decide({...sim,parametri:{explicit:true}},monday,off,settings).length);
  assert.ok(decide(sim,monday,off,{...settings,vacanta_de:'2026-10-26',vacanta_pana:'2026-10-27'}).length);
  const cases=JSON.parse(readFileSync(new URL('../test-fixtures/lumini_parametri.json',import.meta.url),'utf8'));
  for(const c of cases)assert.equal(parametriValizi(c),c.valid,JSON.stringify(c));
});
test('OFF global precede ON indiferent de id; OFF deja citit nu se repeta',async()=>at(now,async()=>{
  const off={...everyDay,id:9,dispozitive:[9]}; // la 21:00 este in afara ferestrei
  const db=persistentDb({schedules:[p,off],lights:[{id:3,rol:'exterior'},{id:9,rol:'interior'}]}),hw=hardware({3:false,9:true});
  await tick(db,hw);assert.deepEqual(hw.posts,[{id:9,value:false},{id:3,value:true}]);
  await at(now+300000,()=>tick(db,hw));assert.equal(hw.posts.length,2);
}));

test('simulare: tick-uri de 5 minute, necunoscute numarate ON; locurile se elibereaza doar prin citire',async()=>{
  const start=soare('2026-10-24').apus+60000;
  const sim={...p,tip:'simulare_prezenta',dispozitive:[2,4,6],parametri:{}};
  const lights=[1,2,4,5,6].map(id=>({id,rol:id===5?'mixt':'interior',last:false}));
  const db=persistentDb({schedules:[sim],lights}),hw=hardware({1:false,2:false,4:false,5:false,6:false});
  hw.offline.add(1);hw.offline.add(5);let hadOn=false;
  for(let t=start;t<hour('23:40');t+=300000) {
    if(t>=start+30*60000)hw.offline.delete(5);
    await at(t,()=>tick(db,hw));
    const occupied=lights.filter(l=>hw.offline.has(l.id) || hw.states[l.id]===true).length;
    assert.ok(occupied<=2,`${new Date(t).toISOString()}: ${occupied}`);
    if(t<start+30*60000)assert.equal(hw.posts.length,0);
    hadOn ||= hw.posts.some(x=>x.value);
  }
  assert.ok(hadOn);assert.equal(hw.states[2],false);assert.equal(hw.states[4],false);assert.equal(hw.states[6],false);
});

test('ON fara raspuns nu permite alte doua ON in acelasi tick sau urmatorul',async()=>{
  const start=hour('21:00');
  const id=Array.from({length:100},(_,i)=>i+2).find(id=>planSimulare(`2026-10-24:${id}`,[2,4],soare('2026-10-24').apus,hour('23:30')).filter(x=>start>=x.start && start<x.end).length===2);
  assert.ok(id);
  const sim={...p,id,tip:'simulare_prezenta',dispozitive:[2,4],parametri:{}};
  const db=persistentDb({schedules:[{...everyDay,parametri:{...everyDay.parametri,oprire:'23:00'},dispozitive:[1]},sim],lights:[1,2,4].map(id=>({id,rol:'interior'}))}),hw=hardware({1:false,2:false,4:false});
  hw.setEffect((id,value,states)=>{states[id]=value;if(id===1) {hw.offline.add(1);throw new Error('timeout POST')}return true});
  await at(start,()=>tick(db,hw));
  assert.equal(Object.values(hw.states).filter(Boolean).length,2);
  assert.equal(hw.posts.filter(x=>x.id!==1 && x.value).length,1);
  await at(start+300000,()=>tick(db,hw));
  assert.ok(Object.values(hw.states).filter(Boolean).length<=2);
});

test('manual incert cu efect fizic: pauza scurta/lunga, stingere dupa fereastra si expirare',async()=>{
  for(const hours of [0.25,3]) {
    const db=persistentDb({schedules:[everyDay]}),hw=hardware();db.settings.pauza_ore=hours;
    hw.setEffect((id,value,states)=>{assert.equal(db.state.runtime.pauze[id],hour('18:00')+hours*3600000);states[id]=value;throw new Error('POST executat, raspuns pierdut')});
    await at(hour('18:00'),()=>manual(db,hw,true));hw.setEffect(null);
    await ticks(db,hw,hour('18:05'),hour('20:00'));
    assert.equal(hw.states[3],hours>2);
    await ticks(db,hw,hour('20:05'),hour('21:05'));assert.equal(hw.states[3],false);
  }
});

test('citirea de dupa POST esueaza repetat: contor o data pe tick si notificare la 3',async()=>{
  const db=persistentDb({schedules:[everyDay]}),hw=hardware();let postThisTick=false;
  const uncertain={call:async(...args)=>{if(args[0]==='GET' && postThisTick)throw new Error('recitire cazuta');const r=await hw.call(...args);if(args[0]==='POST'){postThisTick=true;hw.states[3]=false;}return r}};
  for(let i=0;i<3;i++) {postThisTick=false;await at(hour('18:00')+i*300000,()=>tick(db,uncertain));}
  assert.equal(db.state.runtime.citiri_esuate[3],3);
  assert.ok(db.state.alerts.some(a=>a.p_title==='Lumini sediu: citiri repetate esuate'));
  await at(hour('18:15'),()=>tick(db,hw));assert.equal(db.state.runtime.citiri_esuate[3],undefined);
});

test('DST cu hardware persistent: ora repetata/inexistenta nu pierde OFF final',async()=>{
  for(const zi of ['2026-10-25','2027-03-28','2027-03-29']) {
    const schedule={...everyDay,parametri:{pornire:'03:30',oprire:'05:00',zile:[0,1]}};
    const db=persistentDb({schedules:[schedule]}),hw=hardware();
    await ticks(db,hw,oraLocala(zi,'02:30'),oraLocala(zi,'05:10'));
    assert.deepEqual(hw.posts,[{id:3,value:true},{id:3,value:false}],zi);
    assert.equal(hw.states[3],false);
  }
});
