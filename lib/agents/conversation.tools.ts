import type { Anthropic } from "@anthropic-ai/sdk";
import type { AgentButton } from "@/lib/telegram";
import { collectPreferences } from "./preference";
import {
  saveListing,
  skipListing,
  getScorecard,
  getWhyContext,
  getFormattedPreferences,
  getFormattedSavedList,
  getComparisonData,
} from "@/lib/tools/listing-tools";
import { buildScorecardButtons } from "@/lib/tools/scorecard";
import { runEvaluationPipeline } from "@/lib/tools/evaluation-pipeline";
import { buildTools, executeCallAgent } from "@/lib/core/tools";
import { dbRead, dbWrite } from "@/lib/core/tools/db";
import type { ToolResult } from "@/lib/core/agent";

export const CONVERSATION_TOOL_SCHEMAS: Anthropic.Tool[] = [
  {
    name: "skip_listing",
    description: "Dismiss a property listing the user does not want to pursue.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: {
          type: "string",
          description: "UUID of the listing to dismiss",
        },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "save_listing",
    description: "Save or favourite a property listing for later consideration.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: {
          type: "string",
          description: "UUID of the listing to save",
        },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "show_property_scorecard",
    description:
      "Re-display a property's evaluation scorecard with action buttons.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "UUID of the listing" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "evaluate_listing",
    description:
      "Re-run the full evaluation pipeline for a listing (property, area, commute, finance). Use when the user asks to re-evaluate or refresh scores.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: {
          type: "string",
          description: "UUID of the listing to re-evaluate",
        },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "show_saved_properties",
    description: "List all properties the user has saved or shortlisted.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "show_preferences",
    description: "Display the user's current search preferences.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "get_property_evaluation",
    description:
      "Fetch a property's full evaluation data so you can explain the scores to the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id: { type: "string", description: "UUID of the listing" },
      },
      required: ["listing_id"],
    },
  },
  {
    name: "get_comparison_data",
    description:
      "Fetch evaluation data for two properties so you can produce a head-to-head comparison.",
    input_schema: {
      type: "object" as const,
      properties: {
        listing_id_a: { type: "string", description: "First listing UUID" },
        listing_id_b: { type: "string", description: "Second listing UUID" },
      },
      required: ["listing_id_a", "listing_id_b"],
    },
  },
  {
    name: "update_preferences",
    description:
      "Trigger the preference update flow when the user wants to change their search criteria.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

export function buildConversationTools(): Anthropic.Tool[] {
  return [...buildTools(["call_agent", "db"]), ...CONVERSATION_TOOL_SCHEMAS];
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

  if (toolName === "db_read") {
    const filters =
      typeof toolInput.filters === "object"
        ? (toolInput.filters as Record<string, unknown>)
        : toolInput.filters
          ? JSON.parse(String(toolInput.filters))
          : undefined;
    const result = await dbRead(
      String(toolInput.table),
      filters,
      toolInput.limit ? Number(toolInput.limit) : 100,
    );
    const data = result.ok ? JSON.stringify(result.data) : result.error;
    return { type: "data", data, toolName };
  }

  if (toolName === "db_write") {
    const data =
      typeof toolInput.data === "object"
        ? (toolInput.data as Record<string, unknown>)
        : JSON.parse(String(toolInput.data));
    const filters =
      typeof toolInput.filters === "object"
        ? (toolInput.filters as Record<string, unknown>)
        : toolInput.filters
          ? JSON.parse(String(toolInput.filters))
          : undefined;
    const result = await dbWrite(
      String(toolInput.table),
      toolInput.operation as "insert" | "upsert" | "update",
      data,
      filters,
    );
    const outData = result.ok ? JSON.stringify(result.data ?? "ok") : result.error;
    return { type: "data", data: outData, toolName };
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
