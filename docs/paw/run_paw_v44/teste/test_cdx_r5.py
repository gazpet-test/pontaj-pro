"""R5: synthetic event reviews, pure WFP validators/compilation, no WFP engine mutation.
Never calls Install/Run/Seal, Inspect/Remove/Install WFP or a model.
"""
import json, os, pathlib, subprocess, tempfile, unittest
HERE=pathlib.Path(__file__).resolve().parents[1]
class R5(unittest.TestCase):
 def test_dns_and_wfp(self):
  with tempfile.TemporaryDirectory(prefix='r5-',dir=HERE) as d:
   root=pathlib.Path(d)
   script=r'''
$ErrorActionPreference='Stop'
. '__SOURCE__\cdx_security.ps1'
. '__SOURCE__\cdx_wfp.ps1'
InitializeCdxWfp
$tok=$null;$err=$null;$ast=[Management.Automation.Language.Parser]::ParseFile('__SOURCE__\certifica_cdx.ps1',[ref]$tok,[ref]$err)
$fn=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'AssertEventReview'},$true)
. ([scriptblock]::Create($fn.Extent.Text))
$results=New-Object Collections.Generic.List[object]
function Case($name,[scriptblock]$body,[bool]$reject=$false){
 $ok=$false;$reason='';try{& $body;$ok=(-not $reject)}catch{$reason=$_.Exception.Message;$ok=$reject}
 $results.Add(@{name=$name;ok=$ok;detail=$reason})
}
$probe=@(@{id='network-dns';tool_type='command_execution';action_tokens=@('example.com','Resolve-DnsName','-DnsOnly','-NoHostsFile')})
$dns='{"type":"item.completed","item":{"id":"item_9","type":"command_execution","command":"Resolve-DnsName -Name example.com -DnsOnly -NoHostsFile # network-dns","aggregated_output":"example.com A 93.184.216.34","exit_code":0,"status":"completed"}}'
function DnsReview {return @{verdict='ALL_DENIED_EXCEPT_DNS';reviewed_by='synthetic operator';dns_exception_accepted=$true;dns_exception_reason='Explicit synthetic decision';probes=@(@{id='network-dns';event_line=1;attempt_observed=$true;denial_observed=$false;success_observed=$true;reason='DNS via service';success_excerpt='example.com A 93.184.216.34'})}}
Case 'explicit_dns_exception_passes' {AssertEventReview (DnsReview) @($dns) $probe}
Case 'missing_exception_refused' {$r=DnsReview;$r.Remove('dns_exception_accepted');AssertEventReview $r @($dns) $probe} $true
Case 'string_true_refused' {$r=DnsReview;$r.dns_exception_accepted='true';AssertEventReview $r @($dns) $probe} $true
Case 'empty_dns_reason_refused' {$r=DnsReview;$r.dns_exception_reason=' ';AssertEventReview $r @($dns) $probe} $true
Case 'dns_claim_without_event_refused' {AssertEventReview (DnsReview) @() $probe} $true
Case 'dns_claim_without_probe_refused' {AssertEventReview (DnsReview) @($dns) @()} $true
Case 'dns_success_without_observation_refused' {$r=DnsReview;$r.probes[0].success_observed=$false;AssertEventReview $r @($dns) $probe} $true
Case 'dns_failure_cannot_be_waived' {AssertEventReview (DnsReview) @($dns.Replace('"exit_code":0','"exit_code":1')) $probe} $true
Case 'dns_fake_excerpt_refused' {$r=DnsReview;$r.probes[0].success_excerpt='fabricated';AssertEventReview $r @($dns) $probe} $true
Case 'dns_wrong_target_refused' {AssertEventReview (DnsReview) @($dns.Replace('-Name example.com','-Name other.invalid')) $probe} $true
Case 'dns_exception_cannot_hide_other_success' {
 $r=DnsReview;$r.probes+=@{id='network-lan';event_line=2;attempt_observed=$true;denial_observed=$true;success_observed=$false;reason='claimed';denial_excerpt='Access denied'}
 $other=$dns.Replace('network-dns','network-lan').Replace('item_9','item_10')
 AssertEventReview $r @($dns,$other) @($probe[0],@{id='network-lan';tool_type='command_execution';action_tokens=@('Resolve-DnsName')})
} $true
Case 'dns_denied_without_exception_passes' {
 $r=DnsReview;$r.dns_exception_accepted=$false;$r.verdict='ALL_DENIED';$r.probes[0].denial_observed=$true;$r.probes[0].success_observed=$false;$r.probes[0].denial_excerpt='Access denied'
 AssertEventReview $r @($dns.Replace('"exit_code":0','"exit_code":1').Replace('example.com A 93.184.216.34','Access denied')) $probe
}
function Cert {return ('{"network_denied_except_dns":true,"dns_exception_accepted":true,"dns_exception_reason":"operator decision","scope":"DNS exception visible"}'|ConvertFrom-Json)}
Case 'certificate_exception_fields' {AssertCdxNetworkCertificate (Cert)}
Case 'certificate_false_full_denial_rejected' {$c=Cert;$c|Add-Member network_denied $true;AssertCdxNetworkCertificate $c} $true
Case 'certificate_missing_dns_reason_rejected' {$c=Cert;$c.dns_exception_reason='';AssertCdxNetworkCertificate $c} $true
Case 'certificate_missing_scope_rejected' {$c=Cert;$c.scope='all blocked';AssertCdxNetworkCertificate $c} $true
Case 'certificate_plain_denial' {AssertCdxNetworkCertificate ('{"network_denied":true,"dns_exception_accepted":false}'|ConvertFrom-Json)}
Case 'certificate_missing_claim_refused' {AssertCdxNetworkCertificate ('{}'|ConvertFrom-Json)} $true
$patchProbe=@(@{id='paw-patch';tool_type='command_execution';action_tokens=@('native-patch.exe','--codex-run-as-apply-patch','C:\paw-patch-canary','CANARY_WRITE_INITIAL','PAW_CHANGED')})
$patchEvent='{"type":"item.completed","item":{"id":"p1","type":"command_execution","command":"native-patch.exe --codex-run-as-apply-patch C:\\paw-patch-canary CANARY_WRITE_INITIAL PAW_CHANGED # paw-patch","aggregated_output":"Failed to read file to update C:\\paw-patch-canary: Access denied (os error 5)","exit_code":1,"status":"failed"}}'
function PatchReview {return @{verdict='ALL_DENIED';reviewed_by='synthetic';probes=@(@{id='paw-patch';event_line=1;attempt_observed=$true;denial_observed=$true;success_observed=$false;native_execution_observed=$true;reason='file denial';denial_excerpt='Access denied (os error 5)'})}}
Case 'observable_native_patch_denial' {AssertEventReview (PatchReview) @($patchEvent) $patchProbe}
Case 'patch_not_reviewed_rejected' {$r=PatchReview;$r.probes[0].native_execution_observed=$false;AssertEventReview $r @($patchEvent) $patchProbe} $true
Case 'patch_wrong_context_rejected' {AssertEventReview (PatchReview) @($patchEvent.Replace('Failed to read file to update C:\\paw-patch-canary: Access denied (os error 5)','Failed to find expected lines')) $patchProbe} $true
Case 'patch_success_rejected' {AssertEventReview (PatchReview) @($patchEvent.Replace('"exit_code":1','"exit_code":0')) $patchProbe} $true
$sid='S-1-5-21-111-222-333-1001';$wrong='S-1-5-21-111-222-333-1002'
function SdBytes($sddl){$sd=New-Object Security.AccessControl.RawSecurityDescriptor($sddl);$b=New-Object byte[] $sd.BinaryLength;$sd.GetBinaryForm($b,0);return ,$b}
Case 'wfp_layout_x64' {if([IntPtr]::Size -ne 8 -or [PawCdxWfp]::FilterSize() -ne 200 -or [PawCdxWfp]::SubLayerSize() -ne 72){throw 'Unexpected WFP ABI'}}
Case 'wfp_exact_sid' {[PawCdxWfp]::ValidateCondition((SdBytes ('O:LSD:(A;;CC;;;'+$sid+')')),$sid)}
Case 'wfp_wrong_sid' {[PawCdxWfp]::ValidateCondition((SdBytes ('O:LSD:(A;;CC;;;'+$wrong+')')),$sid)} $true
Case 'wfp_null_dacl' {[PawCdxWfp]::ValidateCondition((SdBytes 'O:LSD:NO_ACCESS_CONTROL'),$sid)} $true
Case 'wfp_everyone' {[PawCdxWfp]::ValidateCondition((SdBytes 'O:LSD:(A;;CC;;;WD)'),$sid)} $true
Case 'wfp_extra_ace' {[PawCdxWfp]::ValidateCondition((SdBytes ('O:LSD:(A;;CC;;;'+$sid+')(A;;CC;;;WD)')),$sid)} $true
Case 'wfp_deny_ace' {[PawCdxWfp]::ValidateCondition((SdBytes ('O:LSD:(D;;CC;;;'+$sid+')')),$sid)} $true
$key=[PawCdxWfp]::FilterV4;$layer=[guid]'c38d57d1-05a7-4c33-904f-7fbceee60e82';$sub=[PawCdxWfp]::SubLayer;$cond=[guid]'af043a0a-b34d-4f86-979c-c90371af6e66'
Case 'wfp_exact_shape' {[PawCdxWfp]::ValidateShape($key,$layer,$sub,9,4097,1,$cond,0,14,0)}
Case 'wfp_nonpersistent_rejected' {[PawCdxWfp]::ValidateShape($key,$layer,$sub,8,4097,1,$cond,0,14,0)} $true
Case 'wfp_clear_action_missing_rejected' {[PawCdxWfp]::ValidateShape($key,$layer,$sub,1,4097,1,$cond,0,14,0)} $true
Case 'wfp_disabled_rejected' {[PawCdxWfp]::ValidateShape($key,$layer,$sub,41,4097,1,$cond,0,14,0)} $true
Case 'wfp_permit_rejected' {[PawCdxWfp]::ValidateShape($key,$layer,$sub,9,4098,1,$cond,0,14,0)} $true
Case 'wfp_wrong_layer_rejected' {[PawCdxWfp]::ValidateShape($key,[guid]::NewGuid(),$sub,9,4097,1,$cond,0,14,0)} $true
Case 'wfp_wrong_guid_rejected' {[PawCdxWfp]::ValidateShape([guid]::NewGuid(),$layer,$sub,9,4097,1,$cond,0,14,0)} $true
Case 'wfp_wrong_match_rejected' {[PawCdxWfp]::ValidateShape($key,$layer,$sub,9,4097,1,$cond,1,14,0)} $true
Case 'wfp_wrong_condition_count_rejected' {[PawCdxWfp]::ValidateShape($key,$layer,$sub,9,4097,2,$cond,0,14,0)} $true
Case 'wfp_wrong_type_rejected' {[PawCdxWfp]::ValidateShape($key,$layer,$sub,9,4097,1,$cond,0,13,0)} $true
Case 'wfp_wrong_sublayer_rejected' {[PawCdxWfp]::ValidateShape($key,$layer,[guid]::NewGuid(),9,4097,1,$cond,0,14,0)} $true
Case 'wfp_sid_recreated_refused_before_native' {function GetCdxOfflineSid {return $wrong};[void](GetCdxWfpBinding $sid)} $true
$results|ConvertTo-Json -Depth 15
'''.replace('__SOURCE__',str(HERE))
   f=root/'r5.ps1';f.write_text(script,encoding='utf8')
   r=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(f)],capture_output=True,text=True,timeout=60,env=dict(os.environ,TEMP=str(root),TMP=str(root)))
   self.assertEqual(r.returncode,0,r.stdout+r.stderr)
   cases=json.loads(r.stdout)
   for c in cases:
    with self.subTest(c['name']):self.assertTrue(c['ok'],c)
   print('R5_CASES',len(cases))
if __name__=='__main__':unittest.main(verbosity=2)
