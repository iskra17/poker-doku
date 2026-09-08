/** Keep an explicitly configured legacy target compatible with its former default threshold.
 * Existing override rows are never changed. Unconfigured installations use the new 2000 default. */
export const LEGACY_RESCUE_COMPAT_SQL = `
  INSERT OR IGNORE INTO game_config (key, value, updated_at)
  SELECT 'economy.rescueThreshold', '800', updated_at
  FROM game_config
  WHERE key = 'economy.rescueTarget'
    AND CAST(value AS INTEGER) > 800 AND CAST(value AS INTEGER) < 2000;
`;

/** v41 is append-only. Never rewrite the v32–v39 catalog amounts or previous grant receipts. */
export const STORY_REWARD_SUPPLEMENTS_SQL = `
  ${LEGACY_RESCUE_COMPAT_SQL}
  INSERT INTO story_reward_catalog (item_id, kind, equip_slot, character_id, chip_amount)
  SELECT item_id || '-v2', 'chips', NULL, NULL,
    CASE WHEN item_id LIKE '%-s' THEN 200
         WHEN item_id LIKE '%-complete' THEN 1000
         ELSE 500 END
  FROM story_reward_catalog
  WHERE kind = 'chips'
    AND (item_id GLOB 'story-chips-act[1-4]-ch[0-9][0-9]-first'
      OR item_id GLOB 'story-chips-act[1-4]-ch[0-9][0-9]-s'
      OR item_id GLOB 'story-chips-act[1-4]-complete');
`;
