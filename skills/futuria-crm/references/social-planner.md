# Social Planner — posts, statistics and comments

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Use the secure helpers in `references/api-and-troubleshooting.md`, with API version `v3`. All IDs come from the user's connected profiles and CRM users. Technical field names below are direct API camelCase, not tool arguments.

## Read and resolve

- Profiles: `GET /social-media-posting/{location}/accounts`. Check connection and active state. Use `id` for posting, `profileId` for statistics; never substitute one for the other.
- CRM users: `GET /users/?locationId={location}`. Resolve the actual author with the user; do not assume the first user is the right author.
- Posts: `POST /social-media-posting/{location}/posts/list`. Use string `skip`, `limit`, `includeUsers`, date bounds `fromDate`/`toDate`, `type` for status, and `accounts` as comma-separated account IDs. Paginate until the result count is covered.
- Detail: `GET /social-media-posting/{location}/posts/{postId}`.
- Categories/tags: `GET /social-media-posting/{location}/categories` and `GET /social-media-posting/{location}/tags`. Resolve real IDs instead of inventing labels.

Windows example (read only):

```powershell
& "<skill-dir>\scripts\crm-api.ps1" -Method GET -Path "/social-media-posting/{location}/accounts" -Version v3
```

On macOS set `FUTURIA_CRM_API_VERSION=v3` for that helper invocation; the PIT remains inside the helper.

## Prepare, approve, write and verify

1. Resolve connected targets, author, exact text, format, media and cover. Media URLs must return the real file publicly over HTTPS, without login or preview pages; do not use Drive sharing links. Load `references/media-library.md` for files.
2. Prepare `status: draft` when the user asks for a draft. A draft is not permission to schedule or publish. Before a public action, obtain authorization covering the exact content, media, profiles, collaborators, visibility and time. Reuse authorization when those still match.
3. For scheduling, use `scheduleDate` in ISO 8601 with a timezone offset or UTC; confirm the user's timezone and verify the instant is in the future. `scheduled` and `published` have external effects.
4. Create with `POST /social-media-posting/{location}/posts`; use `accountIds`, `userId`, `summary`, `type`, `status`, `media` and relevant platform fields. Read the schema for optional fields before first use. Drafts can bypass platform validation: saving a draft does not prove publication readiness.
5. Read the saved object separately and compare targets, author, text, media count/IDs, format, cover, first comment, schedule and status. For every destination and child record, verify the authorized platform fields too: collaborators, visibility/privacyLevel, showOnFeed, YouTube title/type and promotional disclosure/comment/duet/stitch settings. If a field is absent or changed, inspect the editor or destination and report it as unverified until resolved; do not claim full alignment. Report only verified results. If a create times out or has an uncertain result, search by targets, content and time before any retry; stop if duplicate risk remains unresolved.
6. Edit an unpublished post with `PUT /social-media-posting/{location}/posts/{postId}`. Start from the current object and reconstruct the complete supported request body, preserving unchanged writable fields; do not send response-only fields. Read back again. To pause a scheduled post, use `draft` only when the pause is authorized.
7. Delete only the approved post with `DELETE /social-media-posting/{location}/posts/{postId}`. Verify its absence from lists or `deleted: true`; a readable deleted object is not evidence of failure.

## Platform-specific fields

- Instagram: `instagramPostDetails.type` (`post`, `story`, `reel`); media required. Reels require exactly one video; `showOnFeed` controls feed visibility. `collaborators` is a map of connected account IDs to username arrays, without `@`, maximum three per account, posts/reels only. Example: `{"collaborators":{"<connected-account-id>":["<username>"]}}`. Stories do not publish a caption.
- Facebook: `facebookPostDetails.type`; groups do not support reels. Stories do not publish a caption.
- YouTube: `youtubePostDetails.type` is required (`short` or `video`), plus the intended `privacyLevel` (`private`, `public`, `unlisted`) and title (maximum 100 characters). A top-level `type: reel` alone does not make a Short.
- TikTok: `tiktokPostDetails.privacyLevel` is required. Preserve the user's choices for comments, duet, stitch and promotional disclosure. First comments are unsupported.
- LinkedIn: `linkedinPostDetails.postAsPdf` and `pdfTitle` for image carousels as PDF.
- Google Business Profile: `gmbPostDetails`, with the fields required by STANDARD, EVENT or OFFER; verify the current schema for the selected format.
- Pinterest: `pinterestPostDetails.pinterestBoards`, an array of `{accountId, boards}`. Use boards belonging to that connected account; do not use the deprecated `boardIds`.
- First comment: `followUpComment`, supported on Facebook, Instagram, LinkedIn and YouTube.
- Video cover: `media[0].thumbnail` is a publicly accessible JPEG/PNG URL. After publication the resolved cover can appear as top-level `thumbnail` rather than inside `media`.

## Publication and uncertain results

Scheduling to multiple profiles can create separate records grouped by `parentPostId`. A draft may show an unexpected `platform`; verify `accountIds` and each destination's child record instead. Validate the number of saved media; if the API silently loses carousel items, use the web editor and recheck the result rather than accepting the incomplete post.

`pending` or `in_progress` means processing, not published. For `failed` or ambiguous publication, inspect the actual social profile before reposting. Confirm the public permalink/status on each destination when reporting publication. A missing post can return HTTP 400 rather than 404: verify the ID and list before classifying it as absent.

## Statistics and comments

- Statistics: `POST /social-media-posting/statistics?locationId={location}` with `profileIds` (from the profile's `profileId`), optionally `platforms`, `currentRange` and `prevRange` (`startDate`/`endDate`, ISO dates). Without ranges the documented default is the last seven days excluding today against the preceding seven. Set explicit ranges for a requested period; `prevRange` requires `currentRange`.
- Comments: `POST /social-media-posting/comments/{platform}/list?locationId={location}` with `originIds` from the connected account, numeric `skip`/`limit` (unlike post lists), and optionally `parentId`, `fromDate`/`toDate`, `sortBy`. Resolve the actual account's origin IDs from the supported response or interface; do not invent them or substitute profile IDs. If those IDs or the required permission cannot be verified, inspect comments in the web interface instead. Verify platform support and scope before first use.
- Report profile, period, timezone, available metrics and missing data. Missing values are not zero; aggregate account statistics do not prove post-level retention or best posting hours. Use the native analytics interface when the requested metric is absent. Reading comments never authorizes replies or likes.

## Permissions and limits

Relevant PIT scopes: `socialplanner/account.readonly`, `socialplanner/post.readonly`, `socialplanner/post.write`, `socialplanner/category.readonly`, `socialplanner/tag.readonly`, `socialplanner/statistics.readonly`, `users.readonly`. Confirm the documented scope for comments before use. Missing permission is a capability limitation; guide the user through protected configuration without exposing the key. Connecting/disconnecting profiles requires the web interface's login flow. CSV bulk imports and category queues need their own verified schema and explicit scope; do not infer support from basic posting.

API field shapes checked against the current technical OpenAPI v3 on 2026-10-14; source lookup links are confined to `references/terminology-and-voice.md`. This package update does not certify a live publish on the user's account.
