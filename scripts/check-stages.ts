import { createProvider, getProgram, deriveStage } from "../app/helpers";

async function main() {
  const provider = createProvider();
  const program = getProgram(provider);

  for (let i = 0; i <= 5; i++) {
    const [pda] = deriveStage(program.programId, i);
    const info = await provider.connection.getAccountInfo(pda);
    console.log(
      `Stage ${i}: PDA=${pda.toBase58()} exists=${!!info}${info ? " len=" + info.data.length + " owner=" + info.owner.toBase58() : ""}`
    );
  }
}

main().catch(console.error);
