// Logica pura. Toate momentele sunt UTC; calendarul foloseste Europe/Bucharest.
export const TZ = 'Europe/Bucharest';
const MIN = 60000, DAY = 86400000, rad = Math.PI / 180;
export function dataLocala(acum: Date | string | number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(acum));
}
export function oraLocala(data: string, ora: string) {
  const target = Date.parse(`${data}T${ora.length === 5 ? ora + ':00' : ora}Z`);
  let t = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(t));
    t += target - Date.parse(parts.replace(' ', 'T') + 'Z');
  }
  return t;
}
export const altaZi = (zi: string, n: number) => new Date(Date.parse(zi + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
// NOAA: ecuatia timpului si declinatia solara, zenit oficial 90.833 grade.
export function soare(zi: string, lat = 44.94, lon = 26.03) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Coordonate invalide');
  const midnight = Date.parse(zi + 'T00:00:00Z');
  const n = (midnight - Date.UTC(new Date(midnight).getUTCFullYear(), 0, 1)) / DAY + 1;
  const g = 2 * Math.PI / 365 * (n - 1);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2*g) - 0.040849 * Math.sin(2*g));
  const dec = 0.006918 - 0.399912*Math.cos(g) + 0.070257*Math.sin(g) - 0.006758*Math.cos(2*g) + 0.000907*Math.sin(2*g) - 0.002697*Math.cos(3*g) + 0.00148*Math.sin(3*g);
  const c = Math.cos(90.833*rad)/(Math.cos(lat*rad)*Math.cos(dec)) - Math.tan(lat*rad)*Math.tan(dec);
  if (Math.abs(c) > 1) throw new Error('Fara rasarit/apus pentru aceasta data');
  const h = Math.acos(c)/rad*4, noon = 720 - 4*lon - eq;
  return { rasarit: midnight + (noon-h)*MIN, apus: midnight + (noon+h)*MIN };
}
export function aleator(seed: string) {
  let s = 2166136261;
  for (const c of seed) s = Math.imul(s ^ c.charCodeAt(0), 16777619);
  return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function planSimulare(seed: string, ids: number[], start: number, end: number) {
  const rand = aleator(seed), plan: { dispozitiv_id: number; start: number; end: number }[] = [];
  let t = start;
  while (ids.length && t + 20*MIN <= end) {
    const shuffled = [...ids].map(id => ({ id, r: rand() })).sort((a,b) => a.r-b.r);
    const count = ids.length > 1 && rand() < 0.35 ? 2 : 1;
    const duration = Math.min(20 + Math.floor(rand()*71), Math.floor((end-t)/MIN))*MIN;
    for (const { id } of shuffled.slice(0,count)) plan.push({ dispozitiv_id: id, start: t, end: t+duration });
    t += duration + (5+Math.floor(rand()*26))*MIN;
  }
  return plan;
}
export function fereastra(program: any, zi: string, setari: any) {
  const p = program.parametri || {}, sun = soare(zi, Number(setari.lat ?? 44.94), Number(setari.lon ?? 26.03));
  if (program.tip === 'solar') return { start: sun.apus + Number(p.offset_pornire || 0)*MIN, end: soare(altaZi(zi,1), Number(setari.lat ?? 44.94), Number(setari.lon ?? 26.03)).rasarit + Number(p.offset_oprire || 0)*MIN, eligible: true };
  const start = program.tip === 'simulare_prezenta' ? sun.apus : oraLocala(zi, p.pornire || '18:00');
  let end = oraLocala(zi, p.sfarsit || setari.simulare_pana_la || '23:30');
  if (program.tip === 'orar') { end = oraLocala(zi, p.oprire || '23:30'); if (end <= start) end = oraLocala(altaZi(zi,1), p.oprire || '23:30'); }
  const day = new Date(zi+'T12:00:00Z').getUTCDay();
  const eligible = program.tip === 'orar' ? (p.zile || [0,1,2,3,4,5,6]).includes(day) : day === 0 || day === 6 || p.explicit === true || Boolean(setari.vacanta_de && setari.vacanta_pana && zi >= setari.vacanta_de && zi <= setari.vacanta_pana);
  return { start, end, eligible };
}
// runtime este serializabil si persistat de apelant. Nu preluam lumini deja aprinse.
export function evalueaza(program: any, acum: Date | string | number, stari: Record<string, boolean | null>, setari: any, anterior: any = {}) {
  const t = +new Date(acum), zi = dataLocala(t), p = program.parametri || {};
  const candidates = [-1,0,1].map(n => ({ zi: altaZi(zi,n), ...fereastra(program,altaZi(zi,n),setari) }));
  const win = candidates.find(w => w.eligible && t >= w.start && t < w.end);
  const enabled = program.activ === true && Boolean(program.aprobat_de) && Boolean(program.aprobat_la);
  const key = enabled && win ? `${program.id}:${program.aprobat_la}:${win.zi}` : null;
  const runtime = JSON.parse(JSON.stringify(anterior || {}));
  const comenzi: { dispozitiv_id: number; stare: boolean }[] = [];
  runtime.lumini ||= {};
  for (const [id, value] of Object.entries(runtime.lumini) as any) {
    if (typeof stari[id] !== 'boolean') continue;
    if (typeof value.pending === 'boolean') {
      if (stari[id] === value.pending) { value.ultima=value.pending; value.aprins=value.pending; }
      delete value.pending;
    }
    if (typeof value.ultima === 'boolean' && value.ultima !== stari[id]) value.manual = true;
  }
  if (runtime.fereastra !== key) {
    for (const [id,v] of Object.entries(runtime.lumini) as any) if (v.aprins && !v.manual && stari[id] === true) comenzi.push({ dispozitiv_id: Number(id), stare: false });
    // Nu resetam proprietatea inainte sa confirme apelantul stingerea.
    if (comenzi.length || Object.entries(runtime.lumini).some(([id,v]:any) => v.aprins && !v.manual && typeof stari[id] !== 'boolean')) return { comenzi, runtime };
    runtime.lumini = {}; runtime.fereastra = key;
  }
  if (!key || !win) return { comenzi, runtime };
  const ids = (program.dispozitive || []).filter((id: number) => setari.roluri?.[id] && (program.tip !== 'simulare_prezenta' || ['interior','mixt'].includes(setari.roluri[id])) && (program.tip !== 'solar' || ['exterior','mixt'].includes(setari.roluri[id])));
  const plan = program.tip === 'simulare_prezenta' ? planSimulare(`${win.zi}:${program.id}`,ids,win.start,win.end) : null;
  for (const id of ids) {
    if (typeof stari[id] !== 'boolean') continue;
    const v = runtime.lumini[id] ||= { aprins: false, manual: false };
    if (v.manual) continue;
    const desired = plan ? plan.some(x => x.dispozitiv_id === id && t >= x.start && t < x.end) : true;
    if (desired && !stari[id]) comenzi.push({ dispozitiv_id:id, stare:true });
    if (!desired && v.aprins && stari[id]) comenzi.push({ dispozitiv_id:id, stare:false });
  }
  comenzi.sort((a,b)=>Number(a.stare)-Number(b.stare));
  if(program.tip==='simulare_prezenta') {
    let on=Object.entries(stari).filter(([id,value])=>value===true && ['interior','mixt'].includes(setari.roluri?.[id])).length;
    return {comenzi:comenzi.filter(c=>{if(!c.stare){on--;return true}if(on>=2)return false;on++;return true}),runtime};
  }
  return { comenzi, runtime };
}
export function confirma(runtime: any, id: number, stare: boolean) {
  runtime.lumini ||= {}; runtime.lumini[id] = { ...(runtime.lumini[id] || {}), ultima: stare, aprins: stare };
  return runtime;
}
export const decide = (program: any, acum: any, stari: any, setari: any) => evalueaza(program,acum,stari,setari,setari.runtime?.[program.id]).comenzi;
export function urmatoarele(program: any, acum: any, setari: any) {
  const t = +new Date(acum), zi = dataLocala(t);
  const windows = Array.from({length:9},(_,i)=>({zi:altaZi(zi,i-1),...fereastra(program,altaZi(zi,i-1),setari)})).filter(w=>w.eligible);
  if(program.tip==='simulare_prezenta') {
    const ids=(program.dispozitive || []).filter((id:number)=>['interior','mixt'].includes(setari.roluri?.[id]));
    const plan=windows.flatMap(w=>planSimulare(`${w.zi}:${program.id}`,ids,w.start,w.end));
    return {pornire:plan.map(w=>w.start).filter(x=>x>t).sort((a,b)=>a-b)[0] ?? null,oprire:plan.map(w=>w.end).filter(x=>x>t).sort((a,b)=>a-b)[0] ?? null};
  }
  return { pornire: windows.map(w=>w.start).filter(x=>x>t).sort((a,b)=>a-b)[0] ?? null, oprire: windows.map(w=>w.end).filter(x=>x>t).sort((a,b)=>a-b)[0] ?? null };
}
