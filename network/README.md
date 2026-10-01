# Rootwork

A personal network map: you at the centre, circles branching off you, people
branching off circles. You grow it by typing what happened in plain language.

Live at **https://rh56.github.io/lit-coffee-site/network/** once this directory
is on `main` (GitHub Pages already serves the repo root).

## Files

| file | what it is |
| --- | --- |
| `index.html` | the page shell |
| `network.css` | tokens and every component; one theme, inked |
| `app.js` | state, the sentence parser, the spring layout, the canvas plate, the interface |
| `archive.css`, `archive.js` | the archive: seven ways to read the same map as filed paper |
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

### Keeping the project awake

Supabase pauses free projects after about a week of low activity — nothing is
lost, but sync stops until you restart it from their dashboard. The workflow at
`.github/workflows/keep-supabase-awake.yml` pings the project every three days
so that does not happen. It needs two repository secrets (Settings → Secrets and
variables → Actions):

| secret | value |
| --- | --- |
| `SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | the publishable (anon) key — never the secret one |

The job prints only an HTTP status code; the URL, the key and the row never
reach the log, which matters because logs on a public repository are public.
GitHub switches scheduled workflows off in a repository that sees no activity
for 60 days — it emails first, and any push turns them back on.

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

Export downloads a real file — `rootwork-YYYY-MM-DD.csv` for the spreadsheet
view (custom fields folded into notes) or `.json` for a full backup, which
Import also accepts. *Copy instead* is still there for pasting straight into a
sheet. Inside the published artifact the page cannot start its own download, so
that build asks the viewer's runtime to save the file for you.

## Seven ways to look at it

The buttons sit at the top left, or press the number keys. Wherever a name
appears, a coloured dot after it marks every *other* circle that person belongs
to, so a shared person is never hidden.

| view | shape |
| --- | --- |
| **Web** | organic, but tidied: tight clusters, each circle held in its own quarter |
| **Classic** | the original springs and charge, left to find their own shape |
| **Venn** | each circle a field, overlapping only where people are genuinely shared |
| **Arc** | everyone on one ring, grouped by circle, ties crossing the middle |
| **Grid** | a block per circle, wrapping into sub-columns rather than growing endlessly tall |
| **Pulse** | distance from you is time since you last spoke; rings marked at a month, three months, a year |
| **Stars** | ties drive the layout, so people who introduced each other gather |

Web, Classic and Stars relax into place — one solver, three sets of forces.
Venn, Arc, Grid and Pulse are placed outright.

### Staying readable when it grows

Names are rationed once there are more of them than will fit: you, the circles,
whatever is selected or hovered, anything matching the search, then the people
you spoke to most recently. Everyone else stays a dot until you hover them or
search their name — a search match is ringed on the map, not just listed.
Framing holds a legible zoom rather than shrinking to fit everything, and at 120
people across 8 circles every view still settles with no two dots touching.

## Circles

A person can be in as many circles as you like. The first is their primary: it
colours their dot and is the branch they sit nearest. Extra memberships draw as
lighter branches, so someone who is both a neighbour and a supplier visibly
bridges the two.

- **Drag a person onto a circle** to file them there — it becomes their primary.
- Their card lists every circle, **in order** — the first is their *main* one,
  which decides where they are filed and what colour their dot is. Drag the
  chips to reorder, press `‹` to move one ahead, or click a chip to make it
  main. `×` leaves, *+ circle* adds another.
- Grid, Arc, Pulse and Venn place a person with their main circle. Web, Classic
  and Stars let every circle pull, so they settle between — nearest the main.
- **Click a circle on the map** to recolour, rename, hide or delete it.
- Circles claim room in proportion to how many people they hold, so a School of
  thirty gets the space a Family of two does not need.
- Every dot is the same size. Colour says which circle, position says where they
  sit; nothing else is encoded in a dot, except that a quiet one fades to an
  outline.
- Nothing stays pinned. Dragging a person moves them; letting go anywhere that
  is not a circle or another person hands them back to the layout. The **tidy**
  button (or `T`) re-settles everything, and the map re-frames itself once the
  springs stop so nothing drifts off the edge or hides behind an open card.
- The button beside *Add person* makes a new one; empty circles are kept as
  branches until deleted, so structure survives a purge.

## Connections

Who put you onto whom. **Drag one person onto another** to join them, or say
*"Marcus introduced me to Rae Kim"*, *"got her info from Ada"*, *"met Lila
through Priya"*; the Connections row on a card also takes names directly. They
draw as a dashed arrow running from the person who made the introduction to
the person you met. Stored directionally — the toast after a
drag offers to flip it — and drawn mutually.

Deleting a circle leaves a tombstone, so the deletion survives a sync from a
device that still has it; the same mechanism has always covered deleted people.

## Schools

A list, not a field: type one and press enter. Each carries a **degree** — BS,
BA, MS, MBA, JD, MD, PhD and the rest — picked from a list when you click the
chip, or set as you type (*"wharton mba"*, *"rutgers bs"*). The bar reads them
out of a sentence the same way, lower case and all: *"swarthmore alumn, did her
MBA at Wharton"* files both with the right degrees. Anything filed under the
old undergrad/grad pair is converted on load: undergrad becomes BS, grad
becomes MS.

## The archive

The folder button in the top bar (or **A**) pulls a drawer out over the map,
which keeps running, blurred, behind it. The same people and circles, read
seven ways — pick one from the row of buttons and it is remembered:

| design | what it is |
| --- | --- |
| **Drawer** | cut tabs over colour bands; a folder opens and its entries rise into it |
| **Rolodex** | one card at a time on a ring — drag, scroll, arrow or type a name; click to turn it over |
| **Light table** | every person a sheet loose on a table, draggable, lit by a lamp that follows the pointer; threads join whoever introduced whom |
| **Index** | everyone at once, set tight, no colour but the pips; the hovered line types itself out along the bottom |
| **Sublime** | one name a screen, full frame, dissolving into the next |
| **Chroma** | no paper at all — each folder a field of its own light, names set huge over it |
| **Desktop** | folders, files, a preview pane and a status bar; arrow keys walk it, Enter opens the card |

Nothing here edits: *Open the card* hands the person back to the map, where
everything is editable. Escape steps back out, one level at a time.

## Editing a card

Touchpoints are logged from the card too — *+ log a touchpoint* under History
takes the kind, the date and what happened, and lifts the takeaway out of the
text the same way the chat bar does.

Every value on a person's card is edited in place — click it and type, including
the name. Empty fields read *add*; *+ another field* takes anything the standard
ones do not cover. Email and phone keep a small icon beside them for reaching
the mail app or dialer, so clicking the value itself always means *edit*.

An edit is never interrupted by sync: an update arriving from another device
while a field is open is held, folded into whatever you just typed, and applied
when you finish. A single failed request shows as *Retrying* rather than an
error, since the next poll usually settles it.

## Talking to it

The chat bar reads plain sentences. It also takes instructions that reshape the
map (`remove everyone but keep the categories`, `merge Industry into Vendors`,
`rename Neighbors to Philadelphia`, `create a category called Vendors`, `add Ada to
Vendors`) and ones that change how it looks (`make Work green`, `hide Family`,
`call me Ben`). Anything
touching more than one person is described and counted before it runs, and
every change can be taken back with ⌘Z, the Undo on the toast, or `/undo`. Beyond logging a touchpoint it understands direct edits
(`her location is Philadelphia`, `change his email to …`, `remove her phone`),
resolves *she/he/they* to whoever's dossier is open or was last logged, and
turns anything the fixed fields do not cover (`her partner is Sam`) into its own
labelled line on the card. A bare fact edits the card; something that happened
also logs a touchpoint.
