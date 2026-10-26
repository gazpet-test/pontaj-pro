// Fara dependente sau retea: node --test scripts/test_lumini_node.mjs (Node 24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soare, oraLocala, planSimulare, evalueaza, decide, parametriValizi } from '../supabase/functions/tuya/lumini_logica.ts';
import { autorizeazaLumini, citesteSwitch, eroareTuya, executaLumini } from '../supabase/functions/tuya/lumini_edge.ts';
import { dispozitiveImplicite, textStareLumina } from '../src/luminiUi.js';
import { poateSelectaLumina, setariSchimbaProgramarea, textAmanareLumini } from '../src/luminiUi.js';
import { readFileSync } from 'node:fs';
import { stareBuget, verificaBuget, rezervaApel, confirmaSonda, modificaConfig } from '../supabase/functions/tuya/buget.ts';
import { planCitire } from '../supabase/functions/tuya/lumini_adaptiv.ts';
import { textConsumTuya, textCitireLumina } from '../src/luminiUi.js';

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
      assert.ok(Object.keys(a.p_date).every(k=>['pauze','backoff','citiri_esuate','off_offset','amanate'].includes(k)),'Runtime compatibil cu RPC aplicat');
      if(state.failSave)return fail('Runtime indisponibil');
      state.runtime=clone(a.p_date);state.saves.push(clone(a.p_date));
    }
    if(a.p_actiune==='release')state.lease=null;
    return {data:{ok:true}};
  },from(table){
    let data=table==='iot_lumini'?rows:table==='iot_lumini_setari'?db.settings:table==='iot_program_lumini'?schedules:table==='profiles'?{is_owner:db.owner===true}:table==='user_module_access'?[{module:'cladire',access_level:'editor'}]:{config:{}};
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

// Extensie a mock-ului existent: catalog/config/notificari pentru handlerul sync real.
function consumDb(options={}) {
  const db=persistentDb(options),from=db.from.bind(db),rpc=db.rpc.bind(db);
  db.config={uids:['u1','u2','u3']};db.catalog=[];db.citiri=[];db.writes=[];db.failConfig=false;
  db.from=table=>{
    if(!['iot_integrari','iot_dispozitive','iot_citiri','notifications'].includes(table))return from(table);
    let patch=null,kind=null,single=false,limit=Infinity;const filters=[];
    const q={select(){return q},eq(k,v){filters.push(r=>k==='config'?JSON.stringify(r[k])===v:r[k]===v);return q},gt(k,v){filters.push(r=>r[k]>v);return q},limit(n){limit=n;return q},
      maybeSingle(){single=true;return q},single(){single=true;return q},
      update(v){patch=v;kind='update';return q},upsert(v,opts){assert.equal(opts.ignoreDuplicates,true);patch=v;kind='upsert';return q},insert(v){patch=v;kind='insert';return q},
      then(resolve){
        let rows=table==='iot_integrari'?[{cheie:'tuya',config:db.config}]:table==='iot_dispozitive'?db.catalog:table==='notifications'?db.state.alerts.map((a,i)=>({id:i,type:a.p_type,title:a.p_title,created_at:new Date(a.created_at).toISOString()})):db.citiri;
        rows=rows.filter(r=>filters.every(f=>f(r)));
        if(patch){
          if(table==='iot_integrari' && db.failConfig)return Promise.resolve({error:{message:'config indisponibil'}}).then(resolve);
          db.writes.push({table,kind,patch:structuredClone(patch)});
          if(kind==='update')for(const row of rows)Object.assign(row,structuredClone(patch));
          if(table==='iot_integrari' && patch.config && rows.length)db.config=structuredClone(patch.config);
          if(kind==='upsert'){
            if(db.catalog.some(r=>r.extern_id===patch.extern_id && r.sursa===patch.sursa))rows=[];
            else {const row={id:100+db.catalog.length,activ:true,...structuredClone(patch)};db.catalog.push(row);rows=[row]}
          }
          if(kind==='insert')db.citiri.push(structuredClone(patch));
        }
        rows=rows.slice(0,limit);
        return Promise.resolve({data:structuredClone(single?(rows[0]??null):rows),error:null}).then(resolve);
      }};return q;
  };
  db.rpc=async(name,args)=>rpc(name,args);
  return db;
}
let handlerSequence=0;
async function withHandler(db,fetchMock,fn) {
  const {stripTypeScriptTypes}=await import('node:module');
  const originals=[globalThis.Deno,globalThis.__luminiCreateClient,globalThis.fetch];let handler;
  globalThis.__luminiCreateClient=()=>db;
  globalThis.Deno={env:{get:()=> 'fake-local-only'},serve(fn){handler=fn}};
  globalThis.fetch=fetchMock;
  try {
    const source=readFileSync(new URL('../supabase/functions/tuya/index.ts',import.meta.url),'utf8')
      .replace("import { createClient } from 'npm:@supabase/supabase-js@2';",'const createClient = globalThis.__luminiCreateClient;')
      .replace(/'\.\/(lumini_edge|buget)\.ts'/g,(_,name)=>JSON.stringify(new URL('../supabase/functions/tuya/'+name+'.ts',import.meta.url).href));
    await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+`\n// consum ${++handlerSequence}`).toString('base64'));
    await fn(async(actiune='sync',body={},cron=true)=>{
      const response=await handler(new Request('https://local.invalid',{method:'POST',headers:cron?{'x-iot-secret':'cron-test'}:{Authorization:'Bearer fake'},body:JSON.stringify({actiune,...body})}));
      return {status:response.status,...await response.json()};
    });
  } finally {[globalThis.Deno,globalThis.__luminiCreateClient,globalThis.fetch]=originals}
}
const tuyaResult=result=>new Response(JSON.stringify({success:true,result}));
const localDevice=(id,tip='priza',activ=true)=>({id,extern_id:String(id),sursa:'tuya',activ,nume:`D${id}`,meta:{tip,categorie:tip==='camera'?'sp':'cz',model:'model'},ultima_citire:{online:true,pornit:false},citit_la:'2026-10-20T00:00:00.000Z'});

test('consum: handler real fara programe/pauze => zero token/status; aprobarea si pauza mentin citirile',async()=>at(now,async()=>{
  for(const schedules of [[],[{...p,activ:false}],[{...p,aprobat_de:null}],[{...p,aprobat_la:null}]]) {
    const db=consumDb({schedules});let calls=0;
    await withHandler(db,async()=>{calls++;throw new Error('Nu trebuie apelat Tuya')},async run=>{
      const r=await run('programe_tick');assert.equal(r.rezultat,'nimic de facut');assert.equal(r.apeluri_tuya,0);assert.equal(calls,0);assert.equal(db.state.lease,null);
    });
  }
  for(const approved of [false,true]){
    const db=consumDb({schedules:approved?[{...p,dispozitive:[]}]:[],runtime:{pauze:{3:now+300000}}});const paths=[];
    await withHandler(db,async url=>{const path=new URL(url).pathname;paths.push(path);return tuyaResult(path==='/v1.0/token'?{access_token:'fake'}:[{code:'switch_1',value:false}])},async run=>{
      assert.equal((await run('programe_tick')).ok,true);assert.equal(paths.length,2);
    });
  }
}));

