#define MyAppName "SetuLink"
#ifndef MyAppVersion
#define MyAppVersion "0.1.0"
#endif
#define MyAppPublisher "SetuLink"
#define BootstrapExe "build\SetuLinkInstallerBootstrap.exe"
#define AgentExe "build\setulink-agent.exe"
#define UpdaterExe "build\setulink-updater.exe"
#define FfmpegAssets "assets\ffmpeg\*"
#define ConfigTemplate "config.template.json"
#ifndef DefaultBackendUrl
#define DefaultBackendUrl "https://netraapi.shivomsangha.com"
#endif

[Setup]
AppId={{9C817F7F-7A9B-4F9D-9DA5-8C3B5C9F4A28}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\SetuLink
DefaultGroupName=SetuLink
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=SetuLinkSetup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin
ChangesAssociations=no
DisableReadyMemo=no
Uninstallable=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#BootstrapExe}"; DestDir: "{tmp}\SetuLinkSetup"; Flags: deleteafterinstall ignoreversion
Source: "{#AgentExe}"; DestDir: "{tmp}\SetuLinkSetup\assets"; Flags: deleteafterinstall ignoreversion
Source: "{#UpdaterExe}"; DestDir: "{tmp}\SetuLinkSetup\assets"; Flags: deleteafterinstall ignoreversion
Source: "{#FfmpegAssets}"; DestDir: "{tmp}\SetuLinkSetup\assets\ffmpeg"; Flags: deleteafterinstall ignoreversion recursesubdirs createallsubdirs
Source: "{#ConfigTemplate}"; DestDir: "{tmp}\SetuLinkSetup"; Flags: deleteafterinstall ignoreversion

[Code]
var
  BackendPage: TInputQueryWizardPage;

function QuoteForCmd(const Value: string): string;
var
  I: Integer;
  Escaped: string;
begin
  Escaped := '';
  for I := 1 to Length(Value) do
  begin
    if Value[I] = '"' then
      Escaped := Escaped + '\"'
    else
      Escaped := Escaped + Value[I];
  end;

  Result := '"' + Escaped + '"';
end;

function BackendUrlValue(): string;
var
  ParamValue: string;
begin
  ParamValue := Trim(ExpandConstant('{param:BACKENDURL|}'));
  if ParamValue <> '' then
  begin
    Result := ParamValue;
    Exit;
  end;

  if BackendPage = nil then
    Result := '{#DefaultBackendUrl}'
  else
    Result := Trim(BackendPage.Values[0]);
end;

function IsBadBackendUrl(const Value: string): Boolean;
var
  LowerValue: string;
begin
  LowerValue := Lowercase(Trim(Value));
  Result :=
    (LowerValue = '') or
    (Pos('://netralink.shivomsangha.com', LowerValue) > 0) or
    ((Pos('https://', LowerValue) <> 1) and (Pos('http://', LowerValue) <> 1));
end;

function BackendOverrideValue(): string;
var
  Value: string;
begin
  Value := BackendUrlValue();
  if Value <> '{#DefaultBackendUrl}' then
    Result := Value
  else
    Result := '';
end;

procedure InitializeWizard();
begin
  BackendPage := CreateInputQueryPage(
    wpWelcome,
    'SetuLink Backend',
    'Enter the SetuLink API backend URL',
    'Use the API host, not the dashboard/frontend host.'
  );
  BackendPage.Add('Backend URL:', False);
  BackendPage.Values[0] := '{#DefaultBackendUrl}';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = BackendPage.ID then
  begin
    if IsBadBackendUrl(BackendPage.Values[0]) then
    begin
      MsgBox(
        'Backend URL must point to the API host, e.g. https://netraapi.shivomsangha.com',
        mbError,
        MB_OK
      );
      Result := False;
    end;
  end;
end;

function RunBootstrap(): Boolean;
var
  ResultCode: Integer;
  CmdLine: string;
  BootstrapPath: string;
  BackendOverride: string;
begin
  Result := False;
  BootstrapPath := ExpandConstant('{tmp}\SetuLinkSetup\SetuLinkInstallerBootstrap.exe');
  BackendOverride := BackendOverrideValue();

  if not FileExists(BootstrapPath) then
  begin
    MsgBox(
      'SetuLink bootstrap was not found at:' + #13#10 + BootstrapPath,
      mbCriticalError,
      MB_OK
    );
    Exit;
  end;

  CmdLine :=
    '-install-dir ' + QuoteForCmd(ExpandConstant('{autopf}\SetuLink')) + ' ' +
    '-data-dir ' + QuoteForCmd(ExpandConstant('{commonappdata}\SetuLink')) + ' ' +
    '-default-backend-url ' + QuoteForCmd('{#DefaultBackendUrl}') + ' ' +
    '-agent-binary ' + QuoteForCmd(ExpandConstant('{tmp}\SetuLinkSetup\assets\setulink-agent.exe')) + ' ' +
    '-updater-binary ' + QuoteForCmd(ExpandConstant('{tmp}\SetuLinkSetup\assets\setulink-updater.exe')) + ' ' +
    '-ffmpeg-dir ' + QuoteForCmd(ExpandConstant('{tmp}\SetuLinkSetup\assets\ffmpeg')) + ' ' +
    '-config-template ' + QuoteForCmd(ExpandConstant('{tmp}\SetuLinkSetup\config.template.json')) + ' ' +
    '-version ' + QuoteForCmd('{#MyAppVersion}');

  if BackendOverride <> '' then
    CmdLine := CmdLine + ' -backend-url ' + QuoteForCmd(BackendOverride);

  if not Exec(BootstrapPath, CmdLine, '', SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode) then
  begin
    MsgBox(
      'Failed to launch the SetuLink bootstrap installer.' + #13#10 +
      'Path: ' + BootstrapPath + #13#10 +
      'Error: ' + SysErrorMessage(ResultCode),
      mbCriticalError,
      MB_OK
    );
    Exit;
  end;

  if ResultCode <> 0 then
  begin
    MsgBox(
      'SetuLink installation failed. See C:\ProgramData\SetuLink\logs\installer.log for details.',
      mbCriticalError,
      MB_OK
    );
    Exit;
  end;

  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := 'Installing SetuLink files and validating first run...';
    if not RunBootstrap() then
      Abort;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    WizardForm.FinishedLabel.Caption :=
      'SetuLink installation completed. Logs are available under C:\ProgramData\SetuLink\logs.';
  end;
end;
