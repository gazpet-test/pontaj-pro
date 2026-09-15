// ════════════════════════════════════════════════════════════════
// OfertareOrganigrama.jsx — „🏗 Organigramă": generatorul de organigramă per licitație (#80, Oana Nica)
//
// De ce există: la Greci s-a pierdut pe organigramă, nu pe preț. Lecția, punct cu punct:
//  (1) RTE-iștii, CQ, SSM, topograful stau pe ACEEAȘI LINIE cu șeful de șantier, relație BIUNIVOCĂ (săgeți duble);
//  (2) șefii de lucrări și echipele NU sunt independenți: stau sub maiștri;
//  (3) șeful de șantier coordonează și asociatul și subcontractantul, cu formațiile lor în diagramă;
//  (4) linii explicite cu asociat / subcontractant / beneficiar;
//  (5) muncitori per operator pe categorii: calificați / necalificați / tehnic / auxiliar / total;
//  (6) totalul coincide cu histograma din Gantt;
//  (7) CV + declarație de disponibilitate semnate;
//  (8) RTE pe toate domeniile ISC din obiect;
//  (9) tabel nominal: nume, rol, activități, operatorul de care aparține.
//
// Fluxul: spec (edge fn `ofertare-organigrama-spec`, citește documentația → `ofertare_organigrama.spec`)
//   → „Propune echipa" (noduri din ofertare_acoperire + participanți) → editor inline → verificări → SVG → PDF/PNG.
// Tabelul `ofertare_organigrama` (licitatie_id UNIQUE): spec, spec_la, spec_model, spec_citate, noduri, verificari,
//   generat_la, updated_by. Aici se scriu DOAR noduri / verificari / generat_la / updated_by — spec-ul e al funcției.
//
// Gantt: modulul de grafic (grafic_activitati / grafic_parametri) n-are histogramă de personal — `resurse` e text
// liber, `parametri.echipe` e doar numărul de echipe. De aceea totalul din Gantt e câmp manual (noduri.muncitori_gantt),
// cu numărul de echipe afișat ca indiciu.
// ════════════════════════════════════════════════════════════════
import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from './lib/supabase.js'
import { poatePorniProcesarea, MOTIV_POARTA } from './OfertareTriere.jsx'
import { normalizeazaDomeniiISC, acoperaDomeniul } from './iscRte.js'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

const G = { bg:'#0D1117', surface:'#161B22', card:'#1C2128', border:'#30363D', border2:'#21262D',
  text:'#E6EDF3', muted:'#8B949E', dim:'#6E7681',
  ofertare:'#3FB6E2', green:'#3FB950', blue:'#58A6FF', orange:'#F0883E',
  yellow:'#E3B341', red:'#F85149', purple:'#A371F7', teal:'#2DD4BF' }
