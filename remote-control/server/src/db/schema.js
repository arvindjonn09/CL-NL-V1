async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      hostname TEXT,
      os TEXT,
      status TEXT DEFAULT 'offline',
      last_seen TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS command_results (
      id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL,
      output TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const statements = [
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS run_mode TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_name TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS username TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS group_key TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS agent_version TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS service_name TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS backend_url TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS environment_label TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS startup_at TIMESTAMPTZ`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS executable_path TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS config_path TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS process_id INTEGER`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS runtime_paths JSONB`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS remote_desktop_capability JSONB`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_command_activity_at TIMESTAMPTZ`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_file_activity_at TIMESTAMPTZ`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_error_source TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_error_message TEXT`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_command_summary JSONB`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_file_summary JSONB`,
    `ALTER TABLE devices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
    `ALTER TABLE commands ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`,
    `ALTER TABLE commands ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`,
    `ALTER TABLE commands ADD COLUMN IF NOT EXISTS exit_code INTEGER`,
    `ALTER TABLE commands ADD COLUMN IF NOT EXISTS stdout_preview TEXT`,
    `ALTER TABLE commands ADD COLUMN IF NOT EXISTS stderr_preview TEXT`,
    `ALTER TABLE commands ADD COLUMN IF NOT EXISTS error_message TEXT`,
    `ALTER TABLE commands ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS file_jobs (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT,
      direction TEXT NOT NULL DEFAULT 'upload-to-device',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      bytes_transferred BIGINT,
      destination_path TEXT,
      error_message TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_health_events (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_heartbeats (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      run_mode TEXT,
      agent_version TEXT,
      process_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_actions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT,
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      result_summary TEXT,
      result_payload JSONB,
      error_summary TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_diagnostics (
      device_id TEXT PRIMARY KEY,
      reported_at TIMESTAMPTZ DEFAULT NOW(),
      status TEXT,
      degraded BOOLEAN DEFAULT FALSE,
      degraded_reason TEXT,
      last_successful_backend_contact TIMESTAMPTZ,
      heartbeat_failure_count INTEGER DEFAULT 0,
      version TEXT,
      run_mode TEXT,
      executable_path TEXT,
      config_path TEXT,
      log_path TEXT,
      backend_url TEXT,
      service_name TEXT,
      last_command_status TEXT,
      last_file_status TEXT,
      startup_summary_json JSONB,
      diagnostics_json JSONB
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id TEXT PRIMARY KEY,
      admin_user TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      rotated_from TEXT,
      revoked_at TIMESTAMPTZ,
      ip TEXT,
      user_agent TEXT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash
    ON admin_sessions (token_hash)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_operator_acknowledgements (
      admin_identity TEXT NOT NULL,
      version TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (admin_identity, version)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      username TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      user_type TEXT NOT NULL DEFAULT 'remote',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      remote_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      device_scope_mode TEXT NOT NULL DEFAULT 'all',
      notes TEXT,
      password_change_required BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_device_scopes (
      user_id TEXT NOT NULL REFERENCES access_users(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      PRIMARY KEY (user_id, device_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_access_users_email
    ON access_users (email)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_device_scopes_device
    ON user_device_scopes (device_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_operator_acknowledgements_identity
    ON admin_operator_acknowledgements (admin_identity, accepted_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      admin_user TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      ip TEXT,
      user_agent TEXT,
      result TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at
    ON admin_audit_logs (created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS remote_access_verification_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      attempts INTEGER NOT NULL DEFAULT 0,
      resend_available_at TIMESTAMPTZ NOT NULL,
      ip TEXT,
      user_agent TEXT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_remote_access_codes_email_active
    ON remote_access_verification_codes (email, expires_at DESC)
    WHERE consumed_at IS NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS remote_access_sessions (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      issued_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      ip TEXT,
      user_agent TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS remote_access_session_grants (
      id TEXT PRIMARY KEY,
      remote_user_identity TEXT NOT NULL,
      device_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'granted',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      failure_reason TEXT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_remote_access_session_grants_device_created
    ON remote_access_session_grants (device_id, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_remote_access_session_grants_identity_created
    ON remote_access_session_grants (remote_user_identity, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS remote_desktop_sessions (
      id TEXT PRIMARY KEY,
      grant_id TEXT NOT NULL REFERENCES remote_access_session_grants(id) ON DELETE CASCADE,
      remote_user_identity TEXT NOT NULL,
      device_id TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'remote_desktop',
      status TEXT NOT NULL DEFAULT 'requested',
      signaling_state TEXT,
      transport_state TEXT,
      browser_offer JSONB,
      agent_answer JSONB,
      browser_ice JSONB NOT NULL DEFAULT '[]'::jsonb,
      agent_ice JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      failure_reason TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_remote_desktop_sessions_device_created
    ON remote_desktop_sessions (device_id, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_remote_desktop_sessions_identity_created
    ON remote_desktop_sessions (remote_user_identity, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_outbox (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      provider TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS upgrade_events (
      id TEXT PRIMARY KEY,
      device_id TEXT,
      from_version TEXT,
      to_version TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_upgrade_events_device_created_at
    ON upgrade_events (device_id, created_at DESC)
  `);
}

module.exports = {
  ensureSchema,
};
