# Working on Mihrab

The desktop application uses Electron. `main.js` owns the application lifecycle,
windows and IPC handlers; `preload.js` exposes the renderer API. Domain services
live in `src/engines/`. The Arabic interface and its shared controls live in
`src/ui/`; theme definitions live in `themes/`.

## Local development

Run `npm ci`, then `npm start`. Run `npm test` for engine and notification tests
and `npm run test:ui` for isolated Chromium interaction checks. UI checks use
synthetic data and do not launch the application's background services.

Run `npm run format` after editing code and `npm run format:check` before review.
Use descriptive names and small functions. Explain constraints and side effects
in comments rather than restating each line. Keep behavior changes separate from
formatting changes so reviewers can assess them independently.

## Data and privacy

Keep the bundled hadith, Quran, geography and attribution files. User settings,
history, fetched caches, developer contact secrets and bank images are local and
ignored. Never include credentials in source code or test fixtures. Do not run
the public-contact preparation script merely to inspect private account data.

Build outputs, historical scraping tools, original asset working files and local
experiment directories are excluded from Git. Production assets under
`src/ui/assets/` and the test suite remain part of the project.

Git ignore rules do not remove files already committed. Before publishing, inspect
`git status` and `git ls-files`; remove previously tracked private files from the
index and audit history separately if necessary. This source folder currently
has no Git repository, so no existing commit history was altered during cleanup.
