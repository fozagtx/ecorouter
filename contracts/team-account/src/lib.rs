#![no_std]

//! Team account.
//!
//! One USDC account shared by people and AI agents. Every spender pays under
//! its own policy, checked here, by the contract that holds the money.
//!
//! `pay` takes a service id, never an address: the payee always comes from the
//! service registry. A payment outside the policy is refused and nothing moves.
//! A person may then file an approval request; the owner approves or declines
//! it, and settlement is a separate transaction that refuses if the service's
//! payee changed after the request was filed.

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, crypto::Hash,
    symbol_short, token, Address, Bytes, BytesN, Env, String, Symbol, TryFromVal, Vec,
};

pub const VERSION: u32 = 2;

/// Approval requests stay open for seven days.
pub const REQUEST_TTL_SECS: u64 = 7 * 24 * 60 * 60;
/// Upper bound on the approved-services list for one spender.
pub const MAX_SERVICES: u32 = 32;

const DAY_IN_LEDGERS: u32 = 17_280;
// Expired persistent entries are archived and can be restored.
const BUMP_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const BUMP_TO: u32 = 30 * DAY_IN_LEDGERS;

#[contract]
pub struct TeamAccount;

#[contractimpl]
impl CustomAccountInterface for TeamAccount {
    type Signature = SpenderSignature;
    type Error = AccountError;

    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Self::Signature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Self::Error> {
        env.crypto().ed25519_verify(
            &signatures.public_key,
            &Bytes::from(signature_payload.to_bytes()),
            &signatures.signature,
        );

        let spender: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Signer(signatures.public_key))
            .ok_or(AccountError::NotAuthorized)?;

        if is_paused(&env) {
            return Err(AccountError::AccountPaused);
        }
        let policy: Policy = env
            .storage()
            .persistent()
            .get(&DataKey::Policy(spender.clone()))
            .ok_or(AccountError::UnknownSpender)?;
        if policy.paused {
            return Err(AccountError::SpenderPaused);
        }
        if env.ledger().timestamp() >= policy.expires_at {
            return Err(AccountError::PolicyExpired);
        }

        if auth_contexts.len() != 1 {
            return Err(AccountError::NotAuthorized);
        }
        let context = match auth_contexts.get(0) {
            Some(Context::Contract(context)) => context,
            _ => return Err(AccountError::NotAuthorized),
        };
        let asset: Address = env
            .storage()
            .instance()
            .get(&DataKey::Asset)
            .ok_or(AccountError::NotAuthorized)?;
        if context.contract != asset
            || context.fn_name != symbol_short!("transfer")
            || context.args.len() != 3
        {
            return Err(AccountError::NotAuthorized);
        }
        let from_val = context.args.get(0).ok_or(AccountError::NotAuthorized)?;
        let to_val = context.args.get(1).ok_or(AccountError::NotAuthorized)?;
        let amount_val = context.args.get(2).ok_or(AccountError::NotAuthorized)?;
        let from = Address::try_from_val(&env, &from_val).map_err(|_| AccountError::NotAuthorized)?;
        let payee = Address::try_from_val(&env, &to_val).map_err(|_| AccountError::NotAuthorized)?;
        let amount =
            i128::try_from_val(&env, &amount_val).map_err(|_| AccountError::NotAuthorized)?;
        // This prevents a spender key from authorizing anything except a USDC transfer.
        if from != env.current_contract_address() || amount <= 0 {
            return Err(AccountError::NotAuthorized);
        }

        let registry_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Registry)
            .ok_or(AccountError::NotAuthorized)?;
        let registry = RegistryClient::new(&env, &registry_address);
        let service = registry
            .by_payee(&payee)
            .ok_or(AccountError::UnknownService)?;
        let listing = registry
            .get(&service)
            .ok_or(AccountError::UnknownService)?;
        if listing.suspended {
            return Err(AccountError::ServiceSuspended);
        }

        let evaluation = evaluate(&env, &spender, &service, amount, None)
            .map_err(|(error, _)| error)?;
        if balance(&env) < amount {
            return Err(AccountError::InsufficientFunds);
        }
        let mut usage = evaluation.usage;
        usage.spent += amount;
        usage.count += 1;
        write_persistent(&env, &DataKey::Usage(spender.clone()), &usage);
        bump_instance(&env);
        X402Paid {
            spender,
            service,
            payee,
            amount,
            period_spent: usage.spent,
        }
        .publish(&env);
        Ok(())
    }
}

