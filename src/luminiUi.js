import { urmatoarele } from '../supabase/functions/tuya/lumini_logica.ts'

// Formularul pastreaza campurile celorlalte tipuri doar local, nu le trimite RPC-ului.
export function programPentruSalvare(form) {
  const keys={solar:['offset_pornire','offset_oprire'],orar:['pornire','oprire','zile'],simulare_prezenta:['sfarsit','explicit']}[form.tip] || []
  return {...form,parametri:Object.fromEntries(keys.filter(k=>form.parametri?.[k]!==undefined).map(k=>[k,form.parametri[k]]))}
}

// Aceleasi valori tipizate ca in SQL; pauza nu invalideaza programarea.
export function setariSchimbaProgramarea(a,b) {
  return ['lat','lon'].some(k=>Number(a[k])!==Number(b[k])) ||
    ['vacanta_de','vacanta_pana'].some(k=>(a[k] || null)!==(b[k] || null)) ||
    (a.simulare_pana_la?.length===5?a.simulare_pana_la+':00':a.simulare_pana_la)!==
    (b.simulare_pana_la?.length===5?b.simulare_pana_la+':00':b.simulare_pana_la)
}
export const avertismentAcoperire = 'Luminile ies din acoperire si nu mai sunt atinse, inclusiv cele ramase aprinse.'
export const confirmareSetariLumini = (a,b) => setariSchimbaProgramarea(a,b)
  ? `Schimbarea programarii dezactiveaza toate programele pana la reaprobare. ${avertismentAcoperire} Continui?`
  : 'Salvezi pauza manuala? Aprobarile, programele si pauzele deja incepute se pastreaza.'

export const textStareLumina = (citire, cititLa, acum = Date.now()) => {
  if (!cititLa || !Number.isFinite(Date.parse(cititLa)) || acum-Date.parse(cititLa)>15*60000 || typeof citire?.pornit!=='boolean') return 'Stare necunoscuta / citire veche'
  return citire.pornit ? 'Pornita' : 'Oprita'
}
export const dispozitiveImplicite = (lumini, tip) => lumini.filter(l=>l.activ && (tip==='solar' ? l.rol==='exterior' : tip==='simulare_prezenta' ? ['interior','mixt'].includes(l.rol) : true)).map(l=>l.dispozitiv_id)
export const poateSelectaLumina = (lumina, tip) => lumina.activ && (tip!=='simulare_prezenta' || lumina.rol!=='exterior') && (tip!=='solar' || lumina.rol!=='interior')
export const formatMomentLumini = t => t == null ? '-' : new Intl.DateTimeFormat('ro-RO',{timeZone:'Europe/Bucharest',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t))
export function textUrmatoare(program, acum, setari, lumini) {
  if(!program.activ || !program.aprobat_de || !program.aprobat_la) return 'Inactiv - necesita aprobarea ownerului pentru activare'
  try {
    const next=urmatoarele(program,acum,{...setari,roluri:Object.fromEntries(lumini.map(l=>[l.dispozitiv_id,l.rol]))})
    return `Urmatoarea aprindere dorita: ${formatMomentLumini(next.pornire)}; stingere dorita: ${formatMomentLumini(next.oprire)} (ora Bucuresti)`
  } catch { return 'Program invalid - verificati coordonatele si orele' }
}
