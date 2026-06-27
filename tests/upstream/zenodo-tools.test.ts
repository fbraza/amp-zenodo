import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import zenodoExtension from "../src/index.ts";
import {
	createZenodoCreateDraftTool,
	createZenodoDraft,
} from "../src/tools/create-draft.ts";
import {
	createZenodoDeleteDraftTool,
	deleteZenodoDraft,
} from "../src/tools/delete-draft.ts";
import {
	createZenodoGetDepositionTool,
	getZenodoDeposition,
} from "../src/tools/get-deposition.ts";
import { listZenodoDepositions } from "../src/tools/list-depositions.ts";
import { listZenodoLicenses } from "../src/tools/list-licenses.ts";
import {
	createZenodoPublishDepositionTool,
	publishZenodoDeposition,
} from "../src/tools/publish-deposition.ts";
import {
	createZenodoUploadFileTool,
	uploadZenodoFile,
} from "../src/tools/upload-file.ts";
import {
	createZenodoUpdateMetadataTool,
	updateZenodoMetadata,
} from "../src/tools/update-metadata.ts";
import type { CreateZenodoClientOptions } from "../src/zenodo-client.ts";

function validArticleMetadata(overrides: Record<string, unknown> = {}) {
	return {
		upload_type: "publication",
		publication_type: "article",
		title: "Prime role of IL-17A in neutrophilia",
		publication_date: "2015-01-15",
		creators: [{ name: "Chesné, Julie" }],
		description: "Article abstract.",
		access_right: "open",
		license: "cc-by-4.0",
		...overrides,
	};
}

function fakeClient(response: unknown | unknown[]) {
	const calls: Array<{
		clientOptions?: CreateZenodoClientOptions;
		requestConfig: Record<string, unknown>;
		requestContext: Record<string, unknown>;
	}> = [];
	const responses = Array.isArray(response) ? [...response] : [response];

	return {
		calls,
		createClient(clientOptions?: CreateZenodoClientOptions) {
			return {
				environment: clientOptions?.environment ?? "sandbox",
				baseURL: "https://sandbox.zenodo.org/api",
				tokenEnvVar: "ZENODO_SANDBOX_TOKEN",
				axios: {} as never,
				async request(
					requestConfig: Record<string, unknown>,
					requestContext: Record<string, unknown>,
				) {
					calls.push({ clientOptions, requestConfig, requestContext });
					return responses.shift();
				},
			};
		},
	};
}

test("extension registers the implemented Zenodo tools", () => {
	const tools: Array<{ name: string }> = [];
	const fakePi = {
		registerTool(tool: { name: string }) {
			tools.push(tool);
		},
	} as any;

	zenodoExtension(fakePi);

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
	);
});

test("createZenodoDraft defaults to sandbox and posts an empty body", async () => {
	const fake = fakeClient({ id: 123, links: { bucket: "bucket-url" } });
	const result = await createZenodoDraft({}, undefined, {
		createClient: fake.createClient,
	});

	assert.equal(result.environment, "sandbox");
	assert.equal(result.deposition.id, 123);
	assert.equal(fake.calls[0]?.clientOptions?.environment, "sandbox");
	assert.deepEqual(fake.calls[0]?.requestConfig, {
		method: "POST",
		url: "/deposit/depositions",
		data: {},
		headers: { "Content-Type": "application/json" },
		signal: undefined,
	});
});

test("createZenodoDraft validates and sends article metadata", async () => {
	const fake = fakeClient({ id: 456 });
	const metadata = validArticleMetadata();

	await createZenodoDraft(
		{ environment: "production", metadata },
		undefined,
		{ createClient: fake.createClient },
	);

	assert.equal(fake.calls[0]?.clientOptions?.environment, "production");
	assert.deepEqual(fake.calls[0]?.requestConfig.data, { metadata });
});

test("create draft tool throws a metadata validation error without making a request", async () => {
	const fake = fakeClient({ id: 456 });
	const tool = createZenodoCreateDraftTool({ createClient: fake.createClient });

	await assert.rejects(
		() =>
			tool.execute("call", {
				metadata: validArticleMetadata({ publication_type: "preprint" }),
			}),
		/publication_type/,
	);
	assert.equal(fake.calls.length, 0);
});

