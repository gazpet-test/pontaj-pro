// Rețete bazate pe UI existent; pur, fără I/O, nu pornește browser/BD.
// Parametrii fixture.retete sunt completați din preview și DOM-ul clonei.
import { contracte } from './contracte.js'
import { costFaza } from './costuri.js'

const click = selector => ({ tip: 'click', selector })
const scrie = (selector, text) => ({ tip: 'scrie', selector, text })
const asteapta = selector => ({ tip: 'asteapta', selector, ms: 120000 })
const confirma = text => ({ tip: 'confirma', accept: true, ...(text === undefined ? {} : { text }) })
const observa = (selector, disabled = true) => ({ tip: 'observa', selector, asteptat: { disabled }, la_esec: 'BYPASS' })
const exists = (tabela, where, asteptat, la_esec = 'MISSING_LINK') => ({ tip: 'exists', tabela, where, asteptat, la_esec })
const count = (tabela, where, valoare) => ({ tip: 'count', tabela, where, valoare, la_esec: 'BYPASS' })
const chain = (cerinta_id, veriga, stare) => ({ tip: 'chain', cerinta_id, veriga, stare, la_esec: 'FALSE_GREEN' })
const phase = (actiuni, postconditii, final) => ({ actiuni, postconditii, ...(final ? { asteapta: final, timeout_ms: 120000 } : {}) })
const txtCap = 'css=textarea[placeholder="Textul capitolului, așa cum intră în propunere."]'
const salveazaCap = 'text=Salvează (versiune nouă)'
const aproba = 'text=🔏 Aprobă pachetul'
const recipes = {}
function add(pas, nume, required, build, sursa) { recipes[`${pas}/${nume}`] = { required, build, sursa } }

// Parametrii *_selector trebuie observați în DOM și să identifice un singur obiect.
add('01_seap_documente', 'import_copie', ['fisiere', 'nume', 'size_bytes', 'final_selector'], (p, f) => phase([
  { tip: 'incarca', selector: 'css=input[type="file"][multiple]:not([webkitdirectory])', fisiere: p.fisiere },
], [exists('ofertare_documente_atribuire', { licitatie_id: f.licitatie_id, nume_original: p.nume }, { size_bytes: p.size_bytes, status_procesare: 'neprocesat' })], p.final_selector), 'OfertareLicitatii.jsx:1379,834')

add('02_citire', 'citire_integrala', ['doc_id', 'pagini', 'final_selector'], (p, f) => phase([
  click('text=☁️ Pe server'),
], [exists('ofertare_ingest_coada', { licitatie_id: f.licitatie_id }, { activ: false }),
  exists('ofertare_documente_atribuire', { id: p.doc_id }, { status_procesare: 'procesat', pagini: p.pagini, pagini_procesate: p.pagini })], p.final_selector), 'OfertareLicitatii.jsx:1393; complet doar pentru fixture integral')

add('03_cerinte', 'confirmare_umana', ['cerinta_id', 'actor_id', 'confirma_selector', 'final_selector'], (p) => phase([
  click(p.confirma_selector),
], [exists('ofertare_cerinte', { id: p.cerinta_id }, { confirmata_de: p.actor_id })], p.final_selector), 'OfertareLicitatii.jsx:2191')
add('03_cerinte', 'corectie', ['cerinta_id', 'corectez_selector', 'text_selector', 'text', 'actor_id', 'final_selector'], (p) => phase([
  click(p.corectez_selector), scrie(p.text_selector, p.text), click('text=💾 Salvează corecția'),
], [exists('ofertare_cerinte', { id: p.cerinta_id }, { text_cerinta: p.text.trim(), confirmata_de: p.actor_id, extras_de_ai: false })], p.final_selector), 'OfertareLicitatii.jsx:2192,2251,2073')

for (const old of [289, 290, 333]) add('04_clarificari', `leaga_${old}`, ['clarificare_id', 'document_id', 'deschide_selector', 'bifa_selector', 'nr_selectate', 'final_selector'], (p) => phase([
  click(p.deschide_selector), click(p.bifa_selector), click(`text=🔗 Leagă (${p.nr_selectate})`),
], [exists('ofertare_clarificari', { id: p.clarificare_id }, { raspuns_document_id: p.document_id, status: 'raspunsa' })], p.final_selector), 'OfertareClarificari.jsx:455,501; ID-uri REMAPATE')

