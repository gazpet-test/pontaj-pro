# retea-mon — sonda de rețea pe Terra

Sondează dispozitivele din rețea (ping + date QNAP prin SSH) și trimite un lot de citiri la
edge function `iot-retea`, care le scrie pe dispozitivele `sursa='retea'` din `iot_dispozitive`.
Apare în ERP la Clădire → „🌐 Rețea & Servere" (majoritatea dispozitivelor) și „🗄️ Server QNAP"
(card dedicat, ca la Terra).

QNAP (tip `qnap`): temperatură CPU + temperatură maximă disc (`getsysinfo`), plus disc % ocupat
pe volumul principal, RAM % ocupat și starea RAID (`df`/`free`/`/proc/mdstat` prin SSH — un singur
SSH suplimentar pentru toate trei). Uptime-ul NU e colectat (formatul `uptime` variază prea mult
ca să fie parsat sigur în POSIX sh).

## Fișiere (pe Terra, toate ale userului uid 0)
- `/root/retea-mon/sonda.sh` (700) — scriptul.
- `/root/retea-mon/tinte.conf` (600) — liniile `<extern_id> <ip> <tip>` (tip: `qnap` | `mikrotik` | `device`).
- `/root/.retea_mon_secret` (600) — secretul `RETEA_MON_SECRET` (o singură linie), identic cu cel din Vault (Supabase).
- `/root/.retea_mon_url` (600) — `https://dxczwkbciseqniprspcu.supabase.co/functions/v1/iot-retea`.
- `/root/.nas_pw` (600) — parola QNAP (user SSH `admin`), pentru temperaturi (`getsysinfo systmp/hdnum/hdtmp N`).
- `/root/.mikrotik_cred` (600) — `user:parola` pentru MikroTik (user read-only, ex. `claude-mon`), telemetrie prin REST API v7 (`GET /rest/system/resource` + `/rest/system/health`: cpu-load, temperature). Opțional — fără el, MikroTik rămâne doar cu ping.
- `/var/log/retea-mon.log` — erori, cu rotire simplă (~100 KB).

## Cron (la 10 min)
IMPORTANT (TerraMaster): NU folosi `/etc/cron.d` — acolo câmpul `root` rulează ca uid 9999 (fals „root"),
care nu poate citi secretele uid-0 și eșuează silențios. Folosește crontab-ul userului `razvan` (uid 0):

```
( crontab -l 2>/dev/null; echo '*/10 * * * * /bin/sh /root/retea-mon/sonda.sh >/dev/null 2>&1' ) | crontab -
```

## Securitate
Citește doar stare tehnică (ping/temp) — niciun text scris de om, deci fără risc de prompt-injection.
Scrie doar `iot_dispozitive`/`iot_citiri` pe dispozitive `sursa='retea'` EXISTENTE (funcția nu creează dispozitive).
Poarta e secretul `x-retea-secret` (comparat în timp constant în funcție), nu doar JWT. Nu trimite mail, nu atinge bani/drepturi.

## UPS server AI (25.10.2026)
Tipul aiserver citeste si ups_pct (0..100), ups_pe_baterie (boolean JSON,
inclusiv false) si ups_runtime_min (0..10000 sau null) din metrics.json.
Se foloseste jq deja existent, fara dependente noi. Cheile absente/invalide sunt
omise; runtime null este transmis explicit. Colectorul Windows se modifica separat
de operator. Frecventa Terra ramane 10 min; alerta nu este instantanee.

## Limite conturi: cota redari@ + reset ca epoch (09.11.2026)
Tipul aiserver mai trimite, din metrics.json:
- procente 0..100: `ai_redari_saptamana_ramas_pct`, `ai_redari_saptamana_fable_ramas_pct`;
- reset ca epoch în secunde (0..4e9): `ai_codex_reset_s`, `ai_anthropic_saptamana_reset_s`, `ai_anthropic_saptamana_fable_reset_s`,
  `ai_redari_saptamana_reset_s`, `ai_redari_saptamana_fable_reset_s`;
- text scurt: `ai_redari_saptamana_reset`, `ai_redari_saptamana_fable_reset`.

Ca și până acum, valorile lipsă sau invalide se omit.

**Ordinea la livrare e obligatorie:**
1. Întâi se face deploy la `iot-retea` cu validatorul care acceptă cheile noi.
2. Abia apoi se copiază `sonda.sh` pe Terra.

Invers, validatorul vechi respinge tot lotul (o cheie necunoscută dă 400), iar toată rețeaua rămâne fără date până la deploy.
Testul `src/cladireRetea.test.js` („Paritate chei”) verifică faptul că fiecare cheie din sondă e acceptată de `iot-retea`.
