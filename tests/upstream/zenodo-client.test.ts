import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";
import {
	ZenodoApiError,
	createZenodoClient,
	getZenodoBaseURL,
	getZenodoToken,
	getZenodoTokenEnvVar,
	normalizeZenodoError,
} from "../src/zenodo-client.ts";

test("resolves Zenodo base URLs and token environment variables", () => {
	assert.equal(getZenodoBaseURL("sandbox"), "https://sandbox.zenodo.org/api");
	assert.equal(getZenodoBaseURL("production"), "https://zenodo.org/api");
	assert.equal(getZenodoTokenEnvVar("sandbox"), "ZENODO_SANDBOX_TOKEN");
	assert.equal(getZenodoTokenEnvVar("production"), "ZENODO_TOKEN");
});

test("reads separate sandbox and production tokens", () => {
	const env = {
		ZENODO_SANDBOX_TOKEN: " sandbox-token ",
		ZENODO_TOKEN: "production-token",
	};

	assert.equal(getZenodoToken("sandbox", env), "sandbox-token");
	assert.equal(getZenodoToken("production", env), "production-token");
});

test("createZenodoClient requires the selected environment token", () => {
	assert.throws(
		() => createZenodoClient({ environment: "sandbox", env: {} }),
		(error: unknown) => {
			assert.ok(error instanceof ZenodoApiError);
			assert.match(error.message, /ZENODO_SANDBOX_TOKEN/);
			return true;
		},
	);
});

test("createZenodoClient sets Bearer auth header without URL token params", () => {
	const client = createZenodoClient({
		environment: "sandbox",
		env: { ZENODO_SANDBOX_TOKEN: "secret-token" },
	});

	assert.equal(client.baseURL, "https://sandbox.zenodo.org/api");
	assert.equal(client.tokenEnvVar, "ZENODO_SANDBOX_TOKEN");
	assert.equal(client.axios.defaults.baseURL, "https://sandbox.zenodo.org/api");
	assert.equal(
		client.axios.defaults.headers.Authorization,
		"Bearer secret-token",
	);
	assert.doesNotMatch(client.axios.defaults.baseURL ?? "", /secret-token/);
});

test("request wraps Zenodo validation errors without leaking request config", async () => {
	const axiosInstance = {
		async request() {
			throw new axios.AxiosError(
				"Request failed with status code 400",
				"ERR_BAD_REQUEST",
				{ headers: { Authorization: "Bearer secret-token" } } as never,
				undefined,
				{
					status: 400,
					statusText: "Bad Request",
					data: {
						message: "Validation error",
						errors: [
							{ field: "metadata.title", message: "Missing data." },
						],
					},
					headers: {},
					config: {} as never,
				} as never,
			);
		},
	} as never;

	const client = createZenodoClient({
		environment: "sandbox",
		env: { ZENODO_SANDBOX_TOKEN: "secret-token" },
		axiosInstance,
	});

	await assert.rejects(
		() => client.request({ method: "PUT", url: "/deposit/depositions/1" }),
		(error: unknown) => {
			assert.ok(error instanceof ZenodoApiError);
			assert.equal(error.details.status, 400);
			assert.deepEqual(error.details.zenodoErrors, [
				{ field: "metadata.title", message: "Missing data." },
			]);
			assert.match(error.message, /metadata\.title: Missing data\./);
			assert.doesNotMatch(JSON.stringify(error.details), /secret-token/);
			assert.doesNotMatch(error.message, /secret-token/);
			return true;
		},
	);
});

test("normalizeZenodoError preserves safe context", () => {
	const normalized = normalizeZenodoError(new Error("boom"), {
		environment: "production",
		endpoint: "/deposit/depositions/1",
		method: "GET",
		deposition_id: 1,
	});

	assert.deepEqual(normalized, {
		message: "boom",
		environment: "production",
		endpoint: "/deposit/depositions/1",
		method: "GET",
		deposition_id: 1,
	});
});