test('consum: liste/camere la 6h, priza la ora, inactiv nici citit nici reactivat',async()=>at(now,async advance=>{
  const db=consumDb();db.catalog=[localDevice(1,'camera'),localDevice(2),...[279,280,281,283].map(id=>localDevice(id,'camera',false))];
  const paths=[];
  await withHandler(db,async url=>{
    const path=new URL(url).pathname;paths.push(path);
    if(path==='/v1.0/token')return tuyaResult({access_token:'fake'});
    if(path.includes('/users/'))return tuyaResult(db.catalog.map(d=>({id:d.extern_id,name:d.nume,category:d.meta.categorie,online:false})));
    return tuyaResult([{code:'switch_1',value:true}]);
  },async run=>{
    assert.equal((await run()).apeluri_tuya,6); // token + 3 liste + camera + priza (dedup intre uid)
    const camera=structuredClone(db.catalog[0]);paths.length=0;
    advance(600000);assert.equal((await run()).apeluri_tuya,0);
    advance(3000000);
    assert.equal((await run()).apeluri_tuya,2);assert.deepEqual(paths,['/v1.0/token','/v1.0/iot-03/devices/2/status']);assert.deepEqual(db.catalog[0],camera);
    advance(5*3600000);paths.length=0;assert.equal((await run()).apeluri_tuya,6);
    assert.ok(!paths.some(p=>/\/(279|280|281|283)\//.test(p)));assert.ok(db.catalog.slice(2).every(d=>d.activ===false));
    assert.ok(db.writes.every(w=>!Object.hasOwn(w.patch,'activ')));
  });
}));

test('consum: lista actualizeaza online camera fara status sau citire proaspata; status esuat asteapta 6h',async()=>at(now,async advance=>{
  const db=consumDb();db.catalog=[localDevice(1,'camera')];db.config.status_camere_tuya_la=new Date().toISOString();
  const originalRead=db.catalog[0].citit_la;let reads=0;
  await withHandler(db,async url=>{
    const path=new URL(url).pathname;
    if(path==='/v1.0/token')return tuyaResult({access_token:'fake'});
    if(path.includes('/users/'))return tuyaResult([{id:'1',name:'Camera',category:'sp',online:false}]);
    reads++;return new Response(JSON.stringify({success:false,code:1106,msg:'permission deny'}));
  },async run=>{
    assert.equal((await run()).apeluri_tuya,4);assert.equal(reads,0);assert.equal(db.catalog[0].ultima_citire.online,false);assert.equal(db.catalog[0].citit_la,originalRead);
    advance(6*3600000);await run();assert.equal(reads,1);
    advance(300000);await run();assert.equal(reads,1);
  });
}));

test('consum: fallback gol limitat la 6h si catalogul manual persista pentru sync',async()=>at(now,async()=>{
  const db=consumDb();const paths=[];
  await withHandler(db,async url=>{const path=new URL(url).pathname;paths.push(path);return tuyaResult(path==='/v1.0/token'?{access_token:'fake'}:path.includes('/users/')?[]:path==='/v1.3/iot-03/devices'?{list:[{id:'7',name:'Camera',category:'sp',online:true}]}:[])},async run=>{
    assert.equal((await run('lista')).apeluri_tuya,5);assert.equal(db.catalog.length,1);paths.length=0;
    assert.equal((await run()).apeluri_tuya,2); // token + primul status camera
    assert.ok(!paths.some(p=>p.includes('/users/') || p.startsWith('/v1.3/')));
    paths.length=0;assert.equal((await run()).apeluri_tuya,0);
  });
}));

test('consum: cota opreste dupa primul refuz, dedup 24h comun sync/tick/token/lista/status',async()=>at(now,async advance=>{
  for(const stage of ['token','lista','status','tick']){
    const db=consumDb({lights:[1,2,3].map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:[1,2,3]}]});db.catalog=[localDevice(4),localDevice(5)];
    if(['status','tick'].includes(stage))db.config.lista_tuya_la=new Date().toISOString();
    let calls=0;
    await withHandler(db,async url=>{
      calls++;const path=new URL(url).pathname;
      if(path==='/v1.0/token' && stage!=='token')return tuyaResult({access_token:'fake'});
      return new Response(JSON.stringify({success:false,code:28841004,msg:'IoT Core trial quota is exhausted'}));
    },async run=>{
      for(const hours of [0,13,11]) {
        advance(hours*3600000);calls=0;
        const r=await run(stage==='tick'?'programe_tick':'sync');
        assert.equal(r.ok===true,false);assert.equal(calls,stage==='token'?1:2);assert.equal(r.apeluri_tuya,calls);
        assert.equal(db.state.alerts.filter(a=>a.p_title==='Tuya: cota API epuizata').length,hours===11?2:1);
      }
      assert.match(db.state.alerts[0].p_message,/28841004.*Ramanem pe gratuit/);
    });
  }
}));

test('consum: alta eroare de plata opreste tick; esec config opreste listele',async()=>at(now,async()=>{
  const db=consumDb();let calls=0;
  await withHandler(db,async()=>{calls++;return new Response(JSON.stringify({success:false,code:99999,msg:'Insufficient balance'}))},async run=>{
    assert.equal((await run('programe_tick')).apeluri_tuya,1);assert.equal(calls,1);assert.equal(db.state.alerts[0].p_title,'Tuya: cota API epuizata');
  });
  db.failConfig=true;calls=0;
  await withHandler(db,async()=>{calls++;return tuyaResult({access_token:'fake'})},async run=>{
    const r=await run();assert.equal(r.ok,false);assert.equal(calls,0);
  });
}));

test('consum: rezervare concurenta lista si alerta are un singur castigator',async()=>at(now,async()=>{
  for(const quota of [false,true]){
    const db=consumDb();let lists=0,notices=0;
    const rpc=db.rpc.bind(db);db.rpc=async(name,args)=>{if(name==='iot_alerta' && args.p_title==='Tuya: cota API epuizata')notices++;return rpc(name,args)};
    await withHandler(db,async url=>{
      if(quota)return new Response(JSON.stringify({success:false,code:28841004}));
      if(new URL(url).pathname==='/v1.0/token')return tuyaResult({access_token:'fake'});
      lists++;return tuyaResult(new URL(url).pathname.startsWith('/v1.3/')?{list:[]}:[]);
    },async run=>{
      const results=await Promise.all([run(),run()]);
      if(quota){assert.equal(notices,1);assert.equal(db.state.alerts.length,1)}
      else {assert.equal(lists,4);assert.equal(results.filter(r=>r.apeluri_tuya>0).length,1)}
    });
  }
}));

test('consum: rezervare alerta abandonata expira in 10min; RPC esuat permite reincercare',async()=>at(now,async advance=>{
  const db=consumDb();db.config.cota_alerta_tuya_la=new Date().toISOString();
  const rpc=db.rpc.bind(db);let failNotice=true;
  db.rpc=async(name,args)=>name==='iot_alerta' && failNotice?{error:{message:'notificare esuata'}}:rpc(name,args);
  await withHandler(db,async()=>new Response(JSON.stringify({success:false,code:28841004})),async run=>{
    await run();assert.equal(db.state.alerts.length,0);
    advance(6*3600000);await run();assert.equal(db.state.alerts.length,0);
    failNotice=false;advance(6*3600000);await run();assert.equal(db.state.alerts.length,1);
  });
}));

test('consum: cota la POST opreste celelalte POST si recitiri',async()=>at(hour('12:00'),async()=>{
  const db=consumDb({lights:[1,2,3].map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:[1,2,3]}]});let calls=0,posts=0;
  await withHandler(db,async(url,options)=>{
    calls++;
    if(options.method==='POST'){posts++;return new Response(JSON.stringify({success:false,code:28841004}))}
    return tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:[{code:'switch_1',value:true}]);
  },async run=>{const r=await run('programe_tick');assert.equal(r.ok,false);assert.equal(posts,1);assert.equal(calls,5);assert.equal(r.apeluri_tuya,5);assert.equal(db.state.lease,null)});
}));

