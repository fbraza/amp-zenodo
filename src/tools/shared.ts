import type { CreateZenodoClientOptions, ZenodoClient } from "../zenodo-client.ts";

export type ZenodoToolOptions = {
	createClient?: (options?: CreateZenodoClientOptions) => ZenodoClient;
};

export type ZenodoDeposition = Record<string, unknown> & {
	id?: number;
	links?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
	state?: string;
	submitted?: boolean;
};

export function assertPositiveInteger(value: number, field: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${field} must be a positive integer.`);
	}
}

export function assertPageSize(page?: number, size?: number): void {
	if (page !== undefined) assertPositiveInteger(page, "page");
	if (size !== undefined && (!Number.isInteger(size) || size < 1 || size > 100)) {
		throw new Error("size must be an integer between 1 and 100.");
	}
}

export function assertUnsubmittedDraft(
	deposition: ZenodoDeposition,
	action: string,
): void {
	if (
		deposition.submitted !== false ||
		deposition.state === "done" ||
		(deposition.state !== undefined && deposition.state !== "unsubmitted")
	) {
		throw new Error(
			`Cannot ${action}: Zenodo deposition is submitted/published or was not confirmed as an unpublished draft.`,
		);
	}
}

export function normalizeOptionalQuery(value: string | undefined, field: string): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${field} must be non-empty when provided.`);
	return trimmed;
}
