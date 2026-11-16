// ═══════════════════════════════════════════════════════════════════════════
// uscareRaport.js — HTML-ul raportului de uscare (A4 portret), PUR (testabil): aceleași rubrici, în aceeași ordine ca modelul beneficiarului
// („RAPORT - OPERATIUNE DE USCARE A CONDUCTEI”), apoi anexa foto cu legendă. Exportul PDF (html2canvas + jsPDF) e în uscarePdf.js.
// În document apar DOAR datele, constructorul și semnăturile: nicio mențiune despre aplicație, unelte sau cine l-a pregătit.
// Tabelele: <colgroup> în procente (regula html2canvas din CLAUDE.md); pozele vin deja ca data URL (signed URL -> fetchAsDataURL, CORS).
// ═══════════════════════════════════════════════════════════════════════════

import { durataOre, vitezaMedie, fmtZi, fmtOraMinut, fmtMoment, fmtNr, fmtKm, ETICHETE_CATEGORII, NR_CANTARIRI_MODEL } from './uscareLogica.js'

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const B = 'border:1px solid #000;padding:5px 6px;vertical-align:middle'
const TH = `${B};background:#f2f2f2;font-weight:700;text-align:center;font-size:11px`
const TD = `${B};text-align:center;font-size:12px;min-height:22px`
const kg = x => (x == null ? '' : fmtNr(x, 3))
const bifa = da => (da ? '&#9746;' : '&#9744;')   // ☒ / ☐

/** antetul paginii: titlul modelului + mențiunile de stare (ciornă / revizie) */
function titlu(u) {
  const ciorna = u.stare !== 'inchisa'
    ? `<div style="text-align:center;font-size:12px;font-weight:700;color:#b00;margin-top:4px">CIORNĂ — raport ${u.stare === 'anulata' ? 'ANULAT' : 'neînchis'}</div>` : ''
  const rev = u.revizie ? `<div style="text-align:right;font-size:11px">Revizia ${esc(u.revizie)}</div>` : ''
  return `${rev}<div style="text-align:center;font-size:17px;font-weight:800;letter-spacing:.3px;margin:4px 0 10px">RAPORT - OPERATIUNE DE USCARE A CONDUCTEI</div>${ciorna}`
}