add('05_acoperire', 'alegere_umana', ['cerinta_id', 'acoperire_id', 'actor_id', 'alege_selector', 'final_selector'], (p) => phase([
  click(p.alege_selector),
], [count('ofertare_acoperire', { cerinta_id: p.cerinta_id, ales: true }, 1), exists('ofertare_acoperire', { id: p.acoperire_id }, { ales: true, ales_de: p.actor_id })], p.final_selector), 'OfertareCerinte.jsx:506; RPC fn_ofertare_alege_acoperire')
add('05_acoperire', 'verificare_scan', ['acoperire_id', 'actor_id', 'fisier_path', 'verifica_selector', 'final_selector'], (p) => phase([
  click(p.verifica_selector),
], [exists('ofertare_acoperire', { id: p.acoperire_id }, { verificat_pe_scan: true, verificat_de: p.actor_id, fisier_path: p.fisier_path })], p.final_selector), 'OfertareLicitatii.jsx:2921,2687; după citirea umană a scanului')
add('05_acoperire', 'AI_neverificata', ['cerinta_id', 'acoperire_id', 'selector'], (p) => phase([
  asteapta(p.selector),
], [exists('ofertare_acoperire', { id: p.acoperire_id }, { verificat_pe_scan: false }), chain(p.cerinta_id, 3, 'propusa')]), 'Observație a cazului negativ pregătit, nu fabricare dovadă')

add('06_cantitati', 'validare_partiala', ['cantitate_id', 'nevalidata_id', 'valideaza_selector', 'final_selector'], (p) => phase([
  click(p.valideaza_selector),
], [exists('ofertare_cantitati', { id: p.cantitate_id }, { status: 'validat' }), exists('ofertare_cantitati', { id: p.nevalidata_id }, { status: 'extras' })], p.final_selector), 'OfertareCantitati.jsx:238')
add('06_cantitati', 'diferenta_blocheaza', ['cantitate_id', 'pachete_count'], (p, f) => phase([
  observa(aproba),
], [exists('ofertare_cantitati', { id: p.cantitate_id }, { status: 'diferenta' }), count('ofertare_pt_pachet', { licitatie_id: f.licitatie_id }, p.pachete_count)]), 'OfertarePropunere.jsx:2081; blocaj UI, nu probă API')

add('07_grafic', 'inghetare', ['mod', 'versiune_noua', 'actor_id', 'are_activitati', 'final_selector'], (p, f) => phase([
  click(`text=⚙️ Generează grafic (${p.mod === 'oferta' ? 'ofertă' : 'intern'})`),
  ...(p.are_activitati ? [confirma()] : []),
], [exists('grafic_versiuni', { licitatie_id: f.licitatie_id, versiune: p.versiune_noua }, { mod: p.mod, generat_de: p.actor_id })], p.final_selector), 'GraficPoarta.jsx:372,313')

for (const tag of ['D1', 'D6', 'D8']) add('08_pt', `verifica_${tag}`, ['legatura_id', 'capitol_id', 'versiune', 'actor_id', 'locator', 'verifica_selector', 'final_selector'], (p, f) => phase([
  click(p.verifica_selector), confirma(p.locator),
], [exists('ofertare_pt_legaturi', { id: p.legatura_id, cerinta_id: f.cerinte[tag] }, { capitol_id: p.capitol_id, stare: 'verificata', confirmat_de: p.actor_id, locator_raspuns: p.locator, verificat_la_versiunea: p.versiune }), chain(f.cerinte[tag], 5, 'ok')], p.final_selector), 'OfertarePropunere.jsx:452,1752')
for (const [pas, nume] of [['08_pt', 'editeaza_dupa_verificare'], ['09_verificari', 'modificare_versiune']]) add(pas, nume, ['capitol_id', 'cerinta_id', 'text', 'versiune_noua', 'stare_lant_asteptata', 'deschide_editor_selector', 'final_selector'], (p) => phase([
  click(p.deschide_editor_selector), scrie(txtCap, p.text), click(salveazaCap),
], [exists('ofertare_pt_capitole', { id: p.capitol_id }, { continut: p.text, versiune: p.versiune_noua }), chain(p.cerinta_id, 5, p.stare_lant_asteptata)], p.final_selector), 'OfertareRevizii.jsx:166,172; stare așteptată veche/propusa după trigger')

