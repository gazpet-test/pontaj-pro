"""Alunecarea eticheta - valoare in tabelele „breviar de calcul” (aliniere.py, cerere Razvan 27.11.2026).
Fixture reale (doar citire, copiate octet cu octet): PT V1 Lot 1 V1.1 p0120_b0 LightOn (ALUNECAT cu un rand), p0119_b0 / p0121_b0 si
Lot 2 p0105_b0 LightOn (aliniate corect); MinerU p0120_b0 fara stampila (liste separate de etichete si valori, fara tabel).
Rulare: PYTHONPATH=scripts python -m unittest discover -s scripts/ocr_local/tests/aliniere -v"""
import json
import pathlib
import re
import tempfile
import unittest

from ocr_local import aliniere as AL
from ocr_local import asamblare as A
from ocr_local.compare import compare_band, item_hash, segments
from ocr_local.reconcile import apply_band
from ocr_local.triere import triaza_banda

FIX = pathlib.Path(__file__).parent / 'fixtures'
OK = {'ok': True, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None}


def fix(nume):
    return (FIX / nume).read_bytes().decode('utf-8').replace('\r\n', '\n')  # checkout CRLF pe Windows = acelasi text


P120 = fix('v11_p0120_b0_lighton.txt')
P120_MINERU = fix('v11_p0120_b0_mineru_fara_stampila.txt')
CORECTE = {n: fix(n) for n in ('v11_p0119_b0_lighton.txt', 'v11_p0121_b0_lighton.txt', 'l2_p0105_b0_lighton.txt')}


def tabele(raw):
    return [v for k, v in segments(raw) if k == 'table']


def banda(bid='p0120_b0', page=120):
    return {'id': bid, 'page': page, 'kind': 'text', 'image': 'x.png', 'image_sha256': '0' * 64}


def tabel(perechi, titlu=True):
    """Tabel sintetic [eticheta, valoare] din perechi (eticheta_simbol | None, valoare_simbol | None)."""
    rows = [['Date de proiectare (intrare):', '']] if titlu else []
    for i, (e, v) in enumerate(perechi):
        rows.append(['Marime %d, %s' % (i, e) if e else 'Marime %d' % i, ('%s = %d,5 u' % (v, i)) if v else '= %d,5 u' % i])
    return rows


def deplaseaza(rows, k):
    """Valorile alunecă: valoarea etichetei de pe randul i ajunge pe randul i + k. Grila se extinde cat e nevoie (randuri cu
    eticheta goala), deci nicio valoare nu cade din tabel."""
    n = len(rows); lo = min(0, k); hi = max(n, n + k)
    grila = [[''] + [''] * (len(rows[0]) - 1) for _ in range(hi - lo)]
    for i in range(n):
        grila[i - lo][0] = rows[i][0]; grila[i + k - lo][1:] = rows[i][1:]
    return grila


def valori(rows):
    return sorted(c for r in rows for c in r[1:] if c.strip())


