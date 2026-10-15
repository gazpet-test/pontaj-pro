"""Teste fara retea, fara browser real si fara BD:  PYTHONPATH=scripts python -B -m unittest egress_colector.test_egress_colector -v
Fixture: fixture_usage_20261015.txt = textul real al paginii Usage (inner_text, citit 15.10.2026), de la „Usage” pana la
sectiunea „Activity”; numele proiectului inlocuit cu „Proiect-Test”."""
import io, json, os, re, shutil, subprocess, tempfile, time, unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest import mock

from egress_colector import __main__ as M
from egress_colector import bd as B
from egress_colector import pagina as G
from egress_colector import parsare as P

AICI = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(AICI, 'fixture_usage_20261015.txt')
AZI = date(2026, 10, 15)
NB = '\u00a0\u00a0'


def text_fixture():
    with open(FIXTURE, encoding='utf-8') as f:
        return f.read()


def pagina(egress='4.402 / 250 GB' + NB + '(2%)', cached='0.08 / 250 GB' + NB + '(<1%)',
           storage='14.586 / 100 GB' + NB + '(15%)', ciclu='07 Oct 2026 - 07 Nov 2026',
           extra='Edge Function Invocations\n\n70,803 / 2,000,000' + NB + '(4%)'):
    """Pagina sintetica cu structura celei reale (eticheta pe un rand, valoarea pe urmatorul rand nevid)."""
    p = ['Usage', 'Current billing cycle', 'All projects', '', 'Organization is on the Pro Plan', '', ciclu, '',
         'Usage Summary', '', extra, '']
    for et, v in (('Storage Size', storage), ('Egress', egress), ('Cached Egress', cached)):
        if v is not None:
            p += [et, '', v, '']
    return '\n'.join(p)


def citire(**kw):
    c = dict(egress_bytes=4615000000, cached_egress_bytes=78000000, storage_size_bytes=14586000000,
             ciclu_start=date(2026, 10, 7), ciclu_sfarsit=date(2026, 11, 7),
             valori={'egress': '4.615 / 250 GB', 'cached_egress': '0.078 / 250 GB', 'storage_size': '14.586 / 100 GB',
                     'ciclu': '07 Oct 2026 - 07 Nov 2026'},
             randuri={'egress': '4.615 / 250 GB (2%)', 'cached_egress': '0.078 / 250 GB (<1%)',
                      'storage_size': '14.586 / 100 GB (15%)', 'ciclu': '07 Oct 2026 - 07 Nov 2026'},
             cote={'egress': 250 * 10 ** 9, 'cached_egress': 250 * 10 ** 9, 'storage_size': 100 * 10 ** 9}, zecimal='.')
    c.update(kw)
    return P.Citire(**c)


def citire_azi():
    """Citire cu ciclul care contine ziua reala de azi (pentru caile care valideaza fata de ceasul real)."""
    azi = datetime.now(timezone.utc).date()
    s = date(azi.year, azi.month, 7)
    if azi < s:
        s = date(azi.year - 1, 12, 7) if azi.month == 1 else date(azi.year, azi.month - 1, 7)
    return citire(ciclu_start=s, ciclu_sfarsit=P.plus_o_luna(s))


CITIT_LA = datetime(2026, 10, 15, 6, 30, 0, tzinfo=timezone.utc)
ACUM = CITIT_LA + timedelta(minutes=1)


# ── parser ────────────────────────────────────────────────────────────────────────────────────────────────────────────

class TestParserPaginaReala(unittest.TestCase):
    def test_fixture_reala(self):
        c = P.parseaza(text_fixture(), AZI)
        self.assertEqual((c.egress_bytes, c.cached_egress_bytes, c.storage_size_bytes), (4615000000, 78000000, 14586000000))
        self.assertEqual((c.ciclu_start, c.ciclu_sfarsit), (date(2026, 10, 7), date(2026, 11, 7)))
        self.assertEqual(c.zecimal, '.')
        self.assertEqual(c.randuri['egress'], '4.615 / 250 GB (2%)')
        self.assertEqual(c.randuri['cached_egress'], '0.078 / 250 GB (<1%)')
        self.assertEqual(c.randuri['storage_size'], '14.586 / 100 GB (15%)')
        self.assertEqual(c.cote, {'egress': 250 * 10 ** 9, 'cached_egress': 250 * 10 ** 9, 'storage_size': 100 * 10 ** 9})

    def test_fixture_cu_crlf(self):
        self.assertEqual(P.parseaza(text_fixture().replace('\n', '\r\n'), AZI).egress_bytes, 4615000000)

    def test_fixture_etichetele_din_detalii_nu_dau_a_doua_valoare(self):
        # „Egress” apare de 3 ori (rezumat + 2 in detalii), „Cached Egress” / „Storage Size” de 2 ori
        linii = [l for l in text_fixture().split('\n') if l.strip()]
        self.assertEqual(sum(1 for l in linii if l.strip() == 'Egress'), 3)
        self.assertEqual(len(P.gaseste_raport(linii, 'Egress')), 1)
        self.assertEqual(len(P.gaseste_raport(linii, 'Cached Egress')), 1)
        self.assertEqual(len(P.gaseste_raport(linii, 'Storage Size')), 1)

    def test_fixture_alta_zi_in_afara_ciclului(self):
        with self.assertRaisesRegex(P.EroareParsare, 'nu contine ziua de azi'):
            P.parseaza(text_fixture(), date(2026, 11, 8))

    def test_exemplul_din_cerere(self):
        c = P.parseaza(pagina(), AZI)
        self.assertEqual(c.egress_bytes, 4402000000)       # „4.402 / 250 GB” = 4,402 GB zecimali
        self.assertEqual(c.cached_egress_bytes, 80000000)
        self.assertEqual(c.storage_size_bytes, 14586000000)


