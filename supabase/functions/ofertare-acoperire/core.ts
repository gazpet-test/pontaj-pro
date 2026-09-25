// ofertare-acoperire/core.ts — logica motorului de acoperire, FĂRĂ înveliș HTTP (22.09.2026).
// Aceeași funcție rulează în edge function (index.ts = auth + Response) și în workerul de pe NAS
// (worker/ofertare/acoperire.ts), unde nu există limita de 150 s a gateway-ului. Istoricul versiunilor: index.ts.
import { turtesteCandidati, marcheazaSudoriNepotriviti } from './candidati.ts'

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const MODEL = 'claude-opus-5'
const PRICE_IN = 5 / 1e6, PRICE_OUT = 25 / 1e6


const PROMPT = `Ești motorul de confruntare cerințe↔capabilități al modulului de ofertare Gazpet Instal (construcții conducte gaze). Primești: (1) cerințele unei licitații, (2) CATALOGUL REAL: autorizațiile personalului (propriu și extern), DOCUMENTELE DE STUDII ale persoanelor (diplome și calificări — id-uri cu prefix D), DOCUMENTELE FIRMEI (autorizații/certificate ale Gazpet Instal ca societate — id-uri cu prefix F) și partenerii, (3) termenul de depunere.
Pentru FIECARE cerință decizi cine o acoperă.

REGULI NENEGOCIABILE:
- R1: potrivești DOAR cu ce există în catalog. Nu inventa autorizații. Dacă nimic nu se potrivește → status "gol".
- R6: valabilitatea se judecă pe TERMENUL DE DEPUNERE, nu pe azi. Autorizație/document expirat înainte de depunere = NU acoperă (gol, cu motivul "expiră la <data>"). fara_expirare=true = valabil.
- R7 (reguli de domeniu): domeniul/subdomeniul ISC al unui RTE se stabilește EXCLUSIV din natura lucrărilor cerute în ACEASTĂ licitație (obiectul contractului și textul cerinței). NU îl deduci niciodată din lucrarea de experiență similară pe care o prezentăm: faptul că dovedim experiența cu o lucrare de gaze nu face ca RTE-ul cerut pentru alimentări cu apă să fie tot de gaze. O licitație poate cere RTE pe MAI MULTE domenii deodată (ex. rețele apă-canal + drumuri + instalații electrice) — le tratezi separat, cerință cu cerință. O autorizație pe alt domeniu/subdomeniu NU acoperă cerința, oricât de apropiată ar părea: status "gol", cu domeniul lipsă scris explicit în motiv. RTE 8.4(T)=transport ≠ 8.4(D)=distribuție; "atestat ANRE tip B" = INSTALAȚII ELECTRICE (Ord.134/2021); INSEMEX pe ACTIVITĂȚI; sudori SR EN ISO 9606-1: diametrul D acoperă ≥ 0,5·D; RTE MECMA (Ordin 364/2010) ≠ RTE ISC.
- DOCUMENTELE FIRMEI (id F...): cerințele despre autorizații/certificate ALE SOCIETĂȚII — ANRE tip EDSB/EDIB/EPI/ET (Ord. ANRE 132/2021 pt execuție sisteme distribuție/instalații gaze), certificări ISO 9001/14001/45001, certificat constatator, atestări firmă — se acoperă cu ele: status "acoperit", autorizatie_id: "F<id>". Tipul trebuie să corespundă cerinței (EDSB=execuție sisteme distribuție; EDIB=execuție instalații; EPI=proiectare instalații; ET=execuție transport; nu le încurca).
- PARTENERI: câmpul "acopera" descrie ce aduce CONCRET fiecare → "acoperit_partener" cu partener_id. Un partener fără specialitatea cerută NU acoperă.
- O cerință care NU e de capabilitate (garanție de participare, formulare, semnătură, mod de prezentare, preț, termene de plată, vizită amplasament, valabilitatea ofertei) → status "nu_se_aplica".
- R8 (EXPERIENȚĂ SIMILARĂ, id-uri cu prefix E): cerințele de experiență similară / lucrări duse la bun sfârșit / PV de recepție se acoperă DOAR cu lucrări din lista E: status "acoperit", autorizatie_id: "E<id>". Folosești EXCLUSIV campul valoare_proprie_lei — niciodată valoare_totala_lei, care la o asociere e a asocierii, nu a firmei. O lucrare cu cota_proprie_necunoscuta NU acoperă nicio cerință de valoare: răspunzi "gol" și scrii în motiv că lipsește cota Gazpet. Fereastra "ultimii N ani" se socotește față de TERMENUL DE DEPUNERE (ca la R6), pe data_pv. Dacă cerința cere valoare CUMULATĂ din mai multe contracte, pui în autorizatie_id contractul principal și enumeri în motiv celelalte id-uri E folosite — cumulul îl verifică omul.
- motiv: scurt (≤120 caractere), în română, spune DE CE (cine/ce acoperă sau ce lipsește exact).

- R10 (NOMENCLATOR ISC): primești NOMENCLATORUL ISC RTE (Procedura ISC 2016) cu coduri, denumiri și cuvinte-cheie de lucrări. Domeniul cerut se stabilește din OBIECTUL CONTRACTULUI + textul cerinței, pe nomenclator: alimentare cu apă / canalizare / stații de pompare / gospodărie de apă = 9.1 (edilitare) și/sau 8.2 (rețele sanitare); gaze = 8.4 cu varianta D (distribuție) sau T (transport); drumuri = 2.1. Autorizațiile din catalog au câmpul "domenii_isc" (coduri normalizate) — RTE-ul ACOPERĂ cerința dacă "domenii_isc" conține codul cerut (8.4 cerut fără variantă = acoperit de 8.4D sau 8.4T). Cifrele romane din "domenii_vechi" sunt schema veche MLPAT și NU se echivalează automat; dacă doar ele ar acoperi, răspunzi "gol" și spui în motiv că autorizația e pe schema veche, de reconfirmat. Completezi câmpul "domeniu_rte" cu codul cerut (ex. "9.1", "8.4D") la ORICE cerință de RTE, chiar și când e "gol"; la celelalte cerințe e null. Când obiectul contractului cere mai multe domenii (apă + drumuri), fiecare cerință de RTE se judecă pe domeniul ei, iar dacă cerința e generală ("RTE atestat în domeniul contractului") o judeci pe domeniul PRINCIPAL al obiectului și pui celelalte domenii în motiv.
- R11 (art. 51 lit. g + practica comisiilor): RTE-ul trebuie să aibă autorizația ȘI legitimația ISC valabile la termenul de depunere (R6). Dacă obiectul contractului include refaceri de drumuri / sistem rutier / asfalt, comisiile cer în practică și un RTE pe 2.1 chiar dacă cerința nu-l numește (cazul Laza): dacă avem 2.1 în catalog, îl menționezi în motiv; dacă nu, scrii în motiv "risc: comisia poate cere și RTE 2.1 pentru refacerile de drum" — fără să schimbi statusul cerinței principale.
- R12 (REGULI DE ECHIPĂ — RESTRÂNS): status "regula_propunere" e DOAR pentru regulile de ALCĂTUIRE A ECHIPEI: interdicția de cumul de funcții, "fiecare rol e ocupat de altă persoană", "personalul nominalizat trebuie să fie același la execuție", "înlocuirea personalului nominalizat doar cu acordul achizitorului", "fiecare asociat își dovedește partea asumată". NU intră aici: obligațiile de execuție din caietul de sarcini (probe de presiune, tranșee, SSM, recepție, remedieri, dotări, instruiri), lucrurile care "se descriu în propunerea tehnică" (structura echipei, atribuții, metodologie, grafic) — ALEA rămân "nu_se_aplica" ca până acum, fiindcă nu sunt capabilități din catalog. Dacă ai dubii, e "nu_se_aplica". motiv = ce regulă e și unde se verifică.
- R13 (CALITATE — CQ/CTC): controlorul tehnic cu calitatea (CQ/CTC/„responsabil control calitate") NU se mai atestă la ISC — prevederea e abrogată, CQ/CTC se numește prin DECIZIE INTERNĂ a firmei. O cerință de „CQ autorizat ISC" / „controlor tehnic cu calitatea" / „responsabil cu calitatea" se acoperă cu: (a) o persoană din catalog cu cod MANAGER_SMC, AUDITOR_INTERN sau MANAGER_RISCURI_TSC (autorizatie_id numeric), sau (b) un document de firmă de tip decizie de numire CQ/CTC (F<id>), dacă există. NU dai "gol" pentru lipsa unui atestat ISC de CQ — el nu există; scrii în motiv „numire prin decizie internă; atestarea ISC a CTC nu mai e în vigoare". Cerințele formulate ca alternativă („Manager SMC / Responsabil control calitate", „X sau Y") sunt acoperite de ORICARE dintre variante — nu cere ambele.
- R15 (CÂND SE PREZINTĂ): fiecare cerință are câmpul "cand_se_prezinta": "depunere" (documentul se depune cu oferta), "duae" (la depunere se DECLARĂ în DUAE, documentul se cere ulterior), "primul_loc" (se prezintă doar de ofertantul clasat pe locul I, la solicitarea autorității) sau null. Pentru "duae" și "primul_loc", un document de firmă care există în catalog dar EXPIRĂ înainte de termenul de depunere (tipic certificatul constatator ONRC, certificatele fiscale — valabile 30 de zile) ACOPERĂ cerința: status "acoperit" cu F<id>, motiv „se prezintă doar la locul I / în DUAE — se reemite atunci". NU dai "gol" pe motiv de expirare la aceste cerințe. Pentru "depunere" (ex. Conpet cere ONRC odată cu oferta) și null se aplică R6 ca până acum.
- R16 (PROIECTARE prin PARTENER): cerințele de PROIECTARE — „nominalizarea persoanelor responsabile de proiectare pe specialități (diplome, CV, recomandări)", „proiect tehnic de execuție elaborat de ofertant", „verificator de proiecte atestat", „șef de proiect / proiectant de specialitate" — se acoperă cu un PARTENER care face proiectare: status "acoperit_partener" cu partener_id, dacă în "acopera" sau "tip_relatie" scrie proiectare pe SPECIALITATEA cerută (instalații edilitare / apă-canal / gaze / drumuri; „proiectare rețele edilitare" acoperă apă-canal și gaze). Un contract de proiectare cu un proiectant le acoperă pe TOATE specialitățile pe care le are — NU ceri persoane distincte din catalog per specialitate și NU dai "gol" pentru că lipsesc diplome/CV-uri nominale: acelea vin de la partener la depunere (scrie în motiv „prin contract proiectare cu <partener>; CV/diplome de cerut partenerului"). Dacă niciun partener nu face proiectare pe specialitatea cerută → "gol" cu motiv „lipsă contract proiectant pe <specialitate>". Verificatorul de proiecte atestat MDLPA e tot cerință de proiectare (partener sau persoană din catalog cu atestat de verificator, dacă există).
- R14 (RECOMANDĂRI — experiența PERSOANELOR, id-uri cu prefix R): cerințele de „experiență în poziție similară / proiect similar" ale unei PERSOANE (manager de contract, șef de șantier, RTE, inginer execuție, responsabil calitate) se acoperă DOAR cu recomandări din lista R ale acelei persoane: status "acoperit", autorizatie_id: "R<id>". Recomandarea trebuie să se potrivească pe ROL (rolul cerut ≈ rolul din recomandare) și pe NATURA lucrării. Natura se judecă strict, ca la R10 și R20: o cerință pe conducte de GAZE se acoperă doar cu recomandări pe gaze — o lucrare de apă-canal sau o conductă de ȚIȚEI (Conpet) NU acoperă gaze, oricât ar fi de asemănătoare ca execuție; invers la fel. Formulările largi din cerință („fluide", „rețele edilitare") nu lărgesc catalogul: te uiți în câmpurile "domenii" și "obiect_lucrare" și ceri potrivirea reală. Când cerința distinge transport de distribuție, o faci și tu, dar ÎNTR-UN SINGUR SENS (Răzvan, 23.09.2026, Grădiștea; aliniat cu trierea v1.7): o recomandare pe rețea de DISTRIBUȚIE nu acoperă o cerință pe conductă de TRANSPORT (status "gol"); o recomandare pe conductă de TRANSPORT la o cerință pe DISTRIBUȚIE acoperă CONDIȚIONAT — status "acoperit", dar motivul începe cu „CONDIȚIONAT (transport → distribuție): " și completezi OBLIGATORIU câmpul "clarificare" cu întrebarea către autoritate dacă experiența pe conducte de transport gaze naturale e acceptată ca similară/superioară pentru cerința respectivă (numind cerința). Nu prezenta acoperirea condiționată ca una sigură și nu o folosi ca dovadă unică la o cerință eliminatorie fără să spui în motiv „la refuz, oferta poate fi respinsă". Dacă cerința exclude transportul (explicit sau „exclusiv/numai rețele de distribuție"), status "gol". Dacă cerința spune doar „rețele de gaze" / „rețele edilitare gaze" fără să precizeze, o tratezi ca DISTRIBUȚIE (la fel ca trierea): recomandarea pe distribuție acoperă sigur, cea pe transport acoperă CONDIȚIONAT, cu clarificare. Echivalarea asta e DOAR pentru experiență (R14/R14b) — NU se extinde la autorizații: RTE 8.4(T) nu acoperă 8.4(D) și invers (R7, R10), EDSB ≠ ET. Pentru RTE: o recomandare ca RTE pe lucrare similară acoperă experiența ca RTE; experiența GENERALĂ „minim N ani în construcții" e altă cerință — nu o confunda și nu o acoperi cu o singură recomandare dacă durata din recomandări nu ajunge la N ani (spune în motiv câți ani rezultă). O recomandare cu verificat=false acoperă, dar scrii în motiv „neverificată în HR". Autorizația (atestatul) persoanei NU dovedește experiență; recomandarea NU dovedește atestat — sunt cerințe separate.
- R14b (CERINȚE DE PERSONAL PUNCTATE — Răzvan + Silviu, TKT-2026-0270, 22.09.2026): când cerința de personal e PUNCTATĂ (criteriu de atribuire pe numărul de proiecte similare, pe ani, pe valoare), propunerea NU se face după titulatura postului și nici după un certificat de curs. Un „Manager proiect (240h)" e o calificare, nu o experiență, și nu valorează niciun punct. Ordinea e fixă:
  (1) Persoanele care AU recomandări potrivite pe rol și pe natura lucrării. Le ordonezi după numărul de PROIECTE dovedite, nu după numărul de documente: o singură recomandare poate atesta mai multe obiective/contracte — dacă recomandarea are lista "obiective" (structurată, cu natura pe fiecare: transport/distributie/titei/apa_canal), numeri EXACT elementele ei; altfel le numeri pe cele enumerate în "lucrare" — și spui cifra în motiv. Propui primul pe cel cu cele mai multe, iar în motiv citezi dovada exact: persoana, beneficiarul, numărul și data documentului, câte obiective, calificativul. Obiectivele CONDIȚIONATE (transport la o cerință de distribuție, R14) le numeri și le scrii SEPARAT — „N sigure + M condiționate de transport" — nu le aduni în cifra sigură și nu le prezinți ca punctaj cert. Ceilalți candidați cu recomandări intră ca alternative, în aceeași ordine.
  (2) PUNCTAJ DOAR PE RECOMANDĂRI VERIFICATE. O recomandare cu verificat=false poate acoperi cerința (rămâne "acoperit"), dar NU o numeri la punctaj: în motiv scrii câte proiecte ies din recomandări verificate și câte din neverificate, separat, și adaugi „de confirmat în HR înainte de depunere". Nu prezenta o cifră de punctaj sprijinită pe documente necontrolate de om.
  (3) DACĂ NIMENI nu are recomandare potrivită: nu alege tu o persoană. Statusul e "gol", iar în motiv enumeri cine are funcția și autorizația potrivite ca puncte de plecare, fiecare marcat „fără dovadă de experiență — de completat cu recomandare / document constatator". Când persoanele au dată de angajare, le ordonezi după vechimea în firmă (cel mai vechi primul) și spui explicit câți dintre ei nu au dată de angajare în evidență, ca să se vadă că ordinea e parțială. Alegerea o face omul din ecran.
  (4) O PERSOANĂ, UN ROL (Răzvan, 22.09.2026, Jilava): când licitația are mai multe cerințe de experți cheie punctate, nu propui aceeași persoană ca prim candidat pe două dintre ele. Repartizezi persoanele pe roluri astfel încât punctajul TOTAL al echipei să fie maxim, nu fiecare rol separat: dacă A ar lua punctaj maxim pe oricare rol, iar B îl ia doar pe rolul X, B merge pe X și A pe celălalt. Aceeași persoană pe două roluri doar când nimeni altcineva nu trece pragul pe al doilea — și atunci scrii în motiv că e cumul și pui clarificare către autoritate. Persoana mutată de pe un rol rămâne acolo ca alternativă, nu dispare.
  (5) ÎNTÂI NUMĂRĂTOAREA, APOI REPARTIZAREA; LA EGALITATE, MARJA DECIDE (Răzvan, 22.09.2026, Jilava). Înainte să repartizezi, numeri pentru FIECARE persoană cu recomandări potrivite și pentru FIECARE rol punctat câte proiecte dovedite are — toate recomandările, inclusiv cele fără număr sau dată de document (contează la fel). Scrii numărătoarea în motivul candidatului principal, pe scurt: „matrice: Trusu M=15/Ș=14, Pantea M=9/Ș=6". Dacă două repartizări dau același punctaj total, alegi pe cea în care cel mai MIC număr de proiecte peste prag din echipă e cel mai mare — o dovadă „la limită" sau care depinde de o interpretare a comisiei (ex. conducte colectoare la o cerință pe transport) e mai slabă decât una care depășește pragul cu obiective clare. Spui în motiv că a fost egalitate și de ce a câștigat varianta aleasă.
  Niciodată nu formula justificări de tipul „poate demonstra experiență" sau „se va documenta experiența": dacă dovada nu e în catalog, spui că lipsește.
- R17 (STUDII — diplomele persoanelor, id-uri cu prefix D): cerințele care cer o CALIFICARE DE STUDII a unei persoane — „inginer cu diplomă de licență Facultatea de Instalații pentru construcții / Hidrotehnică / Construcții civile / Drumuri", „studii superioare de specialitate", „absolvent al facultății de ...", „calificare de sudor / instalator / lăcătuș" — se acoperă DOAR cu documente din lista D: status "acoperit", autorizatie_id: "D<id>". Potrivirea se face pe SPECIALITATEA scrisă în câmpurile denumire / emitent / descriere ale documentului, nu pe titulatura postului: „Facultatea de Instalații" (UTCB) acoperă „instalații pentru construcții" și „instalații edilitare"; „construcții civile industriale și agricole" NU acoperă „instalații" și invers; „inginerie mecanică" / „petrol și gaze" / „forajul sondelor" NU acoperă o cerință de instalații sau de hidrotehnică, oricât ar fi omul de vechi în firmă. Dacă specialitatea cerută nu se regăsește, e "gol" și scrii în motiv ce diplome AVEM și de ce nu se potrivesc — ajută la decizia de a merge pe subcontractant. O diplomă nu expiră: valabil_la_depunere rămâne null, R6 nu se aplică.
- R18 (VECHIME — dovezile de la angajatori anteriori, id-uri cu prefix V): cerințele care cer ANI DE EXPERIENȚĂ ai unei persoane — „experiență profesională generală de minimum 5 ani în execuția de rețele de canalizare / alimentare cu apă", „vechime în specialitate", „minimum N ani în domeniu" — se acoperă cu documente din lista V: status "acoperit", autorizatie_id: "V<id>". NU confunda cu R14: o recomandare dovedește o LUCRARE anume (un rol, un beneficiar, o perioadă); dovada de vechime acoperă PARCURSUL, adică tocmai bucata pe care recomandările n-o acoperă când însumate dau mai puțin decât cere cerința. Ierarhia probantă, respect-o în motiv: un extras REGES / adeverință de vechime / adeverință de încetare / anexa 7 e emis de un TERȚ și e dovadă; un CV e DECLARAT de persoană și NU e dovadă în fața autorității — dacă singurul document potrivit e un CV, pui tot "acoperit" cu V<id> (e pista corectă), dar scrii explicit în motiv „doar CV — se cere adeverință de vechime de la angajatorul anterior ca document probant". Dacă din documentele V nu iese numărul de ani cerut, e "gol" și scrii câți ani ies și din ce. O adeverință nu expiră: valabil_la_depunere rămâne null, R6 nu se aplică.
  DELIMITAREA față de celelalte surse, ca să nu se acopere unele cu altele: diploma dovedește STUDIILE și atât. NU dovedește experiența (aia e R14, recomandări R) și NU dovedește atestarea (aia e autorizația din catalogul personal sau documentul de firmă). O cerință compusă („inginer instalații CU diplomă ȘI minim 5 ani experiență pe lucrări similare") se acoperă numai dacă ai și D-ul, și R-ul: pui în autorizatie_id documentul principal cerut și scrii explicit în motiv ce mai lipsește. Invers: nu da "gol" pe lipsa diplomei la o cerință care cere doar atestat ISC.
- R9 (CLARIFICĂRI): dacă cerința spune doar "RTE" / "responsabil tehnic cu execuția" / "personal de specialitate atestat" FĂRĂ să numească domeniul sau subdomeniul ISC, nu ghici care e. Dai status "gol" și completezi câmpul "clarificare" cu întrebarea către autoritatea contractantă, formulată scurt și la obiect, citând cerința și cerând să precizeze domeniul/subdomeniul exact (cu trimitere la obiectul contractului, când ajută). Tot clarificare (R9b, Silviu 15.09) propui când o cerință de EXPERIENȚĂ a unei persoane e ambiguă și ambiguitatea schimbă cine o poate ocupa: (a) nu e clar dacă se cere experiență ÎN ROLUL respectiv (ex. ca RTE) pe un proiect similar sau experiență profesională GENERALĂ de N ani; (b) „proiect similar" nu e definit (natura lucrării, valoare, prag); (c) nu e clar dacă N ani se socotesc pe rol sau pe carieră. Întrebarea citează cerința și cere autorității să precizeze exact ce dovadă acceptă (recomandare pe rol? CV? adeverință de vechime?). Statusul rămâne cel rezultat din catalog (acoperit/gol) — clarificarea e în plus, nu în locul evaluării. "clarificare" se completează DOAR în cazurile R9, R9b și R14 (acoperire CONDIȚIONATĂ transport → distribuție — acolo e obligatorie); pentru orice altă cerință e null. O singură clarificare per cerință.

IMPORTANT: raportezi FIECARE cerinta primita, inclusiv cele cu "nu_se_aplica". Daca nu incapi, e mai bine sa scurtezi motivele decat sa omiti cerinte — o cerinta lipsa din raspuns nu poate fi deosebita de una pe care n-ai apucat s-o citesti.

- R20 (SUDURĂ — materialul conductei decide calificarea): catalogul are tipuri DISTINCTE de sudor — „Sudor PEHD" (polietilenă) și „Sudor electric autorizat" (oțel), plus câmpurile "procedeu_sudura" și "diametru_teava_mm". Materialul se ia din OBIECTUL CONTRACTULUI și din textul cerinței: rețea de DISTRIBUȚIE gaze = predominant PEHD; conductă de TRANSPORT / racorduri / stații = oțel. Un sudor de oțel NU acoperă îmbinări de polietilenă și invers — e aceeași greșeală ca un RTE pe alt domeniu (R10) sau o diplomă pe altă specialitate (R17). Dacă lucrarea are ambele materiale, spui în motiv că sunt acoperite ambele și cu cine. Dacă lipsește calificarea pe materialul cerut, e "gol" — nu o înlocuiești cu cealaltă.
  Cerințele de sudură din NTPEE (art. 236, 239) și similare cer DOUĂ lucruri: sudori autorizați ȘI aparate de sudură agrementate tehnic. Aparatele sunt documente de firmă (F<id>), de tip „revizie tehnică aparat sudură prin electrofuziune" / „cap la cap" (PE) — le cauți în catalogul de documente și le numești în motiv. Aparatele de electrofuziune/cap-la-cap sunt pentru PE; nu le invoca la sudură de oțel.
- R19 (ALTERNATIVE — între 0 și 3): la cerințele cu status "acoperit" sau "acoperit_partener", pui în "candidati" variantele care ACOPERĂ cerința, cea mai bună prima. NUMĂRUL NU E O ȚINTĂ. Fiecare variantă trebuie să îndeplinească INDEPENDENT toate condițiile obligatorii ale cerinței — domeniul cerut, valabilitatea la termen, specialitatea. O încălcare nu se compensează prin scor și nu se scuză prin „e singura alternativă". Dacă o singură persoană sau un singur document îndeplinește cerința, întorci UN candidat; asta e răspunsul corect, nu o lipsă. Nu relaxa nicio regulă (R6, R8, R10, R14, R17, R18) ca să ajungi la trei.
  "gol" ÎNSEAMNĂ GOL: dacă nimic din catalog nu acoperă cerința, "candidati" e [] și scrii în "motiv" al cerinței CE anume lipsește, concret („niciun RTE cu domeniul 9.1; avem 8.4D și 2.1", „nicio diplomă pe hidrotehnică"). NU pune în "candidati" variante respinse ca să pară că ai căutat — omul are nevoie să vadă golul, nu o listă de nepotriviri.
  ATENȚIE, capcana cea mai deasă: diploma, recomandarea și dovada de vechime ale ACELEIAȘI persoane NU sunt trei alternative — sunt un DOSAR care se adună. Alternative sunt persoane sau documente DIFERITE, fiecare capabil singur să țină cerința. Dacă cerința compusă are nevoie de D + R + V de la același om, e UN candidat, iar ce lipsește se scrie în motivul lui.
  COMPLETITUDINE, NU LUNGIME: la primul candidat începi cu denumirea exactă a lucrării/persoanei și datele probante (număr, valabilitate, domeniu, material, valoare). Dacă cerința conține mai multe obligații CUMULATIVE — „sudori autorizați ȘI aparate agrementate", „diplomă ȘI minim N ani" — indici pentru FIECARE dovada concretă disponibilă sau explicit ce lipsește. NU declari acoperire integrală dacă o obligație rămâne nedovedită. Explicații adaugi doar când legătura nu e evidentă. La candidații 2-3 păstrezi identificarea, diferența față de primul și eventualele lipsuri, fără să repeți explicațiile comune. La cerințe simple, o propoziție ajunge.
  "scor" (0-100) e încrederea ta în candidatul ăla, nu ordinea lui.

Răspunde EXCLUSIV JSON compact:
{"acoperiri":[{"cerinta_id":123,"status":"acoperit"|"acoperit_partener"|"gol"|"nu_se_aplica"|"regula_propunere","domeniu_rte":<cod din nomenclator sau null>,"clarificare":<text intrebare catre autoritate sau null>,"motiv":"<de ce e gol / nu se aplica — la cerintele acoperite motivul sta pe fiecare candidat>","candidati":[{"status":"acoperit"|"acoperit_partener","autorizatie_id":<id numeric din catalog personal, "F<id>" pentru document de firmă, "E<id>" pentru lucrare din experiența similară, "R<id>" pentru recomandarea unei persoane, "D<id>" pentru diploma/calificarea unei persoane, "V<id>" pentru o dovada de vechime de la un angajator anterior, sau null>,"partener_id":<id sau null>,"scor":<0-100>,"motiv":"..."}]}]}`

