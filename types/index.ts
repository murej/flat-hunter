export type ScoreWeights = {
  fit?: number;
  commute?: number;
  price?: number;
  size?: number;
  area?: number;
};

export interface Preferences {
  id: string;
  created_at: string;
  updated_at: string;
  areas: string[];
  max_price: number;
  min_bedrooms: number;
  must_haves: string[];
  deal_breakers: string[];
  commute_anchor: string;
  commute_anchor_postcode: string;
  max_commute_minutes: number;
  style_notes: string;
  freeform_notes: string;
  deposit: number;
  area_preferences?: string[];
  raw_json: Record<string, unknown>;
}

export interface Listing {
  id: string;
  created_at: string;
  portal_id: string;
  url: string;
  title: string;
  price: number;
  address: string;
  postcode: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  description: string;
  image_urls: string[];
  floorplan_url: string;
  agent_name: string;
  agent_email: string;
  listed_date: string;
  status:
    | "pending_evaluation"
    | "evaluated"
    | "saved"
    | "dismissed"
    | "viewing_requested";
  raw_email_html: string;
}

export interface Evaluation {
  id: string;
  listing_id: string;
  created_at: string;
  price_score: number;
  size_score: number;
  fit_score: number;
  area_score: number;
  commute_score: number;
  overall_score: number;
  deal_breaker_flags: string[];
  commute_minutes: number;
  commute_route: string;
  monthly_mortgage: number;
  monthly_interest_only: number;
  stamp_duty: number;
  estimated_monthly_total: number;
  property_summary: string;
  area_summary: string;
  raw_property_eval: Record<string, unknown>;
  raw_area_eval: Record<string, unknown>;
  raw_finance_eval: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  created_at: string;
  telegram_message_id: string;
  direction: "inbound" | "outbound";
  message: string;
  listing_id: string | null;
  intent:
    | "view"
    | "skip"
    | "save"
    | "why"
    | "preferences"
    | "compare"
    | "other"
    | null;
}

export interface TelegramMessage {
  text: string;
  messageId: string;
  callbackQueryId?: string;
}

export interface PropertyEvalResult {
  price_score: number;
  size_score: number;
  fit_score: number;
  property_unknown?: boolean;
  deal_breaker_flags: string[];
  property_summary: string;
  raw: Record<string, unknown>;
}

export interface AreaEvalResult {
  area_score: number;
  area_summary: string;
  area_unknown?: boolean;
  notable_flags: string[];
  raw: Record<string, unknown>;
}

export interface CombinedEvalResult extends PropertyEvalResult, AreaEvalResult {}

export interface CommuteEvalResult {
  commute_minutes: number;
  commute_route: string;
  commute_score: number;
  commute_unknown?: boolean;
}

export interface FinanceEvalResult {
  monthly_mortgage: number;
  monthly_interest_only: number;
  stamp_duty: number;
  estimated_monthly_total: number;
  raw: Record<string, unknown>;
}
