use anchor_lang::prelude::*;

use crate::errors::IcoError;
use crate::events::CreateStageEvent;
use crate::state::{IcoConfig, Stage};

/// Creates a new presale stage with the given allocation and price.
pub fn handler(
    ctx: Context<CreateStage>,
    stage_id: u8,
    token_price_usd: u64,
    tokens_total: u64,
    start_time: i64,
    end_time: i64,
) -> Result<()> {
    require!(token_price_usd > 0, IcoError::ZeroAmount);
    require!(tokens_total > 0, IcoError::ZeroAmount);
    if start_time > 0 && end_time > 0 {
        require!(end_time > start_time, IcoError::InvalidTimeRange);
    }

    let ico_config = &mut ctx.accounts.ico_config;
    require!(
        stage_id == ico_config.stage_count + 1,
        IcoError::InvalidStageId
    );

    let stage = &mut ctx.accounts.stage;
    stage.stage_id = stage_id;
    stage.token_price_usd = token_price_usd;
    stage.tokens_total = tokens_total;
    stage.tokens_sold = 0;
    stage.total_raised_usd = 0;
    stage.start_time = start_time;
    stage.end_time = end_time;
    stage.is_active = false;
    stage.claim_enabled = false;
    stage.bump = ctx.bumps.stage;

    ico_config.stage_count = ico_config
        .stage_count
        .checked_add(1)
        .ok_or(IcoError::Overflow)?;

    emit!(CreateStageEvent {
        stage_id,
        token_price_usd,
        tokens_total,
        start_time,
        end_time,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(stage_id: u8)]
pub struct CreateStage<'info> {
    #[account(
        mut,
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
        init,
        payer = admin,
        space = 8 + Stage::INIT_SPACE,
        seeds = [b"stage".as_ref(), &[stage_id]],
        bump,
    )]
    pub stage: Account<'info, Stage>,

    pub system_program: Program<'info, System>,
}
