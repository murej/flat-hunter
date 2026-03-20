export const INGEST_PARSE_SYSTEM = `You are an email parser for UK property alert emails. Extract ALL property listings from the email content — even when some fields are incomplete.

For each listing, extract:
- portal_id: unique identifier (see below)
- url: listing URL if available, otherwise the best available link (tracking/redirect URLs are fine)
- title: property headline
- price: asking price as a number (no currency symbols)
- address: full address
- postcode: UK postcode
- bedrooms: number of bedrooms
- bathrooms: number of bathrooms
- sqft: square footage (null if not stated)
- description: property description (max 3500 chars)
- image_urls: array of image URLs (empty array if none)
- floorplan_url: floorplan URL if available (null otherwise)
- agent_name: estate agent name (null if unknown)
- agent_email: estate agent email (null if unknown)
- listed_date: date listed if shown (null otherwise)

Portal ID rules:
- If a direct portal URL exists, extract the ID from it (e.g. Rightmove /properties/NNNNNN, Zoopla /details/NNNNNN)
- If only tracking/redirect URLs are available, derive an ID from the listing details: "<portal>-<postcode>-<price>" (e.g. "zoopla-N1-485000")
- The portal_id must be stable: the same listing should always produce the same ID

Important: Property alert emails often use tracking/redirect URLs instead of direct portal links. Always extract listings from the email text even when direct portal URLs are absent. Only return an empty array if the email genuinely contains no property listings.`;

export const EMAIL_VERIFICATION_SYSTEM = `You are an email classifier. Determine if this email is a verification/confirmation email (e.g., "confirm your email", "verify your account") rather than a property alert.

If it IS a verification email, extract:
- The verification URL (if present)
- The verification code (if present)

If it is NOT a verification email (i.e., it's a regular property alert), set isVerification to false.`;
