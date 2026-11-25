/**
 * The fork ships no declarations, and `@types/s3rver` describes the original package. Only what
 * this example starts and configures is declared.
 */
declare module "@20minutes/s3rver" {
  export interface S3rverBucketConfig {
    name: string;
    configs: readonly (string | Buffer)[];
  }

  export interface S3rverOptions {
    address?: string;
    port?: number;
    directory?: string;
    silent?: boolean;
    configureBuckets?: readonly S3rverBucketConfig[];
  }

  export default class S3rver {
    constructor(options: S3rverOptions);
    run(callback?: (error: Error | null, hostname?: string) => void): Promise<unknown>;
    close(): Promise<void>;
  }
}
