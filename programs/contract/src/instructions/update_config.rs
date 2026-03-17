use anchor_lang::prelude::*;

use crate::errors::IcoError;
use crate::events::{TransferAdminEvent, TogglePauseEvent};
use crate::state::IcoConfig;

/// Transfer admin role directly to a new admin.
pub fn transfer_admin_handler(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    require!(new_admin != Pubkey::default(), IcoError::InvalidAdmin);

    let old_admin = ctx.accounts.ico_config.admin;
    ctx.accounts.ico_config.admin = new_admin;

    emit!(TransferAdminEvent {
        old_admin,
        new_admin,
    });
    Ok(())
}

/// Pause or unpause the contract (disables buy/claim when paused).
pub fn toggle_pause_handler(ctx: Context<TogglePause>, paused: bool) -> Result<()> {
    ctx.accounts.ico_config.paused = paused;

    emit!(TogglePauseEvent { paused });
    Ok(())
}

// ─── Accounts ───────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(
        constraint = admin.key() == ico_config.admin @ IcoError::Unauthorized,
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"ico-config"],
        bump = ico_config.bump,
    )]
    pub ico_config: Account<'info, IcoConfig>,
}

#[derive(Accounts)]
pub struct TogglePause<'info> {
    #[account(
        constraint = admin.key() == ico_config.admin @ IcoError::Unauthorized,
    )]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"ico-config"],
        bump = ico_config.bump,
    )]
    pub ico_config: Account<'info, IcoConfig>,
}
