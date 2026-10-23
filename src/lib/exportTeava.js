import XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import { tipStoc, categorieStare, metri } from './izoStoc.js'

export const TIPURI_EXPORT = { t71:'Țeavă 7,1 mm (12 m)', t88:'Țeavă 8,8 mm', t6m:'Țeavă 6 m', curba:'Curbe' }
export const VERIFICARE = ['Găsit DA/NU', 'Lungime măsurată (m)', 'Serie corectă DA/NU', 'Observații verificare']
const gol = v => v == null ? '' : v
const nr = v => v === '' || v == null || !Number.isFinite(Number(v)) ? '' : Number(v)
const round = v => Math.round((v + Number.EPSILON) * 1000) / 1000
const dataRO = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.split('-').reverse().join('.') : ''
const luni = ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie']
const kgAfisat = (bucati, total) => bucati.some(b => !['anulata','taiata'].includes(b.stare) && nr(b.greutate_kg) !== '') ? total.kg : ''

/** Paginare pe cheie până la pagina GOALĂ, inclusiv când API întoarce mai puțin de limită. */
export async function citestePagini(citeste) {
  const randuri = new Map()
  let ultim = 0
  for (;;) {
    const { data, error } = await citeste(ultim)
    if (error) throw error
    if (!data?.length) return [...randuri.values()]
    const urmator = data[data.length - 1].id
    if (BigInt(urmator) <= BigInt(ultim)) throw new Error('Paginarea registrului nu avansează.')
    for (const r of data) randuri.set(String(r.id), r)
    ultim = urmator
  }
}

/** Locul curent, ca în matricea ecranului; originea nu duplică piesa într-un depozit. */
export function locExport(b, depozite = [], tronsoane = []) {
  // Locul real, nu doar starea (Copilot r1): o piesă pierdută / carantinată pe tronson rămâne la tronsonul ei.
  const peTronson = ['pe_tronson','montat'].includes(categorieStare(b.stare)) || (b.tronson_id != null && b.depozit_id == null)
  const id = peTronson ? b.tronson_id : b.depozit_id
  const loc = (peTronson ? tronsoane : depozite).find(x => String(x.id) === String(id))
  const tip = peTronson ? 'tronson' : 'depozit'
  return { cheie:`${tip}:${id ?? '?'}`, tip, id, nume:loc?.name || loc?.cod || `${peTronson ? 'Tronson' : 'Depozit'} necunoscut`, cod:loc?.cod_3litere || loc?.cod || String(id ?? 'necunoscut') }
}

export function grupeazaExport(bucati, { depozite = [], tronsoane = [], mod = 'cumulat', depozitId = '', tronsonId = '' } = {}) {
  const grupe = new Map()
  for (const b of bucati) {
    if (b.stare === 'anulata') continue
    const loc = locExport(b, depozite, tronsoane)
    if (['depozit','depozite'].includes(mod) && loc.tip !== 'depozit') continue
    if (['tronson','tronsoane'].includes(mod) && loc.tip !== 'tronson') continue
    if (mod === 'depozit' && (!depozitId || String(loc.id) !== String(depozitId))) continue
    if (mod === 'tronson' && (!tronsonId || String(loc.id) !== String(tronsonId))) continue
    const tip = tipStoc(b), key = `${loc.cheie}|${tip}`
    if (!grupe.has(key)) grupe.set(key, { loc, tip, bucati:[] })
    grupe.get(key).bucati.push(b)
  }
  return [...grupe.values()].sort((a,b) => a.loc.cheie.localeCompare(b.loc.cheie, 'ro', { numeric:true }) || Object.keys(TIPURI_EXPORT).indexOf(a.tip) - Object.keys(TIPURI_EXPORT).indexOf(b.tip))
}

export function totalExport(bucati) {
  const t = { bucati:0, metri:0, kg:0, kgLipsa:0 }
  for (const b of bucati) {
    if (b.stare === 'anulata') continue
    t.bucati++
    // Părintele tăiat e istoric: nici metrii, nici greutatea lui nu se adună din nou peste copii (Copilot r1).
    if (b.stare === 'taiata') continue
    t.metri += metri(b)
    const kg = nr(b.greutate_kg)
    if (kg === '') t.kgLipsa++
    else t.kg += kg
  }
  t.metri = round(t.metri); t.kg = round(t.kg)
  return t
}

