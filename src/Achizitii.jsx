// ════════════════════════════════════════════════════════════════════════════
// MODULUL ACHIZIȚII — v1.0 (12.06.2026)
// Comenzi Furnizor (PO digitalizat din Excel-ul Kostas) — Faza 2 UI
// Flux: draft → în aprobare (sau direct emisă sub 2500 lei) → emisă (PDF cu
// semnături electronice) → în tranzit → ajunsă → recepționată (PV 1) →
// în stoc (PV 2 predare-primire magazie + poză depozitare + intrare automată
// în tabelul `stocuri`).
// Aprobatori: listă configurabilă owner-only (comenzi_aprobatori), fiecare
// confirmă cu CLICK pe propriul rând din comenzi_furnizor_aprobari.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from './lib/supabase.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'

// ─── Theme (convenția repo) ──────────────────────────────────────────────────
const G = {
  bg:'#0D1117', surface:'#161B22', border:'#21262D', border2:'#30363D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  blue:'#58A6FF', green:'#3FB950', red:'#F85149', yellow:'#D29922',
  purple:'#BC8CFF', orange:'#F0883E', pink:'#EC6CB9',
  achizitii:'#3FB950',
}
const S = {
  page: { fontFamily:"'Syne','Barlow',sans-serif", background:G.bg, minHeight:'100vh', color:G.text },
  card: { background:G.surface, border:`1px solid ${G.border}`, borderRadius:12 },
  input: { background:G.bg, border:`1px solid ${G.border2}`, color:G.text, borderRadius:8, padding:'9px 12px', fontFamily:'inherit', fontSize:14, outline:'none', width:'100%' },
  btnP: { background:'#1F6FEB', color:'white', border:'none', borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:700, cursor:'pointer' },
  btnS: { background:'#161B22', color:'#E6EDF3', border:'1px solid #30363D', borderRadius:8, padding:'10px 18px', fontFamily:'inherit', fontSize:14, fontWeight:600, cursor:'pointer' },
  // STANDARD UI 11.06.2026: butoane de acțiune MARI (≥16px font, touch target ~36px)
  btnIcon: { background:'transparent', border:`1px solid ${G.border2}`, borderRadius:8, padding:'8px 13px', fontSize:16, cursor:'pointer', color:G.text },
}

// ─── Constante business ──────────────────────────────────────────────────────
// Decizie Razvan 12.06.2026: comandă formală cu aprobare DOAR de la 2500 lei
// în sus; sub prag → direct emisă. Pentru EUR folosim un curs aprox. fix doar
// pentru testul de prag (nu pentru valori contabile).
const PRAG_APROBARE_LEI = 2500
const CURS_EUR_APROX = 5.0
const BUCKET = 'comenzi-furnizor'

const STATUS_INFO = {
  draft:        { label:'Draft',          emoji:'📝', color:G.muted  },
  in_aprobare:  { label:'În aprobare',    emoji:'⏳', color:G.yellow },
  emisa:        { label:'Emisă',          emoji:'📨', color:G.blue   },
  in_tranzit:   { label:'În tranzit',     emoji:'🚚', color:G.purple },
  ajunsa:       { label:'Ajunsă',         emoji:'📦', color:G.orange },
  receptionata: { label:'Recepționată',   emoji:'✅', color:G.green  },
  in_stoc:      { label:'În stoc',        emoji:'🏬', color:G.green  },
  anulata:      { label:'Anulată',        emoji:'⛔', color:G.dim    },
  respinsa:     { label:'Respinsă',       emoji:'❌', color:G.red    },
}
const FLOW_STEPS = ['draft','in_aprobare','emisa','in_tranzit','ajunsa','receptionata','in_stoc']

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtNr = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtData = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') }
const fmtDataOra = (d) => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('ro-RO') + ' ' + x.toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit' }) }
const totalComanda = (c) => (c?.linii || []).reduce((acc, l) => acc + (Number(l.cantitate) || 0) * (Number(l.pret_unitar) || 0), 0)
const totalInLei = (c) => { const t = totalComanda(c); return (c?.moneda === 'EUR') ? t * CURS_EUR_APROX : t }
const subPrag = (c) => totalInLei(c) < PRAG_APROBARE_LEI && totalComanda(c) > 0

// Fuzzy match nume (pattern repo: normalize + ≥2 tokens comune)
const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
function findEmployeeByName(name, employees) {
  const toks = normalize(name).split(' ').filter(t => t.length >= 2)
  if (!toks.length) return null
  let best = null, bestScore = 0
  for (const e of employees || []) {
    const target = ' ' + normalize(e.name) + ' '
    const score = toks.filter(t => target.includes(' ' + t) || target.includes(t)).length
    if (score >= 2 && score > bestScore) { best = e; bestScore = score }
  }
  return best
}

// CORS fix html2canvas: signed URL → dataURL base64
async function fetchAsDataURL(url) {
  const resp = await fetch(url)
  const blob = await resp.blob()
  return await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result)
    r.onerror = rej
    r.readAsDataURL(blob)
  })
}

// Cache semnături pe sesiune (aceiași aprobatori la toate comenzile)
const _semnCache = new Map()
async function getSemnaturaDataURL(employeeId) {
  if (!employeeId) return null
  if (_semnCache.has(employeeId)) return _semnCache.get(employeeId)
  try {
    const { data: rows } = await supabase.from('hr_semnaturi_electronice')
      .select('fisier_path').eq('employee_id', employeeId).eq('activ', true).limit(1)
    if (!rows || !rows.length) { _semnCache.set(employeeId, null); return null }
    const { data: su } = await supabase.storage.from('hr-semnaturi').createSignedUrl(rows[0].fisier_path, 120)
    if (!su?.signedUrl) { _semnCache.set(employeeId, null); return null }
    const dataUrl = await fetchAsDataURL(su.signedUrl)
    _semnCache.set(employeeId, dataUrl)
    return dataUrl
  } catch { _semnCache.set(employeeId, null); return null }
}

// HTML offscreen 794px → html2canvas scale 2 → jsPDF A4 portrait → Blob
async function renderHtmlToPdfBlob(html) {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#ffffff;z-index:-1;'
  holder.innerHTML = html
  document.body.appendChild(holder)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', logging: false })
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST')
    return doc.output('blob')
  } finally {
    document.body.removeChild(holder)
  }
}

async function uploadPdf(blob, path) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'application/pdf', upsert: true })
  if (error) throw error
  return path
}

async function openStorageFile(path) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}

const uniq8 = () => Math.random().toString(36).slice(2, 10)
const todayISO = () => new Date().toISOString().slice(0, 10)

// ════════════════════════════════════════════════════════════════════════════
// TEMPLATE-URI HTML pentru PDF (colgroup PROCENTE — zona utilă A4 = 738px)
// ════════════════════════════════════════════════════════════════════════════
const PDF_BASE = `font-family:Arial,Helvetica,sans-serif;color:#111;padding:28px;width:794px;box-sizing:border-box;background:#fff;`
const pdfHeader = (titlu, subtitlu) => `
  <div style="display:flex;align-items:center;gap:14px;border-bottom:3px solid #1F6FEB;padding-bottom:10px;margin-bottom:14px;">
    <img src="${LOGO_B64}" style="height:46px;" />
    <div style="flex:1;">
      <div style="font-size:17px;font-weight:bold;">GAZPET INSTAL S.R.L.</div>
      <div style="font-size:10px;color:#555;">Ploiești, Prahova · Construcții conducte gaze naturale</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:16px;font-weight:bold;color:#1F6FEB;">${titlu}</div>
      <div style="font-size:11px;color:#333;">${subtitlu}</div>
    </div>
  </div>`
const pdfFooterAudit = () => `
  <div style="margin-top:18px;border-top:1px solid #ccc;padding-top:6px;font-size:9px;color:#777;">
    Document generat electronic din Gazpet ERP la ${new Date().toLocaleDateString('ro-RO')} ${new Date().toLocaleTimeString('ro-RO')} · semnăturile electronice sunt aplicate din baza de date cu confirmarea fiecărui semnatar.
  </div>`
const semnBox = (rol, nume, dataUrl, decisLa) => `
  <div style="display:inline-block;width:30%;vertical-align:top;text-align:center;margin:0 1.5%;">
    <div style="font-size:10px;color:#555;text-transform:uppercase;">${rol || ''}</div>
    <div style="font-size:12px;font-weight:bold;margin:2px 0 4px;">${nume || ''}</div>
    <div style="height:52px;display:flex;align-items:center;justify-content:center;">
      ${dataUrl ? `<img src="${dataUrl}" style="max-height:50px;max-width:160px;" />` : `<div style="border-bottom:1px solid #333;width:150px;height:30px;"></div>`}
    </div>
    <div style="font-size:9px;color:#777;">${decisLa ? 'confirmat ' + new Date(decisLa).toLocaleDateString('ro-RO') : (dataUrl ? '' : 'semnătură olografă')}</div>
  </div>`

function liniileTabelHtml(linii, moneda) {
  const total = (linii || []).reduce((a, l) => a + (Number(l.cantitate) || 0) * (Number(l.pret_unitar) || 0), 0)
  const rows = (linii || []).map((l, i) => `
    <tr>
      <td style="border:1px solid #999;padding:5px 6px;text-align:center;font-size:10px;">${i + 1}</td>
      <td style="border:1px solid #999;padding:5px 6px;font-size:10px;">${l.denumire || ''}${l.observatii ? `<div style="font-size:9px;color:#666;">${l.observatii}</div>` : ''}</td>
      <td style="border:1px solid #999;padding:5px 6px;text-align:center;font-size:10px;">${l.um || ''}</td>
      <td style="border:1px solid #999;padding:5px 6px;text-align:right;font-size:10px;">${fmtNr(l.cantitate)}</td>
      <td style="border:1px solid #999;padding:5px 6px;text-align:right;font-size:10px;">${l.pret_unitar != null ? fmtNr(l.pret_unitar) : '—'}</td>
      <td style="border:1px solid #999;padding:5px 6px;text-align:right;font-size:10px;font-weight:bold;">${fmtNr((Number(l.cantitate) || 0) * (Number(l.pret_unitar) || 0))}</td>
      <td style="border:1px solid #999;padding:5px 6px;text-align:center;font-size:10px;">${l.termen_livrare ? fmtData(l.termen_livrare) : '—'}</td>
    </tr>`).join('')
  return `
  <table style="width:100%;border-collapse:collapse;margin-top:8px;">
    <colgroup>
      <col style="width:5.5%"/><col style="width:37%"/><col style="width:8%"/>
      <col style="width:11%"/><col style="width:13%"/><col style="width:14.5%"/><col style="width:11%"/>
    </colgroup>
    <thead>
      <tr style="background:#E8F0FE;">
        ${['Nr.', 'Denumire produs / material', 'UM', 'Cantitate', `Preț unitar (${moneda})`, `Valoare (${moneda})`, 'Termen livrare']
          .map(h => `<th style="border:1px solid #999;padding:6px;font-size:10px;">${h}</th>`).join('')}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5" style="border:1px solid #999;padding:6px;text-align:right;font-size:11px;font-weight:bold;">TOTAL (fără TVA)</td>
        <td style="border:1px solid #999;padding:6px;text-align:right;font-size:11px;font-weight:bold;background:#E8F0FE;">${fmtNr(total)} ${moneda}</td>
        <td style="border:1px solid #999;"></td>
      </tr>
    </tfoot>
  </table>`
}

