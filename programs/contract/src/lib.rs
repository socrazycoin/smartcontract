use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("7QAjd595eg3EF7ePzYugntUkL6HhjcicrKYXSrD6sXzd");

#[program]
pub mod contract {
    use super::*;

    /// Initialize the ICO configuration and create the token vault.
    pub fn initialize_ico(ctx: Context<InitializeIco>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Create a new presale stage.
    pub fn create_stage(
        ctx: Context<CreateStage>,
        stage_id: u8,
        token_price_usd: u64,
        tokens_total: u64,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        instructions::create_stage::handler(ctx, stage_id, token_price_usd, tokens_total, start_time, end_time)
    }

    /// Activate or deactivate a stage. Only one stage can be active at a time.
    pub fn set_stage_active(
        ctx: Context<SetStageActive>,
        stage_id: u8,
        active: bool,
    ) -> Result<()> {
        instructions::set_stage_active::handler(ctx, stage_id, active)
    }

    /// Enable or disable claiming for a stage.
    pub fn enable_stage_claim(
        ctx: Context<EnableStageClaim>,
        stage_id: u8,
        enabled: bool,
    ) -> Result<()> {
        instructions::enable_stage_claim::handler(ctx, stage_id, enabled)
    }

    /// Add or update a whitelisted payment token.
    pub fn set_whitelist_token(
        ctx: Context<SetWhitelistToken>,
        enabled: bool,
    ) -> Result<()> {
        instructions::set_whitelist_token::handler(ctx, enabled)
    }

    /// Buy tokens from the active stage using a whitelisted payment token.
    pub fn buy(ctx: Context<Buy>, stage_id: u8, payment_amount: u64) -> Result<()> {
        instructions::buy::handler(ctx, stage_id, payment_amount)
    }

    /// Claim purchased tokens from a stage with claiming enabled.
    pub fn claim(ctx: Context<Claim>, stage_id: u8) -> Result<()> {
        instructions::claim::handler(ctx, stage_id)
    }

    /// Emergency withdraw tokens from the vault (admin only).
    pub fn emergency_withdraw(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
        instructions::emergency_withdraw::handler(ctx, amount)
    }

    /// Emergency withdraw SOL from the ico_config PDA (admin only).
    pub fn emergency_withdraw_sol(ctx: Context<EmergencyWithdrawSol>, amount: u64) -> Result<()> {
        instructions::emergency_withdraw::handler_sol(ctx, amount)
    }

    /// Transfer admin role to a new admin.
    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::update_config::transfer_admin_handler(ctx, new_admin)
    }

    /// Pause or unpause the contract (disables buy and claim).
    pub fn toggle_pause(ctx: Context<TogglePause>, paused: bool) -> Result<()> {
        instructions::update_config::toggle_pause_handler(ctx, paused)
    }

    /// Update a stage's price and/or allocation (stage must be inactive).
    pub fn update_stage(
        ctx: Context<UpdateStage>,
        stage_id: u8,
        token_price_usd: u64,
        tokens_total: u64,
        start_time: i64,
        end_time: i64,
    ) -> Result<()> {
        instructions::update_stage::handler(ctx, stage_id, token_price_usd, tokens_total, start_time, end_time)
    }

    /// Close a settled stage account to reclaim rent (admin only).
    pub fn close_stage(ctx: Context<CloseStage>, stage_id: u8) -> Result<()> {
        instructions::close_account::close_stage_handler(ctx, stage_id)
    }

    /// Close a disabled whitelist token account to reclaim rent (admin only).
    pub fn close_whitelist_token(ctx: Context<CloseWhitelistToken>) -> Result<()> {
        instructions::close_account::close_whitelist_token_handler(ctx)
    }

    /// Close a fully settled user purchase account to reclaim rent.
    pub fn close_user_purchase(ctx: Context<CloseUserPurchase>, stage_id: u8) -> Result<()> {
        instructions::close_account::close_user_purchase_handler(ctx, stage_id)
    }
}
