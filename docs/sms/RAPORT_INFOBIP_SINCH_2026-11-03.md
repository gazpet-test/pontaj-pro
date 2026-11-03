# Furnizor SMS pentru EXTERN (Redări): Infobip vs Sinch (vs SMSLink), 03.11.2026
Citite doar paginile publice infobip.com / sinch.com (inclusiv subdomeniile lor: cdn-web., support., status., developers., community., trust.), azi, fără cont, formulare sau oferte. SMSLink = din `docs/sms/RAPORT_SMSLINK_API_2026-11-03.md` [SL]. **întrebat** = nu e public, se cere la vânzări / în contract. Sursele [I*] / [S*] sunt la §6.

## 1. Tabel comparativ
| Criteriu | SMSLink [SL] | Infobip | Sinch |
|---|---|---|---|
| DPA art. 28 public | nu (se cere) | da, v2.0 din 01.09.2026, inclus prin trimitere în T&C self-service (§6.3), obligatoriu de la intrarea în vigoare a acordului [I1][I8] | da, v8 din 29.10.2025, parte din acordul principal [S1] |
| Rol | se declară „operator” | procesator; clientul poate fi și el procesator → Infobip = sub-procesator; SCC modulele 2+3 [I1][I2]. **Rezervă**: operator independent pentru „transmitere, rutare, conectivitate” *dacă fiecare parte stabilește singură scopurile*, plus operator pentru dezvoltare produs, analiză, anti-fraudă (§4.1.1) [I1]; T&C 15.6: folosește datele de trafic (sursă/destinație) și „pentru orice alte scopuri permise legal” [I8] | procesator; sub-procesator când clientul e procesator (§4.1), SCC modulul 3 [S1]. **Rezervă mai largă**: §3.1(iv) „Independent Data Controller Exclusion”: la transmiterea SMS prin rețelele telecom e operator independent *indiferent* de rolul clientului [S1] |
| Sub-procesatori | nenominalizați, subcontractare fără acord (art. 11.12) | listă publică scurtă (Microsoft IE, AWS, Google, afiliați Infobip; LLM-urile doar pentru AgentOS) + abonare la notificări [I3]. Preaviz 30 de zile calendaristice; 30 de zile pentru obiecție, tăcerea = acord; la obiecție: act adițional sau reziliere fără despăgubiri [I1 §5] | listă publică foarte lungă, multi-produs (pentru „Messaging”: AWS IE/DE/SE, Equinix US, GlobalConnect SE + entități Sinch din SUA, India, Singapore etc.) + abonare [S2]. Preaviz 30 de zile; obiecție în 10 zile lucrătoare → nu-l numesc până nu rezolvă; altfel reziliere pentru cauză [S1 §13] |
| Unde stau datele | RO / UE | **implicit în DC din UE/SEE**, în afara lor doar la instrucțiunea clientului [I1 §6.2]. Suportul „follow-the-sun” poate accesa de la distanță din afara UE, cu excepția opțiunii **EU region-locked** (la cerere: formular sau vânzări), unde acces doar din UE + țări adecvate (HR, UK; BiH doar excepțional, email/voce) [I3][I6] | **implicit cont în regiunea SUA**; EU (Irlanda, Suedia) doar prin account manager [S10]; personal de suport „și peste ocean” [S10] |
| Transferuri | n/a | SCC (DTA) în anexa 2 [I1]; entitatea self-service = **Infobip Ltd, UK** [I8 §1.2] | SCC 2021/914 incluse; autoritate IMY, legea Suediei [S1 §12, anexa 1]; self-service Europa = **Sinch Sweden AB** [S5] |
| Retenție | „cât e necesar” | implicit: conținut + loguri CPaaS 3 luni; scurtarea e gratuită, prelungirea costă; CDR / trafic pentru scopuri proprii 12 luni [I4]; la încetare: returnare / ștergere în 30 de zile [I1 §7.4] | politică fără cifre publice (anexa 2 pct. 16) → **întrebat**; ștergere în 90 de zile de la închiderea contului [S1 §11] |
| Notificare breșă | **întrebat** | „fără întârzieri nejustificate”, fără termen în ore [I1 §4.8] | la fel, fără termen în ore [S1 §8] |
| Audit | – | raport sau audit (Information security terms pct. 14) + oricând după o breșă confirmată [I1 §4.7] | doar dacă certificatul ISO / raportul terț nu ajung; preaviz 30 de zile, pe costul clientului [S1 §10] |
| Certificări | ISO 27001 (ASTINVEST) | ISO 27001, 27017, 27018, 22301, 9001, SOC 2 Type 2, CSA STAR L1 [I7] | ISO 27001:2022 [S1 anexa 2]; SOC 2 Type II pentru „Messaging API – SMS” [S7] |
| SLA | nu („așa cum sunt”) | **self-service: fără SLA**, „AS IS / AS AVAILABLE” [I8 §4.3]; documentul aplicabil contului self-service = T&C [I9]. SLA contractual nepublicat → **întrebat** | public: 99,95% „reasonable endeavours”, latență <10 s / <30 s pentru 90% din trafic, P1: răspuns în 30 min, ocolire în 2 h; **fără credite** în text [S3]; **doar cu contract de servicii, nu pentru self-service** [S4] |
| Pagină de status | – | status.infobip.com [I11] | status.sinch.com [S3] |
| RO: rețele | conectare directă la toate | „800+ conexiuni directe MNO”, global [I12]; pagina pe țară e dinamică, nu s-a putut citi [I16]; LOA-ul Telekom cere „Compatel” → intermediar local probabil → **întrebat** [I13] | nespecificat → **întrebat** |
| RO: sender ID | 270 EUR o dată, neportabil | LOA pe fiecare rețea (Telekom, Vodafone, Orange, Digi), **semnat de administratorul Gazpet, pe Gazpet**; taxă de setup (suma o dă account managerul); cererea din portal („Request Sender”) [I13]; aprobare tipică 1–3 zile lucrătoare (pagina generală, nu cea pentru RO) [I14]. Portabilitatea → **întrebat** | înregistrare self-service din Dashboard, RO e pe listă; „poate exista o taxă” [S8]; termen → **întrebat** |
| RO: preț / SMS | 0,049 → 0,040 EUR | calculator public PAYG (EUR / USD), media pe rețele; cifra pentru RO se încarcă din JS și nu a putut fi extrasă [I15] → se citește în pagină | la fel (calculator JS, cifra RO nu s-a încărcat) [S9] |
| Facturare | RON / e-Factura, firmă RO | prepaid; credit valabil 12 luni, fără rambursare; creditul nefolosit se pierde la încetare; moneda = cea a sediului lor (UK), dacă nu se specifică altfel; postpaid doar la decizia lor; prețurile se pot schimba imediat [I8 §8, §12.5] | prepaid în Dashboard, moneda aleasă la crearea contului; prețuri modificabile cu notificare pe mail; reziliere cu preaviz de 90 de zile [S5] |
| Entitate / birou în RO | da | nu (nu e în lista de birouri) [I12] | nu (nu e în lista de entități) [S2] |
| Lege / instanță | RO | T&C self-service: Anglia și Țara Galilor, Londra; răspundere plafonată la taxele plătite [I8 §11, §17] | după domiciliul clientului (tabel GTC); RO nu apare în fragmentul citit → **întrebat** [S6] |

