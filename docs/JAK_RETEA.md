# JAK_RETEA — monitorizare rețea & servere în modulul Clădire (varianta A, aprobată de Răzvan 27.09)

Citește întâi: `AGENTS.md` („Când scrii cod”), `supabase/functions/iot-terra/{index.ts,valideaza.ts,valideaza_test.ts}`
(tiparul EXACT de urmat: POST-only, header-secret în timp constant, scriere `iot_dispozitive`/`iot_citiri`, validare pură separată),
`src/Cladire.jsx` (cardul Terra + graficul 24 h, constante de praguri într-un singur loc), funcțiile SQL `iot_alerta`,
`iot_verifica_terra`, `iot_verifica_incalzire`, `iot_cron_tick` (cron `iot_sync_10min`, la 10 min). Dispozitivele de rețea sunt
DEJA în infrastructura IoT: `iot_dispozitive` cu `sursa='retea'` (le-a inserat Claude — le găsești, NU le re-inserezi).

## Contextul (nu presupune, sunt reale în BD)
Dispozitive `sursa='retea'` deja mapate — cheia stabilă e `extern_id`:
- Online (au IP): `192.168.1.1` (Router MikroTik principal/gateway), `192.168.1.99` (D-Link R32 nod 1),
  `192.168.1.100` (D-Link R32 repeater 1), `192.168.1.42` (QNAP, NAS backup), `192.168.1.63` (Server Windows IIS).
- Offline / IP necunoscut (placeholder, `meta->>'asteptat_online'='false'`): `repeater-2`, `router-hala`, `router-curte`,
  `server-doclib`. Servere numite fără IP încă: `server-mail`, `server-mentor` (`asteptat_online='true'`).
IP-ul real (când există) e în `meta->>'ip'`; pentru rândurile pe IP, `extern_id` ESTE IP-ul. Nu inventa IP-uri pentru placeholdere.

## Fluxul (identic ca la Terra, generalizat pe mai multe dispozitive)
Terra (script pe gazdă, la 10 min, e în aceeași rețea) sondează fiecare dispozitiv → POST la edge function nouă `iot-retea`
cu header `x-retea-secret`, un ARRAY de citiri → funcția scrie câte o citire per dispozitiv (match pe `extern_id`) →
`iot_cron_tick` apelează `iot_verifica_retea()` care compară cu pragurile/starea și cheamă `iot_alerta` (anti-spam 12 h, la owner).

## 1. Migrare `supabase/migrations/20260927c_iot_retea_monitorizare.sql` (NU o aplici tu — o aplic eu)
- Fără INSERT de dispozitive (există deja). Doar funcția + eventual GRANT.
- `public.iot_verifica_retea() RETURNS int` — `SECURITY DEFINER SET search_path = public, pg_temp`,
  `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`. Iterează dispozitivele `sursa='retea' AND activ=true`:
  - **Online/offline**: câmpul `ultima_citire->>'online'` (bool) + `citit_la`.
    - Dispozitiv cu `meta->>'asteptat_online'` ≠ `'false'` care e `online=false` SAU tăcut (`citit_la` > 20 min) → alertă
      `warning` „Rețea: %nume% nu răspunde”. Titlu STABIL per dispozitiv (anti-spam pe titlu).
    - Placeholderele (`asteptat_online='false'`) NU generează alerte cât timp sunt offline (așteptat). Dacă apar `online=true`,
      doar se salvează citirea (info „a apărut în rețea”, fără alertă critică).
  - **QNAP temperaturi** (doar dispozitivul QNAP, când citirea are `cpu_temp`/`hdd_max`): praguri, tabel:
    | cheie JSON | atenție (`warning`) | critic (`error`) |
    |---|---|---|
    | `cpu_temp` (°C) | > 70 | > 85 |
    | `hdd_max` (°C, max peste discuri) | > 50 | > 60 |
    Titlul include pragul depășit; valori `null` → ignorate.
  - **MikroTik** (când citirea are telemetrie, doar dacă există credențiale — vezi §3): `cpu_load` (> 90 warning), dar prioritar
    e doar starea online (routerul principal offline = `error`, nu warning: „Router MikroTik (gateway) nu răspunde — posibil rețea căzută”).
- Modifică `iot_cron_tick` MINIM: adaugă `BEGIN PERFORM public.iot_verifica_retea(); EXCEPTION WHEN OTHERS THEN RAISE WARNING 'iot_verifica_retea: %', SQLERRM; END;`
  imediat lângă apelul existent `iot_verifica_terra()` — ÎNAINTE de testul `iot_integrari ... conectat` (rețeaua nu e integrare cloud;
  trebuie să ruleze mereu). Copiază corpul actual EXACT (îl iei din producție / din migrarea Terra); nu schimba nimic altceva în el.
- Fișier rollback `..._ROLLBACK.sql` alăturat (DROP FUNCTION iot_verifica_retea + revenirea iot_cron_tick la varianta doar-Terra).

## 2. Edge function `supabase/functions/iot-retea/index.ts` + `valideaza.ts` + teste
- Doar `POST`. Autentificare: header `x-retea-secret` comparat în timp constant (`timingSafeEqual` pe digest SHA-256, ca la iot-terra)
  cu `iot_secret_get('RETEA_MON_SECRET')` (rpc existent). Lipsă/greșit → 401. Fără JWT. Adaugă `iot-retea` în lista `NO_JWT` din
  `.github/workflows/deploy-edge-function.yml`.
