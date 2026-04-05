create table message_preference_sections (
  telegram_message_id bigint primary key,
  section_key         text not null,
  created_at          timestamptz default now()
);
