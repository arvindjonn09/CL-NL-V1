This folder is populated by `..\build.ps1`.

Do not edit or replace these binaries by hand for production builds. The build
script rebuilds the agent, bootstrap, and updater binaries, copies them here,
and verifies that the `assets` copies match the fresh `build` outputs by
SHA256.

Packaging-only builds are allowed when this `SetuLinkSetup` folder is copied to
a Windows machine without the full repo. In that mode, all packaged assets must
already be present here before running `build.ps1` with the skip flags:

```text
assets\setulink-agent.exe
assets\SetuLinkInstallerBootstrap.exe
assets\setulink-updater.exe
assets\ffmpeg\ffmpeg.exe
```

The build prints the full path, SHA256, and file size for each packaged asset so
operators can prove exactly which binaries were included.
