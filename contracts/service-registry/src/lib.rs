#![no_std]

//! Service registry.
//!
//! A team account never takes a recipient address. It takes a service id and
//! asks this registry where that id pays. An id nobody registered has nowhere
//! to resolve to, so `resolve` fails with `UnknownService` instead of
//! answering with a default address.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, String,
    Symbol, Vec,
};

pub const VERSION: u32 = 2;
const DAY_IN_LEDGERS: u32 = 17_280;
// Expired persistent entries are archived and can be restored.
const BUMP_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const BUMP_TO: u32 = 30 * DAY_IN_LEDGERS;

#[contract]
pub struct ServiceRegistry;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Service {
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
enum DataKey {
    Owner,
    PendingOwner,
    Ids,
    Service(Symbol),
    Payee(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    NotInitialized = 1,
    AlreadyRegistered = 2,
    UnknownService = 3,
    ServiceSuspended = 4,
    NoPendingOwner = 5,
    NotAuthorized = 6,
    PayeeTaken = 7,
    InvalidListing = 8,
}

#[contractevent(topics = ["service", "registered"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ServiceRegistered {
    #[topic]
    pub id: Symbol,
    pub payee: Address,
}

#[contractevent(topics = ["service", "payee"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayeeChanged {
    #[topic]
    pub id: Symbol,
    pub old_payee: Address,
    pub new_payee: Address,
}

#[contractevent(topics = ["service", "suspended"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SuspensionChanged {
    #[topic]
    pub id: Symbol,
    pub suspended: bool,
}

#[contractimpl]
impl ServiceRegistry {
    pub fn __constructor(env: Env, owner: Address) {
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage()
            .instance()
            .set(&DataKey::Ids, &Vec::<Symbol>::new(&env));
        bump_instance(&env);
    }

    pub fn version() -> u32 {
        VERSION
    }

    pub fn owner(env: Env) -> Result<Address, RegistryError> {
        owner(&env)
    }

