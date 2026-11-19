"""Mutanți pe o COPIE a pachetului ocr_local (repo-ul nu se atinge): fiecare mutant trebuie să pice testul lui;
copia nemodificată trebuie să treacă aceleași teste (altfel căderea n-ar dovedi nimic).
Rulare din rădăcina repo-ului, cu interpretorul env_mineru: python -B scripts/ocr_local/tests/e3/mutanti_gpu_la_cerere.py
Copiile stau în .tmp/mut (ignorat de git) și se șterg la final. Ieșire 0 = toți mutanții uciși."""
import os, pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).parents[4]).resolve()
SRC = ROOT / 'scripts' / 'ocr_local'
WORK = ROOT / '.tmp' / 'mut'
T = 'ocr_local/tests/e3/test_e3_gpu_la_cerere.py::'

M = [
    ('M1 fara pauza la incarcarea esuata', 'e3_gpu.py',
     [('            self.eroare_pana = self.clock() + asteptare', '            self.eroare_pana = self.clock()')],
     T + 'PlafonReincercariTests::test_incarcarea_care_pica_mereu_cel_mult_32_pe_zi_si_cel_tarziu_la_o_ora'),
    ('M2 Pauza fara plafon', 'e3_gpu.py',
     [('        treapta = min(self.baza * 2 ** self.k, self.plafon)', '        treapta = self.baza * 2 ** self.k'),
      ('        return treapta, min(self.plafon, treapta * (1 + 0.1 * self.rnd()))', '        return treapta, treapta * (1 + 0.1 * self.rnd())')],
     T + 'PlafonReincercariTests::test_incarcarea_care_pica_mereu_cel_mult_32_pe_zi_si_cel_tarziu_la_o_ora'),
    ('M3 intretinere zi fara pauza (bucla veche)', 'e3_serviciu.py',
     [('                if t >= retry_at and (t - last_reconcile >= 60 or night != last_night):',
       '                if (t - last_reconcile >= 60 or night != last_night):')],
     T + 'PlafonReincercariTests::test_intretinerea_zi_cazuta_cel_mult_32_pe_zi_si_nu_la_fiecare_secunda'),
    ('M4 intretinere zi fara plafon', 'e3_serviciu.py',
     [("Pauza(plafon=INTRETINERE_PLAFON, baza=INTRETINERE_BAZA, rnd=self.rnd)", "Pauza(plafon=float('inf'), baza=INTRETINERE_BAZA, rnd=self.rnd)")],
     T + 'PlafonReincercariTests::test_intretinerea_zi_cazuta_cel_mult_32_pe_zi_si_nu_la_fiecare_secunda'),
    ('M5 laboratorul nu cedeaza', 'read.py',
     [("            if lock and cerere_activa(proto['gpu_lock']):", '            if False:')],
     T + 'LacatLaCerereTests::test_prioritate_laboratorul_cedeaza_dupa_pagina_curenta'),
    ('M6 fara descarcare la inactivitate', 'e3_gpu.py',
     [('            if de_descarcat or (cerut == 0 and now - self.ultima >= self.inactiv_s):', '            if de_descarcat:')],
     T + 'LacatLaCerereTests::test_lucrare_incarca_lucreaza_descarca_dupa_inactivitate'),
    ('M7 invalidare la modele neincarcate', 'e3_serviciu.py',
     [('                and not isinstance(exc, NeincarcatLaTimp)', '                and True')],
     T + 'WorkerLaCerereTests::test_modele_neincarcate_la_timp_fallback_fara_invalidare_si_fara_cititor'),
    ('M8 lacatul laboratorului atins', 'e3_gpu.py',
     [("                    if old.get('detinator') != 'e3_serviciu' or old.get('gazda') != socket.gethostname():",
       '                    if False:')],
     T + 'LacatLaCerereTests::test_laboratorul_nu_cedeaza_e3_renunta_si_anunta_ocupat'),
    ('M9 fara fereastra ocupat', 'e3_gpu.py',
     [('                        self.ocupat_pana = self.clock() + self.OCUPAT_S', '                        self.ocupat_pana = self.clock()')],
     T + 'LacatLaCerereTests::test_laboratorul_nu_cedeaza_e3_renunta_si_anunta_ocupat'),
    ('M10 cererea veche tot activa', 'gpu_cedare.py',
     [("    return isinstance(la, (int, float)) and not isinstance(la, bool) and math.isfinite(la) and acum - VALABILA_S < la <= acum + 5",
       '    return isinstance(la, (int, float))')],
     T + 'CerereFisierTests::test_proaspata_veche_din_viitor_corupta_si_lipsa'),
    ('M11 noaptea fara descarcare', 'e3_gpu.py',
     [("            if self.tine_lacatul and not self._descarca('noapte'):", '            if False:')],
     T + 'LacatLaCerereTests::test_noaptea_descarca_si_nu_atinge_lacatul'),
    ('M12 reincercarea descarcarii fara verificarea memoriei', 'e3_gpu.py',
     [('        ok = self.c.descarca(self.vram_inainte, verifica_memoria=self.vram_inainte is not None)',
       '        ok = self.c.descarca(self.vram_inainte)')],
     T + 'LacatLaCerereTests::test_descarcarea_neconfirmata_pastreaza_lacatul_si_reincearca_cu_pauza'),
    ('M13 lacatul tinut in pauza dupa pornirea esuata', 'e3_gpu.py',
     [("            ok = self._descarca('pornire_esuata')", '            ok = False')],
     T + 'PlafonReincercariTests::test_incarcarea_care_pica_mereu_cel_mult_32_pe_zi_si_cel_tarziu_la_o_ora'),
]


def copie(n):
    d = WORK / str(n)
    if d.exists():
        shutil.rmtree(d)
    shutil.copytree(SRC, d / 'ocr_local', ignore=shutil.ignore_patterns('__pycache__', '.e3-test-work'))
    return d


def ruleaza(d, test):
    env = dict(os.environ, PYTHONPATH=str(d), PYTHONIOENCODING='utf-8')
    r = subprocess.run([sys.executable, '-B', '-m', 'pytest', test, '-q', '-p', 'no:cacheprovider', '-x'],
                       cwd=d, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1:]


rezultat = 0
d = copie('baza')
for nume, _, _, test in M:
    cod, ultima = ruleaza(d, test)
    print('BAZA', 'trece' if cod == 0 else 'PICA', nume, ultima)
    rezultat |= cod != 0
for i, (nume, fisier, inlocuiri, test) in enumerate(M, 1):
    d = copie(i)
    f = d / 'ocr_local' / fisier
    s = f.read_bytes().decode('utf-8')
    for vechi, nou in inlocuiri:
        n = s.count(vechi)
        if n != 1:
            print('MUTANT', nume, 'text gasit de', n, 'ori:', vechi)
            rezultat = 1
            break
        s = s.replace(vechi, nou)
    else:
        f.write_bytes(s.encode('utf-8'))
        cod, ultima = ruleaza(d, test)
        print('MUTANT', 'ucis' if cod != 0 else 'SUPRAVIETUIESTE', nume, ultima)
        rezultat |= cod == 0
shutil.rmtree(WORK)
print('REZULTAT', 'OK' if rezultat == 0 else 'ESEC')
sys.exit(rezultat)
