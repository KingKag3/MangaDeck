# Real-use checklist

The unit tests and the smoke test cover the logic, but these paths need a real server, real files or a real account. Run through them once after a big change, and note anything odd as an issue.

Use a small series (5 to 10 chapters) so each step takes minutes, not hours.

## New chapters as .cbz, then merge

1. Series page, **All as .cbz**. Save into a folder. Wait for it on the Downloads page. A "Complete" file appears.
2. On the series page, "Your .cbz files": **Choose folder** and pick the same folder. The file is listed as holding all volumes.
3. Make the series grow: pretend by exporting an older state (export, then wait for the source to add a chapter), or edit the last-export line in your browser history. When the series is past your export, the ".cbz files you saved" panel shows "ends at Ch. N" and **Save the new chapters as .cbz**.
4. Press it, save into the same folder. A file named "... - New chapters X-Y.cbz" appears.
5. Back in "Your .cbz files": "New since ...: New chapters X-Y" with **Add to it**. Merge. A new file is written, the old complete file is untouched.
6. Open the merged file in a comic reader: pages in order, no repeated chapter.

## Offline reading

1. Settings, reader: set "Save next chapters on this device while reading" to 2 and leave "Remove them again once I have read them" on.
2. Open a chapter and read to the last page. Open `/offline`: the next two chapters are listed, the one you finished is gone.
3. Turn the network off (browser dev tools, Offline). The saved chapters still open.

## AniList

1. Settings, AniList: register a client, paste its ID, **Connect**, approve in AniList.
2. Open a linked series, mark a chapter read. The entry on AniList moves forward (never back).
3. Disconnect the network, read a chapter: Settings shows it waiting. Reconnect: it is sent.

## Automatic update check

1. Settings, Library: untick the skip rules for unread and not-started titles, set the automatic check to every 6 hours.
2. Clear `mangadeck.autoUpdateAt` in the browser's local storage and reload. Within about 15 seconds the Library page's update indicator runs.
3. When it ends, titles that gained chapters get the green ribbon, and a toast says how many.

## Login

1. If you use `AUTH_MODE=UI_LOGIN` on Suwayomi: the sign-in box shows, signing in works, and a reload keeps you in.
