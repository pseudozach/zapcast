# ZapCast

ZapCast is a Pear desktop MVP for viewer-funded peer-to-peer live streaming. OBS or a local video file is ingested by `ffmpeg`, converted into low-latency fMP4 chunks, appended to Hypercore, replicated over Hyperswarm, and replayed by viewers who also relay the feed.

## What Works

- Create a stream and generate a shareable stream ID.
- Ingest an RTMP/HTTP source URL such as `rtmp://127.0.0.1/live/zapcast` or an HTTP stream that `ffmpeg` can open.
- Use a local video file as a live fallback with `ffmpeg -re`.
- Append init/chunk records to Hypercore with metadata and SHA-256 hashes.
- Replicate the feed over Hyperswarm/Corestore.
- Join as a viewer and receive replicated chunks.
- Automatically keep a rolling 300 chunk relay cache.
- Exchange debug control messages: `hello`, `have`, `want`, `stats`, and `topology`.
- Apply allowlist, blocklist, preferred relay, direct broadcaster denial, and broadcaster connection limit controls.
- Generate a local Arc Testnet wallet, advertise broadcaster payment metadata, and send viewer tips to broadcasters.
- Track broadcaster/viewer metrics, payment settings, and export JSON/CSV debug reports.
- Clean per-instance temporary stream data on app shutdown.

## Development

Development requires Node.js 22+, the Pear CLI, and `ffmpeg` on `PATH` for broadcaster ingest. Viewers do not need `ffmpeg`.

Install dependencies:

```sh
npm install
```

Run in Pear dev mode:

```sh
npm start
```

Run the standalone Electron host used by packaged builds:

```sh
npm run start:desktop
```

If `npm start` prints PHP PEAR package-manager commands, the wrong `pear` binary is first on `PATH`. Install or prioritize the Holepunch Pear CLI before running the desktop app.

depending on your npm version:
```
echo 'export PATH="/Users/z/.nvm/versions/node/v22.22.1/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## Streamer Workflow

1. Open ZapCast.
2. Go to `Streamer`.
3. Enter a source URL, for example `rtmp://127.0.0.1/live/zapcast` or an HTTP/HLS URL that `ffmpeg` can open.
4. Click `Start Streaming`.
5. Copy the generated stream ID and share it with viewers.

OBS should publish to the RTMP endpoint you provide. ZapCast does not implement an RTMP server; it expects one to already be running. HTTP and HTTPS source URLs are passed directly to `ffmpeg`; they work when `ffmpeg` can open and decode that URL.

When streaming starts, ZapCast generates the stream keypair/feed ID automatically. For fallback testing, select a local video file instead of entering a source URL. ZapCast passes `-re` to `ffmpeg` so the file behaves like a live input.

## Viewer Workflow

1. Open another ZapCast instance.
2. Go to `Viewer`.
3. Paste the stream ID.
4. Click `Join Stream`.
5. To tip the broadcaster, enter a USDC amount and click `Tip Broadcaster`.

The viewer joins the stream topic, replicates the Hypercore feed, buffers records, and relays available chunks to peers through normal Hypercore replication.

## Settings And Payments

Each app instance gets a local Arc Testnet wallet generated with `viem` in the Electron renderer. The Pear/Bare backend persists the wallet metadata and transfer receipts, but does not import viem directly. The wallet address is shown in `Settings`; the mnemonic is hidden until you reveal it. Back it up before funding the wallet.

ZapCast currently uses Arc Testnet native USDC for tips. Broadcasters publish their payment address in stream/control metadata, so viewers can tip the broadcaster without entering a recipient address manually. Ark and Lightning support can fit behind the same payment metadata model later.

Optional forwarding settings:

- `Forwarding address`: your main wallet address.
- `Auto-forward threshold`: when the app wallet balance is at or above this USDC amount, ZapCast forwards the spendable balance and records the transfer in `data/wallet/transfers.csv`.

