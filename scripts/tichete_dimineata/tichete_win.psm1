# tichete_win.psm1 — funcțiile WINDOWS ale „Tichete dimineața” (r6, după review-ul r5): probele de izolare ale contului agentului
# (citire / scriere REALE pe disc, grupurile tokenului, SID-ul), job object-ul (oprirea întregului arbore de procese al agentului)
# și pornirea unui proces cu mediul ÎNLOCUIT complet. Folosit de orchestrator (tichete_dimineata.ps1) și de lansator
# (lanseaza_agent.ps1). Nu are oglindă JS: se testează COMPORTAMENTAL — vitest pornește PowerShell pe Windows cu ACL-uri reale pe
# directoare temporare și cu un arbore real de procese (tichete_lib.test.mjs, „r6: separarea contului”) + autotest.ps1.
# Nu citește rețea, BD sau fișierele coordonatorului; nu scrie decât fișierul de probă (creat și șters) din Test-AccesScriere.

Set-StrictMode -Version 2

if (-not ('JobAgent' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JobAgent {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long a; public long b; public uint LimitFlags; public UIntPtr c; public UIntPtr d; public uint e; public UIntPtr f; public uint g; public uint h; }
  [StructLayout(LayoutKind.Sequential)] public struct IOC { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] public struct EXT { public BASIC Basic; public IOC Io; public UIntPtr a; public UIntPtr b; public UIntPtr c; public UIntPtr d; }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attr, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool rez);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000), FĂRĂ JOB_OBJECT_LIMIT_BREAKAWAY_OK: copiii nu pot ieși din job
  public const uint LIMITE = 0x2000;
  public static IntPtr Creeaza() {
    IntPtr j = CreateJobObject(IntPtr.Zero, null);
    if (j == IntPtr.Zero) throw new InvalidOperationException("CreateJobObject");
    EXT x = new EXT(); x.Basic.LimitFlags = LIMITE;
    if (!SetInformationJobObject(j, 9, ref x, (uint)Marshal.SizeOf(typeof(EXT)))) { CloseHandle(j); throw new InvalidOperationException("SetInformationJobObject"); }
    return j;
  }
  public static bool Adauga(IntPtr job, IntPtr proc) {
    if (!AssignProcessToJobObject(job, proc)) return false;
    bool r; if (!IsProcessInJob(proc, job, out r)) return false;
    return r;
  }
  public static bool Termina(IntPtr job) { return TerminateJobObject(job, 1); }
  public static void Inchide(IntPtr job) { CloseHandle(job); }
}
'@
}

function Test-AccesCitire {
  # $true dacă procesul curent poate citi calea (director: listare; fișier: deschidere pentru citire). Lipsă / refuz => $false.
  param([AllowNull()][string]$Cale)
  if ([string]::IsNullOrEmpty($Cale)) { return $false }
  try {
    if ([IO.Directory]::Exists($Cale)) { [void][IO.Directory]::GetFileSystemEntries($Cale); return $true }
    if ([IO.File]::Exists($Cale)) { $f = [IO.File]::Open($Cale, 'Open', 'Read', 'ReadWrite'); $f.Close(); return $true }
  } catch {}
  return $false
}

function Test-AccesScriere {
  # $true dacă procesul curent poate scrie: director => creează (și șterge) un fișier de probă cu nume aleator; fișier =>
  # deschidere pentru scriere FĂRĂ trunchiere și fără să scrie nimic. Lipsă / refuz => $false.
  param([AllowNull()][string]$Cale)
  if ([string]::IsNullOrEmpty($Cale)) { return $false }
  try {
    if ([IO.Directory]::Exists($Cale)) {
      $pr = Join-Path $Cale ('proba_scriere_' + [guid]::NewGuid().ToString('N') + '.tmp')
      $f = [IO.File]::Open($pr, 'CreateNew', 'Write', 'None'); $f.Close()
      try { [IO.File]::Delete($pr) } catch {}
      return $true
    }
    if ([IO.File]::Exists($Cale)) { $f = [IO.File]::Open($Cale, 'Open', 'Write', 'ReadWrite'); $f.Close(); return $true }
  } catch {}
  return $false
}

