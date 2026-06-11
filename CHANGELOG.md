# Changelog

## Unreleased

- Added upload retries with configurable attempt count.
- Added a local failed upload log and commands to show or clear it.
- Added local hash-based upload history so identical image content can reuse an existing R2 URL.
- Added a status bar item that shows current sync activity.
- Added clearer safety feedback when local image deletion is enabled.
- Documented vault scanning scope and exclusions more explicitly.
- Added a language setting with English and Traditional Chinese interface text.
- Added a local cleanup mode so uploaded local files can move to Obsidian trash or a review folder.

## 0.1.5

- Removed the settings tab heading to satisfy community review wording rules.

## 0.1.4

- Renamed the settings tab heading for community review compliance.
- Added validation for stored plugin data before merging settings to avoid unsafe assignment warnings.

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
