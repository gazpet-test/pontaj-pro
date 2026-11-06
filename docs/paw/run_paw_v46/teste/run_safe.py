"""Selectie offline explicita: fara Git, launcher real, CDP, Install sau secrete reale.
Rulare: python -B teste/run_safe.py. Nu reprezinta certificare OS/productie.
"""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True
NAMES = [
    'teste.test_v46',
    'teste.test_gemini_pw',
    'teste.test_cdx_installer',
    'teste.test_cdx_policy',
    'teste.test_cdx_r4.R4.test_links_and_legacy_trust',
    'teste.test_cdx_r4.R4.test_file_symlink_cleanup',
    'teste.test_cdx_r5',
    'teste.test_cdx_r6',
    'teste.test_cdx_security',
    'teste.test_run_paw.RuleazaPipe',
]

if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='safe-temp-', dir=HERE) as directory:
        tempfile.tempdir = directory
        os.environ.update(TEMP=directory, TMP=directory, PYTHONDONTWRITEBYTECODE='1')
        suite = unittest.defaultTestLoader.loadTestsFromNames(NAMES)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        evidence = {
            'scope': 'offline fixtures; no OS or live-service certification',
            'selection': NAMES,
            'run': result.testsRun,
            'passed': result.testsRun - len(result.skipped) - len(result.failures) - len(result.errors),
            'skipped': [{'test': str(test), 'reason': reason} for test, reason in result.skipped],
            'failures': [str(test) for test, _ in result.failures],
            'errors': [str(test) for test, _ in result.errors],
            'excluded': {
                'test_cdx': 'uses Git',
                'test_instalare': 'uses Git',
                'test_cdx_cert_probes': 'uses Git credential fill with synthetic helper',
                'test_cdx_patch_runtime': 'opt-in installed CLI; not a unittest module',
                'test_cdx_r4.R4.test_native_http_positive_control': 'loopback HTTP fails identically on copied v45 baseline',
                'test_run_paw.Lansator': 'separate run: 41 tests, 17 failures due to CIM denied, 24 passed',
            },
        }
        (HERE / 'teste/RESULTATS_v46.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='ascii')
        sys.exit(0 if result.wasSuccessful() else 1)
