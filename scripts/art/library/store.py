import json
from pathlib import Path
import sqlite3
import time
from .common import canonical, confined

SCHEMA = '''
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recipes(hash TEXT PRIMARY KEY,definition TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(
 id TEXT PRIMARY KEY, spec_hash TEXT NOT NULL, spec TEXT NOT NULL,
 recipe_hash TEXT NOT NULL REFERENCES recipes(hash), kind TEXT NOT NULL,
 character TEXT NOT NULL, scene TEXT NOT NULL, seed INTEGER NOT NULL,
 state TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, prompt_id TEXT,
 output TEXT, output_hash TEXT, media TEXT, error TEXT, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS attempts(
 intent TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),number INTEGER NOT NULL,
 recipe_hash TEXT NOT NULL, state TEXT NOT NULL,prefix TEXT NOT NULL,
 started REAL NOT NULL,submitted REAL,finished REAL,prompt_id TEXT,error TEXT,preflight_seconds REAL,
 UNIQUE(job_id,number));
CREATE TABLE IF NOT EXISTS reviews(
 id INTEGER PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),output_hash TEXT NOT NULL,
 decision TEXT NOT NULL,reason TEXT NOT NULL,created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS exports(
 id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),source_hash TEXT NOT NULL,
 settings_hash TEXT NOT NULL,target TEXT NOT NULL UNIQUE,output_hash TEXT NOT NULL,
 staged TEXT NOT NULL,state TEXT NOT NULL,created REAL NOT NULL);
'''

class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        path = self.root/'library.sqlite3'
        if not path.exists(): raise ValueError('Initialize the independent art database first')
        self.db = sqlite3.connect(path, timeout=5)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA busy_timeout=5000')
        self.config = json.loads(self.db.execute("SELECT value FROM settings WHERE key='config'").fetchone()[0])
        if self.config['root'] != str(self.root): raise ValueError('Database belongs to a different job root')

    @classmethod
    def initialize(cls, root, target_root, input_root, output_root):
        root, target, inputs, outputs = [Path(p).resolve() for p in (root,target_root,input_root,output_root)]
        confined(outputs, root)
        for path in (root,target,inputs,outputs): path.mkdir(parents=True,exist_ok=True)
        config = dict(root=str(root),target_root=str(target),input_root=str(inputs),output_root=str(outputs),schema_version=1)
        db = sqlite3.connect(root/'library.sqlite3')
        try:
            db.execute('PRAGMA journal_mode=WAL'); db.executescript(SCHEMA)
            old = db.execute("SELECT value FROM settings WHERE key='config'").fetchone()
            if old and json.loads(old[0]) != config: raise ValueError('Configured roots cannot be changed')
            with db:
                db.execute("INSERT OR IGNORE INTO settings VALUES('config',?)", (canonical(config),))
                db.execute("INSERT OR IGNORE INTO settings VALUES('paused','false')")
        finally: db.close()
        return cls(root)

    def close(self): self.db.close()
    def rows(self, sql, parameters=()): return [dict(r) for r in self.db.execute(sql, parameters).fetchall()]
    def job(self, job_id):
        rows = self.rows('SELECT * FROM jobs WHERE id=?', (job_id,))
        if not rows: raise ValueError('Unknown job')
        return rows[0]
    def recipe(self, recipe_hash):
        return json.loads(self.db.execute('SELECT definition FROM recipes WHERE hash=?',(recipe_hash,)).fetchone()[0])
    def paused(self): return self.db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()[0]=='true'
    def pause(self, paused):
        with self.db: self.db.execute("UPDATE settings SET value=? WHERE key='paused'",('true' if paused else 'false',))
    def state(self, job_id, state, error=None):
        with self.db: self.db.execute('UPDATE jobs SET state=?,error=? WHERE id=?',(state,error,job_id))
    def fail_attempt(self, intent, state, error):
        with self.db:
            row=self.db.execute('SELECT job_id FROM attempts WHERE intent=?',(intent,)).fetchone()
            self.db.execute('UPDATE attempts SET state=?,error=?,finished=? WHERE intent=?',(state,error,time.time(),intent))
            self.db.execute('UPDATE jobs SET state=?,error=? WHERE id=?',(state,error,row[0]))