function Get-GrupuriToken {
  # Grupurile tokenului procesului curent, INCLUSIV cele „doar pentru refuz” (UAC), ca linii CSV `whoami /groups /fo csv /nh`.
  # whoami eșuat / ieșire goală => aruncă (necunoscut != fără grupuri). Calea e FIXĂ (System32): prin PATH, „whoami” poate fi
  # alt program (ex. cel din Git\usr\bin, care nu înțelege /groups) — prins de testul comportamental r6.
  $exe = Join-Path ([Environment]::GetFolderPath('System')) 'whoami.exe'
  $g = @(& $exe /groups /fo csv /nh)
  if ($LASTEXITCODE -ne 0 -or $g.Count -eq 0) { throw 'whoami /groups esuat' }
  if (@($g | Where-Object { $_ -match '"S-1-[0-9-]+"' }).Count -eq 0) { throw 'whoami /groups: iesire fara SID-uri' }
  return $g
}

function Test-IzolareCont {
  # Probele contului AGENTULUI, făcute SUB el (lanseaza_agent.ps1, la fiecare pornire și înaintea fiecărui agent). Întoarce
  # motivele de refuz (listă goală = izolat). Orice motiv => lansatorul refuză.
  #  - SID-ul curent e un cont (S-1-5-21-…), diferit de SID-ul coordonatorului; numele contului = cont_windows din configurare;
  #  - grupurile tokenului (din whoami, cu cele „doar pentru refuz”) nu conțin Administrators (S-1-5-32-544); grupuri necitite = refuz;
  #  - nu poate CITI nimic din InterziseCitire (probă reală: listare / deschidere);
  #  - nu poate SCRIE nimic din InterziseScriere (probă reală: fișier creat / deschis pentru scriere).
  param([AllowNull()][string]$SidCurent, [AllowNull()][string]$NumeCurent, [AllowNull()][string[]]$GrupuriCsv, [AllowNull()][string]$SidCoordonator,
        [AllowNull()][string]$ContWindows, [string[]]$InterziseCitire = @(), [string[]]$InterziseScriere = @())
  $mot = New-Object System.Collections.ArrayList
  if ([string]$SidCurent -cnotmatch '\AS-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}\z') { [void]$mot.Add('SID-ul contului curent nu e al unui cont local / de domeniu') }
  if ([string]::IsNullOrEmpty($SidCoordonator) -or [string]$SidCurent -ceq [string]$SidCoordonator) { [void]$mot.Add('agentul ruleaza sub contul coordonatorului') }
  if ([string]::IsNullOrEmpty($ContWindows) -or -not ([string]$NumeCurent).EndsWith('\' + $ContWindows, [StringComparison]::OrdinalIgnoreCase)) { [void]$mot.Add('contul curent nu e contul agentului din configurare') }
  $gr = @($GrupuriCsv | Where-Object { -not [string]::IsNullOrEmpty($_) })
  if ($gr.Count -eq 0) { [void]$mot.Add('grupurile tokenului necitite') }
  elseif (@($gr | Where-Object { $_ -match '(?:^|[",])S-1-5-32-544(?:[",]|$)' }).Count -gt 0) { [void]$mot.Add('contul agentului e membru Administrators') }
  foreach ($p in @($InterziseCitire)) { if (Test-AccesCitire $p) { [void]$mot.Add('contul agentului poate citi o cale a coordonatorului: ' + $p) } }
  foreach ($p in @($InterziseScriere)) { if (Test-AccesScriere $p) { [void]$mot.Add('contul agentului poate scrie o cale protejata: ' + $p) } }
  return @($mot)
}

function New-JobAgent {
  # Job object cu KILL_ON_JOB_CLOSE, fără BREAKAWAY_OK (copiii proceselor din job rămân în job).
  return [JobAgent]::Creeaza()
}

function Add-ProcesJob {
  # Atașează procesul la job și verifică (IsProcessInJob) că a intrat. $false = procesul NU e în job (apelantul îl oprește).
  param([IntPtr]$Job, [System.Diagnostics.Process]$Proces)
  if ($Job -eq [IntPtr]::Zero -or $null -eq $Proces) { return $false }
  return [JobAgent]::Adauga($Job, $Proces.Handle)
}

function Stop-JobAgent {
  # Oprește TOATE procesele din job (tot arborele, oricare ar fi contul lor).
  param([IntPtr]$Job)
  if ($Job -eq [IntPtr]::Zero) { return $false }
  return [JobAgent]::Termina($Job)
}

function Close-JobAgent {
  # Închide handle-ul job-ului (cu KILL_ON_JOB_CLOSE: procesele rămase sunt oprite).
  param([IntPtr]$Job)
  if ($Job -ne [IntPtr]::Zero) { [JobAgent]::Inchide($Job) }
}

function Invoke-ProcesMediu {
  # Pornește un proces cu mediul ÎNLOCUIT complet ($Mediu; nimic moștenit), stdin trimis ca octeți UTF-8 (gol = fără stdin),
  # stdout / stderr UTF-8. Timeout => kill pe tot arborele (taskkill /T) și exit -1. Întoarce @{ exit; out; err }.
  param([string]$Exe, [string]$LinieArgumente = '', [AllowNull()][string]$Cwd = '', [int]$Secunde = 300, [AllowNull()][string]$Stdin = $null,
        [hashtable]$Mediu = @{})
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.Arguments = $LinieArgumente
  $psi.UseShellExecute = $false
  $cuStdin = -not [string]::IsNullOrEmpty($Stdin)
  $psi.RedirectStandardInput = $cuStdin
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $utf8; $psi.StandardErrorEncoding = $utf8
  $psi.CreateNoWindow = $true
  if ($Cwd) { $psi.WorkingDirectory = $Cwd }
  $psi.EnvironmentVariables.Clear()
  foreach ($k in $Mediu.Keys) { if ($null -ne $Mediu[$k]) { $psi.EnvironmentVariables[[string]$k] = [string]$Mediu[$k] } }
  $p = [System.Diagnostics.Process]::Start($psi)
  $so = $p.StandardOutput.ReadToEndAsync(); $se = $p.StandardError.ReadToEndAsync()
  if ($cuStdin) {
    $oct = $utf8.GetBytes($Stdin)
    $p.StandardInput.BaseStream.Write($oct, 0, $oct.Length); $p.StandardInput.BaseStream.Flush(); $p.StandardInput.Close()
  }
  if (-not $p.WaitForExit($Secunde * 1000)) {
    try { & (Join-Path ([Environment]::GetFolderPath('System')) 'taskkill.exe') /PID $p.Id /T /F | Out-Null } catch {}
    return @{ exit = -1; out = ''; err = 'timeout' }
  }
  $p.WaitForExit()
  return @{ exit = $p.ExitCode; out = $so.Result; err = $se.Result }
}

function Copy-IesireAgent {
  # Copiază un fișier scris de agent (DATE neîncrezute) ca octeți, într-un fișier al orchestratorului: fără legături (reparse
  # point) pe fișier și pe directorul lui, plafon de mărime verificat și pe octeții citiți. Aruncă la orice abatere.
  param([string]$Sursa, [string]$Destinatie, [long]$Max)
  if (-not [IO.File]::Exists($Sursa)) { throw 'fisierul agentului lipseste' }
  foreach ($x in @((Get-Item -LiteralPath $Sursa -Force), (Get-Item -LiteralPath (Split-Path -Parent $Sursa) -Force))) {
    if (($x.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'iesirea agentului e o legatura (reparse point)' }
  }
  $fs = [IO.File]::Open($Sursa, 'Open', 'Read', 'Read')
  try {
    if ($fs.Length -gt $Max) { throw 'iesirea agentului e prea mare' }
    $buf = New-Object byte[] ([int]$fs.Length)
    $n = 0
    while ($n -lt $buf.Length) { $r = $fs.Read($buf, $n, $buf.Length - $n); if ($r -le 0) { break }; $n += $r }
    if ($n -ne $buf.Length -or $fs.ReadByte() -ne -1) { throw 'iesirea agentului s-a schimbat in timpul citirii' }
  } finally { $fs.Dispose() }
  [IO.File]::WriteAllBytes($Destinatie, $buf)
}

Export-ModuleMember -Function Test-AccesCitire, Test-AccesScriere, Get-GrupuriToken, Test-IzolareCont, New-JobAgent, Add-ProcesJob, Stop-JobAgent,
  Close-JobAgent, Invoke-ProcesMediu, Copy-IesireAgent