class Detector(unittest.TestCase):
    def test_p0120_alunecat_cu_un_rand(self):
        (t,) = tabele(P120)
        d = AL.detecteaza(t)
        self.assertEqual((d['semnal'], d['k']), (AL.SEMNAL_ALUNECARE, -1))
        self.assertEqual((d['perechi'], d['potrivite']), (4, 0))
        self.assertEqual(d['randuri'], [2, 3, 5, 6])  # D / l_w / SMYS / F: simbol diferit intre eticheta si valoare pe acelasi rand
        self.assertEqual(d['contradictii'], [])
        prop = {r[0]: r[1:] for r in d['propunere']}
        # ce arata imaginea: p = 0 MPa, SMYS = 355 MPa, D = 813 mm, B_d = 864 mm; randul-titlu ramane fara valoare
        self.assertEqual(prop['Présiunea, p'], ['p =', '0 MPa'])
        self.assertEqual(prop['Limita de curgere, SMYS'], ['=', '355 MPa'])
        self.assertEqual(prop['Diametr exterior, D'], ['D =', '813 mm'])
        self.assertEqual(prop['Diametrul găurii, B_{d}'], ['B_{d} =', '864 mm'])
        self.assertEqual(prop['Date de protectare (intrare):'], ['', ''])
        self.assertEqual(t[4], ['Présiunea, p', '=', '355 MPa'])  # citirea nu se atinge

    def test_tabele_aliniate_corect_nu_se_semnaleaza(self):
        for n, raw in CORECTE.items():
            ts = tabele(raw)
            self.assertTrue(ts, n)
            for t in ts:
                self.assertIsNone(AL.detecteaza(t), n)
                # si perechile chiar exista (detectorul nu e tacut pentru ca nu vede nimic)
                pr = [(AL.simbol_eticheta(r[0]), AL._simbol_valori(r)) for r in t if r]
                self.assertGreaterEqual(sum(1 for a, b in pr if a and a == b), 5, n)

    def test_fara_simboluri_nimic(self):
        rows = [['Material', '= S355JR'], ['Mod pozare', '= foraj'], ['Tipul solului', '= A'], ['Tip linie', '= simpla']]
        self.assertIsNone(AL.detecteaza(rows))

    def test_doua_perechi_sub_prag(self):
        rows = deplaseaza(tabel([('a', 'a'), ('b', 'b')]), -1)
        self.assertIsNone(AL.detecteaza(rows))

    def test_majoritatea_potrivite_nu_e_alunecare(self):
        rows = tabel([('a', 'a'), ('b', 'b'), ('c', 'c'), ('d', 'x')])  # o greseala izolata = treaba comparatiei
        self.assertIsNone(AL.detecteaza(rows))

    def test_simbol_repetat_aliniat_nimic(self):
        rows = tabel([('p', 'p'), ('t', 't'), ('p', 'p'), ('t', 't'), ('p', 'p')])
        self.assertIsNone(AL.detecteaza(rows))

    def test_simbol_repetat_deplasare_ambigua_neclar(self):
        # a, b, a, b...: si k = -1 si k = +1 explica tot -> nu se poate alege, fara propunere
        rows = tabel([('a', 'b'), ('b', 'a'), ('a', 'b'), ('b', 'a'), ('a', 'b'), ('b', 'a')], titlu=False)
        d = AL.detecteaza(rows)
        self.assertEqual(d['semnal'], AL.SEMNAL_NECLAR)
        self.assertIsNone(d['k']); self.assertIsNone(d['propunere'])
        self.assertEqual(d['deplasari_posibile'], [-1, 1])

    def test_deplasare_care_nu_explica_tot_neclar(self):
        rows = tabel([('a', 'c'), ('b', 'e'), ('c', 'a'), ('d', 'b'), ('e', 'd')])
        d = AL.detecteaza(rows)
        self.assertEqual(d['semnal'], AL.SEMNAL_NECLAR)
        self.assertIsNone(d['k']); self.assertIsNone(d['propunere']); self.assertEqual(d['deplasari_posibile'], [])

    def test_toate_minus_una_cu_contradictie_marcata(self):
        rows = deplaseaza(tabel([('a', 'a'), ('b', 'b'), ('c', 'c'), ('d', 'd'), ('e', 'e')]), -1)
        rows[3][1] = 'x = 9 u'  # valoarea lui c (deplasata pe randul 3) citita cu alt simbol
        d = AL.detecteaza(rows)
        self.assertEqual((d['semnal'], d['k']), (AL.SEMNAL_ALUNECARE, -1))
        self.assertEqual(d['contradictii'], [4])  # randul etichetei „c” (indice in tabelul citit)
        marcate = [r[0] for r in d['propunere'] if r[0].startswith('(?) ')]
        self.assertEqual(marcate, ['(?) Marime 2, c'])

    def test_doua_contradictii_nu_mai_e_sigur(self):
        rows = deplaseaza(tabel([('a', 'a'), ('b', 'b'), ('c', 'c'), ('d', 'd'), ('e', 'e')]), -1)
        rows[3][1] = 'x = 9 u'; rows[4][1] = 'y = 9 u'
        self.assertEqual(AL.detecteaza(rows)['semnal'], AL.SEMNAL_NECLAR)

    def test_deplasari_plus_unu_si_doi(self):
        baza = tabel([('a', 'a'), ('b', 'b'), ('c', 'c'), ('d', 'd'), ('e', 'e')])
        for k in (1, 2, -1, -2):
            rows = deplaseaza(baza, k)
            d = AL.detecteaza(rows)
            self.assertEqual((d['semnal'], d['k']), (AL.SEMNAL_ALUNECARE, k), k)
            prop = {r[0]: r[1:] for r in d['propunere']}
            for e in 'abcde':  # realinierea refacuta = tabelul corect, pe fiecare eticheta
                self.assertEqual(prop['Marime %d, %s' % ('abcde'.index(e), e)], ['%s = %d,5 u' % (e, 'abcde'.index(e))], k)
            self.assertEqual(valori(d['propunere']), valori(rows), k)  # nicio valoare citita nu dispare din propunere

    def test_valoare_fara_eticheta_la_margine_nu_se_pierde(self):
        # k = -1: valoarea de pe ULTIMUL rand („f = 5 u”) ar apartine unei etichete de dupa tabel -> rand propriu, nu se pierde
        rows = [['Titlu', 'a = 0 u'], ['Marime 0, a', 'b = 1 u'], ['Marime 1, b', 'c = 2 u'], ['Marime 2, c', 'd = 3 u'],
                ['Marime 3, d', 'e = 4 u'], ['Marime 4, e', 'f = 5 u']]
        d = AL.detecteaza(rows)
        self.assertEqual((d['semnal'], d['k']), (AL.SEMNAL_ALUNECARE, -1))
        self.assertEqual(valori(d['propunere']), valori(rows))
        self.assertIn(['(fără etichetă)', 'f = 5 u'], d['propunere'])
        self.assertIn(['Titlu', ''], d['propunere'])

    def test_randurile_goale_nu_rup_deplasarea(self):
        rows = deplaseaza(tabel([('a', 'a'), ('b', 'b'), ('c', 'c'), ('d', 'd')]), -1)
        rows.insert(3, ['', ''])
        d = AL.detecteaza(rows)
        self.assertEqual((d['semnal'], d['k']), (AL.SEMNAL_ALUNECARE, -1))

    def test_normalizarea_simbolurilor(self):
        V, E = AL.simbol_valoare, AL.simbol_eticheta
        self.assertEqual(V('\\(t_w =\\) 14.2 mm'), 'tw')
        self.assertEqual(V('$t_w =$'), 'tw')
        self.assertEqual(V('$B_d$ = 864 mm'), 'bd')
        self.assertEqual(V('\\( B_{d}= \\)  864 mm'), 'bd')
        self.assertEqual(V('l_{w} ='), 'lw')
        self.assertEqual(V('B<sub>d</sub> ='), 'bd')
        self.assertEqual(V('\\gamma = 18.9 KN/mc'), 'γ')
        self.assertEqual(V('Γ = 1'), 'γ')
        self.assertEqual(V('smys := 355'), 'smys')
        self.assertIsNone(V('= 355 MPa'))
        self.assertIsNone(V('Mod pozare = foraj'))
        self.assertEqual(E('Diametrul găurii, B\\( _{d} \\)'), 'bd')
        self.assertEqual(E('Grosime perete, $t_w$'), 'tw')
        self.assertEqual(E('Greutatea vol. a solului, $\\gamma$'), 'γ')
        self.assertEqual(E('Limita de curgere, SMYS'), 'smys')
        self.assertEqual(E('Coeﬁcient de siguranță, F:'), 'f')
        self.assertIsNone(E('Material conductă (tub protecție)'))
        self.assertIsNone(E('Date de proiectare (intrare):'))


