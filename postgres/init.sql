-- TrackServer universal multi-tenant schema
-- This file is safe for fresh installs and existing databases.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_status') THEN
        CREATE TYPE client_status AS ENUM ('active', 'paused');
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subdomain TEXT UNIQUE,
    pixel_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    status client_status DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS events_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_time BIGINT NOT NULL,
    sent_to_meta BOOLEAN DEFAULT false,
    meta_response JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE events_log ADD COLUMN IF NOT EXISTS workspace_id TEXT;
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS event_source_url TEXT;
ALTER TABLE events_log ADD COLUMN IF NOT EXISTS request_payload JSONB;

CREATE INDEX IF NOT EXISTS idx_clients_subdomain ON clients(subdomain);
CREATE INDEX IF NOT EXISTS idx_clients_workspace_id ON clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_clients_source_id ON clients(source_id);
CREATE INDEX IF NOT EXISTS idx_clients_source_slug ON clients(source_slug);
CREATE INDEX IF NOT EXISTS idx_clients_tracking_domain ON clients(tracking_domain);
CREATE INDEX IF NOT EXISTS idx_clients_external_ref ON clients(external_ref);

DROP INDEX IF EXISTS uniq_clients_source_id_not_null;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_workspace_source_not_null ON clients(workspace_id, source_id) WHERE workspace_id IS NOT NULL AND source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_source_id_without_workspace ON clients(source_id) WHERE workspace_id IS NULL AND source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_tracking_domain_not_null ON clients(tracking_domain) WHERE tracking_domain IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_external_ref_workspace_not_null ON clients(workspace_id, external_ref) WHERE workspace_id IS NOT NULL AND external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_log_client_id ON events_log(client_id);
CREATE INDEX IF NOT EXISTS idx_events_log_event_id ON events_log(event_id);
CREATE INDEX IF NOT EXISTS idx_events_log_created_at ON events_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_log_source_id ON events_log(source_id);
CREATE INDEX IF NOT EXISTS idx_events_log_workspace_id ON events_log(workspace_id);

CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_clients_changetimestamp ON clients;
CREATE TRIGGER update_clients_changetimestamp
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