test('consum: transportul real revalideaza bugetul OFF la iesirea din coada',async()=>at(hour('12:00'),async advance=>{
  const db=consumDb({lights:[1,2,3].map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:[1,2,3]}]});let posts=0;
  await withHandler(db,async(url,options)=>{
    if(options.method==='POST'){posts++;advance(121000);return tuyaResult(true)}
    return tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:[{code:'switch_1',value:posts===0}]);
  },async run=>{const r=await run('programe_tick');assert.equal(posts,1);assert.equal(r.amanate_off.length,2);assert.equal(db.state.lease,null)});
}));

// Ceas virtual cu asteptari concurente: trei operatii de 8s consuma 8s, nu 24s.
function timpSimulat(advance) {
  let queue=[],scheduled=false;
  const pump=()=>{
    scheduled=false;
    const next=Math.min(...queue.map(x=>x.at));
    advance(next-Date.now());
    const ready=queue.filter(x=>x.at===next);queue=queue.filter(x=>x.at!==next);
    for(const item of ready)item.resolve();
    if(queue.length)schedule();
  };
  const schedule=()=>{if(!scheduled){scheduled=true;setImmediate(pump)}};
  return ms=>new Promise(resolve=>{queue.push({at:Date.now()+ms,resolve});schedule()});
}

test('r7 P1-1: 12 OFF lente 8+8s, maxim 3 simultane, acelasi lease; ON oprit dupa 75s',async()=>at(hour('12:00'),async advance=>{
  const ids=Array.from({length:12},(_,i)=>i+1),start=Date.now(),wait=timpSimulat(advance);
  const orar={...p,id:2,tip:'orar',dispozitive:[13],parametri:{pornire:'11:00',oprire:'13:00',zile:[6]}};
  const db=persistentDb({lights:[...ids,13].map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:ids},orar]});
  const hw=hardware(Object.fromEntries([...ids.map(id=>[id,true]),[13,false]]));
  const rpc=db.rpc.bind(db);let active=0,maxActive=0;const postTimes=[];
  db.rpc=async(name,args)=>{const r=await rpc(name,args);if(args?.p_actiune==='acquire')advance(20000);return r};
  const result=await executaLumini(db,async(method,path,payload)=>{
    assert.ok(db.state.lease,'toate operatiile sunt in lease');
    active++;maxActive=Math.max(maxActive,method==='POST'?active:0);
    if(method==='POST')postTimes.push(Date.now()-start);
    await wait(8000);active--;
    return hw.call(method,path,payload);
  },{actiune:'programe_tick'},null);
  assert.equal(hw.posts.length,12);assert.ok(hw.posts.every(x=>x.value===false));
  assert.equal(maxActive,3);assert.ok(postTimes.some(t=>t>=75000));
  assert.equal(Date.now()-start,124000);assert.ok(Object.values(hw.states).every(x=>!x));
  assert.deepEqual(result.amanate_off,[]);assert.equal(result.comenzi.find(x=>x.dispozitiv_id===13).ok,false);
  assert.equal(db.state.lease,null);
}));

test('r7 P1-1: plafon dur, amanate_off explicite, jurnal dedup intre tick-uri si reluare',async()=>{
  const ids=[1,2,3,4,5,6];
  const db=persistentDb({lights:ids.map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:ids}]});
  const hw=hardware(Object.fromEntries(ids.map(id=>[id,true]))),rpc=db.rpc.bind(db);
  let delay=121000;
  for(let n=0;n<3;n++)await at(hour('12:00')+n*300000,async advance=>{
    let delayed=false;
    db.rpc=async(name,args)=>{const r=await rpc(name,args);if(args?.p_actiune==='save' && !delayed){delayed=true;advance(delay)}return r};
    const r=await tick(db,hw);
    if(n<2){
      assert.equal(hw.posts.length,0);assert.equal(r.amanate_off.length,6);
      assert.ok(r.amanate_off.every(x=>x.motiv==='plafon_dur_off'));
      assert.deepEqual(db.state.runtime.amanate,r.amanate_off);
      assert.equal(db.state.logs.filter(x=>x.eroare?.startsWith('OFF amanat:')).length,6);
      assert.equal(db.state.alerts.length,6);
    } else {assert.deepEqual(r.amanate_off,[]);assert.deepEqual(db.state.runtime.amanate,[])}
    if(n===1)delay=0;
  });
  assert.deepEqual(hw.posts.map(x=>x.id),[3,4,5,6,1,2]);
  assert.ok(Object.values(hw.states).every(x=>!x));
});

test('r7 P1-1: citirile lente se rotesc si converg fara a consuma rezerva OFF',async()=>{
  const ids=Array.from({length:12},(_,i)=>i+1);
  const db=persistentDb({lights:ids.map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:ids}]});
  const hw=hardware(Object.fromEntries(ids.map(id=>[id,true]))),rpc=db.rpc.bind(db);
  for(let n=0;n<4;n++)await at(hour('12:00')+n*300000,async advance=>{
    const wait=timpSimulat(advance),start=Date.now();
    db.rpc=async(name,args)=>{const r=await rpc(name,args);if(args?.p_actiune==='acquire')advance(70000);return r};
    const r=await executaLumini(db,async(...args)=>{await wait(8000);return hw.call(...args)},{actiune:'programe_tick'},null);
    assert.ok(Date.now()-start<=140000);
    if(n===0){
      assert.equal(hw.posts.length,3);
      assert.equal(db.state.runtime.citiri_esuate._adaptiv.reverifica,true);
    }
    assert.deepEqual(r.amanate_off,[]);
  });
  assert.deepEqual(hw.posts.map(x=>x.id),ids);assert.ok(Object.values(hw.states).every(x=>!x));
});

test('r7 P1-1: reverificare buget dupa reserve/jurnal/save; soft doar ON, dur amanat OFF',async()=>{
  for(const stage of ['reserve','jurnal','save'])for(const [value,delay,expected] of [[true,76000,0],[false,76000,1],[false,121000,0]]) {
    await at(hour(value?'18:00':'20:00'),async advance=>{
      const db=persistentDb({schedules:[everyDay]}),hw=hardware({3:!value});
      const rpc=db.rpc.bind(db),from=db.from.bind(db);let saves=0,delayed=false;
      const once=()=>{if(!delayed){advance(delay);delayed=true}};
      db.rpc=async(name,args)=>{
        const r=await rpc(name,args);
        if(stage==='reserve' && args?.p_actiune==='reserve')once();
        if(stage==='save' && args?.p_actiune==='save' && ++saves===2)once();
        return r;
      };
      db.from=table=>{const q=from(table);if(stage==='jurnal' && table==='iot_lumini_jurnal'){const insert=q.insert;q.insert=row=>{const result=insert(row);once();return result}}return q};
      const r=await tick(db,hw);
      assert.equal(hw.posts.length,expected,`${stage}, ${value}, ${delay}`);
      assert.equal(r.amanate_off.length,!value && !expected?1:0);
    });
  }
});

test('r7 P1-2: plafon comun doar in fereastra activa, independent de ordinea programelor',async()=>{
  const sim={...p,id:10,tip:'simulare_prezenta',dispozitive:[4],parametri:{}};
  const orar={...p,id:20,tip:'orar',dispozitive:[1,2,3],parametri:{pornire:'16:00',oprire:'23:59',zile:[0,1,2,3,4,5,6]}};
  for(const zi of ['2026-10-24','2026-10-26'])for(const ora of ['16:00','20:00','23:30'])for(const reverse of [false,true]) {
    const schedules=reverse?[orar,sim]:[sim,orar];
    const db=persistentDb({schedules,lights:[1,2,3,4].map(id=>({id,rol:'interior'}))}),hw=hardware({1:false,2:false,3:false,4:false});
    const r=await at(oraLocala(zi,ora),()=>tick(db,hw));
    const active=zi==='2026-10-24' && ora==='20:00';
    assert.equal(hw.posts.filter(x=>x.value).length,active?2:3,`${zi} ${ora} ${reverse}`);
    assert.equal(r.amanate.some(x=>x.motiv==='plafon_comun_2'),active);
  }
});

