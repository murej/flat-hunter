import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import { supabaseAdmin, getListing, logConversation, updateListingStatus } from "@/lib/supabase";
import { VIEWING_EMAIL_SYSTEM } from "@/lib/prompts";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  return new Resend(process.env.RESEND_API_KEY);
}

export const requestViewing = {
  async draftEmail(listingId: string): Promise<string> {
    const listing = await getListing(listingId);

    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: VIEWING_EMAIL_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Write a viewing request email for:\nProperty: ${listing.title}\nAddress: ${listing.address}\nAgent: ${listing.agent_name}\nURL: ${listing.url}`,
        },
      ],
    });

    return response.content[0].type === "text" ? response.content[0].text : "";
  },

  async sendEmail(listingId: string): Promise<void> {
    const listing = await getListing(listingId);
    const draft = await this.draftEmail(listingId);
    await this.sendEmailBody(listingId, draft);
  },

  async sendEmailBody(listingId: string, body: string): Promise<void> {
    const listing = await getListing(listingId);

    if (!listing.agent_email) {
      throw new Error("No agent email address for this listing");
    }

    await getResend().emails.send({
      from: "Flat Hunter <noreply@yourdomain.com>",
      to: listing.agent_email,
      subject: `Viewing Request: ${listing.title}`,
      text: body,
    });

    await updateListingStatus(listingId, "viewing_requested");

    await logConversation({
      direction: "outbound",
      message: `Viewing request email sent to ${listing.agent_email}:\n\n${body}`,
      listing_id: listingId,
      intent: "view",
    });
  },
};
