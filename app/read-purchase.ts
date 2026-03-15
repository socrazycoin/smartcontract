/**
 * read-purchase.ts — Fetch and display a UserStagePurchase account.
 *
 * Usage:
 *   npx ts-node app/read-purchase.ts <user_pubkey> <stage_id>
 *   npx ts-node app/read-purchase.ts <user_pubkey> all     # all stages for a user
 *
 * Examples:
 *   npx ts-node app/read-purchase.ts 5Xc7...abc 0
 *   npx ts-node app/read-purchase.ts 5Xc7...abc all
 *
 * If user_pubkey is "me", uses the loaded wallet keypair.
 */
import { PublicKey } from "@solana/web3.js";
import {
  createProvider,
  getProgram,
  loadKeypair,
  deriveIcoConfig,
  deriveUserStagePurchase,
} from "./helpers";

function printPurchase(purchase: any, pda: PublicKey) {
  const claimable = purchase.tokensBought.sub(purchase.tokensClaimed);

  console.log(`=== Purchase: Stage ${purchase.stageId} ===`);
  console.log(`  PDA:            ${pda.toBase58()}`);
  console.log(`  User:           ${purchase.user.toBase58()}`);
  console.log(`  Tokens Bought:  ${purchase.tokensBought.toString()}`);
  console.log(`  Tokens Claimed: ${purchase.tokensClaimed.toString()}`);
  console.log(`  Claimable:      ${claimable.toString()}`);
  console.log(`  Paid USD Value: $${(purchase.paidUsdValue.toNumber() / 1_000_000).toFixed(6)}`);
  console.log(`  Bump:           ${purchase.bump}`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log("Usage: read-purchase.ts <user_pubkey | me> <stage_id | all>");
    process.exit(1);
  }

  const provider = createProvider();
  const program = getProgram(provider);

  const userPubkey =
    args[0] === "me"
      ? loadKeypair().publicKey
      : new PublicKey(args[0]);

  if (args[1] === "all") {
    const [icoConfigPda] = deriveIcoConfig(program.programId);
    const config = await program.account.icoConfig.fetch(icoConfigPda);

    console.log(`User: ${userPubkey.toBase58()}`);
    console.log(`Scanning purchases across all stages...\n`);

    let found = 0;
    for (let i = 0; i < 256; i++) {
      try {
        const [purchasePda] = deriveUserStagePurchase(program.programId, userPubkey, i);
        const purchase = await program.account.userStagePurchase.fetch(purchasePda);
        printPurchase(purchase, purchasePda);
        found++;
      } catch {
        // no purchase for this stage
      }
    }

    if (found === 0) {
      console.log("No purchases found for this user.");
    } else {
      console.log(`Total: ${found} purchase record(s).`);
    }
  } else {
    const stageId = parseInt(args[1]);
    const [purchasePda] = deriveUserStagePurchase(program.programId, userPubkey, stageId);

    try {
      const purchase = await program.account.userStagePurchase.fetch(purchasePda);
      printPurchase(purchase, purchasePda);
    } catch (err: any) {
      console.error(`No purchase found for user ${userPubkey.toBase58()} in stage ${stageId}.`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
