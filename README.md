# Token ICO Smart Contract

A Solana-based Initial Coin Offering (ICO) smart contract built with Anchor 0.32. Supports multi-stage token presales with configurable pricing, multiple payment tokens (including native SOL via Pyth oracle), and staged claiming.

## Features

- **Multi-stage presale** — Create multiple stages with independent pricing, supplies, and time windows.
- **Multiple payment tokens** — Accept any whitelisted SPL token (USDC, USDT, etc.) as payment.
- **SOL payments via Pyth oracle** — Buy tokens with native SOL; USD price resolved on-chain using [Pyth Push Oracle](https://docs.pyth.network/price-feeds/core/push-feeds/solana) price feed accounts.
- **Staged claiming** — Users claim purchased tokens only after the admin enables claiming for a stage.
- **2-step admin transfer** — Nominate → Accept pattern prevents accidental admin loss.
- **Treasury update** — Admin can change the treasury wallet at any time.
- **Vault balance guard** — `buy` verifies the vault holds enough tokens before selling.
- **Treasury payment validation** — Stablecoin payments verify the destination matches the treasury on-chain.
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
| Program ID | `AwcrcHPXLFVDdxo3VYFYb9YaGdvJ5fpJXqCpoducpz4P` |
| Framework | Anchor 0.32 |
| Instructions | 16 |

### PDA Accounts

| Account | Seeds | Description |
|---------|-------|-------------|
| `IcoConfig` | `["ico-config"]` | Global config: admin, pending_admin, token_mint, treasury, total_raised_usd, current_stage |
| `Stage` | `["stage", stage_id (u8)]` | Per-stage: price, supply, tokens sold, total_raised_usd, start_time, end_time, active/claim flags |
| `WhitelistToken` | `["whitelist-token", mint]` | Payment token: enabled flag, USD price (6 decimals) |
| `UserStagePurchase` | `["user-stage", user, stage_id (u8)]` | Per-user per-stage: tokens_purchased, tokens_claimed |
| Vault (ATA) | Associated Token Account of `IcoConfig` PDA | Holds tokens for distribution |

### Pyth Price Feed Integration (SOL Payments)

When buying with native SOL (`So11111111111111111111111111111111111111112`), the contract reads the SOL/USD price from a **Pyth Push Oracle** price feed account on-chain.

| Item | Value |
|------|-------|
| Pyth Push Oracle Program | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` |
| SOL/USD Feed ID | `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d` |
| Price Feed Account (shard 0) | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE` |
| Staleness threshold | 300 seconds (safe for ICO context; mainnet feeds update every ~60s) |

The price feed account PDA is derived as:

```
seeds = [shard_id (u16 LE, = 0), feed_id (32 bytes from hex)]
program = pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT
```

The `buy.ts` CLI script derives this PDA automatically — no manual address needed.

---

## Instructions (16 total)

### 1. `initialize_ico`

Creates the `IcoConfig` PDA. Must be called once before any other instruction.

- **Signer:** Admin
- **Params:** `token_mint`, `treasury`
- **Initializes:** `IcoConfig` with `pending_admin = Pubkey::default()`, `current_stage = 255` (no active stage)

### 2. `create_stage`

Creates a new `Stage` PDA.

- **Signer:** Admin
- **Params:** `stage_id (u8)`, `price_usd (u64, 6 decimals)`, `tokens_total (u64, raw)`, `start_time (i64, Unix timestamp, 0 = no restriction)`, `end_time (i64, Unix timestamp, 0 = no restriction)`
- **Validates:** `stage_id == stage_count` (sequential), `price > 0`, `tokens_total > 0`, `end_time > start_time` (when both > 0)
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
- **Params:** `mint`, `enabled (bool)`, `price_usd (u64, 6 decimals)`
- **Creates/Updates:** `WhitelistToken` PDA for the mint

### 6. `buy`

Purchases tokens from the active stage.

- **Signer:** Buyer
- **Params:** `stage_id`, `payment_amount (u64, raw)`
- **Payment methods:**
  - **Stablecoins (USDC, USDT, etc.):** Transfers SPL tokens from buyer to treasury ATA. Validates treasury payment account matches on-chain config.
  - **Native SOL:** Transfers SOL via `system_program::transfer` from buyer to treasury. Price is read from Pyth Push Oracle price feed account on-chain.
- **Validates:**
  - Stage is active and within time window (`start_time` / `end_time`)
  - Payment token is whitelisted and enabled
  - Vault holds enough tokens (`vault.amount >= tokens_to_buy`)
  - Price feed is not stale (≤ 300s)
  - Arithmetic uses safe `u64::try_from()` (no unsafe casts)
- **Creates/Updates:** `UserStagePurchase` PDA
- **Updates:** `Stage.total_raised_usd`, `IcoConfig.total_raised_usd`
- **Emits:** `BuyEvent`

### 7. `claim`

Claims purchased tokens from a stage.

- **Signer:** User
- **Params:** `stage_id`
- **Validates:** Claim is enabled for the stage, user has unclaimed tokens
- **Transfers:** Tokens from vault ATA → user ATA (PDA-signed)
- **Emits:** `ClaimEvent`

### 8. `emergency_withdraw`

Admin withdraws tokens from the vault.

- **Signer:** Admin
- **Params:** `amount (u64, raw)`
- **Transfers:** Tokens from vault ATA → admin ATA (PDA-signed)

### 9. `emergency_withdraw_sol`

Admin withdraws SOL from the IcoConfig PDA.

- **Signer:** Admin
- **Params:** `amount (u64, lamports)`

### 10. `nominate_admin`

Step 1 of 2-step admin transfer. Current admin nominates a new admin.

- **Signer:** Current admin
- **Params:** `new_admin (Pubkey)`
- **Sets:** `ico_config.pending_admin = new_admin`

### 11. `accept_admin`

Step 2 of 2-step admin transfer. Nominated admin accepts the role.

- **Signer:** Nominated admin (`pending_admin`)
- **Validates:** `pending_admin != Pubkey::default()`, signer matches `pending_admin`
- **Sets:** `admin = pending_admin`, `pending_admin = Pubkey::default()`

### 12. `toggle_pause`

Pause or unpause the contract. When paused, `buy` and `claim` are disabled.

- **Signer:** Admin
- **Params:** `paused (bool)`

### 13. `update_stage`

Updates a stage's price, total allocation, and time window. The stage must be inactive.

- **Signer:** Admin
- **Params:** `stage_id (u8)`, `token_price_usd (u64, 6 decimals)`, `tokens_total (u64, raw)`, `start_time (i64)`, `end_time (i64)`
- **Validates:** Stage is inactive, `price > 0`, `tokens_total >= tokens_sold`, `end_time > start_time` (when both > 0)

### 14. `update_treasury`

Admin updates the treasury wallet address.

- **Signer:** Admin
- **Params:** `new_treasury (Pubkey)`

### 15. `close_stage`

Closes a settled stage account to reclaim rent.

- **Signer:** Admin
- **Params:** `stage_id (u8)`
- **Validates:** Stage is inactive, claim is disabled

### 16. `close_whitelist_token`

Closes a disabled whitelist token account to reclaim rent.

- **Signer:** Admin
- **Validates:** Token is disabled

### 17. `close_user_purchase`

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
yarn set-whitelist-token <mint> <true|false> <price_usd_6dec>
```

Example — Whitelist USDC at $1:

```bash
yarn set-whitelist-token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v true 1000000
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

#### Transfer Admin (2-step)

Nominate and accept a new admin:

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

Display `IcoConfig` account (admin, treasury, token mint, total raised, pending admin, vault balance):

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
yarn set-whitelist-token EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v true 1000000  # USDC
yarn set-whitelist-token So11111111111111111111111111111111111111112 true 0          # SOL (Pyth)

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

# 12. Move to next stage
yarn set-stage-active 1 false
yarn set-stage-active 2 true

# 13. Update stage (must be inactive)
yarn update-stage 2 6000 60000000000000 0 0

# 14. Admin transfer (2-step: nominate → accept)
yarn transfer-admin <new_admin_pubkey>

# 15. Pause/unpause
yarn pause true
yarn pause false

# 16. Close settled accounts to reclaim rent
yarn close-stage 1
yarn close-user-purchase 1
```
```

---

## Security Features

| Feature | Description |
|---------|-------------|
| **2-step admin transfer** | `nominate_admin` → `accept_admin` prevents accidental admin key loss |
| **Treasury payment validation** | Stablecoin `buy` verifies destination ATA matches on-chain treasury |
| **Vault balance guard** | `buy` checks `vault.amount >= tokens_to_buy` before selling |
| **Safe arithmetic** | `u64::try_from()` for all conversions — no unsafe `as u64` casts |
| **Price staleness check** | Pyth price feed must be ≤ 300s old |
| **PDA-signed transfers** | Vault → user token transfers signed by `IcoConfig` PDA |
| **Single active stage** | Only one stage can be active at any time |
| **Stage time window** | `buy` enforces `start_time` / `end_time` boundaries when set |

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
| `StalePriceFeed` | Pyth price feed older than 300 seconds |
| `InvalidPrice` | Oracle returned invalid price (≤ 0) |
| `InvalidPaymentAccount` | Stablecoin destination doesn't match treasury |
| `InsufficientVaultBalance` | Vault doesn't hold enough tokens for the purchase |
| `NoPendingAdmin` | `accept_admin` called with no pending nomination |
| `InvalidTimeRange` | `end_time` must be greater than `start_time` |
| `StageNotStarted` | Current time is before the stage's `start_time` |
| `StageEnded` | Current time is past the stage's `end_time` |

---

## Project Structure

```
├── programs/contract/src/
│   ├── lib.rs                      # Program entry point (16 instructions)
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
│       ├── update_config.rs        # nominate_admin, accept_admin, toggle_pause, update_treasury
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
