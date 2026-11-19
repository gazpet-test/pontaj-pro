// Redări — importul TGZ, pasul 2 (deciziile lui Răzvan, 19.11.2026): A DOUA OPINIE AI în previzualizare, după verificarea fixă (#1140).
// Ce face aici (ecranul): din `preview.identificare` (doar UAT / Nr.Crt. / rând + cele trei câmpuri, fără nume / adrese / contacte) face lista
// valorilor UNICE de trimis (aceeași triplă poz_hg / nr_cadastral / tarla = un singur rând trimis), o împarte în bucăți de MAX_RANDURI_APEL,
// estimează costul MAXIM (aceeași formulă ca rezervarea din BD) și transformă semnalele AI întoarse de funcția edge în intrări „de verificat” cu
// sursa 'ai' — aceeași listă ca semnalele fixe, deci aceeași mascare (mascheazaRand), aceeași bifă, același CSV, aceeași păstrare în lot
// (semnalFaraValori). NU blochează, NU scrie nimic, NU corectează: omul decide.
import { MAX_RANDURI_APEL, MAX_LUNGIME_VALOARE, MAX_INDEX, MAX_OCTETI_CERERE, CAMPURI_AI, CATEGORII_AI, construiesteCerere, costRezervatMaxim } from '../../supabase/functions/_shared/redariImportAi.mjs'
import { ETICHETA_CAMP_VERIFICAT, ETICHETA_MOTIV_VERIFICARE, numarRanduriDeVerificat } from './importVerificareFixa.js'

export const FUNCTIA_EDGE_AI = 'redari-import-verificare-ai'
export const ETICHETA_CATEGORIE_AI = Object.freeze({
  nume_persoana: 'nume de persoană / firmă', adresa: 'adresă', telefon_cnp: 'telefon / CNP', email_web: 'e-mail / adresă web', text_liber: 'text liber',
})
/**
 * r2 (#1141): explicația afișată pentru un semnal AI = text FIX din cod, după categoria validată. Modelul nu mai scrie niciun text liber (un text al
 * lui putea repeta date personale din alt rând); o categorie necunoscută nu are explicație (semnalul se ignoră înainte, în semnaleAiInDeVerificat).
 */
export const EXPLICATIE_CATEGORIE_AI = Object.freeze({
  nume_persoana: 'Valoarea pare un nume de persoană sau denumirea unei firme, nu un identificator (posibilă coloană decalată).',
  adresa: 'Valoarea pare o adresă poștală (stradă, număr, bloc), nu un identificator.',
  telefon_cnp: 'Valoarea pare un număr de telefon sau un CNP, nu un identificator.',
  email_web: 'Valoarea pare o adresă de e-mail sau o adresă web, nu un identificator.',
  text_liber: 'Valoarea pare text liber (propoziție, observație, mesaj), nu un identificator.',
})
const nevid = v => typeof v === 'string' && v.trim() !== ''
/** Cheia unui rând Excel în „De verificat” (aceleași câmpuri ca în harta din pregatesteVerificareAi), fără valori. */
export const cheieRandAi = r => JSON.stringify([Number.isInteger(r?.rand) ? r.rand : null, String(r?.uat ?? ''), String(r?.nr_crt ?? ''), String(r?.cheie_parcela ?? '')])

/**
 * pregatesteVerificareAi(preview) → { bucati: [[{ i, poz_hg, nr_cadastral, tarla }]], harta: Map(i → [{ rand, uat, nr_crt, cheie_parcela }]),
 *   randuri, unice, prea_lungi, cost_max_usd }. Rândurile cu toate cele trei câmpuri goale nu se trimit (nimic de verificat). O valoare mai lungă
 *   de MAX_LUNGIME_VALOARE NU se taie (L21): rândul nu se trimite și se numără în prea_lungi (ecranul îl arată — nimic nu dispare tacit, L12).
 */
