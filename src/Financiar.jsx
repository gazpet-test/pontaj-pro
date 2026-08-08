// ===========================================================================
// MODUL FINANCIAR — Generator facturi + Evidență încasări
// ===========================================================================
// 03.06.2026 — VERSIUNEA 1
//   • Facturi emise: list + KPI (serie/status/an filter)
//   • Generator factură: pre-fill din SL Execuție, counter automat atomic
//   • PDF preview + descărcare + upload Storage
//   • Trimitere email prin Edge Function send-factura-email (Resend)
//   • NAS sync status (sincronizat via scanner NAS la schimb mount :rw)
//   • Alertă în TabSituatiiPlata dacă SL fără factură
// ===========================================================================
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import ConsumuriBonuriTab from './ConsumuriBonuriTab.jsx'
import CitesteOricePanel from './CitesteOricePanel.jsx'
import { norm } from './lib/diacritice.js'
import * as XLSX from 'xlsx-js-style'

const G = {
  bg:'#0D1117', surface:'#161B22', card:'#1C2128', card2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  border:'#30363D', border2:'#21262D',
  blue:'#58A6FF', green:'#2EA043', greenBg:'#238636',
  yellow:'#D29922', orange:'#F0883E', red:'#F85149',
  purple:'#A371F7', teal:'#2DD4BF', financiar:'#2EA043',
}

const S = {
  input: {
    width:'100%', boxSizing:'border-box', background:G.bg,
    border:`1px solid ${G.border2}`, borderRadius:6,
    padding:'8px 12px', color:G.text, fontSize:13, outline:'none',
  },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.financiar, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
}

const SERII = ['GAZ','PH','PX']
const TVA_DEFAULT = 21

const STATUS_FACTURA = {
  in_pregatire: { label:'În pregătire', color:G.muted,  bg:G.border2,      icon:'📝' },
  emisa:        { label:'Emisă',        color:G.blue,   bg:G.blue+'22',    icon:'🧾' },
  trimisa:      { label:'Trimisă',      color:G.yellow, bg:G.yellow+'22',  icon:'📤' },
  incasata:     { label:'Încasată',     color:G.teal,   bg:G.teal+'22',    icon:'💰' },
  restanta:     { label:'Restantă',     color:G.red,    bg:G.red+'22',     icon:'⚠️' },
  stornata:     { label:'Stornată',     color:G.dim,    bg:G.card2,        icon:'↩️' },
}

const fmtLei = v => v || v===0 ? new Intl.NumberFormat('ro-RO',{style:'currency',currency:'RON',maximumFractionDigits:2}).format(v) : '—'
const fmtDate = d => d ? new Date(d).toLocaleDateString('ro-RO',{day:'2-digit',month:'short',year:'numeric'}) : '—'
const LUNI = ['Ian','Feb','Mar','Apr','Mai','Iun','Iul','Aug','Sep','Oct','Nov','Dec']

function useToast() {
  const [t,setT] = useState(null)
  const show = (msg, kind='ok') => { setT({msg,kind}); setTimeout(()=>setT(null),4000) }
  const Toast = () => t ? (
    <div style={{position:'fixed',bottom:24,right:24,padding:'12px 18px',
      background:t.kind==='err'?G.red:G.greenBg,color:'#fff',
      borderRadius:8,fontWeight:600,fontSize:13,zIndex:10000,maxWidth:380}}>{t.msg}</div>
  ) : null
  return { show, Toast }
}

// ===========================================================================
// Linii-obiect (executie_situatii_plata_linii) → articole factură
// ===========================================================================
// Filtru de siguranță: exclude linii care NU-s de facturat — ex. inputurile de calcul
// coeficient (V0/Io/In din Buletinul statistic) ajunse din greșeală în tabelul de linii.
function _esteLinieFactura(l) {
  const d = String(l?.denumire || '').toLowerCase()
  if (/buletin statistic|indice|coeficient de ajustare|^\s*v0\b|moneda indicelui/.test(d)) return false
  const v = Math.abs(Number(l?.valoare) || 0)
  if (l?.tip === 'lucr_cm' && v < 1000) return false  // valori de indice (~150 lei), nu lucrări
  return true
}
// Mapează liniile-obiect stocate → articole factură (1:1), stil manual (per obiect).
function objLinesToArticole(objLinii, startNr) {
  let _nr = startNr
  const linii = []
  for (const o of (objLinii || [])) {
    if (!_esteLinieFactura(o)) continue
    const val = Number(o.valoare) || 0
    linii.push({ nr:_nr++, denumire:o.denumire, um:o.um || 'buc', cantitate:Number(o.cantitate) || 1,
      pret_unitar:val.toFixed(2), valoare:val.toFixed(2),
      tva_pct:(o.tva_pct != null && o.tva_pct !== '' ? Number(o.tva_pct) : TVA_DEFAULT) })
  }
  return { linii, nextNr:_nr }
}

// ===========================================================================
// INVOICE PDF TEMPLATE — HTML offscreen pentru html2canvas
// ===========================================================================
function buildInvoiceHTML(f) {
  const fmt2 = v => (v||0).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2})
  const fmtD = d => d ? new Date(d).toLocaleDateString('ro-RO') : ''
  const rows = (f.articole||[]).map((a,i) => `
    <tr style="border-bottom:1px solid #e0e0e0">
      <td style="padding:7px 8px;text-align:center">${i+1}</td>
      <td style="padding:7px 8px">${a.denumire||''}</td>
      <td style="padding:7px 8px;text-align:center">${a.um||'buc'}</td>
      <td style="padding:7px 8px;text-align:right">${a.cantitate||1}</td>
      <td style="padding:7px 8px;text-align:right;font-family:monospace">${fmt2(a.pret_unitar)}</td>
      <td style="padding:7px 8px;text-align:right;font-family:monospace;font-weight:600">${fmt2(a.valoare)}</td>
      <td style="padding:7px 8px;text-align:right">${fmt2(a.tva_pct!==undefined&&a.tva_pct!==''&&a.tva_pct!==null?a.tva_pct:TVA_DEFAULT)}%</td>
    </tr>`).join('')
  return `<div style="width:794px;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:11px;padding:28px">
  <table style="width:100%;border-collapse:collapse;margin-bottom:10px">
    <tr>
      <td style="width:38%;vertical-align:top;padding-right:12px">
        <div style="font-size:15px;font-weight:800;color:#1F6FEB">Gazpet-Instal</div>
        <div style="font-size:9px;color:#555;margin-top:2px">S.C. GAZPET INSTAL SRL</div>
        <div style="font-size:12px;font-weight:700;margin-top:4px">Reg.Com: J2007001650296</div>
        <div>C.I.F.: RO22029920</div>
        <div>Sediul: Ploiești, Str. Fluturilor nr. 34, Prahova</div>
        <div>Cont: RO25 BTRL RONC RT0T 1801 7E01</div>
        <div>Banca: BANCA TRANSILVANIA SUC. PLOIEȘTI</div>
        <div>Tel/Fax: 0244/435.005 | office@gazpet.ro</div>
      </td>
      <td style="width:24%;vertical-align:top;text-align:center;padding-top:8px">
        <div style="font-size:22px;font-weight:900;color:#1a1a1a;letter-spacing:2px">FACTURĂ</div>
        <div style="margin-top:10px;border:2px solid #1F6FEB;border-radius:6px;padding:8px">
          <div style="font-size:13px;font-weight:700">Seria: <span style="color:#1F6FEB">${f.serie}</span> Nr. <span style="color:#1F6FEB">${f.nr}</span></div>
          <div style="margin-top:4px;font-size:11px">Data: <strong>${fmtD(f.data)}</strong></div>
        </div>
        <div style="margin-top:8px;font-size:10px;color:#555">Plata cu ${f.mod_plata||'OP'}</div>
      </td>
      <td style="width:38%;vertical-align:top;padding-left:12px;text-align:right">
        <div style="font-size:10px;color:#888;margin-bottom:2px">Beneficiar:</div>
        <div style="font-size:13px;font-weight:700">${f.beneficiar_nume||''}</div>
        <div style="font-size:12px;font-weight:700;color:#222;margin-top:4px">C.I.F.: ${f.beneficiar_cif||''}</div>
        <div>Sediul: ${f.beneficiar_sediu||''}</div>
        <div>Cont IBAN: ${f.beneficiar_iban||''}</div>
        <div>Banca: ${f.beneficiar_banca||''}</div>
        ${(f.contact_nume||f.contact_email||f.contact_telefon) ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #ddd;font-size:10px;color:#333">
          ${f.contact_nume?`<div>Persoană contact: <strong>${f.contact_nume}</strong></div>`:''}
          ${f.contact_email?`<div>Adresă email: ${f.contact_email}</div>`:''}
          ${f.contact_telefon?`<div>Telefon: ${f.contact_telefon}</div>`:''}
        </div>` : ''}
      </td>
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;border:1px solid #ccc;margin:14px 0;font-size:10px">
    <thead>
      <tr style="background:#f0f4f8">
        <th style="padding:7px 8px;border-bottom:2px solid #aaa;text-align:center;width:4%">Nr.</th>
        <th style="padding:7px 8px;border-bottom:2px solid #aaa;text-align:left;width:42%">Denumirea produselor / serviciilor</th>
        <th style="padding:7px 8px;border-bottom:2px solid #aaa;text-align:center;width:5%">U.M.</th>
        <th style="padding:7px 8px;border-bottom:2px solid #aaa;text-align:right;width:7%">Cant.</th>
        <th style="padding:7px 8px;border-bottom:2px solid #aaa;text-align:right;width:14%">Preț unitar (fără TVA) RON</th>
        <th style="padding:7px 8px;border-bottom:2px solid #aaa;text-align:right;width:14%">Valoare Netă RON</th>
        <th style="padding:7px 8px;border-bottom:2px solid #aaa;text-align:right;width:7%">TVA %</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <table style="width:260px;margin-left:auto;border-collapse:collapse;font-size:11px;margin-bottom:12px">
    <tr><td style="padding:5px 10px;color:#555">Valoare netă:</td><td style="padding:5px 10px;text-align:right;font-family:monospace">${fmt2(f.valoare_neta)} RON</td></tr>
    <tr><td style="padding:5px 10px;color:#555">TVA ${f.tva_pct||TVA_DEFAULT}%:</td><td style="padding:5px 10px;text-align:right;font-family:monospace">${fmt2(f.tva)} RON</td></tr>
    <tr style="background:#E8F4FD;border-top:2px solid #1F6FEB">
      <td style="padding:8px 10px;font-weight:800;font-size:12px">TOTAL PLATĂ RON:</td>
      <td style="padding:8px 10px;text-align:right;font-weight:900;font-size:14px;color:#1F6FEB;font-family:monospace">${fmt2(f.total)}</td>
    </tr>
  </table>
  <div style="font-size:10px;color:#666;margin-bottom:8px">Termen de plată: <strong>${f.termen_plata_zile||30} zile</strong> de la data facturii.</div>
  <div style="font-size:9px;color:#888;margin-bottom:14px">Factura circulă fără semnătură și ștampilă conform Legii 277/2015 privind Codul Fiscal art.319</div>
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #ccc;padding-top:12px">
    <tr>
      <td style="width:35%;vertical-align:top;padding-top:10px">
        <div style="font-size:10px;color:#555">Semnătura și ștampila furnizorului</div>
        <div style="height:50px"></div>
      </td>
      <td style="width:35%;vertical-align:top;padding-top:10px;text-align:center">
        ${f.delegat_nume ? `<div style="font-size:10px;color:#555">Numele delegatului:</div><div style="font-size:11px;font-weight:700">${f.delegat_nume}</div>${f.delegat_awb?`<div style="font-size:10px">${f.delegat_awb}</div>`:''}<div style="font-size:10px;color:#555;margin-top:6px">Semnătura de primire</div><div style="height:40px"></div>` : ''}
      </td>
      <td style="width:30%;vertical-align:top;padding-top:10px;text-align:right">
        <div style="font-size:10px;color:#555">Data: ${fmtD(f.data)}</div>
        <div style="font-size:10px;color:#555;margin-top:4px">Semnătura:</div>
      </td>
    </tr>
  </table>
