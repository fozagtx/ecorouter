import { Networks } from "@stellar/stellar-sdk";
import { type Express } from "express";
import { Pool } from "pg";
export interface Listing {
    id: string;
    name: string;
    task: string;
    seller: string;
    kind: "api" | "mcp";
    payee: string;
    url: string;
    price: bigint;
    suspended: boolean;
}
export interface Upstream {
    id: string;
    kind: "api" | "mcp";
    url: string;
    auth_header: string | null;
    seller: string;
}
export interface ListingSource {
    list(): Promise<Listing[]>;
    get(id: string): Promise<Listing | null>;
}
export interface UpstreamStore {
    initialize(): Promise<void>;
    get(id: string): Promise<Upstream | null>;
    listConnected(ids: string[]): Promise<Set<string>>;
    put(upstream: Upstream): Promise<void>;
}
export declare class ChainRegistry implements ListingSource {
    private readonly rpc;
    private readonly registryId;
    private readonly networkPassphrase;
    private readonly source;
    private cached?;
    private inflight?;
    constructor(registryId: string, rpcUrl: string, networkPassphrase?: Networks);
    private read;
    list(): Promise<Listing[]>;
    get(id: string): Promise<Listing | null>;
}
export declare class PostgresUpstreams implements UpstreamStore {
    private readonly pool;
    constructor(pool: Pool);
    initialize(): Promise<void>;
    get(id: string): Promise<Upstream | null>;
    listConnected(ids: string[]): Promise<Set<string>>;
    put(upstream: Upstream): Promise<void>;
}
export declare function sep53Message(message: string): Buffer;
export declare function verifySellerSignature(address: string, signatureBase64: string, message: string): boolean;
export declare function validateUpstreamUrl(raw: string, production: boolean, resolver?: (host: string) => Promise<string[]>): Promise<URL>;
export declare function createGateway(options: {
    listings: ListingSource;
    upstreams: UpstreamStore;
    facilitatorUrl: string;
    localFacilitatorUrl?: string;
    usdc: string;
    publicUrl: string;
    nodeEnv?: string;
    nebiusApiKey?: string;
    fetcher?: typeof fetch;
}): Express;
export declare function isMcpFreeMethod(body: unknown): boolean;
export declare function isMcpPaidMethod(body: unknown): boolean;
