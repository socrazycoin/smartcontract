use anchor_lang::prelude::*;

use crate::errors::IcoError;
use crate::events::UpdateStageEvent;
use crate::state::{IcoConfig, Stage};

/// Updates a stage's token price and/or total allocation.
/// The stage must be inactive. tokens_total cannot be reduced below tokens_sold.
pub fn handler(
    ctx: Context<UpdateStage>,
    _stage_id: u8,
    token_price_usd: u64,
    tokens_total: u64,
    start_time: i64,
    end_time: i64,
) -> Result<()> {
    require!(token_price_usd > 0, IcoError::ZeroAmount);
    require!(!ctx.accounts.stage.is_active, IcoError::StageIsActive);
    require!(
        tokens_total >= ctx.accounts.stage.tokens_sold,
        IcoError::InvalidTokensTotal
    );
    require!(start_time >= 0, IcoError::InvalidTimeRange);
    require!(end_time >= 0, IcoError::InvalidTimeRange);
    if end_time > 0 {
        let now = Clock::get()?.unix_timestamp;
        require!(end_time > now, IcoError::EndTimeExpired);
        if start_time > 0 {
            require!(end_time > start_time, IcoError::InvalidTimeRange);
        }
    }

    let stage = &mut ctx.accounts.stage;
    stage.token_price_usd = token_price_usd;
    stage.tokens_total = tokens_total;
    stage.start_time = start_time;
    stage.end_time = end_time;

    emit!(UpdateStageEvent {
        stage_id: stage.stage_id,
        token_price_usd,
        tokens_total,
        start_time,
        end_time,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(stage_id: u8)]
pub struct UpdateStage<'info> {
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