class TestSeparatoare(unittest.TestCase):
    def test_virgula_de_mii_punct_zecimal(self):
        c = P.parseaza(pagina(egress='1,234.5 / 250 GB' + NB + '(494%)'), AZI)
        self.assertEqual(c.egress_bytes, 1234500000000)

    def test_virgula_zecimala_punct_de_mii(self):
        c = P.parseaza(pagina(egress='4,402 / 250 GB (2%)', cached='0,08 / 250 GB (<1%)', storage='14,586 / 100 GB (15%)',
                              extra='Edge Function Invocations\n70.803 / 2.000.000 (4%)'), AZI)
        self.assertEqual((c.egress_bytes, c.cached_egress_bytes, c.storage_size_bytes), (4402000000, 80000000, 14586000000))
        self.assertEqual(c.zecimal, ',')

    def test_nbsp_ca_separator_de_mii(self):
        c = P.parseaza(pagina(egress='1\u00a0234,5 / 250 GB (494%)', cached='0,08 / 250 GB (<1%)',
                              storage='14,586 / 100 GB (15%)', extra='Realtime Messages\n0 / 5\u00a0000\u00a0000'), AZI)
        self.assertEqual(c.egress_bytes, 1234500000000)

    def test_ambiguu_fara_dovada_pe_pagina(self):
        with self.assertRaisesRegex(P.EroareParsare, 'ambiguu'):
            P.parseaza(pagina(egress='4.402 / 250 GB', cached='1.234 / 250 GB', storage='14.586 / 100 GB', extra=''), AZI)

    def test_separatori_contradictorii(self):
        with self.assertRaisesRegex(P.EroareParsare, 'amesteca'):
            P.parseaza(pagina(egress='4,40 / 250 GB'), AZI)   # „4,40” = zecimal ',' dar „2,000,000” = mii ','

    def test_procentul_prinde_factorul_1000(self):
        # aceeasi cifra citita cu alta conventie ar da 4615 GB; procentul afisat (2%) o respinge
        with self.assertRaisesRegex(P.EroareParsare, 'procentul'):
            P.parseaza(pagina(egress='4,615 / 250 GB (2%)', extra='Edge Function Invocations\n70,803 / 2,000,000'), AZI)

    def test_procent_nepotrivit(self):
        with self.assertRaisesRegex(P.EroareParsare, 'procentul'):
            P.parseaza(pagina(egress='4.615 / 250 GB (40%)'), AZI)

    def test_procent_sub_unu_nepotrivit(self):
        with self.assertRaisesRegex(P.EroareParsare, 'procentul'):
            P.parseaza(pagina(cached='5.5 / 250 GB (<1%)'), AZI)

    def test_fara_procent_refuz(self):
        # procentul e obligatoriu (Jakarinos r1 P1): fara el nu se poate verifica separatorul
        with self.assertRaisesRegex(P.EroareParsare, 'lipseste procentul'):
            P.parseaza(pagina(egress='4.615 / 250 GB'), AZI)

    def test_zero_fara_procent_acceptat(self):
        # pagina reala nu afiseaza procent la zero („0 / 50 MAU”); „0” nu are separator, deci nu poate fi citit gresit
        self.assertEqual(P.parseaza(pagina(cached='0 / 250 GB'), AZI).cached_egress_bytes, 0)
        with self.assertRaisesRegex(P.EroareParsare, 'lipseste procentul'):
            P.parseaza(pagina(cached='0.000 / 250 GB'), AZI)

    def test_procent_pe_randul_urmator(self):
        self.assertEqual(P.parseaza(pagina(egress='4.615 / 250 GB\n(2%)'), AZI).egress_bytes, 4615000000)
        self.assertEqual(P.parseaza(pagina(egress='4.615 / 250 GB\n\n' + NB + '(2%)'), AZI).egress_bytes, 4615000000)

    def test_r1_p1_procent_pe_randul_urmator_nepotrivit(self):
        # Jakarinos r1 P1, exemplul exact: „4,615 / 250 GB\n(2%)” era acceptat ca 4615 GB
        with self.assertRaisesRegex(P.EroareParsare, 'procentul'):
            P.parseaza(pagina(egress='4,615 / 250 GB\n(2%)'), AZI)

    def test_peste_cota(self):
        self.assertEqual(P.parseaza(pagina(egress='260.5 / 250 GB (104%)'), AZI).egress_bytes, 260500000000)

    def test_numar(self):
        D = Decimal
        self.assertEqual(P.numar('4.402', '.'), D('4.402'))
        self.assertEqual(P.numar('4,402', ','), D('4.402'))
        self.assertEqual(P.numar('1,234', '.'), D('1234'))
        self.assertEqual(P.numar('1.234', ','), D('1234'))
        self.assertEqual(P.numar('1,234.5', None), D('1234.5'))
        self.assertEqual(P.numar('1.234,5', None), D('1234.5'))
        self.assertEqual(P.numar('2,000,000', None), D('2000000'))
        self.assertEqual(P.numar('0.078', None), D('0.078'))
        self.assertEqual(P.numar('250', None), D('250'))
        for tok, z in (('4.402', None), ('12,34,567', '.'), ('1,234.5', ','), ('1,2', '.'), ('1.234,56.7', None),
                       ('1,234,56', None), ('1\u00a023,5', ',')):
            with self.subTest(tok=tok, z=z), self.assertRaises(P.EroareParsare):
                P.numar(tok, z)


