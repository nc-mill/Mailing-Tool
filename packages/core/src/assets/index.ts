/**
 * Doména assetů: nahrání obrázku, deduplikace, odvozené velikosti, veřejný výdej.
 *
 * Referenční graf (`asset_references`, `reference_count`) tady NENÍ a nemá být:
 * vlastní ho `packages/core/src/templates/asset-references.ts`, protože se
 * aktualizuje v jedné transakci se zápisem dokumentu šablony nebo kampaně.
 * Rozdělit ho by znamenalo dvě transakce a mezi nimi okno, ve kterém úklid
 * smaže obrázek, na který zápis právě odkazuje.
 */
export {
  DERIVED_VARIANTS,
  EXTENSION_BY_MIME,
  MAX_INPUT_PIXELS,
  MAX_STORED_DIMENSION,
  MIME_BY_EXTENSION,
  ORIGINAL_VARIANT,
  STORED_MIME_TYPES,
  isStoredMimeType,
  variantsFor,
  type StoredMimeType,
  type VariantSpec,
} from './registry';

export { detectFormat, type DetectedFormat } from './detect';

export {
  AssetProcessingError,
  normalizeUpload,
  renderVariants,
  type AssetErrorCode,
  type NormalizedImage,
  type RenderedVariant,
} from './image';

export { generatePublicId, PUBLIC_ID_LENGTH, PUBLIC_ID_PATTERN } from './public-id';

export { assetStorageKey, createFileAssetStorage, type AssetStorage } from './storage';

export { publicAssetPath, publicAssetUrl, signAssetPath, verifyAssetSignature } from './urls';

export {
  parseVariantFile,
  resolvePublicAsset,
  safeDownloadFilename,
  type PublicAssetFile,
} from './public';

export {
  assetUsage,
  findAssetById,
  findAssetBySha256,
  listAssets,
  listPurgeCandidates,
  listVariants,
  refcountMismatches,
  workspaceUsageBytes,
  type AssetRow,
  type AssetSource,
  type AssetUsage,
  type AssetVariantRow,
} from './repository';

export {
  AssetInUseBySentCampaign,
  AssetQuotaExceeded,
  AssetTooLarge,
  deleteAsset,
  loadAssetDetail,
  processAsset,
  purgeAsset,
  uploadAsset,
  type AssetServiceContext,
  type UploadInput,
  type UploadResult,
} from './service';

export {
  ASSETS_AUDIT_ACTIONS,
  AssetsAuditActions,
  writeAssetAudit,
  type AssetsAuditAction,
} from './audit';
