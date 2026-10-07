CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('REQUESTER', 'TECHNICIAN', 'ADMIN')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INTEGER GENERATED ALWAYS AS IDENTITY UNIQUE,
  requester_id UUID NOT NULL REFERENCES users(id),
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ASSIGNED', 'RESOLVED')),
  technician_id UUID REFERENCES users(id),
  technician_name TEXT,
  resolved_by_id UUID REFERENCES users(id),
  resolved_by_name TEXT,
  solution TEXT,
  resolution_version INTEGER NOT NULL DEFAULT 0,
  acceptance TEXT NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (acceptance IN ('NOT_REQUESTED', 'PENDING', 'CONFIRMED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CHECK (status = 'OPEN' OR technician_id IS NOT NULL),
  CHECK (status <> 'RESOLVED' OR (solution IS NOT NULL AND resolved_by_id IS NOT NULL))
);
CREATE INDEX orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX orders_requester_idx ON orders (requester_id);
CREATE INDEX orders_technician_idx ON orders (technician_id);

CREATE TABLE order_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id),
  actor_id UUID REFERENCES users(id),
  actor_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

CREATE TABLE confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id),
  version INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  requester_name TEXT NOT NULL,
  requester_email TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  invalidated_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  response TEXT CHECK (response IN ('CONFIRMED', 'REJECTED')),
  reason TEXT,
  email_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (email_status IN ('PENDING', 'SENT', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX confirmations_order_idx ON confirmations (order_id, created_at DESC);

CREATE TABLE sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX sessions_expire_idx ON sessions (expire);
