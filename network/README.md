# Rootwork

A personal network map: you at the centre, circles branching off you, people
branching off circles. You grow it by typing what happened in plain language.

Live at **https://rh56.github.io/lit-coffee-site/network/** once this directory
is on `main` (GitHub Pages already serves the repo root).

## Files

| file | what it is |
| --- | --- |
| `index.html` | the page shell |
| `network.css` | tokens and every component; light and dark are both real themes |
| `app.js` | state, the sentence parser, the spring layout, the canvas plate, the interface |
| `sync.js` | optional end-to-end encrypted sync across devices |
| `sw.js`, `manifest.webmanifest`, `icons/` | what makes it installable |
| `build-artifact.mjs` | inlines the above into one file for previewing as a Claude Artifact |

No build step, no dependencies. Edit and reload.

## Installing it on a phone

Open the address above in Safari or Chrome → **Add to Home Screen**. It gets an
icon, opens fullscreen, and works with no signal (the service worker caches the
shell; your data is local anyway).

## Sync across devices

Off by default — everything lives in `localStorage` and never leaves the
browser. Turning it on stores the map in a database you own, encrypted here
first.

**On the first device**

1. Create a free project at [supabase.com](https://supabase.com).
2. SQL Editor → run:

   ```sql
   create table if not exists public.rootwork (
     id text primary key,
     payload text not null,
     updated_at timestamptz not null default now()
   );
   alter table public.rootwork enable row level security;
   create policy rootwork_rw on public.rootwork
     for all to anon using (true) with check (true);
   alter publication supabase_realtime add table public.rootwork;
   ```

3. Project Settings → API: copy the **Project URL** and the **anon public key**
   into Rootwork's Sync dialog, pick a passphrase, connect.

**On every other device**: copy the pairing code from the first device's Sync
dialog, paste it under *Add a device*, type the same passphrase.

### What the server can and cannot see

The payload is AES-GCM ciphertext; the key is derived from your passphrase with
PBKDF2 (200k iterations, SHA-256, salted with the space id) and never leaves the
device. The row holds an opaque id, that ciphertext, and a timestamp — no names,
no emails, nothing legible. The anon key and the space id are what authorise the
write, and the policy above lets any holder of them read the row, which is why
the encryption is the part doing the real work. Lose the passphrase and the map
is unrecoverable; there is no reset.

### How two devices agree

Every person carries an `updated` stamp and deletions leave a tombstone, so a
merge is newest-wins per person rather than last-write-wins over the whole file.
A phone edited offline merges cleanly instead of clobbering the laptop. Changes
push about a second after you stop typing; other devices hear about it over a
websocket, with a five-second poll behind it in case the socket is unavailable.

## Data

Export gives you the spreadsheet view (CSV) or a full JSON backup. Import reads
either, plus any CSV/TSV with a `name` column — `phone`, `email`, `profession`,
`company`, `school`, `location`, `circle`, `tags` and `notes` are matched by
header, and people who already exist are updated rather than duplicated.
