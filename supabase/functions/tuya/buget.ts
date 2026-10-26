// Buget local masurat: fiecare incercare HTTP, inclusiv token si raspuns refuzat.
const H6 = 6 * 3600000;
export function stareBuget(config: any, now = Date.now()) {
  const zi = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const [y,m,d] = zi.split('-').map(Number);
  const start = new Date(Date.UTC(y,m-1-(d<6?1:0),6)).toISOString().slice(0,10);
  const buget = Number.isSafeInteger(config.buget_ciclu_tuya) && config.buget_ciclu_tuya>0 ? config.buget_ciclu_tuya : 45000;
  const n = config.consum_ciclu_tuya?.ciclu_start===start ? Math.max(0,Number(config.consum_ciclu_tuya.n)||0) : 0;
  const azi = config.consum_zi_tuya?.zi===zi ? Math.max(0,Number(config.consum_zi_tuya.n)||0) : 0;
  return {zi,ciclu_start:start,azi,n,buget,procent:n/buget,stare:Date.parse(config.cota_blocata_pana)>now?'blocata':n>=buget?'doar_off':n>=buget*.9?'economie':'ok',cota_blocata_pana:config.cota_blocata_pana || null};
}
export async function configTuya(db: any) {
  const r=await db.from('iot_integrari').select('config').eq('cheie','tuya').maybeSingle();
  if(r.error || !r.data?.config) throw new Error('Config Tuya indisponibila; apel oprit');
  return r.data.config;
}
export async function modificaConfig(db: any, fn: any) {
  for(let i=0;i<16;i++) {
    const old=await configTuya(db), next=fn(structuredClone(old));
    if(!next) return null;
    const r=await db.from('iot_integrari').update({config:next}).eq('cheie','tuya').eq('config',JSON.stringify(old)).select('config').maybeSingle();
    if(r.error) throw new Error('Config Tuya nesalvata; apel oprit');
    if(r.data) return next;
  }
  throw new Error('Config Tuya ocupata; apel oprit');
}
export function verificaBuget(config: any, scop: string, now=Date.now()) {
  const s=stareBuget(config,now);
  if(s.stare==='blocata') throw Object.assign(new Error(`cota Tuya epuizata pana la ${s.cota_blocata_pana}`),{cotaTuya:true});
  if(s.procent>=1 && !['off','owner'].includes(scop)) throw new Error('Buget Tuya 100%: doar OFF si comenzi manuale ale ownerului');
  if(s.procent>=.9 && !['off','owner','manual','tranzitie'].includes(scop)) throw new Error('Tuya in mod economie: citirea periodica este oprita');
  return s;
}
export async function notificaBuget(db:any, title:string, message:string) {
  const recent=await db.from('notifications').select('id').eq('type','error').eq('title',title).gt('created_at',new Date(Date.now()-86400000).toISOString()).limit(1);
  if(recent.error || recent.data?.length) return;
  const key=title==='Tuya: cota API epuizata'?'cota_alerta_tuya_la':'buget_alerta_tuya_la';
  const reserved=await modificaConfig(db,(cfg:any)=>{
    if(Date.parse(cfg[key])>Date.now()-600000) return null;
    return {...cfg,[key]:new Date().toISOString()};
  });
  if(!reserved) return;
  const notice=await db.rpc('iot_alerta',{p_type:'error',p_title:title,p_message:message,p_link:'/cladire'});
  if(notice.error) await modificaConfig(db,(cfg:any)=>cfg[key]===reserved[key]?{...cfg,[key]:null}:null);
}
export async function rezervaApel(db:any, scop:string) {
  let probe:string|null=null;
  const cfg=await modificaConfig(db,(cfg:any)=>{
    const s=verificaBuget(cfg,scop);
    // Primul apel dupa blocare rezerva singur sondarea. Un worker mort lasa frana activa.
    if(cfg.cota_blocata_pana) {
      probe=crypto.randomUUID(); cfg.cota_sonda=probe;
      cfg.cota_blocata_pana=new Date(Date.now()+H6).toISOString();
    }
    cfg.consum_zi_tuya={zi:s.zi,n:s.azi+1};
    cfg.consum_ciclu_tuya={ciclu_start:s.ciclu_start,n:s.n+1};
    return cfg;
  });
  if(stareBuget(cfg).procent>=.7) await notificaBuget(db,'Tuya: consum API la 70% din cota','Consumul masurat a trecut de 70%. La 90% se opresc sync si citirile periodice; la 100% raman OFF si comenzile ownerului. Ramanem pe gratuit: reduceti programele si asteptati reinnoirea cotei pe 6.');
  return {probe,zi:cfg.consum_zi_tuya.zi,ciclu_start:cfg.consum_ciclu_tuya.ciclu_start};
}
export async function anuleazaApel(db:any, rezervare:any) {
  // Daca plafonul temporal expira in timpul CAS-ului, nu a existat incercare HTTP.
  await modificaConfig(db,(cfg:any)=>{
    if(cfg.consum_zi_tuya?.zi===rezervare.zi) cfg.consum_zi_tuya={...cfg.consum_zi_tuya,n:Math.max(0,cfg.consum_zi_tuya.n-1)};
    if(cfg.consum_ciclu_tuya?.ciclu_start===rezervare.ciclu_start) cfg.consum_ciclu_tuya={...cfg.consum_ciclu_tuya,n:Math.max(0,cfg.consum_ciclu_tuya.n-1)};
    return cfg;
  });
}
export async function confirmaSonda(db:any, probe:string|null) {
  if(probe) await modificaConfig(db,(cfg:any)=>cfg.cota_sonda===probe?{...cfg,cota_sonda:null,cota_blocata_pana:null}:null);
}
export async function blocheazaCota(db:any, code:any, msg:any) {
  const cfg=await modificaConfig(db,(cfg:any)=>({...cfg,cota_sonda:null,cota_blocata_pana:new Date(Date.now()+H6).toISOString()}));
  const message=`cota Tuya epuizata pana la ${cfg.cota_blocata_pana}`;
  await notificaBuget(db,'Tuya: cota API epuizata',`Cod ${code}: ${String(msg || '').slice(0,300)}. ${message}. Apelurile sunt oprite 6 ore, apoi o singura sondare. Ramanem pe gratuit; asteptati reinnoirea pe 6 si reduceti consumul.`);
  return message;
}
