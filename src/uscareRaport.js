// ═══════════════════════════════════════════════════════════════════════════
// uscareRaport.js — HTML-ul raportului de uscare (A4 portret), PUR (testabil): aceleași rubrici, în aceeași ordine ca modelul beneficiarului
// („RAPORT - OPERAȚIUNE DE USCARE A CONDUCTEI”), apoi anexa foto cu legendă. Exportul PDF (html2canvas + jsPDF) e în uscarePdf.js.
// Raportul e împărțit în BLOCURI (antet, fiecare tabel, observații, criteriu + concluzie, semnături): PDF-ul le așază pe pagini și trece pe
// pagina următoare când nu mai încap (20 de utilaje / bureți, observații lungi), în loc să micșoreze totul pe o pagină.
// În document apar DOAR datele, constructorul și semnăturile: nicio mențiune despre aplicație, unelte sau cine l-a pregătit.
// Coordonatele exacte ale operațiunii NU apar implicit (opțiunea explicită `cuCoordonate` la export).
// Tabelele: <colgroup> în procente (regula html2canvas din CLAUDE.md); pozele vin deja ca data URL (signed URL -> fetchAsDataURL, CORS).
// ═══════════════════════════════════════════════════════════════════════════

import { durataOre, vitezaMedie, fmtZi, fmtMoment, fmtNr, fmtKm, ETICHETE_CATEGORII, ETICHETE_POZ_SURSA } from './uscareLogica.js'

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const B = 'border:1px solid #000;padding:5px 6px;vertical-align:middle'
const TH = `${B};background:#f2f2f2;font-weight:700;text-align:center;font-size:11px`
const TD = `${B};text-align:center;font-size:12px;min-height:22px`
const kg = x => (x == null ? '' : fmtNr(x, 3))
const bifa = da => (da ? '&#9746;' : '&#9744;')   // ☒ / ☐
const PAGINA = 'width:738px;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:6px 24px;box-sizing:content-box'
const bloc = interior => `<div style="${PAGINA}">${interior}</div>`
/** câte rânduri de bureți are modelul pe tabelele lui (1 în primul tabel, 2 și 3 în al doilea); restul în tabelul suplimentar */
const NR_MODEL = 3

/** antetul: titlul modelului + mențiunile de stare (ciornă / revizie) */
function titlu(u) {
  const ciorna = u.stare !== 'inchisa'
    ? `<div style="text-align:center;font-size:12px;font-weight:700;color:#b00;margin-top:4px">CIORNĂ — raport ${u.stare === 'anulata' ? 'ANULAT' : 'neînchis'}</div>` : ''
  const rev = u.revizie ? `<div style="text-align:right;font-size:11px">Revizia ${esc(u.revizie)}</div>` : ''
  return `${rev}<div style="text-align:center;font-size:17px;font-weight:800;letter-spacing:.3px;margin:4px 0 10px">RAPORT - OPERAȚIUNE DE USCARE A CONDUCTEI</div>${ciorna}`
}
const cantNr = (u, n) => (Array.isArray(u.cantariri) ? u.cantariri.find(x => Number(x.nr) === n) : null) || {}
/** celula unei cântăriri: kg, sau mențiunea „nu se aplică” cu motivul */
const celuleCant = c => (typeof c.motiv === 'string' && c.motiv
  ? `<td style="${TD}" colspan="2">nu se aplică: ${esc(c.motiv)}</td>`
  : `<td style="${TD}">${esc(kg(c.intrare_kg))}</td><td style="${TD}">${esc(kg(c.iesire_kg))}</td>`)

/**
 * Blocurile raportului, în ordinea modelului (fiecare = un <div> de 738 px, capturat separat de PDF).
 * opțiuni: { cuCoordonate: false } — coordonatele exacte doar la cerere.
 */
