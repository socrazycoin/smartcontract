import { createProvider, getProgram, deriveStage } from "../app/helpers";

async function main() {
  const provider = createProvider();
  const program = getProgram(provider);
  const [pda] = deriveStage(program.programId, 1);

  console.log("PDA:", pda.toBase58());
  console.log("Program ID:", program.programId.toBase58());

  try {
    const stage = await program.account.stage.fetch(pda);
    console.log("Stage fetched OK:", JSON.stringify(stage, null, 2));
  } catch (err: any) {
    console.log("Fetch error:", err.message);

    // Try raw decode
    const info = await provider.connection.getAccountInfo(pda);
    if (info) {
      console.log("\nRaw data hex:", info.data.toString("hex"));
      console.log("Owner:", info.owner.toBase58());
      console.log("Expected owner:", program.programId.toBase58());
      console.log("Owner match:", info.owner.equals(program.programId));
    }
  }
}

main().catch(console.error);
