#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env,
    Symbol, TryFromVal, Val, Vec,
};

#[contract]
pub struct ArbiterAccount;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Mandate {
    pub session_public_key: BytesN<32>,
    pub asset: Address,
    pub total_limit: i128,
    pub spent: i128,
    pub max_payment: i128,
    pub expires_at: u64,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct SessionSignature {
    pub public_key: BytesN<32>,
    pub signature: BytesN<64>,
}

#[contracttype]
enum DataKey {
    Owner,
    Mandate,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AccountError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidExpiration = 4,
    MandateNotFound = 5,
    MandateRevoked = 6,
    MandateExpired = 7,
    WrongSigner = 8,
    UnsupportedInvocation = 9,
    WrongAsset = 10,
    WrongSource = 11,
    PaymentAboveMaximum = 12,
    AllowanceExceeded = 13,
}

#[contractimpl]
impl ArbiterAccount {
    pub fn initialize(env: Env, owner: Address) -> Result<(), AccountError> {
        owner.require_auth();
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(AccountError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        Ok(())
    }

    pub fn create_mandate(
        env: Env,
        session_public_key: BytesN<32>,
        asset: Address,
        total_limit: i128,
        max_payment: i128,
        expires_at: u64,
    ) -> Result<(), AccountError> {
        let owner = owner(&env)?;
        owner.require_auth();
        if total_limit <= 0 || max_payment <= 0 || max_payment > total_limit {
            return Err(AccountError::InvalidAmount);
        }
        if expires_at <= env.ledger().timestamp() {
            return Err(AccountError::InvalidExpiration);
        }

        let mandate = Mandate {
            session_public_key,
            asset: asset.clone(),
            total_limit,
            spent: 0,
            max_payment,
            expires_at,
            revoked: false,
        };
        env.storage().instance().set(&DataKey::Mandate, &mandate);
        env.events().publish(
            (symbol_short!("mandate"), symbol_short!("created")),
            (asset, total_limit, max_payment, expires_at),
        );
        Ok(())
    }

    pub fn revoke_mandate(env: Env) -> Result<(), AccountError> {
        owner(&env)?.require_auth();
        let mut mandate = mandate(&env)?;
        mandate.revoked = true;
        env.storage().instance().set(&DataKey::Mandate, &mandate);
        env.events()
            .publish((symbol_short!("mandate"), symbol_short!("revoked")), ());
        Ok(())
    }

    pub fn withdraw(
        env: Env,
        asset: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), AccountError> {
        owner(&env)?.require_auth();
        if amount <= 0 {
            return Err(AccountError::InvalidAmount);
        }
        token::Client::new(&env, &asset).transfer(&env.current_contract_address(), &to, &amount);
        env.events()
            .publish((symbol_short!("withdraw"), asset), (to, amount));
        Ok(())
    }

    pub fn get_mandate(env: Env) -> Result<Mandate, AccountError> {
        mandate(&env)
    }

    /// Custom-account authorization hook. The session key can authorize only a
    /// single token transfer from this contract; administrative invocations are
    /// structurally impossible through this path.
    pub fn __check_auth(
        env: Env,
        signature_payload: BytesN<32>,
        signature: SessionSignature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), AccountError> {
        let mut mandate = mandate(&env)?;
        if mandate.revoked {
            return Err(AccountError::MandateRevoked);
        }
        if env.ledger().timestamp() >= mandate.expires_at {
            return Err(AccountError::MandateExpired);
        }
        if signature.public_key != mandate.session_public_key {
            return Err(AccountError::WrongSigner);
        }
        env.crypto().ed25519_verify(
            &signature.public_key,
            &signature_payload.clone().into(),
            &signature.signature,
        );

        if auth_contexts.len() != 1 {
            return Err(AccountError::UnsupportedInvocation);
        }
        let context = auth_contexts
            .get(0)
            .ok_or(AccountError::UnsupportedInvocation)?;
        let (asset, function, args) = match context {
            Context::Contract(ContractContext {
                contract,
                fn_name,
                args,
            }) => (contract, fn_name, args),
            _ => return Err(AccountError::UnsupportedInvocation),
        };
        if asset != mandate.asset {
            return Err(AccountError::WrongAsset);
        }
        if function != Symbol::new(&env, "transfer") || args.len() != 3 {
            return Err(AccountError::UnsupportedInvocation);
        }

        let source = Address::try_from_val(&env, &arg(&args, 0)?)
            .map_err(|_| AccountError::UnsupportedInvocation)?;
        let recipient = Address::try_from_val(&env, &arg(&args, 1)?)
            .map_err(|_| AccountError::UnsupportedInvocation)?;
        let amount = i128::try_from_val(&env, &arg(&args, 2)?)
            .map_err(|_| AccountError::UnsupportedInvocation)?;
        if source != env.current_contract_address() {
            return Err(AccountError::WrongSource);
        }
        if amount <= 0 {
            return Err(AccountError::InvalidAmount);
        }
        if amount > mandate.max_payment {
            return Err(AccountError::PaymentAboveMaximum);
        }
        let new_spent = mandate
            .spent
            .checked_add(amount)
            .ok_or(AccountError::AllowanceExceeded)?;
        if new_spent > mandate.total_limit {
            return Err(AccountError::AllowanceExceeded);
        }

        mandate.spent = new_spent;
        env.storage().instance().set(&DataKey::Mandate, &mandate);
        env.events().publish(
            (symbol_short!("payment"), Symbol::new(&env, "authorized")),
            (
                mandate.asset,
                recipient,
                amount,
                new_spent,
                mandate.total_limit - new_spent,
            ),
        );
        Ok(())
    }
}

fn owner(env: &Env) -> Result<Address, AccountError> {
    env.storage()
        .instance()
        .get(&DataKey::Owner)
        .ok_or(AccountError::NotInitialized)
}

fn mandate(env: &Env) -> Result<Mandate, AccountError> {
    env.storage()
        .instance()
        .get(&DataKey::Mandate)
        .ok_or(AccountError::MandateNotFound)
}

fn arg(args: &Vec<Val>, index: u32) -> Result<Val, AccountError> {
    args.get(index).ok_or(AccountError::UnsupportedInvocation)
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(ArbiterAccount, ());
        let client = ArbiterAccountClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        client.initialize(&owner);

        assert_eq!(
            client.try_initialize(&owner),
            Err(Ok(AccountError::AlreadyInitialized))
        );
    }

    #[test]
    #[should_panic]
    fn test_initialize_requires_auth() {
        let env = Env::default();
        let contract_id = env.register(ArbiterAccount, ());
        let client = ArbiterAccountClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        client.initialize(&owner);
    }
}
