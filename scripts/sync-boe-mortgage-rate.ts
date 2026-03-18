/**
 * Supabase Edge Function: sync-boe-mortgage-rate
 *
 * Fetches the latest Bank of England mortgage rate for series IUMBV45 and
 * upserts it into the `mortgage_rates` table. Deploy this file as a Supabase
 * Edge Function named `sync-boe-mortgage-rate`.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// BoE series IUMBV45: mortgage rate series we care about
const BOE_SERIES_CODE = "IUMBV45";

// Direct CSV download endpoint (confirmed working in browser)
const BOE_CSV_URL =
  "http://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp" +
  "?csv.x=yes" +
  "&Datefrom=01/Jan/2000" +
  "&Dateto=31/Dec/2099" +
  "&SeriesCodes=" +
  BOE_SERIES_CODE +
  "&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N";

Deno.serve(async () => {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !serviceRoleKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
      return new Response(JSON.stringify({ error: "missing_supabase_env" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(url, serviceRoleKey, {
      global: { fetch },
    });

    const res = await fetch(BOE_CSV_URL);
    if (!res.ok) {
      const text = await res.text();
      console.error("BoE request failed", res.status, text.slice(0, 500));
      return new Response(JSON.stringify({ error: "boe_request_failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const csv = await res.text();
    const { effectiveDate, rate } = parseLatestRate(csv, BOE_SERIES_CODE);

    if (!effectiveDate || !Number.isFinite(rate)) {
      console.error("Parsed invalid BoE data", { effectiveDate, rate });
      return new Response(JSON.stringify({ error: "invalid_boe_data" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { error } = await supabaseClient
      .from("mortgage_rates")
      .upsert(
        {
          effective_date: effectiveDate,
          rate_annual_percent: rate,
          source_series: BOE_SERIES_CODE,
          source_name: "BoE series " + BOE_SERIES_CODE,
        },
        { onConflict: "effective_date,source_series" },
      );

    if (error) {
      console.error("Upsert into mortgage_rates failed", error);
      return new Response(JSON.stringify({ error: "db_upsert_failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, effectiveDate, rate }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("Unexpected error in sync-boe-mortgage-rate", e);
    return new Response(JSON.stringify({ error: "unexpected_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

function parseLatestRate(
  csv: string,
  columnCode: string,
): { effectiveDate: string | null; rate: number } {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return { effectiveDate: null, rate: NaN };

  const header = lines[0].split(",");
  const idx = header.indexOf(columnCode);
  if (idx < 0) {
    console.error("Column not found in BoE CSV header", { header, columnCode });
    return { effectiveDate: null, rate: NaN };
  }

  for (let i = lines.length - 1; i >= 1; i--) {
    const cols = lines[i].split(",");
    if (cols.length <= idx) continue;

    const dateRaw = cols[0].trim();
    const rateRaw = cols[idx].trim();
    if (!dateRaw || !rateRaw || rateRaw === "..") continue;

    const d = new Date(dateRaw);
    const rate = parseFloat(rateRaw);

    if (!Number.isFinite(rate) || isNaN(d.getTime())) continue;

    const effectiveDate = d.toISOString().slice(0, 10);
    return { effectiveDate, rate };
  }

  return { effectiveDate: null, rate: NaN };
}