function infoRowsHtml(pairs) {
  return `<table style="width:100%;border-collapse:collapse;margin:6px 0;">
    ${pairs.filter(p => p[1]).map(p => `
      <tr>
        <td style="width:28%;padding:3px 6px;font-size:10px;color:#555;">${p[0]}</td>
        <td style="padding:3px 6px;font-size:11px;font-weight:${p[2] ? 'bold' : 'normal'};">${p[1]}</td>
      </tr>`).join('')}
  </table>`
}

function buildComandaPdfHtml(c, ctx) {
  // ctx: { furnizorNume, furnizorCui, contractNr, proiectNume, livrareTxt, semnaturi: [{rol,nume,dataUrl,decisLa}] }
  return `<div style="${PDF_BASE}">
    ${pdfHeader('COMANDĂ FURNIZOR', `${c.numar_comanda} · ${fmtData(c.data_emitere || new Date())}`)}
    <div style="display:flex;gap:14px;">
      <div style="flex:1;border:1px solid #ccc;border-radius:6px;padding:8px;">
        <div style="font-size:11px;font-weight:bold;color:#1F6FEB;margin-bottom:4px;">CĂTRE FURNIZOR</div>
        ${infoRowsHtml([
          ['Furnizor:', ctx.furnizorNume, true],
          ['CUI / CIF:', ctx.furnizorCui],
          ['Contract:', ctx.contractNr],
          ['Persoană contact:', c.persoana_contact],
          ['Telefon:', c.telefon_contact],
        ])}
      </div>
      <div style="flex:1;border:1px solid #ccc;border-radius:6px;padding:8px;">
        <div style="font-size:11px;font-weight:bold;color:#1F6FEB;margin-bottom:4px;">DETALII COMANDĂ</div>
        ${infoRowsHtml([
          ['Proiect / lucrare:', ctx.proiectNume],
          ['Livrare către:', ctx.livrareTxt, true],
          ['Monedă:', c.moneda],
          ['Verificare juridică:', c.confirmare_juridica ? 'DA — confirmată' : '—'],
        ])}
      </div>
    </div>
    ${liniileTabelHtml(c.linii, c.moneda)}
    ${c.observatii ? `<div style="margin-top:8px;font-size:10px;"><b>Observații:</b> ${c.observatii}</div>` : ''}
    <div style="margin-top:24px;text-align:center;">
      ${(ctx.semnaturi || []).map(s => semnBox(s.rol, s.nume, s.dataUrl, s.decisLa)).join('')}
    </div>
    ${pdfFooterAudit()}
  </div>`
}

function buildPvReceptieHtml(c, ctx) {
  // ctx: { furnizorNume, proiectNume, livrareTxt, semnaturi:[{rol,nume,dataUrl,decisLa}] }
  return `<div style="${PDF_BASE}">
    ${pdfHeader('PROCES-VERBAL DE RECEPȚIE', `calitativă și cantitativă · ${c.numar_comanda}`)}
    <div style="font-size:11px;line-height:1.6;margin:8px 0;">
      Subsemnații, în calitate de comisie de recepție, am procedat astăzi, <b>${fmtData(new Date())}</b>,
      la recepția calitativă și cantitativă a materialelor livrate de furnizorul
      <b>${ctx.furnizorNume || '—'}</b> conform comenzii <b>${c.numar_comanda}</b>
      ${ctx.proiectNume ? `pentru lucrarea <b>${ctx.proiectNume}</b>` : ''},
      cu livrare la <b>${ctx.livrareTxt}</b>.
    </div>
    ${liniileTabelHtml(c.linii, c.moneda)}
    <div style="font-size:11px;margin-top:10px;">
      Materialele de mai sus corespund calitativ și cantitativ cu documentele de livrare și cu comanda emisă.
      Comisia constată că recepția poate fi efectuată fără obiecțiuni.
    </div>
    <div style="margin-top:26px;text-align:center;">
      ${(ctx.semnaturi || []).map(s => semnBox(s.rol, s.nume, s.dataUrl, s.decisLa)).join('')}
    </div>
    ${pdfFooterAudit()}
  </div>`
}

function buildPvPredareHtml(c, ctx) {
  // ctx: { proiectNume, livrareTxt, pozaDataUrl, semnaturi:[...] }
  return `<div style="${PDF_BASE}">
    ${pdfHeader('PV PREDARE-PRIMIRE MAGAZIE', `${c.numar_comanda} · ${fmtData(new Date())}`)}
    <div style="font-size:11px;line-height:1.6;margin:8px 0;">
      Materialele recepționate conform PV-ului de recepție aferent comenzii <b>${c.numar_comanda}</b>
      ${ctx.proiectNume ? `(lucrarea <b>${ctx.proiectNume}</b>)` : ''} au fost predate de Departamentul Achiziții
      și primite în gestiune la <b>${ctx.livrareTxt}</b>. Cantitățile intră automat în evidența de stoc Gazpet ERP.
    </div>
    ${liniileTabelHtml(c.linii, c.moneda)}
    ${ctx.pozaDataUrl ? `
      <div style="margin-top:10px;">
        <div style="font-size:10px;font-weight:bold;color:#1F6FEB;margin-bottom:4px;">DOVADĂ FOTO — LOC DEPOZITARE</div>
        <img src="${ctx.pozaDataUrl}" style="max-width:340px;max-height:220px;border:1px solid #999;border-radius:4px;" />
      </div>` : ''}
    <div style="margin-top:24px;text-align:center;">
      ${(ctx.semnaturi || []).map(s => semnBox(s.rol, s.nume, s.dataUrl, s.decisLa)).join('')}
    </div>
    ${pdfFooterAudit()}
  </div>`
}

// ════════════════════════════════════════════════════════════════════════════
// Toast + componente mici
// ════════════════════════════════════════════════════════════════════════════
function useToast() {
  const [toast, setToast] = useState(null)
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4200)
  }, [])
  const ToastEl = toast ? (
    <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background: toast.type === 'error' ? G.red : toast.type === 'warn' ? G.yellow : G.green, color:'#0D1117', padding:'12px 20px', borderRadius:10, fontWeight:700, fontSize:14, boxShadow:'0 8px 24px rgba(0,0,0,.5)', maxWidth:420 }}>
      {toast.msg}
    </div>
  ) : null
  return { showToast, ToastEl }
}

function StatusBadge({ status, big = false }) {
  const inf = STATUS_INFO[status] || { label: status, emoji: '·', color: G.muted }
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, background: inf.color + '22', color: inf.color, border:`1px solid ${inf.color}55`, borderRadius: 20, padding: big ? '6px 16px' : '3px 11px', fontSize: big ? 14 : 12, fontWeight:700, whiteSpace:'nowrap' }}>
      {inf.emoji} {inf.label}
    </span>
  )
}

function FluxTimeline({ status }) {
  if (status === 'anulata' || status === 'respinsa') return null
  const idx = FLOW_STEPS.indexOf(status)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap', margin:'10px 0' }}>
      {FLOW_STEPS.map((s, i) => {
        const inf = STATUS_INFO[s]
        const done = i < idx, curr = i === idx
        return (
          <div key={s} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', borderRadius:16, fontSize:11, fontWeight:700,
              background: curr ? inf.color + '33' : done ? G.green + '18' : 'transparent',
              color: curr ? inf.color : done ? G.green : G.dim,
              border: `1px solid ${curr ? inf.color : done ? G.green + '66' : G.border}` }}>
              {done ? '✓' : inf.emoji} {inf.label}
            </div>
            {i < FLOW_STEPS.length - 1 && <span style={{ color: done ? G.green : G.dim, fontSize:11 }}>→</span>}
          </div>
        )
      })}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// FURNIZOR COMBOBOX — select din logistica_furnizori + „＋ Furnizor nou" inline
