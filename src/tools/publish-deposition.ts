import { assertValidArticleMetadata } from "../metadata.ts"
import { createZenodoClient, type ZenodoEnvironment } from "../zenodo-client.ts"
import { assertPositiveInteger, assertUnsubmittedDraft, type ZenodoDeposition, type ZenodoToolOptions } from "./shared.ts"

export type ZenodoPublishDepositionParams = {
	environment?: ZenodoEnvironment
	deposition_id: number
	confirmation: string
}

export async function publishZenodoDeposition(
	params: ZenodoPublishDepositionParams,
	signal?: AbortSignal,
	options: ZenodoToolOptions = {},
): Promise<{ environment: ZenodoEnvironment; deposition_id: number; preflight: ZenodoDeposition; deposition: ZenodoDeposition; receipt: string }> {
	assertPositiveInteger(params.deposition_id, "deposition_id")
	const environment = params.environment ?? "sandbox"
	const expectedConfirmation = `publish ${environment} deposition ${params.deposition_id}`
	if (params.confirmation !== expectedConfirmation) throw new Error(`confirmation must exactly equal "${expectedConfirmation}".`)

	const client = (options.createClient ?? createZenodoClient)({ environment })
	const endpoint = `/deposit/depositions/${params.deposition_id}`
	const preflight = await client.request<ZenodoDeposition>(
		{ method: "GET", url: endpoint, signal },
		{ endpoint, method: "GET", deposition_id: params.deposition_id },
	)
	if (preflight.id !== params.deposition_id) {
		throw new Error(`Zenodo deposition response id ${String(preflight.id)} did not match requested deposition_id ${params.deposition_id}.`)
	}
	assertUnsubmittedDraft(preflight, "publish")
	const files = Array.isArray(preflight.files) ? preflight.files : []
	if (files.length === 0) throw new Error("Cannot publish: Zenodo deposition has no uploaded files.")
	assertValidArticleMetadata(preflight.metadata)

	const publishEndpoint = `${endpoint}/actions/publish`
	const deposition = await client.request<ZenodoDeposition>(
		{ method: "POST", url: publishEndpoint, signal },
		{ endpoint: publishEndpoint, method: "POST", deposition_id: params.deposition_id },
	)
	if (deposition.id !== params.deposition_id) {
		throw new Error(`Zenodo publish response id ${String(deposition.id)} did not match requested deposition_id ${params.deposition_id}.`)
	}
	const receipt = buildPublishReceipt(environment, params.deposition_id, deposition, preflight)
	return { environment, deposition_id: params.deposition_id, preflight, deposition, receipt }
}

function buildPublishReceipt(environment: ZenodoEnvironment, depositionId: number, deposition: ZenodoDeposition, preflight: ZenodoDeposition): string {
	const metadata = asRecord(deposition.metadata) ?? asRecord(preflight.metadata) ?? {}
	const files = Array.isArray(deposition.files) ? deposition.files : Array.isArray(preflight.files) ? preflight.files : []
	const links = asRecord(deposition.links) ?? {}
	return [
		"Receipt:",
		`- Environment: ${environment}`,
		`- Deposition ID: ${depositionId}`,
		`- DOI: ${stringValue(deposition.doi) ?? stringValue(metadata.doi) ?? "not returned"}`,
		`- Record URL: ${stringValue(deposition.record_url) ?? stringValue(links.record) ?? stringValue(links.html) ?? "not returned"}`,
		`- Title: ${stringValue(metadata.title) ?? "not returned"}`,
		`- Publication date: ${stringValue(metadata.publication_date) ?? "not returned"}`,
		`- Access right: ${stringValue(metadata.access_right) ?? "not returned"}`,
		`- License: ${stringValue(metadata.license) ?? "not returned"}`,
		`- Files: ${formatReceiptFiles(files)}`,
	].join("\n")
}

function formatReceiptFiles(files: unknown[]): string {
	if (files.length === 0) return "not returned"
	return files.map(formatReceiptFile).join("; ")
}

function formatReceiptFile(file: unknown): string {
	const record = asRecord(file)
	if (!record) return "unknown file"
	const name = stringValue(record.name) ?? stringValue(record.key) ?? stringValue(record.filename) ?? "unknown file"
	const size = typeof record.size === "number" ? `${record.size} bytes` : typeof record.filesize === "number" ? `${record.filesize} bytes` : typeof record.filesize === "string" ? `${record.filesize} bytes` : undefined
	const checksum = stringValue(record.checksum)
	const details = [size, checksum].filter(Boolean).join(", ")
	return details ? `${name} (${details})` : name
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
	return value as Record<string, unknown>
}