## 2. API (pentru adaptor)
| | SMSLink | Infobip | Sinch |
|---|---|---|---|
| Trimitere | `POST …/json.php`, parola în corp | `POST https://{baseUrl}/sms/3/messages` [I17] | `POST https://eu.sms.api.sinch.com/xms/v1/{service_plan_id}/batches` (doar după activarea regiunii EU) [S10] |
| Autentificare | connection_id + parolă | cheie API `Authorization: App …`, cu **scope-uri** (`sms:message:send`, `sms:logs:read`) și expirare `validTo` [I20] | `Authorization: Bearer <token>` pentru fiecare service plan [S10] |
| DLR webhook | GET/POST, fără semnătură | POST JSON; **HMAC** (`X-Hub-Signature`, SHA-256 etc.), Basic, OAuth, mTLS prin Subscriptions (pentru URL-ul per mesaj: „notification profile” separat); listă publică de IP-uri; reîncercări de până la 20 de ori, ultima la 41,5 h [I18][I19] | POST JSON; reîncercare la 5xx/429 (5 s, apoi dublat, până la ~22 h 45 min), la alte 4xx nu se reîncearcă; Basic / OAuth / **HMAC / headere proprii doar prin account manager** [S11] |
| Polling | nu există | `/sms/3/reports` (fiecare raport o singură dată, ultimele 48 h); loguri 48 h, maximum 1.000 / apel, 120 de cereri / min [I18][I21][I23] | raport pe batch și pe destinatar [S15] |
| Idempotency | nedocumentat | **nu**: „un retry poate livra de două ori” [I21]; `messageId` propriu în cerere (îl activează suportul) [I17] | nedocumentat; `client_reference` intră în DLR [S12] |
| Diacritice | doar GSM-7 | Unicode automat la orice caracter non-GSM (70 / 67 de caractere); `transliteration` (lista conține CENTRAL_EUROPEAN; dacă acoperă ș/ț se verifică cu preview), NLI [I22] | „Auto Encoding” (transliterare) doar activat de account manager; `dry_run` arată părțile [S14]; `max_number_of_message_parts` [S12] |
| Limite de rată | 50 de conexiuni / IP | pe endpoint, HTTP 429 + backoff [I21] | mesaje/s pe service plan, coadă FIFO [S13] |
| Test | `test=1` | trial: trimite doar către destinatari verificați [I24] | `dry_run` [S14]; cont gratuit [S9] |
| Self-service | da | da (card, prepaid, T&C UK); SLA, region-lock, termene → vânzări [I6][I8][I9] | da (Dashboard); SLA, regiune EU, HMAC → contract / account manager [S4][S10][S11]. Volum minim: nepublic la ambele |

