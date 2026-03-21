export const AREA_EVALUATION_CONTEXT = `When evaluating an area, consider:
- Crime statistics: types, frequency, trends relative to London averages
- Index of Multiple Deprivation (IMD): overall rank, income, employment, education, health, crime, housing, living environment
- Local character: gentrification, community feel, green spaces, high street quality
- Schools and amenities: if relevant to the buyer's profile
- Development: planned regeneration, new builds, infrastructure projects
- Safety perception: day vs night, well-lit streets, busy vs quiet

Do NOT factor in commute time or transport connectivity for getting to work — that is scored separately by a dedicated Commute score.`;

export const AREA_PROFILE_PROMPT = (area: string) =>
  `Build a comprehensive area profile for ${area}, London. Use the database to check for existing context, and any available data to assess:
1. General character and reputation
2. Crime and safety
3. Deprivation indices
4. Local amenities and green spaces
5. Recent trends (gentrification, price growth, development)

Store your findings in agent_context for future reference.`;
