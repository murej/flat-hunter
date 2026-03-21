create table if not exists public.mortgage_rates (
  id uuid primary key default gen_random_uuid(),
  effective_date date not null,
  rate_annual_percent numeric not null,
  source_series text not null,
  source_name text,
  fetched_at timestamptz not null default now(),
  note text,
  constraint mortgage_rates_effective_date_source_series_uniq unique (effective_date, source_series)
);

create index if not exists mortgage_rates_effective_date_idx
  on public.mortgage_rates (effective_date desc);
;
