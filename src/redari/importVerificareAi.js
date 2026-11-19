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
const nevid = v => typeof v === 'string' && v.trim() !== ''

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
 * semnale = cele validate de funcția edge ({ i, camp, categorie, motiv }); un element cu i / camp / categorie necunoscute se ignoră (L18: nu se
 * ghicește rândul). Motivul AI (text) NU intră aici: rămâne doar în panoul AI (nu în CSV / lot); `motiv` = eticheta fixă din cod.
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
 * adaugaSemnaleAi(preview, intrari, rezumat) → o previzualizare NOUĂ (obiect nou ⇒ bifa „am verificat” se cere din nou): semnalele fixe rămân,
 * semnalele AI anterioare se înlocuiesc cu cele noi, statistica rândurilor de verificat se recalculează; `verificare_ai` = rezumatul rulării
 * (complet / bucăți / semnale / respinse / cost — fără valori).
 */
export function adaugaSemnaleAi(preview, intrari, rezumat) {
  const fixe = (Array.isArray(preview?.de_verificat) ? preview.de_verificat : []).filter(s => s?.sursa !== 'ai')
  const de_verificat = [...fixe, ...(Array.isArray(intrari) ? intrari : [])]
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