test("getZenodoDeposition retrieves a deposition by id", async () => {
	const fake = fakeClient({ id: 789, state: "unsubmitted" });
	const controller = new AbortController();
	const result = await getZenodoDeposition(
		{ deposition_id: 789 },
		controller.signal,
		{ createClient: fake.createClient },
	);

	assert.equal(result.environment, "sandbox");
	assert.equal(result.deposition.id, 789);
	assert.deepEqual(fake.calls[0]?.requestConfig, {
		method: "GET",
		url: "/deposit/depositions/789",
		signal: controller.signal,
	});
	assert.deepEqual(fake.calls[0]?.requestContext, {
		endpoint: "/deposit/depositions/789",
		method: "GET",
		deposition_id: 789,
	});
});

test("getZenodoDeposition rejects non-positive integer ids before making a request", async () => {
	const fake = fakeClient({ id: 789 });

	await assert.rejects(
		() =>
			getZenodoDeposition(
				{ deposition_id: 1.5 },
				undefined,
				{ createClient: fake.createClient },
			),
		/deposition_id must be a positive integer/,
	);
	assert.equal(fake.calls.length, 0);
});

test("tool output includes text content, structured details, and simple rendering", async () => {
	const fake = fakeClient({ id: 789, state: "unsubmitted" });
	const tool = createZenodoGetDepositionTool({ createClient: fake.createClient });
	const result = await tool.execute("call", { deposition_id: 789 });

	assert.deepEqual(result.content, [
		{ type: "text", text: "Retrieved Zenodo sandbox deposition 789." },
	]);
	assert.deepEqual(result.details, {
		environment: "sandbox",
		deposition: { id: 789, state: "unsubmitted" },
	});

	const rendered = tool
		.renderResult(result as never, { expanded: false, isPartial: false }, undefined as never, undefined as never)
		.render(80)
		.join("\n")
		.trimEnd();
	assert.equal(rendered, "Retrieved Zenodo sandbox deposition 789.");
});

test("listZenodoDepositions builds supported query parameters", async () => {
	const fake = fakeClient([[{ id: 1 }, { id: 2 }]]);
	const controller = new AbortController();
	const result = await listZenodoDepositions(
		{
			status: "draft",
			q: "asthma article",
			sort: "mostrecent",
			page: 2,
			size: 50,
			all_versions: true,
		},
		controller.signal,
		{ createClient: fake.createClient },
	);

	assert.equal(result.environment, "sandbox");
	assert.equal(result.depositions.length, 2);
	assert.equal(
		fake.calls[0]?.requestConfig.url,
		"/deposit/depositions?status=draft&q=asthma+article&sort=mostrecent&page=2&size=50&all_versions=true",
	);
	assert.equal(fake.calls[0]?.requestConfig.method, "GET");
	assert.equal(fake.calls[0]?.requestConfig.signal, controller.signal);
	assert.deepEqual(fake.calls[0]?.requestContext, {
		endpoint: "/deposit/depositions",
		method: "GET",
	});
});

test("updateZenodoMetadata validates metadata and sends a PUT request", async () => {
	const fake = fakeClient([
		{ id: 321, submitted: false, state: "unsubmitted" },
		{ id: 321, state: "unsubmitted" },
	]);
	const metadata = validArticleMetadata();
	const controller = new AbortController();
	const result = await updateZenodoMetadata(
		{ deposition_id: 321, metadata },
		controller.signal,
		{ createClient: fake.createClient },
	);

	assert.equal(result.environment, "sandbox");
	assert.equal(result.deposition.id, 321);
	assert.deepEqual(fake.calls[0]?.requestConfig, {
		method: "GET",
		url: "/deposit/depositions/321",
		signal: controller.signal,
	});
	assert.deepEqual(fake.calls[1]?.requestConfig, {
		method: "PUT",
		url: "/deposit/depositions/321",
		data: { metadata },
		headers: { "Content-Type": "application/json" },
		signal: controller.signal,
	});
	assert.deepEqual(fake.calls[1]?.requestContext, {
		endpoint: "/deposit/depositions/321",
		method: "PUT",
		deposition_id: 321,
	});
});

