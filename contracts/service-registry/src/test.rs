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

fn register(
    env: &Env,
    client: &ServiceRegistryClient,
    seller: &Address,
    id: &Symbol,
    payee: &Address,
) {
    client.register(
        seller,
        id,
        &String::from_str(env, "Inference credits"),
        &String::from_str(env, "A specialized agent"),
        &symbol_short!("api"),
        payee,
        &String::from_str(env, ""),
        &1_000_000,
    );
}

#[test]
fn resolve_returns_registered_payee() {
    let (env, client, owner) = setup();
    env.mock_all_auths();
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    register(&env, &client, &seller, &id, &payee);
    assert_eq!(client.resolve(&id), payee);
    assert_eq!(client.list().len(), 1);
    assert_eq!(client.by_payee(&payee), Some(id.clone()));
    let listing = client.get(&id).unwrap();
    assert_eq!(listing.seller, seller);
    assert_eq!(listing.kind, symbol_short!("api"));
    assert_eq!(listing.task, String::from_str(&env, "A specialized agent"));
    assert_eq!(listing.price, 1_000_000);
    assert_eq!(client.owner(), owner);
    assert_eq!(client.version(), 2);
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
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    register(&env, &client, &seller, &id, &payee);
    assert_eq!(
        client.try_register(
            &seller,
            &id,
            &String::from_str(&env, "Inference"),
            &String::from_str(&env, "A task"),
            &symbol_short!("api"),
            &payee,
            &String::from_str(&env, ""),
            &1_000_000,
        ),
        Err(Ok(RegistryError::AlreadyRegistered))
    );
}

#[test]
fn register_is_permissionless_but_requires_the_seller() {
    let (env, client, _) = setup();
    let stranger = Address::generate(&env);
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "register",
            args: (
                seller.clone(),
                id.clone(),
                String::from_str(&env, "Inference"),
                String::from_str(&env, "A task"),
                symbol_short!("api"),
                payee.clone(),
                String::from_str(&env, ""),
                1_000_000_i128,
            )
                .into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client
        .try_register(
            &seller,
            &id,
            &String::from_str(&env, "Inference"),
            &String::from_str(&env, "A task"),
            &symbol_short!("api"),
            &payee,
            &String::from_str(&env, ""),
            &1_000_000,
        )
        .is_err());
}

#[test]
fn register_requires_payee_authorization() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    let args = (
        seller.clone(),
        id.clone(),
        String::from_str(&env, "Inference"),
        String::from_str(&env, "A task"),
        symbol_short!("api"),
        payee.clone(),
        String::from_str(&env, ""),
        1_000_000_i128,
    )
        .into_val(&env);
    env.mock_auths(&[MockAuth {
        address: &seller,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "register",
            args,
            sub_invokes: &[],
        },
    }]);

    assert!(client
        .try_register(
            &seller,
            &id,
            &String::from_str(&env, "Inference"),
            &String::from_str(&env, "A task"),
            &symbol_short!("api"),
            &payee,
            &String::from_str(&env, ""),
            &1_000_000,
        )
        .is_err());
}

#[test]
fn suspended_service_does_not_resolve_and_can_be_restored() {
    let (env, client, owner) = setup();
    env.mock_all_auths();
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = symbol_short!("data");
    register(&env, &client, &seller, &id, &payee);
    client.set_suspended(&id, &true, &owner);
    assert_eq!(
        client.try_resolve(&id),
        Err(Ok(RegistryError::ServiceSuspended))
    );
    client.set_suspended(&id, &false, &seller);
    assert_eq!(client.resolve(&id), payee);
}

#[test]
fn payee_can_move_its_own_payout_address() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let next = Address::generate(&env);
    let id = symbol_short!("data");
    register(&env, &client, &seller, &id, &payee);
    client.set_payee(&id, &next);
    assert_eq!(env.auths()[0].0, seller);
    assert_eq!(client.resolve(&id), next);
    assert_eq!(client.by_payee(&payee), None);
    assert_eq!(client.by_payee(&next), Some(id));
}

#[test]
fn set_payee_requires_new_payee_authorization() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let next = Address::generate(&env);
    let id = symbol_short!("data");
    register(&env, &client, &seller, &id, &payee);
    env.mock_auths(&[MockAuth {
        address: &seller,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "set_payee",
            args: (id.clone(), next.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);

    assert!(client.try_set_payee(&id, &next).is_err());
    assert_eq!(client.resolve(&id), payee);
}

#[test]
fn payees_are_unique_and_sellers_can_update_listing_fields() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    register(&env, &client, &seller, &id, &payee);
    assert_eq!(
        client.try_register(
            &seller,
            &symbol_short!("data"),
            &String::from_str(&env, "Data"),
            &String::from_str(&env, "A task"),
            &symbol_short!("api"),
            &payee,
            &String::from_str(&env, ""),
            &1_000_000,
        ),
        Err(Ok(RegistryError::PayeeTaken))
    );

    client.set_url(&id, &String::from_str(&env, "https://gateway.example/a/infer"));
    client.set_price(&id, &2_000_000);
    client.set_task(&id, &String::from_str(&env, "A focused research agent"));
    assert_eq!(
        client.get(&id).unwrap().url,
        String::from_str(&env, "https://gateway.example/a/infer")
    );
    assert_eq!(client.get(&id).unwrap().price, 2_000_000);
    assert_eq!(
        client.get(&id).unwrap().task,
        String::from_str(&env, "A focused research agent")
    );
}

#[test]
fn payee_cannot_move_to_another_listing_payee() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let seller = Address::generate(&env);
    let first = Address::generate(&env);
    let second = Address::generate(&env);
    let id1 = symbol_short!("infer");
    let id2 = symbol_short!("data");
    register(&env, &client, &seller, &id1, &first);
    register(&env, &client, &seller, &id2, &second);
    assert_eq!(
        client.try_set_payee(&id1, &second),
        Err(Ok(RegistryError::PayeeTaken))
    );
}

#[test]
fn listing_kind_and_task_length_are_validated() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    assert_eq!(
        client.try_register(
            &seller,
            &symbol_short!("badkind"),
            &String::from_str(&env, "Bad kind"),
            &String::from_str(&env, "A task"),
            &symbol_short!("compute"),
            &payee,
            &String::from_str(&env, ""),
            &1_000_000,
        ),
        Err(Ok(RegistryError::InvalidListing))
    );
    assert_eq!(
        client.try_register(
            &seller,
            &symbol_short!("toolong"),
            &String::from_str(&env, "Long task"),
            &String::from_bytes(&env, &[b'x'; 281]),
            &symbol_short!("api"),
            &payee,
            &String::from_str(&env, ""),
            &1_000_000,
        ),
        Err(Ok(RegistryError::InvalidListing))
    );
}

#[test]
fn set_task_rejects_more_than_280_bytes() {
    let (env, client, _) = setup();
    env.mock_all_auths();
    let seller = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = symbol_short!("infer");
    register(&env, &client, &seller, &id, &payee);
    assert_eq!(
        client.try_set_task(&id, &String::from_bytes(&env, &[b'x'; 281])),
        Err(Ok(RegistryError::InvalidListing))
    );
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
