import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { Contract } from "../target/types/contract";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import BN from "bn.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stagePda(programId: PublicKey, stageId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stage"), Buffer.from([stageId])],
    programId
  );
}

function wlPda(programId: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("whitelist-token"), mint.toBuffer()],
    programId
  );
}

function purchasePda(
  programId: PublicKey,
  user: PublicKey,
  stageId: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user-stage"), user.toBuffer(), Buffer.from([stageId])],
    programId
  );
}

async function expectError(promise: Promise<any>, errorCode: string) {
  try {
    await promise;
    expect.fail("Expected transaction to fail");
  } catch (err: any) {
    // Anchor errors
    if (err instanceof AnchorError) {
      expect(err.error.errorCode.code).to.equal(errorCode);
      return;
    }
    // Sometimes anchor wraps them
    if (err.error?.errorCode?.code) {
      expect(err.error.errorCode.code).to.equal(errorCode);
      return;
    }
    // Constraint / account errors surface differently
    const msg = err.toString();
    if (msg.includes(errorCode)) return;
    // For constraint errors that don't have errorCode, just accept them
    if (
      errorCode === "Unauthorized" &&
      (msg.includes("ConstraintRaw") ||
        msg.includes("2003") ||
        msg.includes("Unauthorized"))
    )
      return;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ICO Contract – Full Coverage", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.contract as Program<Contract>;

  const admin = provider.wallet as anchor.Wallet;
  const payer = (admin as any).payer as Keypair;
  const user = Keypair.generate();
  const user2 = Keypair.generate();
  const nonAdmin = Keypair.generate();

  let tokenMint: PublicKey;
  let usdcMint: PublicKey;
  let usdtMint: PublicKey;

  let icoConfigPda: PublicKey;
  let vaultAta: PublicKey;

  const STAGE_1_ID = 1;
  const STAGE_2_ID = 2;
  const STAGE_1_PRICE = new BN(3_000); // $0.003000 (6-dec USD)
  const STAGE_2_PRICE = new BN(5_000); // $0.005000
  const STAGE_1_TOKENS = new BN(100_000_000).mul(new BN(1_000_000)); // 100M (6-dec)
  const STAGE_2_TOKENS = new BN(50_000_000).mul(new BN(1_000_000)); // 50M

  const TOKEN_DECIMALS = 6;
  const USDC_DECIMALS = 6;
  const USDT_DECIMALS = 6;

  // ------ shared accounts populated in tests ------
  let userUsdcAta: PublicKey;
  let icoConfigUsdcAta: PublicKey;

  // ================================================================
  // SETUP
  // ================================================================

  before(async () => {
    [icoConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("ico-config")],
      program.programId
    );

    // Fund wallets
    for (const kp of [user, user2, nonAdmin]) {
      const sig = await provider.connection.requestAirdrop(
        kp.publicKey,
        10 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    }

    // Create mints
    tokenMint = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      TOKEN_DECIMALS
    );
    usdcMint = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      USDC_DECIMALS
    );
    usdtMint = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      null,
      USDT_DECIMALS
    );

    vaultAta = await getAssociatedTokenAddress(tokenMint, icoConfigPda, true);
  });

  // ================================================================
  // 1. INITIALIZE ICO
  // ================================================================

  describe("initialize_ico", () => {
    it("initializes config and vault successfully", async () => {
      await program.methods
        .initializeIco()
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          tokenMint: tokenMint,
          vault: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.admin.toBase58()).to.equal(admin.publicKey.toBase58());
      expect(cfg.tokenMint.toBase58()).to.equal(tokenMint.toBase58());
      expect(cfg.totalRaisedUsd.toNumber()).to.equal(0);
      expect(cfg.stageCount).to.equal(0);
      expect(cfg.currentStage).to.equal(255); // u8::MAX = no active stage
    });

    it("cannot initialize twice (PDA already exists)", async () => {
      try {
        await program.methods
          .initializeIco()
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            tokenMint: tokenMint,
            vault: vaultAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have failed");
      } catch (err: any) {
        // account already in use
        expect(err.toString()).to.include("already in use");
      }
    });

    it("funds the vault with tokens for presale", async () => {
      const totalPresale = 544_444_444 * 10 ** TOKEN_DECIMALS;
      await mintTo(
        provider.connection,
        payer,
        tokenMint,
        vaultAta,
        admin.publicKey,
        totalPresale
      );

      const vaultAccount = await getAccount(provider.connection, vaultAta);
      expect(Number(vaultAccount.amount)).to.equal(totalPresale);
    });
  });

  // ================================================================
  // 2. CREATE STAGE
  // ================================================================

  describe("create_stage", () => {
    it("creates stage 1 with correct data", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await program.methods
        .createStage(STAGE_1_ID, STAGE_1_PRICE, STAGE_1_TOKENS, new BN(0), new BN(0))
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const stage = await program.account.stage.fetch(sPda);
      expect(stage.stageId).to.equal(STAGE_1_ID);
      expect(stage.tokenPriceUsd.toNumber()).to.equal(STAGE_1_PRICE.toNumber());
      expect(stage.tokensTotal.eq(STAGE_1_TOKENS)).to.be.true;
      expect(stage.tokensSold.toNumber()).to.equal(0);
      expect(stage.totalRaisedUsd.toNumber()).to.equal(0);
      expect(stage.startTime.toNumber()).to.equal(0);
      expect(stage.endTime.toNumber()).to.equal(0);
      expect(stage.isActive).to.be.false;
      expect(stage.claimEnabled).to.be.false;

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.stageCount).to.equal(1);
    });

    it("creates stage 2", async () => {
      const [sPda] = stagePda(program.programId, STAGE_2_ID);

      await program.methods
        .createStage(STAGE_2_ID, STAGE_2_PRICE, STAGE_2_TOKENS, new BN(0), new BN(0))
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.stageCount).to.equal(2);
    });

    it("fails when non-admin tries to create stage", async () => {
      const [sPda] = stagePda(program.programId, 3);

      await expectError(
        program.methods
          .createStage(3, new BN(7_000), new BN(1_000_000), new BN(0), new BN(0))
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );
    });

    it("fails when token_price_usd is zero", async () => {
      const [sPda] = stagePda(program.programId, 4);

      await expectError(
        program.methods
          .createStage(4, new BN(0), new BN(1_000_000), new BN(0), new BN(0))
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "ZeroAmount"
      );
    });

    it("fails when tokens_total is zero", async () => {
      const [sPda] = stagePda(program.programId, 5);

      await expectError(
        program.methods
          .createStage(5, new BN(3_000), new BN(0), new BN(0), new BN(0))
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "ZeroAmount"
      );
    });
  });

  // ================================================================
  // 3. SET STAGE ACTIVE
  // ================================================================

  describe("set_stage_active", () => {
    it("activates stage 1", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await program.methods
        .setStageActive(STAGE_1_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      const stage = await program.account.stage.fetch(sPda);
      expect(stage.isActive).to.be.true;

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.currentStage).to.equal(STAGE_1_ID);
    });

    it("fails to activate stage 2 while stage 1 is active (AnotherStageActive)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_2_ID);

      await expectError(
        program.methods
          .setStageActive(STAGE_2_ID, true)
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .rpc(),
        "AnotherStageActive"
      );
    });

    it("fails to deactivate stage 2 when stage 1 is the active one (StageNotActive)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_2_ID);

      await expectError(
        program.methods
          .setStageActive(STAGE_2_ID, false)
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .rpc(),
        "StageNotActive"
      );
    });

    it("fails when non-admin tries to set_stage_active", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await expectError(
        program.methods
          .setStageActive(STAGE_1_ID, false)
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );
    });

    it("deactivates stage 1", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await program.methods
        .setStageActive(STAGE_1_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      const stage = await program.account.stage.fetch(sPda);
      expect(stage.isActive).to.be.false;

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.currentStage).to.equal(255);
    });

    it("activates stage 2 after stage 1 is deactivated", async () => {
      const [sPda] = stagePda(program.programId, STAGE_2_ID);

      await program.methods
        .setStageActive(STAGE_2_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      const stage = await program.account.stage.fetch(sPda);
      expect(stage.isActive).to.be.true;

      // Deactivate stage 2 to leave no stage active for subsequent tests
      await program.methods
        .setStageActive(STAGE_2_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();
    });

    // Re-activate stage 1 for buy tests
    it("re-activates stage 1 for buy tests", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await program.methods
        .setStageActive(STAGE_1_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();
    });
  });

  // ================================================================
  // 4. SET WHITELIST TOKEN
  // ================================================================

  describe("set_whitelist_token", () => {
    it("whitelists USDC", async () => {
      const [wl] = wlPda(program.programId, usdcMint);
      icoConfigUsdcAta = await getAssociatedTokenAddress(usdcMint, icoConfigPda, true);

      await program.methods
        .setWhitelistToken(true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          paymentMint: usdcMint,
          whitelistToken: wl,
          paymentVault: icoConfigUsdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const data = await program.account.whitelistToken.fetch(wl);
      expect(data.enabled).to.be.true;
      expect(data.mint.toBase58()).to.equal(usdcMint.toBase58());
    });

    it("whitelists USDT", async () => {
      const [wl] = wlPda(program.programId, usdtMint);
      const usdtVault = await getAssociatedTokenAddress(usdtMint, icoConfigPda, true);

      await program.methods
        .setWhitelistToken(true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          paymentMint: usdtMint,
          whitelistToken: wl,
          paymentVault: usdtVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const data = await program.account.whitelistToken.fetch(wl);
      expect(data.enabled).to.be.true;
    });

    it("can disable a whitelisted token", async () => {
      const [wl] = wlPda(program.programId, usdtMint);
      const usdtVault = await getAssociatedTokenAddress(usdtMint, icoConfigPda, true);

      await program.methods
        .setWhitelistToken(false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          paymentMint: usdtMint,
          whitelistToken: wl,
          paymentVault: usdtVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const data = await program.account.whitelistToken.fetch(wl);
      expect(data.enabled).to.be.false;
    });

    it("fails when non-admin tries to set whitelist token", async () => {
      const [wl] = wlPda(program.programId, usdcMint);

      await expectError(
        program.methods
          .setWhitelistToken(true)
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
            paymentMint: usdcMint,
            whitelistToken: wl,
            paymentVault: icoConfigUsdcAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );
    });
  });

  // ================================================================
  // 5. BUY
  // ================================================================

  describe("buy", () => {
    before(async () => {
      // Mint 1000 USDC to user
      const ata = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        user.publicKey
      );
      userUsdcAta = ata.address;
      await mintTo(
        provider.connection,
        payer,
        usdcMint,
        userUsdcAta,
        admin.publicKey,
        1_000 * 10 ** USDC_DECIMALS
      );

      // Mint 500 USDC to user2
      const ata2 = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdcMint,
        user2.publicKey
      );
      await mintTo(
        provider.connection,
        payer,
        usdcMint,
        ata2.address,
        admin.publicKey,
        500 * 10 ** USDC_DECIMALS
      );
    });

    it("buys tokens successfully and updates all state", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);

      const paymentAmount = new BN(30 * 10 ** USDC_DECIMALS); // 30 USDC

      // Expected tokens: 30 USDC * $1 / $0.003 = 10000 Token = 10_000_000_000 base
      const expectedTokens = new BN(10_000).mul(new BN(10 ** TOKEN_DECIMALS));

      const vaultBefore = await getAccount(
        provider.connection,
        icoConfigUsdcAta
      );

      await program.methods
        .buy(STAGE_1_ID, paymentAmount)
        .accounts({
          user: user.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          whitelistToken: wl,
          paymentMint: usdcMint,
          tokenMint: tokenMint,
          userPaymentAccount: userUsdcAta,
          paymentVault: icoConfigUsdcAta,
          userStagePurchase: pPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          priceUpdate: icoConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Verify purchase record
      const purchase = await program.account.userStagePurchase.fetch(pPda);
      expect(purchase.tokensBought.eq(expectedTokens)).to.be.true;
      expect(purchase.tokensClaimed.toNumber()).to.equal(0);
      expect(purchase.user.toBase58()).to.equal(user.publicKey.toBase58());
      expect(purchase.stageId).to.equal(STAGE_1_ID);

      // Verify stage tokens_sold updated
      const stage = await program.account.stage.fetch(sPda);
      expect(stage.tokensSold.eq(expectedTokens)).to.be.true;

      // Verify payment vault received payment
      const vaultAfter = await getAccount(
        provider.connection,
        icoConfigUsdcAta
      );
      expect(
        Number(vaultAfter.amount) - Number(vaultBefore.amount)
      ).to.equal(paymentAmount.toNumber());

      // Verify total_raised_usd on config
      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.totalRaisedUsd.toNumber()).to.equal(30 * 10 ** 6); // $30
    });

    it("accumulates on repeated purchases by the same user", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);

      const purchaseBefore = await program.account.userStagePurchase.fetch(pPda);
      const paymentAmount = new BN(15 * 10 ** USDC_DECIMALS); // 15 USDC
      const expectedAddedTokens = new BN(5_000).mul(
        new BN(10 ** TOKEN_DECIMALS)
      );

      await program.methods
        .buy(STAGE_1_ID, paymentAmount)
        .accounts({
          user: user.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          whitelistToken: wl,
          paymentMint: usdcMint,
          tokenMint: tokenMint,
          userPaymentAccount: userUsdcAta,
          paymentVault: icoConfigUsdcAta,
          userStagePurchase: pPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          priceUpdate: icoConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const purchaseAfter = await program.account.userStagePurchase.fetch(pPda);
      expect(
        purchaseAfter.tokensBought.sub(purchaseBefore.tokensBought).eq(expectedAddedTokens)
      ).to.be.true;
    });

    it("a different user can also buy from the same stage", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(
        program.programId,
        user2.publicKey,
        STAGE_1_ID
      );

      const user2UsdcAta = await getAssociatedTokenAddress(
        usdcMint,
        user2.publicKey
      );
      const paymentAmount = new BN(10 * 10 ** USDC_DECIMALS);

      await program.methods
        .buy(STAGE_1_ID, paymentAmount)
        .accounts({
          user: user2.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          whitelistToken: wl,
          paymentMint: usdcMint,
          tokenMint: tokenMint,
          userPaymentAccount: user2UsdcAta,
          paymentVault: icoConfigUsdcAta,
          userStagePurchase: pPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          priceUpdate: icoConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      const purchase = await program.account.userStagePurchase.fetch(pPda);
      expect(purchase.tokensBought.toNumber()).to.be.greaterThan(0);
      expect(purchase.user.toBase58()).to.equal(user2.publicKey.toBase58());
    });

    it("fails when payment_amount is zero (ZeroAmount)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);

      await expectError(
        program.methods
          .buy(STAGE_1_ID, new BN(0))
          .accounts({
            user: user.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            whitelistToken: wl,
            paymentMint: usdcMint,
            tokenMint: tokenMint,
            userPaymentAccount: userUsdcAta,
            paymentVault: icoConfigUsdcAta,
            userStagePurchase: pPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            priceUpdate: icoConfigPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc(),
        "ZeroAmount"
      );
    });

    it("fails when stage is not active (StageNotActive)", async () => {
      // Deactivate stage 1 temporarily
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      await program.methods
        .setStageActive(STAGE_1_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);

      await expectError(
        program.methods
          .buy(STAGE_1_ID, new BN(10 * 10 ** USDC_DECIMALS))
          .accounts({
            user: user.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            whitelistToken: wl,
            paymentMint: usdcMint,
            tokenMint: tokenMint,
            userPaymentAccount: userUsdcAta,
            paymentVault: icoConfigUsdcAta,
            userStagePurchase: pPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            priceUpdate: icoConfigPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc(),
        "StageNotActive"
      );

      // Re-activate stage 1
      await program.methods
        .setStageActive(STAGE_1_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();
    });

    it("fails when payment token is disabled (TokenNotWhitelisted)", async () => {
      // USDT was disabled earlier in set_whitelist_token tests
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [wl] = wlPda(program.programId, usdtMint);

      // Create user USDT ATA and mint some
      const userUsdtAta = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        usdtMint,
        user.publicKey
      );
      await mintTo(
        provider.connection,
        payer,
        usdtMint,
        userUsdtAta.address,
        admin.publicKey,
        100 * 10 ** USDT_DECIMALS
      );

      // Payment vault for USDT (created during whitelist setup)
      const usdtVault = await getAssociatedTokenAddress(usdtMint, icoConfigPda, true);

      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);

      await expectError(
        program.methods
          .buy(STAGE_1_ID, new BN(10 * 10 ** USDT_DECIMALS))
          .accounts({
            user: user.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            whitelistToken: wl,
            paymentMint: usdtMint,
            tokenMint: tokenMint,
            userPaymentAccount: userUsdtAta.address,
            paymentVault: usdtVault,
            userStagePurchase: pPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            priceUpdate: icoConfigPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc(),
        "TokenNotWhitelisted"
      );
    });

    it("fails when purchase exceeds remaining stage supply (ExceedsStageSupply)", async () => {
      // Create a tiny stage 3 with only 1 token (1_000_000 base units) remaining
      const TINY_STAGE_ID = 3;
      const [tinyPda] = stagePda(program.programId, TINY_STAGE_ID);

      await program.methods
        .createStage(TINY_STAGE_ID, new BN(1_000_000), new BN(1_000_000), new BN(0), new BN(0)) // $1 per token, 1 token total
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: tinyPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      // Deactivate stage 1, activate tiny stage
      const [s1Pda] = stagePda(program.programId, STAGE_1_ID);
      await program.methods
        .setStageActive(STAGE_1_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: s1Pda,
        })
        .rpc();

      await program.methods
        .setStageActive(TINY_STAGE_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: tinyPda,
        })
        .rpc();

      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(
        program.programId,
        user.publicKey,
        TINY_STAGE_ID
      );

      // Try to buy 10 USDC worth = 10 tokens, but only 1 token available
      await expectError(
        program.methods
          .buy(TINY_STAGE_ID, new BN(10 * 10 ** USDC_DECIMALS))
          .accounts({
            user: user.publicKey,
            icoConfig: icoConfigPda,
            stage: tinyPda,
            whitelistToken: wl,
            paymentMint: usdcMint,
            tokenMint: tokenMint,
            userPaymentAccount: userUsdcAta,
            paymentVault: icoConfigUsdcAta,
            userStagePurchase: pPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            priceUpdate: icoConfigPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc(),
        "ExceedsStageSupply"
      );

      // Cleanup: deactivate tiny stage, re-activate stage 1
      await program.methods
        .setStageActive(TINY_STAGE_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: tinyPda,
        })
        .rpc();

      await program.methods
        .setStageActive(STAGE_1_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: s1Pda,
        })
        .rpc();
    });


  });

  // ================================================================
  // 6. ENABLE STAGE CLAIM
  // ================================================================

  describe("enable_stage_claim", () => {
    it("enables claim for stage 1", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await program.methods
        .enableStageClaim(STAGE_1_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      const stage = await program.account.stage.fetch(sPda);
      expect(stage.claimEnabled).to.be.true;
    });

    it("can disable and re-enable claim", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await program.methods
        .enableStageClaim(STAGE_1_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      let stage = await program.account.stage.fetch(sPda);
      expect(stage.claimEnabled).to.be.false;

      // Re-enable for claim tests
      await program.methods
        .enableStageClaim(STAGE_1_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      stage = await program.account.stage.fetch(sPda);
      expect(stage.claimEnabled).to.be.true;
    });

    it("fails when non-admin tries to enable claim", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await expectError(
        program.methods
          .enableStageClaim(STAGE_1_ID, true)
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );
    });
  });

  // ================================================================
  // 7. CLAIM
  // ================================================================

  describe("claim", () => {
    it("user claims all purchased tokens from stage 1", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);

      const purchaseBefore = await program.account.userStagePurchase.fetch(pPda);
      const expectedClaim = purchaseBefore.tokensBought.sub(
        purchaseBefore.tokensClaimed
      );

      const userTokenAta = await getAssociatedTokenAddress(
        tokenMint,
        user.publicKey
      );

      await program.methods
        .claim(STAGE_1_ID)
        .accounts({
          user: user.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          userStagePurchase: pPda,
          tokenMint: tokenMint,
          vault: vaultAta,
          userTokenAccount: userTokenAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Verify tokens_claimed == tokens_bought
      const purchaseAfter = await program.account.userStagePurchase.fetch(pPda);
      expect(purchaseAfter.tokensClaimed.eq(purchaseAfter.tokensBought)).to.be
        .true;

      // Verify user received tokens
      const userTokenAcct = await getAccount(
        provider.connection,
        userTokenAta
      );
      expect(Number(userTokenAcct.amount)).to.equal(
        expectedClaim.toNumber()
      );
    });

    it("user2 claims tokens from stage 1", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [pPda] = purchasePda(
        program.programId,
        user2.publicKey,
        STAGE_1_ID
      );

      const user2TokenAta = await getAssociatedTokenAddress(
        tokenMint,
        user2.publicKey
      );

      await program.methods
        .claim(STAGE_1_ID)
        .accounts({
          user: user2.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          userStagePurchase: pPda,
          tokenMint: tokenMint,
          vault: vaultAta,
          userTokenAccount: user2TokenAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      const purchase = await program.account.userStagePurchase.fetch(pPda);
      expect(purchase.tokensClaimed.eq(purchase.tokensBought)).to.be.true;
    });

    it("fails to claim again when nothing left (NothingToClaim)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);
      const userTokenAta = await getAssociatedTokenAddress(
        tokenMint,
        user.publicKey
      );

      await expectError(
        program.methods
          .claim(STAGE_1_ID)
          .accounts({
            user: user.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            userStagePurchase: pPda,
            tokenMint: tokenMint,
            vault: vaultAta,
            userTokenAccount: userTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc(),
        "NothingToClaim"
      );
    });

    it("fails when claim is not enabled for stage (ClaimNotEnabled)", async () => {
      // Disable claim for stage 2
      const [s2Pda] = stagePda(program.programId, STAGE_2_ID);

      // First buy something in stage 2 so user has a purchase record
      // Activate stage 2
      const [s1Pda] = stagePda(program.programId, STAGE_1_ID);
      await program.methods
        .setStageActive(STAGE_1_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: s1Pda,
        })
        .rpc();
      await program.methods
        .setStageActive(STAGE_2_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: s2Pda,
        })
        .rpc();

      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(
        program.programId,
        user.publicKey,
        STAGE_2_ID
      );

      await program.methods
        .buy(STAGE_2_ID, new BN(5 * 10 ** USDC_DECIMALS))
        .accounts({
          user: user.publicKey,
          icoConfig: icoConfigPda,
          stage: s2Pda,
          whitelistToken: wl,
          paymentMint: usdcMint,
          tokenMint: tokenMint,
          userPaymentAccount: userUsdcAta,
          paymentVault: icoConfigUsdcAta,
          userStagePurchase: pPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          priceUpdate: icoConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Try to claim stage 2 (claim_enabled = false by default)
      const userTokenAta = await getAssociatedTokenAddress(
        tokenMint,
        user.publicKey
      );

      await expectError(
        program.methods
          .claim(STAGE_2_ID)
          .accounts({
            user: user.publicKey,
            icoConfig: icoConfigPda,
            stage: s2Pda,
            userStagePurchase: pPda,
            tokenMint: tokenMint,
            vault: vaultAta,
            userTokenAccount: userTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc(),
        "ClaimNotEnabled"
      );

      // Cleanup: deactivate stage 2, re-enable stage 1
      await program.methods
        .setStageActive(STAGE_2_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: s2Pda,
        })
        .rpc();
      await program.methods
        .setStageActive(STAGE_1_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: s1Pda,
        })
        .rpc();
    });

    it("partial claim works: buy more after claiming, then claim again", async () => {
      // User already claimed all tokens. Buy more, then claim the new ones.
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);

      const purchaseBefore = await program.account.userStagePurchase.fetch(pPda);
      const paymentAmount = new BN(6 * 10 ** USDC_DECIMALS); // 6 USDC
      const expectedAdded = new BN(2_000).mul(new BN(10 ** TOKEN_DECIMALS));

      await program.methods
        .buy(STAGE_1_ID, paymentAmount)
        .accounts({
          user: user.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          whitelistToken: wl,
          paymentMint: usdcMint,
          tokenMint: tokenMint,
          userPaymentAccount: userUsdcAta,
          paymentVault: icoConfigUsdcAta,
          userStagePurchase: pPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          priceUpdate: icoConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Now claim the new purchase
      const userTokenAta = await getAssociatedTokenAddress(
        tokenMint,
        user.publicKey
      );
      const tokenBalBefore = await getAccount(
        provider.connection,
        userTokenAta
      );

      await program.methods
        .claim(STAGE_1_ID)
        .accounts({
          user: user.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
          userStagePurchase: pPda,
          tokenMint: tokenMint,
          vault: vaultAta,
          userTokenAccount: userTokenAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const tokenBalAfter = await getAccount(
        provider.connection,
        userTokenAta
      );
      expect(
        Number(tokenBalAfter.amount) - Number(tokenBalBefore.amount)
      ).to.equal(expectedAdded.toNumber());

      const purchaseAfter = await program.account.userStagePurchase.fetch(pPda);
      expect(purchaseAfter.tokensClaimed.eq(purchaseAfter.tokensBought)).to.be
        .true;
    });
  });

  // ================================================================
  // 8. EMERGENCY WITHDRAW
  // ================================================================

  describe("emergency_withdraw", () => {
    it("admin withdraws tokens from vault", async () => {
      const adminTokenAtaAcct = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        tokenMint,
        admin.publicKey
      );
      const adminTokenAta = adminTokenAtaAcct.address;
      const vaultBefore = await getAccount(provider.connection, vaultAta);
      const adminBefore = await getAccount(provider.connection, adminTokenAta);
      const withdrawAmount = new BN(1_000_000); // 1 token

      await program.methods
        .emergencyWithdraw(withdrawAmount)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          tokenMint: tokenMint,
          vault: vaultAta,
          adminTokenAccount: adminTokenAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const vaultAfter = await getAccount(provider.connection, vaultAta);
      expect(
        Number(vaultBefore.amount) - Number(vaultAfter.amount)
      ).to.equal(withdrawAmount.toNumber());

      const adminAfter = await getAccount(provider.connection, adminTokenAta);
      expect(
        Number(adminAfter.amount) - Number(adminBefore.amount)
      ).to.equal(withdrawAmount.toNumber());
    });

    it("fails when non-admin tries emergency withdraw (Unauthorized)", async () => {
      const nonadminTokenAta = await getAssociatedTokenAddress(
        tokenMint,
        nonAdmin.publicKey
      );

      await expectError(
        program.methods
          .emergencyWithdraw(new BN(1_000_000))
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
            tokenMint: tokenMint,
            vault: vaultAta,
            adminTokenAccount: nonadminTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );
    });

    it("fails when amount is zero (ZeroAmount)", async () => {
      const adminTokenAta = await getAssociatedTokenAddress(
        tokenMint,
        admin.publicKey
      );

      await expectError(
        program.methods
          .emergencyWithdraw(new BN(0))
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            tokenMint: tokenMint,
            vault: vaultAta,
            adminTokenAccount: adminTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
        "ZeroAmount"
      );
    });
  });

  // ================================================================
  // 9. TRANSFER ADMIN
  // ================================================================

  describe("transfer_admin", () => {
    it("admin transfers role to a new admin", async () => {
      await program.methods
        .transferAdmin(user.publicKey)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
        })
        .rpc();

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.admin.toBase58()).to.equal(user.publicKey.toBase58());
    });

    it("fails when non-admin tries to transfer (Unauthorized)", async () => {
      await expectError(
        program.methods
          .transferAdmin(nonAdmin.publicKey)
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
          })
          .rpc(),
        "Unauthorized"
      );
    });

    // Transfer admin back to original admin for remaining tests
    it("transfers admin back to original admin", async () => {
      // user is now admin — transfer back to original admin
      await program.methods
        .transferAdmin(admin.publicKey)
        .accounts({
          admin: user.publicKey,
          icoConfig: icoConfigPda,
        })
        .signers([user])
        .rpc();

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    });
  });

  // ================================================================
  // 11. EMERGENCY WITHDRAW SOL
  // ================================================================

  describe("emergency_withdraw_sol", () => {
    it("admin withdraws SOL from ico_config PDA", async () => {
      // First, send some SOL to ico_config PDA to simulate collected payments
      const transferSig = await provider.connection.requestAirdrop(
        icoConfigPda,
        1 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(transferSig);

      const pdaBalBefore = await provider.connection.getBalance(icoConfigPda);
      const adminBalBefore = await provider.connection.getBalance(admin.publicKey);
      const withdrawAmount = new BN(500_000_000); // 0.5 SOL

      await program.methods
        .emergencyWithdrawSol(withdrawAmount)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
        })
        .rpc();

      const pdaBalAfter = await provider.connection.getBalance(icoConfigPda);
      expect(pdaBalBefore - pdaBalAfter).to.equal(withdrawAmount.toNumber());
    });

    it("fails when non-admin tries to withdraw SOL (Unauthorized)", async () => {
      await expectError(
        program.methods
          .emergencyWithdrawSol(new BN(100_000))
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );
    });

    it("fails when amount is zero (ZeroAmount)", async () => {
      await expectError(
        program.methods
          .emergencyWithdrawSol(new BN(0))
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
          })
          .rpc(),
        "ZeroAmount"
      );
    });
  });

  // ================================================================
  // 12. TOGGLE PAUSE
  // ================================================================

  describe("toggle_pause", () => {
    it("admin pauses the contract", async () => {
      await program.methods
        .togglePause(true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
        })
        .rpc();

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.paused).to.be.true;
    });

    it("buy fails when contract is paused (ContractPaused)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      const [wl] = wlPda(program.programId, usdcMint);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_1_ID);

      await expectError(
        program.methods
          .buy(STAGE_1_ID, new BN(1 * 10 ** USDC_DECIMALS))
          .accounts({
            user: user.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            whitelistToken: wl,
            paymentMint: usdcMint,
            tokenMint: tokenMint,
            userPaymentAccount: userUsdcAta,
            paymentVault: icoConfigUsdcAta,
            userStagePurchase: pPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            priceUpdate: icoConfigPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc(),
        "ContractPaused"
      );
    });

    it("claim fails when contract is paused (ContractPaused)", async () => {
      // user has unclaimed in stage 2
      const [sPda] = stagePda(program.programId, STAGE_2_ID);
      const [pPda] = purchasePda(program.programId, user.publicKey, STAGE_2_ID);
      const userTokenAta = await getAssociatedTokenAddress(
        tokenMint,
        user.publicKey
      );

      // Enable claim on stage 2 for this test
      await program.methods
        .enableStageClaim(STAGE_2_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      await expectError(
        program.methods
          .claim(STAGE_2_ID)
          .accounts({
            user: user.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
            userStagePurchase: pPda,
            tokenMint: tokenMint,
            vault: vaultAta,
            userTokenAccount: userTokenAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc(),
        "ContractPaused"
      );

      // Disable claim on stage 2 again
      await program.methods
        .enableStageClaim(STAGE_2_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();
    });

    it("fails when non-admin tries to toggle pause (Unauthorized)", async () => {
      await expectError(
        program.methods
          .togglePause(false)
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );
    });

    it("admin unpauses the contract", async () => {
      await program.methods
        .togglePause(false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
        })
        .rpc();

      const cfg = await program.account.icoConfig.fetch(icoConfigPda);
      expect(cfg.paused).to.be.false;
    });
  });

  // ================================================================
  // 13. UPDATE STAGE
  // ================================================================

  describe("update_stage", () => {
    it("fails when stage is active (StageIsActive)", async () => {
      // Stage 1 is active
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await expectError(
        program.methods
          .updateStage(STAGE_1_ID, new BN(4_000), STAGE_1_TOKENS, new BN(0), new BN(0))
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .rpc(),
        "StageIsActive"
      );
    });

    it("updates an inactive stage price and total", async () => {
      // Stage 2 is inactive
      const [sPda] = stagePda(program.programId, STAGE_2_ID);
      const stageBefore = await program.account.stage.fetch(sPda);

      const newPrice = new BN(6_000); // $0.006
      const newTotal = new BN(60_000_000).mul(new BN(1_000_000)); // 60M

      await program.methods
        .updateStage(STAGE_2_ID, newPrice, newTotal, new BN(0), new BN(0))
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      const stageAfter = await program.account.stage.fetch(sPda);
      expect(stageAfter.tokenPriceUsd.toNumber()).to.equal(6_000);
      expect(stageAfter.tokensTotal.eq(newTotal)).to.be.true;
      // tokens_sold unchanged
      expect(stageAfter.tokensSold.eq(stageBefore.tokensSold)).to.be.true;
    });

    it("fails when tokens_total < tokens_sold (InvalidTokensTotal)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_2_ID);
      const stage = await program.account.stage.fetch(sPda);

      // Try to set total below tokens_sold
      const tooSmall = stage.tokensSold.sub(new BN(1));

      await expectError(
        program.methods
          .updateStage(STAGE_2_ID, new BN(6_000), tooSmall, new BN(0), new BN(0))
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .rpc(),
        "InvalidTokensTotal"
      );
    });

    it("fails when price is zero (ZeroAmount)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_2_ID);

      await expectError(
        program.methods
          .updateStage(STAGE_2_ID, new BN(0), STAGE_2_TOKENS, new BN(0), new BN(0))
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .rpc(),
        "ZeroAmount"
      );
    });

    it("fails when non-admin tries update (Unauthorized)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_2_ID);

      await expectError(
        program.methods
          .updateStage(STAGE_2_ID, new BN(6_000), STAGE_2_TOKENS, new BN(0), new BN(0))
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );
    });

    // Restore stage 2 to original price for subsequent tests
    it("restores stage 2 to original values", async () => {
      const [sPda] = stagePda(program.programId, STAGE_2_ID);

      await program.methods
        .updateStage(STAGE_2_ID, STAGE_2_PRICE, STAGE_2_TOKENS, new BN(0), new BN(0))
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      const stage = await program.account.stage.fetch(sPda);
      expect(stage.tokenPriceUsd.eq(STAGE_2_PRICE)).to.be.true;
      expect(stage.tokensTotal.eq(STAGE_2_TOKENS)).to.be.true;
    });
  });

  // ================================================================
  // 14. CLOSE ACCOUNTS
  // ================================================================

  describe("close_account", () => {
    // --- close_user_purchase ---
    it("fails to close user purchase when not settled (PurchaseNotSettled)", async () => {
      // user has unclaimed tokens in stage 2
      const [pPda] = purchasePda(
        program.programId,
        user.publicKey,
        STAGE_2_ID
      );

      await expectError(
        program.methods
          .closeUserPurchase(STAGE_2_ID)
          .accounts({
            user: user.publicKey,
            userStagePurchase: pPda,
          })
          .signers([user])
          .rpc(),
        "PurchaseNotSettled"
      );
    });

    it("closes fully-claimed user purchase (stage 1)", async () => {
      // user already claimed all from stage 1 — tokens_bought == tokens_claimed
      const [pPda] = purchasePda(
        program.programId,
        user.publicKey,
        STAGE_1_ID
      );

      await program.methods
        .closeUserPurchase(STAGE_1_ID)
        .accounts({
          user: user.publicKey,
          userStagePurchase: pPda,
        })
        .signers([user])
        .rpc();

      // Account should not exist anymore
      const acct = await provider.connection.getAccountInfo(pPda);
      expect(acct).to.be.null;
    });

    // --- close_whitelist_token ---
    it("fails to close enabled whitelist token (TokenStillEnabled)", async () => {
      const [wl] = wlPda(program.programId, usdcMint);

      await expectError(
        program.methods
          .closeWhitelistToken()
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            whitelistToken: wl,
          })
          .rpc(),
        "TokenStillEnabled"
      );
    });

    it("closes disabled whitelist token (USDT)", async () => {
      // USDT was disabled earlier
      const [wl] = wlPda(program.programId, usdtMint);

      await program.methods
        .closeWhitelistToken()
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          whitelistToken: wl,
        })
        .rpc();

      const acct = await provider.connection.getAccountInfo(wl);
      expect(acct).to.be.null;
    });

    // --- close_stage ---
    it("fails to close active stage (StageIsActive)", async () => {
      const [sPda] = stagePda(program.programId, STAGE_1_ID);

      await expectError(
        program.methods
          .closeStage(STAGE_1_ID)
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .rpc(),
        "StageIsActive"
      );
    });

    it("fails to close stage with claim enabled (StageNotSettled)", async () => {
      // Stage 1 has claim_enabled=true
      // First deactivate it
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      await program.methods
        .setStageActive(STAGE_1_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      await expectError(
        program.methods
          .closeStage(STAGE_1_ID)
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .rpc(),
        "StageNotSettled"
      );
    });

    it("fails to close stage with outstanding unclaimed tokens (UnclaimedTokensRemaining)", async () => {
      // Stage 2: inactive, claim_enabled=false, but user bought and never claimed.
      // tokens_claimed_total (0) != tokens_sold (>0) → guard fires.
      const [sPda] = stagePda(program.programId, STAGE_2_ID);

      await expectError(
        program.methods
          .closeStage(STAGE_2_ID)
          .accounts({
            admin: admin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .rpc(),
        "UnclaimedTokensRemaining"
      );
    });

    it("closes a settled stage (stage 3 — inactive, no claim)", async () => {
      // Stage 3 (TINY_STAGE_ID): inactive, claim_enabled=false
      const TINY_STAGE_ID = 3;
      const [sPda] = stagePda(program.programId, TINY_STAGE_ID);

      await program.methods
        .closeStage(TINY_STAGE_ID)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      const acct = await provider.connection.getAccountInfo(sPda);
      expect(acct).to.be.null;
    });

    it("fails when non-admin tries to close stage (Unauthorized)", async () => {
      // Disable claim on stage 1 so it's settled (inactive, no claim)
      const [sPda] = stagePda(program.programId, STAGE_1_ID);
      await program.methods
        .enableStageClaim(STAGE_1_ID, false)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();

      await expectError(
        program.methods
          .closeStage(STAGE_1_ID)
          .accounts({
            admin: nonAdmin.publicKey,
            icoConfig: icoConfigPda,
            stage: sPda,
          })
          .signers([nonAdmin])
          .rpc(),
        "Unauthorized"
      );

      // Re-enable claim for stage 1 in case needed later
      await program.methods
        .enableStageClaim(STAGE_1_ID, true)
        .accounts({
          admin: admin.publicKey,
          icoConfig: icoConfigPda,
          stage: sPda,
        })
        .rpc();
    });
  });
});
