# Future item (NOT approved, NOT implemented): overlapping seasons can be created concurrently

Found during P6 inventory. `createSeason` and `updateSeason` check overlap with a separate read (`assertNoOverlap(await listSeasonRows(), ...)`) and then write. Only `name` is unique, so two near-simultaneous requests (two creates, or a create and a date edit) can both pass the check and leave two seasons covering the same date. `seasonForDate` would then return an arbitrary one of them.

Not changed by P6: the P6 guard protects entries against a season closing or re-dating, not seasons against each other.

Possible minimal fix for a later approval: a required transaction in which a guarded write on a shared document (for example a single "seasons" guard document, or revision-checked writes on the neighbouring seasons) serialises season range changes, plus tests. Any data check for existing overlaps should be added to the read-only census first. No index change is proposed.
