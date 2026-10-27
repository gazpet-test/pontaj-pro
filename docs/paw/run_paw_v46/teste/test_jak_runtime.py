"""Runtime selection on synthetic filesystem; only privileged ACL check mocked."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from .test_v46_r2 import HERE, PS


class Runtime(unittest.TestCase):
    def case(self, mode, expected=None):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            runtime = root/'codex/0.162.0-fixture'
            (runtime/'package/bin').mkdir(parents=True)
            (runtime/'node.exe').write_text('synthetic node', encoding='ascii')
            (runtime/'package/bin/codex.js').write_text('// synthetic CLI', encoding='ascii')
            shutil.copyfile(HERE/'jak.ps1', root/'jak.ps1')
            cfg = dict(schema=2, version='0.162.0', runtime_root=str(runtime))
            if mode == 'outside': cfg['runtime_root'] = str(root)
            if mode == 'version': cfg['version'] = '0.161.0'
            (root/'cdx_install.json').write_text(json.dumps(cfg), encoding='ascii')
            script = root/'test.ps1'
            script.write_text(r'''
$ErrorActionPreference='Stop'
$PAW_ROOT='__ROOT__'
. '__SOURCE__\cdx_security.ps1'
. '__ROOT__\jak.ps1'
function AssertCdxAdminAcl($p){}
$runtime='__RUNTIME__'
$m=GetCdxTreeHashes $runtime
WriteCdxJson '__ROOT__\cdx_runtime_manifest.json' $m
if('__MODE__' -eq 'tamper'){[IO.File]::AppendAllText((Join-Path $runtime 'package\bin\codex.js'),'tamper')}
if('__MODE__' -eq 'extra'){[IO.File]::WriteAllText((Join-Path $runtime 'extra.js'),'unreviewed')}
try {GetJakRuntime|ConvertTo-Json -Compress}
catch {@{error=$_.Exception.Message}|ConvertTo-Json -Compress}
'''.replace('__ROOT__', str(root)).replace('__SOURCE__', str(HERE)).replace('__RUNTIME__', str(runtime)).replace('__MODE__', mode), encoding='ascii')
            result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script)],
                                    capture_output=True, text=True, cwd=root, timeout=15)
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            data = json.loads(result.stdout)
            if expected:
                self.assertIn(expected, data.get('error',''))
            else:
                self.assertEqual(data, dict(exe=str(runtime/'node.exe'), cli=str(runtime/'package/bin/codex.js')))

    def test_protected(self): self.case('clean')
    def test_profile_path_refused(self): self.case('outside', 'jak_runtime_outside')
    def test_version_refused(self): self.case('version', 'jak_runtime_versiune')
    def test_tamper_refused(self): self.case('tamper', 'cdx_hash_set_mismatch')
    def test_extra_file_refused(self): self.case('extra', 'cdx_hash_set_mismatch')
