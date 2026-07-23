import type { PokerDatabase } from '../persistence/database';

export interface GameConfigRow {
  key: string;
  value: string;
  updatedAt: number;
}

export interface GameConfigChange {
  key: string;
  /** null이면 오버라이드 삭제(기본값 복원) */
  value: number | null;
}

/**
 * 런타임 게임 설정 오버라이드 영속 (SQLite `game_config`, 마이그레이션 v24).
 * 오버라이드만 저장한다 — 행이 없으면 코드/env 기본값. 값 해석/검증은 GameConfigService 소관.
 */
export class GameConfigRepository {
  constructor(private readonly database: PokerDatabase) {}

  loadAll(): GameConfigRow[] {
    const rows = this.database.db.prepare(`
      SELECT key, value, updated_at FROM game_config ORDER BY key
    `).all() as Array<{ key: string; value: string; updated_at: number }>;
    return rows.map(row => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
    }));
  }

  /** 검증 완료된 변경 묶음을 단일 트랜잭션으로 반영 — 부분 적용 없음 */
  saveChanges(changes: readonly GameConfigChange[], at: number): void {
    if (changes.length === 0) return;
    this.database.transaction(() => {
      for (const change of changes) {
        if (change.value === null) {
          this.database.db.prepare(
            'DELETE FROM game_config WHERE key = ?',
          ).run(change.key);
        } else {
          this.database.db.prepare(`
            INSERT INTO game_config (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `).run(change.key, String(change.value), at);
        }
      }
    });
  }
}
