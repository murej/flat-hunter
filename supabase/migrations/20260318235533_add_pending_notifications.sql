create table pending_notifications (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  sequence int not null,
  type text not null check (type in ('intro', 'scorecard', 'summary')),
  payload jsonb not null,
  created_at timestamptz default now(),
  consumed_at timestamptz
);

create index idx_pending_notifications_unconsumed
  on pending_notifications (batch_id, sequence)
  where consumed_at is null;;
