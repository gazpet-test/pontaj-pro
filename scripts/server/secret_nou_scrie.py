"""secret_nou.sh, pasul 3: stdin = o linie „uuid|valoare” din Vault. Creează fișierul GOL exclusiv (O_EXCL), îi restrânge și verifică
ACL-ul, abia apoi scrie valoarea. La orice eșec după creare: șterge fișierul local și afișează UUID-ul pentru reconciliere.
Valoarea nu se afișează niciodată.

Identitatea pentru ACL vine din whoami.exe (cont + SID ale procesului), nu din variabile de mediu; drepturile se dau pe SID-uri,
iar verificarea compară EXACT principalul fiecărei intrări (review Jakarinos r3 P1).
Risc acceptat de Răzvan (06.11.2026): directorul .secrete moștenește citire pentru CodexSandboxUsers; între crearea fișierului gol
și restrângerea ACL-ului, un proces al acelui grup ar putea deschide un handle pe care îl păstrează. Închiderea ar cere ACL restrâns
pe director, pe care Răzvan a ales să nu-l facă acum."""
import csv
import io
import os
import re
import subprocess
import sys

WHOAMI = r'C:\Windows\System32\whoami.exe'
ICACLS = r'C:\Windows\System32\icacls.exe'
f = sys.argv[1]
linie = sys.stdin.read().strip()
m = re.fullmatch(r'([0-9a-f-]{36})\|([0-9a-f]{64})', linie)
if not m:
    print('EROARE: raspuns neasteptat sau lipsa din Vault (nimic scris local); verifica in vault.secrets daca secretul a fost totusi creat')
    sys.exit(4)
uid, val = m.groups()


def esec(motiv):
    try:
        if os.path.lexists(f):
            os.remove(f)
    except Exception:
        motiv += '; fisierul local NU a putut fi sters, sterge-l manual: ' + f
    print('EROARE:', motiv, '- secretul din Vault are id', uid, '- reconciliere manuala')
    sys.exit(4)


try:
    w = subprocess.run([WHOAMI, '/user', '/fo', 'csv', '/nh'], capture_output=True, text=True, errors='replace')
    cont, sid = next(csv.reader(io.StringIO(w.stdout.strip())))
    if w.returncode != 0 or not re.fullmatch(r'S-1-5-21-\d+-\d+-\d+-\d+', sid):
        raise ValueError('sid')
except Exception:
    print('EROARE: identitatea procesului nu a putut fi citita (nimic scris local); secretul din Vault are id', uid, '- reconciliere manuala')
    sys.exit(4)

try:
    fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0), 0o600)
    os.close(fd)
except FileExistsError:
    print('EROARE: fisierul a aparut intre timp; secretul din Vault are id', uid, '- reconciliere manuala')
    sys.exit(4)
except Exception as e:
    esec('nu pot crea fisierul local (' + type(e).__name__ + ')')

try:
    r = subprocess.run([ICACLS, f, '/inheritance:r', '/grant:r', '*' + sid + ':F', '*S-1-5-18:F', '*S-1-5-32-544:F'],
                       capture_output=True)
    citire = subprocess.run([ICACLS, f], capture_output=True, text=True, errors='replace')
    acl = citire.stdout if citire.returncode == 0 else ''   # citire eșuată = ACL neverificat = refuz (review r4 P2)
except Exception as e:
    esec('icacls nu a putut rula (' + type(e).__name__ + ')')
permise = {cont.lower(), 'nt authority\\system', 'builtin\\administrators'}
principali = []
for l in acl.splitlines():
    if ':(' not in l:
        continue
    s = l.strip()
    if s.lower().startswith(f.lower()):
        s = s[len(f):].strip()
    principali.append(s.split(':(', 1)[0].strip().lower())
if r.returncode != 0 or set(principali) != permise or len(principali) != len(permise):   # exact cei trei, fiecare o dată (r4 P2)
    esec('ACL-ul nu a putut fi restrans exact la ' + cont + '/SYSTEM/Administrators')
try:
    with open(f, 'w', encoding='ascii') as h:
        h.write(val + '\n')
except Exception as e:
    esec('scrierea valorii a esuat (' + type(e).__name__ + ')')
print('OK: secret creat in Vault (id', uid + ') si scris in', f, '- 64 hex, ACL doar', cont + '/SYSTEM/Administrators; valoarea nu se afiseaza')
