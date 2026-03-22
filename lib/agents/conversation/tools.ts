import { tool } from "ai";
import { z } from "zod";
import { buildTools } from "@/lib/core/tools";
import { dbConfig } from "@/lib/config/db-config";
import { isCallAgentEnabled, isReEvaluationAllowed, RE_EVAL_COOLDOWN_HOURS } from "@/lib/config/conversation-llm";
import {
  saveListing,
  getScorecard,
  getWhyContext,
  getComparisonData,
  getFormattedSavedList,
  getFormattedPreferences,
  findListingsByQuery,
  formatFindListingsForTool,
  UPDATE_PREFERENCES_BUTTONS,
} from "@/lib/tools/listing";
import { truncateForToolResult } from "@/lib/utils/tool-result";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { DirectToolResult, ToolResult } from "@/lib/core/types";
import type { TelegramPayload } from "@/types";
import {
  userAsksForSavedOrShortlistList,
  userAsksToShowPreferences,
} from "./why-intent";
import type { ConversationMode } from "./conversation-router";

/** Domain tool names exposed per router mode (core db/call_agent added separately). */
const MODE_DOMAIN_KEYS: Record<ConversationMode, readonly string[]> = {
  general: [],
  browse: [
    "find_listings",
    "find_and_show_scorecard",
    "show_property_scorecard",
    "save_listing",
    "evaluate_listing",
  ],
  preferences: [
    "show_preferences",
    "show_saved_properties",
    "update_preferences",
  ],
  insight: ["get_property_evaluation", "get_comparison_data"],
};

function pickDomainTools<T extends Record<string, unknown>>(
  all: T,
  keys: readonly string[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (k in all) {
      (out as Record<string, unknown>)[k] = all[k as keyof T];
    }
  }
  return out;
}

