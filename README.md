# amp-zenodo

Amp-oriented port of [`@fbraza/pi-zenodo`](https://github.com/fbraza/pi-zenodo), preserving the same two-part design:

1. **Zenodo tools** for creating, managing, uploading to, validating, deleting, and optionally publishing Zenodo journal article draft deposits.
2. **A bundled Zenodo skill** that guides conservative draft-first publication deposit workflows from PDFs.

This repository is currently scaffolded for the Amp port. The original Pi extension code has not yet been ported to the Amp plugin API.

## Current contents

```text
.agents/skills/zenodo/
├── SKILL.md
└── references/
    └── zenodo_article_deposit_reference.md
tests/upstream/
├── metadata.test.ts
├── zenodo-client.test.ts
└── zenodo-tools.test.ts
```

The skill and resources were copied from `fbraza/pi-zenodo` and placed under Amp's project skill location, `.agents/skills/`.

The upstream Pi tests are preserved under `tests/upstream/` as a porting contract. They are not expected to pass until the TypeScript implementation has been adapted from Pi's extension API to Amp's plugin API.

## Planned Amp plugin tools

The Amp plugin should preserve the original tool names where possible because the skill is written around them:

- `zenodo_create_draft`
- `zenodo_get_deposition`
- `zenodo_list_depositions`
- `zenodo_list_licenses`
- `zenodo_upload_file`
- `zenodo_update_metadata`
- `zenodo_delete_draft`
- `zenodo_publish_deposition`

## Environment variables

The intended environment variables are inherited from `pi-zenodo`:

| Variable | Purpose |
|---|---|
| `ZENODO_SANDBOX_TOKEN` | Sandbox access token; sandbox is the default environment. |
| `ZENODO_TOKEN` | Production access token; production must be explicitly requested. |

## Porting status

- [x] Repository scaffold created.
- [x] Zenodo skill copied into Amp's project skill location.
- [x] Skill reference copied.
- [x] Upstream Pi tests preserved as porting reference.
- [ ] Zenodo TypeScript logic ported from Pi extension to Amp plugin API.
- [ ] Amp plugin tests added.
- [ ] README updated with final install and usage instructions.

## Upstream provenance

This project is derived from `@fbraza/pi-zenodo` version `0.3.0`, which was built for the Pi coding agent. The upstream package used Pi-specific extension metadata, tool registration, rendering, and packaging. Those parts must be adapted before the tools work in Amp.
