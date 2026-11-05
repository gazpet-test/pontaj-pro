import { completeazaDocx, hashBlob, formatDataRo, formatNumarRo, ETICHETA_CALITATE,
  caleAdresaUat, versiuneMaximaInBucket, MIME_DOCX, MAX_INCERCARI_VERSIUNE } from './docx.js'
import { ultimulRaspuns } from './stare.js'
import { mentiuneAr } from './arMentiune.js'

export const ROLURI_PV_A = ['proprietar','coproprietar','mostenitor','neidentificat','utilizator','arendas']
// Contract identic cu regexp_match din fn_red_pv_calitate_semnatar; maxim 9 cifre (fara overflow).
export function citesteCalePvA(path, {proiectCod,uat3,nrPv}) {
  if (typeof path !== 'string') return null
  const m=/^([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Z]{3})\/pv\/(PVA-[A-Z]{3}-[0-9]{4})_v([1-9][0-9]{0,8})_(proprietar|coproprietar|mostenitor|neidentificat|utilizator|arendas)[.]docx$/.exec(path)
  if (!m || m[0] !== path || m[1].includes('..') || m[1]!==proiectCod || m[2]!==uat3 || m[3]!==nrPv) return null
  return {versiune:Number(m[4]),calitate:m[5]}
}
export function versiuneCurentaPvA(path, cheie) {
  if (path == null) return 0
  const curent=citesteCalePvA(path,cheie)
  if (curent) return curent.versiune
  // Legacy fara calitate_document: trebuie regenerat, pastrand totusi versiunea numerica.
  const m=/_v([1-9][0-9]{0,8})[.]docx$/.exec(path)
  if (m && path===calePv({...cheie,calitate:undefined,versiune:Number(m[1])})) return Number(m[1])
  throw new Error('Versiunea DOCX curenta nu poate fi determinata; reincarca.')
}
export function verificaCaleNouaPvA(path, cheie, caleCurenta, calitate) {
  const nou=citesteCalePvA(path,cheie)
  if (!nou || nou.calitate!==calitate) return false
  try { return nou.versiune > versiuneCurentaPvA(caleCurenta,cheie) } catch { return false }
}

// Rolul folosit in DOCX este preconditie; serverul il verifica sub lock.
export function patchGenerarePv({pv, detinator, proiect, uat}, path) {
  if (pv.tip !== 'A') return {fisier_generat_path:path}
  if (!ROLURI_PV_A.includes(detinator?.calitate)) {
    throw new Error('Calitatea detinatorului lipseste; reincarca inainte de generare.')
  }
  if (!verificaCaleNouaPvA(path,{proiectCod:proiect?.cod,uat3:uat?.uat3,nrPv:pv.nr_pv},pv.fisier_generat_path,detinator.calitate)) throw new Error('Cale sau versiune DOCX invalida; regenereaza.')
  return {fisier_generat_path:path, calitate_document:detinator.calitate}
}
export function cheiCasPv(pv, chei) {
  return ['semnat','anulat'].includes(pv.stare) ? chei : chei.filter(k => k !== 'calitate_semnatar')
}
export function pvComparabil(pv) {
  if (!pv || pv.tip !== 'A' || ['semnat','anulat'].includes(pv.stare)) return pv
  const {calitate_semnatar, ...editabile} = pv
  return editabile
}