/// The one registry call this account makes.
#[contractclient(name = "RegistryClient")]
pub trait RegistryInterface {
    fn resolve(env: Env, id: Symbol) -> Address;
    fn by_payee(env: Env, payee: Address) -> Option<Symbol>;
    fn get(env: Env, id: Symbol) -> Option<RegistryService>;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryService {
    pub id: Symbol,
    pub name: String,
    pub task: String,
    pub seller: Address,
    pub kind: Symbol,
    pub payee: Address,
    pub url: String,
    pub price: i128,
    pub suspended: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpenderSignature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JoinRequest {
    pub who: Address,
    pub label: String,
    pub at: u64,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SpenderKind {
    Person = 0,
    Agent = 1,
}

/// What the owner writes. Every field is required and must be positive; a
/// zero never means "no limit".
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicyInput {
    pub kind: SpenderKind,
    pub signer: BytesN<32>,
    pub label: String,
    /// Atomic units allowed per period.
    pub allowance: i128,
    /// Period length in seconds (e.g. 2_592_000 for 30 days).
    pub period: u64,
    /// Atomic units allowed in a single payment.
    pub max_payment: i128,
    /// Payments allowed per period.
    pub max_payments: u32,
    /// Ledger timestamp after which the policy stops authorizing.
    pub expires_at: u64,
    /// Service ids this spender may pay.
    pub services: Vec<Symbol>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Policy {
    pub kind: SpenderKind,
    pub signer: BytesN<32>,
    pub label: String,
    pub allowance: i128,
    pub period: u64,
    pub max_payment: i128,
    pub max_payments: u32,
    pub expires_at: u64,
    pub services: Vec<Symbol>,
    pub paused: bool,
    /// Periods are fixed windows counted from this timestamp.
    pub anchor: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Usage {
    pub period_start: u64,
    pub spent: i128,
    pub count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Receipt {
    pub spender: Address,
    pub service: Symbol,
    pub payee: Address,
    pub amount: i128,
    pub memo: String,
    pub period_spent: i128,
    pub allowance_left: i128,
    pub at: u64,
}

/// Result of a dry-run check. `rule` is 0 when the payment would go through,
/// otherwise the `AccountError` code that would refuse it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Verdict {
    pub rule: u32,
    pub over_by: i128,
    pub allowance_left: i128,
    pub period_spent: i128,
    pub period_count: u32,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RequestStatus {
    Pending = 0,
    Approved = 1,
    Declined = 2,
    Settled = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ApprovalRequest {
    pub id: u64,
    pub spender: Address,
    pub service: Symbol,
    /// Payee the registry returned when the request was filed.
    pub payee: Address,
    pub amount: i128,
    pub memo: String,
    /// The `AccountError` code of the rule that held the payment.
    pub rule: u32,
    /// How far over that rule the payment was (units depend on the rule).
    pub over_by: i128,
    pub status: RequestStatus,
    pub created_at: u64,
    pub expires_at: u64,
}

#[contracttype]
enum DataKey {
    Owner,
    PendingOwner,
    Asset,
    Registry,
    Paused,
    Spenders,
    NextRequest,
    Policy(Address),
    Usage(Address),
    Replay(Address, BytesN<32>),
    Request(u64),
    Signer(BytesN<32>),
    JoinRequest(Address),
    JoinRequests,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AccountError {
    AccountPaused = 1,
    UnknownSpender = 2,
    SpenderPaused = 3,
    PolicyExpired = 4,
    InvalidAmount = 5,
    ServiceNotAllowed = 6,
    DuplicatePayment = 7,
    OverPaymentCap = 8,
    OverFrequency = 9,
    OverAllowance = 10,
    UnknownService = 11,
    ServiceSuspended = 12,
    InsufficientFunds = 13,
    InvalidPolicy = 14,
    UnknownRequest = 15,
    RequestNotPending = 16,
    RequestNotApproved = 17,
    RequestExpired = 18,
    PayeeChanged = 19,
    NotAuthorized = 20,
    NoExceptionNeeded = 21,
    NotEligibleForException = 22,
    AgentCannotRequest = 23,
    RegistryUnavailable = 24,
    NoPendingOwner = 25,
    DuplicateJoinRequest = 26,
    NoJoinRequest = 27,
    AlreadyConfigured = 28,
}

#[contractevent(topics = ["x402", "paid"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct X402Paid {
    pub spender: Address,
    pub service: Symbol,
    pub payee: Address,
    pub amount: i128,
    pub period_spent: i128,
}

#[contractevent(topics = ["join", "requested"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JoinRequested {
    #[topic]
    pub who: Address,
    pub label: String,
    pub at: u64,
}

#[contractevent(topics = ["join", "dismissed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JoinDismissed {
    #[topic]
    pub who: Address,
    pub label: String,
}

// Registry error codes, as defined by the service-registry contract.
const REGISTRY_UNKNOWN_SERVICE: u32 = 3;
const REGISTRY_SERVICE_SUSPENDED: u32 = 4;

#[contractevent(topics = ["pay"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paid {
    #[topic]
    pub spender: Address,
    #[topic]
    pub service: Symbol,
    pub payee: Address,
    pub amount: i128,
    pub memo: String,
    pub key: BytesN<32>,
    pub period_spent: i128,
}

#[contractevent(topics = ["request", "filed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestFiled {
    #[topic]
    pub id: u64,
    pub spender: Address,
    pub service: Symbol,
    pub amount: i128,
    pub rule: u32,
    pub over_by: i128,
}

#[contractevent(topics = ["request", "decided"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestDecided {
    #[topic]
    pub id: u64,
    pub status: RequestStatus,
}

#[contractevent(topics = ["request", "settled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestSettled {
    #[topic]
    pub id: u64,
    pub payee: Address,
    pub amount: i128,
}

#[contractevent(topics = ["policy", "set"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PolicySet {
    #[topic]
    pub spender: Address,
    pub allowance: i128,
    pub max_payment: i128,
    pub expires_at: u64,
}

