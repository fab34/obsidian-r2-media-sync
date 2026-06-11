# Changelog

## 0.1.3

- Removed the word "Obsidian" from the plugin manifest description to satisfy community review requirements.
- Replaced direct settings heading DOM creation with the Obsidian `Setting` API.
- Read the vault config directory from `app.vault.configDir` instead of assuming `.obsidian`.
- Use `fileManager.trashFile` for local cleanup so file deletion respects the user's vault trash settings.
- Removed the `builtin-modules` development dependency.
- Tightened JSON parsing and async callback handling to reduce automated review warnings.

## 0.1.1

- Fixed scan notice spam so bulk scans show one summary notice instead of one notice per Markdown file.

## 0.1.0

- Initial public release.
- Upload local Markdown image references to Cloudflare R2.
- Rewrite `![](...)` and `![[...]]` image links to public R2 URLs.
- Optional local image deletion after successful upload.
- Configurable scan scope and excluded folders.
- EzImage settings import/read mode plus manual R2 configuration.
