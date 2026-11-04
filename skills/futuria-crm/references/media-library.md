# Media Library — secure reads and file handling

Prefer the connected customer MCP specialised tools, then the catalog workflow in `references/mcp-operations.md`. The direct API paths and helper examples in this reference apply only to the explicitly chosen local PIT alternative; use actual MCP tool schemas for OAuth. Missing coverage never authorises a silent channel change.

Use the user's secure API helpers with version `v3` for JSON operations. Media belongs to the user's account; discover IDs and folders there. Relevant PIT scopes are `medias.readonly` for listing and `medias.write` for authorized writes. Source lookup is in `references/terminology-and-voice.md`.

- List/search: `GET /medias/files?altType=location&altId={location}&type=file&sortBy=createdAt&sortOrder=desc&limit=20&offset=0`. Use `query` for search, `parentId` for a known folder; paginate with `offset`/`limit`.
- Delete: `DELETE /medias/{mediaId}?altType=location&altId={location}`, only for the exact authorized file. Before deleting, inspect known posts/content references and retain the ID/name/use context. If references cannot be established, report the uncertainty instead of assuming the file is unused.
- Local upload uses `POST /medias/upload-file` multipart (`file`, `hosted=false`, `name`). The bundled helpers currently send JSON only: they cannot perform this upload. Use the authenticated Media Library web interface for local uploads, URL imports, folders or renaming when a verified secure helper does not support the required request. Never retrieve the PIT or construct a raw authorization header to work around this limitation.
- Verify the resulting library entry, file ID, type, size and accessible file URL after upload. Match files by ID: the URL in a saved post may differ from the library URL. Check image/video integrity and access before assigning it to a post.
- The documented upload limits are 25 MB per file and 500 MB per video; verify the current limits and destination-platform requirements before uploading a large asset.

Do not delete media as an implicit consequence of deleting a social post. File upload or a saved draft does not establish publication approval or rights to use supplied assets.
