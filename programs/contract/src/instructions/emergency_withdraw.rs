use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::IcoError;
use crate::events::{EmergencyWithdrawEvent, EmergencyWithdrawSolEvent};
use crate::state::IcoConfig;

/// Emergency withdrawal of SPL tokens from any ATA owned by the ico_config PDA.
///
/// Use this to recover:
///   - Stablecoin payments (USDC, USDT, …): pass the stablecoin mint.
///     Each whitelisted stablecoin has its own independent ATA; call once per mint.
///   - Unsold or excess ICO tokens: pass the ICO token mint.
///
/// This instruction operates on SPL token accounts (ATAs) only.
/// It does NOT touch SOL lamports on the PDA — use emergency_withdraw_sol for that.
pub fn handler(ctx: Context<EmergencyWithdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, IcoError::ZeroAmount);

    let signer_seeds: &[&[&[u8]]] = &[&[b"ico-config", &[ctx.accounts.ico_config.bump]]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.admin_token_account.to_account_info(),
                authority: ctx.accounts.ico_config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(EmergencyWithdrawEvent {
        admin: ctx.accounts.admin.key(),
        mint: ctx.accounts.token_mint.key(),
        amount,
    });

    Ok(())
}

/// Emergency withdrawal of SOL lamports from the ico_config PDA.
///
/// SOL received from buyers via the `buy` instruction is stored as plain lamports
/// on the ico_config PDA itself (not in a token account).  This instruction drains
/// those lamports using a direct lamport transfer rather than an SPL CPI.
///
/// A minimum rent-exemption reserve is always preserved so the PDA is not destroyed.
/// Available SOL = pda_lamports - min_rent_exemption(pda_data_len).
///
/// This instruction operates on lamports only.
/// It does NOT touch SPL token balances — use emergency_withdraw for those.
pub fn handler_sol(ctx: Context<EmergencyWithdrawSol>, amount: u64) -> Result<()> {
    require!(amount > 0, IcoError::ZeroAmount);

    let ico_config_info = ctx.accounts.ico_config.to_account_info();
    let rent = Rent::get()?;
    let min_rent = rent.minimum_balance(ico_config_info.data_len());
    let available = ico_config_info
        .lamports()
        .checked_sub(min_rent)
        .ok_or(IcoError::InsufficientVaultBalance)?;
    require!(amount <= available, IcoError::InsufficientVaultBalance);

    **ico_config_info.try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.admin.to_account_info().try_borrow_mut_lamports()? += amount;

    emit!(EmergencyWithdrawSolEvent {
        admin: ctx.accounts.admin.key(),
        amount,
    });

    Ok(())
}

#[derive(Accounts)]
pub struct EmergencyWithdraw<'info> {
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

    /// Mint of the token to withdraw
    pub token_mint: Account<'info, Mint>,

    /// Vault holding tokens, owned by ico_config PDA
    #[account(
        mut,
        associated_token::mint = token_mint,
        associated_token::authority = ico_config,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Admin's token account (created if needed)
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = token_mint,
        associated_token::authority = admin,
    )]
    pub admin_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EmergencyWithdrawSol<'info> {
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
}
