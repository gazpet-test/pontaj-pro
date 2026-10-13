// ofertare-triere v1.8 (23.09.2026) — ETAPA 0: triere ieftină, DOAR din Fișa de date.
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
// v1.8 (23.09.2026, Răzvan): MATRICEA CALCULATĂ DE COD din BD (recomandare × rol canonic × natură, din obiectivele structurate #1399);
//   modelul dă doar rol_canonic / natura_ceruta / exclude_transport pe rol; rândurile lui rămân rezervă pentru recomandările fără listă.
// v1.5: o persoană = un rol, repartizare pe punctaj total, cu matricea persoană × rol scoasă în JSON înainte de alegere.
// v1.6: la egalitate de punctaj total, câștigă repartizarea cu cea mai mare marjă peste prag.
// v1.9 (13.10.2026, Botoșani 102, plan docs/ofertare/PLAN_TRIERE_102.md): DETALIEREA CRITERIILOR (document separat) intră în context
//   prin poarta de loturi (blocată = avertisment vizibil, verdictul nu poate fi „mergem”); AUTORIZAȚIILE DE FIRMĂ din documente_firma
//   intră în context și se verifică în cod (atestari_firma cu id); codul ANRE cerut pe rol se verifică în cod (literal sau echivalență
//   APROBATĂ, _shared/echivalenteAnre.ts), cu preferința Răzvan pe EGT; baremul acceptă bonus (certificat); autorizațiile de persoană
//   doar cu titular activ, lista prioritizată pe ANRE / RTE / manager. Logica pură: ./context.ts.
import { poartaOfertare } from '../_shared/poartaOfertare.ts'
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
// Versiune FIXATĂ intenționat (22.09.2026): cu `@2` flotant, bundlerul Supabase a cerut
// varianta denonext a lui 2.117.0, pe care esm.sh nu o are publicată (auth-js dă 404), și
// deployul a picat cu „Module not found". 2.116.0 are build denonext complet.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { documentEligibil, mesajLot } from '../_shared/eligibilLot.ts'   // poarta pe loturi (20261024b), fail-closed
import { marcheazaRiscTransport, matriceDinBD, repartizeazaDinMatrice } from './repartizare.ts'
import { adnoteazaBonus, bonusPersoana, coduriPePersoana, LIMITA_CANDIDATI_CRITERII, liniiFirma, MAX_CRITERII_CARACTERE, PREFERINTE_COD, selecteazaCriterii, SQL_CRITERII, valideazaAtestariFirma, verificaAutorizatiiRoluri, type AutPers } from './context.ts'

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
  (6) ÎNTÂI MATRICEA, APOI REPARTIZAREA. Pentru rolurile la care completezi "rol_canonic" și "natura_ceruta", MATRICEA O CALCULEAZĂ CODUL din obiectivele structurate ale recomandărilor din BD (aceleași reguli: strict = natura cerută, condiționat = transport la distribuție, țiței/apă excluse, un obiectiv o singură dată) și o înlocuiește pe a ta — tu o completezi oricum, ca rezervă pentru recomandările fără obiective structurate. Înainte să alegi, completezi câmpul "matrice_experti": pentru FIECARE persoană care are măcar o recomandare potrivită ca natură a lucrării și pentru FIECARE rol punctat, câte proiecte dovedite are pe rolul ăla și din ce recomandări (beneficiar + nr./dată sau „fără nr."). Numeri TOATE recomandările persoanei pe rol — o recomandare fără număr sau dată de document contează exact la fel ca una cu număr; nu o sări. Un rând pe (persoană, rol), inclusiv cu proiecte=0 dacă persoana n-are recomandare pe rolul respectiv. În "proiecte" pui DOAR obiectivele care trec regula (2) STRICT — pe natura cerută; cele pe TRANSPORT la o cerință de distribuție merg în "proiecte_conditionate" (un obiectiv stă ORI în "proiecte", ORI în "proiecte_conditionate", niciodată în ambele); pe cele excluse (țiței, apă-canal, distribuție când se cere transport) le notezi în "surse" ca „excluse: N (țiței)" și NU le aduni nicăieri (Jilava 22.09: 13 în loc de 9, cu 4 pe țiței adunate). Persoana care are DOAR recomandări pe transport la o cerință de distribuție INTRĂ în matrice (rând cu proiecte=0 și proiecte_conditionate=N) — dacă lipsește din matrice, codul n-o poate propune și nu pune clarificarea (Grădiștea: Trușu, 21 obiective pe transport). "rol" din matrice e EXACT denumirea din "roluri" (nu creezi rânduri separate pe beneficiar, ex. „Manager Proiect (Romgaz)" — se adună la rolul din fișă). Repartizarea de la (5) se face DOAR din matricea asta, iar motivul fiecărei propuneri citează cifra din matrice. La Jilava (22.09) lipsa acestui pas a făcut ca o recomandare de Manager Proiect cu 9 obiective, fără număr de document, să fie ignorată, iar echipa a ieșit cu 3 puncte în minus. UNITATEA DE NUMĂRARE e cea din barem: dacă baremul spune „contracte", o recomandare cu 15 obiective într-un singur contract = 1; dacă spune „proiecte/obiective/lucrări", numeri obiectivele. Un obiectiv care apare în două recomandări (același beneficiar + aceeași lucrare) se numără O SINGURĂ dată, oriunde ar apărea. Dacă recomandarea are „OBIECTIVE STRUCTURATE", numeri EXACT elementele de acolo (natura fiecăruia e în paranteză: transport / distributie / titei / apa_canal) — nu reciți proza; proza contează doar la recomandările fără listă structurată.
  (7) LA EGALITATE, MARJA DECIDE (Răzvan, 22.09.2026). Dacă două repartizări dau același punctaj total, alegi pe cea în care fiecare persoană trece pragul cu cea mai mare marjă — concret, maximizezi cel mai MIC număr de proiecte peste prag din echipă. O dovadă care trece pragul „la limită" sau doar dacă o comisie acceptă o interpretare (ex. conducte colectoare la o cerință pe transport) e mai slabă decât una care îl depășește cu mai multe obiective clare. Spui în motiv că a fost egalitate și de ce a câștigat varianta aleasă. Exemplu: A are 15 pe rolul X și 14 pe Y; B are 9 pe X și 6 pe Y (din care 2 interpretabile); ambele repartizări dau 5+5 — alegi B pe X (9, marjă clară) și A pe Y (14), nu B pe Y (6, la limită).
  (8) RISC DE ELIMINARE (Jakarinos, 23.09.2026): dacă pentru un rol CERINȚA MINIMĂ obligatorie (ex. „minim 1 proiect similar") se îndeplinește DOAR prin proiecte condiționate (transport la cerință de distribuție), scrii în motivul rolului „RISC: cerința minimă depinde de acceptarea transportului — la refuz oferta poate fi respinsă, nu doar depunctată" și verdictul nu poate fi „mergem" (cel mult „cu_clarificari"). Codul adaugă singur clarificarea către autoritate pentru fiecare rol care are în matrice proiecte condiționate și marchează riscul citind cerința minimă din textul rolului — de aceea în "cerinte" copiezi EXACT din fișă cerința minimă („minim N proiecte/contracte/lucrări") și baremul (pragurile cu „pct"/„puncte"), în unitatea din fișă. Tu doar completezi matricea, "cerinte" și "barem" corect — "barem" e STRUCTURAT (minim + trepte cu "de_la" = numărul TOTAL de proiecte, nu cele suplimentare) și e sursa din care codul calculează punctajele; pentru un rol nepunctat, "barem": null.
  NU scrie niciodată „poate demonstra experiență" sau „se va documenta experiența" — dacă dovada nu e în listă, spui că lipsește. Nu invoca drept sprijin o autorizație pe alt domeniu decât cel al lucrării (ex. EGD/PGD = distribuție pe o lucrare de transport): dacă o menționezi, spui explicit că e pe alt domeniu.
- AUTORIZAȚII DE FIRMĂ ≠ PERSONAL (v1.9, Răzvan 12.10.2026). Autorizațiile ANRE / ISC / ISO ale OPERATORULUI ECONOMIC (ex. ANRE ET, EDIB, EDSB, EPI — „autorizație … pentru executarea sistemelor de transport” etc.) NU sunt roluri de personal: nu le pui în "roluri" și nu le „acoperi” cu legitimația unei persoane (EGT ≠ ET). Le pui în "atestari_firma", câte una pe cerință, cu "document_firma_id" = numărul (#id) din lista AUTORIZAȚII FIRMĂ GAZPET dacă o autorizație VALABILĂ de acolo o acoperă literal, altfel null. Codul verifică id-ul.
- FACTORII DE EVALUARE NU SUNT ROLURI. „Calificarea personalului cheie — factor 2 (15%)” e un factor; rolurile punctate (ex. Manager Proiect) și baremul lor le iei din DETALIERE CRITERII DE ATRIBUIRE (dacă e dată mai jos), citate exact. Un punctaj suplimentar condiționat (ex. „+2 puncte pentru certificat de curs Manager de proiect”) îl pui în "barem"."bonus" (puncte + condiție), NU ca treaptă. Dacă detalierea lipsește și fișa doar o referă, spui asta în "alte_cerinte" și propui clarificare.
- CODURI ANRE DE PERSOANĂ: în "autorizatie_ceruta" pe rol scrii codul cerut LITERAL din fișă (ex. „EGT”), sau null. NU inventa echivalențe între nomenclaturi (vechi/noi) — codul le verifică pe cele aprobate; tu doar citezi.
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
  "roluri": [ { "rol": "<denumirea rolului>", "rol_canonic": "<manager_proiect|sef_santier|rte|cq|ssm|inginer|altul — rolul cerut, normalizat>", "natura_ceruta": "<distributie|transport|gaze_orice|alta — natura lucrării cerute la experiența rolului: distributie = rețele de distribuție / edilitare gaze / „rețele de gaze" fără precizare; transport = conducte de transport; gaze_orice = fișa acceptă explicit ambele; alta = nu e gaze>", "exclude_transport": <true dacă cerința exclude explicit transportul („exclusiv/numai distribuție"), altfel false>, "cerinte": "<studii/atestări/experiență cerute — cu baremul citat exact>", "autorizatie_ceruta": "<cod ANRE de persoană cerut literal pe rol (ex. EGT), sau null>", "barem": { "minim": <număr întreg — cerința minimă obligatorie de proiecte/contracte, sau null>, "unitate": "<proiecte|contracte|lucrari|obiective>", "trepte": [ { "de_la": <numărul TOTAL de proiecte de la care se acordă punctele — dacă fișa spune „2-3 proiecte suplimentare" peste minimul de 1, de_la = 3>, "puncte": <număr> } ], "bonus": { "puncte": <număr>, "conditie": "<ex. certificat de curs Manager de proiect>" } | null } | null, "documente": "<ce documente se depun>", "propunere": "<NUME din lista Gazpet sau null>", "motiv": "<de ce persoana asta / de ce nimeni>" } ],
  "atestari": "<atestări/autorizații de firmă cerute (ANRE, ISC, ISO...), sau null>",
  "atestari_firma": [ { "cerinta": "<autorizația de firmă cerută, citată scurt>", "document_firma_id": <#id din AUTORIZAȚII FIRMĂ GAZPET care o acoperă, sau null> } ],
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


Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const identitate: { userId?: string } = {}
  const refuzAcces = await poartaOfertare(req, { context: identitate })
  if (refuzAcces) return refuzAcces
  const userId = identitate.userId!
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })

  try {
    const { licitatie_id, doc_id } = await req.json()
    const lid = Number(licitatie_id)
    if (!lid) return fail('licitatie_id lipsă')

    // Fișa de date: cea indicată explicit sau prima de tip fisa_date a licitației
    let q = supabase.from('ofertare_documente_atribuire').select('id, nume_original, fisier_path, tip, size_bytes, pagini').eq('licitatie_id', lid)
    q = doc_id ? q.eq('id', doc_id) : q.eq('tip', 'fisa_date').not('fisier_path', 'like', '%/neincarcat/%').order('id')
    const { data: docs, error: eDoc } = await q.limit(1)
    if (eDoc) return fail('documente: ' + eDoc.message)
    const doc = docs?.[0]
    if (!doc) return fail('Licitația nu are încă o Fișă de date în documentație. Apasă „Adu din SEAP" (doar descarcă, nu citește) sau urcă fișa de date, apoi reia trierea.')
    if (!/\.pdf$/i.test(doc.nume_original || '')) return fail(`Fișa de date nu e PDF (${doc.nume_original}).`)
    // LOTURI: și fișa de date trece prin poartă (fără excepție în cod — contractul e în SQL), înaintea descărcării și a AI
    const el = await documentEligibil(supabase, doc.id)
    if (!el.eligibil) return new Response(JSON.stringify({ ok: false, blocat_lot: true, motiv: el.motiv, error: mesajLot(el.motiv), doc_id: doc.id }), { status: 200, headers: CORS })

    const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(doc.fisier_path)
    if (dlErr || !blob) return fail('Nu am putut descărca fișa: ' + (dlErr?.message || doc.fisier_path))
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length > MAX_BYTES) return fail(`Fișa are ${(bytes.length / 1e6).toFixed(1)} MB — prea mare pentru citire directă.`)

    // PERSONAL GAZPET — aceeași sursă ca motorul de acoperire, dar compactă
    // TKT-2026-0270: a treia sursă — RECOMANDĂRILE. Fără ele, propunerea se făcea pe titulatură și
    // pe certificate de curs; la SCN1179907 a ieșit un om cu 0 recomandări în locul unuia cu 9.
    const [{ data: auth, error: eAuth }, { data: emp, error: eEmp }, { data: rec, error: eRec }, { data: firma, error: eFirma }, { data: candCrit, error: eCrit }, { data: lic, error: eLic }] = await Promise.all([
      supabase.from('hr_autorizatii')
        .select('employee_id, extern_id, data_expirare, fara_expirare, domenii, tip:hr_autorizatii_tipuri(denumire), emp:employees(name, position, active), ext:hr_personal_extern(nume, activ)')
        .is('deleted_at', null).order('id'),
      supabase.from('employees').select('name, position, functie').eq('active', true)
        .or('position.ilike.%inginer%,position.ilike.%manager%,position.ilike.%sef%,position.ilike.%șef%,position.ilike.%responsabil%,position.ilike.%director%,position.ilike.%proiect%,position.ilike.%calitate%,position.ilike.%ssm%,position.ilike.%mediu%')
        .order('name').limit(120),
      supabase.from('hr_recomandari')
        .select('id, rol, beneficiar, obiect_lucrare, obiective, domenii, verificat, nr_document, data_document, calificativ, emp:employees(name, active), ext:hr_personal_extern(nume, activ)')
        .eq('activ', true).order('id'),
      // v1.9: autorizațiile de FIRMĂ (ET, EDIB…) — activ + utilizabil; valabilitatea o judecă codul (context.ts)
      supabase.from('documente_firma').select('id, denumire, tip, categorie, data_valabilitate, fara_expirare')
        .eq('activ', true).eq('utilizabil', true).order('id').limit(300),
      // v1.9: documentele de criterii (D3: după nume, fără schemă) — puține, deci textul vine direct
      supabase.from('ofertare_documente_atribuire').select('id, nume_original, tip, text_extras').eq('licitatie_id', lid)
        .or(SQL_CRITERII).order('id').limit(LIMITA_CANDIDATI_CRITERII + 1),
      supabase.from('ofertare_licitatii').select('termen_depunere').eq('id', lid).maybeSingle(),
    ])
    // supabase-js nu aruncă la eșec: fără verificarea asta, un timeout ar deveni „nu avem pe nimeni".
    if (eAuth || eEmp || eRec) return fail('catalog personal indisponibil: ' + (eAuth?.message || eEmp?.message || eRec?.message))
    // fail-closed: fără lista firmei sau fără căutarea criteriilor, trierea ar spune fals „lipsește” / „nu sunt criterii”
    if (eFirma || eCrit || eLic) return fail('context triere indisponibil: ' + (eFirma?.message || eCrit?.message || eLic?.message))
    const azi = new Date().toISOString().slice(0, 10)
    // valabilitățile se judecă la TERMENUL DE DEPUNERE (Jakarinos r1 P1 #2; și la o re-triere după termen — Copilot r1 P2); fără termen, azi
    const termen = lic?.termen_depunere ? String(lic.termen_depunere).slice(0, 10) : null
    const ref = termen ?? azi
    const avertismente: string[] = []
    // ── DETALIEREA CRITERIILOR: fiecare document trece prin poarta de loturi; blocat = avertisment, nu tăcere ──
    if ((candCrit || []).length > LIMITA_CANDIDATI_CRITERII) avertismente.push(`Peste ${LIMITA_CANDIDATI_CRITERII} documente cu nume de criterii — lista a fost trunchiată, unele NU au fost verificate.`)
    const candidati = ((candCrit || []) as any[]).slice(0, LIMITA_CANDIDATI_CRITERII).map((d) => ({ ...d, are_text: String(d.text_extras || '').trim().length > 0 }))
    const selCrit = selecteazaCriterii(candidati, doc.id)
    const numeDoc = (id: number) => candidati.find((x) => Number(x.id) === id)?.nume_original || ''
    for (const id of selCrit.fara_text) avertismente.push(`Documentul de criterii #${id} „${numeDoc(id)}” nu are text extras — NU a intrat în context (de citit / verificat de om).`)
    for (const id of selCrit.peste_plafon) avertismente.push(`Documentul de criterii #${id} „${numeDoc(id)}” NU a intrat în context (plafon de documente de criterii).`)
    let criterii = '', criteriiFolosite: number[] = []
    for (const id of selCrit.cu_text) {
      const d = candidati.find((x) => Number(x.id) === id)!
      const elC = await documentEligibil(supabase, id)
      // eroarea porții = verificarea n-a răspuns: oprire înainte de AI, nu context parțial (Jakarinos r1 P2)
      if (elC.motiv === 'eroare_poarta') return fail('Verificarea pe loturi a documentelor de criterii nu a răspuns — reia trierea.')
      if (!elC.eligibil) { avertismente.push(`Detalierea criteriilor de atribuire NU a intrat în context: documentul #${id} „${d.nume_original}” e blocat pe loturi (${mesajLot(elC.motiv)}). Verifică încadrarea lui pe loturi, apoi reia trierea.`); continue }
      const rest = MAX_CRITERII_CARACTERE - criterii.length
      if (rest <= 0) { avertismente.push(`Detalierea criteriilor #${id} nu a mai încăput în context (plafon ${MAX_CRITERII_CARACTERE} caractere).`); continue }
      const txt = String(d.text_extras)
      criterii += `\n--- Document #${id} „${d.nume_original}” ---\n` + txt.slice(0, rest)
      if (txt.length > rest) avertismente.push(`Detalierea criteriilor #${id} a fost tăiată la ${rest} caractere.`)
      criteriiFolosite.push(id)
    }
    // ── AUTORIZAȚIILE DE FIRMĂ ──
    const firmaCtx = liniiFirma((firma || []) as any[], azi, termen)
    // ── codurile ANRE ale persoanelor (doar titulari activi) pentru verificarea din cod ──
    const activ = (a: any) => (a.emp ? a.emp.active !== false : a.ext ? a.ext.activ !== false : false)
    const autPers: AutPers[] = ((auth || []) as any[]).filter(activ).map((a) => ({
      cine: a.emp?.name || a.ext?.nume || '?', tip: a.tip?.denumire || '',
      titular: a.employee_id != null ? 'e' + a.employee_id : a.extern_id != null ? 'x' + a.extern_id : undefined,
      valabil: !!a.fara_expirare || (!!a.data_expirare && a.data_expirare >= ref),   // valabil la termen
    }))
    // Doar ce contează la triere: roluri de conducere/atestări de persoană. Sudorii, legătorii,
    // stivuitoriștii etc. sunt sute de rânduri care umflă inputul (85k tokeni la primul test) fără
    // să răspundă vreunei cerințe din fișa de date. Dedup pe (persoană, tip, domenii).
    const RELEVANT = /rte|responsabil tehnic|anre|diriginte|manager|sef|șef|cq|calitate|ssm|securitate|mediu|proiectant|inginer|expert|verificator|coordonator|isc|electric|instalator autorizat|gaze/i
    const IRELEVANT = /sudor|sudur|legator|legător|stivuitor|macaragiu|fochist|conducator auto|conducător auto|prim ajutor|iscir/i
    const vaz = new Set<string>()
    const linii: string[] = [], liniiPrio: string[] = []
    // v1.9: întâi ANRE / RTE / manager — dacă lista se taie la plafon, se taie ce contează mai puțin, și se spune
    const PRIO = /anre|nomenclatur|\b(eg|pg)[a-z]{1,3}\b|rte|responsabil tehnic|manager/i
    for (const a of (auth || []) as any[]) {
      if (!activ(a)) continue   // v1.9: un om plecat nu poate fi propus (diagnostic 12.10 pct. 5)
      const tip = a.tip?.denumire || 'autorizație'
      if (IRELEVANT.test(tip) || !RELEVANT.test(tip)) continue
      const cine = a.emp?.name || a.ext?.nume || '?'
      const dom = a.domenii?.length ? ' ' + a.domenii.join(', ') : ''
      const k = `${cine}|${tip}|${dom}`
      if (vaz.has(k)) continue
      vaz.add(k)
      const exp = a.fara_expirare ? '' : a.data_expirare ? (a.data_expirare < azi ? ` [EXPIRAT ${a.data_expirare}]` : ` (până ${a.data_expirare})`) : ''
      ;(PRIO.test(tip) ? liniiPrio : linii).push(`- ${cine}${a.ext ? ' (extern)' : ''}: ${tip}${dom}${exp}`)
    }
    for (const e of (emp || []) as any[]) linii.push(`- ${e.name}: ${e.functie || e.position}`)
    const toate = [...liniiPrio, ...linii]
    if (toate.length > 160) avertismente.push(`Lista de personal a fost tăiată la 160 de rânduri din ${toate.length} (întâi ANRE / RTE / manager).`)
    const personal = toate.slice(0, 160).join('\n')

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
        // #1399: obiectivele STRUCTURATE (câte unul pe element, cu natura) — de aici se numără, nu din proză;
        // fără ele, numărătoarea varia între rulări (Grădiștea 23.09: 21 → 19 → 4 → 15 pe aceeași recomandare)
        const ob: any[] = Array.isArray(r.obiective) ? r.obiective : []
        const obTxt = ob.length ? `\n  OBIECTIVE STRUCTURATE (${ob.length} — numără DE AICI, câte 1 per element): ` + ob.map((o: any, i: number) => `${i + 1}. ${o.denumire}${o.an ? ' ' + o.an : ''} [${o.natura}]`).join('; ').slice(0, 3000) : ''
        return `- ${cine}${r.ext ? ' (extern)' : ''} — ca ${r.rol || 'rol nespecificat'}, beneficiar ${r.beneficiar || '?'}${doc ? ' (' + doc + ')' : ''}${dom}${r.verificat ? '' : ' [NEVERIFICATĂ în HR]'}${cal}\n  lucrare: ${String(r.obiect_lucrare || '—').slice(0, 3000)}${obTxt}`
      })
    const recomandari = recLinii.join('\n')

    const text = `${PROMPT}\n\nNumele fișierului: "${String(doc.nume_original).slice(-120)}"\n\nPERSONAL GAZPET (autorizații + funcții; [EXPIRAT] = nu se poate folosi fără reînnoire):\n${personal || '(listă goală)'}\n\nRECOMANDĂRI — experiența DOVEDITĂ a persoanelor (${recLinii.length}; numeri obiectivele din „lucrare", nu rândurile):\n${recomandari || '(nicio recomandare în platformă)'}` +
      `\n\nAUTORIZAȚII FIRMĂ GAZPET (documente_firma — autorizațiile OPERATORULUI ECONOMIC, nu ale persoanelor; în "atestari_firma" folosești #id doar pentru cele valabile):\n${firmaCtx.linii.join('\n') || '(nicio autorizație de firmă în platformă)'}` +
      `\n\nPREFERINȚE OWNER pe coduri de persoană: ${Object.entries(PREFERINTE_COD).map(([c, p]) => `${c} → ${p.join(' sau ')}`).join('; ')} (codul le aplică; tu completezi "autorizatie_ceruta").` +
      (criterii ? `\n\nDETALIERE CRITERII DE ATRIBUIRE (document separat de fișă — sursa rolurilor punctate și a baremurilor):${criterii}` : `\n\nDETALIERE CRITERII DE ATRIBUIRE: nu e disponibilă în platformă pentru această licitație.`)
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
    matriceDinBD(parsed, ((rec || []) as any[]).filter(r => (r.emp ? r.emp.active !== false : r.ext ? r.ext.activ !== false : false)))
    repartizeazaDinMatrice(parsed, (r, p) => bonusPersoana(r, p, autPers))
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
    // v1.9: verificările din cod — codul ANRE pe rol (literal / echivalență aprobată + preferința pe EGT), bonusul din barem,
    // autorizațiile de firmă (id verificat față de documente_firma valabile)
    const probleme = verificaAutorizatiiRoluri(parsed, coduriPePersoana(autPers))
    if (probleme.length) avertismente.push(`Autorizații de persoană neconfirmate pe roluri: ${probleme.join('; ')}.`)
    const probBonus = adnoteazaBonus(parsed, autPers)
    if (probBonus.length) avertismente.push(`Bonusuri de verificat de om: ${probBonus.join('; ')}.`)
    const at = valideazaAtestariFirma(parsed, firmaCtx.valabile, termen, firmaCtx.expiraInainte)
    const lst = (a: string[]) => a.map(c => `„${c.slice(0, 120)}”`).join('; ')
    if (at.neacoperite.length) avertismente.push(`Autorizații de firmă cerute fără document valabil care să le acopere: ${lst(at.neacoperite)}.`)
    if (at.expira.length) avertismente.push(`Autorizații de firmă care expiră înainte de termenul de depunere ${termen}: ${lst(at.expira)}.`)
    if (at.neconfirmate.length) avertismente.push(`Cerințe de firmă neconfirmate (fără cod recunoscut sau nestructurate): ${lst(at.neconfirmate)}.`)
    if (avertismente.length && parsed.verdict === 'mergem') {
      parsed.verdict = 'cu_clarificari'
      parsed.motiv_verdict = 'Context incomplet sau cerințe de firmă neacoperite (vezi avertismentele). ' + String(parsed.motiv_verdict || '')
    }
    parsed.avertismente_context = avertismente
    parsed.sursa = { doc_id: doc.id, nume: doc.nume_original, pagini: doc.pagini, criterii_doc_ids: criteriiFolosite }

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
