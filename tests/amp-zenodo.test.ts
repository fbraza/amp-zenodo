import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import ampZenodoPlugin, { registerZenodoTools } from "../index.ts"
import { assertValidArticleMetadata, validateArticleMetadata, type ZenodoArticleMetadata } from "../lib/metadata.ts"
import { getValidatedBucketUrl, normalizeRemoteFilename, uploadZenodoFile } from "../lib/tools/upload-file.ts"
import { createZenodoClient, ZenodoApiError, type ZenodoClient } from "../lib/zenodo-client.ts"

const validMetadata: ZenodoArticleMetadata = {
	upload_type: "publication",
	publication_type: "article",
	title: "A translational lung study",
	publication_date: "2025-03-10",
	creators: [{ name: "Doe, Jane", affiliation: "University Hospital" }],
	description: "A concise abstract.",
	access_right: "open",
	license: "cc-by-4.0",
	doi: "10.1234/example",
}

type RegisteredTool = {
	name: string
	description: string
	inputSchema: { type?: string; [key: string]: unknown }
	execute: (input: unknown) => Promise<string>
}

function collectTools(options = {}) {
	const tools: RegisteredTool[] = []
	registerZenodoTools(
		{
			registerTool(tool: RegisteredTool) {
				tools.push(tool)
			},
			logger: { log() {} },
		},
		options,
	)
	return tools
}

function findTool(tools: RegisteredTool[], name: string): RegisteredTool {
	const tool = tools.find((candidate) => candidate.name === name)
	assert.ok(tool, `Expected ${name} to be registered`)
	return tool
}

function mockClient(handler: (config: Record<string, unknown>) => unknown): ZenodoClient {
	return {
		environment: "sandbox",
		baseURL: "https://sandbox.zenodo.org/api",
		tokenEnvVar: "ZENODO_SANDBOX_TOKEN",
		async request(config) {
			return handler(config as Record<string, unknown>) as never
		},
	}
}

test("Amp plugin registers its bundled skill and all expected Zenodo tools", async () => {
	const tools: RegisteredTool[] = []
	const skills: string[] = []
	await ampZenodoPlugin({
		registerTool(tool: RegisteredTool) {
			tools.push(tool)
		},
		async registerSkill({ path }: { path: string }) {
			skills.push(path)
		},
		logger: { log() {} },
	} as never)

	assert.deepEqual(skills, ["skills/managing-zenodo-deposits"])
	assert.deepEqual(
		tools.map((tool) => tool.name),
		[
			"zenodo_create_draft",
			"zenodo_get_deposition",
			"zenodo_list_depositions",
			"zenodo_list_licenses",
			"zenodo_upload_file",
			"zenodo_update_metadata",
			"zenodo_delete_draft",
			"zenodo_publish_deposition",
		],
	)
	for (const tool of tools) {
		assert.equal(typeof tool.description, "string")
		assert.equal(tool.inputSchema.type, "object")
		assert.equal(typeof tool.execute, "function")
		assert.equal((tool as Record<string, unknown>).parameters, undefined)
		assert.equal((tool as Record<string, unknown>).renderResult, undefined)
		assert.equal((tool as Record<string, unknown>).label, undefined)
	}
})

test("Zenodo client uses built-in fetch and normalizes API errors", async () => {
	const calls: { url: string; init: RequestInit }[] = []
	const client = createZenodoClient({
		env: { ZENODO_SANDBOX_TOKEN: "token-123" },
		fetch: (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} })
			return new Response(JSON.stringify({ id: 42 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
		}) as typeof fetch,
	})

	const result = await client.request<{ id: number }>({ method: "POST", url: "/deposit/depositions", data: { metadata: { title: "Example" } }, headers: { "Content-Type": "application/json" } })
	assert.deepEqual(result, { id: 42 })
	assert.equal(calls[0].url, "https://sandbox.zenodo.org/api/deposit/depositions")
	assert.equal((calls[0].init.headers as Headers).get("Authorization"), "Bearer token-123")
	assert.equal(calls[0].init.body, JSON.stringify({ metadata: { title: "Example" } }))

	const failingClient = createZenodoClient({
		env: { ZENODO_SANDBOX_TOKEN: "token-123" },
		fetch: (async () => new Response(
			JSON.stringify({ message: "Validation error.", errors: [{ field: "title", message: "Missing data" }] }),
			{ status: 400, statusText: "BAD REQUEST", headers: { "Content-Type": "application/json" } },
		)) as typeof fetch,
	})

	await assert.rejects(
		failingClient.request({ method: "POST", url: "/deposit/depositions" }),
		(error: unknown) => {
			assert.ok(error instanceof ZenodoApiError)
			assert.equal(error.details.status, 400)
			assert.equal(error.details.zenodoErrors?.[0]?.field, "title")
			assert.match(error.message, /Validation error/)
			return true
		},
	)
})

