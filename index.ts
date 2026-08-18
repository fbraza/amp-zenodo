import type { PluginAPI } from "@ampcode/plugin"

import type { ZenodoArticleMetadata } from "./lib/metadata.ts"
import { assertValidArticleMetadata } from "./lib/metadata.ts"
import { createZenodoDraft } from "./lib/tools/create-draft.ts"
import { deleteZenodoDraft } from "./lib/tools/delete-draft.ts"
import { getZenodoDeposition } from "./lib/tools/get-deposition.ts"
import { listZenodoDepositions } from "./lib/tools/list-depositions.ts"
import { listZenodoLicenses } from "./lib/tools/list-licenses.ts"
import { publishZenodoDeposition } from "./lib/tools/publish-deposition.ts"
import type { ZenodoToolOptions } from "./lib/tools/shared.ts"
import { normalizeRemoteFilename } from "./lib/tools/upload-file.ts"
import { uploadZenodoFile } from "./lib/tools/upload-file.ts"
import { updateZenodoMetadata } from "./lib/tools/update-metadata.ts"
import type { ZenodoEnvironment } from "./lib/zenodo-client.ts"

export const description = "Manages conservative Zenodo journal article deposit workflows and bundles guided draft, metadata, upload, and publishing instructions."

type ZenodoToolRegistrar = {
	logger?: { log: (...args: unknown[]) => void }
	registerTool: (definition: PluginToolDefinition) => unknown
}

type PluginToolDefinition = {
	name: string
	description: string
	inputSchema: { type: "object"; properties?: Record<string, object>; required?: string[]; [key: string]: unknown }
	execute: (input: unknown, ctx?: unknown) => Promise<string>
}

function jsonResult(value: unknown): string {
	return JSON.stringify(value, null, 2)
}

const environmentProperty = { type: "string", enum: ["sandbox", "production"], description: "Zenodo environment. Defaults to sandbox." }
const depositionIdProperty = { type: "integer", minimum: 1, description: "Zenodo deposition draft/version id." }

const schemas = {
	createDraft: {
		type: "object" as const,
		additionalProperties: false,
		properties: {
			environment: environmentProperty,
			metadata: { type: "object", description: "Optional validated Zenodo journal article metadata." },
		},
	},
	getDeposition: {
		type: "object" as const,
		additionalProperties: false,
		properties: { environment: environmentProperty, deposition_id: depositionIdProperty },
		required: ["deposition_id"],
	},
	listDepositions: {
		type: "object" as const,
		additionalProperties: false,
		properties: {
			environment: environmentProperty,
			status: { type: "string", enum: ["draft", "published"], description: "Optional deposition status filter." },
			q: { type: "string", description: "Optional Zenodo deposition search query." },
			sort: { type: "string", enum: ["bestmatch", "mostrecent", "-mostrecent"], description: "Optional Zenodo sort order." },
			page: { type: "integer", minimum: 1, description: "Page number." },
			size: { type: "integer", minimum: 1, maximum: 100, description: "Page size, maximum 100." },
			all_versions: { type: "boolean", description: "Whether to include all record versions." },
		},
	},
	listLicenses: {
		type: "object" as const,
		additionalProperties: false,
		properties: {
			environment: environmentProperty,
			q: { type: "string", description: "Optional license search query." },
			page: { type: "integer", minimum: 1, description: "Page number." },
			size: { type: "integer", minimum: 1, maximum: 100, description: "Page size, maximum 100." },
		},
	},
	uploadFile: {
		type: "object" as const,
		additionalProperties: false,
		properties: {
			environment: environmentProperty,
			deposition_id: depositionIdProperty,
			local_path: { type: "string", description: "Path to the local file to upload." },
			remote_filename: { type: "string", description: "Optional filename to use on Zenodo. Defaults to local basename." },
			content_type: { type: "string", description: "Optional upload content type. Must be application/octet-stream if provided." },
		},
		required: ["deposition_id", "local_path"],
	},
	updateMetadata: {
		type: "object" as const,
		additionalProperties: false,
		properties: { environment: environmentProperty, deposition_id: depositionIdProperty, metadata: { type: "object", description: "Validated Zenodo journal article metadata." } },
		required: ["deposition_id", "metadata"],
	},
	deleteDraft: {
		type: "object" as const,
		additionalProperties: false,
		properties: { environment: environmentProperty, deposition_id: depositionIdProperty },
		required: ["deposition_id"],
	},
	publishDeposition: {
		type: "object" as const,
		additionalProperties: false,
		properties: {
			environment: environmentProperty,
			deposition_id: { type: "integer", minimum: 1, description: "Zenodo unpublished draft deposition id to publish." },
			confirmation: { type: "string", description: "Exact phrase: publish sandbox deposition <id> or publish production deposition <id>." },
		},
		required: ["deposition_id", "confirmation"],
	},
}

