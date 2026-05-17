-- Migration 001: generic TrackServer platform fields
-- Execute this manually on existing VPS databases.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'custom';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS source_slug TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tracking_domain TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS test_event_code TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS dns_status TEXT DEFAULT 'pending';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS ssl_status TEXT DEFAULT 'pending';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE events_log ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS event_source_url TEXT;
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS request_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_clients_workspace_id ON clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_clients_source_id ON clients(source_id);
CREATE INDEX IF NOT EXISTS idx_clients_source_slug ON clients(source_slug);
CREATE INDEX IF NOT EXISTS idx_clients_tracking_domain ON clients(tracking_domain);
CREATE INDEX IF NOT EXISTS idx_clients_external_ref ON clients(external_ref);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_source_id_not_null ON clients(source_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_tracking_domain_not_null ON clients(tracking_domain) WHERE tracking_domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_external_ref_workspace_not_null ON clients(workspace_id, external_ref) WHERE workspace_id IS NOT NULL AND external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_log_source_id ON events_log(source_id);
CREATE INDEX IF NOT EXISTS idx_events_log_workspace_id ON events_log(workspace_id);

DROP TRIGGER IF EXISTS update_clients_changetimestamp ON clients;
CREATE TRIGGER update_clients_changetimestamp
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