class Comparatie(unittest.TestCase):
    def test_p0120_semnal_in_dezacorduri_cu_cititor_k_randuri(self):
        s, items = compare_band(banda(), P120, OK, P120_MINERU, OK)
        al = [i for i in items if i.get('semnal')  in AL.SEMNALE]
        self.assertEqual(len(al), 1)
        it = al[0]
        self.assertEqual((it['tip'], it['semnal'], it['cititor'], it['k']), ('structura_tabele', AL.SEMNAL_ALUNECARE, 'lighton', -1))
        self.assertEqual(it['randuri'], [2, 3, 5, 6]); self.assertTrue(it['e_cantitate'])
        self.assertRegex(it['id'], r'^p[0-9]{4}_b[0-9]{1,2}_')  # forma ceruta de fn_ofertare_ocr_scrie_dezacord
        self.assertIn('Présiunea, p | = | 355 MPa', it['citire_lighton']); self.assertEqual(it['citire_mineru'], '')
        self.assertEqual(s['aliniere'], [it['id']])
        json.dumps(it, ensure_ascii=False); self.assertEqual(len(item_hash(it)), 64)

    def test_semnal_si_cand_cititorii_nu_difera(self):
        s, items = compare_band(banda(), P120, OK, P120, OK)  # aceeasi citire la ambii: zero dezacorduri obisnuite
        self.assertEqual(sorted(i['cititor'] for i in items), ['lighton', 'mineru'])
        self.assertTrue(all(i['tip'] == 'structura_tabele' and i['semnal'] == AL.SEMNAL_ALUNECARE for i in items))
        self.assertEqual(s['disagreements'], 2)

    def test_aliniate_identice_zero_dezacorduri(self):
        for n, raw in CORECTE.items():
            s, items = compare_band(banda(), raw, OK, raw, OK)
            self.assertEqual((items, s['disagreements']), ([], 0), n); self.assertNotIn('aliniere', s)

    def test_reconcilierea_si_trierea_trimit_banda_la_om(self):
        _, items = compare_band(banda(), P120, OK, P120, OK)
        self.assertEqual(apply_band(P120, P120, items, {}), (None, True))  # fara decizie = om
        self.assertTrue(all(k == 'OM' for k, _ in triaza_banda(P120, P120, items).values()))


