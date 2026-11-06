# Installing Mangadeck with Suwayomi

Mangadeck is only the interface. It needs a running [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server), which does the real work: it talks to
the manga sources (through Mihon/Tachiyomi-style extensions), downloads chapters and keeps your library. This guide sets up both, starting from nothing.

Mangadeck does not host, include or link to any manga. What you can read depends on the extensions you install into Suwayomi, and what you do with them is up to you
and the rules where you live.

**Contents:** [What you need](#what-you-need) · [1. Install Docker](#1-install-docker) · [2. Get Mangadeck](#2-get-mangadeck) · [3. Start it](#3-start-it) ·
[4. Add an extension repository and a source](#4-add-an-extension-repository-and-a-source) · [5. Your first series](#5-your-first-series) ·
[I already run Suwayomi](#i-already-run-suwayomi) · [Using it from your phone or another PC](#using-it-from-your-phone-or-another-pc) · [Updating](#updating) ·
[Backups](#backups) · [Without Docker](#without-docker) · [Troubleshooting](#troubleshooting)

## What you need

- A computer that can run Docker: Windows 10/11, macOS or Linux. A Raspberry Pi or a home server works too.
- About 1 GB of disk for the two containers, plus room for any chapters you download.
- A current Chrome or Edge is recommended (it gives you the install-as-app option, and saving `.cbz` files straight to a folder). Firefox and Safari work for reading.

## 1. Install Docker

- **Windows / macOS:** install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it once. On Windows it asks to turn on WSL 2; say yes and restart if it asks.
- **Linux:** install Docker Engine and the compose plugin from [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).

Check it works by opening a terminal (PowerShell on Windows) and running:

```bash
docker --version
docker compose version
```

## 2. Get Mangadeck

With git:

```bash
git clone https://github.com/KingKag3/MangaDeck.git
cd MangaDeck
```

No git? On the repository page press **Code, Download ZIP**, unzip it and open a terminal in that folder.

## 3. Start it

```bash
docker compose up -d --build
```

The first run builds the interface and downloads Suwayomi, which takes a few minutes. When it finishes:

- **Mangadeck:** http://localhost:8080
- **Suwayomi's own web page:** http://localhost:4567 (you only need it for settings Mangadeck does not have)

On Windows you can double-click `start-mangadeck.bat` instead; it runs the same command and opens the browser. `stop-mangadeck.bat` stops everything.

Two things in `docker-compose.yml` you may want to change before the first start:

- `TZ: America/New_York`: set it to [your time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) so "updated 3 days ago" and release dates line up.
- The Suwayomi data folder `./suwayomi-data`: your library, settings and downloads live here, next to the compose file. Keep it (and back it up). To store it elsewhere, change the left side of the `volumes` line.

Your library data is **not** inside the Mangadeck container, so rebuilding or updating Mangadeck never touches it.

## 4. Add an extension repository and a source

A fresh Suwayomi has no sources. You add a repository of extensions once, then install the extensions you want.

1. Open Suwayomi's own page at http://localhost:4567.
2. Open its **Settings**, find the **extension repositories** setting (under Browse in current versions) and add a repository address. Community repositories are listed on the
   Mihon/Tachiyomi extension sites; Mangadeck does not recommend or ship any. The address looks like `https://…/index.min.json` or `https://…/index.pb`.
3. Back in Mangadeck, open **Browse**, then the **Extensions** tab, and press **Refresh from repository**.
4. Install the extensions you want (English ones are shown by default; the **Show sources in other languages** switch in Settings reveals the rest).

You can also set the repository when the container starts, which makes it survive a wipe of `suwayomi-data`. In `docker-compose.yml`, under the `suwayomi` service's `environment`:

```yaml
    environment:
      TZ: America/New_York
      EXTENSION_STORES: '["https://example.com/your-repo/index.min.json"]'
```

(An environment value overrides the one saved in the web page each time the container starts.)

## 5. Your first series

1. In Mangadeck open **Browse**, pick a source, find a series and open it, then press **+ Add to library**.
2. Its chapters load from the source. If the list is empty, use the refresh button on the series page.
3. Click a chapter to read. Your place is saved as you go.
4. To keep chapters on your disk, select them and press **Download**; bulk downloads go one chapter at a time with a pause between, so a source does not block you.

Useful first settings (Mangadeck's **Settings** page): reader direction (left to right or right to left), the download pace, and a preferred scanlation group.
Optional: connect AniList for tracking, and turn on **Save next chapters on this device while reading** for offline reading.

## I already run Suwayomi

Do not run plain `docker compose up`: the compose file would start a second Suwayomi on the same port. Build only Mangadeck and point it at yours:

```bash
# Linux / macOS
SUWAYOMI_URL=http://192.168.1.50:4567 docker compose up -d --build --no-deps mangadeck
```

```powershell
# Windows PowerShell. host.docker.internal reaches Suwayomi running on the same PC.
$env:SUWAYOMI_URL='http://host.docker.internal:4567'; docker compose up -d --build --no-deps mangadeck
```

Use the address of your Suwayomi (an IP address, a hostname, or `host.docker.internal`). Mangadeck is then at http://localhost:8080 and uses your existing library.
Both interfaces can be used side by side.

If your Suwayomi uses a login (`AUTH_MODE`), Mangadeck handles Basic auth and the UI login (it shows a sign-in box when needed).

## Using it from your phone or another PC

Open `http://<the PC's IP address>:8080` from any device on the same network (find the address with `ipconfig` on Windows or `ip a` on Linux). Add it to the home screen on a phone.

Notes:

- **Installing it as an app** (the install icon in Chrome/Edge, offline reading, the service worker) only works on `localhost` or an `https://` address. A plain `http://192.168…` address reads fine but will not offer the install.
- **Do not expose it to the internet as is.** Suwayomi with no login lets anyone who reaches it read and delete your library. If you want remote access, put it behind a VPN (Tailscale or WireGuard is the simple way) or a reverse proxy with HTTPS and a login, and set `AUTH_MODE` on Suwayomi.
- Each address (for example `localhost:8080` and `192.168.1.50:8080`) is its own browser origin, so reader settings, volume lists and the AniList sign-in start empty on a new one. Use **Settings, Backup** to move that data between them.

## Updating

```bash
cd MangaDeck
git pull
docker compose up -d --build
```

The image serves a built copy, so source changes only show after this rebuild (then hard-refresh with Ctrl+F5). To update Suwayomi too: `docker compose pull suwayomi` before the command above.

## Backups

- **Library, downloads and Suwayomi settings:** the `suwayomi-data` folder. Stop the containers and copy it.
- **Mangadeck's own browser-side data** (reader options, group choices, linked sources, volume lists, download history, library view): **Settings, Backup, Download backup**. It never includes sign-in tokens.

## Without Docker

You need Node 22 and a running Suwayomi (the [Suwayomi releases](https://github.com/Suwayomi/Suwayomi-Server/releases) have a Windows installer and a Java jar).

```bash
npm install
echo "SUWAYOMI_URL=http://localhost:4567" > .env.local
npm run dev        # http://localhost:5173, with live reload
```

For a production copy, `npm run build` produces `dist/`; serve it with any web server that also proxies `/api/` to Suwayomi (see `nginx.conf.template`), because the browser must see one address.

## Troubleshooting

- **The page loads but the library is empty or errors.** Mangadeck cannot reach Suwayomi. Open http://localhost:4567; if that fails, check `docker compose ps` and `docker compose logs suwayomi`.
- **"Port is already allocated".** Something else uses 8080 or 4567. Change the left number in `ports:` (for example `"8081:80"`) and open that port instead.
- **Browse shows no extensions.** No repository is added yet, or Refresh was not pressed: see [step 4](#4-add-an-extension-repository-and-a-source).
- **A series has no chapters.** Open it and press Refresh. If it stays empty, the source may be down or have changed; try another source for the same series (the **Other sources** row on the series page links them).
- **A download keeps failing.** Sources rate-limit. Choose the Gentle pace in Settings; a chapter that fails three times is retried from a linked source, then set aside.
- **I changed the code and nothing changed.** Rebuild: `docker compose up -d --build`, then Ctrl+F5.
- **Docker Desktop on Windows says WSL is missing or virtualization is off.** Enable virtualization in the BIOS and run `wsl --install` in an administrator PowerShell, then restart.
- **Something else.** Open an issue on the repository with what you did, what you saw, and the output of `docker compose logs`.
