create table agent_context (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  agent_id text not null,
  scope text not null,
  scope_value text,
  content jsonb not null,
  expires_at timestamptz,
  unique(agent_id, scope, scope_value)
);

create index idx_agent_context_lookup on agent_context (agent_id, scope, scope_value);;
