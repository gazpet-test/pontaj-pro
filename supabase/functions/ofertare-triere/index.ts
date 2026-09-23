// ofertare-triere v1.7 (23.09.2026) — ETAPA 0: triere ieftină, DOAR din Fișa de date.
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
  (3) Punctaj doar pe recomandări verificate. Una neverificată se poate propune, dar spui în motiv câte proiecte ies din verificate și câte din neverificate, plus „de confirmat în HR".
  (4) Dacă nimeni nu are recomandare potrivită, propui pe cine are funcția și autorizația potrivite, DAR scrii în motiv „fără dovadă de experiență în platformă — de completat cu recomandare / document constatator". Un certificat de curs (ex. „Manager proiect 240h") e o calificare, nu experiență, și nu se invocă drept experiență.
  (5) O PERSOANĂ, UN ROL (Răzvan, 22.09.2026, Jilava): când fișa cere mai multe roluri de experți cheie, nu propui aceeași persoană pe două roluri. Repartizezi persoanele pe roluri astfel încât punctajul TOTAL să fie maxim — nu rolul cu rolul, ci echipa întreagă: dacă A ar lua 5 puncte pe oricare rol, iar B ia 5 puncte doar pe rolul X, atunci B merge pe X și A pe celălalt. Aceeași persoană pe două roluri doar când nimeni altcineva nu trece pragul de punctaj pe al doilea rol — și atunci scrii în motiv că e cumul și propui clarificare cu autoritatea.
  (6) ÎNTÂI MATRICEA, APOI REPARTIZAREA. Înainte să alegi, completezi câmpul "matrice_experti": pentru FIECARE persoană care are măcar o recomandare potrivită ca natură a lucrării și pentru FIECARE rol punctat, câte proiecte dovedite are pe rolul ăla și din ce recomandări (beneficiar + nr./dată sau „fără nr."). Numeri TOATE recomandările persoanei pe rol — o recomandare fără număr sau dată de document contează exact la fel ca una cu număr; nu o sări. Un rând pe (persoană, rol), inclusiv cu proiecte=0 dacă persoana n-are recomandare pe rolul respectiv. În "proiecte" pui DOAR obiectivele care trec regula (2) — pe natura cerută; pe cele excluse (țiței, apă-canal, distribuție când se cere transport) le notezi în "surse" ca „excluse: N (țiței)" și NU le aduni în "proiecte" (Jilava 22.09: 13 în loc de 9, cu 4 pe țiței adunate). "rol" din matrice e EXACT denumirea din "roluri" (nu creezi rânduri separate pe beneficiar, ex. „Manager Proiect (Romgaz)" — se adună la rolul din fișă). Repartizarea de la (5) se face DOAR din matricea asta, iar motivul fiecărei propuneri citează cifra din matrice. La Jilava (22.09) lipsa acestui pas a făcut ca o recomandare de Manager Proiect cu 9 obiective, fără număr de document, să fie ignorată, iar echipa a ieșit cu 3 puncte în minus. UNITATEA DE NUMĂRARE e cea din barem: dacă baremul spune „contracte", o recomandare cu 15 obiective într-un singur contract = 1; dacă spune „proiecte/obiective/lucrări", numeri obiectivele. Un obiectiv care apare în două recomandări (același beneficiar + aceeași lucrare) se numără O SINGURĂ dată, oriunde ar apărea.
  (7) LA EGALITATE, MARJA DECIDE (Răzvan, 22.09.2026). Dacă două repartizări dau același punctaj total, alegi pe cea în care fiecare persoană trece pragul cu cea mai mare marjă — concret, maximizezi cel mai MIC număr de proiecte peste prag din echipă. O dovadă care trece pragul „la limită" sau doar dacă o comisie acceptă o interpretare (ex. conducte colectoare la o cerință pe transport) e mai slabă decât una care îl depășește cu mai multe obiective clare. Spui în motiv că a fost egalitate și de ce a câștigat varianta aleasă. Exemplu: A are 15 pe rolul X și 14 pe Y; B are 9 pe X și 6 pe Y (din care 2 interpretabile); ambele repartizări dau 5+5 — alegi B pe X (9, marjă clară) și A pe Y (14), nu B pe Y (6, la limită).
  (8) RISC DE ELIMINARE (Jakarinos, 23.09.2026): dacă pentru un rol CERINȚA MINIMĂ obligatorie (ex. „minim 1 proiect similar") se îndeplinește DOAR prin proiecte condiționate (transport la cerință de distribuție), scrii în motivul rolului „RISC: cerința minimă depinde de acceptarea transportului — la refuz oferta poate fi respinsă, nu doar depunctată" și verdictul nu poate fi „mergem" (cel mult „cu_clarificari"). Codul adaugă singur clarificarea către autoritate pentru fiecare rol care folosește proiecte condiționate — tu doar completezi matricea corect.
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
  "roluri": [ { "rol": "<denumirea rolului>", "cerinte": "<studii/atestări/experiență cerute>", "documente": "<ce documente se depun>", "propunere": "<NUME din lista Gazpet sau null>", "motiv": "<de ce persoana asta / de ce nimeni>" } ],
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
function citesteBarem(text: string): Array<{ prag: number; puncte: number }> {
  // v1.7: acceptă și „pct"/„p." nu doar „puncte" (Grădiștea: „2-3 proiecte suplimentare=4pct" nu se citea deloc → repartizarea
  // nu rula), iar „proiecte SUPLIMENTARE" se numără peste minimul obligatoriu (1 proiect minim + 2-3 suplimentare = prag 3).
  const brut: Array<{ prag: number; puncte: number; supl: boolean }> = []
  const re = /(\d+)\s*(?:-\s*\d+|\s*sau\s+mai\s+multe|\+)?\s*(?:de\s+)?proiecte?([^=;:.]{0,40}?)[=:]\s*(\d+(?:[.,]\d+)?)\s*(?:p(?:unct|ct)|p\b)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text || ''))) brut.push({ prag: Number(m[1]), puncte: Number(m[3].replace(',', '.')), supl: /suplimentar/i.test(m[2] || '') })
  const minim = brut.find(b => !b.supl)?.prag ?? 1
  const out = brut.map(b => ({ prag: b.supl ? b.prag + minim : b.prag, puncte: b.puncte }))
  return out.sort((a, b) => a.prag - b.prag)
}
function puncteBarem(barem: Array<{ prag: number; puncte: number }>, n: number) {
  let p = 0, prag = 0
  for (const b of barem) if (n >= b.prag && b.puncte >= p) { p = b.puncte; prag = b.prag }
  return { puncte: p, marja: p > 0 ? n - prag : -1 }
}
type Barem = Array<{ prag: number; puncte: number }>
type Scenariu = { total: number; totalVerif: number; marja: number; proj: number; alocare: (string | null)[] }
// v1.7: două scenarii (Jakarinos, 23.09.2026). „conservator" = doar proiectele necondiționate (natura cerută, strict);
// „conditionat" = + proiectele pe transport la o cerință de distribuție, care depind de acceptarea autorității.
// Echipa propusă e cea optimă în scenariul condiționat (decizia lui Răzvan, varianta A), dar se afișează ȘI punctajul
// ACELEIAȘI echipe dacă transportul e respins, plus cea mai bună echipă pur conservatoare — două maxime obținute cu
// echipe diferite ar ascunde riscul alegerii. La egalitate pe totalul condiționat câștigă totalul conservator, apoi marja.
function repartizeazaDinMatrice(parsed: any) {
  const roluri: any[] = parsed.roluri, mat: any[] = parsed.matrice_experti
  if (!roluri?.length || !mat?.length) return
  const norm = (s: any) => String(s || '').toLowerCase().replace(/[șş]/g, 's').replace(/[țţ]/g, 't').replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/\s+/g, ' ').trim()
  const rolIdx: number[] = [], bareme: Barem[] = []
  roluri.forEach((r, i) => {
    const b = citesteBarem(String(r.cerinte || '') + ' ' + String(r.motiv || ''))
    const areMat = mat.some(x => norm(x.rol) === norm(r.rol))
    if (b.length && areMat) { rolIdx.push(i); bareme.push(b) }
  })
  if (!rolIdx.length) return
  const persoane = [...new Set(mat.map(x => String(x.persoana || '').trim()).filter(Boolean))]
  const rand = (p: string, rol: string) => mat.find(x => String(x.persoana || '').trim() === p && norm(x.rol) === norm(rol))
  const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 }
  // strict = necondiționat; cond = strict + transport condiționat. Verificatele nu pot depăși proiectele.
  const nStrict = (p: string, rol: string) => num(rand(p, rol)?.proiecte)
  const nCondSuplim = (p: string, rol: string) => num(rand(p, rol)?.proiecte_conditionate)
  const nCond = (p: string, rol: string) => nStrict(p, rol) + nCondSuplim(p, rol)
  const vStrict = (p: string, rol: string) => Math.min(nStrict(p, rol), num(rand(p, rol)?.verificate))
  const vCond = (p: string, rol: string) => vStrict(p, rol) + Math.min(nCondSuplim(p, rol), num(rand(p, rol)?.verificate_conditionate))
  const existaConditionate = persoane.some(p => rolIdx.some(i => nCondSuplim(p, roluri[i].rol) > 0))

  // evaluarea unei alocări într-un scenariu dat (n = funcția de numărare, v = cea de verificate)
  const evalueaza = (alocare: (string | null)[], n: (p: string, rol: string) => number, v: (p: string, rol: string) => number): Scenariu => {
    let total = 0, totalVerif = 0, marja = Infinity, proj = 0
    alocare.forEach((p, j) => {
      if (!p) { marja = Math.min(marja, -1); return }
      const rol = roluri[rolIdx[j]].rol, k = n(p, rol), s = puncteBarem(bareme[j], k)
      total += s.puncte; totalVerif += puncteBarem(bareme[j], v(p, rol)).puncte; marja = Math.min(marja, s.marja); proj += k
    })
    return { total, totalVerif, marja, proj, alocare: [...alocare] }
  }
  // căutare exhaustivă (roluri puține, persoane puține): o persoană pe un singur rol, rolul poate rămâne gol
  const cauta = (n: (p: string, rol: string) => number, maiBun: (a: Scenariu, b: Scenariu | null) => boolean, v: (p: string, rol: string) => number): Scenariu | null => {
    let best: Scenariu | null = null
    const rec = (k: number, folosite: Set<string>, alocare: (string | null)[]) => {
      if (k === rolIdx.length) { const sc = evalueaza(alocare, n, v); if (maiBun(sc, best)) best = sc; return }
      const rol = roluri[rolIdx[k]].rol
      for (const p of persoane) if (!folosite.has(p) && n(p, rol) > 0) { folosite.add(p); rec(k + 1, folosite, [...alocare, p]); folosite.delete(p) }
      rec(k + 1, folosite, [...alocare, null])
    }
    rec(0, new Set(), [])
    return best
  }
  // conservator: maxim total strict; la egalitate marja, apoi proiecte
  const conservator = cauta(nStrict, (a, b) => !b || a.total > b.total || (a.total === b.total && (a.marja > b.marja || (a.marja === b.marja && a.proj > b.proj))), vStrict)
  // condiționat: maxim total cu transport; la egalitate câștigă totalul CONSERVATOR al aceleiași alocări (Jakarinos), apoi marja, apoi proiecte
  const consAl = (al: (string | null)[]) => evalueaza(al, nStrict, vStrict).total
  const conditionat = cauta(nCond, (a, b) => !b || a.total > b.total || (a.total === b.total && (consAl(a.alocare) > consAl(b.alocare) || (consAl(a.alocare) === consAl(b.alocare) && (a.marja > b.marja || (a.marja === b.marja && a.proj > b.proj))))), vCond)
  const propus = existaConditionate ? conditionat : conservator
  if (!propus || propus.total <= 0) return
  const aceeasiEchipaConservator = evalueaza(propus.alocare, nStrict, vStrict)

  const rezumat = persoane.map(p => p + ': ' + rolIdx.map(i => { const r = roluri[i].rol, a = nStrict(p, r), b = nCondSuplim(p, r); return r + '=' + a + (b ? '+' + b + 'T' : '') }).join('/')).join('; ')
  const clarificariCod: string[] = []
  const roluriCuRisc: string[] = []
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
      r.depinde_de_transport = true
      // cerința minimă (primul prag din barem) trece DOAR cu transportul → risc de respingere, nu doar depunctare (regula 8)
      const pragMin = bareme[j][0]?.prag ?? 1
      if (kStrict < pragMin && kCond >= pragMin) { r.risc_eliminare = true; roluriCuRisc.push(r.rol); m += `. RISC: cerința minimă (${pragMin} proiect${pragMin > 1 ? 'e' : ''}) depinde de acceptarea transportului — la refuz oferta poate fi respinsă, nu doar depunctată` }
      const cer = String(r.cerinte || '').replace(/\s+/g, ' ').trim().slice(0, 260)
      clarificariCod.push(`Referitor la rolul „${r.rol}"${cer ? ` (cerința: „${cer}${String(r.cerinte || '').trim().length > 260 ? '…' : ''}")` : ''}: vă rugăm să confirmați dacă experiența dobândită în execuția de conducte de transport gaze naturale (presiune înaltă) este acceptată ca experiență similară/superioară pentru cerința privind rețelele de distribuție gaze naturale, atât la îndeplinirea cerinței minime, cât și la punctarea factorului de evaluare.`)
    }
    m += `. Verificate în HR: ${vc} (punctaj doar pe verificate: ${sVerif.puncte}${vc < kCond ? ' — de confirmat în HR înainte de depunere' : ''}). Echipa: ${propus.total} puncte` +
      (existaConditionate ? ` cu transport / ${aceeasiEchipaConservator.total} fără` : '') + `. Matrice: ${rezumat}.`
    r.motiv = m + (schimbat ? ' Propunerea AI inițială a fost înlocuită.' : '') + (r.motiv ? ' — ' + String(r.motiv) : '')
  })
  const aloc = (sc: Scenariu | null) => sc ? rolIdx.map((i, j) => ({ rol: roluri[i].rol, persoana: sc.alocare[j] })) : []
  parsed.repartizare_calculata = {
    scenariu_propus: existaConditionate ? 'conditionat' : 'conservator',
    depinde_de_transport: existaConditionate && aceeasiEchipaConservator.total < propus.total,
    roluri_cu_risc_eliminare: roluriCuRisc,
    conditionat: { total_puncte: propus.total, total_doar_verificate: propus.totalVerif, alocare: aloc(propus) },
    aceeasi_echipa_fara_transport: { total_puncte: aceeasiEchipaConservator.total, total_doar_verificate: aceeasiEchipaConservator.totalVerif },
    conservator: { total_puncte: conservator?.total ?? 0, total_doar_verificate: conservator?.totalVerif ?? 0, alocare: aloc(conservator) },
    // compatibilitate cu UI-ul vechi
    total_puncte: propus.total, alocare: aloc(propus),
  }
  parsed.clarificari_cod = clarificariCod
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
    // v1.7: clarificarea „transport acceptat ca similar?" e garantată din cod, per rol, PRIMA în listă (nu poate dispărea prin
    // slice și nu depinde de model); întrebările generice ale modelului pe același subiect se elimină ca dubluri.
    const dinCod: string[] = Array.isArray(parsed.clarificari_cod) ? parsed.clarificari_cod : []
    const aleModelului = (Array.isArray(parsed.clarificari_propuse) ? parsed.clarificari_propuse : []).filter((c: any) => typeof c === 'string' && c.trim())
      .filter((c: string) => !(dinCod.length && /transport/i.test(c) && /distribu/i.test(c)))
    parsed.clarificari_propuse = [...dinCod, ...aleModelului].slice(0, 20)
    delete parsed.clarificari_cod
    if (parsed.repartizare_calculata?.depinde_de_transport && parsed.verdict === 'mergem') {
      parsed.verdict = 'cu_clarificari'
      parsed.motiv_verdict = `Punctajul echipei depinde de acceptarea experienței pe transport gaze la o cerință de distribuție (${parsed.repartizare_calculata.conditionat?.total_puncte} puncte cu transport / ${parsed.repartizare_calculata.aceeasi_echipa_fara_transport?.total_puncte} fără)` +
        (parsed.repartizare_calculata.roluri_cu_risc_eliminare?.length ? `; la ${parsed.repartizare_calculata.roluri_cu_risc_eliminare.join(', ')} chiar cerința minimă depinde de asta — risc de respingere` : '') + '. ' + String(parsed.motiv_verdict || '')
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
