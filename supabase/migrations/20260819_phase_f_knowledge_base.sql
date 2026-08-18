-- ============================================================================
-- PHASE F — coaching-notes knowledge base. Additive only. Does not touch
-- 20260818_strength_rebuild.sql, 20260819_phase_e_pain_metric.sql, or
-- anything else. See docs/superpowers/specs/2026-08-17-adaptive-engine-v2-
-- design.md, Phase F (Slices 34, 36-39 — Slice 35's authoring UI is a
-- separate, later, UI-track build).
-- ============================================================================

create extension if not exists vector;

create table coaching_note (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  body        text not null,
  tags        text[] not null default '{}',
  embedding   vector(1024),
  created_at  timestamptz not null default now()
);

create index coaching_note_embedding_idx on coaching_note
  using hnsw (embedding vector_cosine_ops);

-- Slice 37: cosine-distance retrieval. top-5 default is chosen to fit
-- comfortably inside a decision call's context without needing tuning
-- infrastructure; revisit only if real usage data shows retrieval quality,
-- not count, is the bottleneck.
create function search_coaching_notes(query_embedding vector(1024), match_count int default 5)
returns setof coaching_note language sql stable as $$
  select * from coaching_note
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