Persistent wallets are stored by wallet slot under `data/wallet/slots/`. Temporary stream chunks, Corestore data, playback buffers, and per-instance reports are stored under `tmp/creator/<instance-id>/` or `tmp/viewer/<instance-id>/` and are cleaned up when the app closes. Packaged builds place these directories in the operating system's ZapCast application-data directory, not beside the installed executable.

## Relay Proof Setup

To prove:

```text
Broadcaster -> Viewer A -> Viewer B
```

Use the `Settings` and `Stats` tabs:

1. On Viewer B, enable `Deny direct broadcaster` in `Settings`.
2. Add the broadcaster peer ID to `Block peer` if you want an explicit block.
3. Set `Preferred relay peer` to Viewer A's peer ID.
4. On the broadcaster, set `Max broadcaster connections` to `1`.
5. Start Viewer A first, then Viewer B.
6. Export JSON or CSV from Viewer B and inspect `network.connectedToBroadcaster`, `relay.chunkSources`, and peer relationships.

The control plane records peer roles and topology decisions. The data plane remains Hypercore/Corestore replication over Hyperswarm.

## Same-Machine Testing

Each app process gets an automatic instance ID. Creator data is written under `tmp/creator/<instance-id>/` and viewer data is written under `tmp/viewer/<instance-id>/`, so you can run a broadcaster window and one or more viewer windows on the same machine without sharing Corestore, chunk, playback, or report directories.

Use separate app windows/processes for relay testing. Streaming and viewing inside the same app instance is only a UI smoke test and does not prove peer-to-peer relay behavior.

## Reports

`Export JSON` downloads a full report with:

- config
- network
- stream
- playback
- relay
- latency
- payments
- errors
- event log

Run syntax checks:

```sh
npm run check
```

## Desktop Distributables

Build an installer/archive for the current operating system:

```sh
npm ci
npm run make
```

Artifacts are written under `out/make/`:

- macOS: DMG and ZIP
- Windows: `ZapCastSetup.exe` and portable ZIP
- Linux: AppImage

Forge makers are host-specific, so a Mac does not produce the Windows or Linux packages. The `Build desktop releases` GitHub Actions workflow builds macOS arm64/x64, Windows x64, and Linux x64. Run it manually from the Actions page, or push a version tag such as `v0.1.0`; tag builds also attach all artifacts to a GitHub Release.

These builds are intentionally unsigned:

- macOS users may need to right-click ZapCast and select **Open**. If quarantine still blocks it, run `xattr -dr com.apple.quarantine /Applications/ZapCast.app`. Apple notarization is not possible without an Apple Developer account.
- Windows users can run `ZapCastSetup.exe` or use the portable ZIP. SmartScreen may warn about an unknown publisher because the executable is unsigned.
- Linux users should run `chmod +x ZapCast-*.AppImage`. Systems without FUSE can launch it with `--appimage-extract-and-run`.

Broadcasters must install `ffmpeg` separately and make it available on `PATH`. It is not bundled. The packaged app otherwise includes Electron and its Node dependencies and does not require Pear or Node.js on the user's machine.

The package configuration follows the [Pear desktop distributables guide](https://docs.pears.com/how-to/operate-an-app/build-and-package/build-desktop-distributables/) and [Electron Forge makers](https://www.electronforge.io/config/makers/).

Project layout follows the MVP prompt:

```text
index.html    shared Pear/Electron UI entrypoint
electron/     standalone packaged desktop host
src/          app controller and config
ui/           browser-side JS and CSS used by index.html
broadcaster/  ffmpeg ingest and chunk watcher
player/       MSE and ffplay fallback helpers
p2p/          swarm, feed replication, control protocol, topology, stats
payments/     wallet, transfer ledger, and mock split helpers
reports/      JSON and CSV exports
utils/        crypto, logging, time helpers
```

## test notes
1) start a local rtmp server 
```
docker run -it --rm \
-p 1935:1935 \
alfg/nginx-rtmp
```

2) start a dummy stream  
```
ffmpeg \
-re \
-f lavfi -i testsrc=size=1280x720:rate=30 \
-f lavfi -i sine=frequency=1000 \
-c:v libx264 \
-c:a aac \
-f flv \
rtmp://127.0.0.1:1935/stream/test
```
