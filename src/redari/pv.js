import { completeazaDocx, hashBlob, formatDataRo, formatNumarRo, ETICHETA_CALITATE,
  caleAdresaUat, versiuneMaximaInBucket, MIME_DOCX, MAX_INCERCARI_VERSIUNE } from './docx.js'

export const BIFA_DA = "\u2612"
export const BIFA_NU = "\u2610"
export const LUCRARI = ['sol_fertil', 'nivelare', 'arat', 'discuit', 'insamantare', 'gard', 'drum', 'altele']
export const STARI_TEREN = ['nivelat', 'strat_vegetal', 'insamantat', 'gard_drum', 'alta']
export const CHEI_PV_A = [
  'act_doveditor','act_identitate','alte_observatii','bifa_altele','bifa_arat','bifa_constatare_sediu',
  'bifa_constatare_teren','bifa_cu_obiectii','bifa_da','bifa_da_cu_obiectii','bifa_discuit','bifa_drum',
  'bifa_fara_obiectii','bifa_foto_da','bifa_foto_nu','bifa_gard','bifa_insamantare','bifa_nivelare',
  'bifa_plan_da','bifa_plan_nu','bifa_sol_fertil','bifa_st_alta','bifa_st_gard_drum','bifa_st_insamantat',
  'bifa_st_nivelat','bifa_st_strat_vegetal','calitate_cota','categoria_folosinta','categoria_initiala',
  'contract_data','contract_nr','data_pv','foto_nr','locul','lucrari_altele','nr_cadastral','nr_pv','nume',
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
export function verificaDatePvA({ proiect = {}, uat = {}, parcela = {}, detinator = {}, pv = {} }) {
  const lipsuri = []
  for (const [v, et] of [[proiect.contract_nr,'numarul contractului'],[proiect.contract_data,'data contractului'],
    [uat.nume,'UAT'],[parcela.tronson,'tronson'],[detinator.nume,'numele detinatorului'],[pv.data_pv,'data PV'],[pv.locul,'locul']]) {
    if (!plin(v)) lipsuri.push(et)
  }
  if (!['sediu','teren'].includes(pv.constatare_mod)) lipsuri.push('modul constatarii')
  if (!STARI_TEREN.slice(0,-1).some(k => pv.stare_teren?.[k] === true) && !plin(pv.stare_teren?.alta)) lipsuri.push('starea terenului')
  if (pv.obiectii_redare && !plin(pv.obiectii_text)) lipsuri.push('textul obiectiilor')
  return lipsuri
}
export async function genereazaPvA({ proiect = {}, uat = {}, parcela = {}, detinator = {}, pv = {}, templateArrayBuffer, strict = true }) {
  const lipsuri = verificaDatePvA({ proiect, uat, parcela, detinator, pv })
  if (strict && lipsuri.length) throw new Error('Lipsesc: ' + lipsuri.join('; '))
  const campuri = Object.fromEntries(CHEI_PV_A.map(k => [k, '']))
  const calitate = ETICHETA_CALITATE[detinator.calitate] ?? detinator.calitate ?? ''
  Object.assign(campuri, {
    contract_nr: proiect.contract_nr ?? '', contract_data: formatDataRo(proiect.contract_data),
    proiect_denumire: proiect.denumire ?? '', uat: uat.nume ?? '', nr_pv: pv.nr_pv ?? '',
    data_pv: formatDataRo(pv.data_pv), locul: pv.locul ?? '', nume: detinator.nume ?? '',
    calitate_cota: calitate + (plin(detinator.cota) ? ', cota ' + detinator.cota : ''),
    suprafata: formatNumarRo(parcela.suprafata_temporara_mp),
    categoria_initiala: parcela.categoria_folosinta ?? '', lucrari_altele: pv.lucrari?.altele ?? '',
    stare_teren_alta: pv.stare_teren?.alta ?? '', foto_nr: pv.foto_nr ?? '',
    verificare_data: formatDataRo(parcela.verificare_data),
    verificare_de: [parcela.verificare_de_gazpet, parcela.verificare_de_tgz ? '(TGZ: ' + parcela.verificare_de_tgz + ')' : ''].filter(Boolean).join(' '),
    obiectii_text: pv.obiectii_text ?? '', termen_remediere: formatDataRo(pv.termen_remediere),
    reverificare_la: formatDataRo(pv.reverificare_la), alte_observatii: pv.alte_observatii ?? '',
    semnatar_detinator: [detinator.nume, calitate].filter(Boolean).join(', '),
    semnatar_gazpet: [proiect.reprezentant_gazpet_nume, proiect.reprezentant_gazpet_functie].filter(Boolean).join(', '),
    semnatar_tgz: [proiect.reprezentant_tgz_nume, proiect.reprezentant_tgz_functie].filter(Boolean).join(', '),
  })
  for (const k of ['sat','tarla','nr_cadastral','poz_hg','categoria_folosinta','tronson']) campuri[k] = parcela[k] ?? ''
  for (const k of LUCRARI) campuri['bifa_' + k] = bifa(k === 'altele' ? plin(pv.lucrari?.altele) : pv.lucrari?.[k])
  for (const k of STARI_TEREN) campuri['bifa_st_' + k] = bifa(k === 'alta' ? plin(pv.stare_teren?.alta) : pv.stare_teren?.[k])
  Object.assign(campuri, {
    bifa_da: bifa(pv.obiectii_redare === false), bifa_da_cu_obiectii: bifa(pv.obiectii_redare),
    bifa_fara_obiectii: bifa(pv.obiectii_redare === false), bifa_cu_obiectii: bifa(pv.obiectii_redare),
    bifa_plan_da: bifa(pv.plan_situatie === true), bifa_plan_nu: bifa(pv.plan_situatie === false),
    bifa_foto_da: bifa(pv.foto_nr > 0), bifa_foto_nu: bifa(pv.foto_nr === 0),
    bifa_constatare_sediu: bifa(pv.constatare_mod === 'sediu'), bifa_constatare_teren: bifa(pv.constatare_mod === 'teren'),
  })
  const blob = await completeazaDocx(templateArrayBuffer, campuri, { strict })
  return { blob, hash: await hashBlob(blob), campuri }
}
export function calePv({ proiectCod, uat3, nrPv, versiune = 1 }) {
  // Reuse segment/version validation; replace only the fixed directory.
  const parti = caleAdresaUat({ proiectCod, uat3, nrDocument: nrPv, versiune }).split('/')
  parti[2] = 'pv'
  return parti.join('/')
}
export async function salveazaPv(supabase, { blob, proiectCod, uat3, nrPv, esteCurent = () => true }) {
  calePv({ proiectCod, uat3, nrPv })
  const max = await versiuneMaximaInBucket(supabase, { proiectCod, uat3, idParcela: 'pv', nrDocument: nrPv, adresa: true }, { esteCurent })
  if (max == null) throw new Error('Nu pot lista versiunile PV; reincarca si verifica starea.')
  for (let i = 1; i <= MAX_INCERCARI_VERSIUNE; i++) {
    if (!esteCurent()) throw new Error('Operatie abandonata: PV schimbat')
    const versiune = max + i
    const path = calePv({ proiectCod, uat3, nrPv, versiune })
    const { error } = await supabase.storage.from('redari').upload(path, blob, { contentType: MIME_DOCX, upsert: false })
    if (!error) return { path, versiune }
    const coliziune = String(error.statusCode ?? error.status) === '409' || /already exists|duplicate/i.test(error.message ?? '')
    if (!coliziune) throw new Error('Incarcarea PV a esuat; verifica starea inainte de reluare. ' + (error.message ?? 'Storage indisponibil'))
  }
  throw new Error('Prea multe coliziuni la salvarea PV; reincarca.')
}
