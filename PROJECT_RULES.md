# BEBO Dashboard Project Rules

These rules define how ChatGPT and the user work together on this repository. They are process rules and apply across the whole project.

## 1. Discussion first, implementation only on commit command

- Before the user says **"commit đi"**, do not modify repository code, database schema/data, or create commits.
- Before that command, work is limited to reading, auditing, researching, tracing data flow, identifying root cause, proposing changes, and agreeing on scope.
- Do not silently implement something just because it was discussed.

## 2. "commit đi" means one agreed batch

- When the user says **"commit đi"**, gather **all changes discussed and explicitly agreed since the previous commit**.
- Implement and commit them as **one coherent batch**, not as separate piecemeal commits.
- Do not omit an agreed item.
- Do not add an item that was only proposed but not agreed.
- The latest agreed decision overrides an older superseded decision.

## 3. Research and root-cause first

- Do not guess, patch by trial and error, or invent selectors/data behavior.
- Read the actual code, schema, data path, and relevant evidence first.
- Identify and verify the root cause before changing logic.
- Do not claim **fixed**, **done**, or **correct** without verification evidence.

## 4. Database changes require explicit scope and verification

- Do not modify database data/schema unless the user explicitly asks for the database operation (for example **"add pr db"**, **"update pr db"**) or the agreed commit batch explicitly requires it.
- Before a DB write, inspect the real schema/data and identify the exact records to change.
- Preserve existing history and avoid duplicate or fabricated records.
- After a DB write, verify the resulting records and dependent counters/derived data.
- A successful write call alone is not proof that the data is correct.

## 5. Cross-page regression is mandatory for logic changes

- Whenever shared logic or any logic that can affect more than one page/tab changes, re-check **every related page/tab** before committing.
- Do not validate only the page currently being edited.
- Trace the full path **DB/source -> transformation/filter -> UI -> action** wherever the logic is consumed.
- Check counters, date boundaries/timezone, filters, statuses, derived UI, desktop/mobile behavior when applicable, and cross-page consistency.
- If the database/source is correct but a page is wrong, fix the incorrect consumer/filter; do not mutate correct data merely to make the UI match.
- A logic change is not complete until the affected-page regression pass is finished.

## 6. Preserve unrelated agreed behavior

- A change in one area does not authorize changing unrelated behavior.
- Keep previously agreed behavior unless the user explicitly changes it.
- Before editing shared code, identify downstream consumers so a local fix does not break another page.

## 7. Context and decision precedence

- When the user asks to continue prior work or reread context, review the work in chronological order and do not skip decisions.
- Distinguish old rules from newer replacements.
- Use the **latest explicitly agreed rule** as the active rule.
- Never mix a superseded rule back into the current implementation.

## 8. Commit quality gate

Before the final commit:
- Confirm the implementation matches the complete agreed batch.
- Run the required cross-page regression checks.
- Verify database/UI consistency when the change touches data logic.
- Do not commit while known regressions or unexplained mismatches remain.

The commit message must:
- Have a clear subject.
- Summarize the agreed batch in the body.
- Mention relevant scope such as UI, DB, route, logic, mobile, or security.
- State whether database/schema/migration changes are included when relevant.


## 9. Todo clone/lineage workflow

- Treat these phrases as clone-lineage triggers when they reference an existing prompt ID: **"tạo prompt giống ..."**, **"clone prompt ..."**, and **"clone pr ..."**.
- A clone must retain a durable relationship to its source/root viral prompt; do not infer lineage from similar wording alone when persistent metadata is available.
- When the user later reports that the clone was posted to a group and runs **"add pr db"**, update the normal prompt/post tracking and the Todo coverage for that viral lineage without requiring a separate "update Todo" command.
- Todo coverage is evaluated **per viral lineage and per group**, not by treating one prompt ID as permanently exhausted.
- In the Todo viral card, list only **Group + status** for coverage: **✓** when that lineage has a post in the group, **-** when it does not.
- Keep Todo group recommendation ordering based on the existing tier/fit priority. A covered group remains visible; coverage changes its mark, not the lineage model or historical record.


## 10. Proxy post-time display

- When a post has `time_is_signal=true`, keep it in counts and timelines.
- Display its stored `submitted_at` normally without a visible approximation marker such as **~**.
- Keep `time_is_signal` as internal provenance only; do not expose proxy/around wording in the normal UI.
- Where manual time correction is available, keep that correction control alongside the stored time.

## 11. Todo viral-card group limit

- For each viral Todo card, show only the **top 6 active groups** using the existing tier/fit ranking.
- Display those 6 group/status rows in **two columns** on desktop and one column on narrow/mobile screens.


## 12. Todo source-group exclusion

