import { assertValidArticleMetadata, type ZenodoArticleMetadata } from "../metadata.ts"
import { createZenodoClient, type ZenodoEnvironment } from "../zenodo-client.ts"
import type { ZenodoDeposition, ZenodoToolOptions } from "./shared.ts"

export type ZenodoCreateDraftParams = {
	environment?: ZenodoEnvironment
	metadata?: ZenodoArticleMetadata
}

export async function createZenodoDraft(
	params: ZenodoCreateDraftParams,
	signal?: AbortSignal,
	options: ZenodoToolOptions = {},
): Promise<{ environment: ZenodoEnvironment; deposition: ZenodoDeposition }> {
	if (params.metadata !== undefined) assertValidArticleMetadata(params.metadata)

	const environment = params.environment ?? "sandbox"
	const client = (options.createClient ?? createZenodoClient)({ environment })
	const deposition = await client.request<ZenodoDeposition>(
		{
			method: "POST",
			url: "/deposit/depositions",
			data: params.metadata === undefined ? {} : { metadata: params.metadata },
			headers: { "Content-Type": "application/json" },
			signal,
		},
		{ endpoint: "/deposit/depositions", method: "POST" },
	)

	return { environment, deposition }
}
