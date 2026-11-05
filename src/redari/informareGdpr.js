// Textul complet al informării GDPR, Lot 1 — sursa unică pentru pagina web /redari/informare și versoul convocatorului.
// Sursa: informarea v3.2 (04.11.2026) = A3_Informare_GDPR_Lot1_v3_1.docx (Final_v2, avocat 03.11.2026 + juridic#031/#032)
// + deciziile (k)/(s) din 04.11.2026 (e-mailul redari@, transferul, sursa datelor fără [surse exacte]),
// secțiunea „TEXT COMPLET – verso + pagina web”;
// v3.3 (05.11.2026, juridic#040, decizia Răzvan: utilizatorii / arendașii primesc convocare): cap. 2 „sau pe terenul pe care îl folosiți”,
// cap. 3 rând nou pentru persoana care folosește terenul.
// Textul scurt (fața convocatorului) NU e aici: el stă în red_proiecte.text_gdpr.
// Publicarea (decizia Răzvan 05.11.2026): informarea e publicată DOAR când proiectul are autorizarea scrisă Transgaz (art. 28 GDPR)
// încărcată de owner în ⚙️ Setări proiect: nr. + dată + PDF (migrarea 20261130m). Fără document nu există deblocare manuală.
// Cât nu e publicată sau textul are câmpuri [ ]: pagina are banda PROIECT + noindex, iar convocatorul pentru expediere se refuză
// (docx.js, verificaDateConvocator). Pagina publică întreabă BD-ul prin fn_red_informare_publicata(cod) (doar da / nu).
export const VERSIUNE_INFORMARE_LOT1 = 'v3.3 05.11.2026'
export const COD_PROIECT_INFORMARE_LOT1 = 'LOT1-PRUNISOR-JUPA'
// Câmpurile autorizării completate pe rândul de proiect — DOAR indiciu pentru formular. Decizia „publicată” o dă serverul
// (fn_red_informare_publicata: proiect activ + PDF-ul legat încă în storage), citită proaspăt înainte de generare (r2 Jakarinos P1-3 / Copilot P1-02).
const plinText = v => v != null && String(v).trim() !== ''
export const autorizareTgzCompleta = (proiect) => !!proiect && plinText(proiect.autorizare_tgz_nr) && plinText(proiect.autorizare_tgz_data) && plinText(proiect.autorizare_tgz_fisier)
// Indicatorul calculat de server, atașat pe obiectul proiectului de cuInformarePublicata (altfel lipsă = nepublicat)
export const informarePublicataPeProiect = (proiect) => proiect?.informare_publicata === true
/** Întreabă serverul (RPC) dacă informarea proiectului e publicată; eroare / RPC lipsă → false (fail-closed). */
export async function informarePublicataServer(client, cod) {
  if (!client || !plinText(cod)) return false
  try {
    const { data, error } = await client.rpc('fn_red_informare_publicata', { p_cod: cod })
    return !error && data === true
  } catch { return false }
}
/** Proiectul cu indicatorul proaspăt de la server (`informare_publicata`), pentru generarea convocatorului. */
export async function cuInformarePublicata(client, proiect) {
  return { ...(proiect || {}), informare_publicata: await informarePublicataServer(client, proiect?.cod) }
}
// Trimiterea de pe FAȚA convocatorului poștal la informarea de pe verso (text v3.2, exact).
// La rezolvarea conflictelor #939 ↔ main: docx.js de pe main are propria constantă TRIMITERE_VERSO_GDPR
// ('Informarea completă se află pe verso.') — se înlocuiește cu importul de aici (testul de paritate din informareGdpr.test.js o cere).
export const TRIMITERE_VERSO_GDPR = 'Pe verso găsiți informațiile complete despre folosirea datelor și drepturile dumneavoastră.'
export const TEXT_INFORMARE_LOT1 = "Proiectul „Conductă de transport gaze naturale Prunișor – Orșova – Băile Herculane – Jupa, Lot 1”, județul Mehedinți.\n\n### 1. Cine folosește datele dumneavoastră\n\n**Transgaz** (S.N.T.G.N. TRANSGAZ S.A., Mediaș, Piața C.I. Motaș nr. 1, jud. Sibiu) este beneficiarul conductei și hotărăște de ce și cum se folosesc datele. Responsabilul Transgaz cu protecția datelor: dpo@transgaz.ro.\n\n**Gazpet Instal** (GAZPET INSTAL S.R.L., Ploiești, Str. Fluturilor nr. 34, jud. Prahova) construiește conducta și folosește datele numai în numele Transgaz, după instrucțiunile Transgaz. Contact Gazpet Instal pentru acest proiect: redari@gazpet.ro, telefon 0244 435 005\n\n### 2. De ce folosim datele\n\nPe terenul dumneavoastră, pe partea de teren care vă aparține sau pe terenul pe care îl folosiți, s-a lucrat temporar la conductă. Folosim datele ca să:\n\n- vă anunțăm când verificăm terenul după lucrări și vă invităm să fiți de față;\n- întocmim procesul-verbal privind starea terenului: de confirmare, dacă participați, sau de constatare tehnică, dacă nu participați;\n- răspundem la sesizările dumneavoastră despre teren;\n- păstrăm dovezile lucrărilor pentru recepția conductei.\n\n**Temeiul legal** (Regulamentul UE 2016/679 – GDPR):\n\n- pentru identificarea proprietarilor și organizarea verificării: îndeplinirea unei sarcini de interes public – art. 6 alin. (1) lit. e). Conducta este declarată proiect de importanță națională prin Hotărârea Guvernului nr. 616/2020, iar Legea nr. 185/2016 (art. 10–12) stabilește cum se identifică proprietarii;\n- pentru refacerea terenului și răspunsul la sesizări: îndeplinirea unei obligații legale – art. 6 alin. (1) lit. c). Transgaz are obligația să dezvolte rețeaua de transport și să readucă la starea inițială terenurile afectate de lucrări (Legea nr. 123/2012, art. 130 alin. (1) lit. b); Standardul de performanță aprobat prin Ordinul ANRE nr. 140/2021, art. 30–31).\n\n### 3. Ce date folosim și de unde le avem\n\n- numele și adresa;\n- datele terenului: comuna (UAT), tarlaua și parcela, numărul cadastral, suprafața, partea care vă aparține;\n- telefonul sau e-mailul, dacă există;\n- semnătura și observațiile din procesul-verbal, prezența la verificare;\n- mesajele pe care ni le trimiteți, inclusiv pe e-mail la redari@gazpet.ro;\n- datele celui care vă reprezintă (împuternicit, moștenitor), dacă e cazul;\n- datele persoanei care folosește terenul (de exemplu, arendașul), dacă este alta decât proprietarul.\n\nDatele provin de la Transgaz, care le-a obținut pentru acest proiect de la oficiul de cadastru, primării și alte instituții, potrivit Legii nr. 185/2016, și din ce ne spuneți dumneavoastră.\n\n### 4. Cine mai vede datele\n\n- Transgaz;\n- firmele care ne ajută tehnic, pe bază de contract: curierul și găzduirea aplicației de evidență;\n- furnizorul de SMS, SMSLink (ASTINVEST COM S.R.L.), dacă vă trimitem și SMS: primește doar numărul de telefon și textul mesajului, ca operator de comunicații; datele sunt stocate în România;\n- autoritățile, când legea o cere.\n\nDatele din evidența proiectului sunt stocate în Uniunea Europeană. Pentru afișarea paginilor web folosim un furnizor din SUA, care vede doar date tehnice ale vizitei (adresa IP), cu garanțiile prevăzute de GDPR. Nu luăm decizii automate despre dumneavoastră. Nu vindem datele și nu le folosim pentru reclamă.\n\n### 5. Cât timp le păstrăm\n\n- Gazpet Instal: până la sfârșitul perioadei de garanție din contract.\n- Transgaz: conform legii în vigoare.\n\nMesajele primite la redari@gazpet.ro se păstrează în evidența proiectului, pe aceeași durată.\n\n### 6. Drepturile dumneavoastră\n\nPuteți cere să vedeți ce date avem despre dumneavoastră și să le corectăm. În cazurile prevăzute de lege, puteți cere ștergerea lor sau limitarea folosirii lor și vă puteți opune folosirii datelor făcute pentru sarcina de interes public. Unele date trebuie totuși păstrate pentru obligațiile legale legate de conductă.\n\nScrieți la dpo@transgaz.ro sau la redari@gazpet.ro. Transgaz răspunde de regulă într-o lună; dacă e nevoie de mai mult timp, vi se comunică. Dacă nu sunteți mulțumit, puteți face plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), www.dataprotection.ro, sau vă puteți adresa instanței.\n\n### 7. Textul pe hârtie\n\nAceastă informare este tipărită pe spatele convocării. O puteți cere și la telefonul de mai sus."

