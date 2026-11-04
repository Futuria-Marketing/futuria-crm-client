# Content & marketing — email, social, blog

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Create and manage content assets in the user's Futuria CRM account: email templates, social posts, and blog posts. Base URL and headers in `references/api-and-troubleshooting.md`.

## Email templates

- List/read: `GET /emails/builder?locationId={id}&limit=10&offset=0` → `builders[]`, `total`. (A `/emails/templates` path does **not** exist — 404.)
- Creating or editing a template body is builder territory: prefer guiding the user in the web editor. If asked to automate it, verify the write endpoint's response shape on first use and re-read afterwards.
- **Mass email is a usage cost.** Sending newsletters/bulk email draws down the wallet — don't trigger sends casually; see the cost model in `references/terminology-and-voice.md`.
- When drafting copy, match the brand/tone the account already uses; keep the platform name as **Futuria CRM** if it appears.

## Social posting and Media Library

Load `references/social-planner.md` for posts, platform fields, statistics and comments. Load `references/media-library.md` for files and upload limitations.

## Blog

- Blog sites of the account: `GET /blogs/site/all?locationId={id}&skip=0&limit=10` → `data[]` (site id in `_id`) (validated).
- Posts of a blog: `GET /blogs/posts/all?locationId={id}&blogId={blogId}&limit=10&offset=0` (validated).
- Valid authors / categories: `GET /blogs/authors?locationId={id}&limit=10&offset=0` and `GET /blogs/categories?locationId={id}&limit=10&offset=0` (validated).
- Slug check: `GET /blogs/posts/url-slug-exists?urlSlug={slug}&locationId={id}` → `{exists}` (validated).
- Create: `POST /blogs/posts`; update: `PUT /blogs/posts/{postId}`.
- **Order of operations:** resolve blog id → category ids → author id → check slug → create → re-read (and check the public page for published posts). A published article is public — confirm before publishing.

## Blog body and public verification

When updating `rawHTML`, include `wordCount` (word count of the rendered text) together with the existing blog, slug and intended status. An update can return success and change `updatedAt` while leaving the body unchanged if this field is omitted. Edit in place first, preserving post ID and public slug; compare the returned body and public page/RSS when published.

Use `status: DRAFT` to hide a post when authorized. Do not assume `ARCHIVED` or an `archived` boolean reproduces the web editor's archive state; verify the actual public visibility. Do not invent a blog DELETE endpoint. Replacing a post is a fallback only after a verified in-place failure: preserve old body/metadata/slug, agree the replacement, and update any user-owned import mapping that refers to the old ID.

For imported articles, verify heading hierarchy, important links, inline image count and placement, featured image, author/category, slug and public status. Remove source navigation/feedback chrome, not useful article content. Before transforming HTML, replace inline images with stable markers; restore the uploaded file URLs at those positions and check no markers were lost. Do not append missing images at the bottom without the user's request. Media upload handling is in `references/media-library.md`.
