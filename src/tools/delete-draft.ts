import { createZenodoClient, type ZenodoEnvironment } from "../zenodo-client.ts"
import { assertPositiveInteger, assertUnsubmittedDraft, type ZenodoDeposition, type ZenodoToolOptions } from "./shared.ts"

export type ZenodoDeleteDraftParams = {
	environment?: ZenodoEnvironment
	deposition_id: number
}

export async function deleteZenodoDraft(
	params: ZenodoDeleteDraftParams,
	signal?: AbortSignal,
	options: ZenodoToolOptions = {},
): Promise<{ environment: ZenodoEnvironment; deposition_id: number }> {
	assertPositiveInteger(params.deposition_id, "deposition_id")
	const environment = params.environment ?? "sandbox"
	const client = (options.createClient ?? createZenodoClient)({ environment })
	const endpoint = `/deposit/depositions/${params.deposition_id}`
	const deposition = await client.request<ZenodoDeposition>(
		{ method: "GET", url: endpoint, signal },
		{ endpoint, method: "GET", deposition_id: params.deposition_id },
	)
	assertUnsubmittedDraft(deposition, "delete")

	await client.request<unknown>(
		{ method: "DELETE", url: endpoint, signal },
		{ endpoint, method: "DELETE", deposition_id: params.deposition_id },
	)

	return { environment, deposition_id: params.deposition_id }
}
