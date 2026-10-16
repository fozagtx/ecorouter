//! Each rule is tested twice: the allowed path goes through, and the refused
//! path fails with the specific error for that rule (so a test cannot pass by
//! failing for the wrong reason).

use super::*;
use service_registry::{ServiceRegistry, ServiceRegistryClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke},
    token::{StellarAssetClient, TokenClient},
    vec, Env, IntoVal, String,
};

const USDC: i128 = 10_000_000; // 7 decimals
const MONTH: u64 = 30 * 24 * 60 * 60;
const START: u64 = 1_800_000_000;

struct T {
    env: Env,
    account: TeamAccountClient<'static>,
    registry: ServiceRegistryClient<'static>,
    token: TokenClient<'static>,
    owner: Address,
    ada: Address,
    infer_payee: Address,
}

fn setup() -> T {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);

    let owner = Address::generate(&env);
    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let registry_id = env.register(ServiceRegistry, (owner.clone(),));
    let registry = ServiceRegistryClient::new(&env, &registry_id);
    let account_id = env.register(
        TeamAccount,
        (owner.clone(), sac.address(), registry_id.clone()),
    );
    let account = TeamAccountClient::new(&env, &account_id);
    StellarAssetClient::new(&env, &sac.address()).mint(&account_id, &(5_000 * USDC));

    let infer_payee = Address::generate(&env);
    registry.register(
        &symbol_short!("infer"),
        &String::from_str(&env, "Inference credits"),
        &infer_payee,
    );
    registry.register(
        &symbol_short!("data"),
        &String::from_str(&env, "Market data API"),
        &Address::generate(&env),
    );

    let ada = Address::generate(&env);
    let token = TokenClient::new(&env, &sac.address());
    let t = T {
        env,
        account,
        registry,
        token,
        owner,
        ada,
        infer_payee,
    };
    let ada = t.ada.clone();
    t.account.set_policy(&ada, &person(&t.env));
    t
}

/// $1,000 a month, $250 per payment, 5 payments a month, two services.
fn person(env: &Env) -> PolicyInput {
    PolicyInput {
        kind: SpenderKind::Person,
        label: String::from_str(env, "Ada"),
        allowance: 1_000 * USDC,
        period: MONTH,
        max_payment: 250 * USDC,
        max_payments: 5,
        expires_at: START + 365 * 24 * 60 * 60,
        services: vec![env, symbol_short!("infer"), symbol_short!("data")],
    }
}

fn key(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

fn memo(env: &Env) -> String {
    String::from_str(env, "top up")
}

fn pay(t: &T, spender: &Address, service: Symbol, amount: i128, n: u8) -> Result<Receipt, AccountError> {
    match t
        .account
        .try_pay(spender, &service, &amount, &memo(&t.env), &key(&t.env, n))
    {
        Ok(Ok(r)) => Ok(r),
        Err(Ok(e)) => Err(e),
        other => panic!("unexpected result {:?}", other),
    }
}

// ------------------------------------------------------------------- paying

#[test]
fn in_policy_payment_moves_money_and_returns_a_receipt() {
    let t = setup();
    let r = pay(&t, &t.ada, symbol_short!("infer"), 120 * USDC, 1).unwrap();
    assert_eq!(r.payee, t.infer_payee);
    assert_eq!(r.amount, 120 * USDC);
    assert_eq!(r.period_spent, 120 * USDC);
    assert_eq!(r.allowance_left, 880 * USDC);
    assert_eq!(t.token.balance(&t.infer_payee), 120 * USDC);
    assert_eq!(t.account.balance(), 4_880 * USDC);
    assert_eq!(t.account.usage(&t.ada).count, 1);
    assert!(t.account.is_key_used(&t.ada, &key(&t.env, 1)));
}

#[test]
fn pay_requires_the_spenders_own_signature() {
    let t = setup();
    let stranger = Address::generate(&t.env);
    let (service, amount, m, k) = (symbol_short!("infer"), USDC, memo(&t.env), key(&t.env, 1));
    t.env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &t.account.address,
            fn_name: "pay",
            args: (t.ada.clone(), service.clone(), amount, m.clone(), k.clone()).into_val(&t.env),
            sub_invokes: &[],
        },
    }]);
    assert!(t.account.try_pay(&t.ada, &service, &amount, &m, &k).is_err());
    assert_eq!(t.token.balance(&t.infer_payee), 0);
}

