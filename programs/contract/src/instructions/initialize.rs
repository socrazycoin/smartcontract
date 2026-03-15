use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::IcoConfig;

/// Initializes the ICO configuration and creates the token vault.
/// The admin must transfer tokens to the vault after initialization.
pub fn handler(ctx: Context<InitializeIco>) -> Result<()> {
    let ico_config = &mut ctx.accounts.ico_config;
    ico_config.admin = ctx.accounts.admin.key();
    ico_config.pending_admin = Pubkey::default();
    ico_config.token_mint = ctx.accounts.token_mint.key();
    ico_config.total_raised_usd = 0;
    ico_config.current_stage = u8::MAX; // no active stage
    ico_config.stage_count = 0;
    ico_config.paused = false;
    ico_config.bump = ctx.bumps.ico_config;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeIco<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + IcoConfig::INIT_SPACE,
        seeds = [b"ico-config"],
        bump,
    )]
    pub ico_config: Account<'info, IcoConfig>,

    /// The token mint
    pub token_mint: Account<'info, Mint>,

    /// Vault to hold tokens for distribution, owned by the ICO config PDA
    #[account(
        init,
        payer = admin,
        associated_token::mint = token_mint,
        associated_token::authority = ico_config,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
