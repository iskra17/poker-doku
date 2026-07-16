import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'anonymous_progression_foundation',
    sql: `
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        credential_hash TEXT NOT NULL UNIQUE,
        credential_lookup TEXT NOT NULL UNIQUE,
        recovery_hash TEXT NOT NULL UNIQUE,
        recovery_lookup TEXT NOT NULL UNIQUE,
        alias TEXT NOT NULL UNIQUE,
        avatar_id TEXT NOT NULL,
        adult_confirmed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE wallets (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        balance INTEGER NOT NULL CHECK (balance >= 0),
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE chip_ledger (
        id TEXT PRIMARY KEY,
        profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
        account TEXT NOT NULL CHECK (account IN ('wallet','escrow','bot','burn')),
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        ref_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE seat_escrows (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        room_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('cash','sng')),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        checkpoint_amount INTEGER NOT NULL CHECK (checkpoint_amount >= 0),
        checkpoint_hand INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('active','settled')),
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX one_active_room_escrow
        ON seat_escrows(profile_id) WHERE status = 'active';

      CREATE TABLE daily_claims (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        claim_date TEXT NOT NULL CHECK (length(claim_date) = 10),
        amount INTEGER NOT NULL CHECK (amount > 0),
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, claim_date)
      ) STRICT;

      CREATE TABLE rescue_claims (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        claim_date TEXT NOT NULL CHECK (length(claim_date) = 10),
        ordinal INTEGER NOT NULL CHECK (ordinal > 0),
        amount INTEGER NOT NULL CHECK (amount > 0),
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (profile_id, claim_date, ordinal)
      ) STRICT;

      CREATE TABLE sng_entries (
        room_id TEXT NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        buy_in INTEGER NOT NULL CHECK (buy_in >= 0),
        fee INTEGER NOT NULL CHECK (fee >= 0),
        status TEXT NOT NULL CHECK (status IN ('reserved','started','settled','refunded')),
        place INTEGER CHECK (place IS NULL OR place BETWEEN 1 AND 6),
        prize INTEGER NOT NULL DEFAULT 0 CHECK (prize >= 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, profile_id)
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: 'index_rescue_claims_by_profile_and_latest_claim',
    sql: `
      CREATE INDEX idx_rescue_claims_profile_claimed_at_desc
      ON rescue_claims(profile_id, claimed_at DESC);
    `,
  },
  {
    version: 3,
    name: 'durable_cash_hand_settlement_identity',
    sql: `
      CREATE TABLE cash_hand_settlements (
        room_id TEXT NOT NULL,
        settlement_seq INTEGER NOT NULL CHECK (settlement_seq > 0),
        engine_hand_number INTEGER NOT NULL CHECK (engine_hand_number > 0),
        start_fingerprint TEXT NOT NULL CHECK (length(start_fingerprint) = 64),
        settlement_fingerprint TEXT CHECK (
          settlement_fingerprint IS NULL OR length(settlement_fingerprint) = 64
        ),
        status TEXT NOT NULL CHECK (status IN ('prepared','settled','voided')),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, settlement_seq)
      ) STRICT;

      CREATE UNIQUE INDEX one_prepared_cash_hand_per_room
        ON cash_hand_settlements(room_id) WHERE status = 'prepared';
    `,
  },
  {
    version: 4,
    name: 'durable_sng_tournament_incarnations',
    sql: `
      ALTER TABLE sng_entries RENAME TO sng_entries_v1_backup;

      CREATE TABLE sng_entries (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        buy_in INTEGER NOT NULL CHECK (buy_in > 0),
        fee INTEGER NOT NULL CHECK (fee > 0),
        status TEXT NOT NULL CHECK (status IN ('reserved','started','settled','refunded')),
        place INTEGER CHECK (place IS NULL OR place BETWEEN 1 AND 6),
        prize INTEGER NOT NULL DEFAULT 0 CHECK (prize >= 0),
        start_attempt INTEGER NOT NULL DEFAULT 0 CHECK (start_attempt >= 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (tournament_id, profile_id)
      ) STRICT;

      INSERT INTO sng_entries (
        id, tournament_id, room_id, profile_id, buy_in, fee,
        status, place, prize, start_attempt, created_at, updated_at
      )
      SELECT
        'legacy:' || room_id || ':' || profile_id,
        'legacy:' || room_id,
        room_id,
        profile_id,
        buy_in,
        fee,
        status,
        place,
        prize,
        CASE WHEN status IN ('started', 'settled') THEN 1 ELSE 0 END,
        created_at,
        updated_at
      FROM sng_entries_v1_backup;

      DROP TABLE sng_entries_v1_backup;

      CREATE UNIQUE INDEX one_active_sng_entry_per_profile
        ON sng_entries(profile_id)
        WHERE status IN ('reserved', 'started');

      CREATE INDEX idx_sng_entries_room_status_tournament
        ON sng_entries(room_id, status, tournament_id);
    `,
  },
  {
    version: 5,
    name: 'progression_persistence_schema',
    sql: `
      CREATE TABLE progression_profiles (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        balance_version INTEGER NOT NULL CHECK (balance_version = 1),
        dojo_level INTEGER NOT NULL CHECK (dojo_level BETWEEN 1 AND 50),
        dojo_xp_milli INTEGER NOT NULL CHECK (
          dojo_xp_milli >= 0 AND (
            (dojo_level = 50 AND dojo_xp_milli = 0)
            OR (
              dojo_level < 50
              AND dojo_xp_milli < (100 + 25 * (dojo_level - 1)) * 1000
            )
          )
        ),
        selected_character_id TEXT NOT NULL CHECK (
          selected_character_id IN ('sakura','ara','hana','chloe','vivian','elena')
        ),
        practice_date TEXT CHECK (
          practice_date IS NULL OR (
            length(practice_date) = 10
            AND practice_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND CAST(substr(practice_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
            AND COALESCE(date(practice_date, '+0 days') = practice_date, 0)
          )
        ),
        practice_hands INTEGER NOT NULL DEFAULT 0 CHECK (practice_hands >= 0),
        completed_hands INTEGER NOT NULL DEFAULT 0 CHECK (completed_hands >= 0),
        cash_hands INTEGER NOT NULL DEFAULT 0 CHECK (cash_hands >= 0),
        practice_hands_total INTEGER NOT NULL DEFAULT 0 CHECK (practice_hands_total >= 0),
        sng_completions INTEGER NOT NULL DEFAULT 0 CHECK (sng_completions >= 0),
        best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
      ) STRICT;

      CREATE TABLE character_affinity (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        character_id TEXT NOT NULL CHECK (
          character_id IN ('sakura','ara','hana','chloe','vivian','elena')
        ),
        level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 20),
        xp_milli INTEGER NOT NULL CHECK (
          xp_milli >= 0 AND (
            (level = 20 AND xp_milli = 0)
            OR (
              level < 20
              AND xp_milli < (40 + 15 * (level - 1)) * 1000
            )
          )
        ),
        PRIMARY KEY (profile_id, character_id)
      ) STRICT;

      CREATE TABLE daily_missions (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        mission_date TEXT NOT NULL CHECK (
          length(mission_date) = 10
          AND mission_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND CAST(substr(mission_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
          AND COALESCE(date(mission_date, '+0 days') = mission_date, 0)
        ),
        slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 2),
        mission_id TEXT NOT NULL CHECK (length(mission_id) > 0),
        target INTEGER NOT NULL CHECK (target > 0),
        progress INTEGER NOT NULL CHECK (progress >= 0),
        balance_version INTEGER NOT NULL CHECK (balance_version > 0),
        reroll_count INTEGER NOT NULL DEFAULT 0 CHECK (reroll_count >= 0),
        assigned_at INTEGER NOT NULL CHECK (assigned_at >= 0),
        completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
        rewarded_at INTEGER CHECK (rewarded_at IS NULL OR rewarded_at >= 0),
        PRIMARY KEY (profile_id, mission_date, slot),
        UNIQUE (profile_id, mission_date, mission_id),
        CHECK (rewarded_at IS NULL OR completed_at IS NOT NULL)
      ) STRICT;

      CREATE TABLE streak_state (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        current_streak INTEGER NOT NULL CHECK (current_streak >= 0),
        rest_passes INTEGER NOT NULL CHECK (rest_passes BETWEEN 0 AND 1),
        last_qualified_date TEXT CHECK (
          last_qualified_date IS NULL OR (
            length(last_qualified_date) = 10
            AND last_qualified_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND CAST(substr(last_qualified_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
            AND COALESCE(
              date(last_qualified_date, '+0 days') = last_qualified_date,
              0
            )
          )
        ),
        last_week_key TEXT CHECK (
          last_week_key IS NULL OR (
            length(last_week_key) = 8
            AND last_week_key GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'
            AND CAST(substr(last_week_key, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
            AND CAST(substr(last_week_key, 7, 2) AS INTEGER) BETWEEN 1 AND 53
          )
        ),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
      ) STRICT;

      CREATE TABLE inventory_items (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL CHECK (length(item_id) > 0),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        granted_at INTEGER NOT NULL CHECK (granted_at >= 0),
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
        PRIMARY KEY (profile_id, item_id)
      ) STRICT;

      CREATE TABLE profile_equipment (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        slot TEXT NOT NULL CHECK (slot IN ('title','frame','skin','cutin')),
        item_id TEXT,
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
        PRIMARY KEY (profile_id, slot),
        FOREIGN KEY (profile_id, item_id)
          REFERENCES inventory_items(profile_id, item_id)
          ON UPDATE CASCADE
          ON DELETE NO ACTION
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;

      CREATE TABLE progression_events (
        idempotency_key TEXT PRIMARY KEY CHECK (length(idempotency_key) > 0),
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (length(event_type) > 0),
        balance_version INTEGER NOT NULL CHECK (balance_version > 0),
        summary_json TEXT NOT NULL CHECK (
          json_valid(summary_json) AND json_type(summary_json) = 'object'
        ),
        created_at INTEGER NOT NULL CHECK (created_at >= 0)
      ) STRICT;

      CREATE INDEX idx_progression_daily_date_profile
        ON daily_missions(mission_date, profile_id);

      CREATE INDEX idx_progression_events_profile_created_at_desc
        ON progression_events(profile_id, created_at DESC);

      CREATE INDEX idx_progression_inventory_item_profile
        ON inventory_items(item_id, profile_id);
    `,
  },
  {
    version: 6,
    name: 'durable_daily_mission_mode_sets',
    sql: `
      CREATE TABLE v6_daily_mission_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      INSERT INTO v6_daily_mission_validation (invalid)
      SELECT 1
      FROM daily_missions
      WHERE
        balance_version != 1
        OR NOT (
          (mission_id = 'COMPLETE_HANDS_ANY_10' AND target = 10)
          OR (mission_id = 'COMPLETE_HANDS_CASH_10' AND target = 10)
          OR (mission_id = 'COMPLETE_HANDS_PRACTICE_10' AND target = 10)
          OR (mission_id = 'COMPLETE_HANDS_ANY_20' AND target = 20)
          OR (mission_id = 'COMPLETE_ONE_SNG' AND target = 1)
          OR (mission_id = 'COMPLETE_TWO_MODES' AND target = 2)
        )
        OR progress > target
        OR reroll_count NOT IN (0, 1)
        OR (
          (progress < target AND (
            completed_at IS NOT NULL OR rewarded_at IS NOT NULL
          ))
          OR (progress = target AND (
            completed_at IS NULL
            OR rewarded_at IS NULL
            OR rewarded_at != completed_at
          ))
        )
      LIMIT 1;

      INSERT INTO v6_daily_mission_validation (invalid)
      SELECT 1
      FROM (
        SELECT
          profile_id,
          mission_date,
          COUNT(*) AS mission_count,
          SUM(slot) AS slot_sum,
          SUM(reroll_count) AS reroll_total
        FROM daily_missions
        GROUP BY profile_id, mission_date
      )
      WHERE mission_count != 3 OR slot_sum != 3 OR reroll_total > 1
      LIMIT 1;

      DROP TABLE v6_daily_mission_validation;

      CREATE TABLE daily_mission_modes (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        mission_date TEXT NOT NULL CHECK (
          length(mission_date) = 10
          AND mission_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND CAST(substr(mission_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
          AND COALESCE(date(mission_date, '+0 days') = mission_date, 0)
        ),
        mode TEXT NOT NULL CHECK (mode IN ('cash','practice','sng')),
        created_at INTEGER NOT NULL CHECK (created_at >= 0),
        PRIMARY KEY (profile_id, mission_date, mode)
      ) STRICT;

      CREATE INDEX idx_daily_mission_modes_date_profile
        ON daily_mission_modes(mission_date, profile_id);

      CREATE TRIGGER validate_daily_mission_insert
      BEFORE INSERT ON daily_missions
      WHEN
        NEW.balance_version != 1
        OR NOT (
          (NEW.mission_id = 'COMPLETE_HANDS_ANY_10' AND NEW.target = 10)
          OR (NEW.mission_id = 'COMPLETE_HANDS_CASH_10' AND NEW.target = 10)
          OR (NEW.mission_id = 'COMPLETE_HANDS_PRACTICE_10' AND NEW.target = 10)
          OR (NEW.mission_id = 'COMPLETE_HANDS_ANY_20' AND NEW.target = 20)
          OR (NEW.mission_id = 'COMPLETE_ONE_SNG' AND NEW.target = 1)
          OR (NEW.mission_id = 'COMPLETE_TWO_MODES' AND NEW.target = 2)
        )
        OR NEW.progress > NEW.target
        OR NEW.reroll_count NOT IN (0, 1)
        OR (
          (NEW.progress < NEW.target AND (
            NEW.completed_at IS NOT NULL OR NEW.rewarded_at IS NOT NULL
          ))
          OR (NEW.progress = NEW.target AND (
            NEW.completed_at IS NULL
            OR NEW.rewarded_at IS NULL
            OR NEW.rewarded_at != NEW.completed_at
          ))
        )
        OR (
          NEW.reroll_count = 1
          AND EXISTS (
            SELECT 1 FROM daily_missions
            WHERE profile_id = NEW.profile_id
              AND mission_date = NEW.mission_date
              AND reroll_count = 1
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid daily mission');
      END;

      CREATE TRIGGER validate_daily_mission_update
      BEFORE UPDATE ON daily_missions
      WHEN
        NEW.profile_id != OLD.profile_id
        OR NEW.mission_date != OLD.mission_date
        OR NEW.slot != OLD.slot
        OR (
          NEW.reroll_count != OLD.reroll_count
          AND NOT (
            OLD.reroll_count = 0
            AND NEW.reroll_count = 1
            AND OLD.completed_at IS NULL
            AND OLD.rewarded_at IS NULL
            AND NEW.mission_id != OLD.mission_id
            AND NEW.progress = 0
            AND NEW.completed_at IS NULL
            AND NEW.rewarded_at IS NULL
          )
        )
        OR (
          (
            NEW.mission_id != OLD.mission_id
            OR NEW.target != OLD.target
            OR NEW.assigned_at != OLD.assigned_at
          )
          AND NOT (OLD.reroll_count = 0 AND NEW.reroll_count = 1)
        )
        OR (
          NEW.progress < OLD.progress
          AND NOT (
            OLD.reroll_count = 0
            AND NEW.reroll_count = 1
            AND OLD.completed_at IS NULL
            AND OLD.rewarded_at IS NULL
            AND NEW.mission_id != OLD.mission_id
            AND NEW.progress = 0
            AND NEW.completed_at IS NULL
            AND NEW.rewarded_at IS NULL
          )
        )
        OR (
          (OLD.completed_at IS NOT NULL OR OLD.rewarded_at IS NOT NULL)
          AND (
            NEW.completed_at IS NOT OLD.completed_at
            OR NEW.rewarded_at IS NOT OLD.rewarded_at
          )
        )
        OR NEW.balance_version != 1
        OR NOT (
          (NEW.mission_id = 'COMPLETE_HANDS_ANY_10' AND NEW.target = 10)
          OR (NEW.mission_id = 'COMPLETE_HANDS_CASH_10' AND NEW.target = 10)
          OR (NEW.mission_id = 'COMPLETE_HANDS_PRACTICE_10' AND NEW.target = 10)
          OR (NEW.mission_id = 'COMPLETE_HANDS_ANY_20' AND NEW.target = 20)
          OR (NEW.mission_id = 'COMPLETE_ONE_SNG' AND NEW.target = 1)
          OR (NEW.mission_id = 'COMPLETE_TWO_MODES' AND NEW.target = 2)
        )
        OR NEW.progress > NEW.target
        OR NEW.reroll_count NOT IN (0, 1)
        OR (
          (NEW.progress < NEW.target AND (
            NEW.completed_at IS NOT NULL OR NEW.rewarded_at IS NOT NULL
          ))
          OR (NEW.progress = NEW.target AND (
            NEW.completed_at IS NULL
            OR NEW.rewarded_at IS NULL
            OR NEW.rewarded_at != NEW.completed_at
          ))
        )
        OR (
          NEW.reroll_count = 1
          AND EXISTS (
            SELECT 1 FROM daily_missions
            WHERE profile_id = NEW.profile_id
              AND mission_date = NEW.mission_date
              AND reroll_count = 1
              AND slot != OLD.slot
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid daily mission');
      END;
    `,
  },
  {
    version: 7,
    name: 'durable_streak_daily_progress',
    sql: `
      CREATE TABLE v7_streak_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      INSERT INTO v7_streak_validation (invalid)
      SELECT 1
      FROM streak_state AS streak
      JOIN progression_profiles AS profile
        ON profile.profile_id = streak.profile_id
      WHERE
        (streak.current_streak = 0) != (streak.last_qualified_date IS NULL)
        OR streak.current_streak > profile.best_streak
        OR (
          streak.last_week_key IS NOT NULL
          AND CAST(substr(streak.last_week_key, 7, 2) AS INTEGER) = 53
          AND NOT (
            strftime(
              '%w', substr(streak.last_week_key, 1, 4) || '-01-01'
            ) = '4'
            OR (
              strftime(
                '%w', substr(streak.last_week_key, 1, 4) || '-01-01'
              ) = '3'
              AND (
                CAST(substr(streak.last_week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(streak.last_week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(streak.last_week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
      LIMIT 1;

      INSERT INTO v7_streak_validation (invalid)
      SELECT 1
      FROM (
        SELECT profile.profile_id
        FROM progression_profiles AS profile
        LEFT JOIN streak_state AS streak
          ON streak.profile_id = profile.profile_id
        WHERE streak.profile_id IS NULL
        UNION ALL
        SELECT streak.profile_id
        FROM streak_state AS streak
        LEFT JOIN progression_profiles AS profile
          ON profile.profile_id = streak.profile_id
        WHERE profile.profile_id IS NULL
      )
      LIMIT 1;

      DROP TABLE v7_streak_validation;

      CREATE TABLE streak_daily_progress (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        kst_date TEXT NOT NULL CHECK (
          length(kst_date) = 10
          AND kst_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND CAST(substr(kst_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
          AND COALESCE(date(kst_date, '+0 days') = kst_date, 0)
        ),
        hands INTEGER NOT NULL CHECK (hands BETWEEN 0 AND 10),
        sngs INTEGER NOT NULL CHECK (sngs BETWEEN 0 AND 1),
        qualified_at INTEGER CHECK (qualified_at IS NULL OR qualified_at >= 0),
        PRIMARY KEY (profile_id, kst_date),
        CHECK (
          (qualified_at IS NULL AND hands < 10 AND sngs = 0)
          OR (
            qualified_at IS NOT NULL
            AND (hands = 10 OR sngs = 1)
          )
        )
      ) STRICT;

      CREATE INDEX idx_streak_daily_progress_date_profile
        ON streak_daily_progress(kst_date, profile_id);

      CREATE TRIGGER validate_streak_daily_progress_update
      BEFORE UPDATE ON streak_daily_progress
      WHEN
        NEW.profile_id != OLD.profile_id
        OR NEW.kst_date != OLD.kst_date
        OR NEW.hands < OLD.hands
        OR NEW.sngs < OLD.sngs
        OR (
          OLD.qualified_at IS NOT NULL
          AND NEW.qualified_at IS NOT OLD.qualified_at
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak daily progress');
      END;

      CREATE TRIGGER validate_streak_state_insert
      BEFORE INSERT ON streak_state
      WHEN
        (NEW.current_streak = 0) != (NEW.last_qualified_date IS NULL)
        OR (
          NEW.last_week_key IS NOT NULL
          AND CAST(substr(NEW.last_week_key, 7, 2) AS INTEGER) = 53
          AND NOT (
            strftime('%w', substr(NEW.last_week_key, 1, 4) || '-01-01') = '4'
            OR (
              strftime('%w', substr(NEW.last_week_key, 1, 4) || '-01-01') = '3'
              AND (
                CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak state');
      END;

      CREATE TRIGGER validate_streak_state_update
      BEFORE UPDATE ON streak_state
      WHEN
        NEW.profile_id != OLD.profile_id
        OR (NEW.current_streak = 0) != (NEW.last_qualified_date IS NULL)
        OR (
          NEW.last_week_key IS NOT NULL
          AND CAST(substr(NEW.last_week_key, 7, 2) AS INTEGER) = 53
          AND NOT (
            strftime('%w', substr(NEW.last_week_key, 1, 4) || '-01-01') = '4'
            OR (
              strftime('%w', substr(NEW.last_week_key, 1, 4) || '-01-01') = '3'
              AND (
                CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
        OR NEW.updated_at < OLD.updated_at
        OR (
          NEW.last_week_key IS NOT OLD.last_week_key
          AND NOT (
            NEW.last_week_key IS NOT NULL
            AND (OLD.last_week_key IS NULL OR NEW.last_week_key > OLD.last_week_key)
            AND NEW.last_qualified_date IS OLD.last_qualified_date
            AND NEW.current_streak = OLD.current_streak
            AND NEW.rest_passes = 1
          )
        )
        OR (
          NEW.last_week_key IS OLD.last_week_key
          AND NEW.last_qualified_date IS OLD.last_qualified_date
          AND (
            NEW.current_streak != OLD.current_streak
            OR NEW.rest_passes != OLD.rest_passes
          )
        )
        OR (
          NEW.last_week_key IS OLD.last_week_key
          AND NEW.last_qualified_date IS NOT OLD.last_qualified_date
          AND NOT (
            (
              OLD.last_qualified_date IS NULL
              AND NEW.last_qualified_date IS NOT NULL
              AND NEW.current_streak = 1
              AND NEW.rest_passes = OLD.rest_passes
            )
            OR (
              OLD.last_qualified_date IS NOT NULL
              AND NEW.last_qualified_date IS NOT NULL
              AND julianday(NEW.last_qualified_date)
                - julianday(OLD.last_qualified_date) = 1
              AND NEW.current_streak = OLD.current_streak + 1
              AND NEW.rest_passes = OLD.rest_passes
            )
            OR (
              OLD.last_qualified_date IS NOT NULL
              AND NEW.last_qualified_date IS NOT NULL
              AND julianday(NEW.last_qualified_date)
                - julianday(OLD.last_qualified_date) = 2
              AND OLD.rest_passes = 1
              AND NEW.current_streak = OLD.current_streak + 1
              AND NEW.rest_passes = 0
            )
            OR (
              OLD.last_qualified_date IS NOT NULL
              AND NEW.last_qualified_date IS NOT NULL
              AND julianday(NEW.last_qualified_date)
                - julianday(OLD.last_qualified_date) >= 2
              AND NOT (
                julianday(NEW.last_qualified_date)
                  - julianday(OLD.last_qualified_date) = 2
                AND OLD.rest_passes = 1
              )
              AND NEW.current_streak = 1
              AND NEW.rest_passes = OLD.rest_passes
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak state');
      END;
    `,
  },
  {
    version: 8,
    name: 'harden_streak_ownership_and_grant_receipts',
    sql: `
      CREATE TABLE v8_progression_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      INSERT INTO v8_progression_validation (invalid)
      SELECT 1 FROM progression_profiles
      WHERE
        balance_version NOT BETWEEN 0 AND 9007199254740991
        OR dojo_level NOT BETWEEN 0 AND 9007199254740991
        OR dojo_xp_milli NOT BETWEEN 0 AND 9007199254740991
        OR practice_hands NOT BETWEEN 0 AND 9007199254740991
        OR completed_hands NOT BETWEEN 0 AND 9007199254740991
        OR cash_hands NOT BETWEEN 0 AND 9007199254740991
        OR practice_hands_total NOT BETWEEN 0 AND 9007199254740991
        OR sng_completions NOT BETWEEN 0 AND 9007199254740991
        OR best_streak NOT BETWEEN 0 AND 9007199254740991
        OR created_at NOT BETWEEN 0 AND 9007199254740991
        OR updated_at NOT BETWEEN 0 AND 9007199254740991
        OR updated_at < created_at
        OR (practice_date IS NULL AND practice_hands != 0)
      LIMIT 1;

      INSERT INTO v8_progression_validation (invalid)
      SELECT 1 FROM streak_state AS streak
      JOIN progression_profiles AS profile
        ON profile.profile_id = streak.profile_id
      WHERE
        streak.current_streak NOT BETWEEN 0 AND 9007199254740991
        OR streak.rest_passes NOT BETWEEN 0 AND 1
        OR streak.created_at NOT BETWEEN 0 AND 9007199254740991
        OR streak.updated_at NOT BETWEEN 0 AND 9007199254740991
        OR streak.updated_at < streak.created_at
        OR streak.current_streak > profile.best_streak
        OR (streak.current_streak = 0) != (streak.last_qualified_date IS NULL)
        OR (
          streak.last_week_key IS NOT NULL
          AND CAST(substr(streak.last_week_key, 7, 2) AS INTEGER) = 53
          AND NOT (
            strftime('%w', substr(streak.last_week_key, 1, 4) || '-01-01') = '4'
            OR (
              strftime('%w', substr(streak.last_week_key, 1, 4) || '-01-01') = '3'
              AND (
                CAST(substr(streak.last_week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(streak.last_week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(streak.last_week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
      LIMIT 1;

      INSERT INTO v8_progression_validation (invalid)
      SELECT 1 FROM (
        SELECT profile.profile_id
        FROM progression_profiles AS profile
        LEFT JOIN streak_state AS streak
          ON streak.profile_id = profile.profile_id
        WHERE streak.profile_id IS NULL
        UNION ALL
        SELECT streak.profile_id
        FROM streak_state AS streak
        LEFT JOIN progression_profiles AS profile
          ON profile.profile_id = streak.profile_id
        WHERE profile.profile_id IS NULL
      )
      LIMIT 1;

      INSERT INTO v8_progression_validation (invalid)
      SELECT 1 FROM streak_daily_progress AS daily
      LEFT JOIN progression_profiles AS profile
        ON profile.profile_id = daily.profile_id
      WHERE
        profile.profile_id IS NULL
        OR daily.hands NOT BETWEEN 0 AND 10
        OR daily.sngs NOT BETWEEN 0 AND 1
        OR (
          daily.qualified_at IS NOT NULL
          AND (
            daily.qualified_at NOT BETWEEN 0 AND 9007199254740991
            OR COALESCE(
              date(daily.qualified_at / 1000.0, 'unixepoch', '+9 hours')
                = daily.kst_date,
              0
            ) = 0
          )
        )
      LIMIT 1;

      INSERT INTO v8_progression_validation (invalid)
      SELECT 1
      FROM progression_events AS fragment
      WHERE fragment.event_type = 'streak-fragment'
        AND (
          json_extract(fragment.summary_json, '$.itemId') != 'streak-fragment'
          OR json_extract(fragment.summary_json, '$.quantity') != 1
          OR fragment.created_at NOT BETWEEN 0 AND 9007199254740991
          OR fragment.idempotency_key != (
            'streak-fragment:' || fragment.profile_id || ':'
            || substr(fragment.idempotency_key, -10)
          )
          OR COALESCE(
            date(substr(fragment.idempotency_key, -10), '+0 days')
              = substr(fragment.idempotency_key, -10),
            0
          ) = 0
          OR date(fragment.created_at / 1000.0, 'unixepoch', '+9 hours')
            != substr(fragment.idempotency_key, -10)
          OR (
            SELECT COUNT(*)
            FROM progression_events AS main
            WHERE main.profile_id = fragment.profile_id
              AND main.event_type IN ('completed-hand', 'sng-finish')
              AND date(main.created_at / 1000.0, 'unixepoch', '+9 hours')
                = substr(fragment.idempotency_key, -10)
              AND json_extract(main.summary_json, '$.streak.currentStreak') % 7 = 0
              AND EXISTS (
                SELECT 1
                FROM json_each(main.summary_json, '$.grantedItemIds')
                WHERE value = 'streak-fragment'
              )
          ) != 1
          OR NOT EXISTS (
            SELECT 1 FROM inventory_items AS inventory
            WHERE inventory.profile_id = fragment.profile_id
              AND inventory.item_id = 'streak-fragment'
              AND inventory.quantity = (
                SELECT COUNT(*) FROM progression_events AS sibling
                WHERE sibling.profile_id = fragment.profile_id
                  AND sibling.event_type = 'streak-fragment'
              )
          )
        )
      LIMIT 1;

      INSERT INTO v8_progression_validation (invalid)
      SELECT 1 FROM inventory_items AS inventory
      WHERE inventory.item_id = 'streak-fragment'
        AND (
          inventory.quantity != (
            SELECT COUNT(*) FROM progression_events AS fragment
            WHERE fragment.profile_id = inventory.profile_id
              AND fragment.event_type = 'streak-fragment'
          )
          OR inventory.granted_at NOT BETWEEN 0 AND 9007199254740991
          OR inventory.updated_at NOT BETWEEN inventory.granted_at
            AND 9007199254740991
        )
      LIMIT 1;

      INSERT INTO v8_progression_validation (invalid)
      SELECT 1 FROM progression_events AS main
      WHERE main.event_type IN ('completed-hand', 'sng-finish')
        AND EXISTS (
          SELECT 1 FROM json_each(main.summary_json, '$.grantedItemIds')
          WHERE value = 'streak-fragment'
        )
        AND (
          SELECT COUNT(*) FROM progression_events AS fragment
          WHERE fragment.profile_id = main.profile_id
            AND fragment.event_type = 'streak-fragment'
            AND substr(fragment.idempotency_key, -10)
              = date(main.created_at / 1000.0, 'unixepoch', '+9 hours')
        ) != 1
      LIMIT 1;

      DROP TRIGGER validate_streak_daily_progress_update;
      DROP TRIGGER validate_streak_state_insert;
      DROP TRIGGER validate_streak_state_update;
      DROP INDEX idx_streak_daily_progress_date_profile;

      ALTER TABLE streak_state RENAME TO streak_state_v7_backup;
      ALTER TABLE streak_daily_progress
        RENAME TO streak_daily_progress_v7_backup;

      CREATE TABLE streak_state (
        profile_id TEXT PRIMARY KEY
          REFERENCES progression_profiles(profile_id) ON DELETE CASCADE,
        current_streak INTEGER NOT NULL CHECK (
          current_streak BETWEEN 0 AND 9007199254740991
        ),
        rest_passes INTEGER NOT NULL CHECK (rest_passes BETWEEN 0 AND 1),
        last_qualified_date TEXT CHECK (
          last_qualified_date IS NULL OR (
            length(last_qualified_date) = 10
            AND last_qualified_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND CAST(substr(last_qualified_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
            AND COALESCE(date(last_qualified_date, '+0 days') = last_qualified_date, 0)
          )
        ),
        last_week_key TEXT CHECK (
          last_week_key IS NULL OR (
            length(last_week_key) = 8
            AND last_week_key GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'
            AND CAST(substr(last_week_key, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
            AND CAST(substr(last_week_key, 7, 2) AS INTEGER) BETWEEN 1 AND 53
          )
        ),
        created_at INTEGER NOT NULL CHECK (
          created_at BETWEEN 0 AND 9007199254740991
        ),
        updated_at INTEGER NOT NULL CHECK (
          updated_at BETWEEN created_at AND 9007199254740991
        ),
        CHECK ((current_streak = 0) = (last_qualified_date IS NULL))
      ) STRICT;

      INSERT INTO streak_state SELECT * FROM streak_state_v7_backup;

      CREATE TABLE streak_daily_progress (
        profile_id TEXT NOT NULL
          REFERENCES progression_profiles(profile_id) ON DELETE CASCADE,
        kst_date TEXT NOT NULL CHECK (
          length(kst_date) = 10
          AND kst_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND CAST(substr(kst_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
          AND COALESCE(date(kst_date, '+0 days') = kst_date, 0)
        ),
        hands INTEGER NOT NULL CHECK (hands BETWEEN 0 AND 10),
        sngs INTEGER NOT NULL CHECK (sngs BETWEEN 0 AND 1),
        qualified_at INTEGER CHECK (
          qualified_at IS NULL OR (
            qualified_at BETWEEN 0 AND 9007199254740991
            AND COALESCE(
              date(qualified_at / 1000.0, 'unixepoch', '+9 hours') = kst_date,
              0
            )
          )
        ),
        PRIMARY KEY (profile_id, kst_date),
        CHECK (
          (qualified_at IS NULL AND hands < 10 AND sngs = 0)
          OR (qualified_at IS NOT NULL AND (hands = 10 OR sngs = 1))
        )
      ) STRICT;

      INSERT INTO streak_daily_progress
        SELECT * FROM streak_daily_progress_v7_backup;

      DROP TABLE streak_daily_progress_v7_backup;
      DROP TABLE streak_state_v7_backup;

      CREATE INDEX idx_streak_daily_progress_date_profile
        ON streak_daily_progress(kst_date, profile_id);

      CREATE TABLE progression_item_grants (
        idempotency_key TEXT PRIMARY KEY CHECK (length(idempotency_key) > 0),
        profile_id TEXT NOT NULL
          REFERENCES progression_profiles(profile_id) ON DELETE CASCADE,
        item_id TEXT NOT NULL CHECK (item_id = 'streak-fragment'),
        source TEXT NOT NULL CHECK (source = 'streak'),
        source_ref TEXT NOT NULL CHECK (length(source_ref) > 0),
        source_date TEXT NOT NULL CHECK (
          length(source_date) = 10
          AND source_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND CAST(substr(source_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
          AND COALESCE(date(source_date, '+0 days') = source_date, 0)
        ),
        quantity INTEGER NOT NULL CHECK (quantity = 1),
        granted_at INTEGER NOT NULL CHECK (
          granted_at BETWEEN 0 AND 9007199254740991
          AND COALESCE(
            date(granted_at / 1000.0, 'unixepoch', '+9 hours') = source_date,
            0
          )
        ),
        UNIQUE (profile_id, item_id, source, source_ref),
        UNIQUE (profile_id, item_id, source, source_date),
        FOREIGN KEY (source_ref)
          REFERENCES progression_events(idempotency_key)
          ON DELETE RESTRICT
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;

      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_date, quantity, granted_at
      )
      SELECT
        fragment.idempotency_key,
        fragment.profile_id,
        'streak-fragment',
        'streak',
        (
          SELECT main.idempotency_key
          FROM progression_events AS main
          WHERE main.profile_id = fragment.profile_id
            AND main.event_type IN ('completed-hand', 'sng-finish')
            AND date(main.created_at / 1000.0, 'unixepoch', '+9 hours')
              = substr(fragment.idempotency_key, -10)
            AND json_extract(main.summary_json, '$.streak.currentStreak') % 7 = 0
            AND EXISTS (
              SELECT 1 FROM json_each(main.summary_json, '$.grantedItemIds')
              WHERE value = 'streak-fragment'
            )
        ),
        substr(fragment.idempotency_key, -10),
        1,
        fragment.created_at
      FROM progression_events AS fragment
      WHERE fragment.event_type = 'streak-fragment';

      DELETE FROM progression_events WHERE event_type = 'streak-fragment';
      DROP TABLE v8_progression_validation;

      CREATE TRIGGER validate_progression_profile_safe_insert
      BEFORE INSERT ON progression_profiles
      WHEN
        NEW.balance_version NOT BETWEEN 0 AND 9007199254740991
        OR NEW.dojo_level NOT BETWEEN 0 AND 9007199254740991
        OR NEW.dojo_xp_milli NOT BETWEEN 0 AND 9007199254740991
        OR NEW.practice_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.completed_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.cash_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.practice_hands_total NOT BETWEEN 0 AND 9007199254740991
        OR NEW.sng_completions NOT BETWEEN 0 AND 9007199254740991
        OR NEW.best_streak NOT BETWEEN 0 AND 9007199254740991
        OR NEW.created_at NOT BETWEEN 0 AND 9007199254740991
        OR NEW.updated_at NOT BETWEEN NEW.created_at AND 9007199254740991
        OR (NEW.practice_date IS NULL AND NEW.practice_hands != 0)
      BEGIN
        SELECT RAISE(ABORT, 'unsafe progression profile');
      END;

      CREATE TRIGGER validate_progression_profile_safe_update
      BEFORE UPDATE ON progression_profiles
      WHEN
        NEW.balance_version NOT BETWEEN 0 AND 9007199254740991
        OR NEW.dojo_level NOT BETWEEN 0 AND 9007199254740991
        OR NEW.dojo_xp_milli NOT BETWEEN 0 AND 9007199254740991
        OR NEW.practice_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.completed_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.cash_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.practice_hands_total NOT BETWEEN 0 AND 9007199254740991
        OR NEW.sng_completions NOT BETWEEN 0 AND 9007199254740991
        OR NEW.best_streak NOT BETWEEN 0 AND 9007199254740991
        OR NEW.created_at NOT BETWEEN 0 AND 9007199254740991
        OR NEW.updated_at NOT BETWEEN NEW.created_at AND 9007199254740991
        OR (NEW.practice_date IS NULL AND NEW.practice_hands != 0)
      BEGIN
        SELECT RAISE(ABORT, 'unsafe progression profile');
      END;

      CREATE TRIGGER create_progression_streak_state
      AFTER INSERT ON progression_profiles
      BEGIN
        INSERT INTO streak_state (
          profile_id, current_streak, rest_passes, last_qualified_date,
          last_week_key, created_at, updated_at
        ) VALUES (NEW.profile_id, 0, 0, NULL, NULL, NEW.created_at, NEW.updated_at);
      END;

      CREATE TRIGGER cleanup_orphaned_progression_after_streak_delete
      AFTER DELETE ON streak_state
      WHEN EXISTS (
        SELECT 1 FROM progression_profiles WHERE profile_id = OLD.profile_id
      )
      BEGIN
        DELETE FROM progression_profiles WHERE profile_id = OLD.profile_id;
      END;

      CREATE TRIGGER validate_streak_state_insert_v8
      BEFORE INSERT ON streak_state
      WHEN
        NEW.current_streak NOT BETWEEN 0 AND 9007199254740991
        OR NEW.rest_passes NOT BETWEEN 0 AND 1
        OR NEW.created_at NOT BETWEEN 0 AND 9007199254740991
        OR NEW.updated_at NOT BETWEEN NEW.created_at AND 9007199254740991
        OR (NEW.current_streak = 0) != (NEW.last_qualified_date IS NULL)
        OR (
          NEW.last_week_key IS NOT NULL
          AND CAST(substr(NEW.last_week_key, 7, 2) AS INTEGER) = 53
          AND NOT (
            strftime('%w', substr(NEW.last_week_key, 1, 4) || '-01-01') = '4'
            OR (
              strftime('%w', substr(NEW.last_week_key, 1, 4) || '-01-01') = '3'
              AND (
                CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak state');
      END;

      CREATE TRIGGER validate_streak_state_update_v8
      BEFORE UPDATE ON streak_state
      WHEN
        NEW.profile_id != OLD.profile_id
        OR NEW.current_streak NOT BETWEEN 0 AND 9007199254740991
        OR NEW.rest_passes NOT BETWEEN 0 AND 1
        OR NEW.created_at != OLD.created_at
        OR NEW.updated_at NOT BETWEEN NEW.created_at AND 9007199254740991
        OR (NEW.current_streak = 0) != (NEW.last_qualified_date IS NULL)
        OR (
          NEW.last_week_key IS NOT NULL
          AND CAST(substr(NEW.last_week_key, 7, 2) AS INTEGER) = 53
          AND NOT (
            strftime('%w', substr(NEW.last_week_key, 1, 4) || '-01-01') = '4'
            OR (
              strftime('%w', substr(NEW.last_week_key, 1, 4) || '-01-01') = '3'
              AND (
                CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(NEW.last_week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
        OR (
          NEW.last_week_key IS NOT OLD.last_week_key
          AND NOT (
            NEW.last_week_key IS NOT NULL
            AND (OLD.last_week_key IS NULL OR NEW.last_week_key > OLD.last_week_key)
            AND NEW.last_qualified_date IS OLD.last_qualified_date
            AND NEW.current_streak = OLD.current_streak
            AND NEW.rest_passes = 1
          )
        )
        OR (
          NEW.last_week_key IS OLD.last_week_key
          AND NEW.last_qualified_date IS OLD.last_qualified_date
          AND (
            NEW.current_streak != OLD.current_streak
            OR NEW.rest_passes != OLD.rest_passes
          )
        )
        OR (
          NEW.last_week_key IS OLD.last_week_key
          AND NEW.last_qualified_date IS NOT OLD.last_qualified_date
          AND NOT (
            (
              OLD.last_qualified_date IS NULL
              AND NEW.last_qualified_date IS NOT NULL
              AND NEW.current_streak = 1
              AND NEW.rest_passes = OLD.rest_passes
            )
            OR (
              OLD.last_qualified_date IS NOT NULL
              AND NEW.last_qualified_date IS NOT NULL
              AND julianday(NEW.last_qualified_date) - julianday(OLD.last_qualified_date) = 1
              AND NEW.current_streak = OLD.current_streak + 1
              AND NEW.rest_passes = OLD.rest_passes
            )
            OR (
              OLD.last_qualified_date IS NOT NULL
              AND NEW.last_qualified_date IS NOT NULL
              AND julianday(NEW.last_qualified_date) - julianday(OLD.last_qualified_date) = 2
              AND OLD.rest_passes = 1
              AND NEW.current_streak = OLD.current_streak + 1
              AND NEW.rest_passes = 0
            )
            OR (
              OLD.last_qualified_date IS NOT NULL
              AND NEW.last_qualified_date IS NOT NULL
              AND julianday(NEW.last_qualified_date) - julianday(OLD.last_qualified_date) >= 2
              AND NOT (
                julianday(NEW.last_qualified_date) - julianday(OLD.last_qualified_date) = 2
                AND OLD.rest_passes = 1
              )
              AND NEW.current_streak = 1
              AND NEW.rest_passes = OLD.rest_passes
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak state');
      END;

      CREATE TRIGGER validate_streak_daily_insert_v8
      BEFORE INSERT ON streak_daily_progress
      WHEN NOT (
        (NEW.hands = 1 AND NEW.sngs = 0 AND NEW.qualified_at IS NULL)
        OR (NEW.hands = 0 AND NEW.sngs = 1 AND NEW.qualified_at IS NOT NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak daily transition');
      END;

      CREATE TRIGGER validate_streak_daily_update_v8
      BEFORE UPDATE ON streak_daily_progress
      WHEN
        NEW.profile_id != OLD.profile_id
        OR NEW.kst_date != OLD.kst_date
        OR NOT (
          (
            OLD.hands < 10
            AND NEW.hands = OLD.hands + 1
            AND NEW.sngs = OLD.sngs
            AND (
              (OLD.qualified_at IS NOT NULL AND NEW.qualified_at IS OLD.qualified_at)
              OR (
                OLD.qualified_at IS NULL
                AND (
                  (NEW.hands < 10 AND NEW.qualified_at IS NULL)
                  OR (NEW.hands = 10 AND NEW.qualified_at IS NOT NULL)
                )
              )
            )
          )
          OR (
            OLD.sngs = 0
            AND NEW.sngs = 1
            AND NEW.hands = OLD.hands
            AND (
              (OLD.qualified_at IS NOT NULL AND NEW.qualified_at IS OLD.qualified_at)
              OR (OLD.qualified_at IS NULL AND NEW.qualified_at IS NOT NULL)
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak daily transition');
      END;

      CREATE TRIGGER validate_fragment_inventory_insert
      BEFORE INSERT ON inventory_items
      WHEN NEW.item_id = 'streak-fragment'
        AND (
          NEW.quantity != (
            SELECT COUNT(*) FROM progression_item_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id
          )
          OR NEW.granted_at NOT BETWEEN 0 AND 9007199254740991
          OR NEW.updated_at NOT BETWEEN NEW.granted_at AND 9007199254740991
        )
      BEGIN
        SELECT RAISE(ABORT, 'fragment inventory receipt mismatch');
      END;

      CREATE TRIGGER validate_fragment_inventory_update
      BEFORE UPDATE ON inventory_items
      WHEN NEW.item_id = 'streak-fragment'
        AND (
          NEW.quantity != (
            SELECT COUNT(*) FROM progression_item_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id
          )
          OR NEW.granted_at NOT BETWEEN 0 AND 9007199254740991
          OR NEW.updated_at NOT BETWEEN NEW.granted_at AND 9007199254740991
        )
      BEGIN
        SELECT RAISE(ABORT, 'fragment inventory receipt mismatch');
      END;

      CREATE TRIGGER sync_fragment_inventory_insert
      AFTER INSERT ON progression_item_grants
      BEGIN
        INSERT INTO inventory_items (
          profile_id, item_id, quantity, granted_at, updated_at
        ) VALUES (
          NEW.profile_id, NEW.item_id,
          (SELECT COUNT(*) FROM progression_item_grants
           WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id),
          NEW.granted_at, NEW.granted_at
        )
        ON CONFLICT(profile_id, item_id) DO UPDATE SET
          quantity = excluded.quantity,
          updated_at = MAX(inventory_items.updated_at, excluded.updated_at);
      END;

      CREATE TRIGGER reject_fragment_grant_update
      BEFORE UPDATE ON progression_item_grants
      BEGIN
        SELECT RAISE(ABORT, 'immutable progression item grant');
      END;

      CREATE TRIGGER reject_fragment_grant_delete
      BEFORE DELETE ON progression_item_grants
      WHEN EXISTS (
        SELECT 1 FROM progression_profiles WHERE profile_id = OLD.profile_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'immutable progression item grant');
      END;

      CREATE TRIGGER sync_fragment_inventory_delete
      AFTER DELETE ON progression_item_grants
      BEGIN
        DELETE FROM inventory_items
        WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
          AND NOT EXISTS (
            SELECT 1 FROM progression_item_grants
            WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
          );
        UPDATE inventory_items
        SET quantity = (
          SELECT COUNT(*) FROM progression_item_grants
          WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
        )
        WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id;
      END;
    `,
  },
  {
    version: 9,
    name: 'repair_streak_children_and_canonicalize_grant_sources',
    sql: `
      CREATE TABLE v9_progression_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      INSERT INTO v9_progression_validation (invalid)
      SELECT 1 FROM progression_profiles
      WHERE created_at NOT BETWEEN 0 AND 253402300799999
        OR updated_at NOT BETWEEN created_at AND 253402300799999
      LIMIT 1;

      INSERT INTO v9_progression_validation (invalid)
      SELECT 1 FROM streak_state
      WHERE created_at NOT BETWEEN 0 AND 253402300799999
        OR updated_at NOT BETWEEN created_at AND 253402300799999
      LIMIT 1;

      INSERT INTO v9_progression_validation (invalid)
      SELECT 1 FROM streak_daily_progress
      WHERE qualified_at IS NOT NULL
        AND qualified_at NOT BETWEEN 0 AND 253402300799999
      LIMIT 1;

      INSERT INTO v9_progression_validation (invalid)
      SELECT 1 FROM inventory_items
      WHERE item_id = 'streak-fragment'
        AND (
          granted_at NOT BETWEEN 0 AND 253402300799999
          OR updated_at NOT BETWEEN granted_at AND 253402300799999
        )
      LIMIT 1;

      INSERT INTO v9_progression_validation (invalid)
      SELECT 1
      FROM progression_item_grants AS grant_row
      LEFT JOIN progression_events AS source_event
        ON source_event.idempotency_key = grant_row.source_ref
      LEFT JOIN streak_daily_progress AS daily
        ON daily.profile_id = grant_row.profile_id
        AND daily.kst_date = grant_row.source_date
      WHERE
        grant_row.granted_at NOT BETWEEN 0 AND 253402300799999
        OR grant_row.idempotency_key != (
          'streak-fragment:' || grant_row.profile_id || ':' || grant_row.source_date
        )
        OR grant_row.item_id != 'streak-fragment'
        OR grant_row.source != 'streak'
        OR grant_row.quantity != 1
        OR source_event.idempotency_key IS NULL
        OR source_event.profile_id != grant_row.profile_id
        OR source_event.event_type NOT IN ('completed-hand', 'sng-finish')
        OR source_event.created_at != grant_row.granted_at
        OR source_event.created_at NOT BETWEEN 0 AND 253402300799999
        OR daily.qualified_at IS NULL
        OR daily.qualified_at != grant_row.granted_at
      LIMIT 1;

      DROP TRIGGER cleanup_orphaned_progression_after_streak_delete;
      DROP TRIGGER validate_progression_profile_safe_insert;
      DROP TRIGGER validate_progression_profile_safe_update;
      DROP TRIGGER validate_fragment_inventory_insert;
      DROP TRIGGER validate_fragment_inventory_update;
      DROP TRIGGER sync_fragment_inventory_insert;
      DROP TRIGGER reject_fragment_grant_update;
      DROP TRIGGER reject_fragment_grant_delete;
      DROP TRIGGER sync_fragment_inventory_delete;

      CREATE UNIQUE INDEX progression_event_profile_identity
        ON progression_events(idempotency_key, profile_id);

      ALTER TABLE progression_item_grants
        RENAME TO progression_item_grants_v8_backup;

      CREATE TABLE progression_item_grants (
        idempotency_key TEXT PRIMARY KEY CHECK (
          idempotency_key = source_ref
        ),
        profile_id TEXT NOT NULL
          REFERENCES progression_profiles(profile_id) ON DELETE CASCADE,
        item_id TEXT NOT NULL CHECK (item_id = 'streak-fragment'),
        source TEXT NOT NULL CHECK (source = 'streak'),
        source_ref TEXT NOT NULL CHECK (
          source_ref = (
            'streak-fragment:' || profile_id || ':' || source_date
          )
        ),
        source_event_id TEXT NOT NULL CHECK (length(source_event_id) > 0),
        source_date TEXT NOT NULL CHECK (
          length(source_date) = 10
          AND source_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND CAST(substr(source_date, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
          AND COALESCE(date(source_date, '+0 days') = source_date, 0)
        ),
        quantity INTEGER NOT NULL CHECK (quantity = 1),
        granted_at INTEGER NOT NULL CHECK (
          granted_at BETWEEN 0 AND 253402300799999
          AND COALESCE(
            date(granted_at / 1000.0, 'unixepoch', '+9 hours') = source_date,
            0
          )
        ),
        UNIQUE (profile_id, item_id, source, source_event_id),
        UNIQUE (profile_id, item_id, source, source_date),
        FOREIGN KEY (source_event_id, profile_id)
          REFERENCES progression_events(idempotency_key, profile_id)
          ON DELETE NO ACTION
          DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY (profile_id, source_date)
          REFERENCES streak_daily_progress(profile_id, kst_date)
          ON DELETE NO ACTION
          DEFERRABLE INITIALLY DEFERRED
      ) STRICT;

      INSERT INTO progression_item_grants (
        idempotency_key, profile_id, item_id, source, source_ref,
        source_event_id, source_date, quantity, granted_at
      )
      SELECT
        idempotency_key, profile_id, item_id, source, idempotency_key,
        source_ref, source_date, quantity, granted_at
      FROM progression_item_grants_v8_backup;

      DROP TABLE progression_item_grants_v8_backup;
      DROP TABLE v9_progression_validation;

      CREATE TRIGGER validate_progression_profile_safe_insert
      BEFORE INSERT ON progression_profiles
      WHEN
        NEW.balance_version NOT BETWEEN 0 AND 9007199254740991
        OR NEW.dojo_level NOT BETWEEN 0 AND 9007199254740991
        OR NEW.dojo_xp_milli NOT BETWEEN 0 AND 9007199254740991
        OR NEW.practice_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.completed_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.cash_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.practice_hands_total NOT BETWEEN 0 AND 9007199254740991
        OR NEW.sng_completions NOT BETWEEN 0 AND 9007199254740991
        OR NEW.best_streak NOT BETWEEN 0 AND 9007199254740991
        OR NEW.created_at NOT BETWEEN 0 AND 253402300799999
        OR NEW.updated_at NOT BETWEEN NEW.created_at AND 253402300799999
        OR (NEW.practice_date IS NULL AND NEW.practice_hands != 0)
      BEGIN
        SELECT RAISE(ABORT, 'unsafe progression profile');
      END;

      CREATE TRIGGER validate_progression_profile_safe_update
      BEFORE UPDATE ON progression_profiles
      WHEN
        NEW.balance_version NOT BETWEEN 0 AND 9007199254740991
        OR NEW.dojo_level NOT BETWEEN 0 AND 9007199254740991
        OR NEW.dojo_xp_milli NOT BETWEEN 0 AND 9007199254740991
        OR NEW.practice_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.completed_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.cash_hands NOT BETWEEN 0 AND 9007199254740991
        OR NEW.practice_hands_total NOT BETWEEN 0 AND 9007199254740991
        OR NEW.sng_completions NOT BETWEEN 0 AND 9007199254740991
        OR NEW.best_streak NOT BETWEEN 0 AND 9007199254740991
        OR NEW.created_at NOT BETWEEN 0 AND 253402300799999
        OR NEW.updated_at NOT BETWEEN NEW.created_at AND 253402300799999
        OR (NEW.practice_date IS NULL AND NEW.practice_hands != 0)
      BEGIN
        SELECT RAISE(ABORT, 'unsafe progression profile');
      END;

      CREATE TRIGGER validate_streak_service_time_insert
      BEFORE INSERT ON streak_state
      WHEN NEW.created_at NOT BETWEEN 0 AND 253402300799999
        OR NEW.updated_at NOT BETWEEN NEW.created_at AND 253402300799999
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak service time');
      END;

      CREATE TRIGGER validate_streak_service_time_update
      BEFORE UPDATE ON streak_state
      WHEN NEW.created_at NOT BETWEEN 0 AND 253402300799999
        OR NEW.updated_at NOT BETWEEN NEW.created_at AND 253402300799999
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak service time');
      END;

      CREATE TRIGGER validate_daily_service_time_insert
      BEFORE INSERT ON streak_daily_progress
      WHEN NEW.qualified_at IS NOT NULL
        AND NEW.qualified_at NOT BETWEEN 0 AND 253402300799999
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak daily service time');
      END;

      CREATE TRIGGER validate_daily_service_time_update
      BEFORE UPDATE ON streak_daily_progress
      WHEN NEW.qualified_at IS NOT NULL
        AND NEW.qualified_at NOT BETWEEN 0 AND 253402300799999
      BEGIN
        SELECT RAISE(ABORT, 'invalid streak daily service time');
      END;

      CREATE TRIGGER validate_progression_item_grant_insert
      BEFORE INSERT ON progression_item_grants
      WHEN
        NEW.idempotency_key != (
          'streak-fragment:' || NEW.profile_id || ':' || NEW.source_date
        )
        OR NEW.source_ref != NEW.idempotency_key
        OR NEW.item_id != 'streak-fragment'
        OR NEW.source != 'streak'
        OR NEW.quantity != 1
        OR NEW.granted_at NOT BETWEEN 0 AND 253402300799999
        OR NOT EXISTS (
          SELECT 1 FROM streak_daily_progress AS daily
          WHERE daily.profile_id = NEW.profile_id
            AND daily.kst_date = NEW.source_date
            AND daily.qualified_at = NEW.granted_at
        )
        OR (
          EXISTS (
            SELECT 1 FROM progression_events
            WHERE idempotency_key = NEW.source_event_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM progression_events AS source_event
            WHERE source_event.idempotency_key = NEW.source_event_id
              AND source_event.profile_id = NEW.profile_id
              AND source_event.event_type IN ('completed-hand', 'sng-finish')
              AND source_event.created_at = NEW.granted_at
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid progression item grant source');
      END;

      CREATE TRIGGER validate_fragment_source_event_insert
      BEFORE INSERT ON progression_events
      WHEN EXISTS (
        SELECT 1 FROM progression_item_grants AS grant_row
        WHERE grant_row.source_event_id = NEW.idempotency_key
          AND (
            grant_row.profile_id != NEW.profile_id
            OR NEW.event_type NOT IN ('completed-hand', 'sng-finish')
            OR grant_row.granted_at != NEW.created_at
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid fragment source event');
      END;

      CREATE TRIGGER reject_fragment_source_event_update
      BEFORE UPDATE ON progression_events
      WHEN EXISTS (
        SELECT 1 FROM progression_item_grants
        WHERE source_event_id = OLD.idempotency_key
      )
      BEGIN
        SELECT RAISE(ABORT, 'immutable fragment source event');
      END;

      CREATE TRIGGER validate_fragment_inventory_insert
      BEFORE INSERT ON inventory_items
      WHEN NEW.item_id = 'streak-fragment'
        AND (
          NEW.quantity != (
            SELECT COUNT(*) FROM progression_item_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id
          )
          OR NEW.granted_at != (
            SELECT MIN(granted_at) FROM progression_item_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id
          )
          OR NEW.updated_at != (
            SELECT MAX(granted_at) FROM progression_item_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id
          )
          OR NEW.granted_at NOT BETWEEN 0 AND 253402300799999
          OR NEW.updated_at NOT BETWEEN NEW.granted_at AND 253402300799999
        )
      BEGIN
        SELECT RAISE(ABORT, 'fragment inventory receipt mismatch');
      END;

      CREATE TRIGGER validate_fragment_inventory_update
      BEFORE UPDATE ON inventory_items
      WHEN
        OLD.item_id = 'streak-fragment'
        OR NEW.item_id = 'streak-fragment'
      BEGIN
        SELECT CASE WHEN
          NEW.profile_id != OLD.profile_id
          OR NEW.item_id != OLD.item_id
          OR NEW.quantity != (
            SELECT COUNT(*) FROM progression_item_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id
          )
          OR NEW.granted_at != (
            SELECT MIN(granted_at) FROM progression_item_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id
          )
          OR NEW.updated_at != (
            SELECT MAX(granted_at) FROM progression_item_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id
          )
          OR NEW.granted_at NOT BETWEEN 0 AND 253402300799999
          OR NEW.updated_at NOT BETWEEN NEW.granted_at AND 253402300799999
        THEN RAISE(ABORT, 'fragment inventory receipt mismatch') END;
      END;

      CREATE TRIGGER validate_fragment_inventory_delete
      BEFORE DELETE ON inventory_items
      WHEN OLD.item_id = 'streak-fragment'
        AND EXISTS (
          SELECT 1 FROM progression_item_grants
          WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
        )
        AND EXISTS (
          SELECT 1 FROM profiles WHERE id = OLD.profile_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'fragment inventory receipt mismatch');
      END;

      CREATE TRIGGER sync_fragment_inventory_insert
      AFTER INSERT ON progression_item_grants
      BEGIN
        INSERT INTO inventory_items (
          profile_id, item_id, quantity, granted_at, updated_at
        ) VALUES (
          NEW.profile_id, NEW.item_id,
          (SELECT COUNT(*) FROM progression_item_grants
           WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id),
          (SELECT MIN(granted_at) FROM progression_item_grants
           WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id),
          (SELECT MAX(granted_at) FROM progression_item_grants
           WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id)
        )
        ON CONFLICT(profile_id, item_id) DO UPDATE SET
          quantity = excluded.quantity,
          granted_at = excluded.granted_at,
          updated_at = excluded.updated_at;
      END;

      CREATE TRIGGER reject_fragment_grant_update
      BEFORE UPDATE ON progression_item_grants
      BEGIN
        SELECT RAISE(ABORT, 'immutable progression item grant');
      END;

      CREATE TRIGGER reject_fragment_grant_delete
      BEFORE DELETE ON progression_item_grants
      WHEN EXISTS (
        SELECT 1 FROM progression_profiles WHERE profile_id = OLD.profile_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'immutable progression item grant');
      END;

      CREATE TRIGGER sync_fragment_inventory_delete
      AFTER DELETE ON progression_item_grants
      BEGIN
        DELETE FROM inventory_items
        WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
          AND NOT EXISTS (
            SELECT 1 FROM progression_item_grants
            WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
          );
        UPDATE inventory_items
        SET
          quantity = (
            SELECT COUNT(*) FROM progression_item_grants
            WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
          ),
          granted_at = (
            SELECT MIN(granted_at) FROM progression_item_grants
            WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
          ),
          updated_at = (
            SELECT MAX(granted_at) FROM progression_item_grants
            WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
          )
        WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id;
      END;
    `,
  },
  {
    version: 10,
    name: 'prove_fragment_sources_and_protect_progression_root',
    sql: `
      CREATE TABLE v10_progression_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      CREATE VIEW canonical_streak_fragment_source_events AS
      SELECT
        source_event.idempotency_key,
        source_event.profile_id,
        source_event.created_at
      FROM progression_events AS source_event
      WHERE
        source_event.event_type IN ('completed-hand', 'sng-finish')
        AND source_event.balance_version = 1
        AND json_valid(source_event.summary_json)
        AND json_type(source_event.summary_json) = 'object'
        AND (
          SELECT COUNT(*) FROM json_each(source_event.summary_json)
        ) = 9
        AND (
          SELECT COUNT(DISTINCT summary_field.key)
          FROM json_each(source_event.summary_json) AS summary_field
        ) = 9
        AND NOT EXISTS (
          SELECT 1 FROM json_each(source_event.summary_json) AS summary_field
          WHERE summary_field.key NOT IN (
            'eventId', 'dojoXpMilli', 'dojoLevelsGained', 'characterId',
            'affinityMilli', 'affinityLevelsGained', 'missionCompletions',
            'grantedItemIds', 'streak'
          )
        )
        AND json_type(source_event.summary_json, '$.eventId') = 'text'
        AND json_extract(source_event.summary_json, '$.eventId')
          = source_event.idempotency_key
        AND json_type(source_event.summary_json, '$.dojoXpMilli') = 'integer'
        AND json_extract(source_event.summary_json, '$.dojoXpMilli')
          BETWEEN 0 AND 9007199254740991
        AND json_type(source_event.summary_json, '$.dojoLevelsGained') = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(
            CASE
              WHEN json_type(
                source_event.summary_json,
                '$.dojoLevelsGained'
              ) = 'array'
              THEN json_extract(
                source_event.summary_json,
                '$.dojoLevelsGained'
              )
              ELSE '[]'
            END
          ) AS dojo_level
          WHERE
            dojo_level.type != 'integer'
            OR dojo_level.value NOT BETWEEN 2 AND 50
            OR (
              CAST(dojo_level.key AS INTEGER) > 0
              AND dojo_level.value != json_extract(
                source_event.summary_json,
                '$.dojoLevelsGained['
                  || (CAST(dojo_level.key AS INTEGER) - 1) || ']'
              ) + 1
            )
        )
        AND json_extract(source_event.summary_json, '$.characterId') IN (
          'sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena'
        )
        AND json_type(source_event.summary_json, '$.affinityMilli') = 'integer'
        AND json_extract(source_event.summary_json, '$.affinityMilli')
          BETWEEN 0 AND 9007199254740991
        AND json_type(
          source_event.summary_json,
          '$.affinityLevelsGained'
        ) = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(
            CASE
              WHEN json_type(
                source_event.summary_json,
                '$.affinityLevelsGained'
              ) = 'array'
              THEN json_extract(
                source_event.summary_json,
                '$.affinityLevelsGained'
              )
              ELSE '[]'
            END
          ) AS affinity_level
          WHERE
            affinity_level.type != 'integer'
            OR affinity_level.value NOT BETWEEN 2 AND 20
            OR (
              CAST(affinity_level.key AS INTEGER) > 0
              AND affinity_level.value != json_extract(
                source_event.summary_json,
                '$.affinityLevelsGained['
                  || (CAST(affinity_level.key AS INTEGER) - 1) || ']'
              ) + 1
            )
        )
        AND json_type(
          source_event.summary_json,
          '$.missionCompletions'
        ) = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(
            CASE
              WHEN json_type(
                source_event.summary_json,
                '$.missionCompletions'
              ) = 'array'
              THEN json_extract(
                source_event.summary_json,
                '$.missionCompletions'
              )
              ELSE '[]'
            END
          ) AS mission
          WHERE
            mission.type != 'object'
            OR (
              SELECT COUNT(*)
              FROM json_each(
                CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
                END
              )
            ) != 3
            OR (
              SELECT COUNT(DISTINCT mission_field.key)
              FROM json_each(
                CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
                END
              ) AS mission_field
            ) != 3
            OR EXISTS (
              SELECT 1
              FROM json_each(
                CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
                END
              ) AS mission_field
              WHERE mission_field.key NOT IN (
                'missionId', 'slot', 'dojoXpMilli'
              )
            )
            OR json_type(
              CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
              END,
              '$.missionId'
            ) != 'text'
            OR json_extract(
              CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
              END,
              '$.missionId'
            ) NOT IN (
              'COMPLETE_HANDS_ANY_10', 'COMPLETE_HANDS_CASH_10',
              'COMPLETE_HANDS_PRACTICE_10', 'COMPLETE_HANDS_ANY_20',
              'COMPLETE_ONE_SNG', 'COMPLETE_TWO_MODES'
            )
            OR json_type(
              CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
              END,
              '$.slot'
            ) != 'integer'
            OR json_extract(
              CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
              END,
              '$.slot'
            ) NOT BETWEEN 0 AND 2
            OR json_type(
              CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
              END,
              '$.dojoXpMilli'
            ) != 'integer'
            OR json_extract(
              CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
              END,
              '$.dojoXpMilli'
            ) != 100000
        )
        AND (
          SELECT COUNT(*)
          FROM json_each(
            source_event.summary_json,
            '$.missionCompletions'
          )
        ) = (
          SELECT COUNT(DISTINCT json_extract(mission.value, '$.missionId'))
          FROM json_each(
            source_event.summary_json,
            '$.missionCompletions'
          ) AS mission
        )
        AND (
          SELECT COUNT(*)
          FROM json_each(
            source_event.summary_json,
            '$.missionCompletions'
          )
        ) = (
          SELECT COUNT(DISTINCT json_extract(mission.value, '$.slot'))
          FROM json_each(
            source_event.summary_json,
            '$.missionCompletions'
          ) AS mission
        )
        AND json_extract(source_event.summary_json, '$.dojoXpMilli') >= COALESCE((
          SELECT SUM(json_extract(mission.value, '$.dojoXpMilli'))
          FROM json_each(
            source_event.summary_json,
            '$.missionCompletions'
          ) AS mission
        ), 0)
        AND json_type(source_event.summary_json, '$.streak') = 'object'
        AND (
          SELECT COUNT(*)
          FROM json_each(source_event.summary_json, '$.streak')
        ) = 3
        AND (
          SELECT COUNT(DISTINCT streak_field.key)
          FROM json_each(
            source_event.summary_json,
            '$.streak'
          ) AS streak_field
        ) = 3
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(source_event.summary_json, '$.streak') AS streak_field
          WHERE streak_field.key NOT IN (
            'previousStreak', 'currentStreak', 'restPassUsed'
          )
        )
        AND json_type(
          source_event.summary_json,
          '$.streak.previousStreak'
        ) = 'integer'
        AND json_extract(
          source_event.summary_json,
          '$.streak.previousStreak'
        ) BETWEEN 0 AND 9007199254740991
        AND json_type(
          source_event.summary_json,
          '$.streak.currentStreak'
        ) = 'integer'
        AND json_extract(
          source_event.summary_json,
          '$.streak.currentStreak'
        ) BETWEEN 1 AND 9007199254740991
        AND json_extract(
          source_event.summary_json,
          '$.streak.currentStreak'
        ) = json_extract(
          source_event.summary_json,
          '$.streak.previousStreak'
        ) + 1
        AND json_extract(
          source_event.summary_json,
          '$.streak.currentStreak'
        ) % 7 = 0
        AND json_type(
          source_event.summary_json,
          '$.streak.restPassUsed'
        ) IN ('true', 'false')
        AND json_type(
          source_event.summary_json,
          '$.grantedItemIds'
        ) = 'array'
        AND json_array_length(
          source_event.summary_json,
          '$.grantedItemIds'
        ) = 1
        AND json_extract(
          source_event.summary_json,
          '$.grantedItemIds[0]'
        ) = 'streak-fragment';

      INSERT INTO v10_progression_validation (invalid)
      SELECT 1
      FROM (
        SELECT
          profile_id,
          item_id,
          COUNT(*) AS receipt_count,
          MIN(granted_at) AS first_granted_at,
          MAX(granted_at) AS last_granted_at
        FROM progression_item_grants
        WHERE item_id = 'streak-fragment'
        GROUP BY profile_id, item_id
      ) AS receipt_group
      LEFT JOIN inventory_items AS inventory
        ON inventory.profile_id = receipt_group.profile_id
        AND inventory.item_id = receipt_group.item_id
      WHERE
        inventory.profile_id IS NULL
        OR inventory.quantity != receipt_group.receipt_count
        OR inventory.granted_at != receipt_group.first_granted_at
        OR inventory.updated_at != receipt_group.last_granted_at
      LIMIT 1;

      INSERT INTO v10_progression_validation (invalid)
      SELECT 1 FROM inventory_items AS inventory
      WHERE inventory.item_id = 'streak-fragment'
        AND NOT EXISTS (
          SELECT 1 FROM progression_item_grants AS grant_row
          WHERE grant_row.profile_id = inventory.profile_id
            AND grant_row.item_id = inventory.item_id
        )
      LIMIT 1;

      INSERT INTO v10_progression_validation (invalid)
      SELECT 1
      FROM progression_item_grants AS grant_row
      LEFT JOIN canonical_streak_fragment_source_events AS source_event
        ON source_event.idempotency_key = grant_row.source_event_id
        AND source_event.profile_id = grant_row.profile_id
        AND source_event.created_at = grant_row.granted_at
      WHERE source_event.idempotency_key IS NULL
      LIMIT 1;

      DROP TABLE v10_progression_validation;

      DROP TRIGGER validate_progression_item_grant_insert;
      DROP TRIGGER validate_fragment_source_event_insert;

      CREATE TRIGGER validate_progression_item_grant_insert
      BEFORE INSERT ON progression_item_grants
      WHEN
        NEW.idempotency_key != (
          'streak-fragment:' || NEW.profile_id || ':' || NEW.source_date
        )
        OR NEW.source_ref != NEW.idempotency_key
        OR NEW.item_id != 'streak-fragment'
        OR NEW.source != 'streak'
        OR NEW.quantity != 1
        OR NEW.granted_at NOT BETWEEN 0 AND 253402300799999
        OR NOT EXISTS (
          SELECT 1 FROM streak_daily_progress AS daily
          WHERE daily.profile_id = NEW.profile_id
            AND daily.kst_date = NEW.source_date
            AND daily.qualified_at = NEW.granted_at
        )
        OR (
          EXISTS (
            SELECT 1 FROM progression_events
            WHERE idempotency_key = NEW.source_event_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM canonical_streak_fragment_source_events AS source_event
            WHERE source_event.idempotency_key = NEW.source_event_id
              AND source_event.profile_id = NEW.profile_id
              AND source_event.created_at = NEW.granted_at
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid progression item grant source');
      END;

      CREATE TRIGGER validate_fragment_source_event_insert
      AFTER INSERT ON progression_events
      WHEN EXISTS (
        SELECT 1 FROM progression_item_grants AS grant_row
        WHERE grant_row.source_event_id = NEW.idempotency_key
      )
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_streak_fragment_source_events AS source_event
          JOIN progression_item_grants AS grant_row
            ON grant_row.source_event_id = source_event.idempotency_key
            AND grant_row.profile_id = source_event.profile_id
            AND grant_row.granted_at = source_event.created_at
          WHERE source_event.idempotency_key = NEW.idempotency_key
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid fragment source event');
      END;

      CREATE TRIGGER reject_direct_progression_profile_delete
      BEFORE DELETE ON progression_profiles
      WHEN EXISTS (
        SELECT 1 FROM profiles WHERE id = OLD.profile_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'delete progression through profile owner');
      END;
    `,
  },
  {
    version: 11,
    name: 'add_permanent_progression_reward_receipts',
    sql: `
      CREATE TABLE permanent_progression_grants (
        profile_id TEXT NOT NULL
          REFERENCES progression_profiles(profile_id) ON DELETE CASCADE,
        item_id TEXT NOT NULL CHECK (
          length(item_id) BETWEEN 1 AND 128
          AND item_id NOT GLOB '*[^A-Za-z0-9_-]*'
          AND item_id != 'streak-fragment'
        ),
        source_event_id TEXT NOT NULL CHECK (length(source_event_id) > 0),
        source_kind TEXT NOT NULL CHECK (
          source_kind IN ('dojo-level', 'affinity-level')
        ),
        source_level INTEGER NOT NULL CHECK (source_level BETWEEN 1 AND 50),
        source_character_id TEXT CHECK (
          (source_kind = 'dojo-level' AND source_character_id IS NULL)
          OR (source_kind = 'affinity-level' AND source_character_id IN (
            'sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena'
          ))
        ),
        granted_at INTEGER NOT NULL CHECK (
          granted_at BETWEEN 0 AND 253402300799999
        ),
        PRIMARY KEY (profile_id, item_id),
        FOREIGN KEY (source_event_id, profile_id)
          REFERENCES progression_events(idempotency_key, profile_id)
          ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
      ) STRICT;

      CREATE INDEX idx_permanent_progression_grants_source_event
        ON permanent_progression_grants(source_event_id, profile_id);

      CREATE TRIGGER validate_permanent_grant_insert
      BEFORE INSERT ON permanent_progression_grants
      WHEN EXISTS (
        SELECT 1 FROM progression_events WHERE idempotency_key = NEW.source_event_id
      ) AND NOT EXISTS (
        SELECT 1 FROM progression_events AS source_event
        WHERE source_event.idempotency_key = NEW.source_event_id
          AND source_event.profile_id = NEW.profile_id
          AND source_event.event_type IN ('completed-hand', 'sng-finish')
          AND source_event.created_at = NEW.granted_at
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid permanent grant source');
      END;

      CREATE TRIGGER validate_permanent_grant_source_event_insert
      BEFORE INSERT ON progression_events
      WHEN EXISTS (
        SELECT 1 FROM permanent_progression_grants AS grant_row
        WHERE grant_row.source_event_id = NEW.idempotency_key
          AND (
            grant_row.profile_id != NEW.profile_id
            OR NEW.event_type NOT IN ('completed-hand', 'sng-finish')
            OR grant_row.granted_at != NEW.created_at
            OR NOT json_valid(NEW.summary_json)
            OR NOT EXISTS (
              SELECT 1 FROM json_each(NEW.summary_json, '$.grantedItemIds')
              WHERE type = 'text' AND value = grant_row.item_id
            )
          )
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid permanent grant source event');
      END;

      CREATE TRIGGER reject_permanent_source_event_update
      BEFORE UPDATE ON progression_events
      WHEN EXISTS (
        SELECT 1 FROM permanent_progression_grants
        WHERE source_event_id = OLD.idempotency_key
      )
      BEGIN SELECT RAISE(ABORT, 'immutable permanent grant source event'); END;

      CREATE TRIGGER sync_permanent_inventory_insert
      AFTER INSERT ON permanent_progression_grants
      BEGIN
        INSERT INTO inventory_items (
          profile_id, item_id, quantity, granted_at, updated_at
        ) VALUES (NEW.profile_id, NEW.item_id, 1, NEW.granted_at, NEW.granted_at)
        ON CONFLICT(profile_id, item_id) DO NOTHING;
      END;

      CREATE TRIGGER reject_permanent_grant_update
      BEFORE UPDATE ON permanent_progression_grants
      BEGIN SELECT RAISE(ABORT, 'immutable permanent progression grant'); END;

      CREATE TRIGGER reject_permanent_grant_delete
      BEFORE DELETE ON permanent_progression_grants
      WHEN EXISTS (
        SELECT 1 FROM progression_profiles WHERE profile_id = OLD.profile_id
      )
      BEGIN SELECT RAISE(ABORT, 'immutable permanent progression grant'); END;

      CREATE TRIGGER protect_permanent_inventory_update
      BEFORE UPDATE ON inventory_items
      WHEN EXISTS (
        SELECT 1 FROM permanent_progression_grants
        WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
      )
      BEGIN SELECT RAISE(ABORT, 'immutable permanent inventory item'); END;

      CREATE TRIGGER protect_permanent_inventory_delete
      BEFORE DELETE ON inventory_items
      WHEN EXISTS (
        SELECT 1 FROM permanent_progression_grants
        WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
      ) AND EXISTS (
        SELECT 1 FROM profiles WHERE id = OLD.profile_id
      )
      BEGIN SELECT RAISE(ABORT, 'immutable permanent inventory item'); END;
    `,
  },
];

export function validateMigrations(definitions: readonly Migration[]): void {
  let previousVersion = 0;
  for (const migration of definitions) {
    if (
      !Number.isInteger(migration.version)
      || migration.version <= previousVersion
    ) {
      throw new Error(
        'Migration versions must be unique and strictly increasing',
      );
    }
    previousVersion = migration.version;
  }
}

export function applyMigrations(db: DatabaseSync): void {
  validateMigrations(migrations);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
    `);

    const appliedVersions = new Set(
      db
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((row) => (row as { version: number }).version),
    );
    const knownVersions = new Set(migrations.map(migration => migration.version));
    const unknownVersions = [...appliedVersions]
      .filter(version => !knownVersions.has(version))
      .sort((left, right) => left - right);
    if (unknownVersions.length > 0) {
      throw new Error(
        `Unknown applied migration version: ${unknownVersions.join(', ')}`,
      );
    }
    const recordMigration = db.prepare(`
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (?, ?, ?)
    `);

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;
      db.exec(migration.sql);
      recordMigration.run(migration.version, migration.name, Date.now());
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