export function pregatesteVerificareAi(preview) {
  const lista = Array.isArray(preview?.identificare) ? preview.identificare : []
  const dupaTripla = new Map(); const harta = new Map(); const unice = []; let randuri = 0, preaLungi = 0
  for (const r of lista) {
    if (!r || typeof r !== 'object') continue
    const valori = CAMPURI_AI.map(c => (r[c] == null ? null : String(r[c])))
    if (!valori.some(nevid)) continue
    randuri++
    if (valori.some(v => v != null && v.length > MAX_LUNGIME_VALOARE)) { preaLungi++; continue }
    const k = JSON.stringify(valori)
    let i = dupaTripla.get(k)
    if (i === undefined) {
      if (unice.length > MAX_INDEX) { preaLungi++; continue }
      i = unice.length; dupaTripla.set(k, i); harta.set(i, [])
      unice.push({ i, poz_hg: valori[0], nr_cadastral: valori[1], tarla: valori[2] })
    }
    harta.get(i).push({ rand: Number.isInteger(r.rand) ? r.rand : null, uat: String(r.uat ?? ''), nr_crt: String(r.nr_crt ?? ''), cheie_parcela: String(r.cheie_parcela ?? '') })
  }
  // bucăți de cel mult MAX_RANDURI_APEL rânduri; o bucată peste MAX_OCTETI_CERERE (valori lungi) se înjumătățește până încape
  const bucati = []
  const pune = b => { if (b.length > 1 && construiesteCerere(b).octeti > MAX_OCTETI_CERERE) { const m = Math.ceil(b.length / 2); pune(b.slice(0, m)); pune(b.slice(m)) } else bucati.push(b) }
  for (let k = 0; k < unice.length; k += MAX_RANDURI_APEL) pune(unice.slice(k, k + MAX_RANDURI_APEL))
  const cost = bucati.reduce((s, b) => s + costRezervatMaxim(construiesteCerere(b).octeti), 0)
  return { bucati, harta, randuri, unice: unice.length, prea_lungi: preaLungi, cost_max_usd: Math.round(cost * 1e6) / 1e6 }
}

/**
 * semnaleAiInDeVerificat(semnale, harta) → intrările „de verificat” (sursa 'ai'), câte una pe fiecare rând Excel cu aceeași triplă de valori.
 * semnale = cele validate de funcția edge ({ i, camp, categorie }); un element cu i / camp / categorie necunoscute se ignoră (L18: nu se
 * ghicește rândul). Orice altă cheie a elementului (ex. un text al modelului) NU se copiază; `motiv` = eticheta fixă din cod.
 */
export function semnaleAiInDeVerificat(semnale, harta) {
  const out = []
  for (const s of Array.isArray(semnale) ? semnale : []) {
    if (!s || !CAMPURI_AI.includes(s.camp) || !CATEGORII_AI.includes(s.categorie) || !harta?.has(s.i)) continue
    const cod = 'ai_' + s.categorie
    for (const r of harta.get(s.i)) {
      out.push({ ...r, camp: s.camp, motive: [cod], motiv: `${ETICHETA_CAMP_VERIFICAT[s.camp]}: ${ETICHETA_MOTIV_VERIFICARE[cod]}`, sursa: 'ai' })
    }
  }
  return out.sort((a, b) => (a.rand ?? Infinity) - (b.rand ?? Infinity) || CAMPURI_AI.indexOf(a.camp) - CAMPURI_AI.indexOf(b.camp))
}

/**
 * clasificaRaspunsBucataAi(data) → 'completa' | 'incompleta' | null — ce înseamnă răspunsul funcției edge pentru O bucată (r3, #1141 Jakarinos P2):
 *  - 'completa'  = cod 'ok', lista de semnale și respinse === 0 (întreg): bucata a fost verificată COMPLET → semnalele AI vechi ale rândurilor ei se pot
 *                  înlocui (inclusiv cu nimic: {"semnale":[]} valid fără respingeri e cazul legitim care curăță);
 *  - 'incompleta' = cod 'incomplet' (sau 'ok' cu respinse > 0 / ne-întreg / lipsă — fail-safe, L18, ex. un edge mai vechi): semnalele valide se ADAUGĂ,
 *                  dar semnalele AI vechi ale rândurilor ei RĂMÂN (un element respins la validare nu e o concluzie negativă despre rând);
 *  - null        = orice altceva (refuz, eroare, necunoscut, formă greșită): bucla se oprește (L05), nimic din bucată nu se aplică.
 */
export function clasificaRaspunsBucataAi(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.semnale)) return null
  if (data.cod === 'ok') return Number.isInteger(data.respinse) && data.respinse === 0 ? 'completa' : 'incompleta'
  if (data.cod === 'incomplet') return 'incompleta'
  return null
}

/**
 * randuriAcoperite(plan, indiciBucati) → Set(cheieRandAi) al rândurilor Excel ale bucăților VERIFICATE COMPLET în rularea curentă (indicii din
 * plan.bucati; r3: NU și cele 'incompleta'). Doar pentru ele se înlocuiesc semnalele AI vechi (adaugaSemnaleAi).
 */
