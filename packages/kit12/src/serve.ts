#!/usr/bin/env node
import { startProviderServer } from "./server.js";

// Run our three model providers, two search providers and one lookup as x402 endpoints on Metal testnet.
const port = Number(process.env.PORT ?? 4021);
const server = await startProviderServer({ port, walletRoot: process.env.PROVIDER_WALLETS ?? ".wallets/providers" });
console.log(`providers on ${server.url}/p/<id>  (POST /admin/<id> from localhost to change price or speed)`);
