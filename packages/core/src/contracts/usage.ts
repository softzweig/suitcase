/** Resource storage quotas for a specific filter. @human */
export type SuitcaseResourceUsage = {
  scope: "resource";
  resourceCount: number;
  size: number;
};

/** Upload storage quotas for a specific filter. @human */
export type SuitcaseUploadUsage = {
  scope: "upload";
  uploadCount: number;
  size: number;
};

/** Total storage quotas for a specific filter. @human */
export type SuitcaseTotalUsage = {
  scope: "total";
  resourceCount: number;
  uploadCount: number;
  size: number;
};

export type SuitcaseUsage = SuitcaseResourceUsage | SuitcaseUploadUsage | SuitcaseTotalUsage;

export const totalUsage = (
  resource: SuitcaseResourceUsage,
  upload: SuitcaseUploadUsage,
): SuitcaseTotalUsage => ({
  scope: "total",
  resourceCount: resource.resourceCount,
  uploadCount: upload.uploadCount,
  size: resource.size + upload.size,
});
