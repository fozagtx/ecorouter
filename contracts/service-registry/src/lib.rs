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

pub const VERSION: u32 = 1;

#[contract]
pub struct ServiceRegistry;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Service {
    pub id: Symbol,
    pub name: String,
    pub payee: Address,
    pub suspended: bool,
}

#[contracttype]
enum DataKey {
    Owner,
    PendingOwner,
    Ids,
    Service(Symbol),
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
    }

    pub fn version() -> u32 {
        VERSION
    }

    pub fn owner(env: Env) -> Result<Address, RegistryError> {
        owner(&env)
    }

    /// Owner-only. Registers a new service id. Ids are never reused.
    pub fn register(
        env: Env,
        id: Symbol,
        name: String,
        payee: Address,
    ) -> Result<(), RegistryError> {
        owner(&env)?.require_auth();
        let key = DataKey::Service(id.clone());
        if env.storage().persistent().has(&key) {
            return Err(RegistryError::AlreadyRegistered);
        }
        let service = Service {
            id: id.clone(),
            name,
            payee: payee.clone(),
            suspended: false,
        };
        env.storage().persistent().set(&key, &service);
        let mut ids: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::Ids)
            .unwrap_or(Vec::new(&env));
        ids.push_back(id.clone());
        env.storage().instance().set(&DataKey::Ids, &ids);
        ServiceRegistered { id, payee }.publish(&env);
        Ok(())
    }

    /// The current payee may move its own payout address. A team account's
    /// approved exception refuses to settle if this changed after the request
    /// was filed.
    pub fn set_payee(env: Env, id: Symbol, new_payee: Address) -> Result<(), RegistryError> {
        let mut service = service(&env, &id)?;
        service.payee.require_auth();
        let old_payee = service.payee.clone();
        service.payee = new_payee.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Service(id.clone()), &service);
        PayeeChanged {
            id,
            old_payee,
            new_payee,
        }
        .publish(&env);
        Ok(())
    }

    /// Owner-only. A suspended service resolves to nothing.
    pub fn set_suspended(env: Env, id: Symbol, suspended: bool) -> Result<(), RegistryError> {
        owner(&env)?.require_auth();
        let mut service = service(&env, &id)?;
        service.suspended = suspended;
        env.storage()
            .persistent()
            .set(&DataKey::Service(id.clone()), &service);
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

#[cfg(test)]
mod test;
