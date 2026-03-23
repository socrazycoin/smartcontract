/**
 * read-stage.ts — Fetch and display a Stage account.
 *
 * Usage:
 *   npx ts-node app/read-stage.ts <stage_id>
 *   npx ts-node app/read-stage.ts all          # list all stages
 *
 * Examples:
 *   npx ts-node app/read-stage.ts 0
 *   npx ts-node app/read-stage.ts all
 */
import BN from "bn.js";
import {
  createProvider,
  getProgram,
  deriveIcoConfig,
  deriveStage,
} from "./helpers";

function toBN(val: any): BN {
  if (BN.isBN(val)) return val;
  return new BN(val.toString());
}

function printStage(stage: any) {
  const total = toBN(stage.tokensTotal);
  const sold = toBN(stage.tokensSold);
  const price = toBN(stage.tokenPriceUsd);
  const totalRaised = toBN(stage.totalRaisedUsd);
  const startTime = toBN(stage.startTime);
  const endTime = toBN(stage.endTime);
  const remaining = total.sub(sold);

  let pctSold = "0.00";
  if (!total.isZero()) {
    // Use BN arithmetic: sold * 10000 / total → basis points → divide by 100
    const bps = sold.mul(new BN(10000)).div(total).toNumber();
    pctSold = (bps / 100).toFixed(2);
  }

  const fmtTime = (t: BN) => {
    if (t.isZero()) return "(no restriction)";
    return new Date(t.toNumber() * 1000).toISOString();
  };

  console.log(`=== Stage ${stage.stageId} ===`);
  console.log(`  Price (USD):      $${(price.toNumber() / 1_000_000).toFixed(6)}`);
  console.log(`  Tokens Total:     ${total.toString()}`);
  console.log(`  Tokens Sold:      ${sold.toString()} (${pctSold}%)`);
  console.log(`  Remaining:        ${remaining.toString()}`);
  console.log(`  Total Raised USD: $${(totalRaised.toNumber() / 1_000_000).toFixed(6)}`);
  console.log(`  Start Time:       ${fmtTime(startTime)}`);
  console.log(`  End Time:         ${fmtTime(endTime)}`);
  console.log(`  Active:           ${stage.isActive}`);
  console.log(`  Claim Enabled:    ${stage.claimEnabled}`);
  console.log(`  Claimed Total:    ${toBN(stage.tokensClaimedTotal).toString()}`);
  console.log(`  Bump:             ${stage.bump}`);
  console.log();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: read-stage.ts <stage_id | all>");
    process.exit(1);
  }

  const provider = createProvider();
  const program = getProgram(provider);

  if (args[0] === "all") {
    const [icoConfigPda] = deriveIcoConfig(program.programId);
    const config = await program.account.icoConfig.fetch(icoConfigPda);

    console.log(`Scanning stages (stage_count = ${config.stageCount})...\n`);

    let found = 0;
    for (let i = 0; i < 256; i++) {
      try {
        const [stagePda] = deriveStage(program.programId, i);
        const stage = await program.account.stage.fetch(stagePda);
        printStage(stage);
        found++;
      } catch (e: any) {
        // stage doesn't exist at this ID — skip
        if (!e.message?.includes('Account does not exist')) {
          console.error(`Stage ${i} decode error:`, e.message);
        }
      }
      if (found >= config.stageCount) break;
    }

    if (found === 0) {
      console.log("No stages found.");
    }
  } else {
    const stageId = parseInt(args[0]);
    const [stagePda] = deriveStage(program.programId, stageId);

    try {
      const stage = await program.account.stage.fetch(stagePda);
      console.log(`PDA: ${stagePda.toBase58()}\n`);
      printStage(stage);
    } catch (err: any) {
      console.error(`Stage ${stageId} error:`, err.message);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
