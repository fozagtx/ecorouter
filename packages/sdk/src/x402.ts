import {
  Account,
  Address,
  authorizeEntry,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";

const NETWORK = "stellar:testnet";
const RPC_URL = "https://soroban-testnet.stellar.org";

export interface X402PaymentResult {
  body: unknown;
  paymentResponse?: ReturnType<typeof decodePaymentResponseHeader>;
  paymentRequired?: ReturnType<typeof decodePaymentRequiredHeader>;
  resourceFeeStroops: string;
  status: number;
}

function signatureScVal(pair: Keypair, payload: Uint8Array): xdr.ScVal {
  const entries = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("public_key"),
      val: xdr.ScVal.scvBytes(StrKey.decodeEd25519PublicKey(pair.publicKey())),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("signature"),
      val: xdr.ScVal.scvBytes(pair.sign(payload)),
    }),
  ];
  return xdr.ScVal.scvMap(entries);
}

function responseBody(response: Response): Promise<unknown> {
  return response.text().then((text) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
}

export async function payX402(
  fetchUrl: string,
  options: { secret: string; teamAccount: string },
): Promise<X402PaymentResult> {
  const initial = await fetch(fetchUrl);
  if (initial.status !== 402) {
    return {
      body: await responseBody(initial),
      resourceFeeStroops: "0",
      status: initial.status,
    };
  }

  const requiredHeader = initial.headers.get("PAYMENT-REQUIRED");
  if (!requiredHeader) throw new Error("402 response has no PAYMENT-REQUIRED header");
  const paymentRequired = decodePaymentRequiredHeader(requiredHeader);
  const accepted = paymentRequired.accepts.find(
    (requirement) => requirement.scheme === "exact" && requirement.network === NETWORK,
  );
  if (!accepted) throw new Error("402 response has no exact Stellar testnet requirement");

  const spender = Keypair.fromSecret(options.secret);
  const server = new rpc.Server(RPC_URL);
  const source = await server.getAccount(spender.publicKey());
  const transfer = new Contract(accepted.asset).call(
    "transfer",
    new Address(options.teamAccount).toScVal(),
    new Address(accepted.payTo).toScVal(),
    nativeToScVal(BigInt(accepted.amount), { type: "i128" }),
  );
  const transaction = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(transfer)
    .setTimeout(120)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error(`x402 payment simulation failed: ${JSON.stringify(simulation)}`);
  }
  const authEntries = simulation.result?.auth ?? [];
  if (authEntries.length !== 1) {
    throw new Error(`Expected one team-account authorization entry, got ${authEntries.length}`);
  }
  const latestLedger = await server.getLatestLedger();
  const timeoutLedgers = Math.ceil((accepted.maxTimeoutSeconds ?? 60) / 5);
  const signedAuth = await authorizeEntry(
    authEntries[0],
    async (_preimage, payload) => ({
      signatureScVal: signatureScVal(spender, payload),
      address: options.teamAccount,
    }),
    latestLedger.sequence + timeoutLedgers,
    Networks.TESTNET,
    options.teamAccount,
  );

  const invoke = transaction.operations[0];
  if (invoke.type !== "invokeHostFunction") {
    throw new Error("x402 payment transaction is not a contract invocation");
  }
  const authorized = rpc
    .assembleTransaction(transaction, simulation)
    .clearOperations()
    .addOperation(
      Operation.invokeHostFunction({
        source: invoke.source,
        func: invoke.func,
        auth: [signedAuth],
      }),
    )
    .build();
  const authorizedSimulation = await server.simulateTransaction(authorized);
  if (!rpc.Api.isSimulationSuccess(authorizedSimulation)) {
    throw new Error(`Authorized x402 payment simulation failed: ${JSON.stringify(authorizedSimulation)}`);
  }
  const prepared = rpc.assembleTransaction(authorized, authorizedSimulation).build();
  const resourceFeeStroops = String(authorizedSimulation.minResourceFee ?? "0");
  const payload = {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted,
    payload: { transaction: prepared.toXDR() },
  };
  const paid = await fetch(fetchUrl, {
    headers: {
      "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload),
    },
  });
  const body = await responseBody(paid);
  const paymentResponseHeader = paid.headers.get("PAYMENT-RESPONSE");
  const failedRequiredHeader = paid.headers.get("PAYMENT-REQUIRED");
  return {
    body,
    ...(paymentResponseHeader
      ? { paymentResponse: decodePaymentResponseHeader(paymentResponseHeader) }
      : {}),
    ...(failedRequiredHeader
      ? { paymentRequired: decodePaymentRequiredHeader(failedRequiredHeader) }
      : {}),
    resourceFeeStroops,
    status: paid.status,
  };
}
