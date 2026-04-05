import { parseReaction } from "@/lib/telegram";
import { getListingByMessageId, updateListingStatus } from "@/lib/supabase";
import { saveListing } from "@/lib/tools/listing";
import { reportError } from "@/lib/core/reporting";
import { sendReactionListingSavedAck } from "@/lib/telegram/llm-outbound";

/**
 * If the webhook body is a message_reaction update, apply save/unsave and return true
 * (caller should respond 200 without running the chat handler).
 */
export async function tryHandleMessageReaction(
  body: Record<string, unknown>,
): Promise<boolean> {
  const reaction = parseReaction(body);
  if (!reaction) return false;

  const listingId = await getListingByMessageId(reaction.messageId);
  if (listingId) {
    if (reaction.added) {
      await saveListing(listingId);
      try {
        await sendReactionListingSavedAck(listingId, reaction.messageId);
      } catch (err) {
        await reportError(err, { source: "api/telegram/reaction_save_ack" });
      }
    } else {
      await updateListingStatus(listingId, "evaluated");
    }
  }

  return true;
}
