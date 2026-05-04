-- Run this in the Supabase SQL editor for your project

CREATE TABLE players (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE games (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_number integer NOT NULL,
  map_name text NOT NULL,
  played_date date NOT NULL,
  replay_url text,
  num_players integer NOT NULL CHECK (num_players >= 2),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE results (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id uuid REFERENCES games(id) ON DELETE CASCADE,
  player_id uuid REFERENCES players(id) ON DELETE CASCADE,
  finish_position integer NOT NULL CHECK (finish_position >= 1),
  UNIQUE(game_id, player_id),
  UNIQUE(game_id, finish_position)
);

-- Enable row-level security
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE results ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can view the leaderboard)
CREATE POLICY "public_select_players" ON players FOR SELECT USING (true);
CREATE POLICY "public_select_games"   ON games   FOR SELECT USING (true);
CREATE POLICY "public_select_results" ON results FOR SELECT USING (true);

-- Write access via anon key (admin password enforced in the app)
CREATE POLICY "anon_insert_players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert_games"   ON games   FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert_results" ON results FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_delete_results" ON results FOR DELETE USING (true);
CREATE POLICY "anon_delete_games"   ON games   FOR DELETE USING (true);
CREATE POLICY "anon_delete_players" ON players FOR DELETE USING (true);
