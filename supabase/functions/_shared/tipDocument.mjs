// tipDocument.mjs — tipul unui document de atribuire ghicit din NUMELE fișierului (sursa unică a regulilor).
// Folosit de: worker/ofertare/seap.ts (NAS Terra), supabase/functions/ofertare-seap-import, src/OfertareLicitatii.jsx.
// api/_tipDocument.js e o COPIE byte cu byte (funcțiile Vercel nu importă din afara api/) — src/ofertareTipDocument.test.js o
// ține sincron. Valorile întoarse trebuie să existe în CHECK-ul coloanei ofertare_documente_atribuire.tip.
//
// 07.10.2026 (Răzvan, motorul de import, varianta A — lic. 3 CN1095546): 117 fișiere dintr-o arhivă publicată ca
// „clarificare” moșteneau tipul arhivei (raspuns_clarificare), deși erau formulare F/C, planșe și ATR — clasificatorul
// știa doar F1–F3. Reguli calibrate pe reclasificarea manuală de la lic. 3 (testul o reproduce integral) și verificate
// pe toate cele 1333 de documente din BD (dry-run + review adversarial, 07.10):
//   - numele se ia fără cale, fără diacritice, cu „_” ca spațiu (altfel \bcs\b nu vede „RGZ_18_CS_Vol_II”);
//   - eDevize: C1, C6–C9, F4–F6, DG, DO → formular; F1–F3, C2–C5, centralizatoare, antemăsurători, explicitarea
//     normelor → lista_cantitati;
//   - un text luat drept planșă NU se mai citește deloc (ofertare_doc_de_citit sare planșele), o planșă ratată se citește
//     degeaba (cost mic) — de aceea: avizele / acordurile / CU / studiile / PV-urile și răspunsurile la clarificări se
//     decid ÎNAINTEA planșelor; vocabularul de desen (schemă, detaliu, profil, montaj…) cere număr de foaie; orice
//     cuvânt de text (TEXT_RE) oprește regula de planșă;
//   - „Solicitare de clarificări” (întrebarea ofertantului) nu e răspuns → alta;
//   - folderul (încărcare pe folder din UI, ZIP desfăcut în edge) e doar indiciu când numele nu spune nimic, fără planșă;
//   - din arhivă: regula proprie, apoi folderul, apoi tipul arhivei — fără raspuns_clarificare și fără planșă;
//   - review r2 (07.10): rândul unei ARHIVE e 'alta' (container), planșa „slabă” cedează în fața folderului / arhivei de
//     caiet sau listă, „Răspuns” / „Erată” bat fișa de date și caietul, caietul cu liste e listă, TEXT_RE lărgit.

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/_/g, ' ')

/** Numele fișierului fără cale (separator / sau \). */
export const numeFisier = (nume) => String(nume ?? '').split(/[\\/]/).pop() || ''

// cuvinte de document TEXT: oricât vocabular de desen ar avea numele, cu ele nu e planșă (se citește)
const TEXT_RE = /procedur|breviar|specificat|tehnologi|program|calcul|instructiun|metodolog|raport|\bnota\b|\bgrafic|\bfis[ae]\b|\blist[ae]\b|descrier|conditii|cerint|\btema\b|masuri|\bssm\b|securitat|control|calitat|tabel|coordonat|borderou|cuprins|memoriu|justific|studiu|aviz|referat|expertiz|extras|deviz|evaluare|pccvi|solutie|garanti|\bordin|\bacord|centralizator|cantitat|autoriza|conventi|decizi|hotarar|notificar|prescripti|manual|verificar|\bprobe|agrement|permis|declarati|normativ|regulament|documentati|propunere|angajament/
const LISTE_RE = /cantitat|antemasur|centralizator|explicitare[ .-]?norm|^f[1-3][ .-]|^c[2-5][ .-]|\bliste?\b[ .-]+(-[ .-]*)?fara[ .-]+(valori|preturi)/
const DESEN_TARE_RE = /\bdwg\b|izometri|schema tehnologica/
const VOCAB_DESEN = /schem|de[tl]aliu|profil|subtravers|sectiun|cofret|electrod|platforma|gauri|grile|montaj|monaj/
const numeCurat = (nume) => norm(numeFisier(nume)).replace(/\.p7[ms]$/, '')

/** Tipul dat de o regulă explicită („tare”) sau null când numele nu spune nimic — atunci decide apelantul: folderul,
 *  arhiva, planșa „slabă” (număr de foaie + vocabular de desen), 'alta'. */
export function tipExplicit(nume) {
  const n = numeCurat(nume)
  if (/(solicitar|cerer|intrebar)[a-z]*[ .-]+((nr|numarul)[ .-]*\d+[ .-]+)?(de[ .-]+)?clarificar/.test(n) && !/raspuns|\brasp\b|^clarificar/.test(n)) return 'alta'
  if (/raspuns|\brasp\b|\berata\b/.test(n)) return 'raspuns_clarificare'
  if (/fisa[ .-]?(de[ .-]?)?date|instructiuni[ .-]?ofertanti/.test(n)) return 'fisa_date'
  if (/caiet|memoriu|parte[a]? scrisa/.test(n) && !LISTE_RE.test(n)) return 'cs_volum'
  if (/clarificar/.test(n)) return 'raspuns_clarificare'
  if (LISTE_RE.test(n)) return 'lista_cantitati'
  if (/\bcs\b/.test(n) && !/desen|plans/.test(n)) return 'cs_volum'
  if (/formular|duae/.test(n)) return 'formular'
  if (/contract|conditii[ .-]?(generale|specifice)/.test(n)) return 'model_contract'
  if ((/volum/.test(n) && !/desen|plans/.test(n)) || /sectiunea/.test(n)) return 'cs_volum'
  if (/^(c\d{1,2}|f\d{1,2}|dg|do|cm)[ .-]/.test(n)) return 'formular'
  if (/\batr\b|aviz|\bacord|anex[ae]|studiu|\bpv\b|proces[ .-]?verbal|ocpi|certificat|autoriza|norme[ .-]?anre|\bgis\b/.test(n)) return 'alta'
  if (/\.dwg$/.test(n)) return 'plansa'
  if (DESEN_TARE_RE.test(n) && !TEXT_RE.test(n.replace(/schema tehnologica|izometri[a-z]*|\bdwg\b/g, ' '))) return 'plansa'
  if (TEXT_RE.test(n)) return null
  if (/desen|plans|topo/.test(n)) return 'plansa'
  if (/\bplan(ul)?[ .-]+(de[ .-]+)?(situatie|amplas|sectiune)/.test(n)) return 'plansa'
  return null
}

