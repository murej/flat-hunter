import type { Anthropic } from "@anthropic-ai/sdk";
import type { AgentButton } from "@/lib/telegram";
import { collectPreferences } from "@/lib/agents/preference";
import {
  saveListing,
  skipListing,
  getScorecard,
  getWhyContext,
  getFormattedPreferences,
  getFormattedSavedList,
  getComparisonData,
} from "@/lib/tools/listing";
import { buildScorecardButtons } from "@/lib/tools/scorecard";
import { runEvaluationPipeline } from "@/lib/tools/evaluation-pipeline";
import {
  getReEvalCooldownHours,
  isConversationCallAgentEnabled,
  isConversationReEvaluationAllowed,
} from "@/lib/config/conversation-llm";
import { supabaseAdmin } from "@/lib/supabase";
import { buildTools, executeCallAgent } from "@/lib/core/tools";
import type { ToolResult } from "@/lib/core/agent";

export const CONVERSATION_TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: "skip_listing",
    description: "Dismiss listing.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: {
          type: "string",
          description: "Listing UUID",
        },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "save_listing",
    description: "Save listing to shortlist.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: {
          type: "string",
          description: "Listing UUID",
        },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "show_property_scorecard",
    description: "Show scorecard + buttons for a listing.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "Listing UUID" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "evaluate_listing",
    description: "Re-run full evaluation (property, area, commute, finance).",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: {
          type: "string",
          description: "Listing UUID",
        },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "show_saved_properties",
    description: "List saved properties.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "show_preferences",
    description: "Show current search preferences.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_property_evaluation",
    description: "Load evaluation JSON for “why” explanations.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "Listing UUID" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "get_comparison_data",
    description: "Load two listings’ evaluations for comparison.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id_a: { type: "string", description: "Listing UUID" },
        listing_id_b: { type: "string", description: "Listing UUID" },
      },
      required: ["listing_id_a", "listing_id_b"],
    },
  },
  {
    name: "update_preferences",
    description: "Start preference update flow.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

export function buildConversationTools(): Anthropic.Tool[] {
  const callAgentPart = isConversationCallAgentEnabled()
    ? buildTools(["call_agent"])
    : [];
  const schemas = CONVERSATION_TOOL_SCHEMAS.filter(
    (t) => t.name !== "evaluate_listing" || isConversationReEvaluationAllowed(),
  );
  return [...callAgentPart, ...schemas];
}

type InternalDirectResult = {
  type: "direct";
  message: string;
  listingId?: string | null;
  intent?: string | null;
  scorecard?: boolean;
  saved?: boolean;
  savedListings?: Array<{ id: string }>;
  buttons?: AgentButton[][];
};

type InternalDataResult = {
  type: "data";
  data: string;
  toolName: string;
};

type InternalToolResult = InternalDirectResult | InternalDataResult;

export type ConversationToolContext = {
  activeListingId: string | null;
  preferences: Record<string, unknown>;
  userMessage: string;
  messageId: string;
};

async function reEvalCooldownMessage(
  listingId: string,
): Promise<string | null> {
  const hours = getReEvalCooldownHours();
  if (hours <= 0) return null;

  const { data } = await supabaseAdmin
    .from("evaluations")
    .select("created_at")
    .eq("listing_id", listingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.created_at) return null;

  const last = new Date(data.created_at as string).getTime();
  const elapsedHr = (Date.now() - last) / (3600 * 1000);
  if (elapsedHr >= hours) return null;

  const remaining = Math.max(1, Math.ceil(hours - elapsedHr));
  return `This property was evaluated recently — please wait about ${remaining} more hour(s) before running a full re-evaluation.`;
}

async function executeToolInternal(
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: ConversationToolContext,
): Promise<InternalToolResult> {
  const listingId = (toolInput.listing_id as string) ?? ctx.activeListingId;

  if (toolName === "call_agent") {
    const data = await executeCallAgent(
      String(toolInput.agent),
      String(toolInput.prompt),
    );
    return { type: "data", data, toolName };
  }

  switch (toolName) {
    case "skip_listing": {
      if (!listingId) {
        return {
          type: "direct",
          message: "Which property would you like to skip?",
        };
      }
      await skipListing(listingId);
      return {
        type: "direct",
        message: "Done — property dismissed. 👋",
        listingId,
        intent: "skip",
      };
    }

    case "save_listing": {
      if (!listingId) {
        return {
          type: "direct",
          message: "Which property would you like to save?",
        };
      }
      await saveListing(listingId);
      return {
        type: "direct",
        message: "Saved! ⭐️ I'll keep that one for you.",
        listingId,
        intent: "save",
      };
    }

    case "evaluate_listing": {
      if (!listingId) {
        return {
          type: "direct",
          message:
            "Which property would you like to re-evaluate? Tap a scorecard button or mention the property.",
        };
      }
      const cooldownMsg = await reEvalCooldownMessage(listingId);
      if (cooldownMsg) {
        return {
          type: "direct",
          message: cooldownMsg,
          listingId,
          intent: "other",
        };
      }
      try {
        const result = await runEvaluationPipeline(listingId);
        const buttons = buildScorecardButtons(
          result.listing.id,
          result.listing.status === "saved",
        );
        return {
          type: "direct",
          message: result.scorecardText,
          listingId: result.listing.id,
          intent: "other",
          scorecard: true,
          saved: result.listing.status === "saved",
          buttons,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { type: "data", data: `Evaluation failed: ${msg}`, toolName };
      }
    }

    case "show_property_scorecard": {
      if (!listingId) {
        return {
          type: "direct",
          message:
            "Which property would you like to see? Tap a scorecard button or mention the property.",
        };
      }
      const scorecardResult = await getScorecard(listingId);
      if (!scorecardResult.ok) {
        return { type: "direct", message: scorecardResult.message };
      }
      return {
        type: "direct",
        message: scorecardResult.scorecardText,
        listingId: scorecardResult.listingId,
        intent: "other",
        scorecard: true,
        saved: scorecardResult.buttons[0]?.some((b) =>
          b.callback_data.startsWith("unsave:"),
        ),
        buttons: scorecardResult.buttons,
      };
    }

    case "show_saved_properties": {
      const savedResult = await getFormattedSavedList();
      if (!savedResult.ok) {
        return { type: "direct", message: savedResult.message };
      }
      return {
        type: "direct",
        message: savedResult.message,
        intent: "other",
        savedListings: savedResult.savedListings.map((l) => ({ id: l.id })),
      };
    }

    case "show_preferences": {
      const prefsResult = await getFormattedPreferences();
      if (!prefsResult.ok) {
        return { type: "direct", message: "No preferences set." };
      }
      return {
        type: "direct",
        message: prefsResult.message,
        intent: "preferences",
        buttons: prefsResult.buttons,
      };
    }

    case "get_property_evaluation": {
      if (!listingId) {
        return {
          type: "data",
          data: "No listing ID found. Ask the user which property they mean.",
          toolName,
        };
      }
      const whyResult = await getWhyContext(listingId);
      if (!whyResult.ok) {
        return { type: "data", data: whyResult.error, toolName };
      }
      return { type: "data", data: whyResult.context, toolName };
    }

    case "get_comparison_data": {
      const idA = toolInput.listing_id_a as string;
      const idB = toolInput.listing_id_b as string;
      if (!idA || !idB) {
        return {
          type: "data",
          data: "Please mention the IDs of the two properties you'd like to compare.",
          toolName,
        };
      }
      const result = await getComparisonData(idA, idB);
      const data = result.ok ? result.data : result.message;
      return { type: "data", data, toolName };
    }

    case "update_preferences": {
      const result = await collectPreferences(ctx.userMessage, ctx.messageId);
      return { type: "direct", message: result.message, intent: "preferences" };
    }

    default:
      return { type: "data", data: `Unknown tool: ${toolName}`, toolName };
  }
}

export function createConversationExecuteTool(
  ctx: ConversationToolContext,
): (name: string, input: Record<string, unknown>) => Promise<ToolResult> {
  return async (
    name: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const toolInput = input as Record<string, unknown>;
    const result = await executeToolInternal(name, toolInput, ctx);
    if (result.type === "direct") {
      let buttons: AgentButton[][] | undefined;
      if (result.buttons && result.buttons.length > 0) {
        buttons = result.buttons;
      } else if (result.scorecard && result.listingId) {
        const saveButton = result.saved
          ? { text: "🗑 Unsave", callback_data: `unsave:${result.listingId}` }
          : { text: "💾 Save", callback_data: `save:${result.listingId}` };
        const scorecardButtons = [
          saveButton,
          ...(result.saved
            ? []
            : [{ text: "⏭ Skip", callback_data: `skip:${result.listingId}` }]),
          { text: "❓ Why?", callback_data: `why:${result.listingId}` },
        ];
        buttons = [scorecardButtons];
      } else if (result.savedListings && result.savedListings.length > 0) {
        buttons = result.savedListings.map((l, i) => [
          { text: `📋 ${i + 1}`, callback_data: `scorecard:${l.id}` },
        ]);
      }
      return {
        type: "direct",
        message: result.message,
        metadata: { listingId: result.listingId, intent: result.intent },
        buttons,
      };
    }
    return result;
  };
}