class TestPaginiProaste(unittest.TestCase):
    def test_pagina_goala(self):
        for t in ('', '   \n  ', None):
            with self.subTest(t=t), self.assertRaisesRegex(P.EroareParsare, 'goala'):
                P.parseaza(t, AZI)

    def test_pagina_fara_cifre(self):
        t = 'Usage\n07 Oct 2026 - 07 Nov 2026\nStorage Size\n\nEgress\n\nCached Egress\n\nMonthly Active Users\n'
        with self.assertRaisesRegex(P.EroareParsare, 'nu am gasit'):
            P.parseaza(t, AZI)

    def test_pagina_de_logare(self):
        with self.assertRaisesRegex(P.EroareParsare, 'nu am gasit'):
            P.parseaza('Welcome back\nSign in to your account\nEmail\nPassword\nSign In', AZI)

    def test_un_contor_lipsa(self):
        for k in ('egress', 'cached', 'storage'):
            with self.subTest(k=k), self.assertRaises(P.EroareParsare):
                P.parseaza(pagina(**{k: None}), AZI)

    def test_doua_valori_diferite(self):
        t = pagina() + '\nEgress\n\n5.1 / 250 GB (2%)\n'
        with self.assertRaisesRegex(P.EroareParsare, 'valori diferite'):
            P.parseaza(t, AZI)

    def test_aceeasi_valoare_de_doua_ori(self):
        t = pagina() + '\nEgress\n\n4.402 / 250 GB (2%)\n'
        self.assertEqual(P.parseaza(t, AZI).egress_bytes, 4402000000)

    def test_eticheta_urmata_de_alt_contor(self):
        # sub „Egress” fara valoare vine direct „Cached Egress”: valoarea lui NU e luata drept Egress
        t = '07 Oct 2026 - 07 Nov 2026\nEgress\n\nCached Egress\n\n0.08 / 250 GB\nStorage Size\n1.5 / 100 GB'
        with self.assertRaisesRegex(P.EroareParsare, '„Egress”'):
            P.parseaza(t, AZI)

    def test_valoare_cu_unitate_proprie(self):
        self.assertEqual(P.parseaza(pagina(egress='1.6 TB / 250 GB (640%)'), AZI).egress_bytes, 1600000000000)

    def test_unitate_necunoscuta(self):
        with self.assertRaisesRegex(P.EroareParsare, 'format de valoare nesuportat'):
            P.parseaza(pagina(egress='4.615 / 250 GiB (2%)'), AZI)

    def test_valoare_negativa(self):
        for v in ('-4.615 / 250 GB (2%)', '\u22124.615 / 250 GB (2%)'):
            with self.subTest(v=v), self.assertRaisesRegex(P.EroareParsare, 'format de valoare nesuportat'):
                P.parseaza(pagina(egress=v), AZI)

    def test_r1_p2_camp_numeric_intreg(self):
        # Jakarinos r1 P2, exemplele exacte: fragmentul \u201e004.615\u201d / \u201e4.615\u201d NU se mai extrage
        for v in ('1 004.615 / 250 GB', '- 4.615 / 250 GB (2%)', '1 004.615 / 250 GB (2%)', 'Egress: 4.615 / 250 GB (2%)',
                  '4.615 / 250 GB (2%) extra'):
            with self.subTest(v=v), self.assertRaisesRegex(P.EroareParsare, 'format de valoare nesuportat'):
                P.parseaza(pagina(egress=v), AZI)

    def test_r1_p2_bloc_propriu_loading(self):
        # Jakarinos r1 P2, exemplul exact: \u201eCached Egress\u201d inca \u201eLoading\u2026\u201d, dedesubt \u201eLog Query \u2026 97.865 / 2,000 GB\u201d;
        # inainte, cautarea fugea la Log Query \u21d2 cached = 97.865 GB
        t = pagina(cached='Loading\u2026\n\nLog Query\n\n97.865 / 2,000 GB' + NB + '(5%)')
        with self.assertRaisesRegex(P.EroareParsare, '\u201eCached Egress\u201d: nu am gasit'):
            P.parseaza(t, AZI)

    def test_r1_p2_cota_asteptata(self):
        # valoarea altui indicator lipita direct sub eticheta: cota 2,000 GB \u2260 250 GB \u21d2 refuz
        with self.assertRaisesRegex(P.EroareParsare, 'cota afisata 2000 GB'):
            P.parseaza(pagina(cached='97.865 / 2,000 GB' + NB + '(5%)'), AZI)
        with self.assertRaisesRegex(P.EroareParsare, 'cota afisata 100 GB'):
            P.parseaza(pagina(egress='14.586 / 100 GB (15%)'), AZI)

    def test_valoarea_doar_pe_primul_rand_al_blocului(self):
        # sub eticheta, un rand de text oarecare, apoi un raport: raportul NU mai e luat (blocul s-a terminat)
        with self.assertRaisesRegex(P.EroareParsare, '\u201eEgress\u201d: nu am gasit'):
            P.parseaza(pagina(egress='Updating\u2026\n4.615 / 250 GB (2%)'), AZI)

    def test_numar_malformat(self):
        for v in ('4..615 / 250 GB', '4,61,5 / 250 GB'):
            with self.subTest(v=v), self.assertRaises(P.EroareParsare):
                P.parseaza(pagina(egress=v), AZI)

    def test_valoare_absurda(self):
        with self.assertRaisesRegex(P.EroareParsare, 'intervalului'):
            P.parseaza(pagina(egress='20,000 TB / 250 GB'), AZI)

    def test_celule_pe_acelasi_rand(self):
        t = ('07 Oct 2026 - 07 Nov 2026\nEgress\t4.615 / 250 GB\t(2%)\nCached Egress\t0.078 / 250 GB\t(<1%)\n'
             'Storage Size\t1.5 / 100 GB\n(2%)\n0 / 5,000,000')
        c = P.parseaza(t, AZI)
        self.assertEqual((c.egress_bytes, c.cached_egress_bytes, c.storage_size_bytes), (4615000000, 78000000, 1500000000))


