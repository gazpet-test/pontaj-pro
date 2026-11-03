# SMSLink: integrarea prin API (din documentația publică), 03.11.2026
Sursa: doar paginile publice smslink.ro, citite azi (lista [S1]–[S24] e la §8). Nu m-am logat, nu am apelat API-ul, nu am văzut credențiale. Ce nu apare public e marcat **suport** (de întrebat la SMSLink).

## 1. API-ul recomandat: SMS Gateway JSON, prin HTTPS POST
- Trimitere: `POST https://secure.smslink.ro/sms/gateway/communicate/json.php`, cu header `Content-Type: application/json`, corp JSON raw, TLS 1.2/1.3 [S2]. Varianta `http://www.smslink.ro/...` NU se folosește.
- Sold: `POST .../json.php?mode=Credit`, cu aceleași două câmpuri de autentificare. Întoarce `credit` (numărul de SMS-uri disponibile) și `timestamp` [S3][S4].
- De ce JSON:
  - parola stă în corpul cererii, nu în URL (la HTTP GET ar ajunge în loguri);
  - răspunsul e structurat;
  - are tot ce ne trebuie: concatenare, programare, `test`, DLR, sender [S13];
  - merge cu `fetch` din Deno, fără librării.
- Ce am respins:
  - HTTP GET/POST: parola stă în query (criptarea RSA în plus nu ne trebuie, avem TLS);
  - SOAP: greoi;
  - BULK v1/v3: făcut pentru volume mari, v1 nu are concatenare; loturile noastre (≤3k) merg pe JSON;
  - SMPP: cere conexiune persistentă, imposibilă în edge (IPsec doar la cerere) [S1][S13][S14].
- Autentificare: `connection_id` (generat de SMSLink) + `password` (aleasă de noi, minimum 6 caractere, contează literele mari/mici), pentru fiecare „conexiune”. Nu există token sau OAuth.
  - Opțional: listă de IP-uri IPv4 permise (fără CIDR sau hostname).
  - Opțional: conexiunea se dezactivează singură după N autentificări eșuate și primești mail [S10].
- Un cont poate avea mai multe conexiuni → facem `ERP-PROD` și `ERP-TEST`, cu secrete separate și rotire separată [S10][S23].
- Limită: maximum 50 de conexiuni simultane per IP; cele peste limită sunt refuzate (se poate mări la cerere). Capacitatea declarată e de „câteva mii de SMS pe minut” [S2][S16].
- **Nu există un endpoint public de stare după `message_id` (polling)**: singura sursă automată de stare e DLR-ul prin webhook [S3][S7][S8].

## 2. Contractul pentru adaptor
**Cererea JSON** [S3]:
- `connection_id`, `password`: obligatorii.
- `to`: obligatoriu. Formatul recomandat e `07xyzzzzzz`; acceptă și `00407…`, `+407…`, `7xy…`. Elimină singur spațiul și `- / . : ; ( )` [S12].
- `message`: obligatoriu, minimum 1 caracter.
  - Peste 160 de caractere → eroarea 12, dacă în cont concatenarea e oprită.
  - Maximum 3.200 de caractere (20 de SMS-uri).
- `sender`: opțional.
  - Fără el → `"numeric"`, adică număr scurt 17xy/18xy, nededicat.
  - O etichetă proprie merge doar după activare, altfel eroarea 13.
- `timestamp`: opțional, UNIX. `0` = trimite imediat; altfel minimum 1 minut în viitor, altfel eroarea 15.
- `test`: opțional, `0`/`1`. Cu `1`, API-ul întoarce un răspuns simulat și SMS-ul nu pleacă; cu `0`, SMS-ul pleacă și creditul scade.

**Răspunsul** [S4][S6]: `{"response_type":"MESSAGE"|"ERROR","response_id":"…","response_message":"…"}`, plus `message_id`, `receiver`, `sender` la trimitere.
- `response_id` se suprapune: 1 înseamnă și „trimis”, și „argumente insuficiente” → **decidem doar după `response_type`**.
- `message_id` e numeric, de ordinul sutelor de milioane / miliardelor → la noi `bigint` [S8].
- Codurile de status HTTP nu sunt documentate → **suport**.

