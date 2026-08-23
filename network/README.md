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

## Importing a spreadsheet

Drop a `.csv` or `.tsv` anywhere on the map, or pick it in the Import dialog.
The importer reads the file in the browser and shows what it made of each
column, with samples from your own rows, so a wrong guess is one dropdown away
from right:

- headers are matched by name (`phone number`, `employer`, `alma mater`, …);
- when the header is missing or unhelpful, the column's *contents* are sniffed —
  emails, phone numbers, dates, full names, long prose;
- a column it cannot name is kept as its own labelled field rather than dropped;
- people already on the map are matched by name or email and updated, never
  duplicated, and keep the circle they are already in;
- circles can come from a column of yours, from company, from school, or
  everyone into one you name.

Export gives the spreadsheet view (CSV, custom fields folded into notes) or a
full JSON backup, which Import also accepts.

## Talking to it

The chat bar reads plain sentences — see **How to talk to it** in the app for
the full list. Beyond logging a touchpoint it understands direct edits
(`her location is Bethlehem`, `change his email to …`, `remove her phone`),
resolves *she/he/they* to whoever's dossier is open or was last logged, and
turns anything the fixed fields do not cover (`her partner is Sam`) into its own
labelled line on the card. A bare fact edits the card; something that happened
also logs a touchpoint.
