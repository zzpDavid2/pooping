-- 允许用户不经 AI，直接自己写评价。
--
-- 结果是 reviews 里现在有两种来源，必须能分辨：
-- CLAUDE.md 10.2 要求「AI 内容必须标注」，反过来说，
-- **不是 AI 写的就绝不能挂 AI 标**，否则那个标识就没意义了。

alter table reviews
  add column if not exists is_ai boolean not null default true;

-- 自己写的没有文风可言，ai_style 不再强制
alter table reviews alter column ai_style drop not null;

comment on column reviews.ai_text is
  '展示用正文。AI 生成或用户手写，看 is_ai。列名沿用历史，不代表一定是 AI 写的。';
comment on column reviews.is_ai is
  'true = LLM 生成（走 generate-review 的内容约束）；false = 用户手写（只受举报和频率限制约束）。';
comment on column reviews.ai_style is
  '文风。仅 is_ai = true 时有意义，手写评价为 null。';

-- 一致性：手写的不该有文风，AI 写的必须有
alter table reviews drop constraint if exists reviews_style_matches_source;
alter table reviews add constraint reviews_style_matches_source
  check (
    (is_ai = true and ai_style is not null)
    or (is_ai = false and ai_style is null)
  );
