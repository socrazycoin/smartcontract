use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::IcoError;
use crate::events::SetWhitelistTokenEvent;
use crate::state::{IcoConfig, WhitelistToken};

/// Adds or updates a whitelisted payment token.
/// Also creates the payment vault (ATA of ico_config for the payment mint).
pub fn handler(ctx: Context<SetWhitelistToken>, enabled: bool) -> Result<()> {
    let wl = &mut ctx.accounts.whitelist_token;
    wl.mint = ctx.accounts.payment_mint.key();
    wl.enabled = enabled;
    wl.decimals = ctx.accounts.payment_mint.decimals;
    wl.bump = ctx.bumps.whitelist_token;

    emit!(SetWhitelistTokenEvent {
        mint: ctx.accounts.payment_mint.key(),
        enabled,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetWhitelistToken<'info> {
    #[account(
        mut,
        constraint = admin.key() == ico_config.admin @ IcoError::Unauthorized,
    )]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"ico-config"],
        bump = ico_config.bump,
    )]
    pub ico_config: Account<'info, IcoConfig>,

    pub payment_mint: Account<'info, Mint>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + WhitelistToken::INIT_SPACE,
        seeds = [b"whitelist-token", payment_mint.key().as_ref()],
        bump,
    )]
    pub whitelist_token: Account<'info, WhitelistToken>,

    /// Payment token vault: ATA of ico_config PDA for the payment mint.
    /// Created when whitelisting to ensure it exists for buy transactions.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = payment_mint,
        associated_token::authority = ico_config,
    )]
    pub payment_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
