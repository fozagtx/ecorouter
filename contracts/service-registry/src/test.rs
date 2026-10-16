use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Env, IntoVal, String,
};

fn setup() -> (Env, ServiceRegistryClient<'static>, Address) {
    let env = Env::default();
    let owner = Address::generate(&env);
    let id = env.register(ServiceRegistry, (owner.clone(),));
    let client = ServiceRegistryClient::new(&env, &id);
    (env, client, owner)
}

#[test]
fn resolve_returns_registered_payee() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    client.register(&id, &String::from_str(&env, "Inference credits"), &payee);
    assert_eq!(client.resolve(&id), payee);
    assert_eq!(client.list().len(), 1);
    assert_eq!(client.version(), 1);
}

#[test]
fn resolve_unknown_id_fails_rather_than_returning_an_address() {
    let (_env, client, _) = setup();
    assert_eq!(
        client.try_resolve(&symbol_short!("invented")),
        Err(Ok(RegistryError::UnknownService))
    );
}

#[test]
fn register_twice_is_refused() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    let name = String::from_str(&env, "Inference");
    client.register(&id, &name, &payee);
    assert_eq!(
        client.try_register(&id, &name, &payee),
        Err(Ok(RegistryError::AlreadyRegistered))
    );
}

#[test]
fn register_requires_owner() {
    let (env, client, _) = setup();
    let stranger = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    let name = String::from_str(&env, "Inference");
    env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "register",
            args: (id.clone(), name.clone(), payee.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_register(&id, &name, &payee).is_err());
}

#[test]
fn suspended_service_does_not_resolve_and_can_be_restored() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let payee = Address::generate(&env);
    let id = symbol_short!("data");
    client.register(&id, &String::from_str(&env, "Data API"), &payee);
    client.set_suspended(&id, &true);
    assert_eq!(
        client.try_resolve(&id),
        Err(Ok(RegistryError::ServiceSuspended))
    );
    client.set_suspended(&id, &false);
    assert_eq!(client.resolve(&id), payee);
}

#[test]
fn payee_can_move_its_own_payout_address() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let payee = Address::generate(&env);
    let next = Address::generate(&env);
    let id = symbol_short!("data");
    client.register(&id, &String::from_str(&env, "Data API"), &payee);
    client.set_payee(&id, &next);
    assert_eq!(env.auths()[0].0, payee);
    assert_eq!(client.resolve(&id), next);
}

#[test]
fn ownership_transfer_is_two_step() {
    let (env, client, owner) = setup();
    env.mock_all_auths();
    let next = Address::generate(&env);
    assert_eq!(
        client.try_accept_owner(),
        Err(Ok(RegistryError::NoPendingOwner))
    );
    client.propose_owner(&next);
    assert_eq!(client.owner(), owner);
    client.accept_owner();
    assert_eq!(client.owner(), next);
}