#[test]
fn paused_account_refuses_and_resumes() {
    let t = setup();
    t.account.set_paused(&true);
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), USDC, 1),
        Err(AccountError::AccountPaused)
    );
    t.account.set_paused(&false);
    assert!(pay(&t, &t.ada, symbol_short!("infer"), USDC, 1).is_ok());
}

#[test]
fn unknown_spender_is_refused() {
    let t = setup();
    let nobody = Address::generate(&t.env);
    assert_eq!(
        pay(&t, &nobody, symbol_short!("infer"), USDC, 1),
        Err(AccountError::UnknownSpender)
    );
}

#[test]
fn paused_spender_is_refused_and_resumes() {
    let t = setup();
    t.account.set_spender_paused(&t.ada, &true);
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), USDC, 1),
        Err(AccountError::SpenderPaused)
    );
    t.account.set_spender_paused(&t.ada, &false);
    assert!(pay(&t, &t.ada, symbol_short!("infer"), USDC, 1).is_ok());
}

#[test]
fn expired_policy_is_refused() {
    let t = setup();
    let mut p = person(&t.env);
    p.expires_at = START + 100;
    t.account.set_policy(&t.ada, &p);
    t.env.ledger().set_timestamp(START + 99);
    assert!(pay(&t, &t.ada, symbol_short!("infer"), USDC, 1).is_ok());
    t.env.ledger().set_timestamp(START + 100);
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), USDC, 2),
        Err(AccountError::PolicyExpired)
    );
}

#[test]
fn zero_and_negative_amounts_are_refused() {
    let t = setup();
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), 0, 1),
        Err(AccountError::InvalidAmount)
    );
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), -5, 2),
        Err(AccountError::InvalidAmount)
    );
}

#[test]
fn service_off_the_spenders_list_is_refused_even_if_registered() {
    let t = setup();
    t.registry.register(
        &symbol_short!("gpu"),
        &String::from_str(&t.env, "GPU hours"),
        &Address::generate(&t.env),
    );
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("gpu"), USDC, 1),
        Err(AccountError::ServiceNotAllowed)
    );
    assert!(pay(&t, &t.ada, symbol_short!("data"), USDC, 2).is_ok());
}

#[test]
fn reused_key_is_refused_so_a_retry_cannot_pay_twice() {
    let t = setup();
    assert!(pay(&t, &t.ada, symbol_short!("infer"), USDC, 7).is_ok());
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), USDC, 7),
        Err(AccountError::DuplicatePayment)
    );
    assert_eq!(t.token.balance(&t.infer_payee), USDC);
}

#[test]
fn per_payment_cap_allows_exactly_the_cap_and_refuses_one_unit_more() {
    let t = setup();
    assert!(pay(&t, &t.ada, symbol_short!("infer"), 250 * USDC, 1).is_ok());
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), 250 * USDC + 1, 2),
        Err(AccountError::OverPaymentCap)
    );
    let v = t.account.check(&t.ada, &symbol_short!("infer"), &(420 * USDC));
    assert_eq!(v.rule, AccountError::OverPaymentCap as u32);
    assert_eq!(v.over_by, 170 * USDC);
}

#[test]
fn payments_per_period_are_capped() {
    let t = setup();
    for n in 1..=5u8 {
        assert!(pay(&t, &t.ada, symbol_short!("infer"), USDC, n).is_ok());
    }
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), USDC, 6),
        Err(AccountError::OverFrequency)
    );
}

#[test]
fn allowance_allows_exactly_the_limit_and_refuses_beyond_it() {
    let t = setup();
    for n in 1..=4u8 {
        assert!(pay(&t, &t.ada, symbol_short!("infer"), 250 * USDC, n).is_ok());
    }
    assert_eq!(t.account.usage(&t.ada).spent, 1_000 * USDC);
    let mut p = person(&t.env);
    p.max_payments = 10;
    t.account.set_policy(&t.ada, &p);
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), 1, 5),
        Err(AccountError::OverAllowance)
    );
    let v = t.account.check(&t.ada, &symbol_short!("infer"), &(60 * USDC));
    assert_eq!(v.rule, AccountError::OverAllowance as u32);
    assert_eq!(v.over_by, 60 * USDC);
    assert_eq!(v.allowance_left, 0);
}

