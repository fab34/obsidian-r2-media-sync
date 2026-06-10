# Changelog

## 0.1.1

- Fixed scan notice spam so bulk scans show one summary notice instead of one notice per Markdown file.

## 0.1.0

- Initial public release.
- Upload local Markdown image references to Cloudflare R2.
- Rewrite `![](...)` and `![[...]]` image links to public R2 URLs.
- Optional local image deletion after successful upload.
- Configurable scan scope and excluded folders.
- EzImage settings import/read mode plus manual R2 configuration.