export function htmlRaportBlocuri(u, { cuCoordonate = false } = {}) {
  const durata = durataOre(u.ora_inceput, u.ora_final)
  const viteza = vitezaMedie(u.lungime_m, u.timp_deplasare_min)
  const utilaje = (u.utilaje || [])
  const temp = u.temperatura_c == null ? '' : `${fmtNr(u.temperatura_c, 1)} °C${u.vreme ? `<div style="font-size:10px;margin-top:2px">${esc(u.vreme)}</div>` : ''}`
  const blocuri = []
  blocuri.push(bloc(`${titlu(u)}
  <table style="width:100%;border-collapse:collapse">
    <colgroup><col style="width:13%"><col style="width:15%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:14%"><col style="width:25%"></colgroup>
    <tr><th style="${TH}">Data operațiune</th><th style="${TH}">Tronson</th><th style="${TH}">De la km</th><th style="${TH}">La km</th><th style="${TH}">Lungime (m)</th><th style="${TH}">Temperatura exterioară</th><th style="${TH}">Denumire Constructor</th></tr>
    <tr><td style="${TD}">${esc(fmtZi(u.data_operatie))}</td><td style="${TD}">${esc(u.tronson)}</td><td style="${TD}">${esc(fmtKm(u.km_de_la_m))}</td><td style="${TD}">${esc(fmtKm(u.km_pana_la_m))}</td>
        <td style="${TD}">${esc(fmtNr(u.lungime_m, 1))}</td><td style="${TD}">${temp}</td><td style="${TD}">${esc(u.constructor)}</td></tr>
  </table>${cuCoordonate && u.poz_lat != null && u.poz_lng != null ? `
  <div style="font-size:11px;margin-top:4px">Poziția operațiunii: ${esc(Number(u.poz_lat).toFixed(6))}, ${esc(Number(u.poz_lng).toFixed(6))} (${esc(ETICHETE_POZ_SURSA[u.poz_sursa] || u.poz_sursa)}${u.poz_sursa === 'gps' && u.poz_precizie_m != null ? `, ±${esc(fmtNr(u.poz_precizie_m, 1))} m` : ''}${u.poz_km_m != null ? `, km ${esc(fmtKm(u.poz_km_m))}` : ''})</div>` : ''}`))
  // tabelul 2: utilajele (toate, pe rânduri), perioada, durata, pistoanele, buretele 1, punctul de rouă
  const n = Math.max(1, utilaje.length)
  const rand = (i) => {
    const x = utilaje[i]
    const util = `<td style="${TD};text-align:left">${x ? esc(x.denumire) : ''}</td><td style="${TD}">${x ? esc(x.buc) : ''}</td>`
    if (i > 0) return `<tr>${util}</tr>`
    const c1 = cantNr(u, 1)
    return `<tr>${util}<td style="${TD}" rowspan="${n}">${esc(fmtMoment(u.ora_inceput))}</td><td style="${TD}" rowspan="${n}">${esc(fmtMoment(u.ora_final))}</td>
        <td style="${TD}" rowspan="${n}">${esc(durata == null ? '' : fmtNr(durata, 2))}</td>
        <td style="${TD}" rowspan="${n}">${esc(u.pig_metalic_buc ?? '')}</td><td style="${TD}" rowspan="${n}">${esc(u.piston_pu_buc ?? '')}</td><td style="${TD}" rowspan="${n}">${esc(u.bureti_buc ?? '')}</td>
        ${celuleCant(c1).replace(/<td style="/g, `<td rowspan="${n}" style="`)}
        <td style="${TD}" rowspan="${n}">${esc(u.punct_roua_c == null ? '' : fmtNr(u.punct_roua_c, 1))}</td><td style="${TD}" rowspan="${n}">${esc(u.punct_roua_loc)}</td></tr>`
  }
  blocuri.push(bloc(`
  <table style="width:100%;border-collapse:collapse">
    <colgroup><col style="width:17%"><col style="width:6%"><col style="width:9%"><col style="width:9%"><col style="width:7%"><col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:7%"></colgroup>
    <tr><th style="${TH}" colspan="2">Utilaje/ Echipamente</th><th style="${TH}" colspan="2">Perioada</th><th style="${TH}" rowspan="2">Durata (ore)</th>
        <th style="${TH}" colspan="3">Configurație ansamblu pistoane</th><th style="${TH}" colspan="2">Cântărire burete 1</th><th style="${TH}" colspan="2">Punct de rouă</th></tr>
    <tr><th style="${TH}">Denumire</th><th style="${TH}">Nr. Buc.</th><th style="${TH}">Ora începere</th><th style="${TH}">Ora finalizare</th>
        <th style="${TH}">PIG metalic [buc]</th><th style="${TH}">Piston poliuretan [buc]</th><th style="${TH}">Bureți spumă [buc]</th>
        <th style="${TH}">La intrare [kg]</th><th style="${TH}">La ieșire [kg]</th><th style="${TH}">Valoare (°C)</th><th style="${TH}">Locație măsurare</th></tr>
    ${Array.from({ length: n }, (_, i) => rand(i)).join('\n    ')}
  </table>`))
  blocuri.push(bloc(`
  <table style="width:100%;border-collapse:collapse">
    <colgroup><col style="width:18%"><col style="width:14%"><col style="width:14%"><col style="width:13.5%"><col style="width:13.5%"><col style="width:13.5%"><col style="width:13.5%"></colgroup>
    <tr><th style="${TH}" rowspan="2">Presiune în spatele buretelui (bar)</th><th style="${TH}" rowspan="2">Timp deplasare (min)</th><th style="${TH}" rowspan="2">Viteza medie (m/s)</th>
        <th style="${TH}" colspan="2">Cântărire burete 2</th><th style="${TH}" colspan="2">Cântărire burete 3</th></tr>
    <tr><th style="${TH}">La intrare [kg]</th><th style="${TH}">La ieșire [kg]</th><th style="${TH}">La intrare [kg]</th><th style="${TH}">La ieșire [kg]</th></tr>
    <tr><td style="${TD}">${esc(u.presiune_bar == null ? '' : fmtNr(u.presiune_bar, 2))}</td><td style="${TD}">${esc(u.timp_deplasare_min == null ? '' : fmtNr(u.timp_deplasare_min, 1))}</td>
        <td style="${TD}">${esc(viteza == null ? '' : fmtNr(viteza, 2))}</td>${celuleCant(cantNr(u, 2))}${celuleCant(cantNr(u, 3))}</tr>
  </table>`))
  // bureții peste cei 3 ai modelului: rânduri suplimentare, în aceeași formă (câte 10 pe bloc, ca un bloc să încapă pe pagină)
  const extra = (Array.isArray(u.cantariri) ? [...u.cantariri] : []).filter(x => Number(x.nr) > NR_MODEL).sort((a, b) => a.nr - b.nr)
  for (let i = 0; i < extra.length; i += 10) {
    blocuri.push(bloc(`
  <table style="width:100%;border-collapse:collapse"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup>
    ${extra.slice(i, i + 10).map(x => `<tr><td style="${TH}">Cântărire burete ${esc(x.nr)}</td>${typeof x.motiv === 'string' && x.motiv ? `<td style="${TD}" colspan="2">nu se aplică: ${esc(x.motiv)}</td>` : `<td style="${TD}">La intrare [kg]: ${esc(kg(x.intrare_kg))}</td><td style="${TD}">La ieșire [kg]: ${esc(kg(x.iesire_kg))}</td>`}</tr>`).join('')}
  </table>`))
  }
  blocuri.push(bloc(`
  <table style="width:100%;border-collapse:collapse"><colgroup><col style="width:100%"></colgroup>
    <tr><th style="${TH};text-align:left">OBSERVAȚII</th></tr>
    <tr><td style="${B};height:70px;vertical-align:top;font-size:12px;white-space:pre-wrap;word-break:break-word">${esc(u.observatii)}</td></tr>
  </table>`))
  blocuri.push(bloc(`
  <div style="margin:8px 0 4px;font-size:12px">Ultimul piston vehiculat iese uscat (criteriul din caietul de sarcini): &nbsp; ${bifa(u.piston_final_rezultat === 'uscat')} DA &nbsp;&nbsp; ${bifa(u.piston_final_rezultat === 'umed')} NU</div>
  <div style="margin:4px 0 8px;font-size:13px;font-weight:700">Concluzie pentru tronson: &nbsp; ${bifa(u.concluzie === 'conform')} CONFORM &nbsp;&nbsp; ${bifa(u.concluzie === 'neconform')} NECONFORM</div>`))
  const semn = (rol, nume, functie) => `
    <td style="${B};vertical-align:top;height:120px">
      <div style="font-weight:800;text-align:center;font-size:12px;margin-bottom:8px">${rol}</div>
      <div style="font-size:11px;margin:4px 0">NUME/ PRENUME: <b>${esc(nume)}</b></div>
      <div style="font-size:11px;margin:4px 0">FUNCȚIE: <b>${esc(functie)}</b></div>
      <div style="font-size:11px;margin-top:18px">Semnătura:</div>
    </td>`
  blocuri.push(bloc(`
  <table style="width:100%;border-collapse:collapse"><colgroup><col style="width:50%"><col style="width:50%"></colgroup>
    <tr>${semn('CONSTRUCTOR', u.semn_constructor_nume, u.semn_constructor_functie)}${semn('BENEFICIAR', u.semn_beneficiar_nume, u.semn_beneficiar_functie)}</tr>
  </table>`))
  return blocuri
}
/** tot raportul ca un singur HTML (pentru teste și previzualizare) */
export const htmlRaport = (u, o) => htmlRaportBlocuri(u, o).join('\n')

/**
 * Așezarea blocurilor pe pagini (pur, testabil): înălțimile blocurilor (mm, la lățimea paginii) → [[{ bloc, y, h, felie }]] pe pagini.
 * Un bloc care nu mai încape pe pagina curentă trece pe pagina următoare; un bloc mai înalt decât o pagină întreagă se taie în felii
 * de câte o pagină (nimic nu se micșorează, nimic nu se pierde).
 */
export function aseazaBlocuri(inaltimi, { inaltimePagina = 281, sus = 8 } = {}) {
  const pagini = [[]]
  let y = 0
  inaltimi.forEach((h, bloc) => {
    if (h <= inaltimePagina) {
      if (y > 0 && y + h > inaltimePagina) { pagini.push([]); y = 0 }
      pagini[pagini.length - 1].push({ bloc, y: sus + y, h, felie: null })
      y += h
      return
    }
    if (y > 0) { pagini.push([]); y = 0 }
    for (let s = 0, i = 0; s < h; s += inaltimePagina, i++) {
      if (i > 0) pagini.push([])
      const hf = Math.min(inaltimePagina, h - s)
      pagini[pagini.length - 1].push({ bloc, y: sus, h: hf, felie: { de_la: s, inaltime: hf, total: h } })
      y = hf
    }
  })
  return pagini.filter(p => p.length)
}

/** legenda unei poze: „Foto N — categoria[, buretele n] — legenda — încărcată la ZZ.LL.AAAA HH:MM” */
export function legendaPoza(p, n) {
  const cat = ETICHETE_CATEGORII[p.categorie] || p.categorie
  return [`Foto ${n} — ${cat}${p.burete_nr ? `, buretele ${p.burete_nr}` : ''}`, p.legenda, p.creat_la ? `încărcată la ${fmtMoment(p.creat_la)}` : null]
    .filter(Boolean).join(' — ')
}
/** ordinea pozelor în anexă: ordinea categoriilor din model (presiune, temperatura, pistoane, cântăriri, ultimul piston…), apoi buretele, apoi încărcarea */
export function ordonPoze(poze) {
  const ord = ['manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'piston_final', 'punct_roua', 'utilaje', 'altele']
  return [...(poze || [])].sort((a, b) => (ord.indexOf(a.categorie) - ord.indexOf(b.categorie)) || ((a.burete_nr || 0) - (b.burete_nr || 0)) || (a.id - b.id))
}
/** paginile anexei foto: câte 2 poze pe pagină; o poză fără imagine (necitită) apare cu mențiunea, nu dispare (L12) */
export function htmlAnexa(u, poze) {
  const ord = ordonPoze(poze)
  const pagini = []
  for (let i = 0; i < ord.length; i += 2) {
    const bucati = ord.slice(i, i + 2).map((p, j) => `
      <div style="margin:10px 0 16px;text-align:center">
        ${p.dataUrl ? `<img src="${p.dataUrl}" style="max-width:100%;max-height:440px;object-fit:contain;border:1px solid #999">`
                    : `<div style="border:1px dashed #999;padding:40px;font-size:12px">Fotografia nu a putut fi citită la generare (${esc(p.cale)})</div>`}
        <div style="font-size:11px;margin-top:6px;text-align:left">${esc(legendaPoza(p, i + j + 1))}</div>
      </div>`).join('')
    pagini.push(`<div style="width:738px;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:18px 24px;box-sizing:content-box">
      <div style="font-size:13px;font-weight:800;margin-bottom:4px">ANEXA FOTO — Raport de uscare, ${esc(u.tronson)}${u.data_operatie ? `, ${esc(fmtZi(u.data_operatie))}` : ''}</div>
      <div style="font-size:11px;margin-bottom:6px">Pagina ${pagini.length + 1} din ${Math.ceil(ord.length / 2)}</div>
      ${bucati}
    </div>`)
  }
  return pagini
}
