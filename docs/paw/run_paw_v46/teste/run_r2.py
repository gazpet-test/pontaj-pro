"""Selectie explicita fara Git/servicii; toate temporarele sunt sub v46."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True
NAMES = ['teste.test_v46', 'teste.test_gemini_pw', 'teste.test_run_paw', 'teste.test_v46_r2', 'teste.test_jak_runtime']
if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='r2-temp-', dir=HERE) as directory:
        tempfile.tempdir = directory
        os.environ.update(TEMP=directory, TMP=directory, LOCALAPPDATA=directory, PYTHONDONTWRITEBYTECODE='1')
        suite = unittest.defaultTestLoader.loadTestsFromNames(NAMES)
        with (HERE/'teste/r2_execution.log').open('w', encoding='ascii', errors='backslashreplace') as log:
            result = unittest.TextTestRunner(verbosity=2, stream=log).run(suite)
        evidence = dict(selection=NAMES, run=result.testsRun,
                        passed=result.testsRun-len(result.skipped)-len(result.failures)-len(result.errors),
                        skipped=[dict(test=str(t), reason=r) for t,r in result.skipped],
                        failures=[dict(test=str(t), detail=d) for t,d in result.failures],
                        errors=[dict(test=str(t), detail=d) for t,d in result.errors],
                        scope='Synthetic processes; real Win32 snapshots/jobs/pipes; no live Codex, ACL certification or CDP')
        (HERE/'teste/RESULTATS_r2.json').write_text(json.dumps(evidence, indent=2)+'\n', encoding='ascii')
        print(json.dumps({key: evidence[key] for key in ('run', 'passed', 'skipped', 'failures', 'errors')}))
        sys.exit(0 if result.wasSuccessful() else 1)