export function randuriAcoperite(plan, indiciBucati) {
  const out = new Set()
  for (const k of Array.isArray(indiciBucati) ? indiciBucati : []) {
    for (const r of plan?.bucati?.[k] || []) for (const x of plan.harta?.get(r.i) || []) out.add(cheieRandAi(x))
  }
  return out
}

/**
 * adaugaSemnaleAi(preview, intrari, rezumat, acoperite) → o previzualizare NOUĂ (obiect nou ⇒ bifa „am verificat” se cere din nou): semnalele fixe
 * rămân; un semnal AI anterior se scoate DOAR dacă rândul lui e în `acoperite` (bucată verificată cu succes acum — r2, #1141: la o rerulare
 * incompletă, bucățile eșuate / neîncercate își păstrează semnalele AI vechi, deci și mascarea și obligația bifei); semnalele noi se adaugă (fără
 * dubluri pe rând + câmp + coduri); statistica se recalculează. `acoperite` lipsă / ne-Set = nimic acoperit (fail-safe: niciun semnal vechi nu se
 * pierde). `verificare_ai` = rezumatul rulării (complet / bucăți / incomplete / semnale / respinse / cost — fără valori).
 */
export function adaugaSemnaleAi(preview, intrari, rezumat, acoperite) {
  const acop = acoperite instanceof Set ? acoperite : new Set()
  const vechi = (Array.isArray(preview?.de_verificat) ? preview.de_verificat : []).filter(s => s?.sursa !== 'ai' || !acop.has(cheieRandAi(s)))
  const cheie = s => `${cheieRandAi(s)}|${s?.camp}|${s?.sursa === 'ai' ? 'ai' : 'fix'}|${(Array.isArray(s?.motive) ? s.motive : []).join('+')}`
  const vazute = new Set(vechi.map(cheie)); const de_verificat = [...vechi]
  for (const s of Array.isArray(intrari) ? intrari : []) { const k = cheie(s); if (!vazute.has(k)) { vazute.add(k); de_verificat.push(s) } }
  return { ...preview, de_verificat, verificare_ai: rezumat ?? null,
    statistici: { ...(preview?.statistici || {}), de_verificat: de_verificat.length, randuri_de_verificat: numarRanduriDeVerificat(de_verificat) } }
}

const MESAJE = {
  neautentificat: 'Sesiunea a expirat: reautentifică-te.',
  fara_drept: 'Nu ai dreptul de a porni verificarea AI pe acest proiect (o pornesc owner-ul și cei cu dreptul pe proiect).',
  plafon_apeluri_zi: 'S-a atins plafonul zilnic de apeluri AI pe acest proiect.',
  plafon_cost_zi: 'S-a atins plafonul zilnic de cost AI pe acest proiect.',
  plafon_bucata_zi: 'Bucata aceasta a fost deja verificată de două ori azi.',
  cheie_refolosita: 'Cererea nu se potrivește cu una anterioară: pornește din nou verificarea.',
  cerere_deja_procesata: 'Cererea a mai fost trimisă (alt tab / reluare): nu se trimite a doua oară.',
  cerere_invalida: 'Cererea nu e validă (reface previzualizarea).',
  ai_neconfigurat: 'Verificarea AI nu e configurată încă pe server.',
  ai_necunoscut: 'Rezultatul apelului AI nu se cunoaște (rețea / server). Nu se reia automat; costul se socotește cel maxim.',
  ai_ocupat: 'Serviciul AI e ocupat; încearcă mai târziu.',
  ai_refuz: 'Modelul AI a refuzat cererea; nu se reia automat.',
  ai_trunchiat: 'Răspunsul AI a fost tăiat (prea multe semnale); nu s-a folosit.',
  ai_raspuns_invalid: 'Răspunsul AI nu are forma cerută; nu s-a folosit.',
  ai_raspuns_prea_mare: 'Răspunsul AI are mai multe semnale decât valori; nu s-a folosit.',
}
/** Mesajul pentru ecran după codul (listă închisă) din răspunsul funcției edge; fără valori. */
export const mesajCodAi = cod => MESAJE[cod] ?? `Verificarea AI s-a oprit (${typeof cod === 'string' && /^[a-z0-9_]{1,40}$/.test(cod) ? cod : 'eroare necunoscută'}).`
