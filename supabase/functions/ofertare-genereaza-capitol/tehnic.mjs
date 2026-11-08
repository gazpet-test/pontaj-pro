// Contextul TEHNIC al unui capitol din propunerea tehnică — funcții pure (fără Supabase, fără rețea), testate în
// src/ofertareCapitolTehnic.test.js. Auditul Ofertare 08.11.2026 (problemele 3–4 ale colegilor: „memoriul tehnic e prea sumar”,
// „propunerea tehnică nu e destul de tehnică”):
//   - generatorul primea doar cerințele ATRIBUITE capitolului (comprimate la ~200 de caractere) + faptele din ERP; textul
//     proiectului (partea scrisă a PT, caietul de sarcini) era citit de platformă, dar nu ajungea la redactor;
//   - un singur prompt pentru toate capitolele, cu regula „lungime pe măsura cerințelor” → metodologia ieșea cât cerințele, nu cât lucrarea;
//   - zero normative în context: pe licitația de test 103 partea scrisă a proiectului citează ~40 de normative, metodologia generată 7;
//   - capitolul „obligații sociale și relații de muncă” a ieșit despre PSI, pentru că avea atribuite doar cerințe PSI (titlul era ignorat).
// Aici: tipul capitolului din titlu, scheletul minim pe tip, normativele citate în documentația licitației (listă albă) și ferestre
// de text din proiect / caiet în jurul cuvintelor-cheie ale tipului. Totul e DATE pentru prompt (conținut extern, L-regula 10).

const fara = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Tipul capitolului, din titlu (ordinea contează: „Planul de management al calității” e calitate, nu management general)
const TIPURI = [
  ['calitate', /calit|pccvi|control.*(execut|lucrar)|inspect.*incerc/],
  ['ssm', /securit.*sanat|\bssm\b|sanatat.*munc|situat.*urgen|\bpsi\b|incendi/],
  ['social', /social|relat.*munc|munc.*relat/],
  ['mediu', /mediu|deseu|ecolog/],
  ['grafic', /grafic|esalonar|durat.*execut|calendar/],
  ['personal', /personal|echip|expert|organigram|managementul contract/],
  ['utilaje', /utilaj|echipament|dotar|infrastructur|logistic/],
  ['organizare', /organizar.*santier|amplasament|constrang/],
  ['garantie', /garanti|post.*garant|mentenan/],
  ['metodologie', /metodolog|tehnolog|executi.*lucrar|mod.*de.*execut|memoriu|descrier.*tehnic|solut.*tehnic/],
]
export function tipCapitol(titlu) {
  const t = fara(titlu)
  for (const [tip, re] of TIPURI) if (re.test(t)) return tip
  return 'altul'
}

// Scheletul minim pe tip — subcapitole care TREBUIE să existe, dimensionate după lucrare, nu după numărul de cerințe atribuite.
export const SCHELET = {
  metodologie: [
    'organizarea de șantier și predarea amplasamentului',
    'trasarea și identificarea rețelelor existente (sondaje)',
    'câte un subcapitol pentru FIECARE categorie de lucrări din proiect / listele de cantități (de ex. săpătură și sprijiniri, pat și pozare, îmbinări / sudură pe tipul de material, subtraversări / foraj, cămine și armături, branșamente / racorduri, hidranți sau stații, după caz), fiecare cu: succesiunea operațiilor, materialele cu specificația din proiect (material, clasă, SDR / PN, diametre), utilajele și echipa din pachet, controalele și punctele de oprire',
    'probele (presiune, etanșeitate, spălare / dezinfecție sau curățare, după caz) cu parametrii din proiect',
    'umpluturi, compactare, refacerea sistemului rutier și a terenului',
    'recepția, documentele de calitate și cartea tehnică',
  ],
  calitate: ['organizarea sistemului de calitate pe contract (responsabili, RTE, CQ)', 'planul de control al calității, verificări și încercări (PCCVI) pe fazele lucrării din proiect', 'fazele determinante / puncte de oprire și cine participă', 'laboratoare, încercări, buletine', 'neconformități și acțiuni corective', 'înregistrări și documente de calitate'],
  ssm: ['evaluarea riscurilor specifice lucrărilor din proiect (săpături, lucru lângă rețele, trafic, utilaje)', 'măsuri de prevenire pe faze', 'instruire și echipament de protecție', 'situații de urgență, PSI, prim ajutor', 'responsabili'],
  social: ['respectarea legislației muncii și a salarizării (contracte, salariul minim, timp de lucru)', 'sănătatea și securitatea în muncă pe șantier', 'relația cu comunitatea și riveranii (acces, zgomot, program)', 'subcontractanți și lanțul de aprovizionare, doar dacă sunt declarați'],
  mediu: ['aspecte de mediu ale lucrărilor din proiect (praf, zgomot, deșeuri, sol, ape)', 'gestionarea deșeurilor pe categorii, cu evidență', 'măsuri la scurgeri accidentale', 'refacerea amplasamentului', 'responsabili și înregistrări'],
  organizare: ['amplasamentul și constrângerile lui din proiect (trafic, utilități existente, acces riverani, teren)', 'soluțiile de execuție pe fiecare constrângere', 'semnalizare și devieri de circulație', 'coordonarea cu deținătorii de utilități'],
}

