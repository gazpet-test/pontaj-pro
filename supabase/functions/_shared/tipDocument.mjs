// tipDocument.mjs — tipul unui document de atribuire ghicit din NUMELE fișierului (sursa unică a regulilor).
// Folosit de: worker/ofertare/seap.ts (NAS Terra), supabase/functions/ofertare-seap-import, src/OfertareLicitatii.jsx.
// api/_tipDocument.js e o COPIE byte cu byte (funcțiile Vercel nu importă din afara api/) — src/tipDocument.test.js o
// ține sincron. Valorile întoarse trebuie să existe în CHECK-ul coloanei ofertare_documente_atribuire.tip.
//
// 07.10.2026 (Răzvan, motorul de import, varianta A — lic. 3 CN1095546): 117 fișiere dintr-o arhivă publicată ca
// „clarificare” moșteneau tipul arhivei (raspuns_clarificare), deși erau formulare F/C, planșe și ATR — clasificatorul
// știa doar F1–F3. Reguli calibrate pe reclasificarea manuală de la lic. 3 (testul o reproduce integral):
//   - formularele eDevize după cod: C1, C6–C9, F4–F6, DG_, DO_ → formular; F1–F3, C2–C5, centralizatoare,
//     antemăsurători, explicitarea normelor → lista_cantitati;
//   - planșele după vocabularul desenului (schemă, detaliu, profil, subtraversare, montaj…) DOAR la numele cu număr de
//     foaie („12. Detaliu…”) și fără cuvinte de text (procedură, breviar, specificație…): o planșă ratată se citește
//     degeaba (cost mic), un text luat drept planșă NU se mai citește deloc (ofertare_doc_de_citit sare planșele);
//   - ATR / avize / anexe / studii / PV-uri / norme → alta, DECLARAT (nu mai moștenesc tipul arhivei);
//   - numele se ia fără cale („Arhiva (#1305)/sub/F3_….pdf” → „F3_….pdf”) și fără diacritice.
// Ordinea contează: regulile înguste înaintea vocabularului larg de planșă (un „Caiet de sarcini montaj” e cs_volum,
// un „C1 Caiet de sarcini” tot cs_volum — caietul/volumul se verifică înaintea codurilor eDevize).

const faraDiacritice = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Numele fișierului fără cale (separator / sau \). */
export const numeFisier = (nume) => String(nume ?? '').split(/[\\/]/).pop() || ''

// cuvinte de document text: un nume numerotat cu ele nu e planșă, oricât vocabular de desen ar avea
const TEXT_RE = /procedur|breviar|specificat|tehnologi|program|calcul|instructiun|metodolog|raport|\bnota\b|grafic/

/** Tipul dat de o regulă explicită sau null când numele nu spune nimic (atunci decide apelantul: 'alta' sau moștenire). */
export function tipExplicit(nume) {
  const n = faraDiacritice(numeFisier(nume)).replace(/\.p7s$/, '')
  if (/fisa[_ .-]?(de[_ .-]?)?date|instructiuni[_ .-]?ofertanti/.test(n)) return 'fisa_date'
  if (/formular|duae/.test(n)) return 'formular'
  if (/contract|conditii[_ .-]?(generale|specifice)/.test(n)) return 'model_contract'
  if (/cantitat|antemasur|centralizator|explicitare[_ .-]?norm|^f[1-3][_ .-]/.test(n)) return 'lista_cantitati'
  if (/volum|caiet|memoriu|\bcs\b|sectiunea/.test(n)) return 'cs_volum'
  if (/^(c\d{1,2}|f\d{1,2}|dg|do|cm)[_ .-]/.test(n)) return 'formular'
  if (/desene|plans|\.dwg$|izometri|topo|schema tehnologica/.test(n)) return 'plansa'
  if (/raspuns|clarificar|erata/.test(n)) return 'raspuns_clarificare'
  if (/\bplan(ul)?[_ .-]+(de[_ .-]+)?(situatie|amplas|sectiune)/.test(n)) return 'plansa'
  if (/^\d{1,3}(\.\d{1,2})?\.?[ _-]/.test(n) && !TEXT_RE.test(n)
    && /schem|de[tl]aliu|profil|subtravers|sectiun|cofret|electrod|platforma|gauri|grile|montaj|monaj/.test(n)) return 'plansa'
  if (/\batr\b|aviz|anex[ae]|studiu|\bpv\b|proces[_ .-]?verbal|ocpi|certificat|norme[_ .-]?anre|\bgis\b/.test(n)) return 'alta'
  return null
}

/** Tipul unui document urcat direct (fără arhivă-mamă). */
export function ghicesteTip(nume) {
  return tipExplicit(nume) ?? 'alta'
}

/** Tipul unui fișier extras dintr-o arhivă: regula proprie câștigă; altfel moștenește tipul arhivei, CU EXCEPȚIA lui
 *  raspuns_clarificare — un fișier fără nume grăitor dintr-o arhivă publicată ca „clarificare” e de regulă documentație
 *  revizuită, nu un răspuns (altfel umple lista Clarificări: Mânăstirea 182 rânduri, lic. 3 117 fișiere). */
export function tipInArhiva(nume, tipArhiva) {
  const t = tipExplicit(nume)
  if (t) return t
  return tipArhiva && tipArhiva !== 'raspuns_clarificare' ? tipArhiva : 'alta'
}

/** Arhivă pe care o despachetează workerul (zip / rar / 7z, opțional semnată .p7s). */
export const ARHIVA_RE = /\.(zip|rar|7z)(\.p7s)?$/i
export const esteArhiva = (nume) => ARHIVA_RE.test(String(nume ?? ''))

/** Adâncimea de imbricare a unui document extras: câte spații de nume „(#id)” are în nume. O arhivă de pe nivelul
 *  MAX_ADANCIME_ARHIVE nu se mai despachetează automat (bombă de arhive / buclă) — rămâne cu motivul scris. */
export const MAX_ADANCIME_ARHIVE = 3
export const adancimeArhiva = (nume) => (String(nume ?? '').match(/\(#\d+\)/g) || []).length
