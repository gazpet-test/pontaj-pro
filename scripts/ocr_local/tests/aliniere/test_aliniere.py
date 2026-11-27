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

    def test_egalitate_doua_potrivite_doua_nepotrivite_nimic(self):
        # „majoritatea NU se potrivesc” e STRICTA: 2 / 2 nu e semnal, chiar daca o deplasare ar explica jumatatea de jos
        # (Jakarinos r1 P3: mutantul <= -> < trecea toate testele)
        rows = [['Marime 0, a', 'a = 0 u'], ['Marime 1, b', 'b = 1 u'], ['Marime 2, c', 'd = 3 u'], ['Marime 3, d', 'e = 4 u'],
                ['Marime 4, e', '= 5 u']]
        self.assertIsNone(AL.detecteaza(rows))
        rows[1][1] = 'z = 1 u'  # 1 potrivita / 3 nepotrivite -> semnal (aceeasi forma, doar majoritatea schimbata)
        self.assertIsNotNone(AL.detecteaza(rows))

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
        # L13: simbolul e la COADA etichetei (dupa ultima virgula), iar valoarea INCEPE cu simbolul
        self.assertIsNone(E('Diametru, D exterior'))
        self.assertIsNone(E('Presiunea, p (bar)'))
        self.assertIsNone(E('Lungime, L totala in m'))
        self.assertIsNone(V('Valoarea p = 3'))
        self.assertIsNone(V('rezulta p = 3'))


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


TABEL_P120 = re.search(r'<table>.*?</table>', P120, re.S).group(0)
TR_P120 = re.findall(r'<tr>.*?</tr>', TABEL_P120, re.S)


