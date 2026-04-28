# Ubuntu Agent Install

Use this procedure for a traditional Ubuntu SetuLink agent install with ffmpeg available from either the OS package or a bundled binary.

## ffmpeg Resolution

On Linux, the agent resolves ffmpeg in this order:

```text
/opt/setulink/ffmpeg/ffmpeg
/usr/bin/ffmpeg
PATH lookup for ffmpeg
missing
```

The agent never copies bundled ffmpeg into `/usr/bin`.

## Install Script

Build or copy a Linux `setulink-agent` binary into one of the supported locations. The installer can be run from any working directory because it resolves paths from the script location.

Agent binary resolution order:

```text
first CLI argument
scripts/setulink-agent
setulink-agent at the repo/package root
agent/setulink-agent
```

Run from the repo root:

```bash
sudo BACKEND_URL="https://setuapi.shivomsangha.com" ./scripts/install-setulink-ubuntu.sh
```

Run from the `scripts` directory:

```bash
cd scripts
sudo BACKEND_URL="https://setuapi.shivomsangha.com" ./install-setulink-ubuntu.sh
```

Run with an explicit agent binary:

```bash
sudo BACKEND_URL="https://setuapi.shivomsangha.com" ./scripts/install-setulink-ubuntu.sh /tmp/setulink-agent
```

The script installs:

```text
/opt/setulink/setulink-agent
/var/lib/setulink/
/var/lib/setulink/setulink/config/agent.json
/var/lib/setulink/setulink/logs/agent.log
```

The authoritative runtime config path is:

```text
/var/lib/setulink/setulink/config/agent.json
```

The Linux service sets `HOME=/var/lib/setulink` so the agent's normal-install runtime layout resolves to `/var/lib/setulink/setulink/...` under systemd. `/etc/setulink/agent.json` is not used by the installer as an active runtime config path.

For ffmpeg, the script uses this simple policy:

- if `ffmpeg` is already available, leave it alone
- otherwise run `apt-get update` and `apt-get install -y ffmpeg`
- if apt is not available or a bundled install is explicitly requested, copy the bundled binary to `/opt/setulink/ffmpeg/ffmpeg`
- always `chmod +x` the bundled binary after copying

To force bundled ffmpeg:

```bash
sudo FFMPEG_MODE=bundled BUNDLED_FFMPEG_SOURCE="./assets/ffmpeg/ffmpeg" ./scripts/install-setulink-ubuntu.sh
```

## systemd Service

The script writes `/etc/systemd/system/setulink-agent.service`:

```ini
[Unit]
Description=SetuLink Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HOME=/var/lib/setulink
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/setulink/ffmpeg
ExecStart=/opt/setulink/setulink-agent -config /var/lib/setulink/setulink/config/agent.json
WorkingDirectory=/opt/setulink
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

This keeps `/usr/bin` in `PATH` and also allows the bundled `/opt/setulink/ffmpeg/ffmpeg` path to be reached.

## Validation

After install:

```bash
sudo systemctl cat setulink-agent
ls -l /var/lib/setulink/setulink/config/agent.json
which ffmpeg || true
test -x /opt/setulink/ffmpeg/ffmpeg && /opt/setulink/ffmpeg/ffmpeg -version || true
sudo systemctl status setulink-agent --no-pager
journalctl -u setulink-agent -n 80 --no-pager
grep -Ei 'ffmpeg|remote-desktop|capability|desktop' /var/lib/setulink/setulink/logs/agent.log | tail -n 20
```

Expected startup log shape:

```json
{"component":"runtime","action":"remote-desktop-capability","message":"remote desktop capability summary","metadata":{"remoteDesktopCapabilityState":"not_ready","state":"not_ready","ffmpegPath":"/usr/bin/ffmpeg","ffmpegSource":"system","reason":"Linux ffmpeg runtime found; unattended Linux desktop capture is not implemented by this agent"}}
```

With bundled ffmpeg, `ffmpegPath` should be `/opt/setulink/ffmpeg/ffmpeg` and `ffmpegSource` should be `bundled`.

If no ffmpeg is found, `ffmpegSource` is `missing` and the reason lists the checked bundled path, system path, and PATH lookup.
