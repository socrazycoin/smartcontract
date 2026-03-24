# Token ICO Smart Contract

A Solana-based Initial Coin Offering (ICO) smart contract built with Anchor 0.32. Supports multi-stage token presales with configurable pricing, multiple payment tokens (including native SOL via Pyth oracle), and staged claiming.

## Features

- **Multi-stage presale** — Create multiple stages with independent pricing, supplies, and time windows.
- **Multiple payment tokens** — Accept any whitelisted SPL token (USDC, USDT, etc.) as payment.
- **SOL payments via Pyth oracle** — Buy tokens with native SOL; USD price resolved on-chain using [Pyth Push Oracle](https://docs.pyth.network/price-feeds/core/push-feeds/solana) price feed accounts.
- **Staged claiming** — Users claim purchased tokens only after the admin enables claiming for a stage.
- **Admin transfer** — Single-step direct assignment of admin role to a new pubkey.
- **Vault balance guard** — `claim` verifies the vault holds enough tokens before transferring.
- **Payment vault validation** — Stablecoin payments verify the destination ATA is owned by the `IcoConfig` PDA.
- **On-chain accounting** — Per-user purchase records; total USD raised tracking (global + per-stage).
- **Read scripts** — Inspect any on-chain account (config, stage, purchase, whitelist) from CLI.
- **6-decimal USD precision** throughout all price calculations.

## Prerequisites

- [Rust](https://rustup.rs/) (toolchain 1.89.0 — auto-selected via `rust-toolchain.toml`)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.18+)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (v0.32.x)
- [Node.js](https://nodejs.org/) (v18+)
- [Yarn](https://yarnpkg.com/) (v1)

## Setup

### 1. Install Dependencies

```bash
yarn install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
ADMIN_KEYPAIR=~/.config/solana/id.json
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
TOKEN_MINT=<your token mint address>
USER_KEYPAIR=~/.config/solana/id.json   # optional (defaults to ADMIN_KEYPAIR)
```

### 3. Build the Contract

```bash
anchor build
```

### 4. Run Tests

```bash
anchor test
```

## Deployment

### Deploy (first time)

```bash
yarn deploy
```

Uses a 2-step buffer approach with automatic retry and priority fees. On failure, prints buffer recovery instructions.

### Upgrade (existing program)

```bash
yarn upgrade-contract
```

Same buffer approach — writes the program to a buffer first, then deploys from the buffer.

---

## On-Chain Architecture

### Program

| Item | Value |
|------|-------|
| Program ID | `9bfF6gsLo8G8Bqmu9B4BBmNuBKuZpdf9dqjXSfS63bbp` |
| Framework | Anchor 0.32 |
| Instructions | 15 |

### PDA Accounts

| Account | Seeds | Description |
|---------|-------|-------------|
| `IcoConfig` | `["ico-config"]` | Global config: admin, token_mint, total_raised_usd, current_stage, stage_count, paused |
| `Stage` | `["stage", stage_id (u8)]` | Per-stage: price, supply, tokens_sold, tokens_claimed_total, total_raised_usd, start_time, end_time, active/claim flags |
| `WhitelistToken` | `["whitelist-token", mint]` | Payment token: enabled flag, cached decimals |
| `UserStagePurchase` | `["user-stage", user, stage_id (u8)]` | Per-user per-stage: tokens_purchased, tokens_claimed |
| Vault (ATA) | Associated Token Account of `IcoConfig` PDA | Holds tokens for distribution |

### Pyth Price Feed Integration (SOL Payments)

When buying with native SOL (`So11111111111111111111111111111111111111112`), the contract reads the SOL/USD price from a **Pyth Push Oracle** price feed account on-chain.

| Item | Value |
|------|-------|
| Pyth Push Oracle Program | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` |
| SOL/USD Feed ID | `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |
| Price Feed Account (shard 0) | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` |
| Staleness threshold | 120 seconds |

The price feed account PDA is derived as:

```
seeds = [shard_id (u16 LE, = 0), feed_id (32 bytes from hex)]
program = pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT
```

The `buy.ts` CLI script derives this PDA automatically — no manual address needed.

---

### Dual-Path Payment & Fund Architecture

The contract uses **two separate fund destinations** depending on the payment token. Operators must understand this split to use the correct withdrawal instruction.

#### Payment routing at `buy` time

| Payment type | Where funds land | On-chain account type |
|---|---|---|
| Native SOL | `IcoConfig` PDA itself (lamports) | System-owned lamports on the PDA |
| Stablecoins (USDC, USDT, …) | ATA of `IcoConfig` for that mint | SPL token account (`TokenAccount`) |

- **SOL path:** `system_instruction::transfer` moves lamports directly from the buyer's wallet to the `IcoConfig` PDA address. The PDA accumulates SOL as plain lamports — there is no separate SOL vault.
- **Stablecoin path:** `token::transfer` (SPL CPI) moves tokens from the buyer's token account to the **payment vault**, which is the Associated Token Account of the `IcoConfig` PDA for that specific mint. Each whitelisted stablecoin has its own ATA; it is created automatically when the admin calls `set_whitelist_token`.

#### Withdrawal instructions — which one to use

| Funds to recover | Instruction | Mechanism |
|---|---|---|
| SOL received from buyers | `emergency_withdraw_sol` | Direct lamport transfer out of PDA; enforces minimum rent reserve so the PDA is not destroyed |
| Stablecoin tokens received from buyers | `emergency_withdraw` (pass the stablecoin mint) | PDA-signed SPL `token::transfer` from the stablecoin's ATA |
| ICO tokens in the distribution vault | `emergency_withdraw` (pass the ICO token mint) | PDA-signed SPL `token::transfer` from the ICO token ATA |

> **Operator note:** Calling `emergency_withdraw_sol` with the wrong amount could leave the PDA balance below rent-exemption — the instruction guards against this by capping the withdrawal to `lamports - min_rent`. Stablecoin balances are fully independent per mint; check each ATA separately on-chain.

---

## Instructions (15 total)

### 1. `initialize_ico`

Creates the `IcoConfig` PDA. Must be called once before any other instruction.

- **Signer:** Admin
- **Params:** `token_mint`
- **Initializes:** `IcoConfig` with `current_stage = 255` (no active stage)

### 2. `create_stage`

Creates a new `Stage` PDA.

- **Signer:** Admin
- **Params:** `stage_id (u8)`, `price_usd (u64, 6 decimals)`, `tokens_total (u64, raw)`, `start_time (i64, Unix timestamp, 0 = no restriction)`, `end_time (i64, Unix timestamp, 0 = no restriction)`
- **Validates:** `stage_id == stage_count + 1` (sequential), `price > 0`, `tokens_total > 0`, timestamps are non-negative, `end_time > now` (when set), `end_time > start_time` (when both set)
- **Initializes:** `total_raised_usd = 0`

### 3. `set_stage_active`

Activates or deactivates a stage.

- **Signer:** Admin
- **Params:** `stage_id`, `active (bool)`
- **Validates:** Only one stage can be active at a time

### 4. `enable_stage_claim`

Enables or disables token claiming for a stage.

- **Signer:** Admin
- **Params:** `stage_id`, `enabled (bool)`

### 5. `set_whitelist_token`

Adds, updates, or disables a whitelisted payment token.

- **Signer:** Admin
- **Params:** `mint`, `enabled (bool)`
- **Creates/Updates:** `WhitelistToken` PDA for the mint (caches mint decimals)
- **Note:** Stablecoin USD value is hardcoded at $1.00 per unit (no on-chain price feed for stablecoins)

### 6. `buy`

Purchases tokens from the active stage.

- **Signer:** Buyer
- **Params:** `stage_id`, `payment_amount (u64, raw)`
- **Payment methods (dual-path — see architecture section above):**
  - **Stablecoins (USDC, USDT, etc.):** SPL `token::transfer` from buyer's token account → payment vault (ATA of `IcoConfig` for that mint). Each stablecoin has its own separate ATA. Recover with `emergency_withdraw`.
  - **Native SOL:** `system_instruction::transfer` (lamport transfer) from buyer → `IcoConfig` PDA itself. SOL accumulates as lamports on the PDA, not in a token account. Recover with `emergency_withdraw_sol`.
- **Validates:**
  - Stage is active and within time window (`start_time` / `end_time`)
  - Payment token is whitelisted and enabled
  - Stage has remaining supply (`tokens_to_buy <= tokens_total - tokens_sold`)
  - Price feed is not stale (≤ 120s) — SOL path only
  - Arithmetic uses safe `u64::try_from()` (no unsafe casts)
- **Creates/Updates:** `UserStagePurchase` PDA
- **Updates:** `Stage.total_raised_usd`, `IcoConfig.total_raised_usd`
- **Emits:** `BuyEvent`

### 7. `claim`

Claims purchased tokens from a stage.

- **Signer:** User
- **Params:** `stage_id`
- **Validates:** Claim is enabled for the stage, user has unclaimed tokens, vault has sufficient balance
- **Transfers:** Tokens from vault ATA → user ATA (PDA-signed)
- **Updates:** `UserStagePurchase.tokens_claimed`, `Stage.tokens_claimed_total`
- **Emits:** `ClaimEvent`

### 8. `emergency_withdraw`

Admin withdraws SPL tokens from any ATA owned by the `IcoConfig` PDA. Use this to recover **stablecoin payments** (pass the stablecoin mint) or unsold/excess **ICO tokens** (pass the ICO token mint). Each stablecoin has its own independent ATA — call this instruction once per mint to drain each one.

- **Signer:** Admin
- **Params:** `amount (u64, raw token units)`, `token_mint (Pubkey)`
- **Transfers:** `vault` ATA (of `IcoConfig` for `token_mint`) → admin ATA (PDA-signed via `IcoConfig`)
- **Does NOT affect SOL lamports on the PDA** — use `emergency_withdraw_sol` for that

### 9. `emergency_withdraw_sol`

Admin withdraws SOL lamports that accumulated on the `IcoConfig` PDA from SOL-payment buyers. SOL is held directly as lamports on the PDA (not in a token account), so this instruction uses a direct lamport transfer rather than an SPL CPI.

- **Signer:** Admin
- **Params:** `amount (u64, lamports)`
- **Validates:** `amount <= pda_lamports - min_rent_exemption` (prevents destroying the PDA by leaving it below rent threshold)
- **Does NOT affect SPL token balances** — use `emergency_withdraw` for stablecoin or ICO token ATAs

### 10. `transfer_admin`

Transfer admin role directly to a new admin.

- **Signer:** Current admin
- **Params:** `new_admin (Pubkey)`
- **Validates:** `new_admin != Pubkey::default()`
- **Sets:** `ico_config.admin = new_admin`

> **⚠️ Warning:** This is a single-step direct assignment. If the admin passes an incorrect pubkey, admin access is permanently lost and all admin-gated functionality becomes inaccessible.

### 11. `toggle_pause`

Pause or unpause the contract. When paused, `buy` and `claim` are disabled.

- **Signer:** Admin
- **Params:** `paused (bool)`

### 12. `update_stage`

Updates a stage's price, total allocation, and time window. The stage must be inactive.

- **Signer:** Admin
- **Params:** `stage_id (u8)`, `token_price_usd (u64, 6 decimals)`, `tokens_total (u64, raw)`, `start_time (i64)`, `end_time (i64)`
- **Validates:** Stage is inactive, `price > 0`, `tokens_total >= tokens_sold`, timestamps are non-negative, `end_time > now` (when set), `end_time > start_time` (when both set)

### 13. `close_stage`

Closes a fully settled stage account to reclaim rent.

- **Signer:** Admin
- **Params:** `stage_id (u8)`
- **Validates:**
  1. Stage is inactive (`is_active = false`)
  2. Claim is disabled (`claim_enabled = false`)
  3. All purchased tokens have been claimed (`tokens_claimed_total == tokens_sold`)

### 14. `close_whitelist_token`

Closes a disabled whitelist token account to reclaim rent.

- **Signer:** Admin
- **Validates:** Token is disabled

### 15. `close_user_purchase`

Closes a fully settled user purchase account to reclaim rent.

- **Signer:** User
- **Params:** `stage_id (u8)`
- **Validates:** `tokens_bought == tokens_claimed`

---

## CLI Scripts

All scripts live in `app/` and are run via `yarn`. Configuration is read from `.env`.

### Admin Setup Scripts
#### Initialize ICO

Creates the on-chain ICO config account and token vault:

```bash
yarn initialize-ico
```

#### Create Stage

```bash
yarn create-stage <stage_id> <price_usd_6dec> <tokens_total_raw> [start_time] [end_time]
```

Example — Stage 1 at $0.001, 77.77M tokens (9 decimals), with time window:

```bash
yarn create-stage 1 1000 77777777000000000 1700000000 1710000000
```

> **Price format**: 6-decimal USD. `1000` = $0.001, `1000000` = $1.00
> **Time format**: Unix timestamp. Use `0` for no restriction.

#### Set Stage Active

```bash
yarn set-stage-active <stage_id> <true|false>
```

#### Enable Stage Claim

```bash
yarn enable-stage-claim <stage_id> <true|false>
```

#### Set Whitelist Token

```bash
yarn set-whitelist-token <mint> <true|false>
```

Example — Whitelist USDC:

```bash
yarn set-whitelist-token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v true
```

#### Fund Vault

Transfer tokens from admin wallet into the presale vault:

```bash
yarn fund-vault <amount_raw>
```

#### Emergency Withdraw

Admin withdraws tokens from the vault:

```bash
yarn emergency-withdraw <amount_raw>
```

#### Update Stage

Update a stage's price, allocation, and time window (stage must be inactive):

```bash
yarn update-stage <stage_id> <token_price_usd> <tokens_total> [start_time] [end_time]
```

Example — Update stage 2 to $0.006 with 60M tokens:

```bash
yarn update-stage 2 6000 60000000000000 1700000000 1710000000
```

#### Toggle Pause

Pause or unpause the contract (disables buy and claim):

```bash
yarn pause <true|false>
```

#### Transfer Admin

Transfer admin role directly to a new pubkey (⚠️ single-step, irreversible):

```bash
yarn transfer-admin <new_admin_pubkey>
```

#### Close Accounts

Reclaim rent from settled accounts:

```bash
yarn close-stage <stage_id>
yarn close-whitelist <mint>
yarn close-user-purchase <stage_id>
```

### User Scripts

#### Buy Tokens

```bash
yarn buy <stage_id> <payment_mint> <payment_amount_raw>
```

**Buy with stablecoin (USDC, 6 decimals):**

```bash
yarn buy 1 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 10000000
```

**Buy with SOL (Pyth price auto-derived, 9 decimals = 0.1 SOL):**

```bash
yarn buy 1 So11111111111111111111111111111111111111112 100000000
```

> When paying with SOL, the script automatically derives the Pyth SOL/USD price feed PDA — no manual address needed.

> Set `USER_KEYPAIR` in `.env` to use a different buyer wallet (defaults to `ADMIN_KEYPAIR`).

#### Claim Tokens

```bash
yarn claim <stage_id>
```

### Read Scripts

#### Read Config

Display `IcoConfig` account (admin, token mint, total raised, vault balance):

```bash
yarn read-config
```

#### Read Stage

Display details about a specific stage (price, supply, sold, total raised USD, time window, progress %):

```bash
yarn read-stage <stage_id>
```

#### Read Purchase

Display a user's purchase record for a stage:

```bash
yarn read-purchase <stage_id> [user_pubkey]
```

> Defaults to the current user wallet if `user_pubkey` is omitted.

#### Read Whitelist

Display whitelist status for a payment token:

```bash
yarn read-whitelist <mint>
```

#### Status

Display comprehensive on-chain ICO state (config + vault balance + all stages):

```bash
yarn status
yarn status <stage_id>   # show a specific stage only
```

---

## Typical Workflow

```bash
# 1. Build & deploy
anchor build
yarn deploy

# 2. Initialize ICO
yarn initialize-ico

# 3. Create stages with time windows
yarn create-stage 1 1000 77777777000000000 1700000000 1710000000
yarn create-stage 2 5000 50000000000000000 0 0   # no time restriction

# 4. Whitelist payment tokens
yarn set-whitelist-token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v true   # USDC (hardcoded $1)
yarn set-whitelist-token So11111111111111111111111111111111111111112 true         # SOL (Pyth oracle)

# 5. Fund the vault with tokens
yarn fund-vault 500000000000000000

# 6. Activate stage 1
yarn set-stage-active 1 true

# 7. Check status
yarn status

# 8. Users buy tokens
yarn buy 1 EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 10000000   # USDC
yarn buy 1 So11111111111111111111111111111111111111112 100000000       # SOL

# 9. Inspect state
yarn read-config
yarn read-stage 1           # shows total_raised_usd, time window, etc.
yarn read-purchase 1

# 10. After stage ends, enable claiming
yarn enable-stage-claim 1 true

# 11. Users claim tokens
yarn claim 1

# 12. Once all users have claimed (tokens_claimed_total == tokens_sold),
#     disable claiming and move to next stage
yarn enable-stage-claim 1 false
yarn set-stage-active 1 false
yarn set-stage-active 2 true

# 13. Update stage (must be inactive)
yarn update-stage 2 6000 60000000000000 0 0

# 14. Admin transfer (single-step, irreversible)
yarn transfer-admin <new_admin_pubkey>

# 15. Pause/unpause
yarn pause true
yarn pause false

# 16. Close settled accounts to reclaim rent
#     close-stage requires: inactive + claim disabled + tokens_claimed_total == tokens_sold
yarn close-stage 1
yarn close-user-purchase 1
```

---

## Security Features

| Feature | Description |
|---------|-------------|
| **Single-step admin transfer** | `transfer_admin` directly assigns new admin — **no nominate/accept safety net; typos cause permanent admin loss** |
| **Payment vault validation** | Stablecoin `buy` verifies destination ATA is owned by the `IcoConfig` PDA |
| **Vault balance guard** | `claim` checks `vault.amount >= claimable` before transferring tokens |
| **Safe arithmetic** | `u64::try_from()` for all conversions — no unsafe `as u64` casts |
| **Price staleness check** | Pyth price feed must be ≤ 120s old |
| **PDA-signed transfers** | Vault → user token transfers signed by `IcoConfig` PDA |
| **Single active stage** | Only one stage can be active at any time |
| **Stage time window** | `buy` enforces `start_time` / `end_time` boundaries when set |
| **Settlement guard on close** | `close_stage` requires `tokens_claimed_total == tokens_sold` — prevents closing a stage while users still have unclaimed balances |

## Error Codes

| Name | Description |
|------|-------------|
| `Unauthorized` | Signer is not the admin |
| `StageNotActive` | Stage is not currently active |
| `AnotherStageActive` | Another stage is already active |
| `TokenNotWhitelisted` | Payment token mint is not whitelisted |
| `ExceedsStageSupply` | Purchase would exceed remaining stage supply |
| `Overflow` | Arithmetic overflow in token/price calculation |
| `ClaimNotEnabled` | Claiming is not enabled for this stage |
| `NothingToClaim` | User has no unclaimed tokens |
| `ZeroAmount` | Payment amount is zero |
| `StalePriceFeed` | Pyth price feed older than 120 seconds |
| `InvalidPrice` | Oracle returned invalid price (≤ 0) |
| `InvalidPaymentAccount` | Payment token account is invalid or does not match expected owner/mint |
| `InsufficientVaultBalance` | Vault doesn't hold enough tokens for the purchase |
| `InvalidPriceOracle` | Pyth price feed account is not owned by the expected oracle program |
| `InvalidAdmin` | `transfer_admin` called with `Pubkey::default()` |
| `InvalidStageId` | `stage_id` is not sequential (must equal `stage_count + 1`) |
| `InvalidStage` | Stage account does not match the provided `stage_id` |
| `DecimalsMismatch` | Payment mint decimals differ from the cached whitelist token decimals |
| `ContractPaused` | Contract is paused; `buy` and `claim` are disabled |
| `StageIsActive` | Stage must be deactivated before this operation |
| `StageNotSettled` | Claim must be disabled before closing a stage |
| `TokenStillEnabled` | Whitelist token must be disabled before its account can be closed |
| `PurchaseNotSettled` | All purchased tokens must be claimed before closing a purchase account |
| `UnclaimedTokensRemaining` | All purchased tokens must be claimed before closing the stage |
| `InvalidTokensTotal` | `tokens_total` cannot be set below `tokens_sold` |
| `InvalidTimeRange` | Timestamps must be non-negative and `end_time` must be greater than `start_time` |
| `EndTimeExpired` | `end_time` is already in the past relative to the current clock |
| `StageNotStarted` | Current time is before the stage's `start_time` |
| `StageEnded` | Current time is past the stage's `end_time` |

---

## Project Structure

```
├── programs/contract/src/
│   ├── lib.rs                      # Program entry point (15 instructions)
│   ├── errors.rs                   # Custom error codes
│   ├── events.rs                   # BuyEvent, ClaimEvent, CreateStageEvent, UpdateStageEvent, etc.
│   ├── state/                      # On-chain account structures
│   │   ├── ico_config.rs           # IcoConfig PDA ["ico-config"]
│   │   ├── stage.rs                # Stage PDA ["stage", stage_id]
│   │   ├── whitelist_token.rs      # WhitelistToken PDA ["whitelist-token", mint]
│   │   └── user_stage_purchase.rs  # UserStagePurchase PDA ["user-stage", user, stage_id]
│   └── instructions/               # Instruction handlers + account contexts
│       ├── initialize.rs
│       ├── create_stage.rs
│       ├── set_stage_active.rs
│       ├── enable_stage_claim.rs
│       ├── set_whitelist_token.rs
│       ├── buy.rs                  # Handles SOL (Pyth) + stablecoin payments
│       ├── claim.rs
│       ├── emergency_withdraw.rs
│       ├── update_config.rs        # transfer_admin, toggle_pause
│       ├── update_stage.rs
│       └── close_account.rs        # close_stage, close_whitelist_token, close_user_purchase
├── app/                            # TypeScript CLI scripts
│   ├── helpers.ts                  # Shared: provider, PDA derivation
│   ├── deploy.ts / upgrade.ts      # Deploy & upgrade (2-step buffer approach)
│   ├── initialize-ico.ts
│   ├── create-stage.ts
│   ├── set-stage-active.ts
│   ├── enable-stage-claim.ts
│   ├── set-whitelist-token.ts
│   ├── buy.ts                      # Pyth PDA auto-derivation for SOL
│   ├── claim.ts
│   ├── fund-vault.ts
│   ├── emergency-withdraw.ts
│   ├── update-stage.ts
│   ├── toggle-pause.ts
│   ├── transfer-admin.ts
│   ├── close-stage.ts
│   ├── close-user-purchase.ts
│   ├── close-whitelist-token.ts
│   ├── status.ts
│   ├── read-config.ts              # Read IcoConfig account
│   ├── read-stage.ts               # Read Stage account (incl. total_raised_usd, time window)
│   ├── read-purchase.ts            # Read UserStagePurchase account
│   └── read-whitelist.ts           # Read WhitelistToken account
├── tests/contract.ts               # Unit tests (anchor test)
├── .env.example                    # Environment template
├── Anchor.toml
└── package.json
```
