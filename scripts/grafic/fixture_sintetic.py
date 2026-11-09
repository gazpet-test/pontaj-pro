"""Grafic SINTETIC (lucrare fictivă) scris cu MPXJ în format MSPDI (.xml): sursa fixture-ului din test-fixtures/grafic/.
Datele reale (graficele Transgaz) NU intră în repo (repo public): testele folosesc acest grafic, cu valorile alese aici.
Utilizare: python -I -X utf8 scripts/grafic/fixture_sintetic.py <iesire.xml>   (Java + pachetele din requirements.txt)
Conținut (valorile așteptate stau scrise separat, de mână, în test_import_mpp.py):
  1 Lucrare test (rezumat)
    1.1 Repere: 1.1.1 Ordin de începere (jalon, 100%), 1.1.2 Recepție (jalon, 0%)
    1.2 Tronson T1: 1.2.1 Decopertare (100%), 1.2.2 Montaj conductă (60%, SS+5z, 2 resurse), 1.2.3 Probe de presiune (0%, FS-2z)
    1.3 Tronson T2: 1.3.1 Montaj T2 (0%, FF, „#DIV/0!” în coloana de raport), 1.3.2 Variantă renunțată (inactivă)
"""
import os, sys


def construieste(cale):
    import jpype
    import mpxj  # noqa: F401
    if not jpype.isJVMStarted():
        jpype.startJVM('-Dlog4j2.loggerContextFactory=org.apache.logging.log4j.simple.SimpleLoggerContextFactory', convertStrings=True)
    from org.mpxj import ProjectFile, Duration, TimeUnit, RelationType, Relation
    from org.mpxj.writer import UniversalProjectWriter, FileFormat
    from java.time import LocalDateTime
    from java.lang import Integer, Double, Boolean

    def dt(s, ora=8):
        a, l, z = (int(x) for x in s.split('-'))
        return LocalDateTime.of(a, l, z, ora, 0)

    p = ProjectFile()
    pr = p.getProjectProperties()
    pr.setName('Lucrare test')
    pr.setStatusDate(dt('2026-04-30', 17))
    pr.setStartDate(dt('2026-03-02'))
    p.addDefaultBaseCalendar()
    ea, eb = p.addResource(), p.addResource()
    ea.setName('Echipa A')
    eb.setName('Echipa B')

    def sarcina(parinte, nume, wbs, start, finish, zile, pct, **k):
        t = (parinte or p).addTask()
        t.setName(nume)
        t.setOutlineNumber(wbs)
        t.setWBS(wbs)
        t.setOutlineLevel(Integer(len(wbs.split('.'))))
        t.setStart(dt(start))
        t.setFinish(dt(finish, 8 if zile == 0 else 17))
        t.setDuration(Duration.getInstance(zile, TimeUnit.DAYS))
        t.setPercentageComplete(Double(pct))
        t.setMilestone(bool(k.get('jalon')))
        t.setSummary(bool(k.get('rezumat')))
        t.setActive(Boolean(k.get('activ', True)))
        for c, v in (('bl', 'Baseline'), ('real', 'Actual')):
            if c + '_start' in k:
                getattr(t, f'set{v}Start')(dt(k[c + '_start']))
            if c + '_finish' in k:
                getattr(t, f'set{v}Finish')(dt(k[c + '_finish'], 17))
        if 'raportat' in k:
            t.setText(2, k['raportat'])
        if 'plan' in k:
            t.setText(5, k['plan'])
        for r in k.get('resurse', ()):
            t.addResourceAssignment(r)
        return t

    t1 = sarcina(None, 'Lucrare test', '1', '2026-03-02', '2026-06-26', 85, 35, rezumat=True, raportat='41,50%', plan='48.00%')
    t11 = sarcina(t1, 'Repere', '1.1', '2026-03-02', '2026-06-26', 85, 50, rezumat=True)
    m1 = sarcina(t11, 'Ordin de începere', '1.1.1', '2026-03-02', '2026-03-02', 0, 100, jalon=True,
                 bl_start='2026-03-02', bl_finish='2026-03-02', real_start='2026-03-02', real_finish='2026-03-02', raportat='100%', plan='100%')
    sarcina(t11, 'Recepție', '1.1.2', '2026-06-26', '2026-06-26', 0, 0, jalon=True, bl_start='2026-06-19', bl_finish='2026-06-19')
    t12 = sarcina(t1, 'Tronson T1', '1.2', '2026-03-02', '2026-05-22', 60, 55, rezumat=True)
    a1 = sarcina(t12, 'Decopertare', '1.2.1', '2026-03-02', '2026-03-13', 10, 100, bl_start='2026-03-02', bl_finish='2026-03-13',
                 real_start='2026-03-02', real_finish='2026-03-13', resurse=(ea,), raportat='100.00%')
    a2 = sarcina(t12, 'Montaj conductă', '1.2.2', '2026-03-16', '2026-05-08', 40, 60, bl_start='2026-03-09', bl_finish='2026-04-30',
                 real_start='2026-03-16', resurse=(ea, eb), raportat='55.25%', plan='80%')
    a3 = sarcina(t12, 'Probe de presiune', '1.2.3', '2026-05-11', '2026-05-22', 10, 0, resurse=(eb,))
    t13 = sarcina(t1, 'Tronson T2', '1.3', '2026-04-01', '2026-06-19', 58, 0, rezumat=True)
    b1 = sarcina(t13, 'Montaj T2', '1.3.1', '2026-04-01', '2026-06-19', 58, 0, raportat='#DIV/0!')
    sarcina(t13, 'Variantă renunțată', '1.3.2', '2026-04-01', '2026-04-10', 8, 0, activ=False)

    def leg(dupa, inainte, tip, lag):
        dupa.addPredecessor(Relation.Builder().predecessorTask(inainte).type(tip).lag(Duration.getInstance(lag, TimeUnit.DAYS)))

    leg(a1, m1, RelationType.FINISH_START, 0)
    leg(a2, a1, RelationType.START_START, 5)
    leg(a3, a2, RelationType.FINISH_START, -2)
    leg(b1, a1, RelationType.FINISH_FINISH, 0)
    UniversalProjectWriter(FileFormat.MSPDI).write(p, cale)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('utilizare: fixture_sintetic.py <iesire.xml>')
    construieste(os.path.abspath(sys.argv[1]))
    print('OK', sys.argv[1])
