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
export const avertismentAcoperire = 'Luminile ies din acoperire și nu mai sunt atinse, inclusiv cele rămase aprinse.'
export function textAmanareLumini(setari, dispozitivId, programId) {
  return (setari?.runtime?.motor?.amanate || []).some(a=>a.motiv==='plafon_comun_2' &&
    (dispozitivId==null || a.dispozitiv_id===dispozitivId) && (programId==null || a.program_id===programId))
    ? 'amânat: plafon comun' : ''
}
export const confirmareSetariLumini = (a,b) => setariSchimbaProgramarea(a,b)
  ? `Schimbarea programării dezactivează toate programele până la reaprobare. ${avertismentAcoperire} Continui?`
  : 'Salvezi pauza manuală? Aprobările, programele și pauzele deja începute se păstrează.'

export const textStareLumina = (citire, cititLa, acum = Date.now(), consum = null) => {
  if(typeof citire?.pornit==='boolean' && (consum?.procent>=.9 || ['economie','doar_off','blocata'].includes(consum?.stare))) return `${citire.pornit?'Pornită':'Oprită'} - ultima stare cunoscută (citire veche: economie/cotă)`
  if (!cititLa || !Number.isFinite(Date.parse(cititLa)) || acum-Date.parse(cititLa)>15*60000 || typeof citire?.pornit!=='boolean') return 'Stare necunoscută / citire veche'
  return citire.pornit ? 'Pornită' : 'Oprită'
}
export const dispozitiveImplicite = (lumini, tip) => lumini.filter(l=>l.activ && (tip==='solar' ? l.rol==='exterior' : tip==='simulare_prezenta' ? ['interior','mixt'].includes(l.rol) : true)).map(l=>l.dispozitiv_id)
export const poateSelectaLumina = (lumina, tip) => lumina.activ && (tip!=='simulare_prezenta' || lumina.rol!=='exterior') && (tip!=='solar' || lumina.rol!=='interior')
export const formatMomentLumini = t => t == null ? '-' : new Intl.DateTimeFormat('ro-RO',{timeZone:'Europe/Bucharest',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(t))
export const textCitireLumina = t => t && Number.isFinite(Date.parse(t)) ? `stare citită la ${formatMomentLumini(t)}` : 'stare fără citire disponibilă'
export function textConsumTuya(consum) {
  if(!consum) return 'Consum Tuya indisponibil'
  const stare=consum.stare==='blocata' ? `blocată până la ${formatMomentLumini(consum.cota_blocata_pana)}` :
    consum.stare==='doar_off' ? 'buget 100%: doar oprire și comenzi manuale ale proprietarului' : consum.stare
  return `Consum Tuya: azi ${consum.azi}, ciclu ${consum.n} / ${consum.buget} - ${stare}`
}
export function textUrmatoare(program, acum, setari, lumini) {
  if(!program.activ || !program.aprobat_de || !program.aprobat_la) return 'Inactiv - necesită aprobarea proprietarului pentru activare'
  try {
    const next=urmatoarele(program,acum,{...setari,roluri:Object.fromEntries(lumini.map(l=>[l.dispozitiv_id,l.rol]))})
    return `Următoarea aprindere dorită: ${formatMomentLumini(next.pornire)}; stingere dorită: ${formatMomentLumini(next.oprire)} (ora României)`
  } catch { return 'Program invalid - verificați coordonatele și orele' }
}
