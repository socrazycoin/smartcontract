use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use anchor_lang::solana_program::{program::invoke, system_instruction};
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

use crate::errors::IcoError;
use crate::events::BuyEvent;
use crate::state::{IcoConfig, Stage, UserStagePurchase, WhitelistToken};

// Pyth Push Oracle program ID.
const PYTH_PUSH_ORACLE_ID: Pubkey = pubkey!("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
// Pyth Receiver program ID.
const PYTH_RECEIVER_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/// USD values use 6-decimal precision throughout the contract.
const USD_DECIMALS: i32 = 6;
/// Native SOL has 9 decimals (lamports).
const SOL_DECIMALS: i32 = 9;
/// Maximum acceptable staleness for the Pyth price feed (seconds).
const PRICE_STALENESS_THRESHOLD: u64 = 120;
/// Pyth SOL/USD price feed ID.
const SOL_USD_FEED_ID: &str = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

pub fn handler(ctx: Context<Buy>, stage_id: u8, payment_amount: u64) -> Result<()> {
    require!(!ctx.accounts.ico_config.paused, IcoError::ContractPaused);
    require!(payment_amount > 0, IcoError::ZeroAmount);
    require!(ctx.accounts.stage.is_active, IcoError::StageNotActive);
    require!(
        ctx.accounts.stage.stage_id == stage_id,
        IcoError::InvalidStage
    );
    require!(
        ctx.accounts.whitelist_token.enabled,
        IcoError::TokenNotWhitelisted
    );

    // ── Validate stage time window ──────────────────────────────────────
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    if ctx.accounts.stage.start_time > 0 {
        require!(now >= ctx.accounts.stage.start_time, IcoError::StageNotStarted);
    }
    if ctx.accounts.stage.end_time > 0 {
        require!(now < ctx.accounts.stage.end_time, IcoError::StageEnded);
    }

    let token_decimals = ctx.accounts.token_mint.decimals;
    let is_sol =
        ctx.accounts.payment_mint.key() == anchor_spl::token::spl_token::native_mint::id();

    // ── Validate Pyth oracle owner for SOL payments ──────────────────
    if is_sol {
        let owner = ctx.accounts.price_update.owner;
        require!(
            owner == &PYTH_PUSH_ORACLE_ID || owner == &PYTH_RECEIVER_ID,
            IcoError::InvalidPriceOracle
        );
    }

    // ── Validate payment token accounts for stablecoin payments ──────
    if !is_sol {
        require!(
            ctx.accounts.payment_mint.decimals == ctx.accounts.whitelist_token.decimals,
            IcoError::DecimalsMismatch
        );

        let user_pay_data = ctx.accounts.user_payment_account.try_borrow_data()?;
        let user_pay = TokenAccount::try_deserialize(&mut &user_pay_data[..])
            .map_err(|_| error!(IcoError::InvalidPaymentAccount))?;
        require!(
            user_pay.mint == ctx.accounts.payment_mint.key()
                && user_pay.owner == ctx.accounts.user.key(),
            IcoError::InvalidPaymentAccount
        );
        drop(user_pay_data);

        let pay_vault_data = ctx.accounts.payment_vault.try_borrow_data()?;
        let pay_vault = TokenAccount::try_deserialize(&mut &pay_vault_data[..])
            .map_err(|_| error!(IcoError::InvalidPaymentAccount))?;
        require!(
            pay_vault.mint == ctx.accounts.payment_mint.key()
                && pay_vault.owner == ctx.accounts.ico_config.key(),
            IcoError::InvalidPaymentAccount
        );
        drop(pay_vault_data);
    }

    // ── Convert payment amount to USD (6-decimal precision) ──────────────
    let usd_value: u128 = if is_sol {
        compute_sol_usd_value(&ctx.accounts.price_update, payment_amount, &clock)?
    } else {
        compute_stablecoin_usd_value(ctx.accounts.payment_mint.decimals, payment_amount)?
    };

    require!(usd_value > 0, IcoError::ZeroAmount);

    // ── Calculate tokens to buy ─────────────────────────────────────────
    let tokens_to_buy_u128 = usd_value
        .checked_mul(10u128.pow(token_decimals as u32))
        .ok_or(IcoError::Overflow)?
        .checked_div(ctx.accounts.stage.token_price_usd as u128)
        .ok_or(IcoError::Overflow)?;

    let tokens_to_buy = u64::try_from(tokens_to_buy_u128).map_err(|_| IcoError::Overflow)?;

    require!(tokens_to_buy > 0, IcoError::ZeroAmount);

    // ── Check remaining stage supply ────────────────────────────────────
    let remaining = ctx
        .accounts
        .stage
        .tokens_total
        .checked_sub(ctx.accounts.stage.tokens_sold)
        .ok_or(IcoError::Overflow)?;
    require!(tokens_to_buy <= remaining, IcoError::ExceedsStageSupply);

    // ── Transfer payment ────────────────────────────────────────────────
    //
    // DUAL-PATH FUND ARCHITECTURE
    // The destination differs by payment type and requires a different
    // withdrawal instruction to recover funds:
    //
    //   SOL path        → lamports land on the ico_config PDA itself.
    //                     Recover with: emergency_withdraw_sol
    //
    //   Stablecoin path → tokens land in the payment_vault, which is the
    //                     ATA of ico_config for the payment mint.
    //                     Each stablecoin has its own independent ATA.
    //                     Recover with: emergency_withdraw (pass the mint)
    if is_sol {
        // Native SOL: system_instruction::transfer moves lamports directly
        // from the buyer to the ico_config PDA address.  The PDA accumulates
        // SOL as plain lamports — there is no separate SOL token account.
        invoke(
            &system_instruction::transfer(
                &ctx.accounts.user.key(),
                &ctx.accounts.ico_config.key(),
                payment_amount,
            ),
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.ico_config.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
    } else {
        // Stablecoin: SPL token::transfer moves tokens from the buyer's ATA
        // to payment_vault (the ATA of ico_config for this specific mint).
        // Created automatically when the admin calls set_whitelist_token.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_payment_account.to_account_info(),
                    to: ctx.accounts.payment_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            payment_amount,
        )?;
    }

    // ── Update stage ────────────────────────────────────────────────────
    ctx.accounts.stage.tokens_sold = ctx
        .accounts
        .stage
        .tokens_sold
        .checked_add(tokens_to_buy)
        .ok_or(IcoError::Overflow)?;

    // ── Update stage total USD raised ──────────────────────────────────
    let paid_usd_value = u64::try_from(usd_value).map_err(|_| IcoError::Overflow)?;
    ctx.accounts.stage.total_raised_usd = ctx
        .accounts
        .stage
        .total_raised_usd
        .checked_add(paid_usd_value)
        .ok_or(IcoError::Overflow)?;

    // ── Update user purchase record ─────────────────────────────────────
    let purchase = &mut ctx.accounts.user_stage_purchase;
    if purchase.user == Pubkey::default() {
        purchase.user = ctx.accounts.user.key();
        purchase.stage_id = stage_id;
        purchase.bump = ctx.bumps.user_stage_purchase;
    }
    purchase.tokens_bought = purchase
        .tokens_bought
        .checked_add(tokens_to_buy)
        .ok_or(IcoError::Overflow)?;

    purchase.paid_usd_value = purchase
        .paid_usd_value
        .checked_add(paid_usd_value)
        .ok_or(IcoError::Overflow)?;

    // ── Update total USD raised ─────────────────────────────────────────
    ctx.accounts.ico_config.total_raised_usd = ctx
        .accounts
        .ico_config
        .total_raised_usd
        .checked_add(paid_usd_value)
        .ok_or(IcoError::Overflow)?;

    emit!(BuyEvent {
        user: ctx.accounts.user.key(),
        stage_id,
        payment_mint: ctx.accounts.payment_mint.key(),
        payment_amount,
        tokens_received: tokens_to_buy,
        usd_value: paid_usd_value,
    });

    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Reads the Pyth SOL/USD price from a `PriceUpdateV2` account, verifies
/// freshness and feed identity, and returns the USD value of `lamports`
/// in 6-decimal precision.
fn compute_sol_usd_value(
    price_update_info: &AccountInfo,
    lamports: u64,
    clock: &Clock,
) -> Result<u128> {
    let mut data: &[u8] = &price_update_info.try_borrow_data()?;
    let price_update =
        PriceUpdateV2::try_deserialize(&mut data).map_err(|_| IcoError::StalePriceFeed)?;

    let feed_id = get_feed_id_from_hex(SOL_USD_FEED_ID).map_err(|_| IcoError::InvalidPrice)?;
    let price = price_update
        .get_price_no_older_than(&clock, PRICE_STALENESS_THRESHOLD, &feed_id)
        .map_err(|_| IcoError::StalePriceFeed)?;

    require!(price.price > 0, IcoError::InvalidPrice);

    let pyth_price = price.price as u128;
    let pyth_expo = price.exponent; // typically negative, e.g. -8

    // usd_value = lamports × pyth_price × 10^(expo + USD_DECIMALS − SOL_DECIMALS)
    let total_expo = (pyth_expo as i64)
        .checked_add((USD_DECIMALS - SOL_DECIMALS) as i64)
        .ok_or(IcoError::Overflow)?;

    let raw = (lamports as u128)
        .checked_mul(pyth_price)
        .ok_or(IcoError::Overflow)?;

    if total_expo >= 0 {
        raw.checked_mul(10u128.pow(total_expo as u32))
            .ok_or_else(|| error!(IcoError::Overflow))
    } else {
        raw.checked_div(10u128.pow((-total_expo) as u32))
            .ok_or_else(|| error!(IcoError::Overflow))
    }
}

/// Returns the USD value (6 decimals) for a stablecoin payment assuming
/// 1 token = 1 USD, adjusted for the token's decimal places.
fn compute_stablecoin_usd_value(payment_decimals: u8, amount: u64) -> Result<u128> {
    let expo_diff = USD_DECIMALS - payment_decimals as i32;
    if expo_diff >= 0 {
        (amount as u128)
            .checked_mul(10u128.pow(expo_diff as u32))
            .ok_or_else(|| error!(IcoError::Overflow))
    } else {
        (amount as u128)
            .checked_div(10u128.pow((-expo_diff) as u32))
            .ok_or_else(|| error!(IcoError::Overflow))
    }
}

// ─── Accounts ───────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(stage_id: u8)]
pub struct Buy<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"ico-config"],
        bump = ico_config.bump,
    )]
    pub ico_config: Account<'info, IcoConfig>,

    #[account(
        mut,
        seeds = [b"stage".as_ref(), &[stage_id]],
        bump = stage.bump,
    )]
    pub stage: Account<'info, Stage>,

    #[account(
        seeds = [b"whitelist-token", payment_mint.key().as_ref()],
        bump = whitelist_token.bump,
    )]
    pub whitelist_token: Account<'info, WhitelistToken>,

    /// Mint of the payment token (native SOL mint, USDC, or USDT)
    pub payment_mint: Account<'info, Mint>,

    /// Token mint — must match ICO config
    #[account(address = ico_config.token_mint)]
    pub token_mint: Account<'info, Mint>,

    /// User's SPL token account for the payment token (used for USDC/USDT).
    /// CHECK: Validated in handler for stablecoin payments.
    /// Ignored when paying with SOL — pass any account.
    #[account(mut)]
    pub user_payment_account: UncheckedAccount<'info>,

    /// Payment vault: ATA of ico_config PDA for the payment token.
    /// CHECK: Validated in handler for stablecoin payments.
    /// Ignored when paying with SOL — pass any account.
    #[account(mut)]
    pub payment_vault: UncheckedAccount<'info>,

    /// Tracks user's purchases for this stage (created on first buy)
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserStagePurchase::INIT_SPACE,
        seeds = [b"user-stage".as_ref(), user.key().as_ref(), &[stage_id]],
        bump,
    )]
    pub user_stage_purchase: Account<'info, UserStagePurchase>,

    pub token_program: Program<'info, Token>,

    /// Pyth PriceUpdateV2 account for SOL/USD (required when paying with SOL).
    /// CHECK: Deserialized manually in the handler only for SOL payments.
    /// Pass any account when paying with a stablecoin.
    pub price_update: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