const S = {
  input: { width:'100%', boxSizing:'border-box', background:G.bg, border:`1px solid ${G.border2}`, borderRadius:6, padding:'6px 8px', color:G.text, fontSize:12, outline:'none' },
  lbl: { display:'block', fontSize:11, color:G.muted, marginBottom:4, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' },
  btnP: { padding:'9px 18px', background:G.ofertare, color:'#0D1117', border:'none', borderRadius:7, cursor:'pointer', fontSize:13, fontWeight:700 },
  btn: { padding:'6px 12px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:6, cursor:'pointer', fontSize:12 },
  btnS: { padding:'9px 18px', background:G.surface, color:G.text, border:`1px solid ${G.border2}`, borderRadius:7, cursor:'pointer', fontSize:13 },
  card: { background:G.card, border:`1px solid ${G.border}`, borderRadius:10 },
  th: { textAlign:'left', fontSize:11, color:G.muted, fontWeight:600, padding:'4px 6px', borderBottom:`1px solid ${G.border}` },
  td: { padding:'3px 4px', verticalAlign:'middle' },
}

const DE_NOMINALIZAT = '— de nominalizat —'
const LIDER = 'GAZPET INSTAL SRL'
const ADMINISTRATOR = 'Trusu Razvan Mihail'
const CATEGORII = ['conducere', 'specialist', 'executie', 'suport']
const LINII = ['subordonare', 'biunivoc']
const TIPURI_OPERATOR = ['lider', 'asociat', 'subcontractant', 'proiectant']
const SUPORT_IMPLICIT = ['Planificare / Raportare', 'Aprovizionare', 'Contracte']

const fara = s => String(s || '').toLowerCase().replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
const uid = () => Math.random().toString(36).slice(2, 10)
const azi = () => new Date().toISOString().slice(0, 10)
const n0 = v => Number(v) || 0
const eNominalizat = p => !!p?.nume && p.nume !== DE_NOMINALIZAT
const eManagerProiect = rol => /manager (de )?proiect|director (de )?proiect|manager (de )?contract/.test(fara(rol))
const eSefSantier = rol => /sef (de )?santier/.test(fara(rol))
const eMaistru = rol => /maistru/.test(fara(rol))
const eSefLucrari = rol => /sef(i)? (de )?lucr/.test(fara(rol))
const eRTE = rol => /^rte\b|responsabil tehnic cu exec/.test(fara(rol))
const totalFormatie = f => n0(f.calificati) + n0(f.necalificati) + n0(f.tehnic) + n0(f.auxiliar)
const domeniiPersoana = p => String(p.domeniu_isc || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean)

// ─────────────────────────────────────────────────────────────────
// Rolul dedus din tipul autorizației (hr_autorizatii_tipuri.cod / denumire) + domeniile ISC normalizate.
// ─────────────────────────────────────────────────────────────────
export function rolDinAutorizatie(cod = '', denumire = '', domenii = null) {
  const c = String(cod || '').toUpperCase(), d = fara(denumire)
  if (c.startsWith('RTE') || d.includes('responsabil tehnic cu exec')) {
    const { coduri } = normalizeazaDomeniiISC(domenii)
    return { rol: `RTE ${coduri.length ? coduri.join(', ') : ''}`.trim(), categorie: 'specialist', domeniu_isc: coduri.join(', ') }
  }
  if (c === 'MANAGER_SMC' || c === 'AUDITOR_INTERN' || d.includes('calitat')) return { rol: 'Manager QA/QC', categorie: 'specialist', domeniu_isc: '' }
  if (/SSM|PSI|MEDIU/.test(c) || /ssm|psi|securitate.*munca|mediu/.test(d)) return { rol: 'Responsabil SSM/PSI/Mediu', categorie: 'specialist', domeniu_isc: '' }
  if (/TOPOGRAF/.test(c) || d.includes('topograf')) return { rol: 'Topograf', categorie: 'specialist', domeniu_isc: '' }
  if (c.startsWith('MANAGER_PROIECT') || d.includes('manager proiect')) return { rol: 'Manager de proiect', categorie: 'conducere', domeniu_isc: '' }
  if (c === 'RTS' || d.includes('responsabil tehnic cu sudura')) return { rol: 'Responsabil tehnic cu sudura (RTS)', categorie: 'specialist', domeniu_isc: '' }
  if (c === 'DIRIGINTE_SANTIER') return { rol: 'Diriginte de șantier', categorie: 'specialist', domeniu_isc: '' }
  return null  // sudori, excavatoriști etc. — nu-s noduri în organigramă, intră la formații ca numere
}

const rolDinCerinta = (r = {}) => {
  const t = fara(r.rol)
  if (/rte|responsabil tehnic/.test(t)) return { rol: `RTE ${r.domeniu_isc || ''}`.trim(), categorie: 'specialist' }
  if (/calit|cq|qa/.test(t)) return { rol: 'Manager QA/QC', categorie: 'specialist' }
  if (/ssm|psi|securit|mediu/.test(t)) return { rol: 'Responsabil SSM/PSI/Mediu', categorie: 'specialist' }
  if (/topo/.test(t)) return { rol: 'Topograf', categorie: 'specialist' }
  if (eManagerProiect(t)) return { rol: 'Manager de proiect', categorie: 'conducere' }
  if (eSefSantier(t)) return { rol: 'Șef de șantier', categorie: 'conducere' }
  return { rol: r.rol || '?', categorie: CATEGORII.includes(r.categorie) ? r.categorie : 'specialist' }
}
// Același rol scris în două feluri („RTE 8.4D" vs „Responsabil tehnic cu execuția 8.4 D") = același rol.
const acelasiRol = (a, b) => {
  const A = rolDinCerinta({ rol: a }), B = rolDinCerinta({ rol: b })
  if (eRTE(A.rol) && eRTE(B.rol)) return true
  return fara(A.rol).replace(/[^a-z0-9]/g, '') === fara(B.rol).replace(/[^a-z0-9]/g, '')
}

const formatieNoua = (nume, operator_id, tip = 'instalatii') => tip === 'instalatii'
  ? { id: uid(), nume, operator_id, maistru_id: null, calificati: 2, necalificati: 2, tehnic: 0, auxiliar: 2, detalii: '1 sudor PE, 1 sudor OL, 2 necalificați, 2 mașiniști' }
  : { id: uid(), nume, operator_id, maistru_id: null, calificati: 2, necalificati: 3, tehnic: 0, auxiliar: 1, detalii: '2 zidari/fierari, 3 necalificați, 1 mașinist' }

// ─────────────────────────────────────────────────────────────────
// „Propune echipa din platformă": noduri din participanți + acoperire + spec.
// ─────────────────────────────────────────────────────────────────
export function construiesteNoduri({ licitatie, participanti = [], acoperiri = [], spec = null, existente = null }) {
  const lider = { id: 'op_lider', tip: 'lider', nume: LIDER, partener_id: null }
  const operatori = [lider]
  for (const p of participanti) {
    const tip = p.rol === 'asociat' ? 'asociat' : p.rol === 'subcontractant' ? 'subcontractant' : p.rol === 'proiectant' ? 'proiectant' : null
    if (!tip) continue  // terț susținător / furnizor nu-s operatori în organigramă
    const nume = p.partener?.nume || p.nume || '?'
    if (operatori.some(o => o.nume === nume && o.tip === tip)) continue
    operatori.push({ id: 'op_' + uid(), tip, nume, partener_id: p.partener_id || null })
  }
  const opDupaPartener = pid => pid ? operatori.find(o => o.partener_id && String(o.partener_id) === String(pid))?.id : null

  const persoane = []
  const vazut = new Set()
  for (const a of acoperiri) {
    const aut = a.autorizatie
    if (!aut || !['acoperit', 'acoperit_partener'].includes(a.status)) continue
    const rd = rolDinAutorizatie(aut.tip?.cod, aut.tip?.denumire, aut.domenii)
    if (!rd) continue
    if (a.domeniu_rte && eRTE(rd.rol)) rd.domeniu_isc = rd.domeniu_isc || String(a.domeniu_rte)
    const nume = aut.emp?.name || aut.ext?.nume || DE_NOMINALIZAT
    const cheie = `${nume}|${rd.rol}`
    if (vazut.has(cheie)) continue
    vazut.add(cheie)
    persoane.push({ id: uid(), nume, rol: rd.rol, categorie: rd.categorie, domeniu_isc: rd.domeniu_isc,
      operator_id: opDupaPartener(a.partener_id || aut.ext?.partener_id) || lider.id,
      employee_id: aut.employee_id || null, extern_id: aut.extern_id || null, autorizatie_id: aut.id,
      raporteaza_la: null, linie: rd.categorie === 'specialist' ? 'biunivoc' : 'subordonare', faza: '' })
  }
  // Rolurile de bază, chiar dacă spec-ul lipsește: fără ele diagrama n-are schelet.
  const roluriBaza = [{ rol: 'Manager de proiect', categorie: 'conducere' }, { rol: 'Șef de șantier', categorie: 'conducere' }]
  const cerute = [...roluriBaza, ...(spec?.roluri_cerute || [])]
  for (const r of cerute) {
    const rd = rolDinCerinta(r)
    if (persoane.some(p => acelasiRol(p.rol, rd.rol) && (!eRTE(rd.rol) || !r.domeniu_isc || domeniiPersoana(p).some(c => acoperaDomeniul(r.domeniu_isc, [c]))))) continue
    if (rd.categorie === 'executie' && !eMaistru(rd.rol) && !eSefLucrari(rd.rol)) continue  // muncitorii intră la formații
    persoane.push({ id: uid(), nume: DE_NOMINALIZAT, rol: rd.rol, categorie: rd.categorie, domeniu_isc: r.domeniu_isc || '',
      operator_id: lider.id, employee_id: null, extern_id: null, autorizatie_id: null, raporteaza_la: null,
      linie: rd.categorie === 'specialist' ? 'biunivoc' : 'subordonare', faza: r.faza || '' })
  }
  // RTE pe fiecare domeniu ISC din obiect (lecția 8)
  for (const cod of spec?.domenii_isc_din_obiect || []) {
    if (persoane.some(p => eRTE(p.rol) && acoperaDomeniul(cod, domeniiPersoana(p)))) continue
    persoane.push({ id: uid(), nume: DE_NOMINALIZAT, rol: `RTE ${cod}`, categorie: 'specialist', domeniu_isc: cod, operator_id: lider.id,
      employee_id: null, extern_id: null, autorizatie_id: null, raporteaza_la: null, linie: 'biunivoc', faza: '' })
  }
  // Un maistru per operator de execuție (lecția 2: echipele stau sub maiștri)
  for (const o of operatori) if (o.tip !== 'proiectant' && !persoane.some(p => eMaistru(p.rol) && p.operator_id === o.id))
    persoane.push({ id: uid(), nume: DE_NOMINALIZAT, rol: 'Maistru', categorie: 'executie', domeniu_isc: '', operator_id: o.id,
      employee_id: null, extern_id: null, autorizatie_id: null, raporteaza_la: null, linie: 'subordonare', faza: '' })

  const formatii = [
    ...[1, 2, 3].map(i => formatieNoua(`Formație instalații ${i}`, lider.id, 'instalatii')),
    ...[1, 2].map(i => formatieNoua(`Formație construcții ${i}`, lider.id, 'constructii')),
  ]
  for (const o of operatori) if (o.tip === 'asociat' || o.tip === 'subcontractant')
    formatii.push({ ...formatieNoua(`Formație ${o.nume}`, o.id, 'instalatii'), calificati: 0, necalificati: 0, auxiliar: 0, detalii: '' })
  const suport = SUPORT_IMPLICIT.map(rol => ({ id: uid(), nume: '', rol, operator_id: lider.id }))
  return {
    beneficiar: { nume: existente?.beneficiar?.nume || licitatie?.autoritate || '' },
    operatori, persoane, formatii, suport,
    muncitori_gantt: existente?.muncitori_gantt ?? null,
    observatii: existente?.observatii || '',
  }
}

// ─────────────────────────────────────────────────────────────────
// Totaluri per operator (formații) + verificările Greci.
// ─────────────────────────────────────────────────────────────────
export function totaluriOperatori(noduri) {
  const out = {}
  for (const o of noduri.operatori || []) {
    const fs = (noduri.formatii || []).filter(f => f.operator_id === o.id)
    const t = { calificati: 0, necalificati: 0, tehnic: 0, auxiliar: 0, total: 0, formatii: fs.length }
    for (const f of fs) { t.calificati += n0(f.calificati); t.necalificati += n0(f.necalificati); t.tehnic += n0(f.tehnic); t.auxiliar += n0(f.auxiliar) }
    t.total = t.calificati + t.necalificati + t.tehnic + t.auxiliar
    out[o.id] = t
  }
  return out
}
const totalGeneral = noduri => Object.values(totaluriOperatori(noduri)).reduce((s, t) => s + t.total, 0)

export function verificaOrganigrama({ noduri, spec, docs = null }) {
  const out = []
  const P = noduri?.persoane || []
  const nominalizate = P.filter(eNominalizat)
  // (a) RTE pe toate domeniile
  const codRte = new Set([...(spec?.domenii_isc_din_obiect || []), ...(spec?.roluri_cerute || []).filter(r => r.domeniu_isc).map(r => r.domeniu_isc)]
    .map(c => String(c).toUpperCase().replace(/\s/g, '')).filter(Boolean))
  for (const cod of codRte) {
    const ok = nominalizate.some(p => eRTE(p.rol) && acoperaDomeniul(cod, domeniiPersoana(p)))
    out.push({ cod: 'rte_' + cod, nivel: ok ? 'ok' : 'rosu', text: ok ? `RTE ${cod}: nominalizat` : `RTE ${cod}: lipsește (lecția Greci — RTE pe toate domeniile din obiect)` })
  }
  if (!codRte.size) out.push({ cod: 'rte_fara_spec', nivel: 'info', text: 'Spec-ul nu are domenii ISC în obiect — nu se poate verifica acoperirea RTE. Citește cerințele mai întâi.' })
  // (b) roluri obligatorii din spec
  for (const r of (spec?.roluri_cerute || []).filter(r => r.obligatoriu)) {
    const rd = rolDinCerinta(r)
    if (rd.categorie === 'executie' && !eMaistru(rd.rol) && !eSefLucrari(rd.rol)) continue
    const ok = nominalizate.some(p => acelasiRol(p.rol, rd.rol) && (!eRTE(rd.rol) || !r.domeniu_isc || acoperaDomeniul(r.domeniu_isc, domeniiPersoana(p))))
    out.push({ cod: 'rol_' + fara(r.rol), nivel: ok ? 'ok' : 'rosu', text: ok ? `${r.rol}: nominalizat` : `Rol obligatoriu fără persoană: ${r.rol}${r.domeniu_isc ? ' (' + r.domeniu_isc + ')' : ''}` })
  }
  for (const rol of ['Manager de proiect', 'Șef de șantier']) if (!nominalizate.some(p => acelasiRol(p.rol, rol)))
    out.push({ cod: 'baza_' + fara(rol), nivel: 'rosu', text: `${rol}: nenominalizat — diagrama n-are schelet fără el` })
  // (c) cumul
  const cheie = p => p.employee_id ? 'e' + p.employee_id : p.extern_id ? 'x' + p.extern_id : 'n' + fara(p.nume).replace(/\s+/g, ' ')
  const peOm = new Map()
  for (const p of nominalizate.filter(p => ['conducere', 'specialist'].includes(p.categorie))) { const k = cheie(p); if (!peOm.has(k)) peOm.set(k, []); peOm.get(k).push(p) }
  for (const [, ps] of peOm) if (ps.length > 1) out.push({ cod: 'cumul_' + cheie(ps[0]), nivel: 'portocaliu', text: `Cumul: ${ps[0].nume} are ${ps.length} roluri (${ps.map(p => p.rol).join(', ')}) — verifică dacă fișa interzice cumulul` })
  // (d) formații per operator
  const T = totaluriOperatori(noduri)
  for (const o of noduri?.operatori || []) {
    if (o.tip === 'proiectant') continue
    const t = T[o.id]
    if (!t.formatii) out.push({ cod: 'form_' + o.id, nivel: 'portocaliu', text: `${o.nume}: nicio formație (lecția 3 — asociatul/subcontractantul apar cu formațiile lor)` })
    else if (!t.total) out.push({ cod: 'form_' + o.id, nivel: 'portocaliu', text: `${o.nume}: formații fără numere completate` })
    else out.push({ cod: 'form_' + o.id, nivel: 'ok', text: `${o.nume}: ${t.formatii} formații, ${t.total} muncitori` })
    if (!P.some(p => eMaistru(p.rol) && p.operator_id === o.id && eNominalizat(p))) out.push({ cod: 'maistru_' + o.id, nivel: 'portocaliu', text: `${o.nume}: fără maistru nominalizat (echipele stau sub maiștri, nu independente)` })
  }
  // (e) total vs Gantt
  const tot = totalGeneral(noduri)
  if (noduri?.muncitori_gantt == null || noduri.muncitori_gantt === '') out.push({ cod: 'gantt', nivel: 'portocaliu', text: `Total organigramă ${tot} — nu e completat maximul din histograma Gantt (nu se poate compara)` })
  else if (n0(noduri.muncitori_gantt) !== tot) out.push({ cod: 'gantt', nivel: 'rosu', text: `Total organigramă ${tot} ≠ maxim Gantt ${noduri.muncitori_gantt} (lecția 6 — trebuie să coincidă)` })
  else out.push({ cod: 'gantt', nivel: 'ok', text: `Total organigramă ${tot} = maxim Gantt` })
  // (f) CV + declarație de disponibilitate
  if (docs) for (const p of nominalizate.filter(p => p.employee_id)) {
    const d = docs[p.employee_id] || { cv: false, disponibilitate: false }
    const lipsa = [!d.cv && 'CV', !d.disponibilitate && 'declarație disponibilitate'].filter(Boolean)
    if (lipsa.length) out.push({ cod: 'doc_' + p.id, nivel: 'portocaliu', text: `${p.nume} (${p.rol}): lipsește ${lipsa.join(' + ')} în dosarul HR` })
  }
  for (const p of nominalizate.filter(p => !p.employee_id && ['conducere', 'specialist'].includes(p.categorie)))
    out.push({ cod: 'docx_' + p.id, nivel: 'info', text: `${p.nume} (${p.rol}): extern — CV + declarația se cer de la ${p.extern_id ? 'partener' : 'persoană'}` })
  return out
}

// ─────────────────────────────────────────────────────────────────
// LAYOUT + SVG (pur, din noduri). Fundal alb, Arial, culori sobre — merge în PDF la autoritate.
// ─────────────────────────────────────────────────────────────────
const C = { text:'#111', muted:'#555', line:'#333', box:'#fff', lider:'#EAF2FB', asociat:'#FFF4E5', sub:'#F1F8E9', proiectant:'#F3E5F5', benef:'#F5F5F5', head:'#1F3A5F', spec:'#FFFFFF', form:'#FAFAFA' }
const BW = 150, BH = 46, COL_W = 190, GAP = 18

function calcLayout(noduri) {
  const P = noduri.persoane || [], O = noduri.operatori || [], F = noduri.formatii || [], SU = noduri.suport || []
  const mp = P.find(p => eManagerProiect(p.rol)) || { nume: DE_NOMINALIZAT, rol: 'Manager de proiect' }
  const ss = P.find(p => eSefSantier(p.rol)) || { nume: DE_NOMINALIZAT, rol: 'Șef de șantier' }
  const specialisti = P.filter(p => p !== mp && p !== ss && ['conducere', 'specialist'].includes(p.categorie) && !eMaistru(p.rol) && !eSefLucrari(p.rol))
  const stanga = specialisti.filter((_, i) => i % 2 === 0), dreapta = specialisti.filter((_, i) => i % 2 === 1)
  const nivel2 = [...stanga.reverse(), ss, ...dreapta]
  const lat2 = nivel2.length * (BW + GAP)
  const lat3 = O.length * (COL_W + GAP)
  const latSuport = SU.length ? 170 : 0
  const W = Math.max(900, lat2 + 40, lat3 + 40, 460 + latSuport * 2 + 40)
  const cx = W / 2
  const boxes = [], edges = []
  const box = (o) => { boxes.push(o); return o }
  // nivel 0 — beneficiar
  const yB = 20
  const bBen = box({ x: cx - 110, y: yB, w: 220, h: BH, t: noduri.beneficiar?.nume || 'Beneficiar', s: 'BENEFICIAR / AUTORITATE CONTRACTANTĂ', fill: C.benef, dash: true })
  // nivel 1 — manager proiect + suport
  const y1 = yB + BH + 50
  const bMp = box({ x: cx - BW / 2, y: y1, w: BW, h: BH, t: mp.nume, s: mp.rol, fill: C.lider, bold: true })
  edges.push({ x1: cx, y1: yB + BH, x2: cx, y2: y1, dash: true, dublu: true })
  SU.forEach((s, i) => {
    const bx = cx + BW / 2 + 60, by = y1 - 30 + i * 30
    box({ x: bx, y: by, w: 160, h: 24, t: (s.rol || '') + (s.nume ? ' · ' + s.nume : ''), s: '', fill: C.form, mic: true })
    edges.push({ x1: cx + BW / 2, y1: y1 + BH / 2, x2: bx, y2: by + 12, dash: true })
  })
  // nivel 2 — linia șefului de șantier
  const y2 = y1 + BH + 70
  const x0 = cx - lat2 / 2 + GAP / 2
  const b2 = nivel2.map((p, i) => box({ x: x0 + i * (BW + GAP), y: y2, w: BW, h: BH, t: p.nume, s: p.rol, fill: p === ss ? C.lider : C.spec, bold: p === ss, p }))
  const bSs = b2[nivel2.indexOf(ss)]
  const cxSs = bSs.x + BW / 2
  edges.push({ x1: cx, y1: y1 + BH, x2: cx, y2: y2 - 30 }, { x1: cx, y1: y2 - 30, x2: cxSs, y2: y2 - 30 }, { x1: cxSs, y1: y2 - 30, x2: cxSs, y2: y2, sageata: true })
  // biunivoc: fiecare specialist ↔ șef șantier printr-o magistrală sub cutii, cu săgeți la ambele capete
  const yBus = y2 + BH + 16
  b2.forEach(b => {
    if (b === bSs) return
    const x = b.x + BW / 2
    edges.push({ x1: x, y1: y2 + BH, x2: x, y2: yBus, dublu: true, sus: true })
  })
  if (b2.length > 1) {
    const xs = b2.map(b => b.x + BW / 2)
    edges.push({ x1: Math.min(...xs), y1: yBus, x2: Math.max(...xs), y2: yBus, dublu: true, fara_sageata: true })
    edges.push({ x1: cxSs, y1: y2 + BH, x2: cxSs, y2: yBus, dublu: true, sus: true })
  }
  // nivel 3 — coloane per operator
  const y3 = yBus + 50
  const x3 = cx - lat3 / 2 + GAP / 2
  const T = totaluriOperatori(noduri)
  let maxY = y3
  const bLider = { x: null }
  O.forEach((o, i) => {
    const x = x3 + i * (COL_W + GAP), xc = x + COL_W / 2
    const fill = o.tip === 'lider' ? C.lider : o.tip === 'asociat' ? C.asociat : o.tip === 'subcontractant' ? C.sub : C.proiectant
    const eticheta = o.tip === 'lider' ? 'LIDER DE ASOCIERE' : o.tip.toUpperCase()
    box({ x, y: y3, w: COL_W, h: BH, t: o.nume, s: eticheta, fill, bold: true })
    if (o.tip === 'lider') bLider.x = xc
    // șef șantier → operator (coordonare); + linie punctată lider ↔ asociat/subcontractant (contract)
    edges.push({ x1: cxSs, y1: yBus, x2: cxSs, y2: y3 - 22 }, { x1: cxSs, y1: y3 - 22, x2: xc, y2: y3 - 22 }, { x1: xc, y1: y3 - 22, x2: xc, y2: y3, sageata: true, dash: o.tip === 'proiectant' })
    let y = y3 + BH + 26
    const maistri = P.filter(p => eMaistru(p.rol) && p.operator_id === o.id)
    const sefi = P.filter(p => eSefLucrari(p.rol) && p.operator_id === o.id)
    const altii = P.filter(p => p.operator_id === o.id && p.categorie === 'executie' && !eMaistru(p.rol) && !eSefLucrari(p.rol))
    const lant = [...maistri, ...sefi, ...altii]
    let yPrev = y3 + BH
    for (const p of lant) {
      box({ x: x + 20, y, w: COL_W - 40, h: BH - 6, t: p.nume, s: p.rol, fill: C.spec })
      edges.push({ x1: xc, y1: yPrev, x2: xc, y2: y, sageata: true })
      yPrev = y + BH - 6; y = yPrev + 22
    }
    const fs = F.filter(f => f.operator_id === o.id)
    fs.forEach(f => {
      box({ x: x + 10, y, w: COL_W - 20, h: 40, t: `${f.nume} · ${totalFormatie(f)} pers.`, s: f.detalii || `${n0(f.calificati)} calif. · ${n0(f.necalificati)} necalif. · ${n0(f.tehnic)} tehnic · ${n0(f.auxiliar)} aux.`, fill: C.form, mic: true })
      edges.push({ x1: xc, y1: yPrev, x2: xc, y2: y, sageata: true })
      yPrev = y + 40; y = yPrev + 14
    })
    if (o.tip !== 'proiectant') {
      const t = T[o.id]
      boxes.push({ x, y, w: COL_W, h: 34, t: `${t.total} muncitori`, s: `${t.calificati} calificați · ${t.necalificati} necalificați · ${t.tehnic} tehnic · ${t.auxiliar} auxiliar`, fill: fill, mic: true, total: true })
      y += 34
    }
    maxY = Math.max(maxY, y)
  })
  // linii contractuale lider ↔ asociat / subcontractant (punctate, sub cutiile de operator)
  if (bLider.x != null) O.forEach((o, i) => {
    if (o.tip === 'lider') return
    const xc = x3 + i * (COL_W + GAP) + COL_W / 2
    const yy = y3 + BH + 8
    edges.push({ x1: bLider.x, y1: yy, x2: xc, y2: yy, dash: true, fara_sageata: true, eticheta: o.tip === 'asociat' ? 'acord de asociere' : o.tip === 'subcontractant' ? 'contract de subcontractare' : 'contract proiectare' })
  })
  return { W, H: maxY + 20, boxes, edges, bBen }
}

export function DiagramaSVG({ noduri, licitatie, administrator = ADMINISTRATOR, data = azi() }) {
  const L = useMemo(() => calcLayout(noduri), [noduri])
  const tot = totalGeneral(noduri)
  const H = L.H + 120
  const marker = (id, col) => <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={col} /></marker>
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={L.W} height={H} viewBox={`0 0 ${L.W} ${H}`} style={{ background:'#fff', fontFamily:'Arial, Helvetica, sans-serif', display:'block' }}>
      <defs>{marker('sag', C.line)}</defs>
      <rect x={0} y={0} width={L.W} height={H} fill="#fff" />
      <g transform="translate(0,58)">
        {L.edges.map((e, i) => {
          const dubla = e.dublu && !e.fara_sageata
          return <g key={i}>
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={C.line} strokeWidth={e.dublu ? 2.2 : 1.4}
              strokeDasharray={e.dash ? '5,4' : undefined}
              markerEnd={e.sageata || dubla ? 'url(#sag)' : undefined} markerStart={dubla ? 'url(#sag)' : undefined} />
            {e.eticheta && <text x={(e.x1 + e.x2) / 2} y={e.y1 - 3} fontSize={9} fill={C.muted} textAnchor="middle">{e.eticheta}</text>}
          </g>
        })}
        {L.boxes.map((b, i) => (
          <g key={i}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill={b.fill || C.box} stroke={b.total ? 'none' : C.line} strokeWidth={b.bold ? 1.6 : 1} strokeDasharray={b.dash ? '4,3' : undefined} />
            <text x={b.x + b.w / 2} y={b.y + (b.s ? (b.mic ? 15 : 19) : b.h / 2 + 4)} fontSize={b.mic ? 10 : 11.5} fontWeight={b.bold || b.total ? 700 : 600} fill={b.t === DE_NOMINALIZAT ? '#B00020' : C.text} textAnchor="middle">
              {String(b.t).length > (b.mic ? 34 : 26) ? String(b.t).slice(0, b.mic ? 33 : 25) + '…' : b.t}
            </text>
            {b.s && <text x={b.x + b.w / 2} y={b.y + (b.mic ? 29 : 35)} fontSize={b.mic ? 8.5 : 9.5} fill={C.muted} textAnchor="middle">
              {String(b.s).length > (b.mic ? 40 : 30) ? String(b.s).slice(0, b.mic ? 39 : 29) + '…' : b.s}
            </text>}
          </g>
        ))}
      </g>
      {/* antet */}
      <text x={L.W / 2} y={26} fontSize={16} fontWeight={700} fill={C.head} textAnchor="middle">ORGANIGRAMA ECHIPEI — {licitatie?.nr_anunt || '?'} · {licitatie?.autoritate || ''}</text>
      <text x={L.W / 2} y={44} fontSize={10} fill={C.muted} textAnchor="middle">{(licitatie?.obiect || '').slice(0, 160)}</text>
      {/* legendă + subsol */}
      <g transform={`translate(20,${H - 52})`} fontSize={9.5} fill={C.text}>
        <line x1={0} y1={6} x2={30} y2={6} stroke={C.line} strokeWidth={1.4} /><text x={36} y={10}>subordonare</text>
        <line x1={120} y1={6} x2={150} y2={6} stroke={C.line} strokeWidth={2.2} markerStart="url(#sag)" markerEnd="url(#sag)" /><text x={156} y={10}>relație biunivocă</text>
        <line x1={260} y1={6} x2={290} y2={6} stroke={C.line} strokeWidth={1.4} strokeDasharray="5,4" /><text x={296} y={10}>comunicare / relație contractuală</text>
        <text x={0} y={30} fontSize={10}>Total personal de execuție: <tspan fontWeight={700}>{tot}</tspan>{noduri.muncitori_gantt != null && noduri.muncitori_gantt !== '' ? ` · maxim histogramă Gantt: ${noduri.muncitori_gantt}` : ''}{(noduri.persoane || []).filter(eNominalizat).length ? ` · personal nominalizat: ${(noduri.persoane || []).filter(eNominalizat).length}` : ''}</text>
      </g>
      <text x={L.W - 20} y={H - 22} fontSize={10} fill={C.text} textAnchor="end">Data {data} · Lider asociere, {administrator}</text>
      {noduri.observatii && <text x={20} y={H - 8} fontSize={8.5} fill={C.muted}>{String(noduri.observatii).slice(0, 220)}</text>}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────
// EXPORT: PNG (canvas) / PDF A4 landscape (pag. 1 diagrama, pag. 2 tabele desenate cu jsPDF).
// ─────────────────────────────────────────────────────────────────
const doiRAF = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
async function captureaza(el) {
  await doiRAF()
  return html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false })
}
const numeFisier = (lic, ext) => `Organigrama_${String(lic?.nr_anunt || lic?.id || 'licitatie').replace(/[^A-Za-z0-9]+/g, '_')}_${azi()}.${ext}`

function deseneazaTabel(doc, { x, y, coloane, randuri, latimi, hRand = 7, fs = 8.5, maxY = 195, titlu }) {
  const lat = latimi.reduce((a, b) => a + b, 0)
  const cap = () => {
    if (titlu) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text(titlu, x, y); y += 5 }
    doc.setFillColor(235, 238, 242); doc.rect(x, y, lat, hRand, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fs)
    let cx = x; coloane.forEach((c, i) => { doc.text(String(c), cx + 1.5, y + hRand - 2); cx += latimi[i] })
    y += hRand
  }
  cap()
  doc.setFont('helvetica', 'normal')
  for (const r of randuri) {
    const celule = r.map((v, i) => doc.splitTextToSize(String(v ?? ''), latimi[i] - 3))
    const h = Math.max(hRand, Math.max(...celule.map(c => c.length)) * (fs * 0.42) + 2.5)
    if (y + h > maxY) { doc.addPage(); y = 15; cap(); doc.setFont('helvetica', 'normal') }
    let cx = x
    celule.forEach((c, i) => { doc.rect(cx, y, latimi[i], h); doc.text(c, cx + 1.5, y + 4); cx += latimi[i] })
    y += h
  }
  return y + 8
}

