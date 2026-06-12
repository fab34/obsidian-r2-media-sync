# R2 Media Sync

R2 Media Sync is an Obsidian plugin that automatically uploads local media assets referenced in Markdown notes to Cloudflare R2, rewrites the Markdown links to public R2 URLs, and optionally deletes the local files.

It is designed for workflows where other tools create local image files inside your vault, such as PDF-to-Markdown converters, document importers, AI assistants, or batch import tools.

## How It Differs From Other Image Upload Plugins

R2 Media Sync is not primarily a paste-image uploader.

Many Obsidian image upload plugins focus on the moment you paste, drag, or manually select an image. That workflow is already handled well by plugins such as EzImage.

R2 Media Sync focuses on the next problem: other tools may create image files directly inside your vault and insert local image links into Markdown. Common examples include:

- PDF-to-Markdown converters that extract page images into the note folder.
- Document importers that generate local assets.
- AI assistants or automation tools that write Markdown and image files directly.
- Batch migration workflows that leave notes full of local image references.

In those cases, paste/drag upload hooks never run. R2 Media Sync watches the resulting Markdown files, uploads the referenced local images to Cloudflare R2, rewrites the links in-place, and can remove the local image files after a successful upload.

In short:

- Use EzImage or a similar plugin for pasted/dragged images.
- Use R2 Media Sync for generated or imported local images that already exist in your vault.
- Use both together if you want pasted images and generated images to follow the same R2 storage strategy.

## What It Does

- Watches newly created or modified Markdown files.
- Detects local image links:
  - `![](image.png)`
  - `![[image.png]]`
- Uploads referenced image files to Cloudflare R2.
- Rewrites the note to use a public R2 URL.
- Optionally deletes the local image file after successful upload.
- Can read Cloudflare R2 settings from the EzImage plugin or use its own manual R2 settings.

## Why

Plugins such as EzImage handle pasted or dragged images very well, but some Obsidian workflows create files directly in the vault and write local links into Markdown. For example, a PDF conversion plugin may create files like `_page_3_Picture_2.jpeg` and insert:

```markdown
![](_page_3_Picture_2.jpeg)
```

Those files can clutter the vault and consume sync storage. R2 Media Sync cleans up that class of generated assets automatically.

## Features

- Configurable local cleanup after upload:
  - move to Obsidian trash
  - move to a review folder before manual cleanup
- Configurable scan scope:
  - whole vault
  - selected folders only
- Configurable excluded folders, such as `.obsidian`, `.git`, `Templates`, or attachment folders.
- Toggle support for Markdown image links and wiki image embeds separately.
- Use existing EzImage R2 settings or enter R2 credentials directly.
- Reuse previous uploads by file hash to avoid uploading identical image content again.
- Retry failed uploads before recording them as failed.
- Keep a local failed upload log for troubleshooting.
- View recent failed upload details in a modal.
- Open a sync dashboard with recent status, scope count, upload history count, failure count, review folder size, and maintenance actions.
- Show the latest sync state in the Obsidian status bar.
- Choose the plugin interface language: Auto, English, or Traditional Chinese.
- Manual command to scan the current note.
- Manual command to scan the configured scope.
- Manual command to import EzImage settings.

## Safety Defaults

R2 Media Sync uses conservative defaults for first-time installs:

- It does not scan on startup by default.
- It does not delete local images by default.
- You can run a manual scan on the current note before enabling broader automation.
- If local cleanup is enabled, files can be moved through Obsidian's trash handling or moved to a review folder after upload and link rewrite.
- Failed uploads are recorded locally so you can inspect and retry later instead of losing track of partial failures.

After confirming your R2 settings, public URL, and scan scope, you can opt in to startup scans or local deletion from the plugin settings.

## Privacy and Security

- No telemetry.
- No analytics.
- No remote service other than the Cloudflare R2 endpoint you configure.
- Credentials are stored locally in Obsidian plugin data when using manual mode.
- When using EzImage mode, this plugin reads the EzImage `data.json` file from your vault config folder locally and does not modify it.
- Public Markdown links will contain your configured public R2 URL.
- Upload history and failed upload logs are stored locally in this plugin's data folder.

## Vault Access

R2 Media Sync scans Markdown files so it can find local media references that were created by PDF converters, importers, AI tools, or other automation.

You can limit this behavior by:

- Choosing `Only included folders` instead of `Whole vault`.
- Setting included folders such as `AI 工作區` or a specific project folder.
- Excluding folders such as `.obsidian`, `.git`, `.trash`, `Templates`, or attachment folders.

