# PixelLab anim dispatch queue

The auto-pixellab loop reads this file every ~5 min. One row must be `in flight` at a time; the loop polls that row, bulk-downloads the character ZIP when complete (cumulative — captures every anim PixelLab has for that character), marks the row `done`, and advances to the next `pending` row. See `~/.claude/skills/auto-pixellab/SKILL.md` for the full protocol.

**Bulk-download path:** `assets/sprites/<character-uuid>/_pixellab_anims/`. The skill creates the parent directory on first harvest.

**Note on initial state:** the 5 idle variants + `working` are marked `done` because they were dispatched in-session prior to the loop being armed. They are NOT yet on local disk — the bulk-download triggered by the `in flight` `reading` row's completion will fetch them all at once (the ZIP is cumulative). After that harvest, all 7 anims will be in the `_pixellab_anims/` directory for sponsor inspection.

| Status | Character | Template | Animation Name |
|---|---|---|---|
| done | 7282cc3d-f822-492c-a790-08b3b5d2b27e | v3-custom | idle |
| done | 7282cc3d-f822-492c-a790-08b3b5d2b27e | v3-custom | idle_snack |
| done | 7282cc3d-f822-492c-a790-08b3b5d2b27e | v3-custom | idle_stretch |
| done | 7282cc3d-f822-492c-a790-08b3b5d2b27e | v3-custom | idle_phone |
| done | 7282cc3d-f822-492c-a790-08b3b5d2b27e | v3-custom | idle_hips |
| done | 7282cc3d-f822-492c-a790-08b3b5d2b27e | v3-custom | working |
| done | 7282cc3d-f822-492c-a790-08b3b5d2b27e | v3-custom | reading |
