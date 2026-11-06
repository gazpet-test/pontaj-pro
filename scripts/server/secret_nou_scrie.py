"""secret_nou.sh, pasul 3: stdin = o linie „uuid|valoare” din Vault. Creează fișierul GOL exclusiv (O_EXCL), îi restrânge și verifică
ACL-ul, abia apoi scrie valoarea. La orice eșec după creare: șterge fișierul local și afișează UUID-ul pentru reconciliere.
Valoarea nu se afișează niciodată."""
import os
import re
import subprocess
import sys

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
    fd = os.open(f, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_BINARY', 0), 0o600)
    os.close(fd)
except FileExistsError:
    print('EROARE: fisierul a aparut intre timp; secretul din Vault are id', uid, '- reconciliere manuala')
    sys.exit(4)
except Exception as e:
    esec('nu pot crea fisierul local (' + type(e).__name__ + ')')

user = os.environ.get('USERNAME', '')
try:
    r = subprocess.run(['icacls', f, '/inheritance:r', '/grant:r', user + ':F', '*S-1-5-18:F', '*S-1-5-32-544:F'],
                       capture_output=True)
    acl = subprocess.run(['icacls', f], capture_output=True, text=True, errors='replace').stdout
except Exception as e:
    esec('icacls nu a putut rula (' + type(e).__name__ + ')')
permise = (user.lower(), 'nt authority\\system', 'builtin\\administrators')
intrari = [l.replace(f, '').strip() for l in acl.splitlines() if ':(' in l]
straini = [x for x in intrari if not any(p in x.lower() for p in permise)]
if r.returncode != 0 or not intrari or straini:
    esec('ACL-ul nu a putut fi restrans')
try:
    with open(f, 'w', encoding='ascii') as h:
        h.write(val + '\n')
except Exception as e:
    esec('scrierea valorii a esuat (' + type(e).__name__ + ')')
print('OK: secret creat in Vault (id', uid + ') si scris in', f, '- 64 hex, ACL doar', user + '/SYSTEM/Administrators; valoarea nu se afiseaza')
