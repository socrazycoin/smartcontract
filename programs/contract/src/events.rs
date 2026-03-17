use anchor_lang::prelude::*;

#[event]
pub struct BuyEvent {
    pub user: Pubkey,
    pub stage_id: u8,
    pub payment_mint: Pubkey,
    pub payment_amount: u64,
    pub tokens_received: u64,
    pub usd_value: u64,
}

#[event]
pub struct ClaimEvent {
    pub user: Pubkey,
    pub stage_id: u8,
    pub tokens_claimed: u64,
}

#[event]
pub struct EmergencyWithdrawEvent {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EmergencyWithdrawSolEvent {
    pub admin: Pubkey,
    pub amount: u64,
}

#[event]
pub struct TransferAdminEvent {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct CreateStageEvent {
    pub stage_id: u8,
    pub token_price_usd: u64,
    pub tokens_total: u64,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct SetStageActiveEvent {
    pub stage_id: u8,
    pub active: bool,
}

#[event]
pub struct EnableStageClaimEvent {
    pub stage_id: u8,
    pub enabled: bool,
}

#[event]
pub struct SetWhitelistTokenEvent {
    pub mint: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct TogglePauseEvent {
    pub paused: bool,
}

#[event]
pub struct UpdateStageEvent {
    pub stage_id: u8,
    pub token_price_usd: u64,
    pub tokens_total: u64,
    pub start_time: i64,
    pub end_time: i64,
}
