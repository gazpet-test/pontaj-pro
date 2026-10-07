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
//   - din arhivă: regula proprie, apoi folderul, apoi tipul arhivei — fără raspuns_clarificare și fără planșă.

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/_/g, ' ')

/** Numele fișierului fără cale (separator / sau \). */
export const numeFisier = (nume) => String(nume ?? '').split(/[\\/]/).pop() || ''

// cuvinte de document TEXT: oricât vocabular de desen ar avea numele, cu ele nu e planșă (se citește)
const TEXT_RE = /procedur|breviar|specificat|tehnologi|program|calcul|instructiun|metodolog|raport|\bnota\b|\bgrafic|\bfis[ae]\b|\blist[ae]\b|descrier|conditii|cerint|\btema\b|masuri|\bssm\b|securitat|control|calitat|tabel|coordonat|borderou|cuprins|memoriu|justific|studiu|aviz|referat|expertiz|extras|deviz|evaluare|pccvi|solutie|garanti|\bordin|\bacord|centralizator|cantitat/

/** Tipul dat de o regulă explicită sau null când numele nu spune nimic (atunci decide apelantul: folder, arhivă, 'alta'). */
export function tipExplicit(nume) {
  const n = norm(numeFisier(nume)).replace(/\.p7s$/, '')
  if (/fisa[ .-]?(de[ .-]?)?date|instructiuni[ .-]?ofertanti/.test(n)) return 'fisa_date'
  if (/(solicitar|cerer|intrebar)[a-z]*[ .-]+(de[ .-]+)?clarificar/.test(n) && !/raspuns/.test(n)) return 'alta'
  if (/caiet|memoriu|parte[a]? scrisa/.test(n)) return 'cs_volum'
  if (/raspuns|clarificar|erata/.test(n)) return 'raspuns_clarificare'
  if (/cantitat|antemasur|centralizator|explicitare[ .-]?norm|^f[1-3][ .-]|^c[2-5][ .-]/.test(n)) return 'lista_cantitati'
  if (/\bcs\b/.test(n)) return 'cs_volum'
  if (/formular|duae/.test(n)) return 'formular'
  if (/contract|conditii[ .-]?(generale|specifice)/.test(n)) return 'model_contract'
  if ((/volum/.test(n) && !/desen|plans/.test(n)) || /sectiunea/.test(n)) return 'cs_volum'
  if (/^(c\d{1,2}|f\d{1,2}|dg|do|cm)[ .-]/.test(n)) return 'formular'
  if (/\batr\b|aviz|\bacord|anex[ae]|studiu|\bpv\b|proces[ .-]?verbal|ocpi|certificat|norme[ .-]?anre|\bgis\b/.test(n)) return 'alta'
  if (/\.dwg$|\bdwg\b|izometri|schema tehnologica/.test(n)) return 'plansa'
  if (TEXT_RE.test(n)) return null
  if (/desen|plans|topo/.test(n)) return 'plansa'
  if (/\bplan(ul)?[ .-]+(de[ .-]+)?(situatie|amplas|sectiune)/.test(n)) return 'plansa'
  if (/^\d{1,3}(\.\d{1,2})?\.?[ -]/.test(n)
    && /schem|de[tl]aliu|profil|subtravers|sectiun|cofret|electrod|platforma|gauri|grile|montaj|monaj/.test(n)) return 'plansa'
  return null
}

// tipurile pe care le poate da un FOLDER (fără planșă: un text dintr-un folder „Planșe” s-ar pierde la citire);
// raspuns_clarificare doar dintr-un folder de răspuns explicit (nu „02_clarificari” cu întrebările noastre)
const DIN_FOLDER = new Set(['fisa_date', 'formular', 'model_contract', 'lista_cantitati', 'cs_volum'])
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

/** Tipul unui document urcat direct (fără arhivă-mamă). */
export function ghicesteTip(nume) {
  return tipExplicit(nume) ?? tipDinFoldere(nume) ?? 'alta'
}

/** Tipul unui fișier extras dintr-o arhivă: regula proprie, apoi folderul, apoi tipul arhivei — CU EXCEPȚIA lui
 *  raspuns_clarificare (un fișier fără nume grăitor dintr-o arhivă „clarificare” e de regulă documentație revizuită:
 *  Mânăstirea 182 rânduri, lic. 3 117 fișiere) și a planșei (un breviar / o notă dintr-o arhivă „Planșe” nu s-ar mai
 *  citi). O arhivă imbricată fără nume grăitor nu moștenește nimic (tip esențial pe o arhivă = poartă blocată). */
export function tipInArhiva(nume, tipArhiva) {
  const t = tipExplicit(nume) ?? tipDinFoldere(nume)
  if (t) return t
  if (esteArhiva(nume)) return 'alta'
  return tipArhiva && tipArhiva !== 'raspuns_clarificare' && tipArhiva !== 'plansa' ? tipArhiva : 'alta'
}

/** Arhivă pe care o despachetează workerul (zip / rar / 7z, opțional semnată .p7s). */
export const ARHIVA_RE = /\.(zip|rar|7z)(\.p7s)?$/i
export const esteArhiva = (nume) => ARHIVA_RE.test(String(nume ?? ''))

/** Adâncimea de imbricare a unui document extras: câte spații de nume „(#id)” are în nume. O arhivă de pe nivelul
 *  MAX_ADANCIME_ARHIVE nu se mai despachetează automat (bombă de arhive / buclă) — rămâne cu motivul scris. */
export const MAX_ADANCIME_ARHIVE = 3
export const adancimeArhiva = (nume) => (String(nume ?? '').match(/\(#\d+\)/g) || []).length
