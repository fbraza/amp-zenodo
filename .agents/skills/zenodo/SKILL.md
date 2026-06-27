---
name: zenodo
description: Prepares, validates, uploads, manages, and optionally publishes Zenodo journal article deposits from PDF files. Use when creating Zenodo records for publications or article PDFs.
---

# Zenodo Journal Article Drafts

Use this skill to prepare **unpublished draft Zenodo deposits for journal article PDFs**.

This skill is intentionally conservative: the default workflow creates and manages drafts, then stops. Publishing is available only as a separate, opt-in action after preflight review and exact user confirmation.

Draft-only and sandbox are separate concepts:

- `sandbox` is Zenodo's test environment and is the default.
- `production` is the real Zenodo service and must be explicitly requested.
- `draft-only` means the record remains unpublished. Draft-only operations can happen in sandbox or production.
- A production draft is still a real Zenodo account action, even though it is unpublished.

## Hard Rules

- Default to `environment: "sandbox"` unless the user explicitly requests production.
- If the user requests `environment: "production"`, state clearly that this creates or modifies a real unpublished Zenodo draft.
- Default workflow stops at draft preflight. Do not publish unless the user explicitly asks after reviewing the preflight summary.
- Never auto-publish from create, upload, update, list, or get operations.
- Publishing requires the user to provide the exact confirmation phrase:
  - `publish sandbox deposition <id>`
  - `publish production deposition <id>`
- Do not synthesize, infer, or reuse the confirmation phrase. Wait for the user to type it.
- Production publishing is real and irreversible; files cannot be changed in-place after publication.
- Do not write local files, receipts, manifests, or transformed metadata files.
- Use local files read-only, except for remote Zenodo API actions through the Zenodo tools.
- Never guess access rights, license, embargo date, access conditions, publication date, or grant IDs.
- Treat PDF extraction as candidate metadata, not truth.
- Confirm unresolved or policy-sensitive metadata with the user before calling `zenodo_update_metadata`.
- Use only Zenodo-native article metadata:
  - `upload_type: "publication"`
  - `publication_type: "article"`
- Do not use this v1 workflow for datasets, software, model artifacts, posters, or presentations.

## Available Zenodo Tools

- `zenodo_create_draft`: create an unpublished draft deposition.
- `zenodo_get_deposition`: retrieve a draft/deposition for verification and preflight.
- `zenodo_list_depositions`: find existing drafts or recover interrupted workflows.
- `zenodo_list_licenses`: inspect valid Zenodo license identifiers.
- `zenodo_upload_file`: upload a local file to a draft bucket, deriving the bucket from the deposition ID.
- `zenodo_update_metadata`: validate and update journal article metadata on an unpublished draft.
- `zenodo_delete_draft`: delete an unpublished draft after explicit user request.
- `zenodo_publish_deposition`: publish a draft only after exact confirmation and preflight validation.

Draft-editing and delete tools fail closed unless Zenodo confirms the deposition is an unpublished draft. Publishing also requires an unpublished draft preflight plus the exact confirmation phrase.

## Standard Workflow

1. Read the user-provided article PDF(s).
2. Extract candidate metadata from visible article text and embedded metadata if available.
3. Present extracted article metadata and creators in Markdown tables for user checking.
4. Ask the user to choose the access right: `open`, `embargoed`, `restricted`, or `closed`.
5. If the access right is `open` or `embargoed`, present a short list of recommended Zenodo license identifiers and ask the user to choose one.
6. Ask only for remaining missing, ambiguous, or policy-sensitive fields.
7. Present the final draft plan: environment, file(s), access right, license if any, and final metadata table.
8. Wait for explicit user approval before calling any mutating Zenodo tool.
9. After approval, create or identify the draft, upload file(s), and update metadata.
10. Retrieve the deposition with `zenodo_get_deposition`.
11. Present a preflight summary and stop.

Do not combine these steps into an implicit publish workflow.

## Chat Review and Confirmation UX

Amp does not provide Pi's interactive TUI controls. Reproduce the same safety behavior in chat with Markdown tables, numbered options, and explicit yes/no questions.

Before creating, uploading, updating, deleting, or publishing a Zenodo record, show the user what will happen and wait for a clear confirmation.

For metadata review, render these tables before draft creation or metadata update:

### Candidate Article Metadata

| Field | Candidate value | Source / confidence | Needs user decision? |
|---|---|---|---|
| title | ... | PDF first page / high | no |
| DOI | ... | PDF header / high | no |
| publication_date | ... | article info / medium | yes/no |
| access_right | unset | user policy choice | yes |
| license | unset | user policy choice | yes when open/embargoed |

### Candidate Creators

| Order | Zenodo name | Affiliation | ORCID | Source / confidence | Needs user decision? |
|---:|---|---|---|---|---|
| 1 | Family, Given | ... | ... | PDF author block / high | no |

When access rights are unresolved, ask exactly:

> Which Zenodo access right should I use: `open`, `embargoed`, `restricted`, or `closed`?

If recommending licenses, keep the recommendation transparent and non-binding:

| Option | Zenodo license id | When appropriate |
|---:|---|---|
| 1 | `cc-by-4.0` | Confirmed open-access article under CC BY 4.0 |
| 2 | `cc-by-nc-4.0` | Confirmed non-commercial Creative Commons license |
| 3 | another Zenodo id | User provides a different valid Zenodo license |

