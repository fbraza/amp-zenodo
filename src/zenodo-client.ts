export type ZenodoEnvironment = "sandbox" | "production";

export type ZenodoRequestConfig = {
	method?: string;
	url?: string;
	data?: unknown;
	headers?: Record<string, string | number | boolean | undefined>;
	signal?: AbortSignal;
	maxBodyLength?: number;
	maxContentLength?: number;
};

export type ZenodoErrorContext = {
	environment?: ZenodoEnvironment;
	endpoint?: string;
	method?: string;
	deposition_id?: number | string;
};

export type ZenodoValidationError = {
	field?: string;
	message?: string;
	[key: string]: unknown;
};

export type NormalizedZenodoError = {
	message: string;
	status?: number;
	statusText?: string;
	zenodoErrors?: ZenodoValidationError[];
	endpoint?: string;
	method?: string;
	environment?: ZenodoEnvironment;
	deposition_id?: number | string;
};

export type ZenodoClient = {
	environment: ZenodoEnvironment;
	baseURL: string;
	tokenEnvVar: string;
	request<T = unknown>(
		config: ZenodoRequestConfig,
		context?: ZenodoErrorContext,
	): Promise<T>;
};

export type CreateZenodoClientOptions = {
	environment?: ZenodoEnvironment;
	env?: NodeJS.ProcessEnv;
	fetch?: typeof fetch;
};

export class ZenodoApiError extends Error {
	readonly details: NormalizedZenodoError;

	constructor(details: NormalizedZenodoError) {
		super(formatZenodoErrorMessage(details));
		this.name = "ZenodoApiError";
		this.details = details;
	}
}

export const ZENODO_BASE_URLS: Record<ZenodoEnvironment, string> = {
	sandbox: "https://sandbox.zenodo.org/api",
	production: "https://zenodo.org/api",
};

export const ZENODO_TOKEN_ENV_VARS: Record<ZenodoEnvironment, string> = {
	sandbox: "ZENODO_SANDBOX_TOKEN",
	production: "ZENODO_TOKEN",
};

export function getZenodoBaseURL(environment: ZenodoEnvironment): string {
	return ZENODO_BASE_URLS[environment];
}

export function getZenodoTokenEnvVar(environment: ZenodoEnvironment): string {
	return ZENODO_TOKEN_ENV_VARS[environment];
}

export function getZenodoToken(
	environment: ZenodoEnvironment,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const token = env[getZenodoTokenEnvVar(environment)]?.trim();
	return token || undefined;
}

export function createZenodoClient(
	options: CreateZenodoClientOptions = {},
): ZenodoClient {
	const environment = options.environment ?? "sandbox";
	const baseURL = getZenodoBaseURL(environment);
	const tokenEnvVar = getZenodoTokenEnvVar(environment);
	const token = getZenodoToken(environment, options.env);

	if (!token) {
		throw new ZenodoApiError({
			message: `Missing Zenodo access token in ${tokenEnvVar}.`,
			environment,
		});
	}

	const fetchImpl = options.fetch ?? fetch;

	return {
		environment,
		baseURL,
		tokenEnvVar,
		async request<T = unknown>(
			config: ZenodoRequestConfig,
			context: ZenodoErrorContext = {},
		): Promise<T> {
			try {
				const response = await fetchImpl(resolveZenodoUrl(baseURL, config.url),
					toFetchRequestInit(config, token),
				);
				const data = await readZenodoResponse(response);
				if (!response.ok) {
					throw new ZenodoHttpError(response, data);
				}
				return data as T;
			} catch (error) {
				throw new ZenodoApiError(
					normalizeZenodoError(error, {
						environment,
						endpoint: config.url,
						method: config.method,
						...context,
					}),
				);
			}
		},
	};
}

export function normalizeZenodoError(
	error: unknown,
	context: ZenodoErrorContext = {},
): NormalizedZenodoError {
	if (error instanceof ZenodoHttpError) {
		return normalizeHttpError(error, context);
	}

	if (error instanceof ZenodoApiError) {
		return { ...error.details, ...context };
	}

	return {
		message: error instanceof Error ? error.message : "Unknown Zenodo error.",
		...context,
	};
}

class ZenodoHttpError extends Error {
	readonly response: Response;
	readonly data: unknown;

	constructor(response: Response, data: unknown) {
		super(`Zenodo request failed with ${response.status} ${response.statusText}.`);
		this.name = "ZenodoHttpError";
		this.response = response;
		this.data = data;
	}
}

function normalizeHttpError(
	error: ZenodoHttpError,
	context: ZenodoErrorContext,
): NormalizedZenodoError {
	const responseData = asRecord(error.data);
	const responseMessage = responseData?.message;
	const message =
		typeof responseMessage === "string" && responseMessage.trim()
			? responseMessage
			: error.message || "Zenodo request failed.";
	const zenodoErrors = normalizeValidationErrors(responseData?.errors);

	return {
		message,
		status: error.response.status,
		statusText: error.response.statusText,
		zenodoErrors: zenodoErrors.length > 0 ? zenodoErrors : undefined,
		...context,
	};
}

function resolveZenodoUrl(baseURL: string, url = ""): string {
	if (/^https?:\/\//i.test(url)) return url;
	const cleanBaseURL = baseURL.replace(/\/+$/, "");
	const cleanPath = url.replace(/^\/+/, "");
	return cleanPath ? `${cleanBaseURL}/${cleanPath}` : cleanBaseURL;
}

function toFetchRequestInit(
	config: ZenodoRequestConfig,
	token: string,
): RequestInit & { duplex?: "half" } {
	const headers = new Headers({ Authorization: `Bearer ${token}` });
	for (const [key, value] of Object.entries(config.headers ?? {})) {
		if (value !== undefined) headers.set(key, String(value));
	}
	const init: RequestInit & { duplex?: "half" } = {
		method: config.method ?? "GET",
		headers,
		signal: config.signal,
	};
	if (config.data !== undefined) {
		init.body = toFetchBody(config.data, headers);
		if (isStreamingBody(config.data)) init.duplex = "half";
	}
	return init;
}

function toFetchBody(value: unknown, headers: Headers): BodyInit {
	const contentType = headers.get("Content-Type") ?? "";
	if (contentType.toLowerCase().includes("application/json") && isPlainObject(value)) {
		return JSON.stringify(value);
	}
	return value as BodyInit;
}

async function readZenodoResponse(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return { message: text };
	}
}

function isStreamingBody(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	return typeof (value as { pipe?: unknown }).pipe === "function";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function normalizeValidationErrors(value: unknown): ZenodoValidationError[] {
	if (!Array.isArray(value)) return [];
	return value.map((item) => {
		const record = asRecord(item);
		if (!record) return { message: String(item) };
		return { ...record } as ZenodoValidationError;
	});
}

function formatZenodoErrorMessage(details: NormalizedZenodoError): string {
	const lines = [details.message];
	for (const error of details.zenodoErrors ?? []) {
		const field = typeof error.field === "string" ? `${error.field}: ` : "";
		const message =
			typeof error.message === "string" ? error.message : JSON.stringify(error);
		lines.push(`${field}${message}`);
	}
	return lines.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}
