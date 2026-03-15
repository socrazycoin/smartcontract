/**
 * close-user-purchase.ts — Close a fully settled user purchase account to reclaim rent.
 *
 * Usage:
 *   npx ts-node app/close-user-purchase.ts <stage_id>
 *
 * Example:
 *   npx ts-node app/close-user-purchase.ts 1
 *
 * Note: tokens_bought must equal tokens_claimed (fully claimed).
 */
import {
  createProvider,
  getProgram,
  loadKeypair,
  deriveUserStagePurchase,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: close-user-purchase.ts <stage_id>");
    process.exit(1);
  }

  const stageId = parseInt(args[0]);

  const userKp = loadKeypair(process.env.USER_KEYPAIR);
  const provider = createProvider(userKp);
  const program = getProgram(provider);

  const [purchasePda] = deriveUserStagePurchase(
    program.programId,
    userKp.publicKey,
    stageId
  );

  console.log(`Closing purchase account for stage ${stageId}...`);
  console.log(`  User: ${userKp.publicKey.toBase58()}`);

  const tx = await program.methods
    .closeUserPurchase(stageId)
    .accounts({
      user: userKp.publicKey,
      userStagePurchase: purchasePda,
    })
    .rpc();

  console.log(`\nPurchase account closed. Rent reclaimed. tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