#[contractevent(topics = ["policy", "paused"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpenderPauseChanged {
    #[topic]
    pub spender: Address,
    pub paused: bool,
}

#[contractevent(topics = ["policy", "removed"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpenderRemoved {
    #[topic]
    pub spender: Address,
}

#[contractevent(topics = ["account", "paused"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccountPauseChanged {
    pub paused: bool,
}

#[contractevent(topics = ["account", "withdraw"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    pub to: Address,
    pub amount: i128,
}

/// Internal outcome of running the policy against a proposed payment.
struct Evaluation {
    policy: Policy,
    usage: Usage,
}

#[contractimpl]
impl TeamAccount {
    pub fn __constructor(env: Env, owner: Address, asset: Address, registry: Address) {
        let s = env.storage().instance();
        s.set(&DataKey::Owner, &owner);
        s.set(&DataKey::Asset, &asset);
        s.set(&DataKey::Registry, &registry);
        s.set(&DataKey::Paused, &false);
        s.set(&DataKey::Spenders, &Vec::<Address>::new(&env));
        s.set(&DataKey::NextRequest, &1u64);
    }

    pub fn version() -> u32 {
        VERSION
    }

    // ---------------------------------------------------------------- owner

    /// Owner-only. Creates or fully overwrites a spender's policy. A new
    /// spender starts a fresh period; an existing one keeps its period, usage
    /// and pause state.
    pub fn set_policy(env: Env, spender: Address, input: PolicyInput) -> Result<(), AccountError> {
        owner(&env).require_auth();
        let now = env.ledger().timestamp();
        if input.allowance <= 0
            || input.max_payment <= 0
            || input.max_payment > input.allowance
            || input.period == 0
            || input.max_payments == 0
            || input.expires_at <= now
            || input.services.len() > MAX_SERVICES
        {
            return Err(AccountError::InvalidPolicy);
        }
        let key = DataKey::Policy(spender.clone());
        let existing: Option<Policy> = env.storage().persistent().get(&key);
        let signer_key = DataKey::Signer(input.signer.clone());
        if let Some(mapped) = env.storage().persistent().get::<_, Address>(&signer_key) {
            if mapped != spender {
                return Err(AccountError::InvalidPolicy);
            }
        }
        let (anchor, paused) = match &existing {
            Some(p) => (p.anchor, p.paused),
            None => (now, false),
        };
        let policy = Policy {
            kind: input.kind,
            signer: input.signer.clone(),
            label: input.label,
            allowance: input.allowance,
            period: input.period,
            max_payment: input.max_payment,
            max_payments: input.max_payments,
            expires_at: input.expires_at,
            services: input.services,
            paused,
            anchor,
        };
        if let Some(old) = existing.as_ref().map(|p| p.signer.clone()) {
            if old != policy.signer {
                env.storage().persistent().remove(&DataKey::Signer(old));
            }
        }
        write_persistent(&env, &key, &policy);
        write_persistent(&env, &signer_key, &spender);
        if existing.is_none() {
            let mut list = spenders(&env);
            list.push_back(spender.clone());
            env.storage().instance().set(&DataKey::Spenders, &list);
            write_persistent(
                &env,
                &DataKey::Usage(spender.clone()),
                &Usage {
                    period_start: now,
                    spent: 0,
                    count: 0,
                },
            );
        }
        clear_join_request(&env, &spender);
        bump_instance(&env);
        PolicySet {
            spender,
            allowance: policy.allowance,
            max_payment: policy.max_payment,
            expires_at: policy.expires_at,
        }
        .publish(&env);
        Ok(())
    }

