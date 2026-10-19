"""Teste pentru banca fara om (Jakarinos #721 r2): localizarea fata de tinta inghetata, legatura cu esantionul, normalizarea fara
numere schimbate, schema etichetelor, auditul trecerii B. Fara retea, fara modele."""
import contextlib, io, json, pathlib, tempfile, unittest
from unittest.mock import patch
from ocr_local import banca as B


def eticheta(sus, jos, text='abc', **k):
    return dict({'zona': 'z01', 'tinta': 'unica', 'incredere': 'sigur', 'vecin_sus': sus, 'vecin_jos': jos, 'transcriere': text,
                 'continut': ['text']}, **k)


ZONA = {'zona': 'd1_p1_b0_t0', 'tip_zona': 'text', 'localizare': 'unica', 'ancora_sus': 'energie electrică ,', 'ancora_jos': 'catodică și fibră'}


class ZoneAncore(unittest.TestCase):
    band = dict(id='p1_b0', page=1, kind='text', image='pagina.png', image_sha256='0' * 64)

    def zone(self, a, b):
        return B.zone_banda('d1', self.band, a, {'ok': True}, b, {'ok': True})

    def test_doua_coloane_text_dupa_ancora_jos_in_a(self):
        a = 'sus alfa beta jos gama delta text mutat final unu doi'
        b = 'sus alfa beta text mutat jos gama delta final unu doi'
        zs = self.zone(a, b)
        self.assertTrue(zs)
        self.assertTrue(all(z['localizare'] == 'ambigua' and z['motiv_localizare'] == 'ordine_ancore' for z in zs))

    def test_ordine_normala(self):
        z, = self.zone('sus alfa beta vechi jos gama delta', 'sus alfa beta nou jos gama delta')
        self.assertEqual(z['localizare'], 'unica')
        self.assertEqual((z['ancora_sus'], z['ancora_jos']), ('sus alfa beta', 'jos gama delta'))
        self.assertNotIn('motiv_localizare', z)

    def test_ambigua_existenta_ramane_ambigua(self):
        z, = self.zone('sus alfa vechi jos gama', 'sus alfa nou jos gama')
        self.assertEqual(z['localizare'], 'ambigua')

    def test_ancora_lipsa_sau_neunica_b(self):
        # Pozitii de item explicite: verificarea trebuie sa refuze ancora din A
        # chiar daca un producator de itemi o omite sau o repeta in B.
        item = dict(id='p1_b0_t0', tip='text', e_cantitate=False,
                    pozitie={'lighton': [3, 4], 'mineru': [3, 4]})
        for b, motiv in (
                ('sus alfa beta nou alta gama delta', 'ancora_lipsa_b'),
                ('sus alfa beta nou jos gama delta jos gama delta', 'ancora_neunica_b')):
            with self.subTest(motiv=motiv), patch.object(B, 'compare_band', return_value=({}, [item])):
                z, = self.zone('sus alfa beta vechi jos gama delta', b)
                self.assertEqual(z['localizare'], 'ambigua')
                self.assertEqual(z['motiv_localizare'], motiv)

    def test_ordine_inversata_b(self):
        item = dict(id='p1_b0_t0', tip='text', e_cantitate=False,
                    pozitie={'lighton': [3, 4], 'mineru': [6, 7]})
        with patch.object(B, 'compare_band', return_value=({}, [item])):
            z, = self.zone('sus alfa beta vechi jos gama delta', 'sus alfa beta jos gama delta nou')
        self.assertEqual((z['localizare'], z['motiv_localizare']), ('ambigua', 'ordine_ancore'))

    def test_fragment_mutat_repetat_e_ambiguu(self):
        # review Copilot #786 P1: fragmentul mutat apare de 2 ori in A -> locul real nu se poate dovedi -> fail-closed
        item = dict(id='p1_b0_t0', tip='text', e_cantitate=False,
                    pozitie={'lighton': [3, 3], 'mineru': [3, 5]})
        with patch.object(B, 'compare_band', return_value=({}, [item])):
            z, = self.zone('sus alfa beta jos gama delta dn 500 x dn 500', 'sus alfa beta dn 500 jos gama delta x')
        self.assertEqual((z['localizare'], z['motiv_localizare']), ('ambigua', 'fragment_neunic'))

    def test_insertie_stergere_si_margini_ramane_unica(self):
        for a, b in (('sus alfa beta jos gama delta', 'sus alfa beta nou jos gama delta'),
                     ('sus alfa beta vechi jos gama delta', 'sus alfa beta jos gama delta'),
                     ('vechi jos gama delta', 'nou jos gama delta'),
                     ('sus alfa beta vechi', 'sus alfa beta nou')):
            with self.subTest(a=a, b=b):
                z, = self.zone(a, b)
                self.assertEqual(z['localizare'], 'unica')


