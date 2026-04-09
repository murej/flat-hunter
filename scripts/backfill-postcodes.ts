/**
 * Backfill postcodes for listings flagged as postcode_invalid by geocoding
 * their address via Nominatim.
 *
 * Usage:
 *   source scripts/load-env.sh && npx tsx scripts/backfill-postcodes.ts [--dry-run]
 *
 * Nominatim is rate-limited to 1 req/s globally via nominatimThrottle.
 * 154 listings ≈ 3 minutes.
 */

import { createClient } from "@supabase/supabase-js";
import { geocodeAddress, passesOutwardCheck } from "../lib/utils/geocode";
import { normalizePortalId } from "../lib/agents/ingest/portal-id";

const isDryRun = process.argv.includes("--dry-run");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type ListingRow = {
  id: string;
  address: string;
  postcode: string;
  portal_id: string;
  url: string;
  validation_flags: string[];
};

async function main() {
  if (isDryRun) {
    console.log("DRY RUN — no changes will be written to the database.\n");
  }

  const { data: listings, error } = await supabase
    .from("listings")
    .select("id, address, postcode, portal_id, url, validation_flags")
    .contains("validation_flags", ["postcode_invalid"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch listings:", error.message);
    process.exit(1);
  }

  if (!listings || listings.length === 0) {
    console.log("No postcode_invalid listings found.");
    return;
  }

  console.log(`Found ${listings.length} listings with postcode_invalid.\n`);

  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of listings as ListingRow[]) {
    if (!row.address?.trim()) {
      console.log(`[SKIP] ${row.id} — no address`);
      skipped++;
      continue;
    }

    let geo: Awaited<ReturnType<typeof geocodeAddress>>;
    try {
      geo = await geocodeAddress(row.address);
    } catch (err) {
      console.error(`[ERROR] ${row.id} — geocode threw:`, err);
      failed++;
      continue;
    }

    if (!geo?.postcode) {
      console.log(`[SKIP] ${row.id} "${row.address}" — no postcode from Nominatim`);
      skipped++;
      continue;
    }

    if (!passesOutwardCheck(row.postcode, geo.postcode)) {
      console.log(
        `[SKIP] ${row.id} "${row.address}" — sanity check failed: stored "${row.postcode}", got "${geo.postcode}"`,
      );
      skipped++;
      continue;
    }

    // Normalize: uppercase, single space before inward code
    const clean = geo.postcode.toUpperCase().replace(/\s+/g, "");
    const enrichedPostcode = `${clean.slice(0, -3)} ${clean.slice(-3)}`;

    const enrichedPortalId = normalizePortalId({
      portal_id: row.portal_id,
      url: row.url,
      postcode: enrichedPostcode,
    });

    const updatedFlags = [
      ...row.validation_flags.filter((f) => f !== "postcode_invalid"),
      "postcode_geocoded",
    ];

    console.log(`[OK] ${row.id} "${row.postcode}" → "${enrichedPostcode}"${isDryRun ? " (dry run)" : ""}`);

    if (!isDryRun) {
      const { error: updateError } = await supabase
        .from("listings")
        .update({
          postcode: enrichedPostcode,
          portal_id: enrichedPortalId,
          validation_flags: updatedFlags,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      if (updateError) {
        console.error(`  ↳ Update failed:`, updateError.message);
        failed++;
        continue;
      }
    }

    enriched++;
  }

  console.log(`\nDone.`);
  console.log(`  Enriched : ${enriched}`);
  console.log(`  Skipped  : ${skipped}`);
  console.log(`  Failed   : ${failed}`);

  if (isDryRun) {
    console.log("\n(Dry run — no changes were written.)");
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