**Erorile** (`response_id` la `ERROR`, [S5]) și ce face coada:
- **respins, fără reîncercare**: 1 (argumente insuficiente), 9 (numărul nu are 10 cifre), 10 (nu e mobil), 11 (mesaj gol), 12 (peste 160 cu concatenarea oprită), 13 (sender neactivat), 14 (mode greșit), 15 (programare prea aproape), 17 (peste 3.200).
- **configurare: oprește coada (kill-switch automat) + alertă owner**: 2 (connection_id), 3 (cont suspendat), 4 (serviciu dezactivat), 5 (IP nepermis), 6 (IP blocat după autentificări eșuate), 7 (parolă).
- **8 (credit insuficient)**: oprește coada + alertă.
- **16 (eroare la trimitere)**: reîncercare cu backoff, maximum 3.
- **Timeout după ce cererea a plecat** → stare `necunoscut`, fără retrimitere automată: idempotency nu e documentat, deci am plăti o dublură.
- ⚠️ **Eroarea 7 întoarce parola în clar** în `response_message` („Password '[PASSWORD]' is not approved!”). Nu salvăm niciodată textul brut; în `sms_mesaje.eroare` intră doar `smslink_<cod>`.

**DLR, prin webhook** [S8][S9][S10]:
- SMSLink apelează URL-ul setat pe conexiune, prin GET (implicit) sau POST (se alege din Setări avansate). Merge HTTP sau HTTPS, asincron (secunde–minute), cu timeout de conectare de 15 s.
- Parametri trimiși mereu: `message_id`, `status` (1 = livrat, 0 = nelivrat: expirat sau eroare finală), `timestamp`.
- Parametri opționali, care se activează pe conexiune:
  - `network_id`: 1 Vodafone, 2 Orange, 3 Telekom, 4 Zapp, 5 Digi, 6 Lyca, 100 internațional;
  - `network_type`;
  - `delivery_report` (raportul brut de la operator);
  - `connection_id`;
  - `message_count` (numărul de segmente).
- Formatul corpului la POST nu e precizat → parsăm form-urlencoded, cu query ca rezervă. Răspunsul pe care îl așteaptă nu e precizat → întoarcem `200 OK` imediat.
- **Documentația nu spune nimic despre semnătură / HMAC, token, IP-uri sursă sau reîncercări** → **suport**. Până atunci îl securizăm noi:
  1. secret lung în URL (`?k=<SMS_DLR_SECRET>`), comparat în timp constant. `sms-dlr` are `verify_jwt=false` (SMSLink nu poate trimite JWT), deci poarta e în cod;
  2. activăm parametrii opționali și cerem ca `connection_id` să fie al nostru (al doilea factor);
  3. `message_id` trebuie să existe în `sms_mesaje` în starea `trimis`. Tranzițiile sunt doar monotone (`trimis→livrat|esuat`); un duplicat nu schimbă nimic. Un id necunoscut ajunge doar în jurnal;
  4. metoda POST, ca parametrii să nu ajungă în URL. Payload-ul brut merge în `sms_dlr_jurnal`;
  5. **DLR-ul nu declanșează niciodată o trimitere**;
  6. rotire: secret nou în Supabase și URL nou în cont, în aceeași fereastră. Dacă SMSLink ne dă IP-urile sursă, le filtrăm și pe ele;
  7. fără DLR în 48 de ore → un job trece mesajul în `fara_raport` (nu avem polling).

