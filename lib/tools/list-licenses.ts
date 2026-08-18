import { createZenodoClient, type ZenodoEnvironment } from "../zenodo-client.ts"
import { assertPageSize, normalizeOptionalQuery, type ZenodoToolOptions } from "./shared.ts"

export type ZenodoListLicensesParams = {
	environment?: ZenodoEnvironment
	q?: string
	page?: number
	size?: number
}

export type ZenodoLicense = Record<string, unknown> & {
	id?: string
	title?: string
}

export async function listZenodoLicenses(
	params: ZenodoListLicensesParams,
	signal?: AbortSignal,
	options: ZenodoToolOptions = {},
): Promise<{ environment: ZenodoEnvironment; licenses: ZenodoLicense[] }> {
	assertPageSize(params.page, params.size)
	const environment = params.environment ?? "sandbox"
	const client = (options.createClient ?? createZenodoClient)({ environment })
	const searchParams = new URLSearchParams()
	const q = normalizeOptionalQuery(params.q, "q")
	if (q) searchParams.set("q", q)
	if (params.page !== undefined) searchParams.set("page", String(params.page))
	if (params.size !== undefined) searchParams.set("size", String(params.size))

	const query = searchParams.toString()
	const endpoint = `/licenses/${query ? `?${query}` : ""}`
	const licenses = await client.request<ZenodoLicense[]>(
		{ method: "GET", url: endpoint, signal },
		{ endpoint: "/licenses/", method: "GET" },
	)

	return { environment, licenses }
}