const PIPE = ['POZ.','SERIE UNICĂ DE IDENTIFICARE','DESCRIERE','ȘARJĂ','M [kg]','NR. AVIZ','DATA AVIZ','CANT. AVIZ','U.M.','NR. NRCD','DATA PV','CANT. REC.','ANUL PV','LUNA PV','GESTIUNE','DT / OS','AVIZ NR.','TRONSON','SERIE','CANTITATE','DEBITARE','CANT. ÎN DM','DATA','OBSERVAȚII','NR. PV']
const BEND = ['POZ.','SERIE DE IDENTIFICARE','DESCRIERE','ȘARJĂ','M [kg]','NR. AVIZ','DATA AVIZ','CANT. (buc.)','DATA RECEPȚIE','CANT. REC.','ANUL REC.','LUNA REC.','GESTIUNE','DT / OS','DESCRIERE','DATA','NR. AVIZ ÎNSOȚIRE','DATA','CANT.','SERIE','TR','KM/KM','NR.','DATA','OBSERVAȚII']
// Lățimile modelului Jupânești standard, respectiv Topleț Curbe (coloane implicite: 8,88671875).
const PIPE_WIDTHS = [5.109375,12.6640625,52.5546875,8.77734375,6.109375,11.6640625,10.44140625,9.109375,5.6640625,8.21875,10.77734375,6.88671875,5.6640625,10,8.109375,22.33203125,9.77734375,6.5546875,12.77734375,9.5546875,9,8.5546875,10.88671875,22,10]
const BEND_WIDTHS = [6.21875,8.77734375,40.109375,8.88671875,8.88671875,11.77734375,11.5546875,7.5546875,9.5546875,8.88671875,8.88671875,8.88671875,8.88671875,8.88671875,18,11,11.33203125,11.88671875,6,8.88671875,6.33203125,8.88671875,8.88671875,9.5546875,22]

export function randExport(b, poz, documente = [], tronsoane = []) {
  const a = b.atribute || {}, curba = b.tip_cod === 'curba'
  // aviz_intrare_id este FK E3; a.document_id e păstrat în atributele piesei de aceeași migrare.
  const docId = b.aviz_intrare_id ?? a.document_id
  const d = documente.find(x => String(x.id) === String(docId) && x.stare === 'confirmat' && String(x.proiect_id) === String(b.proiect_id))
  const pv = d ? { nr:d.pv_nr, data:d.pv_data } : docId == null ? (a.pv_receptie || {}) : {}
  const dataPv = dataRO(pv.data), an = dataPv ? Number(pv.data.slice(0,4)) : '', luna = dataPv ? luni[Number(pv.data.slice(5,7))-1] : ''
  const cantAviz = curba ? 1 : b.lungime_aviz_mm == null ? '' : Number(b.lungime_aviz_mm) / 1000
  // O bucată rezultată din tăiere nu a fost recepționată separat pe PV-ul rădăcinii.
  const lungimeRec = b.lungime_masurata_mm ?? b.lungime_aviz_mm
  const cantRec = dataPv && b.parinte_id == null ? (curba ? 1 : lungimeRec == null ? '' : Number(lungimeRec) / 1000) : ''
  const ies = a.aviz_iesire || {}
  const tr = tronsoane.find(x => String(x.id) === String(b.tronson_id))?.cod || ''
  const descriere = a.descriere || a.specificatie || [curba ? 'Curbă' : 'Țeavă', b.dimensiune, b.perete_mm != null ? `perete ${String(b.perete_mm).replace('.',',')} mm` : '', curba && b.unghi_curba != null ? `${b.unghi_curba}°` : '', b.grad_otel, b.standard].filter(Boolean).join(' · ')
  const baza = [poz, gol(b.serie), descriere, gol(b.sarja), nr(b.greutate_kg), gol(d?.nr_document ?? b.nr_document), dataRO(d?.data_document ?? b.data_receptie), cantAviz]
  // Datele/numerele absente nu se deduc din starea piesei sau din data exportului.
  if (curba) return [...baza, dataPv, cantRec, an, luna, gol(a.gestiune ?? b.lot), gol(a.dt_os), a.decizie === 'primit_neconform' ? gol(a.motiv) : '', '', gol(ies.nr), dataRO(ies.data), '', gol(ies.serie), tr, '', gol(pv.nr), dataPv, gol(b.observatii)]
  // DOAR layout-ul standard a importat NRCD în pv_receptie.nr. Topleț 7,1 și E3 au număr PV separat.
  const nrcdStandard = ['TEAVA 7.1 MM','TEAVA 8.8 MM','8,8 TOPLET','7.1 X 6ML'].includes(a.sursa?.foaie)
  return [...baza, gol(b.um), docId == null && nrcdStandard ? gol(pv.nr) : '', dataPv, cantRec, an, luna, gol(a.gestiune ?? b.lot), gol(a.dt_os), gol(ies.nr), tr, gol(ies.serie), '', '', '', dataRO(ies.data), gol(b.observatii), docId == null && nrcdStandard ? '' : gol(pv.nr)]
}