**Pseudo-cod pentru `_shared/smsFurnizor_smslink.ts`** (secretele vin din Edge Secrets, niciodată din cod):
```ts
const API = "https://secure.smslink.ro/sms/gateway/communicate/json.php";
const PERMANENT = new Set([1, 9, 10, 11, 12, 13, 14, 15, 17]);
const CONFIG = new Set([2, 3, 4, 5, 6, 7]);               // oprește coada + alertă owner
export async function trimite({ to, text, ref }: CerereSms): Promise<RezultatSms> {
  const msg = normalizeazaGsm7(text);       // ș/ş→s ț/ţ→t ă/â→a î→i; scoate " ` CR LF; refuză ce nu e GSM-7
  const segmente = msg.length <= 160 ? 1 : Math.ceil(msg.length / 152);  // lungime GSM (extinse = 2)
  if (segmente > MAX_SEGMENTE) return { ok: false, clasa: "permanent", eroare: "prea_lung", segmente };
  const body: Record<string, unknown> = {
    connection_id: Deno.env.get("SMSLINK_CONNECTION_ID"),
    password: Deno.env.get("SMSLINK_PASSWORD"),
    to: e164LaNational(to),                 // +407xxxxxxxx -> 07xxxxxxxx; refuză ce nu e mobil RO
    message: msg,
    test: Deno.env.get("SMSLINK_TEST") === "1" ? 1 : 0,   // forțat 1 în afara producției
  };
  const sender = Deno.env.get("SMSLINK_SENDER"); if (sender) body.sender = sender; // gol = număr scurt
  let r: Response;
  try {
    r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  } catch { return { ok: false, clasa: "necunoscut", eroare: "retea_timeout", segmente }; } // NU retrimite
  const j = await r.json().catch(() => null);
  if (!j) return { ok: false, clasa: "necunoscut", eroare: `http_${r.status}`, segmente };
  if (j.response_type === "MESSAGE" && j.message_id) return { ok: true, furnizor_id: String(j.message_id), segmente };
  const cod = Number(j.response_id);        // response_message NU se salvează (codul 7 conține parola)
  return { ok: false, segmente, eroare: `smslink_${cod}`, clasa: PERMANENT.has(cod) ? "permanent"
    : CONFIG.has(cod) ? "config" : cod === 8 ? "credit" : "tranzitoriu" };
}
export async function status(_id: string) { return { suportat: false as const }; }   // fără polling public
export function verificaDlr(req: Request, p: URLSearchParams): boolean {
  const k = new URL(req.url).searchParams.get("k") ?? "";
  return req.method === "POST" && egalTimpConstant(k, Deno.env.get("SMS_DLR_SECRET") ?? "\0")
    && p.get("connection_id") === Deno.env.get("SMSLINK_CONNECTION_ID")
    && /^\d{1,20}$/.test(p.get("message_id") ?? "") && /^[01]$/.test(p.get("status") ?? "");
}
export function parseazaDlr(p: URLSearchParams) {
  return { furnizor_id: p.get("message_id")!, stare: p.get("status") === "1" ? "livrat" : "esuat",
    la: new Date(Number(p.get("timestamp")) * 1000), segmente: Number(p.get("message_count")) || null,
    retea: p.get("network_id"), raport_operator: p.get("delivery_report") };
}
```
Secrete (doar nume): `SMS_FURNIZOR=smslink`, `SMSLINK_CONNECTION_ID`, `SMSLINK_PASSWORD`, `SMS_DLR_SECRET`, `SMSLINK_SENDER` (gol până la activare), `SMSLINK_TEST`.

## 3. Sender ID, caractere, costuri
**Sender ID**:
- Maximum 11 caractere alfanumerice.
- Se cere din formularul „activare sender personalizat” din cont sau prin contact. Îl aprobă SMSLink și fiecare operator.
- Costă **270 EUR + TVA o singură dată** pentru toate rețelele (Vodafone 50, Orange 100, Telekom 50, Digi 70); se poate activa și doar pe unele rețele. Dacă e refuzat, banii se restituie. Nici activat nu e garantat că se afișează (terminal vechi, roaming) [S3][S15][S16][S18].
- **Nu e portabil.** Termenii spun că senderul e „dependent de Serviciile Furnizorului … nu poate fi utilizat independent” [S18]. La o mutare plătim activarea din nou la noul furnizor: e un cost, nu un blocaj.
- Nu e public dacă e înregistrat pe Gazpet (LOA), în cât timp se activează și dacă are cost recurent → **suport**.
- Până la activare trimitem fără `sender`: număr scurt 17xy/18xy, gratuit, conform planului de numerotație ANCOM [S16].

**Caractere** [S11]:
- API-ul acceptă **doar GSM 7-bit**; Unicode / UCS-2 nu e documentat.
- 160 de caractere pe SMS; un SMS concatenat se taxează la fiecare 152 de caractere. Recomandarea lor: maximum 4 segmente (608 caractere).
- Pe HTTP / JSON / BULK, caracterele `[ ] { } | ~ ^ " \`` și **CR, LF ocupă câte 2** (deci și ghilimelele, și rândul nou).
- ș ț ă î â nu există în GSM-7. Ce face API-ul cu ele nu e public → **suport**. La importul din campanii le transformă singur în litere fără diacritice [S22], iar ghidul lor pentru Gomag spune „nu utilizați diacritice”.
- **Recomandare**: transliterăm noi în adaptor, scoatem ghilimelele și rândurile noi, validăm GSM-7 și numărăm segmentele înainte de trimitere. MVP: maximum 160 de caractere.

