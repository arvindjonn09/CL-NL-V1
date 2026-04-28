const CONFIRMATION_RULES = {
  'action:restart-service': {
    risk: 'warning',
    intent: 'restart-service',
  },
  'action:apply-staged-upgrade': {
    risk: 'typed',
    intent: 'apply-staged-upgrade',
    typedValue: 'APPLY',
  },
  'device:delete': {
    risk: 'typed',
    intent: 'device-delete',
    typedValue: 'DELETE',
  },
  'device:environment': {
    risk: 'warning',
    intent: 'environment-change',
  },
  'file:upload': {
    risk: 'warning',
    intent: 'file-upload',
  },
};

function confirmationFromBody(body = {}) {
  const confirmation = body.confirmation || {};
  return {
    intent: confirmation.intent || body.confirmationIntent || body.confirmIntent || null,
    typedValue: confirmation.typedValue || confirmation.typed || body.confirmationTypedValue || body.confirmationValue || '',
  };
}

function confirmationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function validateConfirmation(ruleKey, body = {}) {
  const rule = CONFIRMATION_RULES[ruleKey];
  if (!rule) {
    return { required: false, ok: true };
  }

  const provided = confirmationFromBody(body);
  if (provided.intent !== rule.intent) {
    throw confirmationError(`confirmation intent is required: ${rule.intent}`);
  }

  if (rule.typedValue && String(provided.typedValue).trim() !== rule.typedValue) {
    throw confirmationError(`typed confirmation is required: ${rule.typedValue}`);
  }

  return {
    required: true,
    ok: true,
    risk: rule.risk,
    intent: rule.intent,
    typed: Boolean(rule.typedValue),
  };
}

function actionConfirmationRuleKey(actionType) {
  if (actionType === 'restart-service' || actionType === 'apply-staged-upgrade') {
    return `action:${actionType}`;
  }
  return null;
}

function auditConfirmationDetail(baseDetail, confirmation = null) {
  const parts = [];
  if (baseDetail) parts.push(baseDetail);
  if (confirmation?.required) {
    parts.push(`confirmation=${confirmation.intent}`);
    parts.push(`risk=${confirmation.risk}`);
    if (confirmation.typed) parts.push('typed=true');
  }
  return parts.join('; ');
}

module.exports = {
  CONFIRMATION_RULES,
  actionConfirmationRuleKey,
  auditConfirmationDetail,
  confirmationFromBody,
  validateConfirmation,
};
