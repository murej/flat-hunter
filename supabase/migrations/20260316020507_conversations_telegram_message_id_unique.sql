CREATE UNIQUE INDEX conversations_telegram_message_id_unique ON conversations (telegram_message_id) WHERE telegram_message_id IS NOT NULL;;