#[test]
fn allowance_and_count_reset_when_the_period_rolls_over() {
    let t = setup();
    for n in 1..=4u8 {
        pay(&t, &t.ada, symbol_short!("infer"), 250 * USDC, n).unwrap();
    }
    t.env.ledger().set_timestamp(START + MONTH - 1);
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), USDC, 9),
        Err(AccountError::OverAllowance)
    );
    t.env.ledger().set_timestamp(START + MONTH);
    assert_eq!(t.account.usage(&t.ada).spent, 0);
    let r = pay(&t, &t.ada, symbol_short!("infer"), 100 * USDC, 10).unwrap();
    assert_eq!(r.period_spent, 100 * USDC);
}

#[test]
fn service_on_the_list_but_never_registered_is_refused_by_the_registry() {
    let t = setup();
    let mut p = person(&t.env);
    p.services.push_back(symbol_short!("ghost"));
    t.account.set_policy(&t.ada, &p);
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("ghost"), USDC, 1),
        Err(AccountError::UnknownService)
    );
    let v = t.account.check(&t.ada, &symbol_short!("ghost"), &USDC);
    assert_eq!(v.rule, AccountError::UnknownService as u32);
}

#[test]
fn suspended_service_is_refused() {
    let t = setup();
    t.registry.set_suspended(&symbol_short!("infer"), &true);
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), USDC, 1),
        Err(AccountError::ServiceSuspended)
    );
    t.registry.set_suspended(&symbol_short!("infer"), &false);
    assert!(pay(&t, &t.ada, symbol_short!("infer"), USDC, 1).is_ok());
}

#[test]
fn insufficient_balance_is_refused_without_moving_anything() {
    let t = setup();
    t.account.withdraw(&t.owner, &(4_950 * USDC));
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), 100 * USDC, 1),
        Err(AccountError::InsufficientFunds)
    );
    assert_eq!(t.account.usage(&t.ada).spent, 0);
    assert!(!t.account.is_key_used(&t.ada, &key(&t.env, 1)));
}

#[test]
fn check_reports_zero_for_a_payment_that_would_go_through() {
    let t = setup();
    let v = t.account.check(&t.ada, &symbol_short!("infer"), &(120 * USDC));
    assert_eq!(v.rule, 0);
    assert_eq!(v.allowance_left, 1_000 * USDC);
}

// ----------------------------------------------------------------- policies

#[test]
fn policy_with_any_zero_or_inconsistent_limit_is_refused() {
    let t = setup();
    let bob = Address::generate(&t.env);
    let cases: [fn(&mut PolicyInput); 6] = [
        |p| p.allowance = 0,
        |p| p.max_payment = 0,
        |p| p.max_payment = p.allowance + 1,
        |p| p.period = 0,
        |p| p.max_payments = 0,
        |p| p.expires_at = START,
    ];
    for f in cases.iter() {
        let mut p = person(&t.env);
        f(&mut p);
        assert_eq!(
            t.account.try_set_policy(&bob, &p),
            Err(Ok(AccountError::InvalidPolicy))
        );
    }
    assert!(t.account.try_set_policy(&bob, &person(&t.env)).is_ok());
    assert_eq!(t.account.spenders().len(), 2);
}

#[test]
fn set_policy_requires_the_owner() {
    let t = setup();
    let bob = Address::generate(&t.env);
    let p = person(&t.env);
    t.env.mock_auths(&[MockAuth {
        address: &t.ada,
        invoke: &MockAuthInvoke {
            contract: &t.account.address,
            fn_name: "set_policy",
            args: (bob.clone(), p.clone()).into_val(&t.env),
            sub_invokes: &[],
        },
    }]);
    assert!(t.account.try_set_policy(&bob, &p).is_err());
}

#[test]
fn updating_a_policy_keeps_usage_and_pause_state() {
    let t = setup();
    pay(&t, &t.ada, symbol_short!("infer"), 200 * USDC, 1).unwrap();
    t.account.set_spender_paused(&t.ada, &true);
    let mut p = person(&t.env);
    p.allowance = 2_000 * USDC;
    t.account.set_policy(&t.ada, &p);
    assert_eq!(t.account.usage(&t.ada).spent, 200 * USDC);
    assert!(t.account.policy(&t.ada).unwrap().paused);
}

