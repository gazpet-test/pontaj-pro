"""Aviz COMTECH CO P 0160 (27.10.2026): Cod Articol = numărul țevii, Nr.Sarja = șarja, grad din denumire, caseta de totaluri.
Textele OCR sunt SINTETICE (transcrise din scan, aceeași formă ca exporturile LightOn / MinerU); fără GPU / rețea / BD."""
import copy
import json
import pathlib
import shutil
import subprocess
import unittest
from ocr_local.e3_aliniere import compara
from ocr_local.e3_contract import E3Error, numarE3, numarKgE3
from ocr_local.e3_mapare import grad_otel_din_text, mapare

HERE = pathlib.Path(__file__).parent
REPO = HERE.parents[3]
AVIZ = json.loads((HERE / 'aviz_comtech_p0160.json').read_text(encoding='utf-8'))


def raw(reader):
    return (HERE / ('ocr_sintetic_%s_aviz_comtech_p0160.txt' % reader)).read_text(encoding='utf-8')


class AvizComtechP0160(unittest.TestCase):
    def refuses(self, fn, code='structura_incerta'):
        with self.assertRaises(E3Error) as cm:
            fn()
        self.assertEqual(cm.exception.cod, code)

    def test_cele_30_de_randuri_pe_ambele_cititoare(self):
        expected = AVIZ['randuri']
        for reader in ('lighton', 'mineru'):
            obj = mapare(raw(reader), 'aviz_teava')
            rows = obj['randuri']
            self.assertEqual(len(rows), 30, reader)  # rândul „0 1 2 … 8” de sub cap nu e țeavă
            self.assertEqual([r['nr_crt'] for r in rows], [e['nr_crt'] for e in expected])
            self.assertEqual([r['serie'] for r in rows], [e['cod_articol'] for e in expected])
            self.assertEqual([r['sarja'] for r in rows], [e['sarja'] for e in expected])
            self.assertEqual([r['lungime_doc'] for r in rows], [e['lungime_m'] for e in expected])
            self.assertEqual([r['greutate_kg'] for r in rows], [e['greutate_neta'] for e in expected])
            self.assertEqual({r['grad_otel'] for r in rows}, {'L360NE'})
            self.assertEqual({r['specificatie'] for r in rows}, {AVIZ['denumire']})
            # izolația nu are coloană: calea locală nu o completează (regula „izolate = PEHD” rămâne a promptului / editorului)
            self.assertTrue(all(r['izolatie'] is None and r['cantitate'] is None for r in rows))
            self.assertEqual(obj['totaluri_tiparite'], {'total_metri': '178.97', 'total_kg': '20.564'})
            self.assertEqual(round(sum(numarE3(r['lungime_doc']) for r in rows), 2), 178.97)
            self.assertEqual(sum(numarKgE3(r['greutate_kg']) for r in rows), 20564)  # 0,684 t → 684 kg
        obj, cells = compara(mapare(raw('lighton'), 'aviz_teava'), mapare(raw('mineru'), 'aviz_teava'), 'aviz_teava')
        self.assertEqual([c for c in cells if c['rand'] > 0], [])

    def test_bugul_raportat_nu_se_mai_poate_produce(self):
        rows = mapare(raw('lighton'), 'aviz_teava')['randuri']
        serii, sarje = [r['serie'] for r in rows], {r['sarja'] for r in rows}
        self.assertEqual(len(set(serii)), 30)
        self.assertFalse(sarje & set(serii))
        self.assertIn('B2407893', sarje)
        # Dacă cititorul pune aceeași valoare pe mai multe țevi, citirea locală e refuzată (-> Sonnet / om).
        dublat = raw('lighton').replace('| 2 | 247EK04200 |', '| 2 | 247EK04204 |')
        self.refuses(lambda: mapare(dublat, 'aviz_teava'))

    def test_cantitatea_pe_rand_trebuie_sa_fie_o_teava(self):
        source = raw('lighton')
        self.refuses(lambda: mapare(source.replace('| UGAH ACE | 1.0 | B2407893 | 5,95 |', '| UGAH ACE | 2.0 | B2407893 | 5,95 |', 1), 'aviz_teava'))
        self.refuses(lambda: mapare(source.replace('Total cantitate: **30**', 'Total cantitate: **29**'), 'aviz_teava'))

    def test_caseta_de_totaluri(self):
        source = raw('lighton')
        # totalul tipărit care nu bate cu rândurile = rând lipsă / citit greșit -> refuz
        self.refuses(lambda: mapare(source.replace('**178.97 m**', '**179.97 m**'), 'aviz_teava'))
        # două valori diferite pentru același total = ambiguu
        self.refuses(lambda: mapare(source.replace('## CSV', 'Total lungime: 180.00 m\n\n## CSV'), 'aviz_teava'))
        # textul de după „## CSV” nu se citește (CSV-ul repetă tabelul)
        self.assertEqual(len(mapare(source + '\nTotal lungime: 180.00 m\n', 'aviz_teava')['randuri']), 30)
        # fără unitate nu e total de metri; fără niciun total -> refuz (fail-closed, Copilot B3 r2)
        fara = source.replace('**178.97 m**', '**178.97**').replace('**20.564 kg**', '**20.564**')
        self.refuses(lambda: mapare(fara, 'aviz_teava'))
        # unitatea înaintea numărului („Total lungime (m): 178,97”)
        obj = mapare(source.replace('Total lungime:\n**178.97 m**', 'Total lungime (m): 178,97'), 'aviz_teava')
        self.assertEqual(obj['totaluri_tiparite']['total_metri'], '178,97')

    def test_rand_numerotare_doar_sub_cap(self):
        source = raw('lighton')
        fara = source.replace('| 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |\n', '')
        self.assertEqual(len(mapare(fara, 'aviz_teava')['randuri']), 30)

    def test_aliasuri_de_antet(self):
        base = '| Nr. Crt | {serie} | Specificatia | {sarja} | Cantitate livrata (m) | Greutate (kg) |\n' \
               '| 1 | 254CA09016 | Tevi 610x7,10 mm, L 360 NE | SA04751 | 11.96 | 1,343 |\n' \
               '| TOTAL GENERAL |  |  |  | 11.96 | 1,343 |\n'
        for serie in ('Nr. Teava', 'Nr. țeavă', 'Nr. tub', 'Pipe No.', 'Pipe Number', 'Cod Articol'):
            for sarja in ('Nr Sarja', 'Șarja', 'Heat No.', 'Heat Number'):
                r = mapare(base.format(serie=serie, sarja=sarja), 'aviz_teava')['randuri'][0]
                self.assertEqual((r['serie'], r['sarja'], r['grad_otel']), ('254CA09016', 'SA04751', 'L360NE'), (serie, sarja))


class GradOtel(unittest.TestCase):
    VECTORI = json.loads((HERE / 'grade_otel.json').read_text(encoding='utf-8'))

    def test_vectori_python(self):
        for text, expected in self.VECTORI:
            self.assertEqual(grad_otel_din_text(text), expected, text)

    def test_paritate_cu_avizE3_ts(self):
        node = shutil.which('node') or ('C:/Program Files/nodejs/node.exe' if pathlib.Path('C:/Program Files/nodejs/node.exe').exists() else None)
        if not node:
            self.skipTest('Node absent; paritatea TS nu a fost rulată')
        script = r'''
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const {gradOtelE3} = await import(pathToFileURL(resolve(process.argv[1], 'supabase/functions/ocr-packing-list/avizE3.ts')));
const v = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify(v.map(([t]) => gradOtelE3(t))));
'''
        result = subprocess.run([node, '--input-type=module', '-e', script, str(REPO), str(HERE / 'grade_otel.json')],
                                capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [e for _, e in self.VECTORI])


if __name__ == '__main__':
    unittest.main()
