import deployment from "../../../../deployments/testnet.json";

/** Testnet contract ids default to the committed deployment (deployments/testnet.json); VITE_* env vars override them. */
export interface TestnetConfig {
  rpcUrl: string;
  networkPassphrase: string;
  accountId: string;
  registryId: string;
  usdcId: string;
  gatewayUrl: string | null;
}

export const TESTNET_PASSPHRASE = deployment.networkPassphrase;

export function configFromEnv(): TestnetConfig {
  const env = import.meta.env;
  const deployedGateway = (deployment as unknown as { gateway?: { url?: string } | null }).gateway?.url;
  return {
    rpcUrl: env.VITE_RPC_URL || deployment.rpcUrl,
    networkPassphrase: TESTNET_PASSPHRASE,
    accountId: env.VITE_TEAM_ACCOUNT_ID || deployment.teamAccount.contractId,
    registryId: env.VITE_REGISTRY_ID || deployment.registry.contractId,
    usdcId: env.VITE_USDC_ID || deployment.usdc,
    gatewayUrl: env.VITE_GATEWAY_URL || deployedGateway || null,
  };
}
