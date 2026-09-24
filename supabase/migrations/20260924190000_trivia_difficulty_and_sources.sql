-- Keep the TV question payload small. Editors can trace a reviewed question
-- back to a private knowledge-base document without exposing that document to
-- viewers or letting the client generate unreviewed answers at play time.
alter table public.trivia_questions
  add column if not exists difficulty text not null default 'easy';

alter table public.trivia_questions
  drop constraint if exists trivia_questions_difficulty_check;
alter table public.trivia_questions
  add constraint trivia_questions_difficulty_check
  check (difficulty in ('easy', 'standard', 'expert'));

alter table public.trivia_questions
  add column if not exists source_document_id uuid references public.knowledge_documents(id) on delete set null,
  add column if not exists source_locator text,
  add column if not exists reviewed_at timestamptz;

create index if not exists trivia_questions_published_difficulty_idx
  on public.trivia_questions (is_published, difficulty, sort_order);

comment on column public.trivia_questions.source_locator is
  'Private editor reference, such as PDF page or knowledge-guide section; never sent to TV clients.';

