// ═══════════════════════════════════════════════════════════════════════════
// sedinteExport.js — PDF-ul procesului-verbal de ședință.
// Pattern HTML → html2canvas → jsPDF (ca rapoarteExport / FisaActivExport):
// jsPDF cu text direct strică diacriticele (anti-bug cunoscut la Bon consum),
// randarea ca imagine le păstrează. Întoarce Blob — apelantul decide dacă îl
// descarcă, îl urcă în Storage, sau ambele.
// ═══════════════════════════════════════════════════════════════════════════

import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const fmtData = (d) => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

const TIP_LABEL = { problema: '⚠ Problemă', actiune: '✔ Acțiune', decizie: '⚖ Decizie', info: 'ℹ Info' }
const TIP_CULOARE = { problema: '#B45309', actiune: '#166534', decizie: '#0E7490', info: '#6B7280' }
const ST_LABEL = { deschis: 'deschis', in_lucru: 'în lucru', rezolvat: 'rezolvat', anulat: 'anulat' }

function buildHtml({ sed, linii, numeProiect, numeParticipanti, invitati = [], numeProfil, stare, semnatura }) {
  const tipSed = { executie: 'Execuție', logistica: 'Logistică', general: 'General' }[sed.tip_sedinta] || sed.tip_sedinta
  const randuri = linii.filter(l => l.status !== 'anulat').map(l => `
    <tr>
      <td style="padding:5px 7px;border-bottom:1px solid #E5E7EB;white-space:nowrap;vertical-align:top;color:${TIP_CULOARE[l.tip] || '#374151'};font-weight:700;font-size:9px">${TIP_LABEL[l.tip] || l.tip}</td>
      <td style="padding:5px 7px;border-bottom:1px solid #E5E7EB;font-size:10px;color:#111827">${esc(l.text)}${l.provine_din_id ? ' <span style="color:#B45309;font-size:8.5px">(restanță din ședința anterioară)</span>' : ''}${l.tichet_id ? ` <span style="color:#7C3AED;font-size:8.5px">(tichet #${l.tichet_id})</span>` : ''}${l.observatii ? `<div style="margin-top:3px;font-size:9px;color:#4B5563;font-style:italic;white-space:pre-wrap">${esc(l.observatii)}</div>` : ''}</td>
      <td style="padding:5px 7px;border-bottom:1px solid #E5E7EB;white-space:nowrap;font-size:9.5px;color:#374151;vertical-align:top">${l.tip === 'actiune' ? esc(numeProfil(l.responsabil_id) === '—' ? '' : numeProfil(l.responsabil_id)) : ''}</td>
      <td style="padding:5px 7px;border-bottom:1px solid #E5E7EB;white-space:nowrap;font-size:9.5px;color:#374151;vertical-align:top">${l.tip === 'actiune' && l.termen ? fmtData(l.termen) : ''}</td>
      <td style="padding:5px 7px;border-bottom:1px solid #E5E7EB;white-space:nowrap;font-size:9.5px;vertical-align:top;color:${l.status === 'rezolvat' ? '#166534' : l.status === 'in_lucru' ? '#1D4ED8' : '#6B7280'}">${l.tip === 'actiune' ? (ST_LABEL[l.status] || l.status) : ''}</td>
    </tr>`).join('')

  const stareHtml = stare ? `
    <div style="display:flex;gap:22px;flex-wrap:wrap;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;padding:9px 12px;margin:10px 0 4px">
      ${stare.termen ? `<div><div style="font-size:8px;color:#6B7280;text-transform:uppercase">Termen finalizare (${esc(stare.termenSursa || '')})</div><div style="font-size:11px;font-weight:700;color:${stare.zileRamase < 0 ? '#B91C1C' : '#111827'}">${fmtData(stare.termen)} · ${stare.zileRamase < 0 ? 'depășit cu ' + (-stare.zileRamase) + ' zile' : stare.zileRamase + ' zile rămase'}</div></div>` : ''}
      ${stare.pctTimp != null ? `<div><div style="font-size:8px;color:#6B7280;text-transform:uppercase">Timp consumat</div><div style="font-size:11px;font-weight:700">${stare.pctTimp.toFixed(0)}%</div></div>` : ''}
      ${stare.stadiu ? `<div><div style="font-size:8px;color:#6B7280;text-transform:uppercase">Stadiu fizic</div><div style="font-size:11px;font-weight:700">${stare.stadiu.pct.toFixed(0)}%</div></div>` : ''}
      ${stare.risc && stare.risc !== 'ok' ? `<div style="align-self:center;font-size:10px;font-weight:800;color:${stare.risc === 'critic' ? '#B91C1C' : '#B45309'}">decalaj ${stare.decalaj.toFixed(0)}% între timp și execuție</div>` : ''}
    </div>` : ''

  return `
  <div style="width:738px;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#111827;padding:4px 2px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #111827;padding-bottom:7px">
      <div>
        <div style="font-size:15px;font-weight:800">Proces-verbal ședință ${esc(tipSed)}</div>
        <div style="font-size:10px;color:#374151;margin-top:2px">${esc(sed.titlu || '')}</div>
      </div>
      <div style="text-align:right;font-size:10px;color:#374151">
        <div style="font-weight:700">${fmtData(sed.data)}</div>
        ${numeProiect ? `<div>${esc(numeProiect)}</div>` : ''}
        <div style="color:#9CA3AF">GAZPET INSTAL SRL</div>
      </div>
    </div>
    ${numeParticipanti.length ? `<div style="font-size:9.5px;color:#374151;margin-top:7px"><strong>Participanți:</strong> ${numeParticipanti.map(esc).join(', ')}</div>` : ''}
    ${(invitati.length || sed.participanti_alti) ? `<div style="font-size:9.5px;color:#374151;margin-top:3px"><strong>Invitați externi:</strong> ${[
      ...invitati.map(i => esc(i.nume) + (i.firma ? ' (' + esc(i.firma) + ')' : '')),
      ...(sed.participanti_alti ? [esc(sed.participanti_alti)] : []),
    ].join(', ')}</div>` : ''}
    ${stareHtml}
    <table style="width:100%;border-collapse:collapse;margin-top:8px">
      <thead><tr style="background:#111827;color:#fff">
        <th style="padding:5px 7px;text-align:left;font-size:8.5px;text-transform:uppercase">Tip</th>
        <th style="padding:5px 7px;text-align:left;font-size:8.5px;text-transform:uppercase">Punct discutat</th>
        <th style="padding:5px 7px;text-align:left;font-size:8.5px;text-transform:uppercase">Responsabil</th>
        <th style="padding:5px 7px;text-align:left;font-size:8.5px;text-transform:uppercase">Termen</th>
        <th style="padding:5px 7px;text-align:left;font-size:8.5px;text-transform:uppercase">Status</th>
      </tr></thead>
      <tbody>${randuri || '<tr><td colspan="5" style="padding:10px;color:#9CA3AF;font-size:10px">Fără puncte consemnate.</td></tr>'}</tbody>
    </table>
    ${sed.observatii ? `<div style="margin-top:10px;font-size:9.5px;color:#374151;white-space:pre-wrap"><strong>Observații:</strong> ${esc(sed.observatii)}</div>` : ''}
    ${semnatura ? `
    <div style="margin-top:16px;display:flex;justify-content:flex-end">
      <div style="text-align:center">
        <img src="${semnatura.dataUrl}" style="height:60px;max-width:220px;object-fit:contain;border-bottom:1px solid #111827" />
        <div style="font-size:9px;color:#111827;font-weight:700;margin-top:3px">${esc(semnatura.nume)}</div>
        <div style="font-size:8px;color:#6B7280">semnat ${new Date(semnatura.data).toLocaleString('ro-RO')}</div>
      </div>
    </div>` : ''}
    <div style="margin-top:14px;padding-top:6px;border-top:1px solid #E5E7EB;font-size:8px;color:#9CA3AF">
      Generat automat din PontajPRO · ${new Date().toLocaleString('ro-RO')} · Acțiunile nerezolvate se preiau automat în ședința următoare.
    </div>
  </div>`
}

// Construiește PDF-ul și îl întoarce ca Blob (+ nume de fișier sugerat).
export async function genereazaSedintaPdf({ sed, linii, numeProiect, numeParticipanti, invitati, numeProfil, stare, semnatura }) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0'
  host.innerHTML = buildHtml({ sed, linii, numeProiect, numeParticipanti, invitati, numeProfil, stare, semnatura })
  document.body.appendChild(host)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#fff' })
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const w = 190, h = (canvas.height * w) / canvas.width
    const pageH = 277
    let rest = h, y = 0
    while (rest > 0) {
      const partH = Math.min(pageH, rest)
      const part = document.createElement('canvas')
      part.width = canvas.width
      part.height = (partH / h) * canvas.height
      part.getContext('2d').drawImage(canvas, 0, (y / h) * canvas.height, canvas.width, part.height, 0, 0, canvas.width, part.height)
      if (y > 0) pdf.addPage()
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, w, partH)
      y += partH; rest -= partH
    }
    const nume = `PV_sedinta_${String(sed.data).slice(0, 10)}_${sed.id}.pdf`
    return { blob: pdf.output('blob'), nume }
  } finally {
    document.body.removeChild(host)
  }
}
