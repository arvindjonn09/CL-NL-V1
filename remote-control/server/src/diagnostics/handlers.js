const {
  getDeviceHealth,
  getLatestDiagnostics,
  saveLatestDiagnostics,
} = require('./service');

function registerDiagnosticsRoutes(app, { pool, authMiddleware, agentAuthMiddleware }) {
  app.get('/api/admin/devices/:id/health', authMiddleware, async (req, res) => {
    try {
      res.json(await getDeviceHealth(pool, req.params.id));
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error('GET /api/admin/devices/:id/health error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/admin/devices/:id/diagnostics', authMiddleware, async (req, res) => {
    try {
      const diagnostics = await getLatestDiagnostics(pool, req.params.id);
      if (!diagnostics) {
        return res.status(404).json({ error: 'Diagnostics not found' });
      }
      res.json({ deviceId: req.params.id, diagnostics });
    } catch (err) {
      console.error('GET /api/admin/devices/:id/diagnostics error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.post('/api/agent/diagnostics', agentAuthMiddleware, async (req, res) => {
    try {
      const diagnostics = await saveLatestDiagnostics(pool, req.body);
      res.json({ success: true, diagnostics });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      console.error('POST /api/agent/diagnostics error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });
}

module.exports = {
  registerDiagnosticsRoutes,
};