    pub fn set_spender_paused(env: Env, spender: Address, paused: bool) -> Result<(), AccountError> {
        owner(&env).require_auth();
        let key = DataKey::Policy(spender.clone());
        let mut policy: Policy = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(AccountError::UnknownSpender)?;
        policy.paused = paused;
        write_persistent(&env, &key, &policy);
        SpenderPauseChanged { spender, paused }.publish(&env);
        Ok(())
    }

    pub fn remove_spender(env: Env, spender: Address) -> Result<(), AccountError> {
        owner(&env).require_auth();
        let key = DataKey::Policy(spender.clone());
        if !env.storage().persistent().has(&key) {
            return Err(AccountError::UnknownSpender);
        }
        let policy: Policy = env.storage().persistent().get(&key).unwrap();
        env.storage()
            .persistent()
            .remove(&DataKey::Signer(policy.signer));
        env.storage().persistent().remove(&key);
        env.storage()
            .persistent()
            .remove(&DataKey::Usage(spender.clone()));
        let list = spenders(&env);
        let mut kept = Vec::new(&env);
        for s in list.iter() {
            if s != spender {
                kept.push_back(s);
            }
        }
        env.storage().instance().set(&DataKey::Spenders, &kept);
        SpenderRemoved { spender }.publish(&env);
        Ok(())
    }

    /// Owner-only. A paused account authorizes nothing, including settlement
    /// of approved requests.
    pub fn set_paused(env: Env, paused: bool) {
        owner(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        AccountPauseChanged { paused }.publish(&env);
    }

    pub fn withdraw(env: Env, to: Address, amount: i128) -> Result<(), AccountError> {
        owner(&env).require_auth();
        if amount <= 0 {
            return Err(AccountError::InvalidAmount);
        }
        if balance(&env) < amount {
            return Err(AccountError::InsufficientFunds);
        }
        token_client(&env).transfer(&env.current_contract_address(), &to, &amount);
        Withdrawn { to, amount }.publish(&env);
        Ok(())
    }

    pub fn propose_owner(env: Env, new_owner: Address) {
        owner(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PendingOwner, &new_owner);
    }

    pub fn accept_owner(env: Env) -> Result<(), AccountError> {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingOwner)
            .ok_or(AccountError::NoPendingOwner)?;
        pending.require_auth();
        env.storage().instance().set(&DataKey::Owner, &pending);
        env.storage().instance().remove(&DataKey::PendingOwner);
        Ok(())
    }

