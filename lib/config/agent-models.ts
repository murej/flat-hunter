import { envModel } from "@/lib/utils/env-utils";

const DEFAULT = "claude-haiku-4-5";

export const getPropertyExpertModel = () =>
  envModel("PROPERTY_EXPERT_MODEL", DEFAULT);

export const getAreaExpertModel = () =>
  envModel("AREA_EXPERT_MODEL", DEFAULT);

export const getConversationModel = () =>
  envModel("CONVERSATION_MODEL", DEFAULT);

export const getWhyExplanationModel = () =>
  envModel("WHY_EXPLANATION_MODEL", DEFAULT);

export const getPreferenceCollectorModel = () =>
  envModel("PREFERENCE_COLLECTOR_MODEL", DEFAULT);

export const getIngestParseModel = () =>
  envModel("INGEST_PARSE_MODEL", DEFAULT);

export const getEmailVerificationModel = () =>
  envModel("EMAIL_VERIFICATION_MODEL", DEFAULT);

export const getAreaProfileModel = () =>
  envModel("AREA_PROFILE_MODEL", DEFAULT);
