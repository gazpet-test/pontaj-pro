# Jilava / PT93 — ciorne: motivul derogării J05 + nota de depunere H1/H4/H5

> **CIORNE — DOAR PREGĂTIRE** (GO Copilot 29.09 ~23:45). Nimic din acest fișier nu e scris în BD și nu e GO de depunere.
> - Motivul J05 îl aprobă Răzvan. Tot el îl pune, prin RPC-ul `ofertare_derogare_depunere`, cu contul lui, nu din MCP sau SQL editor, unde actorul ar rămâne NULL.
> - Câmpurile `⟨…⟩` se completează în ziua depunerii.
> - Cifrele sunt citite read-only pe 29.09, 19:00–23:50 UTC; se re-rulează pe 02.10 cu `JILAVA_PT93_RERULARE_0210.sql`.

## 1. Ciorna motivului J05 (textul care intră în `derogare_motiv`)

```
DEROGARE OWNER — licitația 93 (SCN1179907, Jilava / protejare conductă Transgaz).
Depunere manuală în SEAP; pachetul PT NU e generat și nici depus în ERP.

Invarianți ocoliți conștient (starea din ERP la ⟨data/ora⟩):
1. J02 — status 'depusa' cere pachet PT depus: 0 pachete în ERP. Pachetul a fost asamblat și verificat MANUAL, în afara ERP (opis, formă, semnătură, „DE COMPLETAT” = 0).
2. J02 / R06 — ⟨158⟩ cerințe fără acoperire verificată pe scan. În plus, ⟨218⟩ cerințe (dintre care ⟨27⟩ eliminatorii) sunt închise „nu se aplică” DOAR de AI, fără actor uman; poarta J02 le socotește acoperite (INCIDENT Audit V2 din 29.09). Verificate de om înainte de depunere: ⟨lista / nr.⟩; neverificate: ⟨nr.⟩, risc asumat.
3. R07 — ⟨8⟩ dovezi „roșii”:
   - certificatul ANAF, expirat din 18.09;
   - certificatul ONRC, valabil până pe 02.10;
   - etalonarea ISOTEST, care expiră pe 12.10;
   - cazierul firmei, valabil mai puțin de 90 de zile după termen.
   Se reemit pentru locul I; ANAF/ONRC: ⟨reemise la data⟩ / ⟨nereemise⟩.
4. Verificarea umană a PT (poarta UI, care nu rulează pe traseul J05):
   - ⟨276⟩ din ⟨280⟩ cerințe PT neverificate la versiunea curentă;
   - ⟨22⟩ capitole obligatorii nesalvate de om;
   - ⟨36⟩ excepții din scopul PT puse doar de AI.
   Stare la depunere: ⟨…⟩.
5. H2 / R5 — 0 rânduri de cantități în ERP. R5 = NULL înseamnă „nimic de verificat”, NU F3 validat. F3 (cap. 5) a fost verificat manual: ⟨da / nu; cele 4 poziții Dv.5 adăugate: da / nu⟩.
6. H10 — graficul nu provine dintr-o versiune înghețată. 5882 (zile lucrătoare, pe articol de deviz): ⟨varianta A făcută / varianta B, risc asumat⟩.
7. Dosar, stare la depunere (nu sunt rezolvate prin această derogare):
   - subcontractare ELCAS: F4 / DUAE / centralizator ⟨…⟩;
   - rolul ATSD ⟨…⟩;
   - garanția de participare, 10.037,58 lei ⟨constituită / dovadă în SEAP⟩;
   - cap. 6: marcaje ⟨0⟩ și legături blocate ⟨…⟩;
   - Anexa ⟨A / B⟩;
   - PV-uri experiență + cazier administrator ⟨…⟩;
   - RTE, autorizația 435 ⟨…⟩;
   - ELCAS 6208 ⟨…⟩.

Termen: oficial SEAP ⟨06.10.2026 15:00 / altul⟩; intern 02.10.2026 12:00.
Clarificările 1300 / 1301 citite de ⟨…⟩ la ⟨…⟩.

Confirmarea SEAP: nr. ⟨…⟩, ora ⟨…⟩.
SHA-256, calculat după semnare/arhivare, pentru fiecare fișier depus:
⟨fișier⟩  ⟨sha256⟩
…
Identitatea end-to-end (bytes depuși = fișierele hash-uite): ⟨dovedită prin recuperare din SEAP / NOT PROVEN⟩.

Acceptarea riscurilor de mai sus: Răzvan Trușu, ⟨data/ora⟩, ÎNAINTE de depunerea externă.
```