test('r7 P2: coordonate invalide nu opresc orarul valid, nici in motorul Edge',async()=>at(hour('18:00'),async()=>{
  const db=persistentDb({schedules:[everyDay]}),hw=hardware();db.settings.lat=999;db.settings.lon=NaN;
  assert.equal((await tick(db,hw)).ok,true);assert.deepEqual(hw.posts,[{id:3,value:true}]);
}));

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

test('r4 P1/r7: timpul avanseaza in tick; rezerva OFF permite toate cele sase stingeri',async()=>{
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
      assert.deepEqual(hw.posts.map(x=>x.id),[1,2,3,4,5,6]);
      assert.equal(hw.states[5],false);assert.equal(hw.states[6],false);
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
  const db=consumDb({lights:[1,2,3,4,5,6].map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:[1,2,3,4,5,6]}]});
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
    source=source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';",'const createClient = globalThis.__luminiCreateClient;').replace(/'\.\/(lumini_edge|buget)\.ts'/g,(_,name)=>JSON.stringify(new URL('../supabase/functions/tuya/'+name+'.ts',import.meta.url).href));
    await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)+'\n// r4 token test').toString('base64'));
    const request=()=>new Request('https://local.invalid',{method:'POST',headers:{'x-iot-secret':'cron-test'},body:JSON.stringify({actiune:'programe_tick'})});
    assert.equal((await handler(request())).status,200);
    assert.equal(tokens,1);assert.equal(statusReads,6);
    tokens=0;statusReads=0;rejectToken=true;delete db.state.runtime.citiri_esuate._adaptiv;
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
  const db=consumDb(),hw=hardware();let handler,fetches=0;
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
    source=source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';",'const createClient = globalThis.__luminiCreateClient;').replace(/'\.\/(lumini_edge|buget)\.ts'/g,(_,name)=>JSON.stringify(new URL('../supabase/functions/tuya/'+name+'.ts',import.meta.url).href));
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
  // Pauzele pastreaza citirea luminilor fara program activ in noul motor adaptiv.
  const db=persistentDb({schedules:[{...everyDay,id:2,activ:false,dispozitive:[1,5]},sim],lights:[1,2,4,5].map(id=>({id,rol:'interior'})),runtime:{pauze:{1:hour('23:59'),5:hour('23:59')}}}),hw=hardware({1:false,2:false,4:false,5:false});
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
  const db=persistentDb({schedules:[sim],lights,runtime:{pauze:{1:hour('23:59'),5:hour('23:59')}}}),hw=hardware({1:false,2:false,4:false,5:false,6:false});
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

// Runda buget: transportul, persistenta si ceasul sunt aceleasi ca in testele vechi.
test('buget: calendar Bucuresti, ciclul pe 6 inclusiv ianuarie si reset zilnic separat',()=>{
  const cfg={buget_ciclu_tuya:100,consum_zi_tuya:{zi:'2026-10-05',n:5},consum_ciclu_tuya:{ciclu_start:'2026-09-06',n:90}};
  assert.equal(stareBuget(cfg,oraLocala('2026-10-05','23:59')).n,90);
  const reset=stareBuget(cfg,oraLocala('2026-10-06','00:00'));
  assert.equal(reset.n,0);assert.equal(reset.azi,0);assert.equal(reset.ciclu_start,'2026-10-06');
  assert.equal(stareBuget({},oraLocala('2026-01-05','23:59')).ciclu_start,'2025-12-06');
  assert.equal(stareBuget({},now).buget,45000);
  assert.equal(stareBuget({buget_ciclu_tuya:0},now).buget,45000);
});
const configConsum=(n,buget=1000)=>({buget_ciclu_tuya:buget,consum_ciclu_tuya:{ciclu_start:'2026-10-06',n}});
for(const [mod,n,indisponibil] of [['90%',900,'economie'],['100%',1000,'cota'],['frana externa',0,'cota']]) {
  test(`runda4 P2-a: lista locala la ${mod}, interval rezervat, zero HTTP`,async()=>at(now,async()=>{
    const db=consumDb();db.catalog=[localDevice(10)];
    Object.assign(db.config,configConsum(n),{lista_tuya_la:new Date().toISOString()});
    if(mod==='frana externa')db.config.cota_blocata_pana=new Date(Date.now()+3600000).toISOString();
    const before=structuredClone(db.config);let attempts=0;
    await withHandler(db,async()=>{attempts++;throw new Error('HTTP interzis')},async run=>{
      const r=await run('lista');
      assert.equal(r.status,200);assert.equal(r.ok,true);assert.equal(r.n,1);
      assert.deepEqual(r.dispozitive,[{id:'10',name:'D10',category:'cz',product_name:'model',online:true}]);
      assert.equal(r.indisponibil,indisponibil);assert.equal(r.apeluri_tuya,0);assert.equal(attempts,0);
      assert.deepEqual(db.config,before);assert.equal(db.writes.length,0);
    });
  }));
}
test('runda4 P2-a: lista care necesita HTTP ramane refuzata cu mesajul existent',async()=>at(now,async()=>{
  for(const [n,frana,message] of [[900,false,/economie/],[1000,false,/100%/],[0,true,/cota Tuya epuizata/]]) {
    for(const gol of [false,true]) {
      const db=consumDb();db.catalog=gol?[]:[localDevice(10)];Object.assign(db.config,configConsum(n));
      // Catalog gol cu interval rezervat, respectiv catalog populat cu interval expirat.
      if(gol)db.config.lista_tuya_la=new Date().toISOString();
      if(frana)db.config.cota_blocata_pana=new Date(Date.now()+3600000).toISOString();
      let attempts=0;
      await withHandler(db,async()=>{attempts++;throw new Error('HTTP interzis')},async run=>{
        const r=await run('lista');assert.equal(r.ok,false);assert.equal(r.status,409);
        assert.match(r.error,message);assert.equal(r.apeluri_tuya,0);assert.equal(attempts,0);
        assert.equal(db.config.consum_ciclu_tuya.n,n);
      });
    }
  }
}));
for(const failure of ['CAS alerta','RPC alerta']) {
  test(`runda4 P2-b: ${failure} arunca dupa contor, HTTP pleaca si contorul ramane corect`,async()=>at(now,async()=>{
    const db=consumDb();Object.assign(db.config,configConsum(699));let failed=0;
    if(failure==='CAS alerta') {
      const from=db.from.bind(db);
      db.from=table=>{
        const q=from(table),update=q.update;
        if(table==='iot_integrari')q.update=v=>{
          update(v);
          if(v.config?.buget_alerta_tuya_la)q.then=resolve=>{failed++;return Promise.resolve({error:{message:'CAS alerta indisponibil'}}).then(resolve)};
          return q;
        };
        return q;
      };
    } else {
      const rpc=db.rpc.bind(db);
      db.rpc=async(name,args)=>{if(name==='iot_alerta'){failed++;throw new Error('RPC alerta indisponibil')}return rpc(name,args)};
    }
    let attempts=0;
    await withHandler(db,async url=>{
      attempts++;
      return tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:[{id:'10',name:'D10',category:'cz'}]);
    },async run=>{
      const r=await run('lista');assert.equal(r.ok,true);assert.equal(r.n,1);
      assert.ok(failed>0);assert.ok(attempts>0);assert.equal(r.apeluri_tuya,attempts);
      assert.equal(db.config.consum_ciclu_tuya.n,699+attempts);assert.equal(db.config.consum_zi_tuya.n,attempts);
      assert.ok(r.avertismente_buget.length>0);
      assert.ok(r.avertismente_buget.every(message=>/Notificare buget esuata:/.test(message)));
      assert.match(r.avertismente_buget[0],failure==='CAS alerta'?/Config Tuya nesalvata/:/RPC alerta indisponibil/);
    });
  }));
}
test('buget: praguri 70/90/100, contor CAS concurent si dedup 24h',async()=>at(now,async advance=>{
  const db=consumDb();Object.assign(db.config,configConsum(699));
  await Promise.all(Array.from({length:8},()=>rezervaApel(db,'sync')));
  assert.equal(db.config.consum_zi_tuya.n,8);assert.equal(db.config.consum_ciclu_tuya.n,707);
  assert.equal(db.state.alerts.filter(a=>a.p_title==='Tuya: consum API la 70% din cota').length,1);
  advance(13*3600000);await rezervaApel(db,'off');assert.equal(db.state.alerts.length,1);
  advance(11*3600000);await rezervaApel(db,'off');assert.equal(db.state.alerts.length,2);
  Object.assign(db.config,configConsum(900));
  assert.equal(stareBuget(db.config).stare,'economie');
  for(const scop of ['sync','periodic']) assert.throws(()=>verificaBuget(db.config,scop),/economie/);
  for(const scop of ['manual','owner','tranzitie','off','program']) assert.doesNotThrow(()=>verificaBuget(db.config,scop));
  Object.assign(db.config,configConsum(1000));
  assert.equal(stareBuget(db.config).stare,'doar_off');
  for(const scop of ['sync','periodic','manual','tranzitie','program']) assert.throws(()=>verificaBuget(db.config,scop),/100%/);
  for(const scop of ['off','owner']) assert.doesNotThrow(()=>verificaBuget(db.config,scop));
}));

