// ===========================================================================
// PV predare-primire generat din avizul de însoțire (TKT-2026-0379)
// Partea PURĂ: citirea datelor (clientul Supabase vine din apelant) + HTML-ul PV.
// Randarea în PDF (html2canvas + jsPDF) stă în pvPredareAvizPdf.js.
// Nimic nu se scrie în BD sau în Storage: PDF-ul se descarcă doar local.
// ===========================================================================

// Coloanele tabelului de bunuri. Lățimile sunt PROCENTE din lățimea utilă A4 (738 px) și trebuie să dea 100.
export const COLOANE_PV = [
  { cheie: 'nr', titlu: 'Nr.', latime: 6, align: 'center' },
  { cheie: 'denumire', titlu: 'Denumire bun', latime: 34, align: 'left' },
  { cheie: 'identificare', titlu: 'Identificare (cod / inventar / serie)', latime: 28, align: 'left' },
  { cheie: 'cantitate', titlu: 'Cantitate', latime: 12, align: 'center' },
  { cheie: 'stare', titlu: 'Stare la predare', latime: 20, align: 'left' },
]

// Aceeași selecție de activ ca în AvizInsotireMarfaModal (Logistica.jsx).
const SELECT_ACTIV = 'id, cod_intern, nr_inventar, marca, model, nr_inmatriculare, serie_sasiu'
export const SELECT_TRANSPORT_PV = `id, numar_transport, tip, continut_multiplu, continut_descriere, activ_transportat:logistica_active!activ_transportat_id(${SELECT_ACTIV})`
export const SELECT_CONTINUT_PV = `*, asset:logistica_active!active_id(${SELECT_ACTIV})`
export const CHEI_FIRMA = ['firma_nume', 'firma_cui', 'firma_reg_com', 'firma_adresa', 'firma_telefon', 'firma_email']

