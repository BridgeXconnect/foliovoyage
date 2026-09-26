import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ViatorProduct } from "../clients/viator.types";
import type { R2Config } from "./raw-archive.store";

/**
 * Read side of the raw-payload archive (BRI-218).
 *
 * `R2RawArchiveStore` only writes. The coordinate backfill needs to re-read the
 * payloads Atlas already archived (`raw/{source}/{date}/{page}.json`), because
 * `Tour` rows keep only the one `location_ref` and not the itinerary/pickup refs
 * this fix reads. Reading our own archive costs no OTA calls, and avoids
 * `/products/bulk`, which doc 13 says must not be used for ingestion.
 */
export interface RawArchiveReader {
  /**
   * Every archived page key for `source`, **newest crawl date first** (so a
   * caller taking the first payload seen per product gets its most recent one).
   * Within a date, ascending page number.
   */
  listPageKeys(source: string): Promise<string[]>;
  /** Fetch and parse one archived page's products. */
  readPage(key: string): Promise<ViatorProduct[]>;
}

const READ_ATTEMPTS = 5;

const KEY_RE = /^raw\/[^/]+\/(\d{4}-\d{2}-\d{2})\/(\d+)\.json$/;

/** Newest date first, then ascending page number; unparseable keys last. */
export function compareArchiveKeys(a: string, b: string): number {
  const ma = KEY_RE.exec(a);
  const mb = KEY_RE.exec(b);
  if (!ma || !mb) return ma ? -1 : mb ? 1 : a.localeCompare(b);
  if (ma[1] !== mb[1]) return ma[1] < mb[1] ? 1 : -1;
  return Number(ma[2]) - Number(mb[2]);
}

export class R2RawArchiveReader implements RawArchiveReader {
  private readonly bucket: string;

  constructor(
    config: R2Config,
    private readonly client: S3Client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: 8,
    }),
    private readonly retryDelayMs = 1000,
  ) {
    this.bucket = config.bucket;
  }

  async listPageKeys(source: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `raw/${source}/`,
          ContinuationToken: token,
        }),
      );
      for (const obj of page.Contents ?? []) {
        if (obj.Key && KEY_RE.test(obj.Key)) keys.push(obj.Key);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys.sort(compareArchiveKeys);
  }

  /**
   * The whole fetch-and-read is retried, not just the request: the SDK's
   * `maxAttempts` covers the request, but a socket that closes mid-body (a
   * 28 MB page over a long crawl does this) surfaces later, from
   * `transformToString`, as `aborted` and is not retried by the SDK.
   */
  async readPage(key: string): Promise<ViatorProduct[]> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        const text = (await response.Body?.transformToString()) ?? "";
        const parsed = JSON.parse(text) as { products?: unknown };
        return Array.isArray(parsed.products)
          ? (parsed.products as ViatorProduct[])
          : [];
      } catch (error) {
        if (attempt >= READ_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
      }
    }
  }
}
