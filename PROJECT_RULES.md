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
- Show its stored `submitted_at` as an approximate recorded-time value prefixed with **~** instead of hiding it as "No time".
- The **~** marker means the time is a DB/reporting proxy and not a verified Facebook posting timestamp.
- Where manual time correction is available, keep that correction control alongside the proxy time.

## 11. Todo viral-card group limit

- For each viral Todo card, show only the **top 6 active groups** using the existing tier/fit ranking.
- Display those 6 group/status rows in **two columns** on desktop and one column on narrow/mobile screens.


## 12. Todo source-group exclusion

- The source/winner group for a viral Todo card is context only and must not appear in that card's top-6 recommended group list.
- Keep coverage/status for other groups in the lineage unchanged.
- Apply the existing tier/fit ranking only after excluding the source group.
