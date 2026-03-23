use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::IcoError;
use crate::events::ClaimEvent;
use crate::state::{IcoConfig, Stage, UserStagePurchase};

/// Claims purchased tokens for a specific stage.
pub fn handler(ctx: Context<Claim>, stage_id: u8) -> Result<()> {
    require!(!ctx.accounts.ico_config.paused, IcoError::ContractPaused);
    require!(
        ctx.accounts.stage.claim_enabled,
        IcoError::ClaimNotEnabled
    );

    let purchase = &mut ctx.accounts.user_stage_purchase;
    let claimable = purchase
        .tokens_bought
        .checked_sub(purchase.tokens_claimed)
        .ok_or(IcoError::Overflow)?;

    require!(claimable > 0, IcoError::NothingToClaim);

    // ── Check vault has enough tokens ───────────────────────────────────
    require!(
        ctx.accounts.vault.amount >= claimable,
        IcoError::InsufficientVaultBalance
    );

    // CPI transfer signed by the ICO config PDA
    let signer_seeds: &[&[&[u8]]] = &[&[b"ico-config", &[ctx.accounts.ico_config.bump]]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.ico_config.to_account_info(),
            },
            signer_seeds,
        ),
        claimable,
    )?;

    purchase.tokens_claimed = purchase
        .tokens_claimed
        .checked_add(claimable)
        .ok_or(IcoError::Overflow)?;

    ctx.accounts.stage.tokens_claimed_total = ctx
        .accounts
        .stage
        .tokens_claimed_total
        .checked_add(claimable)
        .ok_or(IcoError::Overflow)?;

    emit!(ClaimEvent {
        user: ctx.accounts.user.key(),
        stage_id,
        tokens_claimed: claimable,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(stage_id: u8)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
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
        mut,
        seeds = [b"user-stage".as_ref(), user.key().as_ref(), &[stage_id]],
        bump = user_stage_purchase.bump,
    )]
    pub user_stage_purchase: Account<'info, UserStagePurchase>,

    /// Token mint — must match ICO config
    #[account(address = ico_config.token_mint)]
    pub token_mint: Account<'info, Mint>,

    /// Vault holding tokens, owned by ICO config PDA
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = ico_config,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// User's token account (created if needed)
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = token_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
