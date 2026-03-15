/**
 * claim.ts — Claim purchased tokens from a stage.
 *
 * Usage:
 *   npx ts-node app/claim.ts <stage_id>
 *
 * Example:
 *   npx ts-node app/claim.ts 1
 */
import {
  createProvider,
  getProgram,
  loadKeypair,
  deriveIcoConfig,
  deriveStage,
  deriveUserStagePurchase,
} from "./helpers";

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: claim.ts <stage_id>");
    process.exit(1);
  }

  const stageId = parseInt(args[0]);
  const userKp = loadKeypair(process.env.USER_KEYPAIR);
  const provider = createProvider(userKp);
  const program = getProgram(provider);

  const [icoConfigPda] = deriveIcoConfig(program.programId);
  const config = await program.account.icoConfig.fetch(icoConfigPda);
  const tokenMint = config.tokenMint;

  const [stagePda] = deriveStage(program.programId, stageId);
  const [purchasePda] = deriveUserStagePurchase(
    program.programId,
    userKp.publicKey,
    stageId
  );

  const purchaseBefore = await program.account.userStagePurchase.fetch(purchasePda);
  const claimable = purchaseBefore.tokensBought.sub(purchaseBefore.tokensClaimed);

  console.log(`Claiming tokens from stage ${stageId}...`);
  console.log(`  User:      ${userKp.publicKey.toBase58()}`);
  console.log(`  Claimable: ${claimable.toString()}`);

  const tx = await program.methods
    .claim(stageId)
    .accounts({
      user: userKp.publicKey,
      stage: stagePda,
      userStagePurchase: purchasePda,
      tokenMint,
    })
    .rpc();

  console.log(`\nClaimed ${claimable.toString()} tokens! tx: ${tx}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