- The source/winner group for a viral Todo card is context only and must not appear in that card's top-6 recommended group list.
- Keep coverage/status for other groups in the lineage unchanged.
- Apply the existing tier/fit ranking only after excluding the source group.


## 13. Todo snapshot resilience

- Opening/F5 on Todo remains cache-first: render the latest local snapshot and do not auto-query Supabase.
- Only **Sync Todo** queries fresh DB data.
- A failure in one Todo section must not discard the successful sections or prevent snapshot persistence.
- On partial sync, keep the previous cached data for failed sections and save fresh data for successful sections.
- If there is no previous cached data for a failed section, keep that section empty without discarding the rest of the snapshot.


## 14. add pr db lineage integrity

- When **add pr db** records a prompt that is a clone/variant of another prompt, persist lineage metadata in the same DB workflow.
- `source_prompt_id` = the prompt cloned directly.
- `root_prompt_id` = the durable lineage root. If the source already has a root, inherit that root; otherwise use the source itself as the root.
- Do not rely on free-text notes such as "clone of ..." as the only lineage evidence.
- Clone triggers such as **"clone pr ..."**, **"clone prompt ..."**, and **"tạo prompt giống ..."** must preserve lineage through the later **add pr db** operation.
- After writing the prompt/post, verify all of the following before treating the DB update as complete:
  - the clone has the expected `source_prompt_id` and `root_prompt_id`;
  - `post_history` points to the clone record;
  - Todo lineage coverage resolves the posted group as covered.
- For Todo coverage, `submitted`, `pending_approval`, and `approved` count as posted. Pending approval does not block the coverage checkmark.


## 15. Project-wide prompt creation & DB pre-flight — HARD GATE

This rule is mandatory across the entire **View ngoại** project, across every tab/chat/workflow that creates, clones, revises, exports, or writes prompt/post data.

### 15.1 Mandatory rule read before every prompt operation

- Before creating **any new prompt**, clone, revision, TXT/batch prompt file, or prompt-related artifact, read the current `PROJECT_RULES.md` first.
- Before every **add pr db**, **update pr db**, prompt insert/update, or post-history write, read the current `PROJECT_RULES.md` first.
- This is a hard gate, not a suggestion. Do not create or write prompt/post data first and check rules afterward.
- Do not rely on another tab/chat saying what the current rule or next ID is. Every workflow must independently re-read the shared project rules before acting.

### 15.2 HH namespace allocation before creating a new prompt

Before assigning any new `HHxxxxx` ID:

1. Query the current database and inspect the real HH namespace.
2. Determine the highest HH numeric ID currently present.
3. Check that the intended new ID does not already exist.
4. For a genuinely new concept, assign the next free HH ID after the current database maximum.
5. For a revision, keep the existing HH ID and increment only the version.
6. For a clone/variant, assign a new HH ID and retain the source/root lineage needed for the later DB write.
7. For a batch of N new prompts, reserve a contiguous range starting after the current DB maximum and verify:
   - no ID collides with the DB;
   - no IDs collide with each other inside the batch;
   - no previously assigned concept ID is reused.

Do not infer the next HH ID from memory, nearby chat context, an old TXT file, a previous assistant message, or a stale batch.

### 15.3 Pre-flight before every prompt DB write

Before inserting or updating a prompt/post:

1. Re-read `PROJECT_RULES.md`.
2. Query the exact `prompt_id` that is about to be written.
3. If the ID already belongs to a different concept, **STOP**. Do not overwrite and do not insert a duplicate.
4. If the operation is a revision/update of the same prompt, preserve its identity and history.
5. If the operation is a clone/variant, resolve and write both `source_prompt_id` and `root_prompt_id` according to the lineage rule.
6. Resolve the target Facebook group from durable evidence such as Facebook Group ID / canonical group URL when available; do not rely only on a guessed name match.
7. Write prompt and `post_history` consistently.
8. If the exact Facebook post time is unavailable, use the user-report timestamp as a proxy and set `time_is_signal=true`.

### 15.4 Mandatory verification after every DB write

A prompt/post DB operation is not complete until all applicable checks pass:

- Query the written `prompt_id` again.
- Confirm the ID resolves to the intended prompt and not another concept.
- Confirm there is no unintended duplicate prompt record for that ID.
- Confirm title/content/version match the intended prompt.
- Confirm `post_history.prompt_id` points to the correct DB prompt record.
- Confirm the mapped Facebook group is correct.
- For clones/variants, confirm `source_prompt_id` and `root_prompt_id` are correct.
- If Todo lineage coverage is affected, confirm the posted group resolves as covered under the lineage.
- Do not report the write as complete merely because the insert/update call returned success.

### 15.5 Project-wide source-of-truth order

