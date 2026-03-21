import { z } from "zod";

export const PropertyEvalSchema = z.object({
  price_score: z
    .number()
    .describe("Price value score 1-10 (10 = great value)"),
  size_score: z
    .number()
    .describe("Size/space score 1-10 (10 = very spacious for price)"),
  fit_score: z
    .number()
    .describe("Overall fit against must-haves and preferences 1-10"),
  deal_breaker_flags: z
    .array(z.string())
    .describe("List of deal-breaker preferences that this property violates"),
  property_summary: z
    .string()
    .describe(
      "One short punchy sentence — the headline verdict on this property",
    ),
});

export const AreaEvalSchema = z.object({
  area_score: z
    .number()
    .describe("Area desirability score 1-10"),
  area_summary: z
    .string()
    .describe("One short punchy sentence — the headline verdict on this area"),
  notable_flags: z
    .array(z.string())
    .describe("Notable area concerns or highlights"),
});

export const VerificationResultSchema = z.object({
  isVerification: z
    .boolean()
    .describe("True if this is a verification/confirmation email, not a property alert"),
  verificationUrl: z
    .string()
    .optional()
    .describe("The verification URL if found"),
  verificationCode: z
    .string()
    .optional()
    .describe("The verification code if found"),
});

export const ListingSchema = z.object({
  portal_id: z.string().describe("Unique portal identifier for the listing"),
  url: z.string().describe("Full URL to the listing page"),
  title: z.string().describe("Property title/headline"),
  price: z.number().describe("Asking price in GBP"),
  address: z.string().describe("Full property address"),
  postcode: z.string().describe("UK postcode"),
  bedrooms: z.number().describe("Number of bedrooms"),
  bathrooms: z.number().describe("Number of bathrooms"),
  sqft: z.number().nullable().describe("Square footage if available"),
  description: z.string().describe("Property description (max 3500 chars)"),
  image_urls: z.array(z.string()).describe("Property image URLs"),
  floorplan_url: z.string().nullable().describe("Floorplan URL if available"),
  agent_name: z.string().nullable().describe("Estate agent name"),
  agent_email: z.string().nullable().describe("Estate agent email"),
  listed_date: z.string().nullable().describe("Date listed if available"),
});

export type PropertyEvalOutput = z.infer<typeof PropertyEvalSchema>;
export type AreaEvalOutput = z.infer<typeof AreaEvalSchema>;
export type VerificationResultOutput = z.infer<typeof VerificationResultSchema>;
export type ListingOutput = z.infer<typeof ListingSchema>;