class TestCiclu(unittest.TestCase):
    def test_ciclu_gresit_alta_zi(self):
        with self.assertRaisesRegex(P.EroareParsare, '07→07'):
            P.parseaza(pagina(ciclu='08 Oct 2026 - 08 Nov 2026'), AZI)

    def test_ciclu_doua_luni(self):
        with self.assertRaisesRegex(P.EroareParsare, '07→07'):
            P.parseaza(pagina(ciclu='07 Oct 2026 - 07 Dec 2026'), AZI)

    def test_ciclu_trecut(self):
        with self.assertRaisesRegex(P.EroareParsare, 'nu contine ziua de azi'):
            P.parseaza(pagina(ciclu='07 Sep 2026 - 07 Oct 2026'), AZI)

    def test_ciclu_lipsa_sau_luna_necunoscuta(self):
        for cic in ('', '07 Foo 2026 - 07 Bar 2026', '07 Oct - 07 Nov'):
            with self.subTest(c=cic), self.assertRaisesRegex(P.EroareParsare, 'nu apare'):
                P.parseaza(pagina(ciclu=cic), AZI)

    def test_alt_format_si_liniuta_lunga(self):
        for cic in ('Oct 07, 2026 - Nov 07, 2026', '07 Oct 2026 \u2013 07 Nov 2026', '7 October 2026 to 7 November 2026'):
            with self.subTest(c=cic):
                self.assertEqual(P.parseaza(pagina(ciclu=cic), AZI).ciclu_start, date(2026, 10, 7))

    def test_decembrie_ianuarie(self):
        c = P.parseaza(pagina(ciclu='07 Dec 2026 - 07 Jan 2027'), date(2026, 12, 20))
        self.assertEqual((c.ciclu_start, c.ciclu_sfarsit), (date(2026, 12, 7), date(2027, 1, 7)))

    def test_toleranta_la_capete(self):
        self.assertTrue(P.parseaza(pagina(), date(2026, 11, 7)))    # ziua de sfarsit: ultima citire a ciclului
        self.assertTrue(P.parseaza(pagina(), date(2026, 10, 6)))    # o zi inainte (alt fus orar la Supabase)
        with self.assertRaises(P.EroareParsare):
            P.parseaza(pagina(), date(2026, 10, 5))
        with self.assertRaises(P.EroareParsare):
            P.parseaza(pagina(), date(2026, 11, 8))

    def test_doua_intervale_curente_ambiguu(self):
        t = pagina() + '\n01 Oct 2026 - 31 Oct 2026\n'
        with self.assertRaisesRegex(P.EroareParsare, 'ambiguu'):
            P.parseaza(t, AZI)

    def test_ciclul_trecut_afisat_langa_cel_curent(self):
        t = pagina() + '\nPrevious: 07 Sep 2026 - 07 Oct 2026\n'
        self.assertEqual(P.parseaza(t, AZI).ciclu_start, date(2026, 10, 7))