test('buget: CAS pastreaza config strain; esecul persistentei nu permite transport',async()=>at(now,async()=>{
  const db=consumDb();db.config.alt_modul={valoare:7};
  await Promise.all([modificaConfig(db,c=>({...c,camp_a:1})),modificaConfig(db,c=>({...c,camp_b:2})),rezervaApel(db,'off')]);
  assert.deepEqual(db.config.alt_modul,{valoare:7});assert.equal(db.config.camp_a,1);assert.equal(db.config.camp_b,2);
  db.failConfig=true;
  await withHandler(db,async()=>{assert.fail('Transport interzis fara contor persistent')},async run=>{
    const r=await run('programe_tick');assert.equal(r.apeluri_tuya,0);assert.equal(r.ok,false);
  });
}));

test('buget: sync sare luminile iot_lumini, rezerva ora inainte de token, persista intre handleri',async()=>at(now,async advance=>{
  const db=consumDb();db.catalog=[localDevice(3),localDevice(10)];
  const fetch=async url=>{
    const path=new URL(url).pathname;
    assert.ok(!path.includes('/devices/3/'));
    if(path==='/v1.0/token')return tuyaResult({access_token:'fake'});
    if(path.includes('/users/'))return tuyaResult(db.catalog.map(d=>({id:d.extern_id,name:d.nume,category:'cz'})));
    return tuyaResult([{code:'switch_1',value:false}]);
  };
  await withHandler(db,fetch,async run=>{const r=await run();assert.equal(r.apeluri_tuya,5);assert.equal(db.config.consum_ciclu_tuya.n,5)});
  advance(3600000-1);
  await withHandler(db,fetch,async run=>{assert.equal((await run()).apeluri_tuya,0);advance(1);assert.equal((await run()).apeluri_tuya,2)});
  assert.equal(db.config.consum_ciclu_tuya.n,7);
}));

test('buget: tick la 15 min, doar acoperire; runtime schimbat de lease nu invalideaza intervalul',async()=>at(hour('12:00'),async advance=>{
  const db=consumDb({lights:[{id:3,rol:'exterior'},{id:4,rol:'interior'}]});let reads=0;
  await withHandler(db,async url=>{
    if(new URL(url).pathname==='/v1.0/token')return tuyaResult({access_token:'fake'});
    assert.ok(!String(url).includes('/devices/4/'));reads++;return tuyaResult([{code:'switch_1',value:false}]);
  },async run=>{
    assert.equal((await run('programe_tick')).apeluri_tuya,2);
    for(let n=0;n<2;n++) {advance(300000);db.settings.runtime={token:crypto.randomUUID()};assert.equal((await run('programe_tick')).apeluri_tuya,0)}
    advance(300000);assert.equal((await run('programe_tick')).apeluri_tuya,2);assert.equal(reads,2);
  });
}));

test('buget: tranzitii solare/orare/segmente si expirare pauza activeaza citiri la 5 min',()=>{
  const plans=[p,everyDay,{...p,tip:'simulare_prezenta',dispozitive:[1,2],parametri:{}}];
  for(const program of plans) {
    const setari={...settings,roluri:{1:'interior',2:'mixt',3:'exterior'}};
    const t=program.tip==='orar'?hour('18:00'):soare('2026-10-24').apus;
    const runtime={citiri_esuate:{_adaptiv:{ultima_completa:t}}};
    const base=planCitire([program],setari,runtime,t);runtime.citiri_esuate._adaptiv.semnatura=base.semnatura;
    assert.equal(planCitire([program],setari,runtime,t+300000).aproape,true);
    assert.equal(planCitire([program],setari,runtime,t+300000).citeste,true);
    if(program.tip==='simulare_prezenta') {
      const segment=planSimulare('2026-10-24:1',[1,2],t,hour('23:30'))[0];
      runtime.citiri_esuate._adaptiv.ultima_completa=segment.end;
      assert.equal(planCitire([program],setari,runtime,segment.end+300000).aproape,true);
    }
  }
  const runtime={pauze:{3:hour('12:10')},citiri_esuate:{_adaptiv:{ultima_completa:hour('12:00')}}};
  const a=planCitire([p],settings,runtime,hour('12:00'));runtime.citiri_esuate._adaptiv.semnatura=a.semnatura;
  assert.equal(planCitire([p],settings,runtime,hour('12:05')).aproape,true);
});

test('buget: corectie inclusiv refuzata cere reverificare la tick-ul urmator',async()=>at(hour('12:00'),async advance=>{
  const db=persistentDb(),hw=hardware({3:true});let reads=0;
  hw.setEffect(()=>{throw Object.assign(new Error('refuz cert'),{refuzCert:true})});
  const counted={call:async(...a)=>{if(a[0]==='GET')reads++;return hw.call(...a)}};
  await tick(db,counted);const initial=reads;
  assert.equal(db.state.runtime.citiri_esuate._adaptiv.reverifica,true);
  advance(300000);await tick(db,counted);assert.ok(reads>initial);
}));

test('buget: 90% opreste sync, pastreaza programe si OFF chiar cu cache OFF',async()=>{
  for(const [time,initial,expected] of [['12:00',false,2],['12:00',true,4],['18:00',false,4]])await at(hour(time),async()=>{
    const db=consumDb({schedules:[everyDay],lights:[{id:3,rol:'exterior',last:initial}]}),hw=hardware({3:initial});Object.assign(db.config,configConsum(900));
    await withHandler(db,async(url,o)=>tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:await hw.call(o.method,new URL(url).pathname,o.body?JSON.parse(o.body):undefined)),async run=>{
      assert.equal((await run()).apeluri_tuya,0);
      const r=await run('programe_tick');assert.equal(r.apeluri_tuya,expected,`${time} ${initial}`);
      if(time==='12:00')assert.equal(hw.states[3],false);
      if(time==='18:00')assert.equal(hw.states[3],true);
    });
  });
});