export function registerZenodoTools(amp: ZenodoToolRegistrar, options: ZenodoToolOptions = {}) {
	amp.registerTool({
		name: "zenodo_create_draft",
		description: "Create an unpublished Zenodo deposition draft. Defaults to sandbox and optionally accepts validated journal article metadata.",
		inputSchema: schemas.createDraft,
		async execute(input) {
			const params = parseCreateDraftInput(parseInputObject(input))
			return jsonResult({ tool: "zenodo_create_draft", ...(await createZenodoDraft(params, undefined, options)) })
		},
	})
	amp.registerTool({
		name: "zenodo_get_deposition",
		description: "Retrieve a Zenodo deposition draft/version by id for recovery, verification, and preflight checks.",
		inputSchema: schemas.getDeposition,
		async execute(input) {
			const params = parseDepositionIdInput(parseInputObject(input))
			return jsonResult({ tool: "zenodo_get_deposition", ...(await getZenodoDeposition(params, undefined, options)) })
		},
	})
	amp.registerTool({
		name: "zenodo_list_depositions",
		description: "List Zenodo depositions for the authenticated user. Defaults to sandbox and supports draft/published filtering.",
		inputSchema: schemas.listDepositions,
		async execute(input) {
			const params = parseListDepositionsInput(parseInputObject(input))
			return jsonResult({ tool: "zenodo_list_depositions", ...(await listZenodoDepositions(params, undefined, options)) })
		},
	})
	amp.registerTool({
		name: "zenodo_list_licenses",
		description: "List Zenodo license identifiers for selecting article access/license metadata. Defaults to sandbox.",
		inputSchema: schemas.listLicenses,
		async execute(input) {
			const params = parseListLicensesInput(parseInputObject(input))
			return jsonResult({ tool: "zenodo_list_licenses", ...(await listZenodoLicenses(params, undefined, options)) })
		},
	})
	amp.registerTool({
		name: "zenodo_upload_file",
		description: "Upload a local PDF or file to a Zenodo draft deposition bucket. Defaults to sandbox and derives the bucket URL from the deposition id.",
		inputSchema: schemas.uploadFile,
		async execute(input) {
			const params = parseUploadFileInput(parseInputObject(input))
			return jsonResult({ tool: "zenodo_upload_file", ...(await uploadZenodoFile(params, undefined, options)) })
		},
	})
	amp.registerTool({
		name: "zenodo_update_metadata",
		description: "Validate and update metadata for a Zenodo journal article draft deposition. Defaults to sandbox.",
		inputSchema: schemas.updateMetadata,
		async execute(input) {
			const params = parseUpdateMetadataInput(parseInputObject(input))
			return jsonResult({ tool: "zenodo_update_metadata", ...(await updateZenodoMetadata(params, undefined, options)) })
		},
	})
	amp.registerTool({
		name: "zenodo_delete_draft",
		description: "Delete an unpublished Zenodo draft deposition after verifying it has not been submitted or published. Defaults to sandbox.",
		inputSchema: schemas.deleteDraft,
		async execute(input) {
			const params = parseDepositionIdInput(parseInputObject(input))
			return jsonResult({ tool: "zenodo_delete_draft", ...(await deleteZenodoDraft(params, undefined, options)) })
		},
	})
	amp.registerTool({
		name: "zenodo_publish_deposition",
		description: "Publish a Zenodo draft deposition after exact confirmation and preflight validation. Defaults to sandbox.",
		inputSchema: schemas.publishDeposition,
		async execute(input) {
			const params = parsePublishInput(parseInputObject(input))
			return jsonResult({ tool: "zenodo_publish_deposition", ...(await publishZenodoDeposition(params, undefined, options)) })
		},
	})
	amp.logger?.log?.("amp-zenodo plugin registered Zenodo tools")
}

export default async function ampZenodoPlugin(amp: PluginAPI) {
	registerZenodoTools(amp as unknown as ZenodoToolRegistrar)
	await amp.registerSkill({ path: "skills/managing-zenodo-deposits" })
	amp.logger.log("amp-zenodo plugin registered managing-zenodo-deposits and its Zenodo tools")
}

function parseInputObject(input: unknown): Record<string, unknown> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("tool input must be an object.")
	return input as Record<string, unknown>
}