class Asamblare(unittest.TestCase):
    def rulare(self, raw):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup); rd = pathlib.Path(tmp.name)
        (rd / 'd1').mkdir(); (rd / 'd1' / 'plan.json').write_text(json.dumps({'bands': [{'id': 'p0120_b0', 'page': 120, 'index': 0}]}), encoding='utf-8')
        import hashlib
        d = rd / 'd1' / 'page0120' / 'p0120_b0' / 'lighton'; d.mkdir(parents=True)
        (d / 'raw.txt').write_bytes(raw.encode('utf-8'))
        (d / 'result.json').write_text(json.dumps({'ok': True, 'raw_sha256': hashlib.sha256(raw.encode()).hexdigest()}), encoding='utf-8')
        return A.asambleaza_document(rd, 'd1', pagini_native={120: ''})

    def test_p0120_marcaj_si_propunere_separata_citirea_neschimbata(self):
        text, st = self.rulare(P120)
        self.assertIn('etichetele și valorile pot fi decalate cu 1 rând', text)
        self.assertIn('verifică pe imagine pag. 120', text)
        self.assertIn('⟦propunere⟧ Présiunea, p | p = | 0 MPa', text)
        self.assertIn('| Présiunea, p | = | 355 MPa |', text)  # randul citit ramane cum l-a citit LightOn
        # marcajul + propunerea stau INAINTEA tabelului; nicio linie de propunere nu arata ca un rand de tabel citit
        self.assertLess(text.index('⟦ATENȚIE'), text.index('| Date de protectare'))
        self.assertFalse([l for l in text.split('\n') if 'propunere' in l.lower() and l.lstrip().startswith('|')])
        self.assertEqual(st['aliniere_de_verificat'], 1)
        self.assertEqual(st['lista_aliniere'], [{'banda': 'p0120_b0', 'cititor': 'lighton', 'segment': 1,
                                                 'semnal': AL.SEMNAL_ALUNECARE, 'k': -1}])

    def test_aliniat_corect_fara_marcaj(self):
        for n, raw in CORECTE.items():
            text, st = self.rulare(raw)
            self.assertNotIn('⟦ATENȚIE', text, n); self.assertNotIn('propunere', text, n); self.assertEqual(st['aliniere_de_verificat'], 0)

    def test_neclar_marcaj_fara_propunere(self):
        rows = tabel([('a', 'c'), ('b', 'e'), ('c', 'a'), ('d', 'b'), ('e', 'd')])
        raw = '<table>' + ''.join('<tr>' + ''.join('<td>%s</td>' % c for c in r) + '</tr>' for r in rows) + '</table>'
        text, st = self.rulare(raw)
        self.assertIn('deplasare neclară', text); self.assertNotIn('PROPUNERE', text)
        self.assertEqual(st['lista_aliniere'][0]['semnal'], AL.SEMNAL_NECLAR)


class FaraCaractereDeControl(unittest.TestCase):
    def test_sursa_fara_caractere_de_control(self):
        src = (pathlib.Path(AL.__file__)).read_text(encoding='utf-8')
        self.assertFalse(re.findall(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', src))


if __name__ == '__main__':
    unittest.main()
