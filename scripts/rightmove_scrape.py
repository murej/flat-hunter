#!/usr/bin/env python3
"""
Scrape Rightmove search URL and output JSON array of listings to stdout.
Usage: python rightmove_scrape.py <rightmove_search_url>

Uses rightmove-webscraper when possible; falls back to a defensive single-page
scraper when the library hits "list index out of range" (e.g. USERDEFINEDAREA or
changed Rightmove HTML).
"""
import json
import sys

try:
    import pandas as pd
except ImportError:
    pd = None

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing Rightmove URL"}), file=sys.stderr)
        sys.exit(1)
    url = sys.argv[1].strip()
    if not url.startswith("https://www.rightmove.co.uk/"):
        print(json.dumps({"error": "Invalid Rightmove URL"}), file=sys.stderr)
        sys.exit(1)

    # Try the library first
    try:
        from rightmove_webscraper import RightmoveData
        rm = RightmoveData(url)
        df = rm.get_results
    except (IndexError, ValueError) as e:
        # "list index out of range" or invalid URL - use fallback scraper
        df = _fallback_scrape(url)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

    if df is None or (hasattr(df, "empty") and df.empty):
        print("[]")
        return

    # Normalise to list of dicts (and make JSON-serializable: no NaN)
    records = []
    for _, row in df.iterrows():
        d = row.to_dict()
        if "url" not in d or not d.get("url"):
            pid = d.get("id") or d.get("property_id")
            if pid:
                d["url"] = f"https://www.rightmove.co.uk/properties/{pid}"
        for k in list(d.keys()):
            if pd is not None and pd.isna(d[k]):
                d[k] = None
            elif d[k] != d[k]:  # NaN != NaN
                d[k] = None
        records.append(d)

    print(json.dumps(records, default=str))


def _fallback_scrape(url: str):
    """Scrape when the library fails (e.g. results_count_display [0] or new Rightmove HTML)."""
    import re
    import requests
    from lxml import html
    import pandas as pd

    def extract_beds(s):
        if pd.isna(s):
            return None
        m = re.search(r"\b(\d{1,2})\s*bed", str(s), re.I) or re.search(r"\b(\d{1,2})\b", str(s))
        return int(m.group(1)) if m else None

    base = "https://www.rightmove.co.uk"
    rows = []
    page = 0
    seen_urls = set()
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

    while page <= 42:
        p_url = f"{url}&index={page * 24}" if "&index=" not in url else (url.split("&index=")[0] + f"&index={page * 24}")
        r = requests.get(p_url, headers=headers)
        if r.status_code != 200:
            break
        tree = html.fromstring(r.content)

        # Match old (propertyCard) or new (PropertyCard) class names; each card has a /properties/ link
        cards = tree.xpath('//*[contains(@class,"propertyCard") or contains(@class,"PropertyCard")][.//a[contains(@href,"/properties/")]]')
        if not cards:
            break

        for card in cards:
            href_el = card.xpath('.//a[contains(@href,"/properties/")][1]')
            if not href_el:
                continue
            href = href_el[0].get("href", "")
            if not href or href in seen_urls:
                continue
            seen_urls.add(href)
            if not href.startswith("http"):
                href = base + href if href.startswith("/") else base + "/" + href

            price_el = card.xpath('.//*[contains(@class,"price") or contains(@class,"Price")]/text()')
            price = ""
            for t in price_el:
                t = (t or "").strip()
                if t.startswith("£") and any(c.isdigit() for c in t):
                    price = t
                    break

            title_el = card.xpath('.//h2//text() | .//*[contains(@class,"title")]//text()')
            title = " ".join((t or "").strip() for t in title_el if (t or "").strip())[:200]

            addr_el = card.xpath('.//address//text() | .//*[contains(@class,"address")]//text()')
            address = " ".join((t or "").strip() for t in addr_el if (t or "").strip()).replace("\n", " ")[:300]

            rows.append({"price": price, "type": title, "address": address, "url": href})

        page += 1
        if len(cards) < 24:
            break

    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["number_of_bedrooms"] = df["type"].apply(extract_beds)
    return df


if __name__ == "__main__":
    main()
