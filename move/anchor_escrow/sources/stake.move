/// Trustless stakes for Anchor promises.
///
/// A person stakes coins on a promise. The coins sit in a shared `Stake`
/// object, never in Anchor's wallet. Anchor, the arbiter, reads the chain at
/// the deadline and settles the stake, but the money can only go to one of
/// the two addresses fixed when the stake was created:
///   kept   -> back to the payer
///   missed -> to the beneficiary the payer chose (a friend, a charity)
/// If the arbiter never settles, the payer can reclaim the stake once the
/// deadline is a week past. Anchor can never keep or redirect stake money.
module anchor_escrow::stake;

use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;

/// Only the arbiter named in the stake can settle it.
const ENotArbiter: u64 = 1;
/// Reclaiming is only possible a week after the deadline.
const ETooEarly: u64 = 2;
/// A stake needs a positive amount.
const EZeroAmount: u64 = 3;
/// The deadline must be in the future when staking.
const EDeadlinePassed: u64 = 4;
/// Paying the stake to yourself if you miss would make it meaningless.
const EBeneficiaryIsPayer: u64 = 5;

/// Grace period after the deadline before the payer can reclaim an unsettled stake.
const RECLAIM_AFTER_MS: u64 = 7 * 24 * 60 * 60 * 1000;

public struct Stake<phantom T> has key {
    id: UID,
    payer: address,
    beneficiary: address,
    arbiter: address,
    deadline_ms: u64,
    /// Fingerprint of the promise (Anchor uses the sha256 of the stake token), linking the stake to it.
    promise: vector<u8>,
    funds: Balance<T>,
}

public struct Staked has copy, drop {
    stake_id: ID,
    payer: address,
    beneficiary: address,
    arbiter: address,
    amount: u64,
    deadline_ms: u64,
    promise: vector<u8>,
}

public struct Settled has copy, drop {
    stake_id: ID,
    kept: bool,
    to: address,
    amount: u64,
}

public struct Reclaimed has copy, drop {
    stake_id: ID,
    payer: address,
    amount: u64,
}

/// Lock `coin` on a promise. The sender is the payer.
public fun create<T>(
    coin: Coin<T>,
    beneficiary: address,
    arbiter: address,
    deadline_ms: u64,
    promise: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let amount = coin.value();
    assert!(amount > 0, EZeroAmount);
    assert!(deadline_ms > clock.timestamp_ms(), EDeadlinePassed);
    assert!(beneficiary != ctx.sender(), EBeneficiaryIsPayer);
    let stake = Stake<T> {
        id: object::new(ctx),
        payer: ctx.sender(),
        beneficiary,
        arbiter,
        deadline_ms,
        promise,
        funds: coin.into_balance(),
    };
    event::emit(Staked {
        stake_id: object::id(&stake),
        payer: stake.payer,
        beneficiary,
        arbiter,
        amount,
        deadline_ms,
        promise: stake.promise,
    });
    transfer::share_object(stake);
}

/// The arbiter's verdict: kept pays the payer back, missed pays the beneficiary.
public fun settle<T>(stake: Stake<T>, kept: bool, ctx: &mut TxContext) {
    assert!(ctx.sender() == stake.arbiter, ENotArbiter);
    let Stake { id, payer, beneficiary, arbiter: _, deadline_ms: _, promise: _, funds } = stake;
    let to = if (kept) payer else beneficiary;
    event::emit(Settled { stake_id: id.to_inner(), kept, to, amount: funds.value() });
    transfer::public_transfer(coin::from_balance(funds, ctx), to);
    id.delete();
}

/// If the arbiter never settled, anyone can return the stake to the payer a week after the deadline.
public fun reclaim<T>(stake: Stake<T>, clock: &Clock, ctx: &mut TxContext) {
    assert!(clock.timestamp_ms() >= stake.deadline_ms + RECLAIM_AFTER_MS, ETooEarly);
    let Stake { id, payer, beneficiary: _, arbiter: _, deadline_ms: _, promise: _, funds } = stake;
    event::emit(Reclaimed { stake_id: id.to_inner(), payer, amount: funds.value() });
    transfer::public_transfer(coin::from_balance(funds, ctx), payer);
    id.delete();
}

// read-only
public fun payer<T>(s: &Stake<T>): address { s.payer }
public fun beneficiary<T>(s: &Stake<T>): address { s.beneficiary }
public fun arbiter<T>(s: &Stake<T>): address { s.arbiter }
public fun deadline_ms<T>(s: &Stake<T>): u64 { s.deadline_ms }
public fun amount<T>(s: &Stake<T>): u64 { s.funds.value() }
public fun promise<T>(s: &Stake<T>): vector<u8> { s.promise }
