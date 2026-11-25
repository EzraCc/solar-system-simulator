# Working notes for Claude Code

## Push policy — check this before every `git push`

**Current mode: PUSH FREELY (feature branches only).** Switched
2026-11-25 at the user's request ("Let's start pushing on these
changes. Make branches for the parallel tasks and push them"). Push
verified work to its topic branch and open a PR; never push straight to
`main` -- merging is done through PRs after review. (Earlier history:
LOCAL ONLY from 2026-11-17 for the system-view prototype, pushed to main
2026-11-25; the textured-sphere branch was local-only until this switch.)

The other mode is **PUSH FREELY**: OK to push after each verified,
working commit without asking each time.

To change modes, edit the bolded line above. Whoever changes it should
say so out loud in the conversation too, since the file alone is easy to
miss mid-session.

**Rules for working with this flag:**
- Check this section before any `git push` in this repo — don't rely on
  memory of what mode a given task started in, since it can change
  mid-session.
- Default to **LOCAL ONLY** whenever starting a new prototype/
  experimental feature area, even if the file still says PUSH FREELY
  from a previous task — ask explicitly before flipping it back, rather
  than assuming the earlier mode still applies to genuinely new work.
- If genuinely unsure which mode should apply to what you're about to
  do, ask rather than guess. Pushing is much harder to cleanly undo than
  waiting one extra turn to confirm.

(Added 2026-08-03 after a real miss: asked to prototype the velocity-
hodograph dashboard locally only, but it got pushed anyway once
verification passed, because there was no durable record of that
instruction outside the conversation itself.)

## Data pulls — check at the start of each session

Run `tools/.venv/bin/python tools/refresh_check.py --todo` (no network).
It rewrites the data-pull block in `docs/TODO.md` from the log in
`docs/data-pulls.md`; if the last pull is more than 10 days old, it adds
a "data pull due" item. Mention it to the user when one is due. Pulls
are done by hand (no cron or scheduled routine, per the user,
2026-11-25); after each one, log it with
`refresh_check.py --update-baseline --log "what changed" --pr "#N"`.