// ── Domeniile ISC — COPIE a src/iscRte.js (normalizeazaDomeniiISC). Ține-le sincron. ──
const ROMAN = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI)(\.\d+)?$/i
const ETICHETE: [RegExp, string][] = [
  [/constructii civile|cladir|hala|civile/, '1.1'], [/drum|rutier|strazi/, '2.1'], [/pod(uri)?\b/, '2.3'],
  [/hidrotehnic/, '5.1'], [/instalatii electrice/, '6.1'], [/instalatii (termice|sanitare)|ventila|climatiz/, '6.2'],
  [/instalatii( de utilizare)? gaze/, '6.3'], [/retele electrice/, '8.1'],
  [/retele (termice|sanitare)|apa.?canal|alimentare cu apa|canalizare/, '8.2'], [/telecomunicati/, '8.3'],
  [/retele (de )?gaze|distributie gaze/, '8.4D'], [/transport gaze/, '8.4T'], [/petrolier|titei/, '8.5'],
  [/edilitar|gospodarie comunala/, '9.1'], [/fundatii/, '11.1'],
]
const faraDiac = (s: unknown) => String(s || '').toLowerCase().replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
function normalizeazaDomeniuISC(fragment: unknown) {
  const t = faraDiac(fragment).trim()
  if (!t) return { coduri: [] as string[], vechi: [] as string[] }
  const coduri: string[] = [], vechi: string[] = []
  const re84 = /\b8\.4\s*[(\-]?\s*([dt])\s*\)?/gi
  let m: RegExpExecArray | null
  while ((m = re84.exec(t))) coduri.push('8.4' + m[1].toUpperCase())
  const reCod = /\b(1\.[1-4]|2\.[1-4]|3\.1|4\.[12]|5\.1|6\.[1-3]|7\.1|8\.[1-5]|9\.1|11\.1)\b(?!\s*[(\-]?\s*[dt])/gi
  while ((m = reCod.exec(t))) { const c = m[1]; if (!(c === '8.4' && coduri.some(x => x.startsWith('8.4')))) coduri.push(c) }
  for (const p of t.split(/[,;\/]|\s+si\s+|\s+&\s+/)) { const s2 = p.trim().toUpperCase(); if (ROMAN.test(s2)) vechi.push(s2) }
  if (!coduri.length) for (const [re, cod] of ETICHETE) if (re.test(t)) { coduri.push(cod); break }
  return { coduri: [...new Set(coduri)], vechi: [...new Set(vechi)] }
}
function normalizeazaDomeniiISC(lista: unknown) {
  const out = { coduri: [] as string[], vechi: [] as string[] }
  for (const f of Array.isArray(lista) ? lista : (lista ? [lista] : [])) { const r = normalizeazaDomeniuISC(f); out.coduri.push(...r.coduri); out.vechi.push(...r.vechi) }
  out.coduri = [...new Set(out.coduri)]; out.vechi = [...new Set(out.vechi)]
  return out
}

// #51 (14.09.2026): poarta pe cheltuială și pe SERVER, nu doar în UI. Cu verify_jwt=true cheia anon trece
// ca Bearer, deci oricine cu cheia publică putea porni un apel plătit. Reguli:
//  - service_role: liber (rutine interne);
//  - JWT de utilizator: doar owner sau responsabilul licitației;
//  - cheia anon (workerii server din ofertare_*_tick trimit anon JWT din Vault): doar cât coada licitației e activă.
export async function propuneAcoperiri(supabase: any, body: any): Promise<any> {
  const fail = (msg: string) => ({ error: msg })
  try {
    const { licitatie_id, batch, ids } = body || {}
    const licId = Number(licitatie_id)
    if (!licId || !['eliminatorie', 'propunere'].includes(batch)) return fail('licitatie_id + batch (eliminatorie/propunere) obligatorii')
    const idsFelie: number[] | null = Array.isArray(ids) && ids.length ? ids.map(Number).filter(Boolean) : null

    const { data: lic } = await supabase.from('ofertare_licitatii').select('id, nr_anunt, autoritate, termen_depunere, obiect').eq('id', licId).single()
    if (!lic) return fail('licitatie negasita')

    let q = supabase.from('ofertare_cerinte')
      .select('id, sursa_sectiune, text_cerinta, lot, document_probant, cand_se_prezinta')
      .eq('licitatie_id', licId).eq('tip', batch).is('inlocuita_de', null).order('id')
    if (idsFelie) q = q.in('id', idsFelie)
    const { data: cerinte } = await q
    if (!cerinte?.length) return { ok: true, batch, propuneri: 0, skip: 'nicio cerinta de tipul asta' }

    const { data: auth, error: eAuth } = await supabase.from('hr_autorizatii')
      .select('id, numar_autorizatie, data_expirare, fara_expirare, domenii, procedeu_sudura, diametru_teava_mm, emitent, fisier_path, tip:hr_autorizatii_tipuri(denumire, cod), emp:employees(name, active), ext:hr_personal_extern(nume, activ)')
      .is('deleted_at', null).is('inlocuita_de_id', null).order('id')   // ordine STABILA: fara ea, prefixul difera intre apeluri si cache-ul nu se potriveste
    // 17.09.2026: titularii cu contract închis (employees.active=false) sau externii dezactivați nu
    // intră în catalog — o autorizație a unui om plecat nu poate acoperi nimic în fața autorității.
    const titularActiv = (r: any) => !(r.emp && r.emp.active === false) && !(r.ext && r.ext.activ === false)
    const catalog = (auth || []).filter(titularActiv).map((a: any) => ({
      id: a.id, tip: a.tip?.denumire, cod: a.tip?.cod || undefined,
      titular: a.emp?.name || a.ext?.nume || '?', extern: !!a.ext,
      numar: a.numar_autorizatie || undefined, emitent: a.emitent || undefined,
      expira: a.fara_expirare ? 'niciodata' : (a.data_expirare || 'necunoscut'),
      domenii: (a.domenii && a.domenii.length) ? a.domenii : undefined,
      // #65: codurile normalizate din nomenclator + schema veche MLPAT separat (neechivalată)
      ...(() => { const n = normalizeazaDomeniiISC(a.domenii); return { domenii_isc: n.coduri.length ? n.coduri : undefined, domenii_vechi: n.vechi.length ? n.vechi : undefined } })(),
      sudura: a.procedeu_sudura || undefined, diam_mm: a.diametru_teava_mm || undefined,
      are_scan: !!a.fisier_path,
    }))
    const { data: docsF, error: eDocF } = await supabase.from('documente_firma')
      .select('id, tip, denumire, categorie, numar_document, autoritate_emitenta, data_valabilitate, fara_expirare, pdf_path')
      .eq('activ', true).order('id')
    const catalogFirma = (docsF || []).map((d: any) => ({
      id: 'F' + d.id, tip: d.tip, denumire: d.denumire, categorie: d.categorie || undefined,
      numar: d.numar_document || undefined, emitent: d.autoritate_emitenta || undefined,
      expira: d.fara_expirare ? 'niciodata' : (d.data_valabilitate || 'necunoscut'),
      are_scan: !!d.pdf_path,
    }))
    const { data: partAll, error: ePart } = await supabase.from('ofertare_parteneri')
      .select('id, nume, tip_relatie, observatii').eq('activ', true).eq('abandonat', false).order('id')

    // A PATRA sursa (12.09.2026): experienta similara. Pana acum catalogul avea doar
    // autorizatii, documente de firma si parteneri, iar cerintele de experienta similara
    // ieseau „gol" cu motivul „nu exista in catalog" — desi firma are 45 de lucrari in
    // `ofertare_experienta`. La Racari, 5 din 11 goluri eliminatorii erau false din asta.
    // #65: nomenclatorul ISC RTE (23 domenii/subdomenii, Procedura ISC 2016) — parte STABILĂ a promptului.
    const { data: nomen, error: eNomen } = await supabase.from('isc_rte_domenii')
      .select('cod, denumire, grup_nume, variante, experienta_ani, cuvinte_cheie_lucrari, autorizatie_anre_ceruta').eq('activ', true).order('cod')
    const nomenclator = (nomen || []).map((d: any) => ({ cod: d.cod, denumire: d.denumire, grup: d.grup_nume, variante: d.variante || undefined, experienta_ani: d.experienta_ani, lucrari: d.cuvinte_cheie_lucrari || undefined, anre: d.autorizatie_anre_ceruta || undefined }))
    // 17.09.2026: a ȘASEA sursă — documentele de STUDII ale persoanelor, id-uri D.
    // Doar categoria 'studii' din nomenclator (diplome + calificări): restul dosarului de personal
    // (CI, pașaport, cazier, fișa postului, extras de cont) n-are ce căuta într-un prompt de
    // ofertare — sunt date personale care nu dovedesc nicio capabilitate față de autoritate.
    const { data: studiiAll, error: eStudii } = await supabase.from('hr_documente_personale')
      .select('id, numar_document, emitent, data_emitere, fisier_path, observatii, tip:hr_documente_personale_tipuri!inner(cod, denumire, categorie), emp:employees(name, active)')
      .eq('tip.categorie', 'studii').eq('activ', true).is('deleted_at', null).order('id')
    // 17.09.2026: a ȘAPTEA sursă — dovezile de VECHIME de la angajatorii anteriori, id-uri V.
    // Categoria 'angajator_anterior': CV, extras REGES / adeverință de vechime, adeverință și
    // decizie de încetare, anexa 7 de cotizare. Astea acoperă exact felul de cerință pe care
    // recomandările NU-l acoperă: „experiență profesională generală minimum N ani în ...".
    const { data: vechAll, error: eVech } = await supabase.from('hr_documente_personale')
      .select('id, numar_document, emitent, data_emitere, fisier_path, observatii, tip:hr_documente_personale_tipuri!inner(cod, denumire, categorie), emp:employees(name, active)')
      .eq('tip.categorie', 'angajator_anterior').eq('activ', true).is('deleted_at', null).order('id')
    // #73: a CINCEA sursă — recomandările persoanelor (experiență pe roluri), id-uri R
    const { data: recAll, error: eRec } = await supabase.from('hr_recomandari')
      // nr_document / data_document / calificativ: R14b cere motivul să citeze dovada exact
      // („recomandare TRANSGAZ nr. 8231/03.10.2024, 9 obiective, FOARTE BUN"), nu doar să o invoce.
      .select('id, employee_id, extern_id, rol, beneficiar, obiect_lucrare, obiective, perioada_start, perioada_end, valoare_lei, domenii, verificat, ai_confidenta, nr_document, data_document, calificativ, emp:employees(name, active), ext:hr_personal_extern(nume, activ)')
      .eq('activ', true).order('id')
    const { data: expAll, error: eExp } = await supabase.from('ofertare_experienta')
      .select('id, denumire, beneficiar, valoare_lei, valoare_executata_lei, data_pv, tip_pv, asociere, folder_nas')
      .eq('activ', true).order('id')

    // BLOCANT reparat 12.09: interogarile de mai sus citeau doar `data`, niciodata `error`.
    // supabase-js NU arunca la esec — intoarce { data: null, error }. Cu `(auth || [])`,
    // un timeout devenea tacut CATALOG GOL, iar modelul aplica atunci corect regula R1
    // („potrivesti DOAR cu ce exista in catalog") si raspundea 'gol' pe TOATE cerintele.
    // Alea erau randuri valide, deci stergerea pleca si o licitatie cu acoperirile puse
    // devenea integral „fara dovada" — fara nicio eroare nicaieri.
    if (eAuth || eDocF || ePart || eExp || eNomen || eRec || eStudii || eVech) {
      return fail('catalog indisponibil: ' + (eAuth?.message || eDocF?.message || ePart?.message || eExp?.message || eNomen?.message || eRec?.message || eStudii?.message || eVech?.message))
    }
    // A doua plasa: un catalog gol nu e o stare normala pentru firma asta. Daca ambele
    // surse sunt goale, ceva e rupt in amonte — nu propunem nimic si nu stergem nimic.
    if (!(auth || []).length && !(docsF || []).length) {
      return fail('catalog gol (0 autorizatii, 0 documente de firma) — refuz sa propun acoperiri')
    }

    // tip_relatie: 'subcontractant' (execuție / proiectare — R16) sau 'furnizor' (servicii, echipamente);
    // specialitatea CONCRETĂ (ex. „proiectare instalații edilitare / apă-canal / gaze / drumuri") stă în observatii → acopera.
    const parteneri = (partAll || []).map((p: any) => ({ id: p.id, nume: p.nume, tip_relatie: p.tip_relatie, acopera: (p.observatii || '').slice(0, 400) || undefined }))

    // COTA PROPRIE, nu totalul contractului. La o lucrare in asociere, valoarea intreaga e a
    // asocierii; Gazpet poate invoca doar partea lui. In date: o lucrare de 33,29 mil lei are
    // partea proprie 24,21 mil, iar DOUA lucrari in asociere n-au deloc cota completata — alea
    // nu pot sustine nicio cerinta de valoare. A declara totalul asocierii drept experienta
    // proprie nu e o eroare de calcul, e o declaratie falsa catre autoritatea contractanta.
    const valoareProprie = (e: any) => e.asociere ? (e.valoare_executata_lei ?? null) : (e.valoare_lei ?? null)
    // `folder_nas` nu se trimite (cale interna). Trimitem doar faptul ca dosarul e inregistrat —
    // ceea ce NU inseamna ca exista si ca e probant.
    const catalogExp = (expAll || []).map((e: any) => ({
      id: 'E' + e.id, denumire: e.denumire, beneficiar: e.beneficiar || undefined,
      valoare_proprie_lei: valoareProprie(e),
      valoare_totala_lei: e.asociere ? (e.valoare_lei ?? undefined) : undefined,
      in_asociere: e.asociere || undefined,
      cota_proprie_necunoscuta: (e.asociere && e.valoare_executata_lei == null) || undefined,
      data_pv: e.data_pv || undefined, tip_pv: e.tip_pv || undefined,
      cale_inregistrata: !!e.folder_nas,
    }))

    // CACHE (12.09.2026): catalogul — autorizatii, documente de firma, parteneri — e IDENTIC
    // la fiecare apel: nu depinde nici de licitatie, nici de felie. Erau ~35 de mii de tokeni
    // retrimisi si platiti integral de 158 de ori. Anthropic poate tine prefixul in cache, dar
    // DOAR ca prefix: mai intai partea stabila, pe urma cea variabila. Inainte era exact invers
    // (licitatia si cerintele primele), deci un `cache_control` pus fara reordonare n-ar fi
    // prins nimic. De-asta si `.order('id')` de mai sus: o singura linie mutata in catalog
    // schimba prefixul si rateaza cache-ul.
    const catalogRec = (recAll || []).filter(titularActiv).map((r: any) => ({
      id: 'R' + r.id, titular: r.emp?.name || r.ext?.nume || '?', extern: !!r.ext, rol: r.rol || undefined,
      beneficiar: r.beneficiar || undefined, lucrare: r.obiect_lucrare || undefined,
      // #1399: obiectivele structurate — la punctaj numeri de aici (câte 1 per element, natura pe fiecare), nu din „lucrare"
      obiective: (Array.isArray(r.obiective) && r.obiective.length) ? r.obiective.map((o: any) => `${o.denumire}${o.an ? ' ' + o.an : ''} [${o.natura}]`).slice(0, 60) : undefined,
      perioada: [r.perioada_start, r.perioada_end].filter(Boolean).join(' → ') || undefined,
      valoare_lei: r.valoare_lei ?? undefined, domenii: (r.domenii && r.domenii.length) ? r.domenii : undefined,
      verificat: !!r.verificat, incredere_ai: r.ai_confidenta ?? undefined,
      document: [r.nr_document && ('nr. ' + r.nr_document), r.data_document].filter(Boolean).join('/') || undefined,
      calificativ: r.calificativ || undefined,
    }))
    // Compactăm: doar ce contează pentru potrivirea pe specialitate. `observatii` poartă descrierea
    // citită de AI la încărcare („Diplomă de Inginer, Instalații") — de-aia e câmpul cel mai util aici.
    const catalogStudii = (studiiAll || []).filter(titularActiv).map((d: any) => ({
      id: 'D' + d.id, titular: d.emp?.name || '?', fel: d.tip?.denumire,
      descriere: (d.observatii || '').slice(0, 200) || undefined,
      emitent: d.emitent || undefined, numar: d.numar_document || undefined,
      an: d.data_emitere ? String(d.data_emitere).slice(0, 4) : undefined,
      are_scan: !!d.fisier_path,
    }))
    // Aceleași câmpuri ca la studii + `fel` care spune CE E documentul: diferența dintre un CV
    // (declarat de om) și un extras REGES (emis de stat) e toată diferența dintre o pistă și o
    // dovadă — regula R18 din prompt se sprijină pe câmpul ăsta.
    const catalogVechime = (vechAll || []).filter(titularActiv).map((d: any) => ({
      id: 'V' + d.id, titular: d.emp?.name || '?', fel: d.tip?.denumire, cod: d.tip?.cod,
      descriere: (d.observatii || '').slice(0, 200) || undefined,
      emitent: d.emitent || undefined, numar: d.numar_document || undefined,
      an: d.data_emitere ? String(d.data_emitere).slice(0, 4) : undefined,
      are_scan: !!d.fisier_path,
    }))
    // R14b pasul (3): când nimeni n-are recomandare, motorul enumeră cine are FUNCȚIA potrivită și
    // le ordonează după vechime. Autorizațiile dau numele, nu funcția — deci lista vine separat.
    // Doar rolurile de conducere/specialitate; sudorii și legătorii n-au ce căuta la „manager de proiect".
    const { data: personalAll, error: ePers } = await supabase.from('employees')
      .select('name, functie, position, hire_date').eq('active', true).order('name')
    if (ePers) return fail('catalog indisponibil: ' + ePers.message)
    const ROL_CONDUCERE = /manager|sef|șef|responsabil|director|coordonator|inginer|proiect|calitate|ssm|mediu|topo|devizier/i
    const personal = (personalAll || [])
      .filter((e: any) => ROL_CONDUCERE.test(e.functie || e.position || ''))
      .map((e: any) => ({ nume: e.name, functie: e.functie || e.position, din: e.hire_date || undefined }))
    const faraData = personal.filter((p: any) => !p.din).length

    const stabil = `NOMENCLATOR ISC RTE (${nomenclator.length} domenii, Procedura ISC 2016; codurile din domenii_isc trimit aici):\n${JSON.stringify(nomenclator)}\n\nPERSONAL PROPRIU — funcții și vechime (${personal.length}; „din" = data angajării, lipsă la ${faraData} persoane — vezi R14b pasul 3):\n${JSON.stringify(personal)}\n\nCATALOG AUTORIZAȚII PERSONAL (${catalog.length}):\n${JSON.stringify(catalog)}\n\nDOCUMENTE FIRMĂ — Gazpet Instal SRL (${catalogFirma.length}, id-uri cu prefix F):\n${JSON.stringify(catalogFirma)}\n\nPARTENERI ACTIVI (${parteneri.length}):\n${JSON.stringify(parteneri)}\n\nEXPERIENTA SIMILARA — lucrari Gazpet (${catalogExp.length}, id-uri cu prefix E):\n${JSON.stringify(catalogExp)}\n\nRECOMANDARI — experienta PERSOANELOR pe roluri (${catalogRec.length}, id-uri cu prefix R):\n${JSON.stringify(catalogRec)}\n\nSTUDII — diplome si calificari ale persoanelor (${catalogStudii.length}, id-uri cu prefix D):\n${JSON.stringify(catalogStudii)}\n\nVECHIME — dovezi de la angajatori anteriori (${catalogVechime.length}, id-uri cu prefix V):\n${JSON.stringify(catalogVechime)}`
    const variabil = `LICITAȚIA: ${lic.nr_anunt} · ${lic.autoritate} · TERMEN DE DEPUNERE: ${lic.termen_depunere || 'necunoscut'}\nOBIECTUL CONTRACTULUI: ${lic.obiect || 'necunoscut'}\n\nCERINȚE (tip ${batch}):\n${JSON.stringify(cerinte)}`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(Deno.env.get('ANTHROPIC_WORKSPACE_ID') ? { 'anthropic-workspace-id': Deno.env.get('ANTHROPIC_WORKSPACE_ID')! } : {}) },
      signal: AbortSignal.timeout(10 * 60_000),   // pe NAS nu există limita gateway-ului; pe edge oricum cade la 150 s
      body: JSON.stringify({
        // Pe claude-opus-5 gandirea e PORNITA implicit cand `thinking` lipseste (spre deosebire
        // de Opus 4.8/4.7), iar tokenii de gandire se scad din max_tokens. La 9000 se intampla
        // ca taietura sa cada in blocul de gandire: nu ramane niciun bloc `text`, raspunsul pare
        // gol si rularea se oprea. O declaram explicit si ii dam loc. `budget_tokens` ar da 400.
        model: MODEL, max_tokens: 16000,
        thinking: { type: 'adaptive' },
        system: [{ type: 'text', text: PROMPT }],
        messages: [{ role: 'user', content: [
          { type: 'text', text: stabil, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: variabil },
        ] }],
      }),
    })
    const data = await resp.json()
    if (!resp.ok) return fail('Claude: ' + (data.error?.message || resp.status))

    try {
      const u = data.usage || {}
      // Tokenii de cache se factureaza separat: scrierea 1.25x pretul de intrare, citirea 0.1x.
      // Fara ei in formula, cost_usd ar arata artificial mic si n-am mai sti cat costa de fapt.
      const cacheW = u.cache_creation_input_tokens || 0
      const cacheR = u.cache_read_input_tokens || 0
      await supabase.from('ai_usage_log').insert({
        function_name: 'ofertare-acoperire', model: MODEL,
        tokens_in: (u.input_tokens || 0) + cacheW + cacheR,
        tokens_out: u.output_tokens || 0,
        cost_usd: (u.input_tokens || 0) * PRICE_IN + cacheW * PRICE_IN * 1.25 + cacheR * PRICE_IN * 0.1 + (u.output_tokens || 0) * PRICE_OUT,
        ref_table: 'ofertare_licitatii', ref_id: licId,
      })
    } catch (_) {}

    const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
    const clean = txt.replace(/```json?|```/g, '')
    let lista: any[] = []
    let trunchiat = data.stop_reason === 'max_tokens'
    try {
      const m = clean.match(/\{[\s\S]*\}/)
      lista = JSON.parse(m ? m[0] : '{}').acoperiri || []
    } catch (_) {
      // 21.09.2026 — plasa de regex a fost SCOASA, nu reparata. Culegea obiecte `{...}` fara
      // acolade interioare; de cand o cerinta are `candidati: [{...}]`, alea sunt candidatii,
      // nu cerintele. Ar fi intors obiecte fara `cerinta_id`, pe care filtrul de mai jos le
      // arunca in tacere: felia ar fi aparut „fara raspuns" in loc de „netransat".
      //
      // Mai grav: un raspuns taiat la mijloc ar fi dat o LISTA PARTIALA de candidati aratand
      // ca una completa. Omul ar fi vazut doua variante si ar fi crezut ca alea sunt toate.
      // Mai bine nu scriem nimic si reluam felia mai mica — cerintele raman cum erau.
      return fail('Răspunsul AI nu e JSON valid' + (trunchiat ? ' (s-a tăiat la limita de tokeni)' : '') +
        ' — nu s-a scris nimic. Reia felia cu mai puține cerințe.')
    }

    const idsCerinte = new Set((cerinte || []).map((c: any) => c.id))
    const idsAuth = new Map(catalog.map((a: any) => [a.id, a]))
    const idsDocF = new Map((docsF || []).map((d: any) => [d.id, d]))
    const idsPart = new Set(parteneri.map((p: any) => p.id))
    const idsExp = new Map((expAll || []).map((e: any) => [e.id, e]))
    const idsRec = new Map((recAll || []).map((r: any) => [r.id, r]))
    const idsStudii = new Map((studiiAll || []).map((d: any) => [d.id, d]))
    const idsVech = new Map((vechAll || []).map((d: any) => [d.id, d]))
    const azi = lic.termen_depunere ? new Date(lic.termen_depunere) : new Date()

    // R-ACOP-1 (reparat 12.09.2026). Inainte, stergerea rula AICI — inaintea insertului si
    // pe TOATE cerintele feliei, nu doar pe cele la care AI-ul chiar raspunsese. Daca
    // raspunsul se taia (`trunchiat`) sau insertul pica, acoperirile vechi erau deja duse,
    // iar cerintele ramaneau fara niciun rand. Acum se construiesc intai randurile, apoi se
    // scriu printr-o singura tranzactie in BD (vezi fn_ofertare_acoperire_rescrie mai jos).
    const rows: any[] = []
    const clarProps: { cerinta_id: number; intrebare: string }[] = []

    // 21.09.2026 — CANDIDATI MULTIPLI. AI-ul intoarce un obiect per CERINTA, cu `candidati: []`
    // (0-3). `turtesteCandidati` il aduce inapoi la un obiect per CANDIDAT, ca toata logica de
    // mai jos sa ramana neatinsa. Vezi comentariile si testele din candidati.ts.
    const lista1 = turtesteCandidati(lista)

    for (const p of lista1) {
      if (!idsCerinte.has(p.cerinta_id)) continue
      const domeniuRte = (typeof p.domeniu_rte === 'string' && /^\d{1,2}\.\d[DT]?$/i.test(p.domeniu_rte.trim())) ? p.domeniu_rte.trim().toUpperCase() : null
      // #65 varianta A: regula de echipa — se scrie ca atare, ca sa nu dispara sub nu_se_aplica.
      // Garda in cod (14.09, dupa prima rulare pe Domnesti: 74 din 77 de obligatii tehnice din CS au
      // primit "regula_propunere"): statusul se accepta DOAR daca textul cerintei vorbeste de echipa/
      // roluri/cumul/inlocuire/nominalizare. Altfel cade pe nu_se_aplica, cum era inainte de v13.
      const textC = String((cerinte || []).find((c: any) => c.id === p.cerinta_id)?.text_cerinta || '')
      const eRegulaEchipa = /cumul|acela[sș]i persoan|aceea[sș]i persoan|o persoan[aă] nu|nu poate (îndeplini|indeplini)|\brol(uri|ul|urile)?\b|func[tț]i[ei]\b.*(distinct|separat|diferit)|înlocui|inlocui|nominaliz|asociat/i.test(textC)
      if (p.status === 'regula_propunere' && !eRegulaEchipa) p.status = 'nu_se_aplica'
      if (p.status === 'regula_propunere') {
        rows.push({
          cerinta_id: p.cerinta_id, mod: 'regula_propunere',
          autorizatie_id: null, doc_firma_id: null, partener_id: null, experienta_id: null,
          referinta_text: (typeof p.motiv === 'string' ? p.motiv.slice(0, 300) : null),
          status: 'regula_propunere', valabil_la_depunere: null, verificat_pe_scan: false, domeniu_rte: null,
          motiv: (typeof p.motiv === 'string' ? p.motiv.slice(0, 300) : null), scor: null,
        })
        continue
      }
      if (p.status === 'nu_se_aplica') {
        // R-ACOP-1 partea 2: se scrie, nu se tace. „AI-ul a zis ca nu se aplica" si „AI-ul
        // n-a raspuns" insemnau amandoua lipsa randului, deci o pierdere de date arata
        // exact ca o clasare corecta. Decizia OMULUI ramane separata, in
        // ofertare_cerinte.stare — asta e doar propunerea AI-ului.
        rows.push({
          cerinta_id: p.cerinta_id, mod: 'nu_se_aplica',
          autorizatie_id: null, doc_firma_id: null, partener_id: null,
          referinta_text: (typeof p.motiv === 'string' ? p.motiv.slice(0, 300) : null),
          status: 'nu_se_aplica', valabil_la_depunere: null, verificat_pe_scan: false, domeniu_rte: null,
          motiv: (typeof p.motiv === 'string' ? p.motiv.slice(0, 300) : null), scor: null,
        })
        continue
      }
      let docF: any = null
      let aut: any = null
      let exp: any = null
      let rec: any = null
      let stud: any = null
      let vech: any = null
      let motivBlocat: string | null = null
      if (typeof p.autorizatie_id === 'string' && /^V\d+$/.test(p.autorizatie_id)) {
        const vid = Number(p.autorizatie_id.slice(1))
        if (idsVech.has(vid)) vech = idsVech.get(vid)
      } else if (typeof p.autorizatie_id === 'string' && /^D\d+$/.test(p.autorizatie_id)) {
        const did = Number(p.autorizatie_id.slice(1))
        if (idsStudii.has(did)) stud = idsStudii.get(did)
      } else if (typeof p.autorizatie_id === 'string' && /^R\d+$/.test(p.autorizatie_id)) {
        const rid = Number(p.autorizatie_id.slice(1))
        if (idsRec.has(rid)) rec = idsRec.get(rid)
      } else if (typeof p.autorizatie_id === 'string' && /^F\d+$/.test(p.autorizatie_id)) {
        const fid = Number(p.autorizatie_id.slice(1))
        if (idsDocF.has(fid)) docF = idsDocF.get(fid)
      } else if (typeof p.autorizatie_id === 'string' && /^E\d+$/.test(p.autorizatie_id)) {
        const eid = Number(p.autorizatie_id.slice(1))
        const cand = idsExp.get(eid)
        // BLOCAJ IN COD, nu doar in prompt: o lucrare in asociere fara cota proprie nu poate
        // sustine NIMIC. Regula din prompt e o rugaminte catre model; asta e o interdictie.
        // Riscul de aici nu e un rand gresit in tabel, e o declaratie falsa catre autoritate.
        if (cand && cand.asociere && cand.valoare_executata_lei == null) {
          motivBlocat = `lucrarea „${String(cand.denumire || '').slice(0, 60)}" e in asociere si nu are cota Gazpet inregistrata — nu se poate invoca`
        } else if (cand) exp = cand
      } else if (p.autorizatie_id && idsAuth.has(Number(p.autorizatie_id))) {
        aut = idsAuth.get(Number(p.autorizatie_id))
      }
      const part = p.partener_id && idsPart.has(p.partener_id) ? p.partener_id : null
      let status = ['acoperit', 'acoperit_partener', 'gol'].includes(p.status) ? p.status : 'gol'
      if (status === 'acoperit' && !aut && !docF && !exp && !rec && !stud && !vech) status = 'gol'
      if (status === 'acoperit_partener' && !part && !aut && !docF && !exp && !rec && !stud && !vech) status = 'gol'
      if (motivBlocat) status = 'gol'
      let valabil: boolean | null = null
      if (aut) valabil = aut.expira === 'niciodata' ? true : (aut.expira !== 'necunoscut' && new Date(aut.expira) >= azi)
      if (docF) valabil = docF.fara_expirare ? true : (docF.data_valabilitate ? new Date(docF.data_valabilitate) >= azi : null)
      // #72 R15 în cod: la „primul_loc"/„duae" valabilitatea la depunere nu e criteriu — documentul se reemite atunci.
      // 18.09.2026 — FALS POZITIV REPARAT (găsit de o recenzie independentă): excepția ridica la
      // „acoperit" ORICE rând gol care avea un document de firmă atașat, indiferent de motiv. Dar
      // „gol" cu document înseamnă, de regulă, că documentul NU răspunde cerinței — iar un document
      // nepotrivit nu devine potrivit fiindcă se reemite la DUAE. Excepția are voie să acopere un
      // singur motiv: documentul e bun, doar expirat. Altfel platforma declara verde o cerință
      // neacoperită, exact în ecranul pe care se sprijină depunerea.
      const candC = (cerinte || []).find((c: any) => c.id === p.cerinta_id)?.cand_se_prezinta
      if (docF && ['primul_loc', 'duae'].includes(candC)) {
        const doarExpirat = valabil === false   // fara_expirare → true, fara data → null; false = chiar expirat
        valabil = null
        if (status === 'gol' && doarExpirat) { status = 'acoperit'; p.motiv = `${String(p.motiv || '').slice(0, 160)} — se prezintă ${candC === 'duae' ? 'în DUAE' : 'doar la locul I'}, se reemite atunci (R15)` }
      }
      // La experienta nu exista „expirare": lucrarea e receptionata sau nu. Fereastra de ani
      // tine de cerinta, nu de document, deci lasam null si nu inventam un verdict.
      if (exp) valabil = null
      if (rec) valabil = null   // o recomandare nu expiră; fereastra de ani e a cerinței
      if (stud) valabil = null  // o diplomă nu expiră (R17)
      if (vech) valabil = null  // o adeverință de vechime nu expiră (R18)
      rows.push({
        cerinta_id: p.cerinta_id,
        mod: status === 'gol' ? 'gol' : (vech ? 'vechime' : (stud ? 'studii' : (rec ? 'recomandare' : (exp ? 'experienta' : (docF ? 'firma' : (aut ? (aut.extern ? 'partener' : 'personal') : 'partener')))))),
        autorizatie_id: aut ? aut.id : null,
        doc_firma_id: docF ? docF.id : null,
        partener_id: part,
        experienta_id: exp ? exp.id : null,
        recomandare_id: rec ? rec.id : null,
        document_personal_id: stud ? stud.id : (vech ? vech.id : null),
        referinta_text: (motivBlocat || (typeof p.motiv === 'string' ? p.motiv.slice(0, 300) : null)),
        status,
        valabil_la_depunere: valabil,
        verificat_pe_scan: false,
        domeniu_rte: domeniuRte,
        // `motiv` e textul de sub fiecare candidat in ecran; `scor` da ordinea intre ei.
        // `referinta_text` ramane ce era — il citesc ecranele vechi si exporturile.
        motiv: (motivBlocat || (typeof p.motiv === 'string' ? p.motiv.slice(0, 300) : null)),
        scor: (typeof p.scor === 'number' && p.scor >= 0 && p.scor <= 100) ? Math.round(p.scor) : null,
      })
      // TKT-0203 (Oana): cand cerinta zice doar „RTE" fara sa spuna domeniul, AI-ul nu mai
      // ghiceste — propune o clarificare catre autoritate. O retinem doar pentru cerintele
      // care chiar se scriu (vezi mai jos), ca sa nu propunem clarificari pe randuri respinse.
      if (typeof p.clarificare === 'string' && p.clarificare.trim().length > 15) {
        clarProps.push({ cerinta_id: p.cerinta_id, intrebare: p.clarificare.trim().slice(0, 2000) })
      }
    }
    // R20 în cod (vezi candidati.ts pentru de ce, și src/ofertareCandidati.test.js pentru teste).
    marcheazaSudoriNepotriviti(
      rows, String(lic.obiect || ''),
      (cid: number) => String((cerinte || []).find((c: any) => c.id === cid)?.text_cerinta || ''),
      (id: any) => String((idsAuth.get(Number(id)) || {}).tip || ''),
    )

    // Nimic de scris = nimic de sters. Altfel un raspuns gol ar goli tabelul.
    // Felie fara niciun rand valid: NU e o eroare a rularii. Raspunsul purta cheia `error`,
    // iar frontendul face `return` din tot ciclul cand o vede — asa ca o singura felie
    // nefericita oprea si restul eliminatoriilor, si intreg batch-ul 'propunere'. Acum
    // raportam felia ca goala si lasam ciclul sa continue; felia intra la reluare.
    if (!rows.length) {
      return {
        ok: true, batch, propuneri: 0, felie_goala: true, trunchiat,
        motiv_felie_goala: 'AI-ul n-a intors nicio acoperire valida — nu s-a sters si nu s-a scris nimic',
        stop_reason: data.stop_reason || null,
        fara_raspuns: idsCerinte.size, cerinte_fara_raspuns: Array.from(idsCerinte),
        tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      }
    }
    const PLAFON_RAPORT = 500
    // 21.09.2026 — ZIDUL INTAI, DARAMAT. Randurile plecau de aici deduplicate pe `cerinta_id`,
    // deci candidatii 2 si 3 mureau in Edge, inainte sa ajunga la BD. Era prima din cele doua
    // opriri care faceau ecranul sa arate mereu o singura varianta (a doua era `DISTINCT ON`
    // din RPC). Acum pleaca toate; RPC-ul le reconciliaza dupa identitatea candidatului.
    //
    // `randuriUnice` ramane, dar doar pentru RAPORT: „la ce cerinte a raspuns AI-ul" e o
    // intrebare pe cerinte, nu pe randuri, si nu vrem o cerinta numarata de trei ori.
    const vazute = new Set()
    const randuriUnice = rows.filter(r => { if (vazute.has(r.cerinta_id)) return false; vazute.add(r.cerinta_id); return true })

    // 12.09.2026 — SCRIEREA E ACUM ATOMICA, intr-o singura tranzactie in BD.
    // Inainte erau patru cereri separate prin PostgREST: citeste randurile vechi, insereaza
    // cele noi, reciteste ce urmeaza sa stergi, sterge. Netranzactional, deci fiecare pauza
    // dintre ele era o fereastra in care un coleg putea apasa „verificat" sau scrie un raspuns
    // pe randul pe care tocmai il stergeam. Plus: doua rulari simultane lasau duplicate.
    //
    // `fn_ofertare_acoperire_rescrie` face altceva, nu doar acelasi lucru mai repede:
    // ACTUALIZEAZA coloanele AI ale randului existent in loc sa-l stearga si sa-l re-creeze.
    // Campurile omului (raspuns_coleg / raspuns_de / raspuns_la / tichet_id) nu mai sunt nici
    // macar citite de aici — raman pur si simplu pe rand, deci nu mai pot fi pierdute. Le
    // trimitem doar coloanele AI; functia ignora orice altceva ar veni in payload.
    // Impreuna cu indexul unic partial pe (cerinta_id) WHERE verificat_pe_scan = false,
    // duplicatele nu mai sunt posibile nici macar cand doi colegi apasa butonul deodata.
    const { data: rez, error: eRpc } = await supabase.rpc('fn_ofertare_acoperire_rescrie', {
      // `rows`, nu `randuriUnice`: aici se pierdeau candidatii 2 si 3. Ordinea conteaza —
      // RPC-ul taie la primii 3 pe cerinta in ordinea in care ii primeste.
      p_randuri: rows.map(r => ({
        cerinta_id: r.cerinta_id, mod: r.mod,
        autorizatie_id: r.autorizatie_id, doc_firma_id: r.doc_firma_id, partener_id: r.partener_id,
        experienta_id: r.experienta_id, recomandare_id: r.recomandare_id || null,
        document_personal_id: r.document_personal_id || null,
        referinta_text: r.referinta_text, status: r.status, valabil_la_depunere: r.valabil_la_depunere,
        domeniu_rte: r.domeniu_rte || null,
        motiv: r.motiv ?? null, scor: r.scor ?? null,
      })),
    })
    if (eRpc) return fail('rescriere acoperiri (tranzactie anulata, nu s-a schimbat nimic): ' + eRpc.message)

    // Gaura lui `ales_de`: poarta protejează INTENȚIA omului, nu corectitudinea ei. Dacă
    // autorizația aleasă expiră înainte de termen, motorul n-are voie s-o schimbe — dar
    // are voie să-l anunțe. Nu atinge alegerea; îi cere reverificare, cu motivul scris.
    const { data: rev, error: eRev } = await supabase.rpc('fn_ofertare_acoperire_reverifica_alese', {
      p_cerinte: Array.from(idsCerinte),
    })
    if (eRev) console.error('reverificare alese (neblocant):', eRev.message)
    const aleseExpirate: number[] = rev?.reverificate || []

    const scrise: number[] = rez?.scrise || []
    const idsConflicte: number[] = rez?.conflicte || []
    const scriseSet = new Set(scrise)
    // Doua motive diferite de a NU scrie, cu acelasi efect dar cu alt mesaj pentru om:
    // cerinta are o dovada verificata pe scan, sau un coleg a ales deja el un candidat
    // (`ales_de` non-NULL). Pana pe 21.09.2026 exista doar primul motiv; al doilea nu exista
    // deloc — rerularea calca peste alegerea colegului fara sa spuna nimic.
    const idsPeScan: number[] = rez?.pe_scan || []
    const idsAleseDeOm: number[] = rez?.alese_de_om || []
    const dePropus = (ids: number[]) => randuriUnice
      .filter(r => ids.includes(r.cerinta_id))
      .map(r => ({ cerinta_id: r.cerinta_id, propus: r.status, motiv: r.referinta_text }))
    // `pe_scan` lipseste doar daca RPC-ul e o versiune veche; atunci `conflicte` e tot ce avem.
    const conflicteVerificate = dePropus(rez?.pe_scan ? idsPeScan : idsConflicte)
    const conflicteAlesDeOm = dePropus(idsAleseDeOm)
    const deScris = randuriUnice.filter(r => scriseSet.has(r.cerinta_id))

    // TKT-0203: clarificari propuse automat pentru cerintele de RTE „la general".
    // Se scriu ca propuneri (status 'de_trimis') — omul le citeste, le ajusteaza si le trimite.
    // `sursa` e si cheia de idempotenta, si textul pe care il vede omul in lista (se afiseaza
    // brut in UI), de-asta e o fraza, nu un cod. Fara verificarea de duplicat, fiecare reluare
    // a acoperirii ar fi adaugat inca un rand — iar acoperirea se reia des, pe felii.
    // `nr` se completeaza: lista de clarificari il afiseaza ca numar de ordine si se sorteaza
    // dupa el, deci un rand fara nr ar aparea gol si ultimul.
    let clarificariNoi = 0
    try {
      const propuse = clarProps.filter(c => scriseSet.has(c.cerinta_id))
      if (propuse.length) {
        // #74: sursa e generică (domeniu RTE SAU experiență ambiguă) — rămâne cheia de idempotență per cerință
        const sursaPt = (id: number) => `cerința #${id} — de clarificat cu autoritatea (domeniu RTE / experiență)`
        const { data: exist } = await supabase.from('ofertare_clarificari')
          .select('sursa, nr').eq('licitatie_id', licId)
        const deja = new Set((exist || []).map((r: any) => r.sursa).filter(Boolean))
        let nr = Math.max(0, ...(exist || []).map((r: any) => Number(r.nr) || 0))
        const sursaVeche = (id: number) => `cerința #${id} — domeniu RTE neprecizat`   // cheia dinainte de v18 — nu dublăm
        const noi = propuse
          .filter(c => !deja.has(sursaPt(c.cerinta_id)) && !deja.has(sursaVeche(c.cerinta_id)))
          .map(c => ({
            licitatie_id: licId, nr: ++nr, intrebare: c.intrebare,
            sursa: sursaPt(c.cerinta_id), status: 'de_trimis', origine: 'platforma',
          }))
        if (noi.length) {
          const { error: eClar } = await supabase.from('ofertare_clarificari').insert(noi)
          // O clarificare nescrisa NU invalideaza acoperirea (deja scrisa, tranzactional).
          // O raportam in raspuns ca sa se vada, nu o inghitim.
          if (eClar) console.error('clarificari auto:', eClar.message)
          else clarificariNoi = noi.length
        }
      }
    } catch (e: any) { console.error('clarificari auto (neasteptat):', String(e?.message || e)) }

    // Cerintele la care AI-ul n-a raspuns si cele blocate de o dovada verificata: nu le-am
    // atins, deci acoperirea veche le ramane. Plafonul de raportare era 50, iar felia trimisa
    // de frontend are 55 — cerintele peste plafon nu mai erau reluate NICIODATA. Ridicat, plus
    // un steag explicit cand lista tot e taiata, ca frontendul sa reia atunci toata felia.
    const fararaspuns = Array.from(idsCerinte).filter((id: any) => !vazute.has(id))
    const goluri = deScris.filter(r => r.status === 'gol').length
    return { ok: true, batch, felie: idsFelie ? idsFelie.length : null,
      propuneri: deScris.length, goluri, clarificari_noi: clarificariNoi,
      firma: deScris.filter(r => r.mod === 'firma').length,
      nu_se_aplica: deScris.filter(r => r.status === 'nu_se_aplica').length,
      regula_propunere: deScris.filter(r => r.status === 'regula_propunere').length,
      cu_domeniu_rte: deScris.filter(r => r.domeniu_rte).length,
      experienta: deScris.filter(r => r.mod === 'experienta').length,
      recomandari: deScris.filter(r => r.mod === 'recomandare').length,
      studii: deScris.filter(r => r.mod === 'studii').length,
      vechime: deScris.filter(r => r.mod === 'vechime').length,
      conflicte_verificate: conflicteVerificate,
      conflicte_ales_de_om: conflicteAlesDeOm,
      alese_de_om_expirate: aleseExpirate,
      fara_raspuns: fararaspuns.length,
      cerinte_fara_raspuns: fararaspuns.slice(0, PLAFON_RAPORT),
      lista_fara_raspuns_taiata: fararaspuns.length > PLAFON_RAPORT,
      trunchiat, stop_reason: data.stop_reason || null,
      tokens_in: data.usage?.input_tokens, tokens_out: data.usage?.output_tokens,
      cache_scris: data.usage?.cache_creation_input_tokens || 0, cache_citit: data.usage?.cache_read_input_tokens || 0 }
  } catch (e: any) {
    return fail('Eroare neasteptata: ' + String(e?.message || e))
  }
}
