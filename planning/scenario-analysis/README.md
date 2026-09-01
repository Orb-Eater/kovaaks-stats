# Score-by-cm interpretation rules

**The rules moved to [`app/data/categories.md`](../../app/data/categories.md).**

They had to. `planning/` is not copied into a frozen release (`release.py`
COPY_FILES / COPY_DIRS), so a rules file living here would only ever work in the
working copy — the feature would be dead in every build you actually run. It is
served from `app/data/` now, which means it also works with no server at all.

Nothing else changed: it is still plain text, still the only place the rules
live, and editing it still needs no code changes. Reload the page and the app
re-reads it.
