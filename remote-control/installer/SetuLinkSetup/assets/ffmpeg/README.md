Place the Windows ffmpeg runtime files for the installer here.

Required:

- `ffmpeg.exe`
- Any DLLs required by the chosen Windows build, if it is not fully static.

The installer build does not download ffmpeg. `build.ps1` fails unless
`assets\ffmpeg\ffmpeg.exe` exists, then packages this directory into
`dist\SetuLinkSetup.exe`. During install, the bootstrap copies these files to:

```text
C:\Program Files\SetuLink\ffmpeg\
```

Use a trusted Windows ffmpeg static build appropriate for the target agent
architecture.
