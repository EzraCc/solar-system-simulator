# Working notes for Claude Code

## Push policy — check this before every `git push`

**Current mode: PUSH FREELY.** OK to push after each verified, working
commit without asking each time.

The other mode is **LOCAL ONLY** — commit locally (or don't even commit)
but do not run `git push` under any circumstances until explicitly told
to switch back.

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