## 3. Recomandarea pentru SMS-ul EXTERN (Redări): **Infobip, pe contract enterprise (nu pe self-service)**
De ce Infobip și nu Sinch:
1. **Datele stau implicit în UE** (DPA §6.2), iar varianta EU region-locked restrânge și accesul suportului la UE + țări adecvate. La Sinch contul pornește în SUA, iar regiunea EU se cere separat.
2. **Lanțul de sub-împuterniciți e scurt și verificabil** (4 rânduri + afiliați). Lista Sinch e multi-produs și include entități din SUA / Asia pentru suportul „Messaging”. E mult mai greu de pus în autorizarea scrisă a Transgaz (art. 28(2)).
3. **Clauza de „operator independent”**: la Infobip e condiționată („dacă fiecare parte stabilește singură scopurile”). La Sinch e categorică pentru tot transportul SMS. Pentru Redări, unde Transgaz e operatorul, varianta Infobip se negociază mai ușor.
4. Certificări mai largi (27017 / 27018 / 22301 + SOC 2 T2), retenție cu cifre publice și scurtabilă gratuit.
5. API mai bun pentru noi: HMAC configurabil de noi, polling 48 h, `messageId` propriu (reconciliere după timeout).

Condiții de semnare (fără ele, nu pornim extern):
- EU region-locked;
- DPA semnat cu entitatea Infobip potrivită: preferabil din UE (Croația), nu Ltd UK; altfel confirmarea Juridic pe adecvarea UK;
- restrângerea §4.1.1 + T&C 15.5 / 15.6 („orice alte scopuri”) la facturare / anti-fraudă / obligații legale;
- retenția conținutului redusă (de exemplu 30 de zile);
- notificarea breșelor în ≤24–48 h;
- SLA scris;
- sender „GAZPET” pe LOA Gazpet, plus răspunsul despre portabilitate;
- confirmarea livrării directe în RO (Compatel?);
- preț RO + taxă de setup;
- factură în EUR către Gazpet.

