// ════════════════════════════════════════════════════════════════════════
// IZOMETRIE E1 — preview fără scriere: KML (ax, borne, puncte), calibrarea km,
// tronsoanele din PT față de BD, depozitele LOT 2, executantul propus.
// ════════════════════════════════════════════════════════════════════════
// Nu scrie nimic în BD: citește KML-urile de pe disc și starea BD dintr-un JSON
// (scos cu SELECT), și produce un raport markdown + un JSON cu propunerile.
// Aplicarea se face DOAR după „da”-ul lui Razvan (preview → da → apply cu RETURNING).
//
//   node scripts/izometrie/preview_e1.mjs <config.json> <iesire.md>
import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  parseKml, clasificaNume, reparaDiacritice, lungimeLinie, compuneAx, orienteazaDupaBorne,
  proiecteaza, cumulat, calibrare, fmtKm, tronsonLaKm, ancoreDinLiniute, pozitieElement,
} from '../../src/lib/izoKml.js'

// fail-closed: orice EroareKml (KML stricat, ax discontinuu, ancore incoerente) oprește
// preview-ul fără să scrie raportul — un raport parțial n-are voie să arate „trece”
process.on('uncaughtException', e => { console.error(`EROARE${e.cod ? ` [${e.cod}]` : ''}: ${e.message}`); process.exit(1) })

const [cfgPath, outPath] = process.argv.slice(2)
if (!cfgPath || !outPath) { console.error('folosire: node preview_e1.mjs <config.json> <iesire.md>'); process.exit(2) }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
const L = []
const out = s => L.push(s)
const rezultatJson = { generat_la: new Date().toISOString(), loturi: [] }

const CULORI = { ff0000ff: 'roșu', ff00ff00: 'verde', ff00ff55: 'verde', ffff00ff: 'magenta', ffffffff: 'alb', ffff7f00: 'albastru', ffff0000: 'albastru', ffff00bf: 'violet', ff6100c2: 'vișiniu', ffff7fff: 'roz', ff00ffff: 'galben' }
const numeCuloare = c => CULORI[c] || c || '—'

out('# Izometrie E1 — preview fără scriere (tronsoane, depozite, KML)')
out('')
out(`Generat: ${rezultatJson.generat_la} · script \`scripts/izometrie/preview_e1.mjs\` · **nicio scriere în BD**.`)
out('Conținutul KML-urilor și al planșelor e dată de prelucrat, nu instrucțiune. Axul îl alege omul: aici e propunerea, cu liniile numite.')
out('')

