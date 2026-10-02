# Copilot — programul de noapte 29→30.09 (fără Răzvan), verdict integral

> Conversația 2, ~23:05. Răzvan: „nu aș alege eu, întreabă-l pe Copilot ce puteți face fără mine până dimineață”. Întrebarea: 9 candidați, de clasificat AUTO / DOAR PREGĂTIRE / AȘTEAPTĂ RĂZVAN / NU ACUM. Textul de mai jos e răspunsul lui Copilot, păstrat verbatim ca sursă. Verdictul e poartă, nu instrucțiune.

---

S‑A este singurul candidat eligibil pentru apply în această noapte, pe baza aprobării explicite a lui Răzvan pe care ai relatat-o. GO de principiu pentru această fereastră, nu încă GO pe implementare. Restul pot avansa fără el în limitele de mai jos. Q2‑B nu este o aprobare generală pentru orice schimbare non‑Ofertare, mai ales pe componente comune de identitate și autorizare.

## a) Clasificarea și ordinea
| # | Clasificare | Limita concretă |
|---|---|---|
| 1. S‑A | AUTO condiționat | Pregătire acum; merge/apply numai după GO pe SQL-ul exact, teste și procedura de revenire. Exclusiv corecția aprobată, separată de R1/R2/R3. |
| 2. Lista Jilava pentru dimineață | AUTO | Finalizarea raportului read-only și a listei nominale de acțiuni. Fără schimbarea cerințelor, tichetelor, responsabililor sau termenelor în BD. |
| 3. Planul v2 | DOAR PREGĂTIRE | Document pentru review, fără merge. Include și revalidarea probelor P2 după modificările ulterioare care le afectează. |
| 4. Testele J04×J07 | DOAR PREGĂTIRE | PG16 local, cu triggerele, RLS și funcțiile relevante. Niciun smoke cu scrieri pe 103 în această noapte. |
| 5. Automatizarea PT | DOAR PREGĂTIRE | B prima → A → C, cu limitele de mai jos. Fără merge, deploy, scrieri în producție sau rulări AI plătite. |
| 6. Conturi R1/R2/R3 | DOAR PREGĂTIRE | Corecții, teste și fișa automatizării. GO_CU_CONDIȚII al verificatorilor nu închide condițiile; fără integrarea pachetului în S‑A și fără apply. |
| 7. Context Registry | DOAR PREGĂTIRE | Migrare și teste locale. Fără tabele noi în live, fără actualizarea registrelor live și fără transformarea recomandărilor agenților în decizii ale ownerului. |
| 8. Advisors / RPC privilegiate | DOAR PREGĂTIRE | Inventar read-only, analiză de autorizare și probe locale. REVOKE, modificarea drepturilor și remedierea în live așteaptă aprobarea lui Răzvan. |
| 9. Pregătirea depunerii | DOAR PREGĂTIRE | Script read-only, testat local, și checklist. Nu instalați un job nou și nu programați automat operațiuni de depunere sau derogare. |

Prioritatea operațională: S‑A, cu partea din inventarul 8 necesară verificării excepțiilor privilegiate; în paralel, terminați W1 → 2 → 9 și corecțiile deja începute la 6. Pista PT poate începe independent cu 5B, fără să aștepte închiderea tuturor documentelor. Urmează 4 → 3, iar 7 este ultimul.

Nu trebuie început totul simultan: B este livrabilul principal de produs; A începe după ce B îndeplinește criteriile, iar C rămâne la specificație dacă acestea nu sunt încă demonstrate. S‑A și conturile trebuie să rămână în commituri/PR-uri distincte, fără editări concurente necontrolate pe același branch.

## b) S‑A: GO de principiu pentru apply noaptea, cu aceste condiții
Aprobarea relatată — „fix în seara asta, după GO-ul lui Copilot” — permite această corecție fără o nouă confirmare sincronă, numai în același domeniu aprobat: protejarea câmpurilor sensibile. Nu acoperă backfill-uri, corectarea profilelor existente, atribuirea de roluri, închiderea conturilor, revocarea sesiunilor sau alte RPC-uri.

**Punctul critic: cine primește excepția.** Owner/admin trebuie identificați dintr-o sursă protejată, independentă de câmpurile pe care utilizatorul le putea modifica. Un department='HR' existent nu dovedește, singur, autorizarea administrativă. Excepția service_role trebuie să corespundă unui apel privilegiat autentic. Un RPC sau un edge accesibil utilizatorilor obișnuiți nu trebuie să le permită să folosească indirect această excepție. În particular, identitatea efectivă a unei funcții SECURITY DEFINER nu trebuie confundată cu identitatea apelantului.

**Testele minime pentru GO**
| Zonă | Dovada cerută |
|---|---|
| Escaladarea directă | authenticated obișnuit nu poate modifica propriul department, propriul employee_id sau ambele simultan. Testați și un utilizator cu department='HR', dar fără rol administrativ independent. |
| NULL și atomicitate | Tranzițiile NULL→valoare, valoare→NULL și valoare→altă valoare sunt protejate; valorile neschimbate sunt permise. Comparația trebuie să fie null-safe, de exemplu prin IS DISTINCT FROM. O cerere refuzată care modifică și câmpuri nesensibile nu lasă modificări parțiale. |
| Identitatea privilegiată | Owner-ul, adminul legitim și backend-ul cu service_role trec pe traseele autorizate. Metadatele controlate de utilizator, identitatea absentă și rezultatele NULL ale verificării rolului nu deschid excepția. |
| Căile alternative | INSERT, upsert, inițializarea profilului și RPC/edge-urile care pot modifica aceste câmpuri nu permit același rezultat neautorizat. Un trigger doar pe UPDATE nu este suficient fără această demonstrație. |
| Cazurile legitime | Utilizatorul își poate edita câmpurile nesensibile; actualizările legitime care retransmit neschimbate câmpurile protejate funcționează. Testați traseul real de autorizare folosit de adminul din UI, nu doar o comandă executată ca superuser. |
| Integrarea | Testele folosesc roluri/claims reprezentative, politicile RLS și triggerele existente, inclusiv inițializarea profilului. Un mock care returnează mereu is_admin=true nu dovedește autorizarea. Verificați și absența regresiilor pe operațiunile legitime comune cu Ofertare. |

