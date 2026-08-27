; OpenWorker Suite — Windows installer (Inno Setup wrapping the SEA binary)
; srs.md §6, FR-D1. Build with ISCC.exe windows.iss
; Artifact name produced by CI: OpenWorker-setup-x64.exe

#define MyAppName "OpenWorker"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "nsk"
#define MyAppExeName "openworker.exe"

[Setup]
AppId={{7E9B6C31-8A54-4F3E-9D2A-OPENWORKER01}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
PrivilegesRequired=lowest
OutputBaseFilename=OpenWorker-setup-x64
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}

[Tasks]
Name: "autostart"; Description: "Start the OpenWorker dashboard at login (loopback only)"; Flags: unchecked

[Files]
Source: "..\dist-bin\openworker-x64.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
Source: "..\README.md"; DestDir: "{app}"; Flags: skipifsourcedoesntexist

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: autostart

[Run]
Filename: "{cmd}"; Parameters: "/C {app}\{#MyAppExeName} status"; Description: "Verify installation (openworker status)"; Flags: postinstall runasoriginaluser skipifdoesntexist

[Registry]
; optional autostart of `serve` via Run key (loopback-only server per NFR-9)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "OpenWorkerDashboard"; ValueData: """{app}\{#MyAppExeName}"" serve"; Tasks: autostart; Flags: uninsdeletevalue

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    // Keys are stored per-user via DPAPI (FR-K1); nothing secret is written here.
    Log('OpenWorker installed for user.');
  end;
end;