// Pe clona 103 blocată nu există traseu UI către aprobarea/depunerea pachetului.
// Starea neschimbată + disabled probează numai UI, niciodată serverul.
const unchangedSet = (tabela, where = {}) => ({ tip: 'unchanged_set', tabela, where, la_esec: 'BYPASS' })
const porti = f => [
  exists('v_ofertare_cantitati_nevalidate', { licitatie_id: f.licitatie_id }, { lista_f3_nevalidate: 62 }),
  { tip: 'nonempty', tabela: 'v_ofertare_seap_completitudine', where: { licitatie_id: f.licitatie_id }, camp: 'blocaj', la_esec: 'MISSING_LINK' },
]
for (const nume of ['pachet_incomplet', 'aprobare', 'semnare_poarta']) add('10_pachet', nume, ['selector'], (p, f) => ({
  ...phase([observa(p.selector)], [
    ...porti(f), unchangedSet('ofertare_pt_pachet'), unchangedSet('ofertare_pt_pachet_fisiere'),
    unchangedSet('ofertare_pt_poarta'), unchangedSet('ofertare_derogari_audit'),
  ]), preconditii: porti(f), verdict_succes: 'UI_ONLY',
  limita: 'REFUZ UI; nicio tentativă server. Refuzul R5/R12 la aprobat/depus rămâne UNDETERMINED.',
}), 'OfertarePropunere.jsx:2081–2089; blocat dezactivează ambele controale')

add('11_depunere', 'status_depusa', ['final_selector'], (p, f) => ({
  ...phase([click('text=📝 Detalii & decizie'), click('text=📮 Marchează Depusă'),
    asteapta(p.final_selector)], [
    ...porti(f), unchangedSet('ofertare_licitatii'), unchangedSet('ofertare_pt_pachet'),
    unchangedSet('ofertare_pt_pachet_fisiere'), unchangedSet('ofertare_derogari_audit'),
  ]),
  preconditii: [...porti(f), exists('ofertare_licitatii', { id: f.licitatie_id }, { status: 'in_lucru', derogare_depunere: false }),
    count('ofertare_pt_pachet', { licitatie_id: f.licitatie_id }, 0)],
  refuz_server: { tabela: 'ofertare_licitatii', id: f.licitatie_id, metoda: 'PATCH', status: 400 },
  limita: 'Primul refuz este lipsa pachetului depus. R5/R12 sunt active, dar acest click nu izolează execuția lor.',
}), 'OfertareLicitatii.jsx:326–331,3675; fn_gate_depunere J05')

for (const tag of ['D1', 'D6', 'D8']) add('12_comparatie', `matrice_${tag}`, ['verigi_asteptate'], (p, f) => phase([
  asteapta(`text=🔗 Lanțul dovezii · cerința #${f.cerinte[tag]}`),
], Object.entries(p.verigi_asteptate).map(([v, stare]) => chain(f.cerinte[tag], Number(v), stare))), 'OfertareLantProbator.jsx:53; observă numai, nu certifică ground truth')

add('16_restart_worker', 'porneste_citire', ['actor_id', 'final_selector'], (p, f) => phase([
  click('text=☁️ Pe server'),
], [exists('ofertare_ingest_coada', { licitatie_id: f.licitatie_id }, { activ: true, cerut_de: p.actor_id })], p.final_selector), 'OfertareLicitatii.jsx:1393,787; checkpoint, restart extern')
add('16_restart_worker', 'dupa_restart', ['doc_id', 'pagini', 'final_selector'], (p, f) => phase([
  asteapta(p.final_selector),
], [exists('ofertare_ingest_coada', { licitatie_id: f.licitatie_id }, { activ: false }), exists('ofertare_documente_atribuire', { id: p.doc_id }, { status_procesare: 'procesat', pagini_procesate: p.pagini })]), 'OfertareLicitatii.jsx:1421; restart probat separat de operator')