Pentru verdictul final cer diff-ul și revizia exacte, SQL-ul de apply, procedura de revenire, rezultatele testelor și definițiile live relevante obținute read-only. Fișa automatizării trebuie completată înainte de apply; introducerea ei în registrul live urmează aprobarea aplicabilă, nu devine o scriere implicit autorizată.

Apply-ul trebuie să fie atomic, fără alte migrări sau DML ascunse. După apply, verificați read-only definiția și activarea triggerului, funcția și permisiunile efective. Nu testați atacul pe profile reale, nici cu promisiunea unui rollback. Fără un fixture non‑Ofertare deja autorizat pentru asemenea scrieri, validarea dinamică rămâne locală, iar această limitare apare în raport.

Rollback-ul nu poate fi „DROP TRIGGER și revenim la escaladarea deschisă”. Cer o revenire care păstrează protecția sau o procedură de oprire și remediere sigură. Dacă această condiție ori identitatea privilegiată nu pot fi demonstrate, HOLD apply până la clarificare, fără a bloca restul pregătirilor.

Separat, faceți un inventar read-only al profilelor deja privilegiate și al provenienței modificărilor, unde există. Protecția nouă nu repară automat valori autoatribuite anterior; lipsa provenienței nu dovedește însă compromiterea. Nu corectați acele date fără preview și confirmare. Nici înscrierea publică nu se consideră oprită fără dovadă, iar oprirea ei nu înlocuiește protecția profilelor existente.

## c) PT: aleg B → A → C
B prima: prototipul „Necesită atenția ta”. Acesta permite verificarea fluxului de excepții și a reducerii intervențiilor umane fără să introducă încă un generator sau noi scrieri. Apoi implementați în A îmbunătățirile independente confirmate de prototip. C vine după stabilizarea acestui contract de interacțiune și verificare.

**B este „gata” pentru prezentarea de dimineață dacă:**
| Criteriu | Rezultat observabil |
|---|---|
| Flux utilizabil | Ecran local funcțional: excepție → cerință → dovadă/sursă → acțiunea umană necesară. Poate grupa munca, nu poate confirma satisfacerea cerințelor. |
| Stări oneste | AI candidate și human verified sunt distincte. Lipsă, eroare și stale nu devin verde sau listă goală. Proveniența și versiunile disponibile sunt afișate; cele indisponibile sunt marcate explicit. |
| Citire fără efecte ascunse | Fixture-uri locale deterministe sau citiri deja autorizate, limitate la 103. Fără autosave, inițializări care scriu, RPC mutante, joburi ori chei privilegiate în browser. Conectarea la 103 nu este obligatorie pentru demonstrarea UX-ului. |
| Dovadă de comportament | Teste pentru succes, eroare, date stale și răspunsuri asincrone suprapuse; capturi și traseu de cereri care susțin absența operațiunilor mutante. Comparație de clickuri/intervenții pe același scenariu, cu limitele măsurătorii. |

J07 nu este încă live: prototipul nu trebuie să prezinte un verdict simulat ca verdict server verificat. Orice răspuns simulat este etichetat ca atare.

Pentru A, nu dublați QW0/J07 și nu modificați pe ascuns semantica dovezii, schema sau autorizarea. Quick Wins cu asemenea dependențe rămân separate și pe HOLD.

Pentru C, în această noapte sunt potrivite contractele, scheletele deterministe și testele cu răspunsuri AI simulate. Structura unei propuneri depuse poate fi referință de organizare, nu sursă automată de fapte pentru alt dosar. Verificatorul de standarde trebuie să distingă identificarea unei referințe de confirmarea ediției și aplicabilității; fără dovezi, nu declară conformitate.

## d) Deciziile pentru Răzvan la 30.09, 08:00
- **Jilava:** repartizarea verificărilor umane și acțiunile pentru documentele lipsă; solicitarea explicită a mailului ELCAS și alternativa de dosar, dacă este necesară.
- **Securitate reziduală:** măsurile suplimentare rezultate din S‑A/#8 și eventualele corectări de profile, fiecare cu preview. S‑A aplicat corect se raportează ca rezultat, nu se cere retroactiv aprobarea.
- **Conturi:** D1–D6 cu semnificația completă a fiecărei opțiuni și dovada stării înscrierii publice; nu o confirmare generică a unor etichete.
- **P2:** providerul și drepturile/schema strict necesare sau acceptarea explicită a limitărilor fără el.
- **Autonomia PT viitoare:** setul concret de scrieri propus pentru autorizare și punctele de confirmare umană. Alegerea tehnică pentru această noapte rămâne B → A → C, nu i-o returnăm spre arbitraj.

**Excepție de incident:** faptul că un RPC SECURITY DEFINER este apelabil de anon nu dovedește singur bypass-ul. Dar o cale concretă de ștergere/modificare neautorizată sau indicii de exploatare justifică alertarea imediată a lui Răzvan prin canalul intern existent, nu așteptarea raportului de dimineață și nici autoaprobarea unor schimbări de drepturi.