export const BIFA_DA = "\u2612"
export const BIFA_NU = "\u2610"
export const LUCRARI = ['sol_fertil', 'nivelare', 'arat', 'discuit', 'insamantare', 'gard', 'drum', 'altele']
export const STARI_TEREN = ['nivelat', 'strat_vegetal', 'insamantat', 'gard_drum', 'alta']
// Modelele Final_v2 (03.11.2026): fără fotografii în PV A și PV B; PV B fără topo / plan de situație și fără jurnal de șantier.
// foto_nr, plan_situatie și jurnal_santier_ref rămân în BD, dar nu mai apar în documente (lista = cheile din șablon, pv.test.js).
export const CHEI_PV_A = [
  'act_doveditor','act_identitate','alte_observatii','bifa_altele','bifa_arat','bifa_constatare_sediu',
  'bifa_constatare_teren','bifa_cu_obiectii','bifa_da','bifa_da_cu_obiectii','bifa_discuit','bifa_drum',
  'bifa_fara_obiectii','bifa_gard','bifa_insamantare','bifa_nivelare',
  'bifa_plan_da','bifa_plan_nu','bifa_sol_fertil','bifa_st_alta','bifa_st_gard_drum','bifa_st_insamantat',
  'bifa_st_nivelat','bifa_st_strat_vegetal','calitate_cota','categoria_folosinta','categoria_initiala',
  'contract_data','contract_nr','data_pv','locul','lucrari_altele','nr_cadastral','nr_pv','nume',
  'obiectii_text','poz_hg','proiect_denumire','reverificare_la','sat','semnatar_detinator','semnatar_gazpet',
  'semnatar_tgz','stare_teren_alta','suprafata','tarla','termen_remediere','tronson','uat','verificare_data','verificare_de',
]
const plin = v => v != null && String(v).trim() !== ''
const bifa = v => v === true ? BIFA_DA : BIFA_NU
export function propuneLucrari(articolDeviz) {
  const t = String(articolDeviz ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const cuvinte = { sol_fertil: /fertil|decopert/, nivelare: /nivel/, arat: /arat/, discuit: /discu/,
    insamantare: /insamant|semanat/, gard: /gard/, drum: /drum/ }
  return { ...Object.fromEntries(Object.entries(cuvinte).map(([k, rx]) => [k, rx.test(t)])), altele: '' }
}
// L3 / D5 (04.11.2026): valori implicite la crearea PV A / PV B, ca PV-ul să se poată genera fără tastare când datele există.
// Sunt propuneri editabile; garda verificaDatePvA / verificaDatePvB rămâne neschimbată. Se completează DOAR câmpurile goale.
// Starea terenului se propune din lucrările din deviz (aceeași sursă ca propuneLucrari); fără potrivire -> rămâne goală și garda cere bifa
// (decizie conservatoare 04.11.2026: PV-ul e document juridic, fără rezervă „nivelat”).
export const STARE_DIN_LUCRARI = { nivelare: 'nivelat', sol_fertil: 'strat_vegetal', insamantare: 'insamantat', gard: 'gard_drum', drum: 'gard_drum' }
const ZILE_SESIUNE_UAT = ['sesiune_zi1', 'sesiune_zi2', 'sesiune_zi3']
export function loculImplicit({ uat = {}, parcela = {}, mod = 'sediu' } = {}) {
  const nume = String(uat.nume ?? '').trim()
  if (!nume) return ''
  if (mod === 'teren') return ['Pe teren', plin(parcela.sat) ? 'sat ' + String(parcela.sat).trim() : '', 'UAT ' + nume].filter(Boolean).join(', ')
  return 'Sediul Primăriei ' + nume + (plin(uat.primarie_adresa) ? ', ' + String(uat.primarie_adresa).trim() : '')
}
export function propuneStareTeren(lucrari) {
  const st = {}
  for (const [k, v] of Object.entries(STARE_DIN_LUCRARI)) if (lucrari?.[k] === true) st[v] = true
  return Object.keys(st).length ? st : null
}
// raspuns = ultimul răspuns al deținătorului (doar PV A). laCreare: data_pv vine din RPC (azi) și poate fi înlocuită cu ziua aleasă.
export function valoriImplicitePv({ tip = 'A', pv = {}, uat = {}, parcela = {}, raspuns = null, laCreare = false } = {}) {
  if (!pv || tip === 'C' || ['semnat', 'anulat'].includes(pv.stare)) return {}
  const patch = {}
  const optiune = tip === 'A' ? raspuns?.optiune : null
  if (pv.lucrari == null) patch.lucrari = propuneLucrari(parcela.articol_deviz)
  // Copilot #990 P2-01: doar câmpurile NEDECISE (null) primesc propuneri; o alegere salvată (false, {}, bife toate false) nu se rescrie
  if (pv.stare_teren == null) {
    const st = propuneStareTeren(patch.lucrari ?? pv.lucrari)
    if (st) patch.stare_teren = st
  }
  if (tip === 'A' && pv.constatare_mod == null) patch.constatare_mod = optiune === 'constatare_teren' ? 'teren' : 'sediu'
  if (!plin(pv.locul)) {
    const locul = loculImplicit({ uat, parcela, mod: patch.constatare_mod ?? pv.constatare_mod ?? 'sediu' })
    if (locul) patch.locul = locul
  }
  // data = ziua de sesiune aleasă de deținător (doar dacă e una dintre zilele UAT-ului); altfel rămâne data din RPC
  const zi = optiune === 'particip' ? String(raspuns?.zi_sesiune_aleasa ?? '').slice(0, 10) : ''
  const ziValida = zi !== '' && ZILE_SESIUNE_UAT.some(k => String(uat[k] ?? '').slice(0, 10) === zi)
  if (ziValida && (laCreare || !plin(pv.data_pv)) && pv.data_pv !== zi) patch.data_pv = zi
  // Jakarinos #990 P1-1 / P2-3: și „constatare pe teren” poartă obiecții (schema cere textul); textul se copiază EXACT (plin() doar validează)
  // obiectii_redare e NOT NULL DEFAULT false în BD: false salvat nu se poate deosebi de „nedecis” -> obiecțiile se propun DOAR la creare
  if (laCreare && OPTIUNI_CU_OBIECTII.includes(optiune) && pv.obiectii_redare !== true && !plin(pv.obiectii_text) && plin(raspuns?.obiectii_text)) {
    patch.obiectii_redare = true
    patch.obiectii_text = raspuns.obiectii_text
  }
  return patch
}
const OPTIUNI_CU_OBIECTII = ['nu_particip_cu_obiectii', 'constatare_teren']
// Jakarinos #990 P1-2: amprenta surselor din care s-au calculat implicitele (UAT, parcelă, ultimul răspuns)
export function amprentaSurseImplicite({ uat = {}, parcela = {}, raspuns = null } = {}) {
  return JSON.stringify([uat?.id ?? null, uat?.versiune ?? null, uat?.nume ?? null, uat?.primarie_adresa ?? null,
    ...ZILE_SESIUNE_UAT.map(k => uat?.[k] ?? null), parcela?.id ?? null, parcela?.articol_deviz ?? null, parcela?.sat ?? null,
    raspuns?.id ?? null, raspuns?.seq ?? null, raspuns?.optiune ?? null, raspuns?.zi_sesiune_aleasa ?? null, raspuns?.obiectii_text ?? null])
}
// Salvarea implicitelor la creare, fără date vechi tăcute: recitește sursele înainte de UPDATE; dacă s-au schimbat față de calcul,
// recalculează și cere confirmare; după UPDATE recitește încă o dată și raportează o schimbare apărută între timp (nu o ascunde).
// recitesteSurse() -> { pv, uat, parcela, raspuns }; confirma(patch) -> boolean;
// scrie(pv, patch, cheiCas) -> { rand } (1 rând) | { conflict: true } (0 rânduri) | { ambiguu: true } (eroare / rezultat neclar).
// Jakarinos #990 r2 P1: CAS pe toate câmpurile PV citite de valoriImplicitePv, nu doar pe cheile din patch.
export const CHEI_PV_IMPLICITE = ['lucrari', 'stare_teren', 'constatare_mod', 'locul', 'data_pv', 'obiectii_redare', 'obiectii_text']
// Rezultate: nimic | renuntat | conflict (nescris) | necunoscut (UPDATE ambiguu) | salvat (+ schimbatDupa / neverificat)
export async function salveazaImpliciteLaCreare({ tip, sursa, recitesteSurse, scrie, confirma }) {
  const calc = (s) => valoriImplicitePv({ tip, pv: s.pv, uat: s.uat, parcela: s.parcela, raspuns: s.raspuns, laCreare: true })
  const initial = calc(sursa)
  if (!Object.keys(initial).length) return { stare: 'nimic', patch: {} }
  const proaspat = await recitesteSurse()
  if (!proaspat?.pv || proaspat.pv.id !== sursa.pv?.id) throw new Error('PV schimbat între citire și completarea automată; reîncarcă.')
  const patch = calc(proaspat)
  if (!Object.keys(patch).length) return { stare: 'nimic', patch: {} }
  const schimbat = amprentaSurseImplicite(proaspat) !== amprentaSurseImplicite(sursa) || JSON.stringify(patch) !== JSON.stringify(initial)
  if (schimbat && !(await confirma(patch))) return { stare: 'renuntat', patch }
  const cheiCas = [...new Set([...CHEI_PV_IMPLICITE, ...Object.keys(patch)])]
  let r
  try { r = await scrie(proaspat.pv, patch, cheiCas) } catch { return { stare: 'necunoscut', patch } }
  if (r?.conflict) return { stare: 'conflict', patch }
  if (!r?.rand) return { stare: 'necunoscut', patch }
  // Jakarinos #990 r2 P2: scrierea confirmată rămâne confirmată chiar dacă reverificarea surselor eșuează
  let dupa
  try { dupa = await recitesteSurse() } catch { return { stare: 'salvat', patch, pv: r.rand, neverificat: true, schimbatDupa: false } }
  return { stare: 'salvat', patch, pv: r.rand, neverificat: false, schimbatDupa: amprentaSurseImplicite(dupa) !== amprentaSurseImplicite(proaspat) }
}
export function verificaDatePvA({ proiect = {}, uat = {}, parcela = {}, detinator = {}, pv = {} }) {
  const lipsuri = []
  for (const [v, et] of [[proiect.contract_nr,'numarul contractului'],[proiect.contract_data,'data contractului'],
    [uat.nume,'UAT'],[detinator.nume,'numele detinatorului'],[pv.data_pv,'data PV'],[pv.locul,'locul']]) {
    if (!plin(v)) lipsuri.push(et)
  }
  if (!['sediu','teren'].includes(pv.constatare_mod)) lipsuri.push('modul constatarii')
  if (!STARI_TEREN.slice(0,-1).some(k => pv.stare_teren?.[k] === true) && !plin(pv.stare_teren?.alta)) lipsuri.push('starea terenului')
  if (pv.obiectii_redare && !plin(pv.obiectii_text)) lipsuri.push('textul obiectiilor')
  return lipsuri
}
function campuriComune({ proiect = {}, uat = {}, parcela = {}, detinator = {}, pv = {} }) {
  const campuri = Object.fromEntries(CHEI_PV_A.map(k => [k, '']))
  // Draft: rol curent; semnat/anulat: exclusiv snapshot-ul inghetat de server.
  const rol = ['semnat', 'anulat'].includes(pv.stare) ? pv.calitate_semnatar : detinator.calitate
  const calitate = ETICHETA_CALITATE[rol] ?? rol ?? ''
  Object.assign(campuri, {
    contract_nr: proiect.contract_nr ?? '', contract_data: formatDataRo(proiect.contract_data),
    proiect_denumire: proiect.denumire ?? '', uat: uat.nume ?? '', nr_pv: pv.nr_pv ?? '',
    data_pv: formatDataRo(pv.data_pv), locul: pv.locul ?? '', nume: detinator.nume ?? '',
    calitate_cota: calitate + (plin(detinator.cota) ? ', cota ' + detinator.cota : ''),
    suprafata: formatNumarRo(parcela.suprafata_temporara_mp),
    categoria_initiala: parcela.categoria_folosinta ?? '', lucrari_altele: pv.lucrari?.altele ?? '',
    stare_teren_alta: pv.stare_teren?.alta ?? '',
    verificare_data: formatDataRo(parcela.verificare_data),
    verificare_de: [parcela.verificare_de_gazpet, parcela.verificare_de_tgz ? '(TGZ: ' + parcela.verificare_de_tgz + ')' : ''].filter(Boolean).join(' '),
    obiectii_text: pv.obiectii_text ?? '', termen_remediere: formatDataRo(pv.termen_remediere),
    reverificare_la: formatDataRo(pv.reverificare_la), alte_observatii: pv.alte_observatii ?? '',
    semnatar_detinator: [detinator.nume, calitate].filter(Boolean).join(', '),
    semnatar_gazpet: [proiect.reprezentant_gazpet_nume, proiect.reprezentant_gazpet_functie].filter(Boolean).join(', '),
    semnatar_tgz: [proiect.reprezentant_tgz_nume, proiect.reprezentant_tgz_functie].filter(Boolean).join(', '),
  })
  for (const k of ['sat','tarla','nr_cadastral','poz_hg','categoria_folosinta']) campuri[k] = parcela[k] ?? ''
  // Copilot f8a r3 P3: tronsonul din PV A/B e cel inghetat pe randul PV (pe el se sprijina garda BD), nu cel curent al parcelei
  campuri.tronson = pv.tronson ?? ''
  for (const k of LUCRARI) campuri['bifa_' + k] = bifa(k === 'altele' ? plin(pv.lucrari?.altele) : pv.lucrari?.[k])
  for (const k of STARI_TEREN) campuri['bifa_st_' + k] = bifa(k === 'alta' ? plin(pv.stare_teren?.alta) : pv.stare_teren?.[k])
  Object.assign(campuri, {
    bifa_da: bifa(pv.obiectii_redare === false), bifa_da_cu_obiectii: bifa(pv.obiectii_redare),
    bifa_fara_obiectii: bifa(pv.obiectii_redare === false), bifa_cu_obiectii: bifa(pv.obiectii_redare),
    bifa_plan_da: bifa(pv.plan_situatie === true), bifa_plan_nu: bifa(pv.plan_situatie === false),
    bifa_constatare_sediu: bifa(pv.constatare_mod === 'sediu'), bifa_constatare_teren: bifa(pv.constatare_mod === 'teren'),
  })
  return campuri
}
async function documentPv(campuri, templateArrayBuffer, strict) {
  const blob = await completeazaDocx(templateArrayBuffer, campuri, { strict })
  return { blob, hash: await hashBlob(blob), campuri }
}
export async function genereazaPvA(date) {
  const lipsuri = verificaDatePvA(date)
  if (date.strict !== false && lipsuri.length) throw new Error('Lipsesc: ' + lipsuri.join('; '))
  return documentPv(campuriComune(date), date.templateArrayBuffer, date.strict !== false)
}
export const MOTIVE_PV_B = ['declaratie','neprezentat','neidentificat','refuz']
export const CHEI_PV_B = [
  'afisare_data_end','afisare_data_start','afisare_pv_nr','bifa_alt_raspuns','bifa_altele','bifa_arat',
  'bifa_conv_primita','bifa_conv_returnata','bifa_discuit','bifa_drum','bifa_fara_adresa','bifa_fara_raspuns',
  'bifa_gard','bifa_insamantare','bifa_neidentificat','bifa_neprezentat',
  'bifa_nivelare','bifa_raspuns_fara_obiectii','bifa_reluare_fara_raspuns',
  'bifa_reluare_nu_e_cazul','bifa_reluare_raspuns','bifa_sit_declaratie','bifa_sit_neidentificat',
  'bifa_sit_neprezentat','bifa_sit_refuz','bifa_sol_fertil','bifa_st_alta','bifa_st_gard_drum',
  'bifa_st_insamantat','bifa_st_nivelat','bifa_st_strat_vegetal','categoria_folosinta','categoria_initiala',
  'contract_data','contract_nr','conv_data_confirmare','conv_data_expediere','conv_nr_tracking','conv_retur',
  'data_pv','locul','lucrari_altele','nr_cadastral','nr_pv','nume','poz_hg',
  'proiect_denumire','pv_a_referinta','raspuns_alt_text','raspuns_canal','raspuns_data','reluare_adresa_tgz_nr','reluare_data',
  'reluare_nr_tracking','reluare_raspuns_text','reprezentant_uat_nume','sat','semnatar_apm','semnatar_gazpet',
  'semnatar_tgz','semnatar_uat','stare_teren_alta','suprafata','tarla','tronson','uat','verificare_data',
  'verificare_de_gazpet','verificare_de_tgz','zi1','zi2','zi3',
]
// One predicate for references, recipients and the modal guard.
function pvsASemnate({ pvs = [], parcela = {} }) {
  return pvs.filter(p => parcela.id != null && p.parcela_id === parcela.id && p.tip === 'A' && p.stare === 'semnat' && p.sters_la == null)
}
export const esteUtilizator = calitate => ['utilizator', 'arendas'].includes(calitate)
// Oglinda fn_red_parcela_acoperita_a; calitatea PV semnat este istorica, fara fallback la rolul actual.
export function parcelaAcoperitaA({ detinatori = [], ...date }) {
  const semnate = pvsASemnate(date)
  if (semnate.some(p => esteUtilizator(p.calitate_semnatar))) return true
  const proprietari = detinatori.filter(d => d.sters_la == null && !esteUtilizator(d.calitate))
  const semnatari = new Set(semnate.map(p => p.detinator_id))
  return proprietari.length > 0 && proprietari.every(d => semnatari.has(d.id))
}
export function detinatoriFaraPvA({ detinatori = [], ...date }) {
  if (parcelaAcoperitaA({detinatori, ...date})) return []
  const semnatari = new Set(pvsASemnate(date).map(p => p.detinator_id))
  return detinatori.filter(d => d.sters_la == null && !semnatari.has(d.id))
}
export function referintaPvA(date) {
  const semnate = pvsASemnate(date).slice().sort((a,b) => (a.data_pv ?? '').localeCompare(b.data_pv ?? '') || a.nr_pv.localeCompare(b.nr_pv))
  if (!semnate.length) return ''
  if (parcelaAcoperitaA(date)) return 'Parcela acoperita prin PV A semnat; PV B nu este necesar.'
  // Calendar dates from DB: compare YYYY-MM-DD without timezone conversion.
  const ultimaData = semnate.map(p => p.semnat_primit_data || p.data_pv).filter(Boolean).sort().at(-1)
  const referinte = semnate.map(p => p.nr_pv + ' din ' + formatDataRo(p.data_pv)).join(', ')
  const noua = ultimaData && date.parcela?.verificare_data > ultimaData
    ? ' Verificare noua a terenului la data de ' + formatDataRo(date.parcela.verificare_data) + '.' : ''
  return 'Pe aceasta parcela exista PV A semnat: ' + referinte + '. Prezentul PV B priveste numai detinatorii fara PV A semnat.' + noua
}
export function verificaDatePvB({ proiect = {}, uat = {}, parcela = {}, pv = {}, detinatori = [], pvs = [] }) {
  const lipsuri = verificaDatePvA({proiect,uat,parcela,pv,detinator:{nume:'B'}})
    .filter(k => k !== 'modul constatarii')
  if (parcelaAcoperitaA({detinatori,pvs,parcela})) lipsuri.push('parcela acoperita prin PV A semnat')
  if (!MOTIVE_PV_B.includes(pv.motiv_pv_b)) lipsuri.push('motivul PV B')
  if (!plin(parcela.verificare_data)) lipsuri.push('data verificarii pe teren')
  if (![parcela.verificare_de_gazpet,parcela.verificare_de_tgz].some(plin)) lipsuri.push('comisia de verificare')
  if (!plin(uat.reprezentant_uat_nume)) lipsuri.push('reprezentantul UAT')
  return lipsuri
}
export function numeDestinatariPvB(activi) {
  const nume = lista => lista.map(d => d.nume).filter(plin).join('; ') || 'neidentificat'
  const utilizatori = activi.filter(d => esteUtilizator(d.calitate))
  if (!utilizatori.length) return nume(activi)
  const proprietari = activi.filter(d => !esteUtilizator(d.calitate))
  return (proprietari.length ? 'Proprietari: ' + nume(proprietari) + '\n' : '') +
    'Utilizatori / arendasi: ' + nume(utilizatori)
}
export async function genereazaPvB(date) {
  const { proiect = {}, uat = {}, parcela = {}, pv = {}, detinatori = [], convocari = [], raspunsuri = [] } = date
  const lipsuri = verificaDatePvB(date)
  if (date.strict !== false && lipsuri.length) throw new Error('Lipsesc: ' + lipsuri.join('; '))
  const comune = campuriComune(date)
  const campuri = Object.fromEntries(CHEI_PV_B.map(k => [k, comune[k] ?? '']))
  const activi = detinatoriFaraPvA(date)
  const ids = new Set(activi.map(d => d.id))
  const active = convocari.filter(c => ids.has(c.detinator_id) && c.sters_la == null && c.stare === 'activ')
  const ultima = lista => lista.slice().sort((a,b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')) || String(b.id).localeCompare(String(a.id)))[0]
  const conv = ultima(active.filter(c => c.canal === 'posta' && c.reluare !== true))
  const rel = ultima(active.filter(c => c.reluare === true))
  const rasp = ultimulRaspuns(raspunsuri.filter(r => ids.has(r.detinator_id)))
  // A response to a resending must belong to that recipient and follow its dispatch.
  const raspRel = rel && rel.data_expediere ? ultimulRaspuns(raspunsuri.filter(r => r.detinator_id === rel.detinator_id && r.data >= rel.data_expediere)) : null
  Object.assign(campuri, {
    pv_a_referinta: referintaPvA(date),
    // Pastreaza contractul sablonului: sectiuni distincte in campul multiline existent.
    nume: numeDestinatariPvB(activi),
    bifa_neidentificat:bifa(!activi.length || activi.some(d => d.calitate === 'neidentificat')),
    bifa_fara_adresa:bifa(activi.some(d => d.adresa_cunoscuta === false)),
    conv_data_expediere:formatDataRo(conv?.data_expediere), conv_nr_tracking:conv?.nr_tracking ?? '',
    // PV B ajunge la TGZ: fără textul liber de pe AR (Jakarinos f10 UI P2-1); comentariul stă pe rândul lui (Copilot + Jakarinos r2: înghițea conv_retur)
    conv_data_confirmare:formatDataRo(conv?.data_confirmare_primire) + mentiuneAr(conv, { detaliat: false }), conv_retur:conv?.retur ?? '',
    bifa_conv_primita:bifa(plin(conv?.data_confirmare_primire)), bifa_conv_returnata:bifa(plin(conv?.retur)),
    raspuns_data:formatDataRo(rasp?.data), raspuns_canal:rasp?.canal ?? '',
    raspuns_alt_text:rasp?.obiectii_text || rasp?.optiune || '',
    bifa_fara_raspuns:bifa(!rasp), bifa_raspuns_fara_obiectii:bifa(rasp?.optiune === 'nu_particip_fara_obiectii'),
    bifa_alt_raspuns:bifa(!!rasp && rasp.optiune !== 'nu_particip_fara_obiectii'),
    bifa_neprezentat:bifa(pv.motiv_pv_b === 'neprezentat'),
    reluare_data:formatDataRo(rel?.data_expediere), reluare_adresa_tgz_nr:rel?.adresa_tgz_nr ?? '',
    reluare_nr_tracking:rel?.nr_tracking ?? '', bifa_reluare_nu_e_cazul:bifa(!rel),
    bifa_reluare_fara_raspuns:bifa(!!rel?.data_expediere && !raspRel), bifa_reluare_raspuns:bifa(!!raspRel),
    reluare_raspuns_text:raspRel?.obiectii_text || raspRel?.optiune || '',
    verificare_de_gazpet:parcela.verificare_de_gazpet ?? '', verificare_de_tgz:parcela.verificare_de_tgz ?? '',
    reprezentant_uat_nume:uat.reprezentant_uat_nume ?? '',
    semnatar_uat:uat.reprezentant_uat_nume ?? '', semnatar_apm:proiect.apm_nume ?? '',
  })
  for (const k of MOTIVE_PV_B) campuri['bifa_sit_' + k] = bifa(pv.motiv_pv_b === k)
  for (const k of ['afisare_data_start','afisare_data_end']) campuri[k] = formatDataRo(uat[k])
  campuri.afisare_pv_nr = uat.afisare_pv_nr ?? ''
  for (const i of [1,2,3]) campuri['zi'+i] = formatDataRo(uat['sesiune_zi'+i])
  return documentPv(campuri, date.templateArrayBuffer, date.strict !== false)
}
export function calePv({ proiectCod, uat3, nrPv, versiune = 1, extensieSemnat, calitate }) {
  // Reuse segment/version validation; replace only the fixed directory.
  const parti = caleAdresaUat({ proiectCod, uat3, nrDocument: nrPv, versiune }).split('/')
  parti[2] = 'pv'
  const path = parti.join('/')
  if (extensieSemnat && !['pdf','jpg','png'].includes(extensieSemnat)) throw new Error('Format scan invalid')
  if (!extensieSemnat && calitate != null) {
    if (!ROLURI_PV_A.includes(calitate) || !Number.isSafeInteger(versiune) || versiune>999999999 || !/^PVA-[A-Z]{3}-[0-9]{4}$/.test(nrPv)) throw new Error('Calitate/versiune PV A invalida')
    const nou=path.replace(/[.]docx$/, '_' + calitate + '.docx')
    if (!citesteCalePvA(nou,{proiectCod,uat3,nrPv})) throw new Error('Cale PV A invalida')
    return nou
  }
  return extensieSemnat ? path.replace(/_v\d+\.docx$/, `_semnat_v${versiune}.${extensieSemnat}`) : path
}
export function extensieScan(blob) {
  const ext = {'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'}[blob?.type]
  if (!ext || !blob.size || blob.size > 25 * 1024 * 1024) throw new Error('Scanul trebuie sa fie PDF/JPEG/PNG, maximum 25 MB.')
  return ext
}
// Copilot f4c r1 P3-01: continutul trebuie sa corespunda tipului declarat (semnatura PDF / JPEG / PNG)
const SEMNATURI = { pdf:[0x25,0x50,0x44,0x46,0x2d], jpg:[0xff,0xd8,0xff], png:[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a] }
export async function verificaContinutScan(blob) {
  const ext = extensieScan(blob)
  const cap = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  if (!SEMNATURI[ext].every((b, i) => cap[i] === b)) throw new Error('Fisierul nu este un ' + ext.toUpperCase() + ' valid (continutul nu corespunde tipului).')
  return ext
}
async function maximScan(supabase, cheie, esteCurent) {
  const folder = calePv(cheie).split('/').slice(0,-1).join('/')
  const prefix = cheie.nrPv + '_semnat_v'
  let max = 0, offset = 0
  for (let p=0; p<100; p++) {
    if (!esteCurent()) throw new Error('Operatie abandonata: PV schimbat')
    const {data,error} = await supabase.storage.from('redari').list(folder,{limit:1000,offset,sortBy:{column:'name',order:'asc'}})
    if (error || !Array.isArray(data)) throw new Error('Nu pot lista versiunile scanului; reincarca.')
    if (!data.length) return max
    for (const f of data) if (f.name?.startsWith(prefix)) {
      const m = /^(\d+)\.(pdf|jpg|png)$/.exec(f.name.slice(prefix.length))
      if (m) max = Math.max(max, Number(m[1]))
    }
    offset += data.length
  }
  throw new Error('Listarea scanurilor este incompleta.')
}
async function maximPvA(supabase, cheie, esteCurent) {
  const folder=calePv({...cheie,calitate:undefined}).split('/').slice(0,-1).join('/')
  let max=0, offset=0
  for (let p=0;p<100;p++) {
    if (!esteCurent()) throw new Error('Operatie abandonata: PV schimbat')
    const {data,error}=await supabase.storage.from('redari').list(folder,{limit:1000,offset,sortBy:{column:'name',order:'asc'}})
    if (error || !Array.isArray(data)) throw new Error('Nu pot lista versiunile PV A; reincarca.')
    if (!data.length) return max
    for (const f of data) {
      if (f.name?.startsWith(cheie.nrPv+'_v')) {
        max=Math.max(max,versiuneCurentaPvA(folder+'/'+f.name,cheie))
      }
    }
    offset+=data.length
  }
  throw new Error('Listarea versiunilor PV A este incompleta.')
}
export async function salveazaPv(supabase, { blob, proiectCod, uat3, nrPv, semnat = false, calitate, caleCurenta, esteCurent = () => true }) {
  const extensieSemnat = semnat ? extensieScan(blob) : undefined
  const cheie = {proiectCod,uat3,nrPv,extensieSemnat,calitate:semnat?undefined:calitate}
  calePv(cheie)
  const maxBucket = semnat ? await maximScan(supabase,cheie,esteCurent) : calitate != null ? await maximPvA(supabase,cheie,esteCurent) : await versiuneMaximaInBucket(supabase, { proiectCod, uat3, idParcela: 'pv', nrDocument: nrPv, adresa: true }, { esteCurent })
  if (maxBucket == null) throw new Error('Nu pot lista versiunile PV; reincarca si verifica starea.')
  const max=calitate!=null && !semnat ? Math.max(maxBucket,versiuneCurentaPvA(caleCurenta,cheie)) : maxBucket
  for (let i = 1; i <= MAX_INCERCARI_VERSIUNE; i++) {
    if (!esteCurent()) throw new Error('Operatie abandonata: PV schimbat')
    const versiune = max + i
    const path = calePv({ ...cheie, versiune })
    const { error } = await supabase.storage.from('redari').upload(path, blob, { contentType: semnat ? blob.type : MIME_DOCX, upsert: false })
    if (!error) return { path, versiune }
    const coliziune = String(error.statusCode ?? error.status) === '409' || /already exists|duplicate/i.test(error.message ?? '')
    if (!coliziune) throw new Error('Incarcarea PV a esuat; verifica starea inainte de reluare. ' + (error.message ?? 'Storage indisponibil'))
  }
  throw new Error('Prea multe coliziuni la salvarea PV; reincarca.')
}

// PV C counts parcels once, including parcels with several signed co-owners.
export const CHEI_PV_C = ['contract_data','contract_nr','data_pv','km_de_la','km_pana_la','nr_pv','numar_parcele',
  'obiectii_deschise_mp','obiectii_deschise_nr','proiect_denumire','pva_corespondenta_mp','pva_corespondenta_nr',
  'pva_sesiune_mp','pva_sesiune_nr','pvb_mp','pvb_nr','semnatar_apm','semnatar_gazpet','semnatar_tgz','total_mp','total_nr','tronson','uat_uri']
export function totaluriPvC(randuriTronson, pvs) {
  const sesiune = new Set(pvs.filter(p => p.tip === 'A' && p.stare === 'semnat' && p.sters_la == null && p.semnat_la_sesiune === true).map(p => p.parcela_id))
  const grupe = {pva_sesiune:[],pva_corespondenta:[],pvb:[],obiectii_deschise:[],total:randuriTronson}
  for (const r of randuriTronson) {
    if (r.tip_pv === 'A') grupe[sesiune.has(r.parcela_id)?'pva_sesiune':'pva_corespondenta'].push(r)
    if (r.tip_pv === 'B') grupe.pvb.push(r)
    if (r.obiectii_deschise === true) grupe.obiectii_deschise.push(r)
  }
  return Object.fromEntries(Object.entries(grupe).flatMap(([k,rs]) => {
    const suma = rs.reduce((n,r) => {
      // Copilot f4d r1 P2-02: suprafata lipsa NU devine 0 intr-un act de receptie (verificaDatePvC o blocheaza)
      if (r.suprafata_temporara_mp == null || r.suprafata_temporara_mp === '') throw new Error('Suprafata lipsa pentru parcela '+(r.id_parcela??r.parcela_id))
      const v = Number(r.suprafata_temporara_mp)
      if (!Number.isFinite(v)) throw new Error('Suprafata invalida pentru PV C')
      return n+v
    },0)
    return [[k+'_nr',rs.length],[k+'_mp',formatNumarRo(Math.round(suma*100)/100)]]
  }))
}
export function verificaDatePvC({proiect={},pv={},randuriTronson=[]}) {
  const lipsuri=[]
  for(const [v,k] of [[proiect.contract_nr,'numarul contractului'],[proiect.contract_data,'data contractului'],[pv.data_pv,'data PV']]) if(!plin(v)) lipsuri.push(k)
  if(!Number.isInteger(pv.tronson) || pv.tronson<1 || pv.tronson>11) lipsuri.push('tronson')
  if(!randuriTronson.length) lipsuri.push('cel putin o parcela')
  if(randuriTronson.some(r=>r.tip_pv == null)) lipsuri.push('parcele fara PV A semnat sau PV B')
  const faraMp=randuriTronson.filter(r=>r.suprafata_temporara_mp == null || r.suprafata_temporara_mp === '').length
  if(faraMp) lipsuri.push('suprafata temporara lipsa la '+faraMp+' parcele')
  return lipsuri
}
export async function genereazaPvC(date) {
  const {proiect={},pv={},randuriTronson=[],pvs=[],uats=[],parcele=[]}=date
  const lipsuri=verificaDatePvC(date)
  if(date.strict!==false && lipsuri.length) throw new Error('Lipsesc: '+lipsuri.join('; '))
  const active=parcele.filter(p=>p.sters_la==null && p.tronson===pv.tronson)
  const limita=(k,fn)=>{
    const valori=active.filter(p=>p[k]!=null && p[k]!=='').map(p=>Number(p[k]))
    if(valori.some(v=>!Number.isFinite(v))) throw new Error('Kilometraj invalid')
    return valori.length?formatNumarRo(fn(...valori)):''
  }
  const ids=new Set(randuriTronson.map(r=>r.uat_id))
  // Copilot f4d r1 P3-01: fiecare UAT al tronsonului trebuie sa fie citit, altfel lista din PV ar fi incompleta
  const lipsaUat=[...ids].filter(id=>!uats.some(u=>u.id===id))
  if(lipsaUat.length) throw new Error('UAT-uri necitite pentru tronson: '+lipsaUat.length+'; reincarca.')
  const campuri={...totaluriPvC(randuriTronson,pvs),contract_nr:proiect.contract_nr??'',contract_data:formatDataRo(proiect.contract_data),
    proiect_denumire:proiect.denumire??'',nr_pv:pv.nr_pv??'',data_pv:formatDataRo(pv.data_pv),tronson:pv.tronson??'',
    km_de_la:limita('km_de_la',Math.min),km_pana_la:limita('km_pana_la',Math.max),numar_parcele:randuriTronson.length,
    uat_uri:[...new Set(uats.filter(u=>ids.has(u.id)).map(u=>u.nume))].sort((a,b)=>a.localeCompare(b,'ro')).join(', '),
    semnatar_tgz:[proiect.reprezentant_tgz_nume,proiect.reprezentant_tgz_functie].filter(Boolean).join(', '),
    semnatar_gazpet:[proiect.reprezentant_gazpet_nume,proiect.reprezentant_gazpet_functie].filter(Boolean).join(', '),semnatar_apm:proiect.apm_nume??''}
  return documentPv(campuri,date.templateArrayBuffer,date.strict!==false)
}
