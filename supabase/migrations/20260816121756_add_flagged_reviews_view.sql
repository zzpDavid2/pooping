-- 被举报评论的审核视图。
--
-- CLAUDE.md 明确不做管理后台（第 2 节）——处理举报靠 Supabase Studio 自带的
-- Table Editor，这个视图只是把 reports + reviews + toilets 拼在一起，
-- 省得在 Studio 里对着一堆 UUID 手动对照"这条举报说的是哪条评论"。
--
-- 只给 Studio/service_role 用，前端永远不会调它——所以要把 anon/authenticated
-- 的读权限撤掉，不然 PostgREST 会把它当成普通表，通过 /rest/v1/flagged_reviews
-- 把举报理由、举报人这些不该公开的信息暴露给任何人。

create or replace view flagged_reviews as
select
  rev.id as review_id,
  rev.toilet_id,
  t.name as toilet_name,
  rev.ai_text,
  rev.raw_note,
  rev.is_ai,
  rev.user_id as review_author_id,
  rev.created_at as review_created_at,
  count(rep.id) as report_count,
  array_agg(distinct rep.reason) as reasons,
  array_agg(rep.note) filter (where rep.note is not null) as notes,
  max(rep.created_at) as last_reported_at
from reports rep
join reviews rev on rev.id = rep.review_id
join toilets t on t.id = rev.toilet_id
group by rev.id, rev.toilet_id, t.name, rev.ai_text, rev.raw_note, rev.is_ai, rev.user_id, rev.created_at
order by max(rep.created_at) desc;

revoke all on flagged_reviews from public, anon, authenticated;
