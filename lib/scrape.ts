/**
 * Call Rightmove scraper: on Vercel, hit our Python serverless /api/scrape.
 * Locally, run scripts/rightmove_scrape.py via child_process.
 */

export type Listing = {
  id?: number | string;
  url?: string;
  price?: number | string;
  address?: string;
  type?: string;
  number_of_bedrooms?: number;
  [key: string]: unknown;
};

export async function scrapeRightmove(searchUrl: string): Promise<Listing[]> {
  const isVercel = !!process.env.VERCEL;
  const origin =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_ORIGIN || "http://localhost:3000";

  if (isVercel) {
    const res = await fetch(
      `${origin}/api/scrape?url=${encodeURIComponent(searchUrl)}`,
      { cache: "no-store" }
    );
    const text = await res.text();
    if (!res.ok) {
      let err: { error?: string } = {};
      try {
        err = JSON.parse(text);
      } catch {
        err = { error: text };
      }
      throw new Error((err as { error?: string }).error || "Scrape failed");
    }
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data as Listing[];
    if (data?.error) throw new Error(data.error);
    return [];
  }

  // Local: run Python script
  const { spawn } = await import("child_process");
  const path = await import("path");
  const scriptPath = path.join(
    process.cwd(),
    "scripts",
    "rightmove_scrape.py"
  );
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [scriptPath, searchUrl], {
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf-8");
    proc.stderr.setEncoding("utf-8");
    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        try {
          const err = JSON.parse(stderr || stdout);
          reject(new Error((err as { error?: string }).error || "Scrape failed"));
        } catch {
          reject(new Error(stderr || stdout || "Scrape failed"));
        }
        return;
      }
      try {
        const data = JSON.parse(stdout);
        resolve(Array.isArray(data) ? data : []);
      } catch {
        reject(new Error("Invalid JSON from scraper"));
      }
    });
    proc.on("error", (err) => {
      reject(new Error(`Failed to run Python: ${err.message}`));
    });
  });
}
