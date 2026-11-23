#!/usr/bin/env python3
"""Pull one campaign's gifts from DonorPerfect and write the public numbers to data/live.json.

What goes in the public file: the gift count, progress toward the goal, a count per state, the
minute each gift of the last 24 hours arrived (that drives the fire), and for each recent gift a
first name, last initial, city and state. A gift made in memory or in honor of someone shows that
person's name in place of the giver's. Never a giver's full name, an email, an address or a gift amount.
Dollar totals are left out unless "showDollars" is true in config/campaign.json.

Settings come from config/campaign.json ("donorPerfect"). The API key comes from the DP_API_KEY
environment variable (a GitHub Actions secret) and is never written anywhere.

    python scripts/sync_donorperfect.py                 # live run
    python scripts/sync_donorperfect.py --dry-run       # print what would be written
    python scripts/sync_donorperfect.py --fixtures scripts/fixtures   # use saved XML, no network

Standard library only.
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "campaign.json"
OUT = ROOT / "data" / "live.json"
PAGE = 500            # DonorPerfect returns at most 500 rows per request
MAX_SPARKS = 2600     # how many recent gifts carry a name in the public file
HEARTBEAT_MIN = 60    # rewrite the file at least this often so "last synced" stays honest

STATES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO",
    "CONNECTICUT": "CT", "DELAWARE": "DE", "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID",
    "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA",
    "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR", "PENNSYLVANIA": "PA",
    "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX",
    "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI", "WYOMING": "WY",
}
CODES = set(STATES.values())
DATE_FORMATS = ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %I:%M %p", "%Y-%m-%dT%H:%M:%S.%f",
                "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y", "%Y-%m-%d")


def say(msg):
    print(msg, flush=True)


class DonorPerfect:
    """Runs read-only SELECT statements through the DonorPerfect XML API."""

    def __init__(self, endpoint, key=None, fixtures=None):
        self.endpoint, self.key, self.fixtures, self.calls = endpoint, key, fixtures, 0

    def query(self, sql, label):
        self.calls += 1
        if self.fixtures:
            path = Path(self.fixtures) / (label + ".xml")
            text = path.read_text(encoding="utf-8") if path.exists() else "<result></result>"
        else:
            # The key is used exactly as DonorPerfect issued it (it may already contain % codes),
            # so it is not encoded again. Only the SQL is encoded.
            url = self.endpoint + "?apikey=" + self.key + "&action=" + urllib.parse.quote(sql, safe="")
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TRPL-LightTheFire"}), timeout=60) as r:
                    text = r.read().decode("utf-8", "replace")
            except Exception as e:  # never let the key reach the log
                raise RuntimeError("DonorPerfect request failed (%s): %s" % (label, type(e).__name__)) from None
        try:
            root = ET.fromstring(text)
        except ET.ParseError:
            raise RuntimeError("DonorPerfect did not return XML for %s: %s" % (label, text[:200].replace(self.key or "\0", "***")))
        if root.tag.lower() == "error" or root.find(".//error") is not None:
            raise RuntimeError("DonorPerfect error for %s: %s" % (label, "".join(root.itertext()).strip()[:300]))
        rows = []
        for rec in root.iter("record"):
            rows.append({(f.get("name") or f.get("id") or "").lower(): (f.get("value") or "") for f in rec.iter("field")})
        return rows


def safe_code(value):
    """Campaign codes go into SQL, so allow only plain code characters."""
    value = str(value).strip()
    if not re.fullmatch(r"[A-Za-z0-9_\- .]{1,40}", value):
        raise SystemExit("The campaign ID %r has characters that are not allowed." % value)
    return value.replace("'", "")


def safe_field(value):
    value = str(value or "").strip()
    if value and not re.fullmatch(r"[A-Za-z0-9_]{1,40}", value):
        raise SystemExit("The field name %r is not a plain DonorPerfect field name." % value)
    return value


def parse_when(text, tz):
    """Returns (aware datetime in UTC, True if the value carried a time of day)."""
    text = (text or "").strip()
    if not text:
        return None, False
    for fmt in DATE_FORMATS:
        try:
            d = datetime.strptime(text, fmt)
        except ValueError:
            continue
        has_time = "H" in fmt or "I" in fmt
        return d.replace(tzinfo=tz).astimezone(timezone.utc), has_time and (d.hour, d.minute, d.second) != (0, 0, 0)
    return None, False


def state_code(raw):
    raw = (raw or "").strip().upper().replace(".", "")
    if raw in CODES:
        return raw
    return STATES.get(raw)


def public_name(row):
    """First name and last initial only. Organizations and blanks get no name."""
    if (row.get("org_rec") or "").strip().upper() == "Y":
        return None
    first = re.sub(r"\s+", " ", (row.get("first_name") or "").strip())
    last = (row.get("last_name") or "").strip()
    if not first:
        return None
    first = first[:24]
    initial = next((ch.upper() for ch in last if ch.isalpha()), "")
    return (first + (" " + initial + "." if initial else "")).strip()


def tribute(row, dp_cfg, full_name):
    """('memory' | 'honor' | 'tribute', name) when the gift was made for someone, else None."""
    code = (row.get((dp_cfg.get("tributeTypeField") or "memory_honor").lower()) or "").strip().upper()
    first = re.sub(r"\s+", " ", (row.get((dp_cfg.get("tributeFirstField") or "gfname").lower()) or "").strip())
    last = re.sub(r"\s+", " ", (row.get((dp_cfg.get("tributeLastField") or "glname").lower()) or "").strip())
    if not code or not (first or last):
        return None
    kinds = {str(k).upper(): v for k, v in (dp_cfg.get("tributeCodes") or {}).items()}
    kind = kinds.get(code)
    if not kind:
        if code.startswith(("M", "IM")) or "MEM" in code:
            kind = "memory"
        elif code.startswith(("H", "IH")) or "HON" in code:
            kind = "honor"
        else:
            kind = "tribute"
    if full_name or not first:
        name = (first + " " + last).strip()
    else:
        initial = next((ch.upper() for ch in last if ch.isalpha()), "")
        name = (first + (" " + initial + "." if initial else "")).strip()
    return kind, name[:60]


def public_city(raw):
    raw = re.sub(r"\s+", " ", (raw or "").strip())
    if not raw or len(raw) > 40 or any(ch.isdigit() for ch in raw):
        return None
    return raw.title() if raw.isupper() or raw.islower() else raw


def fetch_gifts(dp, campaign, record_types, anon_field, dp_cfg=None):
    types = ",".join("'" + re.sub(r"[^A-Za-z]", "", t) + "'" for t in record_types) or "'G'"
    dp_cfg = dp_cfg or {}
    extra = (", g." + anon_field) if anon_field else ""
    for key, default in (("tributeTypeField", "memory_honor"), ("tributeFirstField", "gfname"), ("tributeLastField", "glname")):
        field = safe_field(dp_cfg.get(key) or default)
        if field and ("g." + field) not in extra:
            extra += ", g." + field
    rows, start = [], 1
    while True:
        sql = ("SELECT * FROM (SELECT ROW_NUMBER() OVER (ORDER BY g.gift_id) AS rn, g.gift_id, g.amount, g.gift_date, "
               "g.created_date, g.record_type%s, d.first_name, d.last_name, d.org_rec, d.city, d.state, d.country "
               "FROM dpgift g INNER JOIN dp d ON d.donor_id = g.donor_id "
               "WHERE g.campaign = '%s' AND g.record_type IN (%s)) t WHERE rn BETWEEN %d AND %d"
               % (extra, campaign, types, start, start + PAGE - 1))
        page = dp.query(sql, "gifts-%d" % ((start - 1) // PAGE + 1))
        rows += page
        if len(page) < PAGE:
            return rows
        start += PAGE


def fetch_campaign(dp, campaign):
    """The campaign's description and goal from DonorPerfect's code table, if they are there."""
    for cols in ("code, description, goal", "code, description"):
        try:
            rows = dp.query("SELECT %s FROM dpcodes WHERE field_name = 'CAMPAIGN' AND code = '%s'" % (cols, campaign), "campaign")
        except RuntimeError as e:
            say("  (campaign lookup with %s failed: %s)" % (cols, e))
            continue
        if rows:
            return rows[0]
    return {}


def build(cfg, gifts, meta, now):
    dp_cfg, disp = cfg.get("donorPerfect", {}), cfg.get("display", {})
    tz = ZoneInfo(dp_cfg.get("timezone") or "America/New_York")
    anon = safe_field(dp_cfg.get("anonymousField")).lower()
    items, timed = [], 0
    for g in gifts:
        try:
            amount = float((g.get("amount") or "0").replace(",", "").replace("$", ""))
        except ValueError:
            amount = 0.0
        made, has_time = parse_when(g.get("created_date"), tz)
        if made is None:
            made, has_time = parse_when(g.get("gift_date"), tz)
        timed += 1 if has_time else 0
        try:
            gid = int(float(g.get("gift_id") or 0))
        except ValueError:
            gid = 0
        hidden = bool(anon) and (g.get(anon) or "").strip().upper() in ("Y", "YES", "TRUE", "1")
        trib = tribute(g, dp_cfg, disp.get("tributeFullName", True)) if disp.get("showTributes", True) else None
        items.append({"id": gid, "amount": amount, "when": made, "timed": has_time, "state": state_code(g.get("state")),
                      "name": trib[1] if trib else (None if hidden else public_name(g)), "kind": trib[0] if trib else None,
                      "city": None if hidden else public_city(g.get("city"))})
    items.sort(key=lambda i: (i["when"] or datetime.min.replace(tzinfo=timezone.utc), i["id"]))

    states, order, elsewhere = {}, [], 0
    for i in items:
        if i["state"]:
            if i["state"] not in states:
                order.append(i["state"])
            states[i["state"]] = states.get(i["state"], 0) + 1
        else:
            elsewhere += 1

    since = now - timedelta(hours=24)
    recent = [i["when"].strftime("%Y-%m-%dT%H:%MZ") for i in items if i["timed"] and i["when"] and since <= i["when"] <= now + timedelta(minutes=5)]
    raised = round(sum(i["amount"] for i in items), 2)

    goal = dp_cfg.get("goal") or 0
    unit = dp_cfg.get("goalUnit") or "dollars"
    if not goal and meta.get("goal"):
        try:
            goal, unit = float(str(meta["goal"]).replace(",", "").replace("$", "")), "dollars"
        except ValueError:
            goal = 0
    progress = None
    if goal:
        progress = round((raised if unit == "dollars" else len(items)) / goal, 4)

    out = {
        "schema": 1,
        "source": "donorperfect",
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "campaign": {"id": dp_cfg.get("campaignId"), "name": dp_cfg.get("campaignName") or meta.get("description") or ""},
        "gifts": len(items),
        "goalUnit": unit,
        "progress": progress,
        "states": dict(sorted(states.items())),
        "stateOrder": order,
        "elsewhere": elsewhere,
        "recentGiftTimes": recent[-3000:],
        "lastGiftAt": items[-1]["when"].strftime("%Y-%m-%dT%H:%MZ") if items and items[-1]["when"] and items[-1]["timed"] else None,
    }
    if unit == "gifts" and goal:
        out["goal"] = int(goal)
    if disp.get("showDollars"):
        out["raised"], out["goal"] = raised, goal
    if disp.get("showNames", True):
        sparks = []
        for i in items[-MAX_SPARKS:]:
            sp = {"n": i["name"], "s": i["state"]}
            if i["kind"]:
                sp["k"] = {"memory": "m", "honor": "h"}.get(i["kind"], "t")
            if i["city"] and disp.get("showCity", True):
                sp["c"] = i["city"]
            sparks.append(sp)
        out["sparks"] = sparks
    notes = []
    if items and not timed:
        notes.append("No gift carried a time of day, so the fire cannot tell recent gifts from old ones. Check which DonorPerfect field holds the entry time.")
    return out, notes


def changed(new, old):
    if old is None:
        return True
    a, b = dict(new), dict(old)
    a.pop("generatedAt", None), b.pop("generatedAt", None)
    if a != b:
        return True
    try:
        last = datetime.strptime(old.get("generatedAt"), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return True
    return datetime.now(timezone.utc) - last > timedelta(minutes=HEARTBEAT_MIN)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="print the result instead of writing data/live.json")
    ap.add_argument("--fixtures", help="folder of saved XML replies (gifts-1.xml, gifts-2.xml, campaign.xml) to use instead of the network")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    dp_cfg = cfg.get("donorPerfect", {})
    campaign = dp_cfg.get("campaignId") or ("FIXTURE" if args.fixtures else "")
    key = os.environ.get("DP_API_KEY", "").strip()
    if not campaign:
        say("No DonorPerfect campaign ID in config/campaign.json yet. Nothing to do.")
        return 0
    if not key and not args.fixtures:
        say("DP_API_KEY is not set. Nothing to do.")
        return 0
    campaign = safe_code(campaign)

    dp = DonorPerfect(dp_cfg.get("endpoint") or "https://www.donorperfect.net/prod/xmlrequest.asp", key, args.fixtures)
    gifts = fetch_gifts(dp, campaign, dp_cfg.get("recordTypes") or ["G"], safe_field(dp_cfg.get("anonymousField")), dp_cfg)
    meta = fetch_campaign(dp, campaign)
    out, notes = build(cfg, gifts, meta, datetime.now(timezone.utc))
    say("Campaign %s: %d gifts, %d states, %d in the last 24 hours, progress %s (%d requests)."
        % (campaign, out["gifts"], len(out["states"]), len(out["recentGiftTimes"]), out["progress"], dp.calls))
    for n in notes:
        say("NOTE: " + n)

    if args.dry_run:
        say(json.dumps(out, indent=1)[:4000])
        return 0
    path = Path(args.out)
    old = None
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            old = None
    if not changed(out, old):
        say("No change.")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    say("Wrote %s." % path.relative_to(ROOT) if path.is_relative_to(ROOT) else "Wrote %s." % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
