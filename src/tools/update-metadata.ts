import { assertValidArticleMetadata, type ZenodoArticleMetadata } from "../metadata.ts"
import { createZenodoClient, type ZenodoEnvironment } from "../zenodo-client.ts"
import { assertPositiveInteger, assertUnsubmittedDraft, type ZenodoDeposition, type ZenodoToolOptions } from "./shared.ts"

export type ZenodoUpdateMetadataParams = {
	environment?: ZenodoEnvironment
	deposition_id: number
	metadata: ZenodoArticleMetadata
}

export async function updateZenodoMetadata(
	params: ZenodoUpdateMetadataParams,
	signal?: AbortSignal,
	options: ZenodoToolOptions = {},
): Promise<{ environment: ZenodoEnvironment; deposition: ZenodoDeposition }> {
	assertPositiveInteger(params.deposition_id, "deposition_id")
	assertValidArticleMetadata(params.metadata)

	const environment = params.environment ?? "sandbox"
	const client = (options.createClient ?? createZenodoClient)({ environment })
	const endpoint = `/deposit/depositions/${params.deposition_id}`
	const existingDeposition = await client.request<ZenodoDeposition>(
		{ method: "GET", url: endpoint, signal },
		{ endpoint, method: "GET", deposition_id: params.deposition_id },
	)
	assertUnsubmittedDraft(existingDeposition, "update metadata for")

	const deposition = await client.request<ZenodoDeposition>(
		{
			method: "PUT",
			url: endpoint,
			data: { metadata: params.metadata },
			headers: { "Content-Type": "application/json" },
			signal,
		},
		{ endpoint, method: "PUT", deposition_id: params.deposition_id },
	)

	return { environment, deposition }
}
