import test from 'node:test'
import assert from 'node:assert/strict'
import { authorized } from './auth.ts'
import { createHandler } from './handler.ts'
const synthetic = 'test-only-not-a-real-secret-0000'
const req = (headers = {}, method = 'POST') => new Request('http://localhost/test', { method, headers })
for (const configured of [undefined, '', 'short', ' '.repeat(24), ' ' + synthetic]) {
 test(`fail closed invalid configuration ${JSON.stringify(configured)}`, async () => {
  assert.equal(await authorized(req({'x-noutati-secret': configured || ''}), configured, async()=>false), false)
 })
}
test('exact synthetic secret works; missing, mismatched and longer values fail', async()=>{
 for(const value of ['',synthetic+'x',synthetic.slice(0,-1),'X'+synthetic.slice(1)])
  assert.equal(await authorized(req({'x-noutati-secret':value}),synthetic,async()=>false),false)
 assert.equal(await authorized(req({'x-noutati-secret':synthetic}),synthetic,async()=>{throw Error('must not call owner')}),true)
})
test('owner fallback requires strict Bearer syntax and verified boolean true', async()=>{
 for(const header of ['', 'Basic token', 'token', 'Bearer a b'])
  assert.equal(await authorized(req({authorization:header}),undefined,async()=>true),false)
 assert.equal(await authorized(req({authorization:'Bearer test-token'}),undefined,async()=>true),true)
 assert.equal(await authorized(req({authorization:'Bearer test-token'}),undefined,async()=>false),false)
 assert.equal(await authorized(req({authorization:'Bearer test-token'}),undefined,async()=>{throw Error('unavailable')}),false)
})
function fixture({secret=synthetic,userError=false,profileError=false,isOwner=false,readError=false,rows=[],
 user=null,throwAuth=false,throwProfile=false,resend=true,claimError=false,send}={}) {
 const calls={queue:0,fetch:0,auth:0,profile:0};const payloads=[];const clients=[];const claimed=new Set()
 const createClient=(_url,key)=>{clients.push(key);return {auth:{getUser:async(jwt)=>{calls.auth++;
  if(throwAuth)throw Error('auth offline')
  return {data:{user:user === false ? null : {id:'synthetic-id'}},error:userError || ['expired','malformed','anon'].includes(jwt)}
 }},from:(name)=>{
  if(name==='profiles'){calls.profile++;return {select:()=>({eq:()=>({maybeSingle:async()=>{
   if(throwProfile)throw Error('db offline');return {data:{is_owner:isOwner},error:profileError}
  }})})}}
  calls.queue++;return {
   select:()=>({is:()=>({order:async()=>({data:[...rows],error:readError})})}),
   update:(value)=>({eq:(_key,id)=>({is:(key,expected)=>({select:()=>({maybeSingle:async()=>{
    assert.equal(key,'trimis_la');assert.equal(expected,null);assert.ok(value.trimis_la)
    if(claimError)return {data:null,error:true}
    if(claimed.has(id))return {data:null,error:null}
    claimed.add(id);return {data:{id},error:null}
   }})})})})
  }
 }}}
 const env=name=>name==='NOUTATI_SECRET'?secret:name==='RESEND_API_KEY'?(resend?'synthetic-provider-token':undefined):name==='SUPABASE_SERVICE_ROLE_KEY'?'synthetic-service-role':name==='SUPABASE_ANON_KEY'?'synthetic-anon':'http://localhost'
 const fetcher=async(_url,options)=>{calls.fetch++;payloads.push(JSON.parse(options.body));return send?send(calls.fetch):new Response('{}',{status:200})}
 return {calls,payloads,clients,claimed,handle:createHandler({createClient,env,fetcher})}
}
test('unauthorized HTTP path never queries queue or sends',async()=>{
 const f=fixture();const r=await f.handle(req());assert.equal(r.status,401);assert.deepEqual(f.calls,{queue:0,fetch:0,auth:0,profile:0})
 assert.equal((await r.text()).includes(synthetic),false)
})
test('OPTIONS and GET do not send',async()=>{
 const f=fixture();assert.equal((await f.handle(req({},'OPTIONS'))).status,200);assert.equal((await f.handle(req({},'GET'))).status,405);assert.equal(f.calls.queue,0)
})
test('owner errors and non-owner fail closed before queue',async()=>{
 for(const options of [{userError:true,isOwner:true},{profileError:true,isOwner:true},{isOwner:false}]){
  const f=fixture(options);assert.equal((await f.handle(req({authorization:'Bearer test-token'}))).status,401);assert.equal(f.calls.queue,0);assert.equal(f.calls.fetch,0)
 }
})
test('valid secret or owner can process empty queue without email',async()=>{
 for(const headers of [{'x-noutati-secret':synthetic},{authorization:'Bearer test-token'}]){
  const f=fixture({isOwner:true});const r=await f.handle(req(headers));assert.equal(r.status,200);assert.equal((await r.json()).procesate,0);assert.equal(f.calls.fetch,0)
 }
})
test('queue failure is not misreported as empty success',async()=>{
 const f=fixture({readError:true});assert.equal((await f.handle(req({'x-noutati-secret':synthetic}))).status,503);assert.equal(f.calls.fetch,0)
})

