"""Verificare independentă a exportului MSPDI al motorului graficului automat (src/graficMotor), cu MPXJ.

Pentru fiecare <nume>.xml din dosar (cu referința <nume>.json scrisă de genereaza_mspdi_proba.mjs):
  0. toate pozițiile din referință trebuie să existe în fișier, o singură dată, și nimic în plus (r1 Jak: fără verde pe listă goală);
  1. citește fișierul cu MPXJ (cum l-ar citi MS Project / Primavera) și compară începutul și sfârșitul (DATA ȘI ORA) și durata;
  2. RECALCULEAZĂ graficul cu planificatorul MPXJ în stil Microsoft (org.mpxj.cpm.MicrosoftScheduler), din legături, durate
     și calendarul din fișier, și compară din nou începutul / sfârșitul / durata, iar la activități (nu la rezumate) și
     începutul / sfârșitul târziu și marja totală. O diferență = motorul și MS Project nu calculează la fel.
Nu scrie nimic; nu atinge ERP-ul.

Utilizare (Java 17+ și pachetele din scripts/grafic/requirements.txt, ca import_mpp.py):
  python -I -X utf8 scripts/grafic/verifica_mspdi.py <dosar> [--java-home <dir JDK>]
Ieșire: 0 = toate fișierele identice la citire și la recalculare; 1 = diferențe; 2 = argumente / fișiere lipsă.
"""
import argparse, glob, json, os, sys


def porneste_jvm(java_home):
    import jpype
    import mpxj  # noqa: F401 — pune jar-urile MPXJ pe classpath
    if jpype.isJVMStarted():
        return jpype
    home = java_home or os.environ.get('JAVA_HOME')
    cale = None
    if home:
        for c in (os.path.join(home, 'bin', 'server', 'jvm.dll'), os.path.join(home, 'lib', 'server', 'libjvm.so'), os.path.join(home, 'lib', 'server', 'libjvm.dylib')):
            if os.path.exists(c):
                cale = c
                break
    jpype.startJVM(cale or jpype.getDefaultJVMPath(), '-Dlog4j2.loggerContextFactory=org.apache.logging.log4j.simple.SimpleLoggerContextFactory', convertStrings=True)
    return jpype


def moment(x):
    """LocalDateTime MPXJ / text ISO al motorului -> 'AAAA-LL-ZZTHH:MM' (fără secunde)."""
    return None if x is None else str(x)[:16]


def la_inceput_de_lucru(m, calendar):
    """Un JALON la sfârșitul unei zile lucrătoare (17:00) e același moment de lucru ca începutul următoarei zile lucrătoare
    (08:00); MPXJ scrie uneori una, motorul cealaltă (ex. jalonul OI de la ziua 0, la trecerea înapoi). Se aduc la aceeași formă
    prin calendarul din fișier — doar la jaloane; restul se compară exact."""
    import java.time as jt
    if m is None or not m.endswith('T17:00'):
        return m  # doar „17:00” se mută; orice altă oră rămâne cum e (07:00 ≠ 08:00 — r2 Jak P2)
    d = jt.LocalDateTime.parse(m + ':00')
    if not calendar.isWorkingDate(d.toLocalDate()):
        return m  # 17:00 într-o zi nelucrătoare nu e sfârșitul unei zile de lucru: nicio echivalență
    return moment(calendar.getNextWorkStart(d))


def zile(durata, proprietati):
    from org.mpxj import TimeUnit
    if durata is None:
        return None
    return round(float(durata.convertUnits(TimeUnit.DAYS, proprietati).getDuration()), 4)


def compara(proiect, ref, cu_tarziu):
    dif = []
    prop = proiect.getProjectProperties()
    vazute = {}
    for t in proiect.getTasks():
        wbs = t.getWBS()
        if not wbs:
            if t.getUniqueID() is not None and int(t.getUniqueID()) == 0:
                continue  # doar sarcina-rezumat a proiectului (UID 0), creată de MPXJ, e scutită
            dif.append(f'sarcină fără WBS în fișier (UID {t.getUniqueID()}, „{t.getName()}”) — necunoscută motorului')
            continue
        wbs = str(wbs)
        vazute[wbs] = vazute.get(wbs, 0) + 1
        r = ref.get(wbs)
        if r is None:
            dif.append(f'{wbs}: sarcină în fișier, necunoscută motorului')
            continue
        noi = (moment(t.getStart()), moment(t.getFinish()), zile(t.getDuration(), prop))
        ast = (moment(r['start']), moment(r['final']), float(r['durata']))
        if noi != ast:
            dif.append(f'{wbs}: MPXJ {noi} ≠ motor {ast}')
        if cu_tarziu and not r['rezumat']:
            noi_t = (moment(t.getLateStart()), moment(t.getLateFinish()), zile(t.getTotalSlack(), prop))
            ast_t = (moment(r['ls']), moment(r['lf']), float(r['marja']))
            if r['jalon']:
                cal = proiect.getDefaultCalendar()
                noi_t = (la_inceput_de_lucru(noi_t[0], cal), la_inceput_de_lucru(noi_t[1], cal), noi_t[2])
                ast_t = (la_inceput_de_lucru(ast_t[0], cal), la_inceput_de_lucru(ast_t[1], cal), ast_t[2])
            if noi_t != ast_t:
                dif.append(f'{wbs}: târziu MPXJ {noi_t} ≠ motor {ast_t}')
    for wbs in ref:
        if vazute.get(wbs, 0) != 1:
            dif.append(f'{wbs}: apare de {vazute.get(wbs, 0)} ori în fișier (aștept 1)')
    return dif


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('dosar')
    ap.add_argument('--java-home')
    a = ap.parse_args()
    fisiere = sorted(glob.glob(os.path.join(a.dosar, '*.xml')))
    if not fisiere:
        print(f'niciun .xml în {a.dosar}', file=sys.stderr)
        return 2
    porneste_jvm(a.java_home)
    from org.mpxj.reader import UniversalProjectReader
    from org.mpxj.cpm import MicrosoftScheduler
    from java.io import File
    rezultat = 0
    for x in fisiere:
        js = x[:-4] + '.json'
        if not os.path.exists(js):
            print(f'{os.path.basename(x)}: lipsește referința {os.path.basename(js)}', file=sys.stderr)
            return 2
        with open(js, encoding='utf-8') as fh:
            ref_json = json.load(fh)
        ref = {p['cod']: p for p in ref_json['pozitii']}
        if not ref or len(ref) != len(ref_json['pozitii']):
            print(f'{os.path.basename(js)}: referință goală sau cu coduri duble', file=sys.stderr)
            return 2
        proiect = UniversalProjectReader().read(File(x))
        d1 = compara(proiect, ref, False)
        try:
            MicrosoftScheduler().schedule(proiect, proiect.getProjectProperties().getStartDate())
            d2 = compara(proiect, ref, True)
        except Exception as e:  # recalcularea imposibilă = neverificat, nu OK
            d2 = [f'recalcularea MPXJ a eșuat: {type(e).__name__}: {str(e)[:200]}']
        stare = 'OK' if not d1 and not d2 else 'DIFERENȚE'
        print(f'{os.path.basename(x)}: {stare} — citire: {len(d1)} diferențe, recalculare MPXJ: {len(d2)} diferențe ({len(ref)} poziții, toate găsite o dată: {"da" if not [d for d in d1 if "apare de" in d] else "NU"})')
        for d in (d1 + d2)[:25]:
            print('   ', d)
        if d1 or d2:
            rezultat = 1
    return rezultat


if __name__ == '__main__':
    sys.exit(main())