- Validare STRICTĂ, funcție pură exportată `valideazaCitiri(body)` în `valideaza.ts`. Body = `{ citiri: Citire[] }`, max 64 elemente.
  `Citire = { extern_id: string, online: boolean, latency_ms?: number, cpu_temp?, hdd_max?, cpu_load?, uptime_s?: number }`.
  - `extern_id`: string 1–64, doar `[a-z0-9.\-]` (acoperă și IP-uri și `router-hala`); orice cheie în plus pe obiect → 400.
  - numere finite în intervale sănătoase (temp -20..120, latency 0..60000, cpu_load 0..100); NaN/Infinity → 400.
- Scriere: pentru fiecare citire, `update iot_dispozitive set ultima_citire=<obiect>, citit_la=now() where sursa='retea' and extern_id=<x>`
  (NU insert — dacă `extern_id` nu există, se ignoră silențios și se raportează în răspuns `necunoscute:[...]`, ca să nu creeze dispozitive
  din date externe) + insert `iot_citiri` per dispozitiv găsit. Nu atinge dispozitive din alte surse. Erori de business → JSON, nu throw.
- Teste Deno (`valideaza_test.ts` + `index_test.ts` unde e fezabil ca la iot-terra): array valid, cheie în plus, NaN, temp 500,
  extern_id cu `;`/spațiu, 65 de elemente, body gol, `citiri` lipsă.

## 3. Scriptul de pe Terra `worker/retea-mon/sonda.sh` + `README.md`
- POSIX sh (fără bash-isme). Pentru fiecare dispozitiv cu IP cunoscut (le poți lista într-un fișier de config `/root/retea-mon/tinte.conf`
  linii `extern_id ip tip` — îl scriu EU cu IP-urile reale; tu doar îl citești, cu exemplu în README):
  - **Ping**: `ping -c1 -W2 <ip>` → `online` + `latency_ms` (din timpul răspunsului). Fără ping-flood.
  - **QNAP** (tip=`qnap`): SSH cu parola din `/root/.nas_pw` (perm 600, altfel skip + log), user `admin` (lowercase), `sshpass -f`:
    `getsysinfo cputmp` și `getsysinfo hdtmp <n>` pentru fiecare disc → `cpu_temp`, `hdd_max`. Timeout SSH strict (`-o ConnectTimeout=8`).
  - **MikroTik** (tip=`mikrotik`): DOAR dacă există `/root/.mikrotik_cred` (perm 600, format `user:parola`). Fără fișier → trimite doar
    `online` din ping (fără telemetrie). Metodă: API RouterOS pe portul 8728 sau SSH `/system resource print` — alege ce e mai robust; dacă
    niciuna nu merge simplu din sh, lasă TODO și trimite doar `online`. Nu bloca livrarea pe telemetria MikroTik.
  - Restul (routere/servere): doar `online` + `latency_ms`.
- Construiește UN singur JSON `{"citiri":[...]}` și POST cu `curl --max-time 25`. Secretul din `/root/.retea_mon_secret`,
  URL din `/root/.retea_mon_url`. NU pune secretul/parola în linia de comandă (se văd în `ps`) — `curl -H @fișier` / `--config` din stdin,
  `sshpass -f fișier`. Eșecul se loghează într-un fișier cu rotire simplă (~100 KB).
- README: instalare cron la 10 min (folosește `/etc/cron.d/`, NU `crontab -` — vezi lecția FARA-CRON din sesiunea Terra), dezinstalare,
  formatul `tinte.conf`, ce fișiere-secret sunt necesare.

## 4. UI `src/Cladire.jsx`
- Secțiune nouă „🌐 Rețea & Servere” (sub cardul Terra). Un card compact per dispozitiv `sursa='retea'`:
  nume, pastilă verde „online / X ms” sau roșu „offline”, „acum Y min”; pentru QNAP: CPU/HDD cu culoare pe praguri (aceleași constante ca SQL,
  într-un singur loc în fișier). Placeholderele offline (asteptat_online=false): gri „neconfigurat / offline (așteptat)”, fără roșu de alarmă.
- Fără librării noi. Stil existent (G/S, inline). Refolosește tiparul cardului Terra.

## Limite
Nu rulezi git, nu aplici migrarea, nu deployezi, nu ceri și nu generezi secrete, nu inserezi/ștergi dispozitive, nu atingi alte funcții IoT
în afară de `iot_cron_tick` (minim). Datele de rețea sunt intrare externă: funcția NU creează dispozitive din ele (doar update pe existente).

## Fișa de securitate (pentru raport + registru_automatizari)
(a) citește extern: DOAR stare tehnică (ping/temp/telemetrie), niciun text scris de om → fără risc de prompt-injection.
(b) scrie/face: update `iot_dispozitive` + insert `iot_citiri` pe dispozitive `sursa='retea'` existente; alerte în BD prin `iot_alerta`.
    NU trimite mail, NU atinge bani/drepturi, NU creează dispozitive.
(c) identitate: edge function cu service_role (necesar pentru rpc `iot_secret_get` + scriere), dar poarta e secretul `x-retea-secret`
    verificat în cod (nu doar JWT — cheia anon e JWT valid). Scriptul de pe Terra rulează local, cu secrete în fișiere 600.
(d) cine o poate porni: doar cine are `RETEA_MON_SECRET` (Terra). Fără secret → 401.
(e) confirmare umană: niciuna necesară (nu are efecte ireversibile / externe). Alertele merg la owner.

## La final
Raport `docs/JAK_RETEA_raport.md`: ce ai schimbat, teste rulate (Deno), ce n-ai putut rula, TODO-uri rămase (ex. telemetrie MikroTik).
