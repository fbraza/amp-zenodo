# Zenodo Article Deposit Reference

This reference supports the `managing-zenodo-deposits` skill. It summarizes the Zenodo API surface used by the bundled tools.

## Environments and Tokens

| Environment | Base URL | Token variable |
|---|---|---|
| Sandbox | `https://sandbox.zenodo.org/api` | `ZENODO_SANDBOX_TOKEN` |
| Production | `https://zenodo.org/api` | `ZENODO_TOKEN` |

Sandbox and production use separate accounts and tokens. Sandbox is the default test environment. Production is the real Zenodo service.

“Draft-only” is independent of environment: a draft is unpublished, but a production draft still belongs to the user's real Zenodo account.

Use bearer-token authentication only:

```http
Authorization: Bearer <token>
```

Draft operations need `deposit:write`. Publishing needs `deposit:actions`.

## Tool-to-Endpoint Mapping

| Tool | Endpoint |
|---|---|
| `zenodo_create_draft` | `POST /deposit/depositions` |
| `zenodo_get_deposition` | `GET /deposit/depositions/:id` |
| `zenodo_list_depositions` | `GET /deposit/depositions` |
| `zenodo_list_licenses` | `GET /licenses/` |
| `zenodo_upload_file` | `GET /deposit/depositions/:id`, then `PUT {links.bucket}/{filename}` |
| `zenodo_update_metadata` | `GET /deposit/depositions/:id`, then `PUT /deposit/depositions/:id` |
| `zenodo_delete_draft` | `GET /deposit/depositions/:id`, then `DELETE /deposit/depositions/:id` |
| `zenodo_publish_deposition` | `GET /deposit/depositions/:id`, then `POST /deposit/depositions/:id/actions/publish` |

The mutating tools check that `submitted === false` before upload, update, or delete.

The publish tool additionally requires the exact phrase `publish <environment> deposition <id>` before any network request.

## Journal Article Metadata Shape

Required fields:

```json
{
  "upload_type": "publication",
  "publication_type": "article",
  "title": "...",
  "publication_date": "YYYY-MM-DD",
  "creators": [{ "name": "Family, Given" }],
  "description": "Abstract text.",
  "access_right": "open"
}
```

Conditional fields:

- `license` for `open` or `embargoed` records.
- `embargo_date` for `embargoed` records.
- `access_conditions` for `restricted` records.

Useful optional fields:

- `doi`
- `journal_title`
- `journal_volume`
- `journal_issue`
- `journal_pages`
- `keywords`
- `language`
- `grants`

## File Upload Constraints

The upload tool uses Zenodo's bucket upload API from `deposition.links.bucket`.
Zenodo bucket uploads expect the raw file bytes with `Content-Type: application/octet-stream` and a `Content-Length` matching the local file size.

Constraints enforced locally:

- local path must be a regular file
- remote filename must not contain path separators
- maximum 50 GB per file
- maximum 100 files per deposition
- bucket URL is derived from Zenodo, not supplied by the user

## Draft-only Safety

Published Zenodo records are difficult or impossible to modify in-place, especially files. The standard workflow intentionally stops at draft preparation.

Use the preflight summary in `SKILL.md` before publishing is considered.

## Publishing Safety

Publishing is opt-in and guarded:

1. exact confirmation phrase is checked locally before requests;
2. the deposition is fetched;
3. response ID must match the requested deposition ID;
4. `submitted` must be `false`;
5. at least one file must be present;
6. server-side article metadata must validate;
7. only then is `POST /deposit/depositions/:id/actions/publish` called.

The publish tool returns a copyable receipt in normal tool output and structured details. It does not write a local receipt file.
