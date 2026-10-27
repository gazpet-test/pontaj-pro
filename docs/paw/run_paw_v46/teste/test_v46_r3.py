"""R3 regression cases: synthetic secrets and real PowerShell children."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import tomllib
import unittest
from . import test_v46_r2 as fixtures
HERE, PS = fixtures.HERE, fixtures.PS


class Isolation(unittest.TestCase):
    def test_foreign_env_http_headers_preflight_has_no_variable(self):
        fixtures.Mcp().case('foreign_env_header', 'jak_mcp_refuzat')

    def test_home_allow_rules_refused_before_mcp(self):
        fixtures.Mcp().case('home_rules', 'jak_rules_neverificabile')

    def test_system_allow_rules_refused_before_mcp(self):
        fixtures.Mcp().case('system_rules', 'jak_rules_neverificabile')

    def test_system_config_refused_before_mcp(self):
        fixtures.Mcp().case('system_config', 'jak_rules_neverificabile')

    def test_managed_allow_requirements_refused_before_mcp(self):
        fixtures.Mcp().case('system_requirements', 'jak_rules_neverificabile')

    def test_legacy_managed_file_refused_before_mcp(self):
        fixtures.Mcp().case('system_managed', 'jak_rules_neverificabile')

    def test_rules_wrong_type_refused_before_mcp(self):
        fixtures.Mcp().case('rules_not_directory', 'jak_rules_neverificabile')

    def ps(self, script):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            path = root/'probe.ps1'
            path.write_text(script.replace('__SOURCE__', str(HERE)).replace('__ROOT__', str(root)), encoding='ascii')
            result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(path)],
                cwd=root, capture_output=True, text=True, timeout=30,
                env=dict(os.environ, TEMP=str(root), TMP=str(root), LOCALAPPDATA=str(root),
                         PSModuleAnalysisCachePath=str(root/'ModuleAnalysisCache')))
            self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            return result.stdout.strip()

    def test_rules_io_error_is_not_absence(self):
        out = self.ps(r'''
. '__SOURCE__\jak.ps1'
function GetJakSystemPolicyRoots {return '__ROOT__'}
function GetJakPolicyItem($path){throw 'synthetic access denied'}
try {AssertJakRules '__ROOT__';throw 'unexpected success'} catch {$_.Exception.Message}
''')
        self.assertEqual(out, 'jak_rules_neverificabile')

    def test_explicit_backend_config_and_cli_match_v45(self):
        data = json.loads(self.ps(r'''
. '__SOURCE__\jak.ps1'
@{config=(GetJakConfig);overrides=@(GetJakOverrides '__ROOT__' $false)}|ConvertTo-Json -Compress
'''))
        cfg = tomllib.loads(data['config'])
        self.assertEqual(cfg['windows']['sandbox'], 'unelevated')
        self.assertEqual(cfg['sandbox_mode'], 'read-only')
        self.assertEqual(cfg['approval_policy'], 'never')
        self.assertIn('windows.sandbox="unelevated"', data['overrides'][0])

    def test_gemini_restored_hash_needs_new_marker(self):
        out = self.ps(r'''
$ErrorActionPreference='Stop'
$DATA='__ROOT__'
$GEMPW=Join-Path $DATA 'gemini_pw.py'
[IO.File]::Copy('__SOURCE__\..\run_paw_v45\gemini_pw.py',$GEMPW)
function CaleSigura($path,$roots,$write){return $path}
function HashCdx($path){return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash}
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\run_paw.ps1',[ref]$tokens,[ref]$errors)
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -ceq 'VerificaCanalGem'},$true)
Invoke-Expression $fn.Extent.Text
$marker=Join-Path $DATA 'gem_canal_validat'
$h46=HashCdx '__SOURCE__\gemini_pw.py'
$h45=HashCdx $GEMPW
if($h45 -eq $h46){throw 'fixture needs distinct versions'}
[IO.File]::WriteAllText($marker,('CANAL_VALIDAT '+$h46+' old'))
$rejected=$false
try {VerificaCanalGem}catch {$rejected=$_.Exception.Message -like '*alta versiune*'}
if(-not $rejected){throw 'v46 marker accepted for v45'}
Remove-Item -LiteralPath $marker
$rejected=$false
try {VerificaCanalGem}catch {$rejected=$_.Exception.Message -like '*lipseste*'}
if(-not $rejected){throw 'missing marker accepted'}
[IO.File]::WriteAllText($marker,('CANAL_VALIDAT '+$h45+' Razvan-v45-rollback-r3'))
VerificaCanalGem
'ROLLBACK_GATE_OK'
''')
        self.assertEqual(out, 'ROLLBACK_GATE_OK')

    def test_runbook_requires_observed_read_write_and_rollback_retest(self):
        text = (HERE/'RUNBOOK_RAZVAN.md').read_text(encoding='ascii')
        for evidence in ('citirea chiar a fost EXECUTATA si a REUSIT',
                         'scrierea chiar a fost INCERCATA si REFUZATA',
                         '--ignore-rules', 'notify=[]',
                         'Razvan-v45-rollback-r3', 'ciorna_cu_atasamente'):
            self.assertIn(evidence, text)
        rollback = text.split('## 8. Rollback explicit la v45', 1)[1]
        self.assertLess(rollback.index('Move-Item -LiteralPath $GemMarker'), rollback.index('Move-Item -LiteralPath $Bin'))
        self.assertLess(rollback.index('trimite $RollbackBrief 120'), rollback.index("$GemLine = 'CANAL_VALIDAT '"))
        self.assertLess(rollback.index("$GemLine = 'CANAL_VALIDAT '"), rollback.index('run_paw.cmd" gem $RollbackBrief'))