# ── document + SQL (anti-injectie) ────────────────────────────────────────────────────────────────────────────────────

OSTIL = ("4.615 / 250 GB $$; DROP TABLE public.supabase_usage_oficial; -- ' \" \\i C:/rau.sql :'v' :v :'DBNAME' :USER :{?USER} \\gexec "
         "$egr_$ $q$ \u201eș\u201d\n\tCOMMIT;")


def _literal(sql):
    m = re.search(r'\$(egr_[0-9a-f]{32}|[a-z_][a-z0-9_]*)\$(.*)\$\1\$', sql, re.S)
    return m.group(1), m.group(2), sql[:m.start()] + '<LIT>' + sql[m.end():]


class TestDocumentSiSQL(unittest.TestCase):
    def doc(self, **kw):
        return B.document(citire(**kw), CITIT_LA)

    def test_document(self):
        d = self.doc()
        self.assertEqual(d['citit_la'], '2026-10-15T06:30:00+00:00')
        self.assertEqual((d['ciclu_start'], d['ciclu_sfarsit']), ('2026-10-07', '2026-11-07'))
        self.assertEqual(d['egress_bytes'], 4615000000)
        rb = d['raspuns_brut']
        self.assertEqual(rb['valori_gb'], {'egress': '4.615', 'cached_egress': '0.078', 'storage_size': '14.586'})
        self.assertEqual(set(rb['randuri']), {'Egress', 'Cached Egress', 'Storage Size', 'ciclu'})
        self.assertLess(len(B.payload_json(d)), 1000)   # doar valori + randuri, nu pagina

    def test_sql_text_ostil_ramane_in_literal(self):
        ostil = self.doc(randuri={'egress': OSTIL, 'cached_egress': OSTIL, 'storage_size': OSTIL, 'ciclu': OSTIL})
        benign = self.doc()
        tag = 'egr_' + 'a' * 32
        s1, s2 = B.construieste_sql(ostil, tag=tag, acum=ACUM), B.construieste_sql(benign, tag=tag, acum=ACUM)
        t1, lit1, sablon1 = _literal(s1)
        _, _, sablon2 = _literal(s2)
        self.assertEqual(t1, tag)
        self.assertEqual(sablon1, sablon2)                 # textul ostil nu schimba nimic in afara literalului
        self.assertEqual(s1.count(f'${tag}$'), 2)
        self.assertEqual(json.loads(lit1), ostil)          # si ajunge intact, ca date
        self.assertNotIn('\n', lit1)
        self.assertTrue(lit1.isascii())
        self.assertNotIn('\\', sablon1)                    # nicio meta-comanda psql posibila in afara literalului
        self.assertIn("'dashboard'", sablon1)

    def test_tag_aleator(self):
        a = _literal(B.construieste_sql(self.doc(), acum=ACUM))[0]
        b = _literal(B.construieste_sql(self.doc(), acum=ACUM))[0]
        self.assertRegex(a, r'^egr_[0-9a-f]{32}$')
        self.assertNotEqual(a, b)

    def test_tag_care_apare_in_document_refuz(self):
        d = self.doc(randuri={'egress': 'x egr_abc x', 'cached_egress': 'a', 'storage_size': 'b', 'ciclu': 'c'})
        with self.assertRaisesRegex(B.EroareScriere, 'tag'):
            B.construieste_sql(d, tag='egr_abc', acum=ACUM)

    def test_tag_invalid(self):
        for tag in ('Egr', '1abc', 'a$b', 'a b'):
            with self.subTest(tag=tag), self.assertRaisesRegex(B.EroareScriere, 'tag'):
                B.construieste_sql(self.doc(), tag=tag, acum=ACUM)

    def test_valideaza_document_refuzuri(self):
        cazuri = {
            'bytes negativ': dict(egress_bytes=-1), 'bool': dict(cached_egress_bytes=True), 'float': dict(egress_bytes=1.5),
            'text': dict(storage_size_bytes='5'), 'prea mare': dict(egress_bytes=P.MAX_BYTES + 1),
            'ziua 8': dict(ciclu_start=date(2026, 10, 8), ciclu_sfarsit=date(2026, 11, 8)),
            'doua luni': dict(ciclu_sfarsit=date(2026, 12, 7)),
        }
        for nume, kw in cazuri.items():
            with self.subTest(nume), self.assertRaises(B.EroareScriere):
                B.valideaza_document(self.doc(**kw), ACUM)

    def test_valideaza_document_timp_si_structura(self):
        d = self.doc()
        for nume, mod in {
            'fara fus': lambda x: x.update(citit_la='2026-10-15T06:30:00'),
            'alt fus': lambda x: x.update(citit_la='2026-10-15T09:30:00+03:00'),
            'viitor': lambda x: x.update(citit_la='2026-10-15T07:00:00+00:00'),
            'in afara ciclului': lambda x: x.update(citit_la='2026-09-01T06:30:00+00:00'),
            'cheie in plus': lambda x: x.update(sursa='altceva'),
            'fara randuri': lambda x: x['raspuns_brut'].pop('randuri'),
            'sir lung': lambda x: x['raspuns_brut']['randuri'].update(Egress='x' * 400),
            'lista': lambda x: x['raspuns_brut'].update(colector=['a']),
        }.items():
            x = json.loads(json.dumps(d))
            mod(x)
            with self.subTest(nume), self.assertRaises(B.EroareScriere):
                B.valideaza_document(x, ACUM)
        self.assertIs(B.valideaza_document(json.loads(json.dumps(d)), ACUM).__class__, dict)


