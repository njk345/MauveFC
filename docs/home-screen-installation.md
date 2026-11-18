# Home-screen installation

Open `/install/` from **Add to home screen** in the footer or mobile navigation.
The installed app is named **Mauve FC** and starts at `/team/`. Its scope includes
all club routes, so teammates can move between the schedule, results and team area
in the same standalone window. Supporting browsers also offer Team and Schedule
app shortcuts.

- **iPhone / iPad:** open the site in Safari, use Share → Add to Home Screen,
  keep Open as Web App enabled if shown, then Add. The page includes these steps
  and recognizes iPads using desktop-mode user agents.
- **Android:** use the Install Mauve FC button when Chrome offers installation,
  or its menu → Add to Home screen / Install app.
- **Computer:** use Chrome or Edge's install action, or Safari on Mac's Add to Dock
  when supported. Browsers without installation support can bookmark the Team area.

An accepted browser prompt requests installation; the page confirms completion
when the browser emits `appinstalled`. The prompt is consumed only once, with
manual instructions available after dismissal or failure. Installation links are
hidden inside standalone windows and after an installation-complete event.
Normal browser tabs cannot reliably detect every app installed on a device.
Browser menu wording and installation availability vary by operating system.

## Privacy and connectivity

Installation uses the same invited sign-in and membership checks as the website.
It does not grant team access. Signing out clears the private workspace as before.
The manifest and icons contain club branding only, with no roster or account data.

This release requires an internet connection. It registers **no service worker**,
writes no Cache Storage entries and creates no offline copy of authenticated
responses. Auth session persistence remains managed by the existing authentication
client. Modern browsers support installation without an offline service worker.
There are no push notifications or background sync jobs in this feature.

## Implementation and checks

`src/app/manifest.webmanifest` defines the stable app ID, standalone display,
launch URL, theme, icons and shortcuts. Root metadata includes Apple web-app tags,
the 180px touch icon and a viewport that supports device safe areas while retaining
zoom. App icons use the existing crest and fit inside the maskable safe zone.
Regenerate their PNGs with `node scripts/generate-app-icons.mjs`.

Serve the production export and run:

```sh
MAUVE_BASE_URL=http://127.0.0.1:3000 python tests/install_browser.py
```

The test includes the isolated team browser contract, then validates Chrome's
manifest/installability result, PNG dimensions and Apple metadata, simulated native
prompt acceptance/dismissal/failure, iPhone/iPad/Android instructions, responsive
layouts, standalone launch and sign-out, and empty Cache Storage/service-worker
registrations after displaying a synthetic private roster. Service calls are
intercepted; no production accounts, invitations or messages are created.
Native OS installation and home-screen saving still need a real-device spot check;
headless tests validate browser eligibility and the app's handling of those events.
