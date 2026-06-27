import assert from "node:assert/strict";
import test from "node:test";
import {
	MetadataValidationError,
	assertValidArticleMetadata,
	formatMetadataValidationErrors,
	validateArticleMetadata,
} from "../src/metadata.ts";

function validArticleMetadata(overrides: Record<string, unknown> = {}) {
	return {
		upload_type: "publication",
		publication_type: "article",
		title: "Prime role of IL-17A in neutrophilia",
		publication_date: "2015-01-15",
		creators: [
			{
				name: "Chesné, Julie",
				affiliation: "Université de Nantes",
			},
		],
		description: "An article abstract extracted from the PDF.",
		access_right: "open",
		license: "cc-by-4.0",
		doi: "10.1234/example.article",
		journal_title: "Example Journal",
		journal_volume: "10",
		journal_issue: "2",
		journal_pages: "1-12",
		keywords: ["asthma", "IL-17A"],
		language: "eng",
		grants: [{ id: "10.13039/501100000780::283595" }],
		...overrides,
	};
}

function fieldsFor(metadata: unknown): string[] {
	return validateArticleMetadata(metadata).errors.map((error) => error.field);
}

test("accepts valid Zenodo journal article metadata", () => {
	const result = validateArticleMetadata(validArticleMetadata());
	assert.equal(result.valid, true);
	assert.deepEqual(result.errors, []);
});

test("requires publication/article Zenodo types", () => {
	const fields = fieldsFor(
		validArticleMetadata({
			upload_type: "dataset",
			publication_type: "preprint",
		}),
	);
	assert.deepEqual(fields, ["upload_type", "publication_type"]);
});

test("requires core article metadata fields", () => {
	const fields = fieldsFor({
		upload_type: "publication",
		publication_type: "article",
		title: " ",
		publication_date: "2015",
		creators: [],
		description: "",
		access_right: "closed",
	});

	assert.deepEqual(fields, [
		"title",
		"publication_date",
		"description",
		"creators",
	]);
});

test("requires creator names and validates optional creator fields", () => {
	const fields = fieldsFor(
		validArticleMetadata({
			creators: [{ name: "", affiliation: "", orcid: false }],
		}),
	);

	assert.deepEqual(fields, [
		"creators.0.name",
		"creators.0.affiliation",
		"creators.0.orcid",
	]);
});

test("rejects empty optional article strings", () => {
	const fields = fieldsFor(
		validArticleMetadata({
			access_right: "closed",
			license: "",
			embargo_date: "",
			access_conditions: "",
			doi: "",
			journal_title: " ",
			journal_volume: "",
			journal_issue: "",
			journal_pages: "",
			language: "",
		}),
	);

	assert.deepEqual(fields, [
		"license",
		"embargo_date",
		"access_conditions",
		"doi",
		"journal_title",
		"journal_volume",
		"journal_issue",
		"journal_pages",
		"language",
	]);
});

test("requires license for open and embargoed articles", () => {
	assert.deepEqual(fieldsFor(validArticleMetadata({ license: undefined })), [
		"license",
	]);

	assert.deepEqual(
		fieldsFor(
			validArticleMetadata({
				access_right: "embargoed",
				license: "",
				embargo_date: "2026-12-01",
			}),
		),
		["license"],
	);
});

test("requires embargo date for embargoed articles", () => {
	assert.deepEqual(
		fieldsFor(
			validArticleMetadata({
				access_right: "embargoed",
				embargo_date: undefined,
			}),
		),
		["embargo_date"],
	);
});

test("requires access conditions for restricted articles", () => {
	assert.deepEqual(
		fieldsFor(
			validArticleMetadata({
				access_right: "restricted",
				license: undefined,
			}),
		),
		["access_conditions"],
	);
});

test("rejects invalid access rights", () => {
	assert.deepEqual(fieldsFor(validArticleMetadata({ access_right: "public" })), [
		"access_right",
	]);
});

test("validates optional keywords and grants shape", () => {
	const fields = fieldsFor(
		validArticleMetadata({
			keywords: ["valid", ""],
			grants: [{ id: "" }, "free text award"],
		}),
	);

	assert.deepEqual(fields, ["keywords.1", "grants.0.id", "grants.1"]);
});

test("rejects invalid calendar dates", () => {
	assert.deepEqual(
		fieldsFor(validArticleMetadata({ publication_date: "2024-02-30" })),
		["publication_date"],
	);
});

test("throws a formatted validation error from assertion helper", () => {
	assert.throws(
		() => assertValidArticleMetadata(validArticleMetadata({ title: "" })),
		(error: unknown) => {
			assert.ok(error instanceof MetadataValidationError);
			assert.match(error.message, /title: A non-empty string is required\./);
			return true;
		},
	);
});

test("formats validation issues for tool output", () => {
	assert.equal(formatMetadataValidationErrors([]), "Metadata is valid.");
	assert.equal(
		formatMetadataValidationErrors([
			{ field: "title", message: "A non-empty string is required." },
		]),
		"title: A non-empty string is required.",
	);
});
