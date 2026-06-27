import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { createZenodoClient, getZenodoBaseURL, type ZenodoEnvironment } from "../zenodo-client.ts"
import { assertPositiveInteger, assertUnsubmittedDraft, type ZenodoDeposition, type ZenodoToolOptions } from "./shared.ts"

const MAX_ZENODO_FILE_SIZE_BYTES = 50 * 1024 * 1024 * 1024
const MAX_ZENODO_FILES_PER_DEPOSITION = 100

export type ZenodoUploadFileParams = {
	environment?: ZenodoEnvironment
	deposition_id: number
	local_path: string
	remote_filename?: string
	content_type?: string
}

export type ZenodoUploadedFile = Record<string, unknown> & {
	key?: string
	size?: number
	checksum?: string
}

export async function uploadZenodoFile(
	params: ZenodoUploadFileParams,
	signal?: AbortSignal,
	options: ZenodoToolOptions = {},
): Promise<{ environment: ZenodoEnvironment; deposition_id: number; remote_filename: string; file: ZenodoUploadedFile }> {
	assertPositiveInteger(params.deposition_id, "deposition_id")
	const localPath = params.local_path.trim()
	if (!localPath) throw new Error("local_path must be non-empty.")
	const contentType = params.content_type?.trim() || "application/octet-stream"
	if (params.content_type !== undefined && !params.content_type.trim()) throw new Error("content_type must be non-empty when provided.")
	if (contentType !== "application/octet-stream") throw new Error("Zenodo bucket uploads require content_type application/octet-stream.")
	const remoteFilename = normalizeRemoteFilename(params.remote_filename ?? path.basename(localPath))
	const fileStat = await stat(localPath)
	if (!fileStat.isFile()) throw new Error(`local_path must point to a regular file: ${localPath}`)
	if (fileStat.size > MAX_ZENODO_FILE_SIZE_BYTES) throw new Error("Zenodo file uploads are limited to 50 GB per file.")

	const environment = params.environment ?? "sandbox"
	const client = (options.createClient ?? createZenodoClient)({ environment })
	const depositionEndpoint = `/deposit/depositions/${params.deposition_id}`
	const deposition = await client.request<ZenodoDeposition>(
		{ method: "GET", url: depositionEndpoint, signal },
		{ endpoint: depositionEndpoint, method: "GET", deposition_id: params.deposition_id },
	)
	assertUnsubmittedDraft(deposition, "upload files to")
	const files = Array.isArray(deposition.files) ? deposition.files : []
	if (files.length >= MAX_ZENODO_FILES_PER_DEPOSITION) throw new Error("Zenodo depositions are limited to 100 files.")
	const bucketUrl = getValidatedBucketUrl(deposition, environment)
	const uploadUrl = `${bucketUrl}/${encodeURIComponent(remoteFilename)}`
	const uploadedFile = await client.request<ZenodoUploadedFile>(
		{
			method: "PUT",
			url: uploadUrl,
			data: createReadStream(localPath),
			headers: { "Content-Type": contentType, "Content-Length": fileStat.size },
			maxBodyLength: Infinity,
			maxContentLength: Infinity,
			signal,
		},
		{ endpoint: "deposition.links.bucket", method: "PUT", deposition_id: params.deposition_id },
	)
	assertUploadedFileMatchesLocalFile(uploadedFile, fileStat.size, remoteFilename)

	return { environment, deposition_id: params.deposition_id, remote_filename: remoteFilename, file: uploadedFile }
}

function assertUploadedFileMatchesLocalFile(uploadedFile: ZenodoUploadedFile, localSize: number, remoteFilename: string): void {
	if (typeof uploadedFile.size !== "number") return
	if (uploadedFile.size === localSize) return
	throw new Error(`Zenodo reported ${uploadedFile.size} bytes for uploaded file ${remoteFilename}, but local file size is ${localSize} bytes.`)
}

export function normalizeRemoteFilename(filename: string): string {
	const trimmed = filename.trim()
	if (!trimmed || trimmed === "." || trimmed === "..") throw new Error("remote_filename must be a non-empty filename.")
	if (trimmed.includes("/") || trimmed.includes("\\")) throw new Error("remote_filename must not contain path separators.")
	return trimmed
}

export function getValidatedBucketUrl(deposition: ZenodoDeposition, environment: ZenodoEnvironment): string {
	const bucket = deposition.links?.bucket
	if (typeof bucket !== "string" || !bucket) throw new Error("Zenodo deposition response did not include links.bucket.")
	const cleaned = bucket.replace(/\/+$/, "")
	let url: URL
	try {
		url = new URL(cleaned)
	} catch {
		throw new Error("Zenodo deposition links.bucket was not a valid URL.")
	}
	const expectedOrigin = new URL(getZenodoBaseURL(environment)).origin
	if (url.protocol !== "https:" || url.origin !== expectedOrigin || !url.pathname.startsWith("/api/files/")) {
		throw new Error(`Zenodo deposition links.bucket must be an HTTPS ${environment} Zenodo file bucket URL.`)
	}
	return cleaned
}
