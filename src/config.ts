/** Backend base URL from the build environment; can be overridden in Settings. */
export const ENV_API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
