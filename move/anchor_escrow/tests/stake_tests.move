#[test_only]
module anchor_escrow::stake_tests;

use anchor_escrow::stake::{Self, Stake};
use sui::clock;
use sui::coin::{Self, Coin};
use sui::sui::SUI;
use sui::test_scenario as ts;

const PAYER: address = @0xA;
const FRIEND: address = @0xB;
const ANCHOR: address = @0xC;
const STRANGER: address = @0xD;
const WEEK_MS: u64 = 7 * 24 * 60 * 60 * 1000;

fun stake_100(scenario: &mut ts::Scenario, now_ms: u64, deadline_ms: u64) {
    scenario.next_tx(PAYER);
    let mut clk = clock::create_for_testing(scenario.ctx());
    clk.set_for_testing(now_ms);
    let coin = coin::mint_for_testing<SUI>(100, scenario.ctx());
    stake::create(coin, FRIEND, ANCHOR, deadline_ms, b"promise-hash", &clk, scenario.ctx());
    clk.destroy_for_testing();
}

fun balance_of(scenario: &mut ts::Scenario, who: address): u64 {
    scenario.next_tx(who);
    let c = scenario.take_from_sender<Coin<SUI>>();
    let v = c.value();
    scenario.return_to_sender(c);
    v
}

#[test]
fun kept_pays_the_payer_back() {
    let mut scenario = ts::begin(PAYER);
    stake_100(&mut scenario, 1_000, 5_000);
    scenario.next_tx(ANCHOR);
    {
        let s = scenario.take_shared<Stake<SUI>>();
        assert!(s.amount() == 100 && s.payer() == PAYER && s.beneficiary() == FRIEND && s.arbiter() == ANCHOR);
        stake::settle(s, true, scenario.ctx());
    };
    assert!(balance_of(&mut scenario, PAYER) == 100);
    scenario.end();
}

#[test]
fun missed_pays_the_beneficiary() {
    let mut scenario = ts::begin(PAYER);
    stake_100(&mut scenario, 1_000, 5_000);
    scenario.next_tx(ANCHOR);
    {
        let s = scenario.take_shared<Stake<SUI>>();
        stake::settle(s, false, scenario.ctx());
    };
    assert!(balance_of(&mut scenario, FRIEND) == 100);
    scenario.end();
}

#[test, expected_failure(abort_code = stake::ENotArbiter)]
fun only_the_arbiter_can_settle() {
    let mut scenario = ts::begin(PAYER);
    stake_100(&mut scenario, 1_000, 5_000);
    scenario.next_tx(STRANGER);
    let s = scenario.take_shared<Stake<SUI>>();
    stake::settle(s, false, scenario.ctx());
    scenario.end();
}

#[test, expected_failure(abort_code = stake::ENotArbiter)]
fun the_payer_cannot_settle_their_own_stake() {
    let mut scenario = ts::begin(PAYER);
    stake_100(&mut scenario, 1_000, 5_000);
    scenario.next_tx(PAYER);
    let s = scenario.take_shared<Stake<SUI>>();
    stake::settle(s, true, scenario.ctx());
    scenario.end();
}

#[test]
fun payer_reclaims_after_a_week_past_the_deadline() {
    let mut scenario = ts::begin(PAYER);
    stake_100(&mut scenario, 1_000, 5_000);
    scenario.next_tx(STRANGER); // anyone may trigger it; the money still goes to the payer
    {
        let s = scenario.take_shared<Stake<SUI>>();
        let mut clk = clock::create_for_testing(scenario.ctx());
        clk.set_for_testing(5_000 + WEEK_MS);
        stake::reclaim(s, &clk, scenario.ctx());
        clk.destroy_for_testing();
    };
    assert!(balance_of(&mut scenario, PAYER) == 100);
    scenario.end();
}

#[test, expected_failure(abort_code = stake::ETooEarly)]
fun reclaim_waits_for_the_grace_period() {
    let mut scenario = ts::begin(PAYER);
    stake_100(&mut scenario, 1_000, 5_000);
    scenario.next_tx(PAYER);
    let s = scenario.take_shared<Stake<SUI>>();
    let mut clk = clock::create_for_testing(scenario.ctx());
    clk.set_for_testing(5_000 + WEEK_MS - 1);
    stake::reclaim(s, &clk, scenario.ctx());
    clk.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = stake::EDeadlinePassed)]
fun cannot_stake_on_a_past_deadline() {
    let mut scenario = ts::begin(PAYER);
    stake_100(&mut scenario, 9_000, 5_000);
    scenario.end();
}

#[test, expected_failure(abort_code = stake::EBeneficiaryIsPayer)]
fun cannot_name_yourself_as_beneficiary() {
    let mut scenario = ts::begin(PAYER);
    scenario.next_tx(PAYER);
    let mut clk = clock::create_for_testing(scenario.ctx());
    clk.set_for_testing(1_000);
    let coin = coin::mint_for_testing<SUI>(100, scenario.ctx());
    stake::create(coin, PAYER, ANCHOR, 5_000, b"x", &clk, scenario.ctx());
    clk.destroy_for_testing();
    scenario.end();
}

#[test, expected_failure(abort_code = stake::EZeroAmount)]
fun cannot_stake_nothing() {
    let mut scenario = ts::begin(PAYER);
    scenario.next_tx(PAYER);
    let mut clk = clock::create_for_testing(scenario.ctx());
    let coin = coin::zero<SUI>(scenario.ctx());
    stake::create(coin, FRIEND, ANCHOR, 5_000, b"x", &clk, scenario.ctx());
    clk.destroy_for_testing();
    scenario.end();
}
