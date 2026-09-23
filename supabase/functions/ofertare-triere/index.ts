// ofertare-triere v1.7.1 (23.09.2026) — ETAPA 0: triere ieftină, DOAR din Fișa de date.
//
// De ce există: colegii descărcau toată documentația (46 fișiere la Simian, planșe de 90 MB la
// Potlogi) și o citeau integral ÎNAINTE să știe dacă vrem licitația. Facturile de API veneau de
// acolo (~20 USD pe licitații la care nici nu s-a luat o decizie). Înainte de platformă, aceeași
// triere se făcea de mână, într-un Excel cu 3 coloane: cerința / ce cere / cine acoperă la Gazpet.
// Funcția asta reproduce Excel-ul ăla dintr-un singur apel pe fișa de date (~20 pagini).
//
// Ce NU face: nu scrie în registrul de cerințe, nu pornește citirea documentelor. Decizia
// „participăm → procesează tot" e a ownerului / responsabilului, din UI.
// v1.1: lista de personal filtrată (fără sudori etc.; 85k tokeni la primul test), max_tokens 8000,
// extragere JSON robustă + stop_reason raportat. v1.2: thinking disabled (Sonnet 5 gândea implicit în bugetul de output).
// v1.3: tip_lucrare_gaze (TKT-2026-0268) + praguri/punctaje citate, nu rezumate (TKT-2026-0271).
// v1.4: propunerea de personal se face pe RECOMANDĂRI, nu pe titulatură sau certificate de curs (TKT-2026-0270).
// v1.7 (23.09.2026, a doua părere Jakarinos): transport gaze la cerință pe DISTRIBUȚIE = scenariu CONDIȚIONAT (nu certitudine):
//   matricea separă proiecte / proiecte_conditionate, repartizarea calculează DOUĂ punctaje (condiționat + conservator, aceeași
//   echipă și echipa conservatoare alternativă), clarificarea către autoritate e garantată din cod (cu rolul + cerința exactă),
//   verdictul nu poate fi „mergem" când echipa depinde de transport, punctajul doar-pe-verificate e afișat separat,
//   lucrarea din recomandare nu se mai taie la 700 caractere, obiectivele duplicate/unitatea baremului se numără o dată.
// v1.7.1 (23.09.2026, recenzie adversarială pe v1.7 — 18 constatări, 3 recenzori): pragul de RISC = cerința minimă SCRISĂ (nu
//   primul prag punctat), clarificarea + riscul se marchează pentru fiecare rol chiar fără barem / cu echipă la 0 puncte,
//   verdictul se escaladează și pe risc fără diferență de puncte, baremul se citește în proiecte/contracte/lucrări/obiective
//   („peste N", „între N și M", trepte prescurtate „4-5 = 7 pct"), matricea se indexează pe (persoană, rol) normalizate,
//   cumulul pe rolurile lăsate pe propunerea AI e marcat + clarificat, filtrul de dubluri nu mai șterge întrebările despre atestate,
//   scenariul e „condiționat" doar dacă echipa propusă chiar folosește transport; punctajele se calculează o dată (12×5: 15 s → 0,1 s).
// v1.5: o persoană = un rol, repartizare pe punctaj total, cu matricea persoană × rol scoasă în JSON înainte de alegere.
// v1.6: la egalitate de punctaj total, câștigă repartizarea cu cea mai mare marjă peste prag.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
// Versiune FIXATĂ intenționat (22.09.2026): cu `@2` flotant, bundlerul Supabase a cerut
// varianta denonext a lui 2.117.0, pe care esm.sh nu o are publicată (auth-js dă 404), și
// deployul a picat cu „Module not found". 2.116.0 are build denonext complet.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const BUCKET = 'ofertare'
const MODEL = 'claude-sonnet-5'
const PRICE_IN = 3 / 1e6, PRICE_OUT = 15 / 1e6
const MAX_BYTES = 28_000_000
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

