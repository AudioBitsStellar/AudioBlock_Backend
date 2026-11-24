/** Resolve Express's trust-proxy setting from deployment configuration. */
export function resolveTrustProxy(
  nodeEnv = process.env.NODE_ENV,
  configuredHops = process.env.TRUST_PROXY_HOPS,
): false | number {
  const hops = Number.parseInt(configuredHops ?? '', 10);
  if (Number.isFinite(hops)) return Math.max(0, hops);
  return nodeEnv === 'production' ? 1 : false;
}
