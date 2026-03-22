/** True when the user is clearly asking for a prose "why" explanation, not just to view a listing. */
export function userWantsExplicitWhyExplanation(text: string): boolean {
  const t = text.trim();
  if (/\bwhy\b/i.test(t)) return true;
  if (/\b(breakdown|break down)\b/i.test(t)) return true;
  if (/\bexplain\b/i.test(t) && /\b(scores?|ratings?|rating)\b/i.test(t)) return true;
  if (/\bhow\b/i.test(t) && /\b(scores?|scored|rating|rated)\b/i.test(t)) return true;
  return false;
}

/** Count / inventory questions (not score explanations). */
export function userAsksHowManyListings(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!/\bhow many\b/.test(t)) return false;
  return (
    /\b(listings?|properties?|flats?|homes?|places)\b/.test(t) ||
    /\b(do you have|are there|in total|we have)\b/.test(t)
  );
}

export function userLikelyWantsPropertyScorecardView(text: string): boolean {
  const t = text.trim();
  if (/\b(how many|how much)\b/i.test(t)) return false;
  if (/\b(update|change|edit)\b.*\bpreferences?\b/i.test(t)) return false;
  if (/\bcompare\b/i.test(t) && /\b(properties|listings|flats)\b/i.test(t)) return false;

  if (/\b(show|see|view|open|display|pull up)\b/i.test(t)) return true;
  if (/\b(newest|oldest|latest|earliest|cheapest|priciest|most expensive)\b/i.test(t))
    return true;
  if (/\bscorecard\b/i.test(t)) return true;
  if (/\b(find|look up|search for)\b/i.test(t) && /\b(property|flat|listing|place)\b/i.test(t))
    return true;
  return false;
}

/**
 * User is asking for a listing other than the session “active” anchor — omit active ID from the prompt
 * so the model uses find_listings/db instead of reusing the previous scorecard’s UUID.
 */
export function userTargetsADifferentListingThanActive(text: string): boolean {
  const t = text.trim();
  if (/\b(newest|oldest|latest|earliest|cheapest|priciest|most expensive)\b/i.test(t))
    return true;
  if (
    /\b(another|a different|different|other)\b/i.test(t) &&
    /\b(listing|property|flat|place|one)\b/i.test(t)
  )
    return true;
  if (
    /\b(next|previous)\b/i.test(t) &&
    /\b(listing|property|flat|one)\b/i.test(t)
  )
    return true;
  if (/\bcompare\b/i.test(t)) return true;
  if (userAsksHowManyListings(t)) return true;
  if (/[A-Z]{1,2}\d[A-Z0-9]?\s*\d[A-Z]{2}/i.test(t)) return true;
  if (
    /\b(show|see|view|find|open|give)\b/i.test(t) &&
    /\b(in|near|around)\s+[a-z]/i.test(t)
  )
    return true;
  return false;
}

export function userAsksForSavedOrShortlistList(text: string): boolean {
  return (
    /\b(saved|shortlist|shortlisted|liked|favourites|favorites)\b/i.test(text) ||
    /\/liked\b/i.test(text)
  );
}

export function userAsksToShowPreferences(text: string): boolean {
  const t = text.trim();
  if (/^\/preferences$/i.test(t)) return true;
  return (
    /\b(show|what are|see)\b/i.test(t) &&
    /\b(preferences?|prefs?|search criteria|my criteria)\b/i.test(t)
  );
}

export function listingIdFromWhyToolPayload(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const listing = (data as { listing?: { id?: unknown } }).listing;
  const id = listing?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}
