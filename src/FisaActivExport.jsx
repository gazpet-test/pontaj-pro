// ===========================================================================
// 📄 FisaActivExport — exportă fișa completă a unui activ în PDF sau Excel
// Adună: date de identificare + tehnice (din talon), documente, supape,
// istoric piese/service. Folosit din ActivFormModal (buton lângă titlu).
// PDF: HTML randat + html2canvas + jsPDF (pattern avize). Excel: xlsx-js-style.
// ===========================================================================

import { useState } from 'react'
import { supabase } from './lib/supabase.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'

const fmt = (v) => (v === null || v === undefined || v === '') ? '—' : String(v)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

// grupele de câmpuri pentru fișă (label, cheie, sufix)
const GRUPE = [
  ['IDENTIFICARE', [
    ['Cod intern', 'cod_intern'], ['Nr. inventar', 'nr_inventar'], ['Nr. înmatriculare', 'nr_inmatriculare'],
    ['Marcă', 'marca'], ['Model', 'model'], ['An fabricație', 'an_fabricatie'],
    ['Firmă proprietară', 'firma_proprietara'], ['Stare', 'stare'],
  ]],
  ['DATE TEHNICE (din talon / CIV)', [
    ['Serie șasiu (VIN)', 'serie_sasiu'], ['Serie motor', 'serie_motor'], ['Serie CIV', 'serie_civ'],
    ['Categorie vehicul', 'categorie_vehicul'], ['Nr. omologare', 'nr_omologare'],
    ['Cilindree', 'capacitate_motor', ' cm³'], ['Putere', 'putere_kw', ' kW'],
    ['Carburant', 'tip_carburant'], ['Culoare', 'culoare'],
    ['Masă proprie', 'greutate_kg', ' kg'], ['Masă maximă autorizată', 'masa_maxima_kg', ' kg'],
    ['Nr. locuri', 'nr_locuri'], ['Prima înmatriculare', 'data_prima_inmatriculare', '', true],
  ]],
  ['EXPLOATARE', [
    ['Km actuali', 'km_actuali'], ['Ore funcționare', 'ore_functionare_actuale'],
    ['Interval service (km)', 'interval_service_km'], ['Interval service (ore)', 'interval_service_ore'],
    ['Normă consum', 'norma_consum'], ['Unitate normă', 'unitate_norma'],
  ]],
  ['DIMENSIUNI & TRANSPORT', [
    ['Lungime', 'lungime_m', ' m'], ['Lățime', 'latime_m', ' m'], ['Înălțime', 'inaltime_m', ' m'],
    ['Necesită ADR', 'necesita_adr'], ['Necesită agabaritic', 'necesita_agabaritic'],
    ['Nr. autorizație ARR', 'nr_autorizatie_arr'],
  ]],
]

async function adunaDate(activId) {
  const [act, docs, tipuri, supape, piese, service] = await Promise.all([
    supabase.from('logistica_active').select('*, sites(name), logistica_categorii(tip, subcategorie)').eq('id', activId).single(),
    supabase.from('logistica_documente').select('tip_id, numar_document, data_emitere, data_expirare, observatii').or(`active_id.eq.${activId},entitate_id.eq.${activId}`),
    supabase.from('logistica_tipuri_documente').select('id, nume'),
    supabase.from('logistica_supape').select('serie, producator, activa, data_verificare, data_valabilitate, rezultat').eq('activ_id', activId),
    supabase.from('logistica_piese_istoric').select('denumire, cod_piesa, cantitate, data_service, km_service, locatie_service').eq('active_id', activId).order('data_service', { ascending: false }).limit(80),
    supabase.from('logistica_service_intrari').select('data_intrare, data_iesire, descriere_problema, cost_total').eq('activ_id', activId).order('data_intrare', { ascending: false }).limit(30),
  ])
  const tipMap = Object.fromEntries((tipuri.data || []).map(t => [t.id, t.nume]))
  return {
    a: act.data || {},
    docs: (docs.data || []).map(d => ({ ...d, tip: tipMap[d.tip_id] || `tip ${d.tip_id}` })),
    supape: supape.data || [],
    piese: piese.data || [],
    service: service.data || [],
  }
}

