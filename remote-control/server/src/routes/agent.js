const express = require('express');
const { v4: uuidv4, validate: isUuid } = require('uuid');

const db = require('../db/db');

const router = express.Router();

router.post('/register', async (req, res) => {
  const {
    id: providedId,
    name,
    hostname = null,
    ip_address = null,
    status = 'online',
    metadata = {},
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  const id = providedId && isUuid(providedId) ? providedId : uuidv4();

  try {
    const result = await db.query(
      `
        INSERT INTO devices (id, name, hostname, ip_address, status, last_seen, metadata, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          hostname = EXCLUDED.hostname,
          ip_address = EXCLUDED.ip_address,
          status = EXCLUDED.status,
          last_seen = NOW(),
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
        RETURNING *
      `,
      [id, name, hostname, ip_address, status, metadata]
    );

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to register device:', error);
    return res.status(500).json({ error: 'Failed to register device' });
  }
});

router.post('/heartbeat', async (req, res) => {
  const { id, status = 'online' } = req.body;

  if (!id || !isUuid(id)) {
    return res.status(400).json({ error: 'valid device id is required' });
  }

  try {
    const result = await db.query(
      `
        UPDATE devices
        SET last_seen = NOW(),
            status = $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [id, status]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to process heartbeat:', error);
    return res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

module.exports = router;
