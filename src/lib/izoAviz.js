// Avizul de ieșire pe tronson (design docs/izometrie/AVIZ_IESIRE_DESIGN.md): logică pură, fără React / rețea.
import { uuid } from './izoCoada.js'

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

// Căutare live: fiecare cuvânt trebuie să apară în serie / șarjă / DN / perete (ex. „247EK 8,8”, „DN 711”).
export function textBucata(b) {
  const pe = num(b.perete_mm)
  return norm([b.serie, b.uid, b.sarja, b.diametru_mm && `dn${b.diametru_mm}`, b.diametru_mm,
    pe !== null && `${pe}`, pe !== null && `${pe}`.replace('.', ','), pe !== null && `${pe}mm`].filter(Boolean).join(' '))
}
export function filtreazaBucati(bucati, q) {
  const cuvinte = norm(q).replace(/dn\s+/g, 'dn').split(/\s+/).filter(Boolean)
  if (!cuvinte.length) return bucati
  return bucati.filter(b => { const t = textBucata(b); return cuvinte.every(c => t.includes(c)) })
}

export function totaluri(bucati, ids) {
  const set = new Set(ids.map(String))
  let n = 0, mm = 0, kg = 0, kgLipsa = 0
  for (const b of bucati) {
    if (!set.has(String(b.id))) continue
    n++; mm += num(b.lungime_mm) || 0
    const k = num(b.greutate_kg); if (k === null) kgLipsa++; else kg += k
  }
  return { n, m: Math.round(mm) / 1000, kg: Math.round(kg * 100) / 100, kgLipsa }
}

export const fmtNr = (v, z = 2) => (num(v) === null ? '—' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits: z, maximumFractionDigits: z }))
export const normNrAuto = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim()

// Cererea RPC; cheia rămâne aceeași la reluarea explicită (ca la celelalte operații de birou).
export function cerereIesireAviz({ depozit, tronson, bucati, data, sofer, vehicul, destinatar }, id = uuid) {
  const ids = (bucati || []).map(Number)
  if (!depozit || !tronson) throw Error('Alege depozitul și tronsonul.')
  if (!ids.length || ids.length > 200 || new Set(ids).size !== ids.length || ids.some(x => !Number.isInteger(x) || x <= 0)) throw Error('Selectează între 1 și 200 de bucăți distincte.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data || '')) throw Error('Alege data avizului.')
  const extern = String(sofer?.extern || '').trim()
  if (sofer?.extern !== undefined && sofer?.extern !== null && extern.length < 3) throw Error('Scrie numele șoferului extern (minim 3 caractere).')
  if (!extern && !(Number(sofer?.employeeId) > 0)) throw Error('Alege șoferul sau bifează „șofer extern”.')
  const nrAuto = normNrAuto(vehicul?.nrAuto)
  if (!(Number(vehicul?.id) > 0) && (nrAuto.length < 3 || nrAuto.length > 20)) throw Error('Alege mașina sau scrie numărul de înmatriculare (3–20 caractere).')
  let dest = { tip: 'intern' }
  if (destinatar?.tip === 'extern') {
    const d = { denumire: String(destinatar.denumire || '').trim(), cui: String(destinatar.cui || '').trim(), adresa: String(destinatar.adresa || '').trim() }
    if (d.denumire.length < 3 || d.cui.length < 2 || d.adresa.length < 5) throw Error('Destinatar extern: completează denumirea, CUI-ul și adresa.')
    dest = { tip: 'extern', ...d }
  }
  return { nume: 'fn_izo_iesire_cu_aviz', args: {
    p_cheie: id(), p_depozit: Number(depozit), p_tronson: Number(tronson), p_bucati: ids, p_data: data,
    p_sofer_employee: extern ? null : Number(sofer.employeeId), p_sofer_extern: extern || null,
    p_sofer_confirmat: !extern && Boolean(sofer?.confirmat),
    p_vehicul: Number(vehicul?.id) > 0 ? Number(vehicul.id) : null, p_nr_auto: Number(vehicul?.id) > 0 ? null : nrAuto,
    p_destinatar: dest,
  } }
}

export const caleAviz = a => `${a.proiect_id}/${a.serie}-${a.numar}.pdf`
export const numeFisierAviz = a => `Aviz ${a.nr_complet || `${a.serie} ${a.numar}`}.pdf`

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const dataRo = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : esc(d) }
const pick = (o, ...k) => { for (const x of k) { const v = x.split('.').reduce((a, p) => a?.[p], o); if (v !== undefined && v !== null && v !== '') return v } return '' }