#[test]
fn removed_spender_can_no_longer_pay() {
    let t = setup();
    t.account.remove_spender(&t.ada);
    assert_eq!(t.account.spenders().len(), 0);
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), USDC, 1),
        Err(AccountError::UnknownSpender)
    );
    assert_eq!(
        t.account.try_remove_spender(&t.ada),
        Err(Ok(AccountError::UnknownSpender))
    );
}

// ---------------------------------------------------------------- approvals

fn file(t: &T, amount: i128) -> u64 {
    t.account
        .request_approval(&t.ada, &symbol_short!("infer"), &amount, &memo(&t.env))
}

#[test]
fn held_payment_can_be_filed_approved_and_settled_as_separate_steps() {
    let t = setup();
    assert_eq!(
        pay(&t, &t.ada, symbol_short!("infer"), 420 * USDC, 1),
        Err(AccountError::OverPaymentCap)
    );
    let id = file(&t, 420 * USDC);
    let r = t.account.request(&id).unwrap();
    assert_eq!(r.status, RequestStatus::Pending);
    assert_eq!(r.rule, AccountError::OverPaymentCap as u32);
    assert_eq!(r.over_by, 170 * USDC);
    assert_eq!(t.token.balance(&t.infer_payee), 0);

    t.account.approve(&id);
    assert_eq!(t.account.request(&id).unwrap().status, RequestStatus::Approved);
    assert_eq!(t.token.balance(&t.infer_payee), 0);

    t.account.settle(&id, &t.ada);
    assert_eq!(t.account.request(&id).unwrap().status, RequestStatus::Settled);
    assert_eq!(t.token.balance(&t.infer_payee), 420 * USDC);
    // An exception does not consume the allowance.
    assert_eq!(t.account.usage(&t.ada).spent, 0);
    assert_eq!(t.account.requests(&0, &10).len(), 1);
}

#[test]
fn filing_a_payment_that_would_pass_is_refused() {
    let t = setup();
    assert_eq!(
        t.account
            .try_request_approval(&t.ada, &symbol_short!("infer"), &USDC, &memo(&t.env)),
        Err(Ok(AccountError::NoExceptionNeeded))
    );
}

#[test]
fn only_limit_rules_are_eligible_for_an_exception() {
    let t = setup();
    t.account.set_spender_paused(&t.ada, &true);
    assert_eq!(
        t.account.try_request_approval(
            &t.ada,
            &symbol_short!("infer"),
            &(420 * USDC),
            &memo(&t.env)
        ),
        Err(Ok(AccountError::SpenderPaused))
    );
}

#[test]
fn exception_for_an_unregistered_service_is_refused() {
    let t = setup();
    assert_eq!(
        t.account
            .try_request_approval(&t.ada, &symbol_short!("ghost"), &USDC, &memo(&t.env)),
        Err(Ok(AccountError::UnknownService))
    );
}

#[test]
fn an_agents_refused_payment_stops_there() {
    let t = setup();
    let bot = Address::generate(&t.env);
    let mut p = person(&t.env);
    p.kind = SpenderKind::Agent;
    t.account.set_policy(&bot, &p);
    assert_eq!(
        t.account.try_request_approval(
            &bot,
            &symbol_short!("infer"),
            &(420 * USDC),
            &memo(&t.env)
        ),
        Err(Ok(AccountError::AgentCannotRequest))
    );
}

#[test]
fn approve_requires_the_owner() {
    let t = setup();
    let id = file(&t, 420 * USDC);
    t.env.mock_auths(&[MockAuth {
        address: &t.ada,
        invoke: &MockAuthInvoke {
            contract: &t.account.address,
            fn_name: "approve",
            args: (id,).into_val(&t.env),
            sub_invokes: &[],
        },
    }]);
    assert!(t.account.try_approve(&id).is_err());
}