    // -------------------------------------------------------------- spender

    /// Pays `amount` to the service registered as `service`, if the spender's
    /// policy allows it. There is no recipient parameter. `key` is a one-time
    /// idempotency key chosen by the caller; reusing it is refused, so a
    /// retried submission can never pay twice.
    pub fn pay(
        env: Env,
        spender: Address,
        service: Symbol,
        amount: i128,
        memo: String,
        key: BytesN<32>,
    ) -> Result<Receipt, AccountError> {
        spender.require_auth();
        let replay = DataKey::Replay(spender.clone(), key.clone());
        let eval = evaluate(&env, &spender, &service, amount, Some(&replay))
            .map_err(|(code, _)| code)?;
        let payee = resolve(&env, &service)?;
        if balance(&env) < amount {
            return Err(AccountError::InsufficientFunds);
        }

        let mut usage = eval.usage;
        usage.spent += amount;
        usage.count += 1;
        write_persistent(&env, &DataKey::Usage(spender.clone()), &usage);
        write_persistent(&env, &replay, &true);
        bump_instance(&env);

        let before = balance(&env);
        token_client(&env).transfer(&env.current_contract_address(), &payee, &amount);
        let moved = before - balance(&env);

        let receipt = Receipt {
            spender: spender.clone(),
            service: service.clone(),
            payee: payee.clone(),
            amount: moved,
            memo: memo.clone(),
            period_spent: usage.spent,
            allowance_left: eval.policy.allowance - usage.spent,
            at: env.ledger().timestamp(),
        };
        Paid {
            spender,
            service,
            payee,
            amount: moved,
            memo,
            key,
            period_spent: usage.spent,
        }
        .publish(&env);
        Ok(receipt)
    }

    /// Dry run of `pay` without auth or state changes, so an app can show the
    /// rule that would refuse a payment before anything is signed.
    pub fn check(env: Env, spender: Address, service: Symbol, amount: i128) -> Verdict {
        match evaluate(&env, &spender, &service, amount, None) {
            Ok(eval) => {
                let usage = eval.usage;
                let rule = match resolve(&env, &service) {
                    Ok(_) if balance(&env) < amount => AccountError::InsufficientFunds as u32,
                    Ok(_) => 0,
                    Err(e) => e as u32,
                };
                Verdict {
                    rule,
                    over_by: 0,
                    allowance_left: eval.policy.allowance - usage.spent,
                    period_spent: usage.spent,
                    period_count: usage.count,
                }
            }
            Err((code, over_by)) => {
                let usage = Self::usage(env.clone(), spender.clone());
                let allowance_left = Self::policy(env, spender)
                    .map(|p| p.allowance - usage.spent)
                    .unwrap_or(0);
                Verdict {
                    rule: code as u32,
                    over_by,
                    allowance_left,
                    period_spent: usage.spent,
                    period_count: usage.count,
                }
            }
        }
    }

