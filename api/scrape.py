"""
Vercel serverless function: GET /api/scrape?url=... or POST with body { "url": "..." }.
Returns JSON array of Rightmove listings or { "error": "..." }.
"""
import json
import urllib.parse

from http.server import BaseHTTPRequestHandler


def scrape_rightmove(url: str):
    from rightmove_webscraper import RightmoveData
    rm = RightmoveData(url)
    df = rm.get_results
    if df is None or df.empty:
        return []
    records = []
    for _, row in df.iterrows():
        d = row.to_dict()
        if "url" not in d or not d.get("url"):
            pid = d.get("id") or d.get("property_id")
            if pid:
                d["url"] = f"https://www.rightmove.co.uk/properties/{pid}"
        records.append(d)
    return records


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        url = (qs.get("url") or [None])[0]
        self._handle_request(url)

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length else "{}"
        try:
            data = json.loads(body)
            url = data.get("url")
        except json.JSONDecodeError:
            url = None
        self._handle_request(url)

    def _handle_request(self, url):
        if not url:
            self._send(400, {"error": "Missing url"})
            return
        url = url.strip()
        if not url.startswith("https://www.rightmove.co.uk/"):
            self._send(400, {"error": "Invalid Rightmove URL"})
            return
        try:
            records = scrape_rightmove(url)
            self._send(200, records)
        except ImportError:
            self._send(500, {"error": "rightmove-webscraper not installed"})
        except Exception as e:
            self._send(502, {"error": str(e)})

    def _send(self, code, body):
        self.send_response(code)
        self.send_header("Content-type", "application/json")
        self.end_headers()
        payload = json.dumps(body, default=str)
        self.wfile.write(payload.encode("utf-8"))
