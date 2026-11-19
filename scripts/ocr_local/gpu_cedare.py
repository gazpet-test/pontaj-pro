"""Protocolul comun al plăcii video (GPU) de pe serverul AI: E3 (Izometrie) la cerere, cu prioritate (decizia Răzvan 19.11.2026).

Două fișiere, în același folder (protocol.json -> gpu_lock):
- gpu.lock    cine ține GPU-ul acum. Creat exclusiv (O_EXCL / rename fără suprascriere), șters doar de deținător. Neschimbat.
- gpu.cerere  E3 are o lucrare și cere GPU-ul. Îl scrie DOAR serviciul E3, cât timp așteaptă lacătul, și îl reîmprospătează
              (câmpul `la`, la cel mult REIMPROSPATARE_S secunde); îl șterge când a luat lacătul sau când renunță.

Regula pentru ORICE alt proces care ține gpu.lock (citirea Ofertare din read.py, Docling, scripturi Ollama):
1. înainte de fiecare pagină / bandă / document: `cerere_activa(cale_lock)`;
2. dacă e True: nu începi pagina următoare; eliberezi memoria plăcii (oprești serverul / descarci modelul; la Ollama
   `keep_alive: 0`), ștergi gpu.lock (doar dacă e al tău) și ieși sau aștepți;
3. reiei doar când `cerere_activa` e False ȘI gpu.lock e liber (E3 îl ține cât lucrează, plus câteva minute fără lucrări).
Așteptarea maximă a lui E3 = durata unei pagini a celuilalt proces. O cerere nereîmprospătată de VALABILA_S secunde
(E3 căzut) nu mai contează, ca să nu blocheze laboratorul pentru totdeauna.
"""
import json
import math
import os
import pathlib
import socket
import time

VALABILA_S = 60
REIMPROSPATARE_S = 10
DETINATOR = 'e3_serviciu'


def cale_cerere(cale_lock):
    return pathlib.Path(cale_lock).with_name('gpu.cerere')


def _proaspat(la, acum):
    """`la` în fereastra [acum - VALABILA_S, acum + 5]: un ceas din viitor nu ține cererea activă la nesfârșit."""
    return isinstance(la, (int, float)) and not isinstance(la, bool) and math.isfinite(la) and acum - VALABILA_S < la <= acum + 5


def cerere_activa(cale_lock, *, acum=None):
    """True dacă E3 cere GPU-ul acum. Fișier lipsă = False. Fișier ilizibil / străin = activ doar cât e proaspăt pe disc
    (mtime), ca o scriere stricată să nu blocheze laboratorul pentru totdeauna, dar nici să nu fie ignorată imediat."""
    p = cale_cerere(cale_lock)
    acum = time.time() if acum is None else acum
    try:
        brut = p.read_text(encoding='utf-8')
    except FileNotFoundError:
        return False
    except OSError:
        brut = None
    try:
        c = json.loads(brut) if brut is not None else None
    except ValueError:
        c = None
    if isinstance(c, dict) and c.get('detinator') == DETINATOR and _proaspat(c.get('la'), acum):
        return True
    if isinstance(c, dict) and c.get('detinator') == DETINATOR:
        return False  # cerere E3 validă ca formă, dar veche: E3 a căzut sau a renunțat fără ștergere
    try:
        return _proaspat(p.stat().st_mtime, acum)
    except OSError:
        return False


class CerereGpu:
    """Partea E3 a protocolului: scrie / reîmprospătează / șterge propria cerere (token unic per instanță)."""
    def __init__(self, cale_lock, *, token, clock=time.time, save=None):
        from .client import save as _save
        self.path, self.token, self.clock, self.save = cale_cerere(cale_lock), token, clock, save or _save
        self.scrisa_la = None

    def cere(self):
        """Scrie cererea dacă lipsește sau dacă a trecut REIMPROSPATARE_S de la ultima scriere."""
        acum = self.clock()
        if self.scrisa_la is not None and acum - self.scrisa_la < REIMPROSPATARE_S and self.path.exists():
            return
        self.save(self.path, {'detinator': DETINATOR, 'pid': os.getpid(), 'gazda': socket.gethostname(),
                              'la': acum, 'token': self.token})
        self.scrisa_la = acum

    def retrage(self):
        """Șterge cererea doar dacă e a acestei instanțe (alt token = nu se atinge)."""
        self.scrisa_la = None
        try:
            c = json.loads(self.path.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return
        if isinstance(c, dict) and c.get('token') == self.token:
            self.path.unlink(missing_ok=True)
