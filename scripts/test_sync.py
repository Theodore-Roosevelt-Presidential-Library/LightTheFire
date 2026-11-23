#!/usr/bin/env python3
"""Checks on the DonorPerfect sync, using the saved replies in scripts/fixtures. Run: python3 scripts/test_sync.py"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sync_donorperfect as s  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"
cfg = json.loads(s.CONFIG.read_text(encoding="utf-8"))
dp = s.DonorPerfect("unused", fixtures=str(FIX))
gifts = s.fetch_gifts(dp, "FIXTURE", ["G"], "", cfg["donorPerfect"])
meta = s.fetch_campaign(dp, "FIXTURE")
out, notes = s.build(cfg, gifts, meta, datetime.now(timezone.utc))
text = json.dumps(out)
fails = []


def check(ok, what):
    print(("ok   " if ok else "FAIL ") + what)
    if not ok:
        fails.append(what)


check(out["gifts"] == 537, "counts every gift across both pages (537)")
check(sum(out["states"].values()) + out["elsewhere"] == 537, "every gift lands in a state or in 'elsewhere'")
check(out["states"].get("ND", 0) > 0 and "NORTH DAKOTA" not in out["states"], "full state names become two-letter codes")
check(out["stateOrder"][0] == "ND", "stateOrder starts with the first state to give")
check(out["progress"] is not None, "progress is computed from the DonorPerfect goal")
check("raised" not in out and "amount" not in text, "no dollar figures in the public file by default")
for last in ("Keller", "Torres", "Meyer", "Patel", "Ruiz", "O'Neil", "Lund", "Outfitters"):
    check(last not in text, "giver's last name %r never appears" % last)
names = [sp["n"] for sp in out["sparks"] if sp.get("n") and not sp.get("k")]
check("Anna K." in names and "Grace & Tom L." in names, "givers show as first name and last initial")
check(all(sp["n"] is None for sp in out["sparks"] if sp.get("c") == "Medora" and not sp.get("k")), "an organization shows no name")
trib = [sp for sp in out["sparks"] if sp.get("k")]
check(any(sp["k"] == "m" and sp["n"] == "Ruth Olson" for sp in trib), "a memorial gift shows the memorial name in place of the giver")
check(any(sp["k"] == "h" and sp["n"] == "Dan Reyes" for sp in trib), "an honor gift shows the honoree in place of the giver")
check(any(sp.get("c") == "Fargo" for sp in out["sparks"]), "city names are tidied (FARGO becomes Fargo)")
check(len(out["recentGiftTimes"]) > 0 and all(t.endswith("Z") and len(t) == 17 for t in out["recentGiftTimes"]), "recent gift times are minute-level UTC")
check(s.public_name({"first_name": "Jo", "last_name": "", "org_rec": "N"}) == "Jo", "a missing last name still yields a first name")
check(s.tribute({"memory_honor": "IMO", "gfname": "Ann", "glname": "Lee"}, {}, True) == ("memory", "Ann Lee"), "unlisted memorial codes are still recognized")
check(s.tribute({"memory_honor": "M", "gfname": "Ann", "glname": "Lee"}, {}, False) == ("memory", "Ann L."), "tributeFullName off shortens the tribute name")
try:
    s.safe_code("X'; DROP TABLE dp;--")
    check(False, "an unsafe campaign ID is refused")
except SystemExit:
    check(True, "an unsafe campaign ID is refused")
print("\n%d failed" % len(fails))
sys.exit(1 if fails else 0)
