#!/usr/bin/env python3
"""
Scrape Rightmove search URL and output JSON array of listings to stdout.
Usage: python rightmove_scrape.py <rightmove_search_url>
"""
import json
import sys

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing Rightmove URL"}), file=sys.stderr)
        sys.exit(1)
    url = sys.argv[1].strip()
    if not url.startswith("https://www.rightmove.co.uk/"):
        print(json.dumps({"error": "Invalid Rightmove URL"}), file=sys.stderr)
        sys.exit(1)

    try:
        from rightmove_webscraper import RightmoveData
    except ImportError:
        print(json.dumps({"error": "rightmove-webscraper not installed"}), file=sys.stderr)
        sys.exit(1)

    try:
        rm = RightmoveData(url)
        df = rm.get_results
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

    if df is None or df.empty:
        print("[]")
        return

    # Normalise column names to snake_case and build list of dicts
    records = []
    for _, row in df.iterrows():
        d = row.to_dict()
        # Ensure we have a property URL for the app (Rightmove uses 'url' or we build from id)
        if "url" not in d or not d.get("url"):
            pid = d.get("id") or d.get("property_id")
            if pid:
                d["url"] = f"https://www.rightmove.co.uk/properties/{pid}"
        records.append(d)

    print(json.dumps(records, default=str))

if __name__ == "__main__":
    main()