async function exportaPDF({ el, noduri, licitatie, verificari }) {
  const canvas = await captureaza(el)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pw = 297, ph = 210, m = 8
  const img = canvas.toDataURL('image/png')
  const ratio = canvas.height / canvas.width
  let w = pw - 2 * m, h = w * ratio
  if (h > ph - 2 * m) { h = ph - 2 * m; w = h / ratio }
  doc.addImage(img, 'PNG', (pw - w) / 2, (ph - h) / 2, w, h)
  // pagina 2: tabelul nominal + personal pe categorii per operator
  doc.addPage()
  const numeOp = id => (noduri.operatori || []).find(o => o.id === id)?.nume || '—'
  const cerinteRol = new Map()
  for (const r of (verificari?.spec?.roluri_cerute || [])) cerinteRol.set(fara(r.rol), r)
  const activitati = p => {
    const r = [...cerinteRol.values()].find(r => acelasiRol(r.rol, p.rol))
    if (r?.cerinte_persoana) return r.cerinte_persoana
    if (eManagerProiect(p.rol)) return 'Coordonarea generală a contractului, relația cu beneficiarul, raportare, resurse'
    if (eSefSantier(p.rol)) return 'Conducerea execuției pe șantier, coordonarea formațiilor proprii, ale asociatului și subcontractantului'
    if (eRTE(p.rol)) return 'Verificarea execuției conform proiect și reglementări, semnarea fazelor determinante'
    if (/qa|calit/.test(fara(p.rol))) return 'Controlul calității, PCCVI, înregistrări de calitate'
    if (/ssm|psi/.test(fara(p.rol))) return 'Securitate și sănătate în muncă, PSI, protecția mediului pe șantier'
    if (/topo/.test(fara(p.rol))) return 'Trasare, măsurători, documentație topografică GIS'
    if (eMaistru(p.rol)) return 'Conducerea directă a șefilor de lucrări și a formațiilor'
    if (eSefLucrari(p.rol)) return 'Conducerea formației pe front'
    return ''
  }
  let y = 15
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(`Tabel nominal — ${licitatie?.nr_anunt || ''} · ${licitatie?.autoritate || ''}`, m, y); y += 8
  const P = (noduri.persoane || []).filter(p => !['suport'].includes(p.categorie))
  y = deseneazaTabel(doc, { x: m, y, coloane: ['Nr.', 'Nume și prenume', 'Rol / funcție', 'Activități / responsabilități', 'Operator economic', 'Fază'],
    latimi: [10, 55, 50, 105, 45, 16], randuri: P.map((p, i) => [i + 1, p.nume, p.rol, activitati(p), numeOp(p.operator_id), p.faza || '']) })
  const T = totaluriOperatori(noduri)
  const randuri = (noduri.operatori || []).filter(o => o.tip !== 'proiectant').map(o => [o.nume, o.tip, T[o.id].calificati, T[o.id].necalificati, T[o.id].tehnic, T[o.id].auxiliar, T[o.id].total])
  const tot = randuri.reduce((a, r) => [a[0] + r[2], a[1] + r[3], a[2] + r[4], a[3] + r[5], a[4] + r[6]], [0, 0, 0, 0, 0])
  randuri.push(['TOTAL', '', ...tot])
  if (y > 150) { doc.addPage(); y = 15 }
  y = deseneazaTabel(doc, { x: m, y, titlu: 'Personal de execuție pe categorii, per operator economic', coloane: ['Operator economic', 'Calitate', 'Calificați', 'Necalificați', 'Tehnic', 'Auxiliar', 'Total'],
    latimi: [90, 35, 25, 28, 22, 22, 22], randuri })
  const F = noduri.formatii || []
  if (F.length) {
    if (y > 150) { doc.addPage(); y = 15 }
    deseneazaTabel(doc, { x: m, y, titlu: 'Formații de lucru', coloane: ['Formație', 'Operator', 'Componență', 'Calif.', 'Necalif.', 'Tehnic', 'Aux.', 'Total'],
      latimi: [55, 55, 90, 18, 18, 18, 18, 18], randuri: F.map(f => [f.nume, numeOp(f.operator_id), f.detalii || '', n0(f.calificati), n0(f.necalificati), n0(f.tehnic), n0(f.auxiliar), totalFormatie(f)]) })
  }
  doc.save(numeFisier(licitatie, 'pdf'))
}

