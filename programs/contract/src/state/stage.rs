use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Stage {
    /// Unique stage identifier
    pub stage_id: u8,
    /// Token price in USD (6 decimal precision, e.g. 7700 = $0.0077)
    pub token_price_usd: u64,
    /// Total token allocation for this stage (in token base units)
    pub tokens_total: u64,
    /// Tokens sold so far (in token base units)
    pub tokens_sold: u64,
    /// Total USD raised in this stage (6 decimal precision)
    pub total_raised_usd: u64,
    /// Stage start time (Unix timestamp, 0 = no restriction)
    pub start_time: i64,
    /// Stage end time (Unix timestamp, 0 = no restriction)
    pub end_time: i64,
    /// Whether this stage is currently active for purchases
    pub is_active: bool,
    /// Whether users can claim tokens from this stage
    pub claim_enabled: bool,
    /// PDA bump seed
    pub bump: u8,
}