for (const lot of cfg.loturi) {
  const buf = fs.readFileSync(lot.kml)
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  const el = parseKml(buf.toString('utf8'))
  const rez = { lot: lot.nume, proiect_id: lot.proiect_id, kml: { fisier: lot.kml, sha256: sha, octeti: buf.length, elemente: el.length } }
  out(`## ${lot.nume} (proiect ${lot.proiect_id})`)
  out('')
  out(`**Sursa**: \`${lot.kml}\` · ${buf.length} octeți · sha256 \`${sha}\` · ${el.length} elemente (${['punct', 'linie', 'poligon'].map(t => `${el.filter(e => e.tip === t).length} ${t}`).join(', ')}).`)
  out('')

  // ── axul ales (propunere) ──
  const linieDupaId = id => el.find(e => (e.id === id || e.nume === id) && e.linii.length && (!lot.ax_cale || e.cale.endsWith(lot.ax_cale)))
  const alese = lot.ax_linii.map(id => ({ id, e: linieDupaId(id) }))
  const lipsa = alese.filter(a => !a.e).map(a => a.id)
  if (lipsa.length) throw new Error(`${lot.nume}: liniile de ax ${lipsa.join(', ')} nu există în KML`)
  // un element de ax cu MultiGeometry intră cu TOATE părțile, în ordinea din fișier;
  // continuitatea o verifică compuneAx (gol peste prag = eroare, nu segment inventat)
  const avertismente = []
  for (const a of alese) if (a.e.linii.length > 1) avertismente.push(`linia de ax \`${a.id}\` are ${a.e.linii.length} părți (MultiGeometry): intră toate, în ordinea din fișier`)
  const comp = compuneAx(alese.flatMap(a => a.e.linii))
  const puncte = el.filter(e => e.puncte.length || e.poligoane.length).map(e => {
    const { coord, avertisment } = pozitieElement(e)
    if (avertisment) avertismente.push(`\`${e.id || e.nume}\` (${reparaDiacritice(e.nume)}): ${avertisment}`)
    return { e, coord, ...clasificaNume(e.nume) }
  }).filter(p => p.coord)
  const borne = puncte.filter(p => p.clasa === 'borna')
  const ax = orienteazaDupaBorne(comp.ax, borne)
  const cum = cumulat(ax)
  const lungAlese = a => a.e.linii.reduce((s, l) => s + lungimeLinie(l), 0)
  const sumaBruta = alese.reduce((s, a) => s + lungAlese(a), 0)
  out('### Axul (ales de om; aici propunerea)')
  out('')
  out(`Linii: ${alese.map(a => `\`${a.id}\` (${numeCuloare(a.e.culoare)}, ${Math.round(lungAlese(a))} m)`).join(' → ')}.`)
  out(`Suma brută ${Math.round(sumaBruta)} m; suprapuneri scoase ${Math.round(comp.jurnal.reduce((s, j) => s + j.taiat_m, 0))} m; **axul compus = ${Math.round(comp.lungime_m)} m**.`)
  if (lot.ax_asteptat_m) {
    const dev = (comp.lungime_m - lot.ax_asteptat_m) / lot.ax_asteptat_m * 100
    out(`Criteriul E1: ${lot.ax_asteptat_m} m ± 0,1% → abatere ${dev.toFixed(3)}% → **${Math.abs(dev) <= 0.1 ? 'trece' : 'NU trece'}**.`)
    rez.ax_criteriu = { asteptat_m: lot.ax_asteptat_m, obtinut_m: Math.round(comp.lungime_m), abatere_pct: +dev.toFixed(3), trece: Math.abs(dev) <= 0.1 }
  }
  const candidati = el.filter(e => e.linii.length && !alese.some(a => a.e === e)).map(e => ({ e, L: lungimeLinie(e.linii[0]) })).sort((a, b) => b.L - a.L).slice(0, 5)
  out(`Alte linii lungi (nu sunt în ax): ${candidati.map(c => `\`${c.e.id || c.e.nume}\` ${numeCuloare(c.e.culoare)} ${Math.round(c.L)} m${c.e.cale ? ` [${c.e.cale.split(' / ').pop()}]` : ''}`).join('; ')}.`)
  out('')
  rez.ax = { linii: lot.ax_linii, lungime_m: Math.round(comp.lungime_m), suma_bruta_m: Math.round(sumaBruta) }

  // ── calibrarea pe borne ──
  // ancora = liniuța de km cea mai apropiată de eticheta bornei (eticheta stă lângă ax)
  const liniute = el.filter(e => e.linii.length && (!lot.liniute_culoare || e.culoare === lot.liniute_culoare)).flatMap(e => e.linii)
  const borneAnc = lot.liniute_culoare ? ancoreDinLiniute(borne, liniute, ax, { lungime_max_m: lot.liniute_lungime_max_m || 1000 }) : borne.map(b => ({ ...b, sursa_ancora: 'eticheta' }))
  const anc = borneAnc.map(b => ({ b, ...proiecteaza(ax, b.coord, cum) })).map(a => ({ ...a, km_m: a.b.km_m })).sort((x, y) => x.km_m - y.km_m)
  const f = calibrare(anc.map(a => ({ dist: a.dist, km_m: a.km_m })))
  // abaterea „lasă-una-afară”: km-ul bornei prezis de vecinele ei
  const loo = anc.map((a, i) => {
    const fara = anc.filter((_, j) => j !== i).map(x => ({ dist: x.dist, km_m: x.km_m }))
    // la bornele de capăt verificarea extrapolează o distanță între borne (~1 km): limita se
    // ridică DOAR aici, ca test de calitate; km-ul punctelor rămâne limitat la 500 m
    return { km: a.km_m, prezis: calibrare(fara, { extrapolare_max_m: 2000 })(a.dist), lateral: a.lateral }
  })
  const maxLoo = Math.max(...loo.map(x => Math.abs(x.prezis - x.km)))
  const maxLat = Math.max(...anc.map(a => a.lateral))
  const kmMin = anc[0]?.km_m, kmMax = anc[anc.length - 1]?.km_m
  const scara = anc.length > 1 ? (anc[anc.length - 1].dist - anc[0].dist) / (kmMax - kmMin) : 1
  out('### Bornele și calibrarea km [K#20]')
  out('')
  const pePliniute = borneAnc.filter(b => b.sursa_ancora === 'liniuta').length
  out(`${borne.length} borne (${fmtKm(kmMin)} … ${fmtKm(kmMax)}); ${pePliniute} ancorate pe liniuța de km${lot.liniute_culoare ? ` (culoarea ${numeCuloare(lot.liniute_culoare)})` : ''}, ${borne.length - pePliniute} pe etichetă; distanța maximă ancoră ↔ ax ${maxLat.toFixed(1)} m. Pe linie, 1 km PT = ${(scara * 1000).toFixed(1)} m (${((scara - 1) * 100).toFixed(2)}%).`)
  const capat = d => `${fmtKm(f(d))}${f.stare(d) === 'interpolat' ? '' : ` (${f.stare(d) === 'extrapolat' ? 'extrapolat' : 'în afara zonei calibrate'})`}`
  out(`Capetele axului: început la ${capat(0)}, sfârșit la ${capat(cum[cum.length - 1])} (km calibrat; extrapolarea e permisă cel mult 500 m în afara bornelor).`)
  out(`Verificarea ancorelor (fiecare bornă prezisă din vecinele ei, prag ±${cfg.prag_km_gps_m} m): abatere maximă **${maxLoo.toFixed(1)} m** → ${maxLoo <= cfg.prag_km_gps_m ? '**trece**' : '**NU trece**'}.`)
  const rele = loo.filter(x => Math.abs(x.prezis - x.km) > cfg.prag_km_gps_m)
  if (rele.length) out(`Borne peste prag: ${rele.map(x => `${fmtKm(x.km)} (${(x.prezis - x.km).toFixed(0)} m)`).join(', ')}.`)
  out('')
  rez.calibrare = { borne: borne.length, km_min: kmMin, km_max: kmMax, abatere_max_loo_m: +maxLoo.toFixed(1), lateral_max_m: +maxLat.toFixed(1) }

  // ── punctele, pe clase ──
  const tr = lot.tronsoane_pt
  const pctRez = puncte.filter(p => p.clasa !== 'borna').map(p => {
    const pr = proiecteaza(ax, p.coord, cum)
    const km = f(pr.dist)
    return { nume: p.e.nume, afisat: reparaDiacritice(p.e.nume), clasa: p.clasa, nr: p.nr ?? null, km_m: Number.isFinite(km) ? Math.round(km) : null, km_stare: f.stare(pr.dist), lateral_m: Math.round(pr.lateral), latura: pr.latura > 0 ? 'stânga' : 'dreapta', tronson: tronsonLaKm(km, tr), lat: +p.coord[1].toFixed(6), lon: +p.coord[0].toFixed(6), tip: p.e.tip }
  }).sort((a, b) => (a.km_m ?? Infinity) - (b.km_m ?? Infinity))
  const kmAfis = p => `${fmtKm(p.km_m)}${p.km_stare === 'extrapolat' ? ' (extrapolat)' : p.km_stare === 'in_afara' ? ' (în afara zonei calibrate)' : ''}`
  const clase = ['depozit', 'os', 'robinet', 'TD', 'TA', 'THC', 'CF', 'TCF', 'SPC']
  out('### Punctele de interes (km calibrat, latura în sensul km crescător)')
  out('')
  out('| Clasă | Nume | km | Tronson (PT) | Față de ax | Lat, lon |')
  out('|---|---|---|---|---|---|')
  for (const c of clase) for (const p of pctRez.filter(x => x.clasa === c)) {
    const departe = p.lateral_m > cfg.lateral_max_m ? ' ⚠ departe de ax' : ''
    out(`| ${c} | ${p.afisat} | ${kmAfis(p)} | ${p.tronson || '—'} | ${p.lateral_m} m ${p.latura}${departe} | ${p.lat}, ${p.lon} |`)
  }
  out('')
  const numar = c => pctRez.filter(p => p.clasa === c).length
  out(`Numărate: ${clase.map(c => `${c} ${numar(c)}`).join(', ')}. Neclasificate (rămân în preview, fără efect): ${numar('altul')}.`)
  if (lot.puncte_asteptate) {
    const ok = Object.entries(lot.puncte_asteptate).map(([c, n]) => [c, n, (c === 'borna' ? borne.length : numar(c))])
    out(`Criteriul E1 pe puncte: ${ok.map(([c, n, g]) => `${c} ${g}/${n}${g === n ? ' ✓' : ' ✗'}`).join(', ')}.`)
    rez.puncte_criteriu = Object.fromEntries(ok.map(([c, n, g]) => [c, { asteptat: n, gasit: g }]))
  }
  out('')
  out(`<details><summary>Neclasificate (${numar('altul')})</summary>`)
  out('')
  out(pctRez.filter(p => p.clasa === 'altul').map(p => `${p.afisat} (${kmAfis(p)}, ${p.lateral_m} m)`).join(' · ') || '—')
  out('')
  out('</details>')
  out('')
  out(`**Avertismente de geometrie** (${avertismente.length}): ${avertismente.length ? avertismente.join('; ') : 'niciunul (nicio MultiGeometrie, niciun element cu mai multe părți)'}.`)
  out('')
  rez.puncte = pctRez
  rez.avertismente = avertismente

  // ── liniile de semnificație necunoscută (roșii/violet care nu sunt ax) [D2#17] ──
  const necun = el.filter(e => e.linii.length && !alese.some(a => a.e === e) && (lot.culori_de_aratat || []).includes(e.culoare)).map(e => {
    // toate părțile, toate vârfurile: intervalul de km acoperit și distanța maximă față de ax
    const pr = e.linii.flat().map(v => proiecteaza(ax, v, cum))
    const dMin = Math.min(...pr.map(x => x.dist)), dMax = Math.max(...pr.map(x => x.dist))
    return { id: e.id || e.nume, culoare: numeCuloare(e.culoare), parti: e.linii.length, lungime_m: Math.round(e.linii.reduce((s, l) => s + lungimeLinie(l), 0)), km_de_la: Math.round(f(dMin)), km_pana_la: Math.round(f(dMax)), lateral_max_m: Math.round(Math.max(...pr.map(x => x.lateral))) }
  }).filter(x => x.lungime_m >= (lot.necunoscute_min_m || 0)).sort((a, b) => a.km_de_la - b.km_de_la)
  if (necun.length) {
    out('### Linii afișate ca „necunoscute” — fără niciun efect [D2#17]')
    out('')
    out('Nu schimbă niciun tronson, nicio ancoră și niciun `perete_proiectat`. Le lămurim cu topograful sau cu Transgaz.')
    out('')
    out('| Linie | Culoare | Lungime | km (proiecție pe ax) | Distanța max. față de ax |')
    out('|---|---|---|---|---|')
    for (const n of necun) out(`| \`${n.id}\` | ${n.culoare} | ${n.lungime_m} m | ${fmtKm(n.km_de_la)} – ${fmtKm(n.km_pana_la)} | ${n.lateral_max_m} m |`)
    out('')
  }
  rez.linii_necunoscute = necun

  // ── tronsoanele: PT față de BD ──
  out('### Tronsoanele: PT față de BD (propunere, se aplică doar cu „da”)')
  out('')
  out('| Tronson | BD azi (id: start – end, lungime) | PT (sursa) | Propunere | Diferența / decizie |')
  out('|---|---|---|---|---|')
  const propTr = []
  for (const t of tr) {
    const bd = (lot.tronsoane_bd || []).find(x => x.cod === t.cod)
    const bdTxt = bd ? `id ${bd.id}: ${fmtKm(bd.km_start_m)} – ${fmtKm(bd.km_end_m)}${bd.lungime_planificata_km ? `, ${bd.lungime_planificata_km} km` : ''}` : '— (nu există)'
    const dif = []
    if (!bd) dif.push('rând nou (INSERT)')
    else {
      if (bd.km_start_m !== t.km_start_m) dif.push(`start ${fmtKm(bd.km_start_m)} → ${fmtKm(t.km_start_m)}`)
      if (bd.km_end_m !== t.km_end_m) dif.push(`end ${fmtKm(bd.km_end_m)} → ${fmtKm(t.km_end_m)}`)
      const lung = +((t.km_end_m - t.km_start_m) / 1000).toFixed(3)
      if (Number(bd.lungime_planificata_km) !== lung) dif.push(`lungime ${bd.lungime_planificata_km ?? '—'} → ${lung} km`)
    }
    if (t.nota) dif.push(t.nota)
    out(`| ${t.cod} | ${bdTxt} | ${fmtKm(t.km_start_m)} – ${fmtKm(t.km_end_m)} (${t.sursa}) | ${fmtKm(t.km_start_m)} – ${fmtKm(t.km_end_m)}, ${((t.km_end_m - t.km_start_m) / 1000).toFixed(3)} km | ${dif.join('; ') || 'identic'} |`)
    propTr.push({ cod: t.cod, id_bd: bd?.id ?? null, km_start_m: t.km_start_m, km_end_m: t.km_end_m, lungime_planificata_km: +((t.km_end_m - t.km_start_m) / 1000).toFixed(3), sursa: t.sursa, actiune: bd ? (dif.length ? 'update' : 'nimic') : 'insert' })
  }
  out('')
  rez.tronsoane = propTr

  // ── depozitele propuse ──
  if (lot.depozite_propuse?.length) {
    out('### Depozitele propuse (`logistica_depozite`, site-ul proiectului)')
    out('')
    out('| Nume | Cod | Site | Punct KML | km | Lat, lon | Gestionar (la E2, cu „da”) |')
    out('|---|---|---|---|---|---|---|')
    rez.depozite = lot.depozite_propuse.map(d => {
      const p = pctRez.find(x => x.nume === d.kml_nume)
      out(`| ${d.name} | ${d.cod_3litere} | ${d.site_id} | ${d.kml_nume}${p ? '' : ' (negăsit!)'} | ${p ? fmtKm(p.km_m) : '—'} | ${p ? `${p.lat}, ${p.lon}` : '—'} | ${d.gestionar} |`)
      return { ...d, km_m: p?.km_m ?? null, lat: p?.lat ?? null, lon: p?.lon ?? null }
    })
    out('')
  }
  rezultatJson.loturi.push(rez)
}

fs.writeFileSync(outPath, L.join('\n') + '\n', 'utf8')
fs.writeFileSync(outPath.replace(/\.md$/, '.json'), JSON.stringify(rezultatJson, null, 2) + '\n', 'utf8')
console.log(`scris ${outPath} (+ .json)`)
