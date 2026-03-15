/**
 * deploy.ts — Deploy the ICO contract to the configured cluster.
 *
 * Usage:
 *   npx ts-node app/deploy.ts
 *
 * Prerequisites:
 *   1. `anchor build` has been run (produces target/deploy/contract.so)
 *   2. .env is configured with ADMIN_KEYPAIR and CLUSTER_URL
 *
 * Steps:
 *   1. Write buffer with priority fee + retry logic
 *   2. Deploy from buffer
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
  const keypairFlag = `--keypair ${process.env.ADMIN_KEYPAIR || "~/.config/solana/id.json"}`;
  const programKpPath = path.resolve(
    __dirname,
    "../target/deploy/contract-keypair.json"
  );
  const programSoPath = path.resolve(
    __dirname,
    "../target/deploy/contract.so"
  );

  console.log("=== ICO Contract Deployment ===");
  console.log(`Cluster:  ${clusterUrl}`);
  console.log(`Deployer: ${admin.publicKey.toBase58()}`);
  console.log(`Program:  ${getProgramId().toBase58()}`);
  console.log();

  // Build first
  console.log("Building program...");
  execSync("anchor build", { stdio: "inherit", cwd: path.resolve(__dirname, "..") });

  // Step 1: Write buffer (with priority fee for mainnet reliability)
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
    // Parse buffer address from output: "Buffer: <address>"
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

  // Step 2: Deploy from buffer
  console.log("\nStep 2: Deploying from buffer...");
  try {
    const deployCmd = [
      "solana program deploy",
      `--url ${clusterUrl}`,
      keypairFlag,
      `--program-id ${programKpPath}`,
      `--buffer ${bufferAddress}`,
      "--with-compute-unit-price 50000",
      "--max-sign-attempts 50",
      "--use-rpc",
    ].join(" ");

    execSync(deployCmd, { stdio: "inherit" });
  } catch (err: any) {
    console.error("\n!!! Deploy from buffer failed !!!");
    console.error(`Buffer is still alive at: ${bufferAddress}`);
    console.error("You can retry deploy with:");
    console.error(`  solana program deploy --url ${clusterUrl} ${keypairFlag} --program-id ${programKpPath} --buffer ${bufferAddress}`);
    console.error("Or close the buffer to reclaim SOL:");
    console.error(`  solana program close ${bufferAddress} ${keypairFlag} --url ${clusterUrl}`);
    throw err;
  }

  console.log("\n=== Deployment complete ===");
  console.log(`Program ID: ${getProgramId().toBase58()}`);
}

main().catch((err) => {
  console.error("\nDeployment failed:", err.message || err);
  process.exit(1);
});
