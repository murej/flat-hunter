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
  UPDATE_PREFERENCES_BUTTONS,
} from "@/lib/tools/listing";
import { supabaseAdmin } from "@/lib/supabase";
import type { ToolResult } from "@/lib/core/types";
import type { TelegramPayload } from "@/types";

export function buildConversationTools(activeListingId: string | null) {
  let captured: ToolResult | null = null;

  const coreTools = buildTools(
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
        return text;
      },
    }),

    show_saved_properties: tool({
      description: "Show saved/shortlisted properties. ONLY call when the user explicitly asks to see their saved list.",
      inputSchema: z.object({}),
      execute: async () => {
        const text = await getFormattedSavedList();
        captured = { type: "direct", message: text, payload: { parse_mode: "Markdown" } as TelegramPayload };
        return text;
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
      description: "Show the full scorecard for a property",
      inputSchema: z.object({
        listing_id: z.string().describe("The listing ID"),
      }),
      execute: async ({ listing_id }) => {
        const scorecard = await getScorecard(listing_id);
        if (!scorecard) return "Listing not found.";
        captured = {
          type: "direct",
          message: scorecard.text,
          payload: { buttons: scorecard.buttons, parse_mode: "Markdown" } as TelegramPayload,
        };
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
        const { data: existing } = await supabaseAdmin
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
        await supabaseAdmin
          .from("listings")
          .update({ status: "pending_evaluation", updated_at: new Date().toISOString() })
          .eq("id", listing_id);

        captured = { type: "direct", message: "Re-evaluation queued. The cron job will pick it up within 5 minutes." };
        return "Re-evaluation queued.";
      },
    }),

    get_property_evaluation: tool({
      description: "Get evaluation data for a property to explain scores (triggers Why explanation chain)",
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
        return "Preference update initiated.";
      },
    }),
  };

  return {
    tools: { ...coreTools, ...domainTools },
    getCaptured: () => captured,
  };
}
