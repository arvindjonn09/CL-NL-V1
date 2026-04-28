function currentApprovedManifest() {
  const version = process.env.UPGRADE_VERSION || '';
  const downloadUrl = process.env.UPGRADE_DOWNLOAD_URL || '';
  const sha256 = process.env.UPGRADE_SHA256 || '';
  const sizeBytes = Number(process.env.UPGRADE_SIZE_BYTES || 0);
  const minimumCompatibleVersion = process.env.UPGRADE_MIN_COMPATIBLE_VERSION || '';

  if (!version || !downloadUrl || !sha256 || !sizeBytes) {
    return null;
  }

  return {
    version,
    downloadUrl,
    sha256,
    sizeBytes,
    ...(minimumCompatibleVersion ? { minimumCompatibleVersion } : {}),
  };
}

function validateManifest(manifest) {
  if (!manifest) return false;
  try {
    const parsed = new URL(manifest.downloadUrl);
    return Boolean(
      manifest.version &&
      parsed.protocol.startsWith('http') &&
      manifest.sha256 &&
      Number(manifest.sizeBytes) > 0
    );
  } catch {
    return false;
  }
}

module.exports = {
  currentApprovedManifest,
  validateManifest,
};
