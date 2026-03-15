use anchor_lang::prelude::*;

use crate::errors::IcoError;
use crate::events::{NominateAdminEvent, AcceptAdminEvent, TogglePauseEvent};
use crate::state::IcoConfig;

/// Step 1: Current admin nominates a new admin.
pub fn nominate_admin_handler(ctx: Context<NominateAdmin>, new_admin: Pubkey) -> Result<()> {
    require!(new_admin != Pubkey::default(), IcoError::InvalidAdmin);
    ctx.accounts.ico_config.pending_admin = new_admin;

    emit!(NominateAdminEvent {
        current_admin: ctx.accounts.admin.key(),
        nominated_admin: new_admin,
    });
    Ok(())
}

/// Step 2: Nominated admin accepts the role.
pub fn accept_admin_handler(ctx: Context<AcceptAdmin>) -> Result<()> {
    let ico_config = &mut ctx.accounts.ico_config;

    require!(
        ico_config.pending_admin != Pubkey::default(),
        IcoError::NoPendingAdmin
    );
    require!(
        ctx.accounts.new_admin.key() == ico_config.pending_admin,
        IcoError::Unauthorized
    );

    let old_admin = ico_config.admin;
    ico_config.admin = ico_config.pending_admin;
    ico_config.pending_admin = Pubkey::default();

    emit!(AcceptAdminEvent {
        old_admin,
        new_admin: ico_config.admin,
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
pub struct NominateAdmin<'info> {
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
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,

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
