# Changelog

## 0.2.0

- Fixed completion not appearing after `[@eq`, `[@fig`, or `[@tbl` before a colon was entered.
- Fixed Pandoc Reference List taking over cross-reference completion.
- Fixed Obsidian dropping custom fields from editor suggestion contexts.
- Verified first-item preselection, ID filtering, and insertion in Obsidian.
- Added existing-label autocomplete after `[@eq`, `[@fig`, and `[@tbl`, before the ID is typed.
- Supports filtering by ID and preserves an existing closing bracket.
- Gives cross-reference completion priority over bibliography completion only for `eq`, `fig`, and `tbl` references.
- Added a setting to enable or disable label autocomplete.
- Bare-reference autocomplete follows the existing bare-reference setting.
- Suggestions show the label, its rendered number, and available equation or captions.

## 0.1.0

- Added equation, figure, and table cross-reference rendering.
- Added `[@eq:id]`, `[@fig:id]`, and `[@tbl:id]` support.
- Added optional bare references, disabled by default.
- Added right-aligned equation numbers.
- Added rendered equation hover previews.
- Added compatibility handling for Pandoc Reference List.
