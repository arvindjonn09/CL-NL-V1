const express = require('express');

const db = require('../db/db');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT *
        FROM devices
        ORDER BY created_at DESC
      `
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Failed to fetch devices:', error);
    return res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

module.exports = router;
