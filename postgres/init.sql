-- Habilitar extensão pgcrypto para UUIDs (se necessário, embora pg16 já possua por padrão)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Criar ENUM para status do cliente
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'client_status') THEN
        CREATE TYPE client_status AS ENUM ('active', 'paused');
    END IF;
END$$;

-- Criar tabela de clientes (multi-tenant)
CREATE TABLE IF NOT EXISTS clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subdomain TEXT UNIQUE NOT NULL, -- Ex: "clinicajoao" (mapeado para clinicajoao.seusaas.com ou track.cliente.com)
    pixel_id TEXT NOT NULL,
    access_token TEXT NOT NULL, -- Token encriptado com AES-256-GCM
    status client_status DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Criar tabela de logs de auditoria dos eventos enviados para a Meta CAPI
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

-- Índices para otimização de busca
CREATE INDEX IF NOT EXISTS idx_clients_subdomain ON clients(subdomain);
CREATE INDEX IF NOT EXISTS idx_events_log_client_id ON events_log(client_id);
CREATE INDEX IF NOT EXISTS idx_events_log_event_id ON events_log(event_id);
CREATE INDEX IF NOT EXISTS idx_events_log_created_at ON events_log(created_at DESC);

-- Trigger para atualizar o updated_at na tabela de clients
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_clients_changetimestamp
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();
