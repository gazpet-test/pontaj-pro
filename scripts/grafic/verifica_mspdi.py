"""Verificare independentă a exportului MSPDI al motorului graficului automat (src/graficMotor), cu MPXJ.

Pentru fiecare <nume>.xml din dosar (cu referința <nume>.json scrisă de genereaza_mspdi_proba.mjs):
  1. citește fișierul cu MPXJ (cum l-ar citi MS Project / Primavera) și compară datele de start / final cu motorul;
  2. RECALCULEAZĂ graficul cu planificatorul MPXJ în stil Microsoft (org.mpxj.cpm.MicrosoftScheduler), din legături,
     durate și calendarul din fișier, și compară din nou. O diferență = motorul și MS Project nu calculează la fel.
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


def compara(proiect, ref):
    dif = []
    for t in proiect.getTasks():
        wbs = t.getWBS()
        if not wbs:
            continue
        r = ref.get(str(wbs))
        if r is None:
            dif.append(f'{wbs}: sarcină necunoscută motorului')
            continue
        s, f = str(t.getStart().toLocalDate()), str(t.getFinish().toLocalDate())
        if (s, f) != (r['start'], r['final']):
            dif.append(f"{wbs}: MPXJ {s}..{f} ≠ motor {r['start']}..{r['final']}")
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
        proiect = UniversalProjectReader().read(File(x))
        d1 = compara(proiect, ref)
        MicrosoftScheduler().schedule(proiect, proiect.getProjectProperties().getStartDate())
        d2 = compara(proiect, ref)
        stare = 'OK' if not d1 and not d2 else 'DIFERENȚE'
        print(f'{os.path.basename(x)}: {stare} — citire: {len(d1)} diferențe, recalculare MPXJ: {len(d2)} diferențe ({len(ref)} poziții)')
        for d in (d1 + d2)[:20]:
            print('   ', d)
        if d1 or d2:
            rezultat = 1
    return rezultat


if __name__ == '__main__':
    sys.exit(main())
