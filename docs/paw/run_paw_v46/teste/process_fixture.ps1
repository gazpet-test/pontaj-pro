# Numai harness: CIM este interzis in container. Citim procese REALE prin Win32,
# fara CDP si fara a inlocui DriverOrfani sau garzile de productie.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class PawProcessFixture {
 public int ProcessId, ParentProcessId;
 public string ExecutablePath, CommandLine;
 public DateTime CreationDate;
 [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h,int cls,IntPtr buf,int size,out int used);
 public static PawProcessFixture[] Snapshot() {
  var rows=new List<PawProcessFixture>();
  foreach(var p in Process.GetProcesses()) {
   try {
    if(p.HasExited) continue;
    var row=new PawProcessFixture(); row.ProcessId=p.Id;
    row.CreationDate=p.StartTime;
    IntPtr basic=Marshal.AllocHGlobal(48);
    try {int used; if(NtQueryInformationProcess(p.Handle,0,basic,48,out used)!=0) continue;
     row.ParentProcessId=(int)Marshal.ReadIntPtr(basic,IntPtr.Size==8?40:20);
    } finally {Marshal.FreeHGlobal(basic);}
    int size; NtQueryInformationProcess(p.Handle,60,IntPtr.Zero,0,out size);
    if(size>0) {
     IntPtr buf=Marshal.AllocHGlobal(size);
     try {int used;if(NtQueryInformationProcess(p.Handle,60,buf,size,out used)==0) {
      int len=(ushort)Marshal.ReadInt16(buf);
      row.CommandLine=Marshal.PtrToStringUni(Marshal.ReadIntPtr(buf,IntPtr.Size==8?8:4),len/2);
     }} finally {Marshal.FreeHGlobal(buf);}
    }
    try {row.ExecutablePath=p.MainModule.FileName;} catch {}
    rows.Add(row);
   } catch {} finally {p.Dispose();}
  }
  return rows.ToArray();
 }
}
'@
function Get-CimInstance([string]$ClassName) {
 if($ClassName -cne 'Win32_Process'){throw 'fixture only supports processes'}
 [PawProcessFixture]::Snapshot()
}