**Costuri** [S15][S16][S18]:
- Tarif după volumul lunar, fără TVA: 0,049 EUR/SMS (1–1.000) · 0,048 (≤5k) · 0,047 (≤10k) · 0,045 (≤20k) · 0,043 (≤30k) · 0,040 (peste 30k). Același preț în toate rețelele din RO.
- Fără abonament; pachetul minim e de 100 SMS.
- **Creditul expiră la 1 an de la factură** și nu se restituie. Cele 1.000 cumpărate azi ≈ 49 EUR + TVA, valabile până la ~03.11.2027.
- Creditul gratuit de test se retrage după 30 de zile.
- Facturare: prepaid (OP, card, numerar). Factura se generează singură, se descarcă din cont și merge în **RO e-Factura** din 01.01.2024. Firma: ASTINVEST COM SRL (Baia Mare), activă din 2008. Moneda facturii nu e precizată (prețurile sunt în EUR) → **suport**.

## 4. Limite și mod test
- Limite: 50 de conexiuni simultane per IP; nu e publicată o limită pe secundă. Noi trimitem cu concurență 3–5, suficient [S2].
- Programare: furnizorul are `timestamp` (minimum +1 minut), dar documentația nu spune cum se anulează prin API. **Programăm noi (cron)**, ca kill-switch-ul să poată opri orice mesaj înainte să plece [S3][S5].
- Ore de trimitere, STOP, liste negre pentru Gateway: nu sunt precizate. Live Update API are o „listă de destinatari blocați”, gândită pentru campanii [S21]. Sursa de adevăr rămâne la noi: `sms_optout` + fereastra 08–20 pentru extern.
- Mod test: `test=1` simulează răspunsul și nu trimite SMS-ul. Nu există un sandbox separat. Dacă vine DLR și pentru mesajele de test: **suport**. În afara producției, `SMSLINK_TEST=1` + conexiunea `ERP-TEST`.
- Sold: `mode=Credit` → cron zilnic + alertă sub un prag (de exemplu 150 de SMS-uri).

## 5. GDPR / DPA / securitate
- Ce scriu public:
  - datele stau pe servere din România, backup-ul în RO și/sau UE/SEE [S17];
  - datacentere Tier 3 în București, certificate ISO 27001;
  - ASTINVEST e certificată SR ISO/CEI 27001:2018;
  - notificare ANSPDCP nr. 10403/03.12.2008;
  - DPO: dpo@smslink.ro;
  - autentificare în 2 pași, opțională [S16].