class FakeRun:
    def __init__(self, rc=0, stdout='', stderr=''):
        self.rc, self.stdout, self.stderr, self.apeluri = rc, stdout, stderr, []

    def __call__(self, cmd, **kw):
        cale = cmd[cmd.index('-f') + 1]
        with open(cale, encoding='utf-8') as f:
            self.apeluri.append({'cmd': cmd, 'kw': kw, 'sql': f.read(), 'dir': os.path.dirname(cale)})
        return subprocess.CompletedProcess(cmd, self.rc, self.stdout, self.stderr)


class TestPsql(unittest.TestCase):
    def test_comanda_si_mediu(self):
        run = FakeRun(stdout='EGRESS_REZULTAT|17|2026-10-15T06:30:00Z\n')
        with mock.patch.dict(os.environ, {'PGPASSWORD': 'secret', 'PGHOST': 'rau', 'PGOPTIONS': '-c x=1'}):
            out = B.ruleaza_psql('SELECT 1;', psql='psql', run=run)
        self.assertIn('EGRESS_REZULTAT', out)
        a = run.apeluri[0]
        self.assertEqual(a['cmd'][:8], ['psql', '-X', '-w', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '--single-transaction'])
        self.assertEqual(a['cmd'][8:16], ['-h', 'aws-1-eu-central-1.pooler.supabase.com', '-p', '5432',
                                          '-U', 'postgres.dxczwkbciseqniprspcu', '-d', 'postgres'])
        self.assertEqual(a['sql'], 'SELECT 1;')
        env = a['kw']['env']
        for k in ('PGPASSWORD', 'PGHOST', 'PGOPTIONS'):
            self.assertNotIn(k, env)
        self.assertEqual(env['PGSSLMODE'], 'require')
        self.assertFalse(os.path.exists(a['dir']))          # fisierul SQL temporar sters
        self.assertNotIn('secret', ' '.join(a['cmd']))

    def test_conexiune_invalida(self):
        for pg in ({'host': 'h; rm -rf'}, {'port': '54x'}, {'db': 'a b'}, {'sslmode': 'allow'}, {'user': 'u u'}):
            with self.subTest(pg=pg), self.assertRaisesRegex(B.EroareScriere, 'conexiune'):
                B.ruleaza_psql('SELECT 1;', psql='psql', pg=pg, run=FakeRun())

    def test_eroare_psql(self):
        run = FakeRun(rc=3, stderr='psql:x:4: ERROR:  new row violates check constraint "supabase_usage_oficial_ciclu_zi7_check"\n')
        with self.assertRaisesRegex(B.EroareScriere, 'ciclu_zi7_check'):
            B.ruleaza_psql('SELECT 1;', psql='psql', run=run)

    def test_scrie_cere_exact_o_linie_de_rezultat(self):
        rez = 'EGRESS_REZULTAT|5|2026-10-15T06:30:00Z\n'
        self.assertEqual(B.scrie(citire(), CITIT_LA, rulare=lambda sql, **k: rez, acum=ACUM), (5, '2026-10-15T06:30:00Z'))
        for out in ('', 'EGRESS_REZULTAT|5|x\nEGRESS_REZULTAT|6|y\n'):
            with self.subTest(out=out), self.assertRaisesRegex(B.EroareScriere, 'EGRESS_REZULTAT'):
                B.scrie(citire(), CITIT_LA, rulare=lambda sql, **k: out, acum=ACUM)

    def test_stare(self):
        out = 'EGRESS_STARE|3|9|2026-10-15 06:30|2026-10-07|2026-11-07|4615000000|78000000|14586000000|0.4|2026-10-14 20:05\n'
        s = B.stare(rulare=lambda sql, **k: out)
        self.assertEqual((s['n'], s['id'], s['egress_bytes'], s['activat_la']), ('3', '9', '4615000000', '2026-10-14 20:05'))
        self.assertIn('READ ONLY', B.SQL_STARE)
        self.assertNotIn('INSERT', B.SQL_STARE.upper())


# ── pagina (Playwright simulat) ───────────────────────────────────────────────────────────────────────────────────────

class TabStrain:
    """Tab ChatGPT/Copilot existent: ORICE atingere pica testul."""
    def __getattr__(self, nume):
        raise AssertionError(f'tabul existent a fost atins: {nume}')


