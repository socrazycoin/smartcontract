use anchor_lang::prelude::*;

use crate::errors::IcoError;
use crate::events::SetStageActiveEvent;
use crate::state::{IcoConfig, Stage};

/// Activates or deactivates a stage. Only one stage can be active at a time.
pub fn handler(ctx: Context<SetStageActive>, _stage_id: u8, active: bool) -> Result<()> {
    let ico_config = &mut ctx.accounts.ico_config;
    let stage = &mut ctx.accounts.stage;

    if active {
        require!(
            ico_config.current_stage == u8::MAX,
            IcoError::AnotherStageActive
        );
        stage.is_active = true;
        ico_config.current_stage = stage.stage_id;
    } else {
        require!(
            ico_config.current_stage == stage.stage_id,
            IcoError::StageNotActive
        );
        stage.is_active = false;
        ico_config.current_stage = u8::MAX;
    }

    emit!(SetStageActiveEvent {
        stage_id: stage.stage_id,
        active,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(stage_id: u8)]
pub struct SetStageActive<'info> {
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

    #[account(
        mut,
        seeds = [b"stage".as_ref(), &[stage_id]],
        bump = stage.bump,
    )]
    pub stage: Account<'info, Stage>,
}
