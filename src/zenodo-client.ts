import axios, {
	type AxiosError,
	type AxiosInstance,
	type AxiosRequestConfig,
} from "axios";

export type ZenodoEnvironment = "sandbox" | "production";

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
	axios: AxiosInstance;
	request<T = unknown>(
		config: AxiosRequestConfig,
		context?: ZenodoErrorContext,
	): Promise<T>;
};

export type CreateZenodoClientOptions = {
	environment?: ZenodoEnvironment;
	env?: NodeJS.ProcessEnv;
	axiosInstance?: AxiosInstance;
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

	const axiosInstance =
		options.axiosInstance ??
		axios.create({
			baseURL,
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

	return {
		environment,
		baseURL,
		tokenEnvVar,
		axios: axiosInstance,
		async request<T = unknown>(
			config: AxiosRequestConfig,
			context: ZenodoErrorContext = {},
		): Promise<T> {
			try {
				const response = await axiosInstance.request<T>(config);
				return response.data;
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
	if (axios.isAxiosError(error)) {
		return normalizeAxiosError(error, context);
	}

	if (error instanceof ZenodoApiError) {
		return { ...error.details, ...context };
	}

	return {
		message: error instanceof Error ? error.message : "Unknown Zenodo error.",
		...context,
	};
}

function normalizeAxiosError(
	error: AxiosError,
	context: ZenodoErrorContext,
): NormalizedZenodoError {
	const responseData = asRecord(error.response?.data);
	const responseMessage = responseData?.message;
	const message =
		typeof responseMessage === "string" && responseMessage.trim()
			? responseMessage
			: error.message || "Zenodo request failed.";
	const zenodoErrors = normalizeValidationErrors(responseData?.errors);

	return {
		message,
		status: error.response?.status,
		statusText: error.response?.statusText,
		zenodoErrors: zenodoErrors.length > 0 ? zenodoErrors : undefined,
		...context,
	};
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