// Cuvintele-cheie (fără diacritice, prefixe) după care se aleg ferestrele din documentație, pe tip
const CHEI = {
  metodologie: ['sapatur', 'tranşe', 'transe', 'pozar', 'pat de nisip', 'umplutur', 'compact', 'sudur', 'electrofuz', 'subtravers', 'foraj', 'camin', 'vana', 'vane', 'robinet', 'hidrant', 'bransament', 'racord', 'proba', 'presiune', 'etanse', 'spalar', 'dezinfect', 'refacer', 'sistem rutier', 'adancime', 'sprijinir', 'pehd', 'pe 100', 'pe100', 'sdr', 'pn', 'diametr', 'dn', 'de 110', 'otel', 'izolat', 'protectie catodic', 'trasar', 'receptie'],
  calitate: ['calitat', 'control', 'verificar', 'incercar', 'laborator', 'faze determinante', 'receptie', 'buletin', 'neconform', 'proba'],
  ssm: ['securitat', 'sanatat', 'protectie a muncii', 'risc', 'sprijinir', 'semnaliz', 'incendi', 'urgen', 'prim ajutor'],
  social: ['munc', 'salari', 'personal', 'riveran', 'program de lucru'],
  mediu: ['mediu', 'deseu', 'zgomot', 'praf', 'sol', 'apa', 'refacer', 'vegetat'],
  organizare: ['amplasament', 'trafic', 'circulat', 'acces', 'utilitat', 'retele existente', 'organizare de santier', 'teren'],
}
export const cuvinteCheie = (tip) => CHEI[tip] || CHEI.metodologie

// Normativele citate într-un text (listă albă pentru citare): STAS, SR / SR EN (ISO), NP, I/C/GP + nr-an, NTPEE, legi, HG, ordine.
const RE_NORM = /\b(?:SR\s+EN(?:\s+ISO)?\s*\d{2,5}(?:[-:/.]\d+)*|SR\s+ISO\s*\d{2,5}(?:[-:/.]\d+)*|SR\s*\d{3,5}(?:[-:/.]\d+)*|STAS\s*\d{2,5}(?:[-:/.]\d+)*|NP\s*[-‐]?\s*\d{2,3}(?!\d)(?:\s*[-/]\s*\d{2,4})?|GP\s*[-‐]?\s*\d{2,3}(?!\d)(?:\s*[-/]\s*\d{2,4})?|[IC]\s?\d{1,3}\s*[-/]\s*(?:(?:19|20)\d{2}|\d{2})|NTPEE(?:[-\s]?20\d{2})?|Legea\s+(?:nr\.\s*)?\d{1,4}\/\d{4}|H\.?G\.?\s+(?:nr\.\s*)?\d{1,4}\/\d{4}|Ordinul\s+(?:[A-Z]+\s+)?(?:nr\.\s*)?\d{1,5}\/\d{4})(?![\d/:]|[-.]\s*\d)/g
const curata = (s) => s.replace(/\s+/g, ' ').replace(/\s*([-/:])\s*/g, '$1').replace(/^(NP|GP)-/, '$1 ').trim()
export function normativeDin(text) {
  const out = new Map()
  for (const m of String(text || '').matchAll(RE_NORM)) {
    const n = curata(m[0])
    // aceeași normă scrisă diferit („HG 395/2016” / „H.G. nr. 395/2016”, „NP 133-2022” / „NP133/2022”) = o singură intrare
    const k = n.toUpperCase().replace(/\bNR\.?/g, '').replace(/[\s.]/g, '').replace(/\//g, '-')
    if (!out.has(k)) out.set(k, n)
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b, 'ro'))
}

