import { expect } from "chai";
import { bootstrap, createMarket, trader, refresh, bookSide, SIDE_BID, SIDE_ASK } from "./lib/harness";

describe("smoke", () => {
  it("boots, creates a market and quotes it", async () => {
    const env = await bootstrap();
    const mk = await createMarket(env);
    await trader(env, mk);
    await refresh(env, mk, "refresh_quotes");
    const m = env.market(mk);
    console.log(bookSide(m, SIDE_BID).map((o) => `${o.tick}x${o.qty}`), bookSide(m, SIDE_ASK).map((o) => `${o.tick}x${o.qty}`));
    console.log(env.cuLog);
    expect(bookSide(m, SIDE_BID).length).to.be.greaterThan(0);
  });
});
