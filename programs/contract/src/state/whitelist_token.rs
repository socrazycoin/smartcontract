use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct WhitelistToken {
    /// Mint address of the payment token
    pub mint: Pubkey,
    /// Whether this token is currently accepted for payment
    pub enabled: bool,
    /// Number of decimals for the mint (cached at whitelist time)
    pub decimals: u8,
    /// PDA bump seed
    pub bump: u8,
}
