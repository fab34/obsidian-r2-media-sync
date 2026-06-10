# R2 Media Sync

R2 Media Sync is an Obsidian desktop plugin that automatically uploads local media assets referenced in Markdown notes to Cloudflare R2, rewrites the Markdown links to public R2 URLs, and optionally deletes the local files.

It is designed for workflows where other tools create local image files inside your vault, such as PDF-to-Markdown converters, document importers, AI assistants, or batch import tools.

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

- Configurable local deletion after upload.
- Configurable scan scope:
  - whole vault
  - selected folders only
- Configurable excluded folders, such as `.obsidian`, `.git`, `Templates`, or attachment folders.
- Toggle support for Markdown image links and wiki image embeds separately.
- Use existing EzImage R2 settings or enter R2 credentials directly.
- Manual command to scan the current note.
- Manual command to scan the configured scope.
- Manual command to import EzImage settings.

## Privacy and Security

- No telemetry.
- No analytics.
- No remote service other than the Cloudflare R2 endpoint you configure.
- Credentials are stored locally in Obsidian plugin data when using manual mode.
- When using EzImage mode, this plugin reads `.obsidian/plugins/ezimage/data.json` locally and does not modify it.
- Public Markdown links will contain your configured public R2 URL.

## Requirements

- Obsidian desktop.
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
fab34/obsidian-r2-media-sync
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
.obsidian/plugins/r2-media-sync/
```

3. Copy the three files into that folder.
4. Restart Obsidian.
5. Open `Settings -> Community plugins`.
6. Enable `R2 Media Sync`.

## Configuration

Open `Settings -> R2 Media Sync`.

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

## Commands

Open the command palette and search for `R2 Media Sync`.

- `Upload local images in current note`
- `Scan configured scope now`
- `Import settings from EzImage`

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

- Publish a GitHub release whose tag exactly matches the version in `manifest.json`, for example `0.1.1`.
- Attach `manifest.json`, `main.js`, and `styles.css` to that release.
- Open a pull request to `obsidianmd/obsidian-releases`.

See `COMMUNITY_SUBMISSION.md` for the suggested entry and checklist.

## Notes

This plugin intentionally only processes image files that are referenced by Markdown notes. It does not upload unreferenced orphan images, because doing so could remove files that are still being staged or reviewed.