test('buget: 100% permite doar OFF si manual owner; 90% permite manual editor',async()=>{
  for(const [n,owner,value,permis] of [[900,false,true,true],[1000,false,true,false],[1000,false,false,true],[1000,true,true,true]])await at(hour('18:00'),async()=>{
    const db=consumDb({schedules:[everyDay]}),hw=hardware({3:!value});db.owner=owner;Object.assign(db.config,configConsum(n));let calls=0;
    await withHandler(db,async(url,o)=>{calls++;return tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:await hw.call(o.method,new URL(url).pathname,o.body?JSON.parse(o.body):undefined))},async run=>{
      const r=await run('comanda',{dispozitiv_id:3,stare:value},false);
      assert.equal(r.ok,permis);assert.equal(calls,permis?4:0);assert.equal(r.apeluri_tuya,calls);
      if(permis)assert.equal(hw.states[3],value);
    });
  });
  for(const [time,initial,expected] of [['18:00',false,0],['20:00',true,4]])await at(hour(time),async()=>{
    const db=consumDb({schedules:[everyDay]}),hw=hardware({3:initial});Object.assign(db.config,configConsum(1000));
    await withHandler(db,async(url,o)=>tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:await hw.call(o.method,new URL(url).pathname,o.body?JSON.parse(o.body):undefined)),async run=>{
      assert.equal((await run('programe_tick')).apeluri_tuya,expected);assert.equal(hw.states[3],false);
    });
  });
});

test('buget: fara programe frana 6h comuna sync/manual owner; o singura sondare concurenta; reluare dupa succes',async()=>at(now,async advance=>{
  const db=consumDb({schedules:[]});let calls=0,quota=true;db.owner=true;
  const fetch=async url=>{calls++;return quota?new Response(JSON.stringify({success:false,code:28841004,msg:'quota exhausted'})):tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:[])};
  await withHandler(db,fetch,async run=>{
    assert.equal((await run()).apeluri_tuya,1);assert.equal(calls,1);
    for(const action of ['sync','programe_tick','comanda']) {
      const r=await run(action,{dispozitiv_id:3,stare:false},action!=='comanda');
      assert.equal(r.apeluri_tuya,0);assert.match(r.error,/cota Tuya epuizata pana la/);
    }
    advance(6*3600000-1);assert.equal((await run()).apeluri_tuya,0);
    advance(1);calls=0;await Promise.all([run(),run(),run('programe_tick')]);assert.equal(calls,1);
    assert.equal(db.state.alerts.filter(a=>a.p_title==='Tuya: cota API epuizata').length,1);
  });
  // Worker nou: frana nu depinde de memoria cererii anterioare.
  await withHandler(db,fetch,async run=>{calls=0;assert.equal((await run()).apeluri_tuya,0);advance(6*3600000);quota=false;await run();assert.ok(calls>0);assert.equal(db.config.cota_blocata_pana,null)});
}));

test('buget: sondarea abandonata ramane blocata si un token vechi nu sterge frana noua',async()=>at(now,async()=>{
  const db=consumDb();db.config.cota_blocata_pana=new Date(now-1).toISOString();
  const {probe}=await rezervaApel(db,'off');assert.ok(probe);
  await assert.rejects(()=>rezervaApel(db,'owner'),/epuizata pana la/);
  const future=new Date(now+7*3600000).toISOString();
  await modificaConfig(db,c=>({...c,cota_sonda:null,cota_blocata_pana:future}));
  await confirmaSonda(db,probe);assert.equal(db.config.cota_blocata_pana,future);
}));

test('buget: consum UI prin actiune autorizata fara token Tuya sau secrete Tuya',async()=>at(now,async()=>{
  const db=consumDb();const rpc=db.rpc.bind(db);db.rpc=async(name,args)=>{assert.ok(!['TUYA_ACCESS_ID','TUYA_ACCESS_SECRET'].includes(args?.p_name));return rpc(name,args)};
  Object.assign(db.config,configConsum(900));db.config.cota_blocata_pana=new Date(now+3600000).toISOString();
  await withHandler(db,async()=>assert.fail('Nu se apeleaza Tuya'),async run=>{
    const r=await run('consum',{},false);assert.equal(r.ok,true);assert.equal(r.apeluri_tuya,0);
    assert.match(textConsumTuya(r.consum_tuya),/azi 0, ciclu 900 \/ 1000 - blocata pana la/);
    assert.ok(!JSON.stringify(r).includes('uids'));
  });
  assert.match(textCitireLumina(new Date(now).toISOString()),/^stare citita la/);
  assert.match(textCitireLumina('invalid'),/fara citire/);
}));

test('buget: 24h reale simulate prin handler, 0/solar/simulare weekend sub 1000 apeluri motor',async()=>{
  const start=oraLocala('2026-10-24','00:00');
  for(const scenario of ['zero','solar','simulare']) {
    const ids=scenario==='simulare'?[1,2,3,4,5]:[3];
    const schedule=scenario==='simulare'?{...p,tip:'simulare_prezenta',dispozitive:ids,parametri:{}}:p;
    const db=consumDb({schedules:scenario==='zero'?[]:[schedule],lights:ids.map(id=>({id,rol:scenario==='simulare'?'interior':'exterior'}))});
    const hw=hardware(Object.fromEntries(ids.map(id=>[id,false])));let calls=0,tokens=0,reads=0,posts=0;
    await withHandler(db,async(url,o)=>{
      calls++;const path=new URL(url).pathname;
      if(path==='/v1.0/token'){tokens++;return tuyaResult({access_token:'fake'})}
      if(o.method==='POST')posts++;else reads++;
      return tuyaResult(await hw.call(o.method,path,o.body?JSON.parse(o.body):undefined));
    },async run=>{
      for(let t=start;t<start+86400000;t+=300000)await at(t,async()=>{
        const r=await run('programe_tick');assert.equal(r.ok,true,JSON.stringify(r));
        assert.ok(Object.values(hw.states).filter(Boolean).length<=(scenario==='simulare'?2:1));
      });
    });
    assert.equal(calls,tokens+reads+posts);assert.ok(calls<1000,`${scenario}: ${calls}`);
    if(scenario==='zero')assert.equal(calls,0);
    if(scenario==='simulare')assert.ok(Object.values(hw.states).every(v=>!v));
    assert.equal(db.config.consum_ciclu_tuya?.n || 0,calls);
    console.log(`BUGET_24H ${scenario}: total=${calls}, token=${tokens}, status=${reads}, POST=${posts}`);
  }
});

test('buget: lumina ramasa ON dupa sfarsitul ferestrei se stinge in cel mult 15 minute',async()=>{
  const db=persistentDb({schedules:[everyDay]}),hw=hardware({3:true});let lastRead=hour('19:55');
  const tracked={call:async(...a)=>{if(a[0]==='GET')lastRead=Date.now();return hw.call(...a)}};
  await at(hour('19:55'),()=>tick(db,tracked));
  let firstOff=null;
  for(let t=hour('20:00');t<=hour('20:15');t+=300000)await at(t,async()=>{
    await tick(db,tracked);if(hw.states[3]===false && firstOff===null)firstOff=t;
  });
  assert.ok(firstOff!==null && firstOff-hour('20:00')<=15*60000);assert.ok(lastRead>=hour('20:00'));
});

test('buget: luminile neacoperite nu sunt citite si starea lor necunoscuta ocupa plafonul',async()=>at(soare('2026-10-24').apus+60000,async()=>{
  const sim={...p,tip:'simulare_prezenta',dispozitive:[3],parametri:{}};
  const db=persistentDb({schedules:[sim],lights:[1,2,3].map(id=>({id,rol:'interior'}))}),hw=hardware({1:false,2:false,3:false});const read=[];
  await executaLumini(db,async(...a)=>{if(a[0]==='GET')read.push(Number(a[1].match(/devices\/(\d+)/)[1]));return hw.call(...a)},{actiune:'programe_tick'},null);
  assert.deepEqual(read,[3]);assert.equal(hw.posts.length,0);
}));

