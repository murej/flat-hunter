import { sendMessage } from "@/lib/telegram";

export async function sendError(
  message: string = "Something went wrong. Please try again.",
): Promise<void> {
  await sendMessage(message);
}
