-- Introspect public columns for allowlisted db_read tables (service_role only).

CREATE OR REPLACE FUNCTION public.get_db_read_schema_subset(p_tables text[])
RETURNS TABLE(
  table_name text,
  column_name text,
  data_type text,
  is_nullable text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.table_name::text,
    c.column_name::text,
    c.data_type::text,
    c.is_nullable::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = ANY(p_tables)
  ORDER BY c.table_name, c.ordinal_position;
$$;
REVOKE ALL ON FUNCTION public.get_db_read_schema_subset(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_db_read_schema_subset(text[]) TO service_role;