/** pagina 1: tabelul raportului, în ordinea modelului */
export function htmlRaport(u) {
  const cant = Array.isArray(u.cantariri) ? [...u.cantariri].sort((a, b) => a.nr - b.nr) : []
  const c = n => cant.find(x => x.nr === n) || {}
  const durata = durataOre(u.ora_inceput, u.ora_final)
  const viteza = vitezaMedie(u.lungime_m, u.timp_deplasare_min)
  const utilaje = (u.utilaje || [])
  const temp = u.temperatura_c == null ? '' : `${fmtNr(u.temperatura_c, 1)} °C${u.vreme ? `<div style="font-size:10px;margin-top:2px">${esc(u.vreme)}</div>` : ''}`
  // bureții peste cei 3 ai modelului: rânduri suplimentare, în aceeași formă
  const extra = cant.filter(x => x.nr > NR_CANTARIRI_MODEL || !Number.isInteger(x.nr))
  const randExtra = extra.length ? `
    <table style="width:100%;border-collapse:collapse;margin-top:6px"><colgroup><col style="width:40%"><col style="width:30%"><col style="width:30%"></colgroup>
      ${extra.map(x => `<tr><td style="${TH}">Cantarire burete ${esc(x.nr)}</td><td style="${TD}">La intrare [kg]: ${esc(kg(x.intrare_kg))}</td><td style="${TD}">La iesire [kg]: ${esc(kg(x.iesire_kg))}</td></tr>`).join('')}
    </table>` : ''
  const semn = (rol, nume, functie) => `
    <td style="${B};vertical-align:top;height:120px">
      <div style="font-weight:800;text-align:center;font-size:12px;margin-bottom:8px">${rol}</div>
      <div style="font-size:11px;margin:4px 0">NUME/ PRENUME: <b>${esc(nume)}</b></div>
      <div style="font-size:11px;margin:4px 0">FUNCTIE: <b>${esc(functie)}</b></div>
      <div style="font-size:11px;margin-top:18px">Semnătura:</div>
    </td>`
  return `<div style="width:738px;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:18px 24px;box-sizing:content-box">
  ${titlu(u)}
  <table style="width:100%;border-collapse:collapse">
    <colgroup><col style="width:13%"><col style="width:15%"><col style="width:11%"><col style="width:11%"><col style="width:11%"><col style="width:14%"><col style="width:25%"></colgroup>
    <tr><th style="${TH}">Data operatiune</th><th style="${TH}">Tronson</th><th style="${TH}">De la km</th><th style="${TH}">La km</th><th style="${TH}">Lungime (m)</th><th style="${TH}">Temperatura exterioara</th><th style="${TH}">Denumire Constructor</th></tr>
    <tr><td style="${TD}">${esc(fmtZi(u.data_operatie))}</td><td style="${TD}">${esc(u.tronson)}</td><td style="${TD}">${esc(fmtKm(u.km_de_la_m))}</td><td style="${TD}">${esc(fmtKm(u.km_pana_la_m))}</td>
        <td style="${TD}">${esc(fmtNr(u.lungime_m, 1))}</td><td style="${TD}">${temp}</td><td style="${TD}">${esc(u.constructor)}</td></tr>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-top:8px">
    <colgroup><col style="width:17%"><col style="width:6%"><col style="width:9%"><col style="width:9%"><col style="width:7%"><col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:7%"></colgroup>
    <tr><th style="${TH}" colspan="2">Utilaje/ Echipamente</th><th style="${TH}" colspan="2">Perioada</th><th style="${TH}" rowspan="2">Durata (ore)</th>
        <th style="${TH}" colspan="3">Configuratie ansamblu pistoane</th><th style="${TH}" colspan="2">Cantarire burete 1</th><th style="${TH}" colspan="2">Punct de roua</th></tr>
    <tr><th style="${TH}">Denumire</th><th style="${TH}">Nr. Buc.</th><th style="${TH}">Ora incepere</th><th style="${TH}">Ora finalizare</th>
        <th style="${TH}">PIG metalic [buc]</th><th style="${TH}">Piston poliuretan [buc]</th><th style="${TH}">Bureti spuma [buc]</th>
        <th style="${TH}">La intrare [kg]</th><th style="${TH}">La iesire [kg]</th><th style="${TH}">Valoare (°C)</th><th style="${TH}">Locatie masurare</th></tr>
    <tr><td style="${TD};text-align:left">${utilaje.map(x => esc(x.denumire)).join('<br>')}</td><td style="${TD}">${utilaje.map(x => esc(x.buc)).join('<br>')}</td>
        <td style="${TD}">${esc(fmtMoment(u.ora_inceput))}</td><td style="${TD}">${esc(fmtMoment(u.ora_final))}</td><td style="${TD}">${esc(durata == null ? '' : fmtNr(durata, 2))}</td>
        <td style="${TD}">${esc(u.pig_metalic_buc ?? '')}</td><td style="${TD}">${esc(u.piston_pu_buc ?? '')}</td><td style="${TD}">${esc(u.bureti_buc ?? '')}</td>
        <td style="${TD}">${esc(kg(c(1).intrare_kg))}</td><td style="${TD}">${esc(kg(c(1).iesire_kg))}</td>
        <td style="${TD}">${esc(u.punct_roua_c == null ? '' : fmtNr(u.punct_roua_c, 1))}</td><td style="${TD}">${esc(u.punct_roua_loc)}</td></tr>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-top:8px">
    <colgroup><col style="width:18%"><col style="width:14%"><col style="width:14%"><col style="width:13.5%"><col style="width:13.5%"><col style="width:13.5%"><col style="width:13.5%"></colgroup>
    <tr><th style="${TH}" rowspan="2">Presiune in spatele buretelui (bar)</th><th style="${TH}" rowspan="2">Timp deplasare (min)</th><th style="${TH}" rowspan="2">Viteza medie (m/s)</th>
        <th style="${TH}" colspan="2">Cantarire burete 2</th><th style="${TH}" colspan="2">Cantarire burete 3</th></tr>
    <tr><th style="${TH}">La intrare [kg]</th><th style="${TH}">La iesire [kg]</th><th style="${TH}">La intrare [kg]</th><th style="${TH}">La iesire [kg]</th></tr>
    <tr><td style="${TD}">${esc(u.presiune_bar == null ? '' : fmtNr(u.presiune_bar, 2))}</td><td style="${TD}">${esc(u.timp_deplasare_min == null ? '' : fmtNr(u.timp_deplasare_min, 1))}</td>
        <td style="${TD}">${esc(viteza == null ? '' : fmtNr(viteza, 2))}</td>
        <td style="${TD}">${esc(kg(c(2).intrare_kg))}</td><td style="${TD}">${esc(kg(c(2).iesire_kg))}</td><td style="${TD}">${esc(kg(c(3).intrare_kg))}</td><td style="${TD}">${esc(kg(c(3).iesire_kg))}</td></tr>
  </table>
  ${randExtra}
  <table style="width:100%;border-collapse:collapse;margin-top:8px"><colgroup><col style="width:100%"></colgroup>
    <tr><th style="${TH};text-align:left">OBSERVATII</th></tr>
    <tr><td style="${B};height:70px;vertical-align:top;font-size:12px;white-space:pre-wrap">${esc(u.observatii)}</td></tr>
  </table>
  <div style="margin:12px 0 8px;font-size:13px;font-weight:700">Concluzie pentru tronson: &nbsp; ${bifa(u.concluzie === 'conform')} CONFORM &nbsp;&nbsp; ${bifa(u.concluzie === 'neconform')} NECONFORM</div>
  <table style="width:100%;border-collapse:collapse"><colgroup><col style="width:50%"><col style="width:50%"></colgroup>
    <tr>${semn('CONSTRUCTOR', u.semn_constructor_nume, u.semn_constructor_functie)}${semn('BENEFICIAR', u.semn_beneficiar_nume, u.semn_beneficiar_functie)}</tr>
  </table>
</div>`
}

/** legenda unei poze: „Foto N — categoria[, buretele n] — legenda — încărcată la ZZ.LL.AAAA HH:MM” */
export function legendaPoza(p, n) {
  const cat = ETICHETE_CATEGORII[p.categorie] || p.categorie
  return [`Foto ${n} — ${cat}${p.burete_nr ? `, buretele ${p.burete_nr}` : ''}`, p.legenda, p.creat_la ? `încărcată la ${fmtMoment(p.creat_la)}` : null]
    .filter(Boolean).join(' — ')
}
/** ordinea pozelor în anexă: ordinea categoriilor din model (presiune, temperatura, pistoane, cântăriri…), apoi buretele, apoi încărcarea */
export function ordonPoze(poze) {
  const ord = ['manometru', 'temperatura', 'pistoane', 'cantar_intrare', 'cantar_iesire', 'punct_roua', 'utilaje', 'altele']
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