    /// Files a held payment for the owner to decide. Only a person can file,
    /// only for a payment one of the exception-eligible rules refused
    /// (service list, per-payment cap, payments per period, allowance), and
    /// only to a service the registry resolves. Nothing moves here.
    pub fn request_approval(
        env: Env,
        spender: Address,
        service: Symbol,
        amount: i128,
        memo: String,
    ) -> Result<u64, AccountError> {
        spender.require_auth();
        let (rule, over_by) = match evaluate(&env, &spender, &service, amount, None) {
            Ok(_) => return Err(AccountError::NoExceptionNeeded),
            Err((code, over_by)) => match code {
                AccountError::ServiceNotAllowed
                | AccountError::OverPaymentCap
                | AccountError::OverFrequency
                | AccountError::OverAllowance => (code, over_by),
                other => return Err(other),
            },
        };
        let policy = policy(&env, &spender)?;
        if policy.kind == SpenderKind::Agent {
            return Err(AccountError::AgentCannotRequest);
        }
        let payee = resolve(&env, &service)?;

        let id: u64 = env.storage().instance().get(&DataKey::NextRequest).unwrap_or(1);
        env.storage().instance().set(&DataKey::NextRequest, &(id + 1));
        let now = env.ledger().timestamp();
        let request = ApprovalRequest {
            id,
            spender: spender.clone(),
            service: service.clone(),
            payee,
            amount,
            memo,
            rule: rule as u32,
            over_by,
            status: RequestStatus::Pending,
            created_at: now,
            expires_at: now + REQUEST_TTL_SECS,
        };
        write_persistent(&env, &DataKey::Request(id), &request);
        bump_instance(&env);
        RequestFiled {
            id,
            spender,
            service,
            amount,
            rule: rule as u32,
            over_by,
        }
        .publish(&env);
        Ok(id)
    }

    /// Owner-only. Approving moves no money; `settle` does.
    pub fn approve(env: Env, id: u64) -> Result<(), AccountError> {
        owner(&env).require_auth();
        let mut request = request(&env, id)?;
        if request.status != RequestStatus::Pending {
            return Err(AccountError::RequestNotPending);
        }
        if env.ledger().timestamp() >= request.expires_at {
            return Err(AccountError::RequestExpired);
        }
        request.status = RequestStatus::Approved;
        write_persistent(&env, &DataKey::Request(id), &request);
        RequestDecided {
            id,
            status: RequestStatus::Approved,
        }
        .publish(&env);
        Ok(())
    }

    /// Owner-only. Declines a pending or approved-but-unsettled request.
    pub fn decline(env: Env, id: u64) -> Result<(), AccountError> {
        owner(&env).require_auth();
        let mut request = request(&env, id)?;
        if request.status != RequestStatus::Pending && request.status != RequestStatus::Approved {
            return Err(AccountError::RequestNotPending);
        }
        request.status = RequestStatus::Declined;
        write_persistent(&env, &DataKey::Request(id), &request);
        RequestDecided {
            id,
            status: RequestStatus::Declined,
        }
        .publish(&env);
        Ok(())
    }

    /// Moves the money for an approved request. Callable by the owner or by
    /// the spender who filed it. The registry is asked again, and the payment
    /// refuses if the payee is no longer the one the owner approved. Settled
    /// exceptions do not consume the spender's allowance.
    pub fn settle(env: Env, id: u64, caller: Address) -> Result<(), AccountError> {
        caller.require_auth();
        let mut request = request(&env, id)?;
        if caller != owner(&env) && caller != request.spender {
            return Err(AccountError::NotAuthorized);
        }
        if is_paused(&env) {
            return Err(AccountError::AccountPaused);
        }
        if request.status != RequestStatus::Approved {
            return Err(AccountError::RequestNotApproved);
        }
        if env.ledger().timestamp() >= request.expires_at {
            return Err(AccountError::RequestExpired);
        }
        let payee = resolve(&env, &request.service)?;
        if payee != request.payee {
            return Err(AccountError::PayeeChanged);
        }
        if balance(&env) < request.amount {
            return Err(AccountError::InsufficientFunds);
        }
        request.status = RequestStatus::Settled;
        write_persistent(&env, &DataKey::Request(id), &request);
        token_client(&env).transfer(&env.current_contract_address(), &payee, &request.amount);
        RequestSettled {
            id,
            payee,
            amount: request.amount,
        }
        .publish(&env);
        Ok(())
    }

    // ---------------------------------------------------------------- views

    pub fn owner(env: Env) -> Address {
        owner(&env)
    }

