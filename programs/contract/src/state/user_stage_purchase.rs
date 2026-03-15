use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserStagePurchase {
    /// User wallet address
    pub user: Pubkey,
    /// Stage this purchase belongs to
    pub stage_id: u8,
    /// Total tokens bought in this stage (in token base units)
    pub tokens_bought: u64,
    /// Total tokens claimed from this stage (in token base units)
    pub tokens_claimed: u64,
    /// Total paid value in USD (6 decimals)
    pub paid_usd_value: u64,
    /// PDA bump seed
    pub bump: u8,
}