// Ferestre de text în jurul cuvintelor-cheie: cele mai bogate (cele mai multe chei distincte), fără suprapuneri, în ordinea din document.
// Pagina se ia din marcajele ⟦PAGINA n⟧ ale extragerii, când există.
export function ferestre(text, chei, { latime = 900, max = 8 } = {}) {
  const t = String(text || '')
  if (!t || !chei?.length) return []
  // fără diacritice, caracter cu caracter: pozițiile din `tn` rămân aceleași cu cele din `t` (un caracter care nu se poate reduce
  // la aceeași lungime rămâne doar cu litere mici)
  const tn = Array.from(t, ch => { const f = fara(ch); return f.length === ch.length ? f : ch.toLowerCase().slice(0, ch.length).padEnd(ch.length, ' ') }).join('')
  const candidati = []
  const pas = Math.max(200, Math.floor(latime / 2))
  for (let start = 0; start < tn.length; start += pas) {
    const bucata = tn.slice(start, start + latime)
    const poz = chei.map(k => bucata.indexOf(fara(k))).filter(i => i >= 0)
    const gasite = new Set(chei.filter(k => bucata.includes(fara(k))))
    if (gasite.size >= 2) candidati.push({ start, scor: gasite.size, prima: start + Math.min(...poz) })
  }
  candidati.sort((a, b) => b.scor - a.scor || a.start - b.start)
  const alese = []
  for (const c of candidati) {
    if (alese.length >= max) break
    if (alese.some(a => Math.abs(a.start - c.start) < latime)) continue
    alese.push(c)
  }
  alese.sort((a, b) => a.start - b.start)
  // pagina = a primei potriviri din fereastră (fereastra poate începe pe pagina dinainte)
  return alese.map(a => ({ start: a.start, pagina: paginaLa(t, a.prima), text: t.slice(a.start, a.start + latime).replace(/\s+/g, ' ').trim() }))
}
export function paginaLa(text, poz) {
  const re = /⟦PAGINA (\d+)⟧/g
  let m, p = null
  while ((m = re.exec(text)) && m.index <= poz) p = Number(m[1])
  return p
}

// Documentele din care se iau extrasele tehnice: partea scrisă / memoriul proiectului și caietul de sarcini (nu fișa de date,
// nu formularele, nu listele de cantități uriașe, nu răspunsurile la clarificări — acelea intră deja în pachet).
export function esteDocTehnic(d) {
  const tip = String(d?.tip || ''), nume = fara(d?.nume_original)
  if (['cs_volum', 'caiet_sarcini', 'memoriu', 'memoriu_tehnic', 'proiect_tehnic'].includes(tip)) return true
  if (['fisa_date', 'formular', 'lista_cantitati', 'raspuns_clarificare', 'model_contract'].includes(tip)) return false
  return /parte scris|piese scrise|memoriu|caiet de sarcini|caietul de sarcini|specificati.*tehnic|proiect tehnic/.test(nume)
}

// Blocul pentru prompt: normativele (listă albă) + ferestrele, cu plafon total de caractere (marcat explicit când taie, L12).
export function blocTehnic(docs, tip, { maxCar = 16000, latime = 900, perDoc = tip === 'metodologie' ? 16 : 8 } = {}) {
  const tehnice = (docs || []).filter(d => esteDocTehnic(d) && typeof d.text_extras === 'string' && d.text_extras.trim())
  const norme = normativeDin(tehnice.map(d => d.text_extras).join('\n'))
  const chei = cuvinteCheie(tip)
  const parti = []
  let total = 0, taiat = false
  for (const d of tehnice) {
    for (const f of ferestre(d.text_extras, chei, { latime, max: perDoc })) {
      const linie = `[${d.nume_original}${f.pagina ? ', p. ' + f.pagina : ''}] ${f.text}`
      if (total + linie.length > maxCar) { taiat = true; break }
      parti.push(linie); total += linie.length
    }
    if (taiat) break
  }
  return { docuri: tehnice.length, norme, extrase: parti, taiat }
}
