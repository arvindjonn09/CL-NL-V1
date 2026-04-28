function auditEntry({
  adminIdentity = null,
  ip = null,
  userAgent = null,
  action,
  targetType = null,
  targetId = null,
  result = 'success',
  detail = null,
}) {
  return {
    adminIdentity,
    ip,
    userAgent,
    action,
    targetType,
    targetId,
    result,
    detail,
  };
}

module.exports = {
  auditEntry,
};
