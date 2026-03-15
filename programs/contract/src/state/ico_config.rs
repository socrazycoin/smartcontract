use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct IcoConfig {
    /// Admin wallet that controls the ICO
    pub admin: Pubkey,
    /// Pending admin for 2-step transfer (Pubkey::default() = none)
    pub pending_admin: Pubkey,
    /// SPL token mint being sold
    pub token_mint: Pubkey,
    /// Total USD raised across all stages (6 decimal precision)
    pub total_raised_usd: u64,
    /// Currently active stage ID (u8::MAX = no active stage)
    pub current_stage: u8,
    /// Number of stages created
    pub stage_count: u8,
    /// Whether the contract is paused (buy/claim disabled)
    pub paused: bool,
    /// PDA bump seed
    pub bump: u8,
}