export async function buildConversationTools(
  _activeListingId: string | null,
  inboundUserText: string | undefined,
  mode: ConversationMode,
) {
  let captured: ToolResult | null = null;
  /** If show_property_scorecard ran, keep it — async tool completion order can let get_property_evaluation overwrite `captured` last. */
  let scorecardDirectCapture: ToolResult | null = null;
  let updatePreferencesDirectCapture: DirectToolResult | null = null;
  let showSavedDirectCapture: DirectToolResult | null = null;
  let showPreferencesDirectCapture: DirectToolResult | null = null;
  /** Listing UUID last shown via scorecard tools (for outbound conversation logging). */
  let lastScorecardListingId: string | null = null;
  const inbound = inboundUserText ?? "";

  const coreTools = await buildTools(
    isCallAgentEnabled() ? ["db", "call_agent"] : ["db"],
    { db: dbConfig },
  );

  const domainTools = {
    show_preferences: tool({
      description: "Show the user's search preferences. ONLY call when the user explicitly asks to see their preferences (e.g. 'show my preferences', 'what are my preferences'). NEVER call on greetings, /start, or general conversation.",
      inputSchema: z.object({}),
      execute: async () => {
        const text = await getFormattedPreferences();
        captured = { type: "direct", message: text, payload: { parse_mode: "Markdown" } as TelegramPayload };
        showPreferencesDirectCapture = captured;
        return text;
      },
    }),

    show_saved_properties: tool({
      description: "Show saved/shortlisted properties. ONLY call when the user explicitly asks to see their saved list.",
      inputSchema: z.object({}),
      execute: async () => {
        const text = await getFormattedSavedList();
        captured = { type: "direct", message: text, payload: { parse_mode: "Markdown" } as TelegramPayload };
        showSavedDirectCapture = captured;
        return text;
      },
    }),

    find_listings: tool({
      description:
        "Search listings by keywords when the user refers to a property without a listing UUID (address fragment, area, postcode, portal reference, price in the title, etc.). Map the user's wording into a short keyword query. Use scope 'saved' only when they mean their saved/shortlisted properties.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Search keywords derived from the user's message (e.g. 'Clapham', 'SW11', 'Old Street')",
          ),
        scope: z
          .enum(["all", "saved"])
          .optional()
          .describe(
            "Use 'saved' for shortlisted listings only; use 'all' or omit to search every listing",
          ),
      }),
      execute: async ({ query, scope }) => {
        const result = await findListingsByQuery(query, {
          status: scope === "saved" ? "saved" : "any",
        });
        return truncateForToolResult(formatFindListingsForTool(result));
      },
    }),

    find_and_show_scorecard: tool({
      description:
        "Search listings by keywords; if exactly one property matches, show the full scorecard with action buttons (same UI as show_property_scorecard). If zero or multiple matches, returns the same text summary as find_listings—tell the user to narrow the search or pick an ID. Prefer this over find_listings when the user wants to open/view/show a specific property described by area, postcode, address fragment, etc., and you do not already have a listing UUID.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            "Search keywords derived from the user's message (e.g. 'Clapham', 'SW11', 'Old Street')",
          ),
        scope: z
          .enum(["all", "saved"])
          .optional()
          .describe(
            "Use 'saved' for shortlisted listings only; use 'all' or omit to search every listing",
          ),
      }),
      execute: async ({ query, scope }) => {
        const result = await findListingsByQuery(query, {
          status: scope === "saved" ? "saved" : "any",
        });
        if (result.totalAfterFilter === 1 && result.rows.length === 1) {
          const id = result.rows[0]!.id;
          const scorecard = await getScorecard(id);
          if (!scorecard) {
            return "One listing matched but a scorecard could not be built (missing evaluation?).";
          }
          lastScorecardListingId = id;
          const next: ToolResult = {
            type: "direct",
            message: scorecard.text,
            payload: { buttons: scorecard.buttons, parse_mode: "Markdown" } as TelegramPayload,
          };
          scorecardDirectCapture = next;
          captured = next;
          return scorecard.text;
        }
        return truncateForToolResult(formatFindListingsForTool(result));
      },
    }),

    save_listing: tool({
      description: "Save/shortlist a property listing",
      inputSchema: z.object({
        listing_id: z.string().describe("The listing ID to save"),
      }),
      execute: async ({ listing_id }) => {
        const msg = await saveListing(listing_id);
        captured = { type: "direct", message: msg };
        return msg;
      },
    }),

    show_property_scorecard: tool({
      description:
        "Show the full scorecard for a property (formatted summary with action buttons) when you have a listing UUID. If the user only described the property in words, use find_and_show_scorecard instead (unless you already resolved an ID). Not for verbal 'why' explanations — use get_property_evaluation only when they explicitly ask why scores are what they are.",
      inputSchema: z.object({
        listing_id: z.string().describe("The listing ID"),
      }),
      execute: async ({ listing_id }) => {
        const scorecard = await getScorecard(listing_id);
        if (!scorecard) return "Listing not found.";
        lastScorecardListingId = listing_id;
        const next: ToolResult = {
          type: "direct",
          message: scorecard.text,
          payload: { buttons: scorecard.buttons, parse_mode: "Markdown" } as TelegramPayload,
        };
        scorecardDirectCapture = next;
        captured = next;
        return scorecard.text;
      },
    }),

    evaluate_listing: tool({
      description: "Trigger re-evaluation of a listing (respects cooldown)",
      inputSchema: z.object({
        listing_id: z.string().describe("The listing ID to re-evaluate"),
      }),
      execute: async ({ listing_id }) => {
        if (!isReEvaluationAllowed()) {
          return "Re-evaluation is currently disabled.";
        }

        // Check cooldown
        const { data: existing } = await getSupabaseAdmin()
          .from("evaluations")
          .select("created_at")
          .eq("listing_id", listing_id)
          .single();

        if (existing) {
          const lastEval = new Date(existing.created_at).getTime();
          const cooldownMs = RE_EVAL_COOLDOWN_HOURS * 60 * 60 * 1000;
          if (Date.now() - lastEval < cooldownMs) {
            return `This listing was evaluated less than ${RE_EVAL_COOLDOWN_HOURS} hours ago. Please wait before re-evaluating.`;
          }
        }

        // Queue for re-evaluation
        await getSupabaseAdmin()
          .from("listings")
          .update({ status: "pending_evaluation", updated_at: new Date().toISOString() })
          .eq("id", listing_id);

        captured = { type: "direct", message: "Re-evaluation queued. The cron job will pick it up within 5 minutes." };
        return "Re-evaluation queued.";
      },
    }),

    get_property_evaluation: tool({
      description:
        "ONLY when the user explicitly asks why the property scored how it did, or wants a detailed explanation of the ratings — not for simply showing the listing or scorecard. Triggers a separate long prose 'why' reply, not the scorecard UI. If they want to see the property, use show_property_scorecard instead.",
      inputSchema: z.object({
        listing_id: z.string().describe("The listing ID"),
      }),
      execute: async ({ listing_id }) => {
        const context = await getWhyContext(listing_id);
        if (!context) return "Listing or evaluation not found.";
        captured = { type: "data", data: context, toolName: "get_property_evaluation" };
        return JSON.stringify(context);
      },
    }),

    get_comparison_data: tool({
      description: "Get data for comparing multiple properties",
      inputSchema: z.object({
        listing_ids: z.array(z.string()).describe("Array of listing IDs to compare"),
      }),
      execute: async ({ listing_ids }) => {
        const data = await getComparisonData(listing_ids);
        if (data.length === 0) return "No listings found.";
        captured = { type: "data", data, toolName: "get_comparison_data" };
        return JSON.stringify(data);
      },
    }),

    update_preferences: tool({
      description: "Start preference update flow",
      inputSchema: z.object({
        category: z.string().optional().describe("Specific category to update, or empty for full update"),
      }),
      execute: async ({ category }) => {
        captured = {
          type: "direct",
          message: category
            ? `Let's update your ${category} preferences. What would you like to change?`
            : "What preferences would you like to update?",
          payload: { buttons: UPDATE_PREFERENCES_BUTTONS, parse_mode: "Markdown" } as TelegramPayload,
        };
        updatePreferencesDirectCapture = captured;
        return "Preference update initiated.";
      },
    }),
  };

  const domainKeys = MODE_DOMAIN_KEYS[mode];
  const domainSubset = pickDomainTools(
    domainTools as Record<string, unknown>,
    domainKeys,
  ) as typeof domainTools;

  return {
    tools: { ...coreTools, ...domainSubset },
    getCaptured: () => {
      if (
        captured?.type === "data" &&
        captured.toolName === "get_property_evaluation"
      ) {
        if (updatePreferencesDirectCapture?.type === "direct") {
          return updatePreferencesDirectCapture;
        }
        if (
          showSavedDirectCapture?.type === "direct" &&
          inbound &&
          userAsksForSavedOrShortlistList(inbound)
        ) {
          return showSavedDirectCapture;
        }
        if (
          showPreferencesDirectCapture?.type === "direct" &&
          inbound &&
          userAsksToShowPreferences(inbound)
        ) {
          return showPreferencesDirectCapture;
        }
        if (scorecardDirectCapture?.type === "direct") {
          const p = scorecardDirectCapture.payload as TelegramPayload | undefined;
          if (p?.buttons?.length) {
            return scorecardDirectCapture;
          }
        }
      }
      return captured;
    },
    getLastScorecardListingId: () => lastScorecardListingId,
  };
}
