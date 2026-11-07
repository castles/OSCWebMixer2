# Changelog

## 1.4.0 — 2026-11-07

Windows product version: **1.4.0**. Node package version: **2.6.0**.

- Local musician accounts use SQLite in the existing Windows service data folder, without a separate database service or cloud dependency.
- Save and restore display names, selected AUX, channel order, favourites and view preferences across browsers and the native mobile client. Fader levels and pan are never recalled.
- Layout changes save automatically, with explicit conflict resolution when another device changes the saved layout.
- Guest mixing stays available; signing out restores the device's guest settings. Musician sessions survive service restarts.
- Admin Config includes musician account listing and password recovery that preserves layouts and invalidates old sign-ins.

## 1.3.1 — 2026-11-02

Windows product version: **1.3.1**. Node package version: **2.6.0**.

- Unified sidebar and page headers with aligned dividers, consistent Lucide icons and tighter page spacing.
- Apply the saved sidebar state before displaying the layout to prevent an expanded sidebar flashing on reload.
- Desk settings channels use a single column with handle dragging and keyboard reordering.
- Added spacing between the sidebar brand and headphone icon.

## 1.3.0 — 2026-11-01

Windows product version: **1.3.0**. Node package version: **2.6.0**.

- Desk settings channels use a compact two-column layout with drag and keyboard reordering while preserving each channel's settings.
- Reusable text tabs show an animated active underline on a full-width baseline. Admin page content no longer sits inside cards.
- The admin sidebar collapses to icons and remembers the preference. Its footer displays the running release version beside the collapse control.
- Removed the disconnected clients section, sidebar subtitle and back-to-mixer link.

## 1.2.2 — 2026-11-01

Windows product version: **1.2.2**. Node package version: **2.6.0**.

- Fader levels and send pan now require dragging the handle when using a finger, mouse or pen. Tapping or swiping the track leaves the value unchanged and allows vertical scrolling.
- Grabbing the handle preserves the current value without jumping to the contact point. Active drags are cancelled when changing mixes or modes, reloading a snapshot, editing the layout or disconnecting.
- Keyboard and assistive-technology slider controls remain available.

## 1.2.1 — 2026-10-16

Windows product version: **1.2.1**. Node package version: **2.6.0**.

- Full Windows installation and upgrade tests are opt-in for manual workflow runs, so ordinary builds and releases do not wait on installation tests.
- Windows installer upgrade tests report progress and elapsed time for each installation stage, with a five-minute limit on the test step.

## 1.2.0 — 2026-10-16

Windows product version: **1.2.0**. Node package version: **2.6.0**.

- The Windows tray checks GitHub for updates at startup and every six hours, with a manual check, a notification, release notes and an optional installer download. Installation remains manual.
- The tray embeds the Windows product version from installer metadata, so update checks follow release tags independently of the Node package version.
- Windows updates reuse the previous installation folder and preserve settings and custom service configuration. Same-version repairs are supported, and the updated installer refuses to replace a newer installed version.
- Upgrade preparation uses the bundled helper to wait for the tray and service to stop, including when the service is already stopped or its previous wrapper files are missing.

## 1.1.0 — 2026-10-15

Windows product version: **1.1.0**. Node package version: **2.6.0**.

### New

- Mixer controls open from a floating menu, keeping more space available for channels. Fullscreen, compact mode, favourites, layout editing and profile controls are available from the menu.
- Layout editing has a dedicated Done button and visible instructions.
- Admin Live mix uses vertical channel strips and receives streamed level and pan updates as faders move.
- A saved custom URL in Admin Overview lets mixer links and dashboard/tray QR codes use a DNS name such as `ears.glow.uk`. Clearing it restores the server address.
- `npm run dev` accepts connections from other devices on the network and prints links using the computer's LAN IP.

### Improvements

- Improved profile dialog sizing on small screens and prevented automatic zoom when editing profile fields on iPhone.
- Live mix reconnects automatically, retains status polling for recovery, and preserves newer streamed values when an older status response arrives.
- Custom mixer URLs survive server and demo restarts. Status refreshes preserve unfinished URL edits.
- Refreshed demo names, setup documentation and phone/tablet screenshots.
- Windows builds publish installers to versioned GitHub releases, reusing an existing release when rebuilding the same version.
- Local npm installer builds stop before invoking Inno Setup when the Windows account has a saved commercial key, keeping unrelated licence settings separate.
