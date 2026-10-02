# PT — Audit UX AS-IS (submodul Propunere Tehnică)

> Read-only. Sursă: cod `main` la 29.09.2026 (`src/OfertarePropunere.jsx`, `src/ofertarePoarta.js`, `src/ofertareControale.js`, `src/OfertareRevizii.jsx`, `src/OfertareLicitatii.jsx`). Exemple reale: PT93 Jilava (lic. 93), clona 103 SANDBOX-V2-DOMNESTI. Nimic din acest document nu schimbă comportamentul live (freeze Ofertare până după 02.10).

## 0. Cifre PT93 la momentul auditului (29.09)
- 25 capitole, 316 cerințe de răspuns, 280 cu capitol, 0 fără capitol, 36 exceptate, 20 de formă.
- **280/280 neverificate de om**; 0 închise cu dovadă; 22 capitole scrise de AI necontrolate; 5 documente necitite.
- Pachet: nu există. Grafic: nicio versiune. Anexe declarate: 0.
- Toate cele 25 de capitole aveau `stare='gol'` deși aveau 104–104k caractere (corectat manual azi → `scris`) — nimic din UI nu semnala contradicția „gol dar are text".
- Operația dominantă de azi: **verificarea celor 280 de cerințe**, una câte una, cu `prompt()` (vezi §2e).

## 1. Montare și încărcare
- Pagina PT = tab top-level `📑 Propunere tehnică` (`OfertareLicitatii.jsx:366`, randare `:385`). Din fișa licitației (modal) există un rezumat (`:3548`, `:3624`) cu „Deschide matricea" care închide modalul și schimbă vederea (`:503`) → **pierderea contextului fișei**.
- `load()` (`OfertarePropunere.jsx:1252-1335`): ~20 query-uri; 4 view-uri pentru poartă + recalcul grafic în browser pe toate cantitățile. **Orice scriere (o bifă) reîncarcă tot.**

