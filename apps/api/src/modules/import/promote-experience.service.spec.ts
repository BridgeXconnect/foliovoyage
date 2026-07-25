import { describe, expect, it, jest } from "@jest/globals";

import {
  ExperienceNotFoundError,
  ExperiencePromoter,
  type ExperiencePromoterPrisma,
} from "./promote-experience.service";

type Row = { id: string; title: string; status: string } | null;

function makePrisma(opts: {
  find: Row;
  onUpdate?: jest.Mock;
}): { prisma: ExperiencePromoterPrisma; update: jest.Mock } {
  const update = opts.onUpdate ?? jest.fn();
  const prisma = {
    experience: {
      findUnique: jest.fn(async () => opts.find),
      update,
    },
  } as unknown as ExperiencePromoterPrisma;
  return { prisma, update };
}

describe("ExperiencePromoter.promote", () => {
  it("promotes a draft Experience to published", async () => {
    const update = jest
      .fn<(args: unknown) => Promise<{ id: string; title: string; status: string }>>()
      .mockResolvedValue({ id: "e1", title: "Wat Pho", status: "published" });
    const { prisma } = makePrisma({
      find: { id: "e1", title: "Wat Pho", status: "draft" },
      onUpdate: update,
    });

    const result = await new ExperiencePromoter(prisma).promote("e1");

    expect(result).toEqual({
      id: "e1",
      title: "Wat Pho",
      previousStatus: "draft",
      status: "published",
      changed: true,
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e1" },
        data: { status: "published" },
      }),
    );
  });

  it("is a no-op for an already-published Experience (never un-publishes)", async () => {
    const { prisma, update } = makePrisma({
      find: { id: "e2", title: "River cruise", status: "published" },
    });

    const result = await new ExperiencePromoter(prisma).promote("e2");

    expect(result.changed).toBe(false);
    expect(result.status).toBe("published");
    expect(update).not.toHaveBeenCalled();
  });

  it("throws ExperienceNotFoundError for an unknown id", async () => {
    const { prisma } = makePrisma({ find: null });

    await expect(
      new ExperiencePromoter(prisma).promote("missing"),
    ).rejects.toBeInstanceOf(ExperienceNotFoundError);
  });
});