**Reguli (din raport §4.E și verdictele Copilot):**
- Ordinea: întâi R5 = NULL (Q13), apoi derogarea (RPC, contul tău), apoi „depusa” din UI, apoi Q61. Q61 trebuie să arate același motiv în `derogare_acordata` și în `depusa_pe_derogare`.
- După acordare, `derogare_motiv` nu se mai atinge.
- **Finding J05 de integritate, OPEN (mediu, nu e bypass de poartă; investigat read-only pe 30.09):**
  - Cei 9 cu modulul Ofertare pot modifica `derogare_motiv` sau retrage derogarea (`derogare_depunere=false`) direct prin API. Nu rămâne niciun rând de audit, iar `updated_at` nu se schimbă.
  - Rândul `depusa_pe_derogare` copiază **coloana editabilă**, nu motivul acordat.
  - Vechea verificare Q61 compara doar primele 300 de caractere și lungimea, deci nu putea dovedi „același motiv”.
  - UI-ul și exportul nu afișează deloc derogarea.
- **Procedura pentru Jilava** (fără nicio schimbare de cod, freeze):
  - (a) Q01 confirmă `derogare_motiv IS NULL`. Acordarea se face **doar prin RPC**, cu contul lui Răzvan.
  - (b) „depusa” o pune Răzvan **imediat** după RPC.
  - (c) **Q61b**, adăugat în SQL-ul de re-rulare: md5 pe motivul întreg. Coloana = `derogare_acordata` = `depusa_pe_derogare`, 0 retrageri.
  - (d) md5-ul textului aprobat se notează **offline**, înainte de apel.
  - (e) `xmin`-ul rândului 93 se notează după depunere și se reverifică până la fix.
- Fix-ul după 02.10: trigger ca singur scriitor, doar owner-ul, cu audit la orice schimbare. `depusa_pe_derogare` va copia din ultimul `derogare_acordata`. Până la fix, „derogări auditabile persistent” **nu** se trece CONFIRMED.
- Derogarea nu transformă cerințele neverificate în verificate și nu rezolvă lipsurile eliminatorii. Jilava rămâne dovadă **parțială**: dovedește depunerea și folosirea derogării, nu fluxul normal (Copilot, review plan A §4).

## 2. Nota de depunere — posibile alarme false H1 / H4 / H5 (DE VALIDAT de om)

> Status: **posibile alarme false, de validat**. Nu se trec ca rezolvate până nu există dovada pentru fiecare.

| Control | Ce a semnalat | De ce pare alarmă falsă | Dovada de adus (om) |
|---|---|---|---|
| **H1** (nume străine) | COMUNEI, Depozit, EPURARE, Gara, LOCAL | Cuvinte generice („Gara” = „Garanția” trunchiat); o căutare mai largă a găsit 0 localități din alte licitații | Căutare în DOCX-ul final după numele din alte licitații active (Răcari, Mânăstirea, Domnești, Huedin…) = 0; bifa H1 cu actor (decizia B: WARN + confirmare auditabilă) |
| **H4** (garanția lucrărilor) | „36 luni” de 2 ori; momentul de start lipsă în ERP | 1.j v2 și cap. 8 v4 spun „72 luni de la semnarea fără obiecțiuni a PV de recepție la terminarea lucrărilor”, ca în 5969. Regexul nu vede cap. 8 („72 (șaptezeci și două)” rupe potrivirea) | Citit 1.j și cap. 8 în DOCX-ul final; lămurit contextul celor două „36 luni”; completat opțional momentul în ERP (Răzvan) |
| **H5** (trimiteri la piese) | „Anexa 1”, „cap. 100” | Vin din „HG 856/2002 anexa 1” și din „suduri cap la cap 100%” | Citite pasajele în DOCX-ul final; confirmat că nu trimit la piese din cuprinsul ofertei |

## 3. Ce NU acoperă aceste ciorne
- Nu sunt GO de depunere.
- Nu închid incidentul „nu se aplică” AI (`INCIDENT_V2_NSA_AI_2026-09-29.md`).
- Nu decid termenul (§0–1 din `LISTA_0800_2026-09-30.md`).
