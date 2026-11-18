# BEBO Dashboard Project Rules

## Change & Commit Rules

1. **Cross-page regression is mandatory for logic changes**
   - Whenever shared logic or any logic that may affect more than one page/tab is changed, re-check **all related pages/tabs** before committing.
   - Do not validate only the page currently being edited.
   - Verify shared counters, statuses, filters, data flow, and derived UI wherever the changed logic is consumed.
   - A logic change is not considered complete until the affected-page regression pass is finished.

2. **Commit gate**
   - Repository changes are only committed when the user explicitly says **"commit đi"**.