const row=(id=1)=>({id,titlu:'<script>&\r\nTitlu',descriere:'<tag> & text',destinatari:['test@example.invalid']})
test('mail payload is escaped, UTF-8 and subject has no CR/LF',async()=>{
 const f=fixture({rows:[row()]});const r=await f.handle(req({'x-noutati-secret':synthetic}));assert.equal((await r.json()).rezultate[1],'trimis')
 const p=f.payloads[0];assert.match(p.html,/&lt;script&gt;&amp;/);assert.match(p.html,/&lt;tag&gt; &amp; text/)
 assert.match(p.html,/Nout\u0103\u021bi \u00een/);assert.match(p.html,/\u00centreb\u0103ri \u2192 R\u0103zvan/)
 assert.doesNotMatch(p.html+p.subject,/[\u00c3\u00c4\u00c8]|\u00f0\u0178|\ufffd/);assert.doesNotMatch(p.subject,/[\r\n]/)
})
test('no mail on all authorization refusals',async()=>{
 const cases=[ [{},{}], [{'x-noutati-secret':'wrong'},{}], [{authorization:'Bearer anon'},{}],
  [{authorization:'Bearer expired'},{}], [{authorization:'Bearer malformed'},{}], [{authorization:'Basic token'},{}],
  [{authorization:'Bearer test-token'},{isOwner:false}], [{authorization:'Bearer test-token'},{user:false,isOwner:true}],
  [{authorization:'Bearer test-token'},{userError:true,isOwner:true}], [{authorization:'Bearer test-token'},{profileError:true,isOwner:true}],
  [{authorization:'Bearer test-token'},{throwAuth:true,isOwner:true}], [{authorization:'Bearer test-token'},{throwProfile:true,isOwner:true}] ]
 for(const [headers,options] of cases){const f=fixture({...options,rows:[row()]});assert.equal((await f.handle(req(headers))).status,401);assert.equal(f.calls.fetch,0);assert.equal(f.calls.queue,0);assert.equal(f.clients.includes('synthetic-service-role'),false)}
})
test('one service client only after owner or secret authorization',async()=>{
 for(const headers of [{authorization:'Bearer test-token'},{'x-noutati-secret':synthetic}]){const f=fixture({isOwner:true,rows:[row()]});assert.equal((await f.handle(req(headers))).status,200);assert.equal(f.clients.filter(x=>x==='synthetic-service-role').length,1)}
})
test('concurrent snapshots claim each id only once',async()=>{
 const f=fixture({rows:[row(1),row(2)]});await Promise.all([f.handle(req({'x-noutati-secret':synthetic})),f.handle(req({'x-noutati-secret':synthetic}))]);assert.equal(f.calls.fetch,2);assert.equal(f.claimed.size,2)
})
test('provider errors retain claim and continue subsequent rows',async()=>{
 for(const send of [n=>n===1?Promise.reject(Error('network')):new Response('{}'),n=>n===1?{text:async()=>{throw Error('stream')},ok:true}:new Response('{}'),n=>new Response('{}',{status:n===1?422:200})]){
  const f=fixture({rows:[row(1),row(2)],send});const j=await (await f.handle(req({'x-noutati-secret':synthetic}))).json()
  assert.match(j.rezultate[1],/^eroare_(retea_furnizor|furnizor_422)$/);assert.equal(j.rezultate[2],'trimis');assert.equal(f.claimed.size,2)
  await f.handle(req({'x-noutati-secret':synthetic}));assert.equal(f.calls.fetch,2)
 }
})
test('empty recipients or failed claim never send',async()=>{
 for(const recipients of [null,[],[''],'  ']){const f=fixture({rows:[{...row(),destinatari:recipients}]});const j=await (await f.handle(req({'x-noutati-secret':synthetic}))).json();assert.equal(j.rezultate[1],'destinatari_goi');assert.equal(f.calls.fetch,0);assert.equal(f.claimed.size,0)}
 const f=fixture({rows:[row()],claimError:true});assert.equal((await (await f.handle(req({'x-noutati-secret':synthetic}))).json()).rezultate[1],'eroare_claim');assert.equal(f.calls.fetch,0)
})
test('missing provider configuration fails before queue',async()=>{
 const f=fixture({resend:false,rows:[row()]});assert.equal((await f.handle(req({'x-noutati-secret':synthetic}))).status,503);assert.equal(f.calls.queue,0);assert.equal(f.calls.fetch,0)
})
