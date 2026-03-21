alter table saved_searches enable row level security;
alter table cached_results enable row level security;
alter table favourites enable row level security;

create policy "flat_hunter_saved_searches_all" on saved_searches for all using (true) with check (true);
create policy "flat_hunter_cached_results_all" on cached_results for all using (true) with check (true);
create policy "flat_hunter_favourites_all" on favourites for all using (true) with check (true);;
