use anchor_lang::prelude::*;

#[error_code]
pub enum IcoError {
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Stage is not active")]
    StageNotActive,
    #[msg("Another stage is currently active")]
    AnotherStageActive,
    #[msg("Payment token is not whitelisted")]
    TokenNotWhitelisted,
    #[msg("Purchase exceeds remaining stage supply")]
    ExceedsStageSupply,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Claim is not enabled for this stage")]
    ClaimNotEnabled,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Price feed is stale or unavailable")]
    StalePriceFeed,
    #[msg("Invalid price from oracle")]
    InvalidPrice,
    #[msg("Invalid payment token account")]
    InvalidPaymentAccount,
    #[msg("Vault has insufficient token balance")]
    InsufficientVaultBalance,
    #[msg("Invalid Pyth oracle account owner")]
    InvalidPriceOracle,
    #[msg("Cannot nominate the zero address as admin")]
    InvalidAdmin,
    #[msg("Stage ID must be sequential")]
    InvalidStageId,
    #[msg("Stage account does not match expected stage ID")]
    InvalidStage,
    #[msg("Payment mint decimals mismatch")]
    DecimalsMismatch,
    #[msg("Contract is paused")]
    ContractPaused,
    #[msg("Stage must be deactivated first")]
    StageIsActive,
    #[msg("Disable claim before closing stage")]
    StageNotSettled,
    #[msg("Disable whitelist token before closing")]
    TokenStillEnabled,
    #[msg("Claim all tokens before closing")]
    PurchaseNotSettled,
    #[msg("All purchased tokens must be claimed before closing the stage")]
    UnclaimedTokensRemaining,
    #[msg("tokens_total cannot be less than tokens_sold")]
    InvalidTokensTotal,
    #[msg("Timestamps must be non-negative and end_time must be greater than start_time")]
    InvalidTimeRange,
    #[msg("end_time is in the past")]
    EndTimeExpired,
    #[msg("Stage has not started yet")]
    StageNotStarted,
    #[msg("Stage has ended")]
    StageEnded,
}