// Câmpurile încă necompletate din text: [__], [de completat], [de confirmat] etc.
export const campuriNecompletate = (text) => (String(text || '').match(/\[[^\]]*\]/g) || [])
// Gata de publicat/tipărit doar dacă e marcată explicit publicată ȘI nu mai are câmpuri [ ]
// r2 (Copilot P2-05): un text lipsă / gol nu e niciodată „gata”
export const informareGata = (text, publicata) => publicata === true && typeof text === 'string' && text.trim().length > 0 && campuriNecompletate(text).length === 0

// Markdown minimal (doar ce folosește textul juridic): ### titlu, - listă, **îngroșat**, paragrafe.
// Folosit identic de pagina web și de versoul DOCX (o singură definiție).
export function blocuri(text) {
  const out = []
  for (const bucata of String(text || '').split(/\n\s*\n/)) {
    const linii = bucata.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
    if (!linii.length) continue
    if (/^#{1,6}\s/.test(linii[0]) && linii.length === 1) out.push({ tip: 'titlu', text: linii[0].replace(/^#{1,6}\s+/, '') })
    else if (linii.every(l => /^\s*-\s/.test(l))) out.push({ tip: 'lista', elemente: linii.map(l => l.replace(/^\s*-\s+/, '')) })
    else out.push({ tip: 'paragraf', text: linii.join(' ') })
  }
  return out
}

// Segmente inline: **x** → îngroșat, [x] → câmp necompletat; restul text simplu
export const segmenteInline = (text) => String(text).split(/(\*\*[^*]+\*\*|\[[^\]]*\])/g).filter(Boolean).map(p =>
  p.startsWith('**') && p.endsWith('**') ? { tip: 'bold', text: p.slice(2, -2) }
    : p.startsWith('[') && p.endsWith(']') ? { tip: 'camp', text: p }
    : { tip: 'text', text: p })
