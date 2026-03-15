use anchor_lang::prelude::*;

use crate::errors::IcoError;
use crate::state::{IcoConfig, Stage, UserStagePurchase, WhitelistToken};

/// Closes a settled stage account, returning rent to the admin.
/// Requires: stage is not active, claim is disabled.
pub fn close_stage_handler(ctx: Context<CloseStage>, _stage_id: u8) -> Result<()> {
    let stage = &ctx.accounts.stage;
    require!(!stage.is_active, IcoError::StageIsActive);
    require!(!stage.claim_enabled, IcoError::StageNotSettled);
    Ok(())
}

/// Closes a disabled whitelist token account, returning rent to the admin.
pub fn close_whitelist_token_handler(ctx: Context<CloseWhitelistToken>) -> Result<()> {
    require!(
        !ctx.accounts.whitelist_token.enabled,
        IcoError::TokenStillEnabled
    );
    Ok(())
}

/// Closes a fully settled user purchase account, returning rent to the user.
/// Requires: tokens_bought == tokens_claimed (all claimed).
pub fn close_user_purchase_handler(ctx: Context<CloseUserPurchase>, _stage_id: u8) -> Result<()> {
    let purchase = &ctx.accounts.user_stage_purchase;
    require!(
        purchase.tokens_bought == purchase.tokens_claimed,
        IcoError::PurchaseNotSettled
    );
    Ok(())
}

// ─── Accounts ───────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(stage_id: u8)]
pub struct CloseStage<'info> {
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

    #[account(
        mut,
        close = admin,
        seeds = [b"stage".as_ref(), &[stage_id]],
        bump = stage.bump,
    )]
    pub stage: Account<'info, Stage>,
}

#[derive(Accounts)]
pub struct CloseWhitelistToken<'info> {
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

    #[account(
        mut,
        close = admin,
        seeds = [b"whitelist-token", whitelist_token.mint.as_ref()],
        bump = whitelist_token.bump,
    )]
    pub whitelist_token: Account<'info, WhitelistToken>,
}

#[derive(Accounts)]
#[instruction(stage_id: u8)]
pub struct CloseUserPurchase<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        close = user,
        seeds = [b"user-stage".as_ref(), user.key().as_ref(), &[stage_id]],
        bump = user_stage_purchase.bump,
    )]
    pub user_stage_purchase: Account<'info, UserStagePurchase>,
}
