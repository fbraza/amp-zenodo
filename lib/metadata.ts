export const ARTICLE_UPLOAD_TYPE = "publication";
export const ARTICLE_PUBLICATION_TYPE = "article";

export const ARTICLE_ACCESS_RIGHTS = [
	"open",
	"embargoed",
	"restricted",
	"closed",
] as const;

export type ArticleAccessRight = (typeof ARTICLE_ACCESS_RIGHTS)[number];

export type ZenodoCreator = {
	name: string;
	affiliation?: string;
	orcid?: string;
};

export type ZenodoGrant = {
	id: string;
};

export type ZenodoArticleMetadata = {
	upload_type: typeof ARTICLE_UPLOAD_TYPE;
	publication_type: typeof ARTICLE_PUBLICATION_TYPE;
	title: string;
	publication_date: string;
	creators: ZenodoCreator[];
	description: string;
	access_right: ArticleAccessRight;
	license?: string;
	embargo_date?: string;
	access_conditions?: string;
	doi?: string;
	journal_title?: string;
	journal_volume?: string;
	journal_issue?: string;
	journal_pages?: string;
	keywords?: string[];
	language?: string;
	grants?: ZenodoGrant[];
	[key: string]: unknown;
};

export type MetadataValidationIssue = {
	field: string;
	message: string;
};

export type MetadataValidationResult = {
	valid: boolean;
	errors: MetadataValidationIssue[];
};

export function validateArticleMetadata(
	metadata: unknown,
): MetadataValidationResult {
	const errors: MetadataValidationIssue[] = [];
	const record = asRecord(metadata);

	if (!record) {
		return {
			valid: false,
			errors: [
				{
					field: "metadata",
					message: "Metadata must be an object.",
				},
			],
		};
	}

	requireExactValue(
		record,
		"upload_type",
		ARTICLE_UPLOAD_TYPE,
		"Article deposits must use upload_type \"publication\".",
		errors,
	);
	requireExactValue(
		record,
		"publication_type",
		ARTICLE_PUBLICATION_TYPE,
		"Journal article deposits must use publication_type \"article\".",
		errors,
	);
	requireNonEmptyString(record, "title", errors);
	requireIsoDate(record, "publication_date", errors);
	requireNonEmptyString(record, "description", errors);
	validateCreators(record.creators, errors);
	validateAccessRight(record, errors);
	validateOptionalNonEmptyString(record, "doi", errors);
	validateOptionalNonEmptyString(record, "journal_title", errors);
	validateOptionalNonEmptyString(record, "journal_volume", errors);
	validateOptionalNonEmptyString(record, "journal_issue", errors);
	validateOptionalNonEmptyString(record, "journal_pages", errors);
	validateOptionalNonEmptyString(record, "language", errors);
	validateKeywords(record.keywords, errors);
	validateGrants(record.grants, errors);

	return { valid: errors.length === 0, errors };
}

export function assertValidArticleMetadata(
	metadata: unknown,
): asserts metadata is ZenodoArticleMetadata {
	const result = validateArticleMetadata(metadata);
	if (!result.valid) {
		throw new MetadataValidationError(result.errors);
	}
}

export class MetadataValidationError extends Error {
	readonly errors: MetadataValidationIssue[];

	constructor(errors: MetadataValidationIssue[]) {
		super(formatMetadataValidationErrors(errors));
		this.name = "MetadataValidationError";
		this.errors = errors;
	}
}

export function formatMetadataValidationErrors(
	errors: MetadataValidationIssue[],
): string {
	if (errors.length === 0) return "Metadata is valid.";
	return errors.map((error) => `${error.field}: ${error.message}`).join("\n");
}

function validateCreators(
	creators: unknown,
	errors: MetadataValidationIssue[],
): void {
	if (!Array.isArray(creators) || creators.length === 0) {
		errors.push({
			field: "creators",
			message: "At least one creator is required.",
		});
		return;
	}

	creators.forEach((creator, index) => {
		const field = `creators.${index}`;
		const record = asRecord(creator);
		if (!record) {
			errors.push({ field, message: "Creator must be an object." });
			return;
		}
		requireNonEmptyString(record, `${field}.name`, errors, "name");
		validateOptionalNonEmptyString(record, `${field}.affiliation`, errors, "affiliation");
		validateOptionalNonEmptyString(record, `${field}.orcid`, errors, "orcid");
	});
}

function validateAccessRight(
	record: Record<string, unknown>,
	errors: MetadataValidationIssue[],
): void {
	const accessRight = record.access_right;
	if (
		typeof accessRight !== "string" ||
		!ARTICLE_ACCESS_RIGHTS.includes(accessRight as ArticleAccessRight)
	) {
		errors.push({
			field: "access_right",
			message: `Access right must be one of: ${ARTICLE_ACCESS_RIGHTS.join(", ")}.`,
		});
		return;
	}

	if (accessRight === "open" || accessRight === "embargoed") {
		requireNonEmptyString(record, "license", errors);
	} else {
		validateOptionalNonEmptyString(record, "license", errors);
	}

	if (accessRight === "embargoed") {
		requireIsoDate(record, "embargo_date", errors);
	} else {
		validateOptionalNonEmptyString(record, "embargo_date", errors);
	}

	if (accessRight === "restricted") {
		requireNonEmptyString(record, "access_conditions", errors);
	} else {
		validateOptionalNonEmptyString(record, "access_conditions", errors);
	}
}

function validateKeywords(
	keywords: unknown,
	errors: MetadataValidationIssue[],
): void {
	if (keywords === undefined) return;
	if (!Array.isArray(keywords)) {
		errors.push({ field: "keywords", message: "Keywords must be an array." });
		return;
	}
	keywords.forEach((keyword, index) => {
		if (!isNonEmptyString(keyword)) {
			errors.push({
				field: `keywords.${index}`,
				message: "Keyword must be a non-empty string.",
			});
		}
	});
}

function validateGrants(
	grants: unknown,
	errors: MetadataValidationIssue[],
): void {
	if (grants === undefined) return;
	if (!Array.isArray(grants)) {
		errors.push({ field: "grants", message: "Grants must be an array." });
		return;
	}
	grants.forEach((grant, index) => {
		const field = `grants.${index}`;
		const record = asRecord(grant);
		if (!record) {
			errors.push({ field, message: "Grant must be an object." });
			return;
		}
		requireNonEmptyString(record, `${field}.id`, errors, "id");
	});
}

function requireExactValue(
	record: Record<string, unknown>,
	field: string,
	expected: string,
	message: string,
	errors: MetadataValidationIssue[],
): void {
	if (record[field] !== expected) {
		errors.push({ field, message });
	}
}

function requireNonEmptyString(
	record: Record<string, unknown>,
	field: string,
	errors: MetadataValidationIssue[],
	key = field,
): void {
	if (!isNonEmptyString(record[key])) {
		errors.push({ field, message: "A non-empty string is required." });
	}
}

function validateOptionalNonEmptyString(
	record: Record<string, unknown>,
	field: string,
	errors: MetadataValidationIssue[],
	key = field,
): void {
	const value = record[key];
	if (value !== undefined && !isNonEmptyString(value)) {
		errors.push({
			field,
			message: "Value must be a non-empty string when provided.",
		});
	}
}

function requireIsoDate(
	record: Record<string, unknown>,
	field: string,
	errors: MetadataValidationIssue[],
	key = field,
): void {
	const value = record[key];
	if (!isIsoDate(value)) {
		errors.push({
			field,
			message: "Date must be a valid ISO date in YYYY-MM-DD format.",
		});
	}
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}