// (pattern PartenerCombobox din Tichete; decizie Razvan 12.06: lista de
// FURNIZORI de materiale, NU contractele/subcontractorii din contracte_terti)
// ════════════════════════════════════════════════════════════════════════════
function FurnizorCombobox({ value, onChange, furnizoriList, onFurnizorNou, showToast }) {
  const [adding, setAdding] = useState(false)
  const [nume, setNume] = useState('')
  const [cui, setCui] = useState('')
  const [contact, setContact] = useState('')
  const [saving, setSaving] = useState(false)

  const salveaza = async () => {
    if (!nume.trim()) { showToast('Numele furnizorului e obligatoriu.', 'error'); return }
    setSaving(true)
    try {
      const created = await onFurnizorNou({ nume: nume.trim(), cui: cui.trim() || null, contact: contact.trim() || null })
      if (created?.id) {
        onChange(String(created.id))
        setAdding(false); setNume(''); setCui(''); setContact('')
        showToast(`Furnizor „${created.nume}" adăugat și selectat.`)
      }
    } catch (e) { showToast('Eroare la adăugare furnizor: ' + (e.message || e), 'error') } finally { setSaving(false) }
  }

  if (adding) return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:6, padding:10, background:G.bg, borderRadius:8, border:`1px solid ${G.achizitii}66` }}>
      <input style={S.input} placeholder="Nume furnizor * (ex: SINTAX)" value={nume} onChange={e => setNume(e.target.value)} autoFocus />
      <div style={{ display:'flex', gap:6 }}>
        <input style={S.input} placeholder="CUI (opțional)" value={cui} onChange={e => setCui(e.target.value)} />
        <input style={S.input} placeholder="Contact (nume · telefon)" value={contact} onChange={e => setContact(e.target.value)} />
      </div>
      <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
        <button onClick={() => setAdding(false)} disabled={saving} style={{ ...S.btnS, padding:'7px 12px', fontSize:13 }}>Anulează</button>
        <button onClick={salveaza} disabled={saving} style={{ ...S.btnP, padding:'7px 14px', fontSize:13, background:G.achizitii, color:'#0D1117' }}>{saving ? '...' : '✓ Salvează furnizor'}</button>
      </div>
    </div>
  )
  return (
    <div style={{ display:'flex', gap:6 }}>
      <select style={S.input} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— Alege furnizor —</option>
        {furnizoriList.map(f => <option key={f.id} value={f.id}>{f.nume}{f.cui ? ` (${f.cui})` : ''}</option>)}
      </select>
      <button onClick={() => setAdding(true)} title="Adaugă furnizor nou" style={{ ...S.btnS, padding:'9px 12px', fontSize:13, whiteSpace:'nowrap', color:G.achizitii, borderColor:G.achizitii + '66', fontWeight:700 }}>＋ Nou</button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: COMANDĂ NOUĂ / EDITARE DRAFT
// ════════════════════════════════════════════════════════════════════════════
const LINIE_GOALA = () => ({ _k: uniq8(), denumire:'', um:'buc', cantitate:'', pret_unitar:'', termen_livrare:'', observatii:'' })

function ComandaFormModal({ comanda, proiecte, furnizoriList, onFurnizorNou, sites, profile, onClose, onSaved, showToast }) {
  const editMode = !!comanda
  const [form, setForm] = useState(() => editMode ? {
    proiect_id: comanda.proiect_id || '',
    furnizor_id: comanda.furnizor_id || '',
    persoana_contact: comanda.persoana_contact || '',
    telefon_contact: comanda.telefon_contact || '',
    livrare_tip: comanda.livrare_tip || 'santier',
    livrare_site_id: comanda.livrare_site_id || '',
    moneda: comanda.moneda || 'EUR',
    confirmare_juridica: !!comanda.confirmare_juridica,
    observatii: comanda.observatii || '',
  } : {
    proiect_id:'', furnizor_id:'', persoana_contact:'', telefon_contact:'',
    livrare_tip:'santier', livrare_site_id:'', moneda:'EUR', confirmare_juridica:false, observatii:'',
  })
  const [linii, setLinii] = useState(() => editMode && comanda.linii?.length
    ? comanda.linii.slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0)).map(l => ({ _k: uniq8(), denumire: l.denumire || '', um: l.um || '', cantitate: l.cantitate ?? '', pret_unitar: l.pret_unitar ?? '', termen_livrare: l.termen_livrare || '', observatii: l.observatii || '' }))
    : [LINIE_GOALA()])
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setLinie = (k, field, v) => setLinii(ls => ls.map(l => l._k === k ? { ...l, [field]: v } : l))
  const addLinie = () => setLinii(ls => [...ls, LINIE_GOALA()])
  const delLinie = (k) => setLinii(ls => ls.length > 1 ? ls.filter(l => l._k !== k) : ls)

  // Autofill la selectare proiect: șantier livrare din proiect.site_id
  const onProiect = (pid) => {
    set('proiect_id', pid)
    const p = proiecte.find(x => String(x.id) === String(pid))
    if (p?.site_id && form.livrare_tip === 'santier' && !form.livrare_site_id) set('livrare_site_id', p.site_id)
  }
  // Autofill contact din fișa furnizorului (logistica_furnizori.contact = „nume · telefon")
  const onFurnizor = (fid) => {
    set('furnizor_id', fid)
    const fz = furnizoriList.find(x => String(x.id) === String(fid))
    if (fz?.contact && !form.persoana_contact && !form.telefon_contact) {
      const tel = (fz.contact.match(/0\d[\d\s.-]{7,}/) || [])[0]
      if (tel) {
        set('telefon_contact', tel.trim())
        const nume = fz.contact.replace(tel, '').replace(/[·,;|-]\s*$|^\s*[·,;|-]/g, '').trim()
        if (nume) set('persoana_contact', nume)
      } else set('persoana_contact', fz.contact)
    }
  }

  const liniiValide = linii.filter(l => l.denumire.trim() && Number(l.cantitate) > 0)
  const total = liniiValide.reduce((a, l) => a + (Number(l.cantitate) || 0) * (Number(l.pret_unitar) || 0), 0)
  const totalLei = form.moneda === 'EUR' ? total * CURS_EUR_APROX : total
  const vaSariAprobarea = total > 0 && totalLei < PRAG_APROBARE_LEI

  const valid = () => {
    if (!form.furnizor_id) { showToast('Alege furnizorul (sau adaugă-l cu „＋ Nou").', 'error'); return false }
    if (!liniiValide.length) { showToast('Adaugă cel puțin o linie cu denumire + cantitate.', 'error'); return false }
    if (form.livrare_tip === 'santier' && !form.livrare_site_id) { showToast('Alege șantierul de livrare.', 'error'); return false }
    return true
  }

  const save = async (apoiTrimite) => {
    if (!valid()) return
    setSaving(true)
    try {
      let comandaId = comanda?.id
      const header = {
        proiect_id: form.proiect_id || null,
        furnizor_id: form.furnizor_id || null,
        persoana_contact: form.persoana_contact.trim() || null,
        telefon_contact: form.telefon_contact.trim() || null,
        livrare_tip: form.livrare_tip,
        livrare_site_id: form.livrare_tip === 'santier' ? (form.livrare_site_id || null) : null,
        moneda: form.moneda,
        confirmare_juridica: form.confirmare_juridica,
        confirmare_juridica_de: form.confirmare_juridica ? profile.id : null,
        confirmare_juridica_la: form.confirmare_juridica ? new Date().toISOString() : null,
        observatii: form.observatii.trim() || null,
        updated_at: new Date().toISOString(),
      }
      if (!editMode) {
        // Numerotare atomică CMD_{COD_PROIECT}_{NNN}
        const { data: nr, error: eNr } = await supabase.rpc('fn_next_numar_comanda_furnizor', { p_proiect_id: form.proiect_id ? Number(form.proiect_id) : null })
        if (eNr) throw eNr
        const { data: ins, error: eIns } = await supabase.from('comenzi_furnizor')
          .insert({ ...header, numar_comanda: nr, status: 'draft' }).select('id').single()
        if (eIns) throw eIns
        comandaId = ins.id
      } else {
        const { error: eUpd } = await supabase.from('comenzi_furnizor').update(header).eq('id', comandaId)
        if (eUpd) throw eUpd
        const { error: eDel } = await supabase.from('comenzi_furnizor_linii').delete().eq('comanda_furnizor_id', comandaId)
        if (eDel) throw eDel
      }
      const rows = liniiValide.map((l, i) => ({
        comanda_furnizor_id: comandaId,
        denumire: l.denumire.trim(),
        um: l.um.trim() || null,
        cantitate: Number(l.cantitate),
        pret_unitar: l.pret_unitar !== '' && l.pret_unitar != null ? Number(l.pret_unitar) : null,
        termen_livrare: l.termen_livrare || null,
        observatii: l.observatii.trim() || null,
        display_order: i,
      }))
      const { error: eLin } = await supabase.from('comenzi_furnizor_linii').insert(rows)
      if (eLin) throw eLin
      showToast(editMode ? 'Comandă actualizată.' : 'Comandă salvată ca draft.')
      onSaved(comandaId, apoiTrimite)
    } catch (e) {
      console.error(e)
      showToast('Eroare la salvare: ' + (e.message || e), 'error')
    } finally { setSaving(false) }
  }

  const lbl = { fontSize:12, color:G.muted, marginBottom:4, display:'block', fontWeight:600 }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(980px,100%)', padding:22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
          <div style={{ fontSize:18, fontWeight:800 }}>🛒 {editMode ? `Editează ${comanda.numar_comanda}` : 'Comandă furnizor nouă'}</div>
          <button onClick={onClose} style={{ ...S.btnIcon, border:'none', fontSize:20 }}>✕</button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div>
            <label style={lbl}>Proiect / lucrare (pentru numerotare CMD)</label>
            <select style={S.input} value={form.proiect_id} onChange={e => onProiect(e.target.value)}>
              <option value="">— Fără proiect (general) —</option>
              {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? `[${p.cod_intern}] ` : ''}{p.nume}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Furnizor materiale *</label>
            <FurnizorCombobox value={form.furnizor_id} onChange={onFurnizor} furnizoriList={furnizoriList} onFurnizorNou={onFurnizorNou} showToast={showToast} />
          </div>
          <div>
            <label style={lbl}>Persoană contact furnizor</label>
            <input style={S.input} value={form.persoana_contact} onChange={e => set('persoana_contact', e.target.value)} placeholder="ex: Ion Popescu" />
          </div>
          <div>
            <label style={lbl}>Telefon contact</label>
            <input style={S.input} value={form.telefon_contact} onChange={e => set('telefon_contact', e.target.value)} placeholder="07xx xxx xxx" />
          </div>
          <div>
            <label style={lbl}>Livrare către *</label>
            <div style={{ display:'flex', gap:8 }}>
              {[['santier', '🏗️ Șantier'], ['sediu', '🏢 Sediu']].map(([v, t]) => (
                <button key={v} onClick={() => set('livrare_tip', v)} style={{ ...S.btnS, flex:1, padding:'10px 8px', background: form.livrare_tip === v ? G.achizitii + '22' : G.surface, borderColor: form.livrare_tip === v ? G.achizitii : G.border2, color: form.livrare_tip === v ? G.achizitii : G.text, fontWeight:700 }}>{t}</button>
              ))}
            </div>
            {form.livrare_tip === 'santier' && (
              <select style={{ ...S.input, marginTop:8 }} value={form.livrare_site_id} onChange={e => set('livrare_site_id', e.target.value)}>
                <option value="">— Alege șantierul —</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label style={lbl}>Monedă</label>
            <select style={S.input} value={form.moneda} onChange={e => set('moneda', e.target.value)}>
              <option value="EUR">EUR</option>
              <option value="RON">RON</option>
            </select>
          </div>
        </div>

        {/* Linii comandă */}
        <div style={{ marginTop:18 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <div style={{ fontSize:14, fontWeight:800 }}>📋 Linii comandă</div>
            <button onClick={addLinie} style={{ ...S.btnS, padding:'8px 14px', fontSize:14, color:G.achizitii, borderColor:G.achizitii + '66', fontWeight:700 }}>＋ Adaugă linie</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 70px 90px 110px 130px 44px', gap:6, fontSize:11, color:G.dim, padding:'0 2px', marginBottom:4 }}>
            <div>Denumire material / produs</div><div>UM</div><div>Cantitate</div><div>Preț unitar</div><div>Termen livrare</div><div></div>
          </div>
          {linii.map(l => (
            <div key={l._k} style={{ display:'grid', gridTemplateColumns:'1fr 70px 90px 110px 130px 44px', gap:6, marginBottom:6 }}>
              <input style={S.input} value={l.denumire} onChange={e => setLinie(l._k, 'denumire', e.target.value)} placeholder="ex: Țeavă OL 219x6.3 SRL 360" />
              <input style={S.input} value={l.um} onChange={e => setLinie(l._k, 'um', e.target.value)} placeholder="buc" />
              <input style={S.input} type="number" min="0" step="any" value={l.cantitate} onChange={e => setLinie(l._k, 'cantitate', e.target.value)} placeholder="0" />
              <input style={S.input} type="number" min="0" step="any" value={l.pret_unitar} onChange={e => setLinie(l._k, 'pret_unitar', e.target.value)} placeholder="0.00" />
              <input style={S.input} type="date" value={l.termen_livrare} onChange={e => setLinie(l._k, 'termen_livrare', e.target.value)} />
              <button onClick={() => delLinie(l._k)} title="Șterge linia" style={{ ...S.btnIcon, color:G.red, padding:'8px 10px' }}>🗑</button>
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:16, alignItems:'center', marginTop:8, padding:'10px 14px', background:G.bg, borderRadius:8, border:`1px solid ${G.border}` }}>
            <div style={{ fontSize:13, color:G.muted }}>TOTAL comandă:</div>
            <div style={{ fontSize:18, fontWeight:800, color:G.achizitii }}>{fmtNr(total)} {form.moneda}</div>
          </div>
          {total > 0 && (
            <div style={{ marginTop:8, padding:'9px 13px', borderRadius:8, fontSize:12.5, fontWeight:600,
              background: vaSariAprobarea ? G.green + '15' : G.yellow + '15',
              border: `1px solid ${vaSariAprobarea ? G.green + '55' : G.yellow + '55'}`,
              color: vaSariAprobarea ? G.green : G.yellow }}>
              {vaSariAprobarea
                ? `✅ Sub pragul de ${PRAG_APROBARE_LEI} lei → la „Trimite" comanda se EMITE DIRECT, fără aprobare.`
                : `⏳ Peste pragul de ${PRAG_APROBARE_LEI} lei → la „Trimite" comanda intră în fluxul de APROBARE.`}
            </div>
          )}
        </div>

        <div style={{ marginTop:14 }}>
          <label style={lbl}>Observații</label>
          <textarea style={{ ...S.input, minHeight:60, resize:'vertical' }} value={form.observatii} onChange={e => set('observatii', e.target.value)} />
        </div>

        <label style={{ display:'flex', alignItems:'center', gap:10, marginTop:14, cursor:'pointer', padding:'10px 13px', background:G.bg, borderRadius:8, border:`1px solid ${form.confirmare_juridica ? G.achizitii : G.border2}` }}>
          <input type="checkbox" checked={form.confirmare_juridica} onChange={e => set('confirmare_juridica', e.target.checked)} style={{ width:18, height:18, accentColor:G.achizitii }} />
          <span style={{ fontSize:13, fontWeight:600 }}>⚖️ Confirm verificarea juridică a furnizorului (date firmă, bonitate, contract valid)</span>
        </label>

        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:20 }}>
          <button onClick={onClose} disabled={saving} style={S.btnS}>Anulează</button>
          <button onClick={() => save(false)} disabled={saving} style={{ ...S.btnS, fontWeight:700 }}>{saving ? '...' : '💾 Salvează draft'}</button>
          <button onClick={() => save(true)} disabled={saving} style={{ ...S.btnP, background:G.achizitii, color:'#0D1117' }}>{saving ? '...' : vaSariAprobarea ? '🚀 Trimite (emitere directă)' : '🚀 Trimite în aprobare'}</button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: RECEPȚIE (PV 1 — calitativă + cantitativă: MP + Achiziții)
// ════════════════════════════════════════════════════════════════════════════
function ReceptieModal({ comanda, profile, profilesMap, onClose, onConfirm, onFinalizeaza, busy }) {
  const mpOk = !!comanda.receptie_mp_profile
  const achOk = !!comanda.receptie_achizitii_profile
  const Bloc = ({ titlu, desc, done, profileId, la, tip }) => (
    <div style={{ flex:1, padding:14, borderRadius:10, border:`1px solid ${done ? G.green : G.border2}`, background: done ? G.green + '10' : G.bg }}>
      <div style={{ fontSize:13, fontWeight:800, marginBottom:4 }}>{titlu}</div>
      <div style={{ fontSize:11.5, color:G.muted, marginBottom:10 }}>{desc}</div>
      {done ? (
        <div style={{ fontSize:13, color:G.green, fontWeight:700 }}>✅ {profilesMap[profileId] || 'Confirmat'}<div style={{ fontSize:11, color:G.muted, fontWeight:400 }}>{fmtDataOra(la)}</div></div>
      ) : (
        <button onClick={() => onConfirm(tip)} disabled={busy} style={{ ...S.btnP, background:G.achizitii, color:'#0D1117', width:'100%', fontSize:14 }}>
          ✍️ Confirm recepția — {profile?.name || 'eu'}
        </button>
      )}
    </div>
  )
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:14 }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(640px,100%)', padding:22 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:6 }}>✅ Recepție calitativă + cantitativă</div>
        <div style={{ fontSize:12.5, color:G.muted, marginBottom:16 }}>
          Comanda <b style={{ color:G.text }}>{comanda.numar_comanda}</b> — confirmă AMBELE părți (Manager Proiect + Achiziții), apoi se generează PV-ul de recepție cu semnături electronice.
        </div>
        <div style={{ display:'flex', gap:12 }}>
          <Bloc titlu="👷 Manager Proiect" desc="Verifică pe teren calitatea și cantitatea materialelor livrate." done={mpOk} profileId={comanda.receptie_mp_profile} la={comanda.receptie_mp_la} tip="mp" />
          <Bloc titlu="📥 Achiziții" desc="Verifică corespondența cu comanda emisă și documentele de livrare." done={achOk} profileId={comanda.receptie_achizitii_profile} la={comanda.receptie_achizitii_la} tip="achizitii" />
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18 }}>
          <button onClick={onClose} disabled={busy} style={S.btnS}>Închide</button>
          <button onClick={onFinalizeaza} disabled={busy || !mpOk || !achOk} style={{ ...S.btnP, background: (mpOk && achOk) ? G.green : G.border2, color:'#0D1117', opacity: busy ? .6 : 1 }}>
            {busy ? 'Generez PV...' : '📄 Generează PV recepție + finalizează'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: PREDARE MAGAZIE (PV 2 — Achiziții → Magazioner + POZĂ obligatorie)
// ════════════════════════════════════════════════════════════════════════════
function PredareModal({ comanda, profile, profilesMap, onClose, onConfirm, onFinalizeaza, busy }) {
  const [pozaFile, setPozaFile] = useState(null)
  const [pozaPreview, setPozaPreview] = useState(null)
  const predOk = !!comanda.predare_achizitii_profile
  const primOk = !!comanda.primire_magazioner_profile

  const onPoza = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.type.startsWith('image/')) return
    setPozaFile(f)
    const r = new FileReader()
    r.onload = () => setPozaPreview(r.result)
    r.readAsDataURL(f)
  }

  const Bloc = ({ titlu, desc, done, profileId, la, tip }) => (
    <div style={{ flex:1, padding:14, borderRadius:10, border:`1px solid ${done ? G.green : G.border2}`, background: done ? G.green + '10' : G.bg }}>
      <div style={{ fontSize:13, fontWeight:800, marginBottom:4 }}>{titlu}</div>
      <div style={{ fontSize:11.5, color:G.muted, marginBottom:10 }}>{desc}</div>
      {done ? (
        <div style={{ fontSize:13, color:G.green, fontWeight:700 }}>✅ {profilesMap[profileId] || 'Confirmat'}<div style={{ fontSize:11, color:G.muted, fontWeight:400 }}>{fmtDataOra(la)}</div></div>
      ) : (
        <button onClick={() => onConfirm(tip)} disabled={busy} style={{ ...S.btnP, background:G.achizitii, color:'#0D1117', width:'100%', fontSize:14 }}>
          ✍️ Confirm — {profile?.name || 'eu'}
        </button>
      )}
    </div>
  )
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:14, overflowY:'auto' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(680px,100%)', padding:22 }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:17, fontWeight:800, marginBottom:6 }}>🏬 Predare-primire magazie</div>
        <div style={{ fontSize:12.5, color:G.muted, marginBottom:16 }}>
          Comanda <b style={{ color:G.text }}>{comanda.numar_comanda}</b> — confirmare predare (Achiziții) + primire (Magazioner), <b style={{ color:G.orange }}>poză loc depozitare OBLIGATORIE</b>. La finalizare cantitățile intră automat în stoc.
        </div>
        <div style={{ display:'flex', gap:12 }}>
          <Bloc titlu="📥 Achiziții — predă" desc="Predă materialele recepționate către gestiune." done={predOk} profileId={comanda.predare_achizitii_profile} la={comanda.predare_achizitii_la} tip="predare" />
          <Bloc titlu="📦 Magazioner — primește" desc="Primește în gestiune și depozitează materialele." done={primOk} profileId={comanda.primire_magazioner_profile} la={comanda.primire_magazioner_la} tip="primire" />
        </div>
        <div style={{ marginTop:14, padding:14, borderRadius:10, border:`1px dashed ${pozaFile ? G.green : G.orange}`, background:G.bg }}>
          <div style={{ fontSize:13, fontWeight:800, marginBottom:8 }}>📸 Poză loc depozitare (obligatorie)</div>
          <input type="file" accept="image/*" capture="environment" onChange={onPoza} style={{ fontSize:13, color:G.muted }} />
          {pozaPreview && <img src={pozaPreview} alt="depozitare" style={{ display:'block', marginTop:10, maxWidth:280, maxHeight:200, borderRadius:8, border:`1px solid ${G.border2}` }} />}
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18 }}>
          <button onClick={onClose} disabled={busy} style={S.btnS}>Închide</button>
          <button onClick={() => onFinalizeaza(pozaFile)} disabled={busy || !predOk || !primOk || !pozaFile} style={{ ...S.btnP, background: (predOk && primOk && pozaFile) ? G.green : G.border2, color:'#0D1117', opacity: busy ? .6 : 1 }}>
            {busy ? 'Generez PV + stoc...' : '📄 PV predare + intrare în stoc'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL: DETALII COMANDĂ (aprobare + acțiuni flux + PDF-uri)
// ════════════════════════════════════════════════════════════════════════════
function ComandaDetailModal({ comanda, ctx, profile, profilesMap, onClose, actions, busy }) {
  const c = comanda
  const total = totalComanda(c)
  const aprobari = (c.aprobari || []).slice().sort((a, b) => (a.id || 0) - (b.id || 0))
  const myAprobare = aprobari.find(a => a.profile_id === profile?.id && a.status === 'in_asteptare')
  const [comentariu, setComentariu] = useState('')
  const Info = ({ k, v, bold }) => (
    <div style={{ display:'flex', gap:8, fontSize:13, padding:'3px 0' }}>
      <div style={{ width:150, color:G.muted, flexShrink:0 }}>{k}</div>
      <div style={{ fontWeight: bold ? 700 : 400 }}>{v || '—'}</div>
    </div>
  )
  const Btn = ({ children, onClick, color = G.blue, disabled }) => (
    <button onClick={onClick} disabled={busy || disabled} style={{ ...S.btnP, background: color, color:'#0D1117', fontSize:14, opacity: (busy || disabled) ? .55 : 1 }}>{children}</button>
  )
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', overflowY:'auto', padding:'30px 14px' }} onClick={onClose}>
      <div style={{ ...S.card, width:'min(1020px,100%)', padding:22 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:8, flexWrap:'wrap' }}>
          <div style={{ fontSize:19, fontWeight:800 }}>🛒 {c.numar_comanda}</div>
          <StatusBadge status={c.status} big />
          <div style={{ flex:1 }} />
          <button onClick={onClose} style={{ ...S.btnIcon, border:'none', fontSize:20 }}>✕</button>
        </div>
        <FluxTimeline status={c.status} />

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:10 }}>
          <div style={{ padding:14, background:G.bg, borderRadius:10, border:`1px solid ${G.border}` }}>
            <div style={{ fontSize:12, fontWeight:800, color:G.achizitii, marginBottom:6 }}>FURNIZOR</div>
            <Info k="Furnizor" v={ctx.furnizorNume} bold />
            <Info k="CUI / CIF" v={ctx.furnizorCui} />
            <Info k="Contract" v={ctx.contractNr} />
            <Info k="Contact" v={[c.persoana_contact, c.telefon_contact].filter(Boolean).join(' · ')} />
          </div>
          <div style={{ padding:14, background:G.bg, borderRadius:10, border:`1px solid ${G.border}` }}>
            <div style={{ fontSize:12, fontWeight:800, color:G.achizitii, marginBottom:6 }}>COMANDĂ</div>
            <Info k="Proiect" v={ctx.proiectNume} />
            <Info k="Livrare către" v={ctx.livrareTxt} bold />
            <Info k="Total" v={`${fmtNr(total)} ${c.moneda}`} bold />
            <Info k="Emisă" v={c.data_emitere ? `${fmtData(c.data_emitere)} · ${profilesMap[c.emisa_de] || ''}` : '—'} />
            <Info k="Verif. juridică" v={c.confirmare_juridica ? `✅ ${profilesMap[c.confirmare_juridica_de] || 'DA'}` : '—'} />
          </div>
        </div>

        {/* Linii */}
        <div style={{ marginTop:14, ...S.card, background:G.bg, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 64px 90px 110px 120px 100px', gap:0, padding:'8px 12px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Nr.</div><div>Denumire</div><div>UM</div><div style={{ textAlign:'right' }}>Cant.</div><div style={{ textAlign:'right' }}>Preț unit.</div><div style={{ textAlign:'right' }}>Valoare</div><div>Termen</div>
          </div>
          {(c.linii || []).slice().sort((a, b) => (a.display_order || 0) - (b.display_order || 0)).map((l, i) => (
            <div key={l.id || i} style={{ display:'grid', gridTemplateColumns:'40px 1fr 64px 90px 110px 120px 100px', padding:'8px 12px', fontSize:13, borderBottom:`1px solid ${G.border}` }}>
              <div style={{ color:G.dim }}>{i + 1}</div>
              <div>{l.denumire}{l.observatii && <div style={{ fontSize:11, color:G.muted }}>{l.observatii}</div>}</div>
              <div style={{ color:G.muted }}>{l.um || '—'}</div>
              <div style={{ textAlign:'right' }}>{fmtNr(l.cantitate)}</div>
              <div style={{ textAlign:'right' }}>{l.pret_unitar != null ? fmtNr(l.pret_unitar) : '—'}</div>
              <div style={{ textAlign:'right', fontWeight:700 }}>{fmtNr((Number(l.cantitate) || 0) * (Number(l.pret_unitar) || 0))}</div>
              <div style={{ color:G.muted }}>{l.termen_livrare ? fmtData(l.termen_livrare) : '—'}</div>
            </div>
          ))}
          <div style={{ display:'flex', justifyContent:'flex-end', padding:'10px 14px', fontSize:15, fontWeight:800, color:G.achizitii }}>TOTAL: {fmtNr(total)} {c.moneda}</div>
        </div>

        {c.observatii && <div style={{ marginTop:10, fontSize:13, color:G.muted }}><b style={{ color:G.text }}>Observații:</b> {c.observatii}</div>}

        {/* Panou aprobări */}
        {aprobari.length > 0 && (
          <div style={{ marginTop:14, padding:14, background:G.bg, borderRadius:10, border:`1px solid ${G.border}` }}>
            <div style={{ fontSize:13, fontWeight:800, marginBottom:10 }}>✍️ Aprobări ({aprobari.filter(a => a.status === 'aprobat').length}/{aprobari.length})</div>
            {aprobari.map(a => (
              <div key={a.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom:`1px solid ${G.border}`, flexWrap:'wrap' }}>
                <div style={{ minWidth:240 }}>
                  <div style={{ fontSize:13, fontWeight:700 }}>{profilesMap[a.profile_id] || '—'}</div>
                  <div style={{ fontSize:11, color:G.muted }}>{a.rol_afisat || ''}</div>
                </div>
                <div style={{ fontSize:13, fontWeight:700, color: a.status === 'aprobat' ? G.green : a.status === 'respins' ? G.red : G.yellow }}>
                  {a.status === 'aprobat' ? '✅ Aprobat' : a.status === 'respins' ? '❌ Respins' : '⏳ În așteptare'}
                  {a.decis_la && <span style={{ color:G.dim, fontWeight:400, fontSize:11 }}> · {fmtDataOra(a.decis_la)}</span>}
                </div>
                {a.comentariu && <div style={{ fontSize:12, color:G.muted, fontStyle:'italic' }}>„{a.comentariu}"</div>}
              </div>
            ))}
            {myAprobare && c.status === 'in_aprobare' && (
              <div style={{ marginTop:12, padding:12, borderRadius:10, border:`1px solid ${G.yellow}66`, background:G.yellow + '0E' }}>
                <div style={{ fontSize:13, fontWeight:800, marginBottom:8 }}>⚡ Decizia ta este așteptată</div>
                <input style={{ ...S.input, marginBottom:10 }} placeholder="Comentariu (opțional, obligatoriu la respingere)" value={comentariu} onChange={e => setComentariu(e.target.value)} />
                <div style={{ display:'flex', gap:10 }}>
                  <Btn color={G.green} onClick={() => actions.decideAprobare(c, myAprobare, 'aprobat', comentariu)}>✅ Aprob comanda</Btn>
                  <Btn color={G.red} disabled={!comentariu.trim()} onClick={() => actions.decideAprobare(c, myAprobare, 'respins', comentariu)}>❌ Resping</Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Documente generate */}
        {(c.pdf_comanda_path || c.pv_receptie_path || c.pv_predare_path || c.poza_depozitare_path) && (
          <div style={{ marginTop:14, display:'flex', gap:10, flexWrap:'wrap' }}>
            {c.pdf_comanda_path && <button onClick={() => openStorageFile(c.pdf_comanda_path)} style={{ ...S.btnS, fontSize:14 }}>📄 PDF Comandă</button>}
            {c.pv_receptie_path && <button onClick={() => openStorageFile(c.pv_receptie_path)} style={{ ...S.btnS, fontSize:14 }}>📄 PV Recepție</button>}
            {c.pv_predare_path && <button onClick={() => openStorageFile(c.pv_predare_path)} style={{ ...S.btnS, fontSize:14 }}>📄 PV Predare</button>}
            {c.poza_depozitare_path && <button onClick={() => openStorageFile(c.poza_depozitare_path)} style={{ ...S.btnS, fontSize:14 }}>📸 Poză depozitare</button>}
          </div>
        )}

        {/* Acțiuni flux */}
        <div style={{ display:'flex', justifyContent:'flex-end', gap:10, marginTop:18, flexWrap:'wrap' }}>
          {c.status === 'draft' && ctx.canCreate && (<>
            <Btn color={G.red} onClick={() => actions.anuleaza(c)}>⛔ Anulează</Btn>
            <Btn color={G.border2} onClick={() => actions.editeaza(c)}><span style={{ color:G.text }}>✏️ Editează</span></Btn>
            <Btn color={G.achizitii} onClick={() => actions.trimite(c)}>{subPrag(c) ? '🚀 Trimite (emitere directă)' : '🚀 Trimite în aprobare'}</Btn>
          </>)}
          {c.status === 'in_aprobare' && (profile?.is_owner || ctx.canCreate) && (
            <Btn color={G.red} onClick={() => actions.anuleaza(c)}>⛔ Anulează comanda</Btn>
          )}
          {c.status === 'emisa' && ctx.canCreate && <Btn color={G.purple} onClick={() => actions.markStatus(c, 'in_tranzit')}>🚚 Marchează ÎN TRANZIT</Btn>}
          {(c.status === 'emisa' || c.status === 'in_tranzit') && ctx.canCreate && <Btn color={G.orange} onClick={() => actions.markStatus(c, 'ajunsa')}>📦 Marchează AJUNSĂ</Btn>}
          {c.status === 'ajunsa' && <Btn color={G.green} onClick={() => actions.deschideReceptie(c)}>✅ Recepție (PV 1)</Btn>}
          {c.status === 'receptionata' && <Btn color={G.green} onClick={() => actions.deschidePredare(c)}>🏬 Predare magazie (PV 2)</Btn>}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// TAB APROBATORI (owner-only) — config comenzi_aprobatori
// ════════════════════════════════════════════════════════════════════════════
function AprobatoriTab({ aprobatori, profilesList, employees, onReload, showToast }) {
  const [adding, setAdding] = useState(false)
  const [npProfile, setNpProfile] = useState('')
  const [npRol, setNpRol] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!npProfile) { showToast('Alege utilizatorul.', 'error'); return }
    setBusy(true)
    try {
      const prof = profilesList.find(p => p.id === npProfile)
      const emp = findEmployeeByName(prof?.name, employees)
      const maxOrd = Math.max(0, ...aprobatori.map(a => a.ordine || 0))
      const { error } = await supabase.from('comenzi_aprobatori').insert({
        profile_id: npProfile,
        employee_id: emp?.id || null,
        rol_afisat: npRol.trim() || null,
        ordine: maxOrd + 1,
        activ: true,
      })
      if (error) throw error
      showToast(`Aprobator adăugat${emp ? ` (semnătură legată de ${emp.name})` : ' — fără match angajat, semnătura nu va apărea automat'}.`, emp ? 'success' : 'warn')
      setAdding(false); setNpProfile(''); setNpRol('')
      onReload()
    } catch (e) { showToast('Eroare: ' + (e.message || e), 'error') } finally { setBusy(false) }
  }
  const toggle = async (a) => {
    setBusy(true)
    try {
      const { error } = await supabase.from('comenzi_aprobatori').update({ activ: !a.activ }).eq('id', a.id)
      if (error) throw error
      onReload()
    } catch (e) { showToast('Eroare: ' + (e.message || e), 'error') } finally { setBusy(false) }
  }

  const profMap = Object.fromEntries(profilesList.map(p => [p.id, p.name]))
  const empMap = Object.fromEntries((employees || []).map(e => [e.id, e.name]))
  return (
    <div style={{ ...S.card, padding:18, marginTop:16 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
        <div style={{ fontSize:15, fontWeight:800 }}>👥 Aprobatori comenzi furnizor</div>
        <button onClick={() => setAdding(a => !a)} style={{ ...S.btnS, color:G.achizitii, borderColor:G.achizitii + '66', fontWeight:700 }}>＋ Adaugă aprobator</button>
      </div>
      <div style={{ fontSize:12, color:G.muted, marginBottom:12 }}>
        La trimiterea în aprobare se face SNAPSHOT al aprobatorilor activi — fiecare confirmă cu click, semnătura electronică se aplică automat pe PDF din baza HR. (Pantea Constantin se adaugă aici când are cont.)
      </div>
      {adding && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:10, padding:12, background:G.bg, borderRadius:10, border:`1px solid ${G.border2}`, marginBottom:12 }}>
          <select style={S.input} value={npProfile} onChange={e => setNpProfile(e.target.value)}>
            <option value="">— Utilizator —</option>
            {profilesList.filter(p => !aprobatori.some(a => a.activ && a.profile_id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input style={S.input} placeholder="Rol afișat (ex: Director Departament)" value={npRol} onChange={e => setNpRol(e.target.value)} />
          <button onClick={add} disabled={busy} style={{ ...S.btnP, background:G.achizitii, color:'#0D1117' }}>Salvează</button>
        </div>
      )}
      {aprobatori.map(a => (
        <div key={a.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'10px 0', borderBottom:`1px solid ${G.border}`, opacity: a.activ ? 1 : .45 }}>
          <div style={{ width:30, textAlign:'center', color:G.dim, fontWeight:700 }}>{a.ordine}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700 }}>{profMap[a.profile_id] || '—'}</div>
            <div style={{ fontSize:11.5, color:G.muted }}>{a.rol_afisat || 'fără rol afișat'} · semnătură: {a.employee_id ? (empMap[a.employee_id] || `emp #${a.employee_id}`) : '⚠️ nelegat'}</div>
          </div>
          <button onClick={() => toggle(a)} disabled={busy} style={{ ...S.btnIcon, color: a.activ ? G.red : G.green }} title={a.activ ? 'Dezactivează' : 'Reactivează'}>
            {a.activ ? '🚫 Dezactivează' : '✅ Reactivează'}
          </button>
        </div>
      ))}
      {!aprobatori.length && <div style={{ fontSize:13, color:G.dim, padding:'12px 0' }}>Niciun aprobator configurat.</div>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTĂ PRINCIPALĂ
// ════════════════════════════════════════════════════════════════════════════
export default function AchizitiiPage() {
  const { showToast, ToastEl } = useToast()
  const [profile, setProfile] = useState(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [tab, setTab] = useState('comenzi')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Date
  const [comenzi, setComenzi] = useState([])
  const [proiecte, setProiecte] = useState([])
  const [furnizoriList, setFurnizoriList] = useState([])
  const [contracteFallback, setContracteFallback] = useState([])
  const [sites, setSites] = useState([])
  const [profilesList, setProfilesList] = useState([])
  const [employees, setEmployees] = useState([])
  const [aprobatori, setAprobatori] = useState([])

  // UI state
  const [showForm, setShowForm] = useState(false)
  const [editComanda, setEditComanda] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [receptieId, setReceptieId] = useState(null)
  const [predareId, setPredareId] = useState(null)
  const [fStatus, setFStatus] = useState('')
  const [fProiect, setFProiect] = useState('')
  const [fSearch, setFSearch] = useState('')

  // ── Profil propriu (pattern Administrativ) ──────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (user) {
        const { data } = await supabase.from('profiles')
          .select('id, name, email, is_owner, can_create_comenzi, can_process_achizitii, can_manage_stoc')
          .eq('id', user.id).single()
        setProfile(data)
      }
      setLoadingProfile(false)
    })()
    return () => { cancelled = true }
  }, [])

  const isOwner = profile?.is_owner === true
  const canCreate = isOwner || profile?.can_process_achizitii === true || profile?.can_create_comenzi === true

  // ── Load all (FK-uri confirmate în BD → nested joins linii + aprobari) ──
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [rCom, rProj, rFz, rCtr, rSites, rProf, rEmp, rApr] = await Promise.all([
        supabase.from('comenzi_furnizor').select('*, linii:comenzi_furnizor_linii(*), aprobari:comenzi_furnizor_aprobari(*)').order('created_at', { ascending: false }),
        supabase.from('executie_proiecte').select('id, nume, cod_intern, site_id').eq('activ', true).order('nume'),
        supabase.from('logistica_furnizori').select('id, nume, cui, contact, activ').eq('activ', true).order('nume'),
        // Fallback DOAR pentru comenzile vechi legate de contract (înainte de furnizor_id)
        supabase.from('contracte_terti').select('id, numar_contract, denumire, partener_text').eq('sens', 'plata'),
        supabase.from('sites').select('id, name').eq('active', true).order('name'),
        supabase.from('profiles').select('id, name').order('name'),
        supabase.from('employees').select('id, name'),
        supabase.from('comenzi_aprobatori').select('*').order('ordine'),
      ])
      setComenzi(rCom.data || [])
      setProiecte(rProj.data || [])
      setFurnizoriList(rFz.data || [])
      setContracteFallback(rCtr.data || [])
      setSites(rSites.data || [])
      setProfilesList(rProf.data || [])
      setEmployees(rEmp.data || [])
      setAprobatori(rApr.data || [])
    } catch (e) {
      console.error(e)
      showToast('Eroare la încărcare date: ' + (e.message || e), 'error')
    } finally { setLoading(false) }
  }, [showToast]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deep-link din notificări: /achizitii?id=N → deschide direct comanda ──
  useEffect(() => {
    const idParam = new URLSearchParams(window.location.search).get('id')
    if (idParam && !isNaN(Number(idParam))) {
      setSelectedId(Number(idParam))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // ── Maps + ctx helpers ───────────────────────────────────────────────────
  const profilesMap = useMemo(() => Object.fromEntries(profilesList.map(p => [p.id, p.name])), [profilesList])
  const proiecteMap = useMemo(() => Object.fromEntries(proiecte.map(p => [p.id, p])), [proiecte])
  const furnizoriMap = useMemo(() => Object.fromEntries(furnizoriList.map(f => [f.id, f])), [furnizoriList])
  const contracteMap = useMemo(() => Object.fromEntries(contracteFallback.map(f => [f.id, f])), [contracteFallback])
  const sitesMap = useMemo(() => Object.fromEntries(sites.map(s => [s.id, s.name])), [sites])

  const ctxFor = useCallback((c) => {
    const fz = c.furnizor_id ? furnizoriMap[c.furnizor_id] : null
    const ctr = !fz && c.furnizor_contract_id ? contracteMap[c.furnizor_contract_id] : null
    const proiect = c.proiect_id ? proiecteMap[c.proiect_id] : null
    return {
      furnizorNume: fz?.nume || ctr?.partener_text || ctr?.denumire || '—',
      furnizorCui: fz?.cui || '',
      contractNr: ctr?.numar_contract || '',
      proiectNume: proiect ? `${proiect.cod_intern ? `[${proiect.cod_intern}] ` : ''}${proiect.nume}` : '',
      livrareTxt: c.livrare_tip === 'sediu' ? 'Sediu Gazpet Instal (Ploiești)' : `Șantier ${sitesMap[c.livrare_site_id] || '—'}`,
      canCreate,
    }
  }, [furnizoriMap, contracteMap, proiecteMap, sitesMap, canCreate])

  const selected = useMemo(() => comenzi.find(c => c.id === selectedId) || null, [comenzi, selectedId])
  const receptieComanda = useMemo(() => comenzi.find(c => c.id === receptieId) || null, [comenzi, receptieId])
  const predareComanda = useMemo(() => comenzi.find(c => c.id === predareId) || null, [comenzi, predareId])

  // ── Semnături pentru PDF-uri ─────────────────────────────────────────────
  const semnEmitent = async () => {
    const emp = findEmployeeByName(profile?.name, employees)
    const dataUrl = emp ? await getSemnaturaDataURL(emp.id) : null
    return { rol: 'Emitent · Achiziții', nume: profile?.name || '', dataUrl, decisLa: new Date().toISOString() }
  }
  const semnDinProfil = async (rol, profileId) => {
    const nume = profilesMap[profileId] || ''
    const emp = findEmployeeByName(nume, employees)
    const dataUrl = emp ? await getSemnaturaDataURL(emp.id) : null
    return { rol, nume, dataUrl, decisLa: null }
  }

  // ── EMITERE: PDF comandă + status emisă ──────────────────────────────────
  const emiteComanda = async (c) => {
    const aprAprobate = (c.aprobari || []).filter(a => a.status === 'aprobat')
    const semnaturi = [await semnEmitent()]
    for (const a of aprAprobate) {
      const dataUrl = a.employee_id ? await getSemnaturaDataURL(a.employee_id) : null
      semnaturi.push({ rol: a.rol_afisat || 'Aprobator', nume: profilesMap[a.profile_id] || '', dataUrl, decisLa: a.decis_la })
    }
    const cFull = { ...c, data_emitere: c.data_emitere || todayISO() }
    const html = buildComandaPdfHtml(cFull, { ...ctxFor(c), semnaturi })
    const blob = await renderHtmlToPdfBlob(html)
    const path = `${c.id}/${todayISO()}_${uniq8()}_comanda.pdf`
    await uploadPdf(blob, path)
    const { error } = await supabase.from('comenzi_furnizor').update({
      status: 'emisa', data_emitere: cFull.data_emitere,
      emisa_de: profile.id, emisa_la: new Date().toISOString(),
      pdf_comanda_path: path, updated_at: new Date().toISOString(),
    }).eq('id', c.id)
    if (error) throw error
  }

  // ── ACȚIUNI FLUX ─────────────────────────────────────────────────────────
  const actions = {
    editeaza: (c) => { setSelectedId(null); setEditComanda(c); setShowForm(true) },

    trimite: async (c) => {
      setBusy(true)
      try {
        if (subPrag(c)) {
          // Decizie Razvan 12.06: sub 2500 lei → emitere directă, fără aprobare
          await emiteComanda(c)
          showToast(`✅ ${c.numar_comanda} emisă direct (sub ${PRAG_APROBARE_LEI} lei) — PDF generat.`)
        } else {
          const activi = aprobatori.filter(a => a.activ)
          if (!activi.length) { showToast('Nu există aprobatori activi configurați (tab Aprobatori).', 'error'); return }
          const rows = activi.map(a => ({ comanda_furnizor_id: c.id, profile_id: a.profile_id, employee_id: a.employee_id, rol_afisat: a.rol_afisat, status: 'in_asteptare' }))
          const { error: e1 } = await supabase.from('comenzi_furnizor_aprobari').insert(rows)
          if (e1) throw e1
          const { error: e2 } = await supabase.from('comenzi_furnizor').update({ status: 'in_aprobare', updated_at: new Date().toISOString() }).eq('id', c.id)
          if (e2) throw e2
          showToast(`⏳ ${c.numar_comanda} trimisă în aprobare — aprobatorii au fost notificați.`)
        }
        await loadAll()
      } catch (e) { console.error(e); showToast('Eroare la trimitere: ' + (e.message || e), 'error') } finally { setBusy(false) }
    },

    decideAprobare: async (c, aprobare, decizie, comentariu) => {
      setBusy(true)
      try {
        const { error } = await supabase.from('comenzi_furnizor_aprobari')
          .update({ status: decizie, decis_la: new Date().toISOString(), comentariu: comentariu?.trim() || null })
          .eq('id', aprobare.id)
        if (error) throw error
        if (decizie === 'respins') {
          await supabase.from('comenzi_furnizor').update({ status: 'respinsa', updated_at: new Date().toISOString() }).eq('id', c.id)
          showToast(`❌ Ai respins ${c.numar_comanda}.`, 'warn')
        } else {
          // Verifică dacă toate aprobările sunt acum complete
          const { data: rest } = await supabase.from('comenzi_furnizor_aprobari')
            .select('id, status').eq('comanda_furnizor_id', c.id)
          const toateOk = (rest || []).every(r => r.status === 'aprobat')
          if (toateOk) {
            const { data: cFresh } = await supabase.from('comenzi_furnizor')
              .select('*, linii:comenzi_furnizor_linii(*), aprobari:comenzi_furnizor_aprobari(*)').eq('id', c.id).single()
            await emiteComanda(cFresh)
            showToast(`✅ Toate aprobările complete — ${c.numar_comanda} EMISĂ, PDF cu semnături generat.`)
          } else {
            showToast(`✅ Aprobat. Se așteaptă restul aprobatorilor.`)
          }
        }
        await loadAll()
      } catch (e) { console.error(e); showToast('Eroare la decizie: ' + (e.message || e), 'error') } finally { setBusy(false) }
    },

    markStatus: async (c, status) => {
      setBusy(true)
      try {
        const { error } = await supabase.from('comenzi_furnizor').update({ status, updated_at: new Date().toISOString() }).eq('id', c.id)
        if (error) throw error
        showToast(`${STATUS_INFO[status].emoji} ${c.numar_comanda} → ${STATUS_INFO[status].label}.`)
        await loadAll()
      } catch (e) { showToast('Eroare: ' + (e.message || e), 'error') } finally { setBusy(false) }
    },

    anuleaza: async (c) => {
      if (!window.confirm(`Anulezi comanda ${c.numar_comanda}? Acțiunea nu poate fi inversată din UI.`)) return
      await actions.markStatus(c, 'anulata')
      setSelectedId(null)
    },

    deschideReceptie: (c) => { setSelectedId(null); setReceptieId(c.id) },
    deschidePredare: (c) => { setSelectedId(null); setPredareId(c.id) },
  }

  // ── RECEPȚIE (PV 1) ──────────────────────────────────────────────────────
  const confirmReceptie = async (tip) => {
    const c = receptieComanda; if (!c) return
    setBusy(true)
    try {
      const upd = tip === 'mp'
        ? { receptie_mp_profile: profile.id, receptie_mp_la: new Date().toISOString() }
        : { receptie_achizitii_profile: profile.id, receptie_achizitii_la: new Date().toISOString() }
      const { error } = await supabase.from('comenzi_furnizor').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', c.id)
      if (error) throw error
      await loadAll()
    } catch (e) { showToast('Eroare: ' + (e.message || e), 'error') } finally { setBusy(false) }
  }
  const finalizeazaReceptie = async () => {
    const c = receptieComanda; if (!c) return
    setBusy(true)
    try {
      const semnaturi = [
        { ...(await semnDinProfil('Manager Proiect', c.receptie_mp_profile)), decisLa: c.receptie_mp_la },
        { ...(await semnDinProfil('Achiziții', c.receptie_achizitii_profile)), decisLa: c.receptie_achizitii_la },
      ]
      const html = buildPvReceptieHtml(c, { ...ctxFor(c), semnaturi })
      const blob = await renderHtmlToPdfBlob(html)
      const path = `${c.id}/${todayISO()}_${uniq8()}_pv_receptie.pdf`
      await uploadPdf(blob, path)
      const { error } = await supabase.from('comenzi_furnizor').update({ pv_receptie_path: path, status: 'receptionata', updated_at: new Date().toISOString() }).eq('id', c.id)
      if (error) throw error
      showToast(`✅ PV recepție generat — ${c.numar_comanda} RECEPȚIONATĂ.`)
      setReceptieId(null)
      await loadAll()
    } catch (e) { console.error(e); showToast('Eroare la PV recepție: ' + (e.message || e), 'error') } finally { setBusy(false) }
  }

  // ── PREDARE MAGAZIE (PV 2) + intrare STOC automată ───────────────────────
  const confirmPredare = async (tip) => {
    const c = predareComanda; if (!c) return
    setBusy(true)
    try {
      const upd = tip === 'predare'
        ? { predare_achizitii_profile: profile.id, predare_achizitii_la: new Date().toISOString() }
        : { primire_magazioner_profile: profile.id, primire_magazioner_la: new Date().toISOString() }
      const { error } = await supabase.from('comenzi_furnizor').update({ ...upd, updated_at: new Date().toISOString() }).eq('id', c.id)
      if (error) throw error
      await loadAll()
    } catch (e) { showToast('Eroare: ' + (e.message || e), 'error') } finally { setBusy(false) }
  }
  const intraInStoc = async (c) => {
    const locatie_tip = c.livrare_tip === 'sediu' ? 'sediu' : 'proiect'
    const locatie_id = c.livrare_tip === 'sediu' ? null : (c.proiect_id || null)
    for (const l of (c.linii || [])) {
      let q = supabase.from('stocuri').select('id, cantitate').eq('locatie_tip', locatie_tip).eq('material_denumire', l.denumire)
      q = locatie_id == null ? q.is('locatie_id', null) : q.eq('locatie_id', locatie_id)
      if (l.um) q = q.eq('um', l.um)
      const { data: existing } = await q.limit(1)
      if (existing && existing.length) {
        await supabase.from('stocuri').update({ cantitate: Number(existing[0].cantitate || 0) + Number(l.cantitate || 0), updated_at: new Date().toISOString() }).eq('id', existing[0].id)
      } else {
        await supabase.from('stocuri').insert({ locatie_tip, locatie_id, material_denumire: l.denumire, um: l.um || null, cantitate: Number(l.cantitate || 0), observatii: `Intrare automată din ${c.numar_comanda}` })
      }
    }
  }
  const finalizeazaPredare = async (pozaFile) => {
    const c = predareComanda; if (!c || !pozaFile) return
    setBusy(true)
    try {
      // 1. Upload poză depozitare (obligatorie)
      const ext = (pozaFile.name.split('.').pop() || 'jpg').toLowerCase()
      const pozaPath = `${c.id}/${todayISO()}_${uniq8()}_depozitare.${ext}`
      const { error: eP } = await supabase.storage.from(BUCKET).upload(pozaPath, pozaFile, { contentType: pozaFile.type, upsert: true })
      if (eP) throw eP
      const pozaDataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(pozaFile) })
      // 2. PV predare cu semnături + poză
      const semnaturi = [
        { ...(await semnDinProfil('Predă · Achiziții', c.predare_achizitii_profile)), decisLa: c.predare_achizitii_la },
        { ...(await semnDinProfil('Primește · Magazioner', c.primire_magazioner_profile)), decisLa: c.primire_magazioner_la },
      ]
      const html = buildPvPredareHtml(c, { ...ctxFor(c), pozaDataUrl, semnaturi })
      const blob = await renderHtmlToPdfBlob(html)
      const pvPath = `${c.id}/${todayISO()}_${uniq8()}_pv_predare.pdf`
      await uploadPdf(blob, pvPath)
      // 3. Intrare automată în stoc
      await intraInStoc(c)
      // 4. Update comandă
      const { error } = await supabase.from('comenzi_furnizor').update({
        pv_predare_path: pvPath, poza_depozitare_path: pozaPath,
        status: 'in_stoc', updated_at: new Date().toISOString(),
      }).eq('id', c.id)
      if (error) throw error
      showToast(`🏬 ${c.numar_comanda} ÎN STOC — PV predare generat, cantitățile au intrat automat în stocuri.`)
      setPredareId(null)
      await loadAll()
    } catch (e) { console.error(e); showToast('Eroare la predare: ' + (e.message || e), 'error') } finally { setBusy(false) }
  }

  // ── Filtre + KPI ─────────────────────────────────────────────────────────
  const comenziFilt = useMemo(() => comenzi.filter(c => {
    if (fStatus && c.status !== fStatus) return false
    if (fProiect && String(c.proiect_id) !== String(fProiect)) return false
    if (fSearch) {
      const t = normalize(fSearch)
      const ctx = ctxFor(c)
      const hay = normalize([c.numar_comanda, ctx.furnizorNume, ctx.proiectNume, ...(c.linii || []).map(l => l.denumire)].join(' '))
      if (!hay.includes(t)) return false
    }
    return true
  }), [comenzi, fStatus, fProiect, fSearch, ctxFor])

  const kpi = useMemo(() => ({
    draft: comenzi.filter(c => c.status === 'draft').length,
    aprobare: comenzi.filter(c => c.status === 'in_aprobare').length,
    emise: comenzi.filter(c => c.status === 'emisa').length,
    livrare: comenzi.filter(c => c.status === 'in_tranzit' || c.status === 'ajunsa').length,
    receptionate: comenzi.filter(c => c.status === 'receptionata').length,
    stoc: comenzi.filter(c => c.status === 'in_stoc').length,
  }), [comenzi])

  const aprobariMele = useMemo(() => {
    if (!profile) return []
    return comenzi.filter(c => c.status === 'in_aprobare' && (c.aprobari || []).some(a => a.profile_id === profile.id && a.status === 'in_asteptare'))
  }, [comenzi, profile])

  // ── Render ───────────────────────────────────────────────────────────────
  if (loadingProfile) return <div style={{ ...S.page, display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:G.muted }}>Se încarcă...</div></div>

  const KpiCard = ({ emoji, label, val, color, onClick }) => (
    <div onClick={onClick} style={{ ...S.card, padding:'14px 16px', flex:1, minWidth:130, cursor: onClick ? 'pointer' : 'default', borderColor: onClick && fStatus && STATUS_INFO[fStatus] ? G.border : G.border }}>
      <div style={{ fontSize:12, color:G.muted, marginBottom:4 }}>{emoji} {label}</div>
      <div style={{ fontSize:24, fontWeight:800, color }}>{val}</div>
    </div>
  )

  return (
    <div style={{ ...S.page, padding:'24px 0' }}>
      {ToastEl}
      {/* Header modul */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:18, flexWrap:'wrap' }}>
        <div style={{ width:44, height:44, borderRadius:12, background:G.achizitii + '22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:24 }}>📥</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:22, fontWeight:800 }}>Achiziții</div>
          <div style={{ fontSize:12.5, color:G.muted }}>Comenzi furnizor · Aprobare · Recepție · Intrare în stoc</div>
        </div>
        {canCreate && tab === 'comenzi' && (
          <button onClick={() => { setEditComanda(null); setShowForm(true) }} style={{ ...S.btnP, background:G.achizitii, color:'#0D1117', fontSize:15 }}>＋ Comandă furnizor nouă</button>
        )}
      </div>

      {/* Banner aprobări așteptate de mine */}
      {aprobariMele.length > 0 && (
        <div style={{ ...S.card, borderColor:G.yellow + '88', background:G.yellow + '0E', padding:'12px 16px', marginBottom:14, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ fontSize:14, fontWeight:800, color:G.yellow }}>⚡ {aprobariMele.length} {aprobariMele.length === 1 ? 'comandă așteaptă' : 'comenzi așteaptă'} aprobarea ta:</div>
          {aprobariMele.map(c => (
            <button key={c.id} onClick={() => setSelectedId(c.id)} style={{ ...S.btnS, fontSize:13, fontWeight:700, color:G.yellow, borderColor:G.yellow + '66' }}>{c.numar_comanda} · {fmtNr(totalComanda(c))} {c.moneda}</button>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display:'flex', gap:8, marginBottom:14, borderBottom:`1px solid ${G.border}`, paddingBottom:0 }}>
        {[['comenzi', '🛒 Comenzi Furnizor'], ...(isOwner ? [['aprobatori', '👥 Aprobatori']] : [])].map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} style={{ background:'transparent', border:'none', borderBottom:`3px solid ${tab === k ? G.achizitii : 'transparent'}`, color: tab === k ? G.text : G.muted, padding:'10px 16px', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>{t}</button>
        ))}
        <div style={{ flex:1 }} />
        <div style={{ fontSize:11, color:G.dim, alignSelf:'center', paddingRight:4 }}>Cereri interne MP → în curând (Faza 4)</div>
      </div>

      {tab === 'comenzi' && (<>
        {/* KPI */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
          <KpiCard emoji="📝" label="Draft" val={kpi.draft} color={G.muted} onClick={() => setFStatus(fStatus === 'draft' ? '' : 'draft')} />
          <KpiCard emoji="⏳" label="În aprobare" val={kpi.aprobare} color={G.yellow} onClick={() => setFStatus(fStatus === 'in_aprobare' ? '' : 'in_aprobare')} />
          <KpiCard emoji="📨" label="Emise" val={kpi.emise} color={G.blue} onClick={() => setFStatus(fStatus === 'emisa' ? '' : 'emisa')} />
          <KpiCard emoji="🚚" label="În livrare" val={kpi.livrare} color={G.purple} onClick={() => setFStatus(fStatus === 'in_tranzit' ? '' : 'in_tranzit')} />
          <KpiCard emoji="✅" label="Recepționate" val={kpi.receptionate} color={G.green} onClick={() => setFStatus(fStatus === 'receptionata' ? '' : 'receptionata')} />
          <KpiCard emoji="🏬" label="În stoc" val={kpi.stoc} color={G.achizitii} onClick={() => setFStatus(fStatus === 'in_stoc' ? '' : 'in_stoc')} />
        </div>

        {/* Filtre */}
        <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
          <input style={{ ...S.input, maxWidth:300 }} placeholder="🔍 Caută (nr, furnizor, material...)" value={fSearch} onChange={e => setFSearch(e.target.value)} />
          <select style={{ ...S.input, maxWidth:200 }} value={fStatus} onChange={e => setFStatus(e.target.value)}>
            <option value="">Toate statusurile</option>
            {Object.entries(STATUS_INFO).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
          </select>
          <select style={{ ...S.input, maxWidth:260 }} value={fProiect} onChange={e => setFProiect(e.target.value)}>
            <option value="">Toate proiectele</option>
            {proiecte.map(p => <option key={p.id} value={p.id}>{p.cod_intern ? `[${p.cod_intern}] ` : ''}{p.nume}</option>)}
          </select>
        </div>

        {/* Lista comenzi */}
        <div style={{ ...S.card, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'190px 1fr 1fr 130px 150px 90px', gap:0, padding:'10px 16px', fontSize:11, color:G.dim, fontWeight:700, borderBottom:`1px solid ${G.border}` }}>
            <div>Nr. comandă</div><div>Furnizor</div><div>Proiect</div><div style={{ textAlign:'right' }}>Total</div><div>Status</div><div></div>
          </div>
          {loading && <div style={{ padding:30, textAlign:'center', color:G.muted }}>Se încarcă comenzile...</div>}
          {!loading && !comenziFilt.length && (
            <div style={{ padding:36, textAlign:'center', color:G.dim, fontSize:14 }}>
              {comenzi.length ? 'Nicio comandă pe filtrele curente.' : <>Nicio comandă încă. {canCreate && 'Apasă „＋ Comandă furnizor nouă" pentru prima.'}</>}
            </div>
          )}
          {!loading && comenziFilt.map(c => {
            const ctx = ctxFor(c)
            return (
              <div key={c.id} onClick={() => setSelectedId(c.id)} style={{ display:'grid', gridTemplateColumns:'190px 1fr 1fr 130px 150px 90px', alignItems:'center', padding:'11px 16px', fontSize:13.5, borderBottom:`1px solid ${G.border}`, cursor:'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = G.bg} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ fontWeight:800 }}>{c.numar_comanda}<div style={{ fontSize:10.5, color:G.dim, fontWeight:400 }}>{fmtData(c.created_at)}</div></div>
                <div>{ctx.furnizorNume}<div style={{ fontSize:11, color:G.muted }}>{(c.linii || []).length} {((c.linii || []).length === 1) ? 'linie' : 'linii'}</div></div>
                <div style={{ color:G.muted, fontSize:12.5 }}>{ctx.proiectNume || '—'}</div>
                <div style={{ textAlign:'right', fontWeight:700 }}>{fmtNr(totalComanda(c))} {c.moneda}</div>
                <div><StatusBadge status={c.status} /></div>
                <div style={{ textAlign:'right' }}>
                  <button onClick={(e) => { e.stopPropagation(); setSelectedId(c.id) }} title="Detalii" style={{ ...S.btnIcon }}>👁</button>
                </div>
              </div>
            )
          })}
        </div>
      </>)}

      {tab === 'aprobatori' && isOwner && (
        <AprobatoriTab aprobatori={aprobatori} profilesList={profilesList} employees={employees} onReload={loadAll} showToast={showToast} />
      )}

      {/* Modale */}
      {showForm && (
        <ComandaFormModal
          comanda={editComanda}
          proiecte={proiecte} furnizoriList={furnizoriList} sites={sites}
          onFurnizorNou={async ({ nume, cui, contact }) => {
            const { data, error } = await supabase.from('logistica_furnizori')
              .insert({ nume, cui, contact, activ: true }).select('id, nume, cui, contact, activ').single()
            if (error) throw error
            setFurnizoriList(ls => [...ls, data].sort((a, b) => a.nume.localeCompare(b.nume)))
            return data
          }}
          profile={profile} showToast={showToast}
          onClose={() => { setShowForm(false); setEditComanda(null) }}
          onSaved={async (comandaId, apoiTrimite) => {
            setShowForm(false); setEditComanda(null)
            await loadAll()
            if (apoiTrimite) {
              const { data: cFresh } = await supabase.from('comenzi_furnizor')
                .select('*, linii:comenzi_furnizor_linii(*), aprobari:comenzi_furnizor_aprobari(*)').eq('id', comandaId).single()
              if (cFresh) await actions.trimite(cFresh)
            }
          }}
        />
      )}
      {selected && (
        <ComandaDetailModal comanda={selected} ctx={ctxFor(selected)} profile={profile} profilesMap={profilesMap}
          onClose={() => setSelectedId(null)} actions={actions} busy={busy} />
      )}
      {receptieComanda && (
        <ReceptieModal comanda={receptieComanda} profile={profile} profilesMap={profilesMap}
          onClose={() => setReceptieId(null)} onConfirm={confirmReceptie} onFinalizeaza={finalizeazaReceptie} busy={busy} />
      )}
      {predareComanda && (
        <PredareModal comanda={predareComanda} profile={profile} profilesMap={profilesMap}
          onClose={() => setPredareId(null)} onConfirm={confirmPredare} onFinalizeaza={finalizeazaPredare} busy={busy} />
      )}
    </div>
  )
}