## 2. Ordinea pe pagină — 15 blocuri, un singur scroll
| # | Bloc | Clasă (vezi §4) | Obs. |
|---|---|---|---|
| 1 | Bară: selector licitație, termen, 4 exporturi, 🔏 Aprobă, 📦 Semnează | PRIMARY (parțial) | Exporturile și semnarea stau la egalitate vizuală |
| 2 | Eroare load | EXCEPTION | |
| 3 | PoartaPT (~22 rânduri) | PRIMARY | Fără verdict agregat; doar 5 rânduri au acțiune |
| 4 | Echipa F9 (colapsat) | CONTEXT | Blocajele F9 NU apar în poartă |
| 5 | Cuprins capitole | PRIMARY | Arată „N cerințe", dar nu care |
| 6 | Pachete aprobate | CONTEXT | Doar după aprobare |
| 7 | Observații | EXCEPTION | |
| 8 | Pachet echipamente | CONTEXT | Folosit o dată/licitație |
| 9 | Pachet personal | CONTEXT | Idem |
| 10 | Organigramă | CONTEXT | |
| 11 | Clarificări AC după depunere | CONTEXT (post-depunere) | Vizibil permanent, util doar după depunere |
| 12 | Participanți + Declarații + Anexe | CONTEXT | 3 formulare |
| 13 | Garanția | CONTEXT | |
| 14 | Afirmații / Conformitate | EXCEPTION | Gol la PT93 („nicio afirmație încărcată") fără buton de încărcare |
| 15 | **Matricea de conformitate** | PRIMARY | **Ultima pe pagină** — aici se face munca zilnică |

Concluzie: munca frecventă (poartă → cerință → capitol → text → verificare) e la extremele paginii (blocurile 3, 5, 15), iar între ele stau 9 blocuri folosite rar.

## 3. Operații AS-IS
Notație: C = click, D = dialog `prompt/confirm`, S = secțiuni traversate cu scroll, E = schimbare ecran/tab, M = ce trebuie să ții minte.

### (a) Intru pe o licitație și văd ce lipsește
Tab PT (1C) → select licitație (1–2C) → PoartaPT (0S). **C 2–3, D 0, S 0, E 1.**
Probleme: nu există verdict unic READY/BLOCKED; 22 de rânduri text, doar 5 clicabile; blocajele F9 sunt separat, colapsate (+1C); rândurile trimit în Documente/Grafic/Cantități fără link (E + M: „ce rând era?").

### (b) Aleg/lucrez un capitol
Scroll la Cuprins (S≈2, peste poarta de 22 rânduri) → `✎ text` (1C). Expand-ul are butoane, preview 200px, participant, istoric. **Cerințele capitolului NU apar.** **C 1, S 2.**

### (c) Văd cerințele capitolului
Nu există listă per capitol. Cuprins arată „N cerințe" → scroll la Matrice (S≈9) → chip „toate"/„rezolvate" (1C) → cauți vizual badge-ul „→ cap. 1.c" printre 316 rânduri. **C 1, S 9, M: eticheta capitolului + ce căutai.** Nu există filtru pe capitol.

### (d) Scriu/modific propunerea
- Manual: `✎ text` → `✎ Scrie/Modifică` → textarea 16 rânduri → Salvează. **C 3, D 0.** Reîncarcă tot.
- AI: `✎ text` → `🤖 Generează` → D prompt instrucțiune → D confirm „rescrii text de om?" → D confirm „cerințe neconfirmate" → text cu `sursa='ai'` → **rândul „nescrise" rămâne roșu până omul deschide editorul și MODIFICĂ ceva** (butonul Salvează e dezactivat fără modificare, `OfertareRevizii.jsx:169`). **C 5, D 1–3, + o editare artificială.** Acceptarea „am citit, e bun" nu există ca acțiune.
- Editorul nu arată cerințele pe care le acoperă capitolul → M: trebuie ținute minte din matrice.

### (e) Atașez / verific dovezile — **operația dominantă la PT93**
Matrice (S≈9) → rândul cerinței → `✓ verific` (1C) → D prompt „unde e răspunsul?" (tastezi locator liber, ex. „1.c.2 ...") → reîncarcă tot.
Dovadă: `📎` (1C) → D prompt „numărul documentului" dintr-o listă text de max 40 → D prompt locator → toast „rămâne de verificat" → apoi `✓ verific` + D.
**Per cerință: 1–2C + 1–3D + reîncărcare completă. La PT93: 280 × (1C + 1D) ≈ 560 interacțiuni + 280 reîncărcări.** În dialog nu vezi textul capitolului (M: omul caută citatul în altă parte și îl tastează).

### (f) Rezolv controalele / blocajele
| Rând poartă | Unde se rezolvă | Are acțiune din rând? |
|---|---|---|
| fără capitol, capcane, neverificate | Matrice | da (filtru + scroll) |
| neconfirmate | registrul de cerințe (alt ecran) — ✓ din PT scrie legătura, nu registrul | **filtru fără chip; mesaj înșelător** |
| dovadă propusă (nebifată pe scan) | modulul Acoperire | nu (trimite la filtrul „fără") |
| documentație / docs necitite | tab Documente | nu |
| grafic, cantități, H10/H11 | Grafic / Cantități | nu |
| goale / nescrise / nu_e_cazul | Cuprins → editare | nu |
| conformitate | secțiunea 14 — dar afirmațiile nu se pot încărca din PT | nu |
| garanție H4, participare H8, anexe H5, pachet H9 | secțiunile 12–13 / 6 | nu |
| identitate H1 | nicăieri (doar warn text) | nu |
**17 din 22 de rânduri nu au acțiune.**

### (g) Verific dacă PT e gata de pachet/depunere
Poarta (0S) → butoanele 🔏/📦 sunt dezactivate cu tooltip. Semnează (1C) → Aprobă (1C + 1D) → scroll la „Pachete aprobate" (S≈5) → 2 file input + Înregistrează. Ordinea semnare/aprobare nu e impusă de UI. Mesajele de refuz („Între timp s-a redeschis un rând roșu") nu spun care rând.

## 4. Inventar clasificat
- **PRIMARY:** verdict poartă (azi lipsește ca verdict unic), lista „ce cere acțiune", cuprins, cerințele capitolului curent, editorul capitolului.
- **CONTEXT (doar când lucrez un capitol / o dată pe licitație):** echipa F9, pachete echipamente/personal, organigramă, participanți/declarații/anexe, garanție, exporturi, istoric capitol, „Piesa o furnizează".
- **EXCEPTION:** observații, conformitate afirmații, capcane, blocaje F9, eroare load, „DEPĂȘIT", transfer în curs.
- **AUDIT/TECHNICAL:** stare legătură vN, verificat_la_versiunea, sha256 fișiere, snapshot semnătură, sursă (om/ai/import), LanțProbator, istoric versiuni, detaliile R9b/transfer_*.

## 5. Informație duplicată
- Cifrele de cerințe în **5 locuri**: eticheta tabului din fișă, PropunereRezumat, PoartaPT, contorul matricei, badge-urile cuprinsului.
- Regula „neverificate" are **3 definiții** (view, filtru client `:345`, badge `:433`); „capcane" 2 (view + `RX_CAPCANA` client).
- `evalueazaPoarta` rulează în **5 locuri** (poartă, bară, semnează, aprobă, rezumat).
- Oamenii apar în **4 vederi** (F9, pachet personal, conformitate, organigramă).
- Participanții în 4 locuri (H8, card, select per capitol, organigramă).

## 6. Verdicte calculate în UI vs server
- Client: `evalueazaPoarta` + 9 controale `ofertareControale.js` + reverificare grafic + filtrele matricei. Verdictul pe care îl vede omul **e calculat în browser**.
- Server (citit): `v_ofertare_pt_stare`, `v_ofertare_pt_cerinte_neconfirmate`, `v_ofertare_seap_completitudine`, `v_ofertare_cantitati_nevalidate`, `v_ofertare_pt_conformitate`, `v_ofertare_pt_echipa(_blocaje)`, `v_ofertare_dotari`; RPC `fn_ofertare_personal_disponibil`, `fn_ofertare_echipamente_disponibile`.
- `ofertare_r5_blocaj_sursa` nu e apelat din UI (doar în trigger-ul pachetului). J07 (`ofertare_poarta_server()`, HOLD) e exact mutarea verdictului pe server.

## 7. Mesaje care spun problema fără pasul următor (selecție, 18 în total)
| Mesaj | Loc | Ce lipsește |
|---|---|---|
| „…confirmă-le (✓) sau exceptează-le" | `ofertarePoarta.js:69` | ✓ din PT nu confirmă în registru; niciun link |
| „dovezi propuse … nebifate verificat pe scan" | `:42` | acțiunea e în alt modul |
| „documente necitite sau cu eroare" | `:145` | care documente, buton „citește" |
| „nicio afirmație încărcată" | `:121` | buton de încărcare |
| „nicio versiune generată în grafic_versiuni" / „deschide Graficul" | `:155-157` | link direct |
| „transfer din planșă în curs — reîncarcă" | `:243` | buton reîncarcă / auto-refresh |
| „⛔ N motiv(e) blochează F9-ul final" | `EchipaF9 :221` | motivele doar după expand; nicio acțiune per motiv |
| „fără rol" | `EchipaF9 :224` | nu există acțiune de atribuire rol |
| „⚠ DEPĂȘIT — un capitol s-a modificat" | `:2134` | care capitol |
| „Între timp s-a redeschis un rând roșu" | `:1939` | care rând |
| „niciun partener declarat" | `:647` | partenerii sunt 7 secțiuni mai jos |
| Starea „gol" pe capitole cu text (PT93) | date | niciun semnal de contradicție |

## 8. Intervenții umane AS-IS (rezumat; clasificarea de autonomie e în TO-BE)
Creare cuprins · atribuire cerință→capitol · excepție · verificare legătură (locator tastat) · blocare · dovadă (nr. document + locator) · confirmare în registru (alt ecran) · scriere/acceptare capitol · generare AI · lacăt · responsabil capitol · observații · import F9 · confirmare disponibilitate · legare externi · calificare cerută · excepție afirmație · garanție · declarații · anexe · participanți · semnare · aprobare pachet · înregistrare depunere.
Sursele automate care există deja și nu sunt folosite pentru pre-completare: `sursa_sectiune` pe cerințe, `ofertare_acoperire` (oameni/dovezi scan), `ghicesteMoment`/`RX_LUNI` (garanție), contoarele H5/H8 din view (anexe/participanți), tipurile de autorizare din acoperire.