class Asamblare(unittest.TestCase):
    def rulare(self, benzi):
        """benzi = [(bid, {cititor: raw})] pe pagina 120; fiecare citire ok = true cu raw_sha256 corect."""
        import hashlib
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup); rd = pathlib.Path(tmp.name)
        (rd / 'd1').mkdir()
        (rd / 'd1' / 'plan.json').write_text(json.dumps({'bands': [{'id': b, 'page': 120, 'index': i} for i, (b, _) in enumerate(benzi)]}),
                                             encoding='utf-8')
        for bid, citiri in benzi:
            for c, x in citiri.items():
                raw, res = x if isinstance(x, tuple) else (x, OK)  # (raw, result) sau doar raw (ok = true)
                d = rd / 'd1' / 'page0120' / bid / c; d.mkdir(parents=True)
                (d / 'raw.txt').write_bytes(raw.encode('utf-8'))
                (d / 'result.json').write_text(json.dumps(dict(res, raw_sha256=hashlib.sha256(raw.encode()).hexdigest())), encoding='utf-8')
        return A.asambleaza_document(rd, 'd1', pagini_native={120: ''})

    def test_p0120_marcaj_si_propunere_separata_citirea_neschimbata(self):
        text, st = self.rulare([('p0120_b0', {'lighton': P120, 'mineru': P120_MINERU})])
        self.assertIn('⟦ATENȚIE (pag. 120, banda p0120_b0, citirea lighton, segmentul 1): în tabelul care începe cu '
                      '„Date de protectare (intrare):” etichetele și valorile pot fi decalate cu 1 rând — verifică pe imagine⟧', text)
        self.assertIn('⟦propunere⟧ Présiunea, p | p = | 0 MPa', text)
        self.assertIn('| Présiunea, p | = | 355 MPa |', text)  # randul citit ramane cum l-a citit LightOn
        # avertismentul + propunerea stau la inceputul paginii; nicio linie de propunere nu arata ca un rand de tabel citit
        self.assertLess(text.index('⟦ATENȚIE'), text.index('| Date de protectare'))
        self.assertTrue(text.startswith('⟦PAGINA 120⟧\n⟦ATENȚIE'))
        self.assertFalse([l for l in text.split('\n') if 'propunere' in l.lower() and l.lstrip().startswith('|')])
        self.assertEqual(st['aliniere_de_verificat'], 1)
        self.assertEqual(st['lista_aliniere'], [{'banda': 'p0120_b0', 'cititor': 'lighton', 'segment': 1,
                                                 'semnal': AL.SEMNAL_ALUNECARE, 'k': -1, 'in_text': True}])

    def test_semnalul_mineru_ajunge_in_text_cand_textul_e_din_lighton(self):
        # Jakarinos r1 P2: LightOn valid fara tabel, MinerU cu tabelul decalat -> comparatia semnaleaza, deci si textul + contorul
        lighton = 'Breviar de calcul\n\nDate de proiectare citite ca text, fara tabel.'
        text, st = self.rulare([('p0120_b0', {'lighton': lighton, 'mineru': P120})])
        self.assertIn('Date de proiectare citite ca text', text)  # textul paginii ramane din LightOn
        self.assertIn('citirea mineru, segmentul 1 (textul de mai jos e din citirea lighton)', text)
        self.assertIn('⟦propunere⟧ Présiunea, p | p = | 0 MPa', text)
        self.assertEqual(st['lista_aliniere'], [{'banda': 'p0120_b0', 'cititor': 'mineru', 'segment': 1,
                                                 'semnal': AL.SEMNAL_ALUNECARE, 'k': -1, 'in_text': False}])

    def test_paritate_cu_comparatia(self):
        # aceleasi semnale (cititor, segment, semnal, k) in dezacorduri.jsonl si in text_conv, pe aceleasi citiri
        for la, lm in ((P120, P120_MINERU), (P120_MINERU, P120), (P120, P120)) + tuple((r, r) for r in CORECTE.values()):
            _, items = compare_band(banda(), la, OK, lm, OK)
            din_cmp = sorted((i['cititor'], i['segment'], i['semnal'], i['k']) for i in items if i.get('semnal') in AL.SEMNALE)
            _, st = self.rulare([('p0120_b0', {'lighton': la, 'mineru': lm})])
            self.assertEqual(sorted((x['cititor'], x['segment'], x['semnal'], x['k']) for x in st['lista_aliniere']), din_cmp)

    def test_paritate_pe_banda_goala_si_citire_incompleta(self):
        # Jakarinos r2 P2: o citire goala / incompleta la un cititor, tabelul decalat la celalalt (valid): semnalul e in dezacorduri
        # (pe langa banda_goala_de_verificat / banda_intreaga) si in text, cu aceleasi (cititor, segment, semnal, k)
        GOL = {'ok': False, 'gol_de_verificat': True, 'finish_reason': 'stop', 'signal': None, 'guard_event': None, 'error': None}
        RUPT = {'ok': False, 'finish_reason': 'length', 'signal': 'bucla', 'guard_event': None, 'error': None}
        for nume, x_rau, tip in (('goala', ('', GOL), 'banda_goala_de_verificat'), ('incompleta', ('BUCLA ' * 20, RUPT), 'banda_intreaga')):
            for valid in ('lighton', 'mineru'):
                citiri = {valid: (P120, OK), ('mineru' if valid == 'lighton' else 'lighton'): x_rau}
                (la, ra), (lm, rm) = citiri['lighton'], citiri['mineru']
                s, items = compare_band(banda(), la, ra, lm, rm)
                self.assertEqual(items[0]['tip'], tip, (nume, valid))  # randul existent ramane primul (reconcile se bazeaza pe asta)
                din_cmp = [(i['cititor'], i['segment'], i['semnal'], i['k']) for i in items if i.get('semnal') in AL.SEMNALE]
                self.assertEqual(din_cmp, [(valid, 1, AL.SEMNAL_ALUNECARE, -1)], (nume, valid))
                self.assertEqual((s.get('disagreements'), s['aliniere']), (2 if nume == 'goala' else None, ['p0120_b0_aliniere_%s_s1' % valid]),
                                 (nume, valid))  # rezumatul „citire incompleta” nu are disagreements (ca pe main)
                self.assertEqual(apply_band(la, lm, items, {}), (None, True))
                _, st = self.rulare([('p0120_b0', citiri)])
                self.assertEqual([(x['cititor'], x['segment'], x['semnal'], x['k']) for x in st['lista_aliniere']], din_cmp, (nume, valid))

    def test_cusatura_cu_banda_precedenta_nu_se_strica(self):
        # Jakarinos r1 P2: tabelul decalat DESCHIDE banda a doua, iar primele lui doua randuri sunt suprapunerea cu banda intai.
        # Cusatura se face pe textul neadnotat: reuseste, randurile suprapuse apar o singura data, avertismentul e in pagina.
        b0 = 'Verificarea tubului de protectie\n\n<table>' + ''.join(TR_P120[:2]) + '</table>'
        b1 = TABEL_P120
        text, st = self.rulare([('p0120_b0', {'lighton': b0}), ('p0120_b1', {'lighton': b1})])
        self.assertEqual(st['cusaturi_nesigure'], 0)
        self.assertEqual(text.count('| Material conductă (tub protecție) | D = | 813 mm |'), 1)
        self.assertIn('banda p0120_b1, citirea lighton', text)
        self.assertEqual([x['banda'] for x in st['lista_aliniere']], ['p0120_b1'])

    def test_aliniat_corect_fara_marcaj(self):
        for n, raw in CORECTE.items():
            text, st = self.rulare([('p0120_b0', {'lighton': raw, 'mineru': raw})])
            self.assertNotIn('⟦ATENȚIE', text, n); self.assertNotIn('propunere', text, n); self.assertEqual(st['aliniere_de_verificat'], 0)

    def test_neclar_marcaj_fara_propunere(self):
        rows = tabel([('a', 'c'), ('b', 'e'), ('c', 'a'), ('d', 'b'), ('e', 'd')])
        raw = '<table>' + ''.join('<tr>' + ''.join('<td>%s</td>' % c for c in r) + '</tr>' for r in rows) + '</table>'
        text, st = self.rulare([('p0120_b0', {'lighton': raw})])
        self.assertIn('deplasare neclară', text); self.assertNotIn('PROPUNERE', text)
        self.assertEqual(st['lista_aliniere'][0]['semnal'], AL.SEMNAL_NECLAR)


class FaraCaractereDeControl(unittest.TestCase):
    def test_sursa_fara_caractere_de_control(self):
        src = (pathlib.Path(AL.__file__)).read_text(encoding='utf-8')
        self.assertFalse(re.findall(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', src))


if __name__ == '__main__':
    unittest.main()