TVA / e-Factura la furnizor străin: de verificat cu contabilitatea (taxare inversă).

**Sinch** rămâne rezervă, doar pe contract (SLA-ul public + regiunea EU + HMAC vin toate prin account manager). Plus la Sinch: dreptul de obiecție e mai tare (nu numesc sub-procesatorul până nu rezolvă) și entitatea self-service e din UE (Sinch Sweden AB).
**SMSLink** rămâne doar pentru intern (fără DPA public, fără SLA, subcontractare liberă).
Ambii CPaaS își păstrează un rol de operator independent pe o parte din date (trafic / anti-fraudă). E practică de industrie, dar trebuie spus Transgaz în cererea de autorizare și validat de Juridic.

## 4. Ce schimbă în adaptor (`_shared/smsFurnizor_infobip.ts`, față de SMSLink)
- `trimite`: `POST {INFOBIP_BASE_URL}/sms/3/messages`, `messages[0] = { sender, destinations:[{ to: "40…", messageId: <sms_mesaje.id> }], content:{ text }, webhooks:{ delivery:{ url }, callbackData: ref } }`. Răspunsul e HTTP + JSON, cu `messageId` text (nu numeric): `furnizor_id` devine coloană `text` pentru toți furnizorii.
- Clasificarea erorilor după statusul HTTP, nu după `response_type`:
  - 401 / 403 → `config` (oprește coada);
  - 429 → backoff;
  - 5xx / timeout → `necunoscut`, fără retrimitere (nu există idempotency);
  - per mesaj, grupul `REJECTED` → `permanent`.
- `status(id)`: devine **suportat** (loguri / rapoarte 48 h). După un timeout, întâi reconciliem după `messageId`-ul nostru, abia apoi `fara_raport`. Jobul de 48 h rămâne.
- `verificaDlr`: HMAC peste corpul brut (`X-Hub-Signature`, comparat în timp constant), plus secret în URL ca al doilea factor; opțional, filtrare pe lista de IP-uri Infobip. `parseazaDlr` întoarce un **array** (`results[]`), cu dedup: reîncercările pot veni până la 41,5 h. Starea finală: livrat / eșuat / expirat / respins. Prețul din DLR poate completa `cost`.
- Textul: transliterarea GSM-7 rămâne la noi (Infobip nu are „max părți”: plafonul de segmente îl verificăm noi). La 1 caracter scăpat, Infobip trece singur pe Unicode → dublează costul.
- Test: fără `test=1` → `smsFurnizor_simulator.ts` rămâne pentru CI; staging = cont trial cu 3–5 numere interne verificate.
- Secrete (doar nume): `SMS_FURNIZOR=infobip`, `INFOBIP_BASE_URL`, `INFOBIP_API_KEY` (scope send + logs:read, `validTo` ≤12 luni, rotire), `INFOBIP_DLR_HMAC_SECRET`, `SMS_DLR_SECRET`, `INFOBIP_SENDER`.
- Rezerva Sinch, ca diferențe:
  - `batches` cu `delivery_report: per_recipient_final`, `callback_url`, `client_reference` = id-ul nostru și `max_number_of_message_parts: 1`;
  - `dry_run` pentru segmente;
  - DLR-ul întoarce 200 imediat, altfel la 4xx nu se mai reîncearcă;
  - semnătura callback-urilor e disponibilă doar după configurarea de către account manager.

