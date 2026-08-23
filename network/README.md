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

3. Project Settings → **API Keys**: copy the **Project URL** and the
   **publishable** (formerly *anon public*) key into Rootwork's Sync dialog,
   pick a passphrase, connect. Never the *secret* / *service_role* key — the
   dialog refuses it.

**On every other device**: copy the pairing code from the first device's Sync
dialog, paste it under *Add a device*, type the same passphrase. The pairing
code carries your project address and anon key — treat it like a password and
never paste it anywhere public. It does not carry the passphrase.

### What the server can and cannot see

The payload is AES-GCM ciphertext; the key is derived from your passphrase with
PBKDF2 (600,000 iterations, SHA-256, salted with the space id) and never leaves
the device. The row holds an opaque id, that ciphertext, and a timestamp — no
names, no emails, nothing legible.

The anon key and the space id are what authorise the write, and any holder of
both can fetch or overwrite that blob — but not read it. The policies above
grant select, insert and update only, deliberately **not** delete, so a leaked
key cannot destroy the map either. That makes the passphrase the thing standing
between a stolen blob and your contacts, which is why weak ones are refused
outright and the dialog will generate a ~98-bit one for you. Put it in a
password manager: lose it and the map is unrecoverable, there is no reset.

Payloads are tagged with their format (`v2:`), so raising the iteration count
again later will not lock anyone out of an existing space.

### How two devices agree

Every person carries an `updated` stamp and deletions leave a tombstone, so a
merge is newest-wins per person rather than last-write-wins over the whole file.
A phone edited offline merges cleanly instead of clobbering the laptop. Changes
push about a second after you stop typing; other devices hear about it over a
websocket, with a five-second poll behind it in case the socket is unavailable.

## What is public, and what is not

The repository is public. **None of your data is in it, and none of it can get
there by accident.**

| | where it lives | who can see it |
| --- | --- | --- |
| The code | this repo, and GitHub Pages | anyone — it is just a program |
| Your map | `localStorage` in your own browser | you, on that device |
| Your map, if sync is on | one row in *your* Supabase project, encrypted | nobody without your passphrase |

Someone opening the app's public URL gets an empty map (or the sample), the way
opening a spreadsheet program does not show them your spreadsheet. The app has
no server of its own, no analytics, no third-party scripts, and makes exactly
one kind of outbound request — to the Supabase project you configure, if you
configure one. Fonts come from Google Fonts; nothing else is fetched.

Exports never touch the disk inside the repo: they go to your clipboard or
through the browser's own save dialog. As a second line of defence, `.gitignore`
covers CSV/backup patterns and there is a hook that refuses to commit any file
carrying what look like real email addresses or phone numbers. Enable it once
per clone:

```sh
git config core.hooksPath .githooks
```

The one personal thing a public repo does expose is the **email address on your
git commits** — that is how GitHub attributes them, and it applies to every
public repo, not just this one. To stop it: GitHub → Settings → Emails → *Keep
my email addresses private*, then `git config --global user.email
"<id>+<user>@users.noreply.github.com"`. Existing commits keep the old address
unless the history is rewritten.

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

## Circles

A person can be in as many circles as you like. The first is their primary: it
colours their dot and is the branch they sit nearest. Extra memberships draw as
lighter branches, so someone who is both a neighbour and a supplier visibly
bridges the two.

- **Drag a person onto a circle** to file them there — it becomes their primary.
- Their card lists every circle: click one to promote it, `×` to leave, *+
  circle* to add another.
- **Click a circle on the map** to recolour, rename, hide or delete it.
- Circles claim room in proportion to how many people they hold, so a School of
  thirty gets the space a Family of two does not need.
- The **tidy** button (or `T`) releases everything you have dragged into place
  and lets the layout settle again.
- The button beside *Add person* makes a new one; empty circles are kept as
  branches until deleted, so structure survives a purge.

## Connections

Who put you onto whom. Say *"Marcus introduced me to Rae Kim"*, *"got her info
from Ada"* or *"met Lila through Priya"* and the two are joined by a dashed
line on the map; the Connections row on a card takes names directly. Stored
directionally, drawn mutually.

## Schools

A list, not a field: type one and press enter. Each carries a level —
undergrad, grad, or unset — cycled by clicking it, or set as you type
(*"wharton mba"*, *"lehigh undergrad"*). The bar reads them out of a sentence
the same way, lower case and all: *"swarthmore alumn, did her MBA at Wharton"*
files both with the right levels.

## Editing a card

Every value on a person's card is edited in place — click it and type, including
the name. Empty fields read *add*; *+ another field* takes anything the standard
ones do not cover.

## Talking to it

The chat bar reads plain sentences — see **How to talk to it** in the app for
the full list. It also takes instructions that reshape the map (`remove everyone
but keep the categories`, `merge Industry into Vendors`, `rename Neighbors to
Bethlehem`, `create a category called Vendors`, `add Ada to Vendors`) and ones
that change how it looks or behaves (`make Work green`, `hide Family`, `mark
people cold after 30 days`, `switch to light mode`, `call me Ben`). Anything
touching more than one person is described and counted before it runs, and
every change can be taken back with ⌘Z, the Undo on the toast, or `/undo`. Beyond logging a touchpoint it understands direct edits
(`her location is Bethlehem`, `change his email to …`, `remove her phone`),
resolves *she/he/they* to whoever's dossier is open or was last logged, and
turns anything the fixed fields do not cover (`her partner is Sam`) into its own
labelled line on the card. A bare fact edits the card; something that happened
also logs a touchpoint.