When prompt identity, IDs, lineage, posting history, or rules conflict, use this precedence:

1. **Current database state**
2. **Current `PROJECT_RULES.md`**
3. **Project files / durable project data**
4. **Conversation context / memory**

Conversation memory is never authoritative for allocating a new HH ID when the database can be checked.

### 15.6 Cross-tab consistency requirement

- Every tab/chat/workflow must perform its own fresh pre-flight before creating a prompt or writing prompt/post data.
- No tab may trust an HH ID merely because another tab previously proposed or displayed it.
- A file that was valid when created can become stale if another tab allocates IDs afterward; therefore DB uniqueness must be re-checked again at DB-write time.
- If a collision is discovered in a batch, do not patch only one conflicting row. Recalculate the affected batch IDs from the current database state and verify the full batch again.


## 16. Post-level pending approval warnings

- `post_history.status='pending_approval'` is a **post-level** state and must not automatically change the Facebook Group workflow/status.
- Pending posts count as posted for lineage/coverage and operational post history, so they must not be suggested for duplicate reposting.
- Pending posts must be visibly flagged as a warning/follow-up item on operational pages that show the post (Home, Todo, Report, Metrics).
- Pending posts must not contribute engagement results, winners, baselines, prompt performance, DNA/mechanic performance, or other analytical intelligence until they are no longer pending.
- Group-level `workflow_status='following_approval'` remains a separate state.

## 17. Paused group visibility

- `facebook_groups.posting_status='paused'` preserves the group, history, and engagement tier but excludes the group from active operations and KPI totals.
- A paused group is visible only on Home inside the dedicated paused/follow-later block.
- Paused groups must be removed from Todo, Report, Metrics, Analysis/Intelligence, filters, recommendations, active group totals, and KPI calculations.
- `posting_status='left'` remains distinct from paused.
- If a group becomes unavailable/deleted externally but the user wants to keep it for later follow-up, use `paused` rather than `left`; it remains visible only in the Home paused block and stays excluded everywhere else.


## 18. Report and Metrics page roles

- The UI page backed by `posts.html` is named **Report** and is the read-only/history view of posted content.
- The UI page backed by `report.html` is named **Metrics** and is the workflow for entering Like / Comment / Share values and confirming checks.
- A `pending_approval` post in Metrics is read-only: disable Like / Comment / Share inputs and the check button until it is no longer pending.
- The Home checklist KPI for updating yesterday's metrics excludes `pending_approval` posts from its denominator because no live reaction data can be entered yet.
- Active Home groups with one or more pending posts must show a restrained amber pulse/badge so the user can manage approval follow-up without changing or replacing the group's own workflow/status label.


## 19. Unranked tier icon

- Do not show visible `UNRANKED`, `Unranked`, or `---` text for a group with no assigned tier.
- Use the single neutral icon **◌** everywhere the unranked tier is displayed.
- Accessibility/title text may say **Chưa xếp hạng**; the internal `unranked` value/class may remain for logic and styling.


## 20. Visual 10S DNA Action Radar

- `public.visual_10s_dna` is the source of truth for the new Visual 10S DNA cohort shown in Todo Action Radar.
- The **DNA MỚI CẦN TEST THÊM** checklist must appear at the top of Action Radar.
- Prevent historical DNA-code collisions by counting only prompts whose `created_at` is at or after the matching `visual_10s_dna.created_at`.
- Pending posts count toward DNA test/coverage counts, but pending posts must not contribute SIGNAL/CONFIRMED performance evidence.
- DNA status rules: no cohort posts = **NEW**; posted but no win = **TESTING**; at least one analytical win = **SIGNAL**; **CONFIRMED** requires at least 4 analytical posts, at least 3 tested groups, and win rate >= 60%.
- The checklist target is at least 3 groups per DNA. CONFIRMED DNA is removed from the needs-more-testing rows.
- Frontend Todo access to `public.visual_10s_dna` must remain SELECT-only for dashboard reader roles; do not grant write access for this checklist.


## 21. Today prioritizes new Visual DNA

- Todo **Đăng hôm nay** must prioritize active DNA from `public.visual_10s_dna` before historical winner lineages.
- For a Visual 10S DNA card, only cohort prompts created at or after that DNA row's `created_at` are eligible, preventing historical DNA-code collisions.
- Coverage for a new-DNA Today card is DNA-wide: if any cohort prompt from that DNA has already been posted to a group, that group is covered for the DNA and must not be recommended as untested.
- Pending posts count as covered for Today DNA coverage.
- Do not cap new-DNA Today work to a fixed two-prompt slice. Show active DNA work that still has uncovered active groups, then append winner-lineage cards.
- Avoid duplicate Today cards when a winner lineage is already represented by a prioritized new-DNA card.
