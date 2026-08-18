# amp-zenodo

Amp-oriented port of [`@fbraza/pi-zenodo`](https://github.com/fbraza/pi-zenodo), packaged as one self-contained Amp directory plugin:

1. **Zenodo tools** for draft creation, metadata management, file upload, listing, deletion, and explicitly confirmed publishing.
2. **A bundled Zenodo skill** that guides the agent through a conservative, draft-first journal article deposit workflow.

## Current contents

```text
amp-zenodo/
├── index.ts
├── src/
│   ├── metadata.ts
│   ├── zenodo-client.ts
│   └── tools/
├── skills/managing-zenodo-deposits/
│   ├── SKILL.md
│   └── references/
│       └── zenodo_article_deposit_reference.md
└── tests/
    └── amp-zenodo.test.ts
```

The plugin explicitly registers its bundled skill with `amp.registerSkill`. Amp exposes it under the qualified name `amp-zenodo:managing-zenodo-deposits`; there is no separate bare project skill. The skill's `builtin-tools` frontmatter gates all eight plugin tools until the skill is loaded.

## Amp plugin tools

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
- Upload validates that Zenodo returned an HTTPS file bucket for the selected environment before sending credentials or file bytes.
- Publishing is separate from draft management and requires the exact confirmation phrase `publish <environment> deposition <id>`.
- The bundled skill requires metadata review and explicit approval before mutations, then stops after draft preflight unless publishing is separately requested.

## Use in Amp

The repository root is the complete Amp directory plugin package. To publish it through a User or Workspace Plugins repository, copy the repository contents into that plugin repository as an `amp-zenodo/` directory. Keeping the directory intact preserves the implementation, bundled skill, and reference material.

The source repository deliberately does not place the package under `.amp/plugins/`. The `.amp/` directory is ignored so repository-local Amp configuration can remain unversioned.

After installing or publishing the plugin and reloading plugins, inspect the bundled skill with:

```bash
amp skill info amp-zenodo:managing-zenodo-deposits
```

## Develop

```bash
npm test
npm run pack:check
```

Tests use mocked clients and do not call the live Zenodo API.

## Upstream provenance

This project is derived from `@fbraza/pi-zenodo` version `0.3.0`. Pi-specific extension registration and rendering were replaced by Amp's plugin API while preserving the core Zenodo workflow and validation behavior.
