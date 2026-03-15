use anchor_lang::prelude::*;

use crate::errors::IcoError;
use crate::events::EnableStageClaimEvent;
use crate::state::{IcoConfig, Stage};

/// Enables or disables token claiming for a specific stage.
pub fn handler(ctx: Context<EnableStageClaim>, _stage_id: u8, enabled: bool) -> Result<()> {
    ctx.accounts.stage.claim_enabled = enabled;

    emit!(EnableStageClaimEvent {
        stage_id: ctx.accounts.stage.stage_id,
        enabled,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(stage_id: u8)]
pub struct EnableStageClaim<'info> {
    #[account(
        constraint = admin.key() == ico_config.admin @ IcoError::Unauthorized,
    )]
    pub admin: Signer<'info>,

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
}
