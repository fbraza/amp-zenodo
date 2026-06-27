# amp-zenodo Pi-to-Amp Porting Plan

## Purpose

Port [`@fbraza/pi-zenodo`](https://github.com/fbraza/pi-zenodo) into this repository as an Amp plugin plus bundled Amp skill.

The port should preserve the original conservative Zenodo workflow:

- sandbox by default;
- production only when explicitly requested;
- unpublished draft-first workflow;
- strict journal article metadata validation;
- safe upload/update/delete checks on unpublished drafts;
- publish only after exact user confirmation and preflight validation.

## Current scaffold

Already present:

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

The upstream Pi tests are preserved as a porting contract and should not be run directly by the Amp test script.

## Target architecture

```text
.amp/plugins/amp-zenodo.ts       # Amp adapter only
src/
├── metadata.ts                  # host-independent metadata validation
├── zenodo-client.ts             # host-independent Zenodo client
└── tools/                       # host-independent Zenodo operations
    ├── create-draft.ts
    ├── delete-draft.ts
    ├── get-deposition.ts
    ├── list-depositions.ts
    ├── list-licenses.ts
    ├── publish-deposition.ts
    ├── shared.ts
    ├── update-metadata.ts
    └── upload-file.ts
tests/*.test.ts                  # Amp-adapted runnable tests
tests/upstream/*.test.ts         # preserved Pi tests, not run
```

Keep three layers separate:

1. `src/metadata.ts`, `src/zenodo-client.ts`, `src/tools/*.ts`
   - no Amp or Pi APIs;
   - reusable business logic;
   - testable with fake clients.

2. `.amp/plugins/amp-zenodo.ts`
   - Amp `registerTool` calls;
   - JSON Schema input descriptions;
   - explicit runtime input parsing;
   - JSON string result wrapping.

3. `.agents/skills/zenodo/`
   - agent instructions and references only;
   - no network/API implementation.

## Tools to expose

Preserve the original Pi tool names:

- `zenodo_create_draft`
- `zenodo_get_deposition`
- `zenodo_list_depositions`
- `zenodo_list_licenses`
- `zenodo_upload_file`
- `zenodo_update_metadata`
- `zenodo_delete_draft`
- `zenodo_publish_deposition`

The skill is written around these names, so changing them would require skill edits and would break compatibility with prior usage.

## Reusable upstream logic

### `metadata.ts`

Copy/adapt almost directly:

- `ZenodoArticleMetadata`
- `validateArticleMetadata`
- `assertValidArticleMetadata`
- `MetadataValidationError`
- `formatMetadataValidationErrors`

Preserve validation behavior:

- `upload_type` must be `publication`;
- `publication_type` must be `article`;
- title, publication date, creators, description, and access right are required;
- publication date must be a real `YYYY-MM-DD` date;
- `license` required for `open` or `embargoed`;
- `embargo_date` required for `embargoed`;
- `access_conditions` required for `restricted`;
- optional strings, keywords, and grants must have valid shape.

### `zenodo-client.ts`

Keep the upstream client shape initially:

- `ZenodoEnvironment = "sandbox" | "production"`
- sandbox base URL: `https://sandbox.zenodo.org/api`
- production base URL: `https://zenodo.org/api`
- `ZENODO_SANDBOX_TOKEN`
- `ZENODO_TOKEN`
- bearer auth;
- normalized `ZenodoApiError`.

Keep `axios` for v1 to minimize port risk and preserve upstream tests. Treat it as a real runtime dependency, not an implementation detail.

If axios cannot resolve or file upload streaming fails under Amp's runtime, then migrate to native `fetch` later.

### `src/tools/*.ts`

Copy/adapt core functions only. Do not copy Pi tool factories, Pi registrars, TypeBox schemas, renderers, or TUI output.

Preserve core functions:

- `createZenodoDraft`
- `getZenodoDeposition`
- `listZenodoDepositions`
- `listZenodoLicenses`
- `uploadZenodoFile`
- `updateZenodoMetadata`
- `deleteZenodoDraft`
- `publishZenodoDeposition`

Preserve shared helpers:

- positive integer validation;
- page/size validation;
- optional query normalization;
- unpublished draft assertion.

## Amp plugin adapter design

Add:

```text
.amp/plugins/amp-zenodo.ts
```

Use injectable registration for tests:

```ts
export function registerZenodoTools(amp: PluginAPI, options: ZenodoToolOptions = {}) {
  amp.registerTool({
    name: "zenodo_get_deposition",
    description: "...",
    inputSchema: getDepositionInputSchema,
    async execute(input, ctx) {
      return jsonResult({
        tool: "zenodo_get_deposition",
        ...(await getZenodoDeposition(parseGetDepositionInput(input), getSignal(ctx), options)),
      })
    },
  })
}

export default function ampZenodoPlugin(amp: PluginAPI) {
  registerZenodoTools(amp)
}
```

This allows tests to register tools with fake clients without ESM monkeypatching or live tokens.

## Runtime input parsing

Do not trust JSON Schema alone. Every Amp tool must parse `Record<string, unknown>` at runtime before calling core functions.

Parsers should enforce:

- `environment`: absent defaults to `sandbox`; present must be exactly `sandbox` or `production`;
- `deposition_id`: safe positive integer;
- `page`: safe positive integer;
- `size`: integer `1..100`;
- `q`: optional non-empty string;
- `status`: `draft` or `published`;
- `sort`: `bestmatch`, `mostrecent`, or `-mostrecent`;
- `all_versions`: optional boolean for `zenodo_list_depositions`;
- `local_path`: non-empty string;
- `remote_filename`: optional safe basename only;
- `content_type`: if provided, must be `application/octet-stream`;
- `metadata`: object, then validated by `assertValidArticleMetadata` where required;
- `confirmation`: string; exact phrase validation stays in the publish core function.

Invalid `environment` and invalid publish confirmation should fail before token lookup or network/client creation.

## JSON Schema input contracts

Define plain JSON Schema objects for Amp:

- no TypeBox runtime dependency;
- top-level `type: "object"`;
- `required` fields where applicable;
- enums for `environment`, `status`, `sort`;
- integer constraints for IDs/pages/sizes;
- `metadata: { type: "object" }` while keeping runtime validation as source of truth;
- use `additionalProperties: false` if supported by Amp's plugin schema handling.

## Result shape

Amp tools return a string or content blocks, not Pi `{ content, details }`.

Return JSON strings:

```ts
JSON.stringify({ tool, environment, ...result }, null, 2)
```

Include enough fields for the agent to reason safely:

- tool name;
- environment;
- deposition ID;
- Zenodo response object or receipt;
- uploaded filename and size;
- validation/preflight details;
- publish receipt.

Do not reintroduce Pi `renderResult`, `label`, `parameters`, `textResult`, or TUI `Text`.

## Safety invariants to preserve or strengthen

### Environment and tokens

- Sandbox is default.
- Production must be explicitly requested by `environment: "production"`.
- Tokens are read from env vars:
  - `ZENODO_SANDBOX_TOKEN`
  - `ZENODO_TOKEN`
- Tokens must be sent only as bearer auth headers, never as URL query parameters.

### Draft mutation safety

For update, upload, delete, and publish preflight:

- fetch deposition first;
- require Zenodo to confirm it is an unpublished draft;
- upstream behavior requires `submitted === false` and rejects `state === "done"`.

Prefer safer Amp behavior if compatible with Zenodo responses:

- require `submitted === false`;
- if `state` is present, require `state === "unsubmitted"`.

If this stricter check breaks known valid Zenodo draft states, revert to upstream parity and document the reason.

### Metadata safety

- `createZenodoDraft` validates metadata if metadata is provided.
- `updateZenodoMetadata` validates metadata and only updates an unpublished draft.
- Publish preflight validates server-side deposition metadata before publishing.

### Upload safety

Preserve upstream checks:

- local path is non-empty;
- local path exists and is a regular file;
- file size is at most 50 GB;
- draft has fewer than 100 files;
- remote filename cannot contain path separators;
- content type, if provided, must be `application/octet-stream`;
- bucket URL is derived from Zenodo deposition response, not user input;
- uploaded size is checked if returned.

Strengthen upstream behavior with bucket URL validation before `PUT`:

- protocol must be `https:`;
- origin must match the selected environment:
  - sandbox: `https://sandbox.zenodo.org`
  - production: `https://zenodo.org`
- path should match Zenodo file bucket shape, e.g. `/api/files/...`;
- only then append `encodeURIComponent(remoteFilename)`.

This avoids bearer-token leakage if a malformed or malicious response contains an off-origin bucket URL.

### Publish safety

- Publish requires exact confirmation phrase:
  - `publish sandbox deposition <id>`
  - `publish production deposition <id>`
- Confirmation mismatch must fail before token lookup or network/client creation.
- Preflight must require:
  - response ID matches requested ID;
  - unpublished draft;
  - at least one uploaded file;
  - valid journal article metadata.
- Publish response ID must match requested ID.

### Delete safety

Preserve upstream behavior: delete only unpublished drafts.

Potential stricter future option: add a delete confirmation phrase. Do not add it in the first port unless intentionally changing the public schema.

## Skill/reference adaptation

The scaffold already removed Pi `allowed-tools` and `starting-prompt` frontmatter.

Before implementation is complete:

- audit `SKILL.md` for Pi-specific built-in names such as `Read`, `WebFetch`, and `WebSearch`;
- replace with Amp-neutral wording, e.g. “if Amp cannot extract usable text from the PDF...”;
- keep all Zenodo safety rules intact;
- keep custom tool names stable;
- update reference wording that describes Pi-style “structured details” if present, because Amp tools return JSON strings.

## Tests

Keep upstream Pi tests under:

```text
tests/upstream/
```

Do not include them in the runnable test script.

Add Amp-adapted tests under:

```text
tests/*.test.ts
```

Test categories:

1. Metadata validation parity.
2. Zenodo client token selection and error normalization with mocked axios/fake client.
3. Core tool endpoint and safety behavior with fake clients.
4. Amp plugin registration smoke test:
   - exactly eight tool names;
   - `inputSchema` exists;
   - no Pi-only `parameters`, `renderResult`, or `label`.
5. Amp plugin execution test with injected fake client:
   - output is parseable JSON;
   - includes `tool` and `environment`.
6. Boundary/safety tests:
   - invalid `environment` rejected before token lookup/network;
   - wrong publish confirmation rejected before token lookup/network;
   - `all_versions` preserved in `zenodo_list_depositions` query;
   - upload rejects off-origin bucket URL before `PUT`;
   - upload rejects unsafe remote filenames;
   - delete/update/upload reject submitted/published depositions;
   - publish preflight rejects missing files or invalid metadata.
7. Source hygiene test or equivalent assertion that runnable source does not import/use:
   - `@earendil-works/*`;
   - `typebox`;
   - `renderResult`;
   - Pi `parameters` fields;
   - Pi `label` fields.

No live Zenodo calls in unit tests.

## Package metadata

After implementation, update `package.json`:

```json
{
  "files": [".amp", ".agents", "src", "tests", "README.md", "LICENSE"],
  "dependencies": {
    "axios": "^1.7.9"
  },
  "scripts": {
    "test": "node --experimental-strip-types --test tests/*.test.ts",
    "pack:check": "npm pack --dry-run"
  }
}
```

Keeping axios means users must run `npm install` before reloading the plugin in a local project checkout.

## README updates after implementation

Document:

- local Amp plugin usage;
- `plugins: reload`;
- tool names;
- environment variables;
- sandbox default and production warning;
- no production test should be run unless explicitly requested;
- upstream tests are preserved but not run;
- global installation will be handled later through the plugin manager.

## Verification

Required:

```bash
npm test
npm run pack:check
```

Optional manual check:

- sandbox-only smoke test if `ZENODO_SANDBOX_TOKEN` is configured;
- never run production operations unless explicitly requested.

Manual upload verification should confirm axios/file streaming works in Amp's plugin runtime. If not, migrate upload/client implementation to native `fetch` without buffering large files.

## Safe to defer

- Migrating from axios to `fetch`.
- Rich rendering/content blocks.
- Result compaction/truncation.
- Deep JSON Schema for full article metadata.
- Live Zenodo integration tests.
- Delete confirmation phrase.
- Global plugin-manager installation.
- Installing by tag/SHA instead of branch head.
- Automatic update checks.