The plugin only uploads image files that are referenced by Markdown notes and are inside the configured scan scope.

## Requirements

- Obsidian desktop or mobile.
- A Cloudflare R2 bucket.
- A public R2 URL or custom public domain.
- R2 API credentials with permission to upload objects to the target bucket.

## Installation

This plugin is not yet published to the Obsidian community plugin registry.

### BRAT Installation

If you use the BRAT plugin:

1. Install and enable BRAT.
2. Run `BRAT: Add a beta plugin for testing`.
3. Enter:

```text
fab34/cloudflare-media-sync
```

4. Enable `R2 Media Sync` in Community plugins.

### Manual Installation

Manual installation:

1. Download or build the plugin files:
   - `manifest.json`
   - `main.js`
   - `styles.css`
2. Create this folder in your vault:

```text
.obsidian/plugins/cloudflare-media-sync/
```

3. Copy the three files into that folder.
4. Restart Obsidian.
5. Open `Settings -> Community plugins`.
6. Enable `R2 Media Sync`.

## Configuration

Open `Settings -> R2 Media Sync`.

### Language

Choose one:

- `Auto`: follow your system/browser language when it is Traditional Chinese, otherwise English.
- `English`
- `Traditional Chinese`

### R2 Settings Source

Choose one:

- `Read from EzImage`: reuse EzImage's R2 settings.
- `Manual`: enter Cloudflare R2 settings directly in this plugin.

Manual fields:

- Cloudflare account ID
- Access key ID
- Secret access key
- Bucket name
- Public URL
- Path template

### Reliability

- `Reuse uploads by file hash`: avoids uploading identical image content more than once by storing a local hash-to-URL history.
- `Upload retry attempts`: retries each R2 upload before the image is recorded in the failed upload log.

### Local Cleanup

Local cleanup is disabled by default.

When enabled, choose one cleanup mode:

- `Move to Obsidian trash`: uses Obsidian's file trash handling.
- `Move to review folder`: moves uploaded local files into a vault folder such as `_synced_media_trash`, preserving the original path under that folder so you can inspect before deleting.

Use `Clear local review folder` from the command palette when you are ready to move review-folder files to Obsidian trash.

### Path Template

Default:

```text
{yyyy}/{MM}/{timestamp}-{random}.{ext}
```

Supported tokens:

- `{yyyy}`
- `{MM}`
- `{dd}`
- `{hh}`
- `{mm}`
- `{ss}`
- `{timestamp}`
- `{random}`
- `{name}`
- `{ext}`

### Scan Scope

Use the whole vault, or limit processing to included folders.

Recommended exclusions:

```text
.obsidian, .git, .trash, Templates
```

### Recommended First Run

1. Keep `Delete local image after upload` disabled.
2. Keep `Scan on startup` disabled.
3. Open a note with one or two local test images.
4. Run `R2 Media Sync: Upload local images in current note`.
5. Confirm the note was rewritten to public R2 URLs.
6. Enable local cleanup or startup scans only after the manual test behaves as expected.

## Commands

Open the command palette and search for `R2 Media Sync`.

- `Upload local images in current note`
- `Scan configured scope now`
- `Import settings from EzImage`
- `Show failed upload summary`
- `Clear failed upload log`
- `Clear local review folder`
- `Open sync dashboard`

## Example

Before:

```markdown
![](_page_3_Picture_2.jpeg)
![[diagram.png]]
```

After:

```markdown
![image](https://example.r2.dev/2026/06/1710000000000-a1b2c3d4.jpeg)
![image](https://example.r2.dev/2026/06/1710000001000-e5f6g7h8.png)
```

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Development watch:

```bash
npm run dev
```

## Release Files

For a manual release, include:

- `manifest.json`
- `main.js`
- `styles.css`

## Community Plugin Submission

This repository is structured for eventual submission to the Obsidian community plugin directory.

Before submitting:

- Publish a GitHub release whose tag exactly matches the version in `manifest.json`, for example `0.1.2`.
- Attach `manifest.json`, `main.js`, and `styles.css` to that release.
- Open a pull request to `obsidianmd/obsidian-releases`.

See `COMMUNITY_SUBMISSION.md` for the suggested entry and checklist.

## Notes

This plugin intentionally only processes image files that are referenced by Markdown notes. It does not upload unreferenced orphan images, because doing so could remove files that are still being staged or reviewed.

## License

[MIT](https://github.com/fab34/cloudflare-media-sync/blob/main/LICENSE) — 歡迎自由使用、修改、散布。Issue 與 PR 都歡迎。
