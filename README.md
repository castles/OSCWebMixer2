# EarsMixer

A local server connecting DiGiCo SD Series and Quantum consoles to the [EarsMixer mobile app](https://github.com/joeclack/EarsMixerApp) and a browser mixer. Musicians control their AUX send levels and pan; administrators manage the console connection, channels and shared layouts.

## Components

- DiGiCo iPad-protocol OSC/UDP bridge and musician WebSocket API.
- Browser mixer and admin dashboard.
- Bonjour/mDNS server discovery and connection QR codes.
- Windows service, tray manager and installer.

## Repository layout

- `index.js`, `lib/` — server, console integration and APIs.
- `web/` — browser mixer and admin dashboard.
- `config/`, `plugins/` — configuration and optional plugins.
- `installer/` — Windows service/tray support and Inno Setup files.
- `tools/` — demo console, development and packaging scripts.
- `test/`, `.github/workflows/` — checks and release automation.

## Windows deployment

1. Download the `EarsMixer-<version>-windows-x64-setup.exe` from [Releases](https://github.com/joeclack/EarsMixer/releases/latest) and install as administrator. The runtime is included.
2. Open the admin dashboard from the EarsMixer tray icon.
3. Configure the console IP/ports and available channels/AUXes. Set an admin password before use on a shared network.
4. Connect musicians through the mobile app or the mixer URL/QR code.

The server, console and musician devices need network access to one another. Configure the console's **DiGiCo iPad** external control, with matching OSC ports: server receive **8000/UDP**, console receive **9000/UDP** by default. S-Series consoles are not supported.

The installed web server defaults to port **80**, with administration at `/admin`. Windows settings and data live in `%PROGRAMDATA%\EarsMixer`. Run a newer installer to update an existing installation.

## Run from source

Use Node.js **22.13+**:

```sh
npm ci
npm run dev
```

The network demo runs at `http://localhost:8082` with 20 mock channels and eight AUXes. It uses isolated settings in `config/demo/` and does not connect to a console.

For a console-connected source deployment, configure the server and run `npm start`. Keep it running under your service/process manager. Clients use the server computer's reachable IP or configured DNS name.

## Packaging and releases

- `npm run build` regenerates the browser assets.
- `npm run installer:windows` builds the Windows installer into `dist/`; requires Inno Setup 6.7+ and the Windows .NET Framework C# compiler.
- GitHub Actions builds release installers from `main`; feature branches remain unpublished until merged. Product metadata and the release tag version come from [installer/version.inc.iss](installer/version.inc.iss).
- Windows/product version: **1.7.1**. Node package version: **2.9.1**, maintained in its separate upstream series.

See [CHANGELOG.md](CHANGELOG.md) for release history. Based on [OSCWebMixer2 by Marc Castles](https://github.com/castles/OSCWebMixer2), maintained by Joe Clack under the [MIT licence](LICENSE).