export function esc(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const areText = (v) => typeof v === 'string' && /\S/.test(v)
const txt = (v) => (v === null || v === undefined) ? '' : String(v).trim()

// 'AAAA-LL-ZZ' (sau timestamp care începe așa) → 'ZZ.LL.AAAA', fără new Date (fără decalaj de fus orar).
export function dataRo(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(v))
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

// Verifică coloanele: lățimi numere pozitive, suma exact 100. Altfel aruncă (nu generăm un tabel strâmb).
export function verificaColoane(coloane = COLOANE_PV) {
  if (!Array.isArray(coloane) || coloane.length === 0) throw new Error('PV: lista de coloane e goală')
  for (const c of coloane) {
    if (!Number.isFinite(c?.latime) || c.latime <= 0) throw new Error(`PV: lățime invalidă la coloana ${c?.cheie}`)
  }
  const suma = coloane.reduce((s, c) => s + c.latime, 0)
  if (suma !== 100) throw new Error(`PV: lățimile coloanelor dau ${suma}%, nu 100%`)
  return true
}

function identificareActiv(a) {
  if (!a) return []
  const r = []
  if (areText(a.nr_inventar)) r.push(`Nr. inventar: ${txt(a.nr_inventar)}`)
  if (areText(a.cod_intern)) r.push(`Cod intern: ${txt(a.cod_intern)}`)
  if (areText(a.nr_inmatriculare)) r.push(`Nr. înmatr.: ${txt(a.nr_inmatriculare)}`)
  if (areText(a.serie_sasiu)) r.push(`Serie: ${txt(a.serie_sasiu)}`)
  return r
}

function denumireActiv(a) {
  if (!a) return ''
  const mm = `${txt(a.marca)} ${txt(a.model)}`.trim()
  return mm || txt(a.cod_intern) || txt(a.nr_inmatriculare)
}

function cantitateText(cant, um, implicitUtilaj) {
  const n = (cant === null || cant === undefined || cant === '') ? NaN : Number(cant)
  if (Number.isFinite(n)) {
    const s = n.toLocaleString('ro-RO', { maximumFractionDigits: 6 })
    return areText(um) ? `${s} ${txt(um)}` : s
  }
  return implicitUtilaj ? '1 buc' : ''
}

// Liniile PV — aceeași regulă ca avizul: conținut multiplu cu rânduri → câte o linie pe rând;
// altfel utilajul de pe transport; altfel descrierea text a transportului; altfel nimic (PV-ul nu se generează).
export function liniiPvDinTransport(transport, continut) {
  const T = transport || {}
  if (T.continut_multiplu && Array.isArray(continut) && continut.length > 0) {
    return continut.map(it => {
      const utilaj = it.tip === 'utilaj'
      const a = utilaj ? it.asset : null
      return {
        denumire: (utilaj ? denumireActiv(a) : '') || txt(it.denumire) || '—',
        tipText: utilaj ? 'Utilaj' : 'Marfă',
        observatii: txt(it.observatii),
        identificare: identificareActiv(a),
        cantitate: cantitateText(it.cantitate, it.um || (utilaj ? 'buc' : ''), utilaj),
      }
    })
  }
  if (T.tip === 'utilaj' && T.activ_transportat) {
    const a = T.activ_transportat
    return [{ denumire: denumireActiv(a) || '—', tipText: 'Utilaj', observatii: '', identificare: identificareActiv(a), cantitate: '1 buc' }]
  }
  if (areText(T.continut_descriere)) {
    return [{ denumire: txt(T.continut_descriere), tipText: '', observatii: '', identificare: [], cantitate: '' }]
  }
  return []
}

// Citirea datelor pentru PV. Întoarce { ok:false, mesaj } la orice problemă (eroare ≠ gol, L18), niciodată un PV gol.
export async function incarcaDatePv(db, aviz) {
  if (!aviz?.transport_id) return { ok: false, mesaj: 'Avizul nu are un transport legat — PV-ul nu se poate genera.' }
  const { data: T, error: eT } = await db.from('logistica_transporturi').select(SELECT_TRANSPORT_PV).eq('id', aviz.transport_id).maybeSingle()
  if (eT) return { ok: false, mesaj: `Nu am putut citi transportul avizului: ${eT.message || eT}` }
  if (!T) return { ok: false, mesaj: `Transportul avizului${aviz.numar_aviz ? ' ' + aviz.numar_aviz : ''} nu se mai găsește (poate a fost șters) — PV-ul nu se poate genera.` }

  let continut = []
  if (T.continut_multiplu) {
    const { data, error, count } = await db.from('logistica_transporturi_continut').select(SELECT_CONTINUT_PV, { count: 'exact' })
      .eq('transport_id', T.id).order('ordine').order('id')
    if (error) return { ok: false, mesaj: `Nu am putut citi conținutul transportului: ${error.message || error}` }
    continut = data || []
    // L12/L23: nimic nu dispare tacit — dacă serverul a tăiat lista, nu generăm un PV incomplet.
    if (Number.isFinite(count) && count !== continut.length) {
      return { ok: false, mesaj: `Conținutul transportului are ${count} rânduri, dar s-au citit ${continut.length} — PV-ul nu se generează incomplet.` }
    }
  }

  const linii = liniiPvDinTransport(T, continut)
  if (linii.length === 0) return { ok: false, mesaj: 'Transportul nu are conținut înregistrat (bunuri / utilaj / descriere) — PV-ul nu se generează gol.' }

  const { data: setari, error: eS } = await db.from('logistica_setari').select('key, value').in('key', CHEI_FIRMA)
  if (eS) return { ok: false, mesaj: `Nu am putut citi datele firmei: ${eS.message || eS}` }
  const firma = Object.fromEntries((setari || []).map(s => [s.key, s.value]))

  return { ok: true, transport: T, linii, firma }
}

const GOL = '……………………………………'

// Stiluri fixate explicit pe th/td: regula globală de th/td din App.jsx (majuscule, gri, padding) nu are voie să le schimbe.
const ST_TH = 'background:#E5E7EB;color:#111827;font-family:Arial,sans-serif;font-size:11px;font-weight:700;text-transform:none;letter-spacing:normal;padding:6px 6px;border:1px solid #6B7280;vertical-align:middle'
const ST_TD = 'color:#111827;background:#FFFFFF;font-family:Arial,sans-serif;font-size:11px;font-weight:400;padding:6px 6px;border:1px solid #9CA3AF;vertical-align:top;line-height:1.35'

export function numeFisierPv(aviz) {
  const baza = txt(aviz?.numar_aviz).replace(/[^A-Za-z0-9._-]+/g, '_') || 'aviz'
  return `${baza}-PV.pdf`
}

// HTML-ul PV (rădăcina are exact 738 px = lățimea utilă A4 la marginile de 10 mm folosite la PDF).
export function construiesteHtmlPv({ aviz, linii, firma = {}, logo = '', dataPv }) {
  if (!Array.isArray(linii) || linii.length === 0) throw new Error('PV: nu există bunuri de trecut în proces-verbal')
  verificaColoane(COLOANE_PV)
  const A = aviz || {}
  const nrAviz = txt(A.numar_aviz)
  const nrPv = `${nrAviz}-PV`
  const dataDoc = dataRo(dataPv) || dataRo(A.data_transport) || GOL
  const dataTr = dataRo(A.data_transport) || GOL
  const predator = txt(A.manager_plecare_nume)
  const primitor = txt(A.manager_destinatie_nume)
  const numeFirma = txt(firma.firma_nume) || 'GAZPET INSTAL SRL'

  const colgroup = `<colgroup>${COLOANE_PV.map(c => `<col data-col="${c.cheie}" style="width:${c.latime}%">`).join('')}</colgroup>`
  const cap = `<tr>${COLOANE_PV.map(c => `<th style="${ST_TH};text-align:${c.align}">${esc(c.titlu)}</th>`).join('')}</tr>`
  const randuri = linii.map((l, i) => {
    const den = `<div style="font-weight:700">${esc(l.denumire)}</div>`
      + (l.tipText ? `<div style="font-size:9px;color:#6B7280;margin-top:2px">${esc(l.tipText)}</div>` : '')
      + (l.observatii ? `<div style="font-size:9px;color:#6B7280;margin-top:2px;font-style:italic">${esc(l.observatii)}</div>` : '')
    const ident = (l.identificare || []).length ? l.identificare.map(x => `<div>${esc(x)}</div>`).join('') : '—'
    return `<tr data-pv-linie="${i + 1}">`
      + `<td style="${ST_TD};text-align:center">${i + 1}</td>`
      + `<td style="${ST_TD};text-align:left">${den}</td>`
      + `<td style="${ST_TD};text-align:left;font-size:10px">${ident}</td>`
      + `<td style="${ST_TD};text-align:center">${esc(l.cantitate) || '—'}</td>`
      + `<td style="${ST_TD};text-align:left">&nbsp;</td>`
      + `</tr>`
  }).join('')

  const linieGoala = '<div style="border-bottom:1px dotted #6B7280;height:20px"></div>'
  const semnatura = (rol, rolDetaliu, nume) => `
      <div style="flex:1;border:1px solid #9CA3AF;border-radius:4px;padding:10px 12px;min-height:120px">
        <div style="font-size:11px;font-weight:700;color:#1E40AF;text-transform:uppercase">${esc(rol)}</div>
        <div style="font-size:9px;color:#6B7280;margin-bottom:8px">${esc(rolDetaliu)}</div>
        <div style="font-size:11px">Nume și prenume: <strong>${nume ? esc(nume) : GOL}</strong></div>
        <div style="font-size:11px;margin-top:8px">Data: ${GOL}</div>
        <div style="font-size:11px;margin-top:8px">Semnătura:</div>
        <div style="height:46px;border-bottom:1px solid #6B7280"></div>
      </div>`

  return `<div data-pv="${esc(nrPv)}" style="width:738px;box-sizing:border-box;padding:0;background:#FFFFFF;color:#111827;font-family:Arial,sans-serif;font-size:11px;line-height:1.4">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1E40AF;padding-bottom:10px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px">
        ${logo ? `<img src="${esc(logo)}" style="height:56px;width:auto" />` : ''}
        <div>
          <div style="font-size:16px;font-weight:700;color:#1E40AF">${esc(numeFirma)}</div>
          <div style="font-size:9px;color:#374151;margin-top:2px">CUI: ${esc(txt(firma.firma_cui) || '—')} · ${esc(txt(firma.firma_reg_com) || '—')}</div>
          <div style="font-size:9px;color:#374151">${esc(txt(firma.firma_adresa) || '—')}</div>
          <div style="font-size:9px;color:#374151">Tel: ${esc(txt(firma.firma_telefon) || '—')} · Email: ${esc(txt(firma.firma_email) || '—')}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:15px;font-weight:700;color:#1E40AF">PROCES-VERBAL</div>
        <div style="font-size:12px;font-weight:700;color:#374151">DE PREDARE-PRIMIRE</div>
        <div style="font-size:10px;color:#374151;margin-top:4px;font-weight:700">Nr. ${esc(nrPv)}</div>
        <div style="font-size:10px;color:#374151">din ${esc(dataDoc)}</div>
      </div>
    </div>

    <div data-pv-titlu style="text-align:center;font-size:14px;font-weight:700;margin:6px 0 12px">Proces-verbal de predare-primire nr. ${esc(nrPv)} din ${esc(dataDoc)}</div>

    <div style="font-size:11px;margin-bottom:12px;text-align:justify">
      Subsemnații <strong>${predator ? esc(predator) : GOL}</strong>, în calitate de predator,
      și <strong>${primitor ? esc(primitor) : GOL}</strong>, în calitate de primitor, am procedat la predarea, respectiv primirea
      bunurilor de mai jos, transportate cu avizul de însoțire a mărfii nr. <strong>${esc(nrAviz)}</strong> din ${esc(dataTr)}
      (transport ${esc(txt(A.numar_transport) || '—')}), de la <strong>${esc(txt(A.plecare_text) || '—')}</strong>
      la <strong>${esc(txt(A.destinatie_text) || '—')}</strong>${txt(A.sofer_nume) ? `, șofer ${esc(txt(A.sofer_nume))}` : ''}.
    </div>

    <table data-pv-tabel style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:14px">
      ${colgroup}
      <thead>${cap}</thead>
      <tbody>${randuri}</tbody>
    </table>

    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;margin-bottom:4px">Mențiuni (stare, lipsuri, observații):</div>
      ${linieGoala}${linieGoala}${linieGoala}
    </div>

    <div style="font-size:10px;color:#374151;margin-bottom:12px">Prezentul proces-verbal s-a încheiat în două exemplare, câte unul pentru fiecare parte.</div>

    <div style="display:flex;gap:16px">
      ${semnatura('Am predat', 'Predator (manager plecare)', predator)}
      ${semnatura('Am primit', 'Primitor (manager destinație)', primitor)}
    </div>
  </div>`
}
