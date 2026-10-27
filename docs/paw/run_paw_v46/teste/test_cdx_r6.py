"""Pure acceptance/DACL planning tests; NEVER opens or changes the WFP engine."""
import json,os,pathlib,subprocess,tempfile,unittest
HERE=pathlib.Path(__file__).resolve().parents[1]
class R6(unittest.TestCase):
 def test_residual_and_engine_plans(self):
  with tempfile.TemporaryDirectory(prefix='r6-',dir=HERE) as d:
   root=pathlib.Path(d)
   script=r'''
$ErrorActionPreference='Stop'
. '__SOURCE__\cdx_security.ps1'
. '__SOURCE__\cdx_wfp.ps1'
InitializeCdxWfp
$cases=New-Object Collections.Generic.List[object]
function Case($name,[scriptblock]$body,[bool]$reject=$false){
 $ok=$false;$detail='';try{& $body;$ok=-not $reject}catch{$detail=$_.Exception.Message;$ok=$reject}
 $cases.Add(@{name=$name;ok=$ok;detail=$detail})
}
function Review {return @{parent_apply_patch_residual_accepted=$true;parent_apply_patch_residual_reason='Explicit operator decision'}}
function Cert {return [pscustomobject]@{parent_apply_patch_residual_accepted=$true;parent_apply_patch_residual_reason='Explicit operator decision';parent_apply_patch='policy-enforced, not OS-attested';scope='parent_apply_patch=policy-enforced, not OS-attested'}}
Case 'residual_accepted' {AssertCdxParentPatchAcceptance (Review)}
Case 'absent_rejected' {AssertCdxParentPatchAcceptance @{}} $true
Case 'false_rejected' {$r=Review;$r.parent_apply_patch_residual_accepted=$false;AssertCdxParentPatchAcceptance $r} $true
Case 'string_true_rejected' {$r=Review;$r.parent_apply_patch_residual_accepted='true';AssertCdxParentPatchAcceptance $r} $true
Case 'empty_reason_rejected' {$r=Review;$r.parent_apply_patch_residual_reason=' ';AssertCdxParentPatchAcceptance $r} $true
Case 'object_reason_rejected' {$r=Review;$r.parent_apply_patch_residual_reason=@{x=1};AssertCdxParentPatchAcceptance $r} $true
Case 'certificate_valid' {AssertCdxParentPatchCertificate (Cert)}
Case 'certificate_missing_scope_rejected' {$c=Cert;$c.scope='OS confined';AssertCdxParentPatchCertificate $c} $true
Case 'certificate_false_attestation_rejected' {$c=Cert;$c.parent_apply_patch='OS-attested';AssertCdxParentPatchCertificate $c} $true
Case 'certificate_missing_acceptance_rejected' {$c=Cert;$c.parent_apply_patch_residual_accepted=$null;AssertCdxParentPatchCertificate $c} $true
function Acl($sddl){$sd=New-Object Security.AccessControl.RawSecurityDescriptor($sddl);$a=$sd.DiscretionaryAcl;$b=New-Object byte[] $a.BinaryLength;$a.GetBinaryForm($b,0);return [Convert]::ToBase64String($b)}
function Decode($b64){return [Security.AccessControl.RawAcl]::new([Convert]::FromBase64String($b64),0)}
function AceBytes($ace){$b=New-Object byte[] $ace.BinaryLength;$ace.GetBinaryForm($b,0);return [Convert]::ToBase64String($b)}
$sid='S-1-5-21-111-222-333-1001';$other='S-1-5-21-111-222-333-1002'
$before=Acl 'D:(D;;DC;;;WD)(A;;GA;;;SY)(A;;GA;;;BA)'
$plan=[PawCdxWfp]::PlanEngineRead($before,$sid)
Case 'minimum_mask_header_values' {if([PawCdxWfp]::EngineReadMask -ne 0xC0 -or $plan.Mask -ne 192){throw 'Wrong SDK rights'}}
Case 'one_new_read_ace_only' {
 $a=Decode $before;$b=Decode $plan.After
 if(-not $plan.Added -or $b.Count -ne $a.Count+1){throw 'Not one addition'}
 for($i=0;$i -lt $a.Count;$i++){if((AceBytes $a[$i]) -cne (AceBytes $b[$i])){throw 'Existing ACE changed'}}
 $new=$b[$b.Count-1];if($new.SecurityIdentifier.Value -cne $sid -or $new.AccessMask -ne 0xC0 -or $new.AceFlags -ne 0 -or $new.IsCallback -or $new.AceQualifier -ne 'AccessAllowed'){throw 'ACE not minimal'}
}
Case 'grant_idempotent' {$p=[PawCdxWfp]::PlanEngineRead($plan.After,$sid);if($p.Added -or $p.After -cne $plan.After){throw 'Duplicated grant'}}
Case 'rollback_exact_delta' {if([PawCdxWfp]::PlanEngineRevoke($plan.After,$before,$plan.After,$sid,$true) -cne $before){throw 'Wrong rollback'}}
Case 'rollback_idempotent' {if([PawCdxWfp]::PlanEngineRevoke($before,$before,$plan.After,$sid,$true) -cne $before){throw 'Wrong repeat'}}
Case 'preexisting_ace_never_removed' {$p=[PawCdxWfp]::PlanEngineRead($plan.After,$sid);if([PawCdxWfp]::PlanEngineRevoke($p.After,$p.Before,$p.After,$sid,$false) -cne $p.After){throw 'Removed preexisting ACE'}}
Case 'unrelated_drift_refused' {$changed=Acl ('D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;0xC0;;;'+$sid+')(A;;RC;;;'+$other+')');[void][PawCdxWfp]::PlanEngineRevoke($changed,$before,$plan.After,$sid,$true)} $true
Case 'merged_broader_ace_refused' {$changed=Acl ('D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;'+$sid+')');[void][PawCdxWfp]::PlanEngineRevoke($changed,$before,$plan.After,$sid,$true)} $true
Case 'forged_receipt_refused' {[void][PawCdxWfp]::PlanEngineRevoke($plan.After,$before,$plan.After,$other,$true)} $true
Case 'false_ownership_refused' {[void][PawCdxWfp]::PlanEngineRevoke($plan.After,$before,$plan.After,$sid,$false)} $true
Case 'ambiguous_duplicate_refused' {$dup=Acl ('D:(A;;0xC0;;;'+$sid+')(A;;0xC0;;;'+$sid+')');[void][PawCdxWfp]::PlanEngineRead($dup,$sid)} $true
Case 'malformed_sid_refused' {[void][PawCdxWfp]::PlanEngineRead($before,'Everyone')} $true
Case 'malformed_acl_refused' {[void][PawCdxWfp]::PlanEngineRead('not-base64',$sid)} $true
Case 'inherited_aces_preserved' {
 $a=Acl 'D:(D;;DC;;;WD)(A;ID;GR;;;BU)';$p=[PawCdxWfp]::PlanEngineRead($a,$sid);$x=Decode $a;$y=Decode $p.After
 if((AceBytes $x[0]) -cne (AceBytes $y[0]) -or (AceBytes $x[1]) -cne (AceBytes $y[2]) -or $y[1].SecurityIdentifier.Value -cne $sid){throw 'Order/inheritance changed'}
}
# Syntax only; no maintenance entrypoint or live WFP call is executed.
Case 'maintenance_and_all_ps_syntax' {
 foreach($file in Get-ChildItem '__SOURCE__' -Filter '*.ps1'){$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$t,[ref]$e);if($e.Count){throw ($file.Name+': '+($e.Message -join ';'))}}
}
$cases|ConvertTo-Json -Depth 10
'''.replace('__SOURCE__',str(HERE))
   f=root/'fixture.ps1';f.write_text(script,encoding='utf8')
   r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(f)],capture_output=True,text=True,timeout=60,env=dict(os.environ,TEMP=str(root),TMP=str(root)))
   self.assertEqual(r.returncode,0,r.stdout+r.stderr)
   cases=json.loads(r.stdout)
   for c in cases:
    with self.subTest(c['name']):self.assertTrue(c['ok'],c)
   print('R6_CASES',len(cases))
if __name__=='__main__':unittest.main(verbosity=2)
