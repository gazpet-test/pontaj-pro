// Buget local masurat: fiecare incercare HTTP, inclusiv token si raspuns refuzat.
const H6 = 6 * 3600000;
const M30 = 30 * 60000;
// Coada comuna: inclusiv POST/recitiri trec prin aceleasi rezervari CAS.
export function limiteazaTransport(trimite:any, maxim=3) {
  let active=0;
  const coada:any[]=[];
  const porneste=()=>{
    while(active<maxim && coada.length) {
      const {args,resolve,reject}=coada.shift();active++;
      Promise.resolve().then(()=>trimite(...args)).then(resolve,reject).finally(()=>{active--;porneste();});
    }
  };
  return (...args:any[])=>new Promise<any>((resolve,reject)=>{coada.push({args,resolve,reject});porneste();});
}
export async function adapteazaFrana(db:any, programeActive:boolean) {
  if(!programeActive) return;
  const cfg=await configTuya(db);
  if(cfg.cota_blocata_pana && !cfg.cota_sonda && cfg.cota_interval_ms!==M30) {
    await modificaConfig(db,(c:any)=>c.cota_blocata_pana && !c.cota_sonda && c.cota_interval_ms!==M30 ?
      {...c,cota_interval_ms:M30,cota_blocata_pana:new Date(Math.min(Date.parse(c.cota_blocata_pana),Date.now()+M30)).toISOString()}:null);
  }
}
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
  if(s.procent>=.9 && !['off','owner','manual','tranzitie','program'].includes(scop)) throw new Error('Tuya in mod economie: citirea periodica neacoperita este oprita');
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
export async function rezervaApel(db:any, scop:string, programeActive=false) {
  let probe:string|null=null;
  const cfg=await modificaConfig(db,(cfg:any)=>{
    const s=verificaBuget(cfg,scop);
    // Primul apel dupa blocare rezerva singur sondarea. Un worker mort lasa frana activa.
    if(cfg.cota_blocata_pana) {
      probe=crypto.randomUUID(); cfg.cota_sonda=probe;
      cfg.cota_interval_ms=programeActive?M30:H6;
      cfg.cota_blocata_pana=new Date(Date.now()+cfg.cota_interval_ms).toISOString();
    }
    cfg.consum_zi_tuya={zi:s.zi,n:s.azi+1};
    cfg.consum_ciclu_tuya={ciclu_start:s.ciclu_start,n:s.n+1};
    return cfg;
  });
  if(stareBuget(cfg).procent>=.7) await notificaBuget(db,'Tuya: consum API la 70% din cota','Consumul masurat a trecut de 70%. La 90% se opreste sync, programele se verifica la 30 minute sau la tranzitii; la 100% raman OFF si comenzile ownerului. Ramanem pe gratuit: reduceti programele si asteptati reinnoirea cotei pe 6.');
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
export async function blocheazaCota(db:any, code:any, msg:any, programeActive=false) {
  const interval=programeActive?M30:H6;
  const cfg=await modificaConfig(db,(cfg:any)=>({...cfg,cota_sonda:null,cota_interval_ms:interval,cota_blocata_pana:new Date(Date.now()+interval).toISOString()}));
  const message=`cota Tuya epuizata pana la ${cfg.cota_blocata_pana}`;
  await notificaBuget(db,'Tuya: cota API epuizata',`Cod ${code}: ${String(msg || '').slice(0,300)}. ${message}. Apelurile sunt oprite ${programeActive?'30 minute':'6 ore'}, apoi o singura sondare. Tuya indisponibila: luminile nu mai pot fi comandate din ERP; stinge manual din aplicatia Smart Life daca e nevoie. Ramanem pe gratuit; asteptati reinnoirea pe 6 si reduceti consumul.`);
  return message;
}
