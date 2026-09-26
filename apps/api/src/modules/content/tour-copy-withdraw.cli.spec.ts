import { describe, expect, it, jest } from "@jest/globals";

import { main, type WithdrawStore } from "./tour-copy-withdraw.cli";

function setup(options: { published?: number; withdrawn?: number; judged?: number; bad?: number } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const store: jest.Mocked<WithdrawStore> = {
    countByStatus: jest.fn(async (_pair, status) => (status === "published" ? options.published ?? 0 : options.withdrawn ?? 0)),
    judgedStats: jest.fn(async () => ({ judged: options.judged ?? 0, bad: options.bad ?? 0, leadsWithFact: 0 })),
    withdraw: jest.fn(async () => options.published ?? 0),
    restore: jest.fn(async () => options.withdrawn ?? 0),
  } as never;
  const disconnect = jest.fn(async () => undefined);
  const run = (args: string[]) =>
    main(args, {}, { out: (l) => out.push(l), err: (l) => err.push(l) }, { store, runId: () => "manual-run-1", disconnect });
  return { out, err, store, disconnect, run };
}

const PAIR_ARGS = ["--prompt-version", "4", "--model", "claude-sonnet-5"];
const PAIR = { promptVersion: 4, model: "claude-sonnet-5" };

describe("tour-copy-withdraw.cli (spec 0003 AC-10)", () => {
  describe("arguments", () => {
    it.each([
      [[], "Both --prompt-version and --model are required"],
      [["--prompt-version", "4"], "Both --prompt-version and --model are required"],
      [["--prompt-version", "x", "--model", "m"], "--prompt-version needs a positive integer"],
      [["--prompt-version", "4", "--model"], "--model needs a model id"],
      [[...PAIR_ARGS, "--force"], 'Unknown argument "--force"'],
    ])("rejects %j with exit 1 and touches nothing", async (args, message) => {
      const { run, err, store } = setup();
      expect(await run(args as string[])).toBe(1);
      expect(err.join("\n")).toContain(message);
      expect(store.countByStatus).not.toHaveBeenCalled();
    });
  });

  describe("withdraw", () => {
    it("is a dry run by default and changes nothing", async () => {
      const { run, out, store } = setup({ published: 12 });
      expect(await run(PAIR_ARGS)).toBe(0);
      expect(out.join("\n")).toContain("Would withdraw 12 rows");
      expect(store.withdraw).not.toHaveBeenCalled();
    });

    it("withdraws with --execute under a CLI generated run id", async () => {
      const { run, out, store } = setup({ published: 12 });
      expect(await run([...PAIR_ARGS, "--execute"])).toBe(0);
      expect(store.withdraw).toHaveBeenCalledWith(PAIR, "manual-run-1");
      expect(out.join("\n")).toContain("Withdrew 12 rows (withdraw run manual-run-1)");
    });

    it("says so when there is nothing to withdraw", async () => {
      const { run, out, store } = setup({ published: 0 });
      expect(await run([...PAIR_ARGS, "--execute"])).toBe(0);
      expect(out.join("\n")).toContain("nothing to withdraw");
      expect(store.withdraw).not.toHaveBeenCalled();
    });
  });

  describe("restore", () => {
    it("refuses with the numbers while the judged rows still cross the limit", async () => {
      const { run, err, store } = setup({ withdrawn: 40, judged: 40, bad: 3 });
      expect(await run([...PAIR_ARGS, "--restore", "--execute"])).toBe(1);
      const message = err.join("\n");
      expect(message).toContain("3 of 40 judged rows");
      expect(message).toContain("Fix the prompt or bump the rubric version first");
      expect(store.restore).not.toHaveBeenCalled();
    });

    it("refuses in a dry run too", async () => {
      const { run, store } = setup({ withdrawn: 40, judged: 40, bad: 3 });
      expect(await run([...PAIR_ARGS, "--restore"])).toBe(1);
      expect(store.restore).not.toHaveBeenCalled();
    });

    it("counts over both published and withdrawn rows at the current rubric version", async () => {
      const { run, store } = setup({ withdrawn: 1 });
      await run([...PAIR_ARGS, "--restore"]);
      expect(store.judgedStats).toHaveBeenCalledWith(PAIR, expect.any(Number));
    });

    it("proceeds with fewer than 30 judged rows however many are bad", async () => {
      const { run, store } = setup({ withdrawn: 9, judged: 29, bad: 20 });
      expect(await run([...PAIR_ARGS, "--restore", "--execute"])).toBe(0);
      expect(store.restore).toHaveBeenCalledWith(PAIR);
    });

    it("proceeds at exactly 5% bad (2 of 40)", async () => {
      const { run, store } = setup({ withdrawn: 9, judged: 40, bad: 2 });
      expect(await run([...PAIR_ARGS, "--restore", "--execute"])).toBe(0);
      expect(store.restore).toHaveBeenCalledTimes(1);
    });

    it("is a dry run by default", async () => {
      const { run, out, store } = setup({ withdrawn: 9, judged: 40, bad: 0 });
      expect(await run([...PAIR_ARGS, "--restore"])).toBe(0);
      expect(out.join("\n")).toContain("Would restore 9 rows");
      expect(store.restore).not.toHaveBeenCalled();
    });

    it("says so when there is nothing to restore", async () => {
      const { run, out, store } = setup({ withdrawn: 0 });
      expect(await run([...PAIR_ARGS, "--restore", "--execute"])).toBe(0);
      expect(out.join("\n")).toContain("nothing to restore");
      expect(store.restore).not.toHaveBeenCalled();
    });
  });

  it("disconnects after every run", async () => {
    const { run, disconnect } = setup({ published: 1 });
    await run(PAIR_ARGS);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
