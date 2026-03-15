/**
 * upgrade.ts — Upgrade the deployed ICO contract to a new version.
 *
 * Usage:
 *   npx ts-node app/upgrade.ts
 *
 * Prerequisites:
 *   1. The program is already deployed.
 *   2. `anchor build` produces the updated contract.so
 *   3. The admin wallet is the upgrade authority.
 *
 * Steps:
 *   1. Write buffer with priority fee + retry logic
 *   2. Deploy (upgrade) from buffer
 *   3. On failure, print recovery commands so SOL can be reclaimed
 */
import { execSync } from "child_process";
import * as path from "path";
import * as dotenv from "dotenv";
import { loadKeypair, getClusterUrl, getProgramId } from "./helpers";

dotenv.config();

async function main() {
  const clusterUrl = getClusterUrl();
  const admin = loadKeypair();
  const programId = getProgramId();
  const keypairFlag = `--keypair ${process.env.ADMIN_KEYPAIR || "~/.config/solana/id.json"}`;
  const programSoPath = path.resolve(
    __dirname,
    "../target/deploy/contract.so"
  );

  console.log("=== ICO Contract Upgrade ===");
  console.log(`Cluster:     ${clusterUrl}`);
  console.log(`Authority:   ${admin.publicKey.toBase58()}`);
  console.log(`Program ID:  ${programId.toBase58()}`);
  console.log();

  // Build
  console.log("Building program...");
  execSync("anchor build", { stdio: "inherit", cwd: path.resolve(__dirname, "..") });

  // Step 1: Write buffer
  console.log("\nStep 1: Writing program buffer...");
  let bufferAddress: string | null = null;
  try {
    const writeCmd = [
      "solana program write-buffer",
      `--url ${clusterUrl}`,
      keypairFlag,
      "--with-compute-unit-price 50000",
      "--max-sign-attempts 50",
      "--use-rpc",
      programSoPath,
    ].join(" ");

    const output = execSync(writeCmd, { encoding: "utf-8" });
    const match = output.match(/Buffer:\s+(\S+)/);
    if (match) {
      bufferAddress = match[1];
      console.log(`Buffer created: ${bufferAddress}`);
    } else {
      console.log(output);
      throw new Error("Could not parse buffer address from output");
    }
  } catch (err: any) {
    console.error("\n!!! Buffer write failed !!!");
    console.error("Check for orphaned buffers and reclaim SOL with:");
    console.error(`  solana program show --buffers ${keypairFlag} --url ${clusterUrl}`);
    console.error(`  solana program close --buffers ${keypairFlag} --url ${clusterUrl}`);
    throw err;
  }

  // Step 2: Upgrade from buffer
  console.log("\nStep 2: Upgrading program from buffer...");
  try {
    const upgradeCmd = [
      "solana program deploy",
      `--url ${clusterUrl}`,
      keypairFlag,
      `--program-id ${programId.toBase58()}`,
      `--buffer ${bufferAddress}`,
      "--with-compute-unit-price 50000",
      "--max-sign-attempts 50",
      "--use-rpc",
    ].join(" ");

    execSync(upgradeCmd, { stdio: "inherit" });
  } catch (err: any) {
    console.error("\n!!! Upgrade from buffer failed !!!");
    console.error(`Buffer is still alive at: ${bufferAddress}`);
    console.error("You can retry upgrade with:");
    console.error(`  solana program deploy --url ${clusterUrl} ${keypairFlag} --program-id ${programId.toBase58()} --buffer ${bufferAddress}`);
    console.error("Or close the buffer to reclaim SOL:");
    console.error(`  solana program close ${bufferAddress} ${keypairFlag} --url ${clusterUrl}`);
    throw err;
  }

  console.log("\n=== Upgrade complete ===");
  console.log(`Program ID: ${programId.toBase58()}`);
}

main().catch((err) => {
  console.error("\nUpgrade failed:", err.message || err);
  process.exit(1);
});
