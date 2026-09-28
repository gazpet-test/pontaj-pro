# retea-mon — sonda de rețea pe Terra

Sondează dispozitivele din rețea (ping + temperaturi QNAP prin SSH) și trimite un lot de citiri la
edge function `iot-retea`, care le scrie pe dispozitivele `sursa='retea'` din `iot_dispozitive`.
Apare în ERP la Clădire → „🌐 Rețea & Servere".

## Fișiere (pe Terra, toate ale userului uid 0)
- `/root/retea-mon/sonda.sh` (700) — scriptul.
- `/root/retea-mon/tinte.conf` (600) — liniile `<extern_id> <ip> <tip>` (tip: `qnap` | `mikrotik` | `device`).
- `/root/.retea_mon_secret` (600) — secretul `RETEA_MON_SECRET` (o singură linie), identic cu cel din Vault (Supabase).
- `/root/.retea_mon_url` (600) — `https://dxczwkbciseqniprspcu.supabase.co/functions/v1/iot-retea`.
- `/root/.nas_pw` (600) — parola QNAP (user SSH `admin`), pentru temperaturi (`getsysinfo systmp/hdnum/hdtmp N`).
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