test('buget: token esuat in retea este contorizat, refuzul local nu consuma apel',async()=>at(hour('12:00'),async()=>{
  const db=consumDb();let attempts=0;
  await withHandler(db,async()=>{attempts++;throw new Error('retea indisponibila')},async run=>{
    assert.equal((await run('programe_tick')).apeluri_tuya,1);
    assert.equal(db.config.consum_zi_tuya.n,1);assert.equal(db.config.consum_ciclu_tuya.n,1);
    Object.assign(db.config,configConsum(1000));
    assert.equal((await run('comanda',{dispozitiv_id:3,stare:true},false)).apeluri_tuya,0);
    assert.equal(db.config.consum_ciclu_tuya.n,1000);assert.equal(attempts,1);
  });
}));

test('buget: pragurile sunt reverificate intre token si status, fara ON dupa atingerea 100%',async()=>at(hour('18:00'),async()=>{
  const db=consumDb({schedules:[everyDay]});Object.assign(db.config,configConsum(999));let attempts=0;
  await withHandler(db,async url=>{attempts++;assert.equal(new URL(url).pathname,'/v1.0/token');return tuyaResult({access_token:'fake'})},async run=>{
    const r=await run('programe_tick');assert.equal(r.ok,false);assert.equal(r.apeluri_tuya,1);
    assert.equal(attempts,1);assert.equal(db.config.consum_ciclu_tuya.n,1000);
    assert.equal(db.state.logs.some(l=>l.eroare?.startsWith('POST urmeaza')),false);
  });
}));

test('buget: expirarea deadline in CAS nu lasa in contor un POST care nu a plecat',async()=>at(hour('12:00'),async advance=>{
  const db=consumDb(),from=db.from.bind(db),hw=hardware({3:true});let armed=false,attempts=0;
  const rpc=db.rpc.bind(db);
  db.rpc=async(name,args)=>{const r=await rpc(name,args);if(args?.p_actiune==='reserve')armed=true;return r};
  db.from=table=>{
    const q=from(table);
    if(table==='iot_integrari') {
      const update=q.update;
      q.update=patch=>{
        const result=update(patch);
        if(armed && patch.config?.consum_zi_tuya?.n>db.config.consum_zi_tuya?.n) {armed=false;advance(121000)}
        return result;
      };
    }
    return q;
  };
  await withHandler(db,async(url,o)=>{
    attempts++;return tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:await hw.call(o.method,new URL(url).pathname,o.body?JSON.parse(o.body):undefined));
  },async run=>{
    const r=await run('programe_tick');assert.equal(r.amanate_off.length,1);assert.equal(hw.posts.length,0);
    assert.equal(r.apeluri_tuya,2);assert.equal(db.config.consum_ciclu_tuya.n,attempts);assert.equal(db.config.consum_zi_tuya.n,attempts);
  });
}));

test('buget: 24h motor plus sync, exemplu explicit 4 senzori/prize si 8 camere = 988 apeluri',async()=>{
  const ids=[1,2,3,4,5],start=oraLocala('2026-10-24','00:00');
  const db=consumDb({schedules:[{...p,tip:'simulare_prezenta',dispozitive:ids,parametri:{}}],lights:ids.map(id=>({id,rol:'interior'}))});
  db.catalog=[...[10,11,12,13].map(id=>localDevice(id)),...Array.from({length:8},(_,i)=>localDevice(20+i,'camera'))];
  const hw=hardware(Object.fromEntries(ids.map(id=>[id,false])));let motor=0,sync=0,actual=0;
  await withHandler(db,async(url,o)=>{
    actual++;const path=new URL(url).pathname;
    if(path==='/v1.0/token')return tuyaResult({access_token:'fake'});
    if(path.includes('/users/'))return tuyaResult(db.catalog.map(d=>({id:d.extern_id,name:d.nume,category:d.meta.categorie,online:true})));
    if(path.includes('/devices/') && Number(path.match(/devices\/(\d+)/)[1])>=10)return tuyaResult([]);
    return tuyaResult(await hw.call(o.method,path,o.body?JSON.parse(o.body):undefined));
  },async run=>{
    for(let t=start;t<start+86400000;t+=300000)await at(t,async()=>{
      if((t-start)%600000===0){const r=await run();assert.equal(r.ok,true);sync+=r.apeluri_tuya}
      const r=await run('programe_tick');assert.equal(r.ok,true);motor+=r.apeluri_tuya;
    });
  });
  assert.equal(motor,824);assert.equal(sync,24*(1+4)+4*(3+8));
  assert.equal(actual,988);assert.equal(db.config.consum_ciclu_tuya.n,988);
  console.log(`BUGET_24H combinat exemplu: motor=${motor}, sync=${sync}, total=${actual}`);
});

test('buget: programul invalid ramane semnalat chiar daca adaptiv nu are nicio lumina de citit',async()=>at(now,async()=>{
  const db=persistentDb({schedules:[{...p,parametri:{offset_pornire:999}}]});
  const r=await executaLumini(db,async()=>assert.fail('Program invalid fara citiri Tuya'),{actiune:'programe_tick'},null);
  assert.equal(r.ok,false);assert.match(r.erori[0],/Parametri program invalizi/);
  assert.equal(db.state.alerts[0].p_title,'Lumini sediu: parametri program invalizi');
}));

test('buget: sondarea reusita tine concurentii blocati pana la raspuns, apoi reia transportul',async()=>at(now,async()=>{
  const db=consumDb();db.owner=true;
  db.config.cota_blocata_pana=new Date(now-1).toISOString();
  let releaseProbe,enteredProbe,attempts=0;
  const entered=new Promise(resolve=>{enteredProbe=resolve});
  const response=new Promise(resolve=>{releaseProbe=resolve});
  await withHandler(db,async url=>{
    attempts++;
    if(attempts===1) {enteredProbe();await response}
    return tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:[]);
  },async run=>{
    const first=run();
    await entered;
    try {
      assert.equal(attempts,1);
      const concurrent=await Promise.all([
        run(),run('programe_tick'),run('comanda',{dispozitiv_id:3,stare:false},false),
      ]);
      for(const r of concurrent) {
        assert.equal(r.apeluri_tuya,0);
        assert.match(r.error,/cota Tuya epuizata pana la/);
      }
      assert.equal(attempts,1);
    } finally {releaseProbe()}
    const result=await first;
    assert.equal(result.ok,true);
    assert.equal(db.config.cota_blocata_pana,null);
    assert.equal(db.config.cota_sonda,null);
    assert.equal(result.apeluri_tuya,attempts);
    assert.equal(db.config.consum_ciclu_tuya.n,attempts);
  });
}));

test('runda3 P1-1: economie, OFF confirmat 20:10, ON extern 20:11 se stinge pana la 20:40',async()=>{
  const db=consumDb({schedules:[everyDay],lights:[{id:3,rol:'exterior'},{id:4,rol:'exterior'}]}),hw=hardware({3:false,4:true});
  Object.assign(db.config,configConsum(950));const reads=[];
  await withHandler(db,async(url,o)=>{
    const path=new URL(url).pathname;
    if(path==='/v1.0/token')return tuyaResult({access_token:'fake'});
    assert.ok(!path.includes('/devices/4/'),'Lumina neacoperita nu consuma apeluri');
    if(o.method==='GET')reads.push(Date.now());
    return tuyaResult(await hw.call(o.method,path,o.body?JSON.parse(o.body):undefined));
  },async run=>{
    await at(hour('20:10'),async()=>assert.equal((await run('programe_tick')).ok,true));
    await at(hour('20:11'),async()=>{hw.states[3]=true});
    for(let t=hour('20:15');t<hour('20:40');t+=300000)await at(t,async()=>{
      assert.equal((await run('programe_tick')).apeluri_tuya,0);assert.equal(hw.states[3],true);
    });
    await at(hour('20:40'),async()=>{assert.equal((await run('programe_tick')).ok,true);assert.equal(hw.states[3],false)});
  });
  assert.equal(reads[1],hour('20:40'));assert.equal(hw.states[4],true);
});