function buildHtml({ a, docs, supape, piese, service }) {
  const rand = (label, val) => `<tr><td style="padding:3px 8px;color:#555;width:42%">${label}</td><td style="padding:3px 8px;font-weight:600">${val}</td></tr>`
  const grupHtml = GRUPE.map(([titlu, campuri]) => {
    const randuri = campuri.map(([label, key, sufix = '', isDate = false]) => {
      let v = a[key]
      if (typeof v === 'boolean') v = v ? 'DA' : 'NU'
      if (isDate) v = v ? fmtDate(v) : null
      return rand(label, v === null || v === undefined || v === '' ? '—' : `${v}${sufix}`)
    }).join('')
    return `<div style="margin-bottom:10px"><div style="background:#1F3A5F;color:#fff;padding:4px 8px;font-size:10px;font-weight:700;letter-spacing:.5px">${titlu}</div>
      <table style="width:100%;border-collapse:collapse;font-size:10px">${randuri}</table></div>`
  }).join('')

  const tabel = (titlu, capete, randuri) => randuri.length === 0 ? '' : `
    <div style="margin-bottom:10px"><div style="background:#1F3A5F;color:#fff;padding:4px 8px;font-size:10px;font-weight:700">${titlu}</div>
    <table style="width:100%;border-collapse:collapse;font-size:9px">
      <tr>${capete.map(c => `<th style="background:#EEF2F7;padding:3px 6px;text-align:left;border-bottom:1px solid #ccc">${c}</th>`).join('')}</tr>
      ${randuri.map(r => `<tr>${r.map(c => `<td style="padding:3px 6px;border-bottom:1px solid #eee">${c ?? '—'}</td>`).join('')}</tr>`).join('')}
    </table></div>`

  return `<div style="width:760px;padding:24px;font-family:Arial,sans-serif;background:#fff;color:#111">
    <div style="display:flex;align-items:center;gap:12px;border-bottom:2px solid #1F3A5F;padding-bottom:8px;margin-bottom:12px">
      <img src="${LOGO_B64}" style="height:42px"/>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800">FIȘA ACTIVULUI — ${fmt(a.marca)} ${fmt(a.model)}</div>
        <div style="font-size:11px;color:#555">${fmt(a.cod_intern)}${a.nr_inmatriculare ? ' · ' + a.nr_inmatriculare : ''}${a.sites?.name ? ' · 📍 ' + a.sites.name : ''}</div>
      </div>
      <div style="font-size:9px;color:#777;text-align:right">Gazpet Instal SRL<br/>generat ${new Date().toLocaleDateString('ro-RO')}</div>
    </div>
    ${grupHtml}
    ${tabel('DOCUMENTE', ['Tip', 'Număr', 'Emitere', 'Expirare'], docs.map(d => [d.tip, d.numar_document, fmtDate(d.data_emitere), d.data_expirare ? fmtDate(d.data_expirare) : 'fără expirare']))}
    ${tabel('SUPAPE DE SIGURANȚĂ', ['Serie', 'Producător', 'Verificare', 'Valabil până', 'Rezultat'], supape.map(s => [s.serie, s.producator, fmtDate(s.data_verificare), fmtDate(s.data_valabilitate), s.rezultat]))}
    ${tabel('INTRĂRI SERVICE', ['Intrare', 'Ieșire', 'Problemă', 'Cost'], service.map(s => [fmtDate(s.data_intrare), fmtDate(s.data_iesire), (s.descriere_problema || '').slice(0, 60), s.cost_total ? s.cost_total + ' lei' : '—']))}
    ${tabel('ISTORIC PIESE', ['Denumire', 'Cod', 'Cant.', 'Data', 'Km/Ore', 'Locație'], piese.slice(0, 40).map(p => [p.denumire, p.cod_piesa, p.cantitate, fmtDate(p.data_service), p.km_service, p.locatie_service]))}
    <div style="margin-top:14px;font-size:8px;color:#888;border-top:1px solid #ddd;padding-top:6px">
      Document generat automat din PontajPRO · Gazpet Instal SRL${piese.length > 40 ? ` · istoric piese limitat la 40 din ${piese.length} înregistrări` : ''}
    </div>
  </div>`
}