</div>`
}

// ===========================================================================
// MODAL FACTURĂ — creare / editare
// ===========================================================================
function FacturaModal({ item, proiectDefault, slDefault, beneficiariLista, profileId, onClose, onSaved, showToast }) {
  const isNew = !item?.id
  const [form, setForm] = useState({
    serie:       item?.serie || 'GAZ',
    nr:          item?.nr || '',
    data:        item?.data || new Date().toISOString().slice(0,10),
    an:          item?.an || Number(String(item?.data || new Date().toISOString()).slice(0,4)) || new Date().getFullYear(),
    beneficiar_id:    item?.beneficiar_id || '',
    beneficiar_nume:  item?.beneficiar_nume || '',
    beneficiar_cif:   item?.beneficiar_cif  || '',
    beneficiar_iban:  item?.beneficiar_iban || '',
    beneficiar_banca: item?.beneficiar_banca || '',
    beneficiar_sediu: item?.beneficiar_sediu || '',
    contact_nume:    item?.contact_nume || '',
    contact_email:   item?.contact_email || '',
    contact_telefon: item?.contact_telefon || '',
    articole:    item?.articole || [{ nr:1, denumire:'', um:'buc', cantitate:1, pret_unitar:'', valoare:'', tva_pct:TVA_DEFAULT }],
    tva_pct:     item?.tva_pct || TVA_DEFAULT,
    mod_plata:   item?.mod_plata || 'OP',
    delegat_nume: item?.delegat_nume || 'TRUSU RAZVAN MIHAIL',
    delegat_awb:  item?.delegat_awb || '',
    termen_plata_zile: item?.termen_plata_zile || 30,
    proiect_id:        item?.proiect_id || proiectDefault || '',
    situatie_plata_ids: item?.situatie_plata_ids || (slDefault ? [slDefault.id] : []),
    email_destinatar: item?.email_destinatar || 'marilena.tudorache@gazpet.ro',
    status: item?.status || 'in_pregatire',
    titlu_scurt: item?.titlu_scurt || '',
  })
  const [saving, setSaving]       = useState(false)
  const [salveazaClient, setSalveazaClient] = useState(true)  // salvează clientul nou în listă pt refolosire
  const [genPDF, setGenPDF]       = useState(false)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [pdfUrl, setPdfUrl]       = useState(item?.pdf_path ? `PDF existent: ${item.pdf_path}` : null)
  const [proiecte, setProiecte]   = useState([])
  const [slLista, setSlLista]     = useState([])
  const previewRef                = useRef(null)
  const lastGenRef                = useRef(null)   // snapshot articole auto-generate (detectare modificări manuale)

  // ─── HELPER: încarcă valorile unei SL (bază/ajustare/total + ajustări retro) ───
  const loadSLValues = async (slId) => {
    let valBaza = 0, valAjust = 0, valTotal = 0, coefAjust = 0, ajustariRetro = []
    try {
      const { data: slF } = await supabase.from('executie_situatii_plata')
        .select('valoare_baza_lei, valoare_ajustare_lei, valoare_ajustata_lei, coeficient_ajustare').eq('id', slId).single()
      if (slF) {
        valBaza   = parseFloat(slF.valoare_baza_lei || 0)
        valAjust  = parseFloat(slF.valoare_ajustare_lei || 0)
        valTotal  = parseFloat(slF.valoare_ajustata_lei || slF.valoare_baza_lei || 0)
        coefAjust = parseFloat(slF.coeficient_ajustare || 0)
      }
    } catch(e) { /* fallback 0 */ }
    try {
      const { data: ajs } = await supabase.from('executie_sl_ajustari')
        .select('sl_ajustata_nr, valoare_ajustare_lei, coeficient')
        .eq('sl_id', slId).order('id', { ascending: true })
      ajustariRetro = ajs || []
    } catch(e) { /* ignor */ }
    return { valBaza, valAjust, valTotal, coefAjust, ajustariRetro }
  }

  // ─── HELPER: încarcă contract + beneficiar (o dată per proiect — toate SL = același proiect) ───
  const loadContractBenef = async (proiect_id, contract_id_hint, nr_contract_hint) => {
    let contractRef = nr_contract_hint || '', contractDenumire = '', benef = null, termenPlata = null, contactContract = null
    try {
      let cid = contract_id_hint
      if (proiect_id) {
        const { data: pr } = await supabase.from('executie_proiecte').select('contract_id, nr_contract').eq('id', proiect_id).single()
        if (pr) { cid = cid || pr.contract_id; if (!contractRef) contractRef = pr.nr_contract || '' }
      }
      if (cid) {
        const { data: ct } = await supabase.from('contracte_terti')
          .select('numar_contract, data_semnare, denumire, termen_plata_zile, beneficiar_id, contact_factura_nume, contact_factura_email, contact_factura_telefon').eq('id', cid).single()
        if (ct) {
          if (ct.numar_contract) {
            const dS = ct.data_semnare ? new Date(ct.data_semnare).toLocaleDateString('ro-RO') : ''
            contractRef = dS ? `${ct.numar_contract}/${dS}` : ct.numar_contract
          }
          contractDenumire = ct.denumire || ''
          termenPlata = ct.termen_plata_zile
          contactContract = { nume: ct.contact_factura_nume || '', email: ct.contact_factura_email || '', telefon: ct.contact_factura_telefon || '' }
          if (ct.beneficiar_id) {
            const { data: b } = await supabase.from('beneficiari')
              .select('id,nume,cif,iban_principal,banca,sediu,contact_email,telefon,contact_nume,retine_gbe_pct,retine_car_pct').eq('id', ct.beneficiar_id).single()
            if (b) benef = b
          }
        }
      }
    } catch(e) { /* fallback */ }
    return { contractRef, contractDenumire, benef, termenPlata, contactContract }
  }

  // ─── HELPER: construiește liniile pentru O situație de lucrări (pură, sincronă) ───
  // Returnează { linii, nextNr }. Reținerile GBE/CAR vin din benef (per beneficiar).
  const buildLinesForSL = ({ nr_situatie, slVals, contractInfo, startNr, objLinii }) => {
    const { valBaza, valAjust, valTotal, coefAjust, ajustariRetro } = slVals
    const { contractRef, contractDenumire, benef } = contractInfo
    const denPart = contractDenumire ? ` — ${contractDenumire}` : ''
    const den = `Contravaloare lucrări conf. situație de lucrări nr.${nr_situatie}${denPart} — contract ${contractRef||'—'}`
    const hasAjust = Math.abs(valAjust) > 0.005
    const linii = []
    let _nr = startNr
    const _obj = objLinesToArticole(objLinii, _nr)
    if (_obj.linii.length) {
      // Linii pe obiect din centralizator (stil manual: lucrări + ajustări separate)
      linii.push(..._obj.linii); _nr = _obj.nextNr
    } else if (hasAjust) {
      linii.push({ nr:_nr++, denumire:den, um:'buc', cantitate:1, pret_unitar:valBaza.toFixed(2), valoare:valBaza.toFixed(2), tva_pct:TVA_DEFAULT })
      linii.push({ nr:_nr++, denumire:`Ajustare de preț conform coeficient ICC${coefAjust ? ' ' + coefAjust.toFixed(4).replace('.', ',') : ''} — situație de lucrări nr.${nr_situatie}`, um:'buc', cantitate:1, pret_unitar:valAjust.toFixed(2), valoare:valAjust.toFixed(2), tva_pct:TVA_DEFAULT })
    } else {
      linii.push({ nr:_nr++, denumire:den, um:'buc', cantitate:1, pret_unitar:valTotal.toFixed(2), valoare:valTotal.toFixed(2), tva_pct:TVA_DEFAULT })
    }
    for (const aj of ajustariRetro) {
      const v = parseFloat(aj.valoare_ajustare_lei || 0)
      if (Math.abs(v) < 0.005) continue
      const coefStr = (aj.coeficient != null && !isNaN(parseFloat(aj.coeficient))) ? ' ' + parseFloat(aj.coeficient).toFixed(5).replace('.', ',') : ''
      const refStr = aj.sl_ajustata_nr ? ` nr.${aj.sl_ajustata_nr}` : ''
      linii.push({ nr:_nr++, denumire:`Ajustare de preț conform coeficient ICC${coefStr} — situație de lucrări${refStr}`, um:'buc', cantitate:1, pret_unitar:v.toFixed(2), valoare:v.toFixed(2), tva_pct:TVA_DEFAULT })
    }
    // Rețineri GBE / CAR per beneficiar (pe valoarea brută a SL-ului)
    const gbePct = parseFloat(benef?.retine_gbe_pct || 0)
    const carPct = parseFloat(benef?.retine_car_pct || 0)
    if (gbePct > 0) {
      const gbe = -(valBaza * gbePct / 100)
      linii.push({ nr:_nr++, denumire:`Reținere GBE (garanție bună execuție) ${gbePct.toString().replace('.', ',')}% — situație de lucrări nr.${nr_situatie}`, um:'buc', cantitate:1, pret_unitar:gbe.toFixed(2), valoare:gbe.toFixed(2), tva_pct:0 })
    }
    if (carPct > 0) {
      const car = -(valBaza * carPct / 100)
      linii.push({ nr:_nr++, denumire:`Reținere CAR ${carPct.toString().replace('.', ',')}% — situație de lucrări nr.${nr_situatie}`, um:'buc', cantitate:1, pret_unitar:car.toFixed(2), valoare:car.toFixed(2), tva_pct:0 })
    }
    return { linii, nextNr: _nr }
  }

  // ─── Regenerează liniile din TOATE SL-urile selectate în multi-select ───
  const regenerateFromSelectedSLs = async () => {
    const ids = (form.situatie_plata_ids || []).filter(Boolean)
    if (ids.length === 0) { showToast('Selectează cel puțin o situație de lucrări', 'err'); return }
    // Detectare modificări manuale: comparăm articolele curente cu ultima generare automată
    const curJSON = JSON.stringify(form.articole)
    if (lastGenRef.current && curJSON !== lastGenRef.current) {
      if (!window.confirm('Ai modificat manual liniile facturii. Le suprascrii cu liniile generate din SL-urile selectate?')) return
    }
    // Contract + beneficiar: o singură dată (toate SL din același proiect)
    const proiectId = form.proiect_id ? Number(form.proiect_id) : null
    const contractInfo = await loadContractBenef(proiectId, null, '')
    // Ordonăm SL-urile cronologic după lista încărcată (slLista e deja sortată an/luna)
    const ordered = slLista.filter(sl => ids.includes(sl.id))
    let articole = [], nr = 1
    for (const sl of ordered) {
      const slVals = await loadSLValues(sl.id)
      const { data: objLinii } = await supabase.from('executie_situatii_plata_linii').select('*').eq('sl_id', sl.id).order('ord')
      const { linii, nextNr } = buildLinesForSL({ nr_situatie: sl.nr_situatie, slVals, contractInfo, startNr: nr, objLinii: objLinii || [] })
      articole = articole.concat(linii)
      nr = nextNr
    }
    const benef = contractInfo.benef
    setForm(f => ({
      ...f,
      articole,
      ...(contractInfo.termenPlata ? { termen_plata_zile: contractInfo.termenPlata } : {}),
      ...(benef ? {
        beneficiar_id: benef.id, beneficiar_nume: benef.nume || '', beneficiar_cif: benef.cif || '',
        beneficiar_iban: benef.iban_principal || '', beneficiar_banca: benef.banca || '', beneficiar_sediu: benef.sediu || '',
        contact_nume: (contractInfo.contactContract && contractInfo.contactContract.nume) || benef.contact_nume || '',
        contact_email: (contractInfo.contactContract && contractInfo.contactContract.email) || benef.contact_email || '',
        contact_telefon: (contractInfo.contactContract && contractInfo.contactContract.telefon) || benef.telefon || '',
      } : {}),
    }))
    lastGenRef.current = JSON.stringify(articole)
    showToast(`✓ ${ordered.length} situații → ${articole.length} linii generate`)
  }

  // Pre-fill din SL dacă e furnizat
  useEffect(() => {
    if (!(slDefault && isNew)) return
    ;(async () => {
      // Valoarea facturii = valoarea ajustată (bază cu OS + ajustare). Obiectul din lista SL
      // poate să nu conțină valoare_ajustata_lei → o luăm PROASPĂT din BD ca să nu cădem pe bază.
      // Valori SL: bază + ajustare ICC separate (factura le listează ca 2 linii distincte).
      let valBaza = parseFloat(slDefault.valoare_baza_lei || 0)
      let valAjust = parseFloat(slDefault.valoare_ajustare_lei || 0)
      let valTotal = parseFloat(slDefault.valoare_ajustata_lei || slDefault.valoare_baza_lei || 0)
      let coefAjust = parseFloat(slDefault.coeficient_ajustare || 0)
      try {
        const { data: slF } = await supabase.from('executie_situatii_plata')
          .select('valoare_baza_lei, valoare_ajustare_lei, valoare_ajustata_lei, coeficient_ajustare').eq('id', slDefault.id).single()
        if (slF) {
          valBaza   = parseFloat(slF.valoare_baza_lei || 0)
          valAjust  = parseFloat(slF.valoare_ajustare_lei || 0)
          valTotal  = parseFloat(slF.valoare_ajustata_lei || slF.valoare_baza_lei || 0)
          coefAjust = parseFloat(slF.coeficient_ajustare || 0)
        }
      } catch(e) { /* fallback la valorile din obiectul listei */ }
      // Ajustări retroactive ale SL anterioare, recuperate în ACEASTĂ SL (one-to-many)
      let ajustariRetro = []
      try {
        const { data: ajs } = await supabase.from('executie_sl_ajustari')
          .select('sl_ajustata_nr, valoare_ajustare_lei, coeficient')
          .eq('sl_id', slDefault.id).order('id', { ascending: true })
        ajustariRetro = ajs || []
      } catch(e) { /* tabela goală sau lipsă → ignor */ }
      // Linii-obiect detaliate (din centralizator) — preferate față de generarea lump
      let objLiniiSL = []
      try {
        const { data: ol } = await supabase.from('executie_situatii_plata_linii').select('*').eq('sl_id', slDefault.id).order('ord')
        objLiniiSL = ol || []
      } catch(e) { /* ignor */ }
      // Contract terț (Administrativ → Contracte cu Terți): nume + nr + dată + beneficiar.
      // OS-ul NU apare ca linie — valoarea (valoare_ajustata_lei) include deja bază (cu OS) + ajustare.
      // Luna NU se mai pune pe linie: data înregistrării SL ≠ luna aferentă lucrărilor.
      let contractRef = slDefault.nr_contract || ''
      let contractDenumire = ''
      let benef = null
      let termenPlata = null
      let contactContract = null
      try {
        let cid = slDefault.contract_id
        if (slDefault.proiect_id) {
          const { data: pr } = await supabase.from('executie_proiecte').select('contract_id, nr_contract').eq('id', slDefault.proiect_id).single()
          if (pr) { cid = cid || pr.contract_id; if (!contractRef) contractRef = pr.nr_contract || '' }
        }
        if (cid) {
          const { data: ct } = await supabase.from('contracte_terti')
            .select('numar_contract, data_semnare, denumire, termen_plata_zile, beneficiar_id, contact_factura_nume, contact_factura_email, contact_factura_telefon').eq('id', cid).single()
          if (ct) {
            if (ct.numar_contract) {
              const dS = ct.data_semnare ? new Date(ct.data_semnare).toLocaleDateString('ro-RO') : ''
              contractRef = dS ? `${ct.numar_contract}/${dS}` : ct.numar_contract
            }
            contractDenumire = ct.denumire || ''
            termenPlata = ct.termen_plata_zile
            contactContract = { nume: ct.contact_factura_nume || '', email: ct.contact_factura_email || '', telefon: ct.contact_factura_telefon || '' }
            if (ct.beneficiar_id) {
              const { data: b } = await supabase.from('beneficiari')
                .select('id,nume,cif,iban_principal,banca,sediu,contact_email,telefon,contact_nume,retine_gbe_pct,retine_car_pct').eq('id', ct.beneficiar_id).single()
              if (b) benef = b
            }
          }
        }
      } catch(e) { /* fallback: rămâne nr_contract simplu, fără denumire/beneficiar */ }
      const denPart = contractDenumire ? ` — ${contractDenumire}` : ''
      const den = `Contravaloare lucrări conf. situație de lucrări nr.${slDefault.nr_situatie}${denPart} — contract ${contractRef||'—'}`
      // Dacă SL are ajustare ICC → 2 linii separate (bază + ajustare). Altfel o singură linie.
      // Plus: câte o linie per ajustare retroactivă a unei SL anterioare recuperate aici.
      const hasAjust = Math.abs(valAjust) > 0.005
      const articoleSL = []
      let _nr = 1
      const _objArt = objLinesToArticole(objLiniiSL, _nr)
      if (_objArt.linii.length) {
        // Linii pe obiect din centralizator (stil manual: lucrări + ajustări separate)
        articoleSL.push(..._objArt.linii); _nr = _objArt.nextNr
      } else if (hasAjust) {
        articoleSL.push({ nr:_nr++, denumire:den, um:'buc', cantitate:1, pret_unitar:valBaza.toFixed(2), valoare:valBaza.toFixed(2), tva_pct:TVA_DEFAULT })
        articoleSL.push({ nr:_nr++, denumire:`Ajustare de preț conform coeficient ICC${coefAjust ? ' ' + coefAjust.toFixed(4).replace('.', ',') : ''} — situație de lucrări nr.${slDefault.nr_situatie}`, um:'buc', cantitate:1, pret_unitar:valAjust.toFixed(2), valoare:valAjust.toFixed(2), tva_pct:TVA_DEFAULT })
      } else {
        articoleSL.push({ nr:_nr++, denumire:den, um:'buc', cantitate:1, pret_unitar:valTotal.toFixed(2), valoare:valTotal.toFixed(2), tva_pct:TVA_DEFAULT })
      }
      for (const aj of ajustariRetro) {
        const v = parseFloat(aj.valoare_ajustare_lei || 0)
        if (Math.abs(v) < 0.005) continue
        const coefStr = (aj.coeficient != null && !isNaN(parseFloat(aj.coeficient))) ? ' ' + parseFloat(aj.coeficient).toFixed(5).replace('.', ',') : ''
        const refStr = aj.sl_ajustata_nr ? ` nr.${aj.sl_ajustata_nr}` : ''
        articoleSL.push({ nr:_nr++, denumire:`Ajustare de preț conform coeficient ICC${coefStr} — situație de lucrări${refStr}`, um:'buc', cantitate:1, pret_unitar:v.toFixed(2), valoare:v.toFixed(2), tva_pct:TVA_DEFAULT })
      }
      // Rețineri GBE / CAR (per beneficiar) — linii negative.
      // Se aplică pe valoarea brută a lucrărilor (valBaza). NU reduc baza de TVA → tva_pct:0 (TVA se calculează pe brut).
      const gbePct = parseFloat(benef?.retine_gbe_pct || 0)
      const carPct = parseFloat(benef?.retine_car_pct || 0)
      if (gbePct > 0) {
        const gbe = -(valBaza * gbePct / 100)
        articoleSL.push({ nr:_nr++, denumire:`Reținere GBE (garanție bună execuție) ${gbePct.toString().replace('.', ',')}% — situație de lucrări nr.${slDefault.nr_situatie}`, um:'buc', cantitate:1, pret_unitar:gbe.toFixed(2), valoare:gbe.toFixed(2), tva_pct:0 })
      }
      if (carPct > 0) {
        const car = -(valBaza * carPct / 100)
        articoleSL.push({ nr:_nr++, denumire:`Reținere CAR ${carPct.toString().replace('.', ',')}% — situație de lucrări nr.${slDefault.nr_situatie}`, um:'buc', cantitate:1, pret_unitar:car.toFixed(2), valoare:car.toFixed(2), tva_pct:0 })
      }
      setForm(f => ({
        ...f,
        articole: articoleSL,
        proiect_id: String(slDefault.proiect_id||''),
        situatie_plata_ids: [slDefault.id],
        ...(termenPlata ? { termen_plata_zile: termenPlata } : {}),
        ...(benef ? {
          beneficiar_id:    benef.id,
          beneficiar_nume:  benef.nume || '',
          beneficiar_cif:   benef.cif || '',
          beneficiar_iban:  benef.iban_principal || '',
          beneficiar_banca: benef.banca || '',
          beneficiar_sediu: benef.sediu || '',
          contact_nume:     (contactContract && contactContract.nume) || benef.contact_nume || '',
          contact_email:    (contactContract && contactContract.email) || benef.contact_email || '',
          contact_telefon:  (contactContract && contactContract.telefon) || benef.telefon || '',
        } : {}),
      }))
      lastGenRef.current = JSON.stringify(articoleSL)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load proiecte + SL când proiect_id se schimbă
  useEffect(() => {
    supabase.from('executie_proiecte').select('id,cod_intern,nr_contract').eq('activ',true).order('cod_intern')
      .then(({data}) => setProiecte(data||[]))
  }, [])

  useEffect(() => {
    if (!form.proiect_id) { setSlLista([]); return }
    supabase.from('executie_situatii_plata').select('id,nr_situatie,luna,an,valoare_baza_lei,valoare_ajustata_lei,status')
      .eq('proiect_id', form.proiect_id).eq('tip','situatie_plata').order('an').order('luna')
      .then(({data}) => setSlLista(data||[]))
  }, [form.proiect_id])

  const set = (k,v) => setForm(f => ({...f,[k]:v}))

  // Calculele valorilor
  const totals = useMemo(() => {
    const neta = form.articole.reduce((s,a) => s + (parseFloat(a.valoare)||0), 0)
    // TVA pe BRUT: se calculează PER LINIE. Reținerile GBE/CAR au tva_pct:0 → NU reduc baza de TVA.
    const tvaV = form.articole.reduce((s,a) => {
      const cota = (a.tva_pct !== undefined && a.tva_pct !== '' && a.tva_pct !== null) ? parseFloat(a.tva_pct) : (parseFloat(form.tva_pct)||21)
      return s + (parseFloat(a.valoare)||0) * (cota||0) / 100
    }, 0)
    return { neta, tva: tvaV, total: neta + tvaV }
  }, [form.articole, form.tva_pct])

  const setArticol = (i, k, v) => setForm(f => {
    const arr = [...f.articole]
    arr[i] = { ...arr[i], [k]: v }
    if (k === 'cantitate' || k === 'pret_unitar') {
      const c = parseFloat(arr[i].cantitate)||0
      const p = parseFloat(arr[i].pret_unitar)||0
      arr[i].valoare = (c * p).toFixed(2)
    }
    return { ...f, articole: arr }
  })

  const addArticol = () => setForm(f => ({
    ...f,
    articole: [...f.articole, { nr: f.articole.length+1, denumire:'', um:'buc', cantitate:1, pret_unitar:'', valoare:'', tva_pct:TVA_DEFAULT }]
  }))
  const removeArticol = i => setForm(f => ({ ...f, articole: f.articole.filter((_,idx)=>idx!==i) }))

  const onBeneficiarChange = (bId) => {
    const b = beneficiariLista.find(x => String(x.id) === String(bId))
    if (b) setForm(f => ({
      ...f, beneficiar_id: bId,
      beneficiar_nume:  b.nume || '',
      beneficiar_cif:   b.cif  || '',
      beneficiar_iban:  b.iban_principal || '',
      beneficiar_banca: b.banca || '',
      beneficiar_sediu: b.sediu || '',
      contact_nume:    b.contact_nume || f.contact_nume || '',
      contact_email:   b.contact_email || f.contact_email || '',
      contact_telefon: b.telefon || f.contact_telefon || '',
    }))
    else set('beneficiar_id', bId)
  }

  const handleSave = async (andPDF = false) => {
    if (!form.beneficiar_nume.trim()) { showToast('Beneficiarul este obligatoriu', 'err'); return }
    if (form.articole.some(a => !a.denumire.trim())) { showToast('Completați denumirea articolelor', 'err'); return }
    setSaving(true)
    try {
      let nrFinal = form.nr
      if (isNew && !nrFinal) {
        const { data: nextNr } = await supabase.rpc('fn_get_next_nr_factura', { p_serie: form.serie })
        nrFinal = nextNr
      }
      // Client fără contract: salvează-l în listă la prima factură → auto-fill data viitoare
      let benefId = form.beneficiar_id ? parseInt(form.beneficiar_id) : null
      if (!benefId && salveazaClient && form.beneficiar_nume.trim()) {
        const cifNou = form.beneficiar_cif.trim()
        if (cifNou) {
          const { data: ex } = await supabase.from('beneficiari').select('id').ilike('cif', cifNou).limit(1)
          if (ex && ex.length) benefId = ex[0].id
        }
        if (!benefId) {
          const { data: nb } = await supabase.from('beneficiari').insert({
            nume: form.beneficiar_nume.trim(),
            cif: cifNou || null,
            iban_principal: form.beneficiar_iban.trim() || null,
            banca: form.beneficiar_banca.trim() || null,
            sediu: form.beneficiar_sediu.trim() || null,
            contact_nume: form.contact_nume.trim() || null,
            contact_email: form.contact_email.trim() || null,
            telefon: form.contact_telefon.trim() || null,
            activ: true,
          }).select('id').single()
          if (nb) benefId = nb.id
        }
      }
      const payload = {
        serie: form.serie, nr: parseInt(nrFinal),
        data: form.data,
        beneficiar_id: benefId,
        beneficiar_nume: form.beneficiar_nume.trim(),
        beneficiar_cif:   form.beneficiar_cif.trim()   || null,
        beneficiar_iban:  form.beneficiar_iban.trim()  || null,
        beneficiar_banca: form.beneficiar_banca.trim() || null,
        beneficiar_sediu: form.beneficiar_sediu.trim() || null,
        contact_nume:    form.contact_nume.trim() || null,
        contact_email:   form.contact_email.trim() || null,
        contact_telefon: form.contact_telefon.trim() || null,
        articole: form.articole,
        tva_pct: parseFloat(form.tva_pct) || TVA_DEFAULT,
        valoare_neta: totals.neta,
        tva: totals.tva,
        total: totals.total,
        mod_plata: form.mod_plata,
        delegat_nume: form.delegat_nume.trim() || null,
        delegat_awb:  form.delegat_awb.trim()  || null,
        termen_plata_zile: parseInt(form.termen_plata_zile)||30,
        proiect_id: form.proiect_id ? parseInt(form.proiect_id) : null,
        situatie_plata_ids: form.situatie_plata_ids.length ? form.situatie_plata_ids.map(Number) : null,
        email_destinatar: form.email_destinatar.trim() || null,
        titlu_scurt: form.titlu_scurt.trim() || null,
        status: form.status,
        updated_at: new Date().toISOString(),
      }
      let savedId = item?.id
      let err
      if (isNew) {
        if (profileId) payload.created_by = profileId
        const res = await supabase.from('facturi_emise').insert(payload).select('id').single()
        err = res.error; savedId = res.data?.id
      } else {
        ({ error: err } = await supabase.from('facturi_emise').update(payload).eq('id', item.id))
      }
      if (err) throw err
      // SL-urile legate trec automat în „facturata" la emiterea facturii
      if (form.situatie_plata_ids.length) {
        await supabase.from('executie_situatii_plata')
          .update({ status: 'facturata' })
          .in('id', form.situatie_plata_ids.map(Number))
          .neq('status', 'facturata')
      }
      showToast(isNew ? 'Factură creată!' : 'Factură salvată!', 'ok')
      if (andPDF && savedId) await handleGenPDF(savedId, { ...payload, id: savedId, nr: nrFinal, an: parseInt(form.an) || new Date().getFullYear() })
      onSaved()
    } catch(e) { showToast('Eroare: ' + e.message, 'err') }
    finally { setSaving(false) }
  }

  const handleGenPDF = async (facturaId, facturaData) => {
    setGenPDF(true)
    try {
      const { jsPDF } = await import('jspdf')
      const html2canvas = (await import('html2canvas')).default
      const fData = facturaData || { ...form, ...totals, id: item?.id }
      const htmlStr = buildInvoiceHTML(fData)
      const div = document.createElement('div')
      div.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff'
      div.innerHTML = htmlStr
      document.body.appendChild(div)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      const canvas = await html2canvas(div, { scale:2, useCORS:true, backgroundColor:'#ffffff', logging:false })
      document.body.removeChild(div)
      const imgData = canvas.toDataURL('image/jpeg', 0.92)
      const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' })
      const W=210, H=Math.min(297, (canvas.height/canvas.width)*(210))
      doc.addImage(imgData,'JPEG',0,0,W,H,'','FAST')
      const pdfBlob = doc.output('blob')

      // Format data: 2026-06-04 → 04.06.2026
      const dataRaw = fData.data || new Date().toISOString().slice(0,10)
      const [yy, mm, dd] = String(dataRaw).split('-')
      const dataFmt = `${dd}.${mm}.${yy}`

      // Beneficiar scurt (primele 2 cuvinte semnificative: Atlas_Copco, SNTGN_TRANSGAZ)
      const benef = (fData.beneficiar_nume || form.beneficiar_nume || '')
        .replace(/S\.?R\.?L\.?|S\.?A\.?/gi,'').trim()
        .split(/\s+/).filter(w=>w.length>2).slice(0,2).join('_')
        .replace(/[^a-zA-Z0-9_]/g,'')

      // Titlu scurt opțional — sanitizat
      const titlu = (fData.titlu_scurt || form.titlu_scurt || '')
        .trim().replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_.\-]/g,'')

      // Proiect cod intern (ex: PRUNISOR_JUPA)
      const proiectCod = proiecte.find(p => String(p.id) === String(fData.proiect_id || form.proiect_id))?.cod_intern || ''
      const proiectClean = proiectCod.trim().replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')

      const nrComplet = `${fData.serie||'GAZ'}-${fData.nr}`
      const fileName = titlu
        ? `Factura_GAZPET_${nrComplet}_${proiectClean ? proiectClean + '_' : ''}${benef}_${titlu}_${dataFmt}.pdf`
        : `Factura_GAZPET_${nrComplet}_${proiectClean ? proiectClean + '_' : ''}${benef}_${dataFmt}.pdf`
      const anFolder = parseInt(fData.an || form.an) || new Date().getFullYear()
      const path = `${anFolder}/${fileName}`
      const { error: upErr } = await supabase.storage.from('facturi-emise').upload(path, pdfBlob, { contentType:'application/pdf', upsert:true })
      if (!upErr) {
        await supabase.from('facturi_emise').update({ pdf_path: path, status:'emisa' }).eq('id', facturaId || item?.id)
        setPdfUrl(path)
        showToast(`PDF generat: ${fileName}`, 'ok')
        // Descărcare locală
        const url = URL.createObjectURL(pdfBlob)
        const a = document.createElement('a'); a.href=url; a.download=fileName; a.click()
        URL.revokeObjectURL(url)
        // Trimitere AUTOMATĂ pe email la emitere (Marilena + Mirela + Razvan, mereu)
        await trimiteEmailFactura(facturaId || item?.id, true)
      } else throw upErr
    } catch(e) { showToast('Eroare PDF: ' + e.message, 'err') }
    finally { setGenPDF(false) }
  }

  // Edge-ul adaugă MEREU destinatarii interni (Marilena, Mirela, Razvan) — v12
  const trimiteEmailFactura = async (idFactura, automat = false) => {
    if (!idFactura) { if (!automat) showToast('Salvați mai întâi factura', 'err'); return }
    setSendingEmail(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-factura-email`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ factura_id: idFactura, email_to: form.email_destinatar || undefined })
      })
      const res = await resp.json()
      if (!resp.ok) throw new Error(res.error || res.hint || 'Eroare trimitere')
      showToast(automat ? `📧 Factura trimisă automat (${(res.destinatari||[]).length} destinatari)` : `Email trimis la ${(res.destinatari||[]).join(', ')}`, 'ok')
      onSaved()
    } catch(e) { showToast('Eroare email: ' + e.message, 'err') }
    finally { setSendingEmail(false) }
  }
  const handleSendEmail = () => trimiteEmailFactura(item?.id)

  const fieldStyle = { ...S.input }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.85)',zIndex:1010,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{background:G.surface,border:`1px solid ${G.border}`,borderRadius:14,width:'100%',maxWidth:720,maxHeight:'92vh',overflow:'auto'}}>

        {/* Header */}
        <div style={{padding:'16px 22px',borderBottom:`1px solid ${G.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:G.surface,zIndex:1}}>
          <div style={{fontSize:15,fontWeight:700}}>{isNew ? '＋ Factură nouă' : `✏️ ${item.nr_complet}`}</div>
          <button onClick={onClose} style={{background:'transparent',border:'none',color:G.muted,fontSize:22,cursor:'pointer'}}>×</button>
        </div>

        <div style={{padding:'18px 22px',display:'flex',flexDirection:'column',gap:14}}>

          {/* Serie + Nr + Data + An */}
          <div style={{display:'grid',gridTemplateColumns:'1.2fr 1.2fr 1.4fr 0.8fr',gap:12}}>
            <div>
              <label style={S.lbl}>Serie</label>
              <select value={form.serie} onChange={e=>set('serie',e.target.value)} style={fieldStyle}>
                {SERII.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Număr {isNew && <span style={{color:G.dim,fontSize:10}}>(auto dacă gol)</span>}</label>
              <input value={form.nr} onChange={e=>set('nr',e.target.value)} style={fieldStyle} placeholder="Auto" type="number" />
            </div>
            <div>
              <label style={S.lbl}>Data</label>
              <input type="date" value={form.data}
                onChange={e=>{ const v=e.target.value; setForm(f=>({...f, data:v, an: v ? Number(v.slice(0,4)) : f.an})) }}
                style={fieldStyle} />
            </div>
            <div>
              <label style={S.lbl}>An <span style={{color:G.dim,fontSize:10}}>(folder PDF)</span></label>
              <input value={form.an} onChange={e=>set('an', e.target.value.replace(/\D/g,'').slice(0,4))}
                style={fieldStyle} type="number" placeholder={String(new Date().getFullYear())} />
            </div>
          </div>

          {/* Beneficiar */}
          <div style={{borderTop:`1px solid ${G.border}`,paddingTop:12}}>
            <div style={{fontSize:12,fontWeight:700,color:G.muted,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:10}}>👔 Beneficiar</div>
            <div style={{marginBottom:10}}>
              <label style={S.lbl}>Din listă (auto-fill)</label>
              <select value={form.beneficiar_id} onChange={e=>onBeneficiarChange(e.target.value)} style={fieldStyle}>
                <option value="">— Selectează sau completează manual —</option>
                {beneficiariLista.map(b=><option key={b.id} value={b.id}>{b.nume}</option>)}
              </select>
              {!form.beneficiar_id && (
                <label style={{display:'flex',alignItems:'center',gap:8,marginTop:8,fontSize:12,color:G.muted,cursor:'pointer'}}>
                  <input type="checkbox" checked={salveazaClient} onChange={e=>setSalveazaClient(e.target.checked)} />
                  💾 Salvează clientul în listă pentru refolosire (auto-fill data viitoare)
                </label>
              )}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'2fr 1fr',gap:10,marginBottom:8}}>
              <div>
                <label style={S.lbl}>Denumire beneficiar *</label>
                <input value={form.beneficiar_nume} onChange={e=>set('beneficiar_nume',e.target.value)} style={fieldStyle} placeholder="S.N.T.G.N. TRANSGAZ S.A." />
              </div>
              <div>
                <label style={S.lbl}>CIF</label>
                <input value={form.beneficiar_cif} onChange={e=>set('beneficiar_cif',e.target.value)} style={fieldStyle} placeholder="RO 13068733" />
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div>
                <label style={S.lbl}>IBAN</label>
                <input value={form.beneficiar_iban} onChange={e=>set('beneficiar_iban',e.target.value)} style={fieldStyle} placeholder="RO09RNCB..." />
              </div>
              <div>
                <label style={S.lbl}>Bancă</label>
                <input value={form.beneficiar_banca} onChange={e=>set('beneficiar_banca',e.target.value)} style={fieldStyle} placeholder="BCR, Mediaș" />
              </div>
            </div>
            <div style={{marginTop:8}}>
              <label style={S.lbl}>Sediu</label>
              <input value={form.beneficiar_sediu} onChange={e=>set('beneficiar_sediu',e.target.value)} style={fieldStyle} placeholder="Piata C.I. Motas nr.1, Sibiu - Medias" />
            </div>
            <div style={{marginTop:10,paddingTop:10,borderTop:`1px dashed ${G.border}`}}>
              <div style={{fontSize:11,color:G.muted,marginBottom:8,fontWeight:600}}>📇 Persoană de contact <span style={{color:G.dim,fontWeight:400}}>(apare pe factură, colț dreapta)</span></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div>
                  <label style={S.lbl}>Persoană contact</label>
                  <input value={form.contact_nume} onChange={e=>set('contact_nume',e.target.value)} style={fieldStyle} placeholder="ex: Ion Popescu" />
                </div>
                <div>
                  <label style={S.lbl}>Adresă email</label>
                  <input value={form.contact_email} onChange={e=>set('contact_email',e.target.value)} style={fieldStyle} placeholder="ex: contact@firma.ro" />
                </div>
                <div>
                  <label style={S.lbl}>Telefon</label>
                  <input value={form.contact_telefon} onChange={e=>set('contact_telefon',e.target.value)} style={fieldStyle} placeholder="ex: 07xx xxx xxx" />
                </div>
              </div>
            </div>
          </div>

          {/* Articole */}
          <div style={{borderTop:`1px solid ${G.border}`,paddingTop:12}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:G.muted,textTransform:'uppercase',letterSpacing:'.5px'}}>📋 Articole</div>
              <button onClick={addArticol} style={{padding:'4px 12px',background:G.financiar+'22',border:`1px solid ${G.financiar}44`,borderRadius:6,color:G.financiar,fontSize:12,cursor:'pointer',fontWeight:700}}>＋ Adaugă linie</button>
            </div>
            {form.articole.map((a,i)=>(
              <div key={i} style={{background:G.card2,borderRadius:8,padding:'10px 12px',marginBottom:8,border:`1px solid ${G.border}`}}>
                <div style={{marginBottom:8}}>
                  <label style={S.lbl}>Denumire *</label>
                  <input value={a.denumire} onChange={e=>setArticol(i,'denumire',e.target.value)} style={fieldStyle} placeholder="Contravaloare lucrări conf. situație nr...." />
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr auto',gap:8,alignItems:'flex-end'}}>
                  <div>
                    <label style={S.lbl}>U.M.</label>
                    <input value={a.um} onChange={e=>setArticol(i,'um',e.target.value)} style={fieldStyle} placeholder="buc" />
                  </div>
                  <div>
                    <label style={S.lbl}>Cantitate</label>
                    <input type="number" value={a.cantitate} onChange={e=>setArticol(i,'cantitate',e.target.value)} style={fieldStyle} />
                  </div>
                  <div>
                    <label style={S.lbl}>Preț unitar (RON)</label>
                    <input type="number" value={a.pret_unitar} onChange={e=>setArticol(i,'pret_unitar',e.target.value)} style={fieldStyle} step="0.01" />
                  </div>
                  <div>
                    <label style={S.lbl}>Valoare netă</label>
                    <input type="number" value={a.valoare} onChange={e=>setArticol(i,'valoare',e.target.value)} style={{...fieldStyle,color:G.green,fontWeight:600}} step="0.01" />
                  </div>
                  {form.articole.length > 1 && (
                    <button onClick={()=>removeArticol(i)} style={{padding:'8px 10px',background:'transparent',border:'none',color:G.red,fontSize:16,cursor:'pointer'}}>🗑</button>
                  )}
                </div>
              </div>
            ))}
            {/* Totals box */}
            <div style={{background:G.card2,borderRadius:8,padding:'12px 14px',border:`1px solid ${G.financiar}33`}}>
              <div style={{display:'flex',justifyContent:'flex-end',gap:24,fontSize:13}}>
                <div style={{color:G.muted}}>Valoare netă: <strong style={{color:G.text,fontFamily:'monospace'}}>{fmtLei(totals.neta)}</strong></div>
                <div style={{color:G.muted}}>TVA {form.tva_pct}%: <strong style={{color:G.yellow,fontFamily:'monospace'}}>{fmtLei(totals.tva)}</strong></div>
                <div style={{color:G.muted}}>TOTAL: <strong style={{color:G.financiar,fontSize:15,fontFamily:'monospace'}}>{fmtLei(totals.total)}</strong></div>
              </div>
            </div>
          </div>

          {/* Detalii expeditie + link Proiect */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:12}}>
            <div>
              <label style={S.lbl}>Mod plată</label>
              <select value={form.mod_plata} onChange={e=>set('mod_plata',e.target.value)} style={fieldStyle}>
                {['OP','Numerar','CEC','Card'].map(m=><option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Termen plată (zile)</label>
              <input type="number" value={form.termen_plata_zile} onChange={e=>set('termen_plata_zile',e.target.value)} style={fieldStyle} placeholder="30" />
            </div>
            <div>
              <label style={S.lbl}>Delegat</label>
              <input value={form.delegat_nume} onChange={e=>set('delegat_nume',e.target.value)} style={fieldStyle} placeholder="TRUSU RAZVAN MIHAIL" />
            </div>
            <div>
              <label style={S.lbl}>AWB Colet</label>
              <input value={form.delegat_awb} onChange={e=>set('delegat_awb',e.target.value)} style={fieldStyle} placeholder="PX 975974" />
            </div>
          </div>

          {/* Proiect + SL link */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label style={S.lbl}>🔗 Proiect Execuție</label>
              <select value={form.proiect_id} onChange={e=>set('proiect_id',e.target.value)} style={fieldStyle}>
                <option value="">— Neselectat —</option>
                {proiecte.map(p=><option key={p.id} value={p.id}>{p.cod_intern}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>SL linkate (multi)</label>
              <select multiple value={form.situatie_plata_ids.map(String)}
                onChange={e=>set('situatie_plata_ids', Array.from(e.target.selectedOptions).map(o=>parseInt(o.value)))}
                style={{...fieldStyle,height:72}}>
                {slLista.map(sl=><option key={sl.id} value={sl.id}>{sl.nr_situatie} — {LUNI[(sl.luna||1)-1]} {sl.an} — {fmtLei(sl.valoare_ajustata_lei||sl.valoare_baza_lei)}</option>)}
              </select>
              <button type="button" onClick={regenerateFromSelectedSLs}
                disabled={(form.situatie_plata_ids||[]).length === 0}
                style={{...S.btnP, marginTop:6, width:'100%', boxSizing:'border-box', fontSize:12,
                  opacity:(form.situatie_plata_ids||[]).length === 0 ? 0.45 : 1,
                  cursor:(form.situatie_plata_ids||[]).length === 0 ? 'not-allowed' : 'pointer'}}>
                🔄 Regenerează linii din {(form.situatie_plata_ids||[]).length || 0} SL selectate
              </button>
              {(form.situatie_plata_ids||[]).length > 1 && (
                <div style={{fontSize:10, color:G.muted, marginTop:4}}>
                  Ține Ctrl/Cmd pentru selecție multiplă. Toate SL trebuie să fie din același proiect.
                </div>
              )}
            </div>
          </div>

          {/* Email */}
          <div>
            <label style={S.lbl}>📝 Titlu scurt (pentru numele PDF)</label>
            <input value={form.titlu_scurt} onChange={e=>set('titlu_scurt',e.target.value)} style={fieldStyle} placeholder="ex: Transgaz Caldararu sit.4" />
            <div style={{fontSize:10,color:'#888',marginTop:3}}>
              Apare în numele fișierului: Factura_GAZPET_GAZ-363_TRANSGAZ_{form.titlu_scurt||'...'}_04.06.2026.pdf
            </div>

            <label style={S.lbl}>📧 Email destinatar</label>
            <input value={form.email_destinatar} onChange={e=>set('email_destinatar',e.target.value)} style={fieldStyle} placeholder="marilena.tudorache@gazpet.ro" type="email" />
          </div>

          {/* PDF existent */}
          {pdfUrl && (
            <div style={{background:G.financiar+'11',border:`1px solid ${G.financiar}33`,borderRadius:8,padding:'10px 14px',fontSize:12,color:G.financiar}}>
              ✅ PDF generat: <span style={{fontFamily:'monospace',fontSize:11}}>{typeof pdfUrl === 'string' ? pdfUrl : 'ok'}</span>
            </div>
          )}

        </div>

        {/* Footer butoane */}
        <div style={{padding:'14px 22px',borderTop:`1px solid ${G.border}`,display:'flex',gap:10,flexWrap:'wrap',justifyContent:'flex-end',background:G.bg,position:'sticky',bottom:0}}>
          <button onClick={onClose} style={S.btnS}>Anulează</button>
          <button onClick={()=>handleSave(false)} disabled={saving} style={{...S.btnS, opacity:saving?0.6:1}}>
            {saving ? '⏳...' : '💾 Salvează'}
          </button>
          <button onClick={()=>handleSave(true)} disabled={saving||genPDF} style={{...S.btnP, background:G.purple, opacity:(saving||genPDF)?0.6:1}}>
            {genPDF ? '⏳ Generez PDF...' : '📄 Salvează + PDF'}
          </button>
          {!isNew && (
            <button onClick={handleSendEmail} disabled={sendingEmail} style={{...S.btnP, background:G.blue, opacity:sendingEmail?0.6:1}}>
              {sendingEmail ? '⏳ Trimit...' : '📧 Trimite email'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ===========================================================================
// PAGINA PRINCIPALĂ FINANCIAR
// ===========================================================================
// ===========================================================================
// TAB FACTURI FURNIZORI (12.06.2026) — facturile încărcate pe comenzile
// furnizor în modulul Achiziții migrează automat aici, grupate per furnizor.
// ===========================================================================
function FacturiFurnizoriTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        // Query-uri separate + merge manual (FK implicit joins evitate — lecție nas_documente)
        const [rDocs, rCmd, rFz, rProj] = await Promise.all([
          supabase.from('comenzi_furnizor_documente').select('*').eq('tip', 'factura').order('uploadat_la', { ascending: false }),
          supabase.from('comenzi_furnizor').select('id, numar_comanda, furnizor_id, proiect_id, status'),
          supabase.from('logistica_furnizori').select('id, nume'),
          supabase.from('executie_proiecte').select('id, nume, cod_intern'),
        ])
        const cmdMap = Object.fromEntries((rCmd.data || []).map(c => [c.id, c]))
        const fzMap  = Object.fromEntries((rFz.data || []).map(f => [f.id, f]))
        const pjMap  = Object.fromEntries((rProj.data || []).map(p => [p.id, p]))
        setRows((rDocs.data || []).map(d => {
          const cmd = cmdMap[d.comanda_id]
          const fz = cmd?.furnizor_id ? fzMap[cmd.furnizor_id] : null
          const pj = cmd?.proiect_id ? pjMap[cmd.proiect_id] : null
          return { ...d, _cmd: cmd, _furnizor: fz?.nume || 'Furnizor necunoscut', _proiect: pj ? (pj.cod_intern || pj.nume) : null }
        }))
      } finally { setLoading(false) }
    })()
  }, [])

  const openDoc = async (path) => {
    const { data } = await supabase.storage.from('comenzi-furnizor').createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  const filtered = useMemo(() => {
    if (!search) return rows
    const s = search.toLowerCase()
    return rows.filter(r => (r._furnizor || '').toLowerCase().includes(s)
      || (r.fisier_nume || '').toLowerCase().includes(s)
      || (r._cmd?.numar_comanda || '').toLowerCase().includes(s)
      || (r._proiect || '').toLowerCase().includes(s))
  }, [rows, search])

  // Grupare per furnizor
  const grupe = useMemo(() => {
    const m = new Map()
    for (const r of filtered) {
      if (!m.has(r._furnizor)) m.set(r._furnizor, [])
      m.get(r._furnizor).push(r)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [filtered])

  return (
    <div>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:18,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:18,fontWeight:800}}>🧾 Facturi furnizori</div>
          <div style={{fontSize:12,color:G.muted,marginTop:2}}>Încărcate pe comenzile din Achiziții · {rows.length} {rows.length === 1 ? 'factură' : 'facturi'} · {grupe.length} furnizori</div>
        </div>
        <div style={{flex:1}} />
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Caută furnizor / comandă / proiect..."
          style={{padding:'9px 13px',background:G.surface,border:`1px solid ${G.border}`,borderRadius:8,color:G.text,fontSize:13,outline:'none',minWidth:260}} />
      </div>

      {loading && <div style={{padding:40,textAlign:'center',color:G.muted}}>Se încarcă...</div>}

      {!loading && !grupe.length && (
        <div style={{padding:50,textAlign:'center',background:G.surface,borderRadius:12,border:`1px dashed ${G.border}`}}>
          <div style={{fontSize:36,marginBottom:10}}>🧾</div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>{search ? 'Nicio factură pe căutarea curentă.' : 'Nicio factură de furnizor încă.'}</div>
          {!search && <div style={{fontSize:12,color:G.muted}}>Facturile se încarcă pe comandă în modulul Achiziții (secțiunea 📎 Factură & Documente calitate) și apar automat aici.</div>}
        </div>
      )}

      {!loading && grupe.map(([furnizor, docs]) => (
        <div key={furnizor} style={{background:G.surface,border:`1px solid ${G.border}`,borderRadius:12,overflow:'hidden',marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 16px',borderBottom:`1px solid ${G.border}`,background:G.card2 || G.bg}}>
            <span style={{fontSize:16}}>🏭</span>
            <span style={{fontSize:14,fontWeight:800,flex:1}}>{furnizor}</span>
            <span style={{background:G.financiar+'22',color:G.financiar,border:`1px solid ${G.financiar}55`,borderRadius:12,padding:'2px 10px',fontSize:11,fontWeight:800}}>{docs.length} {docs.length === 1 ? 'factură' : 'facturi'}</span>
          </div>
          {docs.map(d => (
            <div key={d.id} style={{display:'grid',gridTemplateColumns:'1fr 150px 140px 130px 90px',gap:10,alignItems:'center',padding:'9px 16px',borderBottom:`1px solid ${G.border}`,fontSize:12.5}}>
              <button onClick={()=>openDoc(d.fisier_path)} style={{background:'none',border:'none',color:G.financiar,cursor:'pointer',fontFamily:'inherit',fontSize:12.5,fontWeight:600,textAlign:'left',padding:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={d.fisier_nume}>
                🧾 {d.fisier_nume || d.fisier_path.split('/').pop()}
              </button>
              <a href={`/achizitii?id=${d.comanda_id}`} style={{color:G.muted,fontSize:11.5,fontFamily:'monospace',textDecoration:'none'}} title="Deschide comanda în Achiziții">🛒 {d._cmd?.numar_comanda || `#${d.comanda_id}`}</a>
              <span style={{color:G.muted,fontSize:11.5}}>{d._proiect ? `📂 ${d._proiect}` : '—'}</span>
              <span style={{color:G.dim,fontSize:11}}>{d.uploadat_la ? new Date(d.uploadat_la).toLocaleDateString('ro-RO') : '—'}</span>
              <button onClick={()=>openDoc(d.fisier_path)} style={{padding:'4px 10px',background:G.financiar+'22',border:`1px solid ${G.financiar}44`,borderRadius:6,color:G.financiar,cursor:'pointer',fontSize:11,fontWeight:700}}>👁 Vezi</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function FinanciarPage() {
  const [facturi, setFacturi]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [profile, setProfile]       = useState(null)
  const [beneficiari, setBeneficiari] = useState([])
  const [editItem, setEditItem]     = useState(null)
  const [filterSerie, setFilterSerie] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterAn, setFilterAn]     = useState(String(new Date().getFullYear()))
  const [searchF, setSearchF]       = useState('')    // 14.07: căutare facturi (nr/beneficiar/lucrare)
  const [selIds, setSelIds]         = useState([])    // 14.07: selecție pentru export
  const [proiecteMap, setProiecteMap] = useState({})  // proiect_id → nume lucrare
  const [contracteMap, setContracteMap] = useState({}) // contract_id → „nr — denumire"
  const [deleteConf, setDeleteConf] = useState(null)
  const [slAlert, setSlAlert]       = useState([]) // SL fără factură
  const [citesteOpen, setCitesteOpen] = useState(false)  // 02.07.2026: panel „Citește Orice" (certificate de plată)
  const [tab, setTab]               = useState('emise')  // 'emise' | 'furnizori' | 'consumuri'
  // Deep-link din notificări: /financiar?tab=consumuri deschide direct tab-ul
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && ['emise','furnizori','consumuri'].includes(t)) setTab(t)
  }, [])
  const { show: showToast, Toast }  = useToast()

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('id,is_owner,role,can_access_salarii').eq('id',user.id).single()
        setProfile(prof)
      }
      const q = supabase.from('facturi_emise').select('*').order('an','desc').order('nr','desc')
      const { data } = await q
      setFacturi(data || [])
      // SL fără factură (cross-proiect)
      const { data: alertData } = await supabase.from('v_sl_fara_factura').select('*').order('an').order('luna')
      setSlAlert(alertData || [])
      // Beneficiari
      const { data: bens } = await supabase.from('beneficiari').select('id,nume,cif,iban_principal,banca,sediu,contact_email,telefon,contact_nume').eq('activ',true).order('nume')
      setBeneficiari(bens || [])
      // Lucrări + contracte (coloana „Lucrare / Contract" din listă)
      const { data: prj } = await supabase.from('executie_proiecte').select('id,nume')
      setProiecteMap(Object.fromEntries((prj||[]).map(p => [p.id, p.nume])))
      const { data: cts } = await supabase.from('contracte_terti').select('id,numar_contract,denumire')
      setContracteMap(Object.fromEntries((cts||[]).map(c => [c.id, `${c.numar_contract || ''} — ${c.denumire || ''}`.replace(/^ — /,'')])))
    } finally { setLoading(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAll() }, [loadAll])

  const isOwner = profile?.is_owner === true
  const canWrite = isOwner || ['superadmin','contabilitate'].includes(profile?.role)

  // Lucrarea/contractul facturii: proiectul de execuție are prioritate, apoi contractul
  const lucrareTxt = useCallback(f =>
    proiecteMap[f.proiect_id] || contracteMap[f.contract_id] || '', [proiecteMap, contracteMap])

  const facturiFiltrate = useMemo(() => facturi.filter(f => {
    if (filterSerie  && f.serie  !== filterSerie) return false
    if (filterStatus && f.status !== filterStatus) return false
    if (filterAn     && String(f.an) !== filterAn) return false
    if (searchF.trim()) {
      const s = norm(searchF)   // fără diacritice
      return norm(f.nr_complet).includes(s) || norm(f.beneficiar_nume).includes(s) ||
             norm(lucrareTxt(f)).includes(s) || norm(f.titlu_scurt).includes(s)
    }
    return true
  }), [facturi, filterSerie, filterStatus, filterAn, searchF, lucrareTxt])

  // Export Excel al facturilor selectate (14.07)
  const exportSelectate = () => {
    const rows = facturi.filter(f => selIds.includes(f.id))
    if (!rows.length) return
    const data = rows.map(f => ({
      'Factură': f.nr_complet, 'Data': f.data, 'Beneficiar': f.beneficiar_nume,
      'Lucrare / Contract': lucrareTxt(f),
      'Valoare netă (RON)': parseFloat(f.valoare_neta)||0, 'TVA (RON)': parseFloat(f.tva)||0,
      'Total (RON)': parseFloat(f.total)||0, 'Status': (STATUS_FACTURA[f.status]||{}).label || f.status,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{wch:12},{wch:11},{wch:32},{wch:46},{wch:16},{wch:14},{wch:16},{wch:14}]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Facturi')
    XLSX.writeFile(wb, `Facturi_selectate_${new Date().toISOString().slice(0,10)}.xlsx`)
    showToast(`${rows.length} facturi exportate`, 'ok')
  }
  const toggleSel = id => setSelIds(s => s.includes(id) ? s.filter(x=>x!==id) : [...s, id])
  const toateSelectate = facturiFiltrate.length > 0 && facturiFiltrate.every(f => selIds.includes(f.id))
  const toggleToate = () => setSelIds(toateSelectate ? [] : facturiFiltrate.map(f => f.id))

  const kpi = useMemo(() => {
    const f = facturiFiltrate
    return {
      total:    f.length,
      emise:    f.filter(x => x.status !== 'in_pregatire').length,
      incasat:  f.filter(x => x.status === 'incasata').reduce((s,x) => s+(parseFloat(x.total)||0),0),
      restant:  f.filter(x => x.status === 'restanta').reduce((s,x) => s+(parseFloat(x.total)||0),0),
      totalNeta: f.reduce((s,x) => s+(parseFloat(x.valoare_neta)||0),0),
      totalTva:  f.reduce((s,x) => s+(parseFloat(x.tva)||0),0),
      totalVal: f.reduce((s,x) => s+(parseFloat(x.total)||0),0),
    }
  }, [facturiFiltrate])

  const aniDisponibili = useMemo(() => {
    const s = new Set(facturi.map(f=>f.an).filter(Boolean))
    return [...s].sort((a,b)=>b-a)
  }, [facturi])

  const handleDelete = async (id) => {
    const { error } = await supabase.from('facturi_emise').delete().eq('id', id)
    if (error) showToast('Eroare: ' + error.message, 'err')
    else { showToast('Factură ștearsă', 'ok'); loadAll() }
    setDeleteConf(null)
  }

  const handleMarkStatus = async (id, newStatus) => {
    await supabase.from('facturi_emise').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id)
    showToast(`Status → ${STATUS_FACTURA[newStatus]?.label}`, 'ok')
    loadAll()
  }

  const handleOpenPDF = async (pdfPath) => {
    const { data } = await supabase.storage.from('facturi-emise').createSignedUrl(pdfPath, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  return (
    <div style={{background:G.bg, minHeight:'calc(100vh - 60px)', color:G.text}}>
      <Toast />

      {/* ── Navbar modul ── */}
      <div style={{background:G.surface, borderBottom:`1px solid ${G.border}`, padding:'0 28px', position:'sticky', top:60, zIndex:50}}>
        <div style={{display:'flex', alignItems:'center', gap:10, height:52}}>
          <div style={{width:30,height:30,background:`linear-gradient(135deg,${G.financiar},#2DD4BF)`,borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15}}>💰</div>
          <div style={{fontSize:14,fontWeight:700}}>Financiar</div>
          <div style={{marginLeft:10,display:'flex',gap:6}}>
            {[['emise','📤 Facturi emise'],['furnizori','🧾 Facturi furnizori'],['consumuri','📋 Consumuri']].map(([k,l]) => (
              <button key={k} onClick={()=>setTab(k)} style={{
                padding:'6px 14px',fontSize:12,fontWeight:700,cursor:'pointer',borderRadius:8,
                background: tab===k ? G.financiar+'22' : 'transparent',
                color: tab===k ? G.financiar : G.muted,
                border:`1px solid ${tab===k ? G.financiar+'66' : G.border}`,
              }}>{l}</button>
            ))}
          </div>
          {canWrite && (
            <button onClick={() => setCitesteOpen(true)}
              style={{marginLeft:'auto',display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',background:G.green+'18',color:G.green,border:`1px solid ${G.green}55`,borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer'}}
              title="Trage un certificat de plată — AI îl citește și îl atașează la situația de plată">
              📥 Citește Orice
            </button>
          )}
          {slAlert.length > 0 && (
            <div style={{marginLeft: canWrite ? 8 : 'auto',background:G.orange+'22',border:`1px solid ${G.orange}55`,borderRadius:20,padding:'4px 12px',fontSize:12,color:G.orange,fontWeight:700,display:'flex',alignItems:'center',gap:6}}>
              ⚡ {slAlert.length} SL fără factură
            </div>
          )}
        </div>
      </div>

      <div style={{padding:'24px 28px',maxWidth:1400,margin:'0 auto'}}>

        {tab === 'furnizori' && <FacturiFurnizoriTab />}

        {tab === 'consumuri' && <ConsumuriBonuriTab mode="financiar" />}

        {tab === 'emise' && (<>
        {/* ── ALERTĂ SL fără factură ── */}
        {slAlert.length > 0 && (
          <div style={{background:G.orange+'0E',border:`1px solid ${G.orange}44`,borderRadius:10,padding:'14px 18px',marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:G.orange,marginBottom:10}}>
              ⚡ {slAlert.length} situație{slAlert.length>1?'i':''} de plată neacoperite cu factură:
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
              {slAlert.map(sl => (
                <div key={sl.id} style={{background:G.card2,borderRadius:8,padding:'8px 12px',border:`1px solid ${G.border}`,display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:11,fontWeight:700,color:G.green}}>{sl.cod_intern}</span>
                  <span style={{fontSize:11,color:G.text}}>{sl.nr_situatie} · {LUNI[(sl.luna||1)-1]} {sl.an}</span>
                  {sl.valoare_baza_lei && <span style={{fontSize:11,color:G.green,fontFamily:'monospace'}}>{fmtLei(sl.valoare_baza_lei)}</span>}
                  {canWrite && (
                    <button onClick={()=>setEditItem({ _fromSL: sl })} style={{padding:'3px 10px',background:G.financiar+'22',border:`1px solid ${G.financiar}55`,borderRadius:6,color:G.financiar,fontSize:11,cursor:'pointer',fontWeight:700}}>
                      📄 Emite
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── HEADER + KPI ── */}
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:20,gap:16,flexWrap:'wrap'}}>
          <div>
            <h2 style={{margin:0,fontSize:22,fontWeight:800}}>🧾 Facturi Emise</h2>
            <div style={{color:G.muted,fontSize:13,marginTop:4}}>Generator factură · PDF · Email · NAS sync</div>
          </div>
          {canWrite && (
            <button onClick={()=>setEditItem({})} style={S.btnP}>＋ Factură nouă</button>
          )}
        </div>

        {/* KPI cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
          {[
            { label:'Total facturi', value:kpi.total, icon:'🧾', color:G.blue },
            { label:'Valoare emisă', value:fmtLei(kpi.totalVal), icon:'💶', color:G.financiar },
            { label:'Încasat', value:fmtLei(kpi.incasat), icon:'✅', color:G.teal },
            { label:'Restant', value:fmtLei(kpi.restant), icon:'⚠️', color:G.red },
          ].map((k,i) => (
            <div key={i} style={{background:G.surface,border:`1px solid ${G.border}`,borderRadius:10,padding:'16px 18px',display:'flex',gap:12,alignItems:'center'}}>
              <div style={{width:38,height:38,borderRadius:9,background:k.color+'22',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{k.icon}</div>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:k.color}}>{k.value}</div>
                <div style={{fontSize:11,color:G.muted,marginTop:2}}>{k.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filtre */}
        <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
          <select value={filterAn} onChange={e=>setFilterAn(e.target.value)} style={{...S.input,width:'auto',minWidth:90,padding:'7px 10px',fontSize:12}}>
            <option value="">Toți anii</option>
            {aniDisponibili.map(a=><option key={a} value={a}>{a}</option>)}
          </select>
          <select value={filterSerie} onChange={e=>setFilterSerie(e.target.value)} style={{...S.input,width:'auto',minWidth:90,padding:'7px 10px',fontSize:12}}>
            <option value="">Toate seriile</option>
            {SERII.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...S.input,width:'auto',minWidth:130,padding:'7px 10px',fontSize:12}}>
            <option value="">Toate statusurile</option>
            {Object.entries(STATUS_FACTURA).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <input placeholder="🔍 Caută nr / beneficiar / lucrare..." value={searchF} onChange={e=>setSearchF(e.target.value)}
            style={{...S.input,width:'auto',minWidth:240,padding:'7px 10px',fontSize:12,borderColor:searchF?G.financiar:G.border2}} />
          <span style={{fontSize:12,color:G.dim}}>{facturiFiltrate.length} facturi</span>
          {selIds.length > 0 && (
            <button onClick={exportSelectate} style={{marginLeft:'auto',padding:'7px 14px',background:G.teal+'22',border:`1px solid ${G.teal}55`,borderRadius:7,color:G.teal,fontSize:12,fontWeight:700,cursor:'pointer'}}>
              📊 Exportă selectate ({selIds.length})
            </button>
          )}
        </div>

        {/* Tabel facturi */}
        {loading ? (
          <div style={{textAlign:'center',padding:60,color:G.muted}}>⏳ Se încarcă...</div>
        ) : facturiFiltrate.length === 0 ? (
          <div style={{textAlign:'center',padding:60,color:G.muted,background:G.surface,borderRadius:10,border:`1px solid ${G.border}`}}>
            <div style={{fontSize:40,marginBottom:12,opacity:.4}}>🧾</div>
            <div style={{fontSize:14,fontWeight:600,marginBottom:8}}>Nicio factură</div>
            {canWrite && <button onClick={()=>setEditItem({})} style={{...S.btnP,marginTop:16}}>＋ Creează prima factură</button>}
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr style={{background:G.surface,borderBottom:`1px solid ${G.border}`}}>
                  <th style={{padding:'10px 8px',width:30}}>
                    <input type="checkbox" checked={toateSelectate} onChange={toggleToate} title="Selectează tot (pe filtrele curente)"
                      style={{width:15,height:15,accentColor:G.financiar,cursor:'pointer'}} />
                  </th>
                  {['Factură','Data','Beneficiar','Lucrare / Contract','Valoare netă','TVA','Total','Status','PDF','NAS',''].map((h,i)=>(
                    <th key={i} style={{padding:'10px 12px',textAlign:'left',fontWeight:600,color:G.muted,fontSize:11,textTransform:'uppercase',letterSpacing:'.3px',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {facturiFiltrate.map((f,idx) => {
                  const si = STATUS_FACTURA[f.status] || STATUS_FACTURA.in_pregatire
                  return (
                    <tr key={f.id} style={{borderBottom:`1px solid ${G.border2}`,background:idx%2===0?'transparent':G.bg+'88'}}
                      onMouseEnter={e=>e.currentTarget.style.background=G.surface}
                      onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?'transparent':G.bg+'88'}>
                      <td style={{padding:'10px 8px'}}>
                        <input type="checkbox" checked={selIds.includes(f.id)} onChange={()=>toggleSel(f.id)}
                          style={{width:15,height:15,accentColor:G.financiar,cursor:'pointer'}} />
                      </td>
                      <td style={{padding:'10px 12px',fontWeight:800,color:G.financiar,whiteSpace:'nowrap'}}>
                        <span style={{background:G.financiar+'22',padding:'2px 8px',borderRadius:6}}>{f.nr_complet}</span>
                      </td>
                      <td style={{padding:'10px 12px',color:G.muted,fontSize:12,whiteSpace:'nowrap'}}>{fmtDate(f.data)}</td>
                      <td style={{padding:'10px 12px',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={f.beneficiar_nume}>{f.beneficiar_nume}</td>
                      <td style={{padding:'10px 12px',maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:G.muted,fontSize:12}} title={lucrareTxt(f)}>
                        {lucrareTxt(f) || <span style={{color:G.dim}}>—</span>}
                      </td>
                      <td style={{padding:'10px 12px',textAlign:'right',fontFamily:'monospace',color:G.text}}>{fmtLei(f.valoare_neta)}</td>
                      <td style={{padding:'10px 12px',textAlign:'right',fontFamily:'monospace',color:G.yellow,fontSize:12}}>{fmtLei(f.tva)}</td>
                      <td style={{padding:'10px 12px',textAlign:'right',fontFamily:'monospace',fontWeight:700,color:G.green}}>{fmtLei(f.total)}</td>
                      <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                        <span style={{padding:'3px 10px',borderRadius:12,fontSize:11,fontWeight:600,background:si.bg,color:si.color}}>
                          {si.icon} {si.label}
                        </span>
                      </td>
                      <td style={{padding:'10px 12px'}}>
                        {f.pdf_path ? (
                          <button onClick={()=>handleOpenPDF(f.pdf_path)} style={{padding:'4px 8px',background:G.blue+'22',border:`1px solid ${G.blue}44`,borderRadius:6,color:G.blue,fontSize:11,cursor:'pointer',fontWeight:600}}>📄 PDF</button>
                        ) : (
                          <span style={{fontSize:11,color:G.dim}}>—</span>
                        )}
                      </td>
                      <td style={{padding:'10px 12px'}}>
                        {f.nas_synced
                          ? <span style={{fontSize:11,color:G.teal}}>✅ NAS</span>
                          : <span style={{fontSize:11,color:G.dim}}>⏳</span>}
                      </td>
                      <td style={{padding:'10px 12px'}}>
                        <div style={{display:'flex',gap:5}}>
                          <button onClick={()=>setEditItem(f)} style={{padding:'5px 9px',background:G.border2,border:'none',borderRadius:6,color:G.muted,cursor:'pointer',fontSize:12}}>✏️</button>
                          {f.status !== 'incasata' && (
                            <button onClick={()=>handleMarkStatus(f.id,'incasata')} title="Marchează Încasat" style={{padding:'5px 9px',background:G.teal+'22',border:`1px solid ${G.teal}44`,borderRadius:6,color:G.teal,cursor:'pointer',fontSize:12}}>💰</button>
                          )}
                          {isOwner && (
                            <button onClick={()=>setDeleteConf(f)} style={{padding:'5px 9px',background:G.red+'22',border:'none',borderRadius:6,color:G.red,cursor:'pointer',fontSize:12}}>🗑</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{borderTop:`2px solid ${G.border}`,background:G.surface}}>
                  <td colSpan={5} style={{padding:'10px 12px',fontWeight:700,color:G.muted,fontSize:12}}>TOTAL {filterAn ? `(${filterAn})` : '(toți anii)'}</td>
                  <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,fontFamily:'monospace',color:G.text}}>{fmtLei(kpi.totalNeta)}</td>
                  <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,fontFamily:'monospace',color:G.yellow}}>{fmtLei(kpi.totalTva)}</td>
                  <td style={{padding:'10px 12px',textAlign:'right',fontWeight:800,fontFamily:'monospace',color:G.financiar}}>{fmtLei(kpi.totalVal)}</td>
                  <td colSpan={4}/>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* NAS info */}
        <div style={{marginTop:16,padding:'10px 14px',background:G.card2,borderRadius:8,fontSize:11,color:G.dim,display:'flex',alignItems:'center',gap:8}}>
          <span>📁</span>
          <span>Sincronizare NAS: PDF-urile se salvează automat în Supabase Storage. Pentru sync pe <code>\\gazpet-tnas\Facturi_Emise\Facturi 2026</code>, schimbați volumul Docker la <code>:rw</code> și activați scriptul NAS sync.</span>
        </div>
        </>)}
      </div>

      {/* Modal factură */}
      {editItem !== null && (
        <FacturaModal
          item={editItem?._fromSL ? null : (editItem?.id ? editItem : null)}
          slDefault={editItem?._fromSL || null}
          proiectDefault={editItem?.proiect_id || null}
          beneficiariLista={beneficiari}
          profileId={profile?.id || null}
          onClose={() => setEditItem(null)}
          onSaved={() => { setEditItem(null); loadAll() }}
          showToast={showToast}
        />
      )}

      {/* Confirm delete */}
      {deleteConf && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',zIndex:1020,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:G.surface,border:`1px solid ${G.red}`,borderRadius:12,padding:28,maxWidth:360,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:12}}>🗑</div>
            <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>Ștergi <span style={{color:G.red}}>{deleteConf.nr_complet}</span>?</div>
            <div style={{color:G.muted,fontSize:13,marginBottom:20}}>{fmtLei(deleteConf.total)} · {deleteConf.beneficiar_nume}</div>
            <div style={{display:'flex',gap:10,justifyContent:'center'}}>
              <button onClick={()=>setDeleteConf(null)} style={S.btnS}>Anulează</button>
              <button onClick={()=>handleDelete(deleteConf.id)} style={{...S.btnP,background:G.red}}>Șterge</button>
            </div>
          </div>
        </div>
      )}

      {citesteOpen && profile && (
        <CitesteOricePanel
          open={citesteOpen}
          modul="financiar"
          profile={profile}
          onClose={() => setCitesteOpen(false)}
          onConfirmed={() => loadAll()}
        />
      )}
    </div>
  )
}
