import { altaZi, dataLocala, evalueaza, fereastra, parametriValizi, planSimulare } from './lumini_logica.ts';

export function planCitire(programe:any[], setari:any, runtime:any, now=Date.now()) {
  const active=programe.filter(p=>p.activ && p.aprobat_de && p.aprobat_la);
  const ids=new Set<number>(), dorite:any={}, tranzitii:number[]=[], erori:any[]=[];
  for(const p of active) {
    const r=evalueaza(p,now,{},setari);
    if(r.eroare) erori.push({id:p.id,eroare:r.eroare});
    for(const [id,value] of Object.entries(r.dorite)) {ids.add(Number(id));dorite[id]=value;}
    if(!parametriValizi(p)) continue;
    try {
      for(const delta of [-1,0,1]) {
        const zi=altaZi(dataLocala(now),delta),w=fereastra(p,zi,setari);
        if(!w.eligible) continue;
        tranzitii.push(w.start,w.end);
        if(p.tip==='simulare_prezenta') tranzitii.push(...planSimulare(`${zi}:${p.id}`,Object.keys(r.dorite).map(Number),w.start,w.end).flatMap(x=>[x.start,x.end]));
      }
    } catch { /* Motorul raporteaza separat parametrii invalizi. */ }
  }
  for(const [id,until] of Object.entries(runtime.pauze || {})) {
    if(Number(until)>now) ids.add(Number(id));
    if(Number.isFinite(Number(until))) tranzitii.push(Number(until));
  }
  const aproape=tranzitii.some(t=>Math.abs(t-now)<15*60000);
  // Metadate in obiectul existent: RPC-ul aplicat accepta doar cinci chei motor.
  const meta=runtime.citiri_esuate?._adaptiv || {};
  const configuratie=Object.fromEntries(['lat','lon','simulare_pana_la','vacanta_de','vacanta_pana','roluri'].map(k=>[k,setari[k]]));
  const semnatura=JSON.stringify({active,setari:configuratie,ids:[...ids].sort((a,b)=>a-b)});
  const expirat=!Number.isFinite(meta.ultima_completa) || now-meta.ultima_completa>=15*60000 || meta.semnatura!==semnatura;
  return {ids:[...ids],dorite,aproape,citeste:ids.size>0 && (aproape || expirat || meta.reverifica===true),semnatura,erori};
}