test("metadata validation enforces article deposits and conditional access fields", () => {
	assert.doesNotThrow(() => assertValidArticleMetadata(validMetadata))
	assert.equal(validateArticleMetadata({ ...validMetadata, upload_type: "dataset" }).valid, false)
	assert.equal(validateArticleMetadata({ ...validMetadata, access_right: "open", license: undefined }).valid, false)
	assert.equal(validateArticleMetadata({ ...validMetadata, access_right: "embargoed", embargo_date: undefined }).valid, false)
	assert.equal(validateArticleMetadata({ ...validMetadata, access_right: "restricted", license: undefined, access_conditions: undefined }).valid, false)
	assert.equal(validateArticleMetadata({ ...validMetadata, publication_date: "2025-02-31" }).valid, false)
})

test("list depositions parser preserves all_versions and query parameters", async () => {
	const calls: Record<string, unknown>[] = []
	const tools = collectTools({
		createClient: () => mockClient((config) => {
			calls.push(config)
			return [{ id: 42, state: "unsubmitted", submitted: false }]
		}),
	})
	const tool = findTool(tools, "zenodo_list_depositions")
	const result = JSON.parse(
		await tool.execute({ status: "draft", q: "lung", sort: "mostrecent", page: 2, size: 10, all_versions: true }),
	)

	assert.equal(result.tool, "zenodo_list_depositions")
	assert.equal(result.environment, "sandbox")
	assert.equal(calls[0].method, "GET")
	assert.equal(calls[0].url, "/deposit/depositions?status=draft&q=lung&sort=mostrecent&page=2&size=10&all_versions=true")
})

test("create and update metadata tools validate input at runtime", async () => {
	const calls: Record<string, unknown>[] = []
	const tools = collectTools({
		createClient: () => mockClient((config) => {
			calls.push(config)
			if (config.method === "GET") return { id: 12, state: "unsubmitted", submitted: false }
			return { id: 12, state: "unsubmitted", submitted: false, metadata: validMetadata }
		}),
	})

	await assert.rejects(findTool(tools, "zenodo_create_draft").execute(null), /tool input must be an object/)
	await assert.rejects(findTool(tools, "zenodo_create_draft").execute({ metadata: { ...validMetadata, title: "" } }), /title/)
	await assert.rejects(findTool(tools, "zenodo_update_metadata").execute({ deposition_id: 12, metadata: { ...validMetadata, title: "" } }), /title/)

	const update = JSON.parse(await findTool(tools, "zenodo_update_metadata").execute({ deposition_id: 12, metadata: validMetadata }))
	assert.equal(update.tool, "zenodo_update_metadata")
	assert.deepEqual(
		calls.map((call) => [call.method, call.url]),
		[
			["GET", "/deposit/depositions/12"],
			["PUT", "/deposit/depositions/12"],
		],
	)
})

