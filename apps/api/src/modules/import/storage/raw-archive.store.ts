import { Logger } from "@nestjs/common";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Raw-payload archive (ST-6 / BRI-103).
 *
 * Every page fetched from an OTA is written here verbatim *before* any
 * downstream processing. This is the replay safety net: if normalization
 * (ST-7) later changes or fails, we can re-run the whole pipeline from the
 * archived bytes without re-hitting the OTA. Keys are laid out as
 * `raw/{source}/{date}/{page}.json` so a day's crawl is easy to enumerate and
 * replay in order.
 */

/** What the archive needs to know to store one page. */
export interface RawPageRef {
  /** OTA identifier, e.g. `"viator"`. */
  source: string;
  /** Crawl date, `YYYY-MM-DD` (UTC). */
  date: string;
  /** 1-based page number within the crawl. */
  page: number;
}

/** Where an archived page landed (for logging / provenance). */
export interface ArchivedPage {
  bucket: string;
  key: string;
}

/**
 * Storage seam. The Viator client depends on this interface, not on any
 * concrete backend, so unit tests inject an in-memory fake and never touch R2.
 */
export interface RawArchiveStore {
  /** Archive one raw page. `body` is the exact response text from the OTA. */
  putRawPage(ref: RawPageRef, body: string): Promise<ArchivedPage>;
}

/** Build the object key for a raw page: `raw/{source}/{date}/{page}.json`. */
export function rawPageKey(ref: RawPageRef): string {
  return `raw/${ref.source}/${ref.date}/${ref.page}.json`;
}

/** Config for the R2-backed store. Credentials come from validated env. */
export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Cloudflare R2 implementation of {@link RawArchiveStore}, via R2's
 * S3-compatible API. R2 ignores region, but the SDK requires one — `"auto"` is
 * the documented value.
 */
export class R2RawArchiveStore implements RawArchiveStore {
  private readonly logger = new Logger(R2RawArchiveStore.name);
  private readonly bucket: string;

  constructor(
    config: R2Config,
    /** Injectable for tests; defaults to a real S3 client pointed at R2. */
    private readonly client: S3Client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  ) {
    this.bucket = config.bucket;
  }

  async putRawPage(ref: RawPageRef, body: string): Promise<ArchivedPage> {
    const key = rawPageKey(ref);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
      }),
    );
    this.logger.debug(`Archived raw page to ${this.bucket}/${key}`);
    return { bucket: this.bucket, key };
  }
}
