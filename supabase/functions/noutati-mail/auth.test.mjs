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
function fixture({secret=synthetic,userError=false,profileError=false,isOwner=false,readError=false,rows=[]}={}) {
 const calls={queue:0,fetch:0,auth:0,profile:0}
 const createClient=()=>({auth:{getUser:async()=>{calls.auth++;return {data:{user:{id:'synthetic-id'}},error:userError}}},from:(name)=>{
  if(name==='profiles'){calls.profile++;return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{is_owner:isOwner},error:profileError})})})}}
  calls.queue++;return {select:()=>({is:()=>({order:async()=>({data:rows,error:readError})})}),update:()=>({eq:async()=>({error:null})})}
 }})
 const env=name=>name==='NOUTATI_SECRET'?secret:name==='RESEND_API_KEY'?'synthetic-provider-token':'http://localhost'
 const fetcher=async()=>{calls.fetch++;return new Response('{}',{status:200})}
 return {calls,handle:createHandler({createClient,env,fetcher})}
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