class TabNou:
    def __init__(self, texte, url_final=G.URL_USAGE):
        self.texte, self.url, self.url_final, self.inchis, self.citiri = list(texte), 'about:blank', url_final, False, 0

    def goto(self, url, **kw):
        assert url == G.URL_USAGE
        self.url = self.url_final

    def wait_for_load_state(self, *a, **kw):
        pass

    def inner_text(self, sel, **kw):
        assert sel == 'body'
        self.citiri += 1
        return self.texte.pop(0) if len(self.texte) > 1 else self.texte[0]

    def wait_for_timeout(self, ms):
        pass

    def close(self):
        self.inchis = True


class Context:
    def __init__(self, tab):
        self.pages, self.tab = [TabStrain(), TabStrain()], tab

    def new_page(self):
        self.pages.append(self.tab)
        return self.tab


class Browser:
    def __init__(self, ctx):
        self.contexts = [ctx] if ctx else []

    def close(self):
        raise AssertionError('browser.close() interzis: ar inchide Edge-ul folosit de Copilot')


class PW:
    def __init__(self, browser=None, eroare=None):
        self.browser, self.eroare, self.cdp = browser, eroare, None
        self.chromium = self

    def connect_over_cdp(self, cdp, timeout=None):
        self.cdp = cdp
        if self.eroare:
            raise self.eroare
        return self.browser

    def __call__(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _pw(texte, url_final=G.URL_USAGE):
    tab = TabNou(texte, url_final)
    return PW(Browser(Context(tab))), tab


class TestPagina(unittest.TestCase):
    def parse(self, t):
        return P.parseaza(t, AZI)

    def test_tab_nou_inchis_celelalte_neatinse(self):
        pw, tab = _pw(['se incarca...', text_fixture(), text_fixture()])
        c, url = G.citeste(self.parse, playwright_factory=pw, pauza_ms=0)
        self.assertEqual(c.egress_bytes, 4615000000)
        self.assertTrue(tab.inchis)
        self.assertEqual(tab.citiri, 3)                    # prima citire nereusita, apoi doua identice = stabil
        self.assertEqual(pw.cdp, 'http://127.0.0.1:9333')

    def test_asteapta_valori_stabile(self):
        pw, tab = _pw([pagina(egress='4.1 / 250 GB (2%)'), pagina(egress='4.402 / 250 GB (2%)'),
                       pagina(egress='4.402 / 250 GB (2%)')])
        c, _ = G.citeste(self.parse, playwright_factory=pw, pauza_ms=0)
        self.assertEqual(c.egress_bytes, 4402000000)

    def test_logare_ceruta(self):
        pw, tab = _pw([text_fixture()], url_final='https://supabase.com/dashboard/sign-in?returnTo=%2Forg%2Fx%2Fusage')
        with self.assertRaises(G.LogareNecesara):
            G.citeste(self.parse, playwright_factory=pw, pauza_ms=0)
        self.assertTrue(tab.inchis)

    def test_fara_cifre_pana_la_termen(self):
        pw, tab = _pw(['Usage\nLoading...'])
        with self.assertRaisesRegex(G.EroareCitire, 'nicio citire stabila'):
            G.citeste(self.parse, playwright_factory=pw, pauza_ms=0, timp_max=-1)
        self.assertTrue(tab.inchis)

    def test_eroare_neasteptata_inchide_tabul(self):
        pw, tab = _pw([text_fixture()])
        def rau(t):
            raise ValueError('x')
        with self.assertRaises(ValueError):
            G.citeste(rau, playwright_factory=pw, pauza_ms=0)
        self.assertTrue(tab.inchis)

    def test_edge_oprit_sau_fara_context(self):
        with self.assertRaisesRegex(G.EroareCitire, 'conecta'):
            G.citeste(self.parse, playwright_factory=PW(eroare=RuntimeError('ECONNREFUSED')))
        with self.assertRaisesRegex(G.EroareCitire, 'context'):
            G.citeste(self.parse, playwright_factory=PW(Browser(None)))

    def test_cdp_doar_loopback(self):
        for cdp in ('http://10.0.0.5:9333', 'http://127.0.0.1:9333/x', 'ws://127.0.0.1:9333', 'http://127.0.0.1.evil:9333'):
            with self.subTest(cdp=cdp), self.assertRaisesRegex(G.EroareCitire, 'CDP'):
                G.citeste(self.parse, cdp=cdp, playwright_factory=lambda: self.fail('nu trebuia pornit playwright'))

    def test_verifica_url(self):
        G.verifica_url(G.URL_USAGE)
        G.verifica_url(G.URL_USAGE + '/')
        with self.assertRaises(G.LogareNecesara):
            G.verifica_url('https://supabase.com/dashboard/sign-in?returnTo=x')
        for u in ('https://supabase.com/dashboard/org/altaorg/usage', 'http://supabase.com/dashboard/org/%s/usage' % G.ORG,
                  'https://evil.com/dashboard/org/%s/usage' % G.ORG, 'https://supabase.com/dashboard/org/%s/billing' % G.ORG):
            with self.subTest(u=u), self.assertRaises(G.EroareCitire):
                G.verifica_url(u)


# ── linia de comanda ──────────────────────────────────────────────────────────────────────────────────────────────────

class TestCLI(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix='egress_colector_test_')
        self.addCleanup(shutil.rmtree, self.dir, True)

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = M.main(['--dir', self.dir, *argv])
        return rc, out.getvalue(), err.getvalue()

    def jurnal(self):
        try:
            with open(os.path.join(self.dir, M.JURNAL), encoding='utf-8') as f:
                return f.read()
        except FileNotFoundError:
            return ''

    def test_citeste_din_text(self):
        rc, out, _ = self.run_cli('citeste', '--din-text', FIXTURE)
        self.assertEqual(rc, 0)
        self.assertIn('4.615 GB = 4615000000 bytes', out)
        self.assertIn('nimic scris', out)
        self.assertEqual(self.jurnal(), '')

    def test_citeste_live_nu_scrie(self):
        with mock.patch.object(G, 'citeste', return_value=(citire_azi(), G.URL_USAGE)), \
             mock.patch.object(B, 'ruleaza_psql', side_effect=AssertionError('citeste nu are voie sa atinga BD')):
            rc, out, _ = self.run_cli('citeste', '--arata-sql')
        self.assertEqual(rc, 0)
        self.assertIn('INSERT INTO public.supabase_usage_oficial', out)
        self.assertIn('NU s-a rulat', out)
        self.assertIn('citit (fara scriere)', self.jurnal())

    def test_scrie(self):
        apel = {}
        def scrie(c, citit_la, psql=None, pg=None):
            apel.update(c=c, citit_la=citit_la, pg=pg)
            return 42, '2026-10-15T06:30:00Z'
        with mock.patch.object(G, 'citeste', return_value=(citire(), G.URL_USAGE)), mock.patch.object(B, 'scrie', scrie):
            rc, out, _ = self.run_cli('scrie', '--pg-host', '127.0.0.1', '--pg-sslmode', 'disable')
        self.assertEqual(rc, 0)
        self.assertEqual(apel['pg']['host'], '127.0.0.1')
        self.assertEqual(apel['citit_la'].tzinfo, timezone.utc)
        self.assertIn('scris id 42', self.jurnal())
        self.assertFalse(os.path.exists(os.path.join(self.dir, 'egress_colector.lock')))

    def test_scrie_logare_necesara(self):
        with mock.patch.object(G, 'citeste', side_effect=G.LogareNecesara('cere logare')), \
             mock.patch.object(B, 'scrie', side_effect=AssertionError('nu trebuia scris')):
            rc, _, err = self.run_cli('scrie')
        self.assertEqual(rc, 2)
        self.assertIn('LOGARE', err)
        self.assertIn('| scrie | 2 |', self.jurnal())

    def test_scrie_parsare_esuata(self):
        with mock.patch.object(G, 'citeste', side_effect=P.EroareParsare('„Egress”: nu am gasit')), \
             mock.patch.object(B, 'scrie', side_effect=AssertionError('nu trebuia scris')):
            rc, _, err = self.run_cli('scrie')
        self.assertEqual(rc, 1)
        self.assertIn('nimic scris', err)

    def test_alta_rulare_in_curs(self):
        os.makedirs(self.dir, exist_ok=True)
        lock = os.path.join(self.dir, 'egress_colector.lock')
        with open(lock, 'w') as f:
            f.write('1 x\n')
        with mock.patch.object(G, 'citeste', side_effect=AssertionError('nu trebuia citit')):
            rc, _, _ = self.run_cli('scrie')
        self.assertEqual(rc, 3)
        self.assertTrue(os.path.exists(lock))              # lock-ul altuia ramane
        vechi = time.time() - M.LOCK_MAX_S - 60            # lock ramas de la o rulare oprita → inlocuit
        os.utime(lock, (vechi, vechi))
        with mock.patch.object(G, 'citeste', return_value=(citire(), G.URL_USAGE)), \
             mock.patch.object(B, 'scrie', return_value=(1, 't')):
            rc, _, _ = self.run_cli('scrie')
        self.assertEqual(rc, 0)
        self.assertFalse(os.path.exists(lock))

    def test_stare(self):
        M.jurnal(self.dir, 'scrie', 0, 'scris id 1 (x): egress 1 GB')
        rc, out, _ = self.run_cli('stare', '--fara-bd')
        self.assertEqual(rc, 0)
        self.assertIn('scris id 1', out)
        s = {'n': '1', 'id': '1', 'citit_la': '2026-10-15 06:30', 'ciclu_start': '2026-10-07', 'ciclu_sfarsit': '2026-11-07',
             'egress_bytes': '4615000000', 'cached_egress_bytes': '78000000', 'storage_size_bytes': '14586000000',
             'vechime_ore': '0.4', 'activat_la': '2026-10-14 20:05'}
        with mock.patch.object(B, 'stare', return_value=s):
            rc, out, _ = self.run_cli('stare')
        self.assertEqual(rc, 0)
        self.assertIn('egress 4.615 GB', out)

    def test_jurnal_fara_caractere_de_control(self):
        M.jurnal(self.dir, 'scrie', 1, 'a\nb\rc\x1b[31m')
        self.assertEqual(self.jurnal().count('\n'), 1)


if __name__ == '__main__':
    unittest.main()