export default function FisaActivExport({ activ, showToast }) {
  const [busy, setBusy] = useState(null)

  const exportPdf = async () => {
    setBusy('pdf')
    try {
      const date = await adunaDate(activ.id)
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:-10000px;top:0'
      host.innerHTML = buildHtml(date)
      document.body.appendChild(host)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#fff' })
      document.body.removeChild(host)
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
      const w = 190, h = (canvas.height * w) / canvas.width
      const pageH = 277
      let rest = h, y = 0
      while (rest > 0) {
        const partH = Math.min(pageH, rest)
        const partCanvas = document.createElement('canvas')
        partCanvas.width = canvas.width
        partCanvas.height = (partH / h) * canvas.height
        partCanvas.getContext('2d').drawImage(canvas, 0, (y / h) * canvas.height, canvas.width, partCanvas.height, 0, 0, canvas.width, partCanvas.height)
        if (y > 0) pdf.addPage()
        pdf.addImage(partCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, w, partH)
        y += partH; rest -= partH
      }
      pdf.save(`Fisa_${(activ.cod_intern || activ.nr_inmatriculare || activ.id).toString().replace(/\s/g, '')}.pdf`)
      showToast('✓ Fișă PDF generată', 'success')
    } catch (e) {
      showToast('Eroare export PDF: ' + (e.message || e), 'error')
    } finally { setBusy(null) }
  }

  const exportExcel = async () => {
    setBusy('excel')
    try {
      const XLSX = await import('xlsx-js-style')
      const { a, docs, supape, piese, service } = await adunaDate(activ.id)
      const wb = XLSX.utils.book_new()
      const info = []
      for (const [titlu, campuri] of GRUPE) {
        info.push([titlu, ''])
        for (const [label, key, sufix = ''] of campuri) {
          let v = a[key]
          if (typeof v === 'boolean') v = v ? 'DA' : 'NU'
          info.push([label, v === null || v === undefined || v === '' ? '—' : `${v}${sufix}`])
        }
        info.push(['', ''])
      }
      const wsInfo = XLSX.utils.aoa_to_sheet([['FIȘA ACTIVULUI', `${fmt(a.marca)} ${fmt(a.model)}`], ['', ''], ...info])
      wsInfo['!cols'] = [{ wch: 32 }, { wch: 42 }]
      XLSX.utils.book_append_sheet(wb, wsInfo, 'Fisa')
      if (docs.length) {
        const ws = XLSX.utils.aoa_to_sheet([['Tip', 'Număr', 'Emitere', 'Expirare', 'Observații'], ...docs.map(d => [d.tip, d.numar_document, d.data_emitere, d.data_expirare, d.observatii])])
        ws['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 50 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Documente')
      }
      if (supape.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Serie', 'Producător', 'Activă', 'Verificare', 'Valabil până', 'Rezultat'], ...supape.map(s => [s.serie, s.producator, s.activa ? 'DA' : 'NU', s.data_verificare, s.data_valabilitate, s.rezultat])]), 'Supape')
      if (service.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Intrare', 'Ieșire', 'Problemă', 'Cost'], ...service.map(s => [s.data_intrare, s.data_iesire, s.descriere_problema, s.cost_total])]), 'Service')
      if (piese.length) {
        const ws = XLSX.utils.aoa_to_sheet([['Denumire', 'Cod piesă', 'Cantitate', 'Data', 'Km/Ore', 'Locație'], ...piese.map(p => [p.denumire, p.cod_piesa, p.cantitate, p.data_service, p.km_service, p.locatie_service])])
        ws['!cols'] = [{ wch: 34 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 26 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Istoric piese')
      }
      XLSX.writeFile(wb, `Fisa_${(a.cod_intern || a.nr_inmatriculare || a.id).toString().replace(/\s/g, '')}.xlsx`)
      showToast('✓ Fișă Excel generată', 'success')
    } catch (e) {
      showToast('Eroare export Excel: ' + (e.message || e), 'error')
    } finally { setBusy(null) }
  }

  if (!activ?.id) return null
  const btn = { padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', background: '#161B22', color: '#E6EDF3', border: '1px solid #30363D' }
  return (
    <span style={{ display: 'inline-flex', gap: 6 }}>
      <button onClick={exportPdf} disabled={!!busy} title="Exportă fișa completă în PDF" style={{ ...btn, borderColor: '#F8514955', color: '#F85149' }}>
        {busy === 'pdf' ? '⏳' : '📄 PDF'}
      </button>
      <button onClick={exportExcel} disabled={!!busy} title="Exportă fișa completă în Excel" style={{ ...btn, borderColor: '#3FB95055', color: '#3FB950' }}>
        {busy === 'excel' ? '⏳' : '📊 Excel'}
      </button>
    </span>
  )
}