async function exportaPNG({ el, licitatie }) {
  const canvas = await captureaza(el)
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png'); a.download = numeFisier(licitatie, 'png'); a.click()
}

// ─────────────────────────────────────────────────────────────────
// SPEC — afișare (ce a citit funcția din documente)
// ─────────────────────────────────────────────────────────────────
function SpecView({ spec, citate }) {
  const [desc, setDesc] = useState(false)
  if (!spec) return null
  const L = spec.linii_cerute || {}
  const Chip = ({ ok, children }) => <span style={{ fontSize:11, padding:'1px 7px', borderRadius:10, border:`1px solid ${ok ? G.green : G.border}`, color: ok ? G.green : G.dim, marginRight:4 }}>{children}</span>
  return (
    <div style={{ ...S.card, padding:12, fontSize:12 }}>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:8 }}>
        <b style={{ color: spec.obligatorie ? G.orange : G.muted }}>{spec.obligatorie ? '📌 Organigrama e cerută explicit' : 'Organigrama nu e cerută explicit (se depune oricum)'}</b>
        {spec.per_operator && <Chip ok>per operator</Chip>}
        {spec.corelare_grafic && <Chip ok>corelată cu graficul</Chip>}
        {spec.tabel_nominal?.cerut && <Chip ok>tabel nominal{spec.tabel_nominal.coloane?.length ? `: ${spec.tabel_nominal.coloane.join(', ')}` : ''}</Chip>}
      </div>
      {(spec.avertismente || []).length > 0 && (
        <div style={{ color:G.orange, marginBottom:8 }}>{spec.avertismente.map((a, i) => <div key={i}>⚠️ {a}</div>)}</div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
        <div>
          <div style={S.lbl}>Roluri cerute ({(spec.roluri_cerute || []).length})</div>
          {(spec.roluri_cerute || []).map((r, i) => (
            <div key={i} style={{ padding:'3px 0', borderBottom:`1px solid ${G.border2}` }}>
              <span style={{ color: r.obligatoriu ? G.red : G.muted, fontWeight:600 }}>{r.obligatoriu ? '● ' : '○ '}</span>
              <b>{r.rol}</b>
              <span style={{ color:G.dim }}> · {r.categorie}{r.domeniu_isc ? ` · ISC ${r.domeniu_isc}` : ''}{r.faza ? ` · faza: ${r.faza}` : ''}</span>
              {r.cerinte_persoana && <div style={{ color:G.muted, fontSize:11 }}>{r.cerinte_persoana}</div>}
              {r.citat && <details style={{ color:G.dim, fontSize:11 }}><summary style={{ cursor:'pointer' }}>citat</summary>„{r.citat}"</details>}
            </div>
          ))}
        </div>
        <div>
          <div style={S.lbl}>Linii cerute în diagramă</div>
          <div style={{ marginBottom:8 }}>
            <Chip ok={L.asociati}>asociați</Chip><Chip ok={L.subcontractanti}>subcontractanți</Chip><Chip ok={L.beneficiar}>beneficiar</Chip>
            <Chip ok={L.proiectant}>proiectant</Chip><Chip ok={L.diriginte}>diriginte</Chip><Chip ok={L.biunivoc_cu_seful_de_santier}>biunivoc cu șeful de șantier</Chip>
          </div>
          {(spec.domenii_isc_din_obiect || []).length > 0 && <><div style={S.lbl}>Domenii ISC din obiect</div><div style={{ marginBottom:8 }}>{spec.domenii_isc_din_obiect.map(c => <Chip key={c} ok>RTE {c}</Chip>)}</div></>}
          {(spec.personal_pe_categorii || []).length > 0 && <><div style={S.lbl}>Categorii de personal cerute</div><div style={{ marginBottom:8, color:G.muted }}>{spec.personal_pe_categorii.join(' · ')}</div></>}
          {(spec.faze || []).length > 0 && <><div style={S.lbl}>Faze</div><div style={{ marginBottom:8, color:G.muted }}>{spec.faze.join(' → ')}</div></>}
          {(spec.documente_suport || []).length > 0 && <><div style={S.lbl}>Documente suport</div><ul style={{ margin:'0 0 8px', paddingLeft:18, color:G.muted }}>{spec.documente_suport.map((d, i) => <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>)}</ul></>}
          {spec.format?.observatii && <><div style={S.lbl}>Format</div><div style={{ color:G.muted }}>{spec.format.observatii}</div></>}
        </div>
      </div>
      {Array.isArray(citate) && citate.length > 0 && (
        <div style={{ marginTop:8 }}>
          <button onClick={() => setDesc(!desc)} style={{ ...S.btn, padding:'2px 8px' }}>{desc ? '▾' : '▸'} {citate.length} citate din documente</button>
          {desc && <div style={{ marginTop:6, color:G.dim, fontSize:11 }}>{citate.map((c, i) => <div key={i} style={{ padding:'3px 0', borderBottom:`1px solid ${G.border2}` }}>{typeof c === 'string' ? c : `${c.document || c.sursa || ''}${c.pagina ? ' p. ' + c.pagina : ''}: „${c.text || c.citat || ''}"`}</div>)}</div>}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// EDITOR — tabele inline, fără drag&drop.
// ─────────────────────────────────────────────────────────────────
// Sec stă în afara Editor-ului: definită înăuntru, React o vedea ca altă componentă la fiecare tastă → inputurile pierdeau focusul.
const Sec = ({ titlu, children, onAdd }) => (
  <div style={{ marginBottom:12 }}>
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}><span style={{ ...S.lbl, marginBottom:0 }}>{titlu}</span>{onAdd && <button onClick={onAdd} style={{ ...S.btn, padding:'1px 8px' }}>+</button>}</div>
    <div style={{ overflowX:'auto' }}>{children}</div>
  </div>
)
function Editor({ noduri, setNoduri, angajati, externi, parteneri, echipeGantt }) {
  const up = (k, id, patch) => setNoduri(n => ({ ...n, [k]: n[k].map(x => x.id === id ? { ...x, ...patch } : x) }))
  const del = (k, id) => setNoduri(n => ({ ...n, [k]: n[k].filter(x => x.id !== id) }))
  const add = (k, item) => setNoduri(n => ({ ...n, [k]: [...(n[k] || []), item] }))
  const opts = (noduri.operatori || []).map(o => <option key={o.id} value={o.id}>{o.nume}</option>)
  const sursaPersoana = (p, v) => {
    if (v.startsWith('e:')) { const e = angajati.find(a => String(a.id) === v.slice(2)); up('persoane', p.id, { nume: e?.name || '', employee_id: e?.id || null, extern_id: null }) }
    else if (v.startsWith('x:')) { const x = externi.find(a => String(a.id) === v.slice(2)); up('persoane', p.id, { nume: x?.nume || '', extern_id: x?.id || null, employee_id: null }) }
    else up('persoane', p.id, { nume: DE_NOMINALIZAT, employee_id: null, extern_id: null })
  }
  const valSursa = p => p.employee_id ? `e:${p.employee_id}` : p.extern_id ? `x:${p.extern_id}` : ''
  const inp = { ...S.input, padding:'3px 6px' }
  return (
    <div style={{ ...S.card, padding:12 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
        <div><label style={S.lbl}>Beneficiar / autoritate</label><input style={inp} value={noduri.beneficiar?.nume || ''} onChange={e => setNoduri(n => ({ ...n, beneficiar: { nume: e.target.value } }))} /></div>
        <div><label style={S.lbl}>Muncitori maxim din histograma Gantt {echipeGantt ? <span style={{ color:G.dim, textTransform:'none' }}>(graficul are {echipeGantt} echipe — nu ține personal, se scrie manual)</span> : null}</label>
          <input type="number" min="0" style={inp} value={noduri.muncitori_gantt ?? ''} onChange={e => setNoduri(n => ({ ...n, muncitori_gantt: e.target.value === '' ? null : Number(e.target.value) }))} /></div>
      </div>
      <Sec titlu="Operatori economici" onAdd={() => add('operatori', { id: 'op_' + uid(), tip: 'subcontractant', nume: '', partener_id: null })}>
        <table style={{ borderCollapse:'collapse', width:'100%' }}><thead><tr><th style={S.th}>Tip</th><th style={S.th}>Nume</th><th style={S.th}>Din catalog</th><th style={S.th}></th></tr></thead><tbody>
          {(noduri.operatori || []).map(o => <tr key={o.id}>
            <td style={S.td}><select style={inp} value={o.tip} onChange={e => up('operatori', o.id, { tip: e.target.value })}>{TIPURI_OPERATOR.map(t => <option key={t} value={t}>{t}</option>)}</select></td>
            <td style={S.td}><input style={inp} value={o.nume} onChange={e => up('operatori', o.id, { nume: e.target.value })} /></td>
            <td style={S.td}><select style={inp} value={o.partener_id || ''} onChange={e => { const p = parteneri.find(x => String(x.id) === e.target.value); up('operatori', o.id, { partener_id: p?.id || null, nume: p?.nume || o.nume }) }}><option value="">—</option>{parteneri.map(p => <option key={p.id} value={p.id}>{p.nume}</option>)}</select></td>
            <td style={S.td}>{o.tip !== 'lider' && <button onClick={() => del('operatori', o.id)} style={{ ...S.btn, padding:'1px 6px' }}>✕</button>}</td>
          </tr>)}
        </tbody></table>
      </Sec>
      <Sec titlu="Persoane (conducere, specialiști, maiștri, șefi de lucrări)" onAdd={() => add('persoane', { id: uid(), nume: DE_NOMINALIZAT, rol: '', categorie: 'specialist', domeniu_isc: '', operator_id: 'op_lider', employee_id: null, extern_id: null, autorizatie_id: null, raporteaza_la: null, linie: 'biunivoc', faza: '' })}>
        <table style={{ borderCollapse:'collapse', width:'100%' }}><thead><tr>
          <th style={S.th}>Sursă</th><th style={S.th}>Nume</th><th style={S.th}>Rol</th><th style={S.th}>Categorie</th><th style={S.th}>ISC</th><th style={S.th}>Operator</th><th style={S.th}>Linie</th><th style={S.th}>Fază</th><th style={S.th}></th>
        </tr></thead><tbody>
          {(noduri.persoane || []).map(p => <tr key={p.id}>
            <td style={S.td}><select style={{ ...inp, width:170 }} value={valSursa(p)} onChange={e => sursaPersoana(p, e.target.value)}>
              <option value="">— de nominalizat / text —</option>
              <optgroup label="Angajați">{angajati.map(a => <option key={a.id} value={`e:${a.id}`}>{a.name}{a.functie ? ` · ${a.functie}` : ''}</option>)}</optgroup>
              <optgroup label="Externi">{externi.map(x => <option key={x.id} value={`x:${x.id}`}>{x.nume}{x.firma ? ` · ${x.firma}` : ''}</option>)}</optgroup>
            </select></td>
            <td style={S.td}><input style={{ ...inp, width:150, color: eNominalizat(p) ? G.text : G.red }} value={p.nume} onChange={e => up('persoane', p.id, { nume: e.target.value })} /></td>
            <td style={S.td}><input style={{ ...inp, width:150 }} value={p.rol} onChange={e => up('persoane', p.id, { rol: e.target.value })} /></td>
            <td style={S.td}><select style={inp} value={p.categorie} onChange={e => up('persoane', p.id, { categorie: e.target.value })}>{CATEGORII.map(c => <option key={c} value={c}>{c}</option>)}</select></td>
            <td style={S.td}><input style={{ ...inp, width:70 }} value={p.domeniu_isc || ''} onChange={e => up('persoane', p.id, { domeniu_isc: e.target.value })} placeholder="8.4D" /></td>
            <td style={S.td}><select style={inp} value={p.operator_id || ''} onChange={e => up('persoane', p.id, { operator_id: e.target.value })}>{opts}</select></td>
            <td style={S.td}><select style={inp} value={p.linie} onChange={e => up('persoane', p.id, { linie: e.target.value })}>{LINII.map(l => <option key={l} value={l}>{l}</option>)}</select></td>
            <td style={S.td}><input style={{ ...inp, width:70 }} value={p.faza || ''} onChange={e => up('persoane', p.id, { faza: e.target.value })} /></td>
            <td style={S.td}><button onClick={() => del('persoane', p.id)} style={{ ...S.btn, padding:'1px 6px' }}>✕</button></td>
          </tr>)}
        </tbody></table>
      </Sec>
      <Sec titlu="Formații (numere pe categorii)" onAdd={() => add('formatii', { ...formatieNoua('Formație nouă', 'op_lider'), calificati: 0, necalificati: 0, auxiliar: 0, detalii: '' })}>
        <table style={{ borderCollapse:'collapse', width:'100%' }}><thead><tr>
          <th style={S.th}>Formație</th><th style={S.th}>Operator</th><th style={S.th}>Maistru</th><th style={S.th}>Calif.</th><th style={S.th}>Necalif.</th><th style={S.th}>Tehnic</th><th style={S.th}>Aux.</th><th style={S.th}>Total</th><th style={S.th}>Componență</th><th style={S.th}></th>
        </tr></thead><tbody>
          {(noduri.formatii || []).map(f => <tr key={f.id}>
            <td style={S.td}><input style={{ ...inp, width:150 }} value={f.nume} onChange={e => up('formatii', f.id, { nume: e.target.value })} /></td>
            <td style={S.td}><select style={inp} value={f.operator_id || ''} onChange={e => up('formatii', f.id, { operator_id: e.target.value })}>{opts}</select></td>
            <td style={S.td}><select style={inp} value={f.maistru_id || ''} onChange={e => up('formatii', f.id, { maistru_id: e.target.value || null })}><option value="">—</option>{(noduri.persoane || []).filter(p => eMaistru(p.rol) || eSefLucrari(p.rol)).map(p => <option key={p.id} value={p.id}>{p.nume} · {p.rol}</option>)}</select></td>
            {['calificati', 'necalificati', 'tehnic', 'auxiliar'].map(k => <td key={k} style={S.td}><input type="number" min="0" style={{ ...inp, width:52 }} value={f[k] ?? 0} onChange={e => up('formatii', f.id, { [k]: Number(e.target.value) || 0 })} /></td>)}
            <td style={{ ...S.td, fontWeight:700 }}>{totalFormatie(f)}</td>
            <td style={S.td}><input style={{ ...inp, width:220 }} value={f.detalii || ''} onChange={e => up('formatii', f.id, { detalii: e.target.value })} /></td>
            <td style={S.td}><button onClick={() => del('formatii', f.id)} style={{ ...S.btn, padding:'1px 6px' }}>✕</button></td>
          </tr>)}
        </tbody></table>
      </Sec>
      <Sec titlu="Suport (planificare / aprovizionare / contracte)" onAdd={() => add('suport', { id: uid(), nume: '', rol: '', operator_id: 'op_lider' })}>
        <table style={{ borderCollapse:'collapse' }}><tbody>
          {(noduri.suport || []).map(s => <tr key={s.id}>
            <td style={S.td}><input style={{ ...inp, width:200 }} value={s.rol} onChange={e => up('suport', s.id, { rol: e.target.value })} placeholder="rol" /></td>
            <td style={S.td}><input style={{ ...inp, width:200 }} value={s.nume} onChange={e => up('suport', s.id, { nume: e.target.value })} placeholder="nume (opțional)" /></td>
            <td style={S.td}><button onClick={() => del('suport', s.id)} style={{ ...S.btn, padding:'1px 6px' }}>✕</button></td>
          </tr>)}
        </tbody></table>
      </Sec>
      <div><label style={S.lbl}>Observații (apar în subsolul diagramei)</label><input style={inp} value={noduri.observatii || ''} onChange={e => setNoduri(n => ({ ...n, observatii: e.target.value }))} /></div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// SECȚIUNEA montată în PropunerePanel
// ─────────────────────────────────────────────────────────────────
export default function OrganigramaSection({ licitatie, profile, participanti = [], parteneri = [], showToast }) {
  const licId = licitatie?.id
  const [rand, setRand] = useState(null)
  const [noduri, setNoduri] = useState(null)
  const [verificari, setVerificari] = useState([])
  const [docs, setDocs] = useState(null)
  const [angajati, setAngajati] = useState([])
  const [externi, setExterni] = useState([])
  const [echipeGantt, setEchipeGantt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('diagrama')
  const [deschis, setDeschis] = useState(false)
  const [administrator, setAdministrator] = useState(ADMINISTRATOR)
  const svgRef = useRef(null)
  const poate = poatePorniProcesarea(profile, licitatie)

  useEffect(() => {
    if (!licId) return
    setNoduri(null); setVerificari([]); setDocs(null)
    Promise.all([
      supabase.from('ofertare_organigrama').select('*').eq('licitatie_id', licId).maybeSingle(),
      supabase.from('grafic_parametri').select('parametri').eq('licitatie_id', licId).maybeSingle(),
    ]).then(([r, g]) => {
      if (r.error) { showToast?.('Organigrama nu s-a putut citi: ' + r.error.message, 'err'); return }
      setRand(r.data || null); setNoduri(r.data?.noduri || null); setVerificari(r.data?.verificari || [])
      setEchipeGantt(g.data?.parametri?.echipe ?? null)
    })
  }, [licId])

  // listele pentru editor + numele administratorului, o singură dată, la deschidere
  useEffect(() => {
    if (!deschis || angajati.length) return
    supabase.from('employees').select('id, name, functie').eq('active', true).order('name').limit(1000).then(r => setAngajati(r.data || []))
    supabase.from('hr_personal_extern').select('id, nume, functie, firma, partener_id').eq('activ', true).order('nume').limit(500).then(r => setExterni(r.data || []))
    supabase.from('profiles').select('name').eq('is_owner', true).order('id').limit(1).maybeSingle().then(r => { if (r.data?.name) setAdministrator(r.data.name) })
  }, [deschis])

  const spec = rand?.spec || null

  const citesteSpec = async () => {
    if (!poate) return
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('ofertare-organigrama-spec', { body: { licitatie_id: licId } })
    setBusy(false)
    if (error || data?.error) { showToast?.('Citirea cerințelor a eșuat: ' + (error?.message || data?.error), 'err'); return }
    const r = await supabase.from('ofertare_organigrama').select('*').eq('licitatie_id', licId).maybeSingle()
    setRand(r.data || null)
    showToast?.(`Cerințe citite: ${(r.data?.spec?.roluri_cerute || []).length} roluri, ${(r.data?.spec?.domenii_isc_din_obiect || []).length} domenii ISC.`, 'ok')
  }

  // Documentele HR (CV + declarație de disponibilitate) pentru angajații nominalizați.
  // Tipurile au cod `cv`; declarația n-are cod propriu → se caută în denumirea tipului / observații / numele fișierului,
  // plus hr_autorizatii cu tip FARA („Declarație de disponibilitate") — așa a fost încadrată în HR.
  const incarcaDocs = async (N) => {
    const ids = [...new Set((N?.persoane || []).map(p => p.employee_id).filter(Boolean))]
    if (!ids.length) { setDocs({}); return {} }
    const [rD, rA] = await Promise.all([
      supabase.from('hr_documente_personale').select('employee_id, observatii, fisier_nume, tip:hr_documente_personale_tipuri(cod, denumire)').in('employee_id', ids).is('deleted_at', null).eq('activ', true).limit(5000),
      supabase.from('hr_autorizatii').select('employee_id, tip:hr_autorizatii_tipuri(cod, denumire)').in('employee_id', ids).is('deleted_at', null).limit(5000),
    ])
    const out = {}
    for (const id of ids) out[id] = { cv: false, disponibilitate: false }
    for (const d of rD.data || []) {
      const t = fara(`${d.tip?.cod || ''} ${d.tip?.denumire || ''} ${d.observatii || ''} ${d.fisier_nume || ''}`)
      if (d.tip?.cod === 'cv' || /\bcv\b|curriculum/.test(t)) out[d.employee_id].cv = true
      if (/disponibil/.test(t)) out[d.employee_id].disponibilitate = true
    }
    for (const a of rA.data || []) if (a.tip?.cod === 'FARA' || /disponibil/.test(fara(a.tip?.denumire))) if (out[a.employee_id]) out[a.employee_id].disponibilitate = true
    setDocs(out)
    return out
  }

  const propune = async () => {
    setBusy(true)
    // acoperirea licitației: prin cerințe (ofertare_acoperire n-are licitatie_id)
    const rC = await supabase.from('ofertare_cerinte').select('id').eq('licitatie_id', licId).is('inlocuita_de', null).is('duplicat_al', null).limit(5000)
    const cIds = (rC.data || []).map(c => c.id)
    let acoperiri = []
    if (cIds.length) {
      const rA = await supabase.from('ofertare_acoperire')
        .select('id, cerinta_id, status, partener_id, domeniu_rte, autorizatie:hr_autorizatii(id, employee_id, extern_id, domenii, tip:hr_autorizatii_tipuri(cod, denumire), emp:employees(name), ext:hr_personal_extern(nume, partener_id))')
        .in('cerinta_id', cIds).in('status', ['acoperit', 'acoperit_partener']).not('autorizatie_id', 'is', null).order('id').limit(5000)
      if (rA.error) showToast?.('Acoperirea nu s-a putut citi: ' + rA.error.message, 'err')
      acoperiri = rA.data || []
    }
    const N = construiesteNoduri({ licitatie, participanti, acoperiri, spec, existente: noduri })
    setNoduri(N)
    const d = await incarcaDocs(N)
    setVerificari(verificaOrganigrama({ noduri: N, spec, docs: d }))
    setBusy(false); setTab('editor')
    showToast?.(`Echipă propusă: ${N.persoane.filter(eNominalizat).length} persoane din platformă, ${N.persoane.filter(p => !eNominalizat(p)).length} de nominalizat.`, 'ok')
  }

  const verifica = async () => {
    if (!noduri) return
    const d = docs || await incarcaDocs(noduri)
    const v = verificaOrganigrama({ noduri, spec, docs: d })
    setVerificari(v)
    return v
  }

  const salveaza = async (extra = {}) => {
    if (!noduri) return
    setBusy(true)
    const v = await verifica()
    const payload = { licitatie_id: licId, noduri, verificari: v, updated_by: profile?.id || null, ...extra }
    const { data, error } = await supabase.from('ofertare_organigrama').upsert(payload, { onConflict: 'licitatie_id' }).select('*').maybeSingle()
    setBusy(false)
    if (error) { showToast?.('Nu s-a salvat: ' + error.message, 'err'); return false }
    if (data) setRand(data)
    showToast?.('Organigrama e salvată.', 'ok')
    return true
  }

  const exporta = async (fel) => {
    if (!noduri || !svgRef.current) return
    setBusy(true); setTab('diagrama')  // html2canvas nu capturează un container ascuns
    try {
      if (fel === 'pdf') await exportaPDF({ el: svgRef.current, noduri, licitatie, verificari: { spec } })
      else await exportaPNG({ el: svgRef.current, licitatie })
      await salveaza({ generat_la: new Date().toISOString() })
    } catch (e) { showToast?.('Exportul a eșuat: ' + (e.message || e), 'err') }
    setBusy(false)
  }

  // recalculează verificările la fiecare schimbare din editor (fără documente noi — alea se cer la salvare)
  const verificariLive = useMemo(() => noduri ? verificaOrganigrama({ noduri, spec, docs }) : verificari, [noduri, spec, docs])
  const rosii = verificariLive.filter(v => v.nivel === 'rosu').length, portocalii = verificariLive.filter(v => v.nivel === 'portocaliu').length

  if (!licId) return null
  return (
    <div style={{ ...S.card, padding:14 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        <button onClick={() => setDeschis(!deschis)} style={S.btn}>{deschis ? '▾' : '▸'} 🏗 Organigramă</button>
        <span style={{ color:G.muted, fontSize:12 }}>
          {spec ? `cerințe citite ${rand?.spec_la ? String(rand.spec_la).slice(0, 10) : ''}${rand?.spec_model ? ' · ' + rand.spec_model : ''}` : 'cerințele nu-s citite'}
          {noduri ? ` · ${(noduri.persoane || []).filter(eNominalizat).length} persoane · ${totalGeneral(noduri)} muncitori` : ' · fără echipă'}
          {rand?.generat_la ? ` · PDF generat ${String(rand.generat_la).slice(0, 10)}` : ''}
        </span>
        {noduri && <span style={{ fontSize:12, color: rosii ? G.red : portocalii ? G.orange : G.green }}>{rosii ? `🔴 ${rosii}` : ''} {portocalii ? `🟠 ${portocalii}` : ''} {!rosii && !portocalii ? '🟢 fără probleme' : ''}</span>}
      </div>
      {deschis && (
        <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:12 }}>
          <div style={{ color:G.muted, fontSize:12, lineHeight:1.6 }}>
            Lecția Greci: specialiștii (RTE, CQ, SSM, topograf) stau pe <b>aceeași linie</b> cu șeful de șantier, biunivoc; echipele stau <b>sub maiștri</b>;
            asociatul și subcontractantul apar <b>cu formațiile lor</b>; numărul de muncitori pe categorii, per operator, <b>egal cu histograma din Gantt</b>;
            RTE pe <b>toate</b> domeniile ISC din obiect; CV + declarație de disponibilitate semnate pentru fiecare nominalizat.
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {poate
              ? <button onClick={citesteSpec} disabled={busy} style={{ ...S.btnP, opacity: busy ? .5 : 1 }}>🤖 Citește cerințele de organigramă</button>
              : <span style={{ ...S.btnS, opacity:.6, cursor:'default' }} title={MOTIV_POARTA}>🔒 Citirea cerințelor o pornește ownerul sau responsabilul</span>}
            <button onClick={propune} disabled={busy} style={{ ...S.btnS, opacity: busy ? .5 : 1 }}>✨ Propune echipa din platformă</button>
            {noduri && <>
              <button onClick={() => salveaza()} disabled={busy} style={{ ...S.btnS, opacity: busy ? .5 : 1 }}>💾 Salvează</button>
              <button onClick={() => exporta('pdf')} disabled={busy} style={{ ...S.btnS, opacity: busy ? .5 : 1 }}>⬇ PDF</button>
              <button onClick={() => exporta('png')} disabled={busy} style={{ ...S.btnS, opacity: busy ? .5 : 1 }}>⬇ PNG</button>
            </>}
          </div>
          {!poate && <div style={{ color:G.dim, fontSize:11 }}>{MOTIV_POARTA}</div>}
          <SpecView spec={spec} citate={rand?.spec_citate} />
          {noduri && <>
            <div style={{ ...S.card, padding:10, fontSize:12 }}>
              <div style={{ ...S.lbl }}>Verificări ({verificariLive.length})</div>
              {verificariLive.map(v => (
                <div key={v.cod} style={{ padding:'2px 0', color: v.nivel === 'rosu' ? G.red : v.nivel === 'portocaliu' ? G.orange : v.nivel === 'ok' ? G.green : G.dim }}>
                  {v.nivel === 'rosu' ? '🔴' : v.nivel === 'portocaliu' ? '🟠' : v.nivel === 'ok' ? '🟢' : 'ℹ️'} {v.text}
                </div>
              ))}
              {!docs && <div style={{ color:G.dim, marginTop:4 }}>Documentele HR (CV / declarație) se verifică la salvare.</div>}
            </div>
            <div style={{ display:'flex', gap:6 }}>
              {[['diagrama', '🖼 Diagramă'], ['editor', '✏️ Editor']].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} style={{ ...S.btn, background: tab === k ? G.ofertare : G.surface, color: tab === k ? '#0D1117' : G.text, fontWeight: tab === k ? 700 : 400 }}>{l}</button>
              ))}
            </div>
            {tab === 'editor' && <Editor noduri={noduri} setNoduri={setNoduri} angajati={angajati} externi={externi} parteneri={parteneri} echipeGantt={echipeGantt} />}
            <div style={{ display: tab === 'diagrama' ? 'block' : 'none', overflowX:'auto', background:'#fff', borderRadius:8, padding:8 }}>
              <div ref={svgRef} style={{ display:'inline-block', background:'#fff' }}>
                <DiagramaSVG noduri={noduri} licitatie={licitatie} administrator={administrator} />
              </div>
            </div>
          </>}
        </div>
      )}
    </div>
  )
}