    pub fn asset(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Asset).unwrap()
    }

    pub fn registry(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Registry).unwrap()
    }

    pub fn paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn balance(env: Env) -> i128 {
        balance(&env)
    }

    pub fn spenders(env: Env) -> Vec<Address> {
        spenders(&env)
    }

    pub fn policy(env: Env, spender: Address) -> Option<Policy> {
        env.storage().persistent().get(&DataKey::Policy(spender))
    }

    /// Usage for the current period (a period that has ended reads as zero).
    pub fn usage(env: Env, spender: Address) -> Usage {
        let now = env.ledger().timestamp();
        match env
            .storage()
            .persistent()
            .get::<_, Policy>(&DataKey::Policy(spender.clone()))
        {
            Some(p) => current_usage(&env, &spender, &p, now),
            None => Usage {
                period_start: now,
                spent: 0,
                count: 0,
            },
        }
    }

    pub fn request_join(env: Env, who: Address, label: String) -> Result<(), AccountError> {
        who.require_auth();
        if env.storage().persistent().has(&DataKey::Policy(who.clone())) {
            return Err(AccountError::AlreadyConfigured);
        }
        let key = DataKey::JoinRequest(who.clone());
        if env.storage().persistent().has(&key) {
            return Err(AccountError::DuplicateJoinRequest);
        }
        let request = JoinRequest {
            who: who.clone(),
            label,
            at: env.ledger().timestamp(),
        };
        write_persistent(&env, &key, &request);
        let mut addresses: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::JoinRequests)
            .unwrap_or(Vec::new(&env));
        addresses.push_back(who.clone());
        env.storage()
            .instance()
            .set(&DataKey::JoinRequests, &addresses);
        bump_instance(&env);
        JoinRequested { who, label: request.label, at: request.at }.publish(&env);
        Ok(())
    }

    pub fn join_requests(env: Env) -> Vec<JoinRequest> {
        let addresses: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::JoinRequests)
            .unwrap_or(Vec::new(&env));
        let mut requests = Vec::new(&env);
        for who in addresses.iter() {
            if let Some(request) = env
                .storage()
                .persistent()
                .get(&DataKey::JoinRequest(who))
            {
                requests.push_back(request);
            }
        }
        requests
    }

    pub fn dismiss_join(env: Env, who: Address) -> Result<(), AccountError> {
        owner(&env).require_auth();
        let request: JoinRequest = env
            .storage()
            .persistent()
            .get(&DataKey::JoinRequest(who.clone()))
            .ok_or(AccountError::NoJoinRequest)?;
        clear_join_request(&env, &who);
        bump_instance(&env);
        JoinDismissed {
            who,
            label: request.label,
        }
        .publish(&env);
        Ok(())
    }

    pub fn request(env: Env, id: u64) -> Option<ApprovalRequest> {
        env.storage().persistent().get(&DataKey::Request(id))
    }

    /// Requests with ids in `[from, from + limit)`.
    pub fn requests(env: Env, from: u64, limit: u32) -> Vec<ApprovalRequest> {
        let next: u64 = env.storage().instance().get(&DataKey::NextRequest).unwrap_or(1);
        let mut out = Vec::new(&env);
        let mut id = if from == 0 { 1 } else { from };
        while id < next && out.len() < limit {
            if let Some(r) = env.storage().persistent().get(&DataKey::Request(id)) {
                out.push_back(r);
            }
            id += 1;
        }
        out
    }

    pub fn is_key_used(env: Env, spender: Address, key: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Replay(spender, key))
    }
}

