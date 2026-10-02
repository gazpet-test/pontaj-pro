// ════════════════════════════════════════════════════════════════
// garantiiCerereOferta.js — textul cererii de ofertă pentru poliță (GBE / avans / CAR), logică PURĂ (Răzvan, 02.10.2026,
//   claude_context #1519). Extinde generatorul „Cere ofertă poliță” din Ofertare (doar participare) la garanțiile
//   constituite pe contract: bună execuție (garantii.tip = buna_executie), returnare avans (tip = avans) și
//   asigurarea lucrărilor CAR (tip = car — tip NOU, există doar după migrarea 20261002e; UI-ul îl arată condiționat).
//   Nicio dependență de React/Supabase: se testează cu vitest (garantiiCerereOferta.test.js).
// ════════════════════════════════════════════════════════════════

export const LIPSA = '[DE COMPLETAT]'

// Tipurile pe care le acoperă generatorul (cheia = garantii.tip). `participare` rămâne în OfertareGarantie.jsx.
export const TIPURI_CERERE = {
  buna_executie: {
    eticheta: 'Garanție de bună execuție (GBE)',
    polita: 'Polița de asigurare de garanție de bună execuție',
    subiect: 'Solicitare ofertă Poliță garanție de bună execuție',
    rolValoare: 'Valoarea garanției de bună execuție',
  },
  avans: {
    eticheta: 'Garanție de returnare a avansului',
    polita: 'Polița de asigurare de garanție de returnare a avansului',
    subiect: 'Solicitare ofertă Poliță garanție de returnare avans',
    rolValoare: 'Valoarea avansului garantat',
  },
  car: {
    eticheta: 'Asigurare lucrări CAR (toate riscurile construcții-montaj)',
    polita: 'Polița de asigurare a lucrărilor de construcții-montaj (CAR — Contractor’s All Risks)',
    subiect: 'Solicitare ofertă Poliță CAR (asigurarea lucrărilor)',
    rolValoare: 'Suma asigurată (valoarea lucrărilor)',
  },
}
// tipurile implicite din CHECK-ul garantii_tip_check înainte de 20261002e (rezerva UI-ului când RPC-ul lipsește)
export const TIPURI_GARANTII_IMPLICITE = ['buna_executie', 'participare', 'mentenanta', 'avans']

// tipurile din generator disponibile, în ordinea afișării, pe baza listei permise de BD (fn_garantii_tipuri)
export const tipuriDisponibile = (permise = TIPURI_GARANTII_IMPLICITE) =>
  Object.keys(TIPURI_CERERE).filter(t => (permise || []).includes(t))

// ── Sume în litere (românește): 1.234,56 lei → „o mie două sute treizeci și patru lei și cincizeci și șase de bani”
const UNITATI_M = ['', 'unu', 'doi', 'trei', 'patru', 'cinci', 'șase', 'șapte', 'opt', 'nouă']
const UNITATI_F = ['', 'una', 'două', 'trei', 'patru', 'cinci', 'șase', 'șapte', 'opt', 'nouă']
const TEENS_M = ['zece', 'unsprezece', 'doisprezece', 'treisprezece', 'paisprezece', 'cincisprezece', 'șaisprezece', 'șaptesprezece', 'optsprezece', 'nouăsprezece']
const ZECI = ['', 'zece', 'douăzeci', 'treizeci', 'patruzeci', 'cincizeci', 'șaizeci', 'șaptezeci', 'optzeci', 'nouăzeci']

// 1..999, gen 'm' (lei, bani, milioane) sau 'f' (sute, mii)
function grup(n, gen) {
  const u = gen === 'f' ? UNITATI_F : UNITATI_M
  const s = Math.floor(n / 100), r = n % 100, z = Math.floor(r / 10), c = r % 10
  const p = []
  if (s === 1) p.push('o sută'); else if (s === 2) p.push('două sute'); else if (s > 2) p.push(`${UNITATI_F[s]} sute`)
  if (r >= 10 && r < 20) p.push(r === 12 && gen === 'f' ? 'douăsprezece' : TEENS_M[r - 10])
  else { if (z) p.push(ZECI[z]); if (c) p.push(z ? `și ${u[c]}` : u[c]) }
  return p.join(' ')
}
// „de” înaintea substantivului când ultimul grup e 0 sau ≥ 20 (douăzeci DE lei, o sută DE lei, o sută unu lei)
const cuDe = n => n >= 20 && (n % 100 === 0 || n % 100 >= 20)

// numărul întreg 0..999.999.999 în litere, genul substantivului care urmează
export function numarInLitere(n, gen = 'm') {
  n = Math.floor(Math.abs(Number(n) || 0))
  if (n === 0) return 'zero'
  const mil = Math.floor(n / 1e6), mii = Math.floor((n % 1e6) / 1000), rest = n % 1000
  const p = []
  if (mil === 1) p.push('un milion'); else if (mil > 1) p.push(`${grup(mil, 'f')} ${cuDe(mil) ? 'de ' : ''}milioane`)
  if (mii === 1) p.push('o mie'); else if (mii > 1) p.push(`${grup(mii, 'f')} ${cuDe(mii) ? 'de ' : ''}mii`)
  if (rest) p.push(grup(rest, gen))
  return p.join(' ')
}