const PROMPT = `Ești asistentul de ofertare al Gazpet Instal SRL (Ploiești; construcții conducte și rețele de gaze naturale, apă-canal, instalații). Primești FIȘA DE DATE (sau instrucțiunile pentru ofertanți) a unei achiziții publice din SEAP și faci TRIEREA: fișa scurtă pe care o făceau colegii de mână în Excel înainte să decidă dacă merită să descarce și să citească toată documentația.

REGULI:
- Extragi DOAR ce scrie în fișă. Ce nu apare = null. NU inventa. Citează scurt, nu parafraza cerințele de calificare.
- PRAGURI ȘI PUNCTAJE — se CITEAZĂ, nu se rezumă (TKT-2026-0271). Oriunde fișa dă un barem (puncte pe intervale, procente pe factori, praguri de valoare sau de număr de contracte), scrii cifrele exact cum sunt: „2 proiecte = 1 punct; 3-4 proiecte = 3 puncte; 5+ proiecte = 5 puncte". NU scrie forme prescurtate de tip „punctat pe număr de proiecte (2, 3-4, 5+)" — intervalele fără punctajul lor induc în eroare la stabilirea ofertei. Dacă nu vezi punctajul, scrii intervalele și adaugi „(punctaj nespecificat în fișă)".
- TIPUL LUCRĂRII DE GAZE — se deduce din obiect și din datele tehnice, nu din tipul autorității (TKT-2026-0268). TRANSPORT: conductă de transport, operator/aviz TRANSGAZ, presiune peste 6 bar, diametre mari (DN 300+), SRM/SMG, protecție catodică pe magistrală. DISTRIBUȚIE: rețea de distribuție, branșamente, racorduri, presiune redusă/medie (sub 6 bar), operator de distribuție (Distrigaz, Delgaz, Premier Energy). Dacă lucrarea atinge o conductă de transport în funcțiune — chiar dacă beneficiarul e o primărie — e TRANSPORT. Scrii și presiunea și diametrul dacă apar în fișă. Dacă fișa nu permite o concluzie, scrii „neclar" plus ce lipsește; nu ghici.
- Pe fiecare rol de personal cerut, propune din PERSONAL GAZPET (lista de mai jos) persoana care pare să îndeplinească cerința (după tipul autorizației / domeniu / funcție). Dacă nu găsești pe nimeni: propunere = null și motiv scurt. Dacă fișa cere ceva ce nu e în listă (ex. inginer drumuri), spune „nu avem în listă".
- PROPUNEREA DE PERSONAL SE FACE PE DOVEZI, ÎN ORDINEA ASTA (TKT-2026-0270, Silviu + Răzvan, 22.09.2026). Primești și lista RECOMANDĂRI — experiența dovedită a persoanelor, cu rolul, beneficiarul, lucrarea și dacă e verificată în HR.
  (1) Dacă rolul cerut are experiență punctată sau „proiecte similare", propui persoana cu cele mai multe PROIECTE dovedite în recomandări pe rolul și pe natura lucrării cerute. Numeri obiectivele enumerate în lucrare, nu numărul de recomandări: o singură recomandare poate atesta mai multe contracte. În motiv citezi dovada: beneficiar, numărul și data documentului, câte obiective, calificativul.
  (2) Natura se judecă strict, ca la tipul lucrării: o cerință pe conducte de GAZE nu se acoperă cu lucrări de apă-canal sau cu conducte de ȚIȚEI, oricât de asemănătoare ar fi ca execuție. TRANSPORT ↔ DISTRIBUȚIE, ÎNTR-UN SINGUR SENS (Răzvan, 23.09.2026, Grădiștea; a doua părere Jakarinos): când cerința de experiență a rolului cere TRANSPORT, o recomandare pe distribuție nu se numără. Când cerința cere DISTRIBUȚIE (sau „rețele edilitare gaze", „rețele de gaze" fără precizare), lucrările pe conducte de TRANSPORT gaze naturale NU se aruncă: intră în SCENARIUL CONDIȚIONAT de acceptarea lor de către autoritate ca experiență similară/superioară — nu e o certitudine, e o ipoteză pe care o verificăm prin clarificare. Le pui în matrice SEPARAT, în "proiecte_conditionate" (NU în "proiecte"), cu sursele marcate „transport — condiționat". Judeci pe TEXTUL CERINȚEI DE EXPERIENȚĂ AL FIECĂRUI ROL, nu doar pe obiectul contractului. Excepție: dacă cerința exclude transportul — explicit sau prin formulări restrictive ca „exclusiv rețele de distribuție", „numai lucrări de distribuție" — nu se numără deloc (proiecte_conditionate=0 și spui în surse de ce). Țițeiul și apa-canal rămân excluse în ambele sensuri. ROLUL din recomandare trebuie să fie același cu rolul cerut: o recomandare pe RTE (responsabil tehnic cu execuția) NU dovedește experiență de Șef de șantier sau de Manager de proiect, și invers — chiar dacă e aceeași persoană și aceleași lucrări. Echivalente acceptate doar când sunt evident același rol: „șef de șantier" = „șef șantier" = „site manager"; „manager de proiect" = „project manager" = „director de proiect". Persoana cu recomandări doar pe alte roluri intră în matrice cu proiecte=0 pe rolul cerut (Jilava 22.09: un RTE cu 10 obiective apăruse cu 10 proiecte la Șef de șantier).
  (3) Punctajul echipei îl calculează CODUL din matrice, pe TOATE proiectele (verificate + neverificate), și afișează separat cifra doar-pe-verificate; tu nu scrii cifre de punctaj în motiv. Completezi corect "verificate" în matrice; când propui pe cineva cu recomandări neverificate, spui în motiv câte proiecte ies din verificate și câte din neverificate, plus „de confirmat în HR înainte de depunere".
  (4) Dacă nimeni nu are recomandare potrivită, propui pe cine are funcția și autorizația potrivite, DAR scrii în motiv „fără dovadă de experiență în platformă — de completat cu recomandare / document constatator". Un certificat de curs (ex. „Manager proiect 240h") e o calificare, nu experiență, și nu se invocă drept experiență.
  (5) O PERSOANĂ, UN ROL (Răzvan, 22.09.2026, Jilava): când fișa cere mai multe roluri de experți cheie, nu propui aceeași persoană pe două roluri. Repartizezi persoanele pe roluri astfel încât punctajul TOTAL să fie maxim — nu rolul cu rolul, ci echipa întreagă: dacă A ar lua 5 puncte pe oricare rol, iar B ia 5 puncte doar pe rolul X, atunci B merge pe X și A pe celălalt. Aceeași persoană pe două roluri doar când nimeni altcineva nu trece pragul de punctaj pe al doilea rol — și atunci scrii în motiv că e cumul și propui clarificare cu autoritatea.
  (6) ÎNTÂI MATRICEA, APOI REPARTIZAREA. Înainte să alegi, completezi câmpul "matrice_experti": pentru FIECARE persoană care are măcar o recomandare potrivită ca natură a lucrării și pentru FIECARE rol punctat, câte proiecte dovedite are pe rolul ăla și din ce recomandări (beneficiar + nr./dată sau „fără nr."). Numeri TOATE recomandările persoanei pe rol — o recomandare fără număr sau dată de document contează exact la fel ca una cu număr; nu o sări. Un rând pe (persoană, rol), inclusiv cu proiecte=0 dacă persoana n-are recomandare pe rolul respectiv. În "proiecte" pui DOAR obiectivele care trec regula (2) STRICT — pe natura cerută; cele pe TRANSPORT la o cerință de distribuție merg în "proiecte_conditionate" (un obiectiv stă ORI în "proiecte", ORI în "proiecte_conditionate", niciodată în ambele); pe cele excluse (țiței, apă-canal, distribuție când se cere transport) le notezi în "surse" ca „excluse: N (țiței)" și NU le aduni nicăieri (Jilava 22.09: 13 în loc de 9, cu 4 pe țiței adunate). Persoana care are DOAR recomandări pe transport la o cerință de distribuție INTRĂ în matrice (rând cu proiecte=0 și proiecte_conditionate=N) — dacă lipsește din matrice, codul n-o poate propune și nu pune clarificarea (Grădiștea: Trușu, 21 obiective pe transport). "rol" din matrice e EXACT denumirea din "roluri" (nu creezi rânduri separate pe beneficiar, ex. „Manager Proiect (Romgaz)" — se adună la rolul din fișă). Repartizarea de la (5) se face DOAR din matricea asta, iar motivul fiecărei propuneri citează cifra din matrice. La Jilava (22.09) lipsa acestui pas a făcut ca o recomandare de Manager Proiect cu 9 obiective, fără număr de document, să fie ignorată, iar echipa a ieșit cu 3 puncte în minus. UNITATEA DE NUMĂRARE e cea din barem: dacă baremul spune „contracte", o recomandare cu 15 obiective într-un singur contract = 1; dacă spune „proiecte/obiective/lucrări", numeri obiectivele. Un obiectiv care apare în două recomandări (același beneficiar + aceeași lucrare) se numără O SINGURĂ dată, oriunde ar apărea.
  (7) LA EGALITATE, MARJA DECIDE (Răzvan, 22.09.2026). Dacă două repartizări dau același punctaj total, alegi pe cea în care fiecare persoană trece pragul cu cea mai mare marjă — concret, maximizezi cel mai MIC număr de proiecte peste prag din echipă. O dovadă care trece pragul „la limită" sau doar dacă o comisie acceptă o interpretare (ex. conducte colectoare la o cerință pe transport) e mai slabă decât una care îl depășește cu mai multe obiective clare. Spui în motiv că a fost egalitate și de ce a câștigat varianta aleasă. Exemplu: A are 15 pe rolul X și 14 pe Y; B are 9 pe X și 6 pe Y (din care 2 interpretabile); ambele repartizări dau 5+5 — alegi B pe X (9, marjă clară) și A pe Y (14), nu B pe Y (6, la limită).
  (8) RISC DE ELIMINARE (Jakarinos, 23.09.2026): dacă pentru un rol CERINȚA MINIMĂ obligatorie (ex. „minim 1 proiect similar") se îndeplinește DOAR prin proiecte condiționate (transport la cerință de distribuție), scrii în motivul rolului „RISC: cerința minimă depinde de acceptarea transportului — la refuz oferta poate fi respinsă, nu doar depunctată" și verdictul nu poate fi „mergem" (cel mult „cu_clarificari"). Codul adaugă singur clarificarea către autoritate pentru fiecare rol care are în matrice proiecte condiționate și marchează riscul citind cerința minimă din textul rolului — de aceea în "cerinte" copiezi EXACT din fișă cerința minimă („minim N proiecte/contracte/lucrări") și baremul (pragurile cu „pct"/„puncte"), în unitatea din fișă. Tu doar completezi matricea, "cerinte" și "barem" corect — "barem" e STRUCTURAT (minim + trepte cu "de_la" = numărul TOTAL de proiecte, nu cele suplimentare) și e sursa din care codul calculează punctajele; pentru un rol nepunctat, "barem": null.
  NU scrie niciodată „poate demonstra experiență" sau „se va documenta experiența" — dacă dovada nu e în listă, spui că lipsește. Nu invoca drept sprijin o autorizație pe alt domeniu decât cel al lucrării (ex. EGD/PGD = distribuție pe o lucrare de transport): dacă o menționezi, spui explicit că e pe alt domeniu.
- cumul_functii_interzis = true DOAR dacă fișa spune explicit că o persoană nu poate îndeplini mai multe funcții/roluri.
- clarificari_propuse: întrebări scurte pe care le-am trimite autorității când o cerință e ambiguă, contradictorie sau exagerată (ex. experiență similară definită prea îngust, RTE pe domeniu greșit, personal de proiectare într-un contract de execuție).
- verdict: "mergem" (nimic eliminatoriu neacoperit), "cu_clarificari" (mergem dacă se lămuresc punctele), "nu_se_poate" (o cerință eliminatorie clar neacoperită: obiect străin de activitatea firmei, autorizație pe care nu o avem, experiență similară imposibilă), "neclar" (fișa e incompletă). motiv_verdict: 1–2 propoziții.
- Fii CONCIS: textele scurte, fără repetări. Răspunsul întreg sub 3000 de cuvinte.

Răspunde EXCLUSIV JSON, fără markdown:
{
  "obiect": "<denumirea contractului, scurt>",
  "autoritate": "<autoritatea contractantă>",
  "nr_anunt": "<SCN/CN/DF... sau null>",
  "termen_depunere": "<text cu data și ora, sau null>",
  "zile_clarificari": "<câte zile înainte de termen se pot cere clarificări, sau null>",
  "termen_raspuns_ac": "<termenul autorității de răspuns la clarificări, sau null>",
  "amplasament": "<unde se execută, scurt>",
  "descriere": "<descrierea pe scurt a lucrării, max 600 caractere>",
  "tip_lucrare_gaze": { "tip": "transport"|"distributie"|"mixt"|"neclar"|"nu_e_gaze", "presiune": "<ex. 25 bar, sau null>", "diametru": "<ex. DN700, sau null>", "motiv": "<pe ce te-ai bazat, o propoziție>" },
  "valoare_estimata": "<text, ex. 3.057.279,92 RON, sau null>",
  "termen_executie": "<ex. 3 luni, sau null>",
  "criteriu": "<criteriul de atribuire>",
  "experienta_similara": { "cerinta": "<textul cerinței de experiență similară, cu valoare/număr contracte/ani>", "lucrari_acceptate": "<ce lucrări se acceptă ca similare>" },
  "cumul_functii_interzis": true|false,
  "matrice_experti": [ { "persoana": "<NUME>", "rol": "<rolul punctat din fișă>", "proiecte": <număr întreg — DOAR pe natura cerută, necondiționate>, "verificate": <câte din "proiecte" vin din recomandări verificate în HR>, "proiecte_conditionate": <număr întreg — pe TRANSPORT la o cerință de distribuție; 0 dacă nu e cazul>, "verificate_conditionate": <câte din "proiecte_conditionate" vin din recomandări verificate>, "surse": "<beneficiar + nr./dată document sau „fără nr.", câte una per recomandare; cele condiționate marcate „transport — condiționat"; cele excluse marcate „excluse: N (țiței/apă-canal)">" } ],
  "roluri": [ { "rol": "<denumirea rolului>", "cerinte": "<studii/atestări/experiență cerute — cu baremul citat exact>", "barem": { "minim": <număr întreg — cerința minimă obligatorie de proiecte/contracte, sau null>, "unitate": "<proiecte|contracte|lucrari|obiective>", "trepte": [ { "de_la": <numărul TOTAL de proiecte de la care se acordă punctele — dacă fișa spune „2-3 proiecte suplimentare" peste minimul de 1, de_la = 3>, "puncte": <număr> } ] } | null, "documente": "<ce documente se depun>", "propunere": "<NUME din lista Gazpet sau null>", "motiv": "<de ce persoana asta / de ce nimeni>" } ],
  "atestari": "<atestări/autorizații de firmă cerute (ANRE, ISC, ISO...), sau null>",
  "sursa_finantare": "<sau null>",
  "garantie_participare": "<cuantum + formă, sau null>",
  "garantie_buna_executie": "<sau null>",
  "organizare_santier": "<ce cere fișa, scurt, sau null>",
  "liste_cantitati": "<ce formulare se cer: F1,F2,F3,C6..., sau null>",
  "grafic": "<ce cere la graficul de execuție, sau null>",
  "laborator": "<cerințe de laborator/încercări, sau null>",
  "alte_cerinte": [ "<orice altă cerință eliminatorie sau neobișnuită, câte una>" ],
  "clarificari_propuse": [ "<întrebare scurtă>" ],
  "verdict": "mergem"|"cu_clarificari"|"nu_se_poate"|"neclar",
  "motiv_verdict": "<1-2 propoziții>",
  "confidence": <0-100>
}`

