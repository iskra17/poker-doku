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
  {
    version: 12,
    name: 'enforce_durable_collection_catalog_and_reward_proofs',
    sql: `
      CREATE TABLE collection_catalog (
        item_id TEXT PRIMARY KEY CHECK (
          length(item_id) BETWEEN 1 AND 128
          AND item_id NOT GLOB '*[^A-Za-z0-9_-]*'
        ),
        kind TEXT NOT NULL CHECK (kind IN (
          'fragment', 'title', 'frame', 'emote', 'cutin',
          'dialogue-pack', 'aura', 'skin'
        )),
        stackable INTEGER NOT NULL CHECK (stackable IN (0, 1)),
        source_kind TEXT NOT NULL CHECK (
          source_kind IN ('streak', 'dojo-level', 'affinity-level')
        ),
        required_level INTEGER,
        character_id TEXT CHECK (character_id IS NULL OR character_id IN (
          'sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena'
        )),
        equip_slot TEXT CHECK (
          equip_slot IS NULL OR equip_slot IN ('title', 'frame', 'skin', 'cutin')
        ),
        CHECK (
          (source_kind = 'streak' AND required_level IS NULL
            AND character_id IS NULL AND stackable = 1)
          OR (source_kind = 'dojo-level'
            AND required_level BETWEEN 1 AND 50
            AND character_id IS NULL AND stackable = 0)
          OR (source_kind = 'affinity-level'
            AND required_level BETWEEN 1 AND 20
            AND character_id IS NOT NULL AND stackable = 0)
        )
      ) STRICT;

      INSERT INTO collection_catalog (
        item_id, kind, stackable, source_kind, required_level,
        character_id, equip_slot
      ) VALUES
        ('streak-fragment','fragment',1,'streak',NULL,NULL,NULL),
        ('dojo-title-sprout-challenger','title',0,'dojo-level',2,NULL,'title'),
        ('dojo-frame-cherry-blossom','frame',0,'dojo-level',5,NULL,'frame'),
        ('dojo-emote-miyako-cheer','emote',0,'dojo-level',10,NULL,NULL),
        ('dojo-title-steady-trainee','title',0,'dojo-level',15,NULL,'title'),
        ('dojo-frame-clear-sky','frame',0,'dojo-level',20,NULL,'frame'),
        ('dojo-cutin-focus-lines','cutin',0,'dojo-level',25,NULL,'cutin'),
        ('dojo-title-advanced-student','title',0,'dojo-level',30,NULL,'title'),
        ('dojo-frame-golden','frame',0,'dojo-level',35,NULL,'frame'),
        ('dojo-cutin-match-moment','cutin',0,'dojo-level',40,NULL,'cutin'),
        ('dojo-title-battle-tested','title',0,'dojo-level',45,NULL,'title'),
        ('dojo-frame-master','frame',0,'dojo-level',50,NULL,'frame'),
        ('affinity-sakura-dialogue-pack','dialogue-pack',0,'affinity-level',5,'sakura',NULL),
        ('affinity-sakura-aura','aura',0,'affinity-level',10,'sakura',NULL),
        ('affinity-sakura-cutin','cutin',0,'affinity-level',15,'sakura','cutin'),
        ('affinity-sakura-skin','skin',0,'affinity-level',20,'sakura','skin'),
        ('affinity-ara-dialogue-pack','dialogue-pack',0,'affinity-level',5,'ara',NULL),
        ('affinity-ara-aura','aura',0,'affinity-level',10,'ara',NULL),
        ('affinity-ara-cutin','cutin',0,'affinity-level',15,'ara','cutin'),
        ('affinity-ara-skin','skin',0,'affinity-level',20,'ara','skin'),
        ('affinity-hana-dialogue-pack','dialogue-pack',0,'affinity-level',5,'hana',NULL),
        ('affinity-hana-aura','aura',0,'affinity-level',10,'hana',NULL),
        ('affinity-hana-cutin','cutin',0,'affinity-level',15,'hana','cutin'),
        ('affinity-hana-skin','skin',0,'affinity-level',20,'hana','skin'),
        ('affinity-chloe-dialogue-pack','dialogue-pack',0,'affinity-level',5,'chloe',NULL),
        ('affinity-chloe-aura','aura',0,'affinity-level',10,'chloe',NULL),
        ('affinity-chloe-cutin','cutin',0,'affinity-level',15,'chloe','cutin'),
        ('affinity-chloe-skin','skin',0,'affinity-level',20,'chloe','skin'),
        ('affinity-vivian-dialogue-pack','dialogue-pack',0,'affinity-level',5,'vivian',NULL),
        ('affinity-vivian-aura','aura',0,'affinity-level',10,'vivian',NULL),
        ('affinity-vivian-cutin','cutin',0,'affinity-level',15,'vivian','cutin'),
        ('affinity-vivian-skin','skin',0,'affinity-level',20,'vivian','skin'),
        ('affinity-elena-dialogue-pack','dialogue-pack',0,'affinity-level',5,'elena',NULL),
        ('affinity-elena-aura','aura',0,'affinity-level',10,'elena',NULL),
        ('affinity-elena-cutin','cutin',0,'affinity-level',15,'elena','cutin'),
        ('affinity-elena-skin','skin',0,'affinity-level',20,'elena','skin');

      CREATE TABLE v12_collection_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      INSERT INTO v12_collection_validation(invalid)
      SELECT 1
      FROM inventory_items AS inventory
      LEFT JOIN collection_catalog AS catalog ON catalog.item_id = inventory.item_id
      WHERE catalog.item_id IS NULL
        OR (catalog.stackable = 0 AND inventory.quantity != 1)
        OR (catalog.stackable = 1 AND inventory.quantity < 1)
        OR inventory.granted_at NOT BETWEEN 0 AND 253402300799999
        OR inventory.updated_at NOT BETWEEN
          inventory.granted_at AND 253402300799999;

      INSERT INTO v12_collection_validation(invalid)
      SELECT 1
      FROM profile_equipment AS equipment
      LEFT JOIN progression_profiles AS profile ON profile.profile_id = equipment.profile_id
      LEFT JOIN collection_catalog AS catalog ON catalog.item_id = equipment.item_id
      LEFT JOIN inventory_items AS inventory
        ON inventory.profile_id = equipment.profile_id
        AND inventory.item_id = equipment.item_id
      WHERE profile.profile_id IS NULL
        OR equipment.updated_at NOT BETWEEN 0 AND 253402300799999
        OR (equipment.item_id IS NOT NULL AND (
          catalog.item_id IS NULL
          OR catalog.equip_slot IS NULL
          OR catalog.equip_slot != equipment.slot
          OR inventory.quantity IS NULL
          OR inventory.quantity < 1
          OR (catalog.kind = 'skin'
            AND catalog.character_id != profile.selected_character_id)
        ));

      INSERT INTO v12_collection_validation(invalid)
      SELECT 1
      FROM progression_profiles AS profile
      LEFT JOIN profile_equipment AS equipment
        ON equipment.profile_id = profile.profile_id
      GROUP BY profile.profile_id
      HAVING COUNT(equipment.slot) != 4
        OR COUNT(DISTINCT equipment.slot) != 4;

      INSERT INTO v12_collection_validation(invalid)
      SELECT 1
      FROM inventory_items AS inventory
      WHERE inventory.item_id = 'streak-fragment'
        AND (
          inventory.quantity != (
            SELECT COUNT(*) FROM progression_item_grants AS receipt
            WHERE receipt.profile_id = inventory.profile_id
              AND receipt.item_id = inventory.item_id
          )
          OR inventory.granted_at != (
            SELECT MIN(granted_at) FROM progression_item_grants AS receipt
            WHERE receipt.profile_id = inventory.profile_id
              AND receipt.item_id = inventory.item_id
          )
          OR inventory.updated_at != (
            SELECT MAX(granted_at) FROM progression_item_grants AS receipt
            WHERE receipt.profile_id = inventory.profile_id
              AND receipt.item_id = inventory.item_id
          )
        );

      INSERT INTO v12_collection_validation(invalid)
      SELECT 1
      FROM permanent_progression_grants AS grant_row
      JOIN progression_profiles AS profile ON profile.profile_id = grant_row.profile_id
      LEFT JOIN progression_events AS source_event
        ON source_event.idempotency_key = grant_row.source_event_id
        AND source_event.profile_id = grant_row.profile_id
      LEFT JOIN collection_catalog AS catalog ON catalog.item_id = grant_row.item_id
      LEFT JOIN character_affinity AS affinity
        ON affinity.profile_id = grant_row.profile_id
        AND affinity.character_id = catalog.character_id
      LEFT JOIN inventory_items AS inventory
        ON inventory.profile_id = grant_row.profile_id
        AND inventory.item_id = grant_row.item_id
      WHERE source_event.idempotency_key IS NULL
        OR catalog.item_id IS NULL
        OR catalog.stackable != 0
        OR catalog.source_kind != grant_row.source_kind
        OR catalog.required_level != grant_row.source_level
        OR catalog.character_id IS NOT grant_row.source_character_id
        OR source_event.event_type NOT IN ('completed-hand', 'sng-finish')
        OR source_event.balance_version != 1
        OR source_event.created_at != grant_row.granted_at
        OR inventory.item_id IS NULL
        OR inventory.quantity != 1
        OR inventory.granted_at != grant_row.granted_at
        OR inventory.updated_at != grant_row.granted_at
        OR NOT json_valid(source_event.summary_json)
        OR NOT EXISTS (
          SELECT 1 FROM json_each(source_event.summary_json, '$.grantedItemIds')
          WHERE type = 'text' AND value = grant_row.item_id
        )
        OR (catalog.source_kind = 'dojo-level' AND (
          profile.dojo_level < catalog.required_level
          OR NOT EXISTS (
            SELECT 1 FROM json_each(source_event.summary_json, '$.dojoLevelsGained')
            WHERE type = 'integer' AND value = catalog.required_level
          )
        ))
        OR (catalog.source_kind = 'affinity-level' AND (
          affinity.level IS NULL
          OR affinity.level < catalog.required_level
          OR json_extract(source_event.summary_json, '$.characterId')
            IS NOT catalog.character_id
          OR NOT EXISTS (
            SELECT 1 FROM json_each(source_event.summary_json, '$.affinityLevelsGained')
            WHERE type = 'integer' AND value = catalog.required_level
          )
        ));

      DROP TABLE v12_collection_validation;

      CREATE TRIGGER reject_collection_catalog_insert
      BEFORE INSERT ON collection_catalog
      BEGIN SELECT RAISE(ABORT, 'immutable collection catalog'); END;
      CREATE TRIGGER reject_collection_catalog_update
      BEFORE UPDATE ON collection_catalog
      BEGIN SELECT RAISE(ABORT, 'immutable collection catalog'); END;
      CREATE TRIGGER reject_collection_catalog_delete
      BEFORE DELETE ON collection_catalog
      BEGIN SELECT RAISE(ABORT, 'immutable collection catalog'); END;

      CREATE TRIGGER validate_catalog_inventory_insert
      BEFORE INSERT ON inventory_items
      WHEN NOT EXISTS (
        SELECT 1 FROM collection_catalog AS catalog
        WHERE catalog.item_id = NEW.item_id
          AND ((catalog.stackable = 0 AND NEW.quantity = 1)
            OR (catalog.stackable = 1 AND NEW.quantity >= 1))
      )
      BEGIN SELECT RAISE(ABORT, 'invalid catalog inventory item'); END;

      CREATE TRIGGER validate_catalog_inventory_update
      BEFORE UPDATE ON inventory_items
      WHEN NEW.item_id != 'streak-fragment'
        AND OLD.item_id != 'streak-fragment'
        AND NOT EXISTS (
        SELECT 1 FROM collection_catalog AS catalog
        WHERE catalog.item_id = NEW.item_id
          AND ((catalog.stackable = 0 AND NEW.quantity = 1)
            OR (catalog.stackable = 1 AND NEW.quantity >= 1))
      )
      BEGIN SELECT RAISE(ABORT, 'invalid catalog inventory item'); END;

      CREATE TRIGGER validate_catalog_equipment_insert
      BEFORE INSERT ON profile_equipment
      WHEN NOT EXISTS (
        SELECT 1 FROM progression_profiles WHERE profile_id = NEW.profile_id
      ) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM collection_catalog AS catalog
        JOIN inventory_items AS inventory
          ON inventory.profile_id = NEW.profile_id
          AND inventory.item_id = NEW.item_id
          AND inventory.quantity >= 1
        JOIN progression_profiles AS profile ON profile.profile_id = NEW.profile_id
        WHERE catalog.item_id = NEW.item_id
          AND catalog.equip_slot = NEW.slot
          AND (catalog.kind != 'skin'
            OR catalog.character_id = profile.selected_character_id)
      ))
      BEGIN SELECT RAISE(ABORT, 'invalid catalog equipment'); END;

      CREATE TRIGGER validate_catalog_equipment_update
      BEFORE UPDATE ON profile_equipment
      WHEN NOT EXISTS (
        SELECT 1 FROM progression_profiles WHERE profile_id = NEW.profile_id
      ) OR (NEW.item_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM collection_catalog AS catalog
        JOIN inventory_items AS inventory
          ON inventory.profile_id = NEW.profile_id
          AND inventory.item_id = NEW.item_id
          AND inventory.quantity >= 1
        JOIN progression_profiles AS profile ON profile.profile_id = NEW.profile_id
        WHERE catalog.item_id = NEW.item_id
          AND catalog.equip_slot = NEW.slot
          AND (catalog.kind != 'skin'
            OR catalog.character_id = profile.selected_character_id)
      ))
      BEGIN SELECT RAISE(ABORT, 'invalid catalog equipment'); END;

      CREATE TRIGGER reject_catalog_equipment_delete
      BEFORE DELETE ON profile_equipment
      WHEN EXISTS (SELECT 1 FROM profiles WHERE id = OLD.profile_id)
      BEGIN SELECT RAISE(ABORT, 'delete equipment through profile owner'); END;

      CREATE TRIGGER validate_selected_character_skin_update
      BEFORE UPDATE OF selected_character_id ON progression_profiles
      WHEN EXISTS (
        SELECT 1
        FROM profile_equipment AS equipment
        JOIN collection_catalog AS catalog ON catalog.item_id = equipment.item_id
        WHERE equipment.profile_id = NEW.profile_id
          AND equipment.slot = 'skin'
          AND catalog.kind = 'skin'
          AND catalog.character_id != NEW.selected_character_id
      )
      BEGIN SELECT RAISE(ABORT, 'selected character conflicts with skin'); END;

      CREATE TRIGGER validate_permanent_grant_catalog_insert
      BEFORE INSERT ON permanent_progression_grants
      WHEN NOT EXISTS (
        SELECT 1
        FROM collection_catalog AS catalog
        JOIN progression_profiles AS profile ON profile.profile_id = NEW.profile_id
        LEFT JOIN character_affinity AS affinity
          ON affinity.profile_id = NEW.profile_id
          AND affinity.character_id = catalog.character_id
        WHERE catalog.item_id = NEW.item_id
          AND catalog.stackable = 0
          AND catalog.source_kind = NEW.source_kind
          AND catalog.required_level = NEW.source_level
          AND catalog.character_id IS NEW.source_character_id
          AND ((catalog.source_kind = 'dojo-level'
              AND profile.dojo_level >= catalog.required_level)
            OR (catalog.source_kind = 'affinity-level'
              AND affinity.level >= catalog.required_level))
          AND (NOT EXISTS (
              SELECT 1 FROM progression_events
              WHERE idempotency_key = NEW.source_event_id
            ) OR EXISTS (
              SELECT 1 FROM progression_events AS source_event
              WHERE source_event.idempotency_key = NEW.source_event_id
                AND source_event.profile_id = NEW.profile_id
                AND json_valid(source_event.summary_json)
                AND EXISTS (
                  SELECT 1 FROM json_each(source_event.summary_json, '$.grantedItemIds')
                  WHERE type = 'text' AND value = NEW.item_id
                )
                AND ((catalog.source_kind = 'dojo-level' AND EXISTS (
                    SELECT 1 FROM json_each(source_event.summary_json, '$.dojoLevelsGained')
                    WHERE type = 'integer' AND value = catalog.required_level
                  )) OR (catalog.source_kind = 'affinity-level'
                    AND json_extract(source_event.summary_json, '$.characterId')
                      IS catalog.character_id
                    AND EXISTS (
                      SELECT 1 FROM json_each(source_event.summary_json, '$.affinityLevelsGained')
                      WHERE type = 'integer' AND value = catalog.required_level
                    )))
            ))
      )
      BEGIN SELECT RAISE(ABORT, 'invalid permanent grant catalog proof'); END;

      CREATE TRIGGER validate_permanent_grant_source_proof_insert
      BEFORE INSERT ON progression_events
      WHEN EXISTS (
        SELECT 1
        FROM permanent_progression_grants AS grant_row
        JOIN collection_catalog AS catalog ON catalog.item_id = grant_row.item_id
        JOIN progression_profiles AS profile ON profile.profile_id = grant_row.profile_id
        LEFT JOIN character_affinity AS affinity
          ON affinity.profile_id = grant_row.profile_id
          AND affinity.character_id = catalog.character_id
        WHERE grant_row.source_event_id = NEW.idempotency_key
          AND (
            grant_row.profile_id != NEW.profile_id
            OR catalog.source_kind != grant_row.source_kind
            OR catalog.required_level != grant_row.source_level
            OR catalog.character_id IS NOT grant_row.source_character_id
            OR NOT json_valid(NEW.summary_json)
            OR NOT EXISTS (
              SELECT 1 FROM json_each(NEW.summary_json, '$.grantedItemIds')
              WHERE type = 'text' AND value = grant_row.item_id
            )
            OR (catalog.source_kind = 'dojo-level' AND (
              profile.dojo_level < catalog.required_level
              OR NOT EXISTS (
                SELECT 1 FROM json_each(NEW.summary_json, '$.dojoLevelsGained')
                WHERE type = 'integer' AND value = catalog.required_level
              )
            ))
            OR (catalog.source_kind = 'affinity-level' AND (
              affinity.level IS NULL
              OR affinity.level < catalog.required_level
              OR json_extract(NEW.summary_json, '$.characterId')
                IS NOT catalog.character_id
              OR NOT EXISTS (
                SELECT 1 FROM json_each(NEW.summary_json, '$.affinityLevelsGained')
                WHERE type = 'integer' AND value = catalog.required_level
              )
            ))
          )
      )
      BEGIN SELECT RAISE(ABORT, 'invalid permanent grant source proof'); END;
    `,
  },
  {
    version: 13,
    name: 'canonicalize_permanent_sources_and_collection_rows',
    sql: `
      CREATE VIEW canonical_progression_reward_source_events AS
      SELECT
        source_event.idempotency_key,
        source_event.profile_id,
        source_event.created_at,
        source_event.summary_json
      FROM progression_events AS source_event
      WHERE
        source_event.event_type IN ('completed-hand', 'sng-finish')
        AND source_event.balance_version = 1
        AND source_event.created_at BETWEEN 0 AND 253402300799999
        AND json_valid(source_event.summary_json)
        AND json_type(source_event.summary_json) = 'object'
        AND (
          SELECT COUNT(*) FROM json_each(source_event.summary_json)
        ) IN (8, 9)
        AND (
          SELECT COUNT(DISTINCT summary_field.key)
          FROM json_each(source_event.summary_json) AS summary_field
        ) = (
          SELECT COUNT(*) FROM json_each(source_event.summary_json)
        )
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
            CASE WHEN json_type(
              source_event.summary_json, '$.dojoLevelsGained'
            ) = 'array' THEN json_extract(
              source_event.summary_json, '$.dojoLevelsGained'
            ) ELSE '[]' END
          ) AS dojo_level
          WHERE dojo_level.type != 'integer'
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
        AND json_type(source_event.summary_json, '$.characterId') = 'text'
        AND json_extract(source_event.summary_json, '$.characterId') IN (
          'sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena'
        )
        AND json_type(source_event.summary_json, '$.affinityMilli') = 'integer'
        AND json_extract(source_event.summary_json, '$.affinityMilli')
          BETWEEN 0 AND 9007199254740991
        AND json_type(
          source_event.summary_json, '$.affinityLevelsGained'
        ) = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(
            CASE WHEN json_type(
              source_event.summary_json, '$.affinityLevelsGained'
            ) = 'array' THEN json_extract(
              source_event.summary_json, '$.affinityLevelsGained'
            ) ELSE '[]' END
          ) AS affinity_level
          WHERE affinity_level.type != 'integer'
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
          source_event.summary_json, '$.missionCompletions'
        ) = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(
            CASE WHEN json_type(
              source_event.summary_json, '$.missionCompletions'
            ) = 'array' THEN json_extract(
              source_event.summary_json, '$.missionCompletions'
            ) ELSE '[]' END
          ) AS mission
          WHERE mission.type != 'object'
            OR (
              SELECT COUNT(*) FROM json_each(
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
              SELECT 1 FROM json_each(
                CASE WHEN mission.type = 'object' THEN mission.value ELSE '{}'
                END
              ) AS mission_field
              WHERE mission_field.key NOT IN (
                'missionId', 'slot', 'dojoXpMilli'
              )
            )
            OR json_type(mission.value, '$.missionId') != 'text'
            OR json_extract(mission.value, '$.missionId') NOT IN (
              'COMPLETE_HANDS_ANY_10', 'COMPLETE_HANDS_CASH_10',
              'COMPLETE_HANDS_PRACTICE_10', 'COMPLETE_HANDS_ANY_20',
              'COMPLETE_ONE_SNG', 'COMPLETE_TWO_MODES'
            )
            OR json_type(mission.value, '$.slot') != 'integer'
            OR json_extract(mission.value, '$.slot') NOT BETWEEN 0 AND 2
            OR json_type(mission.value, '$.dojoXpMilli') != 'integer'
            OR json_extract(mission.value, '$.dojoXpMilli') != 100000
        )
        AND (
          SELECT COUNT(*)
          FROM json_each(source_event.summary_json, '$.missionCompletions')
        ) = (
          SELECT COUNT(DISTINCT json_extract(mission.value, '$.missionId'))
          FROM json_each(
            source_event.summary_json, '$.missionCompletions'
          ) AS mission
        )
        AND (
          SELECT COUNT(*)
          FROM json_each(source_event.summary_json, '$.missionCompletions')
        ) = (
          SELECT COUNT(DISTINCT json_extract(mission.value, '$.slot'))
          FROM json_each(
            source_event.summary_json, '$.missionCompletions'
          ) AS mission
        )
        AND json_extract(source_event.summary_json, '$.dojoXpMilli')
          >= COALESCE((
            SELECT SUM(json_extract(mission.value, '$.dojoXpMilli'))
            FROM json_each(
              source_event.summary_json, '$.missionCompletions'
            ) AS mission
          ), 0)
        AND json_type(source_event.summary_json, '$.grantedItemIds') = 'array'
        AND NOT EXISTS (
          SELECT 1
          FROM json_each(
            CASE WHEN json_type(
              source_event.summary_json, '$.grantedItemIds'
            ) = 'array' THEN json_extract(
              source_event.summary_json, '$.grantedItemIds'
            ) ELSE '[]' END
          ) AS granted_item
          LEFT JOIN collection_catalog AS catalog
            ON catalog.item_id = granted_item.value
          WHERE granted_item.type != 'text' OR catalog.item_id IS NULL
        )
        AND (
          SELECT COUNT(*)
          FROM json_each(source_event.summary_json, '$.grantedItemIds')
        ) = (
          SELECT COUNT(DISTINCT granted_item.value)
          FROM json_each(
            source_event.summary_json, '$.grantedItemIds'
          ) AS granted_item
        )
        AND (
          json_type(source_event.summary_json, '$.streak') IS NULL
          OR (
            json_type(source_event.summary_json, '$.streak') = 'object'
            AND (
              SELECT COUNT(*)
              FROM json_each(source_event.summary_json, '$.streak')
            ) = 3
            AND (
              SELECT COUNT(DISTINCT streak_field.key)
              FROM json_each(
                source_event.summary_json, '$.streak'
              ) AS streak_field
            ) = 3
            AND NOT EXISTS (
              SELECT 1
              FROM json_each(
                source_event.summary_json, '$.streak'
              ) AS streak_field
              WHERE streak_field.key NOT IN (
                'previousStreak', 'currentStreak', 'restPassUsed'
              )
            )
            AND json_type(
              source_event.summary_json, '$.streak.previousStreak'
            ) = 'integer'
            AND json_extract(
              source_event.summary_json, '$.streak.previousStreak'
            ) BETWEEN 0 AND 9007199254740991
            AND json_type(
              source_event.summary_json, '$.streak.currentStreak'
            ) = 'integer'
            AND json_extract(
              source_event.summary_json, '$.streak.currentStreak'
            ) BETWEEN 1 AND 9007199254740991
            AND (
              json_extract(
                source_event.summary_json, '$.streak.currentStreak'
              ) = 1
              OR json_extract(
                source_event.summary_json, '$.streak.currentStreak'
              ) = json_extract(
                source_event.summary_json, '$.streak.previousStreak'
              ) + 1
            )
            AND json_type(
              source_event.summary_json, '$.streak.restPassUsed'
            ) IN ('true', 'false')
            AND (
              json_extract(
                source_event.summary_json, '$.streak.restPassUsed'
              ) = 0
              OR (
                json_extract(
                  source_event.summary_json, '$.streak.previousStreak'
                ) > 0
                AND json_extract(
                  source_event.summary_json, '$.streak.currentStreak'
                ) = json_extract(
                  source_event.summary_json, '$.streak.previousStreak'
                ) + 1
              )
            )
          )
        );

      CREATE TABLE v13_collection_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      INSERT INTO v13_collection_validation(invalid)
      SELECT 1 FROM inventory_items
      WHERE granted_at NOT BETWEEN 0 AND 253402300799999
        OR updated_at NOT BETWEEN granted_at AND 253402300799999;

      INSERT INTO v13_collection_validation(invalid)
      SELECT 1 FROM profile_equipment
      WHERE updated_at NOT BETWEEN 0 AND 253402300799999;

      INSERT INTO v13_collection_validation(invalid)
      SELECT 1
      FROM progression_profiles AS profile
      LEFT JOIN profile_equipment AS equipment
        ON equipment.profile_id = profile.profile_id
      GROUP BY profile.profile_id
      HAVING COUNT(equipment.slot) != 4
        OR COUNT(DISTINCT equipment.slot) != 4;

      INSERT INTO v13_collection_validation(invalid)
      SELECT 1
      FROM permanent_progression_grants AS grant_row
      LEFT JOIN collection_catalog AS catalog ON catalog.item_id = grant_row.item_id
      LEFT JOIN progression_profiles AS profile
        ON profile.profile_id = grant_row.profile_id
      LEFT JOIN character_affinity AS affinity
        ON affinity.profile_id = grant_row.profile_id
        AND affinity.character_id = catalog.character_id
      LEFT JOIN inventory_items AS inventory
        ON inventory.profile_id = grant_row.profile_id
        AND inventory.item_id = grant_row.item_id
      LEFT JOIN canonical_progression_reward_source_events AS source_event
        ON source_event.idempotency_key = grant_row.source_event_id
        AND source_event.profile_id = grant_row.profile_id
        AND source_event.created_at = grant_row.granted_at
      WHERE profile.profile_id IS NULL
        OR catalog.item_id IS NULL
        OR catalog.stackable != 0
        OR catalog.source_kind != grant_row.source_kind
        OR catalog.required_level != grant_row.source_level
        OR catalog.character_id IS NOT grant_row.source_character_id
        OR inventory.item_id IS NULL
        OR inventory.quantity != 1
        OR inventory.granted_at != grant_row.granted_at
        OR inventory.updated_at != grant_row.granted_at
        OR source_event.idempotency_key IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM json_each(source_event.summary_json, '$.grantedItemIds')
          WHERE type = 'text' AND value = grant_row.item_id
        )
        OR (catalog.source_kind = 'dojo-level' AND (
          profile.dojo_level < catalog.required_level
          OR NOT EXISTS (
            SELECT 1 FROM json_each(source_event.summary_json, '$.dojoLevelsGained')
            WHERE type = 'integer' AND value = catalog.required_level
          )
        ))
        OR (catalog.source_kind = 'affinity-level' AND (
          affinity.level IS NULL
          OR affinity.level < catalog.required_level
          OR json_extract(source_event.summary_json, '$.characterId')
            IS NOT catalog.character_id
          OR NOT EXISTS (
            SELECT 1 FROM json_each(source_event.summary_json, '$.affinityLevelsGained')
            WHERE type = 'integer' AND value = catalog.required_level
          )
        ));

      DROP TABLE v13_collection_validation;

      DROP TRIGGER validate_permanent_grant_insert;
      DROP TRIGGER validate_permanent_grant_source_event_insert;
      DROP TRIGGER validate_permanent_grant_catalog_insert;
      DROP TRIGGER validate_permanent_grant_source_proof_insert;

      CREATE TRIGGER validate_permanent_grant_insert
      BEFORE INSERT ON permanent_progression_grants
      WHEN NOT EXISTS (
        SELECT 1
        FROM collection_catalog AS catalog
        JOIN progression_profiles AS profile ON profile.profile_id = NEW.profile_id
        LEFT JOIN character_affinity AS affinity
          ON affinity.profile_id = NEW.profile_id
          AND affinity.character_id = catalog.character_id
        WHERE catalog.item_id = NEW.item_id
          AND catalog.stackable = 0
          AND catalog.source_kind = NEW.source_kind
          AND catalog.required_level = NEW.source_level
          AND catalog.character_id IS NEW.source_character_id
          AND ((catalog.source_kind = 'dojo-level'
              AND profile.dojo_level >= catalog.required_level)
            OR (catalog.source_kind = 'affinity-level'
              AND affinity.level >= catalog.required_level))
          AND (NOT EXISTS (
              SELECT 1 FROM progression_events
              WHERE idempotency_key = NEW.source_event_id
            ) OR EXISTS (
              SELECT 1
              FROM canonical_progression_reward_source_events AS source_event
              WHERE source_event.idempotency_key = NEW.source_event_id
                AND source_event.profile_id = NEW.profile_id
                AND source_event.created_at = NEW.granted_at
                AND EXISTS (
                  SELECT 1
                  FROM json_each(source_event.summary_json, '$.grantedItemIds')
                  WHERE type = 'text' AND value = NEW.item_id
                )
                AND ((catalog.source_kind = 'dojo-level' AND EXISTS (
                    SELECT 1
                    FROM json_each(source_event.summary_json, '$.dojoLevelsGained')
                    WHERE type = 'integer' AND value = catalog.required_level
                  )) OR (catalog.source_kind = 'affinity-level'
                    AND json_extract(source_event.summary_json, '$.characterId')
                      IS catalog.character_id
                    AND EXISTS (
                      SELECT 1
                      FROM json_each(
                        source_event.summary_json, '$.affinityLevelsGained'
                      )
                      WHERE type = 'integer' AND value = catalog.required_level
                    )))
            ))
      )
      BEGIN SELECT RAISE(ABORT, 'invalid permanent grant source'); END;

      CREATE TRIGGER validate_permanent_grant_source_event_insert
      AFTER INSERT ON progression_events
      WHEN EXISTS (
        SELECT 1
        FROM permanent_progression_grants AS grant_row
        JOIN collection_catalog AS catalog ON catalog.item_id = grant_row.item_id
        JOIN progression_profiles AS profile
          ON profile.profile_id = grant_row.profile_id
        LEFT JOIN character_affinity AS affinity
          ON affinity.profile_id = grant_row.profile_id
          AND affinity.character_id = catalog.character_id
        LEFT JOIN canonical_progression_reward_source_events AS source_event
          ON source_event.idempotency_key = NEW.idempotency_key
          AND source_event.profile_id = grant_row.profile_id
          AND source_event.created_at = grant_row.granted_at
        WHERE grant_row.source_event_id = NEW.idempotency_key
          AND (
            source_event.idempotency_key IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM json_each(source_event.summary_json, '$.grantedItemIds')
              WHERE type = 'text' AND value = grant_row.item_id
            )
            OR (catalog.source_kind = 'dojo-level' AND (
              profile.dojo_level < catalog.required_level
              OR NOT EXISTS (
                SELECT 1
                FROM json_each(source_event.summary_json, '$.dojoLevelsGained')
                WHERE type = 'integer' AND value = catalog.required_level
              )
            ))
            OR (catalog.source_kind = 'affinity-level' AND (
              affinity.level IS NULL
              OR affinity.level < catalog.required_level
              OR json_extract(source_event.summary_json, '$.characterId')
                IS NOT catalog.character_id
              OR NOT EXISTS (
                SELECT 1
                FROM json_each(
                  source_event.summary_json, '$.affinityLevelsGained'
                )
                WHERE type = 'integer' AND value = catalog.required_level
              )
            ))
          )
      )
      BEGIN SELECT RAISE(ABORT, 'invalid permanent grant source event'); END;

      CREATE TRIGGER validate_collection_inventory_shape_insert
      BEFORE INSERT ON inventory_items
      WHEN NEW.item_id != 'streak-fragment'
        AND (NEW.granted_at NOT BETWEEN 0 AND 253402300799999
        OR NEW.updated_at NOT BETWEEN NEW.granted_at AND 253402300799999
        )
      BEGIN SELECT RAISE(ABORT, 'invalid inventory timestamps'); END;

      CREATE TRIGGER validate_collection_inventory_shape_update
      BEFORE UPDATE ON inventory_items
      WHEN NEW.item_id != 'streak-fragment'
        AND OLD.item_id != 'streak-fragment'
        AND (NEW.profile_id != OLD.profile_id
        OR NEW.item_id != OLD.item_id
        OR NEW.granted_at NOT BETWEEN 0 AND 253402300799999
        OR NEW.updated_at NOT BETWEEN NEW.granted_at AND 253402300799999
        )
      BEGIN SELECT RAISE(ABORT, 'invalid inventory row'); END;

      CREATE TRIGGER validate_collection_equipment_shape_insert
      BEFORE INSERT ON profile_equipment
      WHEN NEW.updated_at NOT BETWEEN 0 AND 253402300799999
      BEGIN SELECT RAISE(ABORT, 'invalid equipment timestamp'); END;

      CREATE TRIGGER validate_collection_equipment_shape_update
      BEFORE UPDATE ON profile_equipment
      WHEN NEW.profile_id != OLD.profile_id
        OR NEW.slot != OLD.slot
        OR NEW.updated_at NOT BETWEEN 0 AND 253402300799999
      BEGIN SELECT RAISE(ABORT, 'invalid equipment row'); END;
    `,
  },
  {
    version: 14,
    name: 'poker_arena_persistence_schema',
    sql: `
      CREATE TABLE arena_seasons (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        ordinal INTEGER NOT NULL UNIQUE CHECK (ordinal >= 0),
        config_version INTEGER NOT NULL CHECK (config_version = 1),
        preseason INTEGER NOT NULL CHECK (preseason IN (0, 1)),
        starts_at INTEGER NOT NULL CHECK (
          starts_at BETWEEN 0 AND 253402300799999
        ),
        ends_at INTEGER NOT NULL CHECK (
          ends_at BETWEEN 0 AND 253402300799999 AND ends_at > starts_at
        ),
        created_at INTEGER NOT NULL CHECK (
          created_at BETWEEN 0 AND 253402300799999
        )
      ) STRICT;

      CREATE TABLE arena_profiles (
        season_id TEXT NOT NULL REFERENCES arena_seasons(id)
          ON DELETE CASCADE,
        profile_id TEXT NOT NULL REFERENCES profiles(id)
          ON DELETE CASCADE,
        available_tickets INTEGER NOT NULL CHECK (
          available_tickets BETWEEN 0 AND 10
        ),
        last_daily_grant_date TEXT NOT NULL CHECK (
          length(last_daily_grant_date) = 10
          AND last_daily_grant_date
            GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND CAST(substr(last_daily_grant_date, 1, 4) AS INTEGER)
            BETWEEN 1 AND 9999
          AND COALESCE(
            date(last_daily_grant_date, '+0 days') = last_daily_grant_date,
            0
          )
        ),
        placement_games INTEGER NOT NULL CHECK (placement_games BETWEEN 0 AND 5),
        placement_points INTEGER NOT NULL CHECK (
          placement_points >= 0
          AND placement_points <= placement_games * 100
        ),
        tier TEXT CHECK (
          tier IS NULL OR tier IN (
            'bronze','silver','gold','platinum','diamond','master'
          )
        ),
        mmr INTEGER NOT NULL CHECK (
          mmr BETWEEN -9007199254740991 AND 9007199254740991
        ),
        created_at INTEGER NOT NULL CHECK (
          created_at BETWEEN 0 AND 253402300799999
        ),
        updated_at INTEGER NOT NULL CHECK (
          updated_at BETWEEN created_at AND 253402300799999
        ),
        PRIMARY KEY (season_id, profile_id),
        CHECK (
          (placement_games < 5 AND tier IS NULL)
          OR (placement_games = 5 AND tier IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE arena_matches (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        season_id TEXT NOT NULL REFERENCES arena_seasons(id)
          ON DELETE RESTRICT,
        config_version INTEGER NOT NULL CHECK (config_version = 1),
        bot_version TEXT NOT NULL CHECK (length(bot_version) > 0),
        bot_mmr INTEGER NOT NULL CHECK (
          bot_mmr BETWEEN -9007199254740991 AND 9007199254740991
        ),
        human_count INTEGER NOT NULL CHECK (human_count BETWEEN 2 AND 6),
        bot_count INTEGER NOT NULL CHECK (
          bot_count BETWEEN 0 AND 4 AND human_count + bot_count = 6
        ),
        status TEXT NOT NULL CHECK (
          status IN ('forming','playing','finished','void')
        ),
        created_at INTEGER NOT NULL CHECK (
          created_at BETWEEN 0 AND 253402300799999
        ),
        started_at INTEGER CHECK (
          started_at IS NULL OR started_at BETWEEN created_at AND 253402300799999
        ),
        finished_at INTEGER CHECK (
          finished_at IS NULL
          OR finished_at BETWEEN COALESCE(started_at, created_at)
            AND 253402300799999
        ),
        CHECK (
          (status = 'forming' AND started_at IS NULL AND finished_at IS NULL)
          OR (status = 'playing' AND started_at IS NOT NULL AND finished_at IS NULL)
          OR (status = 'finished' AND started_at IS NOT NULL AND finished_at IS NOT NULL)
          OR (status = 'void' AND finished_at IS NOT NULL)
        ),
        UNIQUE (id, season_id)
      ) STRICT;

      CREATE TABLE arena_ticket_escrows (
        match_id TEXT NOT NULL,
        season_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('escrow','consumed','refunded')
        ),
        created_at INTEGER NOT NULL CHECK (
          created_at BETWEEN 0 AND 253402300799999
        ),
        settled_at INTEGER CHECK (
          settled_at IS NULL
          OR settled_at BETWEEN created_at AND 253402300799999
        ),
        PRIMARY KEY (match_id, profile_id),
        FOREIGN KEY (match_id, season_id)
          REFERENCES arena_matches(id, season_id) ON DELETE RESTRICT,
        FOREIGN KEY (season_id, profile_id)
          REFERENCES arena_profiles(season_id, profile_id) ON DELETE CASCADE,
        CHECK (
          (status = 'escrow' AND settled_at IS NULL)
          OR (status IN ('consumed','refunded') AND settled_at IS NOT NULL)
        )
      ) STRICT;

      CREATE UNIQUE INDEX one_active_arena_ticket_escrow_per_profile
        ON arena_ticket_escrows(profile_id) WHERE status = 'escrow';

      CREATE TABLE arena_entries (
        match_id TEXT NOT NULL,
        season_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        place INTEGER CHECK (place IS NULL OR place BETWEEN 1 AND 6),
        points INTEGER CHECK (
          points IS NULL OR points IN (0, 5, 15, 35, 60, 100)
        ),
        mmr_before INTEGER NOT NULL CHECK (
          mmr_before BETWEEN -9007199254740991 AND 9007199254740991
        ),
        mmr_after INTEGER CHECK (
          mmr_after IS NULL
          OR mmr_after BETWEEN -9007199254740991 AND 9007199254740991
        ),
        result_key TEXT UNIQUE CHECK (
          result_key IS NULL OR length(result_key) > 0
        ),
        created_at INTEGER NOT NULL CHECK (
          created_at BETWEEN 0 AND 253402300799999
        ),
        settled_at INTEGER CHECK (
          settled_at IS NULL
          OR settled_at BETWEEN created_at AND 253402300799999
        ),
        PRIMARY KEY (match_id, profile_id),
        FOREIGN KEY (match_id, season_id)
          REFERENCES arena_matches(id, season_id) ON DELETE RESTRICT,
        FOREIGN KEY (season_id, profile_id)
          REFERENCES arena_profiles(season_id, profile_id) ON DELETE CASCADE,
        CHECK (
          (result_key IS NULL AND place IS NULL AND points IS NULL
            AND mmr_after IS NULL AND settled_at IS NULL)
          OR (result_key IS NOT NULL AND place IS NOT NULL AND points IS NOT NULL
            AND mmr_after IS NOT NULL AND settled_at IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE arena_groups (
        id TEXT NOT NULL CHECK (length(id) > 0),
        season_id TEXT NOT NULL REFERENCES arena_seasons(id)
          ON DELETE RESTRICT,
        week_key TEXT NOT NULL CHECK (
          length(week_key) = 8
          AND week_key GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'
          AND CAST(substr(week_key, 1, 4) AS INTEGER) BETWEEN 1 AND 9999
          AND CAST(substr(week_key, 7, 2) AS INTEGER) BETWEEN 1 AND 53
        ),
        tier TEXT NOT NULL CHECK (
          tier IN ('bronze','silver','gold','platinum','diamond','master')
        ),
        status TEXT NOT NULL CHECK (status IN ('open','settled')),
        created_at INTEGER NOT NULL CHECK (
          created_at BETWEEN 0 AND 253402300799999
        ),
        settled_at INTEGER CHECK (
          settled_at IS NULL
          OR settled_at BETWEEN created_at AND 253402300799999
        ),
        PRIMARY KEY (id),
        UNIQUE (id, season_id, week_key),
        CHECK (
          (status = 'open' AND settled_at IS NULL)
          OR (status = 'settled' AND settled_at IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE arena_group_members (
        group_id TEXT NOT NULL,
        season_id TEXT NOT NULL,
        week_key TEXT NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id)
          ON DELETE CASCADE,
        points INTEGER NOT NULL CHECK (points >= 0),
        wins INTEGER NOT NULL CHECK (wins >= 0),
        top3 INTEGER NOT NULL CHECK (top3 >= 0),
        place_sum INTEGER NOT NULL CHECK (place_sum >= 0),
        matches INTEGER NOT NULL CHECK (matches >= 0),
        score_reached_at INTEGER NOT NULL CHECK (
          score_reached_at BETWEEN 0 AND 253402300799999
        ),
        joined_at INTEGER NOT NULL CHECK (
          joined_at BETWEEN 0 AND score_reached_at
        ),
        updated_at INTEGER NOT NULL CHECK (
          updated_at BETWEEN score_reached_at AND 253402300799999
        ),
        PRIMARY KEY (group_id, profile_id),
        UNIQUE (season_id, week_key, profile_id),
        FOREIGN KEY (group_id, season_id, week_key)
          REFERENCES arena_groups(id, season_id, week_key)
          ON DELETE CASCADE,
        FOREIGN KEY (season_id, profile_id)
          REFERENCES arena_profiles(season_id, profile_id)
          ON DELETE CASCADE,
        CHECK (wins <= top3 AND top3 <= matches),
        CHECK (
          (matches = 0 AND wins = 0 AND top3 = 0 AND place_sum = 0)
          OR (matches > 0 AND place_sum BETWEEN matches AND matches * 6)
        )
      ) STRICT;

      CREATE TABLE arena_weekly_settlements (
        season_id TEXT NOT NULL,
        week_key TEXT NOT NULL,
        group_id TEXT NOT NULL,
        settled_at INTEGER NOT NULL CHECK (
          settled_at BETWEEN 0 AND 253402300799999
        ),
        PRIMARY KEY (season_id, week_key, group_id),
        FOREIGN KEY (group_id, season_id, week_key)
          REFERENCES arena_groups(id, season_id, week_key)
          ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE arena_season_rewards (
        season_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        item_id TEXT NOT NULL CHECK (length(item_id) > 0),
        granted_at INTEGER NOT NULL CHECK (
          granted_at BETWEEN 0 AND 253402300799999
        ),
        PRIMARY KEY (season_id, profile_id, item_id),
        FOREIGN KEY (season_id, profile_id)
          REFERENCES arena_profiles(season_id, profile_id)
          ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX idx_arena_profiles_profile_season
        ON arena_profiles(profile_id, season_id);
      CREATE INDEX idx_arena_matches_season_status_created
        ON arena_matches(season_id, status, created_at);
      CREATE INDEX idx_arena_entries_profile_match
        ON arena_entries(profile_id, match_id);
      CREATE INDEX idx_arena_groups_week_tier_status
        ON arena_groups(season_id, week_key, tier, status, created_at);
      CREATE INDEX idx_arena_group_members_rank
        ON arena_group_members(
          group_id, points DESC, wins DESC, top3 DESC, score_reached_at,
          profile_id
        );

      CREATE TRIGGER protect_arena_profile_update
      BEFORE UPDATE ON arena_profiles
      WHEN NEW.season_id != OLD.season_id
        OR NEW.profile_id != OLD.profile_id
        OR NEW.created_at != OLD.created_at
        OR NEW.updated_at < OLD.updated_at
      BEGIN SELECT RAISE(ABORT, 'invalid arena profile update'); END;

      CREATE TRIGGER protect_arena_match_update
      BEFORE UPDATE ON arena_matches
      WHEN NEW.id != OLD.id
        OR NEW.season_id != OLD.season_id
        OR NEW.config_version != OLD.config_version
        OR NEW.bot_version != OLD.bot_version
        OR NEW.bot_mmr != OLD.bot_mmr
        OR NEW.human_count != OLD.human_count
        OR NEW.bot_count != OLD.bot_count
        OR NEW.created_at != OLD.created_at
        OR (OLD.started_at IS NOT NULL AND NEW.started_at IS NOT OLD.started_at)
        OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
        OR (OLD.status = 'forming'
          AND NEW.status NOT IN ('forming','playing','void'))
        OR (OLD.status = 'playing'
          AND NEW.status NOT IN ('playing','finished','void'))
        OR (OLD.status IN ('finished','void') AND NEW.status != OLD.status)
      BEGIN SELECT RAISE(ABORT, 'invalid arena match update'); END;

      CREATE TRIGGER protect_arena_ticket_escrow_update
      BEFORE UPDATE ON arena_ticket_escrows
      WHEN NEW.match_id != OLD.match_id
        OR NEW.season_id != OLD.season_id
        OR NEW.profile_id != OLD.profile_id
        OR NEW.created_at != OLD.created_at
        OR (OLD.settled_at IS NOT NULL AND NEW.settled_at IS NOT OLD.settled_at)
        OR (OLD.status = 'escrow'
          AND NEW.status NOT IN ('escrow','consumed','refunded'))
        OR (OLD.status IN ('consumed','refunded') AND NEW.status != OLD.status)
      BEGIN SELECT RAISE(ABORT, 'invalid arena ticket escrow update'); END;

      CREATE TRIGGER protect_arena_entry_update
      BEFORE UPDATE ON arena_entries
      WHEN NEW.match_id != OLD.match_id
        OR NEW.season_id != OLD.season_id
        OR NEW.profile_id != OLD.profile_id
        OR NEW.mmr_before != OLD.mmr_before
        OR NEW.created_at != OLD.created_at
        OR (OLD.result_key IS NOT NULL AND (
          NEW.place IS NOT OLD.place
          OR NEW.points IS NOT OLD.points
          OR NEW.mmr_after IS NOT OLD.mmr_after
          OR NEW.result_key IS NOT OLD.result_key
          OR NEW.settled_at IS NOT OLD.settled_at
        ))
      BEGIN SELECT RAISE(ABORT, 'invalid arena entry update'); END;

      CREATE TRIGGER protect_arena_group_update
      BEFORE UPDATE ON arena_groups
      WHEN NEW.id != OLD.id
        OR NEW.season_id != OLD.season_id
        OR NEW.week_key != OLD.week_key
        OR NEW.tier != OLD.tier
        OR NEW.created_at != OLD.created_at
        OR (OLD.settled_at IS NOT NULL AND NEW.settled_at IS NOT OLD.settled_at)
        OR (OLD.status = 'settled' AND NEW.status != 'settled')
      BEGIN SELECT RAISE(ABORT, 'invalid arena group update'); END;

      CREATE TRIGGER validate_arena_weekly_settlement_insert
      BEFORE INSERT ON arena_weekly_settlements
      WHEN NOT EXISTS (
        SELECT 1 FROM arena_groups AS arena_group
        WHERE arena_group.id = NEW.group_id
          AND arena_group.season_id = NEW.season_id
          AND arena_group.week_key = NEW.week_key
          AND arena_group.status = 'settled'
          AND arena_group.settled_at <= NEW.settled_at
      )
      BEGIN SELECT RAISE(ABORT, 'arena group is not settled'); END;
    `,
  },
  {
    version: 15,
    name: 'harden_poker_arena_lifecycle_invariants',
    sql: `
      CREATE TABLE v15_arena_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_entries
      WHERE place IS NOT NULL AND points != CASE place
        WHEN 1 THEN 100 WHEN 2 THEN 60 WHEN 3 THEN 35
        WHEN 4 THEN 15 WHEN 5 THEN 5 WHEN 6 THEN 0
      END
      LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_entries
      WHERE place IS NULL AND points IS NOT NULL
      LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM (
        SELECT match_id, place, COUNT(*) AS duplicate_count
        FROM arena_entries
        WHERE place IS NOT NULL
        GROUP BY match_id, place
        HAVING duplicate_count > 1
      ) LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_seasons
      WHERE ordinal NOT BETWEEN 0 AND 9007199254740991
        OR starts_at NOT BETWEEN 0 AND 253402300799999
        OR ends_at NOT BETWEEN 0 AND 253402300799999
        OR ends_at <= starts_at
        OR created_at NOT BETWEEN 0 AND 253402300799999
      LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_group_members
      WHERE points NOT BETWEEN 0 AND 9007199254740991
        OR wins NOT BETWEEN 0 AND 9007199254740991
        OR top3 NOT BETWEEN 0 AND 9007199254740991
        OR place_sum NOT BETWEEN 0 AND 9007199254740991
        OR matches NOT BETWEEN 0 AND 9007199254740991
        OR wins > top3
        OR top3 > matches
        OR (matches = 0 AND place_sum != 0)
        OR (matches > 0 AND place_sum NOT BETWEEN matches AND matches * 6)
        OR score_reached_at NOT BETWEEN 0 AND 253402300799999
        OR joined_at NOT BETWEEN 0 AND score_reached_at
        OR updated_at NOT BETWEEN score_reached_at AND 253402300799999
      LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_groups
      WHERE created_at NOT BETWEEN 0 AND 253402300799999
        OR (
          status = 'open' AND settled_at IS NOT NULL
        )
        OR (
          status = 'settled'
          AND settled_at NOT BETWEEN created_at AND 253402300799999
        )
      LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_weekly_settlements
      WHERE settled_at NOT BETWEEN 0 AND 253402300799999
      LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_season_rewards
      WHERE granted_at NOT BETWEEN 0 AND 253402300799999
      LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_groups
      WHERE substr(week_key, 7, 2) = '53'
        AND NOT (
          CAST(strftime(
            '%w', substr(week_key, 1, 4) || '-01-01'
          ) AS INTEGER) = 4
          OR (
            CAST(strftime(
              '%w', substr(week_key, 1, 4) || '-01-01'
            ) AS INTEGER) = 3
            AND (
              CAST(substr(week_key, 1, 4) AS INTEGER) % 400 = 0
              OR (
                CAST(substr(week_key, 1, 4) AS INTEGER) % 4 = 0
                AND CAST(substr(week_key, 1, 4) AS INTEGER) % 100 != 0
              )
            )
          )
        )
      LIMIT 1;

      INSERT INTO v15_arena_validation (invalid)
      SELECT 1 FROM arena_weekly_settlements
      WHERE substr(week_key, 7, 2) = '53'
        AND NOT (
          CAST(strftime(
            '%w', substr(week_key, 1, 4) || '-01-01'
          ) AS INTEGER) = 4
          OR (
            CAST(strftime(
              '%w', substr(week_key, 1, 4) || '-01-01'
            ) AS INTEGER) = 3
            AND (
              CAST(substr(week_key, 1, 4) AS INTEGER) % 400 = 0
              OR (
                CAST(substr(week_key, 1, 4) AS INTEGER) % 4 = 0
                AND CAST(substr(week_key, 1, 4) AS INTEGER) % 100 != 0
              )
            )
          )
        )
      LIMIT 1;

      DROP TABLE v15_arena_validation;

      CREATE UNIQUE INDEX one_arena_finisher_per_place
        ON arena_entries(match_id, place) WHERE place IS NOT NULL;

      DROP TRIGGER protect_arena_profile_update;

      CREATE TRIGGER protect_arena_profile_update
      BEFORE UPDATE ON arena_profiles
      WHEN NEW.season_id != OLD.season_id
        OR NEW.profile_id != OLD.profile_id
        OR NEW.created_at != OLD.created_at
        OR NEW.updated_at < OLD.updated_at
        OR NEW.last_daily_grant_date < OLD.last_daily_grant_date
        OR NEW.placement_games < OLD.placement_games
        OR NEW.placement_games > OLD.placement_games + 1
        OR NEW.placement_points < OLD.placement_points
        OR (
          NEW.placement_games = OLD.placement_games
          AND NEW.placement_points != OLD.placement_points
        )
        OR (
          NEW.placement_games = OLD.placement_games + 1
          AND NEW.placement_points - OLD.placement_points
            NOT IN (0, 5, 15, 35, 60, 100)
        )
        OR (
          OLD.placement_games = 5
          AND (
            NEW.placement_games != OLD.placement_games
            OR NEW.placement_points != OLD.placement_points
          )
        )
      BEGIN SELECT RAISE(ABORT, 'invalid arena profile update'); END;

      CREATE TRIGGER validate_arena_entry_points_insert
      BEFORE INSERT ON arena_entries
      WHEN (NEW.place IS NULL) != (NEW.points IS NULL)
        OR (
          NEW.place IS NOT NULL
          AND NEW.points != CASE NEW.place
            WHEN 1 THEN 100 WHEN 2 THEN 60 WHEN 3 THEN 35
            WHEN 4 THEN 15 WHEN 5 THEN 5 WHEN 6 THEN 0
          END
        )
      BEGIN SELECT RAISE(ABORT, 'invalid arena placement points'); END;

      CREATE TRIGGER validate_arena_entry_points_update
      BEFORE UPDATE ON arena_entries
      WHEN (NEW.place IS NULL) != (NEW.points IS NULL)
        OR (
          NEW.place IS NOT NULL
          AND NEW.points != CASE NEW.place
            WHEN 1 THEN 100 WHEN 2 THEN 60 WHEN 3 THEN 35
            WHEN 4 THEN 15 WHEN 5 THEN 5 WHEN 6 THEN 0
          END
        )
      BEGIN SELECT RAISE(ABORT, 'invalid arena placement points'); END;

      CREATE TRIGGER validate_arena_season_safe_insert
      BEFORE INSERT ON arena_seasons
      WHEN NEW.ordinal > 9007199254740991
      BEGIN SELECT RAISE(ABORT, 'invalid arena season ordinal'); END;

      CREATE TRIGGER validate_arena_season_safe_update
      BEFORE UPDATE ON arena_seasons
      WHEN NEW.ordinal < 0 OR NEW.ordinal > 9007199254740991
      BEGIN SELECT RAISE(ABORT, 'invalid arena season ordinal'); END;

      CREATE TRIGGER validate_arena_group_counters_insert
      BEFORE INSERT ON arena_group_members
      WHEN NEW.points > 9007199254740991
        OR NEW.wins > 9007199254740991
        OR NEW.top3 > 9007199254740991
        OR NEW.place_sum > 9007199254740991
        OR NEW.matches > 9007199254740991
      BEGIN SELECT RAISE(ABORT, 'unsafe arena group counter'); END;

      CREATE TRIGGER validate_arena_group_counters_update
      BEFORE UPDATE ON arena_group_members
      WHEN NEW.points > 9007199254740991
        OR NEW.wins > 9007199254740991
        OR NEW.top3 > 9007199254740991
        OR NEW.place_sum > 9007199254740991
        OR NEW.matches > 9007199254740991
      BEGIN SELECT RAISE(ABORT, 'unsafe arena group counter'); END;

      CREATE TRIGGER validate_arena_group_week_insert
      BEFORE INSERT ON arena_groups
      WHEN substr(NEW.week_key, 7, 2) = '53'
        AND NOT (
          CAST(strftime(
            '%w', substr(NEW.week_key, 1, 4) || '-01-01'
          ) AS INTEGER) = 4
          OR (
            CAST(strftime(
              '%w', substr(NEW.week_key, 1, 4) || '-01-01'
            ) AS INTEGER) = 3
            AND (
              CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 400 = 0
              OR (
                CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 4 = 0
                AND CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 100 != 0
              )
            )
          )
        )
      BEGIN SELECT RAISE(ABORT, 'invalid arena ISO week'); END;

      CREATE TRIGGER validate_arena_group_week_update
      BEFORE UPDATE ON arena_groups
      WHEN substr(NEW.week_key, 7, 2) = '53'
        AND NOT (
          CAST(strftime(
            '%w', substr(NEW.week_key, 1, 4) || '-01-01'
          ) AS INTEGER) = 4
          OR (
            CAST(strftime(
              '%w', substr(NEW.week_key, 1, 4) || '-01-01'
            ) AS INTEGER) = 3
            AND (
              CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 400 = 0
              OR (
                CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 4 = 0
                AND CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 100 != 0
              )
            )
          )
        )
      BEGIN SELECT RAISE(ABORT, 'invalid arena ISO week'); END;

      CREATE TRIGGER validate_arena_settlement_week_insert
      BEFORE INSERT ON arena_weekly_settlements
      WHEN substr(NEW.week_key, 7, 2) = '53'
        AND NOT (
          CAST(strftime(
            '%w', substr(NEW.week_key, 1, 4) || '-01-01'
          ) AS INTEGER) = 4
          OR (
            CAST(strftime(
              '%w', substr(NEW.week_key, 1, 4) || '-01-01'
            ) AS INTEGER) = 3
            AND (
              CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 400 = 0
              OR (
                CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 4 = 0
                AND CAST(substr(NEW.week_key, 1, 4) AS INTEGER) % 100 != 0
              )
            )
          )
        )
      BEGIN SELECT RAISE(ABORT, 'invalid arena ISO week'); END;

      CREATE TRIGGER freeze_settled_arena_group_member_update
      BEFORE UPDATE ON arena_group_members
      WHEN EXISTS (
        SELECT 1 FROM arena_weekly_settlements AS settlement
        WHERE settlement.group_id = OLD.group_id
          AND settlement.season_id = OLD.season_id
          AND settlement.week_key = OLD.week_key
      )
      BEGIN SELECT RAISE(ABORT, 'arena standing is settled'); END;

      CREATE TRIGGER freeze_settled_arena_group_member_delete
      BEFORE DELETE ON arena_group_members
      WHEN EXISTS (
        SELECT 1 FROM arena_weekly_settlements AS settlement
        WHERE settlement.group_id = OLD.group_id
          AND settlement.season_id = OLD.season_id
          AND settlement.week_key = OLD.week_key
      ) AND EXISTS (
        SELECT 1 FROM profiles WHERE id = OLD.profile_id
      )
      BEGIN SELECT RAISE(ABORT, 'arena standing is settled'); END;

      CREATE TRIGGER freeze_arena_weekly_settlement_update
      BEFORE UPDATE ON arena_weekly_settlements
      BEGIN SELECT RAISE(ABORT, 'arena settlement is immutable'); END;

      CREATE TRIGGER freeze_arena_weekly_settlement_delete
      BEFORE DELETE ON arena_weekly_settlements
      BEGIN SELECT RAISE(ABORT, 'arena settlement is immutable'); END;

      CREATE TRIGGER freeze_arena_season_reward_update
      BEFORE UPDATE ON arena_season_rewards
      BEGIN SELECT RAISE(ABORT, 'arena season reward is immutable'); END;

      CREATE TRIGGER freeze_arena_season_reward_delete
      BEFORE DELETE ON arena_season_rewards
      WHEN EXISTS (
        SELECT 1 FROM profiles WHERE id = OLD.profile_id
      )
      BEGIN SELECT RAISE(ABORT, 'arena season reward is immutable'); END;

      CREATE TRIGGER protect_arena_profile_direct_delete
      BEFORE DELETE ON arena_profiles
      WHEN EXISTS (
        SELECT 1 FROM profiles WHERE id = OLD.profile_id
      )
      BEGIN SELECT RAISE(ABORT, 'delete arena profile through profile owner'); END;
    `,
  },
  {
    version: 16,
    name: 'audit_legacy_arena_persistence_rows',
    sql: `
      CREATE TABLE v16_arena_validation (
        invalid INTEGER NOT NULL CHECK (invalid = 0)
      ) STRICT;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_seasons
      WHERE length(id) = 0
        OR ordinal NOT BETWEEN 0 AND 9007199254740991
        OR config_version != 1
        OR preseason NOT IN (0, 1)
        OR starts_at NOT BETWEEN 0 AND 253402300799999
        OR ends_at NOT BETWEEN 0 AND 253402300799999
        OR ends_at <= starts_at
        OR created_at NOT BETWEEN 0 AND 253402300799999
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_profiles
      WHERE length(season_id) = 0
        OR length(profile_id) = 0
        OR available_tickets NOT BETWEEN 0 AND 10
        OR length(last_daily_grant_date) != 10
        OR last_daily_grant_date
          NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        OR CAST(substr(last_daily_grant_date, 1, 4) AS INTEGER)
          NOT BETWEEN 1 AND 9999
        OR COALESCE(
          date(last_daily_grant_date, '+0 days') != last_daily_grant_date,
          1
        )
        OR placement_games NOT BETWEEN 0 AND 5
        OR placement_points < 0
        OR placement_points > placement_games * 100
        OR (tier IS NOT NULL AND tier NOT IN (
          'bronze','silver','gold','platinum','diamond','master'
        ))
        OR NOT (
          (placement_games < 5 AND tier IS NULL)
          OR (placement_games = 5 AND tier IS NOT NULL)
        )
        OR mmr NOT BETWEEN -9007199254740991 AND 9007199254740991
        OR created_at NOT BETWEEN 0 AND 253402300799999
        OR updated_at NOT BETWEEN created_at AND 253402300799999
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_matches
      WHERE length(id) = 0
        OR length(season_id) = 0
        OR config_version != 1
        OR length(bot_version) = 0
        OR bot_mmr NOT BETWEEN -9007199254740991 AND 9007199254740991
        OR human_count NOT BETWEEN 2 AND 6
        OR bot_count NOT BETWEEN 0 AND 4
        OR human_count + bot_count != 6
        OR status NOT IN ('forming','playing','finished','void')
        OR created_at NOT BETWEEN 0 AND 253402300799999
        OR (started_at IS NOT NULL AND started_at
          NOT BETWEEN created_at AND 253402300799999)
        OR (finished_at IS NOT NULL AND finished_at
          NOT BETWEEN COALESCE(started_at, created_at) AND 253402300799999)
        OR NOT (
          (status = 'forming' AND started_at IS NULL AND finished_at IS NULL)
          OR (status = 'playing' AND started_at IS NOT NULL
            AND finished_at IS NULL)
          OR (status = 'finished' AND started_at IS NOT NULL
            AND finished_at IS NOT NULL)
          OR (status = 'void' AND finished_at IS NOT NULL)
        )
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_ticket_escrows
      WHERE length(match_id) = 0
        OR length(season_id) = 0
        OR length(profile_id) = 0
        OR status NOT IN ('escrow','consumed','refunded')
        OR created_at NOT BETWEEN 0 AND 253402300799999
        OR (settled_at IS NOT NULL
          AND settled_at NOT BETWEEN created_at AND 253402300799999)
        OR NOT (
          (status = 'escrow' AND settled_at IS NULL)
          OR (status IN ('consumed','refunded') AND settled_at IS NOT NULL)
        )
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_entries
      WHERE length(match_id) = 0
        OR length(season_id) = 0
        OR length(profile_id) = 0
        OR mmr_before NOT BETWEEN -9007199254740991 AND 9007199254740991
        OR created_at NOT BETWEEN 0 AND 253402300799999
        OR COALESCE(NOT (
          (result_key IS NULL AND place IS NULL AND points IS NULL
            AND mmr_after IS NULL AND settled_at IS NULL)
          OR (
            length(result_key) > 0
            AND place BETWEEN 1 AND 6
            AND points = CASE place
              WHEN 1 THEN 100 WHEN 2 THEN 60 WHEN 3 THEN 35
              WHEN 4 THEN 15 WHEN 5 THEN 5 WHEN 6 THEN 0
            END
            AND mmr_after BETWEEN -9007199254740991 AND 9007199254740991
            AND settled_at BETWEEN created_at AND 253402300799999
          )
        ), 1)
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_groups
      WHERE length(id) = 0
        OR length(season_id) = 0
        OR length(week_key) != 8
        OR week_key NOT GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'
        OR CAST(substr(week_key, 1, 4) AS INTEGER) NOT BETWEEN 1 AND 9999
        OR CAST(substr(week_key, 7, 2) AS INTEGER) NOT BETWEEN 1 AND 53
        OR (
          substr(week_key, 7, 2) = '53'
          AND NOT (
            CAST(strftime(
              '%w', substr(week_key, 1, 4) || '-01-01'
            ) AS INTEGER) = 4
            OR (
              CAST(strftime(
                '%w', substr(week_key, 1, 4) || '-01-01'
              ) AS INTEGER) = 3
              AND (
                CAST(substr(week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
        OR tier NOT IN ('bronze','silver','gold','platinum','diamond','master')
        OR status NOT IN ('open','settled')
        OR created_at NOT BETWEEN 0 AND 253402300799999
        OR (settled_at IS NOT NULL
          AND settled_at NOT BETWEEN created_at AND 253402300799999)
        OR NOT (
          (status = 'open' AND settled_at IS NULL)
          OR (status = 'settled' AND settled_at IS NOT NULL)
        )
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_group_members
      WHERE length(group_id) = 0
        OR length(season_id) = 0
        OR length(profile_id) = 0
        OR length(week_key) != 8
        OR week_key NOT GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'
        OR CAST(substr(week_key, 1, 4) AS INTEGER) NOT BETWEEN 1 AND 9999
        OR CAST(substr(week_key, 7, 2) AS INTEGER) NOT BETWEEN 1 AND 53
        OR (
          substr(week_key, 7, 2) = '53'
          AND NOT (
            CAST(strftime(
              '%w', substr(week_key, 1, 4) || '-01-01'
            ) AS INTEGER) = 4
            OR (
              CAST(strftime(
                '%w', substr(week_key, 1, 4) || '-01-01'
              ) AS INTEGER) = 3
              AND (
                CAST(substr(week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
        OR points NOT BETWEEN 0 AND 9007199254740991
        OR wins NOT BETWEEN 0 AND 9007199254740991
        OR top3 NOT BETWEEN 0 AND 9007199254740991
        OR place_sum NOT BETWEEN 0 AND 9007199254740991
        OR matches NOT BETWEEN 0 AND 9007199254740991
        OR wins > top3
        OR top3 > matches
        OR NOT (
          (matches = 0 AND wins = 0 AND top3 = 0 AND place_sum = 0)
          OR (matches > 0 AND place_sum BETWEEN matches AND matches * 6)
        )
        OR score_reached_at NOT BETWEEN 0 AND 253402300799999
        OR joined_at NOT BETWEEN 0 AND score_reached_at
        OR updated_at NOT BETWEEN score_reached_at AND 253402300799999
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_weekly_settlements
      WHERE length(season_id) = 0
        OR length(group_id) = 0
        OR length(week_key) != 8
        OR week_key NOT GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'
        OR CAST(substr(week_key, 1, 4) AS INTEGER) NOT BETWEEN 1 AND 9999
        OR CAST(substr(week_key, 7, 2) AS INTEGER) NOT BETWEEN 1 AND 53
        OR (
          substr(week_key, 7, 2) = '53'
          AND NOT (
            CAST(strftime(
              '%w', substr(week_key, 1, 4) || '-01-01'
            ) AS INTEGER) = 4
            OR (
              CAST(strftime(
                '%w', substr(week_key, 1, 4) || '-01-01'
              ) AS INTEGER) = 3
              AND (
                CAST(substr(week_key, 1, 4) AS INTEGER) % 400 = 0
                OR (
                  CAST(substr(week_key, 1, 4) AS INTEGER) % 4 = 0
                  AND CAST(substr(week_key, 1, 4) AS INTEGER) % 100 != 0
                )
              )
            )
          )
        )
        OR settled_at NOT BETWEEN 0 AND 253402300799999
        OR NOT EXISTS (
          SELECT 1 FROM arena_groups AS arena_group
          WHERE arena_group.id = arena_weekly_settlements.group_id
            AND arena_group.season_id = arena_weekly_settlements.season_id
            AND arena_group.week_key = arena_weekly_settlements.week_key
            AND arena_group.status = 'settled'
            AND arena_group.settled_at <= arena_weekly_settlements.settled_at
        )
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM arena_season_rewards
      WHERE length(season_id) = 0
        OR length(profile_id) = 0
        OR length(item_id) = 0
        OR granted_at NOT BETWEEN 0 AND 253402300799999
      LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM (
        SELECT profile_id FROM arena_ticket_escrows
        WHERE status = 'escrow'
        GROUP BY profile_id HAVING COUNT(*) > 1
      ) LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM (
        SELECT result_key FROM arena_entries
        WHERE result_key IS NOT NULL
        GROUP BY result_key HAVING COUNT(*) > 1
      ) LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM (
        SELECT match_id, place FROM arena_entries
        WHERE place IS NOT NULL
        GROUP BY match_id, place HAVING COUNT(*) > 1
      ) LIMIT 1;

      INSERT INTO v16_arena_validation (invalid)
      SELECT 1 FROM pragma_foreign_key_check
      WHERE "table" LIKE 'arena_%'
      LIMIT 1;

      DROP TABLE v16_arena_validation;
    `,
  },
  {
    version: 17,
    name: 'index_due_arena_weekly_groups',
    sql: `
      CREATE INDEX idx_arena_groups_open_week_order
        ON arena_groups(status, week_key, season_id, created_at, id);

      CREATE INDEX idx_arena_group_members_profile_due_week
        ON arena_group_members(profile_id, season_id, week_key, group_id);
    `,
  },
  {
    version: 18,
    name: 'settle_and_reward_arena_seasons',
    sql: `
      CREATE TABLE arena_season_catalog (
        season_id TEXT NOT NULL REFERENCES arena_seasons(id)
          ON DELETE RESTRICT,
        item_id TEXT PRIMARY KEY CHECK (
          length(item_id) BETWEEN 1 AND 128
          AND item_id NOT GLOB '*[^A-Za-z0-9_-]*'
        ),
        reward_key TEXT NOT NULL CHECK (reward_key IN (
          'participation-emblem',
          'gold-frame',
          'diamond-featured-skin',
          'master-cutin',
          'top100-chroma',
          'top100-title',
          'rank-1-title',
          'rank-2-title',
          'rank-3-title',
          'rank-4-title',
          'rank-5-title',
          'rank-6-title',
          'rank-7-title',
          'rank-8-title',
          'rank-9-title',
          'rank-10-title',
          'champion-trophy',
          'champion-aura'
        )),
        kind TEXT NOT NULL CHECK (kind IN (
          'emblem', 'frame', 'skin', 'cutin', 'title', 'trophy', 'aura'
        )),
        equip_slot TEXT CHECK (
          equip_slot IS NULL OR equip_slot IN ('title','frame','skin','cutin')
        ),
        character_id TEXT CHECK (character_id IS NULL OR character_id IN (
          'sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena'
        )),
        UNIQUE (season_id, reward_key),
        CHECK (item_id = season_id || '-' || reward_key),
        CHECK (
          (kind = 'frame' AND equip_slot = 'frame' AND character_id IS NULL)
          OR (kind = 'skin' AND equip_slot = 'skin'
            AND character_id IS NOT NULL)
          OR (kind = 'cutin' AND equip_slot = 'cutin'
            AND character_id IS NULL)
          OR (kind = 'title' AND equip_slot = 'title'
            AND character_id IS NULL)
          OR (kind IN ('emblem','trophy','aura')
            AND equip_slot IS NULL AND character_id IS NULL)
        )
      ) STRICT;

      CREATE TABLE arena_season_results (
        season_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        final_rank INTEGER NOT NULL CHECK (final_rank >= 1),
        points INTEGER NOT NULL CHECK (points >= 0),
        wins INTEGER NOT NULL CHECK (wins >= 0),
        top3 INTEGER NOT NULL CHECK (top3 >= 0),
        place_sum INTEGER NOT NULL CHECK (place_sum >= 1),
        matches INTEGER NOT NULL CHECK (matches >= 1),
        score_reached_at INTEGER NOT NULL CHECK (
          score_reached_at BETWEEN 0 AND 253402300799999
        ),
        final_tier TEXT CHECK (final_tier IS NULL OR final_tier IN (
          'bronze','silver','gold','platinum','diamond','master'
        )),
        settled_at INTEGER NOT NULL CHECK (
          settled_at BETWEEN score_reached_at AND 253402300799999
        ),
        PRIMARY KEY (season_id, profile_id),
        UNIQUE (season_id, final_rank),
        FOREIGN KEY (season_id, profile_id)
          REFERENCES arena_profiles(season_id, profile_id)
          ON DELETE CASCADE,
        CHECK (wins <= top3 AND top3 <= matches),
        CHECK (place_sum BETWEEN matches AND matches * 6)
      ) STRICT;

      CREATE TABLE arena_season_settlements (
        season_id TEXT PRIMARY KEY REFERENCES arena_seasons(id)
          ON DELETE RESTRICT,
        next_season_id TEXT NOT NULL UNIQUE REFERENCES arena_seasons(id)
          ON DELETE RESTRICT,
        participant_count INTEGER NOT NULL CHECK (participant_count >= 0),
        settled_at INTEGER NOT NULL CHECK (
          settled_at BETWEEN 0 AND 253402300799999
        ),
        CHECK (season_id != next_season_id)
      ) STRICT;

      CREATE TABLE arena_hall_of_fame (
        season_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        final_rank INTEGER NOT NULL CHECK (final_rank = 1),
        trophy_item_id TEXT NOT NULL,
        aura_item_id TEXT NOT NULL,
        recorded_at INTEGER NOT NULL CHECK (
          recorded_at BETWEEN 0 AND 253402300799999
        ),
        FOREIGN KEY (season_id, profile_id)
          REFERENCES arena_season_results(season_id, profile_id)
          ON DELETE CASCADE,
        FOREIGN KEY (trophy_item_id)
          REFERENCES arena_season_catalog(item_id) ON DELETE RESTRICT,
        FOREIGN KEY (aura_item_id)
          REFERENCES arena_season_catalog(item_id) ON DELETE RESTRICT,
        CHECK (trophy_item_id = season_id || '-champion-trophy'),
        CHECK (aura_item_id = season_id || '-champion-aura')
      ) STRICT;

      CREATE INDEX idx_arena_entries_season_final_rank
        ON arena_entries(
          season_id, profile_id, settled_at, points, place
        ) WHERE result_key IS NOT NULL;
      CREATE INDEX idx_arena_season_results_rank
        ON arena_season_results(season_id, final_rank, profile_id);

      CREATE TRIGGER freeze_arena_season_catalog_update
      BEFORE UPDATE ON arena_season_catalog
      BEGIN SELECT RAISE(ABORT, 'arena season catalog is immutable'); END;
      CREATE TRIGGER freeze_arena_season_catalog_delete
      BEFORE DELETE ON arena_season_catalog
      WHEN EXISTS (SELECT 1 FROM arena_seasons WHERE id = OLD.season_id)
      BEGIN SELECT RAISE(ABORT, 'arena season catalog is immutable'); END;

      CREATE TRIGGER freeze_arena_season_result_update
      BEFORE UPDATE ON arena_season_results
      BEGIN SELECT RAISE(ABORT, 'arena season result is immutable'); END;
      CREATE TRIGGER freeze_arena_season_result_delete
      BEFORE DELETE ON arena_season_results
      WHEN EXISTS (SELECT 1 FROM profiles WHERE id = OLD.profile_id)
      BEGIN SELECT RAISE(ABORT, 'arena season result is immutable'); END;

      CREATE TRIGGER freeze_arena_season_settlement_update
      BEFORE UPDATE ON arena_season_settlements
      BEGIN SELECT RAISE(ABORT, 'arena season settlement is immutable'); END;
      CREATE TRIGGER freeze_arena_season_settlement_delete
      BEFORE DELETE ON arena_season_settlements
      WHEN EXISTS (SELECT 1 FROM arena_seasons WHERE id = OLD.season_id)
      BEGIN SELECT RAISE(ABORT, 'arena season settlement is immutable'); END;

      CREATE TRIGGER freeze_arena_hall_of_fame_update
      BEFORE UPDATE ON arena_hall_of_fame
      BEGIN SELECT RAISE(ABORT, 'arena hall of fame is immutable'); END;
      CREATE TRIGGER freeze_arena_hall_of_fame_delete
      BEFORE DELETE ON arena_hall_of_fame
      WHEN EXISTS (SELECT 1 FROM profiles WHERE id = OLD.profile_id)
      BEGIN SELECT RAISE(ABORT, 'arena hall of fame is immutable'); END;

      CREATE TRIGGER validate_arena_season_reward_insert
      BEFORE INSERT ON arena_season_rewards
      WHEN NEW.season_id GLOB 'arena-v1-[0-9]*'
      AND NOT EXISTS (
        SELECT 1 FROM arena_season_catalog AS catalog
        WHERE catalog.season_id = NEW.season_id
          AND catalog.item_id = NEW.item_id
      )
      BEGIN SELECT RAISE(ABORT, 'invalid arena season reward'); END;

      CREATE TRIGGER sync_arena_season_reward_inventory
      AFTER INSERT ON arena_season_rewards
      WHEN EXISTS (
        SELECT 1 FROM arena_season_catalog AS catalog
        WHERE catalog.season_id = NEW.season_id
          AND catalog.item_id = NEW.item_id
      )
      BEGIN
        INSERT INTO inventory_items (
          profile_id, item_id, quantity, granted_at, updated_at
        ) VALUES (
          NEW.profile_id, NEW.item_id, 1, NEW.granted_at, NEW.granted_at
        )
        ON CONFLICT(profile_id, item_id) DO NOTHING;
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM inventory_items
          WHERE profile_id = NEW.profile_id
            AND item_id = NEW.item_id
            AND quantity = 1
            AND granted_at = NEW.granted_at
            AND updated_at = NEW.granted_at
        ) THEN RAISE(ABORT, 'arena reward inventory mismatch') END;
      END;

      CREATE TRIGGER protect_arena_season_reward_inventory_update
      BEFORE UPDATE ON inventory_items
      WHEN EXISTS (
        SELECT 1 FROM arena_season_rewards
        WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
      )
      BEGIN SELECT RAISE(ABORT, 'immutable arena reward inventory'); END;

      CREATE TRIGGER protect_arena_season_reward_inventory_delete
      BEFORE DELETE ON inventory_items
      WHEN EXISTS (
        SELECT 1 FROM arena_season_rewards
        WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id
      ) AND EXISTS (
        SELECT 1 FROM profiles WHERE id = OLD.profile_id
      )
      BEGIN SELECT RAISE(ABORT, 'immutable arena reward inventory'); END;

      DROP TRIGGER validate_catalog_inventory_insert;
      DROP TRIGGER validate_catalog_inventory_update;
      DROP TRIGGER validate_catalog_equipment_insert;
      DROP TRIGGER validate_catalog_equipment_update;
      DROP TRIGGER validate_selected_character_skin_update;

      CREATE TRIGGER validate_catalog_inventory_insert
      BEFORE INSERT ON inventory_items
      WHEN NOT EXISTS (
        SELECT 1 FROM collection_catalog AS catalog
        WHERE catalog.item_id = NEW.item_id
          AND ((catalog.stackable = 0 AND NEW.quantity = 1)
            OR (catalog.stackable = 1 AND NEW.quantity >= 1))
      ) AND NOT EXISTS (
        SELECT 1 FROM arena_season_catalog AS catalog
        WHERE catalog.item_id = NEW.item_id AND NEW.quantity = 1
      )
      BEGIN SELECT RAISE(ABORT, 'invalid catalog inventory item'); END;

      CREATE TRIGGER validate_catalog_inventory_update
      BEFORE UPDATE ON inventory_items
      WHEN NEW.item_id != 'streak-fragment'
        AND OLD.item_id != 'streak-fragment'
        AND NOT EXISTS (
          SELECT 1 FROM collection_catalog AS catalog
          WHERE catalog.item_id = NEW.item_id
            AND ((catalog.stackable = 0 AND NEW.quantity = 1)
              OR (catalog.stackable = 1 AND NEW.quantity >= 1))
        )
        AND NOT EXISTS (
          SELECT 1 FROM arena_season_catalog AS catalog
          WHERE catalog.item_id = NEW.item_id AND NEW.quantity = 1
        )
      BEGIN SELECT RAISE(ABORT, 'invalid catalog inventory item'); END;

      CREATE TRIGGER validate_catalog_equipment_insert
      BEFORE INSERT ON profile_equipment
      WHEN NOT EXISTS (
        SELECT 1 FROM progression_profiles WHERE profile_id = NEW.profile_id
      ) OR (NEW.item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM collection_catalog AS catalog
          JOIN inventory_items AS inventory
            ON inventory.profile_id = NEW.profile_id
            AND inventory.item_id = NEW.item_id
            AND inventory.quantity >= 1
          JOIN progression_profiles AS profile
            ON profile.profile_id = NEW.profile_id
          WHERE catalog.item_id = NEW.item_id
            AND catalog.equip_slot = NEW.slot
            AND (catalog.kind != 'skin'
              OR catalog.character_id = profile.selected_character_id)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM arena_season_catalog AS catalog
          JOIN inventory_items AS inventory
            ON inventory.profile_id = NEW.profile_id
            AND inventory.item_id = NEW.item_id
            AND inventory.quantity = 1
          JOIN progression_profiles AS profile
            ON profile.profile_id = NEW.profile_id
          WHERE catalog.item_id = NEW.item_id
            AND catalog.equip_slot = NEW.slot
            AND (catalog.kind != 'skin'
              OR catalog.character_id = profile.selected_character_id)
        )
      )
      BEGIN SELECT RAISE(ABORT, 'invalid catalog equipment'); END;

      CREATE TRIGGER validate_catalog_equipment_update
      BEFORE UPDATE ON profile_equipment
      WHEN NOT EXISTS (
        SELECT 1 FROM progression_profiles WHERE profile_id = NEW.profile_id
      ) OR (NEW.item_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM collection_catalog AS catalog
          JOIN inventory_items AS inventory
            ON inventory.profile_id = NEW.profile_id
            AND inventory.item_id = NEW.item_id
            AND inventory.quantity >= 1
          JOIN progression_profiles AS profile
            ON profile.profile_id = NEW.profile_id
          WHERE catalog.item_id = NEW.item_id
            AND catalog.equip_slot = NEW.slot
            AND (catalog.kind != 'skin'
              OR catalog.character_id = profile.selected_character_id)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM arena_season_catalog AS catalog
          JOIN inventory_items AS inventory
            ON inventory.profile_id = NEW.profile_id
            AND inventory.item_id = NEW.item_id
            AND inventory.quantity = 1
          JOIN progression_profiles AS profile
            ON profile.profile_id = NEW.profile_id
          WHERE catalog.item_id = NEW.item_id
            AND catalog.equip_slot = NEW.slot
            AND (catalog.kind != 'skin'
              OR catalog.character_id = profile.selected_character_id)
        )
      )
      BEGIN SELECT RAISE(ABORT, 'invalid catalog equipment'); END;

      CREATE TRIGGER validate_selected_character_skin_update
      BEFORE UPDATE OF selected_character_id ON progression_profiles
      WHEN EXISTS (
        SELECT 1
        FROM profile_equipment AS equipment
        JOIN collection_catalog AS catalog ON catalog.item_id = equipment.item_id
        WHERE equipment.profile_id = NEW.profile_id
          AND equipment.slot = 'skin'
          AND catalog.kind = 'skin'
          AND catalog.character_id != NEW.selected_character_id
      ) OR EXISTS (
        SELECT 1
        FROM profile_equipment AS equipment
        JOIN arena_season_catalog AS catalog
          ON catalog.item_id = equipment.item_id
        WHERE equipment.profile_id = NEW.profile_id
          AND equipment.slot = 'skin'
          AND catalog.kind = 'skin'
          AND catalog.character_id != NEW.selected_character_id
      )
      BEGIN SELECT RAISE(ABORT, 'selected character conflicts with skin'); END;
    `,
  },
  {
    version: 19,
    name: 'persist_arena_entry_weekly_ranks',
    sql: `
      ALTER TABLE arena_entries ADD COLUMN weekly_rank_before INTEGER
        CHECK (
          weekly_rank_before IS NULL
          OR weekly_rank_before BETWEEN 1 AND 9007199254740991
        );

      ALTER TABLE arena_entries ADD COLUMN weekly_rank_after INTEGER
        CHECK (
          weekly_rank_after IS NULL
          OR weekly_rank_after BETWEEN 1 AND 9007199254740991
        );

      CREATE TRIGGER validate_arena_entry_weekly_rank_insert
      BEFORE INSERT ON arena_entries
      WHEN (
          NEW.result_key IS NULL
          AND (
            NEW.weekly_rank_before IS NOT NULL
            OR NEW.weekly_rank_after IS NOT NULL
          )
        )
        OR (
          NEW.weekly_rank_before IS NOT NULL
          AND NEW.weekly_rank_after IS NULL
        )
      BEGIN SELECT RAISE(ABORT, 'invalid arena entry weekly rank'); END;

      CREATE TRIGGER validate_arena_entry_weekly_rank_update
      BEFORE UPDATE ON arena_entries
      WHEN (
          NEW.result_key IS NULL
          AND (
            NEW.weekly_rank_before IS NOT NULL
            OR NEW.weekly_rank_after IS NOT NULL
          )
        )
        OR (
          NEW.weekly_rank_before IS NOT NULL
          AND NEW.weekly_rank_after IS NULL
        )
        OR (
          OLD.result_key IS NOT NULL
          AND (
            NEW.weekly_rank_before IS NOT OLD.weekly_rank_before
            OR NEW.weekly_rank_after IS NOT OLD.weekly_rank_after
          )
        )
      BEGIN SELECT RAISE(ABORT, 'invalid arena entry weekly rank update'); END;
    `,
  },
  {
    version: 20,
    name: 'collect_player_feedback',
    sql: `
      CREATE TABLE feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
        alias TEXT NOT NULL CHECK (length(alias) BETWEEN 1 AND 64),
        category TEXT NOT NULL CHECK (category IN ('bug','idea','other')),
        message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
        created_at INTEGER NOT NULL CHECK (
          created_at BETWEEN 0 AND 253402300799999
        )
      ) STRICT;

      CREATE INDEX idx_feedback_profile_created
        ON feedback(profile_id, created_at);

      CREATE TRIGGER freeze_feedback_update
      BEFORE UPDATE ON feedback
      WHEN NEW.alias != OLD.alias
        OR NEW.category != OLD.category
        OR NEW.message != OLD.message
        OR NEW.created_at != OLD.created_at
      BEGIN SELECT RAISE(ABORT, 'feedback content is immutable'); END;
    `,
  },
  {
    version: 21,
    name: 'record_hand_history',
    sql: `
      CREATE TABLE hand_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        room_id TEXT NOT NULL CHECK (length(room_id) BETWEEN 1 AND 100),
        room_name TEXT NOT NULL CHECK (length(room_name) BETWEEN 1 AND 100),
        game_mode TEXT NOT NULL CHECK (game_mode IN ('cash','sng')),
        hand_number INTEGER NOT NULL CHECK (hand_number >= 1),
        big_blind INTEGER NOT NULL CHECK (big_blind >= 1),
        profit INTEGER NOT NULL,
        hero_cards TEXT NOT NULL CHECK (length(hero_cards) <= 512),
        board TEXT NOT NULL CHECK (length(board) <= 1024),
        detail TEXT NOT NULL CHECK (length(detail) <= 131072),
        played_at INTEGER NOT NULL CHECK (
          played_at BETWEEN 0 AND 253402300799999
        )
      ) STRICT;

      CREATE INDEX idx_hand_history_profile_id
        ON hand_history(profile_id, id);
    `,
  },
  {
    version: 22,
    name: 'ops_events_and_profile_activity',
    sql: `
      -- 운영 이벤트 영속 로그 — 인메모리 링 버퍼(재시작 소멸)와 별개로, 장애/조치 역추적용
      -- 신호 이벤트(http-reject·정산 실패·grace 만료·서버 시작 등)만 화이트리스트로 기록한다.
      CREATE TABLE ops_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL CHECK (at BETWEEN 0 AND 253402300799999),
        type TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 64),
        room_id TEXT CHECK (room_id IS NULL OR length(room_id) <= 100),
        player_id TEXT CHECK (player_id IS NULL OR length(player_id) <= 100),
        data TEXT NOT NULL DEFAULT '{}' CHECK (length(data) <= 8192)
      ) STRICT;

      CREATE INDEX idx_ops_event_at ON ops_event(at);
      CREATE INDEX idx_ops_event_type_at ON ops_event(type, at);

      -- 익명 프로필 활동 지표 — 백오피스 관측용 (개인정보 아님: 접속 횟수/마지막 활동 시각)
      ALTER TABLE profiles ADD COLUMN last_seen_at INTEGER;
      ALTER TABLE profiles ADD COLUMN connect_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 23,
    name: 'table_hand_audit_records',
    sql: `
      -- 테이블 단위 정본 핸드 기록 — id가 사이트 전역 핸드 ID (핸드 감사/콜루전 역추적의 기준).
      -- detail은 마스킹 전 전체 기록(모든 홀카드 포함)이므로 서버 전용:
      -- 조회는 토큰 게이트 운영 API(/api/admin/hands*)만, 브로드캐스트·플레이어 API 노출 금지.
      CREATE TABLE table_hand (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL CHECK (length(room_id) BETWEEN 1 AND 100),
        room_name TEXT NOT NULL CHECK (length(room_name) BETWEEN 1 AND 100),
        game_mode TEXT NOT NULL CHECK (game_mode IN ('cash','sng')),
        hand_number INTEGER NOT NULL CHECK (hand_number >= 1),
        big_blind INTEGER NOT NULL CHECK (big_blind >= 1),
        pot_total INTEGER NOT NULL CHECK (pot_total >= 0),
        rake INTEGER NOT NULL CHECK (rake >= 0),
        showdown INTEGER NOT NULL CHECK (showdown IN (0, 1)),
        player_count INTEGER NOT NULL CHECK (player_count BETWEEN 2 AND 9),
        human_count INTEGER NOT NULL CHECK (human_count >= 0),
        board TEXT NOT NULL CHECK (length(board) <= 1024),
        winners TEXT NOT NULL CHECK (length(winners) <= 4096),
        detail TEXT NOT NULL CHECK (length(detail) <= 131072),
        played_at INTEGER NOT NULL CHECK (
          played_at BETWEEN 0 AND 253402300799999
        )
      ) STRICT;

      CREATE INDEX idx_table_hand_room_id ON table_hand(room_id, id);
      CREATE INDEX idx_table_hand_played_at ON table_hand(played_at);

      -- 감사 기록은 정정 불가 — 삭제(보존 상한 정리)만 허용
      CREATE TRIGGER freeze_table_hand_update
      BEFORE UPDATE ON table_hand
      BEGIN SELECT RAISE(ABORT, 'table_hand is immutable'); END;

      -- 개인(히어로 관점) 기록 → 정본 기록 링크 (기존 행은 NULL 유지)
      ALTER TABLE hand_history ADD COLUMN table_hand_id INTEGER;
    `,
  },
  {
    version: 24,
    name: 'game_config_overrides',
    sql: `
      -- 런타임 게임 설정 오버라이드 (백오피스 핫 컨피그) — 행이 없으면 코드/env 기본값 사용.
      -- 오버라이드만 저장하므로 배포로 기본값이 바뀌어도 미오버라이드 키는 새 기본값을 따른다.
      -- 키/값 해석과 범위 검증의 단일 소스는 src/server/game-config/registry.ts.
      CREATE TABLE game_config (
        key TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
        value TEXT NOT NULL CHECK (length(value) <= 128),
        updated_at INTEGER NOT NULL CHECK (
          updated_at BETWEEN 0 AND 253402300799999
        )
      ) STRICT;
    `,
  },
  {
    version: 25,
    name: 'mtt_hand_records_and_tournament_link',
    sql: `
      -- MTT 핸드 기록 허용 + 토너먼트 조인 키.
      -- v21/v23의 game_mode CHECK가 ('cash','sng')만 허용해 MTT 테이블의 정본/개인 핸드 기록이
      -- 전부 조용히 실패(예외 삼킴 설계)하고 있었다. SQLite는 CHECK를 ALTER할 수 없어
      -- 테이블 재구축으로 넓힌다. table_hand에는 tournament_id(전역 핸드 ID ↔ 토너먼트
      -- 조인 키 — 분쟁·콜루전 조사용)도 함께 추가한다.
      CREATE TABLE table_hand_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL CHECK (length(room_id) BETWEEN 1 AND 100),
        room_name TEXT NOT NULL CHECK (length(room_name) BETWEEN 1 AND 100),
        game_mode TEXT NOT NULL CHECK (game_mode IN ('cash','sng','mtt')),
        hand_number INTEGER NOT NULL CHECK (hand_number >= 1),
        big_blind INTEGER NOT NULL CHECK (big_blind >= 1),
        pot_total INTEGER NOT NULL CHECK (pot_total >= 0),
        rake INTEGER NOT NULL CHECK (rake >= 0),
        showdown INTEGER NOT NULL CHECK (showdown IN (0, 1)),
        player_count INTEGER NOT NULL CHECK (player_count BETWEEN 2 AND 9),
        human_count INTEGER NOT NULL CHECK (human_count >= 0),
        board TEXT NOT NULL CHECK (length(board) <= 1024),
        winners TEXT NOT NULL CHECK (length(winners) <= 4096),
        detail TEXT NOT NULL CHECK (length(detail) <= 131072),
        played_at INTEGER NOT NULL CHECK (
          played_at BETWEEN 0 AND 253402300799999
        ),
        tournament_id TEXT CHECK (
          tournament_id IS NULL OR length(tournament_id) BETWEEN 1 AND 100
        )
      ) STRICT;

      INSERT INTO table_hand_next (
        id, room_id, room_name, game_mode, hand_number, big_blind, pot_total, rake,
        showdown, player_count, human_count, board, winners, detail, played_at,
        tournament_id
      )
      SELECT id, room_id, room_name, game_mode, hand_number, big_blind, pot_total, rake,
             showdown, player_count, human_count, board, winners, detail, played_at,
             NULL
      FROM table_hand;

      -- 전역 핸드 ID 시퀀스는 복사된 행의 max(id)가 AUTOINCREMENT 카운터를 자연 승계한다.
      -- (빈 테이블은 ID를 발급한 적이 없어 카운터 리셋이 무해 — 링크 충돌 불가)
      DROP TABLE table_hand;
      ALTER TABLE table_hand_next RENAME TO table_hand;

      CREATE INDEX idx_table_hand_room_id ON table_hand(room_id, id);
      CREATE INDEX idx_table_hand_played_at ON table_hand(played_at);
      CREATE INDEX idx_table_hand_tournament ON table_hand(tournament_id, id)
        WHERE tournament_id IS NOT NULL;

      CREATE TRIGGER freeze_table_hand_update
      BEFORE UPDATE ON table_hand
      BEGIN SELECT RAISE(ABORT, 'table_hand is immutable'); END;

      -- 개인(히어로 관점) 기록도 같은 CHECK 확장 재구축
      CREATE TABLE hand_history_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        room_id TEXT NOT NULL CHECK (length(room_id) BETWEEN 1 AND 100),
        room_name TEXT NOT NULL CHECK (length(room_name) BETWEEN 1 AND 100),
        game_mode TEXT NOT NULL CHECK (game_mode IN ('cash','sng','mtt')),
        hand_number INTEGER NOT NULL CHECK (hand_number >= 1),
        big_blind INTEGER NOT NULL CHECK (big_blind >= 1),
        profit INTEGER NOT NULL,
        hero_cards TEXT NOT NULL CHECK (length(hero_cards) <= 512),
        board TEXT NOT NULL CHECK (length(board) <= 1024),
        detail TEXT NOT NULL CHECK (length(detail) <= 131072),
        played_at INTEGER NOT NULL CHECK (
          played_at BETWEEN 0 AND 253402300799999
        ),
        table_hand_id INTEGER
      ) STRICT;

      INSERT INTO hand_history_next (
        id, profile_id, room_id, room_name, game_mode, hand_number,
        big_blind, profit, hero_cards, board, detail, played_at, table_hand_id
      )
      SELECT id, profile_id, room_id, room_name, game_mode, hand_number,
             big_blind, profit, hero_cards, board, detail, played_at, table_hand_id
      FROM hand_history;

      DROP TABLE hand_history;
      ALTER TABLE hand_history_next RENAME TO hand_history;

      CREATE INDEX idx_hand_history_profile_id
        ON hand_history(profile_id, id);
    `,
  },
  {
    version: 26,
    name: 'mtt_tournament_entries',
    sql: `
      -- wallet MTT 토너 단위 에스크로 — sng_entries를 SnG(6인)+MTT(2~48인) 공용 참가
      -- 원장으로 일반화한다. MTT는 room_id 자리에 토너먼트 ID를 키로 쓰며, 순위가 6위를
      -- 넘으므로 place CHECK를 넓힌다 (SnG 결과 검증은 리포지토리가 여전히 6인을 강제).
      ALTER TABLE sng_entries RENAME TO sng_entries_v4_backup;

      CREATE TABLE sng_entries (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        buy_in INTEGER NOT NULL CHECK (buy_in > 0),
        fee INTEGER NOT NULL CHECK (fee > 0),
        status TEXT NOT NULL CHECK (status IN ('reserved','started','settled','refunded')),
        place INTEGER CHECK (place IS NULL OR place BETWEEN 1 AND 1000),
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
        id, tournament_id, room_id, profile_id, buy_in, fee,
        status, place, prize, start_attempt, created_at, updated_at
      FROM sng_entries_v4_backup;

      DROP TABLE sng_entries_v4_backup;

      CREATE UNIQUE INDEX one_active_sng_entry_per_profile
        ON sng_entries(profile_id)
        WHERE status IN ('reserved', 'started');

      CREATE INDEX idx_sng_entries_room_status_tournament
        ON sng_entries(room_id, status, tournament_id);
    `,
  },
  {
    version: 27,
    name: 'scheduled_mtt_lifecycle_and_promotion_fund',
    sql: `
      CREATE TABLE tournament_template (
        id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        idempotency_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        timezone TEXT NOT NULL CHECK (timezone = 'Asia/Seoul'),
        recurrence_json TEXT NOT NULL CHECK (json_valid(recurrence_json)),
        visible_lead_ms INTEGER NOT NULL CHECK (visible_lead_ms >= 0),
        registration_lead_ms INTEGER NOT NULL CHECK (registration_lead_ms >= 0),
        config_version INTEGER NOT NULL CHECK (config_version >= 1),
        config_json TEXT NOT NULL CHECK (json_valid(config_json)),
        created_by_kind TEXT NOT NULL,
        created_by_profile_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE tournament_instance (
        id TEXT PRIMARY KEY,
        template_id TEXT REFERENCES tournament_template(id),
        template_revision INTEGER CHECK (
          template_revision IS NULL OR template_revision >= 1
        ),
        idempotency_key TEXT NOT NULL UNIQUE,
        occurrence_key TEXT NOT NULL,
        visible_at INTEGER NOT NULL,
        registration_opens_at INTEGER NOT NULL,
        starts_at INTEGER,
        manual_expires_at INTEGER,
        status TEXT NOT NULL CHECK (status IN (
          'scheduled-hidden', 'scheduled-visible', 'registering',
          'start-delayed', 'starting', 'running', 'payout-pending',
          'refund-pending', 'completed', 'cancelled'
        )),
        status_reason TEXT CHECK (
          status_reason IS NULL OR status_reason IN (
            'capacity', 'restart-checkin-grace', 'not-enough', 'missed-start',
            'promotion-insufficient', 'financial-invariant', 'invalid-config',
            'template-superseded', 'operator-cancel',
            'server-restart-unrecoverable', 'start-economy-failed',
            'room-create-failed'
          )
        ),
        economy_mode TEXT NOT NULL CHECK (economy_mode IN ('freeroll', 'wallet')),
        registration_state TEXT NOT NULL CHECK (registration_state IN (
          'not-open', 'open-prestart', 'locked-for-start',
          'open-late', 'closing', 'closed'
        )),
        registration_close_reason TEXT CHECK (
          registration_close_reason IS NULL OR registration_close_reason IN (
            'late-reg-disabled', 'time', 'full', 'stack-floor', 'bubble',
            'final-table', 'last-player', 'tournament-cancelled',
            'tournament-completed'
          )
        ),
        registration_generation INTEGER NOT NULL DEFAULT 0 CHECK (
          registration_generation >= 0
        ),
        registration_owner_token TEXT,
        min_entrants INTEGER NOT NULL CHECK (min_entrants BETWEEN 2 AND 48),
        max_entrants INTEGER NOT NULL CHECK (
          max_entrants BETWEEN min_entrants AND 48
        ),
        initial_entrants INTEGER CHECK (
          initial_entrants IS NULL OR initial_entrants >= 1
        ),
        initial_bot_entrants INTEGER CHECK (
          initial_bot_entrants IS NULL OR initial_bot_entrants >= 0
        ),
        committed_entrants INTEGER CHECK (
          committed_entrants IS NULL OR committed_entrants >= 0
        ),
        pending_late_entrants INTEGER NOT NULL DEFAULT 0 CHECK (
          pending_late_entrants >= 0
        ),
        final_entrants INTEGER CHECK (
          final_entrants IS NULL OR final_entrants >= 1
        ),
        ever_multi_table INTEGER NOT NULL DEFAULT 0 CHECK (
          ever_multi_table IN (0, 1)
        ),
        forfeited_chips INTEGER NOT NULL DEFAULT 0 CHECK (forfeited_chips >= 0),
        payout_freeze_version INTEGER CHECK (
          payout_freeze_version IS NULL OR payout_freeze_version >= 1
        ),
        payout_freeze_json TEXT CHECK (
          payout_freeze_json IS NULL OR json_valid(payout_freeze_json)
        ),
        payout_freeze_aborted_at INTEGER,
        config_version INTEGER NOT NULL CHECK (config_version >= 1),
        config_json TEXT NOT NULL CHECK (json_valid(config_json)),
        created_by_kind TEXT NOT NULL,
        created_by_profile_id TEXT,
        director_profile_id TEXT,
        start_attempt INTEGER NOT NULL DEFAULT 0 CHECK (start_attempt >= 0),
        next_retry_at INTEGER,
        start_owner_id TEXT,
        start_lease_until INTEGER,
        settlement_attempt INTEGER NOT NULL DEFAULT 0 CHECK (
          settlement_attempt >= 0
        ),
        settlement_next_retry_at INTEGER,
        settlement_owner_id TEXT,
        settlement_lease_until INTEGER,
        actual_started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CHECK (
          (template_id IS NULL AND template_revision IS NULL)
          OR (template_id IS NOT NULL AND template_revision IS NOT NULL)
        ),
        CHECK (
          (
            starts_at IS NOT NULL
            AND manual_expires_at IS NULL
            AND visible_at <= registration_opens_at
            AND registration_opens_at <= starts_at
          )
          OR (
            starts_at IS NULL
            AND manual_expires_at IS NOT NULL
            AND visible_at <= registration_opens_at
            AND registration_opens_at < manual_expires_at
          )
        ),
        CHECK (
          (status IN ('scheduled-hidden', 'scheduled-visible')
            AND registration_state = 'not-open')
          OR (status = 'registering' AND registration_state = 'open-prestart')
          OR (status IN ('start-delayed', 'starting')
            AND registration_state = 'locked-for-start')
          OR (status = 'running'
            AND registration_state IN ('open-late', 'closing', 'closed'))
          OR (status IN (
              'payout-pending', 'refund-pending', 'completed', 'cancelled'
            ) AND registration_state = 'closed')
        ),
        CHECK (
          (
            registration_state IN ('closing', 'closed')
            AND registration_close_reason IS NOT NULL
          )
          OR (
            registration_state NOT IN ('closing', 'closed')
            AND registration_close_reason IS NULL
          )
        ),
        CHECK (
          (registration_state = 'closing' AND registration_owner_token IS NOT NULL)
          OR (registration_state <> 'closing' AND registration_owner_token IS NULL)
        ),
        CHECK (
          committed_entrants IS NULL
          OR committed_entrants + pending_late_entrants <= max_entrants
        ),
        CHECK (
          initial_bot_entrants IS NULL
          OR (
            initial_entrants IS NOT NULL
            AND committed_entrants IS NOT NULL
            AND initial_bot_entrants <= initial_entrants
            AND initial_entrants <= committed_entrants
          )
        ),
        CHECK (
          initial_entrants IS NULL
          OR (
            committed_entrants IS NOT NULL
            AND initial_entrants <= committed_entrants
          )
        ),
        CHECK (
          final_entrants IS NULL
          OR (
            pending_late_entrants = 0
            AND committed_entrants IS NOT NULL
            AND final_entrants = committed_entrants
          )
        ),
        CHECK (
          (final_entrants IS NULL
            AND payout_freeze_version IS NULL
            AND payout_freeze_json IS NULL)
          OR (final_entrants IS NOT NULL
            AND payout_freeze_version IS NOT NULL
            AND payout_freeze_json IS NOT NULL)
        ),
        CHECK (
          payout_freeze_aborted_at IS NULL
          OR (
            payout_freeze_version IS NOT NULL
            AND payout_freeze_json IS NOT NULL
            AND final_entrants IS NOT NULL
            AND status IN ('refund-pending', 'cancelled')
          )
        ),
        CHECK (
          (status IN (
            'scheduled-hidden', 'scheduled-visible', 'registering',
            'start-delayed', 'starting'
          ) AND actual_started_at IS NULL)
          OR (status IN ('running', 'payout-pending', 'completed')
            AND actual_started_at IS NOT NULL)
          OR status IN ('refund-pending', 'cancelled')
        ),
        CHECK (
          (status IN ('completed', 'cancelled') AND completed_at IS NOT NULL)
          OR (status NOT IN ('completed', 'cancelled') AND completed_at IS NULL)
        ),
        CHECK (
          (status = 'starting'
            AND start_owner_id IS NOT NULL
            AND start_lease_until IS NOT NULL)
          OR (status <> 'starting'
            AND start_owner_id IS NULL
            AND start_lease_until IS NULL)
        ),
        CHECK (
          (settlement_owner_id IS NULL AND settlement_lease_until IS NULL)
          OR (
            settlement_owner_id IS NOT NULL
            AND settlement_lease_until IS NOT NULL
            AND status = 'payout-pending'
          )
        )
      ) STRICT;

      CREATE UNIQUE INDEX one_effective_template_occurrence
        ON tournament_instance(template_id, occurrence_key)
        WHERE template_id IS NOT NULL
          AND (
            status <> 'cancelled'
            OR COALESCE(status_reason, '') <> 'template-superseded'
          );

      CREATE INDEX idx_tournament_instance_status_schedule
        ON tournament_instance(status, visible_at, registration_opens_at, starts_at);

      CREATE TRIGGER protect_tournament_instance_identity
      BEFORE UPDATE OF
        id, template_id, template_revision, idempotency_key, occurrence_key,
        visible_at, registration_opens_at, starts_at, manual_expires_at,
        economy_mode, min_entrants, max_entrants, config_version, config_json
      ON tournament_instance
      BEGIN
        SELECT RAISE(ABORT, 'tournament instance identity is immutable');
      END;

      CREATE TRIGGER protect_tournament_instance_monotonic_state
      BEFORE UPDATE ON tournament_instance
      WHEN
        (OLD.ever_multi_table = 1 AND NEW.ever_multi_table = 0)
        OR (
          OLD.payout_freeze_version IS NOT NULL
          AND (
            NEW.payout_freeze_version IS NOT OLD.payout_freeze_version
            OR NEW.payout_freeze_json IS NOT OLD.payout_freeze_json
            OR NEW.final_entrants IS NOT OLD.final_entrants
          )
        )
        OR (
          OLD.payout_freeze_aborted_at IS NOT NULL
          AND NEW.payout_freeze_aborted_at IS NOT OLD.payout_freeze_aborted_at
        )
        OR (OLD.actual_started_at IS NOT NULL
          AND NEW.actual_started_at IS NOT OLD.actual_started_at)
        OR (OLD.completed_at IS NOT NULL
          AND NEW.completed_at IS NOT OLD.completed_at)
        OR (OLD.initial_entrants IS NOT NULL
          AND NEW.initial_entrants IS NOT OLD.initial_entrants)
        OR (OLD.initial_bot_entrants IS NOT NULL
          AND NEW.initial_bot_entrants IS NOT OLD.initial_bot_entrants)
        OR NEW.start_attempt < OLD.start_attempt
        OR NEW.settlement_attempt < OLD.settlement_attempt
        OR NEW.forfeited_chips < OLD.forfeited_chips
        OR (
          OLD.status IN (
            'payout-pending', 'refund-pending', 'completed', 'cancelled'
          )
          AND NEW.status_reason IS NOT OLD.status_reason
        )
        OR (
          OLD.registration_close_reason IS NOT NULL
          AND NEW.registration_close_reason
            IS NOT OLD.registration_close_reason
        )
      BEGIN
        SELECT RAISE(ABORT, 'tournament instance monotonic state is immutable');
      END;

      CREATE TRIGGER protect_tournament_instance_lifecycle
      BEFORE UPDATE OF status ON tournament_instance
      WHEN OLD.status <> NEW.status AND NOT (
        (OLD.status = 'scheduled-hidden'
          AND NEW.status IN (
            'scheduled-visible', 'registering', 'start-delayed',
            'cancelled', 'refund-pending'
          ))
        OR (OLD.status = 'scheduled-visible'
          AND NEW.status IN ('registering', 'cancelled', 'refund-pending'))
        OR (OLD.status = 'registering'
          AND NEW.status IN (
            'start-delayed', 'starting', 'cancelled', 'refund-pending'
          ))
        OR (OLD.status = 'start-delayed'
          AND NEW.status IN ('starting', 'cancelled', 'refund-pending'))
        OR (OLD.status = 'starting'
          AND NEW.status IN (
            'registering', 'start-delayed', 'running',
            'cancelled', 'refund-pending'
          ))
        OR (OLD.status = 'running'
          AND NEW.status IN ('payout-pending', 'refund-pending'))
        OR (OLD.status = 'payout-pending' AND NEW.status = 'completed')
        OR (OLD.status = 'refund-pending' AND NEW.status = 'cancelled')
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid tournament lifecycle transition');
      END;

      CREATE TABLE tournament_registration (
        instance_id TEXT NOT NULL REFERENCES tournament_instance(id),
        profile_id TEXT NOT NULL,
        public_player_json TEXT NOT NULL CHECK (json_valid(public_player_json)),
        status TEXT NOT NULL CHECK (status IN (
          'registered', 'cancelled', 'no-show', 'seat-claimed',
          'late-pending', 'seated', 'eliminated', 'finished', 'refunded'
        )),
        ever_seated INTEGER NOT NULL DEFAULT 0 CHECK (ever_seated IN (0, 1)),
        registration_attempt INTEGER NOT NULL DEFAULT 1 CHECK (
          registration_attempt >= 1
        ),
        economy_entry_attempt INTEGER CHECK (
          economy_entry_attempt IS NULL OR economy_entry_attempt >= 1
        ),
        registered_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(instance_id, profile_id),
        CHECK (
          status NOT IN ('seated', 'eliminated', 'finished')
          OR ever_seated = 1
        )
      ) STRICT;

      CREATE UNIQUE INDEX one_active_mtt_claim_per_profile
        ON tournament_registration(profile_id)
        WHERE status IN ('seat-claimed', 'late-pending', 'seated');

      CREATE INDEX idx_tournament_registration_instance_status
        ON tournament_registration(instance_id, status);

      CREATE TRIGGER protect_tournament_registration_history
      BEFORE UPDATE ON tournament_registration
      WHEN
        (OLD.ever_seated = 1 AND NEW.ever_seated = 0)
        OR (
          OLD.ever_seated = 1
          AND NEW.status IN ('registered', 'late-pending')
        )
        OR (
          OLD.status IN ('no-show', 'cancelled', 'refunded')
          AND NEW.status IN ('registered', 'late-pending')
          AND (
            OLD.ever_seated <> 0
            OR NEW.registration_attempt <> OLD.registration_attempt + 1
          )
        )
        OR (
          NOT (
            OLD.status IN ('no-show', 'cancelled', 'refunded')
            AND NEW.status IN ('registered', 'late-pending')
          )
          AND NEW.registration_attempt <> OLD.registration_attempt
        )
        OR (
          OLD.status IN ('no-show', 'cancelled', 'refunded')
          AND NEW.status = OLD.status
        )
        OR (
          OLD.status <> NEW.status
          AND NOT (
            (OLD.status = 'registered'
              AND NEW.status IN (
                'no-show', 'seat-claimed', 'refunded', 'cancelled'
              ))
            OR (OLD.status = 'seat-claimed'
              AND NEW.status IN (
                'registered', 'seated', 'refunded', 'cancelled'
              ))
            OR (OLD.status = 'late-pending'
              AND NEW.status IN ('seated', 'refunded', 'cancelled'))
            OR (OLD.status = 'seated'
              AND NEW.status IN (
                'eliminated', 'finished', 'refunded', 'cancelled'
              ))
            OR (OLD.status IN ('eliminated', 'finished')
              AND NEW.status IN ('refunded', 'cancelled'))
            OR (OLD.status IN ('no-show', 'cancelled', 'refunded')
              AND NEW.status IN ('registered', 'late-pending'))
          )
        )
        OR NEW.instance_id IS NOT OLD.instance_id
        OR NEW.profile_id IS NOT OLD.profile_id
      BEGIN
        SELECT RAISE(ABORT, 'invalid tournament registration history');
      END;

      CREATE TRIGGER validate_tournament_registration_insert
      BEFORE INSERT ON tournament_registration
      WHEN NEW.status NOT IN ('registered', 'late-pending')
      BEGIN
        SELECT RAISE(ABORT, 'registration must start open');
      END;

      CREATE TRIGGER freeze_tournament_registration_delete
      BEFORE DELETE ON tournament_registration
      BEGIN SELECT RAISE(ABORT, 'tournament registration is immutable'); END;

      CREATE TABLE tournament_registration_attempt (
        instance_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        registration_attempt INTEGER NOT NULL CHECK (registration_attempt >= 1),
        request_id TEXT NOT NULL,
        economy_entry_attempt INTEGER CHECK (
          economy_entry_attempt IS NULL OR economy_entry_attempt >= 1
        ),
        status TEXT NOT NULL CHECK (status IN (
          'registered', 'cancelled', 'no-show', 'seat-claimed',
          'late-pending', 'seated', 'eliminated', 'finished', 'refunded'
        )),
        close_generation INTEGER CHECK (
          close_generation IS NULL OR close_generation >= 0
        ),
        close_owner_token TEXT,
        close_reason TEXT CHECK (
          close_reason IS NULL OR close_reason IN (
            'late-reg-disabled', 'time', 'full', 'stack-floor', 'bubble',
            'final-table', 'last-player', 'tournament-cancelled',
            'tournament-completed'
          )
        ),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(instance_id, profile_id, registration_attempt),
        UNIQUE(instance_id, profile_id, request_id),
        FOREIGN KEY(instance_id, profile_id)
          REFERENCES tournament_registration(instance_id, profile_id),
        CHECK (
          (
            close_generation IS NULL
            AND close_owner_token IS NULL
            AND close_reason IS NULL
          )
          OR (
            close_generation IS NOT NULL
            AND close_owner_token IS NOT NULL
            AND close_reason IS NOT NULL
          )
        )
      ) STRICT;

      CREATE TRIGGER validate_tournament_registration_attempt_insert
      BEFORE INSERT ON tournament_registration_attempt
      WHEN
        NEW.status NOT IN ('registered', 'late-pending')
        OR NOT EXISTS (
          SELECT 1
          FROM tournament_registration AS registration
          WHERE registration.instance_id = NEW.instance_id
            AND registration.profile_id = NEW.profile_id
            AND registration.registration_attempt = NEW.registration_attempt
            AND registration.status = NEW.status
            AND registration.economy_entry_attempt IS NEW.economy_entry_attempt
        )
      BEGIN
        SELECT RAISE(ABORT, 'attempt must match current open registration');
      END;

      CREATE TRIGGER protect_tournament_registration_attempt_history
      BEFORE UPDATE ON tournament_registration_attempt
      WHEN
        NEW.instance_id IS NOT OLD.instance_id
        OR NEW.profile_id IS NOT OLD.profile_id
        OR NEW.registration_attempt IS NOT OLD.registration_attempt
        OR NEW.request_id IS NOT OLD.request_id
        OR NEW.economy_entry_attempt IS NOT OLD.economy_entry_attempt
        OR NEW.created_at IS NOT OLD.created_at
        OR NOT EXISTS (
          SELECT 1
          FROM tournament_registration AS registration
          WHERE registration.instance_id = OLD.instance_id
            AND registration.profile_id = OLD.profile_id
            AND registration.registration_attempt = OLD.registration_attempt
        )
        OR (
          OLD.close_generation IS NOT NULL
          AND (
            NEW.close_generation IS NOT OLD.close_generation
            OR NEW.close_owner_token IS NOT OLD.close_owner_token
            OR NEW.close_reason IS NOT OLD.close_reason
          )
        )
        OR (
          OLD.status <> NEW.status
          AND NOT (
            (OLD.status = 'registered'
              AND NEW.status IN (
                'no-show', 'seat-claimed', 'refunded', 'cancelled'
              ))
            OR (OLD.status = 'seat-claimed'
              AND NEW.status IN (
                'registered', 'seated', 'refunded', 'cancelled'
              ))
            OR (OLD.status = 'late-pending'
              AND NEW.status IN ('seated', 'refunded', 'cancelled'))
            OR (OLD.status = 'seated'
              AND NEW.status IN (
                'eliminated', 'finished', 'refunded', 'cancelled'
              ))
            OR (OLD.status IN ('eliminated', 'finished')
              AND NEW.status IN ('refunded', 'cancelled'))
          )
        )
        OR (
          OLD.status IN ('no-show', 'cancelled', 'refunded')
          AND NEW.status = OLD.status
        )
      BEGIN
        SELECT RAISE(ABORT, 'tournament registration attempt is immutable');
      END;

      CREATE TRIGGER freeze_tournament_registration_attempt_delete
      BEFORE DELETE ON tournament_registration_attempt
      BEGIN
        SELECT RAISE(ABORT, 'tournament registration attempt is immutable');
      END;

      CREATE TABLE tournament_forfeit (
        removal_id TEXT PRIMARY KEY,
        instance_id TEXT NOT NULL REFERENCES tournament_instance(id),
        player_id TEXT NOT NULL,
        profile_id TEXT,
        registration_attempt INTEGER CHECK (
          registration_attempt IS NULL OR registration_attempt >= 1
        ),
        amount INTEGER NOT NULL CHECK (amount >= 0),
        hand_number INTEGER NOT NULL CHECK (hand_number >= 1),
        created_by_profile_id TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(instance_id, player_id),
        CHECK (
          (profile_id IS NULL AND registration_attempt IS NULL)
          OR (profile_id IS NOT NULL AND registration_attempt IS NOT NULL)
        )
      ) STRICT;

      CREATE TRIGGER freeze_tournament_forfeit_update
      BEFORE UPDATE ON tournament_forfeit
      BEGIN SELECT RAISE(ABORT, 'tournament forfeit is immutable'); END;

      CREATE TRIGGER freeze_tournament_forfeit_delete
      BEFORE DELETE ON tournament_forfeit
      BEGIN SELECT RAISE(ABORT, 'tournament forfeit is immutable'); END;

      CREATE TABLE promotion_fund (
        account_id TEXT PRIMARY KEY CHECK (account_id = 'global'),
        balance INTEGER NOT NULL CHECK (balance >= 0),
        version INTEGER NOT NULL CHECK (version >= 0),
        updated_at INTEGER NOT NULL
      ) STRICT;

      INSERT INTO promotion_fund (account_id, balance, version, updated_at)
      VALUES ('global', 0, 0, 0);

      CREATE TABLE promotion_fund_ledger (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES promotion_fund(account_id),
        kind TEXT NOT NULL CHECK (kind IN (
          'admin-adjustment', 'freeroll-prize-reserve',
          'freeroll-bot-prize-return', 'freeroll-prize-refund'
        )),
        delta INTEGER NOT NULL CHECK (
          delta <> 0
          AND delta BETWEEN -2000000000 AND 2000000000
        ),
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        instance_id TEXT,
        actor_kind TEXT NOT NULL CHECK (
          actor_kind IN ('backoffice-admin', 'operator-profile', 'system')
        ),
        actor_id TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (
          length(trim(reason)) BETWEEN 5 AND 200
          AND reason = trim(reason)
        ),
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX idx_promotion_fund_ledger_instance
        ON promotion_fund_ledger(instance_id, created_at);

      CREATE UNIQUE INDEX one_freeroll_reserve_ledger_per_instance
        ON promotion_fund_ledger(instance_id)
        WHERE kind = 'freeroll-prize-reserve';

      CREATE UNIQUE INDEX one_freeroll_refund_ledger_per_instance
        ON promotion_fund_ledger(instance_id)
        WHERE kind = 'freeroll-prize-refund';

      CREATE UNIQUE INDEX one_freeroll_bot_return_ledger_per_instance
        ON promotion_fund_ledger(instance_id)
        WHERE kind = 'freeroll-bot-prize-return';

      CREATE TRIGGER reconcile_promotion_fund_ledger_insert
      BEFORE INSERT ON promotion_fund_ledger
      WHEN
        NEW.balance_after <> (
          SELECT balance + NEW.delta
          FROM promotion_fund
          WHERE account_id = NEW.account_id
        )
        OR (
          NEW.kind = 'admin-adjustment'
          AND (
            NEW.actor_kind <> 'backoffice-admin'
            OR NEW.instance_id IS NOT NULL
          )
        )
        OR (
          NEW.kind <> 'admin-adjustment'
          AND NEW.instance_id IS NULL
        )
        OR (
          NEW.kind = 'freeroll-prize-reserve'
          AND NEW.delta >= 0
        )
        OR (
          NEW.kind = 'freeroll-prize-reserve'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_instance AS instance
            WHERE instance.id = NEW.instance_id
              AND instance.economy_mode = 'freeroll'
              AND instance.status = 'scheduled-hidden'
          )
        )
        OR (
          NEW.kind IN (
            'freeroll-bot-prize-return', 'freeroll-prize-refund'
          )
          AND NEW.delta <= 0
        )
        OR (
          NEW.kind = 'freeroll-prize-refund'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_instance AS instance
            INNER JOIN tournament_prize_escrow AS escrow
              ON escrow.instance_id = instance.id
            WHERE instance.id = NEW.instance_id
              AND instance.status = 'refund-pending'
              AND escrow.status = 'reserved'
              AND NEW.delta = escrow.amount
          )
        )
        OR (
          NEW.kind = 'freeroll-bot-prize-return'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_instance AS instance
            INNER JOIN tournament_prize_escrow AS escrow
              ON escrow.instance_id = instance.id
            INNER JOIN tournament_settlement AS settlement
              ON settlement.instance_id = instance.id
            WHERE instance.id = NEW.instance_id
              AND instance.status = 'payout-pending'
              AND escrow.status = 'reserved'
              AND settlement.status = 'pending'
              AND NEW.delta = settlement.bot_return_total
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'promotion ledger does not reconcile');
      END;

      CREATE TRIGGER apply_promotion_fund_ledger_insert
      AFTER INSERT ON promotion_fund_ledger
      BEGIN
        UPDATE promotion_fund
        SET balance = NEW.balance_after,
            version = version + 1,
            updated_at = NEW.created_at
        WHERE account_id = NEW.account_id;
      END;

      CREATE TRIGGER protect_promotion_fund_update
      BEFORE UPDATE ON promotion_fund
      WHEN NOT (
        NEW.account_id IS OLD.account_id
        AND NEW.version = OLD.version + 1
        AND NEW.version = (
          SELECT COUNT(*)
          FROM promotion_fund_ledger
          WHERE account_id = OLD.account_id
        )
        AND NEW.balance = (
          SELECT balance_after
          FROM promotion_fund_ledger
          WHERE account_id = OLD.account_id
          ORDER BY rowid DESC
          LIMIT 1
        )
        AND NEW.updated_at = (
          SELECT created_at
          FROM promotion_fund_ledger
          WHERE account_id = OLD.account_id
          ORDER BY rowid DESC
          LIMIT 1
        )
      )
      BEGIN
        SELECT RAISE(ABORT, 'promotion fund changes require a ledger');
      END;

      CREATE TRIGGER freeze_promotion_fund_delete
      BEFORE DELETE ON promotion_fund
      BEGIN SELECT RAISE(ABORT, 'promotion fund is immutable'); END;

      CREATE TRIGGER freeze_promotion_fund_ledger_update
      BEFORE UPDATE ON promotion_fund_ledger
      BEGIN SELECT RAISE(ABORT, 'promotion fund ledger is immutable'); END;

      CREATE TRIGGER freeze_promotion_fund_ledger_delete
      BEFORE DELETE ON promotion_fund_ledger
      BEGIN SELECT RAISE(ABORT, 'promotion fund ledger is immutable'); END;

      CREATE TABLE tournament_prize_escrow (
        instance_id TEXT PRIMARY KEY REFERENCES tournament_instance(id),
        account_id TEXT NOT NULL REFERENCES promotion_fund(account_id)
          CHECK (account_id = 'global'),
        amount INTEGER NOT NULL CHECK (amount > 0),
        status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'refunded')),
        human_paid INTEGER NOT NULL DEFAULT 0 CHECK (human_paid >= 0),
        bot_returned INTEGER NOT NULL DEFAULT 0 CHECK (bot_returned >= 0),
        settlement_fingerprint TEXT,
        reserved_at INTEGER NOT NULL,
        settled_at INTEGER,
        refunded_at INTEGER,
        updated_at INTEGER NOT NULL,
        CHECK (
          (status = 'reserved'
            AND human_paid = 0
            AND bot_returned = 0
            AND settled_at IS NULL
            AND refunded_at IS NULL)
          OR (status = 'settled'
            AND human_paid + bot_returned = amount
            AND settlement_fingerprint IS NOT NULL
            AND settled_at IS NOT NULL
            AND refunded_at IS NULL)
          OR (status = 'refunded'
            AND human_paid = 0
            AND bot_returned = 0
            AND settled_at IS NULL
            AND refunded_at IS NOT NULL)
        )
      ) STRICT;

      CREATE TRIGGER validate_tournament_prize_escrow_insert
      BEFORE INSERT ON tournament_prize_escrow
      WHEN
        NEW.status <> 'reserved'
        OR NOT EXISTS (
          SELECT 1
          FROM tournament_instance AS instance
          WHERE instance.id = NEW.instance_id
            AND instance.economy_mode = 'freeroll'
            AND instance.status = 'scheduled-hidden'
        )
        OR NOT EXISTS (
          SELECT 1
          FROM promotion_fund_ledger AS ledger
          WHERE ledger.account_id = NEW.account_id
            AND ledger.instance_id = NEW.instance_id
            AND ledger.kind = 'freeroll-prize-reserve'
            AND ledger.delta = -NEW.amount
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid tournament prize reserve');
      END;

      CREATE TRIGGER protect_tournament_prize_escrow_update
      BEFORE UPDATE ON tournament_prize_escrow
      WHEN
        NEW.instance_id IS NOT OLD.instance_id
        OR NEW.account_id IS NOT OLD.account_id
        OR NEW.amount IS NOT OLD.amount
        OR NEW.reserved_at IS NOT OLD.reserved_at
        OR OLD.status IN ('settled', 'refunded')
        OR (
          OLD.status = 'reserved'
          AND NEW.status NOT IN ('reserved', 'settled', 'refunded')
        )
        OR (
          OLD.settlement_fingerprint IS NOT NULL
          AND NEW.settlement_fingerprint IS NOT OLD.settlement_fingerprint
        )
        OR (
          NEW.status = 'settled'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_instance AS instance
            WHERE instance.id = OLD.instance_id
              AND instance.status = 'payout-pending'
          )
        )
        OR (
          NEW.status = 'refunded'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_instance AS instance
            WHERE instance.id = OLD.instance_id
              AND instance.status = 'refund-pending'
          )
        )
        OR (
          NEW.status = 'refunded'
          AND NOT EXISTS (
            SELECT 1
            FROM promotion_fund_ledger AS ledger
            WHERE ledger.instance_id = OLD.instance_id
              AND ledger.kind = 'freeroll-prize-refund'
              AND ledger.delta = OLD.amount
          )
        )
        OR (
          NEW.status = 'settled'
          AND NEW.bot_returned > 0
          AND NOT EXISTS (
            SELECT 1
            FROM promotion_fund_ledger AS ledger
            WHERE ledger.instance_id = OLD.instance_id
              AND ledger.kind = 'freeroll-bot-prize-return'
              AND ledger.delta = NEW.bot_returned
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid tournament prize escrow transition');
      END;

      CREATE TRIGGER freeze_tournament_prize_escrow_delete
      BEFORE DELETE ON tournament_prize_escrow
      BEGIN SELECT RAISE(ABORT, 'tournament prize escrow is immutable'); END;

      CREATE TABLE tournament_settlement (
        instance_id TEXT PRIMARY KEY REFERENCES tournament_instance(id),
        status TEXT NOT NULL CHECK (status IN ('pending', 'settled')),
        payout_freeze_checksum TEXT NOT NULL,
        final_entrants INTEGER NOT NULL CHECK (final_entrants >= 1),
        prize_pool INTEGER NOT NULL CHECK (prize_pool > 0),
        human_payout_total INTEGER NOT NULL CHECK (human_payout_total >= 0),
        bot_return_total INTEGER NOT NULL CHECK (bot_return_total >= 0),
        fingerprint TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        settled_at INTEGER,
        updated_at INTEGER NOT NULL,
        CHECK (
          (status = 'pending' AND settled_at IS NULL)
          OR (status = 'settled' AND settled_at IS NOT NULL)
        ),
        CHECK (human_payout_total + bot_return_total = prize_pool)
      ) STRICT;

      CREATE TRIGGER validate_tournament_settlement_insert
      BEFORE INSERT ON tournament_settlement
      WHEN
        NEW.status <> 'pending'
        OR NOT EXISTS (
          SELECT 1
          FROM tournament_instance AS instance
          WHERE instance.id = NEW.instance_id
            AND instance.status = 'running'
            AND instance.registration_state = 'closed'
            AND instance.final_entrants = NEW.final_entrants
            AND instance.payout_freeze_version IS NOT NULL
            AND instance.payout_freeze_json IS NOT NULL
        )
      BEGIN
        SELECT RAISE(ABORT, 'settlement must start from a frozen running field');
      END;

      CREATE TRIGGER protect_tournament_settlement_update
      BEFORE UPDATE ON tournament_settlement
      WHEN
        NEW.instance_id IS NOT OLD.instance_id
        OR NEW.payout_freeze_checksum IS NOT OLD.payout_freeze_checksum
        OR NEW.final_entrants IS NOT OLD.final_entrants
        OR NEW.prize_pool IS NOT OLD.prize_pool
        OR NEW.human_payout_total IS NOT OLD.human_payout_total
        OR NEW.bot_return_total IS NOT OLD.bot_return_total
        OR NEW.fingerprint IS NOT OLD.fingerprint
        OR NEW.created_at IS NOT OLD.created_at
        OR OLD.status = 'settled'
        OR (OLD.status = 'pending' AND NEW.status NOT IN ('pending', 'settled'))
        OR (
          NEW.status = 'settled'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_instance AS instance
            WHERE instance.id = OLD.instance_id
              AND instance.status = 'payout-pending'
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid tournament settlement transition');
      END;

      CREATE TRIGGER freeze_tournament_settlement_delete
      BEFORE DELETE ON tournament_settlement
      BEGIN SELECT RAISE(ABORT, 'tournament settlement is immutable'); END;

      CREATE TABLE tournament_settlement_result (
        instance_id TEXT NOT NULL REFERENCES tournament_settlement(instance_id),
        place INTEGER NOT NULL CHECK (place >= 1),
        player_id TEXT NOT NULL,
        participant_type TEXT NOT NULL CHECK (
          participant_type IN ('human', 'bot')
        ),
        profile_id TEXT,
        registration_attempt INTEGER CHECK (
          registration_attempt IS NULL OR registration_attempt >= 1
        ),
        display_name_snapshot TEXT NOT NULL,
        prize INTEGER NOT NULL CHECK (prize >= 0),
        disposition TEXT NOT NULL CHECK (
          disposition IN ('wallet-credit', 'promotion-return', 'none')
        ),
        PRIMARY KEY(instance_id, place),
        UNIQUE(instance_id, player_id),
        CHECK (
          (participant_type = 'human'
            AND profile_id IS NOT NULL
            AND registration_attempt IS NOT NULL)
          OR (participant_type = 'bot'
            AND profile_id IS NULL
            AND registration_attempt IS NULL)
        ),
        CHECK (
          (prize = 0 AND disposition = 'none')
          OR (prize > 0
            AND participant_type = 'human'
            AND disposition = 'wallet-credit')
          OR (prize > 0
            AND participant_type = 'bot'
            AND disposition = 'promotion-return')
        )
      ) STRICT;

      CREATE UNIQUE INDEX one_settlement_result_per_profile
        ON tournament_settlement_result(instance_id, profile_id)
        WHERE profile_id IS NOT NULL;

      CREATE TRIGGER validate_tournament_settlement_result_insert
      BEFORE INSERT ON tournament_settlement_result
      WHEN
        NOT EXISTS (
          SELECT 1
          FROM tournament_settlement AS settlement
          WHERE settlement.instance_id = NEW.instance_id
            AND settlement.status = 'pending'
        )
        OR (
          NEW.participant_type = 'human'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_registration AS registration
            WHERE registration.instance_id = NEW.instance_id
              AND registration.profile_id = NEW.profile_id
              AND registration.registration_attempt = NEW.registration_attempt
              AND registration.ever_seated = 1
              AND registration.status IN ('seated', 'eliminated', 'finished')
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'settlement result does not match a pending plan');
      END;

      CREATE TRIGGER freeze_tournament_settlement_result_update
      BEFORE UPDATE ON tournament_settlement_result
      BEGIN SELECT RAISE(ABORT, 'tournament settlement result is immutable'); END;

      CREATE TRIGGER freeze_tournament_settlement_result_delete
      BEFORE DELETE ON tournament_settlement_result
      BEGIN SELECT RAISE(ABORT, 'tournament settlement result is immutable'); END;

      CREATE TRIGGER reject_terminal_tournament_instance_insert
      BEFORE INSERT ON tournament_instance
      WHEN
        NEW.status IN (
          'payout-pending', 'refund-pending', 'completed', 'cancelled'
        )
        OR (
          NEW.economy_mode = 'freeroll'
          AND NEW.status <> 'scheduled-hidden'
        )
      BEGIN
        SELECT RAISE(ABORT, 'terminal tournament instance requires a transition');
      END;

      CREATE TRIGGER protect_tournament_registration_cas
      BEFORE UPDATE ON tournament_instance
      WHEN
        NOT (
          OLD.registration_state = NEW.registration_state
          OR (OLD.registration_state = 'not-open'
            AND NEW.registration_state IN (
              'open-prestart', 'locked-for-start', 'closed'
            ))
          OR (OLD.registration_state = 'open-prestart'
            AND NEW.registration_state IN ('locked-for-start', 'closed'))
          OR (OLD.registration_state = 'locked-for-start'
            AND NEW.registration_state IN (
              'open-prestart', 'open-late', 'closed'
            ))
          OR (OLD.registration_state = 'open-late'
            AND NEW.registration_state IN ('closing', 'closed'))
          OR (OLD.registration_state = 'closing'
            AND NEW.registration_state = 'closed')
        )
        OR NEW.registration_generation < OLD.registration_generation
        OR (
          OLD.registration_state = NEW.registration_state
          AND (
            (
              OLD.registration_state = 'closing'
              AND (
                (
                  NEW.registration_owner_token IS OLD.registration_owner_token
                  AND NEW.registration_generation
                    <> OLD.registration_generation
                )
                OR (
                  NEW.registration_owner_token IS NOT OLD.registration_owner_token
                  AND NEW.registration_generation
                    <> OLD.registration_generation + 1
                )
              )
            )
            OR (
              OLD.registration_state <> 'closing'
              AND NEW.registration_generation <> OLD.registration_generation
            )
          )
        )
        OR (
          OLD.registration_state <> NEW.registration_state
          AND (
            (
              NEW.registration_state = 'closing'
              AND NEW.registration_generation
                <> OLD.registration_generation + 1
            )
            OR (
              NEW.registration_state = 'closed'
              AND OLD.registration_state <> 'closing'
              AND NEW.registration_generation
                <> OLD.registration_generation + 1
            )
            OR (
              NEW.registration_state = 'closed'
              AND OLD.registration_state = 'closing'
              AND NEW.registration_generation <> OLD.registration_generation
            )
            OR (
              NEW.registration_state NOT IN ('closing', 'closed')
              AND NEW.registration_generation <> OLD.registration_generation
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'invalid registration owner generation');
      END;

      CREATE TRIGGER require_tournament_financial_lifecycle
      BEFORE UPDATE OF status ON tournament_instance
      WHEN
        (
          NEW.economy_mode = 'freeroll'
          AND NEW.status IN (
            'scheduled-visible', 'registering', 'start-delayed',
            'starting', 'running', 'payout-pending'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_prize_escrow AS escrow
            WHERE escrow.instance_id = NEW.id
              AND escrow.account_id = 'global'
              AND escrow.status = 'reserved'
          )
        )
        OR (
          NEW.economy_mode = 'freeroll'
          AND NEW.status = 'refund-pending'
          AND COALESCE(NEW.status_reason, '') <> 'financial-invariant'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_prize_escrow AS escrow
            WHERE escrow.instance_id = NEW.id
              AND escrow.status = 'reserved'
          )
        )
        OR (
          NEW.status = 'cancelled'
          AND NEW.economy_mode = 'freeroll'
          AND NOT (
            EXISTS (
              SELECT 1
              FROM tournament_prize_escrow AS escrow
              WHERE escrow.instance_id = NEW.id
                AND escrow.status = 'refunded'
            )
            OR (
              OLD.status = 'scheduled-hidden'
              AND NEW.status_reason IN (
                'promotion-insufficient', 'invalid-config',
                'template-superseded', 'operator-cancel'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM tournament_prize_escrow AS escrow
                WHERE escrow.instance_id = NEW.id
              )
            )
          )
        )
      BEGIN
        SELECT RAISE(ABORT, 'tournament has unresolved financial liability');
      END;

      CREATE TRIGGER require_tournament_settlement_plan
      BEFORE UPDATE OF status ON tournament_instance
      WHEN NEW.status = 'payout-pending' AND OLD.status <> 'payout-pending'
      BEGIN
        SELECT CASE WHEN
          NEW.final_entrants IS NULL
          OR NEW.payout_freeze_version IS NULL
          OR NEW.payout_freeze_json IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM tournament_settlement AS settlement
            WHERE settlement.instance_id = NEW.id
              AND settlement.status = 'pending'
              AND settlement.final_entrants = NEW.final_entrants
          )
          OR (
            SELECT COUNT(*)
            FROM tournament_settlement_result AS result
            WHERE result.instance_id = NEW.id
          ) <> NEW.final_entrants
          OR (
            SELECT MIN(place)
            FROM tournament_settlement_result
            WHERE instance_id = NEW.id
          ) IS NOT 1
          OR (
            SELECT MAX(place)
            FROM tournament_settlement_result
            WHERE instance_id = NEW.id
          ) IS NOT NEW.final_entrants
          OR (
            SELECT COALESCE(SUM(prize), 0)
            FROM tournament_settlement_result
            WHERE instance_id = NEW.id
          ) <> (
            SELECT prize_pool
            FROM tournament_settlement
            WHERE instance_id = NEW.id
          )
          OR (
            SELECT COALESCE(SUM(prize), 0)
            FROM tournament_settlement_result
            WHERE instance_id = NEW.id AND participant_type = 'human'
          ) <> (
            SELECT human_payout_total
            FROM tournament_settlement
            WHERE instance_id = NEW.id
          )
          OR (
            SELECT COALESCE(SUM(prize), 0)
            FROM tournament_settlement_result
            WHERE instance_id = NEW.id AND participant_type = 'bot'
          ) <> (
            SELECT bot_return_total
            FROM tournament_settlement
            WHERE instance_id = NEW.id
          )
          OR (
            NEW.economy_mode = 'wallet'
            AND (
              EXISTS (
                SELECT 1
                FROM tournament_settlement_result
                WHERE instance_id = NEW.id AND participant_type = 'bot'
              )
              OR (
                SELECT bot_return_total
                FROM tournament_settlement
                WHERE instance_id = NEW.id
              ) <> 0
            )
          )
          OR (
            NEW.economy_mode = 'freeroll'
            AND NOT EXISTS (
              SELECT 1
              FROM tournament_prize_escrow AS escrow
              INNER JOIN tournament_settlement AS settlement
                ON settlement.instance_id = escrow.instance_id
              WHERE escrow.instance_id = NEW.id
                AND escrow.status = 'reserved'
                AND escrow.amount = settlement.prize_pool
                AND escrow.settlement_fingerprint = settlement.fingerprint
            )
          )
        THEN RAISE(ABORT, 'complete tournament settlement plan required')
        END;
      END;

      CREATE TRIGGER require_terminal_tournament_settlement
      BEFORE UPDATE OF status ON tournament_instance
      WHEN NEW.status = 'completed' AND OLD.status <> 'completed'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1
          FROM tournament_settlement AS settlement
          WHERE settlement.instance_id = NEW.id
            AND settlement.status = 'settled'
        ) THEN RAISE(ABORT, 'settled tournament plan required')
        END;
        SELECT CASE WHEN
          NEW.economy_mode = 'freeroll'
          AND NOT EXISTS (
            SELECT 1
            FROM tournament_prize_escrow AS escrow
            WHERE escrow.instance_id = NEW.id
              AND escrow.status = 'settled'
          )
        THEN RAISE(ABORT, 'settled freeroll escrow required')
        END;
      END;
    `,
  },
  {
    version: 28,
    name: 'mtt_entry_attempt_generations',
    sql: `
      ALTER TABLE sng_entries RENAME TO sng_entries_v26_backup;

      CREATE TABLE sng_entries (
        id TEXT PRIMARY KEY,
        tournament_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        buy_in INTEGER NOT NULL CHECK (buy_in > 0),
        fee INTEGER NOT NULL CHECK (fee > 0),
        status TEXT NOT NULL CHECK (
          status IN ('reserved','started','settled','refunded')
        ),
        place INTEGER CHECK (place IS NULL OR place BETWEEN 1 AND 1000),
        prize INTEGER NOT NULL DEFAULT 0 CHECK (prize >= 0),
        start_attempt INTEGER NOT NULL DEFAULT 0 CHECK (start_attempt >= 0),
        entry_attempt INTEGER NOT NULL DEFAULT 1 CHECK (entry_attempt >= 1),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (tournament_id, profile_id, entry_attempt)
      ) STRICT;

      INSERT INTO sng_entries (
        id, tournament_id, room_id, profile_id, buy_in, fee,
        status, place, prize, start_attempt, entry_attempt, created_at, updated_at
      )
      SELECT
        id, tournament_id, room_id, profile_id, buy_in, fee,
        status, place, prize, start_attempt, 1, created_at, updated_at
      FROM sng_entries_v26_backup;

      DROP TABLE sng_entries_v26_backup;

      CREATE UNIQUE INDEX one_active_sng_entry_per_profile
        ON sng_entries(profile_id)
        WHERE status IN ('reserved', 'started');

      CREATE INDEX idx_sng_entries_room_status_tournament
        ON sng_entries(room_id, status, tournament_id);

      CREATE TRIGGER require_refunded_wallet_entries_before_cancellation
      BEFORE UPDATE OF status ON tournament_instance
      WHEN
        NEW.status = 'cancelled'
        AND NEW.economy_mode = 'wallet'
        AND EXISTS (
          SELECT 1
          FROM sng_entries AS entry
          WHERE entry.tournament_id = NEW.id
            AND entry.status IN ('reserved', 'started')
        )
      BEGIN
        SELECT RAISE(ABORT, 'wallet tournament has unresolved entries');
      END;
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