test("upload validates draft state, bucket origin, filename, and returned file size", async () => {
	const tmpDir = await mkdtemp(path.join(os.tmpdir(), "amp-zenodo-"))
	try {
		const localPath = path.join(tmpDir, "paper.pdf")
		await writeFile(localPath, "abc")
		const calls: Record<string, unknown>[] = []
		const result = await uploadZenodoFile(
			{ deposition_id: 99, local_path: localPath, remote_filename: "article.pdf" },
			undefined,
			{
				createClient: () => mockClient((config) => {
					calls.push(config)
					if (config.method === "GET") {
						return { id: 99, state: "unsubmitted", submitted: false, files: [], links: { bucket: "https://sandbox.zenodo.org/api/files/bucket-1" } }
					}
					return { key: "article.pdf", size: 3, checksum: "md5:abc" }
				}),
			},
		)

		assert.equal(result.remote_filename, "article.pdf")
		assert.equal(calls[1].method, "PUT")
		assert.equal(calls[1].url, "https://sandbox.zenodo.org/api/files/bucket-1/article.pdf")
		assert.equal((calls[1].headers as Record<string, unknown>)["Content-Type"], "application/octet-stream")
	} finally {
		await rm(tmpDir, { recursive: true, force: true })
	}
})

test("bucket URL validation rejects cross-origin or non-bucket URLs", () => {
	assert.equal(
		getValidatedBucketUrl({ links: { bucket: "https://sandbox.zenodo.org/api/files/bucket/" } }, "sandbox"),
		"https://sandbox.zenodo.org/api/files/bucket",
	)
	assert.throws(() => getValidatedBucketUrl({ links: { bucket: "https://zenodo.org/api/files/bucket" } }, "sandbox"), /sandbox Zenodo file bucket/)
	assert.throws(() => getValidatedBucketUrl({ links: { bucket: "https://sandbox.zenodo.org/api/records/1" } }, "sandbox"), /sandbox Zenodo file bucket/)
	assert.throws(() => normalizeRemoteFilename("../paper.pdf"), /path separators/)
})

test("publish requires exact confirmation and performs unpublished-draft preflight", async () => {
	const calls: Record<string, unknown>[] = []
	const tools = collectTools({
		createClient: () => mockClient((config) => {
			calls.push(config)
			if (config.method === "GET") return { id: 7, state: "unsubmitted", submitted: false, files: [{ name: "paper.pdf", size: 3 }], metadata: validMetadata }
			return { id: 7, doi: "10.5281/zenodo.7", record_url: "https://sandbox.zenodo.org/records/7", files: [{ name: "paper.pdf", size: 3 }], metadata: validMetadata }
		}),
	})
	const tool = findTool(tools, "zenodo_publish_deposition")

	await assert.rejects(tool.execute({ deposition_id: 7, confirmation: "publish deposition 7" }), /confirmation must exactly equal/)
	const result = JSON.parse(await tool.execute({ deposition_id: 7, confirmation: "publish sandbox deposition 7" }))

	assert.equal(result.tool, "zenodo_publish_deposition")
	assert.equal(result.receipt.includes("Receipt:"), true)
	assert.deepEqual(
		calls.map((call) => [call.method, call.url]),
		[
			["GET", "/deposit/depositions/7"],
			["POST", "/deposit/depositions/7/actions/publish"],
		],
	)
})

test("publish rejects a malformed Zenodo response without the requested id", async () => {
	const tools = collectTools({
		createClient: () => mockClient((config) => {
			if (config.method === "GET") return { id: 7, state: "unsubmitted", submitted: false, files: [{ name: "paper.pdf", size: 3 }], metadata: validMetadata }
			return { doi: "10.5281/zenodo.7", files: [{ name: "paper.pdf", size: 3 }], metadata: validMetadata }
		}),
	})

	await assert.rejects(
		findTool(tools, "zenodo_publish_deposition").execute({ deposition_id: 7, confirmation: "publish sandbox deposition 7" }),
		/publish response id undefined did not match requested deposition_id 7/,
	)
})

test("delete and metadata update fail closed unless Zenodo confirms an unpublished draft", async () => {
	const tools = collectTools({
		createClient: () => mockClient((config) => {
			if (config.method === "GET") return { id: 3, state: "done", submitted: true }
			return { id: 3 }
		}),
	})

	await assert.rejects(findTool(tools, "zenodo_delete_draft").execute({ deposition_id: 3 }), /unpublished draft/)
	await assert.rejects(findTool(tools, "zenodo_update_metadata").execute({ deposition_id: 3, metadata: validMetadata }), /unpublished draft/)
})