#[test]
fn settle_before_approval_or_twice_is_refused() {
    let t = setup();
    let id = file(&t, 420 * USDC);
    assert_eq!(
        t.account.try_settle(&id, &t.owner),
        Err(Ok(AccountError::RequestNotApproved))
    );
    t.account.approve(&id);
    t.account.settle(&id, &t.owner);
    assert_eq!(
        t.account.try_settle(&id, &t.owner),
        Err(Ok(AccountError::RequestNotApproved))
    );
    assert_eq!(t.token.balance(&t.infer_payee), 420 * USDC);
}

#[test]
fn declined_request_cannot_be_settled() {
    let t = setup();
    let id = file(&t, 420 * USDC);
    t.account.approve(&id);
    t.account.decline(&id);
    assert_eq!(
        t.account.try_settle(&id, &t.ada),
        Err(Ok(AccountError::RequestNotApproved))
    );
    assert_eq!(
        t.account.try_decline(&id),
        Err(Ok(AccountError::RequestNotPending))
    );
}

#[test]
fn settle_refuses_if_the_payee_moved_after_the_request() {
    let t = setup();
    let id = file(&t, 420 * USDC);
    t.account.approve(&id);
    let thief = Address::generate(&t.env);
    t.registry.set_payee(&symbol_short!("infer"), &thief);
    assert_eq!(
        t.account.try_settle(&id, &t.owner),
        Err(Ok(AccountError::PayeeChanged))
    );
    assert_eq!(t.token.balance(&thief), 0);
}

#[test]
fn settle_by_a_third_party_is_refused() {
    let t = setup();
    let id = file(&t, 420 * USDC);
    t.account.approve(&id);
    let stranger = Address::generate(&t.env);
    assert_eq!(
        t.account.try_settle(&id, &stranger),
        Err(Ok(AccountError::NotAuthorized))
    );
}

#[test]
fn expired_request_can_be_neither_approved_nor_settled() {
    let t = setup();
    let a = file(&t, 420 * USDC);
    let b = file(&t, 300 * USDC);
    t.account.approve(&b);
    t.env.ledger().set_timestamp(START + REQUEST_TTL_SECS);
    assert_eq!(
        t.account.try_approve(&a),
        Err(Ok(AccountError::RequestExpired))
    );
    assert_eq!(
        t.account.try_settle(&b, &t.owner),
        Err(Ok(AccountError::RequestExpired))
    );
}

#[test]
fn paused_account_does_not_settle_approved_requests() {
    let t = setup();
    let id = file(&t, 420 * USDC);
    t.account.approve(&id);
    t.account.set_paused(&true);
    assert_eq!(
        t.account.try_settle(&id, &t.owner),
        Err(Ok(AccountError::AccountPaused))
    );
}

#[test]
fn unknown_request_is_reported() {
    let t = setup();
    assert_eq!(
        t.account.try_approve(&99),
        Err(Ok(AccountError::UnknownRequest))
    );
}

// -------------------------------------------------------------------- owner

#[test]
fn owner_can_withdraw_within_balance() {
    let t = setup();
    assert_eq!(
        t.account.try_withdraw(&t.owner, &0),
        Err(Ok(AccountError::InvalidAmount))
    );
    assert_eq!(
        t.account.try_withdraw(&t.owner, &(5_001 * USDC)),
        Err(Ok(AccountError::InsufficientFunds))
    );
    t.account.withdraw(&t.owner, &(1_000 * USDC));
    assert_eq!(t.token.balance(&t.owner), 1_000 * USDC);
}

#[test]
fn withdraw_requires_the_owner() {
    let t = setup();
    t.env.mock_auths(&[MockAuth {
        address: &t.ada,
        invoke: &MockAuthInvoke {
            contract: &t.account.address,
            fn_name: "withdraw",
            args: (t.ada.clone(), USDC).into_val(&t.env),
            sub_invokes: &[],
        },
    }]);
    assert!(t.account.try_withdraw(&t.ada, &USDC).is_err());
}

#[test]
fn ownership_transfer_is_two_step() {
    let t = setup();
    let next = Address::generate(&t.env);
    assert_eq!(
        t.account.try_accept_owner(),
        Err(Ok(AccountError::NoPendingOwner))
    );
    t.account.propose_owner(&next);
    assert_eq!(t.account.owner(), t.owner);
    t.account.accept_owner();
    assert_eq!(t.account.owner(), next);
}
