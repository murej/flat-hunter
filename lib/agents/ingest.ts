import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import { EMAIL_PARSER_SYSTEM } from "@/lib/prompts";
import { runEvaluationPipeline } from "./propertyEvaluator";
import { sendMessage } from "@/lib/telegram";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface RawListing {
  portal_id: string;
  url: string;
  title: string;
  price: number;
  address: string;
  postcode: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  description: string;
  image_urls: string[];
  floorplan_url: string;
  agent_name: string;
  agent_email: string;
  listed_date: string;
}

export async function parseEmailHtml(html: string): Promise<RawListing[]> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 4096,
    system: EMAIL_PARSER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Parse the following property alert email HTML and extract all listings:\n\n${html}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "[]";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error("Failed to parse listings JSON from Claude response");
    return [];
  }
}

export async function deduplicateAndStore(
  listings: RawListing[]
): Promise<string[]> {
  const newListingIds: string[] = [];

  for (const listing of listings) {
    const { data: existing } = await supabaseAdmin
      .from("listings")
      .select("id")
      .eq("portal_id", listing.portal_id)
      .single();

    if (existing) continue;

    const { data: inserted, error } = await supabaseAdmin
      .from("listings")
      .insert({
        portal_id: listing.portal_id,
        url: listing.url,
        title: listing.title,
        price: listing.price,
        address: listing.address,
        postcode: listing.postcode,
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        sqft: listing.sqft,
        description: listing.description,
        image_urls: listing.image_urls,
        floorplan_url: listing.floorplan_url,
        agent_name: listing.agent_name,
        agent_email: listing.agent_email,
        listed_date: listing.listed_date,
        status: "pending_evaluation",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Failed to insert listing:", error);
      continue;
    }

    if (inserted) {
      newListingIds.push(inserted.id);
    }
  }

  return newListingIds;
}

export async function ingestAgent(html: string): Promise<void> {
  const listings = await parseEmailHtml(html);
  const newIds = await deduplicateAndStore(listings);

  if (newIds.length === 0) return;

  const evalResults = await Promise.all(
    newIds.map((id) =>
      runEvaluationPipeline(id).catch((e) => {
        console.error(`Evaluation failed for ${id}:`, e);
        return false;
      })
    )
  );

  const sentCount = evalResults.filter(Boolean).length;
  const suppressedCount = evalResults.length - sentCount;

  if (suppressedCount > 0) {
    await sendMessage(
      `📬 Email alert processed: *${newIds.length}* new ${newIds.length === 1 ? "property" : "properties"} — showing *${sentCount}* scorecard${sentCount === 1 ? "" : "s"}, plus *${suppressedCount}* more that scored 5/10 or below.`
    );
  }
}
