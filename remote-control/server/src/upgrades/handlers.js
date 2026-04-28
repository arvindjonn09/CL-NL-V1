const { getApprovedManifest, recordUpgradeEvent } = require('./service');

function registerUpgradeRoutes(app, { pool, agentAuthMiddleware, authMiddleware, audit }) {
  app.get('/api/agent/upgrades/manifest', agentAuthMiddleware, async (req, res) => {
    try {
      const manifest = getApprovedManifest();
      if (!manifest) {
        return res.status(204).end();
      }
      await recordUpgradeEvent(pool, {
        deviceId: req.query.id,
        fromVersion: req.query.version,
        toVersion: manifest.version,
        status: 'manifest-served',
      });
      res.json(manifest);
    } catch (err) {
      console.error('GET /api/agent/upgrades/manifest error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/agent/upgrades/status', agentAuthMiddleware, async (req, res) => {
    try {
      await recordUpgradeEvent(pool, {
        deviceId: req.body.deviceId,
        fromVersion: req.body.fromVersion,
        toVersion: req.body.version,
        status: req.body.status,
        reason: req.body.reason,
      });
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/agent/upgrades/status error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/admin/upgrades/manifest', authMiddleware, async (_req, res) => {
    const manifest = getApprovedManifest();
    res.json({ approved: Boolean(manifest), manifest });
  });

  app.post('/api/admin/upgrades/events', authMiddleware, async (req, res) => {
    try {
      await recordUpgradeEvent(pool, {
        deviceId: req.body.deviceId,
        fromVersion: req.body.fromVersion,
        toVersion: req.body.toVersion,
        status: req.body.status || 'admin-note',
        reason: req.body.reason,
      });
      if (audit) {
        await audit(pool, req, {
          action: 'upgrade_trigger',
          targetType: 'device',
          targetId: req.body.deviceId || null,
          result: 'success',
          detail: req.body.status || 'admin-note',
        });
      }
      res.json({ success: true });
    } catch (err) {
      console.error('POST /api/admin/upgrades/events error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });
}

module.exports = {
  registerUpgradeRoutes,
};