## 5. De întrebat la vânzări Infobip (pe mail, fără date interne)
1. Entitatea contractantă din UE?
2. Region-lock pentru SMS: cost?
3. Text DPA negociabil (§4.1.1, T&C 15.5 / 15.6)?
4. Termenul de notificare a breșelor?
5. SLA: procent, credite?
6. Livrare directă pe cele 4 rețele din RO sau prin Compatel?
7. Sender: taxă, termen, al cui rămâne la plecare?
8. Preț RO, moneda facturii, plată prin OP?
9. Volum minim / abonament?
10. Retenție de 30 de zile pentru conținut?
11. Activarea `messageId` propriu?
12. Sender implicit până la înregistrare?

## 6. URL-uri citite (03.11.2026)
Infobip:
(„…” = https://www.infobip.com; „(f)” = doar fragmentul din căutare)
- [I1] …/data-processing-agreement · [I2] https://cdn-web.infobip.com/uploads/2023/02/IB_UK_DPA-and-DTA-online_selfservice_2022.pdf · [I3] …/policies/processors · [I4] …/policies/data-retention-notice
- [I5] …/privacy-documents · [I6] …/news/infobip-to-deploy-region-locked-eu-data-centre · [I7] …/certificates · [I8] …/policies/service-terms-conditions (v2.1, 29.09.2026) · [I9] https://support.infobip.com/how-can-i-get-a-contract-agreement-sla
- [I11] https://status.infobip.com/ (f) + …/docs/developer-resources/service-health-and-troubleshooting/platform-status-and-incidents (f) · [I12] …/offices · [I13] …/docs/essentials/europe-registration/romania-letter-of-authorization-loa-guidelines
- [I14] …/docs/resources-and-numbers/get-started-with-resources-and-numbers (f) · [I15] …/sms/pricing · [I16] …/docs/sms/sms-coverage-and-connectivity · [I17] …/docs/api/channels/sms/outbound-sms/send-message/send-sms-messages (f)
- [I18] …/docs/sms/message-delivery · [I19] …/docs/developer-resources/api-fundamentals/webhooks, …/docs/subscriptions/manage/authentication-settings, …/docs/developer-resources/security/security-best-practices (f)
- [I20] …/docs/developer-resources/authentication-and-access/authorization-and-scopes · [I21] …/docs/developer-resources/api-fundamentals/rate-limits-and-throttling · [I22] …/docs/sms/sms-multilingual
- [I23] …/docs/api/channels/sms/logs-and-status-reports/get-outbound-sms-message-logs-v3 + …/get-outbound-sms-message-delivery-reports-v3 (f) · [I24] …/docs/get-started/build-and-go-live/free-trial (f)

Sinch („L” = https://sinch.com/legal/terms-and-conditions/other-sinch-terms-conditions; „D” = https://developers.sinch.com/docs/sms):
- [S1] L/data-processing-agreement/ · [S2] https://sinch.com/legal/data-protection-agreement-sub-processors/ · [S3] L/messaging-service-level-agreement-sla/ · [S4] https://community.sinch.com/t5/General-Support/Sinch-SLAs/td-p/9141
- [S5] L/terms-of-service/ · [S6] L/general-terms-and-conditions/ (f) · [S7] https://trust.sinch.com/ (f) · [S8] https://community.sinch.com/t5/SMS/Alpha-Numeric-Sender-ID-Registration-Supported-Countries/ta-p/11743 · [S9] https://sinch.com/pricing/sms/
- [S10] D/api-reference/ · [S11] D/api-reference/sms/webhooks · [S12] D/api-reference/sms/batches/sendsms · [S13] D/resources/message-info/rate-limits · [S14] D/resources/message-info/auto-encoding · [S15] D/api-reference/sms/delivery-reports (rezumat)

Deschise, dar nefolosite: sinch.com/legal/privacy-notice (fragment), infobip.com/glossary, infobip.com/platforms (fragment de marketing: „99.9% uptime”, nu e contract).