const border = Object.fromEntries(['top','bottom','left','right'].map(k => [k, { style:'thin', color:{ rgb:'777777' } }]))
const merge = (r,c,r2,c2) => ({ s:{ r,c }, e:{ r:r2,c:c2 } })
function stilizeaza(ws, rows, header, totalRow, headerRows = 2) {
  for (let r=0;r<rows.length;r++) for (let c=0;c<rows[r].length;c++) {
    const key = XLSX.utils.encode_cell({r,c})
    ws[key] ||= { t:'s', v:'' }
    ws[key].s = { font:{ name:'Arial', sz:10, bold:r < header+headerRows || r === totalRow }, alignment:{ vertical:'center', wrapText:true }, ...(r >= header ? { border } : {}), ...(r >= header && r < header+headerRows ? { fill:{ fgColor:{rgb:'E8EEF4'} }, alignment:{ horizontal:'center', vertical:'center', wrapText:true } } : {}) }
    if (ws[key].t === 'n') ws[key].z = Number.isInteger(ws[key].v) ? '0' : '0.000'
  }
}

export function construiesteFoaie(grupa, { proiect = {}, documente = [], tronsoane = [], verificare = false } = {}) {
  const curba = grupa.tip === 'curba', headers = [...(curba ? BEND : PIPE), ...(verificare ? VERIFICARE : [])]
  const n = headers.length, rows = Array.from({length:12}, () => Array(n).fill(''))
  // Pozițiile titlurilor și antetului sunt cele ale modelului standard (A6 / A7 / A9 / A11:A12).
  const nume = proiect.nume || ''
  const second = nume.match(/\(inclusiv[\s\S]*?\)/i)
  rows[5][0] = second ? nume.replace(second[0],'').trim() : nume
  rows[6][0] = second?.[0] || ''
  rows[8][0] = curba ? (/^OS\b/i.test(grupa.loc.nume) ? grupa.loc.nume : `OS ${grupa.loc.nume}`) : `LIVRĂRI ${grupa.loc.nume}`
  if (verificare) rows[9][0] = `Verifică: ____________________ · ${grupa.loc.nume} · ${grupa.bucati.length} bucăți · găsit, lungime măsurată, serie corectă și observații.`
  const merges = [merge(5,0,5,n-1),merge(6,0,6,n-1),merge(8,0,8,n-1)]
  if (verificare) merges.push(merge(9,0,9,n-1))
  const groups = curba ? [[14,15,'NECONFORMITĂȚI'],[16,18,'AVIZ DE ÎNSOȚIRE'],[22,23,'P-V']] : [[16,19,'LIVRATĂ ÎN TRONSON']]
  for (let c=0;c<n;c++) {
    const g = groups.find(([start,end]) => c >= start && c <= end)
    if (curba && c >= 19 && c <= 21) rows[11][c] = headers[c]
    else if (g) { rows[11][c] = headers[c]; if (c === g[0]) { rows[10][c] = g[2]; merges.push(merge(10,g[0],10,g[1])) } }
    else { rows[10][c] = headers[c]; merges.push(merge(10,c,11,c)) }
  }
  for (const [i,b] of grupa.bucati.entries()) rows.push([...randExport(b,i+1,documente,tronsoane), ...(verificare ? ['','','',''] : [])])
  const t = totalExport(grupa.bucati), total = Array(n).fill('')
  total[0] = 'TOTAL'; total[1] = `${t.bucati} bucăți`; total[2] = `${t.metri} m`; total[4] = kgAfisat(grupa.bucati,t)
  rows.push(total)
  rows.push([`Totaluri din valorile cunoscute; greutate lipsă: ${t.kgLipsa} bucăți. Metri și kg fără părinții tăiați; bucăți anulate excluse. Cantitățile de ieșire lipsesc din atributele registrului.`, ...Array(n-1).fill('')])
  merges.push(merge(rows.length-1,0,rows.length-1,n-1))
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!merges'] = merges
  ws['!cols'] = [...(curba ? BEND_WIDTHS : PIPE_WIDTHS), ...(verificare ? [11.83203125,13.83203125,13.83203125,40.83203125] : [])].map(width => ({width}))
  ws['!rows'] = rows.map((_,i) => ({hpt:i===5 ? 36 : i===9 && verificare ? 30 : i===10 || i===11 ? 32 : i===rows.length-1 ? 30 : 24}))
  ws['!freezeRows'] = 12
  stilizeaza(ws,rows,10,rows.length-2)
  return ws
}

