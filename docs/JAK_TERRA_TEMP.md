# JAK_TERRA_TEMP — temperaturile serverului Terra în modulul Clădire, cu alerte (varianta A, aprobată de Răzvan 27.09)

Citește întâi: `AGENTS.md` („Când scrii cod”), `supabase/functions/tuya/index.ts` (tiparul de autentificare cu secret + scriere
`iot_dispozitive`/`iot_citiri`), `src/Cladire.jsx` (cardul centralei + graficul pe 24 h), funcțiile SQL existente `iot_alerta`,
`iot_verifica_incalzire`, `iot_cron_tick` (cron `iot_sync_10min`, la 10 min). Dispozitivul intră în infrastructura IoT existentă.

## Fluxul
Terra (script pe gazdă, la 10 min) citește senzorii → POST la edge function nouă `iot-terra` cu header `x-terra-secret`
→ funcția scrie o citire pentru UN SINGUR dispozitiv fix (`sursa='terra'`, `extern_id='terra'`) → `iot_cron_tick` apelează
`iot_verifica_terra()` care compară cu pragurile și cheamă `iot_alerta` (anti-spam 12 h existent, merge la owner).

## 1. Migrare `supabase/migrations/20260927b_iot_terra_temperaturi.sql` (NU o aplici tu — o aplic eu)
- `INSERT ... ON CONFLICT (sursa, extern_id) DO NOTHING` dispozitivul: nume `Server Terra`, `site_id=1`, `meta={"tip":"server","model":"TerraMaster"}`, `activ=true`, `privat=false`.
- `public.iot_verifica_terra() RETURNS int` — `SECURITY DEFINER SET search_path = public, pg_temp`, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.
  Pe ultima citire (`ultima_citire` + `citit_la`):
  | valoare (cheie în JSON) | atenție (`warning`) | critic (`error`) |
  |---|---|---|
  | `disc_max` (max peste discuri) | > 45 | > 50 |
  | `nvme_max` | > 65 | > 70 |
  | `cpu` | > 80 | > 90 |
  | `ambient` (acpitz) | > 35 | > 40 |
  | tăcere: `citit_la` mai vechi de 30 min | `error` „Terra nu mai trimite date (server căzut / rețea)” | |
  Titlul alertei include pragul depășit (ca anti-spam-ul pe titlu să nu înghită un critic după un warning). Mesajul: valoarea + ora.
  Valori lipsă (`null`) nu declanșează nimic, dar dacă TOATE lipsesc → tratat ca „citire goală” (warning).
- Modifică `iot_cron_tick` minim: `BEGIN PERFORM public.iot_verifica_terra(); EXCEPTION WHEN OTHERS THEN NULL; END;` lângă
  `iot_verifica_incalzire` — ÎNAINTE de testul `iot_integrari ... conectat` (Terra nu e o integrare cloud; alerta de tăcere trebuie să ruleze mereu).
  Copiază corpul actual al funcției exact (îl găsești în `docs/` dacă există, altfel îl scriu eu în migrare — marchează locul cu TODO-CLAUDE).
- Fișier rollback `..._ROLLBACK.sql` alăturat.

## 2. Edge function `supabase/functions/iot-terra/index.ts`
- Doar `POST`. Autentificare: header `x-terra-secret` comparat în timp constant cu `iot_secret_get('TERRA_TEMP_SECRET')`
  (rpc existent). Lipsă/greșit → 401. Fără alt mod de autentificare (nu JWT). Adaugă `iot-terra` în lista `NO_JWT` din
  `.github/workflows/deploy-edge-function.yml`.
- Validează strict body-ul cu o funcție PURĂ exportată `valideazaCitire(body)` într-un fișier separat `valideaza.ts`:
  `{ ambient?, cpu?, nvme?: number[], discuri?: {dev:string, temp:number}[], uptime_s?: number }` — numere finite între -20 și 120,
  max 16 discuri, `dev` potrivit `/^\/dev\/[a-z0-9]{2,12}$/`; orice cheie în plus → 400. Calculează `disc_max`, `nvme_max`.
- Scrie: `update iot_dispozitive set ultima_citire=…, citit_la=now()` WHERE `sursa='terra' AND extern_id='terra'` + insert `iot_citiri`.
  Nu atinge alt dispozitiv, nu citește nimic altceva. Erori de business → răspuns JSON, nu throw (regula din CLAUDE.md).
- Teste Deno `supabase/functions/iot-terra/valideaza_test.ts`: valid, cheie în plus, NaN/Infinity, temp 500, dev cu `;`, 17 discuri, body gol.

## 3. Scriptul de pe Terra `worker/terra-temp/trimite.sh` + `README.md`
- POSIX sh (fără bash-isme), citește ce am verificat că există pe Terra:
  `/sys/class/thermal/thermal_zone*/{type,temp}` (acpitz = ambient, x86_pkg_temp = cpu), `/sys/class/hwmon/hwmon*/name` = `nvme` → `temp*_input`,
  `smartctl -A /dev/sd?` → `Temperature_Celsius` (coloana 10). Milli-grade → grade.
- Secretul din `/root/.terra_temp_secret` (verifică permisiunile 600, altfel iese cu eroare). URL-ul din `/root/.terra_temp_url`.
  NU pune secretul în linia de comandă a `curl` (se vede în `ps`) — folosește `curl -H @fișier` sau `--config` din stdin.
- `curl --max-time 20`, fără retry agresiv; eșecul se loghează într-un fișier cu rotire simplă (max ~100 KB).
- README: instalare (cron la 10 min), dezinstalare, ce trimite.

## 4. UI `src/Cladire.jsx`
- Card „🖥️ Server Terra” lângă cardul centralei: ambient, CPU, NVMe max, fiecare disc; culoare după prag (verde/galben/roșu, aceleași praguri
  ca în SQL — constante într-un singur loc în fișier); „acum X min”; roșu + „fără date” dacă > 30 min.
- Grafic 24 h (ambient + disc_max) refolosind componenta/tiparul graficului centralei, fără librării noi. Stil existent (G/S, inline).

## Limite
Nu rulezi git, nu aplici migrarea, nu deployezi, nu ceri și nu generezi secrete. Nu atingi alte funcții IoT în afară de `iot_cron_tick` (minim).

## La final
Raport `docs/JAK_TERRA_TEMP_raport.md`: ce ai schimbat, teste, ce n-ai putut rula.
