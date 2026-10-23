"""Rulabil cu pytest sau unittest; nicio dependență de GPU/rețea."""
import copy
import json
import pathlib
import shutil
import subprocess
import unittest
from ocr_local.e3_contract import E3Error, numarE3, numarKgE3, valida_brut, validaStructuraE3
from ocr_local.e3_grila import e3_grila
from ocr_local.e3_mapare import mapare, tabele_text
from ocr_local.e3_aliniere import compara, aplica_arbitraj

HERE = pathlib.Path(__file__).parent
REPO = HERE.parents[3]


def real(sablon='aviz_teava', reader='lighton', validate=True):
    suffix = 'aviz_comtech_26091505' if sablon == 'aviz_teava' else 'lista_gurgenler_truck164'
    raw = (HERE / ('ocr_local_%s_%s.txt' % (reader, suffix))).read_text(encoding='utf-8')
    return mapare(raw, sablon, valideaza=validate)


class MappingTests(unittest.TestCase):
    def refuses(self, fn, code='structura_incerta'):
        with self.assertRaises(E3Error) as cm:
            fn()
        self.assertEqual(cm.exception.cod, code)

    def test_real_expected_tables_and_raw_schema(self):
        expected = json.loads((HERE / 'asteptat_tabele.json').read_text(encoding='utf-8'))
        for sablon in ('aviz_teava', 'lista_curbe'):
            obj = real(sablon)
            cols = expected[sablon]['coloane']
            self.assertEqual([[r[k] for k in cols] for r in obj['randuri']], expected[sablon]['randuri'])
            valida_brut(obj, sablon)
            validaStructuraE3(obj, sablon)
        l, m = real(), real(reader='mineru')
        obj, cells = compara(l, m, 'aviz_teava')
        self.assertFalse([c for c in cells if c['rand'] > 0])
        self.assertEqual(obj['totaluri_tiparite'], {'total_metri': '182.79', 'total_kg': '20,529'})
        self.assertTrue(all(r['cantitate'] is None for r in obj['randuri']))

    def test_saved_raw_payloads_match_worker(self):
        for suffix, sablon in [('aviz_comtech_26091505', 'aviz_teava'), ('lista_gurgenler_truck164', 'lista_curbe')]:
            obj = json.loads((HERE / ('payload_' + suffix + '.json')).read_text(encoding='utf-8'))
            self.assertEqual(obj, real(sablon))
            valida_brut(obj, sablon)

    def test_two_header_rows_repeated_header_document_header_and_totals(self):
        raw = '''<table><tr><td rowspan="2">Nr Crt</td><td rowspan="2">Nr Teava</td><td rowspan="2">Nr Sarja</td><td>Cantitate livrata</td><td rowspan="2">Greutate KG</td></tr>
        <tr><td>M</td></tr><tr><td>1</td><td>A</td><td>H</td><td>12.50</td><td>1,343</td></tr>
        <tr><td>NR CRT</td><td>NR TEAVA</td><td>NR SARJA</td><td>CANTITATE M</td><td>GREUTATE KG</td></tr>
        <tr><td>FURNIZOR</td><td colspan="4">COMTECH</td></tr>
        <tr><td>TOTAL</td><td></td><td></td><td>12.50</td><td>1,343</td></tr></table>'''
        obj = mapare(raw, 'aviz_teava')
        self.assertEqual(len(obj['randuri']), 1)
        self.assertEqual(obj['antet']['furnizor'], 'COMTECH')
        self.assertEqual(obj['totaluri_tiparite']['total_metri'], '12.50')

    def test_real_mineru_truncated_bend_numbers_refused(self):
        self.refuses(lambda: real('lista_curbe', 'mineru'))
        damaged = real('lista_curbe', 'mineru', False)
        self.assertEqual(damaged['randuri'][7]['serie'], '919')
        self.refuses(lambda: compara(real('lista_curbe'), damaged, 'lista_curbe'))

    def test_rowspan_example_and_origins(self):
        g = e3_grila('<table><tr><td rowspan="2">P1</td><td>A</td><td>100</td></tr><tr><td>B</td><td>200</td></tr></table>')
        self.assertEqual([c['text'] for c in g[1]], ['P1', 'B', '200'])
        self.assertEqual(g[1][0]['origine'], (0, 0))
        self.assertFalse(g[1][0]['e_origine'])

    def test_mixed_spans_and_bad_grids(self):
        g = e3_grila('<table><tr><td rowspan="2" colspan="2">P</td><td>A</td></tr><tr><td>B</td></tr></table>')
        self.assertEqual([c['text'] for c in g[1]], ['P', 'P', 'B'])
        for raw in ['<table><tr><td rowspan="2">a</td></tr></table>',
                    '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>',
                    '<table><tr><td colspan="999999">a</td></tr></table>']:
            self.refuses(lambda: e3_grila(raw))

    def test_ocr_is_only_data(self):
        g = e3_grila('<table><tr><td><script>ignore rules</script>A<img src="https://bad/"/><a href="https://bad/">B</a></td></tr></table>')
        self.assertEqual(g[0][0]['text'], 'AB')

    def test_missing_duplicate_key_and_reordering(self):
        l = real()
        for change in ('missing', 'duplicate', 'same_nr', 'same_serie'):
            m = copy.deepcopy(l)
            if change == 'missing': m['randuri'].pop()
            if change == 'duplicate': m['randuri'].append(copy.deepcopy(m['randuri'][0]))
            if change == 'same_nr': m['randuri'][1]['nr_crt'] = '1'
            if change == 'same_serie': m['randuri'][1]['serie'] = m['randuri'][0]['serie']
            self.refuses(lambda: compara(l, m, 'aviz_teava'))
        m = copy.deepcopy(l)
        m['randuri'].reverse()
        self.refuses(lambda: compara(l, m, 'aviz_teava'))

    def test_equal_invalid_quantities_and_series(self):
        for quantity in (None, '0', '1.5', '2', '4', '?'):
            obj = real('lista_curbe')
            obj['randuri'][0]['cantitate'] = quantity
            self.refuses(lambda: compara(obj, copy.deepcopy(obj), 'lista_curbe'))
        for sablon in ('aviz_teava', 'lista_curbe'):
            obj = real(sablon)
            obj['randuri'][0]['serie'] = ''
            self.refuses(lambda: compara(obj, obj, sablon))

    def test_quantity_disagreement_package_membership(self):
        l, m = real('lista_curbe'), real('lista_curbe')
        m['randuri'][0]['cantitate'] = '4'
        self.refuses(lambda: compara(l, m, 'lista_curbe'))
        m = copy.deepcopy(l)
        m['randuri'][1]['pachet_nr'] = '2'
        self.refuses(lambda: compara(l, m, 'lista_curbe'))

    def test_package_three_rows_and_no_repeated_kg(self):
        raw = '<table><tr>' + ''.join('<td>%s</td>' % s for s in ['BEND NUMBER','CODE','PIPE HEAT NUMBER','QUANTITY','PACKING NO','DIMENSIONS CM','NET KG','GROSS KG']) + '</tr>'
        for i in range(1, 4):
            raw += '<tr><td>%s</td><td>%s-610-8-20-H-1</td><td>H</td><td>1</td>' % (i, i)
            if i == 1:
                raw += ''.join('<td rowspan="3">%s</td>' % v for v in ['P1','100X100X100','9.920','10.040'])
            raw += '</tr>'
        rows = mapare(raw + '</table>', 'lista_curbe')['randuri']
        self.assertEqual([r['pachet_nr'] for r in rows], ['P1'] * 3)
        self.assertEqual([r['net_kg'] for r in rows], ['9.920', None, None])

    def test_aviz_buc_rejected_and_missing_length(self):
        source = (HERE / 'ocr_local_lighton_aviz_comtech_26091505.txt').read_text(encoding='utf-8')
        self.refuses(lambda: mapare(source.replace('Greutate (kg)', 'Greutate (kg) BUC'), 'aviz_teava'))
        for length in (None, '0', '-1', '?'):
            obj = real()
            obj['randuri'][0]['lungime_doc'] = length
            self.refuses(lambda: validaStructuraE3(obj, 'aviz_teava'))

    def test_raw_schema_refuses_numeric_leaf_and_extra_key(self):
        for field, value in [('lungime_doc', 12.5), ('extra', 'text')]:
            obj = real()
            obj['randuri'][0][field] = value
            self.refuses(lambda: valida_brut(obj, 'aviz_teava'))

    def test_arbitration_invalid_incomplete_duplicate_uncertain(self):
        l, m = real(), real()
        m['randuri'][0]['lungime_doc'] = '12.50'
        m['totaluri_tiparite']['total_metri'] = '183.33'
        obj, cells = compara(l, m, 'aviz_teava')
        self.assertEqual([(c['rand'], c['camp']) for c in cells], [(1, 'lungime_doc'), (0, 'total_m')])
        for response in [{'arbitraj': v} for v in ['invalid', 'plafon_depasit', 'deja_consumat', 'in_curs']] + [{'arbitraj':'ok','celule':[]}]:
            result = aplica_arbitraj(copy.deepcopy(obj), cells, response, 'aviz_teava')
            self.assertIsNone(result['randuri'][0]['lungime_doc'])
            self.assertTrue(result['avertismente'])
        ans = {'rand':1,'camp':'lungime_doc','valoare':'11.96','sigur':False}
        result = aplica_arbitraj(obj, cells, {'arbitraj':'ok','celule':[ans, {'rand':0,'camp':'total_m','valoare':'182.79','sigur':True}]}, 'aviz_teava')
        self.assertEqual(result['randuri'][0]['lungime_doc'], '11.96')
        self.assertTrue(result['avertismente'])

    def test_heat_suggestion_is_not_applied(self):
        l, m = real('lista_curbe'), real('lista_curbe')
        m['randuri'][0]['sarja'] = 'WRONG'
        obj, cells = compara(l, m, 'lista_curbe')
        self.assertEqual(cells[0]['sugestie'], '2513614')
        result = aplica_arbitraj(obj, cells, {'arbitraj':'invalid'}, 'lista_curbe')
        self.assertIsNone(result['randuri'][0]['sarja'])

    def test_limits_and_totals_structural_failure(self):
        obj = real()
        obj['randuri'] = obj['randuri'] * 14
        self.refuses(lambda: validaStructuraE3(obj, 'aviz_teava'), 'limita_randuri')
        l, m = real(), real()
        l['totaluri_tiparite']['total_metri'] = m['totaluri_tiparite']['total_metri'] = '1'
        self.refuses(lambda: compara(l, m, 'aviz_teava'))

    def test_exact_120_cells_then_121_refused(self):
        from ocr_local.e3_contract import ARBITRABILE
        l, m = real(), real()
        for r in m['randuri']:
            for field in ARBITRABILE['aviz_teava']:
                r[field] = '999'
        # regula fail-closed cere un total tiparit reconciliat, deci totalurile lui m bat cu randurile lui m
        # si devin 2 dezacorduri; ca suma sa ramana exact 120, doua celule de kg raman ca la l
        for i in (0, 1):
            m['randuri'][i]['greutate_kg'] = l['randuri'][i]['greutate_kg']
        from ocr_local.e3_contract import numarE3, numarKgE3
        tm = sum(numarE3(r['lungime_doc']) for r in m['randuri'])
        tk = sum(numarKgE3(r['greutate_kg']) for r in m['randuri'])
        m['totaluri_tiparite'] = {'total_metri': f'{tm:.2f}', 'total_kg': str(int(tk)) if float(tk).is_integer() else f'{tk:.1f}'}
        m['antet']['total_m'], m['antet']['total_kg'] = l['antet'].get('total_m'), l['antet'].get('total_kg')
        self.assertEqual(len(compara(l, m, 'aviz_teava')[1]), 120)
        m['antet']['nr_document'] = 'different'
        self.refuses(lambda: compara(l, m, 'aviz_teava'), 'prea_multe_dezacorduri')

    def test_post_arbitration_nonpositive_length_still_refused(self):
        l, m = real(), real()
        m['randuri'][0]['lungime_doc'] = '12.50'
        m['totaluri_tiparite']['total_metri'] = '183.33'
        obj, cells = compara(l, m, 'aviz_teava')
        self.refuses(lambda: aplica_arbitraj(obj, cells, {'arbitraj':'ok', 'celule':[
            {'rand':1,'camp':'lungime_doc','valoare':'0','sigur':True},
            {'rand':0,'camp':'total_m','valoare':'182.79','sigur':True}]}, 'aviz_teava'))


