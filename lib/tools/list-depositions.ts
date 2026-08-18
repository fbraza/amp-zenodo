import { createZenodoClient, type ZenodoEnvironment } from "../zenodo-client.ts"
import { assertPageSize, normalizeOptionalQuery, type ZenodoDeposition, type ZenodoToolOptions } from "./shared.ts"

export type ZenodoListDepositionsParams = {
	environment?: ZenodoEnvironment
	status?: "draft" | "published"
	q?: string
	sort?: "bestmatch" | "mostrecent" | "-mostrecent"
	page?: number
	size?: number
	all_versions?: boolean
}

export async function listZenodoDepositions(
	params: ZenodoListDepositionsParams,
	signal?: AbortSignal,
	options: ZenodoToolOptions = {},
): Promise<{ environment: ZenodoEnvironment; depositions: ZenodoDeposition[] }> {
	assertPageSize(params.page, params.size)
	const environment = params.environment ?? "sandbox"
	const client = (options.createClient ?? createZenodoClient)({ environment })
	const searchParams = new URLSearchParams()
	if (params.status) searchParams.set("status", params.status)
	const q = normalizeOptionalQuery(params.q, "q")
	if (q) searchParams.set("q", q)
	if (params.sort) searchParams.set("sort", params.sort)
	if (params.page !== undefined) searchParams.set("page", String(params.page))
	if (params.size !== undefined) searchParams.set("size", String(params.size))
	if (params.all_versions !== undefined) searchParams.set("all_versions", params.all_versions ? "true" : "false")

	const query = searchParams.toString()
	const endpoint = `/deposit/depositions${query ? `?${query}` : ""}`
	const depositions = await client.request<ZenodoDeposition[]>(
		{ method: "GET", url: endpoint, signal },
		{ endpoint: "/deposit/depositions", method: "GET" },
	)

	return { environment, depositions }
}