/// Runs the policy rules in their fixed order. On refusal returns the rule
/// and how far over it the payment was.
fn evaluate(
    env: &Env,
    spender: &Address,
    service: &Symbol,
    amount: i128,
    replay: Option<&DataKey>,
) -> Result<Evaluation, (AccountError, i128)> {
    if is_paused(env) {
        return Err((AccountError::AccountPaused, 0));
    }
    let policy: Policy = env
        .storage()
        .persistent()
        .get(&DataKey::Policy(spender.clone()))
        .ok_or((AccountError::UnknownSpender, 0))?;
    if policy.paused {
        return Err((AccountError::SpenderPaused, 0));
    }
    let now = env.ledger().timestamp();
    if now >= policy.expires_at {
        return Err((AccountError::PolicyExpired, 0));
    }
    if amount <= 0 {
        return Err((AccountError::InvalidAmount, 0));
    }
    if !policy.services.contains(service) {
        return Err((AccountError::ServiceNotAllowed, amount));
    }
    if let Some(key) = replay {
        if env.storage().persistent().has(key) {
            return Err((AccountError::DuplicatePayment, 0));
        }
    }
    if amount > policy.max_payment {
        return Err((AccountError::OverPaymentCap, amount - policy.max_payment));
    }
    let usage = current_usage(env, spender, &policy, now);
    if usage.count >= policy.max_payments {
        return Err((AccountError::OverFrequency, 1));
    }
    let after = usage
        .spent
        .checked_add(amount)
        .ok_or((AccountError::OverAllowance, amount))?;
    if after > policy.allowance {
        return Err((AccountError::OverAllowance, after - policy.allowance));
    }
    Ok(Evaluation { policy, usage })
}

fn current_usage(env: &Env, spender: &Address, policy: &Policy, now: u64) -> Usage {
    let start = if now <= policy.anchor {
        policy.anchor
    } else {
        policy.anchor + ((now - policy.anchor) / policy.period) * policy.period
    };
    let stored: Option<Usage> = env
        .storage()
        .persistent()
        .get(&DataKey::Usage(spender.clone()));
    match stored {
        Some(u) if u.period_start == start => u,
        _ => Usage {
            period_start: start,
            spent: 0,
            count: 0,
        },
    }
}

fn resolve(env: &Env, service: &Symbol) -> Result<Address, AccountError> {
    let registry: Address = env.storage().instance().get(&DataKey::Registry).unwrap();
    match RegistryClient::new(env, &registry).try_resolve(service) {
        Ok(Ok(payee)) => Ok(payee),
        Err(Ok(err)) if err == soroban_sdk::Error::from_contract_error(REGISTRY_UNKNOWN_SERVICE) => {
            Err(AccountError::UnknownService)
        }
        Err(Ok(err))
            if err == soroban_sdk::Error::from_contract_error(REGISTRY_SERVICE_SUSPENDED) =>
        {
            Err(AccountError::ServiceSuspended)
        }
        _ => Err(AccountError::RegistryUnavailable),
    }
}

fn owner(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Owner).unwrap()
}

fn policy(env: &Env, spender: &Address) -> Result<Policy, AccountError> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(spender.clone()))
        .ok_or(AccountError::UnknownSpender)
}

fn request(env: &Env, id: u64) -> Result<ApprovalRequest, AccountError> {
    env.storage()
        .persistent()
        .get(&DataKey::Request(id))
        .ok_or(AccountError::UnknownRequest)
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

fn spenders(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Spenders)
        .unwrap_or(Vec::new(env))
}

fn token_client(env: &Env) -> token::Client<'_> {
    let asset: Address = env.storage().instance().get(&DataKey::Asset).unwrap();
    token::Client::new(env, &asset)
}

fn balance(env: &Env) -> i128 {
    token_client(env).balance(&env.current_contract_address())
}

fn write_persistent<V>(env: &Env, key: &DataKey, value: &V)
where
    V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
{
    env.storage().persistent().set(key, value);
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, BUMP_TO);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

fn clear_join_request(env: &Env, who: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::JoinRequest(who.clone()));
    let addresses: Vec<Address> = env
        .storage()
        .instance()
        .get(&DataKey::JoinRequests)
        .unwrap_or(Vec::new(env));
    let mut remaining = Vec::new(env);
    for address in addresses.iter() {
        if address != *who {
            remaining.push_back(address);
        }
    }
    env.storage()
        .instance()
        .set(&DataKey::JoinRequests, &remaining);
}

#[cfg(test)]
mod test;