    /// Registers a unique listing. The seller owns listing metadata.
    pub fn register(
        env: Env,
        seller: Address,
        id: Symbol,
        name: String,
        task: String,
        kind: Symbol,
        payee: Address,
        url: String,
        price: i128,
    ) -> Result<(), RegistryError> {
        seller.require_auth();
        if (kind != soroban_sdk::symbol_short!("mcp")
            && kind != soroban_sdk::symbol_short!("api"))
            || task.len() > 280
        {
            return Err(RegistryError::InvalidListing);
        }
        let key = DataKey::Service(id.clone());
        if env.storage().persistent().has(&key) {
            return Err(RegistryError::AlreadyRegistered);
        }
        let payee_key = DataKey::Payee(payee.clone());
        if env.storage().persistent().has(&payee_key) {
            return Err(RegistryError::PayeeTaken);
        }
        let service = Service {
            id: id.clone(),
            name,
            task,
            seller,
            kind,
            payee: payee.clone(),
            url,
            price,
            suspended: false,
        };
        write_persistent(&env, &key, &service);
        write_persistent(&env, &payee_key, &id);
        let mut ids: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::Ids)
            .unwrap_or(Vec::new(&env));
        ids.push_back(id.clone());
        env.storage().instance().set(&DataKey::Ids, &ids);
        bump_instance(&env);
        ServiceRegistered { id, payee }.publish(&env);
        Ok(())
    }

    /// The current payee may move its own payout address. A team account's
    /// approved exception refuses to settle if this changed after the request
    /// was filed.
    pub fn set_payee(env: Env, id: Symbol, new_payee: Address) -> Result<(), RegistryError> {
        let mut service = service(&env, &id)?;
        service.seller.require_auth();
        let new_key = DataKey::Payee(new_payee.clone());
        if let Some(existing) = env.storage().persistent().get::<_, Symbol>(&new_key) {
            if existing != id {
                return Err(RegistryError::PayeeTaken);
            }
        }
        let old_payee = service.payee.clone();
        env.storage()
            .persistent()
            .remove(&DataKey::Payee(old_payee.clone()));
        service.payee = new_payee.clone();
        write_persistent(&env, &DataKey::Service(id.clone()), &service);
        write_persistent(&env, &new_key, &id);
        PayeeChanged {
            id,
            old_payee,
            new_payee,
        }
        .publish(&env);
        Ok(())
    }

    pub fn set_url(env: Env, id: Symbol, url: String) -> Result<(), RegistryError> {
        let mut service = service(&env, &id)?;
        service.seller.require_auth();
        service.url = url;
        write_persistent(&env, &DataKey::Service(id), &service);
        Ok(())
    }

    pub fn set_price(env: Env, id: Symbol, price: i128) -> Result<(), RegistryError> {
        let mut service = service(&env, &id)?;
        service.seller.require_auth();
        service.price = price;
        write_persistent(&env, &DataKey::Service(id), &service);
        Ok(())
    }

    pub fn set_task(env: Env, id: Symbol, task: String) -> Result<(), RegistryError> {
        let mut service = service(&env, &id)?;
        service.seller.require_auth();
        if task.len() > 280 {
            return Err(RegistryError::InvalidListing);
        }
        service.task = task;
        write_persistent(&env, &DataKey::Service(id), &service);
        Ok(())
    }

    /// A seller or the registry owner may suspend a listing.
    pub fn set_suspended(
        env: Env,
        id: Symbol,
        suspended: bool,
        caller: Address,
    ) -> Result<(), RegistryError> {
        let mut service = service(&env, &id)?;
        caller.require_auth();
        if caller != service.seller && caller != owner(&env)? {
            return Err(RegistryError::NotAuthorized);
        }
        service.suspended = suspended;
        write_persistent(&env, &DataKey::Service(id.clone()), &service);
        SuspensionChanged { id, suspended }.publish(&env);
        Ok(())
    }

    /// Where a payment to `id` goes. Fails on an id nobody registered and on a
    /// suspended service; there is no fallback address.
    pub fn resolve(env: Env, id: Symbol) -> Result<Address, RegistryError> {
        let service = service(&env, &id)?;
        if service.suspended {
            return Err(RegistryError::ServiceSuspended);
        }
        Ok(service.payee)
    }

    pub fn get(env: Env, id: Symbol) -> Option<Service> {
        env.storage().persistent().get(&DataKey::Service(id))
    }

    pub fn by_payee(env: Env, payee: Address) -> Option<Symbol> {
        env.storage().persistent().get(&DataKey::Payee(payee))
    }

    pub fn list(env: Env) -> Vec<Service> {
        let ids: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::Ids)
            .unwrap_or(Vec::new(&env));
        let mut out = Vec::new(&env);
        for id in ids.iter() {
            if let Some(service) = env.storage().persistent().get(&DataKey::Service(id)) {
                out.push_back(service);
            }
        }
        out
    }

    /// Two-step ownership transfer: the current owner proposes, the new owner accepts.
    pub fn propose_owner(env: Env, new_owner: Address) -> Result<(), RegistryError> {
        owner(&env)?.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PendingOwner, &new_owner);
        bump_instance(&env);
        Ok(())
    }

    pub fn accept_owner(env: Env) -> Result<(), RegistryError> {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingOwner)
            .ok_or(RegistryError::NoPendingOwner)?;
        pending.require_auth();
        env.storage().instance().set(&DataKey::Owner, &pending);
        env.storage().instance().remove(&DataKey::PendingOwner);
        bump_instance(&env);
        Ok(())
    }
}

fn owner(env: &Env) -> Result<Address, RegistryError> {
    env.storage()
        .instance()
        .get(&DataKey::Owner)
        .ok_or(RegistryError::NotInitialized)
}

fn service(env: &Env, id: &Symbol) -> Result<Service, RegistryError> {
    env.storage()
        .persistent()
        .get(&DataKey::Service(id.clone()))
        .ok_or(RegistryError::UnknownService)
}

fn write_persistent<V>(env: &Env, key: &DataKey, value: &V)
where
    V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
{
    env.storage().persistent().set(key, value);
    env.storage()
        .persistent()
        .extend_ttl(key, BUMP_THRESHOLD, BUMP_TO);
    bump_instance(env);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

#[cfg(test)]
mod test;
