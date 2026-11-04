CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  password_hash text,
  username text UNIQUE NOT NULL,
  display_name text NOT NULL,
  wallet_address text UNIQUE,
  referral_code text UNIQUE NOT NULL,
  referred_by uuid REFERENCES users(id),
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR wallet_address IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime text NOT NULL,
  size int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text NOT NULL,
  instructions text NOT NULL,
  type text NOT NULL,
  platform text,
  url text,
  reward numeric(20,6) NOT NULL CHECK (reward > 0),
  slots int NOT NULL CHECK (slots >= 1),
  deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','removed')),
  fund_tx text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_open_idx ON tasks (status, deadline);

CREATE TABLE IF NOT EXISTS submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id),
  worker_id uuid NOT NULL REFERENCES users(id),
  proof_url text,
  proof_file uuid REFERENCES uploads(id),
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason text,
  pay_tx text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (task_id, worker_id)
);

CREATE TABLE IF NOT EXISTS contests (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  description text NOT NULL,
  prompt text NOT NULL,
  type text NOT NULL,
  ends_at timestamptz NOT NULL,
  slots int NOT NULL CHECK (slots >= 1),
  prizes jsonb NOT NULL,
  prize_pool numeric(20,6) NOT NULL CHECK (prize_pool > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','removed')),
  fund_tx text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contest_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id uuid NOT NULL REFERENCES contests(id),
  user_id uuid NOT NULL REFERENCES users(id),
  proof_url text,
  proof_file uuid REFERENCES uploads(id),
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','winner','rejected')),
  prize_place text,
  prize_amount numeric(20,6),
  pay_tx text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  link text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, read, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id),
  target_type text NOT NULL CHECK (target_type IN ('task','contest','user')),
  target_id text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  target text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
