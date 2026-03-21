export type Preferences = {
  id: number;
  areas: string[];
  max_price: number;
  deposit: number;
  min_bedrooms: number;
  commute_anchor: string;
  commute_postcode: string;
  commute_max_minutes: number;
  must_haves: string[];
  deal_breakers: string[];
  style_notes: string | null;
  freeform_notes: string | null;
  area_preferences: string[];
  score_weights: ScoreWeights | null;
  raw_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ListingStatus =
  | "pending_evaluation"
  | "evaluating"
  | "evaluated"
  | "saved"
  | "dismissed"
  | "viewing_requested";

export type Listing = {
  id: string;
  portal_id: string;
  url: string;
  title: string;
  price: number;
  address: string;
  postcode: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  description: string;
  image_urls: string[];
  floorplan_url: string | null;
  agent_name: string | null;
  agent_email: string | null;
  listed_date: string | null;
  status: ListingStatus;
  raw_email_html: string | null;
  created_at: string;
  updated_at: string;
};

export type Evaluation = {
  id: string;
  listing_id: string;
  price_score: number | null;
  size_score: number | null;
  appeal_score: number | null;
  commute_score: number | null;
  area_score: number | null;
  overall_score: number;
  deal_breaker_flags: string[];
  commute_minutes: number | null;
  commute_route: string | null;
  mortgage_monthly: number | null;
  interest_only_monthly: number | null;
  stamp_duty: number | null;
  stress_test_monthly: number | null;
  total_monthly: number | null;
  property_summary: string;
  area_summary: string;
  raw_property_eval: Record<string, unknown> | null;
  raw_area_eval: Record<string, unknown> | null;
  property_unknown: string | null;
  area_unknown: string | null;
  created_at: string;
};

export type Conversation = {
  id: number;
  telegram_message_id: number;
  direction: "inbound" | "outbound";
  message: string;
  listing_id: string | number | null;
  intent: string | null;
  created_at: string;
};

export type ScoreWeights = {
  appeal?: number;
  /** Legacy JSON key; used if `appeal` is unset */
  fit?: number;
  commute?: number;
  price?: number;
  size?: number;
  area?: number;
};

export type PropertyEvalResult = {
  price_score: number | null;
  size_score: number | null;
  appeal_score: number | null;
  deal_breaker_flags: string[];
  property_summary: string;
  property_unknown?: string;
  raw: Record<string, unknown>;
};

export type AreaEvalResult = {
  area_score: number | null;
  area_summary: string;
  notable_flags: string[];
  area_unknown?: string;
  raw: Record<string, unknown>;
};

export type CommuteEvalResult = {
  commute_score: number | null;
  commute_minutes: number | null;
  commute_route: string | null;
};

export type FinanceEvalResult = {
  mortgage_monthly: number;
  interest_only_monthly: number;
  stamp_duty: number;
  stress_test_monthly: number;
  total_monthly: number;
};

export type TelegramPayload = {
  buttons?: Array<Array<{ text: string; callback_data: string }>>;
  parse_mode?: "Markdown" | "HTML";
  metadata?: Record<string, unknown>;
};