class Localizare(unittest.TestCase):
    def test_ancorele_tintei(self):
        self.assertTrue(B.localizare_ok(eticheta('energie electrică,', 'catodică şi fibră'), ZONA))  # spatii, ş=ș
        self.assertFalse(B.localizare_ok(eticheta('alt loc de pe pagina', 'catodică și fibră'), ZONA))
        self.assertFalse(B.localizare_ok(eticheta('energie electrică,', 'catodică și fibră', vecin_jos=None), ZONA))

    def test_margine_cere_placeholder(self):
        z = dict(ZONA, ancora_sus=None)
        self.assertTrue(B.localizare_ok(eticheta('(inceputul paginii / tabelului)', 'catodică și fibră'), z))
        self.assertFalse(B.localizare_ok(eticheta('energie electrică,', 'catodică și fibră'), z))

    def test_doua_etichete_identice_pe_zona_gresita_nu_dau_acord(self):
        with tempfile.TemporaryDirectory() as t:
            b = self._banca(pathlib.Path(t), eticheta('alt loc de pe pagina', 'catodică și fibră'), eticheta('alt loc de pe pagina', 'catodică și fibră'))
            B.cmd_compara(type('A', (), {'banca': str(b), 'x': 'A', 'y': 'B'}))
            self.assertEqual(json.loads((b / 'compara_A_B.json').read_text(encoding='utf-8')), {ZONA['zona']: 'localizare_gresita_A'})

    def test_tinta_ambigua_nu_se_masoara(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = self._banca(pathlib.Path(t), e, e, zona=dict(ZONA, localizare='ambigua'))
            B.cmd_compara(type('A', (), {'banca': str(b), 'x': 'A', 'y': 'B'}))
            self.assertEqual(json.loads((b / 'compara_A_B.json').read_text(encoding='utf-8')), {ZONA['zona']: 'ambigue_ancora'})

    def test_compara_numara_ambigua_chiar_fara_etichete(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = self._banca(pathlib.Path(t), e, e, zona=dict(ZONA, localizare='ambigua'))
            (b / 'out' / 'A' / 'lot01.json').unlink()
            B.cmd_compara(type('A', (), dict(banca=str(b), x='A', y='B')))
            self.assertEqual(json.loads((b / 'compara_A_B.json').read_text(encoding='utf-8')), {ZONA['zona']: 'ambigue_ancora'})

    def test_esantion_exclude_si_numara_ambigue(self):
        with tempfile.TemporaryDirectory() as t:
            b = pathlib.Path(t)
            zs = [dict(ZONA, tipuri=['text'], e_cantitate=False),
                  dict(ZONA, zona='ambigua', tipuri=['text'], e_cantitate=False, localizare='ambigua')]
            (b / 'zone.jsonl').write_text('\n'.join(json.dumps(z) for z in zs), encoding='utf-8')
            B.cmd_esantion(type('A', (), dict(banca=str(b), n=50, samanta=1, rescrie=False)))
            es = json.loads((b / 'esantion.json').read_text(encoding='utf-8'))
            self.assertEqual([z['zona'] for z in es['zone']], [ZONA['zona']])
            self.assertEqual(es['ambigue_ancora'], 1)

    def test_raport_exclude_ambigue_chiar_fara_lot(self):
        for lipsa in (False, True):
            with self.subTest(lipsa=lipsa), tempfile.TemporaryDirectory() as t:
                e = eticheta('energie electrică,', 'catodică și fibră')
                b = self._banca(pathlib.Path(t), e, e, zona=dict(ZONA, localizare='ambigua'))
                if lipsa: (b / 'out' / 'A' / 'lot01.json').unlink()
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    B.cmd_raport(type('A', (), dict(banca=str(b), trecere='A')))
                rez = json.loads(out.getvalue())
                self.assertEqual(rez['ambigue_ancora'], 1)
                self.assertEqual(sum(rez['per_strat'].values()), 0)

    @staticmethod
    def _banca(root, ea, eb, zona=ZONA):
        (root / 'priv').mkdir(); (root / 'esantion.json').write_text(json.dumps({'zone': [dict(zona, strat='text+fara')]}), encoding='utf-8')
        for tr, e in (('A', ea), ('B', eb)):
            (root / 'priv' / ('harta_%s.json' % tr)).write_text(json.dumps({'lot01/z01': zona['zona']}), encoding='utf-8')
            B._scrie_legatura(root, tr)
            (root / 'out' / tr).mkdir(parents=True)
            (root / 'out' / tr / 'lot01.json').write_text(json.dumps({'meta': {'secunde': 1}, 'etichete': [e]}), encoding='utf-8')
        return root


class Legatura(unittest.TestCase):
    def test_esantion_rescris_refuzat(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = Localizare._banca(pathlib.Path(t), e, e)
            (b / 'esantion.json').write_text(json.dumps({'zone': [dict(ZONA, strat='text+fara', ancora_sus='alta')]}), encoding='utf-8')
            with self.assertRaises(SystemExit): B._etichete(b, 'A')
            with self.assertRaises(SystemExit): B.cmd_raport(type('A', (), {'banca': str(b), 'trecere': 'A'}))

    def test_rezultat_pentru_alt_esantion_invalid(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = Localizare._banca(pathlib.Path(t), e, e)
            f = b / 'out' / 'A' / 'lot01.json'; d = json.loads(f.read_text(encoding='utf-8')); d['meta']['esantion_sha256'] = '0' * 64
            f.write_text(json.dumps(d), encoding='utf-8')
            out, meta = B._etichete(b, 'A')
            self.assertEqual(out, {}); self.assertEqual(meta['lot01']['invalid'], 'alt esantion')

    def test_fara_legatura_refuzat(self):
        with tempfile.TemporaryDirectory() as t:
            e = eticheta('energie electrică,', 'catodică și fibră')
            b = Localizare._banca(pathlib.Path(t), e, e); (b / 'priv' / 'legatura_A.json').unlink()
            with self.assertRaises(SystemExit): B._etichete(b, 'A')


class Normalizare(unittest.TestCase):
    def test_constante_separate(self):
        self.assertEqual((B.ANCORA_MIN, B.ANCORA_NORM_MIN), (3, 8))

    def test_numere_la_granita(self):
        self.assertFalse(B._ancora_ok('1|Materiale', '11|Materiale', -1))
        self.assertFalse(B._ancora_ok('Total|1000', 'Total|10000', 1))
        self.assertTrue(B._ancora_ok('C.MEDIAȘabc', 'D.P.C.MEDIAȘabc', -1))

    def test_schema_incompleta_neeligibila(self):
        self.assertIsNone(B.cheie({'tinta': 'unica', 'incredere': 'sigur'}, 'text'))
        self.assertIsNotNone(B.cheie(eticheta('a', 'b', text='', continut=['gol']), 'text'))
        self.assertIsNone(B.cheie(eticheta('a', 'b', text=''), 'text'))  # gol fara „gol” declarat


class AuditB(unittest.TestCase):
    def test_primul_brief_end(self):
        c, lin = B._raspuns_codex('BRIEF_START\nx\nBRIEF_END\nexec\nls\nBRIEF_END\ncodex\n[1]\ntokens used')
        self.assertIn('exec', lin); self.assertEqual(c, '[1]')

    def test_fara_brief_end_invalid(self):
        c, lin = B._raspuns_codex('codex\n[1]\ntokens used')
        self.assertIsNone(c); self.assertTrue(lin and lin[0].startswith('exec'))


if __name__ == '__main__':
    unittest.main()