Use `zenodo_list_licenses` when the user asks for valid Zenodo license identifiers or when the identifier is uncertain.

Use one concise final confirmation before creating/updating the draft:

- "I will create a sandbox draft, upload `<filename>`, and apply the metadata above. Proceed?"
- "I will update metadata for sandbox deposition `<id>` with the table above. Proceed?"
- "I will delete unpublished sandbox draft `<id>`. Proceed?"

Do not treat vague approval of a previous step as approval for a later mutating step.

## Opt-in Publishing Workflow

Only start publishing after the standard workflow has produced a preflight summary and the user explicitly asks to publish.

1. Restate that publishing is irreversible for files in that record version.
2. For production, state that this is a real Zenodo publication action.
3. Tell the user the exact required confirmation phrase:
   - `publish sandbox deposition <id>` for sandbox
   - `publish production deposition <id>` for production
4. Wait for the user to type that phrase.
5. Call `zenodo_publish_deposition` with the matching `environment`, `deposition_id`, and exact `confirmation`.
6. Report the returned receipt. Do not write a local receipt file.

If the user asks to publish but has not provided the exact phrase, ask for it. Do not fabricate it on the user's behalf.

## Required Metadata for Journal Articles

Prepare this minimum metadata object:

```json
{
  "upload_type": "publication",
  "publication_type": "article",
  "title": "...",
  "publication_date": "YYYY-MM-DD",
  "creators": [
    {
      "name": "Family, Given",
      "affiliation": "optional",
      "orcid": "optional"
    }
  ],
  "description": "Article abstract.",
  "access_right": "open|embargoed|restricted|closed"
}
```

Conditional fields:

- `license` is required when `access_right` is `open` or `embargoed`.
- `embargo_date` is required when `access_right` is `embargoed`.
- `access_conditions` is required when `access_right` is `restricted`.

Optional article fields to include when confidently extracted or confirmed:

- `doi`: publisher DOI for the deposited article.
- `journal_title`
- `journal_volume`
- `journal_issue`
- `journal_pages`
- `keywords`
- `language`, e.g. `eng`
- `grants`, only as confirmed Zenodo/OpenAIRE IDs like `{ "id": "10.13039/501100000780::283595" }`

See `references/zenodo_article_deposit_reference.md` for endpoint and field details.

## PDF Extraction Guidance

Prefer visible article text over embedded PDF metadata. Embedded PDF metadata is often stale, incomplete, or produced by publisher systems.

When extracting:

- Preserve author order.
- Convert names to `Family, Given` only when clear.
- Ask when author inversion is ambiguous.
- Map affiliations to authors only when clearly indicated.
- Prefer the DOI from the first page, article header, or article information block.
- Avoid DOIs from the reference list.
- Prefer the article publication date or online publication date.
- Do not use received or accepted dates as `publication_date`.
- If only a publication year is available, ask whether to use `YYYY-01-01` or provide the exact date.
- Use the abstract as `description`; remove redundant “Abstract” headings and publisher boilerplate.

If the PDF appears scanned or `Read` cannot extract usable text, stop and ask the user for OCR text or the required metadata.

## Article Type Checklist

- Original research: check for abstract, funding, data availability statements, trial or registry identifiers, supplementary files, and research article publication date.
- Review paper: abstract may be unstructured; funding may be sparse; do not invent keywords or grant IDs.
- Letter, comment, correspondence, or editorial: abstract may be absent; ask whether to use the first paragraph or another confirmed summary as `description`.
- Short items may omit issue, pages, or affiliations; ask rather than guessing.
- If the article type is not a journal article, stop and ask whether this v1 skill is appropriate before using `publication_type: "article"`.

## Access Rights and License

Access rights and license are policy/legal choices. Do not infer them from a DOI or from the mere existence of a PDF.

If the PDF says it is open access, present that as a suggestion, not a decision. Use `zenodo_list_licenses` when the user needs a valid license identifier.

Common examples:

- `access_right: "open"` with `license: "cc-by-4.0"` when confirmed.
- `access_right: "closed"` when the PDF can be archived privately but files should not be public.
- `access_right: "embargoed"` only with a confirmed `license` and `embargo_date`.
- `access_right: "restricted"` only with confirmed `access_conditions`.

## Grants and Funding

Zenodo `grants` expects structured OpenAIRE grant IDs, not free-text funding statements.

Do:

- Extract funding statements as candidates.
- Add `grants` only when the exact Zenodo/OpenAIRE grant ID is confirmed.
- Ask the user to provide exact IDs or choose to omit grants.

Do not:

- Invent grant IDs.
- Guess funder DOI prefixes from acronyms.
- Add a free-text `awards` field.
- Put funding acknowledgements into `notes` automatically.

## Preflight Summary

After uploading files and updating metadata, always call `zenodo_get_deposition` and report:

- environment
- deposition ID
- draft URL if available
- title
- creators
- DOI
- publication date
- access right and license
- uploaded filenames, sizes, and checksums if available
- unresolved or omitted metadata, especially affiliations and grants

End by stating that the record is a draft and has not been published.