- **DPA art. 28: nu e public.** Politica lor spune „în calitate de operator pentru serviciile de transmitere automată de SMS” [S17]. Pentru datele destinatarilor noștri trebuie să fie **împuternicit** → DPA semnat obligatoriu. Un contract fizic se poate cere [S16].
- Sub-împuterniciți: operatorii telecom și datacenterele; în afara UE doar la SMS internațional / roaming [S17].
  - Termenii, art. 11.12, permit subcontractarea **fără acord și fără nominalizare**, ceea ce contrazice art. 28(2) GDPR.
  - DPA-ul trebuie să înlocuiască clauza: listă de sub-împuterniciți + preaviz. Contează pentru Redări / Transgaz.
- Retenție: „perioada necesară … plus obligațiile legale”, detalii la dpo@ → cerem cifre (textul SMS-urilor, numerele, DLR-urile) [S17].
- **Fără SLA** [S18]:
  - nu garantează „un nivel minim de disponibilitate”, iar art. 3.13 spune „așa cum sunt”;
  - termenii se pot schimba fără notificare (11.2);
  - reclamațiile se fac în 7 zile, problemele tehnice se anunță în 24 de ore;
  - la închiderea contului pot șterge tot, fără să dea copie (7.7) → arhiva e jurnalul nostru, `sms_mesaje`.
- Interzis: date confidențiale sau privilegiate în SMS-uri sau în cont. Utilizatorul răspunde singur de liste și de reclamații [S18].
- Rămâne valabilă condiția din RAPORT_SMS: dacă nu primim DPA → rezerva B (Infobip).

## 6. Răspunsuri la RAPORT_SMS §7
1. **Conexiuni directe**: da, „conectivitate directă” cu Vodafone, Orange, Telekom Mobile, Orange Communications, Digi, Lycamobile; portabilitatea se actualizează de 2 ori pe zi [S19][S20]. Rata de livrare → **suport**.
2. **Sender**: 270 EUR + TVA o singură dată, aprobat de operatori, banii se restituie la refuz, **nu e portabil** [S15][S18]. LOA pe Gazpet, termen, cost recurent, registru ANCOM → **suport**.
3. **API**:
   - HTTPS / JSON: da [S2];
   - chei per mediu: da, prin conexiuni multiple [S10];
   - rotire fără întrerupere, idempotency → **suport**;
   - limită: 50 de conexiuni simultane [S2];
   - sandbox: doar `test=1` + credit gratuit de test [S3][S18].
4. **DLR**: GET / POST, status 0/1, raport brut opțional, timeout 15 s [S8]. HMAC / IP fix / reîncercări → **suport** (până atunci, §2).
5. **Preț**: 0,049→0,040 EUR + TVA, același în toate rețelele; un SMS concatenat se taxează la fiecare 152 de caractere; fără abonament; creditul expiră în 1 an [S15][S16]. Unicode → **suport**. Preaviz la schimbarea prețului: nu, termenii se schimbă fără notificare [S18].
6. **Factură**: entitate română, e-Factura, OP, prepaid [S16]. Moneda (RON?) → **suport**.
7. **DPA**: nu e public; servere în RO / UE; ISO 27001; sub-împuterniciți nenominalizați; retenție „cât e necesar” [S16][S17][S18]. DPA, listă, retenție, breșe → **suport / dpo@**.
8. **SLA**: nu are (explicit) [S18]. Suport 24/7/365 la telefon și pe mail, în română [S16].
9. **Numere de răspuns (2-way)**: numerele scurte sunt alocate de furnizor și le poate schimba fără preaviz → numărul e al lor [S18]. Opt-out pentru Gateway → **suport**.
10. **Domeniile din linkuri înregistrate la operatori** → **suport**.
11. **La încetare**: datele se pot șterge fără copie (7.7) [S18]. Export, preaviz → **suport**.
12. **Restricții de conținut**: interzise datele confidențiale; răspunderea pentru liste e a noastră [S18]. Trimitere „în numele Transgaz” → **suport + Juridic**.

