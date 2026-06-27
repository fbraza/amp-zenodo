# amp-zenodo

Amp plugin and bundled skill for conservative Zenodo journal article deposit workflows.

This is an Amp-oriented port of [`@fbraza/pi-zenodo`](https://github.com/fbraza/pi-zenodo). It keeps the original two-part design:

1. **Plugin tools** for Zenodo draft creation, listing, upload, metadata update, deletion, and explicitly confirmed publishing.
2. **A bundled skill** that guides the agent through a draft-first, user-reviewed workflow for article PDFs.

## Contents

```text
.amp/plugins/amp-zenodo.ts
.agents/skills/zenodo/
├── SKILL.md
└── references/
    └── zenodo_article_deposit_reference.md
src/
├── metadata.ts
├── zenodo-client.ts
└── tools/*.ts
tests/
├── amp-zenodo.test.ts
└── upstream/*.test.ts
```

The `tests/upstream/` files preserve the Pi extension's original behavior as a porting reference. The active Amp test suite is `tests/amp-zenodo.test.ts`.

## Tools

The plugin registers these tools:

- `zenodo_create_draft`
- `zenodo_get_deposition`
- `zenodo_list_depositions`
- `zenodo_list_licenses`
- `zenodo_upload_file`
- `zenodo_update_metadata`
- `zenodo_delete_draft`
- `zenodo_publish_deposition`

All tools default to the Zenodo sandbox unless `environment: "production"` is explicitly provided.

## Environment variables

| Variable | Purpose |
|---|---|
| `ZENODO_SANDBOX_TOKEN` | Sandbox access token; sandbox is the default environment. |
| `ZENODO_TOKEN` | Production access token; production must be explicitly requested. |

## Safety model

- Sandbox is the default.
- Production must be explicit.
- Create, upload, update, and delete operate on unpublished drafts only.
- Upload derives the bucket URL from the deposition and validates that it is an HTTPS Zenodo file bucket for the selected environment before sending the authenticated PUT.
- Publishing is separate from draft creation/update/upload and requires the exact confirmation phrase:
  - `publish sandbox deposition <id>`
  - `publish production deposition <id>`
- The skill reproduces the former Pi interactive UX in chat with Markdown metadata tables, access-right questions, license options, and explicit user approval before each mutating step.

## Development

```bash
npm test
npm run pack:check
```

Tests use mocked clients and do not call the live Zenodo API.

## Upstream provenance

This project is derived from `@fbraza/pi-zenodo` version `0.3.0`, which was built for the Pi coding agent. Pi-specific extension registration and rendering were replaced by an Amp plugin adapter while preserving the core Zenodo workflow and validation behavior.
