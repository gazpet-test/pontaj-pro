// Fara dependente sau retea: node --test scripts/test_lumini_node.mjs (Node 24).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soare, oraLocala, planSimulare, evalueaza, confirma, decide } from '../supabase/functions/tuya/lumini_logica.ts';
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
    const program={...p,tip,dispozitive:[1],parametri:{pornire:'18:00',oprire:'23:30',zile:[6]}};
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
  const pending=evalueaza(p,now,{3:true},settings,{fereastra:first.runtime.fereastra,lumini:{3:{aprins:false,manual:false,pending:true}}});
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
