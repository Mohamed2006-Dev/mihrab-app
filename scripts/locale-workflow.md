# Updating Mihrab interface languages

Use src/ui/locales/ar.json as the source catalog. Add new interface copy there and use a stable key in the UI. For an existing message, edit its value without renaming the key. Preserve placeholders such as {count}.

1. Run npm run locales:check to list added, changed, or removed keys.
2. Run npm run locales:draft to generate drafts for changed keys. This step uses Python 3, curl, and an internet connection to Google Translate. It sends eligible interface text only. Quran data is never read. Sensitive-looking strings, surah names, and Tajweed transliterations are left for manual review.
3. Review locale-review.json. Check the changed strings in context, shorten button and tab labels, and fill missing translations. The tool flags long translations of short labels and validates placeholders.
4. Run npm run locales:apply, then npm run locales:check again. Drafts are tied to the Arabic source fingerprint. Pass -- --lang fr to target a single language.

Commit the updated catalogs and scripts/locale-source-revisions.json. The review file is temporary. The app uses local catalogs at runtime. Quran translation editions have their own source and version.
