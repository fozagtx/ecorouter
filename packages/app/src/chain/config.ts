import deployment from "../../../../deployments/testnet.json";

/** Testnet contract ids default to the committed deployment (deployments/testnet.json); VITE_* env vars override them. */
export interface TestnetConfig {
  rpcUrl: string;
  networkPassphrase: string;
  accountId: string;
  registryId: string;
  usdcId: string;
}

export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

export function configFromEnv(): TestnetConfig {
  const env = import.meta.env;
  return {
    rpcUrl: env.VITE_RPC_URL || deployment.rpcUrl,
    networkPassphrase: TESTNET_PASSPHRASE,
    accountId: env.VITE_TEAM_ACCOUNT_ID || deployment.teamAccount.contractId,
    registryId: env.VITE_REGISTRY_ID || deployment.registry.contractId,
    usdcId: env.VITE_USDC_ID || deployment.usdc,
  };
}
