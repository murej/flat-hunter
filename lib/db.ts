import { getSupabase } from "./supabase";

export type SavedSearch = {
  id: number;
  name: string;
  url: string;
  created_at: string;
};

export type CachedResult = {
  id: number;
  search_id: number;
  results_json: unknown;
  scraped_at: string;
};

export type Favourite = {
  id: number;
  property_url: string;
  snapshot_json: unknown;
  created_at: string;
};

export async function listSavedSearches(): Promise<SavedSearch[]> {
  const { data, error } = await getSupabase()
    .from("saved_searches")
    .select("id, name, url, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedSearch[];
}

export async function createSavedSearch(
  name: string,
  url: string
): Promise<SavedSearch> {
  const { data, error } = await getSupabase()
    .from("saved_searches")
    .insert({ name, url })
    .select("id, name, url, created_at")
    .single();
  if (error) throw error;
  return data as SavedSearch;
}

export async function deleteSavedSearch(id: number): Promise<void> {
  const { error } = await getSupabase()
    .from("saved_searches")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function getCachedResults(
  searchId: number
): Promise<unknown | null> {
  const { data, error } = await getSupabase()
    .from("cached_results")
    .select("results_json")
    .eq("search_id", searchId)
    .order("scraped_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { results_json: unknown } | null)?.results_json ?? null;
}

export async function setCachedResults(
  searchId: number,
  resultsJson: unknown
): Promise<void> {
  const { error } = await getSupabase().from("cached_results").upsert(
    {
      search_id: searchId,
      results_json: resultsJson,
      scraped_at: new Date().toISOString(),
    },
    { onConflict: "search_id" }
  );
  if (error) throw error;
}

export async function listFavourites(): Promise<Favourite[]> {
  const { data, error } = await getSupabase()
    .from("favourites")
    .select("id, property_url, snapshot_json, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Favourite[];
}

export async function addFavourite(
  propertyUrl: string,
  snapshot: unknown
): Promise<Favourite> {
  const { data, error } = await getSupabase()
    .from("favourites")
    .upsert(
      { property_url: propertyUrl, snapshot_json: snapshot },
      { onConflict: "property_url" }
    )
    .select("id, property_url, snapshot_json, created_at")
    .single();
  if (error) throw error;
  return data as Favourite;
}

export async function removeFavourite(id: number): Promise<void> {
  const { error } = await getSupabase().from("favourites").delete().eq("id", id);
  if (error) throw error;
}

export async function removeFavouriteByUrl(propertyUrl: string): Promise<void> {
  const { error } = await getSupabase()
    .from("favourites")
    .delete()
    .eq("property_url", propertyUrl);
  if (error) throw error;
}