// suma în litere cu moneda: lei/bani, euro/cenți; sumele negative sau nenumerice → ''
export function sumaInLitere(v, moneda = 'RON') {
  const x = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(x) || x < 0) return ''
  const intreg = Math.floor(x + 1e-9), sub = Math.round((x - intreg) * 100)
  const eur = /EUR/i.test(moneda)
  const nI = intreg === 1 ? (eur ? 'un euro' : 'un leu') : `${numarInLitere(intreg)} ${cuDe(intreg) ? 'de ' : ''}${eur ? 'euro' : 'lei'}`
  if (!sub) return nI
  const nS = sub === 1 ? (eur ? 'un cent' : 'un ban') : `${numarInLitere(sub)} ${cuDe(sub) ? 'de ' : ''}${eur ? 'cenți' : 'bani'}`
  return `${nI} și ${nS}`
}

// ── formatări fără locale (stabile în teste)
export const fmtSuma = (v, moneda = 'RON') => {
  const x = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'))
  if (v == null || v === '' || !Number.isFinite(x)) return ''
  const [i, d] = x.toFixed(2).split('.')
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${d} ${moneda}`
}
export const fmtData = d => {
  if (!d) return ''
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(d)
}
// valoarea garanției din valoarea contractului × procent (2 zecimale); '' dacă lipsește ceva
export const valoareDinProcent = (valoareContract, procent) => {
  const v = Number(valoareContract), p = Number(procent)
  if (!(v > 0) || !(p > 0)) return ''
  return Math.round(v * p) / 100
}
// data de sfârșit = data de început + N luni calendaristice (ISO yyyy-mm-dd); null dacă lipsește ceva
export const adaugaLuni = (de, luni) => {
  const m = String(de || '').match(/^(\d{4})-(\d{2})-(\d{2})/), n = Number(luni)
  if (!m || !(n > 0)) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + n, +m[3]))
  return d.toISOString().slice(0, 10)
}

// ── ce lipsește din formular pentru un text complet (etichete pentru om)
export function lipsuriCerere(tip, d = {}) {
  const l = []
  if (!TIPURI_CERERE[tip]) l.push('tipul garanției')
  if (!d.beneficiar) l.push('beneficiarul')
  if (!d.contract_numar) l.push('numărul contractului')
  if (!d.lucrare) l.push('obiectul contractului / lucrarea')
  if (!(Number(d.valoare) > 0)) l.push(tip === 'car' ? 'suma asigurată' : 'valoarea garanției')
  if (!d.valabil_de || !d.valabil_pana) l.push('perioada de valabilitate')
  if (d.valabil_de && d.valabil_pana && d.valabil_pana < d.valabil_de) l.push('perioada de valabilitate (sfârșitul e înaintea începutului)')
  return l
}

// ── textul cererii (subiect + corp), după modelul cererii de participare (Cristina). Câmpurile lipsă apar ca „[DE COMPLETAT]”
// ca să nu plece niciodată un mail cu goluri nevăzute (UI-ul refuză trimiterea cât timp textul conține marcajul).
export function textCerereOferta(tip, d = {}) {
  const T = TIPURI_CERERE[tip]
  if (!T) return { subiect: '', corp: '', lipsuri: ['tipul garanției'] }
  const moneda = d.moneda || 'RON'
  const ctr = `${d.contract_numar || LIPSA}${d.contract_data ? ` din ${fmtData(d.contract_data)}` : ''}`
  const valoare = Number(d.valoare) > 0 ? fmtSuma(d.valoare, moneda) : LIPSA
  const litere = Number(d.valoare) > 0 ? sumaInLitere(d.valoare, moneda) : ''
  const procent = Number(d.procent) > 0 ? ` (${String(d.procent).replace('.', ',')}% din valoarea contractului)` : ''
  const perioada = d.valabil_de && d.valabil_pana ? `${fmtData(d.valabil_de)} – ${fmtData(d.valabil_pana)}` : LIPSA
  const subiect = `${T.subiect} — contract nr. ${d.contract_numar || LIPSA} — ${d.beneficiar || LIPSA}`

  const randuri = [
    `- Beneficiarul contractului (în favoarea căruia se emite): ${d.beneficiar || LIPSA}`,
    `- Contract nr. ${ctr}`,
    `- Obiectul contractului: „${d.lucrare || LIPSA}”`,
    Number(d.valoare_contract) > 0 ? `- Valoarea contractului: ${fmtSuma(d.valoare_contract, moneda)} (fără TVA)` : null,
    `- ${T.rolValoare}: ${valoare}${procent}${litere ? ` — adică ${litere}` : ''}`,
    `- Perioada de valabilitate a poliței: ${perioada}${tip === 'buna_executie' && Number(d.perioada_garantie_luni) > 0 ? ` (acoperă execuția și perioada de garanție de ${d.perioada_garantie_luni} luni de la recepția la terminarea lucrărilor)` : ''}`,
    `- Asiguratul / contractantul: GAZPET INSTAL SRL, CUI RO22029920, Ploiești, str. Fluturilor nr. 34, jud. Prahova.`,
  ].filter(Boolean)

  const clauze = {
    buna_executie: [
      '- Polița trebuie să fie irevocabilă și să prevadă în mod expres că plata se face necondiționat, la prima cerere scrisă a beneficiarului, în limita valorii garanției, fără ca acesta să aibă obligația de a-și motiva cererea, conform clauzelor contractuale privind garanția de bună execuție.',
      '- Instrumentul de garantare va fi emis conform modelului / cerințelor beneficiarului (dacă există, le atașăm).',
    ],
    avans: [
      '- Polița garantează returnarea avansului acordat de beneficiar, în limita sumei neamortizate, și trebuie să fie irevocabilă, cu plată necondiționată la prima cerere scrisă a beneficiarului.',
      '- Valabilitatea trebuie să acopere perioada până la amortizarea integrală a avansului prin situațiile de lucrări.',
    ],
    car: [
      '- Acoperire: toate riscurile pentru lucrările de construcții-montaj (secțiunea I — daune materiale), pe toată perioada execuției, cu perioadă de întreținere/garanție dacă e cerută prin contract.',
      `- Răspundere civilă față de terți (secțiunea II): ${d.limita_rc ? fmtSuma(d.limita_rc, moneda) : '[DE COMPLETAT — limita cerută prin contract sau „nu e cerută”]'}.`,
      '- Beneficiarul contractului va fi menționat ca asigurat suplimentar / beneficiar al despăgubirii, conform clauzelor contractuale.',
    ],
  }[tip]

  const corp = [
    'Bună ziua,',
    '',
    `Vă rugăm să ne transmiteți oferta dvs. pentru ${T.polita}, pentru următorul contract:`,
    '',
    ...randuri,
    ...clauze,
    ...(d.observatii ? [`- Mențiuni: ${d.observatii}`] : []),
    '',
    'Vă rugăm să ne transmiteți draftul poliței și decontul pentru plata primei de asigurare.',
    '',
    'Vă mulțumim.',
  ].join('\n')

  return { subiect, corp, lipsuri: lipsuriCerere(tip, d) }
}

// textul mai conține goluri? (refuz la trimitere)
export const areGoluri = text => /\[DE COMPLETAT/.test(String(text || ''))

// marcajul scris în garantii.observatii după trimitere (urmă auditabilă, fără coloană nouă)
export const marcajCerereTrimisa = ({ broker, cine, la }) =>
  `⟦cerere-oferta⟧ ${fmtData(la)} → ${broker || '—'}${cine ? ` (${cine})` : ''}`
export const adaugaMarcaj = (observatii, marcaj) => [String(observatii || '').trim(), marcaj].filter(Boolean).join('\n')

// precompletarea formularului din: un rând din registrul garanții (r) SAU un contract din contracte_terti (c)
export function precompleteazaDinGarantie(r = {}) {
  return {
    garantie_id: r.id || null, tip: TIPURI_CERERE[r.tip] ? r.tip : 'buna_executie', contract_terti_id: r.contract_terti_id || null,
    beneficiar: r.beneficiar || '', contract_numar: r.contract_numar || '', contract_data: r.contract_data || '',
    lucrare: r.lucrare || '', valoare: r.valoare ?? '', moneda: r.moneda || 'RON', procent: r.procent ?? '', valoare_contract: '',
    valabil_de: r.data_emitere || '', valabil_pana: r.data_expirare || '', perioada_garantie_luni: '', limita_rc: '', observatii: '',
  }
}
export function precompleteazaDinContract(c = {}, tip = 'buna_executie') {
  const vc = c.valoare_actuala_lei ?? c.valoare_lei ?? ''
  const pct = tip === 'buna_executie' ? (c.garantie_buna_executie_pct ?? '') : ''
  const de = c.data_semnare || ''
  const pana = tip === 'buna_executie' && de && Number(c.garantie_perioada_luni) > 0 && c.data_termen
    ? adaugaLuni(c.data_termen, c.garantie_perioada_luni) : (c.data_termen || '')
  return {
    garantie_id: null, tip, contract_terti_id: c.id || null,
    beneficiar: c.beneficiar?.nume || c.partener_text || '', contract_numar: c.numar_contract || '', contract_data: de,
    lucrare: c.denumire || '', valoare_contract: vc, procent: pct, valoare: tip === 'car' ? vc : (valoareDinProcent(vc, pct) || ''),
    moneda: c.valoare_eur && !c.valoare_lei ? 'EUR' : 'RON', valabil_de: de, valabil_pana: pana || '',
    perioada_garantie_luni: c.garantie_perioada_luni ?? '', limita_rc: '', observatii: '',
  }
}