function b64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(s)
}


// Repartizare DETERMINISTĂ a experților pe roluri, din matrice (Răzvan, 22.09.2026, Jilava):
// modelul fără gândire a ales de 3 ori o repartizare sub-optimă deși matricea era corectă.
// Baremul se citește din textul cerinței rolului („2 proiecte = 1 punct; 3-4 proiecte = 3 puncte; 5 sau mai multe = 5 puncte").
// Se maximizează punctajul TOTAL al echipei, o persoană pe un singur rol; la egalitate câștigă marja minimă mai mare
// (câte proiecte peste prag), apoi totalul de proiecte. Dacă baremul nu se poate citi, propunerea AI rămâne neschimbată.
type Barem = Array<{ prag: number; puncte: number }>
// v1.7.1 (recenzie 23.09): unitatea din barem e cea din regula (6) — proiecte / contracte / lucrări / obiective. Doar „proiecte"
// făcea ca un barem în contracte să nu se citească deloc, deci scenariile, riscul și clarificarea din cod erau sărite.
const UNIT = String.raw`(?:proiecte?|contracte?|lucr[aă]r[ie]|obiective?)`
// cerința minimă OBLIGATORIE scrisă în text („minim 1 proiect similar", „cel puțin 2 contracte"); null dacă nu e scrisă
function citesteMinim(text: string): number | null {
  const m = new RegExp(String.raw`(?:minim(?:um)?|cel\s+pu[țt]in)\s*(?:de\s+)?(\d+)\s*(?:\([^)]{0,40}\)\s*)?(?:de\s+)?${UNIT}`, 'i').exec(text || '')
  return m ? Number(m[1]) : null
}
function citesteBarem(text: string): { trepte: Barem; minim: number } {
  // v1.7: acceptă și „pct"/„p." nu doar „puncte" (Grădiștea: „2-3 proiecte suplimentare=4pct" nu se citea deloc → repartizarea
  // nu rula), iar „proiecte SUPLIMENTARE" se numără peste minimul obligatoriu (1 proiect minim + 2-3 suplimentare = prag 3).
  const brut: Array<{ prag: number; puncte: number; supl: boolean; plafon?: boolean }> = []
  // v1.7.1: „peste 5 proiecte" = prag 6, „între 2 și 3 proiecte" = prag 2, „maxim 5 proiecte" e plafon (nu se ia drept minim)
  const re = new RegExp(String.raw`(?:(peste|mai\s+mult\s+de|maxim(?:um)?)\s+)?(\d+)\s*(?:-\s*\d+|\s*[șs]i\s+\d+|\s*sau\s+mai\s+multe|\+)?\s*(?:de\s+)?${UNIT}([^=;:.]{0,40}?)(?:=>|=|:|→|[-–—])\s*(\d+(?:[.,]\d+)?)\s*(?:p(?:unct|ct)|p\b)`, 'gi')
  let m: RegExpExecArray | null
  const explicit = citesteMinim(text)
  const intregi: Array<{ idx: number; supl: boolean }> = []
  while ((m = re.exec(text || ''))) {
    const supl = /suplimentar/i.test(m[3] || ''), plafon = /maxim/i.test(m[1] || ''), peste = /peste|mai/i.test(m[1] || '')
    intregi.push({ idx: m.index, supl }); brut.push({ prag: Number(m[2]) + (peste ? 1 : 0), puncte: Number(m[4].replace(',', '.')), supl, plafon })
  }
  // treptele prescurtate („4-5 = 7 pct", „6+ = 10 pct", „2-3 suplimentare=4pct") — DOAR dacă unitatea e stabilită deja (o treaptă
  // cu unitate sau „minim N proiecte" în text — Grădiștea E2 avea numai forma asta), nu pe ani/lei/%; continuă seria treptei
  // întregi dinaintea lor (dacă aia era „suplimentare", și ele sunt)
  if (intregi.length || explicit !== null) {
    // fără interval („6 suplimentare=10pct") se acceptă doar cu „suplimentar" lângă cifră — altfel orice „5 = 3 pct" ar fi treaptă
    const reScurt = new RegExp(String.raw`(\d+)\s*(-\s*\d+|\s*sau\s+mai\s+multe|\+)?\s*([^=;:.\d]{0,40}?)(?:=>|=|:|→|[-–—])\s*(\d+(?:[.,]\d+)?)\s*(?:p(?:unct|ct)|p\b)`, 'gi')
    while ((m = reScurt.exec(text || ''))) {
      if (!m[2] && !/suplimentar/i.test(m[3] || '')) continue
      if (intregi.some(t => t.idx === m!.index || (t.idx < m!.index && m!.index - t.idx <= 14 && /^(peste|mai\s+mult\s+de|maxim(?:um)?)\s+$/i.test(text.slice(t.idx, m!.index)))) || /\b(ani|luni|lei|euro)\b|%/i.test(m[3] || '')) continue
      const anterioara = intregi.filter(t => t.idx < m!.index).pop()
      brut.push({ prag: Number(m[1]), puncte: Number(m[4].replace(',', '.')), supl: !!anterioara?.supl || /suplimentar/i.test(m[3] || '') })
    }
  }
  // baza peste care se adună „suplimentare": minimul scris, altfel primul prag nesuplimentar, altfel 1
  const baza = explicit ?? brut.find(b => !b.supl && !b.plafon)?.prag ?? 1
  const trepte = brut.map(b => ({ prag: b.supl ? b.prag + baza : b.prag, puncte: b.puncte })).sort((a, b) => a.prag - b.prag)
  // v1.7.1 (recenzie): pragul de RISC (regula 8) NU e primul prag PUNCTAT — la Grădiștea ar fi ieșit 3, cu minimul real 1 — ci
  // minimul scris în cerință; fără el, o treaptă nepunctată (0 pct) e minimul; altfel 1 (orice proiect strict scoate rolul din risc)
  const minim = explicit ?? brut.find(b => !b.supl && !b.plafon && b.puncte === 0)?.prag ?? 1
  return { trepte, minim }
}
// v1.7.1 (Grădiștea, a doua rulare reală): modelul transcrie baremul de fiecare dată altfel („= 4 pct", „-4 pct", „(0 pct)"), iar
// parserul de text pierde câte o formă la fiecare rulare. De aceea modelul completează și „barem" STRUCTURAT pe rol (minim +
// trepte cu de_la = total); el e prima sursă, textul rămâne rezervă. Dacă modelul a dat treptele ca „suplimentare" (de_la fără
// minim), iar textul citit confirmă (prima treaptă din text = de_la + minim), se corectează prin adunarea minimului.
function baremRol(r: any): { trepte: Barem; minim: number; sursa: 'structurat' | 'text' | 'niciunul' } {
  const text = String(r?.cerinte || '') + ' ' + String(r?.motiv || '')
  const txt = citesteBarem(text)
  const b = r?.barem
  const minimStruct = Number.isFinite(Number(b?.minim)) && Number(b.minim) > 0 ? Math.floor(Number(b.minim)) : null
  const minim = minimStruct ?? txt.minim
  let trepte: Barem = (Array.isArray(b?.trepte) ? b.trepte : [])
    .map((t: any) => ({ prag: num(t?.de_la ?? t?.prag ?? t?.proiecte), puncte: Number(String(t?.puncte ?? '').replace(',', '.')) }))
    .filter((t: { prag: number; puncte: number }) => t.prag > 0 && Number.isFinite(t.puncte) && t.puncte >= 0)
    .sort((a: { prag: number }, b: { prag: number }) => a.prag - b.prag)
  if (trepte.length) {
    if (/suplimentar/i.test(text) && txt.trepte.length && trepte[0].prag + minim === txt.trepte[0].prag) trepte = trepte.map(t => ({ prag: t.prag + minim, puncte: t.puncte }))
    return { trepte, minim, sursa: 'structurat' }
  }
  return { trepte: txt.trepte, minim, sursa: txt.trepte.length ? 'text' : 'niciunul' }
}
function puncteBarem(barem: Array<{ prag: number; puncte: number }>, n: number) {
  let p = 0, prag = 0
  for (const b of barem) if (n >= b.prag && b.puncte >= p) { p = b.puncte; prag = b.prag }
  return { puncte: p, marja: p > 0 ? n - prag : -1 }
}
type Scenariu = { total: number; totalStrict: number; totalVerif: number; marja: number; proj: number; alocare: (string | null)[] }
// v1.7: două scenarii (Jakarinos, 23.09.2026). „conservator" = doar proiectele necondiționate (natura cerută, strict);
// „conditionat" = + proiectele pe transport la o cerință de distribuție, care depind de acceptarea autorității.
// Echipa propusă e cea optimă în scenariul condiționat (decizia lui Răzvan, varianta A), dar se afișează ȘI punctajul
// ACELEIAȘI echipe dacă transportul e respins, plus cea mai bună echipă pur conservatoare — două maxime obținute cu
// echipe diferite ar ascunde riscul alegerii. La egalitate pe totalul condiționat câștigă totalul conservator, apoi marja.
const norm = (s: any) => String(s || '').toLowerCase().replace(/[șş]/g, 's').replace(/[țţ]/g, 't').replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/\s+/g, ' ').trim()
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 }
type RandMat = { persoana: string; proiecte: number; verificate: number; proiecte_conditionate: number; verificate_conditionate: number }
// v1.7.1 (recenzie 23.09): matricea se indexează O DATĂ pe (persoană, rol) normalizate. Rândurile dublate (același om pe același rol,
// scris de două ori sau cu diacritice/majuscule diferite) se contopesc pe MAXIM — nu pe sumă, ca o dublare din greșeală a modelului
// să nu umfle punctajul. Înainte mat.find lua doar primul rând, iar „TRUSU RAZVAN" și „Trusu Razvan" ieșeau două persoane distincte
// (aceeași persoană pe două roluri, fără notă de cumul).
// v1.7.1 (Grădiștea, rulare reală): modelul scurtează rolul în matrice („E3: RTE" față de „E3: RTE (Responsabil Tehnic cu Executia)"
// din roluri) → rolul ieșea din repartizare. Potrivire: exact, apoi pe codul din față („E3:", „2.")," apoi prefix (min. 4 caractere).
function acelasiRol(a: string, b: string) {
  const na = norm(a), nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const cod = (s: string) => (/^([a-z]?\d+)\s*[:.)]/.exec(s) || [])[1]
  const ca = cod(na), cb = cod(nb)
  if (ca && cb) return ca === cb
  return (na.length >= 4 && nb.length >= 4) && (na.startsWith(nb) || nb.startsWith(na))
}
function indexeazaMatrice(mat: any[]) {
  const idx = new Map<string, RandMat>(), nume = new Map<string, string>(), roluriMat: string[] = []
  const rolCheie = (rol: string) => { const n = norm(rol); if (roluriMat.includes(n)) return n; return roluriMat.find(r => acelasiRol(r, n)) }
  for (const x of mat) {
    const p = String(x?.persoana || '').trim(); if (!p) continue
    if (!nume.has(norm(p))) nume.set(norm(p), p)
    // rolul din rând se leagă de un rol deja văzut dacă e același (scris altfel), ca să nu apară două chei pentru un rol
    const rn = rolCheie(x.rol) ?? norm(x.rol)
    if (!roluriMat.includes(rn)) roluriMat.push(rn)
    const k = norm(p) + '|' + rn
    const cur = idx.get(k) || { persoana: nume.get(norm(p))!, proiecte: 0, verificate: 0, proiecte_conditionate: 0, verificate_conditionate: 0 }
    cur.proiecte = Math.max(cur.proiecte, num(x.proiecte)); cur.verificate = Math.max(cur.verificate, num(x.verificate))
    cur.proiecte_conditionate = Math.max(cur.proiecte_conditionate, num(x.proiecte_conditionate)); cur.verificate_conditionate = Math.max(cur.verificate_conditionate, num(x.verificate_conditionate))
    idx.set(k, cur)
  }
  const rand = (p: string, rol: string) => { const rn = rolCheie(rol); return rn === undefined ? undefined : idx.get(norm(p) + '|' + rn) }
  const areRol = (rol: string) => rolCheie(rol) !== undefined
  return { persoane: [...nume.values()], rand, areRol }
}
function repartizeazaDinMatrice(parsed: any) {
  const roluri: any[] = parsed.roluri, mat: any[] = parsed.matrice_experti
  if (!roluri?.length || !mat?.length) return
  const { persoane, rand, areRol } = indexeazaMatrice(mat)
  const rolIdx: number[] = [], bareme: Barem[] = []
  roluri.forEach((r, i) => {
    const b = baremRol(r)
    r.barem_citit = { minim: b.minim, trepte: b.trepte, sursa: b.sursa }
    if (b.trepte.length && areRol(r.rol)) { rolIdx.push(i); bareme.push(b.trepte) }
  })
  if (!rolIdx.length) return
  // strict = necondiționat; cond = strict + transport condiționat. Verificatele nu pot depăși proiectele.
  const nStrict = (p: string, rol: string) => rand(p, rol)?.proiecte ?? 0
  const nCondSuplim = (p: string, rol: string) => rand(p, rol)?.proiecte_conditionate ?? 0
  const nCond = (p: string, rol: string) => nStrict(p, rol) + nCondSuplim(p, rol)
  const vStrict = (p: string, rol: string) => Math.min(nStrict(p, rol), rand(p, rol)?.verificate ?? 0)
  const vCond = (p: string, rol: string) => vStrict(p, rol) + Math.min(nCondSuplim(p, rol), rand(p, rol)?.verificate_conditionate ?? 0)
  const existaConditionate = persoane.some(p => rolIdx.some(i => nCondSuplim(p, roluri[i].rol) > 0))

  // v1.7.1 (recenzie, performanță): punctajele fiecărei (persoană, rol) în ambele scenarii se calculează O DATĂ, într-un tabel;
  // căutarea exhaustivă doar adună — înainte evalua baremul la fiecare frunză și încă o dată la fiecare comparație (12×5 → 15 s,
  // după apelul plătit; un kill pe CPU nu mai ajungea la fail())
  type Cel = { kStrict: number; kCond: number; pStrict: number; mStrict: number; pCond: number; mCond: number; pvStrict: number; pvCond: number }
  const tab = new Map<string, Cel[]>()
  for (const p of persoane) tab.set(p, rolIdx.map((i, j) => {
    const rol = roluri[i].rol, kS = nStrict(p, rol), kC = nCond(p, rol), sS = puncteBarem(bareme[j], kS), sC = puncteBarem(bareme[j], kC)
    return { kStrict: kS, kCond: kC, pStrict: sS.puncte, mStrict: sS.marja, pCond: sC.puncte, mCond: sC.marja, pvStrict: puncteBarem(bareme[j], vStrict(p, rol)).puncte, pvCond: puncteBarem(bareme[j], vCond(p, rol)).puncte }
  }))
  // evaluarea unei alocări într-un scenariu (cond = cu transport); totalul STRICT al aceleiași alocări iese în aceeași trecere
  const evalueaza = (alocare: (string | null)[], cond: boolean): Scenariu => {
    let total = 0, totalStrict = 0, totalVerif = 0, marja = Infinity, proj = 0
    alocare.forEach((p, j) => {
      if (!p) { marja = Math.min(marja, -1); return }
      const c = tab.get(p)![j]
      total += cond ? c.pCond : c.pStrict; totalStrict += c.pStrict; totalVerif += cond ? c.pvCond : c.pvStrict
      marja = Math.min(marja, cond ? c.mCond : c.mStrict); proj += cond ? c.kCond : c.kStrict
    })
    return { total, totalStrict, totalVerif, marja, proj, alocare: [...alocare] }
  }
  // căutare exhaustivă (roluri puține, persoane puține): o persoană pe un singur rol, rolul poate rămâne gol
  const cauta = (cond: boolean, maiBun: (a: Scenariu, b: Scenariu | null) => boolean): Scenariu | null => {
    let best: Scenariu | null = null
    const rec = (k: number, folosite: Set<string>, alocare: (string | null)[]) => {
      if (k === rolIdx.length) { const sc = evalueaza(alocare, cond); if (maiBun(sc, best)) best = sc; return }
      for (const p of persoane) {
        const c = tab.get(p)![k]
        if (!folosite.has(p) && (cond ? c.kCond : c.kStrict) > 0) { folosite.add(p); rec(k + 1, folosite, [...alocare, p]); folosite.delete(p) }
      }
      rec(k + 1, folosite, [...alocare, null])
    }
    rec(0, new Set(), [])
    return best
  }
  // conservator: maxim total strict; la egalitate marja, apoi proiecte
  const conservator = cauta(false, (a, b) => !b || a.total > b.total || (a.total === b.total && (a.marja > b.marja || (a.marja === b.marja && a.proj > b.proj))))
  // condiționat: maxim total cu transport; la egalitate câștigă totalul CONSERVATOR al aceleiași alocări (Jakarinos), apoi marja, apoi proiecte
  const conditionat = cauta(true, (a, b) => !b || a.total > b.total || (a.total === b.total && (a.totalStrict > b.totalStrict || (a.totalStrict === b.totalStrict && (a.marja > b.marja || (a.marja === b.marja && a.proj > b.proj))))))
  const propus = existaConditionate ? conditionat : conservator
  if (!propus || propus.total <= 0) return
  const aceeasiEchipaConservator = evalueaza(propus.alocare, false)
  // echipa propusă chiar folosește proiecte pe transport? (la egalitate câștigă conservatorul, deci poate să nu — atunci nu e „condiționată")
  const folosesteTransport = rolIdx.some((i, j) => !!propus.alocare[j] && nCondSuplim(propus.alocare[j]!, roluri[i].rol) > 0)

  const rezumat = persoane.map(p => p + ': ' + rolIdx.map(i => { const r = roluri[i].rol, a = nStrict(p, r), b = nCondSuplim(p, r); return r + '=' + a + (b ? '+' + b + 'T' : '') }).join('/')).join('; ')
  const alocati = new Map<string, string>(), alocatIdx = new Set<number>()
  propus.alocare.forEach((p, j) => { if (p) { alocati.set(norm(p), roluri[rolIdx[j]].rol); alocatIdx.add(rolIdx[j]) } })
  rolIdx.forEach((i, j) => {
    const p = propus.alocare[j], r = roluri[i]
    if (!p) return
    const kStrict = nStrict(p, r.rol), kSup = nCondSuplim(p, r.rol), kCond = kStrict + kSup
    const sCond = puncteBarem(bareme[j], kCond), sStrict = puncteBarem(bareme[j], kStrict)
    const vc = vCond(p, r.rol), sVerif = puncteBarem(bareme[j], vc)
    const schimbat = norm(r.propunere) !== norm(p)
    r.propunere = p
    r.puncte_conditionat = sCond.puncte; r.puncte_conservator = sStrict.puncte; r.puncte_doar_verificate = sVerif.puncte
    r.proiecte_conditionate = kSup; r.proiecte_neconditionate = kStrict
    let m = `[Repartizare calculată din matrice] ${p}: ${kCond} proiecte pe ${r.rol}` + (kSup ? ` (din care ${kSup} pe TRANSPORT, condiționate de acceptarea autorității)` : '') +
      ` → ${sCond.puncte} puncte (marjă ${sCond.marja} peste prag)`
    if (kSup) {
      m += `; fără transport: ${kStrict} proiecte → ${sStrict.puncte} puncte`
      r.depinde_de_transport = true   // riscul de eliminare + clarificarea: marcheazaRiscTransport (regula 8)
    }
    m += `. Verificate în HR: ${vc} (punctaj doar pe verificate: ${sVerif.puncte}${vc < kCond ? ' — de confirmat în HR înainte de depunere' : ''}). Echipa: ${propus.total} puncte` +
      (folosesteTransport ? ` cu transport / ${aceeasiEchipaConservator.total} fără` : '') + `. Matrice: ${rezumat}.`
    r.motiv = m + (schimbat ? ' Propunerea AI inițială a fost înlocuită.' : '') + (r.motiv ? ' — ' + String(r.motiv) : '')
  })
  // v1.7.1 (recenzie): rolurile pe care codul nu a pus pe nimeni rămân pe propunerea AI — dar dacă acea persoană a fost repartizată
  // din matrice pe ALT rol, e cumul (regula 5): se spune în motiv și se pune clarificarea de cumul; înainte ieșea aceeași persoană
  // pe două roluri fără nicio notă
  const clarCumul: string[] = []
  roluri.forEach((r, i) => {
    if (alocatIdx.has(i) || !r.propunere) return
    const alt = alocati.get(norm(r.propunere))
    if (!alt || norm(alt) === norm(r.rol)) return
    r.cumul_cu = alt
    r.motiv = `CUMUL: ${r.propunere} e repartizat(ă) din matrice pe „${alt}", iar pe „${r.rol}" nu are proiecte dovedite în matrice — propunerea rămâne doar ca punct de plecare, cu clarificare de cumul către autoritate (regula 5). ` + String(r.motiv || '')
    clarCumul.push(`Referitor la rolurile „${alt}" și „${r.rol}": vă rugăm să precizați dacă aceeași persoană poate ocupa ambele poziții (cumul de funcții) sau dacă se solicită persoane distincte pentru fiecare rol.`)
  })
  parsed.clarificari_cumul = clarCumul
  const aloc = (sc: Scenariu | null) => sc ? rolIdx.map((i, j) => ({ rol: roluri[i].rol, persoana: sc.alocare[j] })) : []
  parsed.repartizare_calculata = {
    scenariu_propus: folosesteTransport ? 'conditionat' : 'conservator',
    depinde_de_transport: folosesteTransport && aceeasiEchipaConservator.total < propus.total,
    roluri_cu_risc_eliminare: [] as string[],   // completat de marcheazaRiscTransport
    conditionat: { total_puncte: propus.total, total_doar_verificate: propus.totalVerif, alocare: aloc(propus) },
    aceeasi_echipa_fara_transport: { total_puncte: aceeasiEchipaConservator.total, total_doar_verificate: aceeasiEchipaConservator.totalVerif },
    conservator: { total_puncte: conservator?.total ?? 0, total_doar_verificate: conservator?.totalVerif ?? 0, alocare: aloc(conservator) },
    // compatibilitate cu UI-ul vechi
    total_puncte: propus.total, alocare: aloc(propus),
  }
}
// v1.7.1 (recenzie 23.09): clarificarea „transport acceptat ca similar?" și RISCUL DE ELIMINARE (regula 8) se marchează AICI,
// pentru FIECARE rol — indiferent dacă baremul s-a putut citi sau dacă echipa a ieșit cu 0 puncte. Înainte stăteau în bucla
// de repartizare, deci un rol cu cerință minimă nepunctată („minim 1 proiect similar în distribuție") sau o echipă cu total 0
// ieșeau fără clarificare, fără risc și cu verdict „mergem" — exact ce promptul îi spune modelului că „face codul singur".
function marcheazaRiscTransport(parsed: any) {
  const roluri: any[] = Array.isArray(parsed.roluri) ? parsed.roluri : [], mat: any[] = Array.isArray(parsed.matrice_experti) ? parsed.matrice_experti : []
  const { persoane, rand } = indexeazaMatrice(mat)
  const clar: string[] = [], roluriCuRisc: string[] = [], roluriCond: string[] = []
  for (const r of roluri) {
    const randuri = persoane.map(p => rand(p, r.rol)).filter(Boolean) as RandMat[]
    if (!randuri.some(x => x.proiecte_conditionate > 0)) continue
    // există candidați cu proiecte pe transport la rolul ăsta → întrebarea către autoritate e obligatorie, chiar dacă propusul e altcineva
    roluriCond.push(r.rol)
    const cer = String(r.cerinte || '').replace(/\s+/g, ' ').trim().slice(0, 260)
    clar.push(`Referitor la rolul „${r.rol}"${cer ? ` (cerința: „${cer}${String(r.cerinte || '').trim().length > 260 ? '…' : ''}")` : ''}: vă rugăm să confirmați dacă experiența dobândită în execuția de conducte de transport gaze naturale (presiune înaltă) este acceptată ca experiență similară/superioară pentru cerința privind rețelele de distribuție gaze naturale, atât la îndeplinirea cerinței minime, cât și la punctarea factorului de evaluare.`)
    const rp = r.propunere ? rand(String(r.propunere), r.rol) : undefined
    const kSup = rp?.proiecte_conditionate ?? 0
    if (!rp || !kSup) continue
    const kStrict = rp.proiecte, kCond = kStrict + kSup
    r.depinde_de_transport = true
    if (!Number.isFinite(r.proiecte_conditionate)) { r.proiecte_conditionate = kSup; r.proiecte_neconditionate = kStrict }
    // cerința minimă: cea scrisă în text („minim N proiecte/contracte"), altfel treapta nepunctată din barem, altfel 1
    const pragMin = baremRol(r).minim
    if (kStrict < pragMin && kCond >= pragMin) {
      r.risc_eliminare = true; roluriCuRisc.push(r.rol)
      const txt = `RISC: cerința minimă (${pragMin} proiect${pragMin > 1 ? 'e' : ''}) depinde de acceptarea transportului — la refuz oferta poate fi respinsă, nu doar depunctată.`
      if (!String(r.motiv || '').includes('RISC: cerința minimă')) r.motiv = txt + (r.motiv ? ' ' + String(r.motiv) : '')
    }
  }
  parsed.clarificari_cod = [...clar, ...(Array.isArray(parsed.clarificari_cumul) ? parsed.clarificari_cumul : [])]
  delete parsed.clarificari_cumul
  parsed.risc_transport = { roluri_conditionate: roluriCond, roluri_cu_risc_eliminare: roluriCuRisc }
  if (parsed.repartizare_calculata) parsed.repartizare_calculata.roluri_cu_risc_eliminare = roluriCuRisc
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })

  try {
    const { licitatie_id, doc_id } = await req.json()
    const lid = Number(licitatie_id)
    if (!lid) return fail('licitatie_id lipsă')

    // cine cere (pentru created_by) — JWT-ul userului vine în Authorization
    let userId: string | null = null
    try {
      const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
      const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
      const { data: u } = await anon.auth.getUser()
      userId = u?.user?.id || null
    } catch (_) { /* fără user — rămâne null */ }

    // Fișa de date: cea indicată explicit sau prima de tip fisa_date a licitației
    let q = supabase.from('ofertare_documente_atribuire').select('id, nume_original, fisier_path, tip, size_bytes, pagini').eq('licitatie_id', lid)
    q = doc_id ? q.eq('id', doc_id) : q.eq('tip', 'fisa_date').not('fisier_path', 'like', '%/neincarcat/%').order('id')
    const { data: docs, error: eDoc } = await q.limit(1)
    if (eDoc) return fail('documente: ' + eDoc.message)
    const doc = docs?.[0]
    if (!doc) return fail('Licitația nu are încă o Fișă de date în documentație. Apasă „Adu din SEAP" (doar descarcă, nu citește) sau urcă fișa de date, apoi reia trierea.')
    if (!/\.pdf$/i.test(doc.nume_original || '')) return fail(`Fișa de date nu e PDF (${doc.nume_original}).`)

    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(doc.fisier_path)
    if (dlErr || !blob) return fail('Nu am putut descărca fișa: ' + (dlErr?.message || doc.fisier_path))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length > MAX_BYTES) return fail(`Fișa are ${(bytes.length / 1e6).toFixed(1)} MB — prea mare pentru citire directă.`)

    // PERSONAL GAZPET — aceeași sursă ca motorul de acoperire, dar compactă
    // TKT-2026-0270: a treia sursă — RECOMANDĂRILE. Fără ele, propunerea se făcea pe titulatură și
    // pe certificate de curs; la SCN1179907 a ieșit un om cu 0 recomandări în locul unuia cu 9.
    const [{ data: auth, error: eAuth }, { data: emp, error: eEmp }, { data: rec, error: eRec }] = await Promise.all([
      supabase.from('hr_autorizatii')
        .select('data_expirare, fara_expirare, domenii, tip:hr_autorizatii_tipuri(denumire), emp:employees(name, position), ext:hr_personal_extern(nume)')
        .is('deleted_at', null).order('id'),
      supabase.from('employees').select('name, position, functie').eq('active', true)
        .or('position.ilike.%inginer%,position.ilike.%manager%,position.ilike.%sef%,position.ilike.%șef%,position.ilike.%responsabil%,position.ilike.%director%,position.ilike.%proiect%,position.ilike.%calitate%,position.ilike.%ssm%,position.ilike.%mediu%')
        .order('name').limit(120),
      supabase.from('hr_recomandari')
        .select('rol, beneficiar, obiect_lucrare, domenii, verificat, nr_document, data_document, calificativ, emp:employees(name, active), ext:hr_personal_extern(nume, activ)')
        .eq('activ', true).order('id'),
    ])
    // supabase-js nu aruncă la eșec: fără verificarea asta, un timeout ar deveni „nu avem pe nimeni".
    if (eAuth || eEmp || eRec) return fail('catalog personal indisponibil: ' + (eAuth?.message || eEmp?.message || eRec?.message))
    const azi = new Date().toISOString().slice(0, 10)
    // Doar ce contează la triere: roluri de conducere/atestări de persoană. Sudorii, legătorii,
    // stivuitoriștii etc. sunt sute de rânduri care umflă inputul (85k tokeni la primul test) fără
    // să răspundă vreunei cerințe din fișa de date. Dedup pe (persoană, tip, domenii).
    const RELEVANT = /rte|responsabil tehnic|anre|diriginte|manager|sef|șef|cq|calitate|ssm|securitate|mediu|proiectant|inginer|expert|verificator|coordonator|isc|electric|instalator autorizat|gaze/i
    const IRELEVANT = /sudor|sudur|legator|legător|stivuitor|macaragiu|fochist|conducator auto|conducător auto|prim ajutor|iscir/i
    const vaz = new Set<string>()
    const linii: string[] = []
    for (const a of (auth || []) as any[]) {
      const tip = a.tip?.denumire || 'autorizație'
      if (IRELEVANT.test(tip) || !RELEVANT.test(tip)) continue
      const cine = a.emp?.name || a.ext?.nume || '?'
      const dom = a.domenii?.length ? ' ' + a.domenii.join(', ') : ''
      const k = `${cine}|${tip}|${dom}`
      if (vaz.has(k)) continue
      vaz.add(k)
      const exp = a.fara_expirare ? '' : a.data_expirare ? (a.data_expirare < azi ? ` [EXPIRAT ${a.data_expirare}]` : ` (până ${a.data_expirare})`) : ''
      linii.push(`- ${cine}${a.ext ? ' (extern)' : ''}: ${tip}${dom}${exp}`)
    }
    for (const e of (emp || []) as any[]) linii.push(`- ${e.name}: ${e.functie || e.position}`)
    const personal = linii.slice(0, 160).join('\n')

    // Recomandările: titularul trebuie să fie activ (un om plecat nu poate fi propus), iar lucrarea
    // se dă întreagă — de acolo numără modelul obiectivele, nu din numărul de rânduri.
    // v1.7: plafonul era 700 caractere (Jakarinos: o listă de 21 de obiective ajungea tăiată); azi cea mai lungă lucrare
    // are ~600 caractere și toate cele 32 însumează ~6.500, deci 3.000 per lucrare nu umflă inputul.
    const recLinii = ((rec || []) as any[])
      .filter(r => (r.emp ? r.emp.active !== false : r.ext ? r.ext.activ !== false : false))
      .map(r => {
        const cine = r.emp?.name || r.ext?.nume || '?'
        const doc = [r.nr_document && ('nr. ' + r.nr_document), r.data_document].filter(Boolean).join('/')
        const dom = r.domenii?.length ? ` [${r.domenii.join(', ')}]` : ''
        const cal = r.calificativ ? ` · calificativ: ${r.calificativ}` : ''
        return `- ${cine}${r.ext ? ' (extern)' : ''} — ca ${r.rol || 'rol nespecificat'}, beneficiar ${r.beneficiar || '?'}${doc ? ' (' + doc + ')' : ''}${dom}${r.verificat ? '' : ' [NEVERIFICATĂ în HR]'}${cal}\n  lucrare: ${String(r.obiect_lucrare || '—').slice(0, 3000)}`
      })
    const recomandari = recLinii.join('\n')

    const text = `${PROMPT}\n\nNumele fișierului: "${String(doc.nume_original).slice(-120)}"\n\nPERSONAL GAZPET (autorizații + funcții; [EXPIRAT] = nu se poate folosi fără reînnoire):\n${personal || '(listă goală)'}\n\nRECOMANDĂRI — experiența DOVEDITĂ a persoanelor (${recLinii.length}; numeri obiectivele din „lucrare", nu rândurile):\n${recomandari || '(nicio recomandare în platformă)'}`
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8000,
        // Sonnet 5 gândește implicit (adaptive) și gândirea intră în max_tokens: Potlogi a ieșit gol la 8000.
        // Extragere structurată — nu avem nevoie de gândire.
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(bytes) } },
          { type: 'text', text },
        ] }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) return fail('Claude: ' + (data.error?.message || resp.status))
    const u = data.usage || {}
    const cost = (u.input_tokens || 0) * PRICE_IN + (u.output_tokens || 0) * PRICE_OUT
    try {
      await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-triere', model: MODEL, tokens_in: u.input_tokens || 0, tokens_out: u.output_tokens || 0, cost_usd: cost, ref_table: 'ofertare_licitatii', ref_id: lid })
    } catch (_) {}

    if (data.stop_reason === 'max_tokens') return fail(`Răspunsul AI a fost tăiat la ${u.output_tokens} tokeni — fișa e neobișnuit de lungă; reia trierea.`)
    let parsed: any
    const txt = String(data.content?.find((c: any) => c.type === 'text')?.text || '')
    try {
      const i = txt.indexOf('{'), j = txt.lastIndexOf('}')
      parsed = JSON.parse(i >= 0 && j > i ? txt.slice(i, j + 1) : '{}')
      if (!parsed || typeof parsed !== 'object' || !Object.keys(parsed).length) throw new Error('gol')
    } catch (_) { return fail(`AI a răspuns într-un format neașteptat (${(data.content || []).map((c: any) => c.type).join(',') || 'fără conținut'}; stop=${data.stop_reason}): ${txt.slice(0, 200)}`) }
    const verdict = ['mergem', 'cu_clarificari', 'nu_se_poate', 'neclar'].includes(parsed.verdict) ? parsed.verdict : 'neclar'
    parsed.verdict = verdict
    parsed.roluri = Array.isArray(parsed.roluri) ? parsed.roluri.slice(0, 40) : []
    parsed.matrice_experti = Array.isArray(parsed.matrice_experti) ? parsed.matrice_experti.slice(0, 60) : []
    repartizeazaDinMatrice(parsed)
    marcheazaRiscTransport(parsed)
    // v1.7: clarificarea „transport acceptat ca similar?" e garantată din cod, per rol, PRIMA în listă (nu poate dispărea prin
    // slice și nu depinde de model); întrebările generice ale modelului pe același subiect se elimină ca dubluri.
    const dinCod: string[] = Array.isArray(parsed.clarificari_cod) ? parsed.clarificari_cod : []
    const aleModelului = (Array.isArray(parsed.clarificari_propuse) ? parsed.clarificari_propuse : []).filter((c: any) => typeof c === 'string' && c.trim())
      // dublură = aceeași întrebare (experiență/recomandări pe transport vs distribuție); una despre atestate 8.4T/8.4D e alt subiect (R7/R10)
      .filter((c: string) => !(dinCod.length && /transport/i.test(c) && /distribu/i.test(c) && /experien|similar|recomand|proiect|lucr[aă]r/i.test(c)))
    parsed.clarificari_propuse = [...dinCod, ...aleModelului].slice(0, 20)
    delete parsed.clarificari_cod
    // v1.7.1: escaladarea și când punctele sunt egale dar cerința MINIMĂ a unui rol trece doar cu transportul (regula 8)
    const rc = parsed.repartizare_calculata, roluriRisc: string[] = parsed.risc_transport?.roluri_cu_risc_eliminare || []
    if ((rc?.depinde_de_transport || roluriRisc.length) && parsed.verdict === 'mergem') {
      parsed.verdict = 'cu_clarificari'
      parsed.motiv_verdict = (rc?.depinde_de_transport
        ? `Punctajul echipei depinde de acceptarea experienței pe transport gaze la o cerință de distribuție (${rc.conditionat?.total_puncte} puncte cu transport / ${rc.aceeasi_echipa_fara_transport?.total_puncte} fără)`
        : 'Echipa propusă se sprijină pe experiență pe transport gaze la o cerință de distribuție') +
        (roluriRisc.length ? `; la ${roluriRisc.join(', ')} chiar cerința minimă depinde de asta — risc de respingere` : '') + '. ' + String(parsed.motiv_verdict || '')
    }
    parsed.alte_cerinte = Array.isArray(parsed.alte_cerinte) ? parsed.alte_cerinte.slice(0, 30) : []
    parsed.sursa = { doc_id: doc.id, nume: doc.nume_original, pagini: doc.pagini }

    const verdictFinal = parsed.verdict
    const { error: eUp } = await supabase.from('ofertare_triere').upsert({
      licitatie_id: lid, doc_id: doc.id, rezultat: parsed, verdict: verdictFinal, model: MODEL, cost_usd: cost.toFixed(4),
      created_by: userId, updated_at: new Date().toISOString(),
    }, { onConflict: 'licitatie_id' })
    if (eUp) return fail('salvare triere: ' + eUp.message)

    return new Response(JSON.stringify({ ok: true, verdict: verdictFinal, cost_usd: Number(cost.toFixed(4)), rezultat: parsed }), { headers: CORS })
  } catch (e: any) {
    return fail('Eroare neașteptată: ' + String(e?.message || e))
  }
})