function numeFoaie(nume, folosite) {
  const baza = nume.replace(/[\\/?*\[\]:]/g,' ').replace(/^'+|'+$/g,'').trim() || 'Loc'
  let n = baza.slice(0,31), i=1
  while (folosite.has(n.toLowerCase())) { const suffix=` (${++i})`; n=baza.slice(0,31-suffix.length)+suffix }
  folosite.add(n.toLowerCase()); return n
}

export function construiesteWorkbook(bucati, opt = {}) {
  const grupe = grupeazaExport(bucati,opt)
  if (!grupe.length) return null
  const wb = XLSX.utils.book_new(), folosite = new Set()
  if ((opt.mod || 'cumulat') === 'cumulat') {
    const rows = [['Loc','Tip','Bucăți','Metri','Kg cunoscute','Bucăți fără kg']]
    for (const g of grupe) { const t=totalExport(g.bucati); rows.push([g.loc.nume,TIPURI_EXPORT[g.tip],t.bucati,t.metri,kgAfisat(g.bucati,t),t.kgLipsa]) }
    const toate=grupe.flatMap(g=>g.bucati), t=totalExport(toate)
    rows.push(['TOTAL','',t.bucati,t.metri,kgAfisat(toate,t),t.kgLipsa])
    const ws=XLSX.utils.aoa_to_sheet(rows)
    stilizeaza(ws,rows,0,rows.length-1,1)
    ws['!cols']=[32,26,12,16,18,22].map(wch=>({wch})); ws['!freezeRows']=1
    XLSX.utils.book_append_sheet(wb,ws,numeFoaie('Sumar',folosite))
  }
  for (const g of grupe) XLSX.utils.book_append_sheet(wb,construiesteFoaie(g,opt),numeFoaie(`${g.loc.tip === 'tronson' ? 'TR ' : ''}${g.loc.cod} ${TIPURI_EXPORT[g.tip]}`,folosite))
  return wb
}

/** xlsx-js-style 1.2 nu serializează panouri înghețate; completăm OOXML cu JSZip deja instalat. */
export async function serializeazaWorkbook(wb) {
  const zip = await JSZip.loadAsync(XLSX.write(wb,{type:'array',bookType:'xlsx'}))
  for (const [i,name] of wb.SheetNames.entries()) {
    const y=wb.Sheets[name]['!freezeRows']
    if (!y) continue
    const path=`xl/worksheets/sheet${i+1}.xml`
    const xml=await zip.file(path).async('string')
    const view=`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${y}" topLeftCell="A${y+1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${y+1}" sqref="A${y+1}"/></sheetView></sheetViews>`
    zip.file(path, /<sheetViews[\s\S]*?<\/sheetViews>/.test(xml) ? xml.replace(/<sheetViews[\s\S]*?<\/sheetViews>/,view) : xml.replace(/(<sheetFormatPr|<cols|<sheetData)/,view+'$1'))
  }
  return zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'})
}

export function numeFisier(proiect, loc, data = new Date()) {
  const clean = v => String(v || '').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim().replace(/[. ]+$/g,'').slice(0,80)
  const zi = [data.getFullYear(),String(data.getMonth()+1).padStart(2,'0'),String(data.getDate()).padStart(2,'0')].join('-')
  return `${clean(proiect.cod_intern || proiect.nume || proiect.id || 'PROIECT')}_${clean(loc)}_${zi}.xlsx`
}
