import { createZenodoClient, type ZenodoEnvironment } from "../zenodo-client.ts"
import { assertPositiveInteger, type ZenodoDeposition, type ZenodoToolOptions } from "./shared.ts"

export type ZenodoGetDepositionParams = {
	environment?: ZenodoEnvironment
	deposition_id: number
}

export async function getZenodoDeposition(
	params: ZenodoGetDepositionParams,
	signal?: AbortSignal,
	options: ZenodoToolOptions = {},
): Promise<{ environment: ZenodoEnvironment; deposition: ZenodoDeposition }> {
	assertPositiveInteger(params.deposition_id, "deposition_id")
	const environment = params.environment ?? "sandbox"
	const client = (options.createClient ?? createZenodoClient)({ environment })
	const endpoint = `/deposit/depositions/${params.deposition_id}`
	const deposition = await client.request<ZenodoDeposition>(
		{ method: "GET", url: endpoint, signal },
		{ endpoint, method: "GET", deposition_id: params.deposition_id },
	)

	return { environment, deposition }
}