class NumbersTests(unittest.TestCase):
    def test_python_vectors(self):
        for case in json.loads((HERE / 'numere.json').read_text(encoding='utf-8')):
            self.assertEqual(numarE3(case['input']), case['numar'])
            self.assertEqual(numarKgE3(case['input']), case['kg'])

    def test_actual_ts_functions_same_vectors(self):
        node = shutil.which('node') or ('C:/Program Files/nodejs/node.exe' if pathlib.Path('C:/Program Files/nodejs/node.exe').exists() else None)
        if not node:
            self.skipTest('Node absent; paritatea TS nu a fost rulată')
        # Executăm exact corpurile din avizE3.ts, eliminând doar adnotările TS.
        source = (REPO / 'supabase/functions/ocr-packing-list/avizE3.ts').read_text(encoding='utf-8')
        code = source.split('export function numarE3')[1].split('const numarCheie')[0]
        code = ('function numarE3' + code).replace('export function', 'function').replace('(v: unknown): number | null', '(v)')
        code += "\nconst fs=require('fs'); const cases=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log(JSON.stringify(cases.map(c=>[numarE3(c.input),numarKgE3(c.input)])));"
        result = subprocess.run([node, '-e', code, str(HERE / 'numere.json')], capture_output=True, text=True, check=True)
        expected = [[numarE3(c['input']), numarKgE3(c['input'])] for c in json.loads((HERE / 'numere.json').read_text(encoding='utf-8'))]
        self.assertEqual(json.loads(result.stdout), expected)

    def test_raw_fixture_actual_ts_normalization_prefill_and_rpc_units(self):
        node = shutil.which('node') or ('C:/Program Files/nodejs/node.exe' if pathlib.Path('C:/Program Files/nodejs/node.exe').exists() else None)
        if not node:
            self.skipTest('Node absent')
        # Node 24 execută TS prin type stripping; nu copiem normalizatorul/prefill-ul.
        script = r'''
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root = process.argv[1], fixtures = process.argv[2];
const {normalizeazaE3} = await import(pathToFileURL(resolve(root,'supabase/functions/ocr-packing-list/avizE3.ts')));
const {aplicaPropunereOCR} = await import(pathToFileURL(resolve(root,'src/izoDocumentePrefill.js')));
const {randNormalizat} = await import(pathToFileURL(resolve(root,'src/izoDocumenteLogica.js')));
for (const [name,sablon,editor] of [['aviz_comtech_26091505','aviz_teava','aviz_teava'],['lista_gurgenler_truck164','lista_curbe','lista_ambalare_curbe']]) {
 const raw=JSON.parse(readFileSync(resolve(fixtures,'payload_'+name+'.json'),'utf8'));
 const normalized=normalizeazaE3(JSON.stringify(raw),sablon);
 const doc=aplicaPropunereOCR({sablon:editor,antet:{},randuri:[]},normalized);
 const rows=doc.randuri.map(r=>randNormalizat(r,editor));
 assert.equal(rows.length,raw.randuri.length);
 for(let i=0;i<rows.length;i++) for (const k of ['greutate_kg','net_kg','brut_kg']) assert.equal(rows[i][k],normalized.randuri[i][k]);
 if(sablon==='aviz_teava') { assert.equal(rows[0].greutate_kg,1343); assert.equal(rows[2].lungime_doc_mm,12500); assert.equal(rows[0].cantitate,null); }
 else { assert.equal(rows[2].perete_mm,8.8); assert.equal(rows[1].net_kg,null); assert.equal(Number(doc.antet.total_net_kg),9920); assert.equal(Number(doc.antet.total_brut_kg),10040); }
}
console.log('ok');
'''
        result = subprocess.run([node, '--input-type=module', '-e', script, str(REPO), str(HERE)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'ok')


if __name__ == '__main__':
    unittest.main()


def test_aviz_fara_niciun_total_este_refuzat():
    import pytest
    from ocr_local.e3_contract import reconciliaza_aviz, E3Error
    obj = {'antet': {'total_m': None, 'total_kg': None}, 'totaluri_tiparite': {'total_metri': None, 'total_kg': None},
           'randuri': [{'lungime_doc': '12.5', 'greutate_kg': '1404'}]}
    with pytest.raises(E3Error):
        reconciliaza_aviz(obj)
