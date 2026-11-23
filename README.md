# Light the Fire

A campfire in the Badlands that burns as bright as the giving. Every gift adds a log and sends a
spark into the night sky, where it stays. Built for the Theodore Roosevelt Presidential Library's
giving campaign: Giving Tuesday, year-end and Giving Hearts Day.

**Live:** https://lightthefire.labs.trlibrary.com (preview, setup status and embed codes)

## Put it on a page

```html
<div data-lightthefire="full"></div>
<script src="https://lightthefire.labs.trlibrary.com/embed.js" async></script>
```

| View | What it shows |
|------|---------------|
| `full` | The fire, give buttons, the ride to the Elkhorn and the 50-state race |
| `fire` | The fire, the count and the latest sparks |
| `counter` | A small count with a give button |
| `progress` | The ride to the Elkhorn (progress toward the goal) |
| `map` | The 50-state race |
| `screen` | Full-screen fire for lobby displays |

Add `data-demo="1"` to preview with sample numbers and controls. The embed is an iframe that sizes
itself, so the site's styles and the fire's styles never touch.

## Connect DonorPerfect (three steps)

1. **Campaign.** In `config/campaign.json`, set `donorPerfect.campaignId` to the DonorPerfect
   campaign code. Gifts are counted when their Campaign field matches it.
2. **API key.** In the repository's Settings → Secrets and variables → Actions, add a secret named
   `DP_API_KEY`. Paste the key exactly as DonorPerfect issued it.
3. **Giving form.** Set `give.formUrl` to the DonorPerfect form's address. If the form accepts a
   preset amount on its address, put that parameter's name in `give.amountParam`.

The **Sync DonorPerfect** workflow then runs every 5 minutes, writes `data/live.json` and
redeploys. Until all of this is in place the workflow does nothing, and the page shows sample
numbers with a visible "Sample numbers" label. Set `"mode": "live"` before the embed goes on a
public page: in live mode sample numbers are never shown, and the count starts from zero.

**Goal.** The sync reads the campaign's goal from DonorPerfect's code table. To set it by hand, use
`donorPerfect.goal` with `goalUnit` of `dollars` or `gifts`. The page shows progress as a percent;
dollar totals appear only if `display.showDollars` is true.

**After a gift.** Set the form's thank-you redirect to the page that holds the embed, with
`?ltf=thanks` on the end. The fire sends up a spark for the person who just gave.

## What the public sees about each gift

`data/live.json` is a public file. It holds:

- the gift count, progress toward the goal, and a count per state
- the minute each gift of the last 24 hours arrived (this drives the fire)
- for recent gifts: **first name and last initial, city and state**
- for a gift made in memory or in honor of someone: **that person's name in place of the giver's**

It never holds a giver's full name, an email, a street address or a gift amount. Organizations
show as "A friend."

Settings in `config/campaign.json`:

| Setting | Effect |
|---------|--------|
| `display.showNames` | `false` shows no names at all |
| `display.showCity` | `false` shows state only |
| `display.showTributes` | `false` ignores memorial and honor names |
| `display.tributeFullName` | `false` shortens memorial and honor names to first name and last initial |
| `donorPerfect.anonymousField` | Name of a DonorPerfect gift field (a checkbox) that hides the giver's name and city when checked |
| `donorPerfect.tributeTypeField`, `tributeFirstField`, `tributeLastField` | Where DonorPerfect stores the memorial or honor type and name (defaults: `memory_honor`, `gfname`, `glname`) |
| `donorPerfect.tributeCodes` | Which codes mean memory and which mean honor |

## How the fire decides how bright to burn

The fire measures recent giving, not the total, so it always has room to grow and always burns
down when giving slows. It never goes out: the floor is glowing embers.

- On peak days (`fire.peakDays`) and during a match hour, it counts gifts in the last hour.
- On other days it counts gifts in the last 24 hours.
- `giftsForFullFire` is how many gifts in that window make a roaring fire. Tune these two numbers
  to the size of the list.

Between phases the fire is banked, and before the first phase the logs are laid and unlit.

## Match hours and dates

`phases` sets the three giving windows and drives the countdown bar. Add match hours to `matches`:

```json
{ "label": "Bull Moose Hour", "sponsor": "Name as approved", "start": "2026-12-01T12:00:00-06:00", "end": "2026-12-01T13:00:00-06:00" }
```

## First-time setup

1. Repository Settings → Pages → Source: **GitHub Actions**. Custom domain: `lightthefire.labs.trlibrary.com`.
2. DNS: a CNAME record for `lightthefire.labs` pointing to `theodore-roosevelt-presidential-library.github.io`.
3. Push to `main`. The **Deploy site** workflow publishes it.

## Working on it

```bash
python3 -m http.server 8000        # then open http://localhost:8000/?  (preview page) or /app/?demo=1
python3 scripts/sync_donorperfect.py --fixtures scripts/fixtures --dry-run   # test the sync with saved replies
python3 scripts/test_sync.py       # checks on names, tributes, states and privacy
```

```
index.html              preview, setup status, embed codes
embed.js                the one script a page loads
app/index.html          the page inside the embed
assets/js/app.js        numbers, countdown, map, give links
assets/js/fire.js       the fire and the sky (canvas)
config/campaign.json    every setting a person changes
data/sample.json        stand-in numbers
data/live.json          written by the sync (appears after the first run)
scripts/                DonorPerfect sync, its test and saved sample replies
```

## Not yet verified

The DonorPerfect queries were written from the published API description and tested against saved
sample replies, not a live account. With the first real key, check: the field that holds a gift's
entry time (`created_date`), the time zone DonorPerfect reports it in (`donorPerfect.timezone`),
the campaign goal column, and the memorial and honor codes in use.

Fonts load from www.trlibrary.com (licensed to the Library). Photograph: Theodore Roosevelt in his
buckskin hunting suit, 1885. Code: MIT.