test("update metadata tool throws validation errors before making a request", async () => {
	const fake = fakeClient({ id: 321 });
	const tool = createZenodoUpdateMetadataTool({ createClient: fake.createClient });

	await assert.rejects(
		() =>
			tool.execute("call", {
				deposition_id: 321,
				metadata: validArticleMetadata({ title: "" }),
			}),
		/title: A non-empty string is required/,
	);
	assert.equal(fake.calls.length, 0);
});

test("uploadZenodoFile derives the bucket URL and streams the local file", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-zenodo-"));
	try {
		const localPath = path.join(tempDir, "article.pdf");
		await writeFile(localPath, "pdf bytes");
		const fake = fakeClient([
			{
				id: 654,
				submitted: false,
				state: "unsubmitted",
				files: [],
				links: { bucket: "https://sandbox.zenodo.org/api/files/bucket-id/" },
			},
			{ key: "Article Final.pdf", size: 9, checksum: "md5:abc" },
		]);
		const controller = new AbortController();
		const result = await uploadZenodoFile(
			{
				deposition_id: 654,
				local_path: localPath,
				remote_filename: "Article Final.pdf",
			},
			controller.signal,
			{ createClient: fake.createClient },
		);

		assert.equal(result.environment, "sandbox");
		assert.equal(result.remote_filename, "Article Final.pdf");
		assert.deepEqual(fake.calls[0]?.requestConfig, {
			method: "GET",
			url: "/deposit/depositions/654",
			signal: controller.signal,
		});
		assert.equal(fake.calls[1]?.requestConfig.method, "PUT");
		assert.equal(
			fake.calls[1]?.requestConfig.url,
			"https://sandbox.zenodo.org/api/files/bucket-id/Article%20Final.pdf",
		);
		assert.deepEqual(fake.calls[1]?.requestConfig.headers, {
			"Content-Type": "application/octet-stream",
			"Content-Length": 9,
		});
		assert.equal(fake.calls[1]?.requestConfig.maxBodyLength, Infinity);
		assert.equal(fake.calls[1]?.requestConfig.maxContentLength, Infinity);
		assert.equal(fake.calls[1]?.requestConfig.signal, controller.signal);
		assert.ok(fake.calls[1]?.requestConfig.data);
		assert.deepEqual(fake.calls[1]?.requestContext, {
			endpoint: "deposition.links.bucket",
			method: "PUT",
			deposition_id: 654,
		});
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("uploadZenodoFile rejects empty or truncated upload responses", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-zenodo-"));
	try {
		const localPath = path.join(tempDir, "article.pdf");
		await writeFile(localPath, "pdf bytes");
		const fake = fakeClient([
			{
				id: 654,
				submitted: false,
				state: "unsubmitted",
				files: [],
				links: { bucket: "https://sandbox.zenodo.org/api/files/bucket-id" },
			},
			{
				key: "article.pdf",
				size: 0,
				checksum: "md5:d41d8cd98f00b204e9800998ecf8427e",
			},
		]);

		await assert.rejects(
			() =>
				uploadZenodoFile(
					{ deposition_id: 654, local_path: localPath },
					undefined,
					{ createClient: fake.createClient },
				),
			/reported 0 bytes.*local file size is 9 bytes/,
		);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("upload file tool returns simple text output", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-zenodo-"));
	try {
		const localPath = path.join(tempDir, "article.pdf");
		await writeFile(localPath, "pdf bytes");
		const fake = fakeClient([
			{
				id: 654,
				submitted: false,
				state: "unsubmitted",
				files: [],
				links: { bucket: "https://sandbox.zenodo.org/api/files/bucket-id" },
			},
			{ key: "article.pdf" },
		]);
		const tool = createZenodoUploadFileTool({ createClient: fake.createClient });
		const result = await tool.execute("call", {
			deposition_id: 654,
			local_path: localPath,
		});

		assert.deepEqual(result.content, [
			{
				type: "text",
				text: "Uploaded article.pdf to Zenodo sandbox deposition 654.",
			},
		]);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("uploadZenodoFile rejects unsafe remote filenames before network requests", async () => {
	const fake = fakeClient({});

	await assert.rejects(
		() =>
			uploadZenodoFile(
				{
					deposition_id: 654,
					local_path: "article.pdf",
					remote_filename: "nested/article.pdf",
				},
				undefined,
				{ createClient: fake.createClient },
			),
		/remote_filename must not contain path separators/,
	);
	assert.equal(fake.calls.length, 0);
});

test("uploadZenodoFile rejects directories", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-zenodo-"));
	try {
		const fake = fakeClient({});
		await assert.rejects(
			() =>
				uploadZenodoFile(
					{ deposition_id: 654, local_path: tempDir },
					undefined,
					{ createClient: fake.createClient },
				),
			/local_path must point to a regular file/,
		);
		assert.equal(fake.calls.length, 0);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("uploadZenodoFile rejects depositions at the 100 file limit", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-zenodo-"));
	try {
		const localPath = path.join(tempDir, "article.pdf");
		await writeFile(localPath, "pdf bytes");
		const fake = fakeClient({
			id: 654,
			submitted: false,
			state: "unsubmitted",
			files: Array.from({ length: 100 }, (_, index) => ({ id: index })),
			links: { bucket: "https://sandbox.zenodo.org/api/files/bucket-id" },
		});

		await assert.rejects(
			() =>
				uploadZenodoFile(
					{ deposition_id: 654, local_path: localPath },
					undefined,
					{ createClient: fake.createClient },
				),
			/limited to 100 files/,
		);
		assert.equal(fake.calls.length, 1);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("uploadZenodoFile rejects depositions without a bucket link", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-zenodo-"));
	try {
		const localPath = path.join(tempDir, "article.pdf");
		await writeFile(localPath, "pdf bytes");
		const fake = fakeClient({
			id: 654,
			submitted: false,
			state: "unsubmitted",
			files: [],
			links: {},
		});

		await assert.rejects(
			() =>
				uploadZenodoFile(
					{ deposition_id: 654, local_path: localPath },
					undefined,
					{ createClient: fake.createClient },
				),
			/did not include links\.bucket/,
		);
		assert.equal(fake.calls.length, 1);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("listZenodoLicenses builds supported query parameters", async () => {
	const fake = fakeClient([[{ id: "cc-by-4.0", title: "Creative Commons Attribution 4.0" }]]);
	const controller = new AbortController();
	const result = await listZenodoLicenses(
		{ q: "cc-by", page: 1, size: 10 },
		controller.signal,
		{ createClient: fake.createClient },
	);

	assert.equal(result.environment, "sandbox");
	assert.equal(result.licenses.length, 1);
	assert.deepEqual(fake.calls[0]?.requestConfig, {
		method: "GET",
		url: "/licenses/?q=cc-by&page=1&size=10",
		signal: controller.signal,
	});
	assert.deepEqual(fake.calls[0]?.requestContext, {
		endpoint: "/licenses/",
		method: "GET",
	});
});

test("list functions reject invalid direct-call pagination and blank queries", async () => {
	const fake = fakeClient([]);

	await assert.rejects(
		() => listZenodoDepositions({ page: 0 }, undefined, { createClient: fake.createClient }),
		/page must be a positive integer/,
	);
	await assert.rejects(
		() => listZenodoLicenses({ size: 101 }, undefined, { createClient: fake.createClient }),
		/size must be an integer between 1 and 100/,
	);
	await assert.rejects(
		() => listZenodoDepositions({ q: "   " }, undefined, { createClient: fake.createClient }),
		/q must be non-empty/,
	);
	assert.equal(fake.calls.length, 0);
});

test("deleteZenodoDraft checks draft state before deleting", async () => {
	const fake = fakeClient([{ id: 987, submitted: false, state: "unsubmitted" }, {}]);
	const controller = new AbortController();
	const result = await deleteZenodoDraft(
		{ deposition_id: 987 },
		controller.signal,
		{ createClient: fake.createClient },
	);

	assert.deepEqual(result, { environment: "sandbox", deposition_id: 987 });
	assert.deepEqual(fake.calls[0]?.requestConfig, {
		method: "GET",
		url: "/deposit/depositions/987",
		signal: controller.signal,
	});
	assert.deepEqual(fake.calls[1]?.requestConfig, {
		method: "DELETE",
		url: "/deposit/depositions/987",
		signal: controller.signal,
	});
	assert.deepEqual(fake.calls[1]?.requestContext, {
		endpoint: "/deposit/depositions/987",
		method: "DELETE",
		deposition_id: 987,
	});
});

test("delete draft tool returns simple text output", async () => {
	const fake = fakeClient([{ id: 987, submitted: false, state: "unsubmitted" }, {}]);
	const tool = createZenodoDeleteDraftTool({ createClient: fake.createClient });
	const result = await tool.execute("call", { deposition_id: 987 });

	assert.deepEqual(result.content, [
		{ type: "text", text: "Deleted Zenodo sandbox draft deposition 987." },
	]);
});

test("deleteZenodoDraft refuses submitted depositions", async () => {
	const fake = fakeClient({ id: 987, submitted: true, state: "done" });

	await assert.rejects(
		() => deleteZenodoDraft({ deposition_id: 987 }, undefined, { createClient: fake.createClient }),
		/Cannot delete: Zenodo deposition is submitted\/published/,
	);
	assert.equal(fake.calls.length, 1);
});

test("mutating tools fail closed when draft state is not confirmed", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-zenodo-"));
	try {
		const localPath = path.join(tempDir, "article.pdf");
		await writeFile(localPath, "pdf bytes");
		const updateFake = fakeClient({ id: 987, state: "unsubmitted" });
		await assert.rejects(
			() =>
				updateZenodoMetadata(
					{ deposition_id: 987, metadata: validArticleMetadata() },
					undefined,
					{ createClient: updateFake.createClient },
				),
			/Cannot update metadata for: Zenodo deposition is submitted\/published/,
		);
		assert.equal(updateFake.calls.length, 1);

		const uploadFake = fakeClient({
			id: 654,
			files: [],
			links: { bucket: "https://sandbox.zenodo.org/api/files/bucket-id" },
		});
		await assert.rejects(
			() =>
				uploadZenodoFile(
					{ deposition_id: 654, local_path: localPath },
					undefined,
					{ createClient: uploadFake.createClient },
				),
			/Cannot upload files to: Zenodo deposition is submitted\/published/,
		);
		assert.equal(uploadFake.calls.length, 1);

		const deleteFake = fakeClient({ id: 987, state: "unsubmitted" });
		await assert.rejects(
			() =>
				deleteZenodoDraft(
					{ deposition_id: 987 },
					undefined,
					{ createClient: deleteFake.createClient },
				),
			/Cannot delete: Zenodo deposition is submitted\/published/,
		);
		assert.equal(deleteFake.calls.length, 1);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("uploadZenodoFile rejects blank local_path and content_type before network requests", async () => {
	const fake = fakeClient({});

	await assert.rejects(
		() =>
			uploadZenodoFile(
				{ deposition_id: 654, local_path: "   " },
				undefined,
				{ createClient: fake.createClient },
			),
		/local_path must be non-empty/,
	);
	await assert.rejects(
		() =>
			uploadZenodoFile(
				{ deposition_id: 654, local_path: "article.pdf", content_type: "   " },
				undefined,
				{ createClient: fake.createClient },
			),
		/content_type must be non-empty/,
	);
	assert.equal(fake.calls.length, 0);
});

test("uploadZenodoFile rejects non-Zenodo bucket content types before network requests", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "pi-zenodo-"));
	try {
		const localPath = path.join(tempDir, "article.pdf");
		await writeFile(localPath, "pdf bytes");
		const fake = fakeClient({});

		await assert.rejects(
			() =>
				uploadZenodoFile(
					{
						deposition_id: 654,
						local_path: localPath,
						content_type: "application/pdf",
					},
					undefined,
					{ createClient: fake.createClient },
				),
			/application\/octet-stream/,
		);
		assert.equal(fake.calls.length, 0);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
});

test("deleteZenodoDraft validates deposition id before requests", async () => {
	const fake = fakeClient({});

	await assert.rejects(
		() => deleteZenodoDraft({ deposition_id: 0 }, undefined, { createClient: fake.createClient }),
		/deposition_id must be a positive integer/,
	);
	assert.equal(fake.calls.length, 0);
});

function publishableDraft(overrides: Record<string, unknown> = {}) {
	return {
		id: 123,
		submitted: false,
		state: "unsubmitted",
		files: [{ key: "article.pdf", size: 12345, checksum: "md5:abc" }],
		metadata: validArticleMetadata(),
		...overrides,
	};
}

test("publishZenodoDeposition rejects wrong confirmation before network requests", async () => {
	const fake = fakeClient({});

	await assert.rejects(
		() =>
			publishZenodoDeposition(
				{ deposition_id: 123, confirmation: "publish sandbox deposition 999" },
				undefined,
				{ createClient: fake.createClient },
			),
		/confirmation must exactly equal "publish sandbox deposition 123"/,
	);
	await assert.rejects(
		() =>
			publishZenodoDeposition(
				{
					environment: "production",
					deposition_id: 123,
					confirmation: "publish sandbox deposition 123",
				},
				undefined,
				{ createClient: fake.createClient },
			),
		/confirmation must exactly equal "publish production deposition 123"/,
	);
	assert.equal(fake.calls.length, 0);
});

test("publishZenodoDeposition fails before POST for unsafe preflight states", async () => {
	for (const preflight of [
		publishableDraft({ submitted: true, state: "done" }),
		publishableDraft({ submitted: undefined }),
		publishableDraft({ files: [] }),
		publishableDraft({ metadata: validArticleMetadata({ title: "" }) }),
		publishableDraft({ id: 456 }),
	]) {
		const fake = fakeClient(preflight);
		await assert.rejects(
			() =>
				publishZenodoDeposition(
					{ deposition_id: 123, confirmation: "publish sandbox deposition 123" },
					undefined,
					{ createClient: fake.createClient },
				),
		);
		assert.equal(fake.calls.length, 1);
		assert.equal(fake.calls[0]?.requestConfig.method, "GET");
	}
});

test("publishZenodoDeposition publishes valid preflight and returns receipt", async () => {
	const preflight = publishableDraft({
		files: [{ filename: "article.pdf", filesize: 12345, checksum: "md5:abc" }],
	});
	const published = {
		...preflight,
		submitted: true,
		state: "done",
		doi: "10.5281/zenodo.123",
		record_url: "https://zenodo.org/records/123",
	};
	const fake = fakeClient([preflight, published]);
	const controller = new AbortController();
	const result = await publishZenodoDeposition(
		{ deposition_id: 123, confirmation: "publish sandbox deposition 123" },
		controller.signal,
		{ createClient: fake.createClient },
	);

	assert.equal(result.environment, "sandbox");
	assert.equal(result.deposition_id, 123);
	assert.equal(result.deposition.doi, "10.5281/zenodo.123");
	assert.match(result.receipt, /Receipt:/);
	assert.match(result.receipt, /DOI: 10\.5281\/zenodo\.123/);
	assert.match(result.receipt, /Files: article\.pdf \(12345 bytes, md5:abc\)/);
	assert.deepEqual(fake.calls[0]?.requestConfig, {
		method: "GET",
		url: "/deposit/depositions/123",
		signal: controller.signal,
	});
	assert.deepEqual(fake.calls[1]?.requestConfig, {
		method: "POST",
		url: "/deposit/depositions/123/actions/publish",
		signal: controller.signal,
	});
	assert.deepEqual(fake.calls[1]?.requestContext, {
		endpoint: "/deposit/depositions/123/actions/publish",
		method: "POST",
		deposition_id: 123,
	});
});

test("publishZenodoDeposition rejects mismatched publish response ids", async () => {
	const preflight = publishableDraft();
	const fake = fakeClient([preflight, { ...preflight, id: 456 }]);

	await assert.rejects(
		() =>
			publishZenodoDeposition(
				{ deposition_id: 123, confirmation: "publish sandbox deposition 123" },
				undefined,
				{ createClient: fake.createClient },
			),
		/publish response id 456 did not match requested deposition_id 123/,
	);
});

test("publish tool output is copyable and includes receipt", async () => {
	const preflight = publishableDraft();
	const fake = fakeClient([preflight, { ...preflight, doi: "10.5281/zenodo.123" }]);
	const tool = createZenodoPublishDepositionTool({ createClient: fake.createClient });
	const result = await tool.execute("call", {
		deposition_id: 123,
		confirmation: "publish sandbox deposition 123",
	});

	assert.match(result.content[0]?.text ?? "", /Published Zenodo sandbox deposition 123/);
	assert.match(result.content[0]?.text ?? "", /Receipt:/);
	assert.match(result.content[0]?.text ?? "", /DOI: 10\.5281\/zenodo\.123/);
});