## 7. Ce faci tu, Razvan, în cont (datele NU trec prin chat, repo sau loguri)
1. Activează autentificarea în 2 pași pe contul SMSLink.
2. SMS Gateway → Configurare și setări (`https://www.smslink.ro/sms/gateway/setup.php`) → conexiune nouă **ERP-PROD**:
   - parolă generată aleator, lungă;
   - IP: lași „orice”. Nu ne bazăm pe un IP fix de ieșire din Supabase Edge (de confirmat); dacă trecem printr-un IP fix, restrângem lista;
   - bifezi dezactivarea automată după autentificări eșuate.
   Apoi a doua conexiune, **ERP-TEST**.
3. Supabase Dashboard → Edge Functions → Secrets: `SMSLINK_CONNECTION_ID`, `SMSLINK_PASSWORD` (de la ERP-PROD), `SMS_DLR_SECRET` (generat de tine, minimum 32 de caractere aleatoare), `SMS_FURNIZOR=smslink`.
4. După deploy-ul `sms-dlr` (felia 2), pe conexiune → Editare / Setări avansate:
   - URL DLR = `https://<proiectul Gazpet>.supabase.co/functions/v1/sms-dlr?k=<SMS_DLR_SECRET>`;
   - metoda **POST**;
   - **activezi parametrii suplimentari**;
   - concatenarea rămâne **oprită** la început (eroarea 12 e plasa de siguranță);
   - formatul numărului de telefon rămâne implicit.
5. Sender: formularul „activare sender personalizat” din cont (sau contact@smslink.ro) → **GAZPET**, toate cele 4 rețele (270 EUR + TVA). Ceri în scris: pe ce entitate se înregistrează, în cât timp, dacă are cost recurent și ce se întâmplă cu el la plecare.
6. Mail la contact@ / dpo@ cu toate punctele marcate **suport** + cerere de DPA art. 28 + contract fizic.
7. Nimic în modul real până la testul din felia 2 (5 numere interne).

## 8. URL-uri citite (toate pe https://www.smslink.ro/, 03.11.2026)
[S1] sms-gateway-documentatie-sms-gateway.html · [S2] sms-gateway-conectarea-la-serviciul-sms-gateway-json.html · [S3] sms-gateway-json-parametrii-asociati-endpoint-urilor.html · [S4] sms-gateway-formatul-raspunsurilor-returnate-de-catre-sms-gateway-json.html · [S5] sms-gateway-raspunsurile-de-eroare-posibile-ale-sms-gateway-json.html · [S6] sms-gateway-raspunsurile-de-confirmare-posibile-ale-sms-gateway-http.html · [S7] sms-gateway-parametrii-transmisi-catre-sms-gateway-http.html · [S8] sms-gateway-raportul-de-livrare-al-sms-ului-transmis-prin-sms-gateway.html · [S9] examples.php?id=2 · [S10] sms-gateway-configurarea-conexiunilor-intre-aplicatia-dvs-si-sms-gateway.html · [S11] sms-gateway-caracterele-acceptate-in-textul-sms-ului.html · [S12] sms-gateway-format-numere-de-telefon.html · [S13] sms-gateway-comparatie-metode-de-implementare.html · [S14] sms-gateway-specificatii-solutie.html · [S15] sms-gateway-tarife-de-utilizare.html · [S16] intrebari-frecvente.html · [S17] protectia-datelor-cu-caracter-personal.html · [S18] termeni-si-conditii.html · [S19] infrastructura-si-tehnologie.html · [S20] acoperire-smslink.html · [S21] sms-marketing-documentatie-live-update.html · [S22] blog/imbunatatiri-import-numere-de-telefon-campanii-sms/ · [S23] sms-gateway-activarea-serviciului-sms-gateway.html · [S24] sms-gateway-implementarea-sms-gateway-http.html.
Deschise, dar fără conținut util extras: sms-gateway-implementarea-sms-gateway-bulk.html (pagina nu s-a putut citi); examples.php?id=13 (redirecționat spre index). sms-gomag.html: doar fragmentul din căutare.
