/** Public deployment settings, loaded from /config.js before Angular starts. */
export interface GokulRuntimeConfig {
  apiUrl?: string;
  frontendUrl?: string;
  socketUrl?: string;
}

declare global {
  interface Window { GOKUL_CONFIG?: GokulRuntimeConfig; }
}

export function deploymentConfig(defaults: Required<GokulRuntimeConfig>): Required<GokulRuntimeConfig> {
  const config = typeof window !== 'undefined' ? window.GOKUL_CONFIG : undefined;
  return {
    apiUrl: config?.apiUrl?.replace(/\/$/, '') || defaults.apiUrl,
    frontendUrl: config?.frontendUrl?.replace(/\/$/, '') || defaults.frontendUrl,
    socketUrl: config?.socketUrl?.replace(/\/$/, '') || defaults.socketUrl,
  };
}
