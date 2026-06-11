# Obsidian Community Plugin Submission Notes

This file tracks the steps needed to submit R2 Media Sync to the Obsidian community plugin directory.

## Pre-Submission Checklist

- [x] Public GitHub repository.
- [x] MIT license.
- [x] `README.md` in the repository root.
- [x] `manifest.json` in the repository root.
- [x] `versions.json` in the repository root.
- [x] Production build passes with `npm run build`.
- [x] Release files generated:
  - `manifest.json`
  - `main.js`
  - `styles.css`
- [x] No hard-coded private R2 credentials, tokens, public bucket URL, or local vault path.
- [ ] GitHub release published with tag matching `manifest.json` version exactly.
- [ ] Pull request submitted to `obsidianmd/obsidian-releases`.

## Suggested `community-plugins.json` Entry

When opening a pull request to `obsidianmd/obsidian-releases`, add:

```json
{
  "id": "cloudflare-media-sync",
  "name": "R2 Media Sync",
  "author": "fab34",
  "description": "Automatically upload local Obsidian media assets to Cloudflare R2 and rewrite Markdown links.",
  "repo": "fab34/cloudflare-media-sync"
}
```

## Release Rule

For Obsidian plugin releases, the GitHub release tag should match the version in `manifest.json`, such as `0.1.2`, without a leading `v`. Attach these built files to the release:

- `manifest.json`
- `main.js`
- `styles.css`

The root `manifest.json` should also remain committed in the repository.