const imposibil = {
  '01_seap_documente/inlocuire_acelasi_nume': 'Uploadul existent dedup nume+mărime sau adaugă document; nu este înlocuire a obiectului.',
  '01_seap_documente/document_lipsa': 'Nu există control identificat pentru ștergere Storage cu manifest păstrat.',
  '09_verificari/verificare_finala': 'Prompt sensibil și URL Edge live hardcodat; necesită pregătire explicită de operator, nu rețetă implicită.',
  '10_pachet/asamblare': 'Handlerul Aprobă pachetul execută generare+upload+aprobare împreună; nu inventăm pas separat.',
  '10_pachet/upload_readback_hash': 'SELECT și SHA declarat nu verifică bytes; este necesară comparație de fișier separată.',
  '10_pachet/modificare_fisier_dupa_aprobare': 'Nu există control UI identificat pentru această tentativă.',
  '10_pachet/AI_neverificata_blocheaza': 'R5/R12 blochează deja; nu putem atribui refuzul dovezii AI fără caz izolat.',
  '11_depunere/fara_dovada_SEAP': 'Clona are zero pachete aprobate; formularul lipsește. Disabled nu probează serverul.',
  '11_depunere/cu_depus_final_si_dovada': 'Clona blocată are zero pachete aprobate; nicio tranziție UI către depus. În plus UI scrie pt/103/, în afara prefixului 103/ autorizat.',
  '11_depunere/derogare_non_owner': 'Nu există control UI pentru derogare_depunere; probă API separată autorizată.',
  '13_concurenta_cerinta/aceeasi_cerinta': 'Necesită selectori DOM ai aceleiași cerințe și dovada istoricului ambelor variante.',
  '14_concurenta_capitol/acelasi_capitol': 'Versiunea curentă nu se află în istoricul OLD; verificarea ambelor texte cere unirea current+istoric și acceptarea ambelor ordini concurente, nu rezultat final ghicit.',
  '15_concurenta_acoperire/aceeasi_acoperire': 'Necesită selectori DOM ai celor doi candidați și istoricul alegerii; unicitatea finală singură nu ajunge.',
}

export const PARAMETRI_EXEMPLU = Object.fromEntries(Object.entries(recipes).map(([key, r]) => [key, Object.fromEntries(r.required.map(k => [k, null]))]))

/** Returnează copie de fixture, cu fazele completabile și lista explicită a limitelor.
 * Nu suprascrie faze configurate manual. Nu deduce ID-uri, selectori de rând sau verdicte.
 */
export function retete(fixture) {
  const out = structuredClone(fixture)
  out.scenarii ||= {}; out.retete_neconfigurate = []
  const validL = fixture.licitatie_id === 103
  for (const [pas, contract] of Object.entries(contracte)) {
    const cfg = out.scenarii[pas] ||= { preconditii: [], faze: {} }; cfg.faze ||= {}
    // Gardă minimă; precondițiile business se păstrează dacă operatorul le-a configurat.
    if (!cfg.preconditii?.length && validL && /^SANDBOX-V2-.+/.test(fixture.nr_anunt || '')) cfg.preconditii = [exists('ofertare_licitatii', { id: fixture.licitatie_id }, { nr_anunt: fixture.nr_anunt })]
    for (const name of contract.faze) {
      const cost = costFaza(pas, name)
      cfg.faze[name] = { ...cfg.faze[name], ...cost }
      if (cfg.faze[name]?.actiuni?.length && cfg.faze[name]?.postconditii?.length) continue
      const key = `${pas}/${name}`, r = recipes[key], p = fixture.retete?.[key] || {}
      const absent = r?.required.filter(k => p[k] == null || p[k] === '' || Array.isArray(p[k]) && !p[k].length || typeof p[k] === 'object' && !Array.isArray(p[k]) && !Object.keys(p[k]).length) || []
      if (!validL || !r || absent.length) {
        const motiv = !validL ? 'ID clonă necompletat/invalid' : imposibil[key] || p.motiv_indisponibil || (!r ? 'Necesită selectori DOM și postcondiții specifice fixture-ului; vezi RETETE_UI.md.' : `Completează fixture.retete[${JSON.stringify(key)}]: ${absent.join(', ')}`)
        cfg.faze[name] = { ...cost, actiuni: [], postconditii: [], motiv_indisponibil: motiv }
        out.retete_neconfigurate.push({ pas, faza: name, motiv }); continue
      }
      cfg.faze[name] = { ...cost, ...r.build(p, fixture), sursa_reteta: r.sursa }
      const generated = cfg.faze[name]
      if (!generated.refuz_server && generated.actiuni.some(a => ['click', 'scrie', 'incarca'].includes(a.tip))) {
        // Un rând deja în starea dorită nu dovedește executarea acțiunii curente.
        for (const a of [...generated.postconditii]) if (a.tip === 'exists') generated.postconditii.push({
          tip: 'changed_set', tabela: a.tabela, where: a.where, la_esec: 'IMPLEMENTED_BUT_NOT_USED',
        })
      }
      // Obiectul concurent rămâne cel configurat explicit și verificat în snapshot.
    }
  }
  return out
}