/** Planșa „slabă”: număr de foaie + vocabular de desen („12. Detaliu montaj”), fără niciun cuvânt de text. Cedează în fața
 *  folderului și a unei arhive de caiet / listă („Caiete de sarcini/05. Montaj conducte PE.pdf” e capitol de caiet). */
export const plansaSlaba = (nume) => {
  const n = numeCurat(nume)
  return /^\d{1,3}(\.\d{1,2})?\.?[ -]/.test(n) && !TEXT_RE.test(n) && VOCAB_DESEN.test(n)
}

// tipurile pe care le poate da un FOLDER: fără planșă (un text dintr-un folder „Planșe” s-ar pierde la citire) și fără fișa
// de date (un folder „01_fisa_date_formulare” ar face fișă din orice; fișa are mereu nume grăitor); raspuns_clarificare doar
// dintr-un folder de răspuns explicit (nu „02_clarificari” cu întrebările noastre)
const DIN_FOLDER = new Set(['formular', 'model_contract', 'lista_cantitati', 'cs_volum'])
/** Tipul dat de cel mai apropiat folder grăitor din cale; spațiile de nume ale arhivelor „X (#id)” se sar. */
export function tipDinFoldere(nume) {
  const seg = String(nume ?? '').split(/[\\/]/).slice(0, -1).reverse()
  for (const f of seg) {
    if (/\(#\d+\)/.test(f)) continue
    const t = tipExplicit(f)
    if (t && (DIN_FOLDER.has(t) || (t === 'raspuns_clarificare' && /raspuns/.test(norm(f))))) return t
  }
  return null
}

/** Tipul unui document urcat direct (fără arhivă-mamă). O ARHIVĂ e 'alta': e un container (se despachetează, nu se citește),
 *  iar un tip esențial pe ea ar bloca poarta de completitudine după despachetare (lic. 103, „LISTE CANTITATI…zip”). */
export function ghicesteTip(nume) {
  if (esteArhiva(nume)) return 'alta'
  return tipExplicit(nume) ?? tipDinFoldere(nume) ?? (plansaSlaba(nume) ? 'plansa' : 'alta')
}

/** Tipul unui fișier extras dintr-o arhivă. `tipArhiva` = indiciul mamei (workerul dă tipExplicit(numele arhivei) ?? tipul
 *  rândului). Ordinea: regula proprie, folderul, contextul de caiet / listă al mamei, planșa slabă, apoi tipul mamei — CU
 *  EXCEPȚIA lui raspuns_clarificare (un fișier fără nume grăitor dintr-o arhivă „clarificare” e de regulă documentație
 *  revizuită: Mânăstirea 182 rânduri, lic. 3 117 fișiere) și a planșei (un breviar dintr-o arhivă „Planșe” nu s-ar mai citi). */
export function tipInArhiva(nume, tipArhiva) {
  if (esteArhiva(nume)) return 'alta'
  const t = tipExplicit(nume) ?? tipDinFoldere(nume)
  if (t) return t
  if (tipArhiva === 'cs_volum' || tipArhiva === 'lista_cantitati') return tipArhiva
  if (plansaSlaba(nume)) return 'plansa'
  return tipArhiva && tipArhiva !== 'raspuns_clarificare' && tipArhiva !== 'plansa' ? tipArhiva : 'alta'
}

/** Indiciul de tip al unei arhive pentru fișierele extrase din ea: întâi NUMELE arhivei („Caiet de sarcini.zip” → cs_volum),
 *  apoi tipul rândului ei. Același în worker (bucla de platformă) și în edge (ZIP desfăcut inline) — Copilot conv. 3, #641. */
export const indiciuArhiva = (numeArhiva, tipRand = null) => tipExplicit(numeArhiva) ?? tipRand ?? null

/** Arhivă pe care o despachetează workerul (zip / rar / 7z, opțional semnată .p7s / .p7m — același CMS atașat). */
export const ARHIVA_RE = /\.(zip|rar|7z)(\.p7[ms])?$/i
export const esteArhiva = (nume) => ARHIVA_RE.test(String(nume ?? ''))

/** Adâncimea de imbricare a unui document extras: câte spații de nume „(#id)” are în nume. O arhivă de pe nivelul
 *  MAX_ADANCIME_ARHIVE nu se mai despachetează automat (bombă de arhive / buclă) — rămâne cu motivul scris. */
export const MAX_ADANCIME_ARHIVE = 3
export const adancimeArhiva = (nume) => (String(nume ?? '').match(/\(#\d+\)/g) || []).length