test('runda3 P1-2: programe aprobate => o sonda la 30 min, owner blocat intre sonde, alerta stabila dedup',async()=>at(now,async advance=>{
  const db=consumDb();db.owner=true;let attempts=0;
  await withHandler(db,async()=>{attempts++;return new Response(JSON.stringify({success:false,code:28841004,msg:'quota exhausted'}))},async run=>{
    await run('programe_tick');assert.equal(attempts,1);
    assert.equal(Date.parse(db.config.cota_blocata_pana)-Date.now(),30*60000);
    const title='Tuya: cota API epuizata';
    const notices=()=>db.state.alerts.filter(a=>a.p_title===title);
    assert.equal(notices().length,1);
    assert.ok(notices()[0].p_message.includes('Tuya indisponibila: luminile nu mai pot fi comandate din ERP; stinge manual din aplicatia Smart Life daca e nevoie'));
    for(let minute=5;minute<30;minute+=5){advance(300000);assert.equal((await run('comanda',{dispozitiv_id:3,stare:false},false)).apeluri_tuya,0)}
    advance(300000);const before=attempts;
    await Promise.all([run('programe_tick'),run('comanda',{dispozitiv_id:3,stare:false},false),run()]);
    assert.equal(attempts-before,1);assert.equal(notices().length,1);
    assert.equal(Date.parse(db.config.cota_blocata_pana)-Date.now(),30*60000);
  });
}));

test('runda3 P1-2: aprobarea unui program scurteaza frana veche de 6h',async()=>at(now,async advance=>{
  const db=consumDb({schedules:[]});
  await withHandler(db,async()=>new Response(JSON.stringify({success:false,code:28841004})),async run=>{
    await run();assert.equal(Date.parse(db.config.cota_blocata_pana)-Date.now(),6*3600000);
    db.schedules.push(p);advance(300000);
    assert.equal((await run('programe_tick')).apeluri_tuya,0);
    assert.equal(Date.parse(db.config.cota_blocata_pana)-Date.now(),30*60000);
    advance(300000);await run('programe_tick');
    assert.equal(Date.parse(db.config.cota_blocata_pana)-Date.now(),25*60000,'Nu se amana la fiecare tick');
  });
}));

test('runda3 P1-3: handler real, 13 lumini (6+6+1), status 9.5s, max 3 HTTP, OFF in cel mult 3 tick-uri',async()=>{
  // Crypto nativ foloseste thread-pool real; ceasul virtual modeleaza doar latenta HTTP.
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto'),originalCrypto=globalThis.crypto;
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{randomUUID:()=>originalCrypto.randomUUID(),subtle:{
    digest:async()=>new ArrayBuffer(32),importKey:async()=>({}),sign:async()=>new ArrayBuffer(32),
  }}});
  try {
  const ids=Array.from({length:13},(_,i)=>i+1);
  const schedules=[ids.slice(0,6),ids.slice(6,12),ids.slice(12)].map((dispozitive,i)=>({...everyDay,id:i+1,dispozitive}));
  const db=consumDb({schedules,lights:ids.map(id=>({id,rol:'exterior',last:true}))});
  db.catalog=db.rows.map(l=>l.iot_dispozitive);
  const hw=hardware(Object.fromEntries(ids.map(id=>[id,true])));let active=0,maximum=0,attempts=0,wait,start;
  await withHandler(db,async(url,o)=>{
    assert.ok(db.state.lease);active++;maximum=Math.max(maximum,active);attempts++;
    const path=new URL(url).pathname;
    if(path==='/v1.0/token'){active--;return tuyaResult({access_token:'fake'})}
    // Inclusiv POST + recitire lente, mai sever decat scenariul din brief.
    await wait(9500);active--;
    if(o.method==='POST')assert.ok(Date.now()-start<140000);
    return tuyaResult(await hw.call(o.method,path,o.body?JSON.parse(o.body):undefined));
  },async run=>{
    for(let n=0;n<3 && Object.values(hw.states).some(Boolean);n++)await at(hour('21:00')+n*300000,async advance=>{
      start=Date.now();wait=timpSimulat(advance);
      await run('programe_tick');assert.ok(Date.now()-start<=140000,`Tick ${n}: ${Date.now()-start}ms`);assert.equal(db.state.lease,null);
    });
  });
  assert.equal(maximum,3);assert.ok(Object.values(hw.states).every(v=>!v));
  assert.equal(hw.posts.length,13);assert.equal(db.config.consum_ciclu_tuya.n,attempts);
  } finally {Object.defineProperty(globalThis,'crypto',descriptor)}
});

test('runda3 P2: lista din cache pastreaza dispozitive/n, fara HTTP Tuya',async()=>at(now,async advance=>{
  const db=consumDb();db.catalog=[localDevice(10)];let attempts=0;
  await withHandler(db,async url=>{
    attempts++;
    return tuyaResult(new URL(url).pathname==='/v1.0/token'?{access_token:'fake'}:db.catalog.map(d=>({id:d.extern_id,name:d.nume,category:d.meta.categorie,product_name:d.meta.model,online:d.ultima_citire.online})));
  },async run=>{
    const first=await run('lista');assert.equal(first.ok,true);assert.equal(first.n,1);
    const before=attempts;advance(60000);
    const cached=await run('lista');assert.equal(cached.ok,true);assert.equal(cached.n,first.n);
    assert.deepEqual(cached.dispozitive,first.dispozitive);assert.equal(cached.apeluri_tuya,0);assert.equal(attempts,before);
  });
}));

test('runda3 P1-3: catalogul de sase lumini nu poate creste prin rolurile/RPC existente',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261113a_iot_programe_lumini.sql',import.meta.url),'utf8');
  assert.match(sql,/REVOKE ALL ON public.iot_lumini,.*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql,/GRANT SELECT ON public.iot_lumini,/);
  assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|ALL)[^;]*ON public.iot_lumini[\s,]/);
  const rpc=sql.slice(sql.indexOf('CREATE FUNCTION public.iot_lumini_salveaza'),sql.indexOf('-- Lease globala'));
  assert.doesNotMatch(rpc,/INSERT INTO public.iot_lumini\s*\(/);
  const seed=sql.slice(sql.indexOf('-- SEED CONFIRMAT'),sql.indexOf('ALTER TABLE public.iot_lumini'));
  assert.equal([...seed.matchAll(/\(\d+,'(?:interior|exterior|mixt)'\)/g)].length,6);
});

test('runda3 P1-3: refuzul de cota cu trei statusuri in zbor nu admite lotul urmator',async()=>at(hour('12:00'),async()=>{
  const ids=[1,2,3,4,5,6],db=consumDb({lights:ids.map(id=>({id,rol:'exterior'})),schedules:[{...p,dispozitive:ids}]});
  let release,entered,reads=0,attempts=0;
  const barrier=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{entered=resolve});
  await withHandler(db,async(url,o)=>{
    attempts++;const path=new URL(url).pathname;
    if(path==='/v1.0/token')return tuyaResult({access_token:'fake'});
    assert.equal(o.method,'GET');const n=++reads;if(reads===3)entered();await barrier;
    return n===1?new Response(JSON.stringify({success:false,code:28841004})):tuyaResult([{code:'switch_1',value:true}]);
  },async run=>{
    const tickResult=run('programe_tick');
    await ready;assert.equal(reads,3);release();
    assert.equal((await tickResult).ok,false);assert.equal(attempts,4);
    assert.equal(db.config.consum_ciclu_tuya.n,4);assert.equal(db.state.lease,null);
  });
}));
