/** Testnet contract ids come from the build environment (see scripts/deploy-testnet.sh). */
export interface TestnetConfig {
  rpcUrl: string;
  networkPassphrase: string;
  accountId: string;
  registryId: string;
}

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export function configFromEnv(): TestnetConfig | null {
  const env = import.meta.env;
  if (!env.VITE_TEAM_ACCOUNT_ID || !env.VITE_REGISTRY_ID) return null;
  return {
    rpcUrl: env.VITE_RPC_URL || "https://soroban-testnet.stellar.org",
    networkPassphrase: TESTNET_PASSPHRASE,
    accountId: env.VITE_TEAM_ACCOUNT_ID,
    registryId: env.VITE_REGISTRY_ID,
  };
}