// HTML-ul avizului, DOAR din rândul avizului (antet + conținut instantaneu), nu din formular.
export function htmlAviz(a, { semnGestionar = null, semnSofer = null } = {}) {
  const an = a.antet || {}
  // Serverul copiază cheile din logistica_setari (firma_nume, firma_cui …); acceptăm și forma scurtă.
  const f0 = an.firma || {}
  const firma = { nume: f0.firma_nume || f0.nume, cui: f0.firma_cui || f0.cui, reg_com: f0.firma_reg_com || f0.reg_com, adresa: f0.firma_adresa || f0.adresa, telefon: f0.firma_telefon || f0.telefon, email: f0.firma_email || f0.email }
  const km = m => (num(m) === null ? '' : `${Math.floor(m / 1000)}+${String(Math.round(m % 1000)).padStart(3, '0')}`)
  const rows = Array.isArray(a.continut) ? a.continut : (a.continut?.randuri || [])
  const extern = (a.destinatar_tip || an.destinatar?.tip) === 'extern'
  const dest = extern
    ? { nume: pick(a, 'destinatar_denumire') || pick(an, 'destinatar.denumire'), cui: pick(a, 'destinatar_cui') || pick(an, 'destinatar.cui'), adresa: pick(a, 'destinatar_adresa') || pick(an, 'destinatar.adresa'), extra: '' }
    : { nume: firma.nume || 'GAZPET INSTAL SRL', cui: firma.cui, adresa: firma.adresa, extra: `Punct de lucru: ${esc(pick(an, 'proiect.nume', 'proiect.cod'))}` }
  const kmS = pick(an, 'tronson.km_start_m'), kmE = pick(an, 'tronson.km_end_m')
  const tronson = [pick(an, 'tronson.cod'), kmS !== '' && `km ${km(kmS)}–${km(kmE)}`].filter(Boolean).join(' · ')
  const sofer = a.sofer_extern_nume || pick(an, 'sofer_nume', 'sofer.nume')
  const denumire = r => r.tip_cod === 'curba'
    ? `Curbă DN ${esc(r.diametru_mm ?? '—')} × ${esc(fmtNr(r.perete_mm, 1))} mm${num(r.unghi_curba) !== null ? ` · ${esc(fmtNr(r.unghi_curba, 0))}°` : ''}`
    : `Țeavă oțel DN ${esc(r.diametru_mm ?? '—')} × ${esc(fmtNr(r.perete_mm, 1))} mm`
  const th = 'border:1px solid #333;padding:4px 5px;font-size:11px;background:#eee;text-align:left'
  const td = 'border:1px solid #333;padding:3px 5px;font-size:11px'
  const tdr = td + ';text-align:right'
  const linii = rows.map((r, i) => `<tr><td style="${tdr}">${i + 1}</td><td style="${td}">${denumire(r)}</td><td style="${td}">${esc(r.serie)}</td><td style="${td}">${esc(r.sarja)}</td><td style="${td}">buc / m / kg</td><td style="${tdr}">1</td><td style="${tdr}">${num(r.lungime_mm) === null ? '—' : fmtNr(num(r.lungime_mm) / 1000, 3)}</td><td style="${tdr}">${fmtNr(r.greutate_kg)}</td></tr>`).join('')
  const semn = (titlu, nume, img, nota) => `<td style="width:33%;vertical-align:top;border:1px solid #333;padding:6px;font-size:11px;height:110px"><b>${titlu}</b><br/>${esc(nume || '')}<br/>${img ? `<img src="${img}" style="max-height:60px;max-width:180px;margin-top:4px"/>` : `<div style="height:56px;border-bottom:1px dotted #555;margin-top:4px"></div><i style="font-size:10px">${nota || 'se semnează olograf'}</i>`}</td>`
  const anulat = a.stare === 'anulat' ? `<div style="border:3px solid #9C2121;color:#9C2121;font-weight:bold;padding:6px;margin:6px 0;font-size:14px">ANULAT · ${esc(a.anulat_motiv)} · ${esc(a.anulat_la ? String(a.anulat_la).slice(0, 16).replace('T', ' ') : '')}</div>` : ''
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#000;padding:28px 34px;width:726px;box-sizing:border-box">
<table style="width:100%;border-collapse:collapse"><tr>
<td style="width:55%;font-size:11px;vertical-align:top"><b style="font-size:13px">Expeditor: ${esc(firma.nume || 'GAZPET INSTAL SRL')}</b><br/>CUI: ${esc(firma.cui)} · Reg. Com.: ${esc(firma.reg_com)}<br/>${esc(firma.adresa)}<br/>${esc([firma.telefon, firma.email].filter(Boolean).join(' · '))}</td>
<td style="width:45%;text-align:right;vertical-align:top"><div style="font-size:16px;font-weight:bold">AVIZ DE ÎNSOȚIRE A MĂRFII</div><div style="font-size:14px;margin-top:4px">Seria <b>${esc(a.serie)}</b> nr. <b>${esc(String(a.numar ?? '').padStart(4, '0'))}</b></div><div style="font-size:12px">Data: <b>${dataRo(a.data_aviz)}</b></div></td></tr></table>
${anulat}
<table style="width:100%;border-collapse:collapse;margin-top:10px"><tr>
<td style="${td};width:50%;vertical-align:top"><b>Destinatar:</b> ${esc(dest.nume)}<br/>CUI: ${esc(dest.cui)}<br/>${esc(dest.adresa)}${dest.extra ? `<br/>${dest.extra}` : ''}</td>
<td style="${td};width:50%;vertical-align:top"><b>Loc de încărcare:</b> ${esc(pick(an, 'depozit.nume', 'depozit.name'))}<br/><b>Loc de destinație:</b> ${esc(tronson)}<br/>Proiect: ${esc(pick(an, 'proiect.nume'))} ${esc(pick(an, 'proiect.cod'))}</td></tr>
<tr><td colspan="2" style="${td}"><b>Motivul:</b> ${esc(a.motiv || pick(an, 'motiv'))}</td></tr></table>
<table style="width:100%;border-collapse:collapse;margin-top:10px"><colgroup><col style="width:5%"/><col style="width:25%"/><col style="width:15%"/><col style="width:15%"/><col style="width:10%"/><col style="width:6%"/><col style="width:12%"/><col style="width:12%"/></colgroup>
<tr><th style="${th}">Nr.</th><th style="${th}">Denumire</th><th style="${th}">Serie</th><th style="${th}">Șarjă</th><th style="${th}">UM</th><th style="${th}">Buc</th><th style="${th}">Lungime (m)</th><th style="${th}">Masă (kg)</th></tr>
${linii}
<tr><td colspan="5" style="${td};text-align:right"><b>TOTAL</b></td><td style="${tdr}"><b>${esc(a.total_bucati ?? rows.length)}</b></td><td style="${tdr}"><b>${fmtNr(a.total_m, 3)}</b></td><td style="${tdr}"><b>${fmtNr(a.total_kg)}</b></td></tr></table>
<table style="width:100%;border-collapse:collapse;margin-top:10px"><tr><td style="${td}"><b>Mijloc de transport:</b> ${esc(a.nr_auto || pick(an, 'vehicul.nr_auto'))}</td><td style="${td}"><b>Delegat / șofer:</b> ${esc(sofer)}${a.sofer_extern_nume ? ' (extern)' : ''} · act identitate ____________</td></tr></table>
<table style="width:100%;border-collapse:collapse;margin-top:12px"><tr>
${semn('Predător (gestionar)', pick(an, 'emitent_nume', 'emitent.nume'), semnGestionar)}
${semn('Șofer / delegat', sofer, semnSofer)}
${semn('Primitor', '', null, 'nume, semnătură, data')}
</tr></table>
<div style="font-size:9px;color:#555;margin-top:8px">Generat din ERP Gazpet · ${esc(a.nr_complet || '')} · emis ${esc(a.emis_la ? String(a.emis_la).slice(0, 16).replace('T', ' ') : '')}</div>
</div>`
}
