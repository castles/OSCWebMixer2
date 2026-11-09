# EarsMixer

EarsMixer connects DiGiCo SD Series and Quantum consoles to the [native EarsMixer mobile app](https://github.com/joeclack/EarsMixerApp) and a limited browser mixer. It includes an admin dashboard and a Windows service manager with a connection QR code. Musicians use optional device-local nicknames, without accounts or passwords.

Current Windows/server release: **1.7.1**. Node package version: **2.9.1** (a separate upstream version series). The current mobile app is **0.11.0**; its recent visual and interaction changes do not require additional server changes.

## Mobile app and browser mixer

The mobile app is the main musician interface. The server-hosted browser mixer remains available for anyone without the app.

| Feature | Native mobile app | Server-hosted browser mixer |
| --- | --- | --- |
| Optional nickname saved on the device | Yes | Yes |
| AUX selection, send level and pan | Yes | Yes |
| Channel layout | Reorder channels; hide channels per AUX | Reorder, list/grid views |
| Shared templates | Optional layout selection | No selection; administrators manage templates in the dashboard |
| Cached channels and last-known values | Yes, while refreshing live values | Live desk values; layouts do not recall audio |
| Saved level states per server/AUX | On the phone, with confirmation before recall | No |
| Other users on the same AUX | Profile circles and nicknames | Nickname is shared with the server; no profile-circle display |
| Set all levels to off | Yes, including hidden channels | Yes, for available channels |
| Discovery, guided setup and gesture haptics | Native app features | Connect through the server URL or QR link |

Mobile uses horizontal faders in portrait and a full-height vertical bank in landscape. Its textured console surfaces, sculpted illuminated handles, icon/splash, eased automatic fader movement and brief success feedback are implemented in the mobile repository. They do not change the browser mixer's appearance. See the [mobile README](https://github.com/joeclack/EarsMixerApp#readme) for setup, builds and device-local data behaviour.

## Install on Windows

**[Download the latest EarsMixer installer](https://github.com/joeclack/EarsMixer/releases/latest)**

1. Open the latest release and expand **Assets**.
2. Download `EarsMixer-<version>-windows-x64-setup.exe`. Choose the installer, rather than either **Source code** archive.
3. Run the installer and accept the Windows administrator prompt.
4. Leave **Show the EarsMixer tray icon when signing in** selected if you want the service manager available after each sign-in. A desktop shortcut is optional.
5. Open **EarsMixer tray** from the Start menu, or **EarsMixer Service Manager** from the desktop if you selected that shortcut.

The installer includes the runtime. You do not need Node.js, Git or a command prompt to use the installed app. The mixer starts after installation and runs automatically as a Windows service when the computer boots, including before sign-in.

### What you need

- Windows 10 version 1607 or later, or Windows 11, on an x64-compatible computer.
- Administrator permission to install and control the service.
- A DiGiCo SD Series or Quantum console. S-Series consoles are not supported.
- The server computer, console and mixer devices connected to the same network.

Set the server computer's mixer network to **Private** in Windows. The installer creates a firewall rule allowing devices on the local subnet to connect over a Private network.

## Connect your console

1. Right-click the EarsMixer tray icon and choose **Open admin dashboard**.
2. Open **Desk settings → Connection** in the dashboard.
3. On the console, open **Setup → External Control → DiGiCo iPad**. Set its outgoing destination to the server computer's network IP address and the server's OSC receive port, which defaults to UDP **8000**.
4. In EarsMixer, enter the console's IP address and its receive port, which defaults to UDP **9000**. Ensure the ports match the console's configuration, then save.
5. Select the channels and AUXes you want to make available to musicians and save the settings.
6. Double-click the tray icon to show the mixer QR code. Scan it on a device connected to the same network, then select an AUX to control its mix. The QR code is also available in the admin dashboard.

The default web port is **80**. The tray's browser links and QR code follow the configured port automatically. A link showing `127.0.0.1` means the server computer does not yet have a network address; connect it to the mixer network and the QR window will refresh.

If your network has a DNS name for the mixer, enter it in **Admin → Overview → Mixer URL → Custom URL** and click **Save URL**. For example, `ears.glow.uk` becomes `http://ears.glow.uk/`; you can also enter a full HTTPS URL or include a port, such as `http://ears.glow.uk:8082`. The mixer link and QR codes in the dashboard and tray use this saved address after restarts. DNS must already resolve the name to the server; a DNS record alone does not change the web port. Clear the field and save to return to the server address.

## Automatic discovery

The Windows service and `npm run dev` advertise `_earsmixer._tcp.local` using Bonjour/mDNS. In a native EarsMixer app build, open the **Wi-Fi button → Auto** and select a nearby server. The advertisement includes the actual web port, so the installed service and a demo on port 8082 appear separately.

Discovery uses UDP 5353 on the local network. The installer’s existing private-network firewall rule permits it. Guest Wi-Fi isolation, VLAN boundaries or blocked multicast can prevent discovery; manual addresses and QR codes still work. Set `OSC_WEBMIXER_DISCOVERY=0` in the server environment to disable advertisements. A server bound only to loopback does not advertise on the LAN.

Advertised links and QR codes skip common virtual adapters, including Windows Hyper-V and WSL. With multiple physical networks, use **Overview → Mixer URL → Custom URL** to select the address for your musicians. Discovery advertises eligible physical interfaces and refreshes when addresses change.

## Use the service manager

The tray icon appears in the notification area at the right of the Windows taskbar; it may be inside the hidden-icons menu.

- **Double-click** to show the QR code and copyable mixer link.
- **Right-click** for service status, Start/Stop/Restart, the mixer, admin dashboard, logs and settings.
- **Check for updates** checks GitHub for a newer Windows release. When available, **Download EarsMixer** opens its installer in your browser, and **View release notes** opens the release details.
- Service changes request administrator permission through Windows.
- Closing the QR window or choosing **Exit tray** leaves the mixer service running.

The service is named **EarsMixer** in Windows Services. It starts automatically with delayed startup and is configured to restart after a process failure.

## Mixer and admin dashboard

The browser mixer lets musicians choose an AUX, adjust send levels or pan, reorder channels, choose list/grid views and set a local nickname. Preferences save automatically in that browser. Favourites, compact mode, fullscreen and template selection are no longer offered in the browser mixer.

Drag the fader handle to adjust it with a finger, mouse or pen. Tapping or swiping the track does not jump the level, so the channel list can be scrolled safely. Keyboard and assistive-technology controls remain available.

**Set all levels to off** lowers every available channel's send on the selected AUX to −∞ (−150 dB) after confirmation. It changes send levels rather than toggling mute, and leaves pan unchanged. It does not reset the musician's layout.

The admin dashboard provides connected-device status and nicknames, activity history, a read-only live mix, channel/AUX configuration and shared layout templates. Templates do not recall console levels. Musicians can select them in the mobile app; older favourites-based templates retain their visible-channel selection there.

The admin overview, showing connection status, client counts and the mixer QR code:

![EarsMixer admin dashboard with connection status, client and channel counts, and a QR code for joining the mixer](docs/screenshots/admin-dashboard.jpg)

This screenshot uses the offline server demo. Earlier mixer screenshots below are historical and include controls removed from the current web interface.

<details>
<summary>Earlier web mixer screenshots</summary>

<img src="docs/screenshots/mixer-phone.jpg" alt="Historical phone web mixer with the former compact and favourites controls" width="320">

![Historical iPad web mixer with favourites controls in a three-column grid](docs/screenshots/mixer-ipad.jpg)

</details>

To protect the dashboard, open **Admin → Config** and set an admin password of at least eight characters. Musicians can still access the mixer, and the tray QR code continues to work. Restarting the server clears admin sign-in sessions. This admin password is separate from musician nicknames.

## Nicknames, layouts and saved levels

Musicians can enter an optional nickname. It saves automatically on that device and identifies the live connection in the dashboard and mobile AUX presence. Skipping the nickname is remembered. There are no musician accounts, passwords or server-side profile sign-ins.

The browser stores its selected AUX, channel order and view separately for each server origin. The mobile app keeps its own device-local settings, per-server layouts, per-AUX hidden channels, cached channel values and saved send-level states. Layouts are not synchronised between devices. Clearing browser storage or uninstalling the app removes that device's data.

Browser levels and pan come from the desk and are never recalled from a saved layout. Mobile cached values are also display-only while live values refresh. Separately, mobile edits save a level state per server/AUX. When live levels differ, the app offers **Keep desk levels** or **Load saved levels**; only confirming recall sends those saved levels to the desk. Pan is unchanged. Recent states are listed on the phone by AUX name and edit timestamp. Resetting mobile device data does not change the console's levels or pan.

The built-in mobile demo has 20 channels and four AUXes and runs without a server. For testing an actual mobile-to-server connection, use this repository's network demo with 20 channels and eight AUXes, described below.

Existing `earsmixer.sqlite` files from previous releases are left untouched but are no longer opened or used. Administrators can remove them after taking any desired backup. Shared templates and the admin password record remain server-side data.

## AUX presence for mobile clients

The server sends this message over the existing mixer WebSocket:

```json
{ "presence": { "aux": 2, "peers": [{ "id": "7", "nickname": "Joe" }] } }
```

Each list includes only other open musician connections on the selected AUX, including browser connections. It updates after AUX selection, nickname changes, joins and disconnects; an empty list clears the display. Admin observers are excluded. IDs last for that connection and nicknames may be null. The mobile app displays profile circles; the limited browser mixer does not display them. This requires server 1.5.0 (Node package 2.7.0) or newer.

Live signal meters and channel colour accents are future mobile features, tracked in [EarsMixerApp #4](https://github.com/joeclack/EarsMixerApp/issues/4) and [#3](https://github.com/joeclack/EarsMixerApp/issues/3). They are not implemented in this server release; the console model/software and OSC data formats still need verification.

## Updates, settings and backups

The tray checks GitHub shortly after starting and every six hours while it is running. A newer stable Windows release produces a tray notification with an optional download. You can also choose **Check for updates** at any time. Checks run in the background; an offline mixer network does not interrupt the service or show automatic error dialogs. Updates are never installed automatically: download the installer and run it when you are ready for the service to restart. Closing the tray stops update checks while the mixer service keeps running.

Download and run the latest installer to update EarsMixer; you do not need to uninstall first. Setup reuses the previous installation folder, closes the tray, stops the service before replacing files and starts it again afterwards. Your settings, plugins, custom service XML and shortcut selections are retained. Running the same version again repairs the installation. The updated installer refuses to replace a newer installed version; installers released before this safeguard can still downgrade the app. If you are switching from an older console-based installation, stop that server with Ctrl+C first.

Saved files are in `%PROGRAMDATA%\EarsMixer`:

- `config/` — console connection, channel/AUX settings and shared desk presets.
- `data/` — shared templates and the admin password record.
- `plugins/` — optional custom plugins.
- `logs/` — server and service logs.

Upgrades and uninstall preserve these folders. To make a backup, stop the service from the tray, copy the EarsMixer data folder, then start the service again. Restoring files or adding plugins requires administrator permission.

Copy the whole `data/` directory for backups. Keep backups private because they may contain admin password records and legacy account databases. Source deployments can set `OSC_WEBMIXER_DATA_DIR` to a persistent writable directory.

The installer also migrates settings from earlier installations using the `OSCWebMixer2` folders, preserving the originals. Per-user settings are migrated from the account running setup; if you install using a different administrator account, copy the original user's settings manually.

## Troubleshooting

- **No tray icon:** open **EarsMixer tray** from the Start menu and check Windows' hidden-icons menu.
- **Service stopped:** choose **Start service** from the tray. If it will not stay running, choose **Open logs**.
- **Phones or tablets cannot connect:** check that all devices are on the same network and the server's network profile is Private. Check the QR link's address and web port.
- **Console does not connect:** check its IP address and both OSC ports in **Desk settings** against the console's DiGiCo iPad configuration.

## Development and releases

These instructions are for working on the source code. They are not required to install the released app.

Install Node.js 22.13 or newer and Git, then run:

```bash
npm ci
npm run dev
```

The offline demo listens on all network interfaces on port **8082** and prints mixer and admin links using your computer's LAN IP, so phones and tablets on the same network can connect. It also works at [localhost:8082](http://127.0.0.1:8082/), with the admin dashboard at `/admin`. It has 20 mock channels and eight AUXes and uses the same app as the installed version. The demo uses isolated settings in `config/demo/` and does not connect to a physical console. Ctrl+C stops it.

Set `OSC_WEBMIXER_PUBLIC_URL` to override the advertised links and QR code, for example if your computer has multiple network adapters. Set `OSC_WEBMIXER_DEV_BIND_ADDRESS=127.0.0.1` to restrict the demo to this computer.

Run `npm test` to check the app and `npm run build` to regenerate its minified web assets.

Expo web previews can connect directly to this server: connection information and shared template reads allow CORS without credentials. Admin APIs remain same-origin. WebSocket mixer connections use the same server address. Restart a running source server after updating to pick up these changes.

To build the installer locally on Windows, install Inno Setup 6.7 or newer and run `npm run installer:windows`. The build uses the Windows .NET Framework C# compiler and downloads its packaging runtime and service wrapper when needed. Set `ISCC_PATH` or `CSC_PATH` if the build tools are installed in custom locations. The installer is written to `dist/`.

The npm installer build stops if your Windows account has a saved Inno Setup commercial licence key, so it cannot pick up a licence belonging to another project or organisation. Use GitHub Actions or a separate Windows build account without a saved key. The check leaves your existing Inno licence unchanged. Compiling directly in the Inno Setup IDE bypasses this project check and uses that IDE's licence settings.

Product metadata and the installer version are defined in [`installer/version.inc.iss`](installer/version.inc.iss). GitHub Actions builds and tests the app. Successful pushes to `main`, or manual runs on `main`, attach the installer to the release tagged with that version, such as `v1.2.1`, and mark it as latest. Builds using the same version replace its installer; change `AppVersion` to publish a separate version. Pull requests build downloadable artifacts without publishing a release. The Node package follows its upstream version series separately. See [CHANGELOG.md](CHANGELOG.md) for release notes.

The Windows tray embeds that same product version and compares it numerically against the latest published GitHub release tag. To notify existing installations of an update, increase `AppVersion` before publishing; rebuilding the same version does not trigger an update notification. Drafts, prereleases and releases without the matching Windows installer are not offered as updates.

Normal CI runs compile the installer and run the application tests, without installing the app on the runner. The full Windows installation and upgrade tests are optional: select **Run full Windows installation and upgrade tests** when starting the workflow manually to enable them.

## Credits and licence

EarsMixer is maintained by Joe Clack and is based on [OSCWebMixer2 by Marc Castles](https://github.com/castles/OSCWebMixer2). The project is distributed under the [MIT licence](LICENSE).
