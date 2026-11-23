# Light the Fire — working notes for Claude

Giving-campaign interactive (campfire that burns with recent giving, sparks in a Badlands sky,
50-state map, progress trail) served at lightthefire.labs.trlibrary.com and embedded on
trlibrary.com with one script tag. Data comes from DonorPerfect through a GitHub Action.

## Non-negotiables
- `data/live.json` is public. It may hold a giver's first name and last initial, city and state,
  and a memorial or honor name in place of the giver's. Never a giver's full name, email, street
  address or gift amount. `scripts/test_sync.py` checks this; keep it passing.
- The DonorPerfect API key lives only in the `DP_API_KEY` Actions secret. Never print a request URL.
- Never show sample numbers as real: the "Sample numbers" label stays whenever sample data is on screen.
- The fire never goes out and never implies the campaign is failing: floor is embers, and it
  measures recent giving, not the total.
- Public copy: "T.R." with periods, never "Teddy"; "Benefactors" not "donors"; buttes, not mesas;
  no T.R. quotations unless verified. Route history copy through HistorianPanel.
- Brand: Night Sky + Deep Orange + Gray Sky only. Dharma Gothic (all caps) for headings, Clearface
  for body, Frutiger for labels. Never recolor the logo.

## Common tasks
- Preview: `python3 -m http.server 8000`, then `/` or `/app/?demo=1&view=full`.
- Sync test: `python3 scripts/sync_donorperfect.py --fixtures scripts/fixtures --dry-run` and `python3 scripts/test_sync.py`.
- Every setting a person changes is in `config/campaign.json`; README explains each.