function parseEnvironment(input: Record<string, unknown>): ZenodoEnvironment {
	const value = input.environment
	if (value === undefined) return "sandbox"
	if (value === "sandbox" || value === "production") return value
	throw new Error("environment must be sandbox or production.")
}

function parsePositiveInteger(input: Record<string, unknown>, key: string): number {
	const value = input[key]
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer.`)
	return value
}

function parseOptionalInteger(input: Record<string, unknown>, key: string, min: number, max?: number): number | undefined {
	const value = input[key]
	if (value === undefined) return undefined
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
		throw new Error(max === undefined ? `${key} must be an integer >= ${min}.` : `${key} must be an integer between ${min} and ${max}.`)
	}
	return value
}

function parseOptionalString(input: Record<string, unknown>, key: string): string | undefined {
	const value = input[key]
	if (value === undefined) return undefined
	if (typeof value !== "string") throw new Error(`${key} must be a string.`)
	const trimmed = value.trim()
	if (!trimmed) throw new Error(`${key} must be non-empty when provided.`)
	return trimmed
}

function parseString(input: Record<string, unknown>, key: string): string {
	const value = parseOptionalString(input, key)
	if (value === undefined) throw new Error(`${key} is required.`)
	return value
}

function parseOptionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
	const value = input[key]
	if (value === undefined) return undefined
	if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`)
	return value
}

function parseOptionalEnum<T extends string>(input: Record<string, unknown>, key: string, values: readonly T[]): T | undefined {
	const value = input[key]
	if (value === undefined) return undefined
	if (typeof value === "string" && values.includes(value as T)) return value as T
	throw new Error(`${key} must be one of: ${values.join(", ")}.`)
}

function parseMetadata(input: Record<string, unknown>, required: boolean): ZenodoArticleMetadata | undefined {
	const value = input.metadata
	if (value === undefined) {
		if (required) throw new Error("metadata is required.")
		return undefined
	}
	assertValidArticleMetadata(value)
	return value
}

function parseCreateDraftInput(input: Record<string, unknown>) {
	return { environment: parseEnvironment(input), metadata: parseMetadata(input, false) }
}

function parseDepositionIdInput(input: Record<string, unknown>) {
	return { environment: parseEnvironment(input), deposition_id: parsePositiveInteger(input, "deposition_id") }
}

function parseListDepositionsInput(input: Record<string, unknown>) {
	return {
		environment: parseEnvironment(input),
		status: parseOptionalEnum(input, "status", ["draft", "published"]),
		q: parseOptionalString(input, "q"),
		sort: parseOptionalEnum(input, "sort", ["bestmatch", "mostrecent", "-mostrecent"]),
		page: parseOptionalInteger(input, "page", 1),
		size: parseOptionalInteger(input, "size", 1, 100),
		all_versions: parseOptionalBoolean(input, "all_versions"),
	}
}

function parseListLicensesInput(input: Record<string, unknown>) {
	return { environment: parseEnvironment(input), q: parseOptionalString(input, "q"), page: parseOptionalInteger(input, "page", 1), size: parseOptionalInteger(input, "size", 1, 100) }
}

function parseUploadFileInput(input: Record<string, unknown>) {
	const remoteFilename = parseOptionalString(input, "remote_filename")
	if (remoteFilename !== undefined) normalizeRemoteFilename(remoteFilename)
	const contentType = parseOptionalString(input, "content_type")
	if (contentType !== undefined && contentType !== "application/octet-stream") throw new Error("Zenodo bucket uploads require content_type application/octet-stream.")
	return {
		environment: parseEnvironment(input),
		deposition_id: parsePositiveInteger(input, "deposition_id"),
		local_path: parseString(input, "local_path"),
		remote_filename: remoteFilename,
		content_type: contentType,
	}
}

function parseUpdateMetadataInput(input: Record<string, unknown>) {
	return { environment: parseEnvironment(input), deposition_id: parsePositiveInteger(input, "deposition_id"), metadata: parseMetadata(input, true)! }
}

function parsePublishInput(input: Record<string, unknown>) {
	const environment = parseEnvironment(input)
	const depositionId = parsePositiveInteger(input, "deposition_id")
	const confirmation = parseString(input, "confirmation")
	const expectedConfirmation = `publish ${environment} deposition ${depositionId}`
	if (confirmation !== expectedConfirmation) throw new Error(`confirmation must exactly equal "${expectedConfirmation}".`)
	return { environment, deposition_id: depositionId, confirmation }
}
